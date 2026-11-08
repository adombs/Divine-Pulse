"""The desktop window's saved place (desktop.py)."""

import ctypes
import sys
from types import SimpleNamespace

import pytest

from app.desktop import SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED, geometry_from_placement

SW_SHOWNORMAL = 1


@pytest.mark.parametrize("success", [True, False])
def test_packaged_desktop_check_exits_before_starting_server_or_reader(monkeypatch, success):
    from app import __main__ as launcher, desktop

    monkeypatch.setattr(sys, "argv", ["Divine Pulse.exe", "--check-desktop"])
    monkeypatch.setattr(desktop, "check_desktop", lambda: success)
    monkeypatch.setattr(launcher, "SettingsStore", lambda: pytest.fail("Desktop check must not open user settings"))
    with pytest.raises(SystemExit) as result:
        launcher.main()
    assert result.value.code == (0 if success else 1)


def test_export_dialog_saves_json_only_to_the_selected_path(monkeypatch, tmp_path):
    from app.desktop import ExportDialogs

    target = tmp_path / "chosen.json"
    calls = []
    bridge = ExportDialogs()
    bridge._window = SimpleNamespace(create_file_dialog=lambda *args, **kwargs: calls.append(kwargs) or (str(target),))
    monkeypatch.setitem(sys.modules, "webview", SimpleNamespace(FileDialog=SimpleNamespace(SAVE=1)))
    content = '{"format": "fe3h-run", "version": 1}'
    assert bridge.save_export("somewhere/run.json", content)
    assert target.read_text(encoding="utf-8") == content
    assert calls[0]["save_filename"] == "run.json"


def test_export_dialog_cancel_and_invalid_json_do_not_write(monkeypatch, tmp_path):
    from app.desktop import ExportDialogs

    calls = []
    bridge = ExportDialogs()
    bridge._window = SimpleNamespace(create_file_dialog=lambda *args, **kwargs: calls.append(kwargs))
    monkeypatch.setitem(sys.modules, "webview", SimpleNamespace(FileDialog=SimpleNamespace(SAVE=1)))
    assert bridge.save_export("run.json", "{}") is False
    with pytest.raises(ValueError):
        bridge.save_export("run.json", "invalid")
    assert len(calls) == 1
    assert not list(tmp_path.iterdir())


def _media_bridge(monkeypatch, selected):
    from app.desktop import ExportDialogs

    calls = []
    bridge = ExportDialogs()
    bridge._window = SimpleNamespace(create_file_dialog=lambda *args, **kwargs: calls.append((args, kwargs)) or selected)
    monkeypatch.setitem(sys.modules, "webview", SimpleNamespace(FileDialog=SimpleNamespace(SAVE=1, FOLDER=2)))
    return bridge, calls


def test_a_video_is_saved_in_pieces_to_the_chosen_path(monkeypatch, tmp_path):
    import base64

    target = tmp_path / "replay.mp4"
    bridge, calls = _media_bridge(monkeypatch, (str(target),))
    video = b"\x00\x00\x00\x18ftypisom" + bytes(range(256)) * 10
    token = bridge.begin_media_save("mp4", ["folder/Battle replay.mp4"])
    assert calls[0][1]["save_filename"] == "Battle replay.mp4"
    for at in range(0, len(video), 1000):
        assert bridge.write_media_chunk(token, 0, base64.b64encode(video[at:at + 1000]).decode())
    assert not target.exists()  # still a .part until it's finished
    assert bridge.finish_media_save(token) == [str(target)]
    assert target.read_bytes() == video
    assert [p.name for p in tmp_path.iterdir()] == ["replay.mp4"]


def test_several_images_go_into_the_chosen_folder_without_overwriting(monkeypatch, tmp_path):
    import base64

    (tmp_path / "Team loadouts.png").write_bytes(b"old")
    bridge, calls = _media_bridge(monkeypatch, (str(tmp_path),))
    png = b"\x89PNG\r\n\x1a\n" + b"data"
    token = bridge.begin_media_save("png", ["Team loadouts.png", "Team stats.png"])
    assert calls[0][0] == (2,)
    for index in (0, 1):
        bridge.write_media_chunk(token, index, base64.b64encode(png).decode())
    saved = bridge.finish_media_save(token)
    assert [p.split("\\")[-1].split("/")[-1] for p in saved] == ["Team loadouts (2).png", "Team stats.png"]
    assert (tmp_path / "Team loadouts.png").read_bytes() == b"old"
    assert (tmp_path / "Team stats.png").read_bytes() == png


