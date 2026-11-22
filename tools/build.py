"""Builds Divine Pulse for this computer's system into release/ (docs/releasing.md).

    python tools/build.py [--skip-tests] [--no-installer] [--current-env]

    Windows  Divine-Pulse-<version>-windows-portable.zip, and Divine-Pulse-<version>-setup.exe with Inno Setup 6
    macOS    Divine Pulse.app (ready to run or drag to Applications), and Divine-Pulse-<version>-macos-<arch>.zip of it
    and SHA256SUMS.txt.

Every system goes through the same steps (main()); what differs is a Target (Windows, MacOS, and a Linux stub),
chosen once from sys.platform:

    build env      build/venv with the pinned requirements, and the system's own tools
    web UI, tests  shared
    program        Target.before_program (macOS: the icon), PyInstaller (shared), Target.finish_program (the notes
                   and licenses where the system keeps them, and what the system bundles beside the program)
    sign           Target.sign: Windows ships unsigned; macOS signs ad hoc and checks the memory reader's entitlement
    desktop check  the packaged window opened once with --check-desktop, from a copy treated the way the system
                   treats a downloaded one (Windows: Internet-zone markers; macOS: read-only, as App Translocation)
    package        Target.package: the release files
    checksums      shared

On macOS it needs Xcode's command-line tools (clang, codesign, iconutil): the app is signed ad hoc, with the memory
reader helper inside it signed with the debugger entitlement (backend/app/system/macos).

Run it with Python 3.12 or newer; started with an older one, it looks for a newer one (Windows: the py launcher;
macOS: Homebrew's or python.org's) and runs itself with that. It makes its own build environment (build/venv) with
the pinned requirements, so the release never picks up anything installed by hand; --current-env builds with the
running Python instead. Needs Node.js 22.12+ for the desktop UI. See the release guide for publishing a build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND, FRONTEND, PACKAGING = ROOT / "backend", ROOT / "frontend", ROOT / "packaging"
BUILD, RELEASE = ROOT / "build", ROOT / "release"
VENV = BUILD / "venv"
APP_NAME = "Divine Pulse"
MAC_ICON = ROOT / "branding" / "icons" / "app-icon-rounded-1024.png"
MAC_HELPER = BACKEND / "app" / "system" / "macos"
DEBUGGER_ENTITLEMENT = "com.apple.security.cs.debugger"
NSTOOL = ROOT / "vendor" / "nstool" / "nstool.exe"
DEV_PACKAGES = {"_pytest", "pytest", "pluggy", "iniconfig", "pygments", "httpx", "httpcore", "ruff"}  # requirements-dev.txt
LICENSE_FOLDER = "Third-party licenses"
LICENSE_NAME = re.compile(r"(licen[cs]e|copying|notice)", re.I)
VENDORED_LICENSES = PACKAGING / "third-party-licenses"  # for what doesn't carry its own license text
BUILD_PACKAGES = ("packaging", "pyinstaller", "setuptools")  # end up in the program without being runtime requirements
FRONTEND_PACKAGES = ("scheduler", "@phosphor-icons/core")  # in the web UI bundle, beyond package.json's dependencies
DESKTOP_CHECK_TIMEOUT = 60


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


# Targets: one per system. main() runs the same steps on each; a Target supplies the system's part of them.


class Target:
    """What one system's build does differently. Subclasses override the steps; the defaults are the shared ones."""

    name = ""  # as printed: "Windows", "macOS"
    key = ""  # in the release file names and readme-<key>.txt
    readme = ""  # packaging/readme-<key>.txt, the program's "Read me.txt"
    downloaded_label = "downloaded copy"  # how the desktop check's copy is made to look downloaded

    # Build environment

    def venv_python(self, venv: Path = VENV) -> Path:
        return venv / "bin" / "python"

    def require_tools(self) -> None:
        """Stop before anything is built when the system's own tools are missing."""

    def python_candidates(self) -> list[str]:
        """Python executables to try when this script was started with one older than 3.12, newest first."""
        names = [f"python3.{minor}" for minor in range(20, 11, -1)]
        return [found for name in names if (found := shutil.which(name))]

    # Program

    def program_path(self) -> Path:
        """What PyInstaller makes from packaging/divine_pulse.spec, in build/dist."""
        raise NotImplementedError

    def executable(self, program: Path) -> Path:
        raise NotImplementedError

    def notes_folder(self, program: Path) -> Path:
        """Where the read-me and the license texts go inside the program."""
        raise NotImplementedError

    def before_program(self) -> None:
        """What the spec needs before PyInstaller runs."""

    def finish_program(self, program: Path, v: str) -> None:
        """The files that go into the program beside what PyInstaller put there."""
        step("Notes and licenses")
        notes(self.notes_folder(program), v, self.readme)

    def sign(self, program: Path) -> None:
        """Sign the program and verify the signature."""

    # Desktop check

    def downloaded_copy(self, copy: Path) -> None:
        """Make `copy` of the program look the way the system leaves a downloaded one."""

    def desktop_check(self, program: Path) -> None:
        """Open the packaged window once (--check-desktop: no server, game reader or user data) from a disposable
        copy made to look downloaded, so a build that only works where it was built can't ship."""
        step(f"Packaged desktop ({self.downloaded_label})")
        with tempfile.TemporaryDirectory(prefix="divine-pulse-desktop-") as scratch:
            # Check a copy so the release payload itself is left as it was built.
            copy = Path(scratch) / program.name
            self.copy_program(program, copy)
            self.downloaded_copy(copy)
            try:
                subprocess.run([str(self.executable(copy)), "--check-desktop"], check=True,
                               timeout=DESKTOP_CHECK_TIMEOUT)
            finally:
                self.after_desktop_check(copy)

    def copy_program(self, program: Path, copy: Path) -> None:
        shutil.copytree(program, copy, symlinks=True)

    def after_desktop_check(self, copy: Path) -> None:
        """Undo what downloaded_copy did that would stop the copy from being deleted."""

    # Release files

    def package(self, program: Path, v: str, args: argparse.Namespace) -> list[Path]:
        """The release files, in release/, the zip first."""
        raise NotImplementedError

    def artifact_names(self, v: str, release: Path = RELEASE) -> list[str]:
        """The release files tools/release.py uploads from this system, without the checksum file, the zip first."""
        raise NotImplementedError

    def missing_hint(self) -> str:
        """Said after the names of release files a build didn't make."""
        return ""

    def done(self) -> list[str]:
        """Lines printed above the release files when the build is done."""
        return []


