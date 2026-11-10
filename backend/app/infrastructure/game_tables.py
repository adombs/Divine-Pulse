"""Translate imported game tables to the memory-reader format."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from .game_assets import GameAssetError, game_assets

DATA = Path(__file__).resolve().parents[1] / "data"


_pin = threading.local()


def generation() -> tuple:
    """What the loaded tables are made from (import, language, files). Every table lookup asks for it."""
    pinned = getattr(_pin, "generation", None)
    return pinned if pinned is not None else _generation()


def _generation() -> tuple:
    assets = game_assets()
    manifest = assets.manifest
    return (str(assets.root), assets._stamp, id(manifest), assets.language(), assets.data_stamp())


@contextmanager
def pinned() -> Iterator[None]:
    """Look the generation up once for everything this thread does inside the block. A read of the game makes
    hundreds of table lookups, and each one would check the import's manifest on disk again; an import that finishes
    meanwhile is picked up by the next block. Blocks nest (the outer one counts)."""
    if getattr(_pin, "generation", None) is not None:
        yield
        return
    _pin.generation = _generation()
    try:
        yield
    finally:
        _pin.generation = None


def _rows(assets, filename: str, key: str, fields: tuple = ()) -> list[dict]:
    rel = f"data/{filename}.json"
    source = assets.json(rel)
    if source is None:
        return []
    rows = source.get(key)
    if not isinstance(rows, list) or any(
        not isinstance(row, dict) or type(row.get("id")) is not int or row["id"] < 0
        or any(field not in row for field in fields)
        or ("name" in row and not isinstance(row["name"], str)) for row in rows
    ):
        raise GameAssetError(rel, f"invalid {key} rows")
    return rows


def _names_by_id(rows: list[dict], text: dict) -> dict[str, str]:
    return {str(row["id"]): text.get(str(row["id"])) or row.get("name", "") for row in rows}


def _name_list(rows: list[dict], text: dict) -> list:
    values = _names_by_id(rows, text)
    result = [None] * (max((int(key) for key in values), default=-1) + 1)
    for key, value in values.items():
        result[int(key)] = value
    return result


def _battalion_stats(rows: list[dict]) -> list:
    """Each battalion's modifiers at levels 1-5 by battalion ID (None where an older import has no progression)."""
    result: list = [None] * (max((row["id"] for row in rows if isinstance(row.get("id"), int)), default=-1) + 1)
    for row in rows:
        levels = row.get("stats_by_level")
        if isinstance(row.get("id"), int) and isinstance(levels, list) and len(levels) == 5 and all(
            isinstance(level, dict) for level in levels
        ):
            result[row["id"]] = [{k: v for k, v in level.items() if isinstance(v, int)} for level in levels]
    return result


def _ability_name(student: dict, key: str, values: list) -> str | None:
    index = student.get(key)
    return values[index] if isinstance(index, int) and 0 <= index < len(values) else None


@lru_cache(maxsize=2)
def _memory(_generation: tuple) -> dict:
    assets = game_assets()
    data = {}
    fields = {
        "weapons": ("name", "skill", "max_range", "min_range",
                    "uses", "might", "hit", "crit", "weight", "flags", "raw"),
        "spells": ("name", "skill", "max_range", "min_range",
                   "uses", "might", "hit", "crit", "weight", "flags", "raw"),
        "combat_arts": ("name",),
        "ability_effects": ("name", "raw"),
    }
    for filename, key, target, category in (
        ("weapons", "weapons", "weapons", "weapon"),
        ("spells", "spells", "spells", "spell"),
        ("combat-arts", "combat_arts", "combat_arts", "combat_art"),
        ("abilities", "abilities", "ability_effects", "ability"),
    ):
        rows = _rows(assets, filename, key, fields[target])
        text = assets.text(category)
        result = {}
        for row in rows:
            ident = str(row["id"])
            item = {field: row[field] for field in fields[target]}
            if ("raw" in item and not isinstance(item["raw"], str)) or any(
                type(item[field]) is not int for field in fields[target] if field not in ("name", "raw")
            ):
                raise GameAssetError(f"data/{filename}.json", f"invalid {key} row {ident}")
            if "name" in item:
                item["name"] = text.get(ident) or item["name"]
            result[ident] = item
        data[target] = result
        if target == "ability_effects":
            data["abilities"] = _name_list(rows, text)

    for key, category in (("equipment", "equipment"), ("battalions", "battalion")):
        data[key] = _name_list(_rows(assets, key, key), assets.text(category))
    data["battalion_stats"] = _battalion_stats(_rows(assets, "battalions", "battalions"))
    # Gambit names by gambit ID: the game language's text, else the import's battalion rows.
    gambits = {str(row["gambit"]["id"]): row["gambit"].get("name") for row in _rows(assets, "battalions", "battalions")
               if isinstance(row.get("gambit"), dict) and isinstance(row["gambit"].get("id"), int)}
    data["gambits"] = {**{k: v for k, v in gambits.items() if v}, **{k: v for k, v in assets.text("gambit").items() if v}}
    equipment_text = assets.text("equipment")
    if data["equipment"] and equipment_text:
        for index in range(len(data["equipment"]), max(map(int, equipment_text)) + 1):
            data["equipment"].append(equipment_text.get(str(index)))
    data["items"] = _names_by_id(_rows(assets, "items", "items"), assets.text("item"))
    classes = _rows(assets, "classes", "classes", ("name", "boosts", "mounted", "mastery_ability", "mastery_art", "abilities"))
    if any(not isinstance(row["boosts"], dict) or not isinstance(row["mounted"], dict)
           or not isinstance(row["abilities"], list) for row in classes):
        raise GameAssetError("data/classes.json", "invalid class modifiers or abilities")
    class_names = assets.text("class")
    data["classes"] = {
        str(row["id"]): {
            "name": class_names.get(str(row["id"])) or row["name"],
            "boosts": {key: value for key, value in row["boosts"].items() if value},
            "mounted": {key: value for key, value in row["mounted"].items() if value},
            **({"female_name": row["female_name"]} if row.get("female_name") else {}),
            # The game's own tier (0 Noble and Commoner, 1-5 up to Master, 6 story and DLC classes): the order mastered
            # classes are listed in.
            "tier": row["tier"] if isinstance(row.get("tier"), int) else 0,
        }
        for row in classes
    }
    data["class_abilities"] = {
        str(row["id"]): [value for value in (row["mastery_ability"], row["mastery_art"], *row["abilities"])
                         if value is not None]
        for row in classes
    }

    characters = _rows(assets, "characters", "characters", ("name",))
    if any(row.get("student") is not None and not isinstance(row["student"], dict) for row in characters):
        raise GameAssetError("data/characters.json", "invalid student metadata")
    given = assets.text("character_given")
    full = assets.text("character_full")
    all_names = assets.text("npc_and_generic_names")
    character_ids = set(range(35)) | set(range(1040, 1047))
    npc_ids = set(range(35, 57)) | {58, 70, 71, 72, 73, 74, 75, 80, 81, 82, 83, 84, 85, 86, 99}
    data["characters"] = {}
    for row in characters:
        ident = row["id"]
        if ident not in character_ids:
            continue
        student = row.get("student") or {}
        data["characters"][str(ident)] = {
            "name": given.get(str(row.get("name_id", ident))) or row.get("name", ""),
            "full_name": full.get(str(ident)) or row.get("full_name") or given.get(str(row.get("name_id", ident))) or row.get("name", ""),
            "gender": ("Male", "Female")[row["gender"]] if row.get("gender") in (0, 1) else "",
            "personal": _ability_name(student, "personal_ability", data["abilities"]),
            "personal_plus": _ability_name(student, "personal_ability_upgraded", data["abilities"]),
        }
    data["npc_names"] = {key: value for key, value in all_names.items() if int(key) in npc_ids}
    data["generic_names"] = {key: value for key, value in all_names.items() if int(key) >= 100}
    for ident, row in data["characters"].items():
        if int(ident) >= 100:
            data["generic_names"].setdefault(ident, row["name"])
    data["female"] = [row["id"] for row in characters if row.get("gender") == 1]
    return data
