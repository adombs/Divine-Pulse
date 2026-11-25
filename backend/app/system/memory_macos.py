"""Read-only access to another process's memory on macOS (see memory.py).

macOS gives another process's memory only to a program signed with the debugger entitlement, so the reads go
through a small helper, `dp-memreader` (macos/dp_memreader.c), signed ad hoc with macos/entitlements.plist. The
target must allow it too (com.apple.security.get-task-allow), as Astris's builds do. The helper is built from source
on first use when it isn't bundled (Xcode's command-line tools: clang and codesign).

Listing processes needs no privileges: libproc's proc_listallpids and proc_pidpath.
"""

from __future__ import annotations

import ctypes
import logging
import os
import shutil
import struct
import subprocess
import sys
import threading
from collections.abc import Iterator
from pathlib import Path

from .memory import AccessDenied, Region

log = logging.getLogger(__name__)

SOURCE_DIR = Path(__file__).resolve().parent / "macos"
HELPER_NAME = "dp-memreader"
PROC_PIDPATHINFO_MAXSIZE = 4096
VM_PROT_READ, VM_PROT_WRITE = 0x1, 0x2
# vm_region share modes (mach/vm_region.h). SM_SHARED and SM_TRUESHARED are memory shared with another mapping
# (Astris's guest memory is a shared mapping of its backing block); SM_PRIVATE and SM_COW are the process's own.
SM_COW, SM_PRIVATE, SM_EMPTY, SM_SHARED, SM_TRUESHARED, SM_PRIVATE_ALIASED, SM_SHARED_ALIASED, SM_LARGE_PAGE = range(1, 9)
SHARED_MODES = frozenset({SM_SHARED, SM_TRUESHARED, SM_SHARED_ALIASED, SM_LARGE_PAGE})
KERN_SUCCESS = 0
_REGION = struct.Struct("<QQIII")


def _libproc():
    lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    lib.proc_listallpids.restype = ctypes.c_int
    lib.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidpath.restype = ctypes.c_int
    lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
    return lib


