"""Linux: XDG folders, xdg-open, /proc and pywebview's Qt window (QtWebEngine, a Chromium engine like WebView2; GTK's
WebKitGTK when Qt isn't installed)."""

from __future__ import annotations

import importlib.util
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

from .base import Answer, NotSupported, WindowBehaviour, check_executable, env_dir, launch, signal_says_gone, wait_by_polling

log = logging.getLogger(__name__)

ID = "linux"
NAME = "Linux"

MEMORY_ACCESS_HELP = (
    "Linux won't let the tracker read {emulator}'s memory. Run it as the same user as Divine Pulse. In Ryubing, set "
    "Settings > CPU > Memory Manager Mode to one of the Host modes (its default)."
)
WEBVIEW_MISSING = (
    "Divine Pulse couldn't open its window: it needs a graphical session and Qt WebEngine (python packages PyQt6, "
    "PyQt6-WebEngine and QtPy; the downloaded program has them built in)."
)
NSTOOL_NAME = "nstool"
NSTOOL_MISSING = (
    "NSTool wasn't found. Download the latest Linux release (ubuntu_x86_64) from {download}, unzip it, and leave it in "
    "your Downloads folder or put it on your PATH. Or import a dump folder instead."
)

PORT_CHECK_REUSES_ADDRESS = True
HIDDEN_CONSOLE_FLAGS = 0

DESKTOP_ID = "divine-pulse"  # packaging/linux/install.sh's .desktop file, which gives the window its icon on Wayland
# What PyInstaller and pywebview set for this program, wrong for any other one started from it.
OWN_VARIABLES = ("LD_LIBRARY_PATH", "QT_PLUGIN_PATH", "QML2_IMPORT_PATH", "QT_STYLE_OVERRIDE", "QTWEBENGINE_CHROMIUM_FLAGS")


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def _home(home: Path | None) -> Path:
    return Path.home() if home is None else home


def data_dir(app_name: str, env: Mapping[str, str] | None = None, home: Path | None = None) -> Path:
    """$XDG_DATA_HOME/<app>, by default ~/.local/share/<app>."""
    return env_dir(_env(env), "XDG_DATA_HOME", _home(home) / ".local" / "share") / app_name


def _flatpaks(home: Path | None, *folder: str) -> list[Path]:
    """The folders of this name that Flatpak apps have (~/.var/app/<app>/...): Eden's, Ryubing's, RetroDECK's."""
    try:
        apps = sorted((_home(home) / ".var" / "app").iterdir())
    except OSError:
        return []
    return [found for app in apps if (found := app.joinpath(*folder)).is_dir()]


