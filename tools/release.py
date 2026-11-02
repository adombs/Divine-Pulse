"""Starts a Windows release (docs/releasing.md): versions, builds, tags, and optionally creates a draft release.

    python tools/release.py 0.2.0 [--push]

Sets the version in backend/app/__init__.py, backend/pyproject.toml and frontend/package.json (+ lock), turns
CHANGELOG.md's "## Unreleased" into "## 0.2.0 (date)" under a fresh empty Unreleased section, commits and tags v0.2.0.
Run it on an up-to-date main with nothing uncommitted. --push runs the local Windows checks and build, pushes main and
the tag, then uses the authenticated GitHub CLI to create a draft release and upload the local artifacts. It never
publishes that draft. Without --push, it prepares the local commit and tag and prints the push command.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_content  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILES = (
    ROOT / "backend/app/__init__.py",
    ROOT / "backend/pyproject.toml",
    ROOT / "frontend/package.json",
    ROOT / "frontend/package-lock.json",
    ROOT / "CHANGELOG.md",
)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def fail(message: str) -> None:
    sys.exit(f"release: {message}")


def tag_is_head(tag: str) -> bool:
    """Whether `tag` is on HEAD. The script's tags are annotated, so compare the commit the tag points to, not the tag
    object itself."""
    return git("rev-parse", f"{tag}^{{commit}}") == git("rev-parse", "HEAD")


def sub(path: Path, pattern: str, repl: str) -> None:
    text = path.read_text("utf-8")
    new, n = re.subn(pattern, repl, text, count=1, flags=re.M)
    if n != 1:
        fail(f"no version found in {path.relative_to(ROOT)}")
    path.write_text(new, "utf-8", newline="\n")


def set_json_version(path: Path, version: str, lock: bool) -> None:
    data = json.loads(path.read_text("utf-8"))
    data["version"] = version
    if lock:
        data["packages"][""]["version"] = version
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", "utf-8", newline="\n")


def changelog(version: str) -> None:
    path = ROOT / "CHANGELOG.md"
    text = path.read_text("utf-8")
    m = re.search(r"^## Unreleased\n(.*?)(?=^## |\Z)", text, flags=re.M | re.S)
    if not m or not m.group(1).strip():
        fail("CHANGELOG.md has nothing under '## Unreleased'")
    today = datetime.date.today().isoformat()
    text = re.sub(r"^## Unreleased\n+", f"## Unreleased\n\n## {version} ({today})\n\n", text, count=1, flags=re.M)
    path.write_text(text, "utf-8", newline="\n")


def run(*command: str | Path, cwd: Path = ROOT) -> None:
    subprocess.run([str(part) for part in command], cwd=cwd, check=True)


def preflight_push(tag: str) -> None:
    if sys.platform != "win32":
        fail("--push creates the supported Windows release and must run on Windows")
    if subprocess.run(["gh", "auth", "status"], cwd=ROOT).returncode:
        fail("GitHub CLI is not authenticated; run 'gh auth login' and try again")
    remote_tag = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--tags", "origin", f"refs/tags/{tag}"], cwd=ROOT,
    ).returncode
    if remote_tag == 0:
        fail(f"{tag} already exists on origin")
    if remote_tag != 2:
        fail("couldn't check tags on origin")
    if subprocess.run(["gh", "release", "view", tag], cwd=ROOT, stdout=subprocess.DEVNULL,
                      stderr=subprocess.DEVNULL).returncode == 0:
        fail(f"a GitHub release for {tag} already exists")


def release_files(version: str) -> list[Path]:
    release = ROOT / "release"
    expected = [
        release / f"Divine-Pulse-{version}-windows-portable.zip",
        release / f"Divine-Pulse-{version}-setup.exe",
        release / "SHA256SUMS.txt",
    ]
    missing = [path.name for path in expected if not path.is_file()]
    if missing:
        raise RuntimeError("local build did not create " + ", ".join(missing) + "; install Inno Setup 6 and try again")
    try:
        checksums = expected[-1].read_text("ascii")
    except UnicodeDecodeError as error:
        raise RuntimeError("release/SHA256SUMS.txt must contain ASCII checksum entries") from error
    expected_names = {artifact.name: artifact for artifact in expected[:-1]}
    found: dict[str, str] = {}
    for line_number, line in enumerate(checksums.splitlines(), start=1):
        match = re.fullmatch(r"([0-9a-fA-F]{64})  (.+)", line)
        filename = match.group(2) if match else None
        relevant_names = [name for name in expected_names if name in line]
        if not relevant_names:
            continue
        if match is None or filename not in expected_names:
            raise RuntimeError(f"invalid checksum entry on line {line_number} of release/SHA256SUMS.txt")
        if filename in found:
            raise RuntimeError(f"duplicate checksum entry for {filename} in release/SHA256SUMS.txt")
        found[filename] = match.group(1).lower()

    for name, artifact in expected_names.items():
        if name not in found:
            raise RuntimeError(f"{name} is missing from release/SHA256SUMS.txt")
        actual = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if found[name] != actual:
            raise RuntimeError(f"SHA256 mismatch for {name} in release/SHA256SUMS.txt")
    return expected


def release_notes(version: str) -> str:
    text = (ROOT / "CHANGELOG.md").read_text("utf-8")
    found = re.search(rf"^## {re.escape(version)} \([^\n]+\)\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return found.group(1).strip() if found and found.group(1).strip() else "See CHANGELOG.md."


def app_version() -> str | None:
    found = re.search(r'^__version__ = "([^"]+)"$', (ROOT / "backend/app/__init__.py").read_text("utf-8"), re.M)
    return found.group(1) if found else None


def build_and_check(version: str) -> list[Path]:
    run(sys.executable, ROOT / "tools/build.py")
    python = ROOT / "build/venv/Scripts/python.exe"
    run(python, "-m", "ruff", "check", "--config", "pyproject.toml", ".", "../tools", "../packaging", cwd=ROOT / "backend")
    files = release_files(version)
    problems = game_content.check_zip(files[0])
    if problems:
        raise RuntimeError("the release zip holds game content or lacks a license file:\n  " + "\n  ".join(problems))
    return files


def create_draft(tag: str, version: str, files: list[Path]) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as notes_file:
        notes = Path(notes_file.name)
        notes_file.write(release_notes(version) + "\n")
    try:
        run("gh", "release", "create", tag, *files, "--draft", "--verify-tag", "--title", f"Divine Pulse {version}",
            "--notes-file", notes)
        url = subprocess.run(["gh", "release", "view", tag, "--json", "url", "--jq", ".url"], cwd=ROOT,
                             check=True, capture_output=True, text=True).stdout.strip()
        print(f"Draft release: {url}")
    finally:
        notes.unlink(missing_ok=True)


def main() -> None:
    fail("release automation is disabled: it pushes directly to main; follow docs/releasing.md")
    parser = argparse.ArgumentParser(description="Set the version, build a Windows release, commit, tag, and optionally upload a draft.")
    parser.add_argument("version", help="e.g. 0.2.0")
    parser.add_argument("--push", action="store_true", help="build locally, push main and tag, and create a draft GitHub release")
    args = parser.parse_args()
    version, tag = args.version.removeprefix("v"), f"v{args.version.removeprefix('v')}"
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail("version must look like 1.2.3")
    if git("branch", "--show-current") != "main":
        fail("not on main")
    if git("status", "--porcelain"):
        fail("uncommitted changes")
    existing_tag = bool(git("tag", "--list", tag))
    if existing_tag and not args.push:
        fail(f"{tag} already exists")
    if existing_tag and not tag_is_head(tag):
        fail(f"{tag} does not point to HEAD")
    if existing_tag and app_version() != version:
        fail(f"the current app version is not {version}")
    if args.push:
        preflight_push(tag)

    if existing_tag:
        try:
            files = build_and_check(version)
        except (subprocess.CalledProcessError, RuntimeError) as error:
            fail(f"local checks or build failed ({error})")
    else:
        originals = {path: path.read_bytes() for path in VERSION_FILES}
        try:
            sub(ROOT / "backend/app/__init__.py", r'^__version__ = ".*"$', f'__version__ = "{version}"')
            sub(ROOT / "backend/pyproject.toml", r'^version = "[^"]*"$', f'version = "{version}"')
            set_json_version(ROOT / "frontend/package.json", version, lock=False)
            set_json_version(ROOT / "frontend/package-lock.json", version, lock=True)
            changelog(version)
            files = build_and_check(version) if args.push else []
        except (subprocess.CalledProcessError, RuntimeError) as error:
            for path, original in originals.items():
                path.write_bytes(original)
            fail(f"local checks or build failed ({error}); version and changelog files were restored")
        except SystemExit:
            for path, original in originals.items():
                path.write_bytes(original)
            raise

        git("add", "backend/app/__init__.py", "backend/pyproject.toml", "frontend/package.json",
            "frontend/package-lock.json", "CHANGELOG.md")
        git("commit", "-m", f"Release {version}")
        git("tag", "-a", tag, "-m", f"Divine Pulse {version}")
        print(f"Committed and tagged {tag}.")
    if args.push:
        git("push", "origin", "main", tag)
        try:
            create_draft(tag, version, files)
        except subprocess.CalledProcessError:
            fail("pushed the commit and tag, but creating the draft release failed; fix the issue and create the draft "
                 f"for {tag} with the files in release/")
    else:
        print(f"Push and create the local Windows release:  python tools/release.py {version} --push")


if __name__ == "__main__":
    main()
