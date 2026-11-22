"""Linux processes (see memory.py): listed from /proc. Reading their memory isn't supported yet."""

from __future__ import annotations

import os
from pathlib import Path

from .platform.base import NotSupported

PROC = Path("/proc")


def _all_processes(proc: Path = PROC) -> list[tuple[int, str]]:
    """(pid, executable path) of every process whose executable this user can see."""
    found = []
    try:
        entries = list(proc.iterdir())
    except OSError:
        return []
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            found.append((int(entry.name), os.readlink(entry / "exe")))
        except OSError:
            continue
    return found


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running processes whose executable name (lower case) is in `exe_names`."""
    return [(pid, name) for pid, path in _all_processes() if (name := Path(path).name.lower()) in exe_names]


def process_paths(exe_names: set[str]) -> list[str]:
    """The full executable paths of running processes whose executable name (lower case) is in `exe_names`."""
    return [path for _pid, path in _all_processes() if Path(path).name.lower() in exe_names]


class Process:
    def __init__(self, pid: int):
        raise NotSupported("Reading the emulator's memory isn't supported on Linux yet.")
