"""The assets extracted from the user's own game dump (see app/gamefiles and docs/game-assets/README.md).

Every reader here degrades instead of failing: with no import, a missing file or a damaged one, callers get None
(or their default). Files are only served if the manifest lists them.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
import threading
from typing import Any

from ..gamefiles.output import FORMAT
from .paths import GAME_ASSETS_DIR
from ..domain.settings import GAME_LANGUAGES

log = logging.getLogger(__name__)
MANIFEST = "manifest.json"
DEFAULT_LANGUAGE = "ENG_U"


class GameAssets:
    def __init__(self, root: Path = GAME_ASSETS_DIR):
        self.root = Path(root)
        self._lock = threading.Lock()
        self._stamp: float | None = None
        self._manifest: dict | None = None
        self._cache: dict[str, Any] = {}
        self.language: Callable[[], str] = lambda: DEFAULT_LANGUAGE

    def _refresh(self) -> None:
        """Reload the manifest (and drop cached files) when it changed on disk, e.g. after an import."""
        path = self.root / MANIFEST
        try:
            stamp = path.stat().st_mtime
        except OSError:
            stamp = None
        if stamp == self._stamp:
            return
        self._stamp, self._cache, self._manifest = stamp, {}, None
        if stamp is None:
            return
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(manifest.get("files"), dict):
                raise ValueError("no file list")
            self._manifest = manifest
        except (OSError, ValueError) as error:
            log.warning("Ignoring imported game assets: %s is unreadable (%s)", path, error)

    @property
    def manifest(self) -> dict | None:
        with self._lock:
            self._refresh()
            return self._manifest

    @property
    def available(self) -> bool:
        return self.manifest is not None

    def status(self) -> dict:
        manifest = self.manifest
        if manifest is None:
            return {"available": False, "folder": str(self.root)}
        return {
            "available": True,
            "folder": str(self.root),
            "version": manifest.get("dump", {}).get("version"),
            "dlc": manifest.get("dump", {}).get("dlc", []),
            "created": manifest.get("created"),
            "outdated": manifest.get("format", 0) < FORMAT,
            "files": len(manifest["files"]),
            "languages": [code for code in GAME_LANGUAGES if self.path(f"text/{code}.json") is not None],
            "families": {name: info.get("files", 0) for name, info in manifest.get("families", {}).items()},
            "skipped": [s for info in manifest.get("families", {}).values() for s in info.get("skipped", [])],
        }

    def path(self, rel: str) -> Path | None:
        """The file for a manifest-listed path, or None (unlisted, missing, or outside the folder)."""
        manifest = self.manifest
        if manifest is None or rel not in manifest["files"]:
            return None
        path = (self.root / rel).resolve()
        if self.root.resolve() not in path.parents or not path.is_file():
            return None
        return path

    def json(self, rel: str, default: Any = None) -> Any:
        """A listed JSON file, parsed and cached until the next import; default if it is absent or damaged."""
        with self._lock:
            self._refresh()
            if rel in self._cache:
                return self._cache[rel]
        path = self.path(rel)
        if path is None:
            return default
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            log.warning("Ignoring damaged game asset %s (%s)", rel, error)
            return default
        with self._lock:
            self._cache[rel] = data
        return data

    def text(self, category: str, language: str | None = None) -> dict[str, str]:
        """One category of names or descriptions (the "categories" of text/<LANG>.json), by game id as a string; {} if absent."""
        if language is None:
            language = self.language()
        if language not in GAME_LANGUAGES:
            language = DEFAULT_LANGUAGE
        data = self.json(f"text/{language}.json") or self.json(f"text/{DEFAULT_LANGUAGE}.json")
        if not data:
            data = next((value for code in GAME_LANGUAGES if (value := self.json(f"text/{code}.json"))), None)
        return (data or {}).get("categories", {}).get(category, {})


_shared = GameAssets()


def game_assets() -> GameAssets:
    """The app's game assets (one instance, so every loader sees the same import)."""
    return _shared
