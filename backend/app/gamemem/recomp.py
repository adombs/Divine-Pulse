"""Locate FE3H Recomp (a static recompilation that runs the game natively on Windows) and the game inside it.

FE3H Recomp has no emulated CPU and no fastmem mapping to find. The Switch's memory is ordinary private memory of the
`fe3hrecomp.exe` process, reserved in a fixed window, and a game address is the process's own address (the runtime's
rt.h: "guest addresses == host addresses"). The main program sits at the window's start, and the roster, the battle
copies and the battle history are laid out exactly as in the Switch version, so everything after finding the process
is shared with the Eden reader (fe3h.py).
"""

from __future__ import annotations

from collections.abc import Iterable

from ..system.memory import ProcessMemory, Region
from .emulators import Emulator

# The window the recomp reserves for the game (rt.h: GUEST_LO ... GUEST_HI is 0x7000000000-0x7320000000; the runtime
# itself accepts pointers up to 0x7800000000). Everything outside it is the host program's: graphics buffers,
# decoders and so on, several GiB that the game's data is never in and that would only slow the battle scan down.
GUEST_LO = 0x7000000000
GUEST_HI = 0x7800000000
# Smaller regions are the runtime's bookkeeping, not the game's heap.
MIN_HEAP_REGION = 1 << 20


def _in_guest_window(region: Region) -> bool:
    return GUEST_LO <= region.base and region.base + region.size <= GUEST_HI


class Native:
    """FE3H Recomp: the game's memory is the recompiled program's own, and game address `a` is host address `a`."""

    def module_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if _in_guest_window(r))

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        return (r for r in process.regions() if _in_guest_window(r) and r.size >= MIN_HEAP_REGION)

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        # Switch address 0 is host address 0. The history reader works that out itself from a pointer in the game's
        # data (fe3h.GameMemory._find_arena), and this is its fallback.
        return [0]


RECOMP = Emulator(
    "FE3H Recomp",
    frozenset({"fe3hrecomp.exe"}),
    Native(),
    "it must run game version 1.2.0",
)

RECOMP_EMULATORS = (RECOMP,)
