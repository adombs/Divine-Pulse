"""Units that died in a run (Classic mode's permadeath).

The game says who is dead: the "Is Dead" bit of each roster slot's flags (gamemem/fe3h.py DEAD). The battle recordings
only say where it happened, for the link to that step of the replay: the unit's fall in the timeline that still stands
(the battle's own log, not a Divine Pulse branch) of the latest finished battle it took part in.

The user can overrule the game by hand: Unit.death with manual set (dead), or Unit.marked_alive (alive while the game
calls it dead; forgotten once the game reads it alive again).
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping

from .battle import Battle
from .units import Death, Unit


def final_fall(key: str, battle: Battle) -> Death | None:
    """Where `key` fell in the timeline of `battle` that still stands, if it did and stayed down."""
    actor = f"a:{key}"
    if any(u.key == key and u.guest for u in battle.units):
        return None  # a guest isn't in the army: its fall in a battle isn't a death in the run
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
        if not any(u.key == key and not u.guest for u in battle.units):
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


def newly_dead(units: Mapping[str, Unit], dead: Collection[int]) -> list[str]:
    """Run units the game marks dead that the run doesn't have as dead yet (and the user hasn't said are alive)."""
    return [
        key
        for key, unit in units.items()
        if unit.game_id is not None and unit.game_id in dead and unit.death is None and not unit.marked_alive
    ]


def fall_of(key: str, battles: Iterable[Battle]) -> Death | None:
    """Where the unit fell: in the latest finished battle it took part in, else its latest fall that stood anywhere."""
    battles = list(battles)
    return last_battle_fall(key, battles) or latest_fall(key, battles)


def detect(
    units: Mapping[str, Unit], present: Collection[int], dead: Collection[int], battles: Iterable[Battle] | None
) -> dict[str, Unit]:
    """Changed units after a complete read of the roster outside a battle: `present` the character IDs in the army,
    `dead` those whose slot has the game's "Is Dead" bit. `battles` is only needed for newly_dead units (where they
    fell); with None they're marked dead with no battle to link to."""
    changed: dict[str, Unit] = {}
    for key, unit in units.items():
        if unit.game_id is None or unit.game_id in dead or unit.game_id not in present:
            continue
        # In the army and not dead in the game's eyes: alive (a reload from before the death, say).
        update = {}
        if unit.death is not None and not unit.death.manual:
            update["death"] = None
        if unit.marked_alive:
            update["marked_alive"] = False
        if update:
            changed[key] = unit.model_copy(update=update)
    fresh = newly_dead(units, dead)
    if fresh:
        battles = list(battles or [])
        for key in fresh:
            changed[key] = units[key].model_copy(update={"death": fall_of(key, battles) or Death()})
    return changed


def mark(key: str, unit: Unit, dead: bool, battles: Iterable[Battle]) -> Unit:
    """The user says the unit is dead (linked to where it fell, if anywhere) or alive (whatever the game says)."""
    if dead:
        fall = unit.death or fall_of(key, battles)
        death = (fall or Death()).model_copy(update={"manual": True})
        return unit.model_copy(update={"death": death, "marked_alive": False})
    return unit.model_copy(update={"death": None, "marked_alive": True})
