"""tools/build.py: the shared steps in order, and each system's Target (Windows, macOS, Linux)."""

import argparse
import importlib.util
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

BUILD_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build.py"
SPEC = importlib.util.spec_from_file_location("build_script", BUILD_SCRIPT)
assert SPEC is not None and SPEC.loader is not None
build_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_script)


class Recording(build_script.Target):
    """A target whose steps only say they ran."""

    name, key = "Test", "test"

    def __init__(self, calls):
        self.calls = calls

    def require_tools(self):
        self.calls.append("require_tools")

    def before_program(self):
        self.calls.append("before_program")

    def finish_program(self, program, v):
        self.calls.append("finish_program")

    def sign(self, program):
        self.calls.append("sign")

    def desktop_check(self, program):
        self.calls.append("desktop_check")

    def package(self, program, v, args):
        self.calls.append(("package", program))
        return []


def _main(monkeypatch, argv, calls, target):
    monkeypatch.setattr(build_script.sys, "argv", ["build.py", "--current-env", *argv])
    monkeypatch.setattr(build_script, "target", lambda: target)
    monkeypatch.setattr(build_script, "web_ui", lambda: calls.append("web_ui"))
    monkeypatch.setattr(build_script, "tests", lambda: calls.append("tests"))
    monkeypatch.setattr(build_script, "pyinstaller", lambda t: calls.append("pyinstaller") or Path("program"))
    monkeypatch.setattr(build_script, "checksums", lambda _: calls.append("checksums"))
    build_script.main()


def test_every_target_goes_through_the_same_steps_in_order(monkeypatch):
    """The web UI is built before the tests that serve it; the program is signed and checked before packaging."""
    calls = []
    _main(monkeypatch, [], calls, Recording(calls))
    assert calls == ["require_tools", "web_ui", "tests", "before_program", "pyinstaller", "finish_program", "sign",
                     "desktop_check", ("package", Path("program")), "checksums"]
    calls.clear()
    _main(monkeypatch, ["--skip-tests"], calls, Recording(calls))
    assert "tests" not in calls


def test_the_target_is_chosen_from_the_system():
    assert type(build_script.target("win32")) is build_script.Windows
    assert type(build_script.target("darwin")) is build_script.MacOS
    assert type(build_script.target("linux")) is build_script.Linux
    with pytest.raises(SystemExit, match="not supported yet"):
        build_script.target("freebsd14")


