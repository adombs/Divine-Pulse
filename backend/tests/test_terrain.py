"""Battle map terrain on a small made-up table and maps (helpers/synthetic_terrain.py): the terrain table, the maps,
decoding a grid, and terrain in the combat math."""

import pytest

from app.battle import ArmySample, BattleSample, BattleTracker, terrain_tiles
from app.gamemem import terrain as t
from app.gamemem.terrain import GRID, GRID_BYTES, HEADER, battle_map, decode_grid, fits, ground, map_grids, terrain, terrain_table
from helpers.synthetic_terrain import BIG_MAP_ID, BRIDGE, CLIFF, FOREST, PLAIN, RIVER, SMALL_MAP_ID, THICKET, a_map


@pytest.fixture(autouse=True)
def tables(roster_import):
    return roster_import


def test_the_table_names_every_terrain_id_and_its_effects():
    table = terrain_table()
    assert len(table) == t.TERRAIN_IDS
    assert [table[i].name for i in (0, 2, 3, 10, 18, 35)] == ["Impassable", "Plain", "Forest", "Bridge", "Heal Tile", "Throne"]
    forest = terrain(FOREST)
    assert (forest.kind, forest.avo, forest.defense, forest.res, forest.heal, forest.enter) == ("forest", 30, 1, 0, 0, "all")
    assert (terrain(0).enter, terrain(RIVER).enter, terrain(CLIFF).enter, terrain(17).enter) == ("none", "fliers", "fliers", "none")
    assert (terrain(39).avo, terrain(80).heal, terrain(18).heal, terrain(38).wall_hp) == (-20, -10, 10, 20)
    assert terrain(35).ground == t.Ground(40, 5, 5)
    assert terrain(None) is None and terrain(999) is None
    assert {info.kind for info in table} <= {"plain", "floor", "forest", "water", "mountain", "wall", "bridge", "sand", "heal", "hazard", "fort"}


def test_fliers_get_no_terrain_bonus():
    assert ground(FOREST) == t.Ground(30, 1, 0)
    assert ground(FOREST, flying=True) == t.NO_GROUND
    assert ground(None) == t.NO_GROUND


def test_a_grid_is_cropped_to_the_map():
    rows, second = decode_grid(grid_bytes(a_map(), second=7))
    assert rows == a_map()
    assert (len(rows[0]), len(rows)) == (14, 20)
    assert second[0][0] == 7
    assert decode_grid(b"\x00" * GRID_BYTES) is None  # all impassable: not a map
    assert decode_grid(grid_bytes([[200, 2], [2, 2]])) is None  # not a terrain ID
    assert decode_grid(b"short") is None


def test_the_maps_are_known():
    maps = map_grids()
    assert sorted(maps) == [BIG_MAP_ID, SMALL_MAP_ID]
    assert [list(row) for row in maps[BIG_MAP_ID]] == a_map()
    for grid in maps.values():
        assert 1 <= len(grid) <= GRID and all(1 <= len(row) <= GRID for row in grid)
        assert all(terrain(t) is not None for row in grid for t in row)


def test_the_battle_is_matched_to_its_map():
    units = [(2, 2), (12, 18), (5, 10)]  # only the big map is this large
    map_id, grid = battle_map(BIG_MAP_ID, units)
    assert map_id == BIG_MAP_ID and grid == map_grids()[BIG_MAP_ID]
    assert fits(grid, units)
    assert battle_map(SMALL_MAP_ID, units)[0] == BIG_MAP_ID  # the game's map can't hold them: the one map that does
    both = [(1, 1), (2, 2)]
    assert battle_map(99, both) is None  # a map with no grid, and the units fit two maps
    assert battle_map(SMALL_MAP_ID, both)[0] == SMALL_MAP_ID
    assert battle_map(None, [(1, 1)]) is None  # one unit tells nothing
    assert fits(map_grids()[BIG_MAP_ID], [(6, 10)])  # a river tile is for fliers: they may stand there
    assert not fits(map_grids()[SMALL_MAP_ID], [(3, 3)])  # a pillar nobody can enter
    assert fits(map_grids()[SMALL_MAP_ID], [(3, 3), (1, 0)], allowed=1)
    assert not fits(map_grids()[SMALL_MAP_ID], [(30, 2)])  # off the map


