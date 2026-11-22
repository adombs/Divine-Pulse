"""Tests for validating local release artifacts before upload."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
from pathlib import Path

import pytest

RELEASE_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "release.py"
SPEC = importlib.util.spec_from_file_location("release_script", RELEASE_SCRIPT)
assert SPEC is not None and SPEC.loader is not None
release_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_script)


@pytest.fixture(autouse=True)
def windows_release(monkeypatch: pytest.MonkeyPatch) -> None:
    """These tests use the Windows file names, whichever computer runs them."""
    monkeypatch.setattr(release_script, "target", release_script.build.Windows)


def _release_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    release_dir = tmp_path / "release"
    release_dir.mkdir()
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    artifacts = {
        "Divine-Pulse-1.2.3-windows-portable.zip": release_dir / "Divine-Pulse-1.2.3-windows-portable.zip",
        "Divine-Pulse-1.2.3-setup.exe": release_dir / "Divine-Pulse-1.2.3-setup.exe",
    }
    for name, path in artifacts.items():
        path.write_bytes(f"contents for {name}".encode())
    return artifacts


def _write_manifest(artifacts: dict[str, Path], manifest: Path) -> None:
    lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}" for name, path in artifacts.items()]
    manifest.write_text("\n".join(lines) + "\n", encoding="ascii")


def test_release_files_accepts_exact_entries_with_matching_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    _write_manifest(artifacts, tmp_path / "release" / "SHA256SUMS.txt")

    result = release_script.release_files("1.2.3")

    assert result == [*artifacts.values(), tmp_path / "release" / "SHA256SUMS.txt"]


@pytest.mark.parametrize("missing", ["Divine-Pulse-1.2.3-windows-portable.zip", "Divine-Pulse-1.2.3-setup.exe", "SHA256SUMS.txt"])
def test_release_files_rejects_missing_required_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, missing: str,
) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    if missing == "SHA256SUMS.txt":
        manifest.unlink()
    else:
        artifacts[missing].unlink()

    with pytest.raises(RuntimeError, match="local build did not create"):
        release_script.release_files("1.2.3")


def test_release_files_rejects_missing_checksum_entry_when_artifacts_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    manifest.write_text(manifest.read_text(encoding="ascii").splitlines()[0] + "\n", encoding="ascii")

    with pytest.raises(RuntimeError, match="is missing from release/SHA256SUMS.txt"):
        release_script.release_files("1.2.3")


def test_release_files_tolerates_valid_unrelated_old_version_entry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    old_name = "Divine-Pulse-1.2.2-windows-portable.zip"
    old_digest = hashlib.sha256(b"old artifact").hexdigest()
    with manifest.open("a", encoding="ascii") as checksum_file:
        checksum_file.write(f"{old_digest}  {old_name}\n")

    assert release_script.release_files("1.2.3") == [
        *artifacts.values(),
        manifest,
    ]


def test_release_files_reports_non_ascii_manifest_as_runtime_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _release_fixture(tmp_path, monkeypatch)
    (tmp_path / "release" / "SHA256SUMS.txt").write_bytes(b"invalid: \xff\n")

    with pytest.raises(RuntimeError, match="must contain ASCII checksum entries"):
        release_script.release_files("1.2.3")


def test_release_files_rejects_artifact_bytes_changed_after_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    next(iter(artifacts.values())).write_bytes(b"stale artifact contents")

    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        release_script.release_files("1.2.3")


@pytest.mark.parametrize(
    "entry",
    [
        "not-a-checksum Divine-Pulse-1.2.3-windows-portable.zip",
        f"{'0' * 64} prefix-Divine-Pulse-1.2.3-windows-portable.zip-suffix",
        f"{'0' * 64}  Divine-Pulse-1.2.3-windows-portable.zip.backup",
    ],
)
def test_release_files_rejects_malformed_or_substring_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entry: str,
) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    lines = manifest.read_text(encoding="ascii").splitlines()
    lines[0] = entry
    manifest.write_text("\n".join(lines) + "\n", encoding="ascii")

    with pytest.raises(RuntimeError, match="invalid checksum entry"):
        release_script.release_files("1.2.3")


def test_release_files_rejects_duplicate_exact_entries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    manifest = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest(artifacts, manifest)
    lines = manifest.read_text(encoding="ascii").splitlines()
    manifest.write_text("\n".join([lines[0], *lines]) + "\n", encoding="ascii")

    with pytest.raises(RuntimeError, match="duplicate checksum entry"):
        release_script.release_files("1.2.3")


def test_an_annotated_tag_on_head_counts_as_on_head(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`release.py X.Y.Z` then `release.py X.Y.Z --push`: the second run finds the first run's annotated tag on HEAD."""
    def git(*args: str) -> None:
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init", "-q")
    git("commit", "-q", "--allow-empty", "-m", "Release 1.2.3")
    git("tag", "-a", "v1.2.3", "-m", "Divine Pulse 1.2.3")
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    assert release_script.tag_is_head("v1.2.3")
    git("commit", "-q", "--allow-empty", "-m", "Later")
    assert not release_script.tag_is_head("v1.2.3")



