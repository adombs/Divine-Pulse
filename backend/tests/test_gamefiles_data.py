"""The data family on synthetic rows (no game data in the repo), plus a run on a real dump when one is given."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct

import pytest

from app.gamefiles.extract import data


def section_file(*sections: tuple[int, list[bytes]]) -> bytes:
    """A fixed_*.bin with the given (stride, rows) table sections."""
    head = 4 + 8 * len(sections)
    blobs = []
    for stride, rows in sections:
        blobs.append(b"\x00\x19\x12\x16" + struct.pack("<II", len(rows), stride) + b"\0" * 0x34 + b"".join(rows))
    out = struct.pack("<I", len(sections))
    at = head
    for blob in blobs:
        out += struct.pack("<II", at, len(blob))
        at += len(blob)
    return out + b"".join(blobs)


def text_with(**at: str) -> data.Text:
    strings = [""] * 11000
    for key, value in at.items():
        strings[int(key.removeprefix("i"))] = value
    return data.Text(strings)


def test_text_cleans_and_bounds():
    text = data.Text(["Sword\u200b ", "x"])
    assert text(0) == "Sword"
    assert text(5) == "" and text(-1) == ""


def test_load_reads_plain_and_rejects_garbage(tmp_path):
    raw = section_file((2, [b"\x01\x00", b"\x02\x00"]))
    assert data._is_sections(raw)
    assert not data._is_sections(b"\x00" * 40)
    assert [r[0] for r in data.section(raw, 0)] == [1, 2]


def test_person_fields():
    row = bytearray(80)
    struct.pack_into("<H", row, 0x12, 3)
    row[0x1A], row[0x1B], row[0x1C], row[0x1E] = 4, 17, 6, 22
    row[0x24], row[0x26], row[0x2C], row[0x2D], row[0x2F], row[0x30] = 1, 1, 21, 86, 158, 160
    row[0x2B], row[0x29], row[0x22], row[0x33], row[0x3B] = 40, 50, 99, 9, 7
    record = data.person(bytes(row), text_with(i1160="Edie", i3457="Noble"))
    assert record["name"] == "Edie" and record["class"] == "Noble"
    assert record["birthday"] == {"month": 6, "day": 22}
    assert record["crests"] == [21]
    assert record["bases"]["str"] == 9 and record["bases"]["cha"] == 7
    assert record["hp"] == {"base": 40, "growth": 50, "cap": 99}
    assert record["height"] == {"part1": 158, "part2": 160}


def test_student_sections():
    ranks = bytearray(34)
    ranks[9], ranks[10], ranks[20], ranks[21] = 4, 0xFF, 3, 1
    spells = bytes([2, 0, 0, 0, 0, 1, 0xFF, 0xFF, 0xFF, 0xFF, 24, 0xFF, 0xFF, 0xFF, 0xFF, 2, 0, 0, 0, 0])
    learned = bytearray([0xFF] * 62)
    learned[0], learned[20], learned[22], learned[42] = 7, 83, 12, 5
    arts = bytearray([0xFF] * 30)
    arts[0], arts[10], arts[20] = 5, 2, 8
    rows = {
        "ranks": [bytes(ranks)],
        "spells": [spells],
        "abilities": [bytes(learned)],
        "arts": [bytes(arts)],
    }
    result = data.student(rows, 0)
    assert result["skills"]["sword"] == {"start_rank": "C", "proficiency": "strong"}
    assert result["skills"]["lance"]["start_rank"] is None
    assert result["abilities"] == [{"id": 12, "rank": "C+", "skill": "authority"}]
    assert result["personal_ability"] == 83 and result["personal_ability_upgraded"] is None
    assert result["combat_arts"] == [{"id": 5, "rank": "A", "skill": "axe"}]
    assert result["spells"]["reason"] == [{"id": 1, "rank": "D"}]
    assert result["spells"]["faith"] == [{"id": 24, "rank": "D"}]


def test_classes_flags_and_mov():
    row = bytearray(118)
    row[0x45], row[0x51] = 2, 0x06
    row[0x2E], row[0x37] = 1, 0xFF  # boost mov +1, mounted mov -1
    row[0x4B], row[0x55] = 30, 11
    tables = {
        "classes": [bytes(row)],
        "certification": [bytes([0, 3, 1, 2, 4] + [0] * 10)],
        "tiers": [bytes([n]) for n in (0, 5, 10, 20, 30, 20, 0)],
        "abilities": [bytes([64, 0xFF, 50, 0xFF, 0xFF])],
    }
    [record] = data.classes(tables, text_with(i3453="Lord"))
    assert record["types"] == {"infantry": False, "armored": True, "cavalry": True, "flying": False}
    assert record["base_mv"] == 4 and record["level"] == 10
    assert record["bases"]["hp"] == 30 and record["bases"]["str"] == 11
    assert record["certification"]["seal_item"] == 1003 and record["certification"]["gender"] == "any"
    assert record["certification"]["requirements"] == {"sword": 4}
    assert record["certification"]["selectable"] and not record["certification"]["any_of"]
    assert record["mastery_ability"] == 64 and record["mastery_art"] is None and record["abilities"] == [50]


def test_items_stop_at_unused_slots():
    rows = [bytes(24), bytes(24), bytes(24)]
    names = text_with(i4656="Vulnerary", i4657="0")
    assert [i["id"] for i in data.items(rows, names)] == [1000]


def test_equipment_description_and_stat():
    row = bytearray(24)
    row[2], row[20] = 2, 7
    [record] = data.equipment([bytes(row)], text_with(i4556="Ring", i4606="Increases speed"))
    assert record["description"] == "Increases speed" and record["effects"] == {"prot": 0, "weight": 0, "spd": 2}


def test_equipment_shield_and_effect_slots():
    shield = bytearray(24)
    shield[2], shield[3], shield[0x10], shield[0x13], shield[20], shield[21] = 2, 10, 1, 4, 19, 29
    [record] = data.equipment([bytes(shield)], text_with(i4556="Shield"))
    assert record["effects"] == {"prot": 1, "weight": 4, "res": 2, "hp_restore_pct": 10}


@pytest.mark.parametrize(("code", "field"), [(14, "hit"), (15, "crit"), (16, "avoid")])
def test_equipment_combat_effects(code, field):
    row = bytearray(24)
    row[3], row[21] = 0xFE, code
    [record] = data.equipment([bytes(row)], text_with(i4556="Ring"))
    assert record["effects"][field] == -2


def test_item_amount_and_uses():
    row = bytearray(24)
    row[0x0B], row[0x10] = 3, 10
    [record] = data.items([bytes(row)], text_with(i4656="Vulnerary", i4856="Use to recover 10 HP."))
    assert record["uses"] == 3 and record["amount"] == 10


def test_battalion_fields():
    row = bytearray(44)
    struct.pack_into("<H", row, 6, 60)
    [record] = data.battalions([bytes(row)], text_with(i9096="Company", i9297="Description"))
    assert record["id"] == 0 and record["endurance"] == 60
    assert record["name"] == "Company" and record["description"] == "Description"
    assert set(record["stats"].values()) == {0}


def test_extract_battalion_reference_with_gambit(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from PIL import Image
    from app.gamefiles import rects
    from app.gamefiles.extract import exe_tables
    from app.gamefiles.output import Output

    company, attack, target = bytearray(44), bytearray(24), bytearray(13)
    company[6:8] = (55).to_bytes(2, "little")
    for offset, value in {8: 3, 10: 254, 11: 15, 12: 5, 13: 251, 15: 2, 16: 1, 36: 4}.items():
        company[offset] = value
    company[19], company[20] = 5, 13
    company[39] = 1
    attack[7], attack[10], attack[16], attack[17], target[7] = 3, 2, 6, 70, 2
    attack[0x16], target[10] = 1, 7  # magic; a row of three
    sections = [(1, []) for _ in range(12)]
    sections[3] = (24, [bytes(24), bytes(attack)])
    sections[8] = (13, [bytes(13), bytes(target)])
    sections[11] = (44, [bytes(company)])
    fixed = section_file(*sections)
    monkeypatch.setattr(data, "load", lambda ctx, name: fixed if name == "fixed_data.bin" else None)
    strings = [""] * 11000
    strings[9096], strings[9297], strings[6615], strings[6915] = "Test company", "Test description", "Test move", "Test effect"
    out = Output(tmp_path)
    ctx = SimpleNamespace(text=lambda: [[], [], strings], out=out, skip=lambda _: None,
                          main=object(), table=lambda name, section: {3: [bytes(24), bytes(attack)],
                                                                      11: [bytes(company)]}[section])
    rectangle = rects.Rect(4, 4, 2, 0, 0, 0, 4, 4)
    monkeypatch.setattr(exe_tables.rects, "icons", lambda _: [rectangle] * 725)
    monkeypatch.setattr(exe_tables, "_atlas", lambda _: lambda n: Image.new("RGBA", (4, 4), (10, 20, 30, 255)))
    monkeypatch.setattr(exe_tables, "_abilities", lambda *args: None)
    monkeypatch.setattr(exe_tables, "_crests", lambda *args: None)
    monkeypatch.setattr(exe_tables, "_items", lambda *args: {})
    exe_tables.extract(ctx)
    data.extract(ctx)
    [record] = json.loads((tmp_path / "data/battalions.json").read_text())["battalions"]
    assert record["stats"] == {"phys_atk": -2, "mag_atk": 3, "hit": 15, "crit": 5,
                               "avo": -5, "prt": 2, "rsl": 1, "cha": 4}
    assert [level["phys_atk"] for level in record["stats_by_level"]] == [-2, -2, -1, -1, 0]
    assert [level["hit"] for level in record["stats_by_level"]] == [15, 16, 17, 18, 20]
    assert record["icon"] == "images/icons/battalions/0.png"
    assert (tmp_path / record["icon"]).is_file()
    assert record["gambit"] == {"id": 1, "name": "Test move", "description": "Test effect", "uses": 2,
                                "might": 6, "hit": 70, "range": [2, 3], "icon": "images/icons/gambits/1.png",
                                "area": {"cells": [[-1, -1], [0, -1], [1, -1]], "direction": "forward"}}
    assert (tmp_path / "images/icons/gambits/1.png").is_file()
    assert not (tmp_path / "images/icons/gambits/0.png").exists()  # an empty gambit row has no icon


def test_gambit_area_facing_shapes():
    assert data.gambit_area(3, 0, 1) == {"cells": [[0, -1], [0, -2]], "direction": "forward"}
    assert data.gambit_area(6, 0, 1)["cells"] == [[0, -1], [0, -2], [0, -3], [0, -4]]
    assert data.gambit_area(12, 17, 1)["cells"] == [[-1, -1], [0, -1], [1, -1], [-1, -2], [0, -2], [1, -2]]
    triangle = data.gambit_area(2, 0, 1)["cells"]
    assert sorted(triangle) == sorted([[x, -1] for x in range(-2, 3)] + [[x, -2] for x in range(-1, 2)] + [[0, -3]])


def test_gambit_area_radius_shapes_centre_on_target_or_user():
    plus = data.gambit_area(1, 0, 2)
    assert plus["target"] == [0, -2]
    assert sorted(plus["cells"]) == [[-1, -2], [0, -3], [0, -2], [0, -1], [1, -2]]
    around_user = data.gambit_area(5, 14, 1)
    assert "target" not in around_user and "direction" not in around_user
    assert len(around_user["cells"]) == 12 and [0, 0] not in around_user["cells"]
    assert len(data.gambit_area(5, 0, 1)["cells"]) == 13


def test_gambit_area_unmapped_shapes():
    assert data.gambit_area(0, 0, 1) is None
    assert data.gambit_area(9, 0, 1) is None


def test_gambit_support_effects_match_the_icon_selector():
    from app.gamefiles.extract import exe_tables

    for effect in range(256):
        row = bytearray(24)
        row[4] = effect
        assert (exe_tables.gambit_sprite_id(bytes(row)) == 0x23D) == (effect in data.SUPPORT_GAMBIT_EFFECTS)


def test_meals_recipes_and_transposed_preferences():
    recipe = bytearray(18)
    struct.pack_into("<3H", recipe, 0, 96, 138, 164)
    recipe[14:17] = bytes([3, 1, 0])
    prefs = bytearray(45)
    prefs[2], prefs[3], prefs[38], prefs[43], prefs[44] = 1, 255, 1, 255, 1
    recipes = [bytes(recipe)] * 33  # slot 32 is an unused menu entry, even when nonzero
    preferences = [bytes(prefs)] + [bytes(45)] * 31 + [bytes([1] * 45)]
    result = data.meals(recipes, preferences, text_with(i9852="First dish", i5152="River fish", i5194="Orchard fruit"))
    assert len(result["meals"]) == 32
    assert result["meals"][0] == {"id": 0, "name": "First dish", "ingredients": [
        {"id": 96, "name": "River fish", "quantity": 3},
        {"id": 138, "name": "Orchard fruit", "quantity": 1},
    ]}
    people = {p["character"]: p for p in result["characters"]}
    assert len(people) == 39
    assert people[2]["liked"] == [0] and people[2]["disliked"] == []
    assert people[3]["liked"] == [] and people[3]["disliked"] == [0]
    assert people[1040]["liked"] == [0] and people[1045]["disliked"] == [0]
    assert people[1046]["liked"] == [0]
    assert people[4]["liked"] == [] and people[4]["disliked"] == []
    assert not ({0, 1, 35, 36, 37, 1044} & people.keys())


def test_extract_writes_meals_from_activity_file(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from app.gamefiles.output import Output

    row = bytearray(18)
    struct.pack_into("<H", row, 0, 96)
    row[14] = 2
    preferences = bytearray(45)
    preferences[2] = 1
    raw = section_file((1, []), (18, [bytes(row)]), (45, [bytes(preferences)]))
    monkeypatch.setattr(data, "load", lambda ctx, name: raw if name == "fixed_lobby_activity.bin" else None)
    strings = [""] * 11000
    strings[9852], strings[5152] = "Test dish", "River fish"
    out = Output(tmp_path)
    ctx = SimpleNamespace(text=lambda: [[], [], strings], out=out, skip=lambda _: None)
    data.extract(ctx)
    result = json.loads((tmp_path / "data/meals.json").read_text())
    assert result["meals"][0]["ingredients"] == [{"id": 96, "name": "River fish", "quantity": 2}]
    assert result["characters"][0]["liked"] == [0]
    assert out.files["data/meals.json"]["source"] == "fixed_lobby_activity.bin sections 1-2"


def test_beginner_certification_any_of():
    row = bytearray(118)
    row[0x45] = 1
    cert = bytes([40, 158, 1, 2, 2, 2] + [0] * 9)
    result = data.classes({"classes": [bytes(row)], "certification": [cert], "tiers": [b"\0", b"\x05"],
                           "abilities": [bytes([255] * 5)]}, text_with(i3554="Noble description"))[0]
    assert result["certification"]["any_of"] and result["description"] == "Noble description"


def test_ranks_supports_gifts_and_crests():
    assert data.ranks([struct.pack("<H", v) for v in (40, 60, 0)])[0] == {"rank": "E", "exp": 40}
    pair = bytearray(12)
    struct.pack_into("<HH", pair, 2, 2, 3)
    pair[9] = 0x40 | 0x10 | 0x01
    empty = b"\xff" * 12
    [found] = data.supports([bytes(pair), empty], {2: "Edelgard", 3: "Dimitri"})
    assert found["ranks"] == ["C", "B", "S"] and found["a_name"] == "Edelgard"
    row = bytes([208, 38, 0xFF, 0xFF, 24, 0xFF, 0xFF, 5, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    names = text_with(i10350="Carnation", i10180="White Glove", i10166="Statue", i10147="Book")
    result = data.gifts([bytes(17), bytes(17), row], names)
    assert result["characters"][0]["liked"] == [{"id": 208, "name": "Carnation"}, {"id": 5, "name": "Book"}]
    assert result["characters"][0]["lost_items"] == [{"id": 38, "name": "White Glove"}]
    crests = data.crests_by_person([bytes([0] * 0x2C + [21, 86] + [0] * 34)], text_with())
    assert crests["characters"] == [{"id": 0, "crests": [21]}]


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="needs DIVINE_PULSE_GAME_DUMP")
def test_real_dump_counts(tmp_path):
    from app.gamefiles import dump
    from app.gamefiles.extract import Context
    from app.gamefiles.output import Output

    ctx = Context(dump.find(Path(os.environ["DIVINE_PULSE_GAME_DUMP"])), Output(tmp_path), log=lambda _: None)
    data.extract(ctx)
    read = lambda name: json.loads((tmp_path / "data" / f"{name}.json").read_text(encoding="utf-8"))  # noqa: E731
    assert len(read("characters")["characters"]) == 1201
    assert len(read("classes")["classes"]) == 100
    assert len(read("weapons")["weapons"]) == 223
    assert len(read("spells")["spells"]) == 38
    assert len(read("combat-arts")["combat_arts"]) == 80
    assert len(read("abilities")["abilities"]) == 250
    assert len(read("battalions")["battalions"]) == 200
    assert len(read("supports")["pairs"]) == 267
    dining = read("meals")
    assert len(dining["meals"]) == 32 and len(dining["characters"]) == 39
    assert all(1 <= len(m["ingredients"]) <= 3 for m in dining["meals"])
    assert all(ingredient["name"] and ingredient["quantity"] > 0 for m in dining["meals"] for ingredient in m["ingredients"])


def test_equipment_special_effects():
    seiros = bytearray(24)
    seiros[2], seiros[3], seiros[0x10], seiros[0x13], seiros[20], seiros[21] = 10, 50, 5, 3, 91, 35
    rafail = bytearray(24)
    rafail[2], rafail[3], rafail[20], rafail[21] = 15, 1, 34, 36
    staff = bytearray(24)
    staff[2], staff[3], staff[20], staff[21] = 1, 10, 27, 29
    names = text_with(i4556="Seiros Shield", i4557="Rafail Gem", i4558="Caduceus Staff", i4559="Item 3")
    records = data.equipment([bytes(seiros), bytes(rafail), bytes(staff), bytes(24)], names)
    assert [r["name"] for r in records] == ["Seiros Shield", "Rafail Gem", "Caduceus Staff"]  # placeholder skipped
    assert records[0]["effects"] == {"prot": 5, "weight": 3, "hp_restore_pct": 10, "monster_damage_pct": 50}
    assert records[1]["effects"]["nullify_weakness"] == ["infantry", "armored", "cavalry", "flying"]
    assert records[1]["effects"]["negate_crit"] is True
    assert records[2]["effects"] == {"prot": 0, "weight": 0, "range": 1, "hp_restore_pct": 10}


def test_items_skip_spare_slots():
    rows = [bytes(24), bytes(24)]
    records = data.items(rows, text_with(i4656="Vulnerary", i4657="Spare slot 15"))
    assert [r["name"] for r in records] == ["Vulnerary"]
