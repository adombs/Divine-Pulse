"""Launch the Divine Pulse desktop window on Windows."""

from __future__ import annotations

import json
import ctypes
import logging
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn

from logging.handlers import RotatingFileHandler

from . import __version__
from .config import DATA_DIR, FROZEN, SettingsStore
from .domain.settings import DEFAULT_PORT
from .system import error_box, wait_for_exit

HOST = "127.0.0.1"
log = logging.getLogger("app")


def _already_running(url: str) -> bool:
    """This tracker, with this data folder, is serving `url`. Another copy of it with another data folder (a developer's
    demo server, say) is just another program on the port."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=1) as r:
            if json.load(r).get("app") != "divine-pulse":
                return False
        with urllib.request.urlopen(f"{url}/api/about", timeout=1) as r:
            return Path(json.load(r).get("data_dir", "")).resolve() == DATA_DIR.resolve()
    except Exception:
        return False


def _focus_running_instance(url: str) -> None:
    """Ask the running tracker to show its window."""
    try:
        req = urllib.request.Request(f"{url}/api/window/show", method="POST")
        with urllib.request.urlopen(req, timeout=3):
            return
    except OSError:
        log.warning("Could not focus the running window", exc_info=True)


def _saved_port() -> int:
    """The port in the saved settings, read without SettingsStore: that would write to a data folder about to go."""
    try:
        return int(json.loads((DATA_DIR / "settings.json").read_text("utf-8"))["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_PORT


def quit_running(timeout_s: float = 20.0) -> int:
    """The uninstaller's step: close the tracker using this data folder and wait until its process has gone, so its
    files can be deleted. 0 when none is left running, 1 when one wouldn't close."""
    url = f"http://{HOST}:{_saved_port()}"
    if not _already_running(url):
        return 0
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{url}/api/quit", method="POST"), timeout=3) as r:
            pid = json.load(r)["pid"]
    except (OSError, ValueError, KeyError):
        return 1
    return 0 if wait_for_exit(pid, timeout_s) else 1


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, port))
            return True
        except OSError:
            return False


def _any_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def _setup_choice(message: str) -> int:
    return ctypes.windll.user32.MessageBoxW(None, message, "Divine Pulse setup", 0x23)


def main() -> None:
    if "--check-desktop" in sys.argv[1:]:
        from .desktop import check_desktop

        sys.exit(0 if check_desktop() else 1)
    if "--quit" in sys.argv[1:]:
        sys.exit(quit_running())
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        error_box(f"Divine Pulse can't create its data folder:\n{DATA_DIR}\n\n{exc}")
        return
    settings = SettingsStore()
    url = f"http://{HOST}:{settings.get().port}"
    if _already_running(url):
        _focus_running_instance(url)
        return

    from . import desktop

    if not desktop.available():
        error_box("Divine Pulse requires Microsoft Edge WebView2 on Windows.")
        return

    if FROZEN:
        from .infrastructure.installation import prepare_installation
        from .infrastructure.paths import GAME_ASSETS_DIR

        try:
            if not prepare_installation(settings, GAME_ASSETS_DIR, __version__, _setup_choice):
                return
        except OSError as exc:
            error_box(f"Divine Pulse couldn't finish setup.\n\n{exc}")
            return
    # Rotating, so the log can't grow without bound on a PC that runs the tracker for months.
    handlers: list[logging.Handler] = [RotatingFileHandler(DATA_DIR / "tracker.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")]
    if sys.stderr:  # pythonw has none
        handlers.append(logging.StreamHandler(sys.stderr))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)

    log.info("Divine Pulse %s starting (%s, Windows); data folder: %s", __version__, "packaged" if FROZEN else "from source", DATA_DIR)
    url = f"http://{HOST}:{settings.get().port}"
    if not _port_free(settings.get().port):
        # Another program has the port: move to a free one and remember it.
        port = _any_free_port()
        log.warning("Port %d is in use by another program; using port %d instead.", settings.get().port, port)
        settings.update(port=port)
        url = f"http://{HOST}:{port}"

    from .main import create_app

    # The window and the server share the same settings store.
    app = create_app(settings=settings)
    # log_config=None: uvicorn's default logging writes to stderr, which pythonw doesn't have.
    # timeout_graceful_shutdown: the dashboard's live-update stream never ends on its own, so
    # don't wait for it forever when quitting.
    server = uvicorn.Server(
        uvicorn.Config(app, host=HOST, port=settings.get().port, log_config=None, timeout_graceful_shutdown=2)
    )
    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()
    for _ in range(150):
        if server.started or not thread.is_alive():
            break
        time.sleep(0.1)
    if not server.started:
        error_box(f"Divine Pulse couldn't start its local server on port {settings.get().port}.\n\nDetails are in {DATA_DIR / 'tracker.log'}.")
        return

    try:
        desktop.DesktopApp(url, settings, app.state, server).run()
    finally:
        app.state.events.close()
        server.should_exit = True
        thread.join()


if __name__ == "__main__":
    main()
