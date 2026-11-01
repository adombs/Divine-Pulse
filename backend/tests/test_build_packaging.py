"""Verify the Windows release payload contains its bundled extraction tool."""

import importlib.util
import zipfile
from pathlib import Path

import pytest

BUILD_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build.py"
SPEC = importlib.util.spec_from_file_location("build_script", BUILD_SCRIPT)
assert SPEC is not None and SPEC.loader is not None
build_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_script)


def test_web_ui_is_built_before_the_tests_that_serve_it(monkeypatch):
    calls = []
    monkeypatch.setattr(build_script.sys, "argv", ["build.py", "--current-env", "--no-installer"])
    monkeypatch.setattr(build_script, "web_ui", lambda: calls.append("web_ui"))
    monkeypatch.setattr(build_script, "tests", lambda: calls.append("tests"))
    monkeypatch.setattr(build_script, "program", lambda: calls.append("program"))
    monkeypatch.setattr(build_script, "package", lambda *_: [])
    monkeypatch.setattr(build_script, "checksums", lambda _: None)

    build_script.main()

    assert calls == ["web_ui", "tests", "program"]


def test_dev_modules_names_development_packages_only():
    toc = """[('_pytest', 'x', 'PYMODULE'), ('_pytest.outcomes', 'x', 'PYMODULE'), ('anyio.pytest_plugin', 'x', 'PYMODULE'),
    ('pluggy', 'x', 'PYMODULE'), ('fastapi', 'x', 'PYMODULE'), ('packaging', 'x', 'PYMODULE')]"""
    assert build_script.dev_modules(toc) == ["_pytest", "_pytest.outcomes", "pluggy"]


def test_spec_excludes_pytest_and_its_internals():
    spec = (build_script.PACKAGING / "divine_pulse.spec").read_text(encoding="utf-8")
    assert '"pytest"' in spec and '"_pytest"' in spec


def test_package_copies_nstool_into_program_and_portable_zip(tmp_path, monkeypatch):
    executable = tmp_path / "vendor" / "nstool.exe"
    executable.parent.mkdir()
    executable.write_bytes(b"test executable")
    licenses = executable.parent / "licenses"
    licenses.mkdir()
    (licenses / "NSTool.txt").write_text("Full NSTool license text", encoding="utf-8")
    (licenses / "dependency.txt").write_text("Full dependency license text", encoding="utf-8")
    made = tmp_path / "dist" / "Divine Pulse"
    made.mkdir(parents=True)
    monkeypatch.setattr(build_script, "NSTOOL", executable)
    monkeypatch.setattr(build_script, "RELEASE", tmp_path / "release")
    monkeypatch.setattr(build_script, "notes", lambda *_: None)

    [archive] = build_script.package(made, "1.2.3")

    assert (made / "tools" / "nstool.exe").read_bytes() == b"test executable"
    assert (made / "tools" / "nstool-licenses" / "NSTool.txt").read_text(encoding="utf-8") == "Full NSTool license text"
    with zipfile.ZipFile(archive) as zip_file:
        assert zip_file.read("Divine Pulse/tools/nstool.exe") == b"test executable"
        assert zip_file.read("Divine Pulse/tools/nstool-licenses/NSTool.txt") == b"Full NSTool license text"
        assert zip_file.read("Divine Pulse/tools/nstool-licenses/dependency.txt") == b"Full dependency license text"


def test_package_fails_if_nstool_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(build_script, "NSTOOL", tmp_path / "missing.exe")
    monkeypatch.setattr(build_script, "RELEASE", tmp_path / "release")
    with pytest.raises(FileNotFoundError, match="Bundled NSTool is missing"):
        build_script.package(tmp_path / "program", "1.2.3")
    assert not (tmp_path / "release").exists()


def test_package_fails_if_nstool_licenses_are_missing(tmp_path, monkeypatch):
    executable = tmp_path / "nstool.exe"
    executable.write_bytes(b"test executable")
    monkeypatch.setattr(build_script, "NSTOOL", executable)
    monkeypatch.setattr(build_script, "RELEASE", tmp_path / "release")
    with pytest.raises(FileNotFoundError, match="Bundled NSTool licenses are missing"):
        build_script.package(tmp_path / "program", "1.2.3")
    assert not (tmp_path / "release").exists()
