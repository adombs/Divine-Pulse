"""Tidy typed and saved class names."""

from __future__ import annotations

from functools import lru_cache

from . import names
from .infrastructure import game_tables

MATCH_THRESHOLD = 0.75


def tidy_class(text: str) -> str:
    """Return the closest known class name, or the tidied input."""
    return _tidy(text, game_tables.generation())


@lru_cache(maxsize=1024)
def _tidy(text: str, _generation: tuple) -> str:
    # Matching against every class is slow and a name's answer only changes with the import or language, which the
    # generation names, so it's worked out once (a read of the game tidies a class name per unit).
    return names.snap(text, names.classes(), MATCH_THRESHOLD)
