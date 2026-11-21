"""Launch with Game: a hidden copy of the app (`Divine Pulse.exe --watch-game`) that opens Divine Pulse when Eden or
FE3H Recomp starts.

While the setting is on, Windows starts the watcher at sign-in from the user's Run key, and the app starts it too
whenever it opens. The watcher looks for the game's programs every couple of seconds and opens the app when one starts
and the app isn't already open. It stops by itself once the setting is off or the settings file is gone, and at once
when the stop event is set (by the app when the setting is turned off, and by the installer before it replaces or
removes the program files). One watcher runs per Windows session: the names below are the same for every copy.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

from ..gamemem.emulators import EMULATORS
from ..gamemem.recomp import RECOMP_EMULATORS
from .paths import FROZEN

log = logging.getLogger(__name__)

WATCH_FLAG = "--watch-game"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "Divine Pulse (Launch with Game)"
# Also named in packaging/installer.iss, which sets the stop event before it touches the program files.
MUTEX_NAME = r"Local\DivinePulseGameWatcher"
STOP_EVENT_NAME = r"Local\DivinePulseGameWatcherStop"
POLL_S = 2.0
GAME_EXECUTABLES = frozenset(exe for e in (*EMULATORS, *RECOMP_EMULATORS) for exe in e.executables)
BACKEND_DIR = Path(__file__).resolve().parents[2]

_SYNCHRONIZE = 0x00100000
_EVENT_MODIFY_STATE = 0x0002
_ERROR_ALREADY_EXISTS = 183
_WAIT_OBJECT_0 = 0
# Hidden, and not ended with the process that started it.
_DETACHED = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP


def app_command() -> list[str]:
    """How to start this app: the packaged exe, or Python running the `app` package from backend/."""
    if FROZEN:
        return [sys.executable]
    exe = Path(sys.executable)
    windowless = exe.with_name("pythonw.exe")
    return [str(windowless if windowless.is_file() else exe), "-m", "app"]


def watch_command() -> list[str]:
    return [*app_command(), WATCH_FLAG]


def spawn(command: list[str]) -> None:
    """Start a program on its own, hidden, with no handles shared with this one."""
    subprocess.Popen(command, cwd=None if FROZEN else BACKEND_DIR, creationflags=_DETACHED, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def enabled_in(settings_path: Path) -> bool:
    """The setting as saved, read without SettingsStore (which would write a missing file back)."""
    try:
        return json.loads(settings_path.read_text("utf-8")).get("launch_with_game") is True
    except (OSError, ValueError, AttributeError):
        return False


def watch(
    games: Callable[[], Iterable[int]],
    enabled: Callable[[], bool],
    app_running: Callable[[], bool],
    launch: Callable[[], None],
    wait: Callable[[float], bool],
) -> None:
    """Open the app each time a game process starts while it isn't open. `games`: the running game processes' IDs.
    `wait(s)`: sleep up to `s` seconds, True when asked to stop. A game already running when the watcher starts
    doesn't count: the player is already playing (or the app just opened and started the watcher itself)."""
    seen = set(games())
    while enabled():
        if wait(POLL_S):
            return
        now = set(games())
        started, seen = now - seen, now
        if started and enabled() and not app_running():
            try:
                launch()
            except OSError:
                log.exception("Couldn't open Divine Pulse")


def _kernel32():
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = k32.CreateEventW.restype = k32.OpenMutexW.restype = k32.OpenEventW.restype = wintypes.HANDLE
    k32.CreateMutexW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
    k32.CreateEventW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR)
    k32.OpenMutexW.argtypes = k32.OpenEventW.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR)
    k32.SetEvent.argtypes = k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    return k32, ctypes


def watcher_running() -> bool:
    if sys.platform != "win32":
        return False
    k32, _ = _kernel32()
    handle = k32.OpenMutexW(_SYNCHRONIZE, False, MUTEX_NAME)
    if not handle:
        return False
    k32.CloseHandle(handle)
    return True


def stop_watcher() -> None:
    """Ask a running watcher to stop now. Doesn't wait for it."""
    if sys.platform != "win32":
        return
    k32, _ = _kernel32()
    handle = k32.OpenEventW(_EVENT_MODIFY_STATE, False, STOP_EVENT_NAME)
    if handle:
        k32.SetEvent(handle)
        k32.CloseHandle(handle)


def run_watcher(settings_path: Path, app_running: Callable[[], bool]) -> int:
    """The `--watch-game` process. Returns at once when another watcher is already running."""
    from ..system.memory import find_processes

    k32, ctypes = _kernel32()
    mutex = k32.CreateMutexW(None, False, MUTEX_NAME)
    if not mutex:
        return 1
    if ctypes.get_last_error() == _ERROR_ALREADY_EXISTS:
        k32.CloseHandle(mutex)
        return 0
    stop = k32.CreateEventW(None, True, False, STOP_EVENT_NAME)
    try:
        watch(
            games=lambda: [pid for pid, _name in find_processes(set(GAME_EXECUTABLES))],
            enabled=lambda: enabled_in(settings_path),
            app_running=app_running,
            launch=lambda: spawn(app_command()),
            wait=lambda s: k32.WaitForSingleObject(stop, int(s * 1000)) == _WAIT_OBJECT_0,
        )
    finally:
        # The event goes first: a watcher started next must not find it still set.
        if stop:
            k32.CloseHandle(stop)
        k32.CloseHandle(mutex)
    return 0


def set_autostart(enabled: bool) -> None:
    """Start the watcher at sign-in (the user's Run key), or stop doing so."""
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, subprocess.list2cmdline(watch_command()))
        else:
            try:
                winreg.DeleteValue(key, RUN_VALUE)
            except FileNotFoundError:
                pass


class LaunchWithGame:
    """Keeps the watcher and its sign-in entry in line with the setting. The sign-in entry is only written for the
    packaged app: run from source, the watcher works for the session it was started in."""

    def __init__(self, settings, *, autostart: bool = FROZEN, set_autostart=set_autostart,
                 watcher_running=watcher_running, start_watcher=lambda: spawn(watch_command()), stop_watcher=stop_watcher):
        self._settings = settings
        self._autostart = autostart
        self._set_autostart = set_autostart
        self._watcher_running = watcher_running
        self._start_watcher = start_watcher
        self._stop_watcher = stop_watcher
        self._applied: bool | None = None

    def start(self) -> None:
        """At startup: the setting's state, made true again (the program may have moved, or been updated, which
        stops the watcher). Nothing to do while it's off and was never on here."""
        self._apply(self._settings.get().launch_with_game, startup=True)

    def settings_changed(self) -> None:
        enabled = self._settings.get().launch_with_game
        if enabled != self._applied:
            self._apply(enabled)

    def _apply(self, enabled: bool, startup: bool = False) -> None:
        self._applied = enabled
        if self._autostart and (enabled or not startup):
            try:
                self._set_autostart(enabled)
            except OSError:
                log.exception("Couldn't %s Launch with Game at sign-in", "set up" if enabled else "remove")
        try:
            if enabled and not self._watcher_running():
                self._start_watcher()
            elif not enabled and not startup:
                self._stop_watcher()
        except OSError:
            log.exception("Couldn't %s the Launch with Game watcher", "start" if enabled else "stop")