def test_linux_needs_the_libraries_it_bundles(monkeypatch):
    linux = build_script.Linux()
    monkeypatch.setattr(build_script.shutil, "which", lambda name: None)
    with pytest.raises(SystemExit, match="binutils"):
        linux.require_tools()
    monkeypatch.setattr(build_script.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(build_script.ctypes.util, "find_library", lambda name: None if name == "xcb-cursor" else name)
    with pytest.raises(SystemExit, match="sudo apt install libxcb-cursor0$"):
        linux.require_tools()
    monkeypatch.setattr(build_script.ctypes.util, "find_library", lambda name: name)
    linux.require_tools()


def test_linux_archive_keeps_the_program_s_permissions(tmp_path, monkeypatch):
    import tarfile

    release, program = tmp_path / "release", tmp_path / "dist" / "Divine Pulse"
    program.mkdir(parents=True)
    release.mkdir()
    (release / "Divine-Pulse-1.2.3-linux-old.tar.gz").write_bytes(b"")
    monkeypatch.setattr(build_script, "RELEASE", release)
    monkeypatch.setattr(build_script.platform, "machine", lambda: "x86_64")
    linux = build_script.Linux()
    linux.executable(program).write_bytes(b"program")
    linux.executable(program).chmod(0o755)
    assert linux.package(program, "1.2.3", argparse.Namespace()) == [release / "Divine-Pulse-1.2.3-linux-x86_64.tar.gz"]
    assert linux.artifact_names("1.2.3", release) == ["Divine-Pulse-1.2.3-linux-x86_64.tar.gz"]
    assert linux.artifact_names("1.2.4", release) == ["Divine-Pulse-1.2.4-linux-x86_64.tar.gz"]
    with tarfile.open(release / "Divine-Pulse-1.2.3-linux-x86_64.tar.gz") as tar:
        member = tar.getmember("Divine Pulse/Divine Pulse")
    if sys.platform != "win32":
        assert member.mode & 0o111
    (release / "Divine-Pulse-1.2.3-linux-aarch64.tar.gz").write_bytes(b"")
    with pytest.raises(RuntimeError, match="more than one"):
        linux.artifact_names("1.2.3", release)


def test_build_environment_python_per_system(tmp_path):
    assert build_script.Windows().venv_python(tmp_path).relative_to(tmp_path).parts == ("Scripts", "python.exe")
    assert build_script.MacOS().venv_python(tmp_path).relative_to(tmp_path).parts == ("bin", "python")


def test_program_paths_per_system(tmp_path):
    windows, mac = build_script.Windows(), build_script.MacOS()
    assert windows.program_path().name == "Divine Pulse"
    assert windows.executable(tmp_path) == tmp_path / "Divine Pulse.exe"
    assert windows.notes_folder(tmp_path) == tmp_path
    assert mac.program_path().name == "Divine Pulse.app"
    assert mac.executable(tmp_path) == tmp_path / "Contents" / "MacOS" / "Divine Pulse"
    assert mac.notes_folder(tmp_path) == tmp_path / "Contents" / "Resources"


def test_each_system_has_a_readme_with_the_same_sections():
    """The read-mes cover installing, the first launch, importing, the data folder, updating and removing."""
    texts = {t.key: (build_script.PACKAGING / t.readme).read_text("utf-8") for t in (build_script.Windows(), build_script.MacOS(),
                                                                                    build_script.Linux())}
    for key, text in texts.items():
        assert text.count("{version}") == 1, key
        for heading in ("Install", "First launch", "Import your game", "Your data", "Updating", "Removing",
                        "Requirements"):
            assert f"\n{heading}\n" in text, (key, heading)


def test_python_candidates_on_windows_come_from_the_py_launcher(monkeypatch):
    listed = (" -V:3.14 *        C:\\Python314\\python.exe\r\n -V:3.12          C:\\Python312\\python.exe\r\n"
              " -V:3.13          C:\\Program Files\\Python313\\python.exe\r\n")
    monkeypatch.setattr(build_script.shutil, "which", lambda name: {
        "py": "C:\\Windows\\py.exe", "python": "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe",
    }.get(name))
    monkeypatch.setattr(build_script.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a[0], 0, listed, ""))
    assert build_script.Windows().python_candidates() == [
        "C:\\Python314\\python.exe", "C:\\Program Files\\Python313\\python.exe", "C:\\Python312\\python.exe"]


def test_newer_python_skips_what_is_too_old(monkeypatch):
    class Candidates(build_script.Target):
        def python_candidates(self):
            return ["old", "new"]

    monkeypatch.setattr(build_script, "python_version", {"old": (3, 11), "new": (3, 13)}.get)
    assert build_script.newer_python(Candidates()) == "new"


def test_dev_modules_names_development_packages_only():
    toc = """[('_pytest', 'x', 'PYMODULE'), ('_pytest.outcomes', 'x', 'PYMODULE'), ('anyio.pytest_plugin', 'x', 'PYMODULE'),
    ('pluggy', 'x', 'PYMODULE'), ('fastapi', 'x', 'PYMODULE'), ('packaging', 'x', 'PYMODULE')]"""
    assert build_script.dev_modules(toc) == ["_pytest", "_pytest.outcomes", "pluggy"]


def test_spec_excludes_pytest_and_its_internals():
    spec = (build_script.PACKAGING / "divine_pulse.spec").read_text(encoding="utf-8")
    assert '"pytest"' in spec and '"_pytest"' in spec


