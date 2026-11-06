"""Battalion level and modifier rules, shared by the memory reader, the run and the combat model.

Sources (docs/battalions.md has the evidence):
- A battalion has levels 1-5. The game keeps its cumulative experience (u16) and derives the level as
  experience / 100 + 1, with experience capped at 400 (FE3H 1.2.0; hashcade/feth-save-editor
  core/SaveBuffer.Battalions.cs). Seen live: 115 shows as level 2, Exp 15.
- Each level's modifiers come from the import (data/battalions.json `stats_by_level`): a fixed growth in tenths per
  level, the accumulated growth rounded down (Serenes Forest's tables, and the game's panel at levels 1 and 2).
- With no endurance left the unit gets none of the modifiers (Fire Emblem Wiki, Battalion). A rattled unit doesn't
  either, but the tracker can't read rattled yet.
- The Status page includes the battalion's Charm in Cha (shown blue, counted in the stats total); Atk, Hit, Crit,
  Avo, Prt and Rsl include the other modifiers.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

MAX_LEVEL = 5
EXP_PER_LEVEL = 100
MAX_EXP = EXP_PER_LEVEL * (MAX_LEVEL - 1)
# Larger than any battalion's endurance (the most is 100 or so): a bigger value means the bytes aren't a battalion.
MAX_ENDURANCE = 999
MAX_GAMBIT_USES = 9
MODIFIER_KEYS = ("phys_atk", "mag_atk", "hit", "crit", "avo", "prt", "rsl", "cha")


def valid_exp(exp: int | None) -> int | None:
    """The experience if it's one the game can hold, else None (unknown)."""
    return exp if exp is not None and 0 <= exp <= MAX_EXP else None


def valid_endurance(endurance: int | None) -> int | None:
    return endurance if endurance is not None and 0 <= endurance <= MAX_ENDURANCE else None


def valid_uses(uses: int | None) -> int | None:
    return uses if uses is not None and 0 <= uses <= MAX_GAMBIT_USES else None


def level(exp: int | None) -> int | None:
    """The battalion level (1-5) for its cumulative experience; None when the experience isn't known."""
    exp = valid_exp(exp)
    return None if exp is None else min(MAX_LEVEL, exp // EXP_PER_LEVEL + 1)


def level_exp(exp: int | None) -> int | None:
    """Experience into the current level, as the game's panel shows it (0 at level 5)."""
    lv = level(exp)
    return None if lv is None or exp is None else (0 if lv == MAX_LEVEL else exp - (lv - 1) * EXP_PER_LEVEL)


def modifiers(
    stats_by_level: Sequence[Mapping[str, int]] | None, exp: int | None, endurance: int | None
) -> dict[str, int] | None:
    """The modifiers the unit gets from its battalion now: the import's values at the battalion's level, nothing when
    its endurance is spent. None when they can't be known (no import progression, or exp/endurance not read)."""
    lv, endurance = level(exp), valid_endurance(endurance)
    if lv is None or endurance is None or not stats_by_level or len(stats_by_level) < lv:
        return None
    if endurance == 0:
        return {}
    row = stats_by_level[lv - 1]
    return {k: int(row[k]) for k in MODIFIER_KEYS if isinstance(row.get(k), int) and row[k]}


__all__ = [
    "EXP_PER_LEVEL",
    "MAX_EXP",
    "MAX_LEVEL",
    "MODIFIER_KEYS",
    "level",
    "level_exp",
    "modifiers",
    "valid_endurance",
    "valid_exp",
    "valid_uses",
]
