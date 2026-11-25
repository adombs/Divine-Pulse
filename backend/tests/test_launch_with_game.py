"""Launch with Game: the watcher that opens the app when Eden or FE3H Recomp starts, and the setting that runs it."""

import json
import threading
import time
from types import SimpleNamespace

import pytest

from app.infrastructure import launch_with_game as lwg
from app.infrastructure.settings import SettingsStore


def test_every_windows_reader_is_watched():
    assert {"eden.exe", "fe3hrecomp.exe", "ryujinx.exe"} <= lwg.GAME_EXECUTABLES


def test_only_windows_has_a_game_watch():
    from app.system import platform

    assert [m.ID for m in platform.ALL if m.game_watch() is not None] == ["windows"]


def _run(polls, *, app_running=False, enabled=None):
    """Run watch() over a list of process-ID polls; returns how many times it launched the app."""
    polls = list(polls)
    launched = []
    checks = iter(enabled) if enabled is not None else None
    lwg.watch(
        games=lambda: polls.pop(0),
        enabled=(lambda: next(checks, False)) if checks else (lambda: True),
        app_running=lambda: app_running,
        launch=lambda: launched.append(True),
        wait=lambda _s: not polls,  # asked to stop once every poll is used
    )
    return len(launched)


def test_opens_the_app_each_time_a_game_starts():
    assert _run([[], [], [10], [10], [], [11]]) == 2


def test_a_game_already_running_at_start_does_not_count():
    assert _run([[10], [10], [10]]) == 0
    # A second game process while the first runs still counts.
    assert _run([[10], [10, 12]]) == 1


def test_leaves_an_open_app_alone():
    assert _run([[], [10]], app_running=True) == 0


def test_stops_when_the_setting_goes_off():
    assert _run([[], [], [10]], enabled=[True, True, False]) == 0


def test_a_failed_launch_keeps_watching():
    polls = iter([[], [1], [], [2]])
    calls = []

    def launch():
        calls.append(True)
        raise OSError("gone")

    lwg.watch(games=lambda: next(polls), enabled=lambda: True, app_running=lambda: False, launch=launch,
              wait=lambda _s: False if calls.__len__() < 2 else True)
    assert len(calls) == 2


def test_setting_is_read_from_the_saved_file(tmp_path):
    path = tmp_path / "settings.json"
    assert not lwg.enabled_in(path)
    path.write_text(json.dumps({"launch_with_game": True}), "utf-8")
    assert lwg.enabled_in(path)
    path.write_text("not json", "utf-8")
    assert not lwg.enabled_in(path)
    path.write_text("[]", "utf-8")
    assert not lwg.enabled_in(path)


def test_watch_command_runs_this_app_with_the_flag():
    assert lwg.watch_command()[-1] == lwg.WATCH_FLAG
    assert lwg.watch_command()[:-1] == lwg.app_command()


class FakeWatch:
    def __init__(self, running=False, refuse_autostart=False):
        self.log = []
        self.is_running = running
        self.refuse = refuse_autostart

    def running(self):
        return self.is_running

    def stop(self):
        self.log.append("stop")

    def set_autostart(self, command):
        if self.refuse:
            raise PermissionError("denied")
        self.log.append(("autostart", command is not None and command[-1] == lwg.WATCH_FLAG))

    def spawn(self, command, cwd=None):
        assert command[-1] == lwg.WATCH_FLAG
        self.log.append("start")