class Windows(Target):
    name, key, readme = "Windows", "windows", "readme-windows.txt"
    downloaded_label = "downloaded DLLs"

    def venv_python(self, venv: Path = VENV) -> Path:
        return venv / "Scripts" / "python.exe"

    def require_tools(self) -> None:
        if not NSTOOL.is_file():
            raise FileNotFoundError(f"Bundled NSTool is missing: {NSTOOL}")
        licenses = NSTOOL.parent / "licenses"
        if not licenses.is_dir() or not any(licenses.iterdir()):
            raise FileNotFoundError(f"Bundled NSTool licenses are missing: {licenses}")

    def python_candidates(self) -> list[str]:
        """The Pythons the py launcher knows (py -0p), newest first, then python.exe files on PATH (not the
        Microsoft Store's alias)."""
        found = []
        if launcher := shutil.which("py"):
            listed = subprocess.run([launcher, "-0p"], capture_output=True, text=True, stdin=subprocess.DEVNULL)
            pythons = re.findall(r"-V:3\.(\d+)\S*\s+\*?\s*(\S.*\.exe)\s*$", listed.stdout, re.M)
            found += [exe.strip() for _minor, exe in sorted(pythons, key=lambda p: -int(p[0]))]
        return found + [exe for exe in [shutil.which("python")] if exe and "WindowsApps" not in exe]

    def program_path(self) -> Path:
        return BUILD / "dist" / APP_NAME

    def executable(self, program: Path) -> Path:
        return program / f"{APP_NAME}.exe"

    def notes_folder(self, program: Path) -> Path:
        return program

    def finish_program(self, program: Path, v: str) -> None:
        super().finish_program(program, v)
        step("NSTool and the CLR settings")
        self.require_tools()
        # The CLR reads this beside the executable, not in PyInstaller's _internal directory.
        shutil.copy2(PACKAGING / f"{APP_NAME}.exe.config", program)
        tools_dir = program / "tools"
        tools_dir.mkdir(exist_ok=True)
        shutil.copy2(NSTOOL, tools_dir / "nstool.exe")
        shutil.copytree(NSTOOL.parent / "licenses", tools_dir / "nstool-licenses", dirs_exist_ok=True)

    def sign(self, program: Path) -> None:
        """Not code-signed (docs/releasing.md: SmartScreen): nothing to do."""

    def downloaded_copy(self, copy: Path) -> None:
        """Explorer marks DLLs extracted from a downloaded zip as Internet files: a locally working build can't
        silently ship a portable program whose .NET assemblies won't load."""
        for dll in (copy / "_internal").rglob("*.dll"):
            Path(f"{dll}:Zone.Identifier").write_text("[ZoneTransfer]\nZoneId=3\n", encoding="utf-8")

    def package(self, program: Path, v: str, args: argparse.Namespace) -> list[Path]:
        step("Release files")
        RELEASE.mkdir(exist_ok=True)
        portable = RELEASE / f"Divine-Pulse-{v}-windows-portable"
        out = [Path(shutil.make_archive(str(portable), "zip", program.parent, program.name))]
        if not args.no_installer and (setup := installer(v)):
            out.append(setup)
        return out

    def artifact_names(self, v: str, release: Path = RELEASE) -> list[str]:
        return [f"Divine-Pulse-{v}-windows-portable.zip", f"Divine-Pulse-{v}-setup.exe"]

    def missing_hint(self) -> str:
        return "; install Inno Setup 6 and try again"


