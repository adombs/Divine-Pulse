"""App NSP import and retention through the HTTP API with synthetic file inputs."""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.infrastructure.game_assets import GameAssets

from app.infrastructure import game_assets_import as importer
from app.infrastructure import nsp_extractor, nsp_workspace
from helpers.fake_import import fake_dump
from test_game_assets_api import wait_job
from test_nsp_extractor import FakeExtractor


def configure(tmp_path, monkeypatch):
    from app.infrastructure import game_assets, paths

    data = tmp_path / "data"
    data.mkdir()
    (data / "runs").mkdir()
    (data / "battles").mkdir()
    monkeypatch.setattr(paths, "DATA_DIR", data)
    monkeypatch.setattr(paths, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(paths, "FROZEN", False)
    monkeypatch.setattr(game_assets, "_shared", GameAssets(data / "game-assets"))
    tool = tmp_path / "vendor" / "nstool" / "nstool.exe"
    tool.parent.mkdir(parents=True)
    tool.touch()
    return data, tool


def request_import(data, packages, keys, destination):
    payload = {"nsps": [str(package) for package in packages], "keys": str(keys)}
    if destination is not None:
        payload["keep_dumps"] = str(destination)
    with TestClient(create_app(data, background=False)) as client:
        response = client.post("/api/game-assets/import-nsps", json=payload)
        return response.status_code, wait_job(client) if response.status_code == 202 else response.json()


@pytest.mark.parametrize("retained", [False, True])
def test_app_retains_only_opted_in_verified_extraction(tmp_path, monkeypatch, retained):
    data, tool_path = configure(tmp_path, monkeypatch)
    runner = FakeExtractor(tmp_path)
    packages = [runner.add("base game.nsp", 0x1000, 0x80), runner.add("update.nsp", 0x1800, 0x81, 2),
                runner.add("dlc.nsp", 0x2001, 0x82)]
    runner.keys.write_text("synthetic-private-key-sentinel")
    original_run = runner.run

    def tool_io(args, source, **kwargs):
        result = original_run(args, source, **kwargs)
        if "-x" in args and source.suffix == ".nca" and not source.name.endswith(".cnmt.nca"):
            target = Path(args[-1])
            if target.name == "romfs" and "DLC" not in target.parts:
                fake_dump(target)
                (target.parent / "exefs/main").write_bytes((target / "main").read_bytes())
        return result

    runner.run = tool_io

    def extractor(tool, keys, output, log, cancelled):
        assert tool == tool_path and keys == runner.keys
        runner.output = output
        return runner

    def family_io(ctx):
        assert ctx.dump.romfs.is_dir()
        ctx.out.json("data/example.json", {"synthetic": True}, source="test")
        return {"data": {"files": 1, "skipped": []}}

    monkeypatch.setattr(nsp_extractor, "Extractor", extractor)
    monkeypatch.setattr(importer, "run", family_io)
    destination = tmp_path / "saved raw dump"
    verify = importer.verify.check
    monkeypatch.setattr(importer.verify, "check", lambda root, **_: verify(root))
    code, job = request_import(data, packages, runner.keys, destination if retained else None)
    assert code == 202 and job["state"] == "done"
    assert verify(data / "game-assets").ok
    assert runner.output.exists() is retained
    assert not runner.work.exists()
    if retained:
        assert (destination / "exefs/main").is_file()
        assert (destination / "romfs/DATA0.bin").is_file()
        assert (destination / "DLC/0000000000002001/romfs/synthetic.bin").is_file()
        assert json.loads((destination / "extraction.json").read_text())
        assert not list(destination.rglob("*.keys"))
        assert not list(destination.rglob("*.nca"))
        assert not list(destination.rglob("*.tik"))
    assert all(p.is_file() and p.stat().st_size == 0 for p in packages)
    assert runner.keys.read_text() == "synthetic-private-key-sentinel"
    assert not (data / "game-assets-import.log").exists()
    assert "log" not in job


@pytest.mark.parametrize("retained", [False, True])
@pytest.mark.parametrize("stage", ["extract", "invalid-dump", "import", "verify", "cancel"])
def test_failed_import_cleans_only_owned_raw_workspace(tmp_path, monkeypatch, retained, stage):
    data, _ = configure(tmp_path, monkeypatch)
    source = tmp_path / "base.nsp"
    keys = tmp_path / "prod.keys"
    keys.touch()
    source.write_bytes(b"synthetic-package")
    unrelated = tmp_path / "keep.txt"
    unrelated.write_text("keep")
    old = data / "game-assets"
    old.mkdir()
    (old / "previous.txt").write_text("previous")
    workspaces = []

    def extract(_inputs, _tool, _keys, output, *, cancelled):
        workspaces.append(output)
        (output / "partial.txt").write_text("partial")
        if stage in ("extract", "cancel"):
            raise RuntimeError("Cancelled" if stage == "cancel" else "extraction failed")
        if stage != "invalid-dump":
            fake_dump(output / "romfs")

    def run(ctx):
        if stage == "import":
            raise ValueError("import failed")
        ctx.out.json("data/example.json", {"ok": True}, source="test")
        if stage == "verify":
            (ctx.out.root / "data/example.json").write_text("damaged")
        return {"data": {"files": 1, "skipped": []}}

    monkeypatch.setattr(nsp_extractor, "extract_nsps", extract)
    monkeypatch.setattr(importer, "run", run)
    destination = tmp_path / "saved"
    code, job = request_import(data, [source], keys, destination if retained else None)
    assert code == 202 and job["state"] == "failed" and "log" not in job
    assert not workspaces[0].exists()
    assert source.read_bytes() == b"synthetic-package"
    assert unrelated.read_text() == "keep"
    assert (old / "previous.txt").read_text() == "previous"
    assert not (data / "settings.json").exists()
    assert not (data / "game-assets-import.log").exists()
    error = job["error"]
    if stage == "verify":
        assert "Verification failed" in error
    elif stage == "import":
        assert "import failed" in error
    elif stage == "cancel":
        assert "Cancelled" in error


@pytest.mark.parametrize("kind", ["existing", "file", "missing-parent", "relative", "data", "reserved", "invalid"])
def test_invalid_destination_does_not_extract_or_change_existing_files(tmp_path, monkeypatch, kind):
    data, _ = configure(tmp_path, monkeypatch)
    destination = tmp_path / "saved"
    if kind == "existing":
        destination.mkdir()
        (destination / "keep.txt").write_text("keep")
    elif kind == "file":
        destination.write_text("keep")
    elif kind == "missing-parent":
        destination = tmp_path / "absent" / "child"
    elif kind == "relative":
        destination = Path("relative")
    elif kind == "data":
        destination = data / "child"
    elif kind in ("reserved", "invalid"):
        if os.name != "nt":
            pytest.skip("Windows path rules")
        destination = tmp_path / ("CON" if kind == "reserved" else "bad:name")
    source = tmp_path / "base.nsp"
    keys = tmp_path / "prod.keys"
    keys.touch()
    source.touch()
    monkeypatch.setattr(nsp_extractor, "extract_nsps", lambda *_, **__: pytest.fail("must validate first"))
    before = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*"))
    assert request_import(data, [source], keys, destination)[0] == 400
    after = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*") if p.name != "game-assets-import.log")
    assert after == before
    if kind == "existing":
        assert (destination / "keep.txt").read_text() == "keep"
    if kind == "file":
        assert destination.read_text() == "keep"


def test_app_shutdown_cancels_import_and_cleans_the_extraction(tmp_path, monkeypatch):
    data, _ = configure(tmp_path, monkeypatch)
    destination = tmp_path / "saved"
    nsp, keys = tmp_path / "base.nsp", tmp_path / "prod.keys"
    nsp.touch()
    keys.touch()
    workspaces = []

    def extract(_inputs, _tool, _keys, output, *, cancelled):
        workspaces.append(output)
        (output / "partial").touch()
        assert cancelled.wait(5)
        raise InterruptedError("App closed")

    monkeypatch.setattr(nsp_extractor, "extract_nsps", extract)
    with TestClient(create_app(data, background=False)) as client:
        response = client.post("/api/game-assets/import-nsps", json={"nsps": [str(nsp)], "keys": str(keys),
                                                                    "keep_dumps": str(destination)})
        assert response.status_code == 202
    assert workspaces == [destination]
    assert not destination.exists()
    assert not (data / "game-assets").exists()


def test_unwritable_parent_and_creation_race_preserve_unrelated_files(tmp_path, monkeypatch):
    destination = tmp_path / "child"
    with monkeypatch.context() as patch:
        def denied(**_kwargs):
            raise PermissionError("synthetic write denial")
        patch.setattr(nsp_workspace.tempfile, "TemporaryFile", denied)
        with pytest.raises(PermissionError):
            with nsp_workspace.extraction_workspace(destination):
                pytest.fail("unwritable parent")
    assert not destination.exists()
    validate = nsp_workspace.validate_destination

    def race(path, protected):
        validate(path, protected)
        path.mkdir()
        (path / "racer.txt").write_text("unrelated")

    monkeypatch.setattr(nsp_workspace, "validate_destination", race)
    with pytest.raises(FileExistsError):
        with nsp_workspace.extraction_workspace(destination):
            pytest.fail("destination appeared")
    assert (destination / "racer.txt").read_text() == "unrelated"


def test_interruption_cleans_owned_directory(tmp_path):
    destination = tmp_path / "interrupted"
    with pytest.raises(KeyboardInterrupt):
        with nsp_workspace.extraction_workspace(destination):
            (destination / "partial").touch()
            raise KeyboardInterrupt
    assert not destination.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows junctions")
def test_destination_below_junction_is_rejected_without_touching_target(tmp_path):
    import _winapi

    target = tmp_path / "target"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    link = tmp_path / "junction"
    _winapi.CreateJunction(str(target), str(link))
    try:
        with pytest.raises(ValueError, match="linked folders"):
            with nsp_workspace.extraction_workspace(link / "new"):
                pytest.fail("junction must be rejected")
        assert list(target.iterdir()) == [target / "keep.txt"]
    finally:
        link.rmdir()
