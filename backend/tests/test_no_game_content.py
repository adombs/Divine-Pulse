"""The repository and the release carry no game content: players import their own dump."""

from __future__ import annotations

import importlib.util
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("game_content", ROOT / "tools" / "game_content.py")
assert SPEC is not None and SPEC.loader is not None
game_content = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(game_content)

SKIP_DIRS = {".git", "node_modules", ".venv", "game-assets", "build", "release", "dist", "__pycache__"}


def tracked_files() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout
        return [p for p in out.split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        return [
            p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*")
            if p.is_file() and not SKIP_DIRS & set(p.relative_to(ROOT).parts) and p.relative_to(ROOT).parts[0] != "data"
        ]


def test_tracked_files_hold_no_game_content() -> None:
    files = []
    for path in tracked_files():
        try:
            files.append((path, (ROOT / path).stat().st_size))
        except OSError:
            continue  # listed by git, deleted in the working tree
    assert game_content.check_files(files) == []


def test_pyinstaller_spec_bundles_only_the_web_ui_and_app_data() -> None:
    text = (ROOT / "packaging" / "divine_pulse.spec").read_text(encoding="utf-8")
    assert game_content.check_spec(text) == []


@pytest.mark.parametrize("path", [
    "frontend/src/portrait.png",
    "backend/app/data/face.JPG",
    "docs/shot.webp",
    "frontend/public/icons/sword.png",
    "frontend/dist/assets/face.png",
    "tools/frame.dds",
    "a/b.tga",
    "a/b.bmp",
    "a/b.gif",
    "a/b.jpeg",
    "backend/tests/fixtures/DATA0.bin",
    "x/texture.g1t",
    "x/model.g1m",
    "x/main.nso",
    "x/module.nro",
    "x/title.nca",
    "x/game.nsp",
    "x/game.xci",
    "x/prod.keys",
    "x/memory.dmp",
    "x/battle.fe3hrec",
    "x/battle.dprec",
    "x/blob.bin",
    "x/DATA0",
    "x/DATA1",
    "x/msgdata_eng.csv",
    "x/fixed_persondata.csv",
    "frontend/public/data.json",
    "frontend/public/portraits/a.svg",
])
def test_checker_rejects(path: str) -> None:
    assert game_content.check_path(path), path


@pytest.mark.parametrize("path", [
    "frontend/public/brand/mark.png",
    "frontend/public/favicon.png",
    "backend/app/data/icon.png",
    "backend/app/data/icon.ico",
    "frontend/dist/brand/mark.png",
    "frontend/src/App.tsx",
    "backend/app/gamefiles/archive.py",
    "docs/README.md",
    "backend/app/data/small.json",
    "backend/app/gamefiles/msgdata.py",
])
def test_checker_accepts(path: str) -> None:
    assert game_content.check_path(path) is None, path


def test_checker_limits_json_size() -> None:
    limit = game_content.JSON_LIMIT
    assert game_content.check_path("frontend/src/data.json", limit) is None
    assert game_content.check_path("frontend/src/data.json", limit + 1)
    assert game_content.check_path("backend/app/data/big.json", limit + 1)
    assert game_content.check_path("frontend/src/reference/wiki/fe-wiki.json", limit * 100) is None
    assert game_content.check_path("docs/example.json", limit + 1) is None


def test_checker_reports_every_offender() -> None:
    found = game_content.check_files([("ok.txt", 1), ("a.png", 1), ("b/c.g1t", 1)])
    assert len(found) == 2 and "a.png" in found[0] and "b/c.g1t" in found[1]


def test_spec_checker_flags_extra_data() -> None:
    spec = 'datas = [\n    (str(DIST_UI), "frontend_dist"),\n    (str(DATA), "app/data"),\n    (str(GAME), "game"),\n]\n'
    assert game_content.check_spec(spec) == ["divine_pulse.spec: datas bundles 'game'"]
    assert game_content.check_spec("datas = []\n") == game_content.check_spec("nothing here")


def make_zip(path: Path, names: list[str]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name in names:
            archive.writestr(name, b"x")
    return path


LICENSES = [f"Divine Pulse/{name}" for name in game_content.LICENSE_FILES]
LICENSE_TEXT = f"Divine Pulse/{game_content.LICENSE_FOLDER}python.txt"


def test_zip_check_passes_a_clean_release(tmp_path: Path) -> None:
    names = [
        *LICENSES, LICENSE_TEXT, "Divine Pulse/Divine Pulse.exe", "Divine Pulse/_internal/frontend_dist/index.html",
        "Divine Pulse/_internal/frontend_dist/brand/mark.png", "Divine Pulse/_internal/app/data/icon.png",
        "Divine Pulse/_internal/PIL/data/sample.png", "Divine Pulse/_internal/numpy/fixed_point.bin",
    ]
    assert game_content.check_zip(make_zip(tmp_path / "ok.zip", names)) == []


def test_zip_check_names_game_content_and_missing_licenses(tmp_path: Path) -> None:
    names = [
        *LICENSES[:2], "Divine Pulse/_internal/frontend_dist/assets/face.png", "Divine Pulse/_internal/app/data/x.g1t",
        "Divine Pulse/_internal/PIL/data/sample.png",
    ]
    found = game_content.check_zip(make_zip(tmp_path / "bad.zip", names))
    assert len(found) == 4
    assert any("frontend/dist/assets/face.png" in line for line in found)
    assert any("backend/app/data/x.g1t" in line for line in found)
    assert any("missing GFDL-1.3.txt" in line for line in found)
    assert any(f"missing {game_content.LICENSE_FOLDER}" in line for line in found)
