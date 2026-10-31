import json
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.gamefiles.dump import GameDump
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
        assert status["available"] and status["job"]["state"] == "idle" and status["last_dump"] is None
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
    monkeypatch.setattr(importer.dump, "find", lambda _: GameDump(tmp_path))

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
        assert client.get("/api/game-assets/status").json()["last_dump"] == str(tmp_path)


def test_successful_import_swaps_and_emits_status(tmp_path, assets, monkeypatch):
    assets.root.mkdir()
    (assets.root / "old.txt").write_text("old")
    monkeypatch.setattr(importer.dump, "find", lambda _: GameDump(tmp_path))

    def extract(ctx):
        ctx.log("data:")
        ctx.out.json("data/example.json", {"ok": True}, source="test")
        return {"data": {"files": 1, "skipped": []}}

    monkeypatch.setattr(importer, "run", extract)
    monkeypatch.setattr(importer.verify, "check", lambda _: importer.verify.Report())
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
    monkeypatch.setattr(importer.dump, "find", lambda _: GameDump(tmp_path))
    monkeypatch.setattr(importer, "run", lambda ctx: {})
    verifying, finish_verify = threading.Event(), threading.Event()
    replacing, finish_replace = threading.Event(), threading.Event()

    def check(_):
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


def fake_base(folder, title=None):
    romfs = folder / title / "romfs" if title else folder / "romfs"
    (romfs / "patch0").mkdir(parents=True)
    (romfs / "nx").mkdir()
    (romfs / "DATA0.bin").write_bytes(b"0")
    (romfs / "DATA1.bin").write_bytes(b"0")
    return romfs


def test_candidates_find_each_location_and_ignore_junk(tmp_path, assets, monkeypatch):
    appdata, home = tmp_path / "appdata", tmp_path / "home"
    eden = fake_base(appdata / "eden" / "dump", importer.dump.BASE_TITLE)
    (appdata / "eden" / "dump" / "010055D009F79001" / "romfs").mkdir(parents=True)
    (appdata / "eden" / "dump" / "010055D009F79001" / "romfs" / "DATA0.bin").write_bytes(b"0")
    (appdata / "eden" / "dump" / "010055D009F79001" / "romfs" / "DATA1.bin").write_bytes(b"0")
    ryu = fake_base(appdata / "Ryujinx" / "mods" / "contents", importer.dump.BASE_TITLE)
    desk = fake_base(home / "Desktop" / "Fire Emblem Three Houses Dump")
    down = fake_base(home / "Downloads" / "fe3h")
    for junk in (appdata / "yuzu" / "dump" / "0100000000000000" / "romfs", home / "Documents" / "Taxes" / "x",
                 home / "Desktop" / "romfs-empty" / "romfs", appdata / "suyu" / "dump"):
        junk.mkdir(parents=True)
    (home / "Documents" / "Taxes" / "x" / "DATA0.bin").write_bytes(b"0")
    for i, romfs in enumerate((ryu, down, desk, eden)):
        os.utime(romfs, (1000 + i, 1000 + i))
    monkeypatch.setenv("APPDATA", str(appdata))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("HOME", str(home))
    with TestClient(create_app(tmp_path / "data", background=False)) as client:
        found = client.get("/api/game-assets/candidates").json()["candidates"]
        paths = [item["romfs"] for item in found]
        assert str(ryu) in paths and str(down) in paths and str(desk) in paths and str(eden) in paths
        assert not any("yuzu" in p or "Taxes" in p or "romfs-empty" in p or "suyu" in p for p in paths)
        assert paths == sorted(paths, key=lambda p: -os.stat(p).st_mtime)
        assert next(i for i in found if i["romfs"] == str(eden))["dlc"] == ["cindered_shadows"]
        assert all(set(i) >= {"path", "version", "dlc", "exefs", "supported"} for i in found)


def test_candidates_last_dump_and_parent_and_dedupe(tmp_path):
    parent = tmp_path / "dumps"
    mine = fake_base(parent / "mine")
    found = importer.candidates(str(parent / "mine"), env={})
    assert [item["romfs"] for item in found] == [str(mine)]
    found = importer.candidates(str(mine), env={})
    assert [item["romfs"] for item in found] == [str(mine)]
    assert importer.candidates(str(tmp_path / "missing"), env={}) == []
