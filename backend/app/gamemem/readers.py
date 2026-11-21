"""The game readers the tracker can use, by the name the memory_reader setting gives them."""

from __future__ import annotations

from .emulators import EMULATORS, Emulator
from .recomp import RECOMP_EMULATORS
from .ryujinx import RYUJINX_EMULATORS

# Auto: every supported program; the reader uses the first running one that has the game open.
ALL_EMULATORS: tuple[Emulator, ...] = (*EMULATORS, *RYUJINX_EMULATORS, *RECOMP_EMULATORS)
READERS: dict[str, tuple[Emulator, ...]] = {
    "auto": ALL_EMULATORS, "eden": EMULATORS, "recomp": RECOMP_EMULATORS, "ryujinx": RYUJINX_EMULATORS,
}


def emulators_for(reader: str) -> tuple[Emulator, ...]:
    """What to look for in the running programs for a memory_reader setting (all of them for one that isn't
    known)."""
    return READERS.get(reader, ALL_EMULATORS)
