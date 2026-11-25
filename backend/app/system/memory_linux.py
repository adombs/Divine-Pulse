"""Read-only access to another process's memory on Linux (see memory.py).

Most distributions stop a program from reading another's memory (Yama's ptrace_scope is 1: only a debugger may read
its own children), so process_vm_readv usually fails. The emulators' Switch memory can be read anyway: Eden and
Ryujinx keep it in a file that exists only in memory (a memfd named HostMemory, an unlinked /dev/shm/Ryujinx-*) and map
it, and a program's open files can be opened by the same user's other programs through /proc/<pid>/fd, which Yama does
not restrict. So:

- /proc/<pid>/maps says which stretch of which file is at which address;
- those stretches are read from the file itself, opened read-only (nothing is stopped, attached to or written). Reading
  a file also leaves the parts the emulator never touched unallocated, which reading its memory would not;
- everything else is read with process_vm_readv, where the system allows it.
"""

from __future__ import annotations

import bisect
import ctypes
import errno
import logging
import os
import re
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .memory import SEARCH_CHUNK, AccessDenied, Region, matches

log = logging.getLogger(__name__)

PROC = Path("/proc")
# How old the list of mappings may be when reading. Emulators map and unmap the game's memory as it runs.
MAPS_TTL_S = 1.0
COMM_LENGTH = 15  # the kernel keeps this much of a process's name in /proc/<pid>/comm
# Programs that run another one: the emulator is their first argument (a framework-dependent Ryujinx build).
HOSTS = frozenset({"dotnet"})

_MAP_LINE = re.compile(rb"^([0-9a-f]+)-([0-9a-f]+) (\S{4}) ([0-9a-f]+) ([0-9a-f]+):([0-9a-f]+) (\d+) *([^\n]*)$", re.M)
_WRAPPED = re.compile(r"^\.(.+)-wrapped$")  # NixOS's name for a program it wraps in a script


# Listing processes


