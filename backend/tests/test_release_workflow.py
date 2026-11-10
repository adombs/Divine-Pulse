"""Release promotion checks against an isolated Git repository."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "release.py"
SPEC = importlib.util.spec_from_file_location("release_workflow", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def repo_git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def release_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo_git(tmp_path, "init", "-q", "-b", "main")
    repo_git(tmp_path, "config", "user.name", "Release Test")
    repo_git(tmp_path, "config", "user.email", "release-test@example.invalid")
    contents = {
        "backend/app/__init__.py": '__version__ = "1.2.9"\n',
        "backend/pyproject.toml": '[project]\nversion = "1.2.9"\n',
        "frontend/package.json": json.dumps({"name": "test", "version": "1.2.9"}) + "\n",
        "frontend/package-lock.json": json.dumps({"version": "1.2.9", "packages": {"": {"version": "1.2.9"}}}) + "\n",
        "CHANGELOG.md": "# Changelog\n\n## Unreleased\n\n- A change.\n\n## 1.2.9 (2026-11-01)\n\n- Earlier.\n",
    }
    for name, value in contents.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")
    repo_git(tmp_path, "add", ".")
    repo_git(tmp_path, "commit", "-qm", "Initial")
    monkeypatch.setattr(release, "ROOT", tmp_path)
    monkeypatch.setattr(release, "VERSION_FILES", tuple(tmp_path / name for name in contents))
    return tmp_path


def test_prepare_commits_version_on_release_branch_without_creating_tag_or_pushing(
    release_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_git(release_repo, "switch", "-qc", "release/1.2.10")
    real_git = release.git
    calls = []

    def record_git(*args: str) -> str:
        calls.append(args)
        return real_git(*args)

    monkeypatch.setattr(release, "git", record_git)
    release.prepare("1.2.10")

    assert repo_git(release_repo, "status", "--porcelain") == ""
    assert repo_git(release_repo, "log", "-1", "--format=%s") == "Release 1.2.10"
    assert repo_git(release_repo, "tag", "--list") == ""
    assert not any(call[0] in {"tag", "push"} and (call[0] != "tag" or "--list" not in call) for call in calls)
    assert json.loads((release_repo / "frontend/package-lock.json").read_text())["packages"][""]["version"] == "1.2.10"
    assert "## 1.2.10 (" in (release_repo / "CHANGELOG.md").read_text()


@pytest.mark.parametrize("branch", ["main", "feature/1.2.10", "release/1.2.11"])
def test_prepare_rejects_wrong_branch_without_changes(release_repo: Path, branch: str) -> None:
    if branch != "main":
        repo_git(release_repo, "switch", "-qc", branch)
    head = repo_git(release_repo, "rev-parse", "HEAD")
    with pytest.raises(SystemExit):
        release.prepare("1.2.10")
    assert repo_git(release_repo, "rev-parse", "HEAD") == head
    assert repo_git(release_repo, "status", "--porcelain") == ""


def test_finalize_rejects_release_branch_without_tagging(release_repo: Path) -> None:
    repo_git(release_repo, "switch", "-qc", "release/1.2.10")
    with pytest.raises(SystemExit):
        release.finalize("1.2.10")
    assert repo_git(release_repo, "tag", "--list") == ""


def _prepared_main(root: Path) -> None:
    repo_git(root, "switch", "-qc", "release/1.2.10")
    release.prepare("1.2.10")
    repo_git(root, "switch", "-q", "main")
    repo_git(root, "merge", "--ff-only", "release/1.2.10")


def test_finalize_checks_remote_main_and_pushes_only_the_tag(
    release_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _prepared_main(release_repo)
    head = repo_git(release_repo, "rev-parse", "HEAD")
    real_git = release.git
    calls = []
    artifacts = [release_repo / "artifact.zip"]
    drafts = []

    def stub_git(*args: str) -> str:
        calls.append(args)
        if args[0] == "ls-remote":
            return f"{head}\trefs/heads/main"
        if args[0] == "push":
            return ""
        return real_git(*args)

    monkeypatch.setattr(release, "git", stub_git)
    monkeypatch.setattr(release, "preflight_push", lambda tag: None)
    monkeypatch.setattr(release, "build_and_check", lambda version: artifacts)
    monkeypatch.setattr(release, "create_draft", lambda *args: drafts.append(args))
    monkeypatch.setattr(release, "published_notes", lambda version: f"Notes of {version}.")
    release.finalize("1.2.10")

    assert [call for call in calls if call[0] == "push"] == [("push", "origin", "refs/tags/v1.2.10")]
    assert len([call for call in calls if call[0] == "ls-remote"]) == 2
    assert repo_git(release_repo, "rev-parse", "v1.2.10^{commit}") == head
    assert drafts == [("v1.2.10", "1.2.10", artifacts, "Notes of 1.2.9.\n\n## Hotfix 1.2.10\n\n- A change.")]


def test_finalize_stops_before_building_when_the_previous_notes_cannot_be_read(
    release_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _prepared_main(release_repo)
    head = repo_git(release_repo, "rev-parse", "HEAD")
    real_git = release.git
    built = []
    monkeypatch.setattr(release, "git", lambda *args: f"{head}\trefs/heads/main" if args[0] == "ls-remote"
                        else real_git(*args))
    monkeypatch.setattr(release, "preflight_push", lambda tag: None)
    monkeypatch.setattr(release, "build_and_check", lambda version: built.append(version) or [])
    monkeypatch.setattr(release, "published_notes", lambda version: None)
    with pytest.raises(SystemExit, match="v1.2.9"):
        release.finalize("1.2.10")
    assert built == []
    assert repo_git(release_repo, "tag", "--list") == ""


def test_hotfix_notes_build_on_the_previous_release(release_repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (release_repo / "CHANGELOG.md").write_text(
        "# Changelog\n\n## Unreleased\n\n## 1.5.2 (2026-11-12)\n\n- Second fix.\n\n"
        "## 1.5.1 (2026-11-11)\n\n- First fix.\n\n## 1.5.0 (2026-11-10)\n\n- New things.\n", encoding="utf-8")
    published = {"1.5.0": "Hand-written 1.5.0 notes.", "1.5.1": "Hand-written 1.5.0 notes.\n\n## Hotfix 1.5.1\n\n- Fix one."}
    monkeypatch.setattr(release, "published_notes", published.get)

    assert release.release_notes("1.5.0") == "- New things."  # a minor release: its own changelog section
    assert release.release_notes("1.5.1") == "Hand-written 1.5.0 notes.\n\n## Hotfix 1.5.1\n\n- First fix."
    # The previous hotfix's notes as published (edited on GitHub), then this one's bullets.
    assert release.release_notes("1.5.2") == (
        "Hand-written 1.5.0 notes.\n\n## Hotfix 1.5.1\n\n- Fix one.\n\n## Hotfix 1.5.2\n\n- Second fix.")
    assert release.previous_release("2.0.0") is None and release.previous_release("1.4.10") == "1.4.9"


def test_finalize_does_not_tag_when_remote_main_changes_during_build(
    release_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _prepared_main(release_repo)
    head = repo_git(release_repo, "rev-parse", "HEAD")
    real_git = release.git
    remote_heads = iter([head, "0" * 40])

    def stub_git(*args: str) -> str:
        if args[0] == "ls-remote":
            return f"{next(remote_heads)}\trefs/heads/main"
        return real_git(*args)

    monkeypatch.setattr(release, "git", stub_git)
    monkeypatch.setattr(release, "preflight_push", lambda tag: None)
    monkeypatch.setattr(release, "build_and_check", lambda version: [])
    monkeypatch.setattr(release, "published_notes", lambda version: f"Notes of {version}.")
    with pytest.raises(SystemExit, match="origin/main"):
        release.finalize("1.2.10")
    assert repo_git(release_repo, "tag", "--list") == ""
