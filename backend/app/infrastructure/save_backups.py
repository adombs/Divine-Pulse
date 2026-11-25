"""Snapshots of the game's save folder (Settings > Game Saves).

The save folders are found automatically (where each OS keeps them: system/platform/): Eden's (%APPDATA%/eden;
~/Library/Application Support/eden or ~/.local/share/eden; or a portable Eden's `user` folder), Ryujinx's family's
(Ryubing's and Ryujinx's Ryujinx folder, Astris's inside its macOS container, or a portable one beside Ryujinx.exe) and FE3H Recomp's (the `save` folder beside fe3hrecomp.exe, found while it runs and
remembered), unless one is set in Settings.

A snapshot is the whole save folder at one moment: every save slot, the autosave, the suspend save (the game's
bookmark) and the system file together, as the game left them. One is taken automatically whenever the game has
written its saves (once the folder has been still for a moment), and on request (Back Up Now). Automatic snapshots
keep the newest (the saves as they are now) and `save_backups` older ones; 0 turns them off. Snapshots taken by hand,
and the one taken just before a restore, stay until they are deleted.

Restoring puts the whole folder back as it was: each file the snapshot holds is written back, and save files made
since are removed (they are in the snapshot taken just before restoring). The game must be closed, as it keeps its
saves in memory while it runs.

Snapshots live in the data folder's `save-backups` folder: one folder per save folder, and in it one folder per
snapshot (named by its time and kind) holding the files and a snapshot.json that lists them with their checksums.
1.5.2's single-file copies are moved aside, into "Single-file copies (1.5.2)".
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import struct
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from ..system import platform
from ..system.files import in_os_metadata

log = logging.getLogger(__name__)

# Fire Emblem: Three Houses' title ID: its saves are in a folder of this name.
TITLE_ID = "010055D009F78000"
INTERVAL = 10.0
# A file written this recently may still be being written: it's copied on a later pass.
SETTLE_SECONDS = 2.0
# Ryujinx's family's executables (gamemem/ryujinx.py), whose portable data folder is beside them.
EDEN_PROGRAMS = frozenset({"eden.exe", "eden", "eden-cli"})
RYUJINX_PROGRAMS = frozenset({"ryujinx.exe", "ryujinx", "astris", "astris.exe"})


def eden_save_folders(appdata: str | None = None) -> list[Path]:
    """FE3H's save folders in Eden's user folder (platform.eden_user_dirs: %APPDATA%/eden on Windows; on macOS
    ~/Library/Application Support/eden and ~/.local/share/eden; on Linux ~/.local/share/eden, and the Flatpak's), one per
    emulated user profile. `appdata`: a Windows %APPDATA% folder to look in instead."""
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
    on macOS; ~/.config/Ryujinx and the Flatpaks' on Linux."""
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
    eden.exe, or on Linux beside its AppImage or in the folder it was started from), a portable Ryujinx's or Ryubing's (a `portable` folder beside Ryujinx.exe), and FE3H Recomp's (the `save`
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
    return list(dict.fromkeys(found))


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
        return program_save_folders(sorted(set(process_paths({"fe3hrecomp.exe", *EDEN_PROGRAMS, *RYUJINX_PROGRAMS}))))
    except OSError:
        return []


def find_save_folders() -> list[Path]:
    found = eden_save_folders() + [f for root in ryujinx_roots() for f in ryujinx_save_folders(root)]
    return found + [f for f in running_save_folders() if f not in found]




# The programs that hold the saves open while they run: a restore waits until none is running.
GAME_PROGRAMS = frozenset({"fe3hrecomp.exe", *EDEN_PROGRAMS, *RYUJINX_PROGRAMS})
SNAPSHOT_FILE = "snapshot.json"
# Where 1.5.2's copies of single files go, out of the way of the snapshots.
LEGACY_FOLDER = "Single-file copies (1.5.2)"
KIND_NAMES = {"auto": "Automatic", "manual": "Manual", "restore": "Before restore"}
PARTIAL = ".partial"
# A file being written back by a restore, until it replaces the save.
RESTORING = ".divine-pulse-restore"


class SnapshotError(RuntimeError):
    """A snapshot couldn't be taken, found, restored or deleted; the message says why, for the player."""


class GameRunning(SnapshotError):
    """The game (or the program that runs it) is open, so its saves can't be restored now."""


