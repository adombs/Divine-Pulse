"""What the other armies can do to your units before your next turn (gamemem/threat.py), and the outlook it drives."""

import pytest

from app.battle import Battle, BattleUnitStats, EnemyStats
from app.domain.battle import UnitThreat
from app.domain.combat import BattleUnit
from app.domain.outlook import outlook
from app.gamemem.combat import CombatData, Weapon
from app.gamemem.threat import threats
from test_battle import STATS, T0

SWORD, BOW = 50, 51
DATA = CombatData(
    weapons={
        SWORD: Weapon(SWORD, False, 0, 10, 0, -300, 0, 1, 1),  # no crits unless asked
        BOW: Weapon(BOW, False, 3, 10, 0, -300, 0, 2, 2),
    },
    spells={}, effects={}, classes={}, personal={},
)


def unit(slot, x, y, team, hp=30, weapon=SWORD, mv=4, **stats) -> BattleUnit:
    # Dex 100 against Spd 0: every hit lands (unless the stats say otherwise); Def 0, Lck 0.
    raw = {"hp": 30, "str": 0, "mag": 0, "dex": 100, "spd": 0, "lck": 0, "def": 0, "res": 0, "cha": 0, "mv": mv, **stats}
    return BattleUnit(slot, team == 0, 1, 0, raw, hp=hp, x=x, y=y, items=((weapon, 40),), slot=slot, team=team)


def me(hp=30, x=5, y=5, **stats) -> BattleUnit:
    return unit(1, x, y, 0, hp=hp, **{"spd": 0, "str": 0, **stats})


def test_damage_that_cant_kill_is_no_risk_however_many_reach():
    foes = [unit(10 + i, 5 + dx, 5 + dy, 1) for i, (dx, dy) in enumerate(((2, 0), (-2, 0), (0, 2), (0, -2)))]
    t = threats([me(hp=41), *foes], data=DATA)[1]
    assert len(t.attackers) == 4 and t.max_damage == 40 and t.death == 0
    assert threats([me(hp=40), *foes], data=DATA)[1].death == pytest.approx(1.0)


def test_one_attacker_to_each_free_tile_around_the_unit():
    # Six swordsmen nearby, but only the four tiles next to it to strike from: four can attack.
    foes = [unit(10 + i, 2 + i, 3, 1) for i in range(6)]
    t = threats([me(), *foes], data=DATA)[1]
    assert len(t.attackers) == 4 and t.max_damage == 40
    # Boxed in by its own side: melee can't reach it at all; a bow still can, from two tiles away.
    walls = [unit(2 + i, 5 + dx, 5 + dy, 0) for i, (dx, dy) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1)))]
    assert threats([me(), *walls, *foes], data=DATA, targets={1})[1].attackers == ()
    archer = unit(20, 5, 1, 1, weapon=BOW)
    assert threats([me(), *walls, *foes, archer], data=DATA, targets={1})[1].attackers == (20,)


def test_out_of_reach_and_already_acted_dont_count():
    far = unit(10, 20, 20, 1)
    near = unit(11, 5, 8, 1)
    assert threats([me(), far, near], data=DATA)[1].attackers == (11,)
    assert threats([me(), far, near], data=DATA, spent=frozenset({11}))[1].attackers == ()


def test_avoid_and_crits_change_the_chance_to_fall():
    foe = unit(10, 5, 7, 1, dex=50)  # Hit 50 against Avo 0
    dodgy = threats([me(hp=10), foe], data=DATA)[1]
    assert 0.4 < dodgy.death < 0.6  # true Hit 50 lands half the time
    # Speedy enough to double (and avoid some): two chances at it, each less likely to land.
    quick = threats([me(hp=10, spd=20), foe], data=DATA)[1]
    assert quick.death < dodgy.death
    # A critical (x3) is the only way 5 damage takes 12 HP.
    data = CombatData({SWORD: Weapon(SWORD, False, 0, 5, 0, 30, 0, 1, 1)}, {}, {}, {}, {})
    crit = threats([me(hp=12), unit(10, 5, 7, 1, lck=0)], data=data)[1]
    assert crit.max_damage == 15 and 0 < crit.death < 1


