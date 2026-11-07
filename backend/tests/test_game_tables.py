import json
import pytest

from app.gamemem import combat
from app.infrastructure import game_tables
from app.infrastructure.game_assets import GameAssetError, GameAssets


def test_imported_tables(fake_import):
    data = game_tables.memory()
    assert data["characters"]["2"]["name"] == "Aster"
    assert data["classes"]["0"]["name"] == "Scout"
    assert data["items"]["1000"] == "Amber"
    assert game_tables.maps() == {"0": ["0001"]}
    assert game_tables.scenario_names() == ("First Trial",)
    assert combat.support_pairs()[frozenset(("Aster", "Bram"))] == ("C", "B")
    assert combat.support_pairs()[frozenset(("Byleth (M)", "Bram"))] == ("C",)
    assert combat.support_pairs()[frozenset(("Byleth (F)", "Bram"))] == ("C", "S")


def test_language_changes(fake_import):
    language = ["ENG_U"]
    fake_import.language = lambda: language[0]
    assert game_tables.memory()["items"]["1000"] == "Amber"
    language[0] = "GER"
    assert game_tables.memory()["items"]["1000"] == "Bernstein"
    assert game_tables.scenario_names() == ("Erste Prüfung",)


def test_first_run_without_import_uses_empty_reference_sentinels(tmp_path, monkeypatch):
    assets = GameAssets(tmp_path)
    monkeypatch.setattr(game_tables, "game_assets", lambda: assets)
    data = game_tables.memory()
    assert not data["characters"]
    assert not data["weapons"]
    assert not data["abilities"]
    assert not game_tables.maps()
    assert not game_tables.terrain()
    assert not game_tables.scenario_names()
    assert not combat.support_pairs()


@pytest.mark.parametrize(("relative", "content", "reader"), [
    ("data/maps.json", {"maps": {}}, game_tables.maps),
    ("data/maps.json", {"maps": {"0": ["not hex"]}}, game_tables.maps),
    ("data/items.json", {"items": {}}, game_tables.memory),
    ("data/weapons.json", {"weapons": [{"id": 1}]}, game_tables.memory),
    ("data/classes.json", {"classes": [{"id": 0, "types": []}]}, game_tables.class_types),
    ("data/terrain.json", {"tiles": {}}, game_tables.terrain),
    ("text/ENG_U.json", {"categories": {"scenario_title": {"invalid": "Trial"}}}, game_tables.scenario_names),
])
def test_invalid_required_table_reports_source(fake_import, relative, content, reader):
    path = fake_import.root / relative
    path.write_text(json.dumps(content), encoding="utf-8")
    manifest_path = fake_import.root / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))
    manifest["files"][relative] = {}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(GameAssetError) as caught:
        reader()
    assert caught.value.asset == relative


def test_cached_tables_do_not_hide_deleted_required_file(fake_import):
    assert game_tables.memory()["items"]["1000"] == "Amber"
    (fake_import.root / "data/items.json").unlink()
    with pytest.raises(GameAssetError, match="data/items.json"):
        game_tables.memory()


def test_cached_tables_do_not_hide_corrupt_selected_language(fake_import):
    assert game_tables.memory()["items"]["1000"] == "Amber"
    (fake_import.root / "text/ENG_U.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(GameAssetError, match="text/ENG_U.json"):
        game_tables.memory()
