"""Read-only access to the emulator process on Windows."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol


class AccessDenied(OSError):
    """The OS refused to open the process (e.g. it runs as administrator and we don't)."""


@dataclass(frozen=True)
class Region:
    base: int
    size: int
    mapped: bool  # a file or shared-memory view (where Eden maps the Switch's memory)


class ProcessMemory(Protocol):
    pid: int

    def regions(self) -> Iterator[Region]:
        """Committed, readable regions, lowest address first."""

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""

    def alive(self) -> bool: ...

    def close(self) -> None: ...


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running programs whose executable name (lower case) is in `exe_names`."""
    from .memory_windows import find_processes as find_windows_processes

    return find_windows_processes({n.lower() for n in exe_names})


def open_process(pid: int) -> ProcessMemory:
    """Open a process for reading. Raises AccessDenied if the OS refuses, OSError if it's gone."""
    from .memory_windows import Process

    return Process(pid)
