"""Dead units follow the battle history: discarding or restoring a duplicate relinks where they fell."""

import pytest
from fastapi.testclient import TestClient

from app.domain.battle import BattleUnitStats, LogEntry
from app.domain.units import Death, Unit
from app.main import create_app
from test_duplicate_battles import battle


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as c:
        c.app_state = app.state
        c.published = []
        app.state.events.add_listener(lambda name, data: c.published.append((name, data)))
        yield c


def a_run(client, mode="ask"):
    run_id = client.post("/api/runs", json={"name": "Run"}).json()["id"]
    client.app_state.settings.update(active_run_id=run_id, duplicate_battles=mode)
    return run_id


def copy(bid, run_id, falls=(), **kw):
    """A copy of scenario 0 with the army units "raphael" and "byleth"; `falls` are the keys that fell in it."""
    b = battle(bid, run_id=run_id, **kw)
    b.units = [BattleUnitStats(key=k, name=k.title(), start_level=1, level=1, start={}, now={})
               for k in ("raphael", "byleth")]
    b.log = [LogEntry(t=3.0, turn=2, kind="fell", text=f"{k} fell.", unit=k, actor_id=f"a:{k}", step=7) for k in falls]
    return b


def setup(client, run_id, battles, dead=("raphael",), manual=False):
    runs = client.app_state.store
    for key in ("raphael", "byleth"):
        runs.put_unit(run_id, key, Unit(name=key.title()))
    for b in battles:
        client.app_state.scanner._save_battle(b)
    for key in dead:
        runs.apply_units(run_id, {key: Unit(name=key.title(), death=Death(battle_id=battles[0].id, manual=manual))})
    client.published.clear()


def death(client, run_id, key="raphael"):
    return client.app_state.store.get(run_id).units[key].death


def resolve(client, run_id, keep, discard):
    r = client.post(f"/api/runs/{run_id}/battles/duplicates/resolve", json={"keep": keep, "discard": discard})
    assert r.status_code == 200


def test_discarding_the_copy_it_fell_in_links_to_the_kept_copy_that_has_the_fall(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id, ["raphael"]), copy("b2", run_id, ["raphael"])])
    resolve(client, run_id, "b2", ["b1"])
    d = death(client, run_id)
    assert (d.battle_id, d.turn, d.step, d.scenario) == ("b2", 2, 7, 0)
    assert d.battle_name == "Map 0"
    assert ("units_changed", {"run_id": run_id}) in client.published


def test_discarding_the_only_copy_with_the_fall_clears_the_link_but_stays_dead(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id, ["raphael"]), copy("b2", run_id)])
    resolve(client, run_id, "b2", ["b1"])
    d = death(client, run_id)
    assert d is not None
    assert (d.battle_id, d.battle_name, d.scenario, d.turn, d.step, d.t, d.by) == (None, "", None, None, None, None, None)


def test_restoring_the_copy_links_the_death_back(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id, ["raphael"]), copy("b2", run_id)])
    resolve(client, run_id, "b2", ["b1"])
    client.published.clear()
    assert client.post(f"/api/runs/{run_id}/battles/restore", json={"ids": ["b1"]}).status_code == 200
    d = death(client, run_id)
    assert (d.battle_id, d.step, d.turn) == ("b1", 7, 2)
    assert ("units_changed", {"run_id": run_id}) in client.published


def test_manual_death_stays_manual_through_discard_and_restore(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id, ["raphael"]), copy("b2", run_id)], manual=True)
    resolve(client, run_id, "b2", ["b1"])
    assert death(client, run_id).manual and death(client, run_id).battle_id is None
    client.post(f"/api/runs/{run_id}/battles/restore", json={"ids": ["b1"]})
    assert death(client, run_id).manual and death(client, run_id).battle_id == "b1"


def test_living_units_are_untouched_and_nothing_is_published(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id, ["byleth"]), copy("b2", run_id, ["byleth"])], dead=())
    resolve(client, run_id, "b2", ["b1"])
    assert all(u.death is None for u in client.app_state.store.get(run_id).units.values())
    assert not [e for e in client.published if e[0] == "units_changed"]


def test_a_death_linked_to_a_kept_battle_is_left_alone(client):
    run_id = a_run(client)
    setup(client, run_id, [copy("b1", run_id), copy("b2", run_id)])
    client.app_state.store.apply_units(run_id, {"raphael": Unit(name="Raphael", death=Death(battle_id="b2", turn=4))})
    client.published.clear()
    resolve(client, run_id, "b2", ["b1"])
    assert (death(client, run_id).battle_id, death(client, run_id).turn) == ("b2", 4)
    assert not [e for e in client.published if e[0] == "units_changed"]


def test_keep_best_relinks_the_death_of_the_discarded_copy(client):
    run_id = a_run(client, mode="keep_best")
    runs = client.app_state.store
    for key in ("raphael", "byleth"):
        runs.put_unit(run_id, key, Unit(name=key.title()))
    client.app_state.scanner._save_battle(copy("b1", run_id, ["raphael"], turn=9, now=2))
    runs.apply_units(run_id, {"raphael": Unit(name="Raphael", death=Death(battle_id="b1"))})
    client.published.clear()
    client.app_state.scanner._save_battle(copy("b2", run_id, [], turn=4, now=0))  # won: b1 is set aside
    assert [b.id for b in client.app_state.battles.discarded(run_id)] == ["b1"]
    d = death(client, run_id)
    assert d is not None and d.battle_id is None
    assert ("units_changed", {"run_id": run_id}) in client.published
