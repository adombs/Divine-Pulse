"""Builds Divine Pulse for Windows, into release/ (docs/releasing.md).

    python tools/build.py [--skip-tests] [--no-installer] [--current-env]

    Windows  Divine-Pulse-<version>-windows-portable.zip, and Divine-Pulse-<version>-setup.exe with Inno Setup 6
    and SHA256SUMS.txt.

Run it with Python 3.12 or newer. It makes its own build environment (build/venv) with the pinned requirements, so the
release never picks up anything installed by hand; --current-env builds with the running Python instead. Needs
Node.js 22.12+ for the web UI. `tools/release.py --push` can upload a Windows build to a draft GitHub release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND, FRONTEND, PACKAGING = ROOT / "backend", ROOT / "frontend", ROOT / "packaging"
BUILD, RELEASE = ROOT / "build", ROOT / "release"
VENV = BUILD / "venv"
APP_NAME = "Divine Pulse"
NSTOOL = ROOT / "vendor" / "nstool" / "nstool.exe"
DEV_PACKAGES = {"_pytest", "pytest", "pluggy", "iniconfig", "pygments", "httpx", "httpcore", "ruff"}  # requirements-dev.txt
LICENSE_FOLDER = "Third-party licenses"
LICENSE_NAME = re.compile(r"(licen[cs]e|copying|notice)", re.I)
VENDORED_LICENSES = PACKAGING / "third-party-licenses"  # for what doesn't carry its own license text
BUILD_PACKAGES = ("packaging", "pyinstaller", "setuptools")  # end up in the program without being runtime requirements
FRONTEND_PACKAGES = ("scheduler", "@phosphor-icons/core")  # in the web UI bundle, beyond package.json's dependencies


def step(text: str) -> None:
    print(f"== {text}", flush=True)


def run(*command: str | Path, cwd: Path = ROOT) -> None:
    args = [str(c) for c in command]
    exe = shutil.which(args[0]) or args[0]  # npm is npm.cmd on Windows
    subprocess.run([exe, *args[1:]], cwd=cwd, check=True)


def version() -> str:
    found = re.search(r'__version__ = "([^"]+)"', (BACKEND / "app" / "__init__.py").read_text("utf-8"))
    if not found:
        sys.exit("Couldn't read __version__ from backend/app/__init__.py")
    return found.group(1)


def venv_python() -> Path:
    return VENV / "Scripts/python.exe"


def in_build_env() -> bool:
    return Path(sys.prefix).resolve() == VENV.resolve()


def venv_version() -> str | None:
    """The Python version build/venv was made with (from its pyvenv.cfg), or None if there's no venv."""
    try:
        found = re.search(r"^version(?:_info)?\s*=\s*(\d+\.\d+)", (VENV / "pyvenv.cfg").read_text("utf-8"), re.M)
    except OSError:
        return None
    return found.group(1) if found else None


def make_build_env(args: argparse.Namespace) -> None:
    """Create build/venv with the pinned requirements and run this script again inside it."""
    this = f"{sys.version_info.major}.{sys.version_info.minor}"
    if sys.version_info < (3, 12):  # noqa: UP036 (a guard for whoever runs it with an old Python)
        sys.exit(f"Python 3.12 or newer is needed (this is {sys.version.split()[0]}).")
    step(f"Build environment (Python {this})")
    if not venv_python().exists() or venv_version() != this:
        run(sys.executable, "-m", "venv", "--clear", VENV)  # new, or made with another Python version
    py = venv_python()
    try:
        run(py, "-m", "pip", "install", "--upgrade", "pip", "--quiet")
        run(py, "-m", "pip", "install", "-r", BACKEND / "requirements-build.txt", "--quiet")
        if not args.skip_tests:
            run(py, "-m", "pip", "install", "-r", BACKEND / "requirements-dev.txt", "--quiet")
    except subprocess.CalledProcessError:
        sys.exit(f"Installing the pinned requirements failed. If a package doesn't support Python {this} yet, build "
                 "with an older Python (py -3.13 tools/build.py) or update the pin in backend/requirements*.txt.")
    raise SystemExit(subprocess.call([str(py), __file__, *sys.argv[1:]]))


def tests() -> None:
    step("Tests")
    run(sys.executable, "-m", "pytest", "-q", cwd=BACKEND)


def web_ui() -> None:
    step("Web UI")
    run("npm", "ci" if (FRONTEND / "package-lock.json").exists() else "install", "--no-audit", "--no-fund", cwd=FRONTEND)
    run("npm", "run", "build", cwd=FRONTEND)


def program() -> Path:
    """Run PyInstaller; returns what it made (the program folder)."""
    step("Program (PyInstaller)")
    run(
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
        "--distpath", BUILD / "dist", "--workpath", BUILD / "work", PACKAGING / "divine_pulse.spec",
    )
    made = BUILD / "dist" / APP_NAME
    if not made.exists():
        sys.exit(f"PyInstaller didn't produce {made}")
    leaked = dev_modules((BUILD / "work" / "divine_pulse" / "PYZ-00.toc").read_text("utf-8", "replace"))
    if leaked:
        sys.exit(f"Development packages got into the program: {', '.join(leaked)}. Exclude them in {PACKAGING / 'divine_pulse.spec'}.")
    return made


def dev_modules(toc: str) -> list[str]:
    """Modules from packages only development needs, in the text of PyInstaller's module list."""
    return sorted({name for name in re.findall(r"\('([\w.]+)',", toc) if name.split(".")[0] in DEV_PACKAGES})


def readme(v: str) -> str:
    text = (PACKAGING / "readme-windows.txt").read_text("utf-8")
    return text.replace("{version}", v)


