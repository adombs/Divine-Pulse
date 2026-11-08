"""Dead units: a fall that stood in the latest finished battle, confirmed by the army no longer having the unit."""

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


def test_a_unit_that_fell_and_left_the_army_is_dead():
    battles = [battle("b1", ["byleth", "raphael"], [moved("byleth", 1), fell("raphael", 4)])]
    changed = deaths.detect(UNITS, {0}, battles)
    assert list(changed) == ["raphael"]
    death = changed["raphael"].death
    assert death is not None and (death.battle_id, death.step, death.turn, death.t) == ("b1", 4, 1, 40.0)
    assert death.battle_name == "Battle in the Forest" and not death.manual


def test_a_fall_alone_isnt_death_while_the_unit_is_still_in_the_army():
    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4)])]
    assert deaths.detect(UNITS, {0, 20}, battles) == {}


def test_a_restarted_battle_brings_the_unit_back():
    """Raphael fell in the first try; the battle was restarted and he fought in the next one: alive."""
    battles = [
        battle("b1", ["byleth", "raphael"], [fell("raphael", 4)]),
        battle("b2", ["byleth", "raphael"], [moved("raphael", 1)], day=1),
    ]
    assert deaths.detect(UNITS, {0}, battles) == {}


def test_a_fall_undone_later_in_the_log_doesnt_count():
    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4), moved("raphael", 9)])]
    assert deaths.detect(UNITS, {0}, battles) == {}


def test_a_battle_still_on_doesnt_decide():
    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4)], ended=False)]
    assert deaths.detect(UNITS, {0}, battles) == {}


def test_a_unit_back_in_the_army_is_alive_again_unless_marked_by_hand():
    dead = {
        "raphael": Unit(name="Raphael", game_id=20, death=Death(battle_id="b1")),
        "hilda": Unit(name="Hilda", game_id=25, death=Death(battle_id="b1", manual=True)),
    }
    changed = deaths.detect(dead, {20, 25}, None)
    assert list(changed) == ["raphael"] and changed["raphael"].death is None


def test_marking_by_hand():
    from app.domain.battle import EnemyStats

    battles = [battle("b1", ["byleth", "raphael"], [fell("raphael", 4, by="e:7")])]
    battles[0].enemy_stats = {7: EnemyStats(slot=7, label="Rogue 7")}
    marked = deaths.mark("raphael", UNITS["raphael"], True, battles)
    assert marked.death is not None and marked.death.manual and marked.death.battle_id == "b1"
    assert marked.death.by == "Rogue 7"
    # Marked alive: that fall isn't taken as its death again.
    alive = deaths.mark("raphael", marked, False, battles)
    assert alive.death is None and alive.death_dismissed == "b1"
    assert deaths.detect({"raphael": alive}, set(), battles) == {}
    # Dead with no fall recorded: no battle to link to.
    alone = deaths.mark("byleth", UNITS["byleth"], True, [])
    assert alone.death == Death(manual=True, at=alone.death.at)


def test_runs_saved_before_deaths_load_alive():
    run = Run.model_validate({"id": "run", "name": "Run", "units": {"raphael": {"name": "Raphael"}}})
    assert run.units["raphael"].death is None and run.units["raphael"].death_dismissed is None
