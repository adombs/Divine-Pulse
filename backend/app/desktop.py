"""Standalone desktop window (pywebview) plus the system-tray icon.

The window shows the same UI the server hosts; nothing about the app changes except where
it's displayed. Closing the window hides it to the tray so the tracker keeps reading the game;
"Quit" in the tray menu exits. Without a tray icon, closing the window quits.

pywebview uses Edge WebView2 on Windows.
Where there's none, the app opens in the browser instead (see available()).
"""

from __future__ import annotations

import ctypes
import json
import logging
import threading
import time
from pathlib import Path

import uvicorn

from .config import DATA_DIR, SettingsStore

log = logging.getLogger(__name__)

ICON_ICO = Path(__file__).parent / "data" / "icon.ico"
ICON_PNG = Path(__file__).parent / "data" / "icon.png"

DEFAULT_SIZE = (1500, 940)
MIN_SIZE = (960, 640)
BACKGROUND = "#241a15"  # the dark wood behind the sheet, shown while the page loads


def available() -> bool:
    """Whether this PC can show the desktop window (else the app opens in the browser)."""
    try:
        import webview  # noqa: F401

        from webview.platforms.winforms import _is_chromium

        return bool(_is_chromium())  # WebView2 is installed
    except Exception:
        log.exception("Desktop window unavailable; falling back to the browser")
        return False


def _on_some_monitor(x: int, y: int) -> bool:
    """True if the window's top-left area is visible on a connected monitor."""
    px, py = x + 60, y + 20
    try:
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        return bool(ctypes.windll.user32.MonitorFromPoint(POINT(px, py), 0))  # 0: MONITOR_DEFAULTTONULL
    except Exception:
        return True  # can't tell; trust the saved position


# On Windows the window's place is saved as Windows itself keeps it (GetWindowPlacement): the normal (restored) bounds
# in physical pixels, kept while it's maximized or minimized. pywebview's x/y/width/height can't be used for this:
# it divides them by the scaling of the monitor the window is on, but multiplies them by the scaling of the monitor
# it's created on, so a window left on a 125% monitor came back smaller and on the other monitor. Geometry saved this
# way has "physical": True.
SW_HIDE, SW_SHOWNORMAL, SW_SHOWMINIMIZED, SW_SHOWMAXIMIZED = 0, 1, 2, 3
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


class ExportDialogs:
    """Expose only a user-confirmed Save As operation to the desktop page."""

    def __init__(self):
        self._window = None

    def save_export(self, filename: str, content: str) -> bool:
        import webview

        # Validate before opening a dialog; the bridge only saves JSON exports.
        json.loads(content)
        if self._window is None:
            raise RuntimeError("The desktop window is not ready")
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=Path(filename).name,
            file_types=("JSON files (*.json)",),
        )
        if not selected:
            return False
        # The path comes exclusively from the OS dialog, never from Javascript.
        path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
        path.write_text(content, encoding="utf-8")
        return True


