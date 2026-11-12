"""HTTP response models and presentation-only battle serialization."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..domain.battle import Battle, BattleUnitStats
from ..domain.runs import RunSummary
from ..domain.membership import on_roster
from ..domain.units import Unit, VALUE_KEYS
from ..domain.ebst import EbstConfig
from ..domain.outlook import outlook


class RunsOut(BaseModel):
    runs: list[RunSummary]
    active_run_id: str | None


class BattleUnitOut(BattleUnitStats):
    level_up_count: int = Field(alias="level_ups")
    stat_gains: dict[str, int] = Field(alias="gains")


class BattleOut(Battle):
    """Stored battle facts plus the dashboard's explicitly declared derived values."""

    units: list[BattleUnitOut]
    route: str | None
    active: bool
    duration_seconds: float = Field(alias="seconds")
    level_up_count: int = Field(alias="level_ups")
    gained_stat_points: int = Field(alias="stat_points")
    weapon_use_count: int = Field(alias="weapon_uses")
    spell_cast_count: int = Field(alias="spells_cast")
    item_use_count: int = Field(alias="item_uses")
    remaining_spell_uses: int | None = Field(alias="spell_uses_left")
    full_spell_uses: int | None = Field(alias="spell_uses_full")
    outlook: dict | None


def battle_out(battle: Battle, active: bool, route: str | None = None) -> dict:
    """A battle for the Battle page, with the numbers worked out from it."""
    out = battle.model_dump(mode="json")
    out.update(
        route=route,
        active=active,
        seconds=round(battle.seconds(), 1),
        level_ups=battle.level_ups,
        stat_points=battle.stat_points,
        weapon_uses=battle.weapon_uses,
        spells_cast=battle.spells_cast,
        item_uses=battle.item_uses,
        spell_uses_left=battle.spell_uses_left,
        spell_uses_full=battle.spell_uses_full,
        outlook=outlook(battle) if active else None,
    )
    for unit, data in zip(battle.units, out["units"]):
        data.update(level_ups=unit.level_ups, gains=unit.gains())
    return BattleOut.model_validate(out).model_dump(mode="json", by_alias=True)


class UnitOut(Unit):
    key: str
    base_values: dict[str, int]
    effective_bonuses: dict[str, int]
    # The setup (offense/defense types + stat toggles) used for eBST.
    ebst_effective: EbstConfig
    # Blue on screen, but no known or manual bonus explains it.
    boosted_unexplained: list[str]
    # Whether the Roster shows it (in the army, or dead); `in_army` alone is the game's in-army flag.
    on_roster: bool

    @classmethod
    def from_unit(cls, key: str, unit: Unit) -> UnitOut:
        base = unit.base()
        effective = {k: b for k in VALUE_KEYS if (b := unit.effective_bonus(k))}
        unexplained = [k for k in unit.blue if not unit.effective_bonus(k)]
        cfg = unit.ebst_config()
        return cls(
            **unit.model_dump(),
            key=key,
            base_values=base,
            effective_bonuses=effective,
            ebst_effective=cfg,
            boosted_unexplained=unexplained,
            on_roster=on_roster(unit),
        )