def test_a_media_save_refuses_wrong_files_and_cleans_up(monkeypatch, tmp_path):
    import base64

    bridge, _ = _media_bridge(monkeypatch, (str(tmp_path / "x.mp4"),))
    with pytest.raises(ValueError):
        bridge.begin_media_save("exe", ["x.exe"])
    with pytest.raises(ValueError):
        bridge.begin_media_save("mp4", ["x.png"])
    token = bridge.begin_media_save("mp4", ["x.mp4"])
    bridge.write_media_chunk(token, 0, base64.b64encode(b"not a video at all").decode())
    with pytest.raises(ValueError):
        bridge.finish_media_save(token)
    assert not list(tmp_path.iterdir())
    token = bridge.begin_media_save("mp4", ["x.mp4"])
    assert bridge.cancel_media_save(token)
    assert not list(tmp_path.iterdir())


def test_a_cancelled_media_dialog_saves_nothing(monkeypatch):
    bridge, _ = _media_bridge(monkeypatch, None)
    assert bridge.begin_media_save("png", ["a.png", "b.png"]) is None


def test_geometry_keeps_the_normal_bounds_and_the_maximized_state():
    rect = (2800, 200, 3800, 900)  # physical pixels on a second monitor
    expected = {"x": 2800, "y": 200, "width": 1000, "height": 700, "physical": True}
    assert geometry_from_placement(SW_SHOWNORMAL, 0, rect) == {**expected, "maximized": False}
    assert geometry_from_placement(SW_SHOWMAXIMIZED, 0, rect) == {**expected, "maximized": True}
    # Minimized: maximized only if it goes back to maximized.
    assert geometry_from_placement(SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED, rect)["maximized"] is True
    assert geometry_from_placement(SW_SHOWMINIMIZED, 0, rect)["maximized"] is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows window placement")
def test_a_window_goes_back_where_it_was_saved():
    from app.desktop import place_window, window_geometry

    user32 = ctypes.windll.user32
    user32.CreateWindowExW.restype = ctypes.c_void_p
    user32.CreateWindowExW.argtypes = [ctypes.c_uint, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint] + [ctypes.c_int] * 4 + [ctypes.c_void_p] * 4
    hwnd = user32.CreateWindowExW(0, "STATIC", "placement test", 0x00CF0000, 0, 0, 300, 200, None, None, None, None)  # hidden
    assert hwnd
    try:
        geo = {"x": 120, "y": 90, "width": 640, "height": 480, "maximized": False, "physical": True}
        place_window(hwnd, geo)
        assert window_geometry(hwnd) == geo
        assert not user32.IsWindowVisible(ctypes.c_void_p(hwnd))  # placing it doesn't show it
    finally:
        user32.DestroyWindow(ctypes.c_void_p(hwnd))


def test_window_mode_switches_fullscreen_once_and_keeps_the_windowed_place(tmp_path):
    from app.config import SettingsStore
    from app.desktop import DesktopApp

    class FakeWindow:
        x, y, width, height = 100, 80, 1200, 800
        toggles = 0

        def toggle_fullscreen(self):
            self.toggles += 1
            self.x, self.y, self.width, self.height = 0, 0, 2560, 1440

    store = SettingsStore(tmp_path / "settings.json")
    app = DesktopApp("http://127.0.0.1", store, None, None)
    app.window = w = FakeWindow()
    app.set_window_mode("windowed")
    assert w.toggles == 0
    app.set_window_mode("fullscreen")
    app.set_window_mode("fullscreen")
    assert w.toggles == 1
    windowed = {"x": 100, "y": 80, "width": 1200, "height": 800, "maximized": False}
    assert store.get().window == windowed
    app._save_geometry()  # while fullscreen the windowed place stays saved
    assert store.get().window == windowed
    app.set_window_mode("windowed")
    assert w.toggles == 2
