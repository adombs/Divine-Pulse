"""Prepare a release branch, or build and draft its merged main commit.

    python tools/release.py prepare 1.2.10
    python tools/release.py finalize 1.2.10
    python tools/release.py check [1.2.10]

Preparation commits version and changelog changes on the matching release or hotfix branch.
Finalization checks the clean current main against origin and builds this computer's release files (Windows: the
installer and portable zip; macOS: the app zip). Run it on each: the first pushes only the tag and creates a draft
with its files, the next adds its files to that draft. Either may go first. Check only validates this computer's
built release files (names, checksums, the zip's game-content scan), as finalize does before uploading.

The system's part (which files, where the build environment is) comes from tools/build.py's Target.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402 (this system's release files and build environment: build.target())

if sys.version_info < (3, 12):  # noqa: UP036 (macOS's own python3 is 3.9, which lacks tomllib)
    if newer := build.newer_python():
        print(f"Python {sys.version.split()[0]} is too old for the release script: using {newer}", flush=True)
        os.execv(newer, [newer, __file__, *sys.argv[1:]])
    sys.exit(f"release: Python 3.12 or newer is needed (this is {sys.version.split()[0]}).")
import tomllib  # noqa: E402

import game_content  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RELEASED_ON = {"win32": "Windows", "darwin": "macOS"}  # each finalizes its own files onto the same draft
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
    if re.search(rf"^## {re.escape(version)} \(", text, re.M):
        fail(f"CHANGELOG.md already has a {version} section")
    m = re.search(r"^## Unreleased\n(.*?)(?=^## |\Z)", text, flags=re.M | re.S)
    if not m or not m.group(1).strip():
        fail("CHANGELOG.md has nothing under '## Unreleased'")
    today = datetime.date.today().isoformat()
    text = re.sub(r"^## Unreleased\n+", f"## Unreleased\n\n## {version} ({today})\n\n", text, count=1, flags=re.M)
    path.write_text(text, "utf-8", newline="\n")


def run(*command: str | Path, cwd: Path = ROOT) -> None:
    subprocess.run([str(part) for part in command], cwd=cwd, check=True)


def target() -> build.Target:
    """This computer's build target: which release files it makes and where its build environment is."""
    return build.target()


def preflight(tag: str) -> list[str] | None:
    """None when `tag` is new: nothing on origin and no release yet. When the other computer already finalized, the
    names of the files on its draft (the tag must be this commit and the release still a draft)."""
    if sys.platform not in RELEASED_ON:
        fail(f"finalize builds the {' or '.join(RELEASED_ON.values())} release files and must run on one of them")
    if subprocess.run(["gh", "auth", "status"], cwd=ROOT, capture_output=True).returncode:
        fail("GitHub CLI is not authenticated; run 'gh auth login' and try again")
    remote_tag = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--tags", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if remote_tag.returncode not in {0, 2}:
        fail("couldn't check tags on origin")
    found = subprocess.run(["gh", "release", "view", tag, "--json", "isDraft,assets"], cwd=ROOT,
                           capture_output=True, text=True, encoding="utf-8")
    if remote_tag.returncode == 2:
        if found.returncode == 0:
            fail(f"a GitHub release for {tag} already exists")
        if git("tag", "--list", tag):
            fail(f"{tag} already exists locally")
        return None
    if found.returncode:
        fail(f"{tag} exists on origin but has no GitHub release; inspect it before retrying")
    draft = json.loads(found.stdout)
    if not draft["isDraft"]:
        fail(f"{tag} is already published")
    commits = {line.split()[1]: line.split()[0] for line in remote_tag.stdout.splitlines()}
    commit = commits.get(f"refs/tags/{tag}^{{}}", commits.get(f"refs/tags/{tag}"))
    if commit != git("rev-parse", "HEAD"):
        fail(f"{tag} on origin isn't this commit; its draft must get files built from the same commit")
    return [asset["name"] for asset in draft["assets"]]


def artifact_names(version: str) -> list[str]:
    """This computer's release files, without the checksum file, the zip first."""
    return target().artifact_names(version, ROOT / "release")


def release_files(version: str) -> list[Path]:
    release = ROOT / "release"
    expected = [*(release / name for name in artifact_names(version)), release / "SHA256SUMS.txt"]
    missing = [path.name for path in expected if not path.is_file()]
    if missing:
        raise RuntimeError("local build did not create " + ", ".join(missing) + target().missing_hint())
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


