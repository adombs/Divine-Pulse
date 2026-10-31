import asyncio
import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from starlette.requests import Request

from app.interface.api import events as events_endpoint
from app.domain.battle import Battle, BattleUnitStats
from app.domain.units import Unit
from app.gamemem.units import SCREEN_TITLE as MEMORY_TITLE
from app.infrastructure.events import EventBus
from app.main import create_app


def test_run_endpoints_keep_statuses_and_event_side_effects(tmp_path):
    with TestClient(create_app(tmp_path, background=False)) as client:
        assert client.get("/api/runs").json() == {"runs": [], "active_run_id": None}

        assert client.post("/api/runs", json={"name": "   "}).status_code == 422
        created = client.post("/api/runs", json={"name": "Azure Moon"})
        assert created.status_code == 200
        run_id = created.json()["id"]
        assert run_id == "azure-moon"
        assert client.post("/api/runs", json={"name": "azure moon"}).status_code == 409
        assert client.get("/api/runs").json()["runs"][0]["name"] == "Azure Moon"

        assert client.put("/api/runs/missing/ebst", json={"offense": "physical"}).status_code == 404
        assert client.delete(f"/api/runs/{run_id}/units/nobody").status_code == 404
        assert client.get("/api/settings").status_code == 200
        assert client.get("/api/battle").json() == {"battle": None}


def test_settings_validation_and_desktop_browser_response_contract(tmp_path):
    with TestClient(create_app(tmp_path, background=False)) as client:
        settings = client.get("/api/settings").json()
        body = {"auto_interval_s": settings["auto_interval_s"]}
        assert client.put("/api/settings", json={**body, "auto_interval_s": 0.05}).status_code == 422
        assert (
            client.put("/api/settings", json={**body, "window_mode": "fullscreen"}).json()["window_mode"]
            == "fullscreen"
        )
        assert client.post("/api/window/show").status_code == 404

        about = client.get("/api/about").json()
        assert about["desktop"] is False
        assert about["data_dir"] == str(tmp_path)
        assert client.get("/api/health").json()["app"] == "divine-pulse"


def test_run_response_schemas_and_per_request_window_view(tmp_path):
    app = create_app(tmp_path, background=False)
    schemas = app.openapi()["paths"]
    assert schemas["/api/runs"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RunSummary"
    )
    with TestClient(app) as client:
        original = app.state.runtime.operations.window
        modes = []
        app.state.set_window_mode = modes.append
        assert client.get("/api/about").json()["desktop"] is False
        settings = client.get("/api/settings").json()
        client.put("/api/settings", json={"auto_interval_s": settings["auto_interval_s"], "window_mode": "fullscreen"})
        assert modes == ["fullscreen"]
        assert app.state.runtime.operations.window is original


