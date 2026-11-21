"""tools/smoke_app.py's checks, against a stand-in server and log, and CI's use of it."""

from __future__ import annotations

import importlib.util
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("smoke_app", ROOT / "tools" / "smoke_app.py")
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class Running:
    """A process that hasn't exited."""

    returncode = None

    def poll(self) -> None:
        return None


class Exited:
    returncode = 3

    def poll(self) -> int:
        return 3


@pytest.fixture
def server(tmp_path: Path):
    """A stand-in for the app's server: `routes` maps a path to (content type, body)."""
    routes: dict[str, tuple[str, bytes]] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path not in routes:
                self.send_error(404)
                return
            kind, body = routes[self.path]
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}", routes
    finally:
        httpd.shutdown()
        httpd.server_close()


def _app_routes(routes: dict, data: Path, picture: tuple[str, bytes]) -> None:
    routes["/api/health"] = ("application/json", json.dumps({"ok": True, "app": "divine-pulse", "version": "1.2.3"}).encode())
    routes["/api/about"] = ("application/json", json.dumps({"version": "1.2.3", "data_dir": str(data), "desktop": True,
                                                            "platform": smoke.PLATFORM}).encode())
    routes["/"] = ("text/html; charset=utf-8", b'<!doctype html><div id="root"></div>')
    routes[smoke.PICTURE] = picture


def test_check_server_accepts_the_app(server, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    base, routes = server
    _app_routes(routes, tmp_path, ("image/png", smoke.PNG_SIGNATURE + b"rest"))
    smoke.check_server(base, "1.2.3", tmp_path)


def test_check_server_rejects_the_page_served_for_a_missing_picture(server, tmp_path: Path) -> None:
    """The fallback route serves index.html with 200 for any unknown path, as it did for the brand pictures when the
    app's frontend folder was reached through a symlink."""
    base, routes = server
    _app_routes(routes, tmp_path, ("text/html; charset=utf-8", b"<!doctype html>"))
    with pytest.raises(smoke.SmokeFailure, match="not a PNG"):
        smoke.check_server(base, "1.2.3", tmp_path)


@pytest.mark.parametrize(("field", "value", "message"), [
    ("platform", "linux", "platform"),
    ("data_dir", "/somewhere/else", "data folder"),
])
def test_check_server_rejects_another_platform_or_data_folder(server, tmp_path: Path, field, value, message) -> None:
    base, routes = server
    _app_routes(routes, tmp_path, ("image/png", smoke.PNG_SIGNATURE))
    about = json.loads(routes["/api/about"][1])
    routes["/api/about"] = ("application/json", json.dumps({**about, field: value}).encode())
    with pytest.raises(smoke.SmokeFailure, match=message):
        smoke.check_server(base, "1.2.3", tmp_path)


def test_check_server_rejects_another_version(server, tmp_path: Path) -> None:
    base, routes = server
    _app_routes(routes, tmp_path, ("image/png", smoke.PNG_SIGNATURE))
    with pytest.raises(smoke.SmokeFailure, match="version"):
        smoke.check_server(base, "1.2.4", tmp_path)


ACCESS = '2026-11-21 15:17:29,439 INFO uvicorn.access: 127.0.0.1:63291 - "{}" 200\n'


def test_the_window_counts_once_its_page_has_called_the_api(tmp_path: Path) -> None:
    lines = ["GET /api/health HTTP/1.1", "GET /?launch=1763 HTTP/1.1", "GET /assets/index-abc.js HTTP/1.1",
             "GET /api/settings HTTP/1.1"]
    (tmp_path / "tracker.log").write_text("".join(ACCESS.format(line) for line in lines), "utf-8")
    smoke.wait_for_window(Running(), tmp_path, timeout=1)


@pytest.mark.parametrize("lines", [
    ["GET /api/health HTTP/1.1", "GET /api/about HTTP/1.1"],  # only the smoke test's own requests
    ["GET /?launch=1763 HTTP/1.1", "GET /assets/index-abc.js HTTP/1.1"],  # the page, but its script never ran
])
def test_the_window_must_load_the_page_and_run_it(tmp_path: Path, lines: list[str]) -> None:
    (tmp_path / "tracker.log").write_text("".join(ACCESS.format(line) for line in lines), "utf-8")
    with pytest.raises(smoke.SmokeFailure, match="didn't load the page"):
        smoke.wait_for_window(Running(), tmp_path, timeout=0.3)


def test_an_app_that_exits_early_fails_at_once(tmp_path: Path) -> None:
    with pytest.raises(smoke.SmokeFailure, match="exited with code 3"):
        smoke.wait_for_window(Exited(), tmp_path, timeout=30)
    with pytest.raises(smoke.SmokeFailure, match="exited with code 3"):
        smoke.wait_for_server(Exited(), tmp_path, 1, timeout=30)


def test_the_port_is_the_one_the_app_saved(tmp_path: Path) -> None:
    """The app moves to a free port when its own is taken, and saves it."""
    assert smoke.saved_port(tmp_path, 8799) == 8799
    (tmp_path / "settings.json").write_text(json.dumps({"port": 50123}), "utf-8")
    assert smoke.saved_port(tmp_path, 8799) == 50123


def test_release_zip_is_this_platforms(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(smoke, "RELEASE", tmp_path)
    for name in ("Divine-Pulse-1.2.3-macos-arm64.zip", "Divine-Pulse-1.2.3-windows-portable.zip",
                 "Divine-Pulse-1.2.2-macos-arm64.zip", "Divine-Pulse-1.2.2-windows-portable.zip"):
        (tmp_path / name).write_bytes(b"")
    monkeypatch.setattr(smoke, "MACOS", True)
    assert smoke.release_zip("1.2.3").name == "Divine-Pulse-1.2.3-macos-arm64.zip"
    monkeypatch.setattr(smoke, "MACOS", False)
    assert smoke.release_zip("1.2.3").name == "Divine-Pulse-1.2.3-windows-portable.zip"
    with pytest.raises(smoke.SmokeFailure, match="run tools/build.py"):
        smoke.release_zip("1.2.4")


def _job(text: str, name: str) -> str:
    found = re.search(rf"^  {name}:\n(.*?)(?=^  \S|\Z)", text, re.M | re.S)
    assert found, name
    return found.group(1)


def test_ci_smoke_tests_each_release_build() -> None:
    text = WORKFLOW.read_text("utf-8")
    job = _job(text, "release-build")
    assert "os: windows-latest" in job and "os: macos-latest" in job
    assert job.index("python tools/build.py --skip-tests") < job.index("python tools/smoke_app.py") < job.index(
        "actions/upload-artifact")


def test_ci_checks_the_frontend_and_backend_on_both_systems() -> None:
    text = WORKFLOW.read_text("utf-8")
    job = _job(text, "checks")
    assert "runs-on: ${{ matrix.os }}" in job
    assert job.count("os: windows-latest") == 2 and job.count("os: macos-latest") == 2
    for command in ("npm test", "npx tsc --noEmit", "npm run build", "python -m pytest -q"):
        assert f"run: {command}" in job, command
    # The macOS memory reader's tests need developer tools allowed, before they run.
    assert job.index("sudo DevToolsSecurity -enable") < job.index("python -m pytest -q")


def test_ci_actions_are_pinned_to_commits() -> None:
    uses = [line.strip() for line in WORKFLOW.read_text("utf-8").splitlines() if "uses:" in line]
    assert uses
    for line in uses:
        assert re.fullmatch(r"- uses: [\w.-]+/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+)*", line), line
