"""Locate the Eden process and the game inside its fastmem mapping, and what every emulator's layout provides."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from ..system.memory import ProcessMemory, Region, find_processes

FOUR_GIB = 1 << 32


class MemoryLayout(Protocol):
    """Where the Switch's memory is inside an emulator's."""

    def module_regions(self, process: ProcessMemory) -> Iterable[Region]:
        """Regions the game's main program may start at."""

    def main_candidates(self, process: ProcessMemory, header: bytes) -> Iterable[int]:
        """Host addresses the game's main program may start at (it starts with `header`)."""

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        """Regions to search for the game's heap data (the units' battle copies)."""

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        """Host addresses where Switch address 0 may be, tried when the game's own pointers don't say."""


def region_starts(layout: MemoryLayout, process: ProcessMemory) -> Iterable[int]:
    """main_candidates for a layout whose main program starts a region."""
    return (r.base for r in layout.module_regions(process))


class Fastmem:
    """Eden with fastmem on: the Switch's memory is mapped into the emulator's own as shared views,
    so a game address `a` is at host address `arena + a`. The emulator also keeps a 4 GiB block of the Switch's
    physical RAM, a second view of the same memory, which is skipped when searching."""

    def module_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if r.mapped)

    def main_candidates(self, process: ProcessMemory, header: bytes) -> Iterable[int]:
        return region_starts(self, process)

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if r.mapped and r.size < FOUR_GIB)

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        # Just after the 4 GiB block, where Eden was seen to put it.
        block = next((r.base for r in process.regions() if r.size == FOUR_GIB), None)
        return [] if block is None else [block + FOUR_GIB + k * 0x10000 for k in range(0x400)]


@dataclass(frozen=True)
class Emulator:
    name: str
    # Executable names (lower case): Windows' with .exe, macOS's without.
    executables: frozenset[str]
    layout: MemoryLayout
    # What the emulator needs for the tracker to find the game, shown when it isn't found.
    requirement: str = ""


EMULATORS = (Emulator("Eden", frozenset({"eden.exe"}), Fastmem(), "Eden's fastmem setting must be on"),)


def running(emulators: Iterable[Emulator] = EMULATORS) -> list[tuple[Emulator, int]]:
    """Running Eden processes, in process ID order."""
    by_name = {exe: e for e in emulators for exe in e.executables}
    if not by_name:
        return []
    found = find_processes(set(by_name))
    return sorted(((by_name[name], pid) for pid, name in found), key=lambda x: x[1])


def names(emulators: Iterable[Emulator] = EMULATORS) -> str:
    """The supported emulator name."""
    listed = [e.name for e in emulators]
    return listed[0] if len(listed) == 1 else f"{', '.join(listed[:-1])} or {listed[-1]}"
