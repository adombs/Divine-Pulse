import json

from app.domain.settings import Settings
from app.infrastructure.game_assets import GameAssets
from app.infrastructure.settings import SettingsStore


def test_language_persists_and_invalid_saved_value_falls_back(tmp_path):
    path = tmp_path / "settings.json"
    store = SettingsStore(path)
    store.update(game_language="GER")
    assert SettingsStore(path).get().game_language == "GER"
    path.write_text(json.dumps({"game_language": "unknown", "battle_alerts": False}), encoding="utf-8")
    loaded = SettingsStore(path).get()
    assert loaded.game_language == "ENG_U"
    assert loaded.battle_alerts is False
    assert Settings(game_language="JP").game_language == "JP"


def test_missing_language_falls_back_to_first_available(tmp_path):
    (tmp_path / "text").mkdir()
    (tmp_path / "text/JP.json").write_text(json.dumps({"categories": {"class": {"1": "日本語"}}}), encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"files": {"text/JP.json": {}}}), encoding="utf-8")
    assert GameAssets(tmp_path).text("class", "GER") == {"1": "日本語"}
    assert GameAssets(tmp_path).status()["languages"] == ["JP"]
