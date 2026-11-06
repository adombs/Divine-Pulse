"""Bundled battle reference data and adapters for battle tracking."""

from __future__ import annotations

from ..domain.battle import HistoryStep, RALLY_ABILITIES, STEP_ITEM, STEP_SPELL, SUPPORT_SPELLS, StepUnit, TerrainTile
from .inventory import ability_name
from . import game_tables


def _scenario_names() -> tuple[str | None, ...]:
    try:
        return game_tables.scenario_names()
    except (OSError, ValueError, KeyError, TypeError):
        return ()


def scenario_name(scenario: int) -> str:
    """The battle's name for a scenario id ("Oil and Water"), "" if not known."""
    names = _scenario_names()
    return (names[scenario] or "") if 0 <= scenario < len(names) else ""


def terrain_tiles(grid: list[list[int]]) -> dict[int, TerrainTile]:
    """What each terrain ID on this map is (unknown IDs are left out)."""
    from ..gamemem.terrain import terrain

    out = {}
    for tile_id in sorted({t for row in grid for t in row}):
        info = terrain(tile_id)
        if info is not None:
            out[tile_id] = TerrainTile(
                name=info.name,
                kind=info.kind,
                effect=info.move,
                avo=info.avo,
                defense=info.defense,
                res=info.res,
                heal=info.heal,
                enter=info.enter,
                wall_hp=info.wall_hp,
            )
    return out


def _item_names() -> tuple[dict[str, str], dict[str, str]]:
    """Spell and item names by ID."""
    try:
        data = game_tables.memory()
        return {k: v["name"] for k, v in data["spells"].items()}, dict(data.get("items", {}))
    except (OSError, ValueError, KeyError, TypeError):
        return {}, {}


def support_spell(step: HistoryStep) -> str | None:
    """The staff a step used ("Rescue"), if it's one: magic with no fight in it (ITEM 0)."""
    if step.action != STEP_SPELL or step.item or step.spell not in SUPPORT_SPELLS:
        return None
    return _item_names()[0].get(str(step.spell))


def item_used(step: HistoryStep) -> str | None:
    """The item a step used ("Vulnerary"), if it's an item's and the ID is known."""
    return _item_names()[1].get(str(step.item)) if step.action == STEP_ITEM else None


def gambit_name(gambit: int) -> str:
    """A gambit's name from the import ("Assembly"), else "Gambit <ID>"."""
    return game_tables.memory().get("gambits", {}).get(str(gambit)) or f"Gambit {gambit}"


def rally_name(unit: StepUnit | None) -> str:
    """The Rally a unit used: its one equipped Rally ability ("Rally Speed"), else just "Rally"."""
    rallies = [a for a in unit.abilities if a in RALLY_ABILITIES] if unit is not None else []
    return (ability_name(rallies[0]) or "Rally") if len(rallies) == 1 else "Rally"
