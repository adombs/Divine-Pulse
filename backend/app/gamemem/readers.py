"""The game readers the tracker can use, by the name the memory_reader setting gives them."""

from __future__ import annotations

import sys

from .emulators import EMULATORS, Emulator
from .recomp import RECOMP_EMULATORS
from .ryujinx import RYUJINX_EMULATORS

# Auto: every supported program; the reader uses the first running one that has the game open.
ALL_EMULATORS: tuple[Emulator, ...] = (*EMULATORS, *RYUJINX_EMULATORS, *RECOMP_EMULATORS)
READERS: dict[str, tuple[Emulator, ...]] = {
    "auto": ALL_EMULATORS, "eden": EMULATORS, "recomp": RECOMP_EMULATORS, "ryujinx": RYUJINX_EMULATORS,
}

_AUTO: dict[str, tuple[Emulator, ...]] = {}


def runs_here(emulator: Emulator) -> bool:
    """Whether the program can run on this computer: a Windows-only one (only an .exe) can't on macOS or Linux."""
    return sys.platform == "win32" or any(not name.endswith(".exe") for name in emulator.executables)


def emulators_for(reader: str) -> tuple[Emulator, ...]:
    """What to look for in the running programs for a memory_reader setting (all of them for one that isn't
    known). Auto looks only for the programs that run on this computer, so a Mac isn't told to start Eden for
    Windows or FE3H Recomp."""
    if reader in READERS and reader != "auto":
        return READERS[reader]
    if sys.platform not in _AUTO:  # (one tuple per platform, so a reader's emulators can be compared with `is`)
        _AUTO[sys.platform] = tuple(e for e in ALL_EMULATORS if runs_here(e)) or ALL_EMULATORS
    return _AUTO[sys.platform]
