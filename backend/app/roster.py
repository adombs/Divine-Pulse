"""Resolve slightly misread or misspelt unit names."""

from __future__ import annotations

from . import names

MATCH_THRESHOLD = 0.75


def resolve_name(candidates: list[str], existing: list[str]) -> str:
    """Pick the best match from existing units and imported names."""
    best: names.Match | None = None
    for reading in candidates:
        match = names.best_match(reading, [*existing, *names.characters()], MATCH_THRESHOLD)
        if match and (best is None or match.score > best.score):
            best = match
    return best.value if best else names.clean_text(candidates[0])
