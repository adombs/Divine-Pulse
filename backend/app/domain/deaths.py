"""Units that died in a run (Classic mode's permadeath).

A unit falling in a battle isn't enough to call it dead: the battle can be restarted, a Divine Pulse can undo it, and in
Casual mode the unit is back after the battle. So a unit is dead when both hold:

- it fell in the timeline that still stands (the battle's own log, not a Divine Pulse branch) of the latest finished
  battle it took part in, and did nothing after falling;
- a complete read of the army outside a battle, after that battle, no longer has it.

A unit that turns up in the army again is alive again (a reload from before the battle). What the user decides by hand
(Unit.death with manual set, or Unit.death_dismissed) wins over both.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping

from .battle import Battle
from .units import Death, Unit


def final_fall(key: str, battle: Battle) -> Death | None:
    """Where `key` fell in the timeline of `battle` that still stands, if it did and stayed down."""
    actor = f"a:{key}"
    fall = None
    for index, entry in enumerate(battle.log):
        if entry.kind == "fell" and (entry.unit == key or entry.actor_id == actor):
            fall = (index, entry)
        elif fall is not None and entry.kind != "fell" and (entry.unit == key or entry.actor_id == actor):
            fall = None  # it acted after falling: that fall didn't stand
    if fall is None:
        return None
    index, entry = fall
    # Whoever caused it: for "fell" the target is the unit that dealt the blow ("e:<slot>" / "a:<key>").
    by = None
    if entry.target_id:
        by = _name(battle, entry.target_id)
    return Death(
        battle_id=battle.id,
        battle_name=battle.map_name or "",
        scenario=battle.scenario,
        turn=entry.turn,
        step=entry.step,
        t=entry.t,
        by=by,
    )


def _name(battle: Battle, uid: str) -> str | None:
    if uid.startswith("a:"):
        key = uid[2:]
        unit = next((u for u in battle.units if u.key == key), None)
        return unit.name if unit else key
    if uid.startswith("e:") and uid[2:].isdigit():
        enemy = (battle.enemy_stats or {}).get(int(uid[2:]))
        if enemy is not None:
            return enemy.label or enemy.name or None
    return None


def last_battle_fall(key: str, battles: Iterable[Battle]) -> Death | None:
    """Its fall in the latest finished battle it took part in (None: it didn't fall there, or that battle is still on)."""
    for battle in sorted(battles, key=lambda b: b.started_at, reverse=True):
        if not any(u.key == key for u in battle.units):
            continue
        if battle.ended_at is None:
            return None
        return final_fall(key, battle)
    return None


def latest_fall(key: str, battles: Iterable[Battle]) -> Death | None:
    """Its latest fall that stood in any battle (for a death marked by hand: the battle to link to)."""
    for battle in sorted(battles, key=lambda b: b.started_at, reverse=True):
        fall = final_fall(key, battle)
        if fall is not None:
            return fall
    return None


def missing_units(units: Mapping[str, Unit], present: Collection[int]) -> list[str]:
    """Run units read from game memory before that the army doesn't have now, and that could be newly dead."""
    return [
        key
        for key, unit in units.items()
        if unit.game_id is not None and unit.game_id not in present and unit.death is None
    ]


def detect(units: Mapping[str, Unit], present: Collection[int], battles: Iterable[Battle] | None) -> dict[str, Unit]:
    """Changed units after a complete read of the army outside a battle (`present`: the character IDs in it).

    `battles` is only needed when some unit is missing (see missing_units); pass None to skip loading them."""
    changed: dict[str, Unit] = {}
    for key, unit in units.items():
        if unit.game_id is None:
            continue
        if unit.game_id in present:
            if unit.death is not None and not unit.death.manual:
                changed[key] = unit.model_copy(update={"death": None})
            continue
    missing = missing_units(units, present)
    if missing and battles is not None:
        battles = list(battles)
        for key in missing:
            unit = units[key]
            fall = last_battle_fall(key, battles)
            if fall is None or fall.battle_id == unit.death_dismissed:
                continue
            changed[key] = unit.model_copy(update={"death": fall})
    return changed


def mark(key: str, unit: Unit, dead: bool, battles: Iterable[Battle]) -> Unit:
    """The user says the unit is dead (linked to its latest fall, if any) or alive (that fall is ignored from now on)."""
    fall = unit.death or latest_fall(key, list(battles))
    if dead:
        death = (fall or Death()).model_copy(update={"manual": True})
        return unit.model_copy(update={"death": death, "death_dismissed": None})
    dismissed = fall.battle_id if fall is not None and fall.battle_id else unit.death_dismissed
    return unit.model_copy(update={"death": None, "death_dismissed": dismissed})
