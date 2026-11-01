"""Battle map terrain against your own import and a battle recorded from your own game (see helpers/captures.py)."""

import pytest

from app.gamemem import terrain as t
from app.gamemem.terrain import GRID, battle_map, fits, ground, map_grids
from helpers import captures
from test_combat_captures import NO_CAPTURE
from test_terrain import FOREST, PLAIN, THICKET

pytestmark = [pytest.mark.needs_captures, pytest.mark.needs_game_import]
DATA = captures.read_json("battle", "oil_and_water_turn2.json", default=NO_CAPTURE)


def oil_and_water_positions() -> list[tuple[int, int]]:
    frame = DATA["frames"][0]
    return [(u["x"], u["y"]) for u in frame["units"] if u["x"] is not None and (u["x"], u["y"]) != (0, 0)]


def test_the_battle_is_matched_to_its_map():
    units = oil_and_water_positions()
    map_id, grid = battle_map(36, units)  # Oil and Water: the game's map id, and every unit stands on it
    assert map_id == 36 and grid == map_grids()[36]
    assert fits(grid, units)
    assert battle_map(0, units) is None  # the prologue map can't hold these units, and the units alone fit several maps
    assert battle_map(99, units) is None  # a map with no grid
    assert battle_map(0, [(10, 17), (9, 17), (11, 17), (10, 18), (9, 19)])[0] == 0  # the prologue's starting units
    assert fits(map_grids()[0], [(0, 16)])  # the prologue's wall is fliers-only
    if 39 in map_grids():  # Cindered Shadows, when that DLC was imported
        assert not fits(map_grids()[39], [(11, 0)])  # a wall nobody can enter
        assert fits(map_grids()[39], [(11, 0), (1, 0)], allowed=1)
    assert not fits(map_grids()[0], [(30, 2)])  # off the map


def test_a_tile_bonus_comes_off_the_damage_and_hit_against_the_unit_on_it():
    from app.gamemem.combat import Fighter
    from test_combat import forecast
    from test_combat_captures import UNITS

    byleth = Fighter.from_unit(next(u for u in UNITS if u.army and u.character == 0))
    bandit = Fighter.from_unit(next(u for u in UNITS if not u.army and u.character != 0))
    arm = byleth.arms[0]
    plain = forecast(byleth, arm, bandit, None, 1)
    woods = forecast(byleth, arm, bandit, None, 1, d_ground=ground(FOREST))
    assert woods.attacker.mt == max(0, plain.attacker.mt - 1)
    assert woods.attacker.hit < plain.attacker.hit
    deeper = forecast(byleth, arm, bandit, None, 1, d_ground=t.Ground(avo=60, defense=1))
    assert deeper.attacker.hit == max(0, woods.attacker.hit - 30)
    # The attacker's own tile counts against the counterattack, not its attack.
    on_thicket = forecast(byleth, arm, bandit, bandit.arms[0] if bandit.arms else None, 1, a_ground=ground(THICKET))
    assert on_thicket.attacker == forecast(byleth, arm, bandit, bandit.arms[0] if bandit.arms else None, 1).attacker


def test_fight_pairing_uses_the_tiles_and_still_finds_every_fight():
    from test_pairing_captures import FRAMES, HISTORY, ORIGINS, pair_fights

    def read_by_read(terrain):
        found, sure = [], {}
        for a in range(len(FRAMES) - 1):
            result = pair_fights(FRAMES[a], FRAMES[a + 1], origins=ORIGINS, terrain=terrain)
            for f in result.fights:
                found.append((f.attacker, f.defender))
                sure[(f.attacker, f.defender)] = f.confidence
        return sorted(found), sure

    found, before = read_by_read(None)
    assert found == sorted(HISTORY)
    # Oil and Water's turn 2 was fought on open ground: with every tile Plain each fight is found about as surely
    # (one 0.90 -> 0.93, Lorenz's 0.661 -> 0.658).
    found, plain = read_by_read([[PLAIN] * GRID for _ in range(GRID)])
    assert found == sorted(HISTORY)
    assert all(plain[k] >= before[k] - 0.01 for k in before) and sum(plain.values()) > sum(before.values())
    # Even a wrong map (every tile forest) keeps the right fights, just less surely.
    found, _ = read_by_read([[FOREST] * GRID for _ in range(GRID)])
    assert found == sorted(HISTORY)
