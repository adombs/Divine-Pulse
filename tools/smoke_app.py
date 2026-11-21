"""Smoke-test a built Divine Pulse release the way a player would get it: unzip it, start it, use it, quit it.

    python tools/smoke_app.py [--zip release/Divine-Pulse-1.5.3-macos-arm64.zip] [--port 8799] [--keep]

Without --zip it takes this version's release zip from release/ (tools/build.py's output). It unzips it into a
temporary folder (macOS: with ditto, as Finder and Archive Utility do; Windows: with Internet-zone markers on the
DLLs, as Explorer leaves them after a download), then:

- macOS: checks the app's signature (codesign --verify --deep --strict) and that the memory reader helper beside the
  program still has its debugger entitlement;
- starts the app with a new, empty data folder (DIVINE_PULSE_DATA_DIR) set to use --port, which opens its window;
- checks /api/health, /api/about (this platform, that data folder), the page (GET /) and a picture the page loads
  (/brand/home-lockup-cream.png, which must be a PNG, not the page served in its place);
- waits until the window has loaded the page and its script has called the API (the server's access log, in the
  data folder's tracker.log), so the window really opened;
- quits it with POST /api/quit, as the uninstaller does, and expects it to exit with code 0.

Standard library only, so it runs with any Python 3.9+ (CI's, or macOS's own python3). Exits 1 on any failure,
with the app's output and log.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "release"
APP_NAME = "Divine Pulse"
MACOS = sys.platform == "darwin"
PLATFORM = "macos" if MACOS else "windows"
HELPER = "dp-memreader"  # app.system.memory_macos.HELPER_NAME
DEBUGGER_ENTITLEMENT = "com.apple.security.cs.debugger"
PICTURE = "/brand/home-lockup-cream.png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class SmokeFailure(Exception):
    pass


def step(text: str) -> None:
    print(f"== {text}", flush=True)


def ok(text: str) -> None:
    print(f"   ok: {text}", flush=True)


def version() -> str:
    found = re.search(r'__version__ = "([^"]+)"', (ROOT / "backend" / "app" / "__init__.py").read_text("utf-8"))
    if not found:
        raise SmokeFailure("couldn't read __version__ from backend/app/__init__.py")
    return found.group(1)


def release_zip(v: str) -> Path:
    """This version's release zip for this platform, in release/."""
    pattern = f"Divine-Pulse-{v}-macos-*.zip" if MACOS else f"Divine-Pulse-{v}-windows-portable.zip"
    found = sorted(RELEASE.glob(pattern))
    if len(found) != 1:
        raise SmokeFailure(f"expected one {pattern} in {RELEASE}, found {len(found)}; run tools/build.py first")
    return found[0]


def unzip(archive: Path, into: Path) -> Path:
    """Extract like a player would; returns the program to start."""
    if MACOS:
        subprocess.run(["ditto", "-x", "-k", str(archive), str(into)], check=True)
        app = into / f"{APP_NAME}.app"
        if not app.is_dir():
            raise SmokeFailure(f"{archive.name} has no {APP_NAME}.app at its top level")
        return app
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(into)
    folder = into / APP_NAME
    for dll in folder.rglob("*.dll"):  # what Explorer marks on files from a downloaded zip
        Path(f"{dll}:Zone.Identifier").write_text("[ZoneTransfer]\nZoneId=3\n", encoding="utf-8")
    if not (folder / f"{APP_NAME}.exe").is_file():
        raise SmokeFailure(f"{archive.name} has no {APP_NAME}/{APP_NAME}.exe")
    return folder


def executable(program: Path) -> Path:
    return program / "Contents" / "MacOS" / APP_NAME if MACOS else program / f"{APP_NAME}.exe"


