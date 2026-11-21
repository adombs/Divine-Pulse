"""Read-only access to the emulator process (Windows: memory_windows.py, macOS: memory_macos.py)."""

from __future__ import annotations

import sys
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


class ProcessMemory(Protocol):
    pid: int

    def regions(self) -> Iterator[Region]:
        """Committed, readable regions, lowest address first."""

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""

    def alive(self) -> bool: ...

    def close(self) -> None: ...


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
        i = data.find(pattern)
        while i != -1 and i < SEARCH_CHUNK:
            if (base + offset + i) % alignment == 0:
                found.append(base + offset + i)
            i = data.find(pattern, i + 1)
    return found


def _platform():
    if sys.platform == "win32":
        from . import memory_windows as platform
    elif sys.platform == "darwin":
        from . import memory_macos as platform
    else:
        raise OSError("Reading the emulator's memory is supported on Windows and macOS.")
    return platform


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running programs whose executable name (lower case) is in `exe_names`."""
    return _platform().find_processes({n.lower() for n in exe_names})


def process_paths(exe_names: set[str]) -> list[str]:
    """Full executable paths of running programs whose executable name is in `exe_names` (none elsewhere)."""
    if sys.platform not in ("win32", "darwin"):
        return []
    return _platform().process_paths({n.lower() for n in exe_names})


def open_process(pid: int) -> ProcessMemory:
    """Open a process for reading. Raises AccessDenied if the OS refuses, OSError if it's gone."""
    return _platform().Process(pid)
