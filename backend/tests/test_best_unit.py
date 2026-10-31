"""The best unit shown on a run's row on the home page."""

from app.domain.battle import Battle, BattleUnitStats
from app.domain.best_unit import best_unit
from app.infrastructure.persistence import BattleStore, RunStore
from app.domain.units import Unit


def unit(key: str, **stats) -> BattleUnitStats:
    return BattleUnitStats(key=key, name=key.title(), start_level=1, level=stats.pop("level", 1), start={}, now={}, **stats)


def battle(day: int, *units: BattleUnitStats, finished: bool = True, run_id: str = "run") -> Battle:
    at = f"2026-10-{day:02}T12:00:00Z"
    return Battle(id=f"b{day}", run_id=run_id, started_at=at, ended_at=at if finished else None, units=list(units))


def best(*battles: Battle, roster: tuple[str, ...] = ()) -> str | None:
    found = best_unit(battles, roster)
    return found.key if found else None


def test_score_adds_mvps_damage_and_healing_over_the_whole_run():
    # Felix is MVP twice: 2 x 1000 + 100 damage.
    assert best(
        battle(1, unit("dimitri", damage_dealt=1200, defeats=1), unit("felix", damage_dealt=50, defeats=2)),
        battle(2, unit("dimitri", damage_dealt=1200, defeats=1), unit("felix", damage_dealt=50, defeats=3)),
    ) == "dimitri"  # 2400 damage beats 2100
    assert best(
        battle(1, unit("dimitri", damage_dealt=400, defeats=1), unit("felix", damage_dealt=50, defeats=2)),
        battle(2, unit("dimitri", damage_dealt=400, defeats=1), unit("felix", damage_dealt=50, defeats=3)),
    ) == "felix"  # 800 damage doesn't


def test_healing_counts_like_damage():
    assert best(battle(1, unit("mercedes", healing_given=90), unit("felix", damage_dealt=80))) == "mercedes"


def test_mvp_is_shared_on_a_tie_and_needs_a_defeat():
    found = best_unit([battle(1, unit("a", defeats=2), unit("b", defeats=2, damage_dealt=1))], ())
    assert found.key == "b"  # both are MVP, then damage decides
    assert best(battle(1, unit("a", defeats=0), unit("b", defeats=0))) is None


def test_ties_go_to_kills_then_falls_then_level_then_roster_order():
    # x and y each score 1000 + 100; x has the extra kill.
    assert best(
        battle(1, unit("x", defeats=1, damage_dealt=100), unit("y", defeats=1, healing_given=100)),
        battle(2, unit("x", defeats=1), unit("y", defeats=0), unit("z", defeats=2)),
    ) == "x"
    assert best(battle(1, unit("x", damage_dealt=100, on_map=False), unit("y", damage_dealt=100))) == "y"
    assert best(battle(1, unit("x", damage_dealt=100, level=9), unit("y", damage_dealt=100, level=12))) == "y"
    tied = battle(1, unit("x", damage_dealt=100), unit("y", damage_dealt=100))
    assert best(tied, roster=("y", "x")) == "y"
    assert best(tied, roster=("x", "y")) == "x"


def test_an_adjutant_off_the_map_has_not_fallen():
    assert best(battle(1, unit("x", damage_dealt=100, on_map=False, adjutant_of="y", level=9), unit("y", damage_dealt=100, level=1))) == "x"


def test_no_data_means_no_best_unit():
    assert best() is None
    assert best(battle(1, unit("x"), unit("y", damage_dealt=None))) is None
    assert best(battle(1, unit("x", damage_dealt=500), finished=False)) is None  # still in progress


def test_sprite_comes_from_the_units_newest_battle():
    found = best_unit(
        [
            battle(2, unit("byleth", damage_dealt=1, class_id=9, character=1, female=True, look="green")),
            battle(1, unit("byleth", damage_dealt=1, class_id=2, character=1, female=True, look="dark")),
        ]
    )
    assert (found.name, found.class_id, found.character, found.female, found.look) == ("Byleth", 9, 1, True, "green")


def test_run_list_updates_the_best_unit_when_battles_change(tmp_path):
    runs, battles = RunStore(tmp_path / "runs"), BattleStore(tmp_path / "battles")
    runs.battles, battles.on_change = battles, runs.refresh_route
    run = runs.create("Azure Moon")
    assert runs.list()[0].best_unit is None

    battles.add(battle(1, unit("felix", damage_dealt=100), run_id=run.id))
    assert runs.list()[0].best_unit.key == "felix"

    battles.add(battle(2, unit("dimitri", damage_dealt=500), run_id=run.id))
    assert runs.list()[0].best_unit.key == "dimitri"

    battles.delete(run.id, "b2")
    assert runs.list()[0].best_unit.key == "felix"


def test_run_list_uses_roster_order_and_caches_the_best_unit(tmp_path, monkeypatch):
    runs, battles = RunStore(tmp_path / "runs"), BattleStore(tmp_path / "battles")
    runs.battles, battles.on_change = battles, runs.refresh_route
    run = runs.create("Azure Moon")
    runs.apply_units(run.id, {"y": Unit(name="Y"), "x": Unit(name="X")})
    battles.add(battle(1, unit("x", damage_dealt=100), unit("y", damage_dealt=100), run_id=run.id))
    assert runs.list()[0].best_unit.key == "y"

    monkeypatch.setattr("app.infrastructure.persistence.best_unit", lambda *_: (_ for _ in ()).throw(AssertionError))
    assert runs.list()[0].best_unit.key == "y"