def test_pyinstaller_returns_the_targets_program_and_rejects_dev_packages(tmp_path, monkeypatch):
    toc = tmp_path / "work" / "divine_pulse" / "PYZ-00.toc"
    toc.parent.mkdir(parents=True)
    toc.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(build_script, "BUILD", tmp_path)
    monkeypatch.setattr(build_script, "run", lambda *_: None)
    for target in (build_script.Windows(), build_script.MacOS(), build_script.Linux()):
        target.program_path().mkdir(parents=True, exist_ok=True)
        assert build_script.pyinstaller(target) == target.program_path()
    toc.write_text("[('pytest', 'x', 'PYMODULE')]", encoding="utf-8")
    with pytest.raises(SystemExit, match="Development packages"):
        build_script.pyinstaller(build_script.Windows())


def _nstool(tmp_path, monkeypatch):
    executable = tmp_path / "vendor" / "nstool.exe"
    executable.parent.mkdir()
    executable.write_bytes(b"test executable")
    licenses = executable.parent / "licenses"
    licenses.mkdir()
    (licenses / "NSTool.txt").write_text("Full NSTool license text", encoding="utf-8")
    (licenses / "dependency.txt").write_text("Full dependency license text", encoding="utf-8")
    monkeypatch.setattr(build_script, "NSTOOL", executable)
    return executable


def test_windows_program_gets_its_notes_clr_config_and_nstool(tmp_path, monkeypatch):
    import xml.etree.ElementTree as ET

    _nstool(tmp_path, monkeypatch)
    made = tmp_path / "dist" / "Divine Pulse"
    made.mkdir(parents=True)
    noted = []
    monkeypatch.setattr(build_script, "notes", lambda folder, v, name: noted.append((folder, v, name)))

    build_script.Windows().finish_program(made, "1.2.3")

    assert noted == [(made, "1.2.3", "readme-windows.txt")]
    config = ET.parse(made / f"{build_script.APP_NAME}.exe.config")
    assert config.find("runtime/loadFromRemoteSources").get("enabled") == "true"
    assert (made / "tools" / "nstool.exe").read_bytes() == b"test executable"
    assert (made / "tools" / "nstool-licenses" / "NSTool.txt").read_text(encoding="utf-8") == "Full NSTool license text"


def test_windows_package_is_the_portable_zip_and_the_installer(tmp_path, monkeypatch):
    made = tmp_path / "dist" / "Divine Pulse"
    (made / "tools").mkdir(parents=True)
    (made / "tools" / "nstool.exe").write_bytes(b"test executable")
    monkeypatch.setattr(build_script, "RELEASE", tmp_path / "release")
    setup = tmp_path / "release" / "Divine-Pulse-1.2.3-setup.exe"
    monkeypatch.setattr(build_script, "installer", lambda v: setup)

    archive, installer = build_script.Windows().package(made, "1.2.3", argparse.Namespace(no_installer=False))
    assert installer == setup
    assert [archive.name, installer.name] == build_script.Windows().artifact_names("1.2.3")
    with zipfile.ZipFile(archive) as zip_file:
        assert zip_file.read("Divine Pulse/tools/nstool.exe") == b"test executable"
    monkeypatch.setattr(build_script, "installer", lambda v: pytest.fail("--no-installer"))
    assert build_script.Windows().package(made, "1.2.3", argparse.Namespace(no_installer=True)) == [archive]


def test_windows_stops_before_building_if_nstool_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(build_script, "NSTOOL", tmp_path / "missing.exe")
    with pytest.raises(FileNotFoundError, match="Bundled NSTool is missing"):
        build_script.Windows().require_tools()


def test_windows_stops_before_building_if_nstool_licenses_are_missing(tmp_path, monkeypatch):
    executable = tmp_path / "nstool.exe"
    executable.write_bytes(b"test executable")
    monkeypatch.setattr(build_script, "NSTOOL", executable)
    with pytest.raises(FileNotFoundError, match="Bundled NSTool licenses are missing"):
        build_script.Windows().require_tools()