def test_the_scenario_table_beats_a_stale_game_map_value(monkeypatch):
    both = [(1, 1), (2, 2)]  # fits both maps, like a battle's opening positions
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: BIG_MAP_ID})
    assert battle_map(SMALL_MAP_ID, both, scenario=66)[0] == BIG_MAP_ID  # the game's value read as another map
    assert battle_map(SMALL_MAP_ID, both, scenario=5)[0] == SMALL_MAP_ID  # a scenario not in the table: the game's value
    assert battle_map(SMALL_MAP_ID, both)[0] == SMALL_MAP_ID


def test_the_game_map_is_tried_when_the_table_map_does_not_fit(monkeypatch):
    units = [(2, 2), (12, 18), (5, 10)]  # only the big map holds them
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: SMALL_MAP_ID})
    assert battle_map(BIG_MAP_ID, units, scenario=66)[0] == BIG_MAP_ID


def test_a_map_the_units_have_walked_off_is_not_taken(monkeypatch):
    both = [(1, 1), (2, 2)]  # fit both maps now
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: SMALL_MAP_ID})
    walked = [(12, 18), (5, 10), (2, 15), (10, 12)]  # earlier this battle, on tiles only the big map has
    assert battle_map(SMALL_MAP_ID, both, scenario=66, seen=walked)[0] == BIG_MAP_ID
    assert battle_map(SMALL_MAP_ID, both, scenario=66, seen=[])[0] == SMALL_MAP_ID


def test_the_reader_remembers_positions_for_one_battle_only(monkeypatch):
    from types import SimpleNamespace

    from app.gamemem.fe3h import GameMemory

    memory = GameMemory(emulators=())
    memory._process, memory._copies = object(), {1: 1}
    located = {"map": SMALL_MAP_ID, "scenario": 66}
    monkeypatch.setattr(memory, "battle_globals", lambda: located)
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: SMALL_MAP_ID})

    def at(*positions):
        return memory.battle_terrain([SimpleNamespace(x=x, y=y, hp=10) for x, y in positions])

    assert at((12, 18), (5, 10), (2, 15), (10, 12))[0] == BIG_MAP_ID  # walked where only the big map has room
    assert at((1, 1), (2, 2))[0] == BIG_MAP_ID  # fits both now, but the small map was walked off this battle
    memory._generation += 1  # the next battle
    assert at((1, 1), (2, 2))[0] == SMALL_MAP_ID


def test_the_reader_picks_no_map_once_the_battle_is_over(monkeypatch):
    from types import SimpleNamespace

    from app.gamemem.fe3h import GameMemory

    memory = GameMemory(emulators=())
    memory._process, memory._copies = object(), {1: 1}
    located = {"map": BIG_MAP_ID, "scenario": 66}
    monkeypatch.setattr(memory, "battle_globals", lambda: located)
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: BIG_MAP_ID})
    units = [SimpleNamespace(x=x, y=y, hp=10) for x, y in ((1, 1), (2, 2))]  # fit both maps
    assert memory.battle_terrain(units)[0] == BIG_MAP_ID
    # The battle ends: the game resets the scenario and its map value (to the small map here, map 0 in the game)
    # while the units are still in memory. Picking a map then would replace the one the battle was played on.
    located.update(map=SMALL_MAP_ID, scenario=None)
    assert memory.battle_terrain(units) is None


def test_a_table_and_game_disagreement_is_logged_once(monkeypatch, caplog):
    monkeypatch.setattr(t, "scenario_maps", lambda: {66: BIG_MAP_ID})
    monkeypatch.setattr(t, "_disagreements", set())
    both = [(1, 1), (2, 2)]
    with caplog.at_level("WARNING", logger=t.__name__):
        battle_map(SMALL_MAP_ID, both, scenario=66)
        battle_map(SMALL_MAP_ID, both, scenario=66)
        battle_map(0, both, scenario=66)  # the game's value reading 0: the known case, not logged
        battle_map(BIG_MAP_ID, both, scenario=66)  # agreement
    assert [r.getMessage() for r in caplog.records] == [
        f"scenario 66: the scenario table says map {BIG_MAP_ID}, the game says map {SMALL_MAP_ID}"
    ]