def game_is_running() -> bool:
    """Whether Eden, Ryujinx's family or FE3H Recomp is running."""
    from ..system.memory import find_processes

    try:
        return bool(find_processes(set(GAME_PROGRAMS)))
    except OSError:
        return False


def _label(source: Path) -> str:
    """The backup folder for a save folder: its last two folder names, e.g. "<profile> - 010055D009F78000", or
    "FE3H Recomp v0.1.8 - save". A Ryujinx save (".../save/<ID>/0") is "Ryujinx - <ID>", or "Astris - <ID>"."""
    if source.name == "0" and source.parent.parent.name == "save" and "bis" in source.parts:
        return f"{'Astris' if 'V380-Ori.Astris' in source.parts else 'Ryujinx'} - {source.parent.name}"
    parts = [p for p in source.parts[-2:] if p not in ("", "/", "\\")]
    name = " - ".join(p.rstrip(":\\/") for p in parts) or "saves"
    return "".join("_" if c in '<>:"/\\|?*' else c for c in name)


def _save_files(source: Path) -> dict[str, Path]:
    """The save folder's files by their path in it ("slot00", or "save_0/slot00" for FE3H Recomp), without the
    operating system's own files or a restore's unfinished ones."""
    found: dict[str, Path] = {}
    try:
        for file in sorted(source.rglob("*")):
            if in_os_metadata(file, source) or file.name.endswith(RESTORING) or not file.is_file():
                continue
            found[file.relative_to(source).as_posix()] = file
    except OSError as exc:
        log.warning("Couldn't list the saves in %s: %s", source, exc)
    return found


def _marks(files: dict[str, Path]) -> dict[str, tuple[int, int]]:
    marks = {}
    for name, file in files.items():
        try:
            stat = file.stat()
        except OSError:
            continue
        marks[name] = (stat.st_mtime_ns, stat.st_size)
    return marks


def _safe_name(name: str) -> bool:
    """A file name from a snapshot.json stays inside the folder it is written to."""
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts and ":" not in name and "\\" not in name


def _checksums(files: dict[str, Any]) -> dict[str, str]:
    return {name: info["sha256"] for name, info in files.items()}