def test_turning_it_on_and_off(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    watch = FakeWatch()
    service = lwg.LaunchWithGame(settings, service=watch, autostart=True)
    service.start()
    assert watch.log == []  # off: nothing to touch

    settings.update(launch_with_game=True)
    service.settings_changed()
    assert watch.log == [("autostart", True), "start"]

    settings.update(max_recordings=5)
    service.settings_changed()
    assert watch.log == [("autostart", True), "start"]  # unchanged

    settings.update(launch_with_game=False)
    service.settings_changed()
    assert watch.log[-2:] == [("autostart", False), "stop"]


def test_startup_brings_back_the_watcher_and_sign_in_entry(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(launch_with_game=True)
    watch = FakeWatch(running=True)
    lwg.LaunchWithGame(settings, service=watch, autostart=True).start()
    assert watch.log == [("autostart", True)]  # already watching: no second watcher

    watch = FakeWatch()
    lwg.LaunchWithGame(settings, service=watch, autostart=False).start()
    assert watch.log == ["start"]  # from source: no sign-in entry


def test_registry_failure_still_starts_the_watcher(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(launch_with_game=True)
    watch = FakeWatch(refuse_autostart=True)
    lwg.LaunchWithGame(settings, service=watch, autostart=True).start()
    assert watch.log == ["start"]


def test_unsupported_platforms_do_nothing(tmp_path, monkeypatch):
    from app.system import platform

    monkeypatch.setattr(platform, "_selected", platform.for_platform("linux"))
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(launch_with_game=True)
    service = lwg.LaunchWithGame(settings, autostart=True)
    assert not service.supported
    service.start()
    service.settings_changed()
    assert lwg.run_watcher(tmp_path / "settings.json", lambda: True) == 1


def test_settings_operation_tells_the_watcher(tmp_path):
    from app.application.operations import BackendOperations

    told = []
    settings = SettingsStore(tmp_path / "settings.json")
    ops = BackendOperations(
        runs=None, battles=None, settings=settings, events=None,
        scanner=SimpleNamespace(settings_changed=lambda: None),
        memory_check=None, system=None, data_dir=tmp_path, version="0",
        launch_with_game=SimpleNamespace(settings_changed=lambda: told.append(settings.get().launch_with_game)),
    )
    assert ops.update_settings({"launch_with_game": True})["launch_with_game"] is True
    assert told == [True]


def test_settings_api_saves_the_toggle(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(tmp_path, background=False)
    calls = []
    monkeypatch.setattr(app.state.runtime.launch_with_game, "settings_changed", lambda: calls.append(True))
    with TestClient(app) as c:
        assert c.get("/api/settings").json()["launch_with_game"] is False
        assert c.put("/api/settings", json={"launch_with_game": True}).json()["launch_with_game"] is True
        assert c.put("/api/settings", json={"launch_with_game": "yes please"}).status_code == 422
    assert calls == [True]
    assert json.loads((tmp_path / "settings.json").read_text("utf-8"))["launch_with_game"] is True


def _on_windows() -> bool:
    from app.system import platform

    return platform.current().ID == "windows"


windows_only = pytest.mark.skipif(not _on_windows(), reason="Windows named objects and registry")


@windows_only
def test_one_watcher_runs_and_stops_when_asked(tmp_path):
    from app.system.platform import windows

    watch = windows.game_watch()
    if watch.running():
        pytest.skip("A real Launch with Game watcher is running on this PC")
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"launch_with_game": True}), "utf-8")
    codes = []
    thread = threading.Thread(target=lambda: codes.append(lwg.run_watcher(path, lambda: True)), daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not watch.running() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert watch.running()
    assert lwg.run_watcher(path, lambda: True) == 0  # a second one leaves at once
    assert thread.is_alive()

    watch.stop()
    thread.join(5)
    assert not thread.is_alive() and codes == [0]
    assert not watch.running()


@windows_only
def test_sign_in_entry_is_written_and_removed(monkeypatch):
    import uuid
    import winreg

    from app.system.platform import windows

    name = f"Divine Pulse test {uuid.uuid4()}"
    monkeypatch.setattr(windows.GameWatch, "RUN_VALUE", name)
    watch = windows.game_watch()

    def read():
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, windows.GameWatch.RUN_KEY) as key:
            return winreg.QueryValueEx(key, name)[0]

    try:
        watch.set_autostart(lwg.watch_command())
        assert read().endswith(lwg.WATCH_FLAG)
        watch.set_autostart(None)
        with pytest.raises(FileNotFoundError):
            read()
        watch.set_autostart(None)  # already gone
    finally:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, windows.GameWatch.RUN_KEY, access=winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, name)
        except FileNotFoundError:
            pass
