"""The one place that knows which operating system this is.

`current()` is the platform module for this computer (windows.py, macos.py or linux.py), chosen once; each has the
names in base.Platform. Code elsewhere asks it for paths, texts and OS services instead of checking sys.platform.
Supporting another OS means adding a module here and a line in MODULES.

Tests can check any platform's pure parts with `for_platform("darwin")` etc., or act as another one with
`monkeypatch.setattr(app.system.platform, "_selected", for_platform(...))`.
"""

from __future__ import annotations

import sys
from types import ModuleType

from . import linux, macos, windows
from .base import Answer as Answer, NotSupported as NotSupported, Platform as Platform, WindowBehaviour as WindowBehaviour

# sys.platform -> platform module. Any other POSIX system gets the Linux module (XDG folders, /proc, xdg-open).
MODULES: dict[str, ModuleType] = {"win32": windows, "darwin": macos, "linux": linux}
ALL: tuple[ModuleType, ...] = (windows, macos, linux)

_selected: ModuleType | None = None


def for_platform(name: str) -> ModuleType:
    """The platform module for a sys.platform value."""
    return MODULES.get(name, linux)


def current() -> ModuleType:
    """The platform module for this computer."""
    global _selected
    if _selected is None:
        _selected = for_platform(sys.platform)
    return _selected
