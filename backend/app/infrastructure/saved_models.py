"""Prepare saved units and runs for validation."""

from __future__ import annotations

from pydantic import model_validator

from ..domain.ebst import ordered_others
from ..domain.runs import Run as DomainRun
from ..domain.inventory import InventoryItem
from ..domain.units import byleth_look
from .inventory import weapon_kind


def _prepare_unit(data):
    if not isinstance(data, dict) or not isinstance(data.get("inventory"), list):
        if isinstance(data, dict) and isinstance(data.get("ebst_stats"), list):
            return {**data, "ebst_stats": ordered_others(data["ebst_stats"])}
        return data
    inventory = []
    for item in data["inventory"]:
        if isinstance(item, InventoryItem):
            inventory.append(item.model_copy(update={"weapon": weapon_kind(item.kind, item.id)}))
            continue
        if isinstance(item, dict):
            item = {**item, "weapon": weapon_kind(item.get("kind", ""), item.get("id", -1))}
        inventory.append(item)
    adapted = {**data, "inventory": inventory}
    if isinstance(data.get("ebst_stats"), list):
        adapted["ebst_stats"] = ordered_others(data["ebst_stats"])
    return adapted


class Run(DomainRun):
    """Prepare nested units before domain validation."""

    @model_validator(mode="before")
    @classmethod
    def _prepare_units(cls, data):
        if isinstance(data, dict) and isinstance(data.get("units"), dict):
            data = {**data, "units": {key: _prepare_unit(value) for key, value in data["units"].items()}}
        if isinstance(data, dict) and isinstance(data.get("ebst_default"), dict):
            config = data["ebst_default"]
            if isinstance(config.get("stats"), list):
                data = {**data, "ebst_default": {**config, "stats": ordered_others(config["stats"])}}
        return data


def _reference_items(items: list[dict]) -> list[dict]:
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError("Saved inventory/usage must be a list of objects")
    return [
        {**item, "weapon": weapon_kind(item["kind"], item["id"])}
        if isinstance(item.get("kind"), str) and isinstance(item.get("id"), int)
        else item
        for item in items
    ]


def decode_battle(data: dict):
    """Refresh derived labels using this installation's tables, then validate saved facts."""
    from ..domain.battle import Battle

    if not isinstance(data, dict):
        raise ValueError("Saved battle must be an object")
    data = dict(data)
    units = []
    for unit in data.get("units", []):
        unit = dict(unit)
        # Hair is derived from this recording's story progress, not today's roster. Repair the old chapter-11 rule.
        if unit.get("character") in (0, 1):
            look = byleth_look(data.get("scenario"), in_battle=True)
            if look is not None:
                unit["look"] = look
        for field in ("inventory", "usage"):
            if field in unit and unit[field] is not None:
                unit[field] = _reference_items(unit[field])
        units.append(unit)
    data["units"] = units
    enemies = {}
    for key, enemy in data.get("enemy_stats", {}).items():
        enemy = dict(enemy)
        if "inventory" in enemy:
            enemy["inventory"] = _reference_items(enemy["inventory"])
        enemies[key] = enemy
    data["enemy_stats"] = enemies
    return Battle.model_validate(data)


def decode_battles(contents: str):
    import json

    data = json.loads(contents)
    if not isinstance(data, list):
        raise ValueError("Saved battle history must be a list")
    return [decode_battle(battle) for battle in data]
