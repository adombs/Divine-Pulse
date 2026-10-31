"""The portraits extractor on synthetic rows, plus a run on a real dump when DIVINE_PULSE_GAME_DUMP is set."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct

import pytest

from app.gamefiles import dump
from app.gamefiles.extract import Context, portraits
from app.gamefiles.output import Output


def person_row(asset: int, cls: int = 0, gender: int = 0, name: int = 0) -> bytes:
    row = bytearray(0x50)
    struct.pack_into("<H", row, 0x12, name)
    struct.pack_into("<H", row, 0x18, asset)
    row[0x1A], row[0x26] = cls, gender
    return bytes(row)


def asset_row(part1: int) -> bytes:
    return struct.pack("<9h", -1, 0, -1, 0, part1, 0, -1, 0, 0)


def portrait_row(*faces: int) -> bytes:
    faces = (*faces, *([-1] * (portraits.EXPRESSIONS - len(faces))))
    return struct.pack("<11hh", *faces, 0)


def test_person_fields():
    assert portraits.person(person_row(7, cls=5, gender=1, name=9)) == {"name": 9, "asset": 7, "class": 5, "gender": 1}


def test_person_faces_uses_name_id_and_skips_missing_face():
    strings = [""] * (portraits.NAME_BASE + 10)
    strings[portraits.NAME_BASE + 9] = "Scholar"
    people = [person_row(0, cls=5, gender=1, name=9), person_row(1)]
    result = portraits.person_faces(people, [asset_row(3), asset_row(-1)],
                                    {3: ["images/portraits/faces/3/0.png", None]}, strings)
    assert result == {"0": {"name": "Scholar", "face": "images/portraits/faces/3/0.png"}}


def test_character_expressions_reuses_face_paths_and_preserves_slots():
    paths = ["images/portraits/faces/3/0.png", None, "images/portraits/faces/3/2.png"]
    assert portraits.character_expressions(3, -1, {3: paths}) == {"part1": paths, "part2": []}


def test_generic_group_runs_stop_at_next_start_reserved_and_empty():
    people = [person_row(0)] * 100 + [person_row(0, cls=2), person_row(1, cls=2, gender=1)]
    assets = [asset_row(2), asset_row(6)]
    rows = [portrait_row(n) for n in range(2)] + [portrait_row(10 + n, 20 + n) for n in range(4)]
    rows += [portrait_row(30), portrait_row(), portrait_row(40)]
    groups = portraits.generic_groups(people, assets, rows, reserved={4})
    assert [(g["start"], g["portraits"]) for g in groups] == [(2, [2, 3]), (6, [6])]
    assert groups[0]["class"] == 2 and groups[1]["gender"] == 1


def test_extract_keeps_character_expressions_and_skips_unreferenced_faces(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from PIL import Image

    source = tmp_path / "person.bin"
    source.write_bytes(b"synthetic")
    assets = [struct.pack("<9h", -1, 0, 1, 0, 0, 0, -1, 0, 0)]
    rows = [portrait_row(0, -1, -1, 1), portrait_row(2, -1, -1, 3), portrait_row(4, 5)]
    sections = {portraits.PEOPLE: [person_row(0)], portraits.ASSETS: assets, portraits.PORTRAITS: rows}

    class FakeFaces:
        dlc = []

        def __len__(self):
            return 6

        def source(self, index):
            return f"synthetic face {index}"

        def image(self, index):
            return Image.new("RGBA", (4, 4), (index, 0, 0, 255))

    monkeypatch.setattr(portraits.tables, "rows", lambda data, section: sections[section])
    monkeypatch.setattr(portraits, "load_faces", lambda ctx: FakeFaces())
    monkeypatch.setattr(portraits, "string_table", lambda ctx: None)
    monkeypatch.setattr(portraits, "APP_PORTRAITS", "byleth_m:0")
    monkeypatch.setattr(portraits, "FOLLOW_UP_LOOKS", {})
    monkeypatch.setattr(portraits, "NAMED_IDS", (0,))
    out = Output(tmp_path / "out")
    ctx = SimpleNamespace(base=SimpleNamespace(resolve=lambda rel: source), out=out, log=lambda message: None)
    portraits.extract(ctx)
    data = json.loads((out.root / "data/portraits.json").read_text(encoding="utf-8"))
    expressions = data["characters"]["0"]["expressions"]
    assert expressions["part1"][3] == "images/portraits/faces/0/3.png"
    assert expressions["part2"][3] == "images/portraits/faces/1/3.png"
    assert expressions["part1"][1] is None
    assert data["persons"]["0"]["face"] == "images/portraits/faces/0/0.png"
    assert data["app_keys"]["byleth_m"] == "images/portraits/characters/0.png"
    assert not any(path.startswith("images/portraits/faces/2/") for path in out.files)


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="needs a game dump")
def test_real_dump(tmp_path: Path):
    ctx = Context(dump=dump.find(Path(os.environ["DIVINE_PULSE_GAME_DUMP"])), out=Output(tmp_path), log=lambda _: None)
    portraits.extract(ctx)
    data = json.loads((tmp_path / "data/portraits.json").read_text(encoding="utf-8"))
    assert len(data["app_keys"]) == 324
    assert len(data["characters"]) >= 75