def test_desktop_check_opens_a_downloaded_looking_copy_and_propagates_failure(tmp_path, monkeypatch):
    """The shared step: copy, make it look downloaded (the target's part), run --check-desktop, clean up."""
    made = tmp_path / "program"
    made.mkdir()
    (made / "file.txt").write_text("payload", encoding="utf-8")
    marked, checked = [], []

    class Target(build_script.Target):
        def executable(self, program):
            return program / "run"

        def downloaded_copy(self, copy):
            marked.append(copy)
            (copy / "marker").write_text("downloaded", encoding="utf-8")

    def run(command, **kwargs):
        copy = Path(command[0]).parent
        assert command[1:] == ["--check-desktop"]
        assert kwargs == {"check": True, "timeout": 60}
        assert (copy / "file.txt").read_text(encoding="utf-8") == "payload"
        assert (copy / "marker").is_file()
        checked.append(copy)
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(build_script.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        Target().desktop_check(made)
    assert marked == checked and checked[0] != made
    assert not (made / "marker").exists()
    assert not checked[0].exists()


@pytest.mark.skipif(build_script.sys.platform != "win32", reason="Windows alternate data streams")
def test_windows_downloaded_copy_marks_the_dlls_as_internet_files(tmp_path):
    runtime = tmp_path / "_internal" / "pythonnet" / "runtime" / "Python.Runtime.dll"
    runtime.parent.mkdir(parents=True)
    runtime.write_bytes(b"synthetic DLL")
    build_script.Windows().downloaded_copy(tmp_path)
    assert "ZoneId=3" in Path(f"{runtime}:Zone.Identifier").read_text()


@pytest.mark.skipif(build_script.sys.platform == "win32", reason="POSIX permissions")
def test_macos_downloaded_copy_is_read_only_and_can_be_removed(tmp_path):
    app = tmp_path / "Divine Pulse.app"
    (app / "Contents" / "MacOS").mkdir(parents=True)
    with pytest.raises(PermissionError):
        build_script.MacOS().downloaded_copy(app)
        (app / "Contents" / "MacOS" / "written").write_text("x")
    build_script.MacOS().after_desktop_check(app)
    (app / "Contents" / "MacOS" / "written").write_text("x")


def test_macos_program_gets_its_notes_in_resources_and_the_memory_reader(tmp_path, monkeypatch):
    app = tmp_path / "Divine Pulse.app"
    noted, built = [], []
    monkeypatch.setattr(build_script, "notes", lambda folder, v, name: noted.append((folder, name)))
    monkeypatch.setattr(build_script, "helper_name", lambda: "dp-memreader")
    monkeypatch.setattr(build_script, "build_helper", built.append)
    build_script.MacOS().finish_program(app, "1.2.3")
    assert noted == [(app / "Contents" / "Resources", "readme-macos.txt")]
    assert built == [app / "Contents" / "MacOS" / "dp-memreader"]


def test_macos_signs_the_helper_with_its_entitlement_then_the_app(tmp_path, monkeypatch):
    app = tmp_path / "Divine Pulse.app"
    commands = []
    monkeypatch.setattr(build_script, "helper_name", lambda: "dp-memreader")
    monkeypatch.setattr(build_script, "run", lambda *command, cwd=None: commands.append([str(c) for c in command]))
    shown = {"out": "[Key] com.apple.security.cs.debugger"}
    monkeypatch.setattr(build_script.subprocess, "run",
                        lambda command, **k: subprocess.CompletedProcess(command, 0, shown["out"], ""))
    build_script.MacOS().sign(app)
    helper = str(app / "Contents" / "MacOS" / "dp-memreader")
    assert commands[0][-3:] == ["--entitlements", str(build_script.MAC_HELPER / "entitlements.plist"), helper]
    assert commands[1][-1] == str(app) and "--entitlements" not in commands[1]
    assert commands[2] == ["codesign", "--verify", "--strict", str(app)]
    shown["out"] = ""
    with pytest.raises(SystemExit, match="lost its debugger entitlement"):
        build_script.MacOS().sign(app)


def test_mac_package_replaces_this_versions_zips_only(tmp_path, monkeypatch):
    """One macOS zip per version in release/, so release.py can't take a stale one for another architecture."""
    release = tmp_path / "release"
    release.mkdir()
    for name in ("Divine-Pulse-1.2.3-macos-x86_64.zip", "Divine-Pulse-1.2.3-macos-arm64.zip",
                 "Divine-Pulse-1.2.2-macos-arm64.zip"):
        (release / name).write_bytes(b"old")
    monkeypatch.setattr(build_script, "RELEASE", release)
    monkeypatch.setattr(build_script.platform, "machine", lambda: "arm64")
    commands = []

    def fake_run(*command, cwd=None):
        commands.append([str(part) for part in command])
        if command[:2] == ("ditto", "-c"):
            Path(command[-1]).write_bytes(b"new")

    monkeypatch.setattr(build_script, "run", fake_run)
    app = tmp_path / "dist" / "Divine Pulse.app"
    mac = build_script.MacOS()
    assert mac.package(app, "1.2.3", argparse.Namespace()) == [release / "Divine-Pulse-1.2.3-macos-arm64.zip"]
    assert sorted(path.name for path in release.glob("*.zip")) == [
        "Divine-Pulse-1.2.2-macos-arm64.zip", "Divine-Pulse-1.2.3-macos-arm64.zip"]
    assert (release / "Divine-Pulse-1.2.3-macos-arm64.zip").read_bytes() == b"new"
    assert commands[-1][:5] == ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent"]
    assert mac.artifact_names("1.2.3", release) == ["Divine-Pulse-1.2.3-macos-arm64.zip"]


def test_spec_bundles_an_app_on_macos():
    spec = (build_script.PACKAGING / "divine_pulse.spec").read_text(encoding="utf-8")
    assert "BUNDLE(" in spec and 'f"{NAME}.app"' in spec


def _headings(path, pattern):
    return re.findall(pattern, path.read_text("utf-8"), re.M)


def test_setup_scripts_take_the_same_steps_in_the_same_order():
    tools = build_script.ROOT / "tools"
    windows = _headings(tools / "setup.ps1", r'^Write-Host "(== [^"]+)"')
    macos = _headings(tools / "setup.sh", r'^echo "(== [^"]+)"')
    assert windows == macos == ["== Python environment", "== Memory reader", "== Frontend build",
                                "== Desktop shortcut"]
    for name, needs in (("setup.ps1", "Python 3.12 or newer is needed"), ("setup.sh", "Python 3.12 or newer is needed")):
        text = (tools / name).read_text("utf-8")
        assert needs in text and "Node.js 22.12 or newer is needed" in text
        assert "Closing the Divine Pulse window stops the app." in text
        assert "Done. Start Divine Pulse with 'Divine Pulse (source)' on your desktop, or tools" in text


def test_launch_scripts_check_the_setup_and_the_frontend_build():
    tools = build_script.ROOT / "tools"
    for name, setup in (("launch.bat", "tools\\setup.bat"), ("launch.sh", "tools/setup.sh")):
        text = (tools / name).read_text("utf-8")
        assert f"Divine Pulse isn't set up yet: run {setup} first." in text, name
        assert f"The frontend isn't built: run {setup} again." in text, name
        assert "frontend" in text and "dist" in text and "index.html" in text, name
        assert "-m app" in text, name


def test_build_windows_ps1_is_gone_in_favor_of_build_py():
    """build.py finds a Python 3.12+ itself (the py launcher on Windows), so there's one build command for both."""
    assert not (build_script.ROOT / "tools" / "build_windows.ps1").exists()
