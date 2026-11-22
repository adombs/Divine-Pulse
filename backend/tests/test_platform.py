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
        assert not module.runs_program("fe3hrecomp.exe") and module.runs_program("ryujinx")
    assert linux.runs_program("eden") and not macos.runs_program("eden")  # Eden's game isn't read on a Mac


def test_texts_name_their_os():
    for module in platform.ALL:
        assert module.NAME in module.MEMORY_ACCESS_HELP.format(emulator="Eden")
        assert "{emulator}" in module.MEMORY_ACCESS_HELP
    assert "WebView2" in windows.WEBVIEW_MISSING and "WebKit" in macos.WEBVIEW_MISSING and "Qt" in linux.WEBVIEW_MISSING
    assert (windows.NSTOOL_NAME, macos.NSTOOL_NAME, linux.NSTOOL_NAME) == ("nstool.exe", "nstool", "nstool")


def test_folder_names_windows_cant_make():
    assert windows.folder_name_problem(("dumps", "CON")) and windows.folder_name_problem(("a:b",))
    assert windows.folder_name_problem(("trailing.",)) and not windows.folder_name_problem(("dumps", "FE3H 1.2.0"))
    assert macos.folder_name_problem(("CON",)) is None and linux.folder_name_problem(("a:b",)) is None


def test_web_view_caches_cleared_on_a_new_installation(tmp_path):
    assert windows.webview_caches(tmp_path)[0] == tmp_path / "webview" / "EBWebView" / "Default" / "Cache"
    assert all("Local Storage" not in str(p) for p in windows.webview_caches(tmp_path))
    assert macos.webview_caches(tmp_path, HOME) == [HOME / "Library" / "Caches" / macos.BUNDLE_ID / "WebKit"]
    assert linux.webview_caches(tmp_path / "Divine Pulse", HOME) == [HOME / ".cache" / "Divine Pulse" / "QtWebEngine"]


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


@pytest.mark.parametrize(("code", "output", "answer"), [
    (0, "", "yes"), (1, "No\n", "no"), (1, "", "cancel"),  # closed, or its Cancel button
    (5, "", "cancel"), (255, "", "cancel"),  # zenity failed: never No, which can delete records
])
def test_linux_setup_questions_without_qt(monkeypatch, code, output, answer):
    import subprocess

    asked = []
    monkeypatch.setattr(linux, "_qt_message", lambda *a, **k: None)
    monkeypatch.setattr(linux.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(linux.subprocess, "run",
                        lambda command, **k: asked.append(command) or subprocess.CompletedProcess(command, code, output, ""))
    assert linux.ask("Keep?", "Divine Pulse setup") == answer
    assert asked[0][0] == "zenity" and "--text=Keep?" in asked[0]


def test_linux_asks_with_qt_first_and_says_when_nothing_can_ask(monkeypatch):
    monkeypatch.setattr(linux, "_qt_message", lambda *a, **k: "no")
    assert linux.ask("Keep?", "Divine Pulse setup") == "no"
    monkeypatch.setattr(linux, "_qt_message", lambda *a, **k: None)
    monkeypatch.setattr(linux.shutil, "which", lambda name: None)
    with pytest.raises(base.NotSupported, match="zenity"):
        linux.ask("Keep?", "Divine Pulse setup")


def test_linux_starts_other_programs_with_the_environment_it_was_given(monkeypatch):
    """The packaged program's own libraries (PyInstaller's LD_LIBRARY_PATH, Qt's plugins) would break them."""
    assert linux.child_env() is None  # from source
    monkeypatch.setattr(linux.sys, "frozen", True, raising=False)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/opt/Divine Pulse/_internal")
    monkeypatch.setenv("QT_PLUGIN_PATH", "/opt/Divine Pulse/_internal/PyQt6")
    monkeypatch.setenv("KEPT", "1")
    env = linux.child_env()
    assert env["KEPT"] == "1" and "LD_LIBRARY_PATH" not in env and "QT_PLUGIN_PATH" not in env
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", "/usr/local/lib")
    assert linux.child_env()["LD_LIBRARY_PATH"] == "/usr/local/lib" and "LD_LIBRARY_PATH_ORIG" not in linux.child_env()


def test_linux_window_needs_a_display():
    assert linux.has_display({"WAYLAND_DISPLAY": "wayland-0"}) and linux.has_display({"DISPLAY": ":0"})
    assert not linux.has_display({})


@pytest.mark.parametrize(("settings", "blocked"), [
    ({}, False), ({"kernel.apparmor_restrict_unprivileged_userns": "1"}, True),
    ({"kernel.apparmor_restrict_unprivileged_userns": "0", "kernel.unprivileged_userns_clone": "1"}, False),
    ({"kernel.unprivileged_userns_clone": "0"}, True), ({"user.max_user_namespaces": "0"}, True),
])
def test_linux_runs_the_window_without_a_sandbox_only_where_it_cant_start(monkeypatch, settings, blocked):
    monkeypatch.setattr(linux, "_sysctl", lambda name: settings.get(name, ""))
    monkeypatch.setattr(linux.os, "geteuid", lambda: 1000, raising=False)
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)
    monkeypatch.setenv("QT_API", "pyqt6")
    assert linux.sandbox_blocked() is blocked
    linux.prepare_qt()
    assert ("QTWEBENGINE_DISABLE_SANDBOX" in linux.os.environ) is blocked
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)
    monkeypatch.setattr(linux.os, "geteuid", lambda: 0, raising=False)
    assert linux.sandbox_blocked()


