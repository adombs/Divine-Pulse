import struct

import pytest

from app.gamemem.skills import EXP_OFFSET, RANKS_OFFSET, SKILLS, decode_skill_progress


def _record(ranks: list[int], exp: list[int]) -> bytes:
    data = bytearray(0x93)
    data[RANKS_OFFSET : RANKS_OFFSET + len(ranks)] = bytes(ranks)
    for index, value in enumerate(exp):
        struct.pack_into("<H", data, EXP_OFFSET + index * 2, value)
    return bytes(data)


def test_decodes_all_eleven_skills_and_within_rank_exp():
    ranks = list(range(11))
    exp = [39, 59, 79, 119, 159, 219, 279, 359, 67, 10, 192]

    decoded = decode_skill_progress(_record(ranks, exp))

    assert list(decoded) == list(SKILLS)
    assert decoded["sword"].rank == "E"
    assert decoded["sword"].exp == 39
    assert decoded["authority"].rank == "B+"
    assert decoded["authority"].exp == 359
    assert decoded["heavy_armor"].rank == "A"
    assert decoded["heavy_armor"].exp == 67
    assert decoded["flying"].rank == "S"
    assert decoded["flying"].exp == 192


@pytest.mark.parametrize("rank,limit", [(0, 40), (1, 60), (2, 80), (3, 120), (4, 160), (5, 220), (6, 280), (7, 360)])
def test_rejects_exp_at_the_next_rank_threshold(rank: int, limit: int):
    decoded = decode_skill_progress(_record([rank] + [0] * 10, [limit] + [0] * 10))

    assert "sword" not in decoded
    assert len(decoded) == 10


def test_omits_invalid_rank_or_exp_but_keeps_other_skills():
    record = _record([12, 7] + [0] * 9, [0, 360] + [0] * 9)

    decoded = decode_skill_progress(record)

    assert "sword" not in decoded
    assert "lance" not in decoded
    assert len(decoded) == 9


@pytest.mark.parametrize("size", [0, EXP_OFFSET + 21, RANKS_OFFSET + 10])
def test_truncated_record_yields_no_skill_data(size: int):
    assert decode_skill_progress(bytes(size)) == {}


def test_does_not_mutate_the_roster_record():
    record = _record(list(range(11)), [0] * 11)
    before = record[:]

    decode_skill_progress(record)

    assert record == before
