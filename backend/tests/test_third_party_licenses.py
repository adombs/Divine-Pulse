"""The notices and license texts must keep up with what requirements.txt actually pulls in."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT =Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("build_script", ROOT / "tools" / "build.py")
assert SPEC and SPEC.loader
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


def test_runtime_distributions_follow_dependencies_and_extras() -> None:
    found = build.runtime_distributions()
    assert "pydantic-core" in found  # a dependency of a requirement
    assert "websockets" in found  # only through uvicorn[standard]
    assert "pytest" not in found


def test_every_runtime_package_is_named_in_the_notices() -> None:
    notices = re.sub(r"[-_ ]+", "-", (ROOT / "docs" / "third-party-notices.md").read_text("utf-8").lower())
    assert [name for name in build.runtime_distributions() if name not in notices] == []


def test_every_runtime_package_has_license_text() -> None:
    vendored = {path.stem for path in build.VENDORED_LICENSES.iterdir()}
    packages = build.runtime_distributions().items()
    assert [name for name, dist in packages if not build.license_files(dist) and name not in vendored] == []


def test_license_files_keep_their_paths_inside_the_package_information() -> None:
    inside = [path for _, path in build.license_files(build.metadata.distribution("httptools"))]
    assert len(inside) == len(set(inside))


def test_frontend_packages_are_named_in_the_notices() -> None:
    notices = (ROOT / "docs" / "third-party-notices.md").read_text("utf-8").lower()
    manifest = json.loads((ROOT / "frontend" / "package.json").read_text("utf-8"))
    fonts = [name for name in manifest["dependencies"] if name.startswith("@fontsource/")]
    assert [name for name in fonts if name.split("/")[1].replace("-", " ") not in notices] == []
    assert "react dom" in notices
    assert "phosphor icons" in notices


def test_what_gets_copied_for_a_build(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    if not (ROOT / "frontend" / "node_modules" / "react").is_dir():
        pytest.skip("frontend dependencies aren't installed")
    monkeypatch.setattr(build, "BUILD_PACKAGES", ())  # installed only in the build environment
    build.third_party_licenses(tmp_path)
    target = tmp_path / build.LICENSE_FOLDER
    assert (target / "python.txt").is_file()
    assert (target / "frontend" / "react" / "LICENSE").is_file()
    assert any((target / "pillow").rglob("LICENSE*"))
