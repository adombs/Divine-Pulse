"""Dead units: the game's own "Is Dead" flag says who; the battle recordings say where they fell."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.domain import deaths
from app.domain.battle import Battle, BattleUnitStats, LogEntry
from app.domain.runs import Run
from app.domain.units import Death, Unit

START = datetime(2026, 11, 1, tzinfo=timezone.utc)


def battle(id: str, keys: list[str], log: list[LogEntry], *, day: int = 0, ended: bool = True) -> Battle:
    started = START + timedelta(days=day)
    return Battle(
        id=id,
        run_id="run",
        started_at=started,
        ended_at=started + timedelta(hours=1) if ended else None,
        units=[BattleUnitStats(key=k, name=k.title(), start_level=1, level=1, start={}, now={}) for k in keys],
        map_name="Battle in the Forest",
        scenario=82,
        log=log,
    )


def fell(key: str, step: int, by: str | None = None) -> LogEntry:
    return LogEntry(t=step * 10.0, turn=1, kind="fell", text=f"{key} fell.", unit=key, actor_id=f"a:{key}",
                    target_id=by, step=step)


def moved(key: str, step: int) -> LogEntry:
    return LogEntry(t=step * 10.0, turn=1, kind="move", text=f"{key} moved.", unit=key, actor_id=f"a:{key}", step=step)


UNITS = {"byleth": Unit(name="Byleth", game_id=0), "raphael": Unit(name="Raphael", game_id=20)}


def test_a_unit_the_game_marks_dead_is_dead_and_linked_to_where_it_fell():
    battles = [battle("b1", ["byleth", "raphael"], [moved("byleth", 1), fell("raphael", 4)])]
    changed = deaths.detect(UNITS, {0}, {20}, battles)
    assert list(changed) == ["raphael"]
    death = changed["raphael"].death
    assert death is not None and (death.battle_id, death.step, death.turn, death.t) == ("b1", 4, 1, 40.0)
    assert death.battle_name == "Battle in the Forest" and not death.manual


def test_the_dead_flag_decides_not_the_fall():
    """A fall with no dead flag (a restart, a Divine Pulse, Casual mode) is no death, missing from the army or not."""
    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4)])]
    assert deaths.detect(UNITS, {0, 20}, set(), battles) == {}
    assert deaths.detect(UNITS, {0}, set(), battles) == {}


def test_dead_with_no_recorded_fall_has_no_battle_to_link_to():
    changed = deaths.detect(UNITS, {0}, {20}, [])
    assert changed["raphael"].death is not None and changed["raphael"].death.battle_id is None


def test_the_link_goes_to_the_fall_that_stood_in_the_latest_battle():
    battles = [
        battle("b1", ["byleth", "raphael"], [fell("raphael", 4)]),  # restarted after this
        battle("b2", ["byleth", "raphael"], [moved("raphael", 1), fell("raphael", 6), moved("byleth", 7)], day=1),
    ]
    assert deaths.detect(UNITS, {0}, {20}, battles)["raphael"].death.battle_id == "b2"
    undone = [battle("b3", ["raphael"], [fell("raphael", 4), moved("raphael", 9)], day=2)]
    assert deaths.detect(UNITS, {0}, {20}, undone)["raphael"].death.battle_id is None


def test_a_unit_back_in_the_army_without_the_flag_is_alive_again_unless_marked_by_hand():
    dead = {
        "raphael": Unit(name="Raphael", game_id=20, death=Death(battle_id="b1")),
        "hilda": Unit(name="Hilda", game_id=25, death=Death(battle_id="b1", manual=True)),
    }
    changed = deaths.detect(dead, {20, 25}, set(), None)
    assert list(changed) == ["raphael"] and changed["raphael"].death is None


def test_marking_by_hand():
    from app.domain.battle import EnemyStats

    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4, by="e:7")])]
    battles[0].enemy_stats = {7: EnemyStats(slot=7, label="Rogue 7")}
    marked = deaths.mark("raphael", UNITS["raphael"], True, battles)
    assert marked.death is not None and marked.death.manual and marked.death.battle_id == "b1"
    assert marked.death.by == "Rogue 7"
    # Marked alive: the game's dead flag doesn't mark it dead again...
    alive = deaths.mark("raphael", marked, False, battles)
    assert alive.death is None and alive.marked_alive
    assert deaths.detect({"raphael": alive}, set(), {20}, battles) == {}
    # ...until the game reads it alive, which ends the override.
    back = deaths.detect({"raphael": alive}, {20}, set(), battles)["raphael"]
    assert not back.marked_alive and back.death is None
    # Dead with no fall recorded: no battle to link to.
    alone = deaths.mark("byleth", UNITS["byleth"], True, [])
    assert alone.death == Death(manual=True, at=alone.death.at)


def test_runs_saved_before_deaths_load_alive():
    run = Run.model_validate({"id": "run", "name": "Run", "units": {"raphael": {"name": "Raphael"}}})
    assert run.units["raphael"].death is None and not run.units["raphael"].marked_alive


def test_the_roster_dead_bit_is_read_from_the_slot_flags():
    import struct

    from app.gamemem import fe3h

    data = bytearray([0xFF] * fe3h.ROSTER_SIZE)
    for slot, (character, flags) in enumerate([(20, fe3h.IN_ARMY), (25, fe3h.IN_ARMY | fe3h.DEAD), (30, 0x02 | fe3h.DEAD)]):
        base = slot * fe3h.SLOT_SIZE
        struct.pack_into("<H", data, base + fe3h._CHARACTER, character)
        struct.pack_into("<I", data, base + fe3h._FLAGS, flags)
    assert fe3h.decode_dead(bytes(data)) == (25, 30)
