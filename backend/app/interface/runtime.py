"""Typed HTTP access to the runtime built by the composition root."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Protocol

from fastapi import Request

from ..application.operations import BackendOperations


class EventStreams(Protocol):
    def subscribe(self) -> asyncio.Queue[str | None]: ...
    def unsubscribe(self, queue: asyncio.Queue[str | None]) -> None: ...


@dataclass
class RuntimeView:
    operations: BackendOperations
    events: EventStreams
    desktop: bool = field(default=False, kw_only=True)
    game_import: object = field(default=None, kw_only=True)
    #: Messages about saves recovered from a backup, shown once when a window connects.
    take_notices: Callable[[], list[str]] = field(default=lambda: [], kw_only=True)


@dataclass
class WindowCallbacks:
    """Desktop hooks are attached after the HTTP server starts."""

    show_callback: Callable[[], None] | None
    mode_callback: Callable[[str], None] | None

    def show(self) -> None:
        if self.show_callback is None:
            raise LookupError("No desktop window (running in browser mode).")
        self.show_callback()

    def set_mode(self, mode: str) -> None:
        if self.mode_callback is not None:
            self.mode_callback(mode)


def runtime_for(request: Request) -> RuntimeView:
    state = request.app.state
    runtime: RuntimeView = state.runtime
    # Only this adapter reads the optional hooks attached after window creation.
    show = getattr(state, "show_window", None)
    mode = getattr(state, "set_window_mode", None)
    window = WindowCallbacks(show, mode) if show is not None or mode is not None else None
    return RuntimeView(replace(runtime.operations, window=window), runtime.events, desktop=show is not None,
                       game_import=runtime.game_import)
