import json

import pytest
from fastapi.testclient import TestClient

from app.battle import Battle, BattleUnitStats
from app.main import create_app
from app.domain.units import Unit, now
from app.infrastructure.saved_models import Run
from app.infrastructure.route_inference import route_of, route_reference

SCENARIO_ROUTES = route_reference().scenario_routes


def battle(scenario=None, keys=(), **kwargs):
    return Battle(
        id="test", run_id="test", started_at=now(), scenario=scenario,
        units=[BattleUnitStats(key=k, name=k.title(), level=20, start_level=20, start={}, now={}) for k in keys],
        **kwargs,
    )


@pytest.mark.parametrize("scenario,route", SCENARIO_ROUTES.items())
def test_exclusive_scenarios_win_over_recruits(scenario, route):
    run = Run(id="test", name="Test", units={"hilda": Unit(name="Hilda")})
    assert route_of(run, [battle(scenario, ["hilda"])]) == route


def test_part_one_house_and_unknown(roster_import):
    assert route_of(Run(id="test", name="Test"), []) is None
    assert route_of(None, [battle(7, ["edelgard", "dimitri", "claude"])]) is None
    assert route_of(None, [battle(2, ["claude", "lysithea"])]) == "golden-deer"
    assert route_of(None, [battle(2, ["petra", "dorothea"])]) == "black-eagles"
    assert route_of(Run(id="test", name="Test", units={"cluade": Unit(name="Cluade", game_id=4)}), []) == "golden-deer"


def test_part_two_lords_and_silver_snow_need_evidence():
    assert route_of(None, [battle(13, ["claude"])]) == "vw"
    assert route_of(None, [battle(14, ["dimitri"])]) == "am"
    assert route_of(None, [battle(13, ["petra", "dorothea"])]) == "ss"
    assert route_of(None, [battle(14, ["byleth"])]) is None
    # Pre-timeskip histories do not keep an absent Edelgard on the Silver Snow branch.
    assert route_of(None, [battle(2, ["edelgard"]), battle(13, ["petra", "dorothea"])]) == "ss"


def test_routes_update_on_battle_save_and_survive_restart(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        run_id = client.post("/api/runs", json={"name": "Test"}).json()["id"]
        app.state.store.put_unit(run_id, "claude", Unit(name="Claude"))
        assert client.get("/api/runs").json()["runs"][0]["route"] == "golden-deer"
        app.state.battles.save_active(battle(29))
        assert client.get("/api/runs").json()["runs"][0]["route"] == "vw"
        assert json.loads((tmp_path / "runs" / "test.json").read_text())["route"] == "vw"
    with TestClient(create_app(tmp_path, background=False)) as client:
        assert client.get("/api/runs").json()["runs"][0]["route"] == "vw"


def test_late_lord_class_identifies_auxiliary_battles():
    run = Run(id="test", name="Test", units={"edelgard": Unit(name="Edelgard", class_name="Emperor")})
    assert route_of(run, [battle(61, ["edelgard"])]) == "cf"
    auxiliary = battle(61, ["edelgard"])
    auxiliary.units[0].class_name = "Emperor"
    assert route_of(None, [auxiliary]) == "cf"
