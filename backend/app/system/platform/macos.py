"""macOS: ~/Library, Finder, AppleScript dialogs, libproc, WebKit and AppKit's own window frame and full screen."""

from __future__ import annotations

import ctypes
import logging
import os
import shutil
import subprocess
import threading
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

from .base import Answer, WindowBehaviour, check_executable, env_dir, launch, signal_says_gone, wait_by_polling

log = logging.getLogger(__name__)

ID = "macos"
NAME = "macOS"

MEMORY_ACCESS_HELP = (
    "macOS won't let the tracker read {emulator}'s memory. Use a build of {emulator} that allows debugging "
    "(Astris's releases do), and restart it after updating."
)
WEBVIEW_MISSING = "Divine Pulse couldn't open its window: macOS's WebKit isn't available to it (pywebview isn't working)."
NSTOOL_NAME = "nstool"
NSTOOL_MISSING = (
    "NSTool wasn't found. Download the latest macOS release from {download} (macos_arm64 for Apple silicon, "
    "macos_x64 for Intel), unzip it, and put the nstool file in your Applications or Downloads folder. Or import a "
    "dump folder instead."
)
NSTOOL_BLOCKED = (
    "macOS blocked NSTool ({path}) because it was downloaded from the internet. Open System Settings > Privacy & "
    "Security, click Allow Anyway next to \"nstool\", then import again (choose Open if macOS asks)."
)

PORT_CHECK_REUSES_ADDRESS = True  # as uvicorn binds: a port this app let go a moment ago (TIME_WAIT) is free
HIDDEN_CONSOLE_FLAGS = 0

# The packaged app's bundle identifier (packaging/divine_pulse.spec): WebKit keeps its caches under it.
BUNDLE_ID = "io.github.adombs.divine-pulse"
# macOS's own trusted roots, for a Python that has no certificate file of its own (see trusted_roots).
SYSTEM_ROOTS = "/System/Library/Keychains/SystemRootCertificates.keychain"
ASTRIS_CONTAINER = Path("Library") / "Containers" / "V380-Ori.Astris" / "Data"


def _home(home: Path | None) -> Path:
    return Path.home() if home is None else home


def _support(home: Path | None) -> Path:
    return _home(home) / "Library" / "Application Support"


def data_dir(app_name: str, env: Mapping[str, str] | None = None, home: Path | None = None) -> Path:
    """~/Library/Application Support/<app>: also where the log is, so Settings > About > Open shows it."""
    return _support(home) / app_name