def test_linux_window_closing_during_a_load_ends_pywebview_s_waiting_threads():
    """pywebview's evaluate_js waits on a semaphore that only the page's answer releases, in a thread that isn't a
    daemon: a window closed meanwhile would keep the program running for good."""
    import threading
    from types import SimpleNamespace

    asked = [threading.Semaphore(0) for _ in range(2)]
    native = SimpleNamespace(_js_results={})
    started = threading.Event()

    def generate_js_object():  # two scripts in turn, as pywebview's
        for i, semaphore in enumerate(asked):
            native._js_results[str(i)] = {"semaphore": semaphore}
            started.set()
            semaphore.acquire()
            del native._js_results[str(i)]

    thread = threading.Thread(target=generate_js_object, daemon=False)
    thread.start()
    started.wait(5)
    linux.Window().closed(SimpleNamespace(native=native))
    thread.join(5)
    assert not thread.is_alive() and native._js_results == {}
    linux.Window().closed(SimpleNamespace(native=None))  # GTK's window, or none


def test_linux_finds_a_downloaded_nstool(tmp_path, monkeypatch):
    monkeypatch.setattr(linux.shutil, "which", lambda name: None)
    unzipped = tmp_path / "Downloads" / "nstool-v1.9.2-ubuntu_x86_64"
    unzipped.mkdir(parents=True)
    (unzipped / "nstool").write_bytes(b"")
    (unzipped / "nstool").chmod(0o644)
    assert next(c for c in linux.nstool_candidates(tmp_path) if c.is_file()) == unzipped / "nstool"
    if sys.platform != "win32":
        with pytest.raises(ValueError, match="chmod"):
            linux.check_nstool(unzipped / "nstool", "https://example.invalid")


def test_linux_finds_flatpak_emulators_folders(tmp_path):
    eden = tmp_path / ".var/app/dev.eden_emu.eden/data/eden"
    ryubing = tmp_path / ".var/app/io.github.ryubing.Ryujinx/config/Ryujinx"
    eden.mkdir(parents=True)
    ryubing.mkdir(parents=True)
    assert linux.eden_user_dirs({}, tmp_path) == [tmp_path / ".local/share/eden", eden]
    assert linux.ryujinx_roots({}, tmp_path) == [tmp_path / ".config/Ryujinx", ryubing]


@pytest.mark.skipif(sys.platform == "win32", reason="makes symbolic links")
def test_linux_lists_processes_from_proc(tmp_path, monkeypatch):
    from app.system import memory_linux

    (tmp_path / "42").mkdir()
    (tmp_path / "42" / "exe").symlink_to("/opt/Ryubing/Ryujinx")
    (tmp_path / "43").mkdir()  # another user's: its exe can't be read
    (tmp_path / "self").mkdir()
    monkeypatch.setattr(memory_linux, "PROC", tmp_path)
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
    monkeypatch.setattr(memory_linux, "_all_processes", lambda: [(7, "/usr/bin/Ryujinx", {"ryujinx"})])
    assert memory.find_processes({"Ryujinx"}) == [(7, "ryujinx")]
    monkeypatch.setattr(memory_linux, "Process", lambda pid: ("opened", pid))
    assert memory.open_process(7) == ("opened", 7)


def test_about_reports_the_platform(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(tmp_path, background=False)) as client:
        assert client.get("/api/about").json()["platform"] == platform.current().ID


def test_running_only_looks_for_eden(monkeypatch, as_platform):
    as_platform("win32")

    from app.gamemem.emulators import running

    def processes(names):
        assert names == {"eden.exe", "eden", "eden-cli"}
        return [(42, "eden.exe")]

    monkeypatch.setattr("app.gamemem.emulators.find_processes", processes)
    assert [(emulator.name, pid) for emulator, pid in running()] == [("Eden", 42)]