class SaveBackups:
    """Takes snapshots of the save folders, in a background thread while the app runs, and restores them."""

    def __init__(
        self,
        settings: Any,
        folder: Path,
        find_sources: Callable[[], list[Path]] = find_save_folders,
        clock: Callable[[], float] = time.time,
        game_running: Callable[[], bool] = game_is_running,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.settings = settings
        self.folder = folder
        self._find_sources = find_sources
        self._clock = clock
        self._game_running = game_running
        self._sleep = sleep
        self._seen: dict[Path, dict[str, tuple[int, int]]] = {}
        self._tidied: set[Path] = set()
        self._keep: int | None = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # Public API (thread-safe)

    def sources(self) -> list[Path]:
        """The save folders there now (see known_sources)."""
        return [p for p in self.known_sources() if p.is_dir()]

    def known_sources(self) -> list[Path]:
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
        return known

    def status(self) -> dict[str, Any]:
        """The save folders and each one's snapshots, newest first."""
        saves = []
        for source in self.known_sources():
            dest = self.folder / _label(source)
            if not source.is_dir() and not self._snapshots(dest):
                continue
            saves.append({"id": _label(source), "path": str(source), "found": source.is_dir(),
                          "snapshots": self._records(dest)})
        return {"sources": [str(p) for p in self.sources()], "folder": str(self.folder),
                "game_running": self._game_running(), "saves": saves}

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
        """One automatic pass over the save folders; returns how many snapshots were taken."""
        with self._lock:
            keep = self.settings.get().save_backups
            if keep <= 0:
                return 0
            prune_all = keep != self._keep
            self._keep = keep
            made = 0
            for source in self.sources():
                made += self._auto(source, self.folder / _label(source), keep, prune_all)
            return made

    def take(self, source_id: str) -> dict[str, Any]:
        """Back Up Now: a snapshot of the save folder as it is, kept until it is deleted."""
        with self._lock:
            source = self._source(source_id)
            if not source.is_dir():
                raise SnapshotError(f"The save folder isn't there: {source}")
            data, files = self._capture_settled(source)
            if not files:
                raise SnapshotError("There are no saves to back up in this folder yet.")
            dest = self.folder / _label(source)
            snapshot = self._write(dest, "manual", data, files, self._clock())
            self._seen[source] = {n: (f["mtime_ns"], f["size"]) for n, f in files.items()}
            return self._record(snapshot, self._snapshots(dest))

    def restore(self, source_id: str, snapshot_id: str) -> dict[str, Any]:
        """Puts the save folder back as the snapshot has it, after keeping the saves as they are now in a snapshot of
        their own (unless they already match). Returns the restored snapshot, and the one taken just before."""
        with self._lock:
            if self._game_running():
                raise GameRunning("Close the game first: it keeps its saves in memory and would write them back.")
            source = self._source(source_id)
            dest = self.folder / _label(source)
            snapshot, files = self._find(dest, snapshot_id)
            data: dict[str, bytes] = {}
            for name, info in files.items():
                if not _safe_name(name):
                    raise SnapshotError(f"The snapshot lists a file outside its folder: {name}")
                try:
                    data[name] = (snapshot / name).read_bytes()
                except OSError as exc:
                    raise SnapshotError(f"The snapshot is missing {name}: {exc}") from exc
                if hashlib.sha256(data[name]).hexdigest() != info["sha256"]:
                    raise SnapshotError(f"The snapshot's copy of {name} is damaged, so nothing was restored.")
            source.mkdir(parents=True, exist_ok=True)
            now_data, now_files = self._capture_settled(source)
            before = None
            if now_files and _checksums(now_files) != _checksums(files):
                before = self._write(dest, "restore", now_data, now_files, self._clock())
            for name, info in files.items():
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                writing = target.with_name(target.name + RESTORING)
                writing.write_bytes(data[name])
                os.utime(writing, ns=(info["mtime_ns"], info["mtime_ns"]))
                os.replace(writing, target)
            for name, file in _save_files(source).items():
                if name not in files:
                    file.unlink()
            self._seen[source] = _marks(_save_files(source))
            snapshots = self._snapshots(dest)
            log.info("Restored the saves in %s from the snapshot %s", source, snapshot.name)
            return {"restored": self._record(snapshot, snapshots),
                    "kept": self._record(before, snapshots) if before is not None else None}

    def delete(self, source_id: str, snapshot_id: str) -> None:
        with self._lock:
            snapshot, _ = self._find(self.folder / _label(self._source(source_id)), snapshot_id)
            shutil.rmtree(snapshot)

    # Worker

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.back_up()
            except Exception:
                log.exception("Backing up the game saves failed")
            self._wake.wait(INTERVAL)
            self._wake.clear()

    def _auto(self, source: Path, dest: Path, keep: int, prune_all: bool) -> int:
        self._tidy(dest)
        marks = _marks(_save_files(source))
        if not marks:
            return 0
        if self._seen.get(source) == marks:
            if prune_all:
                self._prune(dest, keep)
            return 0
        written = max(mtime for mtime, _ in marks.values()) / 1e9
        if self._clock() - written < SETTLE_SECONDS:
            return 0  # the game may still be writing: the snapshot waits until the folder is still
        captured = self._capture(source)
        if captured is None:
            return 0
        data, files = captured
        made = 0
        sums = _checksums(files)
        if all(_checksums(known["files"]) != sums for _, known in self._snapshots(dest)):
            self._write(dest, "auto", data, files, written)
            made = 1
        self._seen[source] = {n: (f["mtime_ns"], f["size"]) for n, f in files.items()}
        self._prune(dest, keep)
        return made

    # Snapshots

    def _capture(self, source: Path) -> tuple[dict[str, bytes], dict[str, dict[str, Any]]] | None:
        """Every save file's bytes and details, or None if one changed while they were read."""
        found = _save_files(source)
        before = _marks(found)
        try:
            data = {name: found[name].read_bytes() for name in before}
        except OSError:
            return None
        if _marks(_save_files(source)) != before:
            return None
        return data, {name: {"size": size, "mtime_ns": mtime, "sha256": hashlib.sha256(data[name]).hexdigest()}
                      for name, (mtime, size) in before.items()}

    def _capture_settled(self, source: Path) -> tuple[dict[str, bytes], dict[str, dict[str, Any]]]:
        for _ in range(10):
            captured = self._capture(source)
            if captured is not None:
                return captured
            self._sleep(0.5)
        raise SnapshotError("The game kept writing its saves. Try again in a moment.")

    def _write(self, dest: Path, kind: str, data: dict[str, bytes], files: dict[str, dict[str, Any]], when: float) -> Path:
        stamp = datetime.fromtimestamp(when).strftime("%Y-%m-%d %H%M%S")
        target, n = dest / f"{stamp} {KIND_NAMES[kind]}", 2
        while target.exists() or target.with_name(target.name + PARTIAL).exists():
            target, n = dest / f"{stamp} {KIND_NAMES[kind]} ({n})", n + 1
        partial = target.with_name(target.name + PARTIAL)
        partial.mkdir(parents=True)
        try:
            for name, info in files.items():
                path = partial / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data[name])
                os.utime(path, ns=(info["mtime_ns"], info["mtime_ns"]))
            record = {"kind": kind, "time": datetime.fromtimestamp(when).isoformat(timespec="seconds"),
                      "taken": datetime.fromtimestamp(self._clock()).isoformat(timespec="seconds"), "files": files}
            (partial / SNAPSHOT_FILE).write_text(json.dumps(record, indent=1), encoding="utf-8")
            partial.rename(target)
        except BaseException:
            shutil.rmtree(partial, ignore_errors=True)
            raise
        return target

    def _snapshots(self, dest: Path) -> list[tuple[Path, dict[str, Any]]]:
        """The snapshots in a backup folder, oldest first."""
        found = []
        try:
            folders = [p for p in dest.iterdir() if p.is_dir() and not p.name.endswith(PARTIAL)]
        except OSError:
            return []
        for folder in folders:
            try:
                record = json.loads((folder / SNAPSHOT_FILE).read_text(encoding="utf-8"))
                if record.get("kind") in KIND_NAMES and isinstance(record.get("files"), dict):
                    found.append((folder, record))
            except (OSError, ValueError, AttributeError):
                continue
        return sorted(found, key=lambda s: (str(s[1].get("time", "")), str(s[1].get("taken", "")), s[0].name))

    def _records(self, dest: Path) -> list[dict[str, Any]]:
        snapshots = self._snapshots(dest)
        return [self._record(folder, snapshots) for folder, _ in reversed(snapshots)]

    @staticmethod
    def _record(folder: Path, snapshots: list[tuple[Path, dict[str, Any]]]) -> dict[str, Any]:
        """A snapshot for the page, with the saves that changed since the one before it."""
        at = next(i for i, (f, _) in enumerate(snapshots) if f == folder)
        record = snapshots[at][1]
        files = record["files"]
        changed = None
        if at > 0:
            earlier = _checksums(snapshots[at - 1][1]["files"])
            changed = sorted(n for n in set(files) | set(earlier) if earlier.get(n) != files.get(n, {}).get("sha256"))
        return {"id": folder.name, "kind": record["kind"], "time": record.get("time"), "files": sorted(files),
                "size": sum(int(f.get("size", 0)) for f in files.values()), "changed": changed}

    def _find(self, dest: Path, snapshot_id: str) -> tuple[Path, dict[str, Any]]:
        for folder, record in self._snapshots(dest):
            if folder.name == snapshot_id:
                return folder, record["files"]
        raise SnapshotError("That snapshot isn't there any more.")

    def _source(self, source_id: str) -> Path:
        for source in self.known_sources():
            if _label(source) == source_id:
                return source
        raise SnapshotError("That save folder isn't known any more.")

    def _prune(self, dest: Path, keep: int) -> None:
        """Keep the newest automatic snapshot (the saves as they are now) and `keep` older ones."""
        autos = [folder for folder, record in self._snapshots(dest) if record["kind"] == "auto"]
        for old in autos[: -(keep + 1)]:
            try:
                shutil.rmtree(old)
            except OSError as exc:
                log.warning("Couldn't remove the old save snapshot %s: %s", old, exc)

    def _tidy(self, dest: Path) -> None:
        """Once per run: clear unfinished snapshots, and move 1.5.2's single-file copies aside."""
        if dest in self._tidied or not dest.is_dir():
            return
        self._tidied.add(dest)
        for child in list(dest.iterdir()):
            try:
                if not child.is_dir() or child.name == LEGACY_FOLDER:
                    continue
                if child.name.endswith(PARTIAL):
                    shutil.rmtree(child)
                elif not (child / SNAPSHOT_FILE).exists():
                    (dest / LEGACY_FOLDER).mkdir(exist_ok=True)
                    child.rename(dest / LEGACY_FOLDER / child.name)
            except OSError as exc:
                log.warning("Couldn't tidy the save backups in %s: %s", dest, exc)

    # Remembered folders

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