class MacOS(Target):
    name, key, readme = "macOS", "macos", "readme-macos.txt"
    downloaded_label = "read-only, as App Translocation runs a downloaded app"

    def require_tools(self) -> None:
        missing = [tool for tool in ("clang", "codesign", "iconutil", "sips", "ditto") if not shutil.which(tool)]
        if missing:
            sys.exit(f"{', '.join(missing)} not found: the macOS build needs Xcode's command-line tools. "
                     "Run: xcode-select --install")

    def python_candidates(self) -> list[str]:
        """On PATH, or where Homebrew and python.org install one (not on PATH for every shell): macOS's own python3
        is 3.9."""
        folders = ["/opt/homebrew/bin", "/usr/local/bin", "/Library/Frameworks/Python.framework/Versions/Current/bin"]
        found = []
        for name in (f"python3.{minor}" for minor in range(20, 11, -1)):
            path = shutil.which(name) or next((f"{d}/{name}" for d in folders if os.access(f"{d}/{name}", os.X_OK)),
                                              None)
            if path:
                found.append(path)
        return found

    def program_path(self) -> Path:
        return BUILD / "dist" / f"{APP_NAME}.app"

    def executable(self, program: Path) -> Path:
        return program / "Contents" / "MacOS" / APP_NAME

    def notes_folder(self, program: Path) -> Path:
        return program / "Contents" / "Resources"

    def before_program(self) -> None:
        step("App icon")
        mac_icon()

    def finish_program(self, program: Path, v: str) -> None:
        """The notes and licenses in Resources, and the memory reader helper beside the program (where the app looks
        for a bundled one), compiled and signed with the debugger entitlement."""
        super().finish_program(program, v)
        step("Memory reader")
        build_helper(program / "Contents" / "MacOS" / helper_name())

    def sign(self, program: Path) -> None:
        """Each part signed in turn, the app last, then checked: the helper must keep its entitlement."""
        step("Signing (ad hoc)")
        helper = program / "Contents" / "MacOS" / helper_name()
        codesign(helper, MAC_HELPER / "entitlements.plist")
        codesign(program)
        run("codesign", "--verify", "--strict", program)
        entitlements = subprocess.run(["codesign", "-d", "--entitlements", "-", str(helper)], capture_output=True,
                                      text=True)
        if DEBUGGER_ENTITLEMENT not in entitlements.stdout + entitlements.stderr:
            sys.exit("The memory reader lost its debugger entitlement while signing the app.")

    def copy_program(self, program: Path, copy: Path) -> None:
        run("ditto", program, copy)  # keeps the bundle's links and signatures

    def downloaded_copy(self, copy: Path) -> None:
        """A downloaded app that's been allowed to open runs from a read-only copy at a random path (App
        Translocation): a build that writes into its own bundle, or needs its build folder, fails here. (Marking the
        copy quarantined instead would only bring up Gatekeeper's prompt: the app isn't notarized.)"""
        subprocess.run(["chmod", "-R", "a-w", str(copy)], check=True)

    def after_desktop_check(self, copy: Path) -> None:
        subprocess.run(["chmod", "-R", "u+w", str(copy)], check=False)

    def package(self, program: Path, v: str, args: argparse.Namespace) -> list[Path]:
        """release/Divine Pulse.app, and a zip of it to share (ditto keeps the bundle's links and signatures)."""
        step("Release files")
        RELEASE.mkdir(exist_ok=True)
        target = RELEASE / program.name
        shutil.rmtree(target, ignore_errors=True)
        run("ditto", program, target)
        for old in RELEASE.glob(f"Divine-Pulse-{v}-macos-*.zip"):  # this version's, another architecture's too
            old.unlink()
        archive = RELEASE / f"Divine-Pulse-{v}-macos-{platform.machine()}.zip"
        run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", target, archive)
        return [archive]

    def artifact_names(self, v: str, release: Path = RELEASE) -> list[str]:
        # Named by the build's own Python (build/venv), which needn't be this one's architecture: look for it.
        found = sorted(path.name for path in release.glob(f"Divine-Pulse-{v}-macos-*.zip"))
        if len(found) > 1:
            raise RuntimeError(f"more than one macOS zip for {v} in release/: {', '.join(found)}")
        return found or [f"Divine-Pulse-{v}-macos-{platform.machine()}.zip"]

    def done(self) -> list[str]:
        return [f"  {(RELEASE / f'{APP_NAME}.app').relative_to(ROOT)}  (open it, or drag it to Applications)"]


