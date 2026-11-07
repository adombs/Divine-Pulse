"""The text family's index rules on synthetic strings (no game data in the repo), plus one run on a real dump when
DIVINE_PULSE_GAME_DUMP points at one."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct

import pytest

from app.gamefiles import msgdata
from app.gamefiles.extract import text
from app.gamefiles.extract.text import Category


def _table(entries: dict[int, str]) -> list[str]:
    table = [""] * 15397
    for index, value in entries.items():
        table[index] = value
    return table


def test_person_name_ids_read_u16_at_0x12():
    rows = [bytearray(0x50) for _ in range(3)]
    for n, row in enumerate(rows):
        struct.pack_into("<H", row, 0x12, 100 + n)
    assert text._person_name_ids([bytes(row) for row in rows]) == [100, 101, 102]


def test_clean_drops_empty_tbd_and_control_codes():
    assert text._clean(["x", "TBD", "a\x1bC1b\x1bR​ "], 1) == ""
    assert text._clean(["x", "TBD", "a\x1bC1b\x1bR​ "], 2) == "ab"
    assert text._clean(["x"], 5) == ""


def test_person_rows_pick_the_name_and_dlc_uses_its_row():
    # Person 0 is Byleth (name id 0 gives F[1157]); DLC person 1040 has its own name id, 7, so its name is F[1164].
    name_ids = list(range(1201))
    name_ids[1040] = 7
    table = _table({1157: "Byleth", 1158: "Edelgard", 1164: "Yuri", 1157 + 999: "Soldier"})
    names = text._language([[], [], table], name_ids)
    assert names["character_given"]["0"] == "Byleth"
    assert names["character_given"]["1040"] == "Yuri"
    assert "1040" not in names["npc_and_generic_names"]
    assert names["npc_and_generic_names"]["999"] == "Soldier"


def test_full_name_joins_given_middle_and_surname():
    table = _table({1158: "Edelgard", 1732: "Mid", 2306: "von Hresvelg"})
    names = text._language([[], [], table], list(range(1201)))
    assert names["character_full"]["1"] == "Edelgard Mid von Hresvelg"
    assert "0" not in names["character_full"]


def test_fixed_index_categories_use_base_plus_id():
    table = _table({9590 + 2: "Crest of Seiros", 9612 + 2: "Minor Crest of Seiros", 3453: "Noble", 3554: "Leaders"})
    names = text._language([[], [], table], list(range(1201)))
    assert names["crest_major"] == {"2": "Crest of Seiros"}
    assert names["crest_minor"] == {"2": "Minor Crest of Seiros"}
    assert names["class"] == {"0": "Noble"}
    assert names["class_description"] == {"0": "Leaders"}


def test_categories_have_unique_names():
    keys = [c.name for c in text.CATEGORIES]
    assert len(keys) == len(set(keys))
    assert all(isinstance(c, Category) for c in text.CATEGORIES)


def test_meal_names_use_indexed_strings_and_exclude_unused_slots():
    table = _table({9852: "First meal", 9883: "Last meal", 9884: "Unused dish"})
    names = text._language([[], [], table], list(range(1201)))
    assert names["meal"] == {"0": "First meal", "31": "Last meal"}


def test_ingredient_names_use_material_ids():
    table = _table({5151: "Outside", 5152: "River fish", 5194: "Orchard fruit", 5220: "Wild meat", 5221: "Outside"})
    names = text._language([[], [], table], list(range(1201)))
    assert names["ingredient"] == {"96": "River fish", "138": "Orchard fruit", "164": "Wild meat"}


def test_items_match_their_documented_ranges():
    item = next(c for c in text.CATEGORIES if c.name == "item")
    assert item.base == 3656 and item.ids[0] == 1000
    equipment_description = next(c for c in text.CATEGORIES if c.name == "equipment_description")
    assert equipment_description.base == 4606 and len(equipment_description.ids) == 50


def test_equipment_description_is_extracted():
    table = _table({4612: "Relic effect"})
    names = text._language([[], [], table], list(range(1201)))
    assert names["equipment_description"]["6"] == "Relic effect"


def test_gambit_text_is_indexed_by_gambit_id():
    names = text._language([[], [], _table({6616: "Test tactic", 6916: "Test effect"})], list(range(1201)))
    assert names["gambit"]["2"] == "Test tactic"
    assert names["gambit_description"]["2"] == "Test effect"


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="needs DIVINE_PULSE_GAME_DUMP (a 1.2.0 dump)")
def test_text_family_on_a_real_dump(tmp_path: Path):
    from app.gamefiles import dump as dumps
    from app.gamefiles.extract import Context
    from app.gamefiles.output import Output

    found = dumps.find(Path(os.environ["DIVINE_PULSE_GAME_DUMP"]))
    out = Output(tmp_path)
    text.extract(Context(found, out, log=lambda _: None))

    assert len([f for f in out.files if f.startswith("text/")]) == len(msgdata.LANGUAGES)
    english = json.loads((tmp_path / "text" / "ENG_U.json").read_text(encoding="utf-8"))["categories"]
    assert english["character_given"]["0"] == "Byleth"
    assert len(english["class"]) == 92
    assert len(english["ability"]) == 248
    assert len(english["gift"]) == 239
    assert set(english["meal"]) == {str(i) for i in range(32)}
