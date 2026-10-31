import json

from fastapi.testclient import TestClient

from app import __version__
from app.config import SettingsStore
from app.main import create_app


def test_damaged_settings_file_starts_with_defaults(tmp_path):
    (tmp_path / "settings.json").write_text("{not json", "utf-8")
    store = SettingsStore(tmp_path / "settings.json")
    assert store.get().auto_interval_s == 1.0
    assert (tmp_path / "settings.broken.json").exists()


def test_about_reports_version_and_data_folder(tmp_path):
    with TestClient(create_app(tmp_path, background=False)) as c:
        about = c.get("/api/about").json()
        assert about["version"] == __version__ and about["data_dir"] == str(tmp_path)
        assert c.get("/api/health").json()["version"] == __version__


def test_port_helpers():
    import socket

    from app.__main__ import HOST, _any_free_port, _port_free

    with socket.socket() as s:
        s.bind((HOST, 0))
        s.listen()
        taken = s.getsockname()[1]
        assert not _port_free(taken)
    assert _port_free(_any_free_port())


def test_battle_settings_default_to_the_recommended_values(tmp_path):
    from app.config import SettingsStore

    s = SettingsStore(tmp_path / "settings.json").get()
    assert (s.battle_interval_s, s.battle_estimate_fights, s.pairing_check, s.hide_history) == (0.1, True, False, False)
    assert s.window_mode == "windowed"


def test_settings_from_older_versions_still_load(tmp_path):
    # Older versions saved a first-run "setup_done", and the screenshot / OCR settings: ignored now.
    old = {"auto_interval_s": 2.0, "setup_done": True, "scan_hotkey": "f9", "data_source": "screen", "screenshot_dir": ""}
    (tmp_path / "settings.json").write_text(json.dumps(old), "utf-8")
    store = SettingsStore(tmp_path / "settings.json")
    assert store.get().auto_interval_s == 2.0
    store.update(auto_interval_s=1.5)
    assert "scan_hotkey" not in json.loads((tmp_path / "settings.json").read_text("utf-8"))
