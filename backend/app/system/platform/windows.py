"""Windows: %LOCALAPPDATA%, Explorer, MessageBoxW, WebView2 and Windows' own window placement."""

from __future__ import annotations

import ctypes
import logging
import os
import re
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

from .base import Answer, WindowBehaviour, launch

log = logging.getLogger(__name__)

ID = "windows"
NAME = "Windows"

MEMORY_ACCESS_HELP = (
    "Windows won't let the tracker read {emulator}'s memory. If {emulator} runs as administrator, run the tracker as "
    "administrator too."
)
WEBVIEW_MISSING = "Divine Pulse requires Microsoft Edge WebView2 on Windows."
NSTOOL_NAME = "nstool.exe"
NSTOOL_MISSING = "Bundled NSTool was not found. Reinstall the application."

PORT_CHECK_REUSES_ADDRESS = False  # on Windows SO_REUSEADDR would let a bind take a port another program listens on
HIDDEN_CONSOLE_FLAGS = 0x08000000  # CREATE_NO_WINDOW

_RESERVED_NAME = re.compile(r"(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?")
_BAD_CHARACTERS = re.compile(r'[<>:"|?*\x00-\x1f]')


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def _home(home: Path | None) -> Path:
    return Path.home() if home is None else home


def data_dir(app_name: str, env: Mapping[str, str] | None = None, home: Path | None = None) -> Path:
    base = _env(env).get("LOCALAPPDATA") or str(_home(home) / "AppData" / "Local")
    return Path(base) / app_name


def _roaming(env: Mapping[str, str] | None) -> Path | None:
    appdata = _env(env).get("APPDATA")
    return Path(appdata) if appdata else None


