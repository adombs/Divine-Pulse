import json
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

from helpers.fake_import import fake_dump
from app.infrastructure import game_assets as assets_module
from app.infrastructure import game_assets_import as importer
from app.main import create_app


@pytest.fixture
def assets(tmp_path, monkeypatch):
    assets = assets_module.GameAssets(tmp_path / "assets")
    monkeypatch.setattr(assets_module, "_shared", assets)
    return assets


def wait_job(client):
    for _ in range(1000):
        job = client.get("/api/game-assets/status").json()["job"]
        if job["state"] != "running":
            return job
        time.sleep(0.01)
    pytest.fail("import did not finish")


def test_routes_and_manifest_allowlist(tmp_path, assets):
    assets.root.mkdir()
    (assets.root / "file.json").write_text("{}", encoding="utf-8")
    (assets.root / "secret.txt").write_text("secret", encoding="utf-8")
    (assets.root / "manifest.json").write_text(json.dumps({"files": {"file.json": {"sha256": "abc"}}}))
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        status = client.get("/api/game-assets/status").json()
        assert status["available"] and status["job"]["state"] == "idle" and "last_dump" not in status
        response = client.get("/game-assets/file.json")
        assert response.status_code == 200
        assert response.headers["etag"] == '"abc"' and response.headers["cache-control"] == "no-cache"
        assert client.get("/game-assets/secret.txt").status_code == 404
        assert client.get("/game-assets/%2e%2e/secret.txt").status_code == 404
        assert client.post("/api/game-assets/scan", json={"dump": str(tmp_path / "missing")}).status_code == 400
        assert client.post("/api/game-assets/pick-folder").status_code == 501
        client.app.state.pick_game_dump = lambda: None
        assert client.post("/api/game-assets/pick-folder").json() == {"path": None}
        assert set(client.post("/api/game-assets/verify").json()) == {"ok", "checked", "errors", "warnings"}
        assert client.delete("/api/game-assets").status_code == 200
        assert not client.get("/api/game-assets/status").json()["available"]


def test_running_conflicts_and_failed_import_preserves_old(tmp_path, assets, monkeypatch):
    assets.root.mkdir()
    (assets.root / "old.txt").write_text("old")
    (assets.root / "manifest.json").write_text(json.dumps({"files": {}}))
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setattr(importer.dump, "find", lambda _: fake_dump(tmp_path))

    def failing(ctx):
        entered.set()
        assert release.wait(10)
        raise ValueError("extract failed")

    monkeypatch.setattr(importer, "run", failing)
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        response = client.post("/api/game-assets/import", json={"dump": str(tmp_path)})
        assert response.status_code == 202
        assert entered.wait(5)
        assert client.post("/api/game-assets/import", json={"dump": str(tmp_path)}).status_code == 409
        assert client.delete("/api/game-assets").status_code == 409
        release.set()
        job = wait_job(client)
        assert job["state"] == "failed" and job["error"] == "extract failed"
        assert (assets.root / "old.txt").read_text() == "old"
        assert "last_dump" not in client.get("/api/game-assets/status").json()
        assert client.get("/api/game-assets/candidates").status_code == 404


def test_successful_import_swaps_and_emits_status(tmp_path, assets, monkeypatch):
    assets.root.mkdir()
    (assets.root / "old.txt").write_text("old")
    monkeypatch.setattr(importer.dump, "find", lambda _: fake_dump(tmp_path))

    def extract(ctx):
        ctx.log("data:")
        ctx.out.json("data/example.json", {"ok": True}, source="test")
        return {"data": {"files": 1, "skipped": []}}

    monkeypatch.setattr(importer, "run", extract)
    monkeypatch.setattr(importer.verify, "check", lambda _, **kwargs: importer.verify.Report())
    app = create_app(tmp_path / "data", background=False)
    events = []
    finished = threading.Event()

    def listener(name, data):
        events.append((name, data))
        if name == "game_assets" and data["job"]["state"] == "done":
            finished.set()

    app.state.events.add_listener(listener)
    with TestClient(app) as client:
        assert client.post("/api/game-assets/import", json={"dump": str(tmp_path)}).status_code == 202
        assert wait_job(client)["state"] == "done"
        assert client.get("/game-assets/data/example.json").json() == {"ok": True}
        assert not (assets.root / "old.txt").exists()
        assert finished.wait(5)
        assert any(name == "game_assets" and data["job"]["state"] == "done" for name, data in events)