@lru_cache(maxsize=1)
def byleth_no_s() -> dict[str, frozenset[int]]:
    rows = json.loads((DATA / "byleth_no_s.json").read_text(encoding="utf-8"))
    return {gender: frozenset(rows[gender]) for gender in ("male", "female")}


def memory() -> dict:
    return _memory(generation())


@lru_cache(maxsize=2)
def _maps(_generation: tuple) -> dict:
    source = game_assets().json("data/maps.json")
    if source is None:
        return {}
    try:
        maps = source["maps"]
        if not isinstance(maps, dict) or not maps:
            raise ValueError("empty maps")
        for key, rows in maps.items():
            int(key)
            if not rows or not all(bytes.fromhex(row) for row in rows):
                raise ValueError("invalid grid")
        return maps
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise GameAssetError("data/maps.json", "invalid map grids") from error


def maps() -> dict:
    return _maps(generation())


@lru_cache(maxsize=2)
def _scenario_maps(_generation: tuple) -> dict:
    source = game_assets().json("data/maps.json")
    scenarios = source.get("scenarios") if isinstance(source, dict) else None
    if not isinstance(scenarios, dict):
        return {}  # an import from before the table existed: the game's own map value is all there is
    try:
        return {int(scenario): int(map_id) for scenario, map_id in scenarios.items()}
    except (TypeError, ValueError):
        return {}


def scenario_maps() -> dict:
    """Scenario id -> the id of the map it is fought on (data/maps.json "scenarios")."""
    return _scenario_maps(generation())


@lru_cache(maxsize=2)
def _terrain(_generation: tuple) -> list:
    kinds = json.loads((DATA / "terrain_kinds.json").read_text(encoding="utf-8"))
    source = game_assets().json("data/terrain.json")
    if source is None:
        return []
    try:
        rows = source["tiles"]
        names = game_assets().text("terrain")
        return [[names.get(str(i)) or rows[str(i)]["name"], kind, *(rows[str(i)][key] for key in
                 ("avo", "def", "res", "heal", "enter", "move_name", "wall_hp"))]
                for i, kind in enumerate(kinds)]
    except (KeyError, TypeError, ValueError) as error:
        raise GameAssetError("data/terrain.json", "invalid terrain tiles") from error


def terrain() -> list:
    return _terrain(generation())


@lru_cache(maxsize=2)
def _scenario_names(_generation: tuple) -> tuple:
    try:
        text = game_assets().text("scenario_title")
        return tuple(text.get(str(i)) for i in range(max((int(key) for key in text), default=-1) + 1))
    except (AttributeError, TypeError, ValueError) as error:
        raise GameAssetError(f"text/{game_assets().language()}.json", "invalid scenario_title IDs") from error


def scenario_names() -> tuple:
    return _scenario_names(generation())


@lru_cache(maxsize=2)
def _class_types(_generation: tuple) -> dict[int, dict]:
    rows = _rows(game_assets(), "classes", "classes", ("types",))
    if any(not isinstance(row["types"], dict) for row in rows):
        raise GameAssetError("data/classes.json", "invalid class types")
    return {row["id"]: row["types"] for row in rows}


def class_types() -> dict[int, dict]:
    return _class_types(generation())
