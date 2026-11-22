"""The platform layer (app/system/platform/): one module per OS, picked once, each with the same interface. These
check every platform's pure parts (paths, texts, choices) on whatever OS the tests run on."""

import inspect
import sys
from pathlib import Path

import pytest

from app.system import platform
from app.system.platform import base, linux, macos, windows

HOME = Path("/home/me")


def test_this_computer_gets_its_own_module():
    expected = {"win32": windows, "darwin": macos}.get(sys.platform, linux)
    assert platform.current() is expected
    assert platform.current() is platform.current()  # chosen once


def test_each_sys_platform_value_names_a_module():
    assert platform.for_platform("win32") is windows
    assert platform.for_platform("darwin") is macos
    assert platform.for_platform("linux") is linux
    assert platform.for_platform("freebsd14") is linux  # other POSIX systems: XDG folders, /proc, xdg-open


@pytest.mark.parametrize("module", platform.ALL, ids=lambda m: m.ID)
def test_every_platform_has_the_whole_interface(module):
    """Adding an OS means adding a module with these names; nothing else in the app checks which OS it is."""
    for name, kind in base.Platform.__annotations__.items():
        assert hasattr(module, name), f"{module.__name__} has no {name}"
        assert isinstance(getattr(module, name), {"str": str, "bool": bool, "int": int}[kind])
    methods = [n for n, f in inspect.getmembers(base.Platform, inspect.isfunction) if not n.startswith("_")]
    for name in methods:
        assert callable(getattr(module, name, None)), f"{module.__name__} has no {name}()"
        expected = list(inspect.signature(getattr(base.Platform, name)).parameters)[1:]  # without self
        assert list(inspect.signature(getattr(module, name)).parameters) == expected, name
    assert isinstance(module.window(), base.WindowBehaviour)


def test_platform_ids_and_names():
    assert [(m.ID, m.NAME) for m in platform.ALL] == [("windows", "Windows"), ("macos", "macOS"), ("linux", "Linux")]


def test_data_folders():
    assert windows.data_dir("Divine Pulse", {"LOCALAPPDATA": "C:/Users/me/AppData/Local"}) == Path(
        "C:/Users/me/AppData/Local/Divine Pulse")
    assert windows.data_dir("Divine Pulse", {}, HOME) == HOME / "AppData" / "Local" / "Divine Pulse"
    assert macos.data_dir("Divine Pulse", {}, HOME) == HOME / "Library" / "Application Support" / "Divine Pulse"
    assert linux.data_dir("Divine Pulse", {}, HOME) == HOME / ".local" / "share" / "Divine Pulse"
    assert linux.data_dir("Divine Pulse", {"XDG_DATA_HOME": "/data"}, HOME) == Path("/data/Divine Pulse")
    assert linux.data_dir("Divine Pulse", {"XDG_DATA_HOME": "relative"}, HOME) == HOME / ".local/share/Divine Pulse"


def test_the_system_facade_uses_the_current_platform(as_platform, monkeypatch):
    from app import system

    monkeypatch.setattr(Path, "home", lambda: HOME)
    as_platform("darwin")
    assert system.data_dir("Divine Pulse") == HOME / "Library" / "Application Support" / "Divine Pulse"


def test_emulator_folders():
    roaming = {"APPDATA": "C:/Users/me/AppData/Roaming"}
    assert windows.eden_user_dirs(roaming) == [Path("C:/Users/me/AppData/Roaming/eden")]
    assert windows.ryujinx_roots(roaming) == [Path("C:/Users/me/AppData/Roaming/Ryujinx")]
    assert windows.eden_user_dirs({}) == windows.ryujinx_roots({}) == []
    support = HOME / "Library" / "Application Support"
    assert macos.eden_user_dirs({}, HOME) == [support / "eden", HOME / ".local" / "share" / "eden"]
    assert macos.ryujinx_roots({}, HOME) == [support / "Ryujinx", HOME / macos.ASTRIS_CONTAINER / support.relative_to(HOME) / "Ryujinx"]
    assert linux.eden_user_dirs({}, HOME) == [HOME / ".local" / "share" / "eden"]
    assert linux.ryujinx_roots({}, HOME) == [HOME / ".config" / "Ryujinx"]
    assert linux.ryujinx_roots({"XDG_CONFIG_HOME": "/cfg"}, HOME) == [Path("/cfg/Ryujinx")]


def test_which_programs_run_where():
    assert windows.runs_program("eden.exe") and windows.runs_program("ryujinx")
    for module in (macos, linux):
        assert not module.runs_program("fe3hrecomp.exe") and module.runs_program("astris")


def test_texts_name_their_os():
    for module in platform.ALL:
        assert module.NAME in module.MEMORY_ACCESS_HELP.format(emulator="Eden")
        assert "{emulator}" in module.MEMORY_ACCESS_HELP
    assert "WebView2" in windows.WEBVIEW_MISSING and "WebKit" in macos.WEBVIEW_MISSING and "GTK" in linux.WEBVIEW_MISSING
    assert (windows.NSTOOL_NAME, macos.NSTOOL_NAME, linux.NSTOOL_NAME) == ("nstool.exe", "nstool", "nstool")


