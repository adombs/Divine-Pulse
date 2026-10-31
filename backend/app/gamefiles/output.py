"""The output folder: every file an extractor writes is recorded in manifest.json with its hashes.

An image records two hashes: `sha256` of the PNG file (catches a damaged file) and `pixels`, the sha256 of its size
and RGBA pixels, which stays the same across Pillow versions.
"""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path

from PIL import Image

MANIFEST = "manifest.json"
# Raised when an extractor's output changes in a way the app relies on (2: equipment effects and descriptions), so an
# older import is reported as needing a new one.
FORMAT = 2


def pixel_hash(image: Image.Image) -> str:
    rgba = image.convert("RGBA")
    return hashlib.sha256(f"{rgba.width}x{rgba.height}:".encode() + rgba.tobytes()).hexdigest()


def json_bytes(data) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")


class Output:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.files: dict[str, dict] = {}

    def _path(self, rel: str) -> Path:
        if rel in self.files:
            raise ValueError(f"{rel} written twice")
        if rel == MANIFEST or rel.startswith(("/", "..")) or "\\" in rel:
            raise ValueError(f"bad output path {rel!r}")
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def image(self, rel: str, image: Image.Image, *, source: str) -> None:
        """Save a PNG. source says where in the dump it came from (e.g. "DATA 6123 item 12")."""
        path = self._path(rel)
        image = image.convert("RGBA")
        image.save(path, "PNG")
        data = path.read_bytes()
        self.files[rel] = {
            "kind": "image",
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "pixels": pixel_hash(image),
            "width": image.width,
            "height": image.height,
            "source": source,
        }

    def json(self, rel: str, data, *, source: str) -> None:
        path = self._path(rel)
        raw = json_bytes(data)
        path.write_bytes(raw)
        self.files[rel] = {"kind": "json", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "source": source}

    def write_manifest(self, *, dump: dict, families: dict[str, dict]) -> Path:
        manifest = {
            "format": FORMAT,
            "created": datetime.now(UTC).isoformat(timespec="seconds"),
            "dump": dump,
            "families": families,
            "files": dict(sorted(self.files.items())),
        }
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / MANIFEST
        path.write_bytes(json_bytes(manifest))
        return path
