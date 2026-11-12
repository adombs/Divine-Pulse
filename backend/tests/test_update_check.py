import json
import urllib.request

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.domain.updates import LATEST_RELEASE_URL, is_newer, parse_version, release_url
from app.infrastructure.settings import SettingsStore
from app.infrastructure.update_check import LATEST_RELEASE_API, UpdateCheck, fetch_latest_release
from app.main import create_app


class Events:
    def __init__(self):
        self.items = []

    def publish(self, event, data=None):
        self.items.append((event, data))


def make(tmp_path, fetcher, enabled=True):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(check_updates=enabled)
    events = Events()
    calls = []

    def fetch(version):
        calls.append(version)
        return fetcher(version)

    check = UpdateCheck("1.4.3", settings, events, fetcher=fetch, spawn=lambda work: work())
    return check, settings, events, calls


def release(tag="v1.4.4", url="https://github.com/adombs/Divine-Pulse/releases/tag/v1.4.4"):
    return lambda _version: {"tag_name": tag, "html_url": url}


def test_version_parsing_and_comparison():
    assert parse_version("v1.4.4") == (1, 4, 4)
    assert parse_version("1.4.4") == (1, 4, 4)
    for bad in ("1.4", "v1.4.4-beta", "latest", "", None, 5, "1.4.x"):
        assert parse_version(bad) is None
    assert is_newer("v1.4.10", "1.4.9")
    assert is_newer("2.0.0", "1.99.99")
    assert not is_newer("1.4.3", "1.4.3")
    assert not is_newer("1.4.2", "1.4.3")
    assert not is_newer("junk", "1.4.3")


def test_release_url_only_accepts_this_repositorys_releases():
    ok = "https://github.com/adombs/Divine-Pulse/releases/tag/v1.4.4"
    assert release_url(ok) == ok
    for other in ("https://evil.example/releases/", "http://github.com/adombs/Divine-Pulse/releases/x", None, 3):
        assert release_url(other) == LATEST_RELEASE_URL


def test_newer_release_is_available_with_its_url(tmp_path):
    check, _, events, calls = make(tmp_path, release())
    assert check.status() == {"current": "1.4.3", "latest": None, "url": None, "available": False, "checked": False}
    check.start()
    expected = {"current": "1.4.3", "latest": "1.4.4",
                "url": "https://github.com/adombs/Divine-Pulse/releases/tag/v1.4.4", "available": True, "checked": True}
    assert check.status() == expected
    assert events.items == [("update", expected)]
    assert calls == ["1.4.3"]


def test_same_or_older_release_is_not_available(tmp_path):
    check, *_ = make(tmp_path, release("1.4.3", "https://elsewhere.example/x"))
    check.start()
    assert check.status() == {"current": "1.4.3", "latest": "1.4.3", "url": LATEST_RELEASE_URL,
                              "available": False, "checked": True}


@pytest.mark.parametrize("fetcher", [
    lambda _v: (_ for _ in ()).throw(OSError("offline")),
    lambda _v: {"tag_name": "nightly"},
    lambda _v: {},
])
def test_failures_stay_not_checked_without_raising(tmp_path, fetcher):
    check, _, events, calls = make(tmp_path, fetcher)
    check.start()
    check.settings_changed()
    assert check.status()["checked"] is False
    assert events.items == []
    assert len(calls) == 1  # no retry loop


def test_setting_off_means_no_fetch_and_turning_it_on_checks_once(tmp_path):
    check, settings, events, calls = make(tmp_path, release(), enabled=False)
    check.start()
    assert calls == []
    settings.update(check_updates=True)
    check.settings_changed()
    check.settings_changed()
    assert len(calls) == 1
    assert check.status()["available"] is True
    assert len(events.items) == 1


def test_nothing_runs_before_start(tmp_path):
    check, _, _, calls = make(tmp_path, release())
    check.settings_changed()
    assert calls == []


def test_fetch_uses_the_release_api_with_a_timeout_and_plain_headers(monkeypatch):
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"tag_name": "v9.9.9"}).encode()

    def urlopen(request, timeout):
        seen["request"], seen["timeout"] = request, timeout
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert fetch_latest_release("1.4.3") == {"tag_name": "v9.9.9"}
    assert seen["request"].full_url == LATEST_RELEASE_API
    assert seen["timeout"] == 5
    assert seen["request"].get_header("User-agent") == "Divine-Pulse/1.4.3"
    assert seen["request"].get_header("Accept") == "application/vnd.github+json"


@pytest.fixture
def client(tmp_path, monkeypatch):
    def no_network(*_a, **_k):
        raise AssertionError("tests must not use the network")

    monkeypatch.setattr(urllib.request, "urlopen", no_network)
    with TestClient(create_app(tmp_path, background=False)) as c:
        yield c


def test_update_endpoint_shape(client):
    response = client.get("/api/update")
    assert response.status_code == 200
    assert response.json() == {"current": __version__, "latest": None, "url": None, "available": False, "checked": False}
    # Turning the setting on in an app without background work still never fetches.
    assert client.put("/api/settings", json={"check_updates": True}).status_code == 200
    assert client.get("/api/update").json()["checked"] is False


def test_update_settings_round_trip(client, tmp_path):
    settings = client.get("/api/settings").json()
    assert settings["check_updates"] is True and settings["update_dismissed"] is None
    saved = client.put("/api/settings", json={"check_updates": False, "update_dismissed": "1.4.4"}).json()
    assert saved["check_updates"] is False and saved["update_dismissed"] == "1.4.4"
    assert SettingsStore(tmp_path / "settings.json").get().update_dismissed == "1.4.4"
    assert client.put("/api/settings", json={"max_recordings": 2}).json()["update_dismissed"] == "1.4.4"
    assert client.put("/api/settings", json={"update_dismissed": ""}).json()["update_dismissed"] is None
    assert client.put("/api/settings", json={"check_updates": "maybe"}).status_code == 422