def test_folder_names_windows_cant_make():
    assert windows.folder_name_problem(("dumps", "CON")) and windows.folder_name_problem(("a:b",))
    assert windows.folder_name_problem(("trailing.",)) and not windows.folder_name_problem(("dumps", "FE3H 1.2.0"))
    assert macos.folder_name_problem(("CON",)) is None and linux.folder_name_problem(("a:b",)) is None


def test_web_view_caches_cleared_on_a_new_installation(tmp_path):
    assert windows.webview_caches(tmp_path)[0] == tmp_path / "webview" / "EBWebView" / "Default" / "Cache"
    assert all("Local Storage" not in str(p) for p in windows.webview_caches(tmp_path))
    assert macos.webview_caches(tmp_path, HOME) == [HOME / "Library" / "Caches" / macos.BUNDLE_ID / "WebKit"]
    assert linux.webview_caches(tmp_path, HOME) == []


def test_flags():
    assert not windows.PORT_CHECK_REUSES_ADDRESS and macos.PORT_CHECK_REUSES_ADDRESS and linux.PORT_CHECK_REUSES_ADDRESS
    assert windows.HIDDEN_CONSOLE_FLAGS == 0x08000000 and macos.HIDDEN_CONSOLE_FLAGS == linux.HIDDEN_CONSOLE_FLAGS == 0


def test_mac_dialogs_quote_their_text():
    script = macos.dialog_script('Say "hi" \\ bye', "Divine Pulse setup", ("Cancel", "No", "Yes"), "Yes")
    assert script == ('display dialog "Say \\"hi\\" \\\\ bye" with title "Divine Pulse setup" '
                      'buttons {"Cancel", "No", "Yes"} default button "Yes" with icon note')


@pytest.mark.parametrize(("clicked", "answer"), [("Yes", "yes"), ("No", "no"), (None, "cancel")])
def test_mac_setup_questions(monkeypatch, clicked, answer):
    monkeypatch.setattr(macos, "dialog", lambda *a, **k: clicked)
    assert macos.ask("Keep?", "Divine Pulse setup") == answer


def test_setup_questions_map_to_the_installer_s_answers(monkeypatch, as_platform):
    from app import __main__ as launcher
    from app.infrastructure.installation import NO, YES

    module = as_platform("darwin")
    for clicked, expected in (("Yes", YES), ("No", NO), (None, 0)):
        monkeypatch.setattr(module, "dialog", lambda *a, clicked=clicked, **k: clicked)
        assert launcher._setup_choice("Keep?") == expected


def test_linux_says_what_it_doesnt_support_yet():
    with pytest.raises(base.NotSupported, match="Linux"):
        linux.ask("Keep?", "Divine Pulse setup")
    from app.system import memory_linux

    with pytest.raises(base.NotSupported, match="Linux"):
        memory_linux.Process(1)


@pytest.mark.skipif(sys.platform == "win32", reason="makes symbolic links")
def test_linux_lists_processes_from_proc(tmp_path, monkeypatch):
    from app.system import memory_linux

    (tmp_path / "42").mkdir()
    (tmp_path / "42" / "exe").symlink_to("/opt/Ryubing/Ryujinx")
    (tmp_path / "43").mkdir()  # another user's: its exe can't be read
    (tmp_path / "self").mkdir()
    monkeypatch.setattr(memory_linux, "PROC", tmp_path)
    monkeypatch.setattr(memory_linux._all_processes, "__defaults__", (tmp_path,))
    assert memory_linux.find_processes({"ryujinx"}) == [(42, "ryujinx")]
    assert memory_linux.process_paths({"ryujinx", "eden"}) == ["/opt/Ryubing/Ryujinx"]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX process states")
@pytest.mark.parametrize("module", [macos, linux] if sys.platform == "darwin" else [linux], ids=lambda m: m.ID)
def test_posix_wait_sees_a_process_end(module):
    if module is linux and not Path("/proc/self/stat").exists():
        pytest.skip("no /proc")
    import subprocess

    child = subprocess.Popen([sys.executable, "-c", "input()"], stdin=subprocess.PIPE)
    try:
        assert module.wait_for_exit(child.pid, 0.1) is False
        child.stdin.close()
        assert module.wait_for_exit(child.pid, 20) is True  # ended, not yet collected (a zombie)
    finally:
        child.kill()
        child.wait()


def test_memory_goes_through_the_current_platform(as_platform, monkeypatch):
    from app.system import memory, memory_linux

    as_platform("linux")
    monkeypatch.setattr(memory_linux, "_all_processes", lambda: [(7, "/usr/bin/Ryujinx")])
    assert memory.find_processes({"Ryujinx"}) == [(7, "ryujinx")]
    with pytest.raises(OSError):
        memory.open_process(7)


def test_about_reports_the_platform(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(tmp_path, background=False)) as client:
        assert client.get("/api/about").json()["platform"] == platform.current().ID


def test_running_only_looks_for_eden(monkeypatch):
    from app.gamemem.emulators import running

    def processes(names):
        assert names == {"eden.exe"}
        return [(42, "eden.exe")]

    monkeypatch.setattr("app.gamemem.emulators.find_processes", processes)
    assert [(emulator.name, pid) for emulator, pid in running()] == [("Eden", 42)]
