"""Pure observation-to-change rules with external lookups passed as capabilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from .changes import Outcome, UnitChange
from .inventory import InventoryItem
from .readings import UnitStatsReading
from .runs import Run
from .units import STAT_KEYS, Unit, now, unit_key

MAX_STAT_JUMP = 15
LABELS = {"hp": "HP", "mv": "Mv", **{key: key.capitalize() for key in STAT_KEYS}}


class BonusCalculator(Protocol):
    def compute(self, equipped: list[str], personal: str, accessory: str | None) -> dict[str, int]: ...


NameResolver = Callable[[list[str], list[str]], str]


def _inventory_item(value) -> InventoryItem:
    data = value.model_dump() if hasattr(value, "model_dump") else value
    # Older stored items did not serialize the derived weapon key.
    return InventoryItem.model_validate(data)


def apply_unit_stats(
    reading: UnitStatsReading,
    run: Run,
    bonuses: BonusCalculator,
    resolve_name: NameResolver,
) -> Outcome:
    same_character = next(
        (key for key, unit in run.units.items() if reading.game_id is not None and unit.game_id == reading.game_id),
        None,
    )
    if same_character is not None:
        key, name = same_character, run.units[same_character].name
    else:
        name = resolve_name(reading.name_candidates, [unit.name for unit in run.units.values()])
        key = unit_key(name)
    existing = run.units.get(key)
    shown = set(reading.values)

    unit = (
        existing.model_copy(deep=True)
        if existing
        else Unit(
            name=name,
            ebst_offense=run.ebst_default.offense,
            ebst_defense=run.ebst_default.defense,
            ebst_stats=list(run.ebst_default.stats),
        )
    )
    unit.name = name
    if reading.full_name:
        unit.full_name = reading.full_name
    if reading.class_name:
        unit.class_name = reading.class_name
    if reading.gender:
        unit.gender = reading.gender
    unit.displayed = {**unit.displayed, **reading.values}
    unit.blue = sorted({key for key in unit.blue if key not in shown} | reading.blue)
    if reading.abilities is not None:
        ability = reading.abilities
        unit.personal_ability, unit.abilities, unit.accessory = (
            ability.personal,
            list(ability.equipped),
            ability.accessory,
        )
        unit.bonuses = bonuses.compute(ability.equipped, ability.personal, ability.accessory)
        # The battalion's share of the values is a bonus too, so base() stays the unit's own stat.
        for stat, amount in (ability.battalion_bonus or {}).items():
            unit.bonuses = {**unit.bonuses, stat: unit.bonuses.get(stat, 0) + amount}
        if ability.arts is not None:
            unit.combat_arts = list(ability.arts)
        if ability.inventory is not None:
            unit.inventory = [_inventory_item(item) for item in ability.inventory]
        if ability.learned is not None:
            unit.learned_abilities = list(ability.learned)
        if ability.learned_arts is not None:
            unit.learned_arts = list(ability.learned_arts)
        if ability.battalion is not None:
            if ability.battalion_id is not None or ability.battalion != unit.battalion:
                unit.battalion_id = ability.battalion_id
            unit.battalion = ability.battalion
            unit.battalion_exp = ability.battalion_exp if ability.battalion else None
            unit.battalion_endurance = ability.battalion_endurance if ability.battalion else None
            unit.gambit_uses = ability.gambit_uses if ability.battalion else None
            if not ability.battalion:
                unit.battalion_id = None
        if ability.skills is not None:
            unit.skills = dict(ability.skills)
        if ability.mastered_classes is not None:
            unit.mastered_classes = list(ability.mastered_classes)
    if reading.game_id is not None:
        unit.game_id = reading.game_id
    if reading.look is not None:
        unit.look = reading.look
    if reading.birthday is not None:
        unit.birthday = reading.birthday
    unit.source = "memory" if reading.game_id is not None else "scan"
    unit.updated_at = now()

    outcome = Outcome(subject=name, changes=[UnitChange(key, existing, unit)])
    if existing:
        for key in ("hp", *STAT_KEYS):
            if key not in shown:
                continue
            old, new = existing.displayed.get(key, 0), unit.displayed[key]
            if abs(new - old) > MAX_STAT_JUMP:
                outcome.warnings.append(f"{LABELS[key]} changed a lot ({old} → {new}).")
    for key in sorted(reading.blue):
        if not unit.effective_bonus(key):
            outcome.warnings.append(
                f"{LABELS.get(key, key)} is boosted (blue) but no known bonus explains it; set the bonus manually."
            )
    if reading.abilities is not None:
        for key, amount in unit.bonuses.items():
            if (
                key in shown
                and key != "mv"
                and key not in reading.blue
                and key not in unit.manual_bonuses
            ):
                outcome.warnings.append(
                    f"{LABELS.get(key, key)} has a +{amount} ability bonus but isn't shown in blue; check it."
                )
    return outcome
