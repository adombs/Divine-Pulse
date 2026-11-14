"""The best unit shown on a run's row on the home page."""

from app.domain.battle import Battle, BattleUnitStats
from app.domain.best_unit import best_unit, unit_scores
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


def test_score_is_damage_and_healing_and_mvps_add_nothing():
    # Felix has every kill (the battle's MVP) but less damage.
    assert best(
        battle(1, unit("dimitri", damage_dealt=120), unit("felix", damage_dealt=50, defeats=5)),
        battle(2, unit("dimitri", damage_dealt=120), unit("felix", damage_dealt=50, defeats=5)),
    ) == "dimitri"


def test_healing_counts_like_damage():
    assert best(battle(1, unit("mercedes", healing_given=90), unit("felix", damage_dealt=80))) == "mercedes"


def test_nothing_dealt_or_healed_scores_nothing():
    assert best(battle(1, unit("a", defeats=2), unit("b", defeats=2, damage_dealt=1))) == "b"
    assert best(battle(1, unit("a", defeats=3), unit("b", defeats=0))) is None


def test_ties_go_to_kills_then_falls_then_level_then_roster_order():
    # x and y each average 100 / 2; x has the extra kill.
    assert best(
        battle(1, unit("x", defeats=1, damage_dealt=100), unit("y", defeats=1, healing_given=100)),
        battle(2, unit("x", defeats=1), unit("y", defeats=0)),
    ) == "x"
    assert best(battle(1, unit("x", damage_dealt=100, on_map=False), unit("y", damage_dealt=100))) == "y"
    assert best(battle(1, unit("x", damage_dealt=100, level=9), unit("y", damage_dealt=100, level=12))) == "y"
    tied = battle(1, unit("x", damage_dealt=100), unit("y", damage_dealt=100))
    assert best(tied, roster=("y", "x")) == "y"
    assert best(tied, roster=("x", "y")) == "x"


def test_an_adjutant_off_the_map_has_not_fallen():
    # x and y each average 100 over their one deployment; x's battle as an adjutant isn't a fall (or a deployment).
    assert best(
        battle(1, unit("x", damage_dealt=100, level=9), unit("y", damage_dealt=100, level=1)),
        battle(2, unit("x", on_map=False, adjutant_of="z"), unit("z", on_map=False)),
    ) == "x"


def test_score_is_the_average_per_deployment():
    battles = [
        battle(1, unit("felix", damage_dealt=300, defeats=2), unit("mercedes", healing_given=400)),
        battle(2, unit("felix", damage_dealt=100), unit("mercedes", healing_given=201)),
        battle(3, unit("felix", damage_dealt=201)),
    ]
    # Both earned 601 in all; Mercedes did it in fewer battles: 601 / 3 against 601 / 2.
    assert unit_scores(battles) == {"felix": 200, "mercedes": 301}
    assert best(*battles) == "mercedes"
    assert unit_scores([battle(1, unit("x", damage_dealt=1)), battle(2, unit("x", damage_dealt=0))]) == {"x": 1}  # halves round up


def test_battles_as_an_adjutant_are_not_deployments():
    battles = [
        battle(1, unit("felix", damage_dealt=300), unit("dedue", damage_dealt=100)),
        battle(2, unit("felix", damage_dealt=50, on_map=False, adjutant_of="dedue"), unit("dedue", damage_dealt=100)),
        battle(3, unit("felix", on_map=False, adjutant_of="dedue"), unit("dedue")),
    ]
    # Felix was deployed once (300); Dedue three times (200 / 3). Only ever an adjutant: no deployments, so 0.
    assert unit_scores(battles) == {"felix": 300, "dedue": 67}
    assert unit_scores([battle(1, unit("ashe", damage_dealt=80, on_map=False, adjutant_of="felix"), unit("felix"))]) == {"ashe": 0, "felix": 0}


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


def test_unit_scores_are_what_the_best_unit_is_chosen_by():
    battles = [
        battle(1, unit("felix", damage_dealt=100, defeats=2), unit("mercedes", healing_given=40), unit("ingrid")),
        battle(2, unit("felix", damage_dealt=50, defeats=1), unit("mercedes", healing_given=10, defeats=3), finished=False),
    ]
    # Felix: 100 damage in one deployment; the unfinished battle counts for nothing.
    assert unit_scores(battles) == {"felix": 100, "mercedes": 40, "ingrid": 0}
    assert best(*battles) == "felix"


def test_unit_scores_skip_guests_the_run_does_not_have():
    battles = [battle(1, unit("guest", damage_dealt=900, guest=True), unit("felix", damage_dealt=5))]
    assert unit_scores(battles) == {"felix": 5}
    assert unit_scores(battles, ("guest",)) == {"guest": 900, "felix": 5}


def test_run_store_serves_scores_and_refreshes_them(tmp_path):
    runs, battles = RunStore(tmp_path / "runs"), BattleStore(tmp_path / "battles")
    runs.battles, battles.on_change = battles, runs.refresh_route
    run = runs.create("Azure Moon")
    assert runs.unit_scores(run.id) == {}
    battles.add(battle(1, unit("felix", damage_dealt=100), run_id=run.id))
    assert runs.unit_scores(run.id) == {"felix": 100}
    battles.delete(run.id, "b1")
    assert runs.unit_scores(run.id) == {}
