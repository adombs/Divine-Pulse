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

from .output import MANIFEST, pixel_hash


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


def check(root: Path) -> Report:
    root = Path(root)
    report = Report()
    try:
        manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        report.errors.append(f"{MANIFEST}: {error}")
        return report
    files = manifest["files"]
    for rel, record in files.items():
        _check_file(root, rel, record, report)
        report.checked += 1
    listed = set(files) | {MANIFEST}
    for path in root.rglob("*"):
        if path.is_file() and path.relative_to(root).as_posix() not in listed:
            report.warnings.append(f"{path.relative_to(root).as_posix()}: not in the manifest")
    for family, info in manifest.get("families", {}).items():
        for skipped in info.get("skipped", []):
            report.warnings.append(f"{family}: skipped {skipped}")
    return report

