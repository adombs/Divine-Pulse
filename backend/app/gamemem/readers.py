"""The game readers the tracker can use, by the name the memory_reader setting gives them."""

from __future__ import annotations

from .emulators import EMULATORS, Emulator
from .recomp import RECOMP_EMULATORS

READERS: dict[str, tuple[Emulator, ...]] = {"eden": EMULATORS, "recomp": RECOMP_EMULATORS}


def emulators_for(reader: str) -> tuple[Emulator, ...]:
    """What to look for in the running programs for a memory_reader setting (Eden for one that isn't known)."""
    return READERS.get(reader, EMULATORS)