class DesktopApp:
    def __init__(self, url: str, settings: SettingsStore, app_state, server: uvicorn.Server):
        self.url = url
        self.settings = settings
        self.state = app_state
        self.server = server
        self.window = None
        self.tray = None
        self._quitting = False
        self._told_about_tray = False
        # Borderless fullscreen (settings.window_mode): pywebview's fullscreen, which on Windows is a frameless
        # window over the whole monitor rather than the exclusive kind.
        self._fullscreen = False
        self._mode_lock = threading.Lock()

    # Window

    def run(self) -> None:
        """Blocks until the app quits. Must be called on the main thread."""
        import webview

        geo = self.settings.get().window or {}
        width, height = geo.get("width", DEFAULT_SIZE[0]), geo.get("height", DEFAULT_SIZE[1])
        x, y = geo.get("x"), geo.get("y")
        if x is None or y is None or not _on_some_monitor(x, y):
            x = y = None  # let Windows centre it
        # Saved by window_geometry (Windows): put the window there before it shows. The x/y passed to pywebview below
        # only keep it from centring the window when it shows.
        placed = x is not None and bool(geo.get("physical"))

        exports = ExportDialogs()
        self.window = webview.create_window(
            "Divine Pulse",
            # A new address every launch, so WebView2 always fetches the current page instead of a copy cached
            # by an older version of the tracker (its script and style files are content-hashed, so those stay
            # cached until they change).
            f"{self.url}/?launch={int(time.time())}",
            width=max(MIN_SIZE[0], width),
            height=max(MIN_SIZE[1], height),
            x=x,
            y=y,
            min_size=MIN_SIZE,
            maximized=bool(geo.get("maximized")),
            background_color=BACKGROUND,
            text_select=True,
            js_api=exports,
        )
        exports._window = self.window
        self.window.events.closing += self._on_closing
        if placed:
            self.window.events.before_show += lambda: self._place(geo)
        # Fullscreen once it's shown (not create_window's fullscreen=True), so the saved place above is where the
        # window goes back to when it's switched to windowed.
        self.window.events.shown += lambda: self.set_window_mode(self.settings.get().window_mode)

        # Lets a second launch (and the tray) bring this window back, and Settings switch it to fullscreen and back.
        self.state.show_window = self.show
        self.state.set_window_mode = self.set_window_mode
        self.state.pick_game_dump = self.pick_game_dump
        self._start_tray()

        webview.start(
            gui="edgechromium",
            private_mode=False,  # keep localStorage (theme, font) between launches
            storage_path=str(DATA_DIR / "webview"),
            icon=str(ICON_ICO),
        )
        # The window is gone: shut everything else down.
        self._stop_tray()
        self.state.events.close()
        self.server.should_exit = True

    def pick_game_dump(self) -> str | None:
        import webview

        selected = self.window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return None
        return str(selected[0] if isinstance(selected, (tuple, list)) else selected)

    def _hwnd(self) -> int | None:
        try:
            return int(self.window.native.Handle.ToInt64())
        except Exception:
            return None

    def _is(self, check: str) -> bool:
        """Ask Windows directly: "IsIconic" (minimized) or "IsZoomed" (maximized). False elsewhere."""
        hwnd = self._hwnd()
        return bool(hwnd and getattr(ctypes.windll.user32, check)(hwnd))

    def _place(self, geo: dict) -> None:
        """before_show (Windows): put the window back where it was. It's still hidden here; pywebview shows it
        (maximized if it was) right after."""
        hwnd = self._hwnd()
        if not hwnd:
            return
        try:
            place_window(hwnd, geo)
            log.info("Window placed at %s (asked for %s)", window_geometry(hwnd), geo)
        except Exception:
            log.exception("Could not put the window back where it was")

    def set_window_mode(self, mode: str) -> None:
        """Switch the window between "windowed" and "fullscreen" (borderless, over its monitor)."""
        with self._mode_lock:
            want = mode == "fullscreen"
            if self.window is None or want == self._fullscreen:
                return
            try:
                if want:
                    self._save_geometry()  # the windowed place, to go back to
                    self.window.toggle_fullscreen()
                    self._fullscreen = True
                    return
                self.window.toggle_fullscreen()
                self._fullscreen = False
                geo = self.settings.get().window or {}
                hwnd = self._hwnd()
                if hwnd and geo.get("physical"):
                    place_window(hwnd, geo, SW_SHOWMAXIMIZED if geo.get("maximized") else SW_SHOWNORMAL)
                elif geo.get("maximized"):
                    self.window.maximize()
            except Exception:
                log.exception("Could not switch the window to %s", mode)

    def _save_geometry(self) -> None:
        w = self.window
        if w is None or self._fullscreen:  # keep the windowed place saved before going fullscreen
            return
        try:
            hwnd = self._hwnd()
            if hwnd:  # Windows: its own record, right for any monitor and scaling, even while minimized
                self.settings.update(window=window_geometry(hwnd))
                return
            previous = self.settings.get().window or {}
            # A minimized window reports a placeholder position (-32000, -32000, 160×28).
            if self._is("IsIconic") or w.x <= -30000 or w.width < MIN_SIZE[0] // 2:
                return
            if self._is("IsZoomed"):
                # Keep the normal-size bounds; just remember it was maximized.
                geo = {**previous, "maximized": True}
            else:
                geo = {"x": w.x, "y": w.y, "width": w.width, "height": w.height, "maximized": False}
            self.settings.update(window=geo)
        except Exception:
            log.exception("Could not save window position")

    def _on_closing(self):
        if self._quitting:
            return True
        self._save_geometry()
        if self.tray is None:  # nowhere to bring the window back from: closing it quits
            self._quitting = True
            return True
        # Hide instead of closing so the tracker keeps reading the game. (Hide from another thread:
        # this handler runs inside the window's own close event.)
        threading.Thread(target=self.window.hide, daemon=True).start()
        if not self._told_about_tray and self.tray is not None:
            self._told_about_tray = True
            try:
                self.tray.notify("Still running in the tray. Right-click the icon to quit.", "Divine Pulse")
            except Exception:
                pass
        return False  # cancel the close

    def show(self) -> None:
        """Bring the window back (from the tray, or when launched a second time)."""
        if self.window is None:
            return
        self.window.show()
        hwnd = self._hwnd()
        if hwnd and self._is("IsIconic"):
            # SW_RESTORE returns to the previous state, so a maximized window comes back maximized.
            ctypes.windll.user32.ShowWindow(hwnd, 9)
        # Nudge it to the front: Windows won't always let a background process steal focus.
        self.window.on_top = True
        self.window.on_top = False

    def quit(self) -> None:
        self._quitting = True
        self._save_geometry()
        self._stop_tray()
        if self.window is not None:
            self.window.destroy()

    # Tray

    def _start_tray(self) -> None:
        try:
            import pystray
            from PIL import Image
        except Exception:
            log.exception("System tray unavailable")
            return

        menu = pystray.Menu(
            pystray.MenuItem("Show window", lambda *_: self.show(), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", lambda *_: self.quit()),
        )
        self.tray = pystray.Icon("divine-pulse", Image.open(ICON_PNG), "Divine Pulse", menu=menu)

        # The tray runs on a thread while the window owns the main thread.
        threading.Thread(target=self.tray.run, name="tray", daemon=True).start()

    def _stop_tray(self) -> None:
        if self.tray is not None:
            try:
                self.tray.stop()
            except Exception:
                pass
            self.tray = None
