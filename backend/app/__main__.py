"""Entry point: `python -m app` (what the desktop shortcut runs).

    python -m app              standalone desktop window + tray icon (default)
    python -m app --browser    open the dashboard in the web browser instead, with the tray icon
    python -m app --server     server only: no window, no tray (for development)
    python -m app --quit       close the tracker using this data folder and wait for it to end (for the uninstaller)

If the tracker is already running, launching it again just brings its window forward.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from logging.handlers import RotatingFileHandler

from . import __version__
from .config import DATA_DIR, FROZEN, SettingsStore
from .domain.settings import DEFAULT_PORT
from .system import error_box, wait_for_exit

HOST = "127.0.0.1"
log = logging.getLogger("app")


def _find_nsps(folder: Path) -> list[Path]:
    """Find packages below a selected folder without following links into other trees."""
    found = []
    for current, dirs, files in os.walk(folder, followlinks=False):
        root = Path(current)
        dirs[:] = [name for name in dirs if not (root / name).is_symlink()
                   and not (root / name).is_junction()]
        found.extend(root / name for name in files if Path(name).suffix.lower() == ".nsp")
    return sorted(found)


def import_game_files(folder: str, nstool: str = "", keys: str = "", nsps: list[str] | None = None,
                      keep_dumps: str = "") -> int:
    """Run the same import as Settings without starting the desktop or server."""
    from .gamefiles import dump
    from .infrastructure.game_assets import game_assets
    from .infrastructure.game_assets_import import import_assets
    from .infrastructure.nsp_workspace import extraction_workspace
    from .infrastructure.paths import INSTALL_DIR

    log_file = None

    def output(message: str) -> None:
        line = " ".join(str(message).splitlines())
        if sys.stdout:
            print(line, flush=True)
        if log_file:
            log_file.write(line + "\n")
            log_file.flush()

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        log_file = (DATA_DIR / "game-assets-import.log").open("w", encoding="utf-8")
        output("Finding game files...")
        source = Path(folder)
        if nsps is not None:
            if not nsps or any(not name or name.startswith("--") for name in nsps):
                raise ValueError("Choose at least one NSP file.")
            packages = [Path(name) for name in nsps]
        else:
            existing = dump.find(source) if source.is_dir() else None
            packages = ([source] if source.is_file() and source.suffix.lower() == ".nsp" else
                        _find_nsps(source)
                        if source.is_dir() and not existing.romfs else [])
        if keep_dumps and not packages:
            raise ValueError("Saving raw dumps requires NSP inputs. Existing extracted folders are left unchanged.")
        protected = (DATA_DIR, INSTALL_DIR) if FROZEN else (DATA_DIR,)
        with extraction_workspace(Path(keep_dumps) if keep_dumps else None, protected=protected) as workspace:
            if packages:
                if not nstool or not keys:
                    raise ValueError("Choose NSTool and prod.keys to import NSP files.")
                from .infrastructure.nsp_extractor import extract_nsps
                output("Extracting NSP files (this can take a while)...")
                if keep_dumps:
                    output(f"Raw dump destination: {workspace} (kept only after a successful import).")
                extract_nsps(packages, Path(nstool), Path(keys), workspace, output)
                source = workspace
            found = dump.find(source)
            if found.problems:
                raise ValueError("; ".join(found.problems))
            output("Importing game files...")
            import_assets(found, game_assets().root, lambda message, _out: output(message),
                          lambda: output("Verifying game files..."))
        SettingsStore().update(last_dump=folder)
        if keep_dumps:
            output(f"Raw extracted files saved in: {keep_dumps}")
        output("Game files imported successfully.")
        return 0
    except Exception as exc:
        output(str(exc) or type(exc).__name__)
        return 1
    finally:
        if log_file:
            log_file.close()


def check_game_files() -> int:
    from .gamefiles import verify
    from .infrastructure.game_assets import game_assets

    try:
        root = game_assets().root
        if not (root / "manifest.json").is_file():
            return 1
        return 0 if verify.check(root).ok else 1
    except Exception:
        return 1


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
    """Ask the running tracker to show its window; fall back to a browser tab."""
    try:
        req = urllib.request.Request(f"{url}/api/window/show", method="POST")
        with urllib.request.urlopen(req, timeout=3):
            return
    except Exception:
        webbrowser.open(url)


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


def _browser_tray(url: str, server: uvicorn.Server, state) -> None:
    """Browser mode: a tray icon to reopen the dashboard or quit."""
    import pystray
    from PIL import Image

    def quit_app(icon, _item):
        icon.stop()
        server.should_exit = True

    icon = pystray.Icon(
        "divine-pulse",
        Image.open(Path(__file__).parent / "data" / "icon.png"),
        "Divine Pulse",
        menu=pystray.Menu(
            pystray.MenuItem("Open dashboard", lambda *_: webbrowser.open(url), default=True),
            pystray.MenuItem("Quit", quit_app),
        ),
    )
    state.quit_app = lambda: quit_app(icon, None)
    icon.run()


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


def main() -> None:
    if "--check-desktop" in sys.argv[1:]:
        from .desktop import check_desktop

        sys.exit(0 if check_desktop() else 1)
    # Setup's command-line steps: import or check the game files and exit, without the server or a window. Here rather
    # than under __main__ so the packaged program (packaging/launcher.py calls main()) handles them too.
    if "--import-game-files" in sys.argv[1:]:
        index = sys.argv.index("--import-game-files")
        folder = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""
        if any(flag in sys.argv for flag in ("--nstool", "--keys", "--nsp", "--keep-dumps")):
            def option(name: str) -> str:
                if name not in sys.argv:
                    return ""
                i = sys.argv.index(name)
                return sys.argv[i + 1] if i + 1 < len(sys.argv) else ""

            selected = [sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
                        for i, arg in enumerate(sys.argv) if arg == "--nsp"]
            if "--keep-dumps" in sys.argv:
                destination = option("--keep-dumps")
                if not destination or destination.startswith("--"):
                    sys.exit(1)
                sys.exit(import_game_files(folder, option("--nstool"), option("--keys"),
                                           selected or None, destination))
            if selected:
                sys.exit(import_game_files(folder, option("--nstool"), option("--keys"), selected))
            sys.exit(import_game_files(folder, option("--nstool"), option("--keys")))
        sys.exit(import_game_files(folder))
    if "--check-game-files" in sys.argv[1:]:
        sys.exit(check_game_files())
    if "--quit" in sys.argv[1:]:
        sys.exit(quit_running())
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        error_box(f"Divine Pulse can't create its data folder:\n{DATA_DIR}\n\n{exc}")
        return
    # Rotating, so the log can't grow without bound on a PC that runs the tracker for months.
    handlers: list[logging.Handler] = [RotatingFileHandler(DATA_DIR / "tracker.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")]
    if sys.stderr:  # pythonw has none
        handlers.append(logging.StreamHandler(sys.stderr))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)

    args = set(sys.argv[1:])
    server_only = "--server" in args
    browser_mode = "--browser" in args

    log.info("Divine Pulse %s starting (%s, Windows); data folder: %s", __version__, "packaged" if FROZEN else "from source", DATA_DIR)
    settings = SettingsStore()
    url = f"http://{HOST}:{settings.get().port}"
    if _already_running(url):
        if not server_only:
            _focus_running_instance(url)
        return
    if not _port_free(settings.get().port):
        # Another program has the port: move to a free one and remember it.
        port = _any_free_port()
        log.warning("Port %d is in use by another program; using port %d instead.", settings.get().port, port)
        settings.update(port=port)
        url = f"http://{HOST}:{port}"

    from .main import create_app

    # One settings store for the app, the window and the tray: a second copy loaded at launch would write the
    # settings as they were then over any changes made since (the window saves its position on quit).
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

    if server_only:
        thread.join()
        return

    from . import desktop

    if not browser_mode and desktop.available():
        from .desktop import DesktopApp

        DesktopApp(url, settings, app.state, server).run()
    else:
        webbrowser.open(url)
        _browser_tray(url, server, app.state)
    app.state.events.close()
    server.should_exit = True
    thread.join(timeout=5)


if __name__ == "__main__":
    main()
