"""One background look at GitHub's latest published release, kept in memory for the dashboard."""

from __future__ import annotations

import json
import logging
import threading
import urllib.request
from collections.abc import Callable
from typing import Any

from ..application.ports import EventPublisher, SettingsRepository
from ..domain.updates import is_newer, parse_version, release_url

log = logging.getLogger(__name__)

LATEST_RELEASE_API = "https://api.github.com/repos/adombs/Divine-Pulse/releases/latest"
TIMEOUT_S = 5

Fetcher = Callable[[str], dict[str, Any]]


def fetch_latest_release(version: str) -> dict[str, Any]:
    """The latest published release as GitHub's JSON object. Raises on any network or format problem."""
    request = urllib.request.Request(LATEST_RELEASE_API, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": f"Divine-Pulse/{version}",
    })
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("unexpected release response")
    return data


def _spawn_thread(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="update-check", daemon=True).start()


class UpdateCheck:
    """Checks at most once per session while `check_updates` is on. Nothing runs until `start()`,
    so an app built without background work (tests) never reaches the network."""

    def __init__(self, current: str, settings: SettingsRepository, events: EventPublisher,
                 fetcher: Fetcher | None = None, spawn: Callable[[Callable[[], None]], None] = _spawn_thread):
        self.current = current
        self._settings = settings
        self._events = events
        self._fetch = fetcher or fetch_latest_release
        self._spawn = spawn
        self._lock = threading.Lock()
        self._started = False
        self._attempted = False
        self._result: dict[str, Any] = {"current": current, "latest": None, "url": None,
                                        "available": False, "checked": False}

    def status(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._result)

    def start(self) -> None:
        """Called once at app start; checks in the background when the setting is on."""
        self._started = True
        self._maybe_check()

    def settings_changed(self) -> None:
        """Turning the setting on runs the check if none has run this session."""
        self._maybe_check()

    def _maybe_check(self) -> None:
        if not self._started or not self._settings.get().check_updates:
            return
        with self._lock:
            if self._attempted:
                return
            self._attempted = True
        self._spawn(self._run)

    def _run(self) -> None:
        try:
            release = self._fetch(self.current)
            tag = release.get("tag_name")
            parsed = parse_version(tag)
            if parsed is None:
                log.info("Update check: ignoring release tag %r.", tag)
                return
            latest = ".".join(map(str, parsed))
            result = {"current": self.current, "latest": latest,
                      "url": release_url(release.get("html_url")),
                      "available": is_newer(latest, self.current), "checked": True}
        except Exception as exc:  # offline, timeout, HTTP error, rate limit, bad JSON: stay "not checked"
            log.info("Update check skipped (%s).", exc)
            return
        with self._lock:
            self._result = result
        self._events.publish("update", dict(result))
