import json
import pytest

from app.infrastructure.game_assets import GameAssetError, GameAssets
from app.infrastructure.settings import SettingsStore


def test_old_language_preference_does_not_change_the_app_language(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"game_language": "GER", "record_battles": False}), encoding="utf-8")
    store = SettingsStore(path)
    assert "game_language" not in store.get().model_dump()
    assert store.get().max_recordings == 0


def test_missing_selected_language_reports_its_path_without_substitution(tmp_path):
    (tmp_path / "text").mkdir()
    (tmp_path / "text/JP.json").write_text(json.dumps({"categories": {"class": {"1": "日本語"}}}), encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"files": {"text/JP.json": {}}}), encoding="utf-8")
    with pytest.raises(GameAssetError, match="text/GER.json"):
        GameAssets(tmp_path).text("class", "GER")
    assert GameAssets(tmp_path).status()["languages"] == ["JP"]
