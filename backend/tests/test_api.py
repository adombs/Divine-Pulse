import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.main import create_app

STATS = dict(hp=30, mv=4, str=10, mag=5, dex=8, spd=9, lck=6, **{"def": 7}, res=3, cha=4)


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as c:
        c.app_state = app.state
        yield c


def make_run(client, name="Golden Wildfire"):
    r = client.post("/api/runs", json={"name": name})
    assert r.status_code == 200
    return r.json()["id"]


def test_run_lifecycle(client):
    run_id = make_run(client)
    assert run_id == "golden-wildfire"
    runs = client.get("/api/runs").json()
    assert runs["active_run_id"] == run_id  # first run becomes active
    assert client.post("/api/runs", json={"name": " golden  WILDFIRE "}).status_code == 409  # same name
    second = make_run(client, "Golden Wildfire+")
    assert second == "golden-wildfire-2"
    client.patch(f"/api/runs/{second}", json={"name": "Azure Moon"})
    client.post(f"/api/runs/{second}/activate")
    assert client.get("/api/runs").json()["active_run_id"] == second
    client.delete(f"/api/runs/{second}")
    runs = client.get("/api/runs").json()
    assert [r["id"] for r in runs["runs"]] == [run_id]
    assert runs["active_run_id"] == run_id


def test_run_names_are_validated(client):
    assert client.post("/api/runs", json={"name": "  "}).status_code == 422
    assert client.post("/api/runs", json={"name": "x" * 61}).status_code == 422
    run_id = make_run(client, "Azure Moon")
    other = make_run(client, "Silver Snow")
    r = client.patch(f"/api/runs/{other}", json={"name": "azure moon"})
    assert r.status_code == 409 and "Azure Moon" in r.json()["detail"]
    assert client.patch(f"/api/runs/{run_id}", json={"name": "Azure  Moon"}).status_code == 200  # its own name
    assert client.get("/api/runs/../settings/units").status_code == 404


def test_run_and_battle_export_import_round_trip(client):
    from datetime import datetime, timezone
    from app.domain.battle import Battle

    source_id = make_run(client, "Azure Moon")
    client.app_state.battles.add(Battle(id="battle-one", run_id=source_id, started_at=datetime(2026, 10, 14, tzinfo=timezone.utc)))
    exported = client.get(f"/api/runs/{source_id}/export").json()
    assert exported["format"] == "divine-pulse-run" and exported["version"] == 1
    assert len(exported["battles"]) == 1
    imported = client.post("/api/runs/import", json=exported)
    assert imported.status_code == 200
    new_id = imported.json()["id"]
    assert new_id != source_id and imported.json()["name"] == "Azure Moon (imported)"
    assert client.get(f"/api/runs/{new_id}/battles").json()[0]["id"] != "battle-one"
    # Files with the former format name are rejected.
    assert client.post("/api/runs/import", json={**exported, "format": "fe3h-tracker-run"}).status_code == 422

    battle_file = client.get(f"/api/runs/{source_id}/battles/export").json()
    assert battle_file["format"] == "divine-pulse-battles"
    assert client.post(f"/api/runs/{new_id}/battles/import", json=battle_file).json() == {"added": 0}
    assert client.post(f"/api/runs/{source_id}/battles/import", json=battle_file).json() == {"added": 0}


def test_run_and_battle_import_reject_invalid_files(client):
    assert client.post("/api/runs/import", json={"format": "bad", "version": 1}).status_code == 422
    run_id = make_run(client)
    assert client.post(f"/api/runs/{run_id}/battles/import", json={"format": "fe3h-tracker-battles", "version": 1, "battles": [{"bad": True}]}).status_code == 422


