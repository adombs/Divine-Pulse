# PyInstaller recipe for Divine Pulse. Build with tools/build.py, which builds the web UI first and runs its Target's
# before_program step (macOS: the app icon), then adds what goes beside the program (Target.finish_program: the
# notes and licenses; Windows: NSTool and the CLR settings; macOS: the memory reader helper) and signs it.
# One-folder build: starts faster than one-file and antivirus tools flag it less often.
#   Windows: build/dist/Divine Pulse/Divine Pulse.exe
#   macOS:   build/dist/Divine Pulse.app
#   Linux:   build/dist/Divine Pulse/Divine Pulse
import re
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

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
COPYRIGHT = "GPL-3.0. Fan-made; not affiliated with Nintendo, Intelligent Systems or Koei Tecmo."

# Shared: the same program on every system.

datas = [
    (str(DIST_UI), "frontend_dist"),
    (str(DATA), "app/data"),
    (str(ROOT / "packaging" / "nsp-unpacker-LICENSE.txt"), "app/data"),
]
hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("uvicorn"),  # picks its loop / protocol modules at runtime
]
excludes = ["tkinter", "pytest", "_pytest", "matplotlib", "IPython"]

# Per system: the icon, the version information the system shows, and how the program folder is wrapped.


def windows_version_info():
    """The Details tab of Divine Pulse.exe's properties."""
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
    )

    nums = tuple(int(n) for n in re.findall(r"\d+", VERSION)[:3]) + (0,)
    return VSVersionInfo(
        ffi=FixedFileInfo(filevers=nums, prodvers=nums),
        kids=[
            StringFileInfo([StringTable("040904B0", [
                StringStruct("FileDescription", NAME),
                StringStruct("ProductName", NAME),
                StringStruct("FileVersion", VERSION),
                StringStruct("ProductVersion", VERSION),
                StringStruct("OriginalFilename", f"{NAME}.exe"),
                StringStruct("LegalCopyright", COPYRIGHT),
            ])]),
            VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
        ],
    )


MACOS_INFO_PLIST = {  # the app's Info.plist (Finder's Get Info)
    "CFBundleDisplayName": NAME,
    "CFBundleShortVersionString": VERSION,
    "CFBundleVersion": VERSION,
    "LSApplicationCategoryType": "public.app-category.games",
    "LSMinimumSystemVersion": "12.0",
    "NSHighResolutionCapable": True,
    "NSHumanReadableCopyright": COPYRIGHT,
}

if sys.platform == "win32":
    ICON, VERSION_INFO = str(DATA / "icon.ico"), windows_version_info()
elif sys.platform == "darwin":
    ICON, VERSION_INFO = str(ROOT / "build" / "Divine Pulse.icns"), None  # made by tools/build.py
elif sys.platform == "linux":
    ICON, VERSION_INFO = None, None  # Linux programs carry neither: the .desktop file (linux/install.sh) has the icon
    # The window: pywebview picks its renderer, and QtPy its Qt, at runtime.
    hiddenimports += [
        "webview.platforms.qt", "qtpy", "qtpy.QtWebChannel", "qtpy.QtWebEngineCore", "qtpy.QtWebEngineWidgets",
        "PyQt6.QtNetwork", "PyQt6.QtPrintSupport", "PyQt6.QtWebChannel", "PyQt6.QtWebEngineCore",
        "PyQt6.QtWebEngineWidgets",
    ]
    excludes += ["gi", "PyQt5", "PySide2", "PySide6"]
else:
    raise SystemExit(f"Packaging Divine Pulse for {sys.platform} is not supported yet (see tools/build.py).")

# Shared: analysis, the executable and the program folder.

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(BACKEND)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=excludes,
    noarchive=False,
)
# Linux: libraries that belong to the system it runs on, which every desktop has, not to the one it's built on. The
# graphics driver's own (libgbm), what the system's drivers load with it (a newer Mesa needs a newer libstdc++), and
# those that read the system's own settings and plugins (sound, fonts). And Qt's GTK theme, which would bring an old GTK
# to load the system's GTK modules into: file dialogs come from the desktop's portal without it.
SYSTEM_LIBRARIES = re.compile(
    r"lib(gbm|drm|stdc\+\+|gcc_s|X11|X11-xcb|asound|fontconfig|freetype|expat|z|qgtk3|gtk-3|gdk-3|gdk_pixbuf-2\.0|atk-1\.0"
    r"|atk-bridge-2\.0|atspi|cairo-gobject|epoxy)\.so(\.\d+)*$"
)
if sys.platform == "linux":
    for found in (a.binaries, a.datas):
        found[:] = [entry for entry in found if not SYSTEM_LIBRARIES.match(Path(entry[0]).name)]
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=NAME,
    icon=ICON,
    version=VERSION_INFO,
    console=False,  # a window app: logs go to tracker.log in the data folder
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name=NAME, upx=False)

# macOS: the program folder wrapped as Divine Pulse.app. Windows and Linux ship the folder itself.
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{NAME}.app",
        icon=ICON,
        bundle_identifier="io.github.adombs.divine-pulse",
        version=VERSION,
        info_plist=MACOS_INFO_PLIST,
    )
