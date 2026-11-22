"""Read-only access to the emulator process: memory_windows.py, memory_macos.py, memory_linux.py, as
platform.current().memory() picks."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol

SEARCH_CHUNK = 1 << 26


class AccessDenied(OSError):
    """The OS refused to open the process (e.g. it runs as administrator and we don't)."""


@dataclass(frozen=True)
class Region:
    base: int
    size: int
    mapped: bool  # a file or shared-memory view (where Eden maps the Switch's memory)
    # Whether the emulator can write it (the Switch's memory always is); None where the OS reader doesn't say.
    writable: bool | None = None
    # The file it is a view of ("" for none), and where in the file it starts; None where the OS reader doesn't say.
    file: str | None = None
    offset: int = 0

    def continues(self, before: Region) -> bool:
        """Whether this region is the next part of the memory `before` is part of, not just next to it. Where the
        reader doesn't name files, any back-to-back region is."""
        if before.base + before.size != self.base:
            return False
        if self.file is None or before.file is None:
            return True
        return bool(self.file) and self.file == before.file and before.offset + before.size == self.offset


class ProcessMemory(Protocol):
    pid: int

    def regions(self) -> Iterator[Region]:
        """Committed, readable regions, lowest address first."""

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""

    def alive(self) -> bool: ...

    def close(self) -> None: ...


def matches(data: bytes, pattern: bytes, base: int = 0, alignment: int = 1) -> Iterator[int]:
    """Offsets in `data` (read from address `base`) where `pattern` starts at a multiple of `alignment`."""
    if alignment >= 256:  # far apart: look at each place rather than at every byte
        for i in range(-base % alignment, len(data) - len(pattern) + 1, alignment):
            if data.startswith(pattern, i):
                yield i
        return
    i = data.find(pattern)
    while i != -1:
        if (base + i) % alignment == 0:
            yield i
        i = data.find(pattern, i + 1)


def search(process: ProcessMemory, base: int, size: int, pattern: bytes, alignment: int = 1) -> list[int]:
    """Addresses in [base, base + size) where `pattern` starts, keeping those that are a multiple of `alignment`.
    Parts that can't be read are skipped. Uses the reader's own search when it has one (the macOS helper searches
    without copying the memory over)."""
    native = getattr(process, "search", None)
    if native is not None:
        return native(base, size, pattern, alignment)
    found = []
    for offset in range(0, size, SEARCH_CHUNK):
        data = process.read(base + offset, min(SEARCH_CHUNK + len(pattern) - 1, size - offset))
        if data is None:
            continue
        found += [base + offset + i for i in matches(data, pattern, base + offset, alignment) if i < SEARCH_CHUNK]
    return found


def _platform():
    from .platform import current

    return current().memory()


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running programs whose executable name (lower case) is in `exe_names`."""
    return _platform().find_processes({n.lower() for n in exe_names})


def process_paths(exe_names: set[str]) -> list[str]:
    """Full executable paths of running programs whose executable name is in `exe_names`."""
    return _platform().process_paths({n.lower() for n in exe_names})


def similar_processes(exe_names: set[str]) -> list[str]:
    """Running programs that may be these under another name, for the log (Linux, where they're installed in many
    ways)."""
    similar = getattr(_platform(), "similar_processes", None)
    return similar({n.lower() for n in exe_names}) if similar is not None else []


def open_process(pid: int) -> ProcessMemory:
    """Open a process for reading. Raises AccessDenied if the OS refuses, OSError if it's gone."""
    return _platform().Process(pid)