def test_battalion_identity_and_battle_assignment_survive_public_updates_and_exports(client):
    from datetime import datetime, timezone
    from app.domain.battle import Battle, BattleUnitStats
    from app.domain.units import Unit

    run_id = make_run(client, "Assignment test")
    client.app_state.store.put_unit(run_id, "aster", Unit(name="Aster", battalion="Current company", battalion_id=0))
    response = client.put(f"/api/runs/{run_id}/units/aster/portrait", json={"gender": "female"})
    assert response.status_code == 200
    assert response.json()["battalion_id"] == 0
    recorded = BattleUnitStats(key="aster", name="Aster", start_level=10, level=10, start=STATS, now=STATS,
                               battalion="Earlier company", battalion_id=3)
    # A pre-feature recording has no assignment; absence must remain unknown after migration.
    older = BattleUnitStats(key="bram", name="Bram", start_level=10, level=10, start=STATS, now=STATS)
    client.app_state.battles.add(Battle(id="assignment-battle", run_id=run_id,
                                     started_at=datetime(2026, 10, 14, tzinfo=timezone.utc), units=[recorded, older]))
    exported = client.get(f"/api/runs/{run_id}/export").json()
    imported = client.post("/api/runs/import", json=exported)
    assert imported.status_code == 200
    new_id = imported.json()["id"]
    [unit] = client.get(f"/api/runs/{new_id}/units").json()
    assert (unit["battalion"], unit["battalion_id"]) == ("Current company", 0)
    [battle] = client.get(f"/api/runs/{new_id}/battles").json()
    historical, unknown = battle["units"]
    assert (historical["battalion"], historical["battalion_id"]) == ("Earlier company", 3)
    assert unknown["battalion"] is None and unknown["battalion_id"] is None


def test_undo_with_nothing_to_undo(client):
    assert client.post("/api/scan/undo").json() is None
    assert client.get("/api/scans").json() == []


def test_portrait_gender_setting(client):
    from app.domain.units import Unit

    run_id = client.post("/api/runs", json={"name": "Run"}).json()["id"]
    client.app_state.store.put_unit(run_id, "byleth", Unit(name="Byleth", source="memory"))
    assert client.get(f"/api/runs/{run_id}/units").json()[0]["portrait_gender"] == "auto"
    r = client.put(f"/api/runs/{run_id}/units/byleth/portrait", json={"gender": "female"})
    assert r.status_code == 200 and r.json()["portrait_gender"] == "female"
    assert client.put(f"/api/runs/{run_id}/units/byleth/portrait", json={"gender": "other"}).status_code == 422
    assert client.put(f"/api/runs/{run_id}/units/nobody/portrait", json={"gender": "male"}).status_code == 404


def test_settings_are_validated(client):
    body = {"auto_interval_s": client.get("/api/settings").json()["auto_interval_s"]}

    def put(**changes):
        return client.put("/api/settings", json={**body, **changes})

    assert put().status_code == 200
    assert put(auto_interval_s=0.05).status_code == 422
    assert put(colour="red").status_code == 422


def test_battle_switches_and_memory_check(client, monkeypatch):
    from app.gamemem import fe3h

    settings = client.get("/api/settings").json()
    body = {"auto_interval_s": settings["auto_interval_s"]}
    assert settings["battle_filter_auto"] is True
    assert client.put("/api/settings", json={**body, "battle_filter_auto": False}).json()["battle_filter_auto"] is False
    assert settings["battle_page_auto"] is True
    assert client.put("/api/settings", json={**body, "battle_page_auto": False}).json()["battle_page_auto"] is False
    assert settings["battle_alerts"] is True
    assert client.put("/api/settings", json={**body, "battle_alerts": False}).json()["battle_alerts"] is False
    assert settings["record_battles"] is True
    assert client.put("/api/settings", json={**body, "record_battles": False}).json()["record_battles"] is False

    monkeypatch.setattr(fe3h, "running", lambda emulators: [])
    assert client.get("/api/memory/check").json() == {"ok": False, "message": "Eden isn't running."}


