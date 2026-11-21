"""Background import and safe replacement of a user's extracted game assets."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from ..gamefiles import dump, verify
from ..gamefiles.extract import Context, FAMILIES, run
from ..gamefiles.output import Output
from .game_assets import game_assets
from .nsp_workspace import extraction_workspace, validate_destination


NSTOOL_NAME = "nstool.exe" if sys.platform == "win32" else "nstool"
NSTOOL_DOWNLOAD = "https://github.com/jakcron/nstool/releases/latest"
NSTOOL_MISSING = (
    f"NSTool wasn't found. Download the latest macOS release from {NSTOOL_DOWNLOAD} (macos_arm64 for Apple silicon, "
    "macos_x64 for Intel), unzip it, and put the nstool file in your Applications or Downloads folder. Or import a "
    "dump folder instead."
)
NSTOOL_BLOCKED = (
    "macOS blocked NSTool ({path}) because it was downloaded from the internet. Open System Settings > Privacy & "
    "Security, click Allow Anyway next to \"nstool\", then import again (choose Open if macOS asks)."
)


def _mac_download_spots(home: Path) -> list[Path]:
    """Where a Mac user is likely to have put a downloaded nstool: Applications and Downloads, as the bare file or
    in the folder its zip unpacked to, and Homebrew's and /usr/local's bin (not on a GUI app's PATH)."""
    spots: list[Path] = []
    for folder in (Path("/Applications"), home / "Applications", home / "Downloads", home / "Desktop"):
        spots.append(folder / "nstool")
        try:
            spots += sorted((p / "nstool" for p in folder.glob("nstool*") if p.is_dir()), reverse=True)  # newest first
        except OSError:
            continue
    return spots + [Path("/opt/homebrew/bin/nstool"), Path("/usr/local/bin/nstool")]


def nstool_path(install_dir: Path | None, project_root: Path, home: Path | None = None) -> Path | None:
    """NSTool: bundled with the Windows program (tools/nstool.exe) or vendored for source runs; on macOS and Linux,
    a build beside the vendored copy (vendor/nstool/nstool), on PATH, or (macOS) where a download usually ends up
    (_mac_download_spots). None if there is none."""
    candidates = [install_dir / "tools" / NSTOOL_NAME] if install_dir is not None else []
    candidates.append(project_root / "vendor" / "nstool" / NSTOOL_NAME)
    if sys.platform != "win32":
        if on_path := shutil.which("nstool"):
            candidates.append(Path(on_path))
        if sys.platform == "darwin":
            candidates += _mac_download_spots(home if home is not None else Path.home())
    return next((c for c in candidates if c.is_file()), None)


def check_nstool(tool: Path) -> None:
    """Raise ValueError saying how to fix it when NSTool can't run: not executable, or (macOS) killed by Gatekeeper
    on its first run after a browser download, until the user allows it in System Settings."""
    if sys.platform == "win32":
        return
    if not os.access(tool, os.X_OK):
        raise ValueError(f"NSTool ({tool}) isn't executable. Download it again from {NSTOOL_DOWNLOAD} and unzip it.")
    try:
        result = subprocess.run([str(tool)], capture_output=True, timeout=30)
    except OSError as exc:
        raise ValueError(f"NSTool ({tool}) couldn't start: {exc}. Download it again from {NSTOOL_DOWNLOAD}.") from exc
    except subprocess.TimeoutExpired:
        return  # it runs
    if result.returncode < 0:  # killed by a signal: Gatekeeper's SIGKILL for an unapproved download
        raise ValueError(NSTOOL_BLOCKED.format(path=tool))


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


_NSP_STAGE = re.compile(r"^(?:Counting files: )?NSP (\d+)/(\d+) - (.+)$")
_METADATA_STAGE = re.compile(r"^Reading metadata (\d+)/(\d+)$")
_PARTITION_STAGE = re.compile(r"^(?:Counting files: )?(ExeFS|RomFS) - (.+)$")
_DLC_FOLDER = re.compile(r"^(?:[0-9A-Fa-f]{16}|content-\d+)$")


def describe_extraction(stage: str) -> str:
    """The NSP extractor's stage name in plain words."""
    if found := _NSP_STAGE.match(stage):
        return f"Unpacking {found.group(3)} ({found.group(1)} of {found.group(2)})"
    if found := _METADATA_STAGE.match(stage):
        return f"Reading package details ({found.group(1)} of {found.group(2)})"
    if found := _PARTITION_STAGE.match(stage):
        dlc = _DLC_FOLDER.match(found.group(2))
        if found.group(1) == "ExeFS":
            return "Extracting the game program"
        return "Extracting DLC files" if dlc else "Extracting game files (the longest part)"
    if stage.startswith("Finishing"):
        return "Removing temporary files"
    return "Unpacking NSP files"


class GameAssetsImport:
    def __init__(self, settings, events):
        self.settings, self.events = settings, events
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.worker: threading.Thread | None = None
        self.job = {"state": "idle", "phase": None, "done": 0, "total": len(FAMILIES) + 1, "error": None}
        self._emitted = 0.0

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
                        "error": None, "source": "dump", "started": time.time()}
            job = self.status()["job"]
            self.worker = threading.Thread(target=self._run, args=(found,), daemon=True, name="game-assets-import")
            self.worker.start()
        self.emit()
        return job

    def start_nsps(self, nsps: list[str], keys: str, keep_dumps: str | None = None) -> dict:
        from .paths import DATA_DIR, FROZEN, INSTALL_DIR, PROJECT_ROOT

        packages = [Path(name) for name in nsps]
        key_path = Path(keys)
        tool = nstool_path(INSTALL_DIR if FROZEN else None, PROJECT_ROOT)
        if not packages or any(not path.is_file() or path.suffix.lower() != ".nsp" for path in packages):
            raise ValueError("Choose existing NSP files.")
        if not key_path.is_file():
            raise ValueError("Choose your prod.keys file.")
        if tool is None:
            raise ValueError("Bundled NSTool was not found. Reinstall the application." if sys.platform == "win32"
                             else NSTOOL_MISSING)
        check_nstool(tool)
        destination = Path(keep_dumps) if keep_dumps else None
        protected = (DATA_DIR, game_assets().root, INSTALL_DIR) if FROZEN else (DATA_DIR, game_assets().root)
        with self.lock:
            self._check_cancelled()
            if self.job["state"] == "running":
                raise BusyError("An import is already running.")
            if destination is not None:
                validate_destination(destination, protected)
            self.job = {"state": "running", "phase": "extracting", "done": 0, "total": 0,
                        "error": None, "source": "nsp", "started": time.time(),
                        "step": {"label": "Unpacking NSP files", "done": 0, "total": 0, "current": ""}}
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
                extract_nsps(packages, tool, keys, workspace, cancelled=self.cancelled, progress=self._extracting)
                found = dump.find(workspace)
                if found.problems:
                    raise ValueError(" ".join(found.problems))
                with self.lock:
                    self.job.update(phase="starting", total=len(FAMILIES) + 1, done=0)
                    self.job.pop("step", None)
                self._extract(found)
        except Exception as exc:
            self._failed(exc)
        else:
            self._completed()

    def _extracting(self, event: dict) -> None:
        """The NSP extractor's progress: which package or part it is on, and how many of its files are written."""
        step = {"label": describe_extraction(str(event.get("stage", ""))), "done": int(event.get("completed") or 0),
                "total": int(event.get("total") or 0), "current": Path(str(event.get("current") or "")).name}
        with self.lock:
            changed = self.job.get("step", {}).get("label") != step["label"]
            self.job["step"] = step
        # The extractor reports several times a second; a new part shows at once, file counts at most twice a second.
        if changed or time.monotonic() - self._emitted >= 0.5:
            self._emitted = time.monotonic()
            self.emit()

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
