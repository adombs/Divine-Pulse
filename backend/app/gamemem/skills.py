"""Decode a unit's current skill ranks and within-rank EXP from its roster record.

In FE3H 1.2.0 the game mirrors 11 rank bytes at 0x88 and 11 u16 EXP values at 0x32.
The EXP is progress within the current rank, not a cumulative total. The rank's current
EXP limit is the corresponding increment in the imported data/ranks.json table, including
the game table limits for A through S.
"""

from __future__ import annotations

import struct

from ..domain.units import SkillProgress

SKILLS = (
    "sword",
    "lance",
    "axe",
    "bow",
    "brawling",
    "reason",
    "faith",
    "authority",
    "heavy_armor",
    "riding",
    "flying",
)
RANKS = ("E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+")
RANK_EXP_LIMITS = (40, 60, 80, 120, 160, 220, 280, 360, 440, 760, 1080, None)
RANKS_OFFSET = 0x88
EXP_OFFSET = 0x32
SKILL_COUNT = len(SKILLS)
RECORD_SIZE = max(RANKS_OFFSET + SKILL_COUNT, EXP_OFFSET + SKILL_COUNT * 2)


def decode_skill_progress(record: bytes) -> dict[str, SkillProgress]:
    """Return valid skill progress from one roster slot; truncated slots yield no data.

    Rank bytes are game enum values (E through S+). Entries with impossible ranks or
    EXP beyond the known limit for that rank are omitted; S+ has no limit.
    """
    if len(record) < RECORD_SIZE:
        return {}

    result: dict[str, SkillProgress] = {}
    for index, skill in enumerate(SKILLS):
        rank_index = record[RANKS_OFFSET + index]
        if rank_index >= len(RANKS):
            continue

        exp = struct.unpack_from("<H", record, EXP_OFFSET + index * 2)[0]
        exp_limit = RANK_EXP_LIMITS[rank_index]
        if exp_limit is not None and exp >= exp_limit:
            continue

        result[skill] = SkillProgress(rank=RANKS[rank_index], exp=exp)
    return result