def _read(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        return b""


def _program_name(path: str) -> str:
    """A program's name from its path, lower case, as the emulators are listed (gamemem)."""
    name = path.rsplit("/", 1)[-1].removesuffix(" (deleted)")  # updated while it runs
    if wrapped := _WRAPPED.match(name):
        name = wrapped.group(1)
    return name.lower()


def _process_names(entry: Path, exe: str) -> set[str]:
    """What a process may be called: its executable, the name it was started by (an AppImage built with sharun runs the
    emulator inside a loader whose executable has another name), or the program a host such as dotnet runs."""
    found = {_program_name(exe)}
    arguments = [os.fsdecode(a) for a in _read(entry / "cmdline").split(b"\0")[:2]]
    if arguments and arguments[0]:
        found.add(_program_name(arguments[0]))
    if found & HOSTS and len(arguments) > 1 and arguments[1].lower().endswith(".dll"):
        found.add(_program_name(arguments[1])[: -len(".dll")])
    comm = os.fsdecode(_read(entry / "comm")).strip()
    if 0 < len(comm) < COMM_LENGTH:  # a longer one is cut short
        found.add(_program_name(comm))
    return found


def _all_processes() -> list[tuple[int, str, set[str]]]:
    """(pid, executable path, names) of every process whose executable this user can see."""
    found = []
    try:
        entries = list(PROC.iterdir())
    except OSError:
        return []
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            exe = os.readlink(entry / "exe")
        except OSError:
            continue
        found.append((int(entry.name), exe, _process_names(entry, exe)))
    return found


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running processes with one of these names (lower case)."""
    return [(pid, min(known)) for pid, _exe, names in _all_processes() if (known := names & exe_names)]


def similar_processes(exe_names: set[str]) -> list[str]:
    """Running programs with one of these names somewhere in theirs: an emulator packaged in a way that isn't known
    yet. Names only, not paths or arguments."""
    return sorted({
        ", ".join(sorted(names)) for pid, _exe, names in _all_processes()
        if pid != os.getpid() and not names & exe_names and any(known in name for known in exe_names for name in names)
    })


def process_paths(exe_names: set[str]) -> list[str]:
    """Where the running processes with one of these names (lower case) are: the executable's path, and that name in
    the folder of the AppImage it came from and in its working folder (where a portable Eden's `user` folder is)."""
    found: list[str] = []
    for pid, exe, names in _all_processes():
        for name in sorted(names & exe_names):
            paths = [exe if _program_name(exe) == name else os.path.join(os.path.dirname(exe), name)]
            folders = []
            for variable in _read(PROC / str(pid) / "environ").split(b"\0"):
                if variable.startswith(b"APPIMAGE=/"):
                    folders.append(os.path.dirname(os.fsdecode(variable.partition(b"=")[2])))
            try:
                folders.append(os.readlink(PROC / str(pid) / "cwd"))
            except OSError:
                pass
            paths += [os.path.join(folder, name) for folder in folders if folder != os.path.dirname(exe)]
            found += paths
    return list(dict.fromkeys(found))


# Mappings


@dataclass(frozen=True)
class Mapping:
    base: int
    end: int
    readable: bool
    writable: bool
    shared: bool
    offset: int  # of `base` in the file
    device: int
    inode: int  # 0: not a file
    path: str

    @property
    def key(self) -> tuple[int, int]:
        return self.device, self.inode

    @property
    def shared_memory(self) -> bool:
        """Memory shared through a file that is only in memory: a memfd, a file in /dev/shm, or an unlinked file (a
        Flatpak's own /dev/shm isn't named as such from outside it). Not a device's, such as a graphics card's."""
        if not self.shared or self.inode == 0:
            return False
        if self.path.startswith(("/memfd:", "/dev/shm/", "/dev/zero")):
            return True
        return self.path.endswith(" (deleted)") and not self.path.startswith("/dev/")


def parse_maps(text: bytes) -> list[Mapping]:
    """/proc/<pid>/maps, lowest address first."""
    out = []
    for m in _MAP_LINE.finditer(text):
        perms = m.group(3)
        out.append(Mapping(
            int(m.group(1), 16), int(m.group(2), 16), perms[:1] == b"r", perms[1:2] == b"w", perms[3:4] == b"s",
            int(m.group(4), 16), int(m.group(5), 16) << 20 | int(m.group(6), 16), int(m.group(7)),
            os.fsdecode(m.group(8)),
        ))
    return out


def _device(st_dev: int) -> int:
    """A stat's device as maps writes one (major:minor), in Mapping.device's form."""
    return os.major(st_dev) << 20 | os.minor(st_dev)


# Reading


class _IoVec(ctypes.Structure):
    _fields_ = [("base", ctypes.c_void_p), ("length", ctypes.c_size_t)]


_libc = None


def _process_vm_readv(pid: int, address: int, size: int) -> bytes:
    """`size` bytes of another process's memory. Raises OSError (EPERM when the system doesn't allow it)."""
    global _libc
    if _libc is None:
        lib = ctypes.CDLL(None, use_errno=True)
        lib.process_vm_readv.restype = ctypes.c_ssize_t
        lib.process_vm_readv.argtypes = [ctypes.c_int, ctypes.POINTER(_IoVec), ctypes.c_ulong, ctypes.POINTER(_IoVec),
                                         ctypes.c_ulong, ctypes.c_ulong]
        _libc = lib
    buffer = ctypes.create_string_buffer(size)
    local, remote = _IoVec(ctypes.addressof(buffer), size), _IoVec(address, size)
    got = _libc.process_vm_readv(pid, ctypes.byref(local), 1, ctypes.byref(remote), 1, 0)
    if got < 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))
    if got != size:
        raise OSError(errno.EFAULT, "Part of the memory can't be read")
    return buffer.raw


def _start_time(pid: int) -> bytes | None:
    """When the process started (clock ticks since boot): tells it from a later one with the same pid. None once it
    has ended, also while it waits for its parent to collect it."""
    fields = _read(PROC / str(pid) / "stat").rpartition(b")")[2].split()  # after "pid (name)"
    return fields[19] if len(fields) > 19 and fields[0] not in (b"Z", b"X") else None


