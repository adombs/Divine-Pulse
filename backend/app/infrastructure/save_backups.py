"""Keep copies of the game's save files (Settings > General > Backup Game Saves).

The save folders are found automatically (where each OS keeps them: system/platform/): Eden's (%APPDATA%/eden;
~/Library/Application Support/eden or ~/.local/share/eden; or a portable Eden's `user` folder), Ryujinx's family's
(Ryubing's and Ryujinx's Ryujinx folder, Astris's inside its macOS container, or a portable one beside Ryujinx.exe) and FE3H Recomp's (the `save` folder beside fe3hrecomp.exe, found while it runs and
remembered), unless one is set in Settings.

Every save file in the save folder is copied as soon as it is seen, so when the game overwrites it the version it
replaced is already kept. Each file keeps its newest copy (the save as it is now) and up to `save_backups` older
versions; 0 turns backups off. Copies live in the data folder's `save-backups` folder, one folder per save file, each
copy named after the time the game wrote it: to restore one, copy it back over the save with its original name.
"""

from __future__ import annotations

import json
import logging
import os
import struct
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from ..system import platform
from ..system.files import in_os_metadata, is_os_metadata

log = logging.getLogger(__name__)

# Fire Emblem: Three Houses' title ID: its saves are in a folder of this name.
TITLE_ID = "010055D009F78000"
INTERVAL = 10.0
# A file written this recently may still be being written: it's copied on a later pass.
SETTLE_SECONDS = 2.0
# Ryujinx's family's executables (gamemem/ryujinx.py), whose portable data folder is beside them.
RYUJINX_PROGRAMS = frozenset({"ryujinx.exe", "ryujinx", "astris", "astris.exe"})


def eden_save_folders(appdata: str | None = None) -> list[Path]:
    """FE3H's save folders in Eden's user folder (platform.eden_user_dirs: %APPDATA%/eden on Windows; on macOS
    ~/Library/Application Support/eden and ~/.local/share/eden; on Linux ~/.local/share/eden), one per emulated user
    profile. `appdata`: a Windows %APPDATA% folder to look in instead."""
    users = [Path(appdata) / "eden"] if appdata is not None else platform.current().eden_user_dirs()
    found: list[Path] = []
    for user in users:
        found += [f for f in _eden_saves(user) if f not in found]
    return found


# Ryujinx's save index (bis/system/save/8000000000000000/0/imkvdb.arc): "IMKV", u32 reserved, u32 entry count,
# then per entry "IMEN", u32 key size, u32 value size, the key (a save data attribute: u64 program ID first) and the
# value (u64 save data ID first). A save's files are in bis/user/save/<save data ID as 16 hex digits>/0 (the
# committed copy; Ryujinx writes to 1 and then swaps).
_IMKVDB = Path("bis") / "system" / "save" / "8000000000000000" / "0" / "imkvdb.arc"


def ryujinx_roots(home: Path | None = None, appdata: str | None = None) -> list[Path]:
    """Where Ryujinx and its forks keep their data on this computer (platform.ryujinx_roots): %APPDATA%/Ryujinx
    (Ryubing, Ryujinx) on Windows; ~/Library/Application Support/Ryujinx (Ryubing) and Astris's sandbox container's
    on macOS; ~/.config/Ryujinx on Linux."""
    env = {"APPDATA": appdata} if appdata is not None else None
    return platform.current().ryujinx_roots(env=env, home=home)


def ryujinx_save_folders(root: Path) -> list[Path]:
    """FE3H's save folders in a Ryujinx data folder (one per user profile), from its save index."""
    try:
        data = (root / _IMKVDB).read_bytes()
    except OSError:
        return []
    if data[:4] != b"IMKV" or len(data) < 12:
        return []
    count, at, found = struct.unpack_from("<I", data, 8)[0], 12, []
    title = int(TITLE_ID, 16)
    for _ in range(count):
        if data[at : at + 4] != b"IMEN" or at + 12 > len(data):
            break
        key_size, value_size = struct.unpack_from("<II", data, at + 4)
        key, value = at + 12, at + 12 + key_size
        at = value + value_size
        if key_size < 8 or value_size < 8 or at > len(data):
            break
        if struct.unpack_from("<Q", data, key)[0] == title:
            folder = root / "bis" / "user" / "save" / f"{struct.unpack_from('<Q', data, value)[0]:016x}" / "0"
            if folder.is_dir() and folder not in found:
                found.append(folder)
    return found


def program_save_folders(programs: list[str]) -> list[Path]:
    """The save folders of running programs, given their executable paths: a portable Eden's (a `user` folder beside
    eden.exe), a portable Ryujinx's or Ryubing's (a `portable` folder beside Ryujinx.exe), and FE3H Recomp's (the `save`
    folder beside fe3hrecomp.exe, one `save_N` folder per profile)."""
    found: list[Path] = []
    for program in programs:
        exe = Path(program)
        if exe.name.lower() == "fe3hrecomp.exe":
            found += [exe.parent / "save"] if (exe.parent / "save").is_dir() else []
        elif exe.name.lower() in RYUJINX_PROGRAMS:
            found += ryujinx_save_folders(exe.parent / "portable")
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
    """The save folders of Eden, Ryujinx's family or FE3H Recomp, if one is running."""
    from ..system.memory import process_paths

    try:
        return program_save_folders(sorted(set(process_paths({"eden.exe", "fe3hrecomp.exe", *RYUJINX_PROGRAMS}))))
    except OSError:
        return []


def find_save_folders() -> list[Path]:
    found = eden_save_folders() + [f for root in ryujinx_roots() for f in ryujinx_save_folders(root)]
    return found + [f for f in running_save_folders() if f not in found]


def _label(source: Path) -> str:
    """The backup folder for a save folder: its last two folder names, e.g. "<profile> - 010055D009F78000", or
    "FE3H Recomp v0.1.8 - save". A Ryujinx save (".../save/<ID>/0") is "Ryujinx - <ID>", or "Astris - <ID>"."""
    if source.name == "0" and source.parent.parent.name == "save" and "bis" in source.parts:
        return f"{'Astris' if 'V380-Ori.Astris' in source.parts else 'Ryujinx'} - {source.parent.name}"
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
                if in_os_metadata(file, source) or not file.is_file():
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
            return sorted((p for p in versions.iterdir()
                           if p.is_file() and not p.name.endswith(".partial") and not is_os_metadata(p.name)), key=lambda p: (p.stat().st_mtime_ns, p.name))
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
