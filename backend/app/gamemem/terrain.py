"""Battle map terrain and imported terrain grids."""

from __future__ import annotations

from dataclasses import dataclass

from ..infrastructure import game_tables

GRID = 32  # tiles across and down in a terrain grid
HEADER = 8
TILE = 2  # bytes per tile: terrain ID, second ID
GRID_BYTES = HEADER + GRID * GRID * TILE
TERRAIN_IDS = 115  # IDs 0-114 are named; anything above isn't a terrain grid
IMPASSABLE = 0


@dataclass(frozen=True)
class Ground:
    """What a tile adds to the unit standing on it (fliers get none of it but the healing)."""

    avo: int = 0
    defense: int = 0
    res: int = 0


NO_GROUND = Ground()


@dataclass(frozen=True)
class TerrainInfo:
    name: str
    kind: str  # colour group: plain, floor, forest, water, mountain, wall, bridge, sand, heal, hazard, fort
    avo: int
    defense: int
    res: int
    heal: int  # % of max HP per turn (negative: damage)
    enter: str  # who can stand on it: all, fliers, none
    move: str = "Normal"  # the game's movement group ("Forest", "Fliers only"...)
    wall_hp: int = 0  # a breakable wall's HP (0: not breakable)

    @property
    def ground(self) -> Ground:
        return Ground(self.avo, self.defense, self.res)


def terrain_table() -> tuple[TerrainInfo, ...]:
    """Every terrain ID's name and effects, by ID."""
    try:
        tiles = game_tables.terrain()
        return tuple(TerrainInfo(*tile) for tile in tiles)
    except (OSError, ValueError, KeyError, TypeError):
        return ()


def terrain(tile_id: int | None) -> TerrainInfo | None:
    table = terrain_table()
    return table[tile_id] if tile_id is not None and 0 <= tile_id < len(table) else None


def ground(tile_id: int | None, flying: bool = False) -> Ground:
    """The bonuses a unit gets on this tile (none for fliers, or for a tile not known)."""
    info = terrain(tile_id)
    return NO_GROUND if info is None or flying else info.ground


def decode_grid(data: bytes) -> tuple[list[list[int]], list[list[int]]] | None:
    """The terrain IDs and second IDs of a grid in the file's layout, cropped to the map's real size (rows of
    width w, h of them). None if it isn't a terrain grid."""
    if len(data) < GRID_BYTES:
        return None
    body = data[HEADER:GRID_BYTES]
    first, second = body[0::2], body[1::2]
    if max(first) >= TERRAIN_IDS:
        return None
    w = max((x + 1 for y in range(GRID) for x in range(GRID) if first[y * GRID + x] != IMPASSABLE), default=0)
    h = max((y + 1 for y in range(GRID) for x in range(GRID) if first[y * GRID + x] != IMPASSABLE), default=0)
    if not w:
        return None
    rows = [list(first[y * GRID : y * GRID + w]) for y in range(h)]
    rows2 = [list(second[y * GRID : y * GRID + w]) for y in range(h)]
    return rows, rows2


def map_grids() -> dict[int, tuple[tuple[int, ...], ...]]:
    """Every map's terrain IDs by map id, rows from y = 0. Empty if the file can't be read."""
    try:
        maps = game_tables.maps()
        return {int(k): tuple(tuple(bytes.fromhex(row)) for row in rows) for k, rows in maps.items()}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


def fits(grid: tuple[tuple[int, ...], ...], positions: list[tuple[int, int]], allowed: int = 0) -> bool:
    """Whether every position is on the map and on a tile a unit can stand on (fliers-only tiles count: units on
    them may fly), but for at most `allowed` of them."""
    blocked = 0
    for x, y in positions:
        if not (0 <= y < len(grid) and 0 <= x < len(grid[y])):
            return False
        info = terrain(grid[y][x])
        if info is None or info.enter == "none":
            blocked += 1
            if blocked > allowed:
                return False
    return True


def battle_map(map_id: int | None, positions: list[tuple[int, int]]) -> tuple[int, tuple[tuple[int, ...], ...]] | None:
    """The battle's map id and grid: the map the game says (`map_id`) if every unit fits on it, else the only map
    every unit fits on. None when no map (or more than one, without the game's id) fits. The game's map may have a
    few units on tiles its table calls impassable (levers, altars, a raised drawbridge: event tiles), so one in ten is
    let off for it."""
    grids = map_grids()
    if map_id is not None and map_id in grids and fits(grids[map_id], positions, allowed=len(positions) // 10):
        return map_id, grids[map_id]
    if len(positions) < 2:
        return None
    candidates = [(m, g) for m, g in grids.items() if fits(g, positions)]
    return candidates[0] if len(candidates) == 1 else None
