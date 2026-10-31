import pytest

from helpers import captures
from helpers.fake_import import write_fake_import
from helpers.synthetic_roster import write_roster_tables
from helpers.synthetic_terrain import write_terrain_tables


def pytest_configure(config):
    config.addinivalue_line("markers", "needs_game_import: requires the player's own imported game files")
    config.addinivalue_line("markers", f"needs_captures: requires {captures.ENV} ({captures.REASON})")


def pytest_collection_modifyitems(items):
    from app.infrastructure.game_assets import game_assets

    skips = {
        "needs_game_import": (not game_assets().available, "requires imported game tables"),
        "needs_captures": (not captures.available(), captures.REASON),
    }
    for item in items:
        for name, (missing, reason) in skips.items():
            if missing and item.get_closest_marker(name):
                item.add_marker(pytest.mark.skip(reason=reason))


@pytest.fixture
def fake_import(tmp_path, monkeypatch):
    from app.infrastructure import game_tables
    from app.infrastructure.game_assets import GameAssets

    write_fake_import(tmp_path)
    assets = GameAssets(tmp_path)
    monkeypatch.setattr(game_tables, "game_assets", lambda: assets)
    return assets


@pytest.fixture
def roster_import(tmp_path, monkeypatch):
    """A fake import that also names the made-up army of helpers/synthetic_roster.py and has a small terrain table and
    two maps (helpers/synthetic_terrain.py)."""
    from app.infrastructure import game_tables
    from app.infrastructure.game_assets import GameAssets

    write_fake_import(tmp_path)
    write_roster_tables(tmp_path)
    write_terrain_tables(tmp_path)
    assets = GameAssets(tmp_path)
    monkeypatch.setattr(game_tables, "game_assets", lambda: assets)
    return assets


class _ImportedGameFiles:
    available = True


@pytest.fixture(autouse=True)
def test_client_host_allowed(monkeypatch):
    """TestClient calls itself "testserver"; the real server answers only to this computer's names."""
    from app.interface import security

    monkeypatch.setattr(security, "ALLOWED_HOSTS", {*security.ALLOWED_HOSTS, "testserver"})


@pytest.fixture(autouse=True)
def game_files_imported(monkeypatch):
    """The memory reader only reads once game files are imported. Tests don't depend on whether the machine running them
    has an import: they read as if it had (tests of the no-import case patch this back)."""
    from app.infrastructure import polling

    monkeypatch.setattr(polling, "game_assets", lambda: _ImportedGameFiles())
