"""What every platform module (windows.py, macos.py, linux.py) provides, and the parts they share.

A platform module is a plain module with the names in `Platform`; `app.system.platform.current()` picks the one for
this computer. Each module imports its OS's libraries (ctypes.windll, libproc, AppKit, pywebview) only inside the
functions that use them, so every module can be imported, and its pure parts tested, on any OS.
"""

from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Callable, Mapping
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Literal, Protocol

Answer = Literal["yes", "no", "cancel"]


class NotSupported(OSError):
    """Something this platform doesn't do yet (Linux: reading the emulator's memory, setup prompts)."""


class Platform(Protocol):
    """The interface of a platform module. Paths take `env` and `home` so they can be checked for any OS anywhere."""

    ID: str  # "windows", "macos", "linux": what /api/about reports
    NAME: str  # "Windows", "macOS", "Linux": for messages and the log

    # Texts that differ by platform.
    MEMORY_ACCESS_HELP: str  # why reading {emulator}'s memory was refused, and what to do
    WEBVIEW_MISSING: str  # the window can't open: the web view isn't there
    NSTOOL_NAME: str
    NSTOOL_MISSING: str  # NSTool wasn't found (bundled on Windows, the user's download elsewhere)

    # Behaviour flags.
    PORT_CHECK_REUSES_ADDRESS: bool  # SO_REUSEADDR in the free-port check (not on Windows, where it'd share a port)
    HIDDEN_CONSOLE_FLAGS: int  # creationflags for a console tool run without a console window

    def data_dir(self, app_name: str, env: Mapping[str, str] | None = None, home: Path | None = None) -> Path:
        """The per-user folder for the app's data (also where its log is)."""

    def eden_user_dirs(self, env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
        """Where Eden keeps its user folder (nand/user/save/...)."""

    def ryujinx_roots(self, env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
        """Where Ryujinx and its forks keep their data."""

    def nstool_candidates(self, home: Path | None = None) -> list[Path]:
        """Where else to look for NSTool, after the bundled and vendored copies."""

    def check_nstool(self, tool: Path, download: str) -> None:
        """Raise ValueError, saying how to fix it, when NSTool can't run."""

    def folder_name_problem(self, parts: tuple[str, ...]) -> str | None:
        """Why these path parts can't name a new folder here (Windows' reserved names), or None."""

    def runs_program(self, executable: str) -> bool:
        """Whether a program with this executable name (lower case) can run on this computer."""

    def webview_caches(self, data_dir: Path, home: Path | None = None) -> list[Path]:
        """The web view's caches, cleared when a new version is installed (its page storage is kept)."""

    def trusted_roots(self) -> str | None:
        """PEM certificates to trust when Python has none of its own, or None."""

    def open_folder(self, path: Path) -> None:
        """Open a folder in the file manager. Raises OSError if it can't."""

    def error_box(self, message: str, title: str = "Divine Pulse") -> None:
        """Tell the user about an error that stops the app. Never raises."""

    def ask(self, message: str, title: str) -> Answer:
        """A Yes / No / Cancel question. Raises NotSupported where there's no way to ask."""

    def wait_for_exit(self, pid: int, timeout_s: float) -> bool:
        """Wait for a process to end. True once it's gone (or was already)."""

    def memory(self) -> ModuleType:
        """The process-memory module: find_processes, process_paths and Process (see app.system.memory)."""

    def window(self) -> WindowBehaviour:
        """How the desktop window behaves here (see WindowBehaviour)."""


def launch(command: list[str]) -> None:
    """Start a program and don't wait for it."""
    try:
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError as exc:
        raise OSError(f"{command[0]} isn't available on this computer.") from exc


def wait_by_polling(pid: int, timeout_s: float, ended: Callable[[int], bool]) -> bool:
    """Wait for a process to end, checking every 50 ms with `ended`."""
    deadline = time.monotonic() + timeout_s
    while not ended(pid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)
    return True


def signal_says_gone(pid: int) -> bool | None:
    """True when no process has this pid, False when one does (even another user's), None when it's ours: then only
    the OS can tell whether it has ended and waits for its parent to collect it (a zombie)."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return None


def check_executable(tool: Path, download: str, blocked: str | None = None) -> None:
    """For macOS and Linux: raise ValueError when `tool` isn't executable or can't start. `blocked` is the message
    for a tool killed by a signal on its first run (macOS's Gatekeeper does that to an unapproved download)."""
    if not os.access(tool, os.X_OK):
        raise ValueError(f"NSTool ({tool}) isn't executable. Download it again from {download} and unzip it.")
    try:
        result = subprocess.run([str(tool)], capture_output=True, timeout=30)
    except OSError as exc:
        raise ValueError(f"NSTool ({tool}) couldn't start: {exc}. Download it again from {download}.") from exc
    except subprocess.TimeoutExpired:
        return  # it runs
    if result.returncode < 0:
        raise ValueError(blocked.format(path=tool) if blocked else
                         f"NSTool ({tool}) was stopped as it started (signal {-result.returncode}).")


def env_dir(env: Mapping[str, str], name: str, default: Path) -> Path:
    """An XDG-style folder: the variable when it's set to an absolute path, else the default."""
    value = env.get(name, "")
    return Path(value) if value and PurePosixPath(value).is_absolute() else default


class WindowBehaviour:
    """The desktop window's platform-specific parts, used by app.desktop.DesktopApp. This base is plain pywebview
    (what Linux uses): its own bounds for the saved place, its own fullscreen. windows.py and macos.py refine it."""

    gui: str | None = None  # pywebview's renderer, None for its default

    def available(self) -> bool:
        """Whether the web view can be used. Raises or returns False when it can't."""
        import webview  # noqa: F401

        return True

    def saved_place(self, saved: dict) -> dict:
        """The part of the saved place to open the window at."""
        return saved

    def on_screen(self, x: int, y: int) -> bool:
        """Whether a window at x, y would be visible (the window manager keeps it on screen otherwise)."""
        return True

    def before_show(self, window, place: dict | None) -> None:
        """pywebview's before_show: the window is built but not on screen. `place` is a saved place to put it at,
        as current_place made it (one with "physical": True), or None."""

    def current_place(self, window, previous: dict, min_size: tuple[int, int]) -> dict | None:
        """The place to save from the window now, or None to keep the saved one."""
        # A minimized window can report a placeholder position (Windows: -32000, -32000, 160×28).
        if window.x <= -30000 or window.width < min_size[0] // 2:
            return None
        return {"x": window.x, "y": window.y, "width": window.width, "height": window.height, "maximized": False}

    def native_fullscreen(self, window, want: bool) -> bool:
        """Enter or leave the OS's own full screen, if the platform uses it instead of pywebview's toggle. True when
        it did (macOS), False to use pywebview's toggle_fullscreen."""
        return False

    def restore_place(self, window, place: dict) -> None:
        """After leaving pywebview's fullscreen: go back to the saved windowed place."""
        if place.get("maximized"):
            window.maximize()

    def focus(self, window) -> None:
        """Bring the window to the front (a second launch asks for it)."""
        window.show()
        # Nudge it to the front: Windows won't always let a background process steal focus.
        window.on_top = True
        window.on_top = False
