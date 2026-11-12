"""Required import reads fail visibly; first run and optional asset discovery stay usable."""

import json

import pytest
from fastapi.testclient import TestClient

from app.infrastructure.game_assets import GameAssetError, GameAssets
from app.main import create_app


def test_first_run_is_a_sentinel_not_an_import_error(tmp_path):
    assets = GameAssets(tmp_path)
    assert assets.json("data/items.json") is None
    assert assets.text("item") == {}
    assert assets.status() == {"available": False, "folder": str(tmp_path)}


@pytest.mark.parametrize("fault", ["unlisted", "missing", "corrupt", "wrong-root", "unreadable"])
def test_required_json_faults_report_exact_file(fake_import, monkeypatch, fault):
    rel = "data/items.json"
    path = fake_import.root / rel
    assert fake_import.json(rel)["items"]
    if fault == "unlisted":
        manifest_path = fake_import.root / "manifest.json"
        manifest = json.loads(manifest_path.read_text("utf-8"))
        del manifest["files"][rel]
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    elif fault == "missing":
        path.unlink()
    elif fault == "corrupt":
        path.write_text("{broken", encoding="utf-8")
    elif fault == "wrong-root":
        path.write_text("[]", encoding="utf-8")
    else:
        # Invalidate the cached file, then model a filesystem permission failure.
        path.write_text('{"items": []}', encoding="utf-8")
        original = type(path).read_text

        def read_text(self, *args, **kwargs):
            if self == path:
                raise PermissionError("test access denied")
            return original(self, *args, **kwargs)

        monkeypatch.setattr(type(path), "read_text", read_text)
    with pytest.raises(GameAssetError) as caught:
        fake_import.json(rel)
    assert caught.value.asset == rel
    assert caught.value.reason
    assert "Reprocess" in str(caught.value)


@pytest.mark.parametrize("categories", [{}, {"item": []}, {"item": {"1": None}}])
def test_missing_or_malformed_requested_text_category_is_an_error(fake_import, categories):
    (fake_import.root / "text/ENG_U.json").write_text(json.dumps({"categories": categories}), encoding="utf-8")
    with pytest.raises(GameAssetError, match="text/ENG_U.json"):
        fake_import.text("item")


def test_valid_empty_category_and_absent_optional_dlc_are_allowed(fake_import):
    assert fake_import.text("gambit") == {}
    assert fake_import.path("images/portraits/optional-dlc.png") is None
    assert fake_import.available


def test_corrupt_manifest_is_visible_and_can_be_repaired(fake_import):
    path = fake_import.root / "manifest.json"
    original = path.read_text("utf-8")
    path.write_text("{broken", encoding="utf-8")
    assert not fake_import.available
    assert "manifest.json" in fake_import.status()["error"]
    with pytest.raises(GameAssetError, match="manifest.json"):
        fake_import.json("data/items.json")
    path.write_text(original, encoding="utf-8")
    assert fake_import.json("data/items.json")["items"]
    path.unlink()
    assert fake_import.json("data/items.json") is None


def test_required_asset_failure_is_a_structured_service_error(tmp_path, fake_import):
    app = create_app(tmp_path / "runs", background=False)

    @app.get("/api/test-required-asset")
    def required_asset():
        return fake_import.json("data/missing.json")

    # Application routes precede the SPA catch-all, which exists after a frontend build.
    app.router.routes.insert(0, app.router.routes.pop())
    with TestClient(app) as client:
        response = client.get("/api/test-required-asset")
    assert response.status_code == 503
    assert response.json()["code"] == "game_asset_error"
    assert response.json()["asset"] == "data/missing.json"
    assert "Reprocess" in response.json()["detail"]
