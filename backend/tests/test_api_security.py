"""The local server serves only this computer's own app: other sites get a 403."""

import pytest
from fastapi.testclient import TestClient

from app.interface import security
from app.main import create_app


LOCAL = "http://127.0.0.1:8765"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(security, "ALLOWED_HOSTS", {"127.0.0.1", "localhost", "[::1]"})
    with TestClient(create_app(tmp_path, background=False), base_url=LOCAL) as c:
        yield c


@pytest.mark.parametrize("host", ["127.0.0.1:8765", "localhost:5173", "LOCALHOST:8765", "[::1]:8765", "127.0.0.1"])
def test_this_computers_names_are_served(client, host):
    assert client.get("/api/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8765", "127.0.0.1.evil.example", "[::1].evil:8765", "localhost:80:80",
                                  "localhost:evil", ""])
def test_other_host_names_are_refused(client, host):
    response = client.get("/api/about", headers={"host": host})
    assert response.status_code == 403
    assert "data_dir" not in response.text


def test_request_without_browser_headers_passes(client):
    """The launcher asks a running copy about itself this way."""
    assert client.get("/api/about").status_code == 200


def test_page_from_this_address_may_write(client):
    response = client.post("/api/about/check-nothing", headers={"origin": LOCAL, "sec-fetch-site": "same-origin"})
    assert response.status_code != 403


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://127.0.0.1:9999", "http://localhost:8765",
                                    "file://", "http://[broken"])
def test_other_origins_are_refused(client, origin):
    assert client.post("/api/game-assets/scan", json={"dump": "x"}, headers={"origin": origin}).status_code == 403
    assert client.get("/api/about", headers={"origin": origin}).status_code == 403


def test_form_post_from_another_site_has_no_effect(client, monkeypatch):
    """A form or fetch from a site can post with no body and no preflight; it must never reach the handler."""
    called = []
    monkeypatch.setattr(client.app.state.runtime.operations, "open_data_folder", lambda: called.append(1))
    response = client.post("/api/about/open-data-folder", headers={"origin": "https://evil.example"})
    assert response.status_code == 403
    assert called == []


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_fetch_from_another_site_is_refused_even_without_origin(client, site):
    assert client.get("/api/about", headers={"sec-fetch-site": site}).status_code == 403
    assert client.get("/game-assets/data/maps.json", headers={"sec-fetch-site": site}).status_code == 403
    assert client.post("/anything", headers={"sec-fetch-site": site}).status_code == 403


@pytest.mark.parametrize("site", ["same-origin", "none"])
def test_own_pages_pass_fetch_metadata(client, site):
    assert client.get("/api/health", headers={"sec-fetch-site": site}).status_code == 200


def test_following_a_link_to_the_app_still_opens_it(client):
    """Only the page: the API behind it stays closed to the other site."""
    response = client.get("/", headers={"sec-fetch-site": "cross-site"})
    assert response.status_code != 403


def test_responses_carry_security_headers(client):
    for response in (client.get("/api/health"), client.get("/api/about", headers={"host": "evil.example"})):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["cross-origin-resource-policy"] == "same-origin"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