def changelog_notes(version: str) -> str:
    """The version's own bullets from CHANGELOG.md."""
    text = (ROOT / "CHANGELOG.md").read_text("utf-8")
    found = re.search(rf"^## {re.escape(version)} \([^\n]+\)\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return found.group(1).strip() if found and found.group(1).strip() else "See CHANGELOG.md."


def version_notes(version: str, previous_notes: str, own: str) -> str:
    """Cumulative notes use neutral version headings, regardless of whether a patch adds features or fixes."""
    return f"{previous_notes.rstrip()}\n\n## Version {version}\n\n{own.strip()}"


def previous_release(version: str) -> str | None:
    """The release version x.y.z builds its notes on (x.y.(z-1)); None for an x.y.0 release."""
    major, minor, patch = (int(part) for part in version.split("."))
    return f"{major}.{minor}.{patch - 1}" if patch else None


def release_notes(version: str) -> str:
    """An x.y.0 release's notes are its CHANGELOG.md section (rewritten by hand on GitHub as needed). A patch version x.y.z
    carries x.y.0's notes as published, with each version's bullets appended in order up to this one."""
    own = changelog_notes(version)
    previous = previous_release(version)
    if previous is None:
        return own
    notes = published_notes(previous)
    if not notes:
        fail(f"couldn't read the published notes of v{previous}, which version {version}'s notes build on")
    return version_notes(version, notes, own)


def published_notes(version: str) -> str | None:
    """A GitHub release's notes as they stand (None if they can't be read)."""
    found = subprocess.run(["gh", "release", "view", f"v{version}", "--json", "body", "--jq", ".body"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    return found.stdout.strip() or None if found.returncode == 0 else None


def app_version() -> str | None:
    found = re.search(r'^__version__ = "([^"]+)"$', (ROOT / "backend/app/__init__.py").read_text("utf-8"), re.M)
    return found.group(1) if found else None


def build_and_check(version: str) -> list[Path]:
    run(sys.executable, ROOT / "tools/build.py")
    python = target().venv_python(ROOT / "build" / "venv")
    run(python, "-m", "ruff", "check", "--config", "pyproject.toml", ".", "../tools", "../packaging", cwd=ROOT / "backend")
    return check_release(version)


def check_release(version: str) -> list[Path]:
    """This computer's built release files and checksums, and the zip's game-content scan: what finalize uploads
    (CI runs it on each system's build as `release.py check`)."""
    files = release_files(version)
    problems = game_content.check_zip(files[0])
    if problems:
        raise RuntimeError("the release zip holds game content or lacks a license file:\n  " + "\n  ".join(problems))
    return files


def create_draft(tag: str, version: str, files: list[Path], text: str) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as notes_file:
        notes = Path(notes_file.name)
        notes_file.write(text + "\n")
    try:
        run("gh", "release", "create", tag, *files, "--draft", "--verify-tag", "--title", f"Divine Pulse {version}",
            "--notes-file", notes)
        url = subprocess.run(["gh", "release", "view", tag, "--json", "url", "--jq", ".url"], cwd=ROOT,
                             check=True, capture_output=True, text=True).stdout.strip()
        print(f"Draft release: {url}")
    finally:
        notes.unlink(missing_ok=True)


def check_versions(version: str) -> None:
    """Reject a partially prepared or mismatched release before tagging."""
    pyproject = tomllib.loads((ROOT / "backend/pyproject.toml").read_text("utf-8"))
    package = json.loads((ROOT / "frontend/package.json").read_text("utf-8"))
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text("utf-8"))
    versions = [app_version(), pyproject["project"]["version"], package["version"],
                lock["version"], lock["packages"][""]["version"]]
    if any(item != version for item in versions):
        fail(f"version files do not all match {version}")
    text = (ROOT / "CHANGELOG.md").read_text("utf-8")
    section = re.search(rf"^## {re.escape(version)} \(\d{{4}}-\d{{2}}-\d{{2}}\)[ \t]*\n(.*?)(?=^## |\Z)",
                        text, re.M | re.S)
    if not section or not section.group(1).strip():
        fail(f"CHANGELOG.md has no nonempty dated {version} section")


def prepare(version: str) -> None:
    branch = git("branch", "--show-current")
    if branch not in {f"release/{version}", f"hotfix/{version}"}:
        fail(f"prepare must run on release/{version} or hotfix/{version}")
    if git("status", "--porcelain"):
        fail("uncommitted changes")
    if git("tag", "--list", f"v{version}"):
        fail(f"v{version} already exists locally")
    originals = {path: path.read_bytes() for path in VERSION_FILES}
    try:
        sub(ROOT / "backend/app/__init__.py", r'^__version__ = ".*"$', f'__version__ = "{version}"')
        sub(ROOT / "backend/pyproject.toml", r'^version = "[^"]*"$', f'version = "{version}"')
        set_json_version(ROOT / "frontend/package.json", version, lock=False)
        set_json_version(ROOT / "frontend/package-lock.json", version, lock=True)
        changelog(version)
        check_versions(version)
    except (Exception, SystemExit):
        for path, original in originals.items():
            path.write_bytes(original)
        raise
    git("add", "backend/app/__init__.py", "backend/pyproject.toml", "frontend/package.json",
        "frontend/package-lock.json", "CHANGELOG.md")
    git("commit", "-m", f"Release {version}")
    print(f"Prepared {version} on {branch}. Push the branch and merge its PR into main before finalizing.")


def check_current_main() -> None:
    if git("branch", "--show-current") != "main":
        fail("finalize must run on main")
    if git("status", "--porcelain"):
        fail("uncommitted changes")
    remote = git("ls-remote", "--exit-code", "origin", "refs/heads/main").split()
    if len(remote) != 2 or remote[0] != git("rev-parse", "HEAD"):
        fail("main does not match origin/main; update your checkout before finalizing")


def finalize(version: str) -> None:
    tag = f"v{version}"
    check_current_main()
    check_versions(version)
    existing = preflight(tag)
    # Before the build and tag: a patch version's notes need the previous release's.
    notes = release_notes(version) if existing is None else ""
    try:
        files = build_and_check(version)
    except (subprocess.CalledProcessError, RuntimeError) as error:
        fail(f"local checks or build failed ({error}); nothing was tagged or uploaded")
    check_current_main()
    check_versions(version)
    if existing is not None:
        try:
            add_to_draft(tag, files)
        except (subprocess.CalledProcessError, RuntimeError) as error:
            fail(f"adding the files to the {tag} draft failed ({error}); run finalize again")
        return
    git("tag", "-a", tag, "-m", f"Divine Pulse {version}")
    try:
        git("push", "origin", f"refs/tags/{tag}")
    except subprocess.CalledProcessError:
        fail(f"tag {tag} exists locally but push failed; inspect remote and local state before retrying")
    try:
        create_draft(tag, version, files, notes)
        check_uploaded(tag, files[:-1])
    except (subprocess.CalledProcessError, RuntimeError):
        fail(f"tag {tag} was pushed, but the draft wasn't created or its files don't match; follow docs/releasing.md")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_uploaded(tag: str, artifacts: list[Path]) -> None:
    """Download the draft's copies of `artifacts` and compare them byte for byte with the files built here."""
    with tempfile.TemporaryDirectory() as folder:
        for artifact in artifacts:
            run("gh", "release", "download", tag, "--pattern", artifact.name, "--dir", folder, "--clobber")
            if sha256(Path(folder) / artifact.name) != sha256(artifact):
                raise RuntimeError(f"the draft's {artifact.name} differs from release/{artifact.name}")


def add_to_draft(tag: str, files: list[Path]) -> None:
    """Upload this computer's files to the other computer's draft (replacing earlier copies of them), with their lines
    merged into the draft's SHA256SUMS.txt, then check the uploaded copies."""
    artifacts, local_sums = files[:-1], files[-1]
    names = {artifact.name for artifact in artifacts}
    ours = [line for line in local_sums.read_text("ascii").splitlines() if line.split("  ", 1)[-1] in names]
    with tempfile.TemporaryDirectory() as folder:
        sums = Path(folder) / "SHA256SUMS.txt"
        assets = preflight(tag) or []
        lines = []
        if sums.name in assets:
            run("gh", "release", "download", tag, "--pattern", sums.name, "--dir", folder)
            lines = [line for line in sums.read_text("ascii").splitlines()
                     if line.strip() and line.split("  ", 1)[-1] not in names]
        sums.write_text("\n".join([*lines, *ours]) + "\n", "ascii", newline="\n")
        run("gh", "release", "upload", tag, *artifacts, sums, "--clobber")
    check_uploaded(tag, artifacts)
    print(f"Added {', '.join(sorted(names))} to the {tag} draft.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a release branch, finalize a merged release on main, or "
                                                 "check this computer's built release files.")
    parser.add_argument("action", choices=("prepare", "finalize", "check"))
    parser.add_argument("version", nargs="?", help="e.g. 1.2.10 (check: the app's version by default)")
    args = parser.parse_args()
    if args.version is None and args.action != "check":
        parser.error(f"{args.action} needs the version")
    version = (args.version or app_version() or "").removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail("version must look like 1.2.3")
    if args.action == "prepare":
        prepare(version)
    elif args.action == "finalize":
        finalize(version)
    else:
        try:
            files = check_release(version)
        except RuntimeError as error:
            fail(str(error))
        print("Release files OK: " + ", ".join(path.name for path in files))


if __name__ == "__main__":
    main()
