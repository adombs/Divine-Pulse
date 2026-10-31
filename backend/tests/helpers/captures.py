"""Optional captures from your own game.

A few regression tests replay recordings read from a real copy of the game (roster memory, battle frames, saved
runs). They are not part of the repository: set DIVINE_PULSE_CAPTURES to a folder holding them and those tests run;
without it they are skipped. Tests mark themselves with `needs_captures`.
"""

import json
import os
from pathlib import Path

ENV = "DIVINE_PULSE_CAPTURES"
REASON = f"needs {ENV}: captures from your own game"


def folder() -> Path | None:
    value = os.environ.get(ENV)
    return Path(value) if value and Path(value).is_dir() else None


def available() -> bool:
    return folder() is not None


def path(*parts: str) -> Path:
    """A file in the captures folder (not checked to exist; use only from tests marked `needs_captures`)."""
    root = folder()
    return (root or Path(ENV)).joinpath(*parts)


def read_bytes(*parts: str) -> bytes:
    return path(*parts).read_bytes() if available() else b""


def read_json(*parts: str, default=None):
    """The JSON capture, or `default` when there are no captures (collection must still work)."""
    return json.loads(path(*parts).read_text("utf-8")) if available() else default
