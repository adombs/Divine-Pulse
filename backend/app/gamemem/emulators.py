"""The emulators the tracker can read FE3H from, and where each keeps the Switch's memory (docs/porting.md).

Supporting another emulator is adding an entry to EMULATORS: its executable names on Windows and a memory layout
that says where to look for the game inside the emulator's memory. The game side (fe3h.py) stays as it is.
"""

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

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        """Regions to search for the game's heap data (the units' battle copies)."""

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        """Host addresses where Switch address 0 may be, tried when the game's own pointers don't say."""


class Fastmem:
    """yuzu and its forks with fastmem on: the Switch's memory is mapped into the emulator's own as shared views,
    so a game address `a` is at host address `arena + a`. The emulator also keeps a 4 GiB block of the Switch's
    physical RAM, a second view of the same memory, which is skipped when searching."""

    def module_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if r.mapped)

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if r.mapped and r.size < FOUR_GIB)

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        # Just after the 4 GiB block, where Eden was seen to put it.
        block = next((r.base for r in process.regions() if r.size == FOUR_GIB), None)
        return [] if block is None else [block + FOUR_GIB + k * 0x10000 for k in range(0x400)]


@dataclass(frozen=True)
class Emulator:
    name: str
    # Executable names (lower case) on Windows.
    executables: frozenset[str]
    layout: MemoryLayout
    # Checked against the game by hand. Others share a tested one's code and layout but haven't been tried.
    tested: bool = False
    # What the emulator needs for the tracker to find the game, shown when it isn't found.
    requirement: str = ""


def _yuzu_family(name: str, exe: str, tested: bool = False) -> Emulator:
    return Emulator(
        name,
        frozenset({f"{exe}.exe"}),
        Fastmem(),
        tested,
        f"{name}'s fastmem setting must be on (it is by default)",
    )


EMULATORS: tuple[Emulator, ...] = (
    _yuzu_family("Eden", "eden", tested=True),
    _yuzu_family("yuzu", "yuzu"),
    _yuzu_family("Citron", "citron"),
    _yuzu_family("Sudachi", "sudachi"),
    _yuzu_family("Suyu", "suyu"),
    _yuzu_family("Torzu", "torzu"),
)


def running(emulators: Iterable[Emulator] = EMULATORS) -> list[tuple[Emulator, int]]:
    """The supported emulators running now, with their process IDs (tested ones first)."""
    emulators = sorted(emulators, key=lambda e: not e.tested)
    by_name = {exe: e for e in emulators for exe in e.executables}
    if not by_name:
        return []
    found = find_processes(set(by_name))
    return sorted(((by_name[name], pid) for pid, name in found), key=lambda x: (not x[0].tested, x[1]))


def names(emulators: Iterable[Emulator] = EMULATORS) -> str:
    """'Eden, yuzu, Citron, Sudachi, Suyu or Torzu'."""
    listed = [e.name for e in emulators]
    return listed[0] if len(listed) == 1 else f"{', '.join(listed[:-1])} or {listed[-1]}"
