"""Background import and safe replacement of a user's extracted game assets."""

from __future__ import annotations

import os
import shutil
import threading
import tempfile
from pathlib import Path

from ..gamefiles import dump, verify
from ..gamefiles.extract import Context, FAMILIES, run
from ..gamefiles.output import Output
from .game_assets import game_assets


class BusyError(RuntimeError):
    pass


def import_assets(found, root: Path, progress, verifying=lambda: None) -> None:
    """Extract, verify and atomically replace an import, preserving the previous one on failure."""
    staging = root.with_name(root.name + ".importing")
    backup = root.with_name(root.name + ".previous")
    moved = False
    try:
        if staging.exists():
            shutil.rmtree(staging)
        out = Output(staging)
        ctx = Context(found, out, log=lambda message: progress(message, out))
        families = run(ctx)
        out.write_manifest(dump={"version": found.version, "build": ctx.main.build_id if ctx.main else None,
                                 "dlc": sorted(found.dlc), "exefs": bool(found.main_path and found.main_path.is_file())},
                           families=families)
        verifying()
        report = verify.check(staging)
        if not report.ok:
            raise ValueError("Verification failed: " + "; ".join(report.errors[:5]))
        if backup.exists():
            shutil.rmtree(backup)
        if root.exists():
            root.rename(backup)
            moved = True
        try:
            staging.rename(root)
        except Exception:
            if moved:
                backup.rename(root)
                moved = False
            raise
        if moved:
            shutil.rmtree(backup, ignore_errors=True)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def scan(folder: str) -> dict:
    found = dump.find(Path(folder))
    build = found.build
    return {"romfs": str(found.romfs) if found.romfs else None, "exefs": str(found.exefs) if found.exefs else None,
            "build": build, "version": found.version, "supported": found.version is not None,
            "parts": found.parts(), "importable": not found.problems, "problems": found.problems,
            "dlc": {name: str(found.dlc[name]) if name in found.dlc else None
                    for name in dump.DLC_TITLES.values()}}


EMULATOR_FOLDERS = ("eden", "yuzu", "suyu", "sudachi", "citron", "torzu", "Ryujinx")
EMULATOR_SUBFOLDERS = ("dump", "load", "mods/contents", "user/dump", "user/load")
NAME_HINTS = ("three houses", "threehouses", "fe3h", "fire emblem", "romfs", dump.BASE_TITLE.lower())
MARKERS = ("romfs", "exefs", dump.BASE_TITLE.lower())


def _subdirs(folder: Path) -> list[Path]:
    try:
        return [child for child in folder.iterdir() if child.is_dir()]
    except OSError:
        return []


def _plausible(folder: Path) -> bool:
    """Cheap check (one folder listing) before the deeper dump.find()."""
    if (folder / "DATA0.bin").is_file():
        return True
    return any(child.name.lower() in MARKERS for child in _subdirs(folder))


def _describe(folder: Path) -> dict | None:
    try:
        found = dump.find(folder)
        if found.romfs is None:
            return None
        return {"path": str(folder), "romfs": str(found.romfs), "exefs": bool(found.exefs),
                "version": found.version, "supported": found.version is not None,
                "parts": found.parts(), "importable": not found.problems, "problems": found.problems,
                "dlc": [name for name in dump.DLC_TITLES.values() if name in found.dlc],
                "modified": found.romfs.stat().st_mtime}
    except (OSError, ValueError):
        return None


def candidates(last_dump: str | None = None, env: dict | None = None) -> list[dict]:
    """Real game dumps in the usual places, newest first. Existence checks and shallow listings only."""
    env = os.environ if env is None else env
    roots: list[Path] = []
    if last_dump:
        last = Path(last_dump)
        roots += [last, last.parent]
    appdata = env.get("APPDATA")
    if appdata:
        roots += [Path(appdata) / emu / sub for emu in EMULATOR_FOLDERS for sub in EMULATOR_SUBFOLDERS]
    home = env.get("USERPROFILE") or env.get("HOME")
    if home:
        for name in ("Desktop", "Downloads", "Documents"):
            roots += [child for child in _subdirs(Path(home) / name)
                      if any(hint in child.name.lower() for hint in NAME_HINTS) or _plausible(child)]
    seen, found = set(), []
    for root in roots:
        if not root.is_dir() or not _plausible(root):
            continue
        item = _describe(root)
        if item and item["romfs"] not in seen:
            seen.add(item["romfs"])
            found.append(item)
    return sorted(found, key=lambda item: item["modified"], reverse=True)


