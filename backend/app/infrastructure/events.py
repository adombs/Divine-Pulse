"""Fan-out of server events to connected browsers (Server-Sent Events), plus in-process
listeners (e.g. the tray menu).

Events are published from worker threads and delivered on the asyncio loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue[str | None]] = set()
        self._listeners: list[Callable[[str, Any], None]] = []

    def add_listener(self, fn: Callable[[str, Any], None]) -> None:
        """Call `fn(event, data)` for every event, on the publishing thread. Keep it quick."""
        self._listeners.append(fn)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[str | None]:
        q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str | None]) -> None:
        self._subscribers.discard(q)

    def publish(self, event: str, data: Any = None) -> None:
        """Thread-safe."""
        for fn in list(self._listeners):
            try:
                fn(event, data)
            except Exception:
                log.exception("Event listener failed")
        if self._loop is None:
            return
        message = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
        try:
            self._loop.call_soon_threadsafe(self._deliver, message)
        except RuntimeError:
            log.debug("Event loop closed before event could be delivered")

    def close(self) -> None:
        """End every open event stream (call before stopping the server). Thread-safe."""
        if self._loop is not None:
            try:
                self._loop.call_soon_threadsafe(self._deliver, None)
            except RuntimeError:
                log.debug("Event loop already closed")

    def _deliver(self, message: str | None) -> None:
        for q in list(self._subscribers):
            if message is None:  # closing: make room for the end marker
                while q.full():
                    q.get_nowait()
            elif q.full():
                continue
            q.put_nowait(message)