def test_release_files_on_macos_is_the_app_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    monkeypatch.setattr(release_script, "target", release_script.build.MacOS)
    monkeypatch.setattr(release_script.build.platform, "machine", lambda: "arm64")
    (tmp_path / "release").mkdir()
    archive = tmp_path / "release" / "Divine-Pulse-1.2.3-macos-arm64.zip"
    archive.write_bytes(b"app")
    sums = tmp_path / "release" / "SHA256SUMS.txt"
    sums.write_text("0" * 64 + f"  {archive.name}\n", encoding="ascii")
    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        release_script.release_files("1.2.3")
    _write_manifest({archive.name: archive}, sums)
    assert release_script.release_files("1.2.3") == [archive, sums]


def test_release_files_on_macos_takes_the_zip_the_build_named(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """build.py names the zip by build/venv's architecture, which an x86_64 (Rosetta) Python running this script
    wouldn't report. More than one for the version can't be told apart."""
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    monkeypatch.setattr(release_script, "target", release_script.build.MacOS)
    monkeypatch.setattr(release_script.build.platform, "machine", lambda: "x86_64")
    (tmp_path / "release").mkdir()
    archive = tmp_path / "release" / "Divine-Pulse-1.2.3-macos-arm64.zip"
    archive.write_bytes(b"app")
    (tmp_path / "release" / "Divine-Pulse-1.2.2-macos-x86_64.zip").write_bytes(b"older")
    sums = tmp_path / "release" / "SHA256SUMS.txt"
    _write_manifest({archive.name: archive}, sums)
    assert release_script.release_files("1.2.3") == [archive, sums]
    (tmp_path / "release" / "Divine-Pulse-1.2.3-macos-x86_64.zip").write_bytes(b"other")
    with pytest.raises(RuntimeError, match="more than one macOS zip"):
        release_script.release_files("1.2.3")


def test_release_files_on_macos_names_the_missing_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    monkeypatch.setattr(release_script, "target", release_script.build.MacOS)
    monkeypatch.setattr(release_script.build.platform, "machine", lambda: "arm64")
    (tmp_path / "release").mkdir()
    with pytest.raises(RuntimeError, match=r"did not create Divine-Pulse-1\.2\.3-macos-arm64\.zip, SHA256SUMS\.txt$"):
        release_script.release_files("1.2.3")


def test_build_and_check_on_macos_uses_the_build_venvs_ruff_and_scans_the_app_zip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    monkeypatch.setattr(release_script, "target", release_script.build.MacOS)
    commands = []
    monkeypatch.setattr(release_script, "run", lambda *command, cwd=tmp_path: commands.append(([*command], cwd)))
    archive, sums = tmp_path / "release" / "Divine-Pulse-1.2.3-macos-arm64.zip", tmp_path / "release" / "SHA256SUMS.txt"
    monkeypatch.setattr(release_script, "release_files", lambda version: [archive, sums])
    scanned = []
    monkeypatch.setattr(release_script.game_content, "check_zip", lambda path: scanned.append(path) or [])

    assert release_script.build_and_check("1.2.3") == [archive, sums]
    (build, _), (ruff, cwd) = commands
    assert build == [release_script.sys.executable, tmp_path / "tools/build.py"]
    assert ruff[0] == tmp_path / "build/venv/bin/python" and ruff[1:4] == ["-m", "ruff", "check"]
    assert cwd == tmp_path / "backend"
    assert scanned == [archive]


def test_the_release_script_runs_with_macos_own_python3(tmp_path: Path) -> None:
    """macOS's /usr/bin/python3 is 3.9 (no tomllib): the script switches to a newer Python, as build.py does."""
    old = Path("/usr/bin/python3")
    if not old.is_file():
        pytest.skip("no /usr/bin/python3")
    found = subprocess.run([str(old), "-c", "import sys; print(sys.version_info < (3, 11))"], capture_output=True,
                           text=True)
    if found.returncode or found.stdout.strip() != "True":
        pytest.skip("/usr/bin/python3 has tomllib")
    result = subprocess.run([str(old), str(RELEASE_SCRIPT), "finalize", "not-a-version"], capture_output=True,
                            text=True, cwd=tmp_path)
    assert "tomllib" not in result.stderr
    assert "version must look like 1.2.3" in result.stderr or "Python 3.12 or newer is needed" in result.stderr


def test_add_to_draft_merges_the_checksums_and_checks_the_upload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The draft keeps the other computer's checksum lines, gains this one's (replacing an earlier upload's), and
    the uploaded files are downloaded back and compared."""
    archive = tmp_path / "Divine-Pulse-1.2.3-macos-arm64.zip"
    archive.write_bytes(b"app")
    local_sums = tmp_path / "SHA256SUMS.txt"
    _write_manifest({archive.name: archive}, local_sums)
    windows = "a" * 64 + "  Divine-Pulse-1.2.3-setup.exe"
    draft = {"SHA256SUMS.txt": (windows + "\n" + "0" * 64 + f"  {archive.name}\n").encode()}
    monkeypatch.setattr(release_script, "preflight", lambda tag: list(draft))

    def fake_run(*command, cwd=None):
        command = [str(part) for part in command]
        if command[:3] == ["gh", "release", "download"]:
            pattern = command[command.index("--pattern") + 1]
            (Path(command[command.index("--dir") + 1]) / pattern).write_bytes(draft[pattern])
        elif command[:3] == ["gh", "release", "upload"]:
            assert command[-1] == "--clobber"
            for path in command[4:-1]:
                draft[Path(path).name] = Path(path).read_bytes()

    monkeypatch.setattr(release_script, "run", fake_run)
    release_script.add_to_draft("v1.2.3", [archive, local_sums])
    assert draft["SHA256SUMS.txt"].decode("ascii").splitlines() == [
        windows, f"{hashlib.sha256(b'app').hexdigest()}  {archive.name}"]
    assert draft[archive.name] == b"app"

    draft[archive.name] = b"something else"
    monkeypatch.setattr(release_script, "run", lambda *command, cwd=None: fake_run(*command) if "upload" not in
                        [str(part) for part in command] else None)
    with pytest.raises(RuntimeError, match="differs"):
        release_script.add_to_draft("v1.2.3", [archive, local_sums])


def test_build_and_check_on_windows_uses_the_build_venvs_ruff_and_scans_the_portable_zip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(release_script, "ROOT", tmp_path)
    commands = []
    monkeypatch.setattr(release_script, "run", lambda *command, cwd=tmp_path: commands.append(([*command], cwd)))
    release = tmp_path / "release"
    files = [release / "Divine-Pulse-1.2.3-windows-portable.zip", release / "Divine-Pulse-1.2.3-setup.exe",
             release / "SHA256SUMS.txt"]
    monkeypatch.setattr(release_script, "release_files", lambda version: files)
    scanned = []
    monkeypatch.setattr(release_script.game_content, "check_zip", lambda path: scanned.append(path) or [])

    assert release_script.build_and_check("1.2.3") == files
    (_, _), (ruff, _) = commands
    assert ruff[0] == tmp_path / "build" / "venv" / "Scripts" / "python.exe"
    assert scanned == [files[0]]


def test_a_missing_installer_says_to_install_inno_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    _write_manifest(artifacts, tmp_path / "release" / "SHA256SUMS.txt")
    artifacts["Divine-Pulse-1.2.3-setup.exe"].unlink()
    with pytest.raises(RuntimeError, match="setup.exe; install Inno Setup 6"):
        release_script.release_files("1.2.3")


def test_check_validates_the_built_files_with_the_apps_version_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture,
) -> None:
    artifacts = _release_fixture(tmp_path, monkeypatch)
    _write_manifest(artifacts, tmp_path / "release" / "SHA256SUMS.txt")
    monkeypatch.setattr(release_script, "app_version", lambda: "1.2.3")
    scanned = []
    monkeypatch.setattr(release_script.game_content, "check_zip", lambda path: scanned.append(path.name) or [])
    monkeypatch.setattr(release_script.sys, "argv", ["release.py", "check"])
    release_script.main()
    assert scanned == ["Divine-Pulse-1.2.3-windows-portable.zip"]
    assert "Release files OK: Divine-Pulse-1.2.3-windows-portable.zip" in capsys.readouterr().out
    monkeypatch.setattr(release_script.game_content, "check_zip", lambda path: ["game.bin: game data"])
    with pytest.raises(SystemExit, match="game content"):
        release_script.main()
    monkeypatch.setattr(release_script.sys, "argv", ["release.py", "finalize"])
    with pytest.raises(SystemExit):
        release_script.main()


def test_finalize_runs_only_where_releases_are_built(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(release_script.sys, "platform", "linux")
    with pytest.raises(SystemExit, match="Windows or macOS release files"):
        release_script.preflight("v1.2.3")
