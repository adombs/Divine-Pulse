"""Divine Pulse desktop window: pywebview with Microsoft Edge WebView2 on Windows, WebKit (WKWebView) on macOS.

What the window does differently on each OS (the web view check, where it reopens, full screen, coming to the front)
is the platform's WindowBehaviour (system/platform/).
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

import uvicorn

from .config import DATA_DIR, SettingsStore
from .system import platform
from .system.platform import WindowBehaviour

log = logging.getLogger(__name__)

ICON_ICO = Path(__file__).parent / "data" / "icon.ico"

DEFAULT_SIZE = (1500, 940)
MIN_SIZE = (960, 640)
BACKGROUND = "#241a15"  # the dark wood behind the sheet, shown while the page loads


def available(behaviour: WindowBehaviour | None = None) -> bool:
    """Whether the web view is available: WebView2 on Windows, WebKit on macOS, GTK or Qt on Linux."""
    try:
        return bool((behaviour or platform.current().window()).available())
    except Exception:
        log.exception("The web view is unavailable")
        return False


def check_desktop() -> bool:
    """Open and close a hidden window for the packaged build check.

    No server, saved settings or game reader is involved. Importing webview
    alone misses failures (Windows: .NET assemblies) that only happen while creating the window.
    """
    try:
        behaviour = platform.current().window()
        if not available(behaviour):
            return False
        import webview

        loaded = False
        window = webview.create_window("Divine Pulse desktop check", html="<p>Desktop check</p>", hidden=True)

        def on_loaded():
            nonlocal loaded
            loaded = True
            window.destroy()

        window.events.loaded += on_loaded
        webview.start(gui=behaviour.gui)
        return loaded
    except Exception:
        log.exception("Packaged desktop check failed")
        return False


MEDIA_TYPES = {
    "mp4": ("MP4 video (*.mp4)", ".mp4"),
    "png": ("PNG image (*.png)", ".png"),
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MEDIA_LIMIT = 2 * 1024**3  # bytes per file: a long replay at 1080p is a few hundred MB at most


def _is_media(kind: str, head: bytes) -> bool:
    """Whether a file starts the way an MP4 video (an `ftyp` box) or a PNG image does."""
    if kind == "png":
        return head.startswith(PNG_SIGNATURE)
    return len(head) >= 8 and head[4:8] == b"ftyp"


def _free_path(path: Path) -> Path:
    """`path`, or "name (2).ext" and so on when it's taken."""
    n = 2
    candidate = path
    while candidate.exists():
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        n += 1
    return candidate


class _MediaSave:
    """Files being written for one export: each to a .part file beside where it goes, moved there when all is done."""

    def __init__(self, kind: str, paths: list[Path]):
        self.kind = kind
        self.paths = paths
        self.parts = [p.with_name(p.name + ".part") for p in paths]
        self.sizes = [0] * len(paths)
        self.heads = [b""] * len(paths)

    def discard(self) -> None:
        for part in self.parts:
            part.unlink(missing_ok=True)


