from app.gamemem import combat
from app.infrastructure import game_tables
from app.infrastructure.game_assets import GameAssets


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


def test_missing_import_is_empty(tmp_path, monkeypatch):
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
