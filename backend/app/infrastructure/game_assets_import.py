"""Background import and safe replacement of a user's extracted game assets."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

from ..gamefiles import dump, verify
from ..gamefiles.extract import Context, FAMILIES, run
from ..gamefiles.output import Output
from .game_assets import game_assets
from .nsp_workspace import extraction_workspace, validate_destination


class BusyError(RuntimeError):
    pass


def import_assets(found, root: Path, progress, verifying, check_cancelled) -> None:
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
        report = verify.check(staging, require_complete=True)
        if not report.ok:
            raise ValueError("Verification failed: " + "; ".join(report.errors[:5]))
        check_cancelled()
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


class GameAssetsImport:
    def __init__(self, settings, events):
        self.settings, self.events = settings, events
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.worker: threading.Thread | None = None
        self.job = {"state": "idle", "phase": None, "done": 0, "total": len(FAMILIES) + 1, "error": None}

    def close(self) -> None:
        with self.lock:
            self.cancelled.set()
            worker = self.worker
        if worker is not None:
            worker.join()

    def _check_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise BusyError("The app closed before the import finished.")

    def status(self) -> dict:
        with self.lock:
            return {**game_assets().status(), "job": self.job.copy()}

    def emit(self) -> None:
        self.events.publish("game_assets", self.status())

    def scan(self, folder: str) -> dict:
        return scan(folder)

    def start(self, folder: str) -> dict:
        with self.lock:
            self._check_cancelled()
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            found = dump.find(Path(folder))
            if found.problems:
                raise ValueError(" ".join(found.problems))
            self.job = {"state": "running", "phase": "starting", "done": 0, "total": len(FAMILIES) + 1,
                        "error": None}
            job = self.status()["job"]
            self.worker = threading.Thread(target=self._run, args=(found,), daemon=True, name="game-assets-import")
            self.worker.start()
        self.emit()
        return job

    def start_nsps(self, nsps: list[str], keys: str, keep_dumps: str | None = None) -> dict:
        from .paths import DATA_DIR, FROZEN, INSTALL_DIR, PROJECT_ROOT

        packages = [Path(name) for name in nsps]
        key_path = Path(keys)
        tool = (INSTALL_DIR / "tools" / "nstool.exe") if FROZEN else (PROJECT_ROOT / "vendor" / "nstool" / "nstool.exe")
        if not packages or any(not path.is_file() or path.suffix.lower() != ".nsp" for path in packages):
            raise ValueError("Choose existing NSP files.")
        if not key_path.is_file():
            raise ValueError("Choose your prod.keys file.")
        if not tool.is_file():
            raise ValueError("Bundled NSTool was not found. Reinstall the application.")
        destination = Path(keep_dumps) if keep_dumps else None
        protected = (DATA_DIR, game_assets().root, INSTALL_DIR) if FROZEN else (DATA_DIR, game_assets().root)
        with self.lock:
            self._check_cancelled()
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            if destination is not None:
                validate_destination(destination, protected)
            self.job = {"state": "running", "phase": "extracting", "done": 0, "total": 0,
                        "error": None}
            job = self.status()["job"]
            self.worker = threading.Thread(target=self._run_nsps, args=(packages, key_path, tool, destination, protected),
                                           daemon=True, name="game-assets-nsp-import")
            self.worker.start()
        self.emit()
        return job

    def _run_nsps(self, packages: list[Path], keys: Path, tool: Path,
                  destination: Path | None, protected: tuple[Path, ...]) -> None:
        from .nsp_extractor import extract_nsps

        try:
            with extraction_workspace(destination, protected=protected) as workspace:
                extract_nsps(packages, tool, keys, workspace, cancelled=self.cancelled)
                found = dump.find(workspace)
                if found.problems:
                    raise ValueError(" ".join(found.problems))
                with self.lock:
                    self.job.update(total=len(FAMILIES) + 1, done=0)
                self._extract(found)
        except Exception as exc:
            self._failed(exc)
        else:
            self._completed()

    def _run(self, found) -> None:
        try:
            self._extract(found)
        except Exception as exc:
            self._failed(exc)
        else:
            self._completed()

    def _extract(self, found) -> None:
        def progress(message: str, out: Output) -> None:
            self._check_cancelled()
            with self.lock:
                if message.endswith(":") and message[:-1] in FAMILIES:
                    self.job["phase"] = message[:-1]
                    self.job["done"] = FAMILIES.index(message[:-1])
                self.job["files"] = len(out.files)
            self.emit()

        def verifying() -> None:
            self._check_cancelled()
            with self.lock:
                self.job.update(phase="verify", done=len(FAMILIES))
            self.emit()

        import_assets(found, game_assets().root, progress, verifying, self._check_cancelled)

    def _completed(self) -> None:
        with self.lock:
            if self.settings.get().replace_import:
                self.settings.update(replace_import=False)
            self.job.update(state="done", phase="done", done=self.job["total"])
        self.emit()

    def _failed(self, error: Exception) -> None:
        with self.lock:
            self.job.update(state="failed", phase="failed", error=str(error))
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
        report = verify.check(game_assets().root, require_complete=True)
        return {"ok": report.ok, "checked": report.checked, "errors": report.errors[:200],
                "warnings": report.warnings[:200]}
