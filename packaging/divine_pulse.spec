# PyInstaller recipe for Divine Pulse, for Windows and macOS. Build with tools/build.py (which builds the web UI
# first, and on macOS the app icon and the memory reader helper).
# One-folder build: starts faster than one-file and antivirus tools flag it less often.
#   Windows: build/dist/Divine Pulse/Divine Pulse.exe
#   macOS:   build/dist/Divine Pulse.app
import re
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

MACOS = sys.platform == "darwin"
if not MACOS:
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
    )

ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"
DIST_UI = ROOT / "frontend" / "dist"
DATA = BACKEND / "app" / "data"
# collect_submodules("app") imports the app to list its modules, including the importer's extractor modules, which
# are imported by name at runtime: it must be importable from here, whatever folder the build runs in.
sys.path.insert(0, str(BACKEND))
if not (DIST_UI / "index.html").exists():
    raise SystemExit("frontend/dist is missing: run `npm run build` in frontend/ first (tools/build.py does).")

VERSION = re.search(r'__version__ = "([^"]+)"', (BACKEND / "app" / "__init__.py").read_text()).group(1)
NAME = "Divine Pulse"

datas = [
    (str(DIST_UI), "frontend_dist"),
    (str(DATA), "app/data"),
    (str(ROOT / "packaging" / "nsp-unpacker-LICENSE.txt"), "app/data"),
]
hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("uvicorn"),  # picks its loop / protocol modules at runtime
]

nums = tuple(int(n) for n in re.findall(r"\d+", VERSION)[:3]) + (0,)
version_info = None if MACOS else VSVersionInfo(
    ffi=FixedFileInfo(filevers=nums, prodvers=nums),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("FileDescription", "Divine Pulse"),
            StringStruct("ProductName", "Divine Pulse"),
            StringStruct("FileVersion", VERSION),
            StringStruct("ProductVersion", VERSION),
            StringStruct("OriginalFilename", "Divine Pulse.exe"),
        ])]),
        VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
    ],
)

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(BACKEND)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "_pytest", "matplotlib", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=NAME,
    icon=str(ROOT / "build" / "Divine Pulse.icns") if MACOS else str(DATA / "icon.ico"),
    version=version_info,
    console=False,  # a window app: logs go to tracker.log in the data folder
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name=NAME, upx=False)
if MACOS:
    app = BUNDLE(
        coll,
        name=f"{NAME}.app",
        icon=str(ROOT / "build" / "Divine Pulse.icns"),
        bundle_identifier="io.github.adombs.divine-pulse",
        version=VERSION,
        info_plist={
            "CFBundleDisplayName": NAME,
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSApplicationCategoryType": "public.app-category.games",
            "LSMinimumSystemVersion": "12.0",
            "NSHighResolutionCapable": True,
            "NSHumanReadableCopyright": "GPL-3.0. Fan-made; not affiliated with Nintendo, Intelligent Systems or Koei Tecmo.",
        },
    )
