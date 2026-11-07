"""First launch choices for a Windows installation with existing data."""

import shutil
from collections.abc import Callable
from pathlib import Path

from .settings import SettingsStore

YES, NO = 6, 7


def _remove(path: Path) -> None:
    if path.is_symlink():
        path.unlink()
    elif path.is_junction():
        path.rmdir()
    elif path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def prepare_installation(settings: SettingsStore, assets: Path, version: str, ask: Callable[[str], int]) -> bool:
    """Return false when the player cancels, before making changes."""
    saved = settings.get()
    if saved.installation_version == version:
        return True

    data = settings.path.parent
    records = (data / "runs", data / "battles")
    retain_records = True
    if any(path.is_dir() and any(path.iterdir()) for path in records):
        choice = ask("Keep your existing runs and battle history?\n\nYes keeps your records. No deletes them. Cancel exits setup.")
        if choice not in {YES, NO}:
            return False
        retain_records = choice == YES

    replace_import = False
    delete_import = False
    if assets.resolve() == (data / "game-assets").resolve() and assets.is_dir():
        choice = ask("Keep your previously imported game files?\n\nYes keeps the import. No lets you replace or delete it. Cancel exits setup.")
        if choice not in {YES, NO}:
            return False
        if choice == NO:
            choice = ask("Delete your previously imported game files?\n\nYes deletes the import now. No opens the app to import a replacement. Cancel exits setup.")
            if choice not in {YES, NO}:
                return False
            delete_import = choice == YES
            replace_import = choice == NO

    if not retain_records:
        for path in records:
            _remove(path)
    if delete_import:
        _remove(assets)
    for name in ("webview", "battle-recordings", "pairing-checks", "game-assets-import.log", "tracker.log", "tracker.log.1", "tracker.log.2",
                 "game-assets.importing"):
        _remove(data / name)
    settings.reset_installation(version, replace_import, saved.active_run_id if retain_records else None)
    return True