class Linux(Target):
    """Not built yet. To add it: the program folder (program_path, executable, notes_folder; the spec's Linux part),
    downloaded_copy for the desktop check, package (for example a tar.gz or AppImage) with artifact_names, and the
    matching parts of tools/smoke_app.py, the setup and launch scripts, and CI."""

    name, key, readme = "Linux", "linux", "readme-linux.txt"

    def require_tools(self) -> None:
        sys.exit("Building Divine Pulse for Linux is not supported yet: see the Linux target in tools/build.py.")

    def artifact_names(self, v: str, release: Path = RELEASE) -> list[str]:
        raise RuntimeError("release files for Linux are not supported yet")


TARGETS: dict[str, type[Target]] = {"win32": Windows, "darwin": MacOS, "linux": Linux}


def target(system: str | None = None) -> Target:
    """This computer's Target (or `system`'s, a sys.platform value)."""
    system = system or sys.platform
    if system not in TARGETS:
        sys.exit(f"Building Divine Pulse on {system} is not supported yet: see the targets in tools/build.py.")
    return TARGETS[system]()


# Build environment


def in_build_env() -> bool:
    return Path(sys.prefix).resolve() == VENV.resolve()


def venv_version() -> str | None:
    """The Python version build/venv was made with (from its pyvenv.cfg), or None if there's no venv."""
    try:
        found = re.search(r"^version(?:_info)?\s*=\s*(\d+\.\d+)", (VENV / "pyvenv.cfg").read_text("utf-8"), re.M)
    except OSError:
        return None
    return found.group(1) if found else None