def grid_bytes(rows: list[list[int]], second: int = 0) -> bytes:
    body = bytearray(GRID * GRID * 2)
    for y, row in enumerate(rows):
        for x, tile in enumerate(row):
            body[(y * GRID + x) * 2] = tile
            body[(y * GRID + x) * 2 + 1] = second
    return bytes(range(1, HEADER + 1)) + bytes(body)


def test_the_tracker_keeps_the_terrain_and_what_its_tiles_are():
    tracker = BattleTracker()
    army = (ArmySample("byleth", "Byleth", "Mercenary", 10, {"hp": 30, "mv": 5}, x=4, y=4),)
    tracker.update(BattleSample(army, terrain=tuple(tuple(r) for r in a_map())), "run")
    battle = tracker.battle
    assert battle.terrain == a_map()
    assert set(battle.terrain_tiles) == {PLAIN, FOREST, RIVER, BRIDGE, CLIFF, THICKET}
    assert battle.terrain_tiles[FOREST].name == "Forest" and battle.terrain_tiles[FOREST].avo == 30
    assert (battle.map_w, battle.map_h) == (14, 20)  # the whole map, not just where units stood
    # Read again unchanged: nothing changes; a lowered bridge: the new grid replaces it.
    changed, _ = tracker.update(BattleSample(army, terrain=tuple(tuple(r) for r in a_map())), "run")
    assert not changed
    lowered = a_map()
    lowered[10][6] = BRIDGE
    changed, _ = tracker.update(BattleSample(army, terrain=tuple(tuple(r) for r in lowered)), "run")
    assert changed and battle.terrain[10][6] == BRIDGE
    # No terrain read (not located): the battle keeps working without it.
    tracker.update(BattleSample(army), "run")
    assert battle.terrain == lowered


def test_terrain_tiles_leaves_out_unknown_ids():
    assert set(terrain_tiles([[2, 3, 250]])) == {2, 3}


def test_the_battle_is_named_from_its_scenario_id():
    from app.battle import scenario_name
    from app.gamemem.battle import BattleFields

    assert (scenario_name(0), scenario_name(59), scenario_name(9999), scenario_name(-1)) == ("First Trial", "", "", "")
    assert BattleFields.load().scenario == 0x163130
    tracker = BattleTracker()
    army = (ArmySample("byleth", "Byleth", "Mercenary", 10, {"hp": 30, "mv": 5}),)
    tracker.update(BattleSample(army, scenario=0), "run")
    assert (tracker.battle.scenario, tracker.battle.map_name) == (0, "First Trial")
    tracker.update(BattleSample(army), "run")  # not read this time: kept
    assert tracker.battle.map_name == "First Trial"


def test_a_tile_bonus_comes_off_the_damage_and_hit_against_the_unit_on_it():
    from app.gamemem.battle import BattleUnit
    from app.gamemem.combat import Fighter
    from test_combat import forecast

    raw = {"hp": 40, "str": 21, "mag": 12, "dex": 14, "spd": 18, "lck": 17, "def": 7, "res": 11, "mv": 4, "cha": 16}
    attacker = Fighter.from_unit(BattleUnit(0, True, 17, 7, raw, hp=40, x=1, y=1, items=((16, 40),), slot=0))
    foe = Fighter.from_unit(BattleUnit(509, False, 17, 11, raw, hp=40, x=2, y=1, items=((22, 40),), slot=1))
    arm = attacker.arms[0]
    plain = forecast(attacker, arm, foe, None, 1)
    woods = forecast(attacker, arm, foe, None, 1, d_ground=ground(FOREST))
    assert woods.attacker.mt == plain.attacker.mt - 1
    assert woods.attacker.hit == plain.attacker.hit - 30
    deeper = forecast(attacker, arm, foe, None, 1, d_ground=t.Ground(avo=60, defense=1))
    assert deeper.attacker.hit == woods.attacker.hit - 30
    # The attacker's own tile counts against the counterattack, not its attack.
    on_thicket = forecast(attacker, arm, foe, foe.arms[0], 1, a_ground=ground(THICKET))
    assert on_thicket.attacker == forecast(attacker, arm, foe, foe.arms[0], 1).attacker
    assert on_thicket.defender.hit < forecast(attacker, arm, foe, foe.arms[0], 1).defender.hit