class Process:
    """A process opened for reading. Close it when done. Safe to use from several threads."""

    def __init__(self, pid: int):
        self.pid = pid
        self._lock = threading.RLock()
        self._files: dict[tuple[int, int], int | None] = {}  # the emulator's shared memory, opened read-only
        self._open: dict[tuple[int, int], str] | None = None  # the emulator's own open files, listed when needed
        self._maps: list[Mapping] = []
        self._bases: list[int] = []
        self._read_at = 0.0
        self._closed = False
        self._direct = True  # process_vm_readv is allowed, until it says otherwise
        self._started = _start_time(pid)
        if self._started is None:
            raise OSError(errno.ESRCH, f"Process {pid} isn't running")
        try:
            text = (PROC / str(pid) / "maps").read_bytes()
        except PermissionError as exc:
            raise AccessDenied(exc.errno, f"Linux refused access to process {pid}") from exc
        if not text:  # another user's: the list opens but is empty
            raise AccessDenied(errno.EACCES, f"Linux refused access to process {pid}")
        self._use(text)
        self._try_direct()

    def _try_direct(self) -> None:
        readable = next((m for m in self._maps if m.readable and not m.shared and m.path != "[vvar]"), None)
        if readable is not None:
            try:
                _process_vm_readv(self.pid, readable.base, 8)
            except PermissionError:
                self._direct = False
            except (OSError, AttributeError):  # (no such call)
                pass

    def _use(self, text: bytes) -> None:
        self._maps = parse_maps(text)
        self._bases = [m.base for m in self._maps]
        self._read_at = time.monotonic()
        # A file the emulator no longer maps (it closed the game): holding it open would keep its memory allocated.
        live = {m.key for m in self._maps if m.shared_memory}
        for key in [k for k in self._files if k not in live]:
            fd = self._files.pop(key)
            if fd is not None:
                os.close(fd)
        # One that couldn't be opened is tried again; new ones are opened when they're first read.
        self._open = None
        for key in [k for k, fd in self._files.items() if fd is None]:
            del self._files[key]

    def _refresh(self, force: bool = False) -> bool:
        """Read the mappings again if they're old. False once the process has gone."""
        if self._closed:
            return False
        if not force and time.monotonic() - self._read_at < MAPS_TTL_S:
            return True
        text = _read(PROC / str(self.pid) / "maps") if _start_time(self.pid) == self._started else b""
        self._use(text)
        return bool(text)

    def _file(self, mapping: Mapping) -> int | None:
        """The mapping's shared memory, opened read-only through the process's own open file. None if it isn't shared
        memory or can't be opened."""
        if not mapping.shared_memory:
            return None
        if mapping.key not in self._files:
            self._files[mapping.key] = self._open_file(mapping.key)
        return self._files[mapping.key]

    def _open_files(self) -> dict[tuple[int, int], str]:
        """/proc/<pid>/fd's path for each file the process has open, by device and inode."""
        if self._open is None:
            self._open = {}
            folder = PROC / str(self.pid) / "fd"
            try:
                names = os.listdir(folder)
            except OSError:
                return self._open
            for name in names:
                try:
                    found = os.stat(f"{folder}/{name}")
                except OSError:
                    continue
                self._open.setdefault((_device(found.st_dev), found.st_ino), f"{folder}/{name}")
        return self._open

    def _open_file(self, key: tuple[int, int]) -> int | None:
        path = self._open_files().get(key)
        if path is None:
            return None
        try:
            fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NONBLOCK)
        except OSError:
            return None
        opened = os.fstat(fd)
        if (_device(opened.st_dev), opened.st_ino) == key:
            return fd
        os.close(fd)  # the process has reused the number for another file meanwhile
        return None

    def close(self) -> None:
        with self._lock:
            self._closed = True
            for fd in self._files.values():
                if fd is not None:
                    os.close(fd)
            self._files, self._maps, self._bases = {}, [], []

    def alive(self) -> bool:
        return not self._closed and _start_time(self.pid) == self._started

    def describe(self) -> str:
        """What can be read of it, for the log: enough to see why the game wasn't found, in a player's report."""
        with self._lock:
            self._refresh()
            shared: dict[tuple[int, int], list[Mapping]] = {}
            for m in self._maps:
                if m.shared_memory:
                    shared.setdefault(m.key, []).append(m)
            # The emulated memory is gigabytes: the smaller ones (windows, sound) say nothing.
            files = [
                f"{views[0].path} ({sum(m.end - m.base for m in views) >> 20} MiB in {len(views)} mapping(s), "
                f"{'opened' if self._file(views[0]) is not None else 'not opened'})"
                for views in shared.values() if sum(m.end - m.base for m in views) >= 64 << 20
            ]
            largest = max((m.end - m.base for m in self._maps if m.readable and m.inode == 0), default=0)
            names = ", ".join(sorted(_process_names(PROC / str(self.pid), os.readlink(PROC / str(self.pid) / "exe"))))
        scope = os.fsdecode(_read(PROC / "sys/kernel/yama/ptrace_scope")).strip() or "none"
        return (f"{names}; direct reads {'allowed' if self._direct else 'refused'} (ptrace_scope {scope}); shared memory: "
                f"{'; '.join(files) or 'none'}; largest private mapping {largest >> 20} MiB")

    def _visible(self, mapping: Mapping) -> bool:
        if self._file(mapping) is not None:
            return True
        device = mapping.path.startswith("/dev/") and not mapping.shared_memory
        return self._direct and mapping.readable and not device

    def regions(self) -> Iterator[Region]:
        """Regions that can be read, lowest address first. `mapped` is shared memory."""
        with self._lock:
            if not self._refresh(force=True):
                return
            found = [self._region(m) for m in self._maps if self._visible(m)]
        yield from found

    def hidden_regions(self) -> Iterator[Region]:
        """The process's own readable regions that the system won't let this one read."""
        with self._lock:
            if not self._refresh():
                return
            found = [self._region(m) for m in self._maps if m.readable and m.inode == 0 and not self._visible(m)]
        yield from found

    @staticmethod
    def _region(m: Mapping) -> Region:
        file = f"{m.device:x}:{m.inode}" if m.inode else ""
        return Region(m.base, m.end - m.base, m.shared_memory, m.writable, file, m.offset)

    def _pieces(self, address: int, size: int) -> list[tuple[Mapping, int, int]] | None:
        """(mapping, address, size) for each mapping the range lies in, or None when part of it is in none."""
        out, end = [], address + size
        i = bisect.bisect_right(self._bases, address) - 1
        while address < end:
            if not 0 <= i < len(self._maps) or not self._maps[i].base <= address < self._maps[i].end:
                return None
            n = min(end, self._maps[i].end) - address
            out.append((self._maps[i], address, n))
            address += n
            i += 1
        return out

    def _read_piece(self, mapping: Mapping, address: int, size: int) -> bytes | None:
        fd = self._file(mapping)
        if fd is None:
            return _process_vm_readv(self.pid, address, size) if self._direct and mapping.readable else None
        data = os.pread(fd, size, mapping.offset + address - mapping.base)
        return data if len(data) == size else None

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""
        if size < 0 or address < 0:
            return None
        with self._lock:
            if not self._refresh():
                return None
            pieces = self._pieces(address, size)
            if pieces is None and self._refresh(force=True):  # mapped since the list was read?
                pieces = self._pieces(address, size)
            if pieces is None:
                return None
            data = []
            for mapping, at, n in pieces:
                try:
                    part = self._read_piece(mapping, at, n)
                except OSError:
                    return None
                if part is None:
                    return None
                data.append(part)
        return b"".join(data)

    def search(self, base: int, size: int, pattern: bytes, alignment: int = 1) -> list[int]:
        """Addresses in [base, base + size) where `pattern` starts and that are a multiple of `alignment`
        (memory.search). The parts of shared memory that were never written are skipped."""
        found: list[int] = []
        end = base + size
        with self._lock:
            maps = list(self._maps)
        for m in maps:
            low, high = max(m.base, base), min(m.end, end)
            if low >= high:
                continue
            for start, stop in self._written(m, low, high):
                for address in range(start, stop, SEARCH_CHUNK):
                    # Past the chunk's end by what a match starting in its last byte needs, where there is more.
                    data = self._read_up_to(m, address, min(stop, address + SEARCH_CHUNK), min(high, stop + len(pattern) - 1), len(pattern) - 1)
                    if data is not None:
                        limit = min(stop, address + SEARCH_CHUNK) - address
                        found += [address + i for i in matches(data, pattern, address, alignment) if i < limit]
        return found

    def _read_up_to(self, m: Mapping, address: int, end: int, most: int, extra: int) -> bytes | None:
        with self._lock:
            if self._closed:
                return None
            try:
                return self._read_piece(m, address, min(most, end + extra) - address)
            except OSError:
                return None

    def _written(self, m: Mapping, low: int, high: int) -> list[tuple[int, int]]:
        """The stretches of [low, high) that hold data: all of it, or the file's parts between its holes."""
        with self._lock:
            fd = None if self._closed else self._file(m)
            if fd is None:
                return [] if self._closed else [(low, high)]
            delta = m.base - m.offset
            at, out = low, []
            try:
                while at < high:
                    start = os.lseek(fd, at - delta, os.SEEK_DATA) + delta
                    if start >= high:
                        break
                    stop = min(high, os.lseek(fd, start - delta, os.SEEK_HOLE) + delta)
                    out.append((start, stop))
                    at = stop
            except OSError as exc:
                if exc.errno != errno.ENXIO:  # ENXIO: no data after here
                    return [(low, high)]
            return out