def python_version(exe: str) -> tuple[int, int] | None:
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    found = re.search(r"Python 3\.(\d+)\.", out.stdout + out.stderr)
    return (3, int(found.group(1))) if found else None


def newer_python(build: Target | None = None) -> str | None:
    """A Python 3.12+ to run this script (or tools/release.py) with, when the running one is older."""
    for exe in (build or target()).python_candidates():
        if (found := python_version(exe)) and found >= (3, 12):
            return exe
    return None


def make_build_env(build: Target, args: argparse.Namespace) -> None:
    """Create build/venv with the pinned requirements and run this script again inside it."""
    this = f"{sys.version_info.major}.{sys.version_info.minor}"
    if sys.version_info < (3, 12):  # noqa: UP036 (a guard for whoever runs it with an old Python)
        if newer := newer_python(build):
            print(f"Python {sys.version.split()[0]} is too old to build with: using {newer}", flush=True)
            os.execv(newer, [newer, __file__, *sys.argv[1:]])
        sys.exit(f"Python 3.12 or newer is needed (this is {sys.version.split()[0]}).")
    step(f"Build environment (Python {this})")
    py = build.venv_python()
    if not py.exists() or venv_version() != this:
        run(sys.executable, "-m", "venv", "--clear", VENV)  # new, or made with another Python version
    try:
        run(py, "-m", "pip", "install", "--upgrade", "pip", "--quiet")
        run(py, "-m", "pip", "install", "-r", BACKEND / "requirements-build.txt", "--quiet")
        if not args.skip_tests:
            run(py, "-m", "pip", "install", "-r", BACKEND / "requirements-dev.txt", "--quiet")
    except subprocess.CalledProcessError:
        sys.exit(f"Installing the pinned requirements failed. If a package doesn't support Python {this} yet, build "
                 "with an older Python (py -3.13 tools/build.py, python3.13 tools/build.py) or update the pin in "
                 "backend/requirements*.txt.")
    raise SystemExit(subprocess.call([str(py), __file__, *sys.argv[1:]]))


# Shared steps


def web_ui() -> None:
    step("Web UI")
    run("npm", "ci" if (FRONTEND / "package-lock.json").exists() else "install", "--no-audit", "--no-fund", cwd=FRONTEND)
    run("npm", "run", "build", cwd=FRONTEND)


def tests() -> None:
    step("Tests")
    run(sys.executable, "-m", "pytest", "-q", cwd=BACKEND)


def pyinstaller(build: Target) -> Path:
    """Run PyInstaller on packaging/divine_pulse.spec; returns what it made, with no development packages in it."""
    step("Program (PyInstaller)")
    run(
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
        "--distpath", BUILD / "dist", "--workpath", BUILD / "work", PACKAGING / "divine_pulse.spec",
    )
    made = build.program_path()
    if not made.exists():
        sys.exit(f"PyInstaller didn't produce {made}")
    leaked = dev_modules((BUILD / "work" / "divine_pulse" / "PYZ-00.toc").read_text("utf-8", "replace"))
    if leaked:
        sys.exit(f"Development packages got into the program: {', '.join(leaked)}. Exclude them in {PACKAGING / 'divine_pulse.spec'}.")
    return made


def program(build: Target, v: str) -> Path:
    """The program, complete, signed and checked: everything but the release files."""
    build.before_program()
    made = pyinstaller(build)
    build.finish_program(made, v)
    build.sign(made)
    build.desktop_check(made)
    return made


def dev_modules(toc: str) -> list[str]:
    """Modules from packages only development needs, in the text of PyInstaller's module list."""
    return sorted({name for name in re.findall(r"\('([\w.]+)',", toc) if name.split(".")[0] in DEV_PACKAGES})


