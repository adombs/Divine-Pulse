"""Windows filesystem, desktop, and memory interfaces."""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
from ctypes import wintypes
from pathlib import Path

log = logging.getLogger(__name__)

def data_dir(app_name: str) -> Path:
    """The per-user folder for the app's data."""
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / app_name


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    """Wait for a process to end, so its files can be deleted. True once it's gone (or was already)."""
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
        raise OSError(f"{command[0]} isn't available on this PC.") from exc


def open_folder(path: Path) -> None:
    """Open a folder in the file manager."""
    _launch(["explorer", str(path)])


def error_box(message: str, title: str = "Divine Pulse") -> None:
    """Tell the user about an error that stops the app from starting. Never raises."""
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        log.exception("Couldn't show the error: %s", message)


# Why reading the emulator's memory was refused, and what to do about it.
MEMORY_ACCESS_HELP = "Windows won't let the tracker read {emulator}'s memory. If {emulator} runs as administrator, run the tracker as administrator too."

