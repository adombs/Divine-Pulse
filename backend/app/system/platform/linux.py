"""Linux: XDG folders, xdg-open, /proc and plain pywebview (GTK or Qt). Not a supported platform yet: reading the
emulator's memory and the packaged build's setup questions raise NotSupported."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

from .base import Answer, NotSupported, WindowBehaviour, check_executable, env_dir, launch, signal_says_gone, wait_by_polling

log = logging.getLogger(__name__)

ID = "linux"
NAME = "Linux"

MEMORY_ACCESS_HELP = (
    "Linux won't let the tracker read {emulator}'s memory. Reading another program's memory needs ptrace access "
    "(see /proc/sys/kernel/yama/ptrace_scope)."
)
WEBVIEW_MISSING = "Divine Pulse needs pywebview with GTK (WebKit2GTK) or Qt to open its window on Linux."
NSTOOL_NAME = "nstool"
NSTOOL_MISSING = (
    "NSTool wasn't found. Download or build it from {download} and put it on your PATH (or in vendor/nstool/). Or "
    "import a dump folder instead."
)

PORT_CHECK_REUSES_ADDRESS = True
HIDDEN_CONSOLE_FLAGS = 0


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def _home(home: Path | None) -> Path:
    return Path.home() if home is None else home


def data_dir(app_name: str, env: Mapping[str, str] | None = None, home: Path | None = None) -> Path:
    """$XDG_DATA_HOME/<app>, by default ~/.local/share/<app>."""
    return env_dir(_env(env), "XDG_DATA_HOME", _home(home) / ".local" / "share") / app_name


def eden_user_dirs(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    return [env_dir(_env(env), "XDG_DATA_HOME", _home(home) / ".local" / "share") / "eden"]


def ryujinx_roots(env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    return [env_dir(_env(env), "XDG_CONFIG_HOME", _home(home) / ".config") / "Ryujinx"]


def nstool_candidates(home: Path | None = None) -> list[Path]:
    on_path = shutil.which("nstool")
    return [Path(on_path)] if on_path else []


def check_nstool(tool: Path, download: str) -> None:
    check_executable(tool, download)


def folder_name_problem(parts: tuple[str, ...]) -> str | None:
    return None


def runs_program(executable: str) -> bool:
    return not executable.endswith(".exe")


def webview_caches(data_dir: Path, home: Path | None = None) -> list[Path]:
    return []  # no packaged build to install over yet


def trusted_roots() -> str | None:
    return None  # Linux's Python uses the distribution's certificate bundle


def open_folder(path: Path) -> None:
    launch(["xdg-open", str(path)])


def error_box(message: str, title: str = "Divine Pulse") -> None:
    """zenity's error dialog when it's installed; the log (and stderr) always."""
    log.error("%s: %s", title, message)
    try:
        if shutil.which("zenity"):
            subprocess.run(["zenity", "--error", f"--title={title}", f"--text={message}"], timeout=600, check=False)
    except Exception:
        log.exception("Couldn't show the error: %s", message)


def ask(message: str, title: str) -> Answer:
    raise NotSupported("Setup questions aren't supported on Linux yet.")


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


class Window(WindowBehaviour):
    """pywebview's GTK or Qt window, with pywebview's own bounds and fullscreen (the base behaviour)."""

    def available(self) -> bool:
        import importlib.util

        import webview  # noqa: F401

        return any(importlib.util.find_spec(name) is not None for name in ("gi", "qtpy"))


def window() -> Window:
    return Window()
