"""Filesystem, desktop, and memory interfaces for Windows and macOS."""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

log = logging.getLogger(__name__)

MACOS = sys.platform == "darwin"


def data_dir(app_name: str) -> Path:
    """The per-user folder for the app's data: %LOCALAPPDATA% on Windows, ~/Library/Application Support on macOS."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / app_name
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / app_name


def _gone(pid: int) -> bool:
    """A process that has ended (macOS: also one that has ended and waits for its parent to collect it)."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    if sys.platform != "darwin":
        return False
    info = ctypes.create_string_buffer(136)  # struct proc_bsdinfo; pbi_status is the u32 at offset 4
    lib = ctypes.CDLL("/usr/lib/libproc.dylib")
    if lib.proc_pidinfo(ctypes.c_int(pid), 3, ctypes.c_uint64(0), info, ctypes.sizeof(info)) <= 0:  # PROC_PIDTBSDINFO
        return True
    return int.from_bytes(info.raw[4:8], "little") == 5  # SZOMB


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    """Wait for a process to end, so its files can be deleted. True once it's gone (or was already)."""
    if sys.platform != "win32":
        deadline = time.monotonic() + timeout_s
        while not _gone(pid):
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)
        return True
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


def _launch(command: list[str]) -> None:
    try:
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError as exc:
        raise OSError(f"{command[0]} isn't available on this computer.") from exc


def open_folder(path: Path) -> None:
    """Open a folder in the file manager (Explorer, Finder)."""
    _launch(["open", str(path)] if sys.platform == "darwin" else ["explorer", str(path)])


def _applescript_text(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def mac_dialog(message: str, title: str, buttons: tuple[str, ...], default: str, icon: str = "note") -> str | None:
    """Show a macOS dialog; the button clicked, or None if it couldn't be shown."""
    script = (
        f"display dialog {_applescript_text(message)} with title {_applescript_text(title)} "
        f"buttons {{{', '.join(_applescript_text(b) for b in buttons)}}} default button {_applescript_text(default)} "
        f"with icon {icon}"
    )
    try:
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        return None
    prefix = "button returned:"
    return result.stdout.strip()[len(prefix):] if result.stdout.startswith(prefix) else None


def error_box(message: str, title: str = "Divine Pulse") -> None:
    """Tell the user about an error that stops the app from starting. Never raises."""
    try:
        if sys.platform == "darwin":
            mac_dialog(message, title, ("OK",), "OK", "stop")
            return
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        log.exception("Couldn't show the error: %s", message)


# Why reading the emulator's memory was refused, and what to do about it.
if MACOS:
    MEMORY_ACCESS_HELP = (
        "macOS won't let the tracker read {emulator}'s memory. Use a build of {emulator} that allows debugging "
        "(Astris's releases do), and restart it after updating."
    )
else:
    MEMORY_ACCESS_HELP = "Windows won't let the tracker read {emulator}'s memory. If {emulator} runs as administrator, run the tracker as administrator too."