def readme(v: str, name: str) -> str:
    return (PACKAGING / name).read_text("utf-8").replace("{version}", v)


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
    target_folder = folder / LICENSE_FOLDER
    shutil.rmtree(target_folder, ignore_errors=True)
    shutil.copytree(VENDORED_LICENSES, target_folder)
    vendored = {path.stem for path in VENDORED_LICENSES.iterdir()}
    packages = runtime_distributions()
    packages.update({name: metadata.distribution(name) for name in BUILD_PACKAGES})
    missing = []
    for name, dist in sorted(packages.items()):
        files = license_files(dist)
        if not files and name not in vendored:
            missing.append(name)
        for source, inside in files:
            copied = target_folder / name / inside
            copied.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, copied)
    manifest = json.loads((FRONTEND / "package.json").read_text("utf-8"))
    for name in [*manifest["dependencies"], *FRONTEND_PACKAGES]:
        source = FRONTEND / "node_modules" / name / "LICENSE"
        if not source.is_file():
            missing.append(name)
            continue
        copied = target_folder / "frontend" / name / "LICENSE"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, copied)
    if missing:
        sys.exit(f"No license text found for: {', '.join(missing)}. Add one to {VENDORED_LICENSES}.")


def notes(folder: Path, v: str, readme_name: str) -> None:
    """The read-me, the program's license, the third-party notices and license texts, in the program."""
    (folder / "Read me.txt").write_text(readme(v, readme_name), "utf-8")
    shutil.copy2(ROOT / "LICENSE", folder / "LICENSE.txt")
    shutil.copy2(ROOT / "docs" / "third-party-notices.md", folder / "Third-party notices.txt")
    shutil.copy2(FRONTEND / "src" / "reference" / "wiki" / "LICENSE-GFDL-1.3.txt", folder / "GFDL-1.3.txt")
    third_party_licenses(folder)


def checksums(files: list[Path]) -> None:
    step("Checksums")
    lines = [f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}" for f in files]
    (RELEASE / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", "ascii")


# Windows


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


# macOS


def mac_icon() -> Path:
    """build/Divine Pulse.icns, from the rounded app icon (sips and iconutil come with macOS)."""
    iconset = BUILD / "Divine Pulse.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
            px = str(size * scale)
            subprocess.run(["sips", "-z", px, px, str(MAC_ICON), "--out", str(iconset / name)], check=True,
                           capture_output=True)
    icns = BUILD / "Divine Pulse.icns"
    run("iconutil", "-c", "icns", iconset, "-o", icns)
    return icns


def _memory_macos():
    """The app's macOS memory module, which names, compiles and signs the helper (the one place that knows how)."""
    sys.path.insert(0, str(BACKEND))
    from app.system import memory_macos

    return memory_macos


def helper_name() -> str:
    return _memory_macos().HELPER_NAME


def build_helper(path: Path) -> None:
    _memory_macos().build(path)  # compiled and signed with the debugger entitlement


def codesign(path: Path, entitlements: Path | None = None) -> None:
    """Sign ad hoc (no developer certificate needed). Not --deep: that would strip the helper's entitlements."""
    extra = ["--entitlements", str(entitlements)] if entitlements else []
    run("codesign", "--force", "--sign", "-", "--timestamp=none", *extra, path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Divine Pulse for this system (Windows or macOS) into release/.")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--no-installer", action="store_true", help="Windows: only the portable zip")
    parser.add_argument("--current-env", action="store_true", help="build with this Python instead of build/venv")
    args = parser.parse_args()
    build = target()
    build.require_tools()
    if not args.current_env and not in_build_env():
        make_build_env(build, args)
    v = version()
    print(f"Divine Pulse {v} for {build.name}")
    web_ui()  # before the tests: the API tests serve frontend/dist
    if not args.skip_tests:
        tests()
    files = build.package(program(build, v), v, args)
    checksums(files)
    print("\nDone:")
    for line in build.done():
        print(line)
    for f in files:
        print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size / 2**20:.1f} MB)")


if __name__ == "__main__":
    main()
