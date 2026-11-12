"""Duplicate battles: grouping and ranking, keep-best filing, and the resolve / restore endpoints."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.domain import duplicates
from app.domain.battle import Battle, LogEntry
from app.main import create_app

QUESTS = frozenset({95, 102})
T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)


def battle(bid, scenario=0, quest=None, run_id="run", turn=5, defeated=3, start=6, now=None, log=0):
    return Battle(
        id=bid, run_id=run_id, started_at=T0 + timedelta(hours=int(bid[1:])),
        ended_at=T0 + timedelta(hours=int(bid[1:]), minutes=30), scenario=scenario, quest=quest, turn=turn,
        enemies_defeated=defeated, enemies_start=start, enemies_now=start - defeated if now is None else now,
        map_name=f"Map {scenario}", log=[LogEntry(t=float(i), kind="wait", text="x") for i in range(log)],
    )


def ids(group):
    return [b.id for b in group.battles]


def test_five_copies_of_scenario_zero_form_one_group_newest_first():
    found = duplicates.groups([battle(f"b{i}") for i in range(5)], QUESTS)
    assert len(found) == 1 and (found[0].scenario, found[0].quest) == (0, None)
    assert ids(found[0]) == ["b4", "b3", "b2", "b1", "b0"]


def test_a_single_copy_is_not_a_group():
    assert duplicates.groups([battle("b1")], QUESTS) == []


def test_repeatable_scenario_is_never_grouped():
    assert duplicates.groups([battle("b1", scenario=82), battle("b2", scenario=82)], QUESTS) == []
    assert duplicates.groups([battle("b1", scenario=61), battle("b2", scenario=61)], QUESTS) == []


def test_quest_battle_is_grouped_apart_from_the_plain_repeatable_scenario():
    history = [battle("b1", scenario=61), battle("b2", scenario=61), battle("b3", scenario=61, quest=95),
               battle("b4", scenario=61, quest=95)]
    [group] = duplicates.groups(history, QUESTS)
    assert (group.scenario, group.quest, ids(group)) == (61, 95, ["b4", "b3"])


def test_a_quest_that_has_no_battle_is_ignored_for_identity():
    history = [battle("b1", scenario=61, quest=7), battle("b2", scenario=61, quest=8)]
    assert duplicates.groups(history, QUESTS) == []


def test_ignored_and_unknown_scenarios_are_skipped():
    history = [battle(f"b{i}", scenario=s) for i, s in enumerate([95, 95, 96, 96, 98, 98, 99, 99])]
    history += [battle("b9", scenario=None), battle("b10", scenario=None)]
    assert duplicates.groups(history, QUESTS) == []


def test_paralogue_and_dlc_battles_are_one_time():
    history = [battle("b1", scenario=40), battle("b2", scenario=40), battle("b3", scenario=88), battle("b4", scenario=88)]
    assert [g.scenario for g in duplicates.groups(history, QUESTS)] == [40, 88]


def test_ranking_prefers_won_then_defeated_then_turn_then_log_then_newest():
    lost = battle("b1", defeated=5, turn=9, log=9, now=1)
    won = battle("b2", defeated=2, turn=1, log=0, now=0)
    assert duplicates.best([lost, won]) is won
    assert duplicates.best([battle("b1", now=1, defeated=2), battle("b2", now=1, defeated=4)]).id == "b2"
    assert duplicates.best([battle("b1", now=1, turn=8), battle("b2", now=1, turn=3)]).id == "b1"
    assert duplicates.best([battle("b1", now=1, log=1), battle("b2", now=1, log=4)]).id == "b2"
    assert duplicates.best([battle("b1", now=1), battle("b2", now=1)]).id == "b2"


def test_won_needs_enemies_at_the_start_and_none_left():
    assert duplicates.won(battle("b1", start=4, defeated=4))
    assert not duplicates.won(battle("b1", start=0, defeated=0, now=0))
    assert not duplicates.won(battle("b1", start=4, defeated=1))


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as c:
        c.app_state = app.state
        c.published = []
        app.state.events.add_listener(lambda name, data: c.published.append((name, data)))
        yield c


def a_run(client):
    run_id = client.post("/api/runs", json={"name": "Run"}).json()["id"]
    client.app_state.settings.update(active_run_id=run_id)
    return run_id


def file_battle(client, finished):
    client.app_state.scanner._save_battle(finished)


def test_keep_best_files_the_best_copy_and_sets_the_rest_aside(client):
    run_id = a_run(client)
    store = client.app_state.battles
    file_battle(client, battle("b1", run_id=run_id, turn=9, now=2))
    assert not [e for e in client.published if e[0] == "duplicate_battles"]
    file_battle(client, battle("b2", run_id=run_id, turn=4, now=0))  # won beats a longer lost one
    assert [b.id for b in store.list(run_id)] == ["b2"]
    assert [b.id for b in store.discarded(run_id)] == ["b1"]
    assert ("battle", {"active": False, "history": True}) in client.published
    [(_, data)] = [e for e in client.published if e[0] == "duplicate_battles"]
    assert data == {"run_id": run_id, "name": "Map 0", "kept": "b2", "kept_turn": 4, "discarded": ["b1"]}


def test_keep_best_with_a_weaker_new_copy_discards_the_new_one(client):
    run_id = a_run(client)
    store = client.app_state.battles
    file_battle(client, battle("b1", run_id=run_id, turn=9, now=0))
    file_battle(client, battle("b2", run_id=run_id, turn=2, now=3))
    assert [b.id for b in store.list(run_id)] == ["b1"]
    assert [b.id for b in store.discarded(run_id)] == ["b2"]


def test_keep_best_leaves_repeatable_battles_alone(client):
    run_id = a_run(client)
    file_battle(client, battle("b1", run_id=run_id, scenario=82))
    file_battle(client, battle("b2", run_id=run_id, scenario=82))
    assert len(client.app_state.battles.list(run_id)) == 2
    assert not [e for e in client.published if e[0] == "duplicate_battles"]


def test_ask_mode_files_everything_and_does_nothing(client):
    run_id = a_run(client)
    client.put("/api/settings", json={"duplicate_battles": "ask"})
    file_battle(client, battle("b1", run_id=run_id))
    file_battle(client, battle("b2", run_id=run_id))
    assert [b.id for b in client.app_state.battles.list(run_id)] == ["b1", "b2"]
    assert client.app_state.battles.discarded(run_id) == []
    assert not [e for e in client.published if e[0] == "duplicate_battles"]
    [group] = client.get(f"/api/runs/{run_id}/battles/duplicates").json()["groups"]
    assert group["best"] == "b2"


def test_duplicates_endpoint_shape(client):
    run_id = a_run(client)
    client.put("/api/settings", json={"duplicate_battles": "ask"})
    for i in (1, 2):
        file_battle(client, battle(f"b{i}", run_id=run_id, scenario=3, turn=i, log=i))
    file_battle(client, battle("b3", run_id=run_id, scenario=1))
    groups = client.get(f"/api/runs/{run_id}/battles/duplicates").json()["groups"]
    assert len(groups) == 1
    group = groups[0]
    assert set(group) == {"scenario", "quest", "name", "best", "battles"}
    assert (group["scenario"], group["quest"], group["name"], group["best"]) == (3, None, "Map 3", "b2")
    assert [c["id"] for c in group["battles"]] == ["b2", "b1"]
    assert set(group["battles"][0]) == {"id", "started_at", "ended_at", "seconds", "turn", "enemies_defeated",
                                        "enemies_start", "log_len"}
    assert group["battles"][0]["turn"] == 2 and group["battles"][0]["log_len"] == 2
    assert client.get("/api/runs/nope/battles/duplicates").status_code == 404


def test_resolve_then_restore(client):
    run_id = a_run(client)
    client.put("/api/settings", json={"duplicate_battles": "ask"})
    for i in (1, 2, 3):
        file_battle(client, battle(f"b{i}", run_id=run_id))
    url = f"/api/runs/{run_id}/battles"
    client.published.clear()
    done = client.post(f"{url}/duplicates/resolve", json={"keep": "b3", "discard": ["b1", "b2"]})
    assert done.status_code == 200 and done.json() == {"groups": []}
    assert [b.id for b in client.app_state.battles.list(run_id)] == ["b3"]
    assert client.published == [("battle", {"active": False, "history": True})]
    back = client.post(f"{url}/restore", json={"ids": ["b1", "missing"]})
    assert back.status_code == 200
    assert [b.id for b in client.app_state.battles.list(run_id)] == ["b1", "b3"]
    assert [c["id"] for c in back.json()["groups"][0]["battles"]] == ["b3", "b1"]
    client.post(f"{url}/restore", json={"ids": ["b2"]})
    assert [b.id for b in client.app_state.battles.list(run_id)] == ["b1", "b2", "b3"]
    assert client.app_state.battles.discarded(run_id) == []


def test_resolve_and_restore_errors(client):
    run_id = a_run(client)
    client.put("/api/settings", json={"duplicate_battles": "ask"})
    for i in (1, 2):
        file_battle(client, battle(f"b{i}", run_id=run_id))
    url = f"/api/runs/{run_id}/battles"
    assert client.post("/api/runs/nope/battles/duplicates/resolve", json={"keep": "b1", "discard": []}).status_code == 404
    assert client.post("/api/runs/nope/battles/restore", json={"ids": []}).status_code == 404
    assert client.post(f"{url}/duplicates/resolve", json={"keep": "b1", "discard": ["b1"]}).status_code == 400
    assert client.post(f"{url}/duplicates/resolve", json={"keep": "b1", "discard": ["zzz"]}).status_code == 400
    assert client.post(f"{url}/duplicates/resolve", json={"keep": "zzz", "discard": ["b1"]}).status_code == 400
    assert client.post(f"{url}/duplicates/resolve", json={"keep": "b1"}).status_code == 422
    assert len(client.app_state.battles.list(run_id)) == 2


def test_deleting_a_run_removes_its_discarded_battles(client):
    run_id = a_run(client)
    file_battle(client, battle("b1", run_id=run_id))
    file_battle(client, battle("b2", run_id=run_id))
    side = client.app_state.battles._discarded_path(run_id)
    assert side.exists()
    client.app_state.battles.delete_run(run_id)
    assert not side.exists()


def test_duplicate_battles_setting_round_trips(client):
    assert client.get("/api/settings").json()["duplicate_battles"] == "keep_best"
    assert client.put("/api/settings", json={"duplicate_battles": "ask"}).json()["duplicate_battles"] == "ask"
    assert client.get("/api/settings").json()["duplicate_battles"] == "ask"
    assert client.put("/api/settings", json={"duplicate_battles": "maybe"}).status_code == 422
