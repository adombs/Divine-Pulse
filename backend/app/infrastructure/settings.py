"""Settings data and its JSON persistence adapter."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path


from .json_files import atomic_write_text, preserve_original, read_with_backup
from .paths import DATA_DIR
from ..domain.settings import Settings

log = logging.getLogger(__name__)


class SettingsStore:
    def __init__(self, path: Path | None = None):
        self.path = path or DATA_DIR / "settings.json"
        self._lock = threading.Lock()
        self._settings = self._load()

    def _load(self) -> Settings:
        settings = Settings()
        if self.path.exists():
            try:
                saved = read_with_backup(self.path, json.loads)
                settings = Settings.model_validate(saved)
            except (OSError, ValueError) as exc:
                log.error(
                    "Could not read %s (%s); starting with default settings.",
                    self.path,
                    exc,
                )
                try:
                    backup = preserve_original(self.path, suffix=".broken.json")
                    self.path.unlink()
                    log.error("Preserved unreadable settings as %s.", backup)
                except OSError:
                    log.exception("Could not preserve unreadable settings %s.", self.path)
        return settings

    def get(self) -> Settings:
        with self._lock:
            return self._settings.model_copy(deep=True)

    def reset_installation(self, version: str, replace_import: bool, active_run_id: str | None) -> None:
        """Start an installation with clean preferences and discard backups containing old source paths."""
        with self._lock:
            clean = Settings(installation_version=version, replace_import=replace_import, active_run_id=active_run_id)
            atomic_write_text(self.path, clean.model_dump_json(indent=2))
            self.path.with_suffix(self.path.suffix + ".bak").unlink(missing_ok=True)
            self._settings = clean

    def update(self, **changes) -> Settings:
        with self._lock:
            updated = Settings.model_validate({**self._settings.model_dump(), **changes})
            atomic_write_text(self.path, json.dumps(updated.model_dump(), indent=2), backup=True)
            self._settings = updated
            return self._settings.model_copy(deep=True)


__all__ = [
    "Settings",
    "SettingsStore",
]
