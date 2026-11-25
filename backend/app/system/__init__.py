"""Filesystem, desktop and memory interfaces. What differs by operating system is in platform/ (one module per OS);
these are the services the rest of the app uses, for whichever OS it runs on."""

from __future__ import annotations

from pathlib import Path

from . import platform


def data_dir(app_name: str) -> Path:
    """The per-user folder for the app's data (%LOCALAPPDATA%, ~/Library/Application Support, ~/.local/share)."""
    return platform.current().data_dir(app_name)


def wait_for_exit(pid: int, timeout_s: float) -> bool:
    """Wait for a process to end, so its files can be deleted. True once it's gone (or was already)."""
    return platform.current().wait_for_exit(pid, timeout_s)


def open_folder(path: Path) -> None:
    """Open a folder in the file manager (Explorer, Finder, the desktop's own)."""
    platform.current().open_folder(path)


def error_box(message: str, title: str = "Divine Pulse") -> None:
    """Tell the user about an error that stops the app from starting. Never raises."""
    platform.current().error_box(message, title)


# Why reading the emulator's memory was refused, and what to do about it.
MEMORY_ACCESS_HELP: str = platform.current().MEMORY_ACCESS_HELP
