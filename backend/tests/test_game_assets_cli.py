import pytest
import json

from app import __main__ as entry
from app.infrastructure import game_assets as assets_module
from app.infrastructure import game_assets_import as importer
from app.infrastructure.settings import SettingsStore
from helpers.fake_import import fake_dump


def configure(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(entry, "DATA_DIR", data)
    monkeypatch.setattr(entry, "SettingsStore", lambda: SettingsStore(data / "settings.json"))
    monkeypatch.setattr(assets_module, "_shared", assets_module.GameAssets(data / "game-assets"))
    dump = tmp_path / "dump" / "romfs"
    fake_dump(dump)
    return data, dump.parent


def test_cli_import_success(tmp_path, monkeypatch, capsys):
    data, dump = configure(tmp_path, monkeypatch)

    def extract(ctx):
        ctx.log("data:")
        ctx.out.json("data/example.json", {"ok": True}, source="test")
        return {"data": {"files": 1, "skipped": []}}

    monkeypatch.setattr(importer, "run", extract)
    assert entry.import_game_files(str(dump)) == 0
    assert json.loads((data / "settings.json").read_text())["last_dump"] == str(dump)
    assert (data / "game-assets" / "data" / "example.json").exists()
    assert "successfully" in capsys.readouterr().out
    assert "successfully" in (data / "game-assets-import.log").read_text()
    assert entry.check_game_files() == 0
    (data / "game-assets" / "data" / "example.json").write_text("damaged")
    assert entry.check_game_files() == 1


def test_cli_failure_preserves_previous_import(tmp_path, monkeypatch, capsys):
    data, dump = configure(tmp_path, monkeypatch)
    old = data / "game-assets"
    old.mkdir()
    (old / "old.txt").write_text("old")

    def fail(_ctx):
        raise ValueError("extract failed")

    monkeypatch.setattr(importer, "run", fail)
    assert entry.import_game_files(str(dump)) == 1
    assert capsys.readouterr().out.splitlines()[-1] == "extract failed"
    assert (data / "game-assets-import.log").read_text().splitlines()[-1] == "extract failed"
    assert (old / "old.txt").read_text() == "old"


def test_main_handles_the_setup_flags(monkeypatch):
    # The packaged program calls main() (packaging/launcher.py), so the flags must work there, not only under __main__.
    monkeypatch.setattr(entry, "import_game_files", lambda folder: 3 if folder == "dump" else 9)
    monkeypatch.setattr(entry, "check_game_files", lambda: 4)
    monkeypatch.setattr(entry.sys, "argv", ["Divine Pulse.exe", "--import-game-files", "dump"])
    with pytest.raises(SystemExit) as imported:
        entry.main()
    assert imported.value.code == 3
    monkeypatch.setattr(entry.sys, "argv", ["Divine Pulse.exe", "--check-game-files"])
    with pytest.raises(SystemExit) as checked:
        entry.main()
    assert checked.value.code == 4