def test_its_counter_can_stop_an_attacker_before_its_second_strike():
    foe = unit(10, 5, 7, 1, hp=5, spd=10)  # doubles, but falls to the counter after its first strike
    t = threats([me(hp=15, str=10, dex=200), foe], data=DATA)[1]
    assert t.death == 0 and t.expected == pytest.approx(10)
    # A counter that can miss leaves room for the second strike.
    assert 0 < threats([me(hp=15, str=10, dex=100), foe], data=DATA)[1].death < 0.05


def test_no_game_tables_means_no_estimate():
    assert threats([me(), unit(10, 5, 6, 1)], data=CombatData({}, {}, {}, {}, {})) == {}


def battle_with(threat: dict[str, UnitThreat], acted=True) -> Battle:
    units = [
        BattleUnitStats(key=k, name=k.capitalize(), start_level=5, level=5, start=dict(STATS), now=dict(STATS), hp=20, x=1, y=1, acted=acted)
        for k in ("byleth", "lysithea")
    ]
    return Battle(id="b", run_id="r", started_at=T0, units=units, enemy_stats={9: EnemyStats(slot=9, label="Bandit", x=2, y=1, hp=20, max_hp=20)}, threats=threat)


def test_outlook_is_the_chance_of_getting_through_the_turn():
    safe = outlook(battle_with({"byleth": UnitThreat(attackers=["e:9"] * 3, max_damage=15), "lysithea": UnitThreat()}))
    assert safe["chance"] == 0.99 and safe["factors"] == []
    risky = outlook(battle_with({"byleth": UnitThreat(attackers=["e:9"], max_damage=30, death=0.4), "lysithea": UnitThreat()}))
    assert risky["chance"] == pytest.approx(0.6) and risky["factors"][0]["points"] == pytest.approx(-40)
    assert "40% to fall" in risky["factors"][0]["detail"]
    # Losing a unit that isn't Byleth or a house leader doesn't lose the battle: listed, but the chance holds.
    other = outlook(battle_with({"byleth": UnitThreat(), "lysithea": UnitThreat(attackers=["e:9"], max_damage=30, death=0.9)}))
    assert other["chance"] == 0.99 and other["at_risk"][0]["key"] == "lysithea" and other["factors"][0]["points"] == 0
    # Once worked out it holds until the next time (the tracker does that when your phase ends).
    held = battle_with({"byleth": UnitThreat(attackers=["e:9"], max_damage=30, death=0.4)})
    held.outlook_at = outlook(held)
    held.threats = {}
    assert outlook(held)["chance"] == pytest.approx(0.6)


def test_how_a_unit_moves_sets_what_terrain_costs_it(monkeypatch):
    from app.gamemem import threat as th
    from app.gamemem.combat import Fighter, GameClassInfo
    from app.gamemem.terrain import TerrainInfo

    forest = TerrainInfo("Forest", "forest", 30, 1, 0, 0, "all", "Forest")
    monkeypatch.setattr(th, "terrain", lambda tile: forest)
    data = CombatData(DATA.weapons, {}, {}, {0: GameClassInfo("Thief", {}, {}, ()), 1: GameClassInfo("Paladin", {}, {}, ())}, {})
    grid = [[3] * 32 for _ in range(32)]  # all forest
    thief = Fighter.from_unit(unit(10, 10, 10, 1, mv=6), data)
    rider = Fighter.from_unit(BattleUnit(1, False, 1, 1, dict(thief.unit.raw), hp=30, x=10, y=10, slot=11, team=1), data)
    assert (th.move_kind(thief, data), th.move_kind(rider, data)) == (th.THIEF, th.CAVALRY)
    # Forest costs a thief 1 and a horse 3: six tiles out against two.
    def reach(f, kind):
        return max(abs(x - 10) + abs(y - 10) for x, y in th._stops(f, [f.unit], grid, kind))

    assert (reach(thief, th.THIEF), reach(rider, th.CAVALRY)) == (6, 2)
