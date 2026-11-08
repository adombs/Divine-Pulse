"""Check an output folder: every file in the manifest is there, undamaged and readable.

The dump itself is checked before and during extraction (dump.py: a 1.2.0 dump; the extractors fail on an
archive that can't be read). Nothing here compares the output with a stored copy, so a change to what the app
extracts never fails an import.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path

from PIL import Image

from .extract import FAMILIES
from .msgdata import LANGUAGES
from .output import MANIFEST, pixel_hash

REQUIRED_FILES = {
    f"data/{name}.json" for name in (
        "abilities", "battalions", "characters", "class-sprites", "classes", "combat-arts", "crests-by-person",
        "equipment", "exe/item-icons", "factions", "gifts", "icons", "items", "maps", "meals", "minimap-terrain",
        "portraits", "ranks", "spells", "supports", "terrain", "weapons",
    )
} | {f"text/{code}.json" for code in LANGUAGES} | {"images/map/class-sprites.png", "images/map/map-heads.png"}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checked: int = 0

    @property
    def ok(self) -> bool:
        return not self.errors

    def lines(self) -> list[str]:
        head = f"{self.checked} files checked: {len(self.errors)} errors, {len(self.warnings)} warnings"
        return [head, *(f"ERROR {e}" for e in self.errors), *(f"warning {w}" for w in self.warnings)]


def _check_file(root: Path, rel: str, record: dict, report: Report) -> None:
    path = root / rel
    if "\\" in rel or ":" in rel or any(part in {"", ".", ".."} for part in rel.split("/")) or not path.resolve().is_relative_to(root):
        report.errors.append(f"{rel}: invalid manifest path")
        return
    if not path.is_file():
        report.errors.append(f"{rel}: missing")
        return
    data = path.read_bytes()
    if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
        report.errors.append(f"{rel}: damaged (size or sha256 differs from the manifest)")
        return
    if record["kind"] == "image":
        try:
            with Image.open(path) as image:
                image.load()
                if image.size != (record["width"], record["height"]):
                    report.errors.append(f"{rel}: size {image.size} != manifest")
                if pixel_hash(image) != record["pixels"]:
                    report.errors.append(f"{rel}: pixels differ from the manifest")
                alpha = image.convert("RGBA").getchannel("A").getextrema()
                if alpha == (0, 0):
                    report.warnings.append(f"{rel}: fully transparent")
        except OSError as error:
            report.errors.append(f"{rel}: unreadable image ({error})")
    elif record["kind"] == "json":
        try:
            json.loads(data)
        except ValueError as error:
            report.errors.append(f"{rel}: invalid JSON ({error})")


def check(root: Path, *, require_complete: bool = False) -> Report:
    root = Path(root).resolve()
    report = Report()
    try:
        manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        report.errors.append(f"{MANIFEST}: {error}")
        return report
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), dict):
        report.errors.append(f"{MANIFEST}: missing or invalid file list")
        return report
    files = manifest["files"]
    for rel, record in files.items():
        try:
            _check_file(root, rel, record, report)
        except (OSError, KeyError, TypeError, ValueError) as error:
            report.errors.append(f"{rel}: unreadable file or invalid manifest entry ({error})")
        report.checked += 1
    listed = set(files) | {MANIFEST}
    for path in root.rglob("*"):
        if path.is_file() and path.relative_to(root).as_posix() not in listed:
            report.warnings.append(f"{path.relative_to(root).as_posix()}: not in the manifest")
    families = manifest.get("families", {})
    if not isinstance(families, dict) or any(not isinstance(info, dict) for info in families.values()):
        report.errors.append(f"{MANIFEST}: invalid extractor summaries")
        return report
    if require_complete:
        for name in sorted(REQUIRED_FILES - files.keys()):
            report.errors.append(f"{name}: required file was not extracted")
        for name in FAMILIES:
            if not families.get(name, {}).get("files"):
                report.errors.append(f"{name}: required extractor produced no files")
    dump = manifest.get("dump", {})
    if not isinstance(dump, dict) or not isinstance(dump.get("dlc", []), list):
        report.errors.append(f"{MANIFEST}: invalid game information")
        return report
    has_dlc = "cindered_shadows" in dump.get("dlc", [])
    has_battle_maps = "auxiliary_battle_maps" in dump.get("dlc", [])
    for family, info in families.items():
        skips = info.get("skipped", [])
        if not isinstance(skips, list) or any(not isinstance(item, str) for item in skips):
            report.errors.append(f"{family}: invalid list of skipped assets")
            continue
        for skipped in skips:
            optional = (not has_dlc and skipped.startswith((
                "Cindered Shadows DLC not found", "Cindered Shadows faces", "houses/ashen-wolves:",
                "ability icons for the Cindered Shadows abilities:",
            ))) or (not has_battle_maps and skipped.startswith("Auxiliary Battle Maps DLC not found"))
            messages = report.errors if require_complete and not optional else report.warnings
            messages.append(f"{family}: skipped {skipped}")
    return report

