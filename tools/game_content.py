"""What the repository and the release must never hold: game images, game file formats, bulk game data.

One rule set for backend/tests/test_no_game_content.py (the files in git) and tools/release.py (the release zip).
"""

from __future__ import annotations

import re
import zipfile
from collections.abc import Iterable
from pathlib import Path, PurePosixPath

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tga", ".dds"}
GAME_EXTS = {".bin", ".g1t", ".g1m", ".nso", ".nro", ".nca", ".nsp", ".xci", ".keys", ".dmp", ".fe3hrec", ".dprec"}
GAME_NAMES = {"data0", "data1"}  # file stems
GAME_PREFIXES = ("msgdata", "fixed_")
CODE_EXTS = {".py", ".ts", ".tsx", ".mjs", ".md"}  # a module may be named after the thing it parses
# Where images may live (the program's own brand files).
IMAGE_OK = (
    "branding/", "frontend/public/brand/", "frontend/public/favicon.png", "backend/app/data/icon.",
    "frontend/dist/brand/", "frontend/dist/favicon.png",
)
JSON_ROOTS = ("frontend/src/", "backend/app/")
JSON_LIMIT = 64 * 1024
JSON_OK = {"fe-wiki.json"}
PUBLIC_OK = ("brand/", "favicon.png")
SPEC_DATAS = {"frontend_dist", "app/data"}
LICENSE_FILES = ("LICENSE.txt", "Third-party notices.txt", "GFDL-1.3.txt")


def check_path(path: str, size: int = 0) -> str | None:
    """Why a file at this repository-relative path (forward slashes) may not ship, or None."""
    name = PurePosixPath(path).name
    stem, ext = PurePosixPath(name).stem.lower(), PurePosixPath(name).suffix.lower()
    if ext in IMAGE_EXTS and not path.startswith(IMAGE_OK):
        return "image outside the brand files"
    if ext in GAME_EXTS:
        return f"game file format {ext}"
    if ext not in CODE_EXTS and (stem in GAME_NAMES or name.lower().startswith(GAME_PREFIXES)):
        return "game data file name"
    if ext == ".json" and path.startswith(JSON_ROOTS) and size > JSON_LIMIT and name not in JSON_OK:
        return f"JSON over {JSON_LIMIT // 1024} KB"
    if path.startswith("frontend/public/") and not path.removeprefix("frontend/public/").startswith(PUBLIC_OK):
        return "frontend/public holds only brand/ and favicon.png"
    return None


def check_files(files: Iterable[tuple[str, int]]) -> list[str]:
    """One message per offending (path, size)."""
    return [f"{path}: {why}" for path, size in files if (why := check_path(path, size))]


def check_spec(text: str) -> list[str]:
    """What the PyInstaller spec's datas list bundles, beyond the web UI and the app's own data."""
    found = re.search(r"^datas = \[(.*?)^\]", text, re.M | re.S)
    if not found:
        return ["divine_pulse.spec: no datas list found"]
    extra = set(re.findall(r',\s*"([^"]+)"\)', found.group(1))) - SPEC_DATAS
    return [f"divine_pulse.spec: datas bundles {name!r}" for name in sorted(extra)]


def bundled_path(name: str) -> str | None:
    """A release zip entry as the repository path it came from, or None for the bundled third-party packages."""
    parts = name.split("/")[1:]  # drop the program folder
    if not parts or parts[0] != "_internal":
        return "/".join(parts)
    if parts[1:2] == ["frontend_dist"]:
        return "/".join(["frontend/dist", *parts[2:]])
    if parts[1:2] == ["app"]:
        return "/".join(["backend/app", *parts[2:]])
    return None


def check_zip(path: Path) -> list[str]:
    """Game content in the program's own files in a release zip, and any missing license file."""
    with zipfile.ZipFile(path) as archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
    found = [(p, i.file_size) for i in infos if (p := bundled_path(i.filename))]
    top = {i.filename.split("/", 1)[1] for i in infos if "/" in i.filename}
    missing = [f"{path.name}: missing {name}" for name in LICENSE_FILES if name not in top]
    return check_files(found) + missing
