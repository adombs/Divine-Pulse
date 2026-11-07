"""Identify game dump components by their contents."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import os
import re

BASE_TITLE = "010055D009F78000"
DLC_TITLES = {
    "010055D009F79001": "cindered_shadows",
    "010055D009F79002": "new_attire",
    "010055D009F79003": "auxiliary_battle_maps",
    "010055D009F79004": "additional_quests",
    "010055D009F79005": "additional_support_items",
    "010055D009F79006": "officers_academy_uniform",
}
SUPPORTED_BUILDS = {"89048449BA238C8CF565518B83BF02D3": "1.2.0"}
UPDATE_PATCH = 4  # update 1.2.0's newest patch folder
# SHA-256 of each 33,920-byte DATA0 index in the supplied desktop DLC dumps.
DLC_INDEX_HASHES = {
    "787E74AFEBD8E53EE68841C857ECEFE2A6CD6B4D6F5FF3365877BF43DCB78615": "010055D009F79001",
    "393BABE750745B62DCFE1C4E62F0F069019C5D2D0B7F0219A65AD939B0AF3564": "010055D009F79002",
    "FB679964BE5B8BC81D47671591E9F39EA5BE92FC48D974C178E445667FED6890": "010055D009F79003",
    "1B0FEB168D69C887450FD082AD16297FF1AA4308F26913000F1FB8DF84C64D6A": "010055D009F79004",
    "F1205C3087E39320C854AA9F4C4AA653138813173F9551B9B285D19EDFDADE58": "010055D009F79005",
    "6D9FF374DC59451D543E33A9A1A9643649270AFB52B20E51E521143C26AF50EF": "010055D009F79006",
}
TITLE_ID = re.compile(r"0100[0-9A-Fa-f]{12}")
PATCH = re.compile(r"patch(\d+)$", re.IGNORECASE)


def _build(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        with path.open("rb") as file:
            header = file.read(0x50)
        return header[0x40:0x50].hex().upper() if len(header) == 0x50 and header[:4] == b"NSO0" else None
    except OSError:
        return None


@dataclass
class GameDump:
    romfs: Path | None
    exefs: Path | None = None
    dlc: dict[str, Path] = field(default_factory=dict)
    updates: list[Path] = field(default_factory=list)

    @property
    def main_path(self) -> Path | None:
        return self.exefs / "main" if self.exefs else None

    @property
    def build(self) -> str | None:
        return _build(self.main_path)

    @property
    def version(self) -> str | None:
        return SUPPORTED_BUILDS.get(self.build)

    def _latest_patch(self) -> tuple[int, Path] | None:
        patches = [(int(m.group(1)), root) for root in self.updates for p in root.iterdir()
                   if p.is_dir() and (m := PATCH.fullmatch(p.name))]
        return max(patches, default=None, key=lambda item: item[0])

    def parts(self) -> list[dict]:
        latest = self._latest_patch()
        update_detail = ("1.2.0" if latest[0] == UPDATE_PATCH else f"patch{latest[0]}") if latest else None
        parts = [
            {"id": "base", "name": "Base game", "found": self.romfs is not None,
             "path": str(self.romfs) if self.romfs else None,
             "detail": None, "required": True},
            {"id": "update", "name": "Update", "found": bool(latest),
             "path": str(latest[1]) if latest else None, "detail": update_detail, "required": True},
            {"id": "exefs", "name": "ExeFS", "found": bool(self.exefs),
             "path": str(self.exefs) if self.exefs else None,
             "detail": self.version or self.build, "required": True},
        ]
        for title, name in DLC_TITLES.items():
            path = self.dlc.get(name)
            parts.append({"id": title, "name": name.replace("_", " ").title(), "found": bool(path),
                          "path": str(path) if path else None, "detail": None, "required": False})
        return parts

    @property
    def problems(self) -> list[str]:
        """Why this dump can't be imported. It must be 1.2.0: the base game, the update and the update's ExeFS. DLC is
        optional."""
        problems = [] if self.romfs else ["Base game not found"]
        latest = self._latest_patch()
        if not latest or latest[0] != UPDATE_PATCH:
            problems.append(f"Update 1.2.0 not found: the dump needs the update's patch{UPDATE_PATCH} folder.")
        if not self.exefs:
            problems.append("ExeFS not found: the dump needs the main file from update 1.2.0.")
        elif not self.version:
            problems.append(f"ExeFS is from another game version (build {self.build}): only 1.2.0 is supported.")
        return problems

    def describe(self) -> list[str]:
        return [f"{part['name']}: {part['path'] or 'not found'}" for part in self.parts()]


def _title(path: Path) -> str | None:
    found = [m.upper() for m in TITLE_ID.findall(str(path))]
    return found[-1] if found else None


def find(root: Path) -> GameDump:
    """Find components without depending on their parent folder names."""
    root = Path(root)
    if not root.is_dir():
        raise FileNotFoundError(f"{root} is not a folder")
    bases, updates, executables, dlc = [], [], [], {}
    for current, dirs, files in os.walk(root, followlinks=False):
        folder = Path(current)
        names = set(files)
        patch_dirs = [name for name in dirs if PATCH.fullmatch(name)]
        if patch_dirs:
            updates.append(folder)
            dirs[:] = [name for name in dirs if name not in patch_dirs]
        if "main" in names and (build := _build(folder / "main")):
            executables.append((folder, build))
        if {"DATA0.bin", "DATA1.bin"} <= names:
            index = folder / "DATA0.bin"
            digest = hashlib.sha256(index.read_bytes()).hexdigest().upper() if index.stat().st_size == 33920 else ""
            title = DLC_INDEX_HASHES.get(digest) or _title(folder.relative_to(root)) or _title(folder)
            if title in DLC_TITLES:
                dlc.setdefault(DLC_TITLES[title], folder)
            elif "nx" in dirs:
                bases.append(folder)
            dirs[:] = [name for name in dirs if name != "nx"]
    base = min(bases) if bases else None
    executables.sort(key=lambda item: (item[1] not in SUPPORTED_BUILDS, str(item[0])))
    return GameDump(base, executables[0][0] if executables else None, dlc, updates)
