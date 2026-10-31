"""The terrain table and maps of your own import (what the app uses once the game files are imported)."""

import pytest

from app.gamemem import terrain as t
from app.gamemem.terrain import GRID, map_grids, terrain, terrain_table

pytestmark = pytest.mark.needs_game_import
FOREST, RIVER, BRIDGE, CLIFF = 3, 6, 10, 37


def test_the_imported_table_names_every_terrain_id_and_its_effects():
    table = terrain_table()
    assert len(table) == t.TERRAIN_IDS
    assert [table[i].name for i in (0, 2, 3, 10, 18, 35)] == ["Impassable", "Plain", "Forest", "Bridge", "Heal Tile", "Throne"]
    forest = terrain(FOREST)
    assert (forest.kind, forest.avo, forest.defense, forest.res, forest.heal, forest.enter) == ("forest", 30, 1, 0, 0, "all")
    # The game's own table: cliffs are fliers-only, doors and pillars nobody's; snow costs 20 Avo, poison hurts.
    assert (terrain(0).enter, terrain(RIVER).enter, terrain(CLIFF).enter, terrain(17).enter, terrain(34).enter) == (
        "none", "fliers", "fliers", "none", "none")
    assert (terrain(39).avo, terrain(80).heal, terrain(62).heal, terrain(38).wall_hp) == (-20, -10, 30, 20)
    assert terrain(35).ground == t.Ground(40, 5, 5)
    assert terrain(None) is None and terrain(999) is None
    assert {info.kind for info in table} <= {"plain", "floor", "forest", "water", "mountain", "wall", "bridge", "sand", "heal", "hazard", "fort"}




def test_every_map_is_known():
    maps = map_grids()
    assert sorted(maps) == list(range(37)) + [38, 39, 40, 41]  # the base game's, then Cindered Shadows'
    for grid in maps.values():
        assert 1 <= len(grid) <= GRID and all(1 <= len(row) <= GRID for row in grid)
        assert all(terrain(t) is not None for row in grid for t in row)
    # The prologue (A Skirmish at Dawn, map 0), as the game's map screen showed it: 21 x 20, a river along row 15
    # with a 3-tile bridge, walls under it, and forest along the top.
    prologue = maps[0]
    assert (len(prologue[0]), len(prologue)) == (21, 20)
    assert prologue[15] == (RIVER,) * 9 + (BRIDGE,) * 3 + (RIVER,) * 9
    assert prologue[16][:9] == (13,) * 9 and prologue[16][9:12] == (1, 1, 1)
    assert prologue[0][4:13] == (FOREST,) * 9
    assert (len(maps[36][0]), len(maps[36])) == (14, 30)  # Oil and Water