@pytest.mark.parametrize("fail_replacement", [False, True])
def test_progress_waits_for_verification_and_replacement(tmp_path, assets, monkeypatch, fail_replacement):
    monkeypatch.setattr(importer.dump, "find", lambda _: fake_dump(tmp_path))
    monkeypatch.setattr(importer, "run", lambda ctx: {})
    verifying, finish_verify = threading.Event(), threading.Event()
    replacing, finish_replace = threading.Event(), threading.Event()

    def check(_, **kwargs):
        verifying.set()
        assert finish_verify.wait(10)
        return importer.verify.Report()

    rename = type(assets.root).rename

    def replace(path, target):
        if path.name.endswith(".importing"):
            replacing.set()
            assert finish_replace.wait(10)
            if fail_replacement:
                raise OSError("replacement failed")
        return rename(path, target)

    monkeypatch.setattr(importer.verify, "check", check)
    monkeypatch.setattr(type(assets.root), "rename", replace)
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        assert client.post("/api/game-assets/import", json={"dump": str(tmp_path)}).status_code == 202
        try:
            assert verifying.wait(5)
            job = client.get("/api/game-assets/status").json()["job"]
            assert job["state"] == "running" and job["phase"] == "verify" and job["done"] < job["total"]
            finish_verify.set()
            assert replacing.wait(5)
            job = client.get("/api/game-assets/status").json()["job"]
            assert job["state"] == "running" and job["done"] < job["total"]
        finally:
            finish_verify.set()
            finish_replace.set()
        job = wait_job(client)
        if fail_replacement:
            assert job["state"] == "failed" and job["error"] == "replacement failed"
            assert job["done"] < job["total"]
        else:
            assert job["state"] == "done" and job["done"] == job["total"]


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="real game dump not supplied")
def test_real_import(tmp_path, assets):
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        assert client.post("/api/game-assets/import", json={"dump": os.environ["DIVINE_PULSE_GAME_DUMP"]}).status_code == 202
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            status = client.get("/api/game-assets/status").json()
            if status["job"]["state"] != "running":
                assert status["job"]["state"] == "done", status["job"]
                assert status["available"]
                return
            time.sleep(0.2)
        pytest.fail("real import timed out")


def test_nsp_import_success_and_picker_routes(tmp_path, assets, monkeypatch):
    from app.infrastructure import nsp_extractor, paths

    tool = tmp_path / "vendor" / "nstool" / "nstool.exe"
    tool.parent.mkdir(parents=True)
    tool.touch()
    monkeypatch.setattr(paths, "FROZEN", False)
    monkeypatch.setattr(paths, "PROJECT_ROOT", tmp_path)
    packages = [tmp_path / "base.nsp", tmp_path / "update.nsp"]
    keys = tmp_path / "prod.keys"
    for file in [*packages, keys]:
        file.touch()
    extraction = []

    def extract(inputs, executable, key_path, output, *, cancelled):
        extraction.append(output)
        assert inputs == packages and executable == tool and key_path == keys
        assert not cancelled.is_set()

    monkeypatch.setattr(nsp_extractor, "extract_nsps", extract)
    monkeypatch.setattr(importer.dump, "find", lambda _: fake_dump(tmp_path))
    monkeypatch.setattr(importer, "run", lambda ctx: {})
    monkeypatch.setattr(importer.verify, "check", lambda _, **kwargs: importer.verify.Report())
    app = create_app(tmp_path / "data", background=False)
    with TestClient(app) as client:
        assert client.post("/api/game-assets/pick-nsps").status_code == 501
        app.state.pick_game_nsps = lambda: list(map(str, packages))
        app.state.pick_game_keys = lambda: str(keys)
        assert client.post("/api/game-assets/pick-nsps").json()["paths"] == list(map(str, packages))
        assert client.post("/api/game-assets/pick-keys").json()["path"] == str(keys)
        response = client.post("/api/game-assets/import-nsps", json={"nsps": list(map(str, packages)), "keys": str(keys)})
        assert response.status_code == 202
        assert wait_job(client)["state"] == "done"
    assert extraction and not extraction[0].exists()


def test_nsp_extraction_failure_preserves_existing_assets(tmp_path, assets, monkeypatch):
    from app.infrastructure import nsp_extractor, paths

    assets.root.mkdir()
    (assets.root / "old.txt").write_text("old")
    tool = tmp_path / "vendor" / "nstool" / "nstool.exe"
    tool.parent.mkdir(parents=True)
    tool.touch()
    monkeypatch.setattr(paths, "FROZEN", False)
    monkeypatch.setattr(paths, "PROJECT_ROOT", tmp_path)
    package, keys = tmp_path / "base.nsp", tmp_path / "prod.keys"
    package.touch()
    keys.touch()
    def fail(*args, **kwargs):
        raise ValueError("bad keys")
    monkeypatch.setattr(nsp_extractor, "extract_nsps", fail)
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        assert client.post("/api/game-assets/import-nsps", json={"nsps": [str(package)], "keys": str(keys)}).status_code == 202
        job = wait_job(client)
        assert job["state"] == "failed" and job["error"] == "bad keys"
        assert client.post("/api/game-assets/import-nsps", json={"nsps": ["missing.nsp"], "keys": str(keys)}).status_code == 400
    assert (assets.root / "old.txt").read_text() == "old"
