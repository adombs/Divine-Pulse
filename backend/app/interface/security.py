"""Keep the local server to the app itself.

The server listens on the loopback address only, but a web page open in the player's browser can still send requests
to it. Three checks stop that:

- Host must name this computer, which defeats DNS rebinding (a site's own name pointed at 127.0.0.1).
- Origin, when a browser sends one, must be the address the request came in on.
- Sec-Fetch-Site, when a browser sends one, must not be another site for the API or imported game files.

Programs without those headers (the launcher asking a running copy to show its window) pass on Host alone.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any
from urllib.parse import urlsplit

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
App = Callable[[Scope, Receive, Send], Awaitable[None]]

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
PROTECTED_PATHS = ("/api", "/game-assets")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SAFE_FETCH_SITES = {"same-origin", "none"}
_HOST = re.compile(r"(\[[^\]]*\]|[^:\[\]]+)(?::\d+)?")

HEADERS = (
    (b"content-security-policy",
     b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
     b"font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; "
     b"frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
)


def _host_name(host: str) -> str:
    """The name in a Host value, without the port. An IPv6 address keeps its brackets; a malformed value is returned
    whole, so it matches nothing allowed."""
    match = _HOST.fullmatch(host)
    return match.group(1) if match else host


def rejection(method: str, path: str, host: str | None, origin: str | None, fetch_site: str | None) -> str | None:
    """Why this request must not be served, or None if it may be."""
    if not host or _host_name(host).lower() not in ALLOWED_HOSTS:
        return "This address isn't allowed."
    if origin is not None:
        try:
            parts = urlsplit(origin)
            same = parts.scheme in {"http", "https"} and parts.netloc.lower() == host.lower()
        except ValueError:
            same = False
        if not same:
            return "Requests from other sites aren't allowed."
    protected = method not in SAFE_METHODS or any(path == p or path.startswith(p + "/") for p in PROTECTED_PATHS)
    if protected and fetch_site is not None and fetch_site.lower() not in SAFE_FETCH_SITES:
        return "Requests from other sites aren't allowed."
    return None


class LocalOnly:
    """Plain ASGI, so the event stream isn't buffered."""

    def __init__(self, app: App) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", ()), *HEADERS]
            await send(message)

        headers = {key.lower(): value for key, value in scope["headers"]}
        text = lambda name: headers[name].decode("latin-1") if name in headers else None  # noqa: E731
        reason = rejection(scope["method"], scope["path"], text(b"host"), text(b"origin"), text(b"sec-fetch-site"))
        if reason is None:
            await self.app(scope, receive, send_with_headers)
            return
        body = json.dumps({"detail": reason}).encode()
        await send_with_headers({
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})
