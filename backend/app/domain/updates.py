"""Release version rules for the update check, independent of where the release information comes from."""

from __future__ import annotations

import re

RELEASES_URL = "https://github.com/adombs/Divine-Pulse/releases/"
LATEST_RELEASE_URL = RELEASES_URL + "latest"

_VERSION = re.compile(r"v?(\d+)\.(\d+)\.(\d+)", re.ASCII)


def parse_version(tag: object) -> tuple[int, int, int] | None:
    """`"v1.4.4"` or `"1.4.4"` as (1, 4, 4); anything else (pre-release suffixes included) is None."""
    if not isinstance(tag, str):
        return None
    match = _VERSION.fullmatch(tag.strip())
    if match is None:
        return None
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def is_newer(latest: object, current: object) -> bool:
    """True only when both parse and `latest` is a higher x.y.z than `current`."""
    a, b = parse_version(latest), parse_version(current)
    return a is not None and b is not None and a > b


def release_url(url: object) -> str:
    """The release page to open: GitHub's own link for this repository, else the latest-release page."""
    if isinstance(url, str) and url.startswith(RELEASES_URL):
        return url
    return LATEST_RELEASE_URL
