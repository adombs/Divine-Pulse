import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.domain.units import Unit

# On-screen values; Mag carries a +2 ability bonus (base 21).
SHOWN = dict(hp=32, mv=4, str=4, mag=23, dex=15, spd=13, lck=8, **{"def": 4}, res=11, cha=9)


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as c:
        c.app_state = app.state
        yield c


@pytest.fixture
def unit(client):
    run_id = client.post("/api/runs", json={"name": "Run"}).json()["id"]
    client.app_state.store.put_unit(run_id, "lysithea", Unit(name="Lysithea", displayed=SHOWN, manual_bonuses={"mag": 2}, source="memory"))
    return run_id, "lysithea"


def get(client, run_id):
    return client.get(f"/api/runs/{run_id}/units").json()[0]


def put(client, unit, **body):
    run_id, key = unit
    return client.put(f"/api/runs/{run_id}/units/{key}/ebst", json=body)


# Through the API


def test_new_units_default_to_auto_with_hp_and_spd(client, unit):
    u = get(client, unit[0])
    assert u["ebst_effective"] == {"offense": "auto", "defense": "auto", "stats": ["hp", "spd"]}


def test_setting_types_and_toggles_keeps_other_fields(client, unit):
    u = put(client, unit, offense="magical").json()
    u = put(client, unit, defense="flex").json()
    assert u["ebst_effective"]["offense"] == "magical" and u["ebst_effective"]["defense"] == "flex"
    u = put(client, unit, stats=["spd", "dex", "spd"]).json()
    assert u["ebst_effective"] == {"offense": "magical", "defense": "flex", "stats": ["dex", "spd"]}
    assert put(client, unit, stats=["str"]).status_code == 422  # Str/Mag/Def/Res are the types' job
    assert put(client, unit, offense="ranged").status_code == 422
    assert put(client, unit).status_code == 422


def test_apply_ebst_overwrites_custom_units_and_persists_default(client, unit):
    from app.storage import RunStore

    run_id, key = unit
    store = client.app_state.store
    put(client, unit, offense="physical", defense="magical", stats=["cha"])
    store.put_unit(run_id, "hilda", Unit(name="Hilda", displayed=SHOWN))
    config = {"offense": "magical", "defense": "flex", "stats": ["mv", "dex", "lck"]}
    response = client.put(f"/api/runs/{run_id}/ebst", json=config)
    assert response.status_code == 200 and response.json() == config
    assert all(u["ebst_effective"] == config for u in client.get(f"/api/runs/{run_id}/units").json())
    assert client.get(f"/api/runs/{run_id}/ebst").json() == config

    # The default and overwritten settings survive a new store (no cache).
    reloaded = RunStore(store.dir)
    assert reloaded.get(run_id).ebst_default.model_dump() == config
    assert all(u.ebst_config().model_dump() == config for u in reloaded.get(run_id).units.values())
    reloaded.put_unit(run_id, "leonie", Unit(name="Leonie"))
    assert reloaded.get(run_id).units["leonie"].ebst_config().model_dump() == config

    # A later individual edit stays individual, including through future scans.
    edited = put(client, unit, offense="physical", stats=[])
    assert edited.status_code == 200
    assert edited.json()["ebst_effective"] == {**config, "offense": "physical", "stats": []}
    assert client.get(f"/api/runs/{run_id}/ebst").json() == config
    scanned = store.get(run_id).units[key]
    scanned.class_name = "Mage"
    store.put_unit(run_id, key, scanned)
    assert get(client, run_id)["ebst_effective"] == {**config, "offense": "physical", "stats": []}


def test_future_scanned_unit_inherits_run_default(client, unit):
    from app.bonuses import BonusTable
    from app.handlers import apply_unit_stats
    from app.domain.readings import UnitStatsReading

    run_id, _ = unit
    config = {"offense": "flex", "defense": "physical", "stats": []}
    client.put(f"/api/runs/{run_id}/ebst", json=config)
    reading = UnitStatsReading(screen="memory", name_candidates=["Leonie"], values=SHOWN)
    result = apply_unit_stats(reading, client.app_state.store.get(run_id), BonusTable({}, {}))
    assert result.is_new
    assert result.changes[0].after.ebst_config().model_dump() == config


def test_apply_run_ebst_validation_and_run_isolation(client, unit):
    run_id, _ = unit
    other = client.post("/api/runs", json={"name": "Other"}).json()["id"]
    store = client.app_state.store
    store.put_unit(other, "claude", Unit(name="Claude"))
    before = store.get(other)
    assert client.put(f"/api/runs/{run_id}/ebst", json={"offense": "ranged"}).status_code == 422
    assert client.put(f"/api/runs/{run_id}/ebst", json={"stats": ["str"]}).status_code == 422
    assert client.put(f"/api/runs/{run_id}/ebst", json={}).status_code == 422
    assert client.put("/api/runs/missing/ebst", json={"stats": []}).status_code == 404
    assert client.get("/api/runs/missing/ebst").status_code == 404
    assert client.put(f"/api/runs/{run_id}/ebst", json={"offense": "flex", "stats": []}).status_code == 200
    assert store.get(other) == before
