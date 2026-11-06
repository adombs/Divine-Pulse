"""The exe_tables family on synthetic tables (no game data in the repo), plus a real-dump check when one is given."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.gamefiles import dump
from app.gamefiles.extract import Context, exe_tables
from app.gamefiles.output import Output


def row(skill: int, crest: int = 0x56, flags: int = 0, category: int = 0, kind: int = 0, big: int = 0) -> bytes:
    data = bytearray(24)
    data[4], data[5], data[9], data[0x0D], data[0x0F], data[0x16] = kind, skill, crest, category, big, flags
    return bytes(data)


def test_item_sprite_selector():
    assert exe_tables.item_sprite_id(row(0)) == 0x1FC  # plain sword
    assert exe_tables.item_sprite_id(row(1, crest=0x10)) == 0x20D + 1  # crest weapon
    assert exe_tables.item_sprite_id(row(2, crest=0x2C)) == 0x205 + 2
    assert exe_tables.item_sprite_id(row(3, flags=0x80)) == 0x215 + 3
    assert exe_tables.item_sprite_id(row(0), "Broken Iron Sword") == 0x21D
    assert exe_tables.item_sprite_id(row(5)) == 0x202
    assert exe_tables.item_sprite_id(row(4, big=0x80)) == 0x204
    assert exe_tables.item_sprite_id(row(8, category=1)) == 0x1D5
    assert exe_tables.item_sprite_id(row(8, category=9)) == 0x1D4
    assert exe_tables.item_sprite_id(row(9, crest=3, kind=0x17)) == 0x7A + 3  # Dragon Sign
    assert exe_tables.item_sprite_id(row(9, category=2)) == 0x1D6
    assert exe_tables.item_sprite_id(row(10)) == 0x1D7
    assert exe_tables.item_sprite_id(row(99)) is None


def test_battalion_sprite_selector_uses_rank_and_movement_flags():
    data = bytearray(44)
    assert exe_tables.battalion_sprite_id(data) == 0x22B
    data[0x26], data[0x28] = 2, 4
    assert exe_tables.battalion_sprite_id(data) == 0x235
    data[0x26], data[0x28] = 4, 8
    assert exe_tables.battalion_sprite_id(data) == 0x23A
    data[0x28] = 2 | 4 | 8
    assert exe_tables.battalion_sprite_id(data) == 0x23A


def test_extract_without_exefs_skips(tmp_path):
    ctx = Context(dump=dump.GameDump(romfs=tmp_path), out=Output(tmp_path / "out"), log=lambda _: None)
    ctx.__dict__["main"] = None
    exe_tables.extract(ctx)
    assert ctx.skipped and not ctx.out.files


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="needs DIVINE_PULSE_GAME_DUMP")
def test_real_dump_counts(tmp_path):
    ctx = Context(dump=dump.find(Path(os.environ["DIVINE_PULSE_GAME_DUMP"])), out=Output(tmp_path), log=lambda _: None)
    exe_tables.extract(ctx)
    assert len(list((tmp_path / "images/icons/crests").glob("*.png"))) == 22
    assert len(list((tmp_path / "images/icons/abilities").glob("*.png"))) >= 250
    assert list((tmp_path / "images/icons/items-native").glob("*.png"))
