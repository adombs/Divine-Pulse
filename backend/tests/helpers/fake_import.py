"""Create a small imported data set for table tests."""

import json
from pathlib import Path

from app.gamefiles.dump import SUPPORTED_BUILDS, GameDump


def fake_dump(root: Path) -> GameDump:
    """A folder that passes as a complete 1.2.0 dump, holding no game data."""
    (root / "nx").mkdir(parents=True, exist_ok=True)
    (root / "patch4").mkdir(exist_ok=True)
    (root / "DATA0.bin").write_bytes(b"0")
    (root / "DATA1.bin").write_bytes(b"0")
    (root / "main").write_bytes(b"NSO0" + b"\0" * 60 + bytes.fromhex(next(iter(SUPPORTED_BUILDS))))
    return GameDump(root, root, updates=[root])


def write_fake_import(root: Path) -> None:
    files = {
        "data/items.json": {"items": [{"id": 1000, "name": "Amber"}]},
        "data/classes.json": {"classes": [{
            "id": 0, "name": "Scout", "boosts": {}, "mounted": {},
            "mastery_ability": None, "mastery_art": None, "abilities": [], "types": {},
        }]},
        "data/characters.json": {"characters": [{
            "id": 0, "name_id": 0, "name": "Byleth", "full_name": "Byleth Vale",
            "gender": 0, "student": {},
        }, {
            "id": 2, "name_id": 2, "name": "Aster", "full_name": "Aster Vale",
            "gender": 1, "student": {},
        }, {
            "id": 3, "name_id": 3, "name": "Bram", "full_name": "Bram Vale",
            "gender": 0, "student": {},
        }]},
        "data/supports.json": {"pairs": [
            {"a": 2, "b": 3, "ranks": ["C", "B+"]},
            {"a": 0, "b": 3, "ranks": ["C", "S"]},
        ]},
        "data/maps.json": {"maps": {"0": ["0001"]}},
        "text/ENG_U.json": {"categories": {
            "character_given": {"0": "Byleth", "2": "Aster", "3": "Bram"},
            "class": {"0": "Scout"}, "item": {"1000": "Amber"},
            "scenario_title": {"0": "First Trial"},
        }},
        "text/GER.json": {"categories": {
            "character_given": {"0": "Byleth", "2": "Aster", "3": "Bram"},
            "class": {"0": "Späher"}, "item": {"1000": "Bernstein"},
            "scenario_title": {"0": "Erste Prüfung"},
        }},
    }
    for filename, key in (("weapons", "weapons"), ("spells", "spells"), ("combat-arts", "combat_arts"),
                          ("abilities", "abilities"), ("equipment", "equipment"), ("battalions", "battalions")):
        files[f"data/{filename}.json"] = {key: []}
    for language in ("ENG_U", "GER"):
        categories = files[f"text/{language}.json"]["categories"]
        for category in ("weapon", "spell", "combat_art", "ability", "equipment", "battalion", "gambit",
                         "character_full", "npc_and_generic_names", "terrain"):
            categories[category] = {}
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({"files": dict.fromkeys(files, {})}), encoding="utf-8")
