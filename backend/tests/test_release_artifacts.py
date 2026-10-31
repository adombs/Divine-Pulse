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