def runtime_distributions() -> dict[str, metadata.Distribution]:
    """The Python packages requirements.txt pulls in, with their dependencies, by normalized name."""
    from packaging.requirements import Requirement

    todo = [
        Requirement(line) for line in (BACKEND / "requirements.txt").read_text("utf-8").splitlines()
        if line.strip() and not line.startswith(("#", "-"))
    ]
    found: dict[str, metadata.Distribution] = {}
    extras: dict[str, set[str]] = {}
    while todo:
        wanted = todo.pop()
        name = normalize(wanted.name)
        if name in found and wanted.extras <= extras[name]:
            continue
        extras[name] = extras.get(name, set()) | wanted.extras
        found[name] = metadata.distribution(name)
        for text in found[name].requires or []:
            child = Requirement(text)
            if child.marker is None or any(child.marker.evaluate({"extra": e}) for e in extras[name] or {""}):
                todo.append(child)
    return found


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def license_files(dist: metadata.Distribution) -> list[tuple[Path, str]]:
    """A package's license files as (source, path inside its .dist-info): names repeat, as in httptools' vendored ones."""
    out = []
    for file in dist.files or []:
        parts = file.parts
        if parts[0].endswith(".dist-info") and LICENSE_NAME.match(file.name):
            out.append((Path(str(file.locate())), "/".join(parts[1:])))
    return out


def third_party_licenses(folder: Path) -> None:
    """The license text of everything bundled, in Third-party licenses/. A package without one stops the build."""
    target = folder / LICENSE_FOLDER
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(VENDORED_LICENSES, target)
    vendored = {path.stem for path in VENDORED_LICENSES.iterdir()}
    packages = runtime_distributions()
    packages.update({name: metadata.distribution(name) for name in BUILD_PACKAGES})
    missing = []
    for name, dist in sorted(packages.items()):
        files = license_files(dist)
        if not files and name not in vendored:
            missing.append(name)
        for source, inside in files:
            copied = target / name / inside
            copied.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, copied)
    manifest = json.loads((FRONTEND / "package.json").read_text("utf-8"))
    for name in [*manifest["dependencies"], *FRONTEND_PACKAGES]:
        source = FRONTEND / "node_modules" / name / "LICENSE"
        if not source.is_file():
            missing.append(name)
            continue
        copied = target / "frontend" / name / "LICENSE"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, copied)
    if missing:
        sys.exit(f"No license text found for: {', '.join(missing)}. Add one to {VENDORED_LICENSES}.")


def notes(folder: Path, v: str) -> None:
    """The read-me, the program's license, the third-party notices and license texts, next to the program."""
    (folder / "Read me.txt").write_text(readme(v), "utf-8")
    shutil.copy2(ROOT / "LICENSE", folder / "LICENSE.txt")
    shutil.copy2(ROOT / "docs" / "third-party-notices.md", folder / "Third-party notices.txt")
    shutil.copy2(FRONTEND / "src" / "reference" / "wiki" / "LICENSE-GFDL-1.3.txt", folder / "GFDL-1.3.txt")
    third_party_licenses(folder)


def package(made: Path, v: str) -> list[Path]:
    step("Release files")
    if not NSTOOL.is_file():
        raise FileNotFoundError(f"Bundled NSTool is missing: {NSTOOL}")
    licenses = NSTOOL.parent / "licenses"
    if not licenses.is_dir() or not any(licenses.iterdir()):
        raise FileNotFoundError(f"Bundled NSTool licenses are missing: {licenses}")
    RELEASE.mkdir(exist_ok=True)
    out: list[Path] = []
    notes(made, v)
    tools_dir = made / "tools"
    tools_dir.mkdir(exist_ok=True)
    shutil.copy2(NSTOOL, tools_dir / "nstool.exe")
    shutil.copytree(licenses, tools_dir / "nstool-licenses", dirs_exist_ok=True)
    out.append(Path(shutil.make_archive(str(RELEASE / f"Divine-Pulse-{v}-windows-portable"), "zip", made.parent, made.name)))
    return out


def installer(v: str) -> Path | None:
    """The Windows installer, when Inno Setup 6 is installed."""
    candidates = [shutil.which("iscc")] + [
        os.path.join(base, "Inno Setup 6", "ISCC.exe")
        for base in (os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs"))
        if base
    ]
    iscc = next((c for c in candidates if c and Path(c).exists()), None)
    if not iscc:
        print("Inno Setup 6 not found: skipping the installer (the portable zip is complete on its own).")
        return None
    step("Installer (Inno Setup)")
    run(iscc, "/Q", f"/DAppVersion={v}", PACKAGING / "installer.iss")
    return RELEASE / f"Divine-Pulse-{v}-setup.exe"


def checksums(files: list[Path]) -> None:
    step("Checksums")
    lines = [f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}" for f in files]
    (RELEASE / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", "ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Divine Pulse for Windows into release/.")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--no-installer", action="store_true", help="Windows: only the portable zip")
    parser.add_argument("--current-env", action="store_true", help="build with this Python instead of build/venv")
    args = parser.parse_args()
    if not args.current_env and not in_build_env():
        make_build_env(args)
    v = version()
    print(f"Divine Pulse {v} for Windows")
    web_ui()  # before the tests: the API tests serve frontend/dist
    if not args.skip_tests:
        tests()
    files = package(program(), v)
    if not args.no_installer and (setup := installer(v)):
        files.append(setup)
    checksums(files)
    print("\nDone:")
    for f in files:
        print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size / 2**20:.1f} MB)")


if __name__ == "__main__":
    main()