def test_battle_endpoints(client):
    from datetime import datetime, timezone

    from app.battle import Battle, BattleUnitStats

    run_id = make_run(client)
    assert client.get("/api/battle").json() == {"battle": None}
    stats = dict(STATS)
    unit = BattleUnitStats(key="felix", name="Felix", start_level=10, level=11, start=stats, now={**stats, "str": 11})
    client.app_state.battles.add(Battle(id="b1", run_id=run_id, started_at=datetime(2026, 10, 14, tzinfo=timezone.utc), ended_at=datetime(2026, 10, 14, 0, 10, tzinfo=timezone.utc), units=[unit]))
    [b] = client.get(f"/api/runs/{run_id}/battles").json()
    assert (b["id"], b["seconds"], b["level_ups"], b["stat_points"], b["active"]) == ("b1", 600, 1, 1, False)
    assert b["units"][0]["gains"] == {"str": 1}
    assert client.delete(f"/api/runs/{run_id}/battles/b1").status_code == 200
    assert client.get(f"/api/runs/{run_id}/battles").json() == []
    assert client.delete(f"/api/runs/{run_id}/battles/b1").status_code == 404


def test_deleting_a_run_deletes_its_battles(client):
    from datetime import datetime, timezone

    from app.battle import Battle

    run_id = make_run(client)
    client.app_state.battles.add(Battle(id="b1", run_id=run_id, started_at=datetime(2026, 10, 14, tzinfo=timezone.utc)))
    assert client.delete(f"/api/runs/{run_id}").status_code == 200
    assert make_run(client) == run_id  # same name, same ID
    assert client.get(f"/api/runs/{run_id}/battles").json() == []


def test_the_app_shares_the_launchers_settings(tmp_path):
    from app.config import SettingsStore
    from app.main import create_app

    store = SettingsStore(tmp_path / "settings.json")
    app = create_app(tmp_path, background=False, settings=store)
    assert app.state.settings is store
    app.state.settings.update(auto_interval_s=2.0)
    store.update(window={"x": 1, "y": 2, "width": 900, "height": 700, "maximized": False})  # the window saving its position on quit
    assert SettingsStore(tmp_path / "settings.json").get().auto_interval_s == 2.0


def test_battle_settings_roundtrip(client):
    current = client.get("/api/settings").json()
    assert (current["battle_interval_s"], current["battle_estimate_fights"], current["pairing_check"], current["hide_history"]) == (0.1, True, False, False)
    body = {"auto_interval_s": current["auto_interval_s"]}
    r = client.put("/api/settings", json={**body, "battle_interval_s": 0.2, "battle_estimate_fights": False, "pairing_check": True})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert (saved["battle_interval_s"], saved["battle_estimate_fights"], saved["pairing_check"], saved["hide_history"]) == (0.2, False, True, False)
    assert client.put("/api/settings", json={**body, "battle_interval_s": 0.05}).status_code == 422


def test_window_mode_is_saved_and_applied_to_the_desktop_window(client):
    body = {"auto_interval_s": client.get("/api/settings").json()["auto_interval_s"]}
    assert client.get("/api/settings").json()["window_mode"] == "windowed"
    # Browser mode: no window to switch, the setting is just saved.
    assert client.get("/api/about").json()["desktop"] is False
    assert client.put("/api/settings", json={**body, "window_mode": "fullscreen"}).json()["window_mode"] == "fullscreen"
    assert client.put("/api/settings", json={**body, "window_mode": "exclusive"}).status_code == 422

    modes = []
    client.app_state.show_window = lambda: None
    client.app_state.set_window_mode = modes.append
    assert client.get("/api/about").json()["desktop"] is True
    client.put("/api/settings", json={**body, "window_mode": "windowed"})
    client.put("/api/settings", json={**body, "window_mode": "fullscreen"})
    assert modes == ["windowed", "fullscreen"]


def test_about_says_where_the_data_lives(client, tmp_path):
    about = client.get("/api/about").json()
    assert about == {"version": __version__, "data_dir": str(tmp_path), "desktop": False}