def check_signature(app: Path) -> None:
    step("Signature (codesign)")
    verify = subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)],
                            capture_output=True, text=True)
    if verify.returncode:
        lines = (verify.stdout + verify.stderr).splitlines()
        reasons = [line for line in lines if not line.startswith(("--prepared:", "--validated:"))]
        raise SmokeFailure("codesign --verify --deep --strict failed:\n" + "\n".join(reasons[-20:]))
    ok("codesign --verify --deep --strict")
    helper = app / "Contents" / "MacOS" / HELPER
    if not helper.is_file():
        raise SmokeFailure(f"the memory reader helper is missing: {helper.relative_to(app.parent)}")
    shown = subprocess.run(["codesign", "-d", "--entitlements", "-", str(helper)], capture_output=True, text=True)
    if shown.returncode or DEBUGGER_ENTITLEMENT not in shown.stdout + shown.stderr:
        raise SmokeFailure(f"{HELPER} lacks the {DEBUGGER_ENTITLEMENT} entitlement:\n{shown.stdout}{shown.stderr}")
    ok(f"{HELPER} has {DEBUGGER_ENTITLEMENT}")


def request(url: str, method: str = "GET", timeout: float = 5) -> tuple[int, str, bytes]:
    """(status, content type, body); raises URLError when nothing answers."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=timeout) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read()


def get_json(url: str) -> dict:
    status, _, body = request(url)
    if status != 200:
        raise SmokeFailure(f"GET {url} answered {status}: {body[:200]!r}")
    return json.loads(body)


def port_in_use(port: int) -> bool:
    try:
        request(f"http://127.0.0.1:{port}/", timeout=1)
        return True
    except (urllib.error.URLError, OSError):
        return False


def saved_port(data: Path, default: int) -> int:
    """The app moves to another port when its own is taken, and saves that one."""
    try:
        return int(json.loads((data / "settings.json").read_text("utf-8"))["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return default


def wait_for_server(process: subprocess.Popen, data: Path, port: int, timeout: float) -> str:
    """The base URL once /api/health answers."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SmokeFailure(f"the app exited with code {process.returncode} before its server answered")
        base = f"http://127.0.0.1:{saved_port(data, port)}"
        try:
            request(f"{base}/api/health", timeout=1)
            return base
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    raise SmokeFailure(f"the app's server didn't answer within {timeout:.0f} s")


def check_server(base: str, v: str, data: Path) -> None:
    step(f"Server ({base})")
    health = get_json(f"{base}/api/health")
    if health.get("app") != "divine-pulse":
        raise SmokeFailure(f"/api/health isn't Divine Pulse's: {health}")
    if health.get("version") != v:
        raise SmokeFailure(f"/api/health reports version {health.get('version')}, expected {v}")
    ok(f"/api/health {health}")
    about = get_json(f"{base}/api/about")
    if about.get("platform") != PLATFORM:
        raise SmokeFailure(f"/api/about reports platform {about.get('platform')!r}, expected {PLATFORM!r}")
    if Path(about.get("data_dir", "")).resolve() != data.resolve():
        raise SmokeFailure(f"/api/about reports data folder {about.get('data_dir')}, expected {data}")
    ok(f"/api/about platform={about['platform']} desktop={about.get('desktop')} data_dir={about['data_dir']}")
    status, kind, body = request(f"{base}/")
    if status != 200 or not kind.startswith("text/html") or b'<div id="root"' not in body:
        raise SmokeFailure(f"GET / answered {status} {kind} without the page: {body[:200]!r}")
    ok(f"GET / {status} {kind}, {len(body)} bytes")
    status, kind, body = request(f"{base}{PICTURE}")
    if status != 200 or kind != "image/png" or not body.startswith(PNG_SIGNATURE):
        raise SmokeFailure(f"GET {PICTURE} answered {status} {kind}, not a PNG: {body[:60]!r}")
    ok(f"GET {PICTURE} {status} {kind}, {len(body)} bytes")


def wait_for_window(process: subprocess.Popen, data: Path, timeout: float) -> None:
    """The window's page loads (GET /?launch=..., desktop.DesktopApp.run) and its script calls the API, as the server's
    access log in tracker.log shows. Without this the app could quit before its window ever showed."""
    step("Window (page and its API calls, in tracker.log)")
    log = data / "tracker.log"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SmokeFailure(f"the app exited with code {process.returncode} before its window loaded the page")
        text = log.read_text("utf-8", "replace") if log.is_file() else ""
        page = text.find('"GET /?launch=')
        if page >= 0:
            after = text[page:].splitlines()[1:]
            script = [line for line in after if '"GET /assets/' in line]
            calls = [line for line in after if re.search(r'"(GET|POST|PUT) /api/', line)]
            if script and calls:
                ok(f"page loaded ({len(script)} script/style files), then {len(calls)} API calls, e.g. "
                   + calls[0].split('"')[1])
                return
        time.sleep(0.25)
    raise SmokeFailure(f"the window didn't load the page and call the API within {timeout:.0f} s")