def eden_user_dirs(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    """Eden's macOS builds keep its user folder in ~/Library/Application Support/eden; older ones (as yuzu did)
    in the XDG data folder, ~/.local/share/eden."""
    env = os.environ if env is None else env
    return [_support(home) / "eden", env_dir(env, "XDG_DATA_HOME", _home(home) / ".local" / "share") / "eden"]


def ryujinx_roots(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    """~/Library/Application Support/Ryujinx (Ryubing, Ryujinx), and the same inside Astris's sandbox container."""
    support = Path("Library") / "Application Support" / "Ryujinx"
    return [_home(home) / support, _home(home) / ASTRIS_CONTAINER / support]


def download_spots(home: Path) -> list[Path]:
    """Where a Mac user is likely to have put a downloaded nstool: Applications and Downloads, as the bare file or
    in the folder its zip unpacked to, and Homebrew's and /usr/local's bin (not on a GUI app's PATH)."""
    spots: list[Path] = []
    for folder in (Path("/Applications"), home / "Applications", home / "Downloads", home / "Desktop"):
        spots.append(folder / "nstool")
        try:
            spots += sorted((p / "nstool" for p in folder.glob("nstool*") if p.is_dir()), reverse=True)  # newest first
        except OSError:
            continue
    return spots + [Path("/opt/homebrew/bin/nstool"), Path("/usr/local/bin/nstool")]


def nstool_candidates(home: Path | None = None) -> list[Path]:
    on_path = shutil.which("nstool")
    return ([Path(on_path)] if on_path else []) + download_spots(_home(home))


def check_nstool(tool: Path, download: str) -> None:
    """Not executable, or killed by Gatekeeper on its first run after a browser download, until the user allows
    it in System Settings (the counterpart of Windows' Internet zone, which doesn't stop a program from running)."""
    check_executable(tool, download, NSTOOL_BLOCKED)


def folder_name_problem(parts: tuple[str, ...]) -> str | None:
    return None  # any name but "/" (which can't be in a part) works


# Programs that run on a Mac but whose game the tracker doesn't read there: Eden.
UNREADABLE_PROGRAMS = frozenset({"eden", "eden-cli"})


def runs_program(executable: str) -> bool:
    return not executable.endswith(".exe") and executable not in UNREADABLE_PROGRAMS


def webview_caches(data_dir: Path, home: Path | None = None) -> list[Path]:
    """WKWebView's caches (pywebview uses WebKit's default data store, whose page storage is in
    ~/Library/WebKit/<bundle id> and stays)."""
    return [_home(home) / "Library" / "Caches" / BUNDLE_ID / "WebKit"]


def child_env() -> dict[str, str] | None:
    return None


def trusted_roots() -> str | None:
    """The macOS app's Python looks for certificates only where the build machine's OpenSSL kept them (Homebrew's
    folder), which most Macs don't have: then macOS's own trusted roots are used."""
    try:
        roots = subprocess.run(["/usr/bin/security", "find-certificate", "-a", "-p", SYSTEM_ROOTS],
                               capture_output=True, text=True, timeout=10, check=True).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        log.info("Couldn't read macOS's trusted certificates (%s).", exc)
        return None
    return roots if "BEGIN CERTIFICATE" in roots else None


def open_folder(path: Path) -> None:
    launch(["open", str(path)])


def applescript_text(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def dialog_script(message: str, title: str, buttons: tuple[str, ...], default: str, icon: str = "note") -> str:
    return (
        f"display dialog {applescript_text(message)} with title {applescript_text(title)} "
        f"buttons {{{', '.join(applescript_text(b) for b in buttons)}}} default button {applescript_text(default)} "
        f"with icon {icon}"
    )


def dialog(message: str, title: str, buttons: tuple[str, ...], default: str, icon: str = "note") -> str | None:
    """Show a dialog; the button clicked, or None if it couldn't be shown (or was cancelled)."""
    try:
        result = subprocess.run(["osascript", "-e", dialog_script(message, title, buttons, default, icon)],
                                capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        return None
    prefix = "button returned:"
    return result.stdout.strip()[len(prefix):] if result.stdout.startswith(prefix) else None


def error_box(message: str, title: str = "Divine Pulse") -> None:
    try:
        dialog(message, title, ("OK",), "OK", "stop")
    except Exception:
        log.exception("Couldn't show the error: %s", message)


def ask(message: str, title: str) -> Answer:
    answer = dialog(message, title, ("Cancel", "No", "Yes"), "Yes")
    return "yes" if answer == "Yes" else "no" if answer == "No" else "cancel"


def _ended(pid: int) -> bool:
    """A process that has ended, also one that has ended and waits for its parent to collect it (a zombie)."""
    gone = signal_says_gone(pid)
    if gone is not None:
        return gone
    info = ctypes.create_string_buffer(136)  # struct proc_bsdinfo; pbi_status is the u32 at offset 4
    lib = ctypes.CDLL("/usr/lib/libproc.dylib")
    if lib.proc_pidinfo(ctypes.c_int(pid), 3, ctypes.c_uint64(0), info, ctypes.sizeof(info)) <= 0:  # PROC_PIDTBSDINFO
        return True
    return int.from_bytes(info.raw[4:8], "little") == 5  # SZOMB


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    return wait_by_polling(pid, timeout_s, _ended)


def memory() -> ModuleType:
    from .. import memory_macos

    return memory_macos


# macOS keeps the window's place itself under this name (NSWindow's frame autosave), in the app's preferences: it
# handles several monitors and screens that have gone (the counterpart of Windows' window placement). pywebview's own
# x/y can't be used here: it places a window relative to one screen but reports its place on another, so a window on
# a second monitor drifted further off screen each launch until pywebview crashed opening it.
FRAME_NAME = "Divine Pulse"
NS_FULLSCREEN_PRIMARY = 1 << 7  # NSWindowCollectionBehaviorFullScreenPrimary
NS_FULLSCREEN_MASK = 1 << 14  # NSWindowStyleMaskFullScreen


def keep_frame(native_window) -> None:
    """Put the window where macOS last saw it (if it has), and have macOS remember where it goes from now on; and let
    it go full screen (its green button, and Settings' window mode). Call on the main thread, before it shows."""
    native_window.setFrameUsingName_(FRAME_NAME)
    native_window.setFrameAutosaveName_(FRAME_NAME)
    native_window.setCollectionBehavior_(native_window.collectionBehavior() | NS_FULLSCREEN_PRIMARY)


def tab_to_every_control(web_view) -> None:
    """Have Tab move to links and buttons too, as it does in WebView2. WKWebView otherwise reaches only text fields
    unless the user turned on Keyboard navigation in System Settings (Option-Tab reaches the rest)."""
    web_view.configuration().preferences().setTabFocusesLinks_(True)


def fullscreen(native_window, want: bool) -> None:
    """Enter or leave macOS full screen, going by the window's own state (the user can also leave with its green
    button or Esc). pywebview's toggle can't be used: it marks the window unable to go full screen before toggling."""
    if bool(native_window.styleMask() & NS_FULLSCREEN_MASK) != want:
        native_window.setCollectionBehavior_(native_window.collectionBehavior() | NS_FULLSCREEN_PRIMARY)
        native_window.toggleFullScreen_(None)


def _web_view(window):
    """The WKWebView pywebview built for a window (not yet the window's content view at before_show)."""
    from webview.platforms.cocoa import BrowserView

    instance = BrowserView.instances.get(window.uid)
    return instance.webview if instance is not None else None


def _on_main_thread(action) -> None:
    from PyObjCTools import AppHelper

    # pywebview fires before_show on the main thread, as it builds the window: then before it's on screen.
    if threading.current_thread() is threading.main_thread():
        action()
    else:
        AppHelper.callAfter(action)


class Window(WindowBehaviour):
    """WKWebView; AppKit keeps the place (keep_frame) and does full screen (fullscreen)."""

    def available(self) -> bool:
        import webview  # noqa: F401
        import WebKit

        return hasattr(WebKit, "WKWebView")  # the counterpart of Windows' WebView2 check

    def saved_place(self, saved: dict) -> dict:
        return {}  # a place saved by an earlier version is never used: macOS keeps it (keep_frame)

    def before_show(self, window, place: dict | None) -> None:
        def prepare() -> None:
            try:
                keep_frame(window.native)
            except Exception:
                log.exception("Could not restore the window's place")
            try:
                if (web_view := _web_view(window)) is not None:
                    tab_to_every_control(web_view)
            except Exception:
                log.exception("Could not let Tab reach every control")

        _on_main_thread(prepare)

    def current_place(self, window, previous: dict, min_size: tuple[int, int]) -> dict | None:
        return None  # macOS saves the place itself

    def native_fullscreen(self, window, want: bool) -> bool:
        from PyObjCTools import AppHelper

        AppHelper.callAfter(fullscreen, window.native, want)
        return True


def window() -> Window:
    return Window()