class ExportDialogs:
    """Expose only user-confirmed Save As operations to the desktop page: a run's JSON export, and the battle
    replay video and team images, whose bytes come over in pieces. Paths come only from the window's own dialogs."""

    def __init__(self):
        self._window = None
        self._saves: dict[str, _MediaSave] = {}
        self._lock = threading.Lock()

    def begin_media_save(self, kind: str, filenames: list[str]) -> str | None:
        """Ask where to save: Save As for one file, a folder for several. Returns a token for the writes, or None if
        the user cancelled."""
        import secrets

        import webview

        if kind not in MEDIA_TYPES or not filenames or len(filenames) > 8:
            raise ValueError("Unsupported export")
        label, suffix = MEDIA_TYPES[kind]
        names = [Path(str(name)).name for name in filenames]
        if any(not name or Path(name).suffix.lower() != suffix for name in names):
            raise ValueError("Unsupported file name")
        if self._window is None:
            raise RuntimeError("The desktop window is not ready")
        if len(names) == 1:
            selected = self._window.create_file_dialog(webview.FileDialog.SAVE, save_filename=names[0], file_types=(label,))
            if not selected:
                return None
            path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
            if path.suffix.lower() != suffix:
                path = path.with_name(path.name + suffix)
            paths = [path]
        else:
            selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            if not selected:
                return None
            folder = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
            paths = [_free_path(folder / name) for name in names]
        token = secrets.token_urlsafe(16)
        save = _MediaSave(kind, paths)
        for part in save.parts:
            part.write_bytes(b"")
        with self._lock:
            self._saves[token] = save
        return token

    def write_media_chunk(self, token: str, index: int, data: str) -> bool:
        import base64

        with self._lock:
            save = self._saves.get(token)
        if save is None or not 0 <= index < len(save.paths):
            raise ValueError("Unknown export")
        chunk = base64.b64decode(data, validate=True)
        if save.sizes[index] + len(chunk) > MEDIA_LIMIT:
            self.cancel_media_save(token)
            raise ValueError("The export is too large")
        if save.sizes[index] < 16:
            save.heads[index] = (save.heads[index] + chunk)[:16]
        with save.parts[index].open("ab") as out:
            out.write(chunk)
        save.sizes[index] += len(chunk)
        return True

    def finish_media_save(self, token: str) -> list[str]:
        """Check each file is what it says it is and put it in place. Returns the saved paths."""
        with self._lock:
            save = self._saves.pop(token, None)
        if save is None:
            raise ValueError("Unknown export")
        if not all(_is_media(save.kind, head) for head in save.heads):
            save.discard()
            raise ValueError("The export isn't a valid file")
        for part, path in zip(save.parts, save.paths):
            part.replace(path)
        return [str(path) for path in save.paths]

    def cancel_media_save(self, token: str) -> bool:
        with self._lock:
            save = self._saves.pop(token, None)
        if save is not None:
            save.discard()
        return save is not None

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
    def __init__(self, url: str, settings: SettingsStore, app_state, server: uvicorn.Server,
                 behaviour: WindowBehaviour | None = None):
        self.url = url
        self.settings = settings
        self.state = app_state
        self.server = server
        self.behaviour = behaviour or platform.current().window()
        self.window = None
        self._quitting = False
        # Settings' window mode "fullscreen": pywebview's fullscreen (on Windows a frameless window over the whole
        # monitor rather than the exclusive kind), or the OS's own (macOS).
        self._fullscreen = False
        self._mode_lock = threading.Lock()

    # Window

    def run(self) -> None:
        """Blocks until the app quits. Must be called on the main thread."""
        import webview

        # The saved place, as far as this OS uses it (macOS keeps the place itself, so a place saved by an earlier
        # version is never used there).
        geo = self.behaviour.saved_place(self.settings.get().window or {})
        width, height = geo.get("width", DEFAULT_SIZE[0]), geo.get("height", DEFAULT_SIZE[1])
        x, y = geo.get("x"), geo.get("y")
        if x is None or y is None or not self.behaviour.on_screen(x, y):
            x = y = None  # let the OS centre it
        # Saved by the OS's own record (Windows' placement): put the window there before it shows. The x/y passed to
        # pywebview below only keep it from centring the window when it shows.
        place = geo if x is not None and geo.get("physical") else None

        exports = ExportDialogs()
        import_route = "&replace_import=1#/settings/game-files" if self.settings.get().replace_import else ""
        self.window = webview.create_window(
            "Divine Pulse",
            # A new address every launch, so the web view always fetches the current page instead of a copy cached
            # by an older version of the tracker (its script and style files are content-hashed, so those stay
            # cached until they change).
            f"{self.url}/?launch={int(time.time())}{import_route}",
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
        self.window.events.before_show += lambda: self.behaviour.before_show(self.window, place)
        # Fullscreen once it's shown (not create_window's fullscreen=True), so the saved place above is where the
        # window goes back to when it's switched to windowed.
        self.window.events.shown += lambda: self.set_window_mode(self.settings.get().window_mode)

        # Lets a second launch focus this window, and Settings switch it to fullscreen and back.
        self.state.show_window = self.show
        self.state.quit_app = self.quit
        self.state.set_window_mode = self.set_window_mode
        self.state.pick_game_dump = self.pick_game_dump
        self.state.pick_game_nsps = self.pick_game_nsps
        self.state.pick_game_keys = self.pick_game_keys

        webview.start(
            gui=self.behaviour.gui,
            private_mode=False,  # keep localStorage (theme, font) between launches
            storage_path=str(DATA_DIR / "webview"),
            icon=str(ICON_ICO),
        )

    def pick_game_dump(self) -> str | None:
        import webview

        selected = self.window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return None
        return str(selected[0] if isinstance(selected, (tuple, list)) else selected)

    def pick_game_nsps(self) -> list[str]:
        import webview

        selected = self.window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=True,
                                                  file_types=("NSP files (*.nsp)",))
        if not selected:
            return []
        return [str(path) for path in selected] if isinstance(selected, (tuple, list)) else [str(selected)]

    def pick_game_keys(self) -> str | None:
        import webview

        selected = self.window.create_file_dialog(webview.FileDialog.OPEN, file_types=("Key files (*.keys)",))
        if not selected:
            return None
        return str(selected[0] if isinstance(selected, (tuple, list)) else selected)

    def set_window_mode(self, mode: str) -> None:
        """Switch the window between "windowed" and "fullscreen"."""
        with self._mode_lock:
            want = mode == "fullscreen"
            if self.window is None:
                return
            try:
                if self.behaviour.native_fullscreen(self.window, want):  # the OS's own, which knows its state
                    self._fullscreen = want
                    return
                if want == self._fullscreen:
                    return
                if want:
                    self._save_geometry()  # the windowed place, to go back to
                    self.window.toggle_fullscreen()
                    self._fullscreen = True
                    return
                self.window.toggle_fullscreen()
                self._fullscreen = False
                self.behaviour.restore_place(self.window, self.settings.get().window or {})
            except Exception:
                log.exception("Could not switch the window to %s", mode)

    def _save_geometry(self) -> None:
        if self.window is None or self._fullscreen:  # keep the windowed place saved before going fullscreen
            return
        try:
            geo = self.behaviour.current_place(self.window, self.settings.get().window or {}, MIN_SIZE)
            if geo is not None:
                self.settings.update(window=geo)
        except Exception:
            log.exception("Could not save window position")

    def _on_closing(self):
        if self._quitting:
            return True
        self._save_geometry()
        self._quitting = True
        return True

    def show(self) -> None:
        """Focus the window when the application is launched a second time."""
        if self.window is not None:
            self.behaviour.focus(self.window)

    def quit(self) -> None:
        self._quitting = True
        self._save_geometry()
        if self.window is not None:
            self.window.destroy()
