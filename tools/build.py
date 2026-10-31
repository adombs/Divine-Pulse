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
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND, FRONTEND, PACKAGING = ROOT / "backend", ROOT / "frontend", ROOT / "packaging"
BUILD, RELEASE = ROOT / "build", ROOT / "release"
VENV = BUILD / "venv"
APP_NAME = "Divine Pulse"


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
    return made


def readme(v: str) -> str:
    text = (PACKAGING / "readme-windows.txt").read_text("utf-8")
    return text.replace("{version}", v)


def notes(folder: Path, v: str) -> None:
    """The read-me, the program's license, and the third-party notices with the full GFDL text, next to the program."""
    (folder / "Read me.txt").write_text(readme(v), "utf-8")
    shutil.copy2(ROOT / "LICENSE", folder / "LICENSE.txt")
    shutil.copy2(ROOT / "docs" / "third-party-notices.md", folder / "Third-party notices.txt")
    shutil.copy2(FRONTEND / "src" / "reference" / "wiki" / "LICENSE-GFDL-1.3.txt", folder / "GFDL-1.3.txt")


def package(made: Path, v: str) -> list[Path]:
    step("Release files")
    RELEASE.mkdir(exist_ok=True)
    out: list[Path] = []
    notes(made, v)
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
    if not args.skip_tests:
        tests()
    web_ui()
    files = package(program(), v)
    if not args.no_installer and (setup := installer(v)):
        files.append(setup)
    checksums(files)
    print("\nDone:")
    for f in files:
        print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size / 2**20:.1f} MB)")


if __name__ == "__main__":
    main()
