"""The assets extracted from the user's own game dump (see app/gamefiles ).

An absent import is a first-run sentinel. Once an import exists, required reads fail with the asset's path and
reason instead of silently substituting empty data or another language. Files are only served if listed.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
import threading
import time
from typing import Any

from ..gamefiles.output import FORMAT
from .paths import GAME_ASSETS_DIR
from ..domain.settings import GAME_LANGUAGES

MANIFEST = "manifest.json"
DEFAULT_LANGUAGE = "ENG_U"
# How long the table files' modification times are trusted (see GameAssets.data_stamp).
DATA_STAMP_TTL_S = 1.0


class GameAssetError(RuntimeError):
    """A required file in an existing game import is missing, unreadable or invalid."""

    def __init__(self, asset: str, reason: str):
        self.asset, self.reason = asset, reason
        super().__init__(f"Required game asset {asset}: {reason}. Reprocess your game files.")


class GameAssets:
    def __init__(self, root: Path = GAME_ASSETS_DIR):
        self.root = Path(root)
        self._lock = threading.Lock()
        self._stamp: tuple[int, int] | None = None
        self._manifest: dict | None = None
        self._manifest_error: GameAssetError | None = None
        self._cache: dict[str, tuple[tuple[int, int], Any]] = {}
        self._data_stamp: tuple[float, tuple, tuple] | None = None  # when it was read, for which manifest and language
        self.language: Callable[[], str] = lambda: DEFAULT_LANGUAGE

    def _refresh(self) -> None:
        """Reload the manifest (and drop cached files) when it changed on disk, e.g. after an import."""
        path = self.root / MANIFEST
        try:
            stat = path.stat()
            stamp = stat.st_mtime_ns, stat.st_size
        except FileNotFoundError:
            stamp = None
        except OSError as error:
            self._stamp, self._cache = None, {}
            self._manifest_error = GameAssetError(MANIFEST, f"cannot read manifest ({error})")
            self._manifest = None
            return
        if stamp == self._stamp and self._manifest_error is None:
            return
        self._stamp, self._cache, self._manifest, self._manifest_error = stamp, {}, None, None
        if stamp is None:
            return
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), dict):
                raise ValueError("no file list")
            if not all(isinstance(rel, str) for rel in manifest["files"]):
                raise ValueError("invalid file paths")
            if not isinstance(manifest.get("dump", {}), dict) or type(manifest.get("format", 0)) is not int:
                raise ValueError("invalid dump metadata or format")
            families = manifest.get("families", {})
            if not isinstance(families, dict) or any(not isinstance(info, dict) for info in families.values()):
                raise ValueError("invalid import families")
            self._manifest = manifest
        except (OSError, ValueError) as error:
            self._manifest_error = GameAssetError(MANIFEST, f"invalid manifest ({error})")

    @property
    def manifest(self) -> dict | None:
        with self._lock:
            self._refresh()
            if self._manifest_error is not None:
                raise self._manifest_error
            return self._manifest

    @property
    def available(self) -> bool:
        try:
            return self.manifest is not None
        except GameAssetError:
            return False

    def status(self) -> dict:
        try:
            manifest = self.manifest
        except GameAssetError as error:
            return {"available": False, "folder": str(self.root), "error": str(error)}
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

    def json(self, rel: str) -> Any:
        """A required JSON object; None only before any game files have been imported."""
        manifest = self.manifest
        if manifest is None:
            return None
        if rel not in manifest["files"]:
            raise GameAssetError(rel, "not listed in the import manifest")
        path = self.path(rel)
        if path is None:
            raise GameAssetError(rel, "file is missing or outside the import folder")
        try:
            stat = path.stat()
            stamp = stat.st_mtime_ns, stat.st_size
        except OSError as error:
            raise GameAssetError(rel, f"cannot read file ({error})") from error
        with self._lock:
            self._refresh()
            cached = self._cache.get(rel)
            if cached is not None and cached[0] == stamp:
                return cached[1]
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise GameAssetError(rel, f"cannot decode JSON ({error})") from error
        if not isinstance(data, dict):
            raise GameAssetError(rel, "expected a JSON object")
        with self._lock:
            self._cache[rel] = stamp, data
        return data

    def data_stamp(self) -> tuple:
        """Reference-table cache identity, including files replaced without rewriting the manifest.

        Every table lookup asks for it, and checking each table file takes a system call, so the files are only looked
        at again after DATA_STAMP_TTL_S (a new manifest or language is noticed at once)."""
        manifest = self.manifest
        if manifest is None:
            return ()
        language = self.language()
        key = self._stamp, language  # (not id(manifest): a freed manifest's id can be given to its replacement)
        now = time.monotonic()
        checked = self._data_stamp
        if checked is not None and checked[1] == key and now - checked[0] < DATA_STAMP_TTL_S:
            return checked[2]
        stamps = self._read_data_stamp(manifest, language)
        self._data_stamp = now, key, stamps
        return stamps

    def _read_data_stamp(self, manifest: dict, language: str) -> tuple:
        stamps = []
        relatives = (rel for rel in manifest["files"] if rel.startswith("data/") or rel == f"text/{language}.json")
        for rel in sorted(relatives):
            # This fingerprint reads metadata only. Required content reads still use path()'s resolved allowlist.
            # Resolving the root and every parent for every table lookup makes roster decoding needlessly expensive.
            if Path(rel).is_absolute() or ".." in Path(rel).parts:
                stamps.append((rel, None, None))
                continue
            try:
                stat = (self.root / rel).stat()
                stamps.append((rel, stat.st_mtime_ns, stat.st_size))
            except OSError:
                stamps.append((rel, None, None))
        return tuple(stamps)

    def text(self, category: str, language: str | None = None) -> dict[str, str]:
        """One requested category in the selected language; {} only for first run or a valid empty category."""
        if language is None:
            language = self.language()
        if language not in GAME_LANGUAGES:
            raise GameAssetError(f"text/{language}.json", "unsupported selected language")
        rel = f"text/{language}.json"
        data = self.json(rel)
        if data is None:
            return {}
        categories = data.get("categories")
        if not isinstance(categories, dict) or category not in categories:
            raise GameAssetError(rel, f"missing text category {category}")
        values = categories[category]
        if not isinstance(values, dict) or not all(isinstance(k, str) and k.isdecimal() and isinstance(v, str)
                                                  for k, v in values.items()):
            raise GameAssetError(rel, f"invalid text category {category}")
        return values


_shared = GameAssets()


def game_assets() -> GameAssets:
    """The app's game assets (one instance, so every loader sees the same import)."""
    return _shared