class GameAssetsImport:
    def __init__(self, settings, events):
        self.settings, self.events = settings, events
        self.lock = threading.RLock()
        self.job = {"state": "idle", "phase": None, "done": 0, "total": len(FAMILIES) + 1, "error": None, "log": []}

    def status(self) -> dict:
        with self.lock:
            return {**game_assets().status(), "last_dump": self.settings.get().last_dump,
                    "job": {**self.job, "log": list(self.job["log"])}}

    def emit(self) -> None:
        self.events.publish("game_assets", self.status())

    def scan(self, folder: str) -> dict:
        return scan(folder)

    def candidates(self) -> list[dict]:
        return candidates(self.settings.get().last_dump)

    def start(self, folder: str) -> dict:
        with self.lock:
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            found = dump.find(Path(folder))
            if found.problems:
                raise ValueError(" ".join(found.problems))
            self.settings.update(last_dump=folder)
            self.job = {"state": "running", "phase": "starting", "done": 0, "total": len(FAMILIES) + 1,
                        "error": None, "log": []}
            job = self.status()["job"]
            threading.Thread(target=self._run, args=(found,), daemon=True, name="game-assets-import").start()
        self.emit()
        return job

    def start_nsps(self, nsps: list[str], keys: str) -> dict:
        from .paths import INSTALL_DIR, PROJECT_ROOT, FROZEN

        packages = [Path(name) for name in nsps]
        key_path = Path(keys)
        tool = (INSTALL_DIR / "tools" / "nstool.exe") if FROZEN else (PROJECT_ROOT / "vendor" / "nstool" / "nstool.exe")
        if not packages or any(not path.is_file() or path.suffix.lower() != ".nsp" for path in packages):
            raise ValueError("Choose existing NSP files.")
        if not key_path.is_file():
            raise ValueError("Choose your prod.keys file.")
        if not tool.is_file():
            raise ValueError("Bundled NSTool was not found. Reinstall the application.")
        with self.lock:
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            self.job = {"state": "running", "phase": "extracting", "done": 0, "total": 0,
                        "error": None, "log": []}
            job = self.status()["job"]
            threading.Thread(target=self._run_nsps, args=(packages, key_path, tool), daemon=True,
                             name="game-assets-nsp-import").start()
        self.emit()
        return job

    def _run_nsps(self, packages: list[Path], keys: Path, tool: Path) -> None:
        from .nsp_extractor import extract_nsps

        try:
            with tempfile.TemporaryDirectory(prefix="divine-pulse-nsp-") as temp:
                def log(message: str) -> None:
                    with self.lock:
                        self.job["log"] = (self.job["log"] + [message])[-200:]
                    self.emit()
                extract_nsps(packages, tool, keys, Path(temp), log)
                found = dump.find(Path(temp))
                if found.problems:
                    raise ValueError(" ".join(found.problems))
                with self.lock:
                    self.job.update(total=len(FAMILIES) + 1, done=0)
                self._run(found)
        except Exception as exc:
            with self.lock:
                self.job.update(state="failed", phase="failed", error=str(exc))
            self.emit()

    def _run(self, found) -> None:
        root = game_assets().root
        try:
            def progress(message: str, out: Output) -> None:
                with self.lock:
                    self.job["log"].append(message)
                    self.job["log"] = self.job["log"][-200:]
                    if message.endswith(":") and message[:-1] in FAMILIES:
                        self.job["phase"] = message[:-1]
                        self.job["done"] = FAMILIES.index(message[:-1])
                    self.job["files"] = len(out.files)
                self.emit()

            def verifying() -> None:
                with self.lock:
                    self.job.update(phase="verify", done=len(FAMILIES))
                self.emit()

            import_assets(found, root, progress, verifying)
            with self.lock:
                self.job.update(state="done", phase="done", done=self.job["total"])
        except Exception as exc:
            with self.lock:
                self.job.update(state="failed", phase="failed", error=str(exc))
        finally:
            self.emit()

    def delete(self) -> None:
        with self.lock:
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            root = game_assets().root
            if root.exists():
                shutil.rmtree(root)
        self.emit()

    def verify(self) -> dict:
        report = verify.check(game_assets().root)
        return {"ok": report.ok, "checked": report.checked, "errors": report.errors[:200],
                "warnings": report.warnings[:200]}