def eden_user_dirs(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    native = env_dir(_env(env), "XDG_DATA_HOME", _home(home) / ".local" / "share") / "eden"
    return [native, *_flatpaks(home, "data", "eden")]


def ryujinx_roots(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    native = env_dir(_env(env), "XDG_CONFIG_HOME", _home(home) / ".config") / "Ryujinx"
    return [native, *_flatpaks(home, "config", "Ryujinx")]


def nstool_candidates(home: Path | None = None) -> list[Path]:
    """On PATH, or where a download ends up: the bare file, or in the folder its zip unpacked to (newest first)."""
    on_path = shutil.which("nstool")
    spots = [Path(on_path)] if on_path else []
    for folder in (_home(home) / "Downloads", _home(home) / "Desktop"):
        spots.append(folder / "nstool")
        try:
            spots += sorted((p / "nstool" for p in folder.glob("nstool*") if p.is_dir()), reverse=True)
        except OSError:
            continue
    return spots


def check_nstool(tool: Path, download: str) -> None:
    if not os.access(tool, os.X_OK):
        raise ValueError(f"NSTool ({tool}) isn't executable. Run: chmod +x '{tool}', then import again.")
    check_executable(tool, download, env=child_env())


def folder_name_problem(parts: tuple[str, ...]) -> str | None:
    return None


def runs_program(executable: str) -> bool:
    return not executable.endswith(".exe")


def webview_caches(data_dir: Path, home: Path | None = None) -> list[Path]:
    """QtWebEngine's cache (its page storage is in data_dir/webview and stays)."""
    return [env_dir({} if home is not None else os.environ, "XDG_CACHE_HOME", _home(home) / ".cache") / data_dir.name / "QtWebEngine"]


def child_env() -> dict[str, str] | None:
    """The packaged program runs with its own libraries first, which would break other programs: they get the
    environment it was started with."""
    if not getattr(sys, "frozen", False):
        return None
    env = {k: v for k, v in os.environ.items() if k not in OWN_VARIABLES}
    if original := os.environ.get("LD_LIBRARY_PATH_ORIG"):  # as PyInstaller's launcher found it
        env["LD_LIBRARY_PATH"] = original
    env.pop("LD_LIBRARY_PATH_ORIG", None)
    return env


def trusted_roots() -> str | None:
    """The packaged program's Python looks for certificates only where the build machine's OpenSSL keeps them, which
    other distributions may not have: then the distribution's own bundle is used."""
    for path in ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/ca-bundle.pem",
                 "/etc/ssl/cert.pem"):
        try:
            roots = Path(path).read_text("utf-8", errors="replace")
        except OSError:
            continue
        if "BEGIN CERTIFICATE" in roots:
            return roots
    return None


def open_folder(path: Path) -> None:
    launch(["xdg-open", str(path)], child_env())


# Dialogs


def has_qt() -> bool:
    """Whether the Qt window can be used (PyQt6 with QtWebEngine, through QtPy as pywebview needs it)."""
    def there(name: str) -> bool:
        return importlib.util.find_spec(name) is not None

    return there("qtpy") and there("PyQt6") and there("PyQt6.QtWebEngineWidgets")


def has_display(env: Mapping[str, str] | None = None) -> bool:
    """Whether there is a graphical session (Qt ends the whole program when it finds none)."""
    env = _env(env)
    return bool(env.get("WAYLAND_DISPLAY") or env.get("DISPLAY") or env.get("QT_QPA_PLATFORM"))


def _qt_message(message: str, title: str, question: bool) -> Answer | None:
    """A Qt message box; the answer, or None where Qt can't show one."""
    if not (has_qt() and has_display() and threading.current_thread() is threading.main_thread()):
        return None
    prepare_qt()
    # QtWebEngine must be imported before the QApplication, which pywebview then uses too.
    from PyQt6 import QtWebEngineWidgets  # noqa: F401
    from PyQt6.QtWidgets import QApplication, QMessageBox

    app = QApplication.instance() or QApplication(sys.argv[:1])
    box = QMessageBox()
    box.setWindowTitle(title)
    box.setText(message)
    buttons = QMessageBox.StandardButton
    if question:
        box.setIcon(QMessageBox.Icon.Question)
        box.setStandardButtons(buttons.Yes | buttons.No | buttons.Cancel)
        box.setEscapeButton(buttons.Cancel)  # closing it, too
    else:
        box.setIcon(QMessageBox.Icon.Critical)
    clicked = box.exec()
    _keep.append(app)
    return "yes" if clicked == buttons.Yes else "no" if clicked == buttons.No else "cancel"


_keep: list[object] = []  # the QApplication, which must outlive the message box


def _zenity(*args: str) -> subprocess.CompletedProcess[str] | None:
    if not shutil.which("zenity"):
        return None
    return subprocess.run(["zenity", *args], capture_output=True, text=True, timeout=600, check=False, env=child_env())


def error_box(message: str, title: str = "Divine Pulse") -> None:
    """A Qt message box, or zenity's or kdialog's; the log (and stderr) always."""
    log.error("%s: %s", title, message)
    print(f"{title}: {message}", file=sys.stderr)
    try:
        if _qt_message(message, title, question=False) is not None:
            return
        if _zenity("--error", "--no-markup", f"--title={title}", f"--text={message}") is None and shutil.which("kdialog"):
            subprocess.run(["kdialog", "--title", title, "--error", message], timeout=600, check=False, env=child_env())
    except Exception:
        log.exception("Couldn't show the error: %s", message)


def ask(message: str, title: str) -> Answer:
    """A Qt message box, or zenity's. Closing it, or anything but a button, is Cancel: No can delete records."""
    if (answer := _qt_message(message, title, question=True)) is not None:
        return answer
    result = _zenity("--question", "--no-markup", f"--title={title}", f"--text={message}", "--ok-label=Yes",
                     "--cancel-label=Cancel", "--extra-button=No")
    if result is None:
        raise NotSupported("Divine Pulse needs Qt or zenity to ask a setup question.")
    if result.returncode == 0:
        return "yes"
    return "no" if result.stdout.strip() == "No" else "cancel"


def _ended(pid: int) -> bool:
    gone = signal_says_gone(pid)
    if gone is not None:
        return gone
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return True
    return stat.rsplit(")", 1)[-1].split()[:1] == ["Z"]  # the state after "(comm)": Z is a zombie


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    return wait_by_polling(pid, timeout_s, _ended)


def memory() -> ModuleType:
    from .. import memory_linux

    return memory_linux


# The window


def _sysctl(name: str) -> str:
    try:
        return Path("/proc/sys", *name.split(".")).read_text().strip()
    except OSError:
        return ""


def sandbox_blocked() -> bool:
    """Whether the system stops Chromium's sandbox from starting, which would stop the window from opening: Ubuntu's
    AppArmor rule and some kernels let only approved programs make the namespaces it needs, and it refuses to run as
    root. The window only ever shows this app's own page, from this computer."""
    return (
        _sysctl("kernel.apparmor_restrict_unprivileged_userns") == "1"
        or _sysctl("kernel.unprivileged_userns_clone") == "0"
        or _sysctl("user.max_user_namespaces") == "0"
        or (hasattr(os, "geteuid") and os.geteuid() == 0)
    )


def prepare_qt() -> None:
    """What Qt reads from the environment, before it's imported."""
    os.environ.setdefault("QT_API", "pyqt6")
    if sandbox_blocked():
        os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")


def release_page_waits(native, timeout_s: float = 5.0) -> bool:
    """End pywebview's threads that wait for the page to answer. Each load starts one (its generate_js_object, not a
    daemon), and a window closed before the answer came would leave it waiting, and the program running, for good.
    True once none is left."""
    deadline = time.monotonic() + timeout_s
    while True:
        waiting = [t for t in threading.enumerate()
                   if not t.daemon and t is not threading.main_thread() and t is not threading.current_thread()]
        if not waiting:
            return True
        if time.monotonic() >= deadline:
            log.warning("Still running after the window closed: %s", ", ".join(t.name for t in waiting))
            return False
        for result in list(getattr(native, "_js_results", {}).values()):
            result["semaphore"].release()
        time.sleep(0.02)


class _Browser(webbrowser.BaseBrowser):
    """Opens links with the environment other programs need (child_env)."""

    def open(self, url: str, new: int = 0, autoraise: bool = True) -> bool:
        try:
            launch(["xdg-open", url], child_env())
        except OSError:
            return False
        return True


class Window(WindowBehaviour):
    """pywebview's Qt window, with its own bounds and fullscreen (the base behaviour)."""

    @property
    def gui(self) -> str | None:  # type: ignore[override]
        return "qt" if has_qt() else "gtk" if importlib.util.find_spec("gi") is not None else None

    def available(self) -> bool:
        if self.gui is None or not has_display():
            return False
        if self.gui == "qt":
            prepare_qt()
            from PyQt6 import QtWebEngineWidgets  # noqa: F401 (its libraries load)
            from PyQt6.QtGui import QGuiApplication

            QGuiApplication.setDesktopFileName(DESKTOP_ID)
        if getattr(sys, "frozen", False):
            webbrowser.register("divine-pulse-xdg-open", None, _Browser("xdg-open"), preferred=True)
        import webview  # noqa: F401

        return True

    def current_place(self, window, previous: dict, min_size: tuple[int, int]) -> dict | None:
        native = getattr(window, "native", None)
        if native is not None and hasattr(native, "isMaximized"):  # Qt's window
            if native.isMinimized():
                return None
            if native.isMaximized():
                return {**previous, "maximized": True}  # keep the normal bounds
        return super().current_place(window, previous, min_size)

    def closed(self, window) -> None:
        if (native := getattr(window, "native", None)) is not None and hasattr(native, "_js_results"):  # Qt's window
            release_page_waits(native)

    def focus(self, window) -> None:
        native = getattr(window, "native", None)
        if native is None or not hasattr(native, "windowHandle"):
            super().focus(window)
            return
        from PyQt6.QtCore import QMetaObject, Qt

        # Not on_top, as elsewhere: Qt hides and shows the window again to change it. This isn't the window's thread.
        if native.isMinimized():
            window.restore()
        window.show()
        queued = Qt.ConnectionType.QueuedConnection
        QMetaObject.invokeMethod(native, "raise", queued)
        if (handle := native.windowHandle()) is not None:
            QMetaObject.invokeMethod(handle, "requestActivate", queued)


def window() -> Window:
    return Window()


def game_watch() -> None:
    """Launch with Game is Windows-only."""
    return None
