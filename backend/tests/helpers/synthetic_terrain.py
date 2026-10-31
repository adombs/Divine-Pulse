"""A small made-up terrain table and two maps for a fake import (helpers/fake_import.py)."""

import json
from pathlib import Path

PLAIN, FOREST, RIVER, BRIDGE, THICKET, PILLAR, CLIFF = 2, 3, 6, 10, 24, 17, 37
IDS = 115
# id -> name, Avo, Def, Res, heal, who can stand there, movement group, wall HP
TILES = {
    0: ("Impassable", 0, 0, 0, 0, "none", "Normal", 0),
    PLAIN: ("Plain", 0, 0, 0, 0, "all", "Normal", 0),
    FOREST: ("Forest", 30, 1, 0, 0, "all", "Forest", 0),
    RIVER: ("River", 0, 0, 0, 0, "fliers", "Fliers only", 0),
    BRIDGE: ("Bridge", 0, 0, 0, 0, "all", "Normal", 0),
    THICKET: ("Thicket", 20, 2, 0, 0, "all", "Forest", 0),
    PILLAR: ("Pillar", 0, 0, 0, 0, "none", "Normal", 0),
    CLIFF: ("Cliff", 0, 0, 0, 0, "fliers", "Fliers only", 0),
    18: ("Heal Tile", 0, 0, 0, 10, "all", "Normal", 0),
    35: ("Throne", 40, 5, 5, 0, "all", "Normal", 0),
    38: ("Breakable Wall", 0, 0, 0, 0, "none", "Normal", 20),
    39: ("Snow", -20, 0, 0, 0, "all", "Normal", 0),
    80: ("Poison", 0, 0, 0, -10, "all", "Normal", 0),
}
BIG_MAP_ID, SMALL_MAP_ID = 7, 8


def a_map(w=14, h=20) -> list[list[int]]:
    """A small map: plain with a forest patch, a river crossed by a bridge, a cliff edge."""
    rows = [[PLAIN] * w for _ in range(h)]
    for y in range(2, 6):
        for x in range(3, 7):
            rows[y][x] = FOREST
    for x in range(w):
        rows[10][x] = RIVER
    rows[10][5] = BRIDGE
    for y in range(h):
        rows[y][w - 1] = CLIFF
    rows[15][2] = THICKET
    return rows


def small_map() -> list[list[int]]:
    rows = [[PLAIN] * 6 for _ in range(6)]
    rows[3][3] = PILLAR
    return rows


def write_terrain_tables(root: Path) -> None:
    def write(relative, content):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content), encoding="utf-8")
        manifest = json.loads((root / "manifest.json").read_text("utf-8"))
        manifest["files"][relative] = {}
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    tiles = {}
    for i in range(IDS):
        name, avo, defense, res, heal, enter, move, wall = TILES.get(i, (f"Terrain {i}", 0, 0, 0, 0, "all", "Normal", 0))
        tiles[str(i)] = {"name": name, "avo": avo, "def": defense, "res": res, "heal": heal, "enter": enter,
                         "move_name": move, "wall_hp": wall}
    write("data/terrain.json", {"tiles": tiles})
    write("data/maps.json", {"maps": {
        str(BIG_MAP_ID): [bytes(row).hex() for row in a_map()],
        str(SMALL_MAP_ID): [bytes(row).hex() for row in small_map()],
    }})
