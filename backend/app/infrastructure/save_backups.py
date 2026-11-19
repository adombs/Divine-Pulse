"""Keep copies of the game's save files (Settings > General > Backup Game Saves).

The save folders are found automatically: Eden's (%APPDATA%/eden, or a portable Eden's `user` folder) and FE3H
Recomp's (the `save` folder beside fe3hrecomp.exe, found while it runs and remembered), unless one is set in Settings.

Every save file in the save folder is copied as soon as it is seen, so when the game overwrites it the version it
replaced is already kept. Each file keeps its newest copy (the save as it is now) and up to `save_backups` older
versions; 0 turns backups off. Copies live in the data folder's `save-backups` folder, one folder per save file, each
copy named after the time the game wrote it: to restore one, copy it back over the save with its original name.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Fire Emblem: Three Houses' title ID: its saves are in a folder of this name.
TITLE_ID = "010055D009F78000"
INTERVAL = 10.0
# A file written this recently may still be being written: it's copied on a later pass.
SETTLE_SECONDS = 2.0


def eden_save_folders(appdata: str | None = None) -> list[Path]:
    """FE3H's save folders in Eden's user folder (%APPDATA%/eden), one per emulated user profile."""
    appdata = appdata if appdata is not None else os.environ.get("APPDATA")
    return _eden_saves(Path(appdata) / "eden") if appdata else []


def program_save_folders(programs: list[str]) -> list[Path]:
    """The save folders of running programs, given their executable paths: a portable Eden's (a `user` folder beside
    eden.exe), and FE3H Recomp's (the `save` folder beside fe3hrecomp.exe, one `save_N` folder per profile)."""
    found: list[Path] = []
    for program in programs:
        exe = Path(program)
        if exe.name.lower() == "fe3hrecomp.exe":
            found += [exe.parent / "save"] if (exe.parent / "save").is_dir() else []
        else:
            found += _eden_saves(exe.parent / "user")
    return found


def _eden_saves(user: Path) -> list[Path]:
    base = user / "nand" / "user" / "save" / "0000000000000000"
    try:
        profiles = sorted(p for p in base.iterdir() if p.is_dir())
    except OSError:
        return []
    found = []
    for profile in profiles:
        try:
            found += [p for p in profile.iterdir() if p.is_dir() and p.name.upper() == TITLE_ID]
        except OSError:
            continue
    return found


def running_save_folders() -> list[Path]:
    """The save folders of Eden or FE3H Recomp, if one is running."""
    from ..system.memory import process_paths

    try:
        return program_save_folders(sorted(set(process_paths({"eden.exe", "fe3hrecomp.exe"}))))
    except OSError:
        return []


def find_save_folders() -> list[Path]:
    return eden_save_folders() + running_save_folders()


def _label(source: Path) -> str:
    """The backup folder for a save folder: its last two folder names, e.g. "<profile> - 010055D009F78000", or
    "FE3H Recomp v0.1.8 - save"."""
    parts = [p for p in source.parts[-2:] if p not in ("", "/", "\\")]
    name = " - ".join(p.rstrip(":\\/") for p in parts) or "saves"
    return "".join("_" if c in '<>:"/\\|?*' else c for c in name)


class SaveBackups:
    """Copies new versions of the save files into `folder`, in a background thread while the app runs."""

    def __init__(
        self,
        settings: Any,
        folder: Path,
        find_sources: Callable[[], list[Path]] = find_save_folders,
        clock: Callable[[], float] = time.time,
    ):
        self.settings = settings
        self.folder = folder
        self._find_sources = find_sources
        self._clock = clock
        self._seen: dict[Path, tuple[int, int]] = {}
        self._keep: int | None = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # Public API (thread-safe)

    def sources(self) -> list[Path]:
        """The custom save folder, or every save folder found so far: the ones found now, and the ones found while
        the game was running before (remembered in folders.json), so a portable Eden's or FE3H Recomp's are still
        backed up while it is closed."""
        custom = self.settings.get().save_folder
        if custom:
            return [Path(custom).expanduser()]
        known = self._remembered()
        found = [p for p in self._find_sources() if p not in known]
        if found:
            known += found
            self._remember(known)
        return [p for p in known if p.is_dir()]

    def _remembered(self) -> list[Path]:
        try:
            return [Path(p) for p in json.loads((self.folder / "folders.json").read_text(encoding="utf-8"))]
        except (OSError, ValueError, TypeError):
            return []

    def _remember(self, folders: list[Path]) -> None:
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            (self.folder / "folders.json").write_text(json.dumps([str(p) for p in folders], indent=1), encoding="utf-8")
        except OSError as exc:
            log.warning("Couldn't remember the save folders: %s", exc)

    def status(self) -> dict[str, Any]:
        return {"sources": [str(p) for p in self.sources()], "folder": str(self.folder)}

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="save-backups", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def settings_changed(self) -> None:
        self._wake.set()

    def back_up(self) -> int:
        """One pass over the save folders; returns how many copies were made."""
        with self._lock:
            keep = self.settings.get().save_backups
            if keep <= 0:
                return 0
            prune_all = keep != self._keep
            self._keep = keep
            made = 0
            for source in self.sources():
                if source.is_dir():
                    made += self._back_up_folder(source, self.folder / _label(source), keep, prune_all)
            return made

    # Worker

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.back_up()
            except Exception:
                log.exception("Backing up the game saves failed")
            self._wake.wait(INTERVAL)
            self._wake.clear()

    def _back_up_folder(self, source: Path, dest: Path, keep: int, prune_all: bool) -> int:
        made = 0
        for file in sorted(source.rglob("*")):
            try:
                if not file.is_file():
                    continue
                stat = file.stat()
                versions = dest / file.relative_to(source)
                mark = (stat.st_mtime_ns, stat.st_size)
                if self._seen.get(file) == mark:
                    if prune_all:
                        self._prune(versions, keep)
                    continue
                if self._clock() - stat.st_mtime < SETTLE_SECONDS:
                    continue  # the game may still be writing it
                data = file.read_bytes()
                existing = self._versions(versions)
                if not existing or existing[-1].read_bytes() != data:
                    self._write(versions, file.name, data, stat.st_mtime_ns)
                    made += 1
                self._seen[file] = mark
                self._prune(versions, keep)
            except OSError as exc:
                log.warning("Couldn't back up %s: %s", file, exc)
        return made

    @staticmethod
    def _versions(versions: Path) -> list[Path]:
        try:
            return sorted((p for p in versions.iterdir() if p.is_file() and not p.name.endswith(".partial")), key=lambda p: (p.stat().st_mtime_ns, p.name))
        except OSError:
            return []

    @staticmethod
    def _write(versions: Path, name: str, data: bytes, mtime_ns: int) -> None:
        versions.mkdir(parents=True, exist_ok=True)
        stamp = datetime.fromtimestamp(mtime_ns / 1e9).strftime("%Y-%m-%d %H%M%S")
        target, n = versions / f"{stamp} {name}", 2
        while target.exists():
            target, n = versions / f"{stamp} ({n}) {name}", n + 1
        partial = target.with_name(target.name + ".partial")
        partial.write_bytes(data)
        os.utime(partial, ns=(mtime_ns, mtime_ns))
        partial.replace(target)

    def _prune(self, versions: Path, keep: int) -> None:
        """Keep the newest copy (the save as it is now) and `keep` older versions."""
        for old in self._versions(versions)[: -(keep + 1)]:
            try:
                old.unlink()
            except OSError as exc:
                log.warning("Couldn't remove the old save backup %s: %s", old, exc)
