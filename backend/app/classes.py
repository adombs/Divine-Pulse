"""Tidy typed and saved class names."""

from __future__ import annotations

from . import names

MATCH_THRESHOLD = 0.75


def tidy_class(text: str) -> str:
    """Return the closest known class name, or the tidied input."""
    return names.snap(text, names.classes(), MATCH_THRESHOLD)
