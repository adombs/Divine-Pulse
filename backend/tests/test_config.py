import io
import json
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.config import SettingsStore
from app.main import create_app


def test_damaged_settings_file_starts_with_defaults(tmp_path):
    (tmp_path / "settings.json").write_text("{not json", "utf-8")
    store = SettingsStore(tmp_path / "settings.json")
    assert store.get().max_recordings == 3
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


def test_quit_route_answers_before_it_quits(tmp_path):
    import os

    quit_calls = []
    with TestClient(create_app(tmp_path, background=False)) as c:
        assert c.post("/api/quit").status_code == 404  # no desktop window attached
        c.app.state.quit_app = lambda: quit_calls.append(True)
        assert c.get("/api/quit").status_code == 404  # only a POST quits
        assert c.post("/api/quit", headers={"origin": "https://evil.example"}).status_code == 403
        assert not quit_calls
        assert c.post("/api/quit").json() == {"pid": os.getpid()}
        assert quit_calls == [True]


def test_quit_flag_leaves_another_tracker_and_a_missing_data_folder_alone(tmp_path, monkeypatch):
    from app import __main__ as main

    data = tmp_path / "gone"
    monkeypatch.setattr(main, "DATA_DIR", data)
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("refused")))
    assert main.quit_running() == 0
    assert not data.exists()

    monkeypatch.setattr(main.sys, "argv", ["app", "--quit"])
    with pytest.raises(SystemExit) as stopped:
        main.main()
    assert stopped.value.code == 0
    assert not data.exists()


@pytest.mark.parametrize(("exits", "code"), [(True, 0), (False, 1)])
def test_quit_flag_waits_for_the_process_to_end(tmp_path, monkeypatch, exits, code):
    from app import __main__ as main

    (tmp_path / "settings.json").write_text(json.dumps({"port": 9123}), "utf-8")
    requests, waited = [], []

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def urlopen(request, timeout):
        requests.append((request.full_url, request.get_method()))
        return Response(b'{"pid": 4242}')

    def wait_for_exit(pid, timeout_s):
        waited.append(pid)
        return exits

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "_already_running", lambda url: url == "http://127.0.0.1:9123")
    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(main, "wait_for_exit", wait_for_exit)
    assert main.quit_running() == code
    assert requests == [("http://127.0.0.1:9123/api/quit", "POST")]
    assert waited == [4242]


def test_quit_flag_reports_a_tracker_that_refuses(tmp_path, monkeypatch):
    from app import __main__ as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "_already_running", lambda url: True)
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("404")))
    assert main.quit_running() == 1


def test_wait_for_exit_sees_a_real_process_end():
    from app.system import wait_for_exit

    child = subprocess.Popen([sys.executable, "-c", "input()"], stdin=subprocess.PIPE)
    try:
        assert wait_for_exit(child.pid, 0.1) is False
        child.stdin.close()
        assert wait_for_exit(child.pid, 20) is True
    finally:
        child.kill()
        child.wait()
    assert wait_for_exit(child.pid, 0.1) is True


def test_battle_settings_default_to_the_recommended_values(tmp_path):
    from app.config import SettingsStore

    s = SettingsStore(tmp_path / "settings.json").get()
    assert s.max_recordings == 3
    assert s.window_mode == "windowed"


def test_settings_from_older_versions_still_load(tmp_path):
    # Older versions saved a first-run "setup_done", and the screenshot / OCR settings: ignored now.
    old = {"record_battles": False, "setup_done": True, "scan_hotkey": "f9", "data_source": "screen", "screenshot_dir": ""}
    (tmp_path / "settings.json").write_text(json.dumps(old), "utf-8")
    store = SettingsStore(tmp_path / "settings.json")
    assert store.get().max_recordings == 0
    store.update(max_recordings=8)
    assert "scan_hotkey" not in json.loads((tmp_path / "settings.json").read_text("utf-8"))
