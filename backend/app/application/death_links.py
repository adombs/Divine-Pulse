"""Keeping the dead units' link to the battle where they fell in step with a run's battle history."""

from __future__ import annotations

from ..domain import deaths
from ..domain.battle import Battle
from ..domain.units import Death, Unit
from .ports import EventPublisher, RunRepository

_FALL_FIELDS = ("battle_id", "battle_name", "scenario", "turn", "step", "t", "by")


def relinked(units: dict[str, Unit], history: list[Battle]) -> dict[str, Unit]:
    """The dead units whose death should now link elsewhere, after battles were discarded or restored.

    Each dead unit's fall is worked out again from the history (deaths.fall_of). Found: the death's fall fields come
    from it. Not found: a link to a battle still in the history stays, else the link and fall details are cleared. The
    unit stays dead and `manual` is kept; living units are never touched."""
    present = {battle.id for battle in history}
    changed: dict[str, Unit] = {}
    for key, unit in units.items():
        death = unit.death
        if death is None:
            continue
        fall = deaths.fall_of(key, history)
        if fall is not None:
            update = {name: getattr(fall, name) for name in _FALL_FIELDS}
        elif death.battle_id is not None and death.battle_id not in present:
            update = {name: getattr(Death(), name) for name in _FALL_FIELDS}
        else:
            continue
        if all(getattr(death, name) == value for name, value in update.items()):
            continue
        changed[key] = unit.model_copy(update={"death": death.model_copy(update=update)})
    return changed


def relink_deaths(runs: RunRepository, run_id: str, history: list[Battle], events: EventPublisher) -> list[str]:
    """Save and announce the deaths relinked by `relinked`; the keys of the units changed."""
    changed = relinked(runs.get(run_id).units, history)
    if changed:
        runs.apply_units(run_id, changed)
        events.publish("units_changed", {"run_id": run_id})
    return list(changed)