def eden_user_dirs(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    """%APPDATA%/eden."""
    roaming = _roaming(env)
    return [roaming / "eden"] if roaming else []


def ryujinx_roots(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    """%APPDATA%/Ryujinx (Ryubing, Ryujinx)."""
    roaming = _roaming(env)
    return [roaming / "Ryujinx"] if roaming else []


def nstool_candidates(home: Path | None = None) -> list[Path]:
    return []  # bundled with the program (tools/nstool.exe)


def check_nstool(tool: Path, download: str) -> None:
    """The bundled copy runs (a downloaded one that Windows marked as from the Internet still runs)."""


def folder_name_problem(parts: tuple[str, ...]) -> str | None:
    if any(_BAD_CHARACTERS.search(part) or part.endswith((".", " ")) or _RESERVED_NAME.fullmatch(part) for part in parts):
        return "Choose a valid Windows folder name for the new dump folder."
    return None


def runs_program(executable: str) -> bool:
    return True  # Windows programs (.exe), and the same names elsewhere are Windows builds too


def webview_caches(data_dir: Path, home: Path | None = None) -> list[Path]:
    """WebView2's profile caches (its storage_path is data_dir/webview)."""
    profile = data_dir / "webview" / "EBWebView" / "Default"
    return [profile / name for name in ("Cache", "Code Cache", "GPUCache", "Service Worker")]


def trusted_roots() -> str | None:
    return None  # Windows' Python reads the system's certificate store itself


def open_folder(path: Path) -> None:
    launch(["explorer", str(path)])


MB_ICONERROR, MB_YESNOCANCEL_QUESTION = 0x10, 0x23
IDCANCEL, IDYES, IDNO = 2, 6, 7


def error_box(message: str, title: str = "Divine Pulse") -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, MB_ICONERROR)
    except Exception:
        log.exception("Couldn't show the error: %s", message)


def ask(message: str, title: str) -> Answer:
    answer = ctypes.windll.user32.MessageBoxW(None, message, title, MB_YESNOCANCEL_QUESTION)
    return "yes" if answer == IDYES else "no" if answer == IDNO else "cancel"


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        return True
    try:
        return kernel32.WaitForSingleObject(handle, int(timeout_s * 1000)) == 0  # WAIT_OBJECT_0
    finally:
        kernel32.CloseHandle(handle)


def memory() -> ModuleType:
    from .. import memory_windows

    return memory_windows


# The window's place is saved as Windows itself keeps it (GetWindowPlacement): the normal (restored) bounds in
# physical pixels, kept while it's maximized or minimized. pywebview's x/y/width/height can't be used for this: it
# divides them by the scaling of the monitor the window is on, but multiplies them by the scaling of the monitor it's
# created on, so a window left on a 125% monitor came back smaller and on the other monitor. Geometry saved this way
# has "physical": True.
SW_HIDE, SW_SHOWNORMAL, SW_SHOWMINIMIZED, SW_SHOWMAXIMIZED, SW_RESTORE = 0, 1, 2, 3, 9
WPF_RESTORETOMAXIMIZED = 0x2


def geometry_from_placement(show_cmd: int, flags: int, rect: tuple[int, int, int, int]) -> dict:
    """The geometry to save from a window placement: its normal bounds, and whether it's maximized (also when it
    was minimized from maximized)."""
    left, top, right, bottom = rect
    maximized = show_cmd == SW_SHOWMAXIMIZED or (show_cmd == SW_SHOWMINIMIZED and bool(flags & WPF_RESTORETOMAXIMIZED))
    return {"x": left, "y": top, "width": right - left, "height": bottom - top, "maximized": maximized, "physical": True}


def _placement_struct():
    from ctypes import wintypes

    class WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [
            ("length", wintypes.UINT),
            ("flags", wintypes.UINT),
            ("showCmd", wintypes.UINT),
            ("ptMinPosition", wintypes.POINT),
            ("ptMaxPosition", wintypes.POINT),
            ("rcNormalPosition", wintypes.RECT),
        ]

    wp = WINDOWPLACEMENT()
    wp.length = ctypes.sizeof(WINDOWPLACEMENT)
    return wp


def window_geometry(hwnd: int) -> dict:
    """Where a window is, as Windows keeps it (see geometry_from_placement)."""
    wp = _placement_struct()
    if not ctypes.windll.user32.GetWindowPlacement(hwnd, ctypes.byref(wp)):
        raise ctypes.WinError()
    r = wp.rcNormalPosition
    return geometry_from_placement(wp.showCmd, wp.flags, (r.left, r.top, r.right, r.bottom))


def place_window(hwnd: int, geo: dict, show_cmd: int = SW_HIDE) -> None:
    """Give a window the normal bounds saved by window_geometry. Done twice: when the move takes the window to a
    monitor with another scaling, Windows resizes it for that scaling, and the second time the bounds stick."""
    wp = _placement_struct()
    wp.showCmd = show_cmd
    r = wp.rcNormalPosition
    r.left, r.top, r.right, r.bottom = geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + geo["height"]
    for _ in range(2):
        if not ctypes.windll.user32.SetWindowPlacement(hwnd, ctypes.byref(wp)):
            raise ctypes.WinError()


class Window(WindowBehaviour):
    """WebView2, and the place as Windows keeps it (see place_window)."""

    gui = "edgechromium"

    def available(self) -> bool:
        import webview  # noqa: F401
        from webview.platforms.winforms import _is_chromium

        return bool(_is_chromium())  # WebView2 is installed

    def on_screen(self, x: int, y: int) -> bool:
        """Whether the window's top-left area is on a connected monitor."""
        try:
            class POINT(ctypes.Structure):
                _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

            return bool(ctypes.windll.user32.MonitorFromPoint(POINT(x + 60, y + 20), 0))  # MONITOR_DEFAULTTONULL
        except Exception:
            return True  # can't tell; trust the saved position

    @staticmethod
    def hwnd(window) -> int | None:
        try:
            return int(window.native.Handle.ToInt64())
        except Exception:
            return None

    def before_show(self, window, place: dict | None) -> None:
        """Put the window back where it was. It's still hidden here; pywebview shows it (maximized if it was) right
        after."""
        hwnd = self.hwnd(window) if place else None
        if not hwnd:
            return
        try:
            place_window(hwnd, place)
            log.info("Window placed at %s (asked for %s)", window_geometry(hwnd), place)
        except Exception:
            log.exception("Could not put the window back where it was")

    def current_place(self, window, previous: dict, min_size: tuple[int, int]) -> dict | None:
        hwnd = self.hwnd(window)
        if hwnd:  # Windows' own record, right for any monitor and scaling, even while minimized
            return window_geometry(hwnd)
        return super().current_place(window, previous, min_size)

    def restore_place(self, window, place: dict) -> None:
        hwnd = self.hwnd(window)
        if hwnd and place.get("physical"):
            place_window(hwnd, place, SW_SHOWMAXIMIZED if place.get("maximized") else SW_SHOWNORMAL)
        else:
            super().restore_place(window, place)

    def focus(self, window) -> None:
        window.show()
        hwnd = self.hwnd(window)
        if hwnd and ctypes.windll.user32.IsIconic(hwnd):
            # SW_RESTORE returns to the previous state, so a maximized window comes back maximized.
            ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
        window.on_top = True
        window.on_top = False


def window() -> Window:
    return Window()