def quit_app(process: subprocess.Popen, base: str, timeout: float) -> None:
    step("Quit (POST /api/quit)")
    # The quit route exists once the window is being made, a moment after the server starts.
    deadline = time.monotonic() + 15
    while True:
        status, _, body = request(f"{base}/api/quit", method="POST")
        if status == 200:
            break
        if status != 404 or time.monotonic() > deadline or process.poll() is not None:
            raise SmokeFailure(f"POST /api/quit answered {status}: {body[:200]!r}")
        time.sleep(0.5)
    ok(f"POST /api/quit {json.loads(body)}")
    started = time.monotonic()
    try:
        code = process.wait(timeout)
    except subprocess.TimeoutExpired:
        raise SmokeFailure(f"the app was still running {timeout:.0f} s after /api/quit") from None
    if code != 0:
        raise SmokeFailure(f"the app exited with code {code} after /api/quit")
    ok(f"exited with code 0 after {time.monotonic() - started:.1f} s")


def show_output(output: Path, data: Path) -> None:
    for path in (output, data / "tracker.log"):
        if path.is_file():
            text = path.read_text("utf-8", "replace").strip()
            print(f"--- {path.name} (last 60 lines) ---\n" + "\n".join(text.splitlines()[-60:]), flush=True)


def smoke(archive: Path, port: int, start_timeout: float, window_timeout: float, quit_timeout: float,
          keep: bool) -> None:
    v = version()
    scratch = Path(tempfile.mkdtemp(prefix="divine-pulse-smoke-"))
    process: subprocess.Popen | None = None
    data = scratch / "data"
    output = scratch / "app-output.txt"
    try:
        step(f"Unzip {archive.name}")
        program = unzip(archive, scratch / "unzipped")
        ok(str(program))
        if MACOS:
            check_signature(program)
        if port_in_use(port):
            raise SmokeFailure(f"port {port} is already in use; pick a free one with --port")
        data.mkdir()
        (data / "settings.json").write_text(json.dumps({"port": port}), "utf-8")
        step(f"Start ({executable(program).name}, data folder {data})")
        env = {**os.environ, "DIVINE_PULSE_DATA_DIR": str(data)}
        started = time.monotonic()
        with output.open("wb") as sink:
            process = subprocess.Popen([str(executable(program))], env=env, stdout=sink, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL)
        base = wait_for_server(process, data, port, start_timeout)
        ok(f"server answered after {time.monotonic() - started:.1f} s (pid {process.pid})")
        check_server(base, v, data)
        wait_for_window(process, data, window_timeout)
        quit_app(process, base, quit_timeout)
        process = None
    except BaseException:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(10)
        show_output(output, data)
        raise
    finally:
        if keep:
            print(f"Kept {scratch}")
        else:
            shutil.rmtree(scratch, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test a built Divine Pulse release zip.")
    parser.add_argument("--zip", type=Path, help="the release zip (default: this version's, in release/)")
    parser.add_argument("--port", type=int, default=8799, help="the port to give the app (default 8799)")
    parser.add_argument("--start-timeout", type=float, default=90, help="seconds to wait for the server")
    parser.add_argument("--window-timeout", type=float, default=60, help="seconds to wait for the window's page")
    parser.add_argument("--quit-timeout", type=float, default=20, help="seconds to wait for the app to exit")
    parser.add_argument("--keep", action="store_true", help="keep the unzipped app and its data folder")
    args = parser.parse_args()
    if sys.platform not in {"darwin", "win32"}:
        sys.exit("smoke_app: the release runs on Windows or macOS")
    try:
        archive = (args.zip or release_zip(version())).resolve()
        smoke(archive, args.port, args.start_timeout, args.window_timeout, args.quit_timeout, args.keep)
    except (SmokeFailure, subprocess.CalledProcessError) as error:
        sys.exit(f"smoke_app: FAILED: {error}")
    print(f"smoke_app: {archive.name} OK")


if __name__ == "__main__":
    main()