def _all_processes() -> list[tuple[int, str]]:
    """(pid, executable path) of every process this user can see."""
    lib = _libproc()
    count = lib.proc_listallpids(None, 0)
    if count <= 0:
        return []
    pids = (ctypes.c_int * (count + 64))()
    count = lib.proc_listallpids(pids, ctypes.sizeof(pids))
    found = []
    buffer = ctypes.create_string_buffer(PROC_PIDPATHINFO_MAXSIZE)
    for pid in pids[: max(count, 0)]:
        if pid <= 0:
            continue
        if lib.proc_pidpath(pid, buffer, PROC_PIDPATHINFO_MAXSIZE) > 0:
            found.append((pid, os.fsdecode(buffer.value)))
    return found


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running processes whose executable name (lower case) is in `exe_names`."""
    return [(pid, name) for pid, path in _all_processes() if (name := Path(path).name.lower()) in exe_names]


def process_paths(exe_names: set[str]) -> list[str]:
    """The full executable paths of running processes whose executable name (lower case) is in `exe_names`."""
    return [path for _pid, path in _all_processes() if Path(path).name.lower() in exe_names]


def _bundled_helper() -> Path | None:
    """The helper shipped with a packaged build, if any."""
    meipass = getattr(sys, "_MEIPASS", None)
    candidates = [Path(meipass) / HELPER_NAME] if meipass else []
    candidates.append(Path(sys.executable).resolve().parent / HELPER_NAME)
    return next((c for c in candidates if c.is_file()), None)


_build_lock = threading.Lock()


def helper_path(build_dir: Path | None = None) -> Path:
    """The signed helper, building it from source (into `build_dir`, by default the data folder's bin/) when no
    bundled copy exists or the source is newer. Raises OSError when it can't be built."""
    if (bundled := _bundled_helper()) is not None:
        return bundled
    if build_dir is None:
        from ..infrastructure.paths import DATA_DIR

        build_dir = DATA_DIR / "bin"
    target = build_dir / HELPER_NAME
    source = SOURCE_DIR / "dp_memreader.c"
    with _build_lock:
        if target.is_file() and target.stat().st_mtime >= source.stat().st_mtime:
            return target
        build(target)
    return target


def build(target: Path) -> None:
    """Compile and sign the helper at `target`. Raises OSError with what went wrong."""
    clang, codesign = shutil.which("clang"), shutil.which("codesign")
    if not clang or not codesign:
        raise OSError("Reading the emulator's memory needs Xcode's command-line tools. Run: xcode-select --install")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    steps = (
        [clang, "-O2", "-Wall", "-o", str(temporary), str(SOURCE_DIR / "dp_memreader.c")],
        [codesign, "--force", "--sign", "-", "--entitlements", str(SOURCE_DIR / "entitlements.plist"), str(temporary)],
    )
    for step in steps:
        result = subprocess.run(step, capture_output=True, text=True)
        if result.returncode != 0:
            temporary.unlink(missing_ok=True)
            raise OSError(f"Couldn't build the memory reader ({Path(step[0]).name}): {result.stderr.strip()}")
    os.replace(temporary, target)
    log.info("Built the memory reader at %s", target)


class Process:
    """A process opened for reading through the helper. Close it when done. Safe to use from several threads."""

    def __init__(self, pid: int, helper: Path | None = None):
        self.pid = pid
        self._lock = threading.Lock()
        self._proc = subprocess.Popen(
            [str(helper or helper_path()), str(pid)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, bufsize=0,
        )
        head = self._exactly(4)
        status = struct.unpack("<i", head)[0] if head is not None else -1
        if status != KERN_SUCCESS:
            self.close()
            if not self._exists():
                raise OSError(f"Process {pid} isn't running")
            raise AccessDenied(status, f"macOS refused access to process {pid} (kern_return {status})")

    def _exists(self) -> bool:
        try:
            os.kill(self.pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def _exactly(self, n: int) -> bytes | None:
        out = self._proc.stdout
        if out is None:
            return None
        chunks, left = [], n
        while left:
            chunk = out.read(left)
            if not chunk:
                return None
            chunks.append(chunk)
            left -= len(chunk)
        return b"".join(chunks)

    def _send(self, data: bytes) -> bool:
        try:
            assert self._proc.stdin is not None
            self._proc.stdin.write(data)
            return True
        except (OSError, ValueError, AssertionError):
            return False

    def close(self) -> None:
        proc = getattr(self, "_proc", None)
        if proc is None:
            return
        self._proc = None  # type: ignore[assignment]
        try:
            if proc.stdin:
                proc.stdin.write(b"Q")
                proc.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        if proc.stdout:
            proc.stdout.close()

    def alive(self) -> bool:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None or not self._send(b"A"):
                return False
            answer = self._exactly(1)
        return answer == b"\x01"

    def regions(self) -> Iterator[Region]:
        """Readable regions, lowest address first. `mapped` is memory shared with another mapping."""
        rows = []
        with self._lock:
            if self._proc is None or not self._send(b"M"):
                return
            while (row := self._exactly(_REGION.size)) is not None:
                base, size, protection, share_mode, _tag = _REGION.unpack(row)
                if size == 0:
                    break
                rows.append((base, size, protection, share_mode))
        for base, size, protection, share_mode in rows:
            if protection & VM_PROT_READ:
                yield Region(base, size, share_mode in SHARED_MODES, bool(protection & VM_PROT_WRITE))

    def search(self, base: int, size: int, pattern: bytes, alignment: int = 1) -> list[int]:
        """Addresses in [base, base + size) where `pattern` starts and that are a multiple of `alignment`, searched
        by the helper (memory.search)."""
        if not 0 < alignment <= 0xFFFFFFFF:
            raise ValueError("alignment must fit in 32 bits")
        if not 0 < len(pattern) <= 256 or size <= 0:
            return []
        found = []
        with self._lock:
            request = struct.pack("<cQQII", b"S", base, size, max(alignment, 1), len(pattern)) + pattern
            if self._proc is None or not self._send(request):
                return []
            while (row := self._exactly(8)) is not None:
                address = struct.unpack("<Q", row)[0]
                if address == 0:
                    break
                found.append(address)
        return found

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""
        if size < 0 or address < 0:
            return None
        with self._lock:
            if self._proc is None or not self._send(struct.pack("<cQQ", b"R", address, size)):
                return None
            ok = self._exactly(1)
            if ok != b"\x01":
                return None
            return self._exactly(size)