def test_run_response_values_match_the_wire_contract(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        created = client.post("/api/runs", json={"name": "Azure Moon"}).json()
        assert {"id", "name", "unit_count", "route", "created_at", "updated_at"} <= created.keys()
        assert created["route"] is None
        assert created["unit_count"] == 0
        fetched = client.get("/api/runs").json()["runs"][0]
        assert fetched["id"] == created["id"]
        assert fetched["name"] == created["name"]
        assert fetched["unit_count"] == created["unit_count"]
        assert fetched["route"] == created["route"]
        assert fetched["created_at"] == created["created_at"]
        assert fetched["updated_at"] >= created["updated_at"]


def test_unit_response_loads_legacy_saved_fields_and_emits_current_defaults(tmp_path):
    with TestClient(create_app(tmp_path, background=False)) as client:
        created = client.post("/api/runs", json={"name": "Azure Moon"}).json()
        run_id = created["id"]
        old_save = {
            "schema_version": 1,
            "id": run_id,
            "name": created["name"],
            "created_at": created["created_at"],
            "updated_at": created["updated_at"],
            "units": {"byleth": {"name": "Byleth"}},
        }

    (tmp_path / "runs" / f"{run_id}.json").write_text(json.dumps(old_save), encoding="utf-8")
    with TestClient(create_app(tmp_path, background=False)) as client:
        [unit] = client.get(f"/api/runs/{run_id}/units").json()
        assert unit["key"] == "byleth"
        assert unit["source"] == "manual"
        assert unit["portrait_gender"] == "auto"
        assert unit["ebst_effective"] == {"offense": "auto", "defense": "auto", "stats": ["hp", "spd"]}
        assert unit["combat_arts"] == []
        assert unit["skills"] == {}
        assert unit["base_values"] == {
            key: 0 for key in ("hp", "mv", "str", "mag", "dex", "spd", "lck", "def", "res", "cha")
        }


def test_settings_response_values_match_the_frontend_fields(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        run_id = client.post("/api/runs", json={"name": "Azure Moon"}).json()["id"]
        settings = client.get("/api/settings").json()
        assert {
            "battle_filter_auto",
            "battle_page_auto",
            "battle_alerts",
            "record_battles",
            "battle_interval_s",
            "battle_estimate_fights",
            "pairing_check",
            "hide_history",
            "auto_interval_s",
            "active_run_id",
            "port",
            "window_mode",
        } <= settings.keys()
        assert settings["window_mode"] in {"windowed", "fullscreen"}
        assert settings["active_run_id"] == run_id


def test_battle_response_values_include_derived_and_optional_legacy_fields(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        run_id = client.post("/api/runs", json={"name": "Azure Moon"}).json()["id"]
        old_battle = Battle(
            id="battle-1",
            run_id=run_id,
            started_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
            ended_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
            units=[
                BattleUnitStats(
                    key="byleth",
                    name="Byleth",
                    start_level=1,
                    level=2,
                    start={"hp": 20, "str": 5},
                    now={"hp": 22, "str": 6},
                )
            ],
        )
        app.state.battles.add(old_battle)
        current = client.get(f"/api/runs/{run_id}/battles").json()[0]
        assert current["active"] is False
        assert current["route"] is None
        assert current["seconds"] == 0
        assert current["level_ups"] == 1
        assert current["stat_points"] == 3
        assert current["units"][0]["level_ups"] == 1
        assert current["units"][0]["gains"] == {"hp": 2, "str": 1}
        assert current["units"][0]["female"] is False
        assert current["units"][0]["usage"] is None
        assert current["outlook"] is None


def test_event_publishers_and_sse_wire_message_keep_names_and_payloads(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        published = []
        app.state.events.add_listener(lambda name, data: published.append((name, data)))
        run_id = client.post("/api/runs", json={"name": "Golden Deer"}).json()["id"]
        assert published == [("runs_changed", None)]

        client.post(f"/api/runs/{run_id}/activate")
        assert published[-2:] == [
            ("runs_changed", None),
            ("battle", {"active": False}),
        ]

        app.state.store.put_unit(run_id, "byleth", Unit(name="Byleth"))
        client.put(f"/api/runs/{run_id}/units/byleth/portrait", json={"gender": "female"})
        assert published[-1] == ("units_changed", {"run_id": run_id})

        app.state.battles.add(
            Battle(
                id="battle-1",
                run_id=run_id,
                started_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
                ended_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
            )
        )
        client.delete(f"/api/runs/{run_id}/battles/battle-1")
        assert published[-1] == ("battle", {"active": False, "history": True})

        scanner = app.state.scanner
        scan = scanner._record("ok", "Roster read", run_id=run_id, screen="Roster")
        assert published[-1] == ("scan", scan.model_dump(mode="json"))
        scanner._publish_status("watching", MEMORY_TITLE, "Byleth", force=True)
        assert published[-1] == (
            "auto",
            {
                "interval_s": 1.0,
                "battle": [],
                "state": "watching",
                "screen": MEMORY_TITLE,
                "seeing": "Byleth",
                "message": "",
            },
        )

        async def hello_event():
            request = Request({"type": "http", "app": app, "method": "GET", "path": "/api/events", "headers": []})
            response = await events_endpoint(request)
            first = await anext(response.body_iterator)
            await response.body_iterator.aclose()
            return response, first

        response, hello = asyncio.run(hello_event())
        assert response.media_type == "text/event-stream"
        assert response.headers["cache-control"] == "no-cache"
        assert hello == 'event: hello\ndata: {"notices": []}\n\n'

    async def sse_message():
        bus = EventBus()
        bus.bind(asyncio.get_running_loop())
        queue = bus.subscribe()
        bus.publish("units_changed", {"run_id": "golden-deer", "unit_key": None})
        message = await queue.get()
        bus.unsubscribe(queue)
        return message

    message = asyncio.run(sse_message())
    event, data = message.splitlines()[:2]
    assert event == "event: units_changed"
    assert json.loads(data.removeprefix("data: ")) == {"run_id": "golden-deer", "unit_key": None}
