"""Launch with Game: a hidden copy of the app (`Divine Pulse.exe --watch-game`) that opens Divine Pulse when a program
it reads the game from (Eden, Ryubing/Ryujinx, FE3H Recomp) starts. Windows only for now: elsewhere the platform layer
has no game_watch() and the setting does nothing.

While the setting is on, the watcher starts at sign-in, and the app starts it too whenever it opens. It looks for the
game's programs every couple of seconds and opens the app when one starts and the app isn't already open. It stops by
itself once the setting is off or the settings file is gone, and at once when asked (by the app when the setting is
turned off, and by the installer before it replaces or removes the program files). One watcher runs per user session.
"""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

from ..gamemem.readers import ALL_EMULATORS
from ..system import platform
from .paths import FROZEN

log = logging.getLogger(__name__)

WATCH_FLAG = "--watch-game"
POLL_S = 2.0
GAME_EXECUTABLES = frozenset(exe for e in ALL_EMULATORS for exe in e.executables)
BACKEND_DIR = Path(__file__).resolve().parents[2]


def app_command() -> list[str]:
    """How to start this app: the packaged program, or Python running the `app` package from backend/."""
    if FROZEN:
        return [sys.executable]
    exe = Path(sys.executable)
    windowless = exe.with_name("pythonw.exe")
    return [str(windowless if windowless.is_file() else exe), "-m", "app"]


def watch_command() -> list[str]:
    return [*app_command(), WATCH_FLAG]


def _cwd() -> Path | None:
    return None if FROZEN else BACKEND_DIR


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


def run_watcher(settings_path: Path, app_running: Callable[[], bool]) -> int:
    """The `--watch-game` process. Returns at once when another watcher is already running, or where unsupported."""
    here = platform.current()
    service = here.game_watch()
    if service is None:
        return 1
    wait = service.claim()
    if wait is None:
        return 0
    memory = here.memory()
    try:
        watch(
            games=lambda: [pid for pid, _name in memory.find_processes(set(GAME_EXECUTABLES))],
            enabled=lambda: enabled_in(settings_path),
            app_running=app_running,
            launch=lambda: service.spawn(app_command(), _cwd()),
            wait=wait,
        )
    finally:
        service.release()
    return 0


class LaunchWithGame:
    """Keeps the watcher and its sign-in entry in line with the setting. The sign-in entry is only written for the
    packaged app: run from source, the watcher works for the session it was started in."""

    def __init__(self, settings, *, service=None, autostart: bool = FROZEN):
        self._settings = settings
        self._service = service if service is not None else platform.current().game_watch()
        self._autostart = autostart
        self._applied: bool | None = None

    @property
    def supported(self) -> bool:
        return self._service is not None

    def start(self) -> None:
        """At startup: the setting's state, made true again (the program may have moved, or been updated, which
        stops the watcher). Nothing to do while it's off."""
        self._apply(self._settings.get().launch_with_game, startup=True)

    def settings_changed(self) -> None:
        enabled = self._settings.get().launch_with_game
        if enabled != self._applied:
            self._apply(enabled)

    def _apply(self, enabled: bool, startup: bool = False) -> None:
        self._applied = enabled
        if self._service is None or (startup and not enabled):
            return
        if self._autostart:
            try:
                self._service.set_autostart(watch_command() if enabled else None)
            except OSError:
                log.exception("Couldn't %s Launch with Game at sign-in", "set up" if enabled else "remove")
        try:
            if not enabled:
                self._service.stop()
            elif not self._service.running():
                self._service.spawn(watch_command(), _cwd())
        except OSError:
            log.exception("Couldn't %s the Launch with Game watcher", "start" if enabled else "stop")
