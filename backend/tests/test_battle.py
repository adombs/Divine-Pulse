"""Battle sessions: the tracker, the outlook, the battle pool decoder and battle history."""

from dataclasses import replace
import struct
from datetime import datetime, timedelta, timezone

import pytest

from app.battle import STEP_ATTACK, ArmySample, Battle, BattleSample, BattleTracker, BattleUnitStats, EnemySample, EnemyStats, HistoryStep, StepUnit, power
from app.gamemem import battle as pool
from app.gamemem.fe3h import BATTLE_MARKER, BATTLE_MARKER_TO_COPY
from app.domain.battle import LogEntry
from app.domain.outlook import outlook
from app.storage import BattleStore, NotFound

T0 = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)
STATS = {"hp": 30, "mv": 4, "str": 10, "mag": 20, "dex": 15, "spd": 14, "lck": 8, "def": 5, "res": 12, "cha": 11}


def army(key="lysithea", level=16, **changes) -> ArmySample:
    return ArmySample(key, key.capitalize(), "Mage", level, {**STATS, **changes})


def test_byleth_look_is_correct_on_first_poll_and_look_only_changes_are_reported():
    tracker = BattleTracker()
    byleth = replace(army("byleth"), character=0, look="dark")
    sample = BattleSample((byleth,), scenario=11)
    tracker.update(sample, "run", T0)
    assert tracker.battle.units[0].look == "green"
    tracker.battle.units[0].look = "dark"  # resumed from a recording made with the old rule
    changed, _ = tracker.update(sample, "run", T0 + timedelta(seconds=1))
    assert changed
    assert tracker.battle.units[0].look == "green"

    auxiliary = BattleTracker()
    auxiliary.update(BattleSample((replace(byleth, look="green"),), scenario=83), "run", T0)
    assert auxiliary.battle.units[0].look == "green"


def enemies(n, level=15) -> tuple[EnemySample, ...]:
    return tuple(EnemySample("Brigand", level, 100.0) for _ in range(n))


def test_battalion_updates_without_resource_reads_and_unknown_does_not_clear_it():
    tracker = BattleTracker()
    assigned = replace(army(), battalion="Test company", battalion_id=0)
    tracker.update(BattleSample((assigned,)), "run", T0)
    unit = tracker.battle.units[0]
    assert (unit.battalion, unit.battalion_id) == ("Test company", 0)
    # Missing observations never erase the recorded assignment, even after resume.
    resumed = BattleTracker()
    resumed.resume(tracker.battle)
    resumed.update(BattleSample((army(),)), "run", T0 + timedelta(seconds=1))
    assert (unit.battalion, unit.battalion_id) == ("Test company", 0)
    changed, _ = resumed.update(BattleSample((replace(assigned, battalion=""),)), "run", T0 + timedelta(seconds=2))
    assert changed and unit.battalion == "" and unit.battalion_id is None
    assert not tracker.battle.log  # no invented gambit action or combat effect


def at(seconds) -> datetime:
    return T0 + timedelta(seconds=seconds)


def test_a_battle_from_start_to_end():
    tracker = BattleTracker()
    assert tracker.update(BattleSample(()), "run", at(0)) == (False, None)  # no battle, nothing happens

    changed, finished = tracker.update(BattleSample((army(), army("claude", 17)), enemies(10)), "run", at(0))
    assert changed and finished is None and tracker.active
    battle = tracker.battle
    assert [u.key for u in battle.units] == ["lysithea", "claude"]
    assert battle.enemies_start == 10
    assert battle.events[0].kind == "start"

    # Nothing new: no change.
    assert tracker.update(BattleSample((army(), army("claude", 17)), enemies(10)), "run", at(5)) == (False, None)

    # Lysithea levels up, two enemies are gone.
    changed, _ = tracker.update(BattleSample((army(level=17, mag=21, dex=16), army("claude", 17)), enemies(8)), "run", at(60))
    assert changed
    lysithea = battle.units[0]
    assert (lysithea.level_ups, lysithea.gains()) == (1, {"mag": 1, "dex": 1})
    kinds = [e.kind for e in battle.events]
    assert kinds == ["start", "level_up", "enemies"]
    assert battle.events[1].text == "Lysithea reached level 17 (Mag +1, Dex +1)"
    assert battle.events[1].t == 60
    assert battle.enemies_now == 8 and battle.stat_points == 2 and battle.level_ups == 1

    # Claude falls (no longer on the map).
    tracker.update(BattleSample((army(level=17, mag=21, dex=16),), enemies(8)), "run", at(90))
    assert not battle.units[1].on_map and battle.events[-1].kind == "left"

    # The battle ends.
    changed, finished = tracker.update(BattleSample(()), "run", at(600))
    assert changed and finished is battle and not tracker.active
    assert finished.ended_at == at(600) and finished.seconds() == 600
    assert finished.events[-1].kind == "end"


def test_divine_pulse_is_detected_when_a_gain_is_undone():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),)), "run", at(0))
    tracker.update(BattleSample((army(level=17, mag=21),)), "run", at(10))
    tracker.update(BattleSample((army(),)), "run", at(20))  # back to before the level-up
    battle = tracker.battle
    assert battle.divine_pulses == 1
    # The undone level-up goes off the log with the stats it gave.
    assert [e.kind for e in battle.events] == ["start", "divine_pulse"]
    assert battle.units[0].level == 16 and battle.level_ups == 0 and battle.stat_points == 0


def test_gains_of_one_point_count_as_a_level_up_before_the_level_shows():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),)), "run", at(0))
    tracker.update(BattleSample((army(mag=21, spd=15),)), "run", at(10))  # the stats are written before the level
    battle = tracker.battle
    assert battle.level_ups == 1 and battle.events[-1].kind == "level_up"
    assert battle.events[-1].text == "Lysithea leveled up (Mag +1, Spd +1)"
    tracker.update(BattleSample((army(level=17, mag=21, spd=15),)), "run", at(11))  # then the level: the same level-up
    assert battle.level_ups == 1 and [e.kind for e in battle.events] == ["start", "level_up"]
    assert battle.events[-1].text == "Lysithea reached level 17 (Mag +1, Spd +1)"
    tracker.update(BattleSample((army(spd=18),)), "run", at(20))  # undone; a +2 booster isn't a level-up
    assert battle.level_ups == 0


def test_a_stat_booster_is_not_a_level_up():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),)), "run", at(0))
    tracker.update(BattleSample((army(spd=16),)), "run", at(10))
    assert tracker.battle.level_ups == 0 and tracker.battle.events[-1].kind == "stat_up"


def test_a_class_change_mid_battle_is_not_growth_or_a_divine_pulse():
    tracker = BattleTracker()
    tracker.update(BattleSample((ArmySample("lorenz", "Lorenz", "Paladin", 20, {**STATS, "mv": 7, "def": 9}),)), "run", at(0))
    tracker.update(BattleSample((ArmySample("lorenz", "Lorenz", "Paladin (dismounted)", 20, {**STATS, "mv": 4, "def": 8}),)), "run", at(10))
    battle = tracker.battle
    assert battle.divine_pulses == 0 and battle.units[0].on_map and battle.units[0].gains() == {}
    assert [e.kind for e in battle.events] == ["start"]


def test_a_level_up_undone_by_divine_pulse_goes_with_its_branch():
    """The level-up happens in the fight whose history entry only shows up when the next action starts."""
    me, foe = "a:lysithea", "e:5"

    def step(turn, actor=None, target=None, hp=(30, 20), phase_start=False):
        return HistoryStep(turn, 0, phase_start, STEP_ATTACK if target else 0x0B, actor, target, False, (StepUnit(me, hp[0], 0, 0), StepUnit(foe, hp[1], 1, 0)))

    start = step(1, phase_start=True)
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), history=(start,)), "run", at(0))
    # Lysithea's fight: she levels up; its entry isn't in the history yet.
    tracker.update(BattleSample((army(level=17, mag=21),), history=(start,)), "run", at(10))
    tracker.update(BattleSample((army(level=17, mag=21),), history=(start, step(1, me, foe, (30, 0)))), "run", at(12))
    # Time is turned back to before the fight.
    tracker.update(BattleSample((army(),), history=(start,)), "run", at(20))
    battle = tracker.battle
    assert battle.level_ups == 0 and battle.divine_pulses == 1
    assert "level_up" not in [e.kind for e in battle.events]
    assert [e.kind for b in battle.branches for e in b.events] == ["level_up"]


def test_stat_gain_without_level_up_and_joining_mid_battle():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),)), "run", at(0))
    tracker.update(BattleSample((army(spd=16), army("leonie", 17))), "run", at(10))  # a Speedwing; Leonie arrives
    kinds = [(e.kind, e.unit) for e in tracker.battle.events]
    assert ("stat_up", "lysithea") in kinds and ("joined", "leonie") in kinds
    assert tracker.battle.events[-1].kind in ("stat_up", "joined")


def test_switching_runs_closes_the_battle():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),)), "run-a", at(0))
    _, finished = tracker.update(BattleSample((army(),)), "run-b", at(5))
    assert finished.run_id == "run-a" and tracker.battle.run_id == "run-b"


# Outlook


def hp_battle(mine: list[int], foes: list[int], allies: list[int] = (), **fields) -> Battle:
    """A battle whose units have the HP given, out of 30 each (far apart, so none is at risk)."""
    b = battle(**fields)
    for i, u in enumerate(b.units):
        u.hp, u.x, u.y = (mine[i] if i < len(mine) else 0), i, 0
        u.on_map = i < len(mine)
    b.enemy_stats = {
        s: EnemyStats(slot=s, label=f"U{s}", hp=hp, max_hp=30, x=30, y=30 + s, side=side)
        for s, (hp, side) in enumerate([*((h, "enemy") for h in foes), *((h, "ally") for h in allies)], 1)
    }
    return b


def battle(**fields) -> Battle:
    units = [BattleUnitStats(key=f"u{i}", name=f"U{i}", start_level=10, level=10, start=STATS, now=STATS) for i in range(4)]
    return Battle(id="b", run_id="r", started_at=T0, **{"units": units, **fields})


def test_outlook_moves_the_right_way():
    even = outlook(battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10))["chance"]
    stronger = outlook(battle(army_power=2000, enemy_power=1000, enemies_start=10, enemies_now=10))["chance"]
    progress = outlook(battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=3))["chance"]
    pulses = outlook(battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10, divine_pulses=3))["chance"]
    assert progress > even
    assert stronger == even  # strength isn't a factor
    assert pulses == even
    hurt = battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10)
    hurt.units[0].on_map = hurt.units[1].on_map = False
    assert outlook(hurt)["chance"] < even
    assert outlook(battle())["confidence"] == "low"
    won = outlook(hp_battle([30, 30, 30, 30], [3, *[0] * 9]))  # 9 of 10 enemies down
    assert won["chance"] == 0.97  # capped: never certain


def test_outlook_explains_itself():
    result = outlook(battle(army_power=400, enemy_power=1000, enemies_start=10, enemies_now=5, divine_pulses=1))
    by_label = {f["label"]: f for f in result["factors"]}
    assert "Strength" not in by_label and by_label["Progress"]["points"] > 0
    assert "Divine Pulse" not in by_label
    assert by_label["Progress"]["detail"] == "5 of 10 enemies down"


def test_outlook_weighs_units_at_risk_by_whether_losing_them_loses_the_battle():
    def at_risk(*keys, hp=8):
        b = battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10)
        for i, u in enumerate(b.units):
            u.hp, u.x, u.y = 30, i, 0
        for i, key in enumerate(keys):
            b.units[i].key, b.units[i].hp = key, hp
        b.enemy_stats = {1: EnemyStats(slot=1, label="Bandit 1", x=2, y=2)}
        return outlook(b)

    safe = at_risk()
    one, two = at_risk("lorenz"), at_risk("lorenz", "leonie")
    leader = at_risk("byleth")
    assert safe["at_risk"] == [] and safe["chance"] > one["chance"] > two["chance"] > leader["chance"]
    assert leader["chance"] < 0.2  # a defeat condition about to fall: really bad
    assert two["chance"] > 0.3  # bad, but the battle goes on without them
    assert [(r["key"], r["level"], r["critical"], r["near"]) for r in leader["at_risk"]] == [("byleth", "danger", True, 1)]
    labels = {f["label"]: f["detail"] for f in leader["factors"]}
    assert labels["Defeat risk"] == "U0 8/30 HP, 1 enemy in reach"
    # No other unit in reach: not at risk.
    b = battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10, units=[BattleUnitStats(key="byleth", name="Byleth", start_level=10, level=10, start=STATS, now=STATS, hp=8, x=0, y=0)])
    b.enemy_stats = {1: EnemyStats(slot=1, label="Bandit 1", x=20, y=20)}
    assert outlook(b)["at_risk"] == []


def test_units_on_your_side_dont_put_yours_at_risk():
    # The prologue: the house leaders (your side, not in the roster yet) and Jeralt (an ally) stand next to Byleth.
    b = battle(units=[BattleUnitStats(key="byleth", name="Byleth", start_level=1, level=1, start=STATS, now=STATS, hp=27, x=10, y=17)])
    b.enemy_stats = {
        s: EnemyStats(slot=s, label=name, x=x, y=y, side=side)
        for s, name, x, y, side in ((1, "Edelgard", 9, 17, "player"), (2, "Dimitri", 11, 17, "player"),
                                    (3, "Claude", 10, 18, "player"), (4, "Jeralt", 9, 19, "ally"))
    }
    assert outlook(b)["at_risk"] == []
    b.enemy_stats[5] = EnemyStats(slot=5, label="Thief 1", x=10, y=16, side="enemy")
    b.enemy_stats[6] = EnemyStats(slot=6, label="Thief 2", x=9, y=16, side="enemy")
    b.enemy_stats[7] = EnemyStats(slot=7, label="Thief 3", x=11, y=16, side="enemy")
    assert outlook(b)["at_risk"][0]["near"] == 3


def _turn(phase, *, acted=0, enemy_acted=(), leader_hp=30, ones=4):
    """Byleth and `ones` others in a row, three bandits within reach of Byleth; `acted` of the army have acted."""
    units = [BattleUnitStats(key="byleth", name="Byleth", start_level=10, level=10, start=STATS, now=STATS, hp=leader_hp, x=5, y=5)]
    units += [BattleUnitStats(key=f"u{i}", name=f"U{i}", start_level=10, level=10, start=STATS, now=STATS, hp=15, x=6 + i, y=5) for i in range(ones)]
    for i, u in enumerate(units):
        u.acted = i < acted
    b = battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10, units=units, turn=3)
    b.enemy_stats = {s: EnemyStats(slot=s, label=f"Bandit {s}", x=5 + s, y=8, weapon="sword") for s in (1, 2, 3)}
    b.log = [LogEntry(t=1, turn=3, kind="phase", text="phase", phase=phase)]
    b.log += [LogEntry(t=2, turn=3, kind="attack", text="hit", phase=1, actor_id=s) for s in enemy_acted]
    return outlook(b)


def test_byleth_exposed_at_the_start_of_the_enemy_phase_is_really_bad():
    start = _turn(1, leader_hp=8)  # a quarter of his HP, three bandits in reach, none has moved yet
    assert start["at_risk"][0]["key"] == "byleth"
    assert start["chance"] < 0.25
    assert any("Enemy Phase, 3 still to act" in f["detail"] for f in start["factors"] if f["label"] == "Defeat risk")
    assert _turn(1)["at_risk"][0]["near"] == 3 and _turn(1)["chance"] < _turn(1, enemy_acted=["e:1", "e:2", "e:3"])["chance"]  # a crowd around him even at full HP


def test_the_outlook_falls_across_the_player_phase_as_units_end_exposed():
    chances = [_turn(0, acted=n, leader_hp=15)["chance"] for n in range(6)]
    assert chances == sorted(chances, reverse=True) and chances[0] > chances[-1] + 0.1
    assert _turn(0, acted=0, leader_hp=15)["at_risk"][0]["pending"] is True
    assert _turn(0, acted=1, leader_hp=15)["at_risk"][0]["pending"] is False  # Byleth has acted: he stays where he is
    # The same position at the start of the enemy phase weighs in full.
    assert _turn(1, leader_hp=15)["chance"] <= chances[-1]


def test_the_outlook_recovers_across_the_enemy_phase_when_exposed_units_survive():
    chances = [_turn(1, enemy_acted=[f"e:{s}" for s in range(1, n + 1)], leader_hp=15)["chance"] for n in range(4)]
    assert chances == sorted(chances) and chances[-1] > chances[0] + 0.1
    assert _turn(1, enemy_acted=["e:1", "e:2", "e:3"], leader_hp=15)["at_risk"] == []


def test_a_unit_boxed_in_by_others_is_out_of_melee_reach():
    def boxed(weapon):
        units = [BattleUnitStats(key="byleth", name="Byleth", start_level=10, level=10, start=STATS, now=STATS, hp=8, x=5, y=5)]
        units += [BattleUnitStats(key=f"u{i}", name=f"U{i}", start_level=10, level=10, start=STATS, now=STATS, hp=30, x=x, y=y) for i, (x, y) in enumerate([(4, 5), (6, 5), (5, 4)])]
        b = battle(army_power=1000, enemy_power=1000, enemies_start=10, enemies_now=10, units=units)
        # The fourth side is held by another unit; a second one stands two tiles off.
        b.enemy_stats = {1: EnemyStats(slot=1, label="Bandit 1", x=5, y=6, hp=0), 2: EnemyStats(slot=2, label="Bandit 2", x=5, y=8, weapon=weapon)}
        b.enemy_stats[1].on_map = False
        b.units.append(BattleUnitStats(key="u9", name="U9", start_level=10, level=10, start=STATS, now=STATS, hp=30, x=5, y=6))
        return outlook(b)["at_risk"]

    assert boxed("axe") == []  # nowhere free next to Byleth
    assert [(r["key"], r["near"]) for r in boxed("bow")] == [("byleth", 1)]  # a bow hits from two tiles off


def test_power_rewards_better_stats():
    assert power({**STATS, "mag": 30}, 20) > power(STATS, 20) > power(STATS, 1)


# The battle pool in game memory


def record(character, level=15, class_id=4, hp=30, flags=0, marker=BATTLE_MARKER) -> bytes:
    r = bytearray(pool.RECORD_SIZE)
    r[pool.RECORD_SIZE - BATTLE_MARKER_TO_COPY : pool.RECORD_SIZE - BATTLE_MARKER_TO_COPY + len(marker)] = marker
    return bytes(r), character, level, class_id, hp, flags


def pool_bytes(units) -> bytes:
    """Records laid out as in the game: each one 0x14 bytes after its marker, 0x330 apart."""
    data = bytearray(pool.RECORD_SIZE * (len(units) + 1))
    for i, (character, level, class_id, hp, flags, marker) in enumerate(units):
        start = pool.RECORD_SIZE * (i + 1)
        data[start - BATTLE_MARKER_TO_COPY : start - BATTLE_MARKER_TO_COPY + len(marker)] = marker
        struct.pack_into("<H", data, start + 0x24, character)
        data[start + 0x4A], data[start + 0x4B], data[start + 0x4C] = level, class_id, hp
        data[start + 0x4E] = 12  # Str
        data[start + 0xAC] = flags
    return bytes(data)


def test_decodes_every_unit_on_the_map():
    cleared = BATTLE_MARKER[:-1] + b"\x01"
    data = pool_bytes([(22, 17, 14, 27, 0x03, BATTLE_MARKER), (217, 16, 77, 24, 0, BATTLE_MARKER), (219, 16, 79, 26, 0, cleared)])
    units = pool.decode_pool(data, pool.RECORD_SIZE, {22}, pool.BattleFields())
    assert [(u.character, u.army, u.level, u.class_id, u.max_hp) for u in units] == [(22, True, 17, 14, 27), (217, False, 16, 77, 24)]
    assert units[0].raw["str"] == 12 and units[0].hp is None  # no current HP without its offset
    assert pool.pool_window([1000, 5000]) == (1000 - 16 * 0x330, 5000 + 160 * 0x330)


# Battle history


def test_battle_store(tmp_path):
    store = BattleStore(tmp_path / "battles")
    assert store.list("run") == []
    store.add(battle(ended_at=at(60)))
    store.add(Battle(id="b2", run_id="run", started_at=T0))
    store.add(Battle(id="b3", run_id="other", started_at=T0))
    assert [b.id for b in store.list("r")] == ["b"]
    assert [b.id for b in store.list("run")] == ["b2"]
    store.delete("run", "b2")
    assert store.list("run") == []
    with pytest.raises(NotFound):
        store.delete("run", "missing")
    with pytest.raises(NotFound):
        store.list("../evil")


# Actions: weapon durability, items and spell uses spent


def acting(spells=(10, 8), items=((22, 40), (1000, 3))) -> ArmySample:
    return ArmySample("lysithea", "Lysithea", "Mage", 16, dict(STATS), tuple(items), tuple(spells))


def test_counts_what_units_spend():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(),)), "run", at(0))
    tracker.update(BattleSample((acting(spells=(9, 8)),)), "run", at(5))  # cast one
    tracker.update(BattleSample((acting(spells=(9, 7), items=((22, 38), (1000, 1))),)), "run", at(9))  # cast, two weapon uses, two Vulneraries
    tracker.update(BattleSample((acting(spells=(9, 7), items=((22, 38),)),)), "run", at(12))  # last Vulnerary used up
    unit = tracker.battle.units[0]
    assert (unit.spells_cast, unit.weapon_uses, unit.item_uses) == (2, 2, 3)
    assert (tracker.battle.spells_cast, tracker.battle.weapon_uses, tracker.battle.item_uses) == (2, 2, 3)


def test_trading_an_item_away_is_not_a_use():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(),)), "run", at(0))
    tracker.update(BattleSample((acting(items=((1000, 3),)),)), "run", at(5))  # the weapon went to the convoy
    tracker.update(BattleSample((acting(items=((1000, 3), (34, 20))),)), "run", at(9))  # and a new one came
    unit = tracker.battle.units[0]
    assert (unit.weapon_uses, unit.item_uses) == (0, 0)


def test_a_sample_without_the_units_record_counts_nothing():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(),)), "run", at(0))
    tracker.update(BattleSample((acting(spells=(), items=()),)), "run", at(5))  # the pool wasn't read this time
    tracker.update(BattleSample((acting(),)), "run", at(9))
    unit = tracker.battle.units[0]
    assert (unit.weapon_uses, unit.item_uses, unit.spells_cast, tracker.battle.divine_pulses) == (0, 0, 0, 0)


def test_spell_uses_coming_back_mean_divine_pulse():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(),)), "run", at(0))
    tracker.update(BattleSample((acting(spells=(8, 8)),)), "run", at(5))
    tracker.update(BattleSample((acting(spells=(9, 8)),)), "run", at(9))  # one cast undone
    assert tracker.battle.divine_pulses == 1 and tracker.battle.units[0].spells_cast == 1
    assert tracker.battle.events[-1].kind == "divine_pulse"


def test_pool_records_carry_inventory_and_spell_uses():
    data = bytearray(pool_bytes([(22, 17, 14, 27, 0x03, BATTLE_MARKER)]))
    start = pool.RECORD_SIZE
    struct.pack_into("<12H", data, start, 34, 21, 622, 100, 1000, 3, 0xFFFF, 0, 0xFFFF, 0, 0xFFFF, 0)
    data[start + 0x24 : start + 0x26] = struct.pack("<H", 22)  # restore the character over the inventory write
    data[start + pool.SPELL_USES : start + pool.SPELL_USES + 3] = bytes([10, 8, 2])
    [unit] = pool.decode_pool(bytes(data), start, {22})
    assert unit.items == ((34, 21), (622, 100), (1000, 3))
    assert unit.item_slot_0 == 34
    assert unit.spell_uses[:4] == (10, 8, 2, 0)

    # The game says a weapon is equipped, but an empty raw slot zero must not be inferred from the compacted list.
    struct.pack_into("<12H", data, start, 0xFFFF, 0, 34, 21, 622, 100, 1000, 3, 0xFFFF, 0, 0xFFFF, 0)
    struct.pack_into("<H", data, start + pool._EQUIPPED, 1)
    [unit] = pool.decode_pool(bytes(data), start, {22})
    assert unit.item_slot_0 is None and unit.items[0] == (34, 21)
    from app.inventory import inventory

    assert inventory(unit.items, equipped_item_id=unit.item_slot_0 if unit.equipped == 1 else None)[0].equipped is False


def test_uses_returned_by_divine_pulse_are_taken_back():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(items=((22, 40),)),)), "run", at(0))
    tracker.update(BattleSample((acting(items=((22, 36),)),)), "run", at(5))
    tracker.update(BattleSample((acting(items=((22, 38),)),)), "run", at(9))  # two uses undone
    assert tracker.battle.units[0].weapon_uses == 2


def test_battle_in_progress_is_saved_for_a_restart(tmp_path):
    store = BattleStore(tmp_path / "battles")
    assert store.load_active("run") is None
    store.save_active(Battle(id="b", run_id="run", key="k", started_at=T0))
    assert store.load_active("run").key == "k" and store.list("run") == []
    store.clear_active("run")
    assert store.load_active("run") is None


def test_a_different_battle_key_starts_a_new_battle():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), key="k1"), "run", at(0))
    _, finished = tracker.update(BattleSample((army(),), key="k2"), "run", at(5))
    assert finished.key == "k1" and tracker.battle.key == "k2"


def test_a_spell_learned_mid_battle_is_not_a_divine_pulse():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(spells=(10, 0)),)), "run", at(0))
    tracker.update(BattleSample((acting(spells=(9, 8)),)), "run", at(5))  # cast one, learned a new spell (8 uses)
    assert tracker.battle.divine_pulses == 0 and tracker.battle.units[0].spells_cast == 1


def test_a_rewind_takes_back_spells_and_weapon_uses_together():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(spells=(10, 8), items=((22, 40),)),)), "run", at(0))
    tracker.update(BattleSample((acting(spells=(9, 8), items=((22, 38),)),)), "run", at(5))
    tracker.update(BattleSample((acting(spells=(10, 8), items=((22, 40),)),)), "run", at(9))  # all undone
    unit = tracker.battle.units[0]
    assert (unit.spells_cast, unit.weapon_uses, tracker.battle.divine_pulses) == (0, 0, 1)


def test_outlook_trend_follows_the_battle():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), enemies(10)), "run", at(0))
    tracker.update(BattleSample((army(),), enemies(10)), "run", at(5))  # nothing changed: no new point
    tracker.update(BattleSample((army(),), enemies(4)), "run", at(60))
    trend = tracker.battle.trend
    assert [p.t for p in trend] == [0, 60] and trend[1].chance > trend[0].chance


# Located fields (current HP, position, turn, Divine Pulse charges): used once battle_fields.json has offsets.


def fighter(key="lysithea", cur=30, x=5, y=5, spells=(10,), level=16, **values) -> ArmySample:
    """An army unit with current HP `cur`; max HP and stats are STATS (hp=30) unless overridden."""
    return ArmySample(key, key.capitalize(), "Mage", level, {**STATS, **values}, (), tuple(spells), cur, x, y)


def foe(slot, hp, max_hp=40) -> EnemySample:
    return EnemySample("Brigand", 15, 100.0, max_hp, hp, slot)


def located(*army, enemies=(), turn=1, charges=3) -> BattleSample:
    return BattleSample(tuple(army), tuple(enemies), "k", turn, charges)


def test_fields_file(tmp_path):
    path = tmp_path / "fields.json"
    path.write_text('{"unit": {"hp": "0x2a0", "x": 680, "y": null}, "globals": {"turn": "0x10"}}')
    f = pool.BattleFields.load(path)
    assert (f.hp, f.x, f.y, f.turn, f.divine_pulse_charges) == (0x2A0, 680, None, 0x10, None)
    assert pool.BattleFields.load(tmp_path / "missing.json") == pool.BattleFields()
    data = bytearray(pool_bytes([(22, 17, 14, 27, 0x03, BATTLE_MARKER)]))
    data[pool.RECORD_SIZE + 0x2A0] = 19
    data[pool.RECORD_SIZE + 680] = 7
    [unit] = pool.decode_pool(bytes(data), pool.RECORD_SIZE, {22}, f)
    assert (unit.hp, unit.x, unit.y, unit.slot) == (19, 7, None, 1)
    # The slot follows the record's address, not its place in the window that was read.
    [moved] = pool.decode_pool(bytes(data[0x100:]), pool.RECORD_SIZE - 0x100, {22}, f, base=0x100)
    assert moved.slot == unit.slot


def test_hp_turns_and_defeats_from_each_read():
    tracker = BattleTracker()
    tracker.update(located(fighter(), fighter("claude", x=9), enemies=(foe(1, 40), foe(2, 40))), "run", at(0))
    battle = tracker.battle
    assert (battle.army_hp, battle.enemy_hp, battle.enemies_defeated, battle.turn) == (60, 80, 0, 1)
    # Turn 2, after an enemy phase skipped through: whatever happened, each read shows where things stand.
    tracker.update(located(fighter(cur=22, x=7), fighter("claude", x=9), enemies=(foe(1, 0), foe(2, 15)), turn=2), "run", at(20))
    assert (battle.army_hp, battle.enemy_hp, battle.enemies_defeated, battle.turn) == (52, 15, 1, 2)
    assert "turn" in [e.kind for e in battle.events]
    # Damage, healing and moves come only from the game's history: not tracked without it.
    lys = battle.units[1]
    assert (lys.damage_dealt, lys.damage_taken, lys.healed, lys.tiles_moved) == (None, None, None, None) and battle.log == []
    assert battle.enemy_stats[2].damage_taken is None


def test_turn_or_charges_going_back_is_a_divine_pulse():
    tracker = BattleTracker()
    tracker.update(located(fighter(cur=30), enemies=(foe(1, 10),), turn=3, charges=3), "run", at(0))
    tracker.update(located(fighter(cur=20), enemies=(foe(1, 0),), turn=3, charges=3), "run", at(5))  # enemy 1 defeated
    assert tracker.battle.enemies_defeated == 1
    tracker.update(located(fighter(cur=30), enemies=(foe(1, 10),), turn=2, charges=2), "run", at(9))  # turned back to turn 2
    battle = tracker.battle
    assert battle.divine_pulses == 1 and battle.divine_pulse_charges == 2 and battle.turn == 2
    assert battle.enemies_defeated == 0  # back on the map


def test_outlook_uses_health_when_known():
    hurt = hp_battle([6, 6, 6, 6], [27, 27])
    fine = hp_battle([30, 27, 30, 27], [9, 9])
    assert outlook(fine)["chance"] > outlook(hurt)["chance"]
    assert outlook(fine)["confidence"] == "medium" and outlook(battle())["confidence"] == "low"
    assert any(f["label"] == "Health" for f in outlook(fine)["factors"])


def test_outlook_progress_counts_only_enemies_that_have_been_on_the_map():
    b = hp_battle([30], [15, 0, 0], allies=[30], enemies_start=11, enemies_now=7)  # stale totals from an older count
    b.enemy_stats[9] = EnemyStats(slot=9, label="Reinforcement", hp=20, max_hp=20, on_map=False, side="enemy")
    detail = next(f["detail"] for f in outlook(b)["factors"] if f["label"] == "Progress")
    assert detail == "2 of 3 enemies down"


def test_outlook_health_is_each_units_share_of_hp_not_the_pool():
    # 30/30 and 10/60: 58% on average (the pool would say 40/90, 44%).
    def hurt_giant(**extra):
        b = hp_battle([30, 10], [15, 15], **extra)
        b.units[1].now = {**STATS, "hp": 60}
        return next(f["detail"] for f in outlook(b)["factors"] if f["label"] == "Health")

    assert hurt_giant() == "Your Units 58% HP, Enemy Units 50%"
    assert hurt_giant(allies=[1]) == hurt_giant()  # allies count for neither side




def test_tracks_what_units_have_left():
    tracker = BattleTracker()
    tracker.update(BattleSample((acting(spells=(3, 2), items=((22, 4), (30, 0), (1000, 3))),)), "run", at(0))
    unit = tracker.battle.units[0]
    assert (unit.spell_uses_left, unit.spell_uses_full, unit.weakest_weapon, unit.broken_weapons, unit.consumables_left) == (5, 5, 4, 1, 3)
    changed, _ = tracker.update(BattleSample((acting(spells=(2, 2), items=((22, 3), (30, 0), (1000, 2))),)), "run", at(5))
    assert changed and (unit.spell_uses_left, unit.spell_uses_full, unit.weakest_weapon, unit.consumables_left) == (4, 5, 3, 2)
    assert (tracker.battle.spell_uses_left, tracker.battle.spell_uses_full) == (4, 5)
    tracker.update(BattleSample((acting(spells=(), items=()),)), "run", at(9))  # record not read: keep what we knew
    assert unit.spell_uses_left == 4


def test_inventory_names_items_and_spells(roster_import):
    from app.inventory import inventory

    got = inventory(((16, 33), (616, 0), (1000, 2), (1199, 1)), (7, 0, 0), (0, None, 4))
    assert [(i.name, i.kind, i.uses, i.full) for i in got] == [
        ("Iron Sword", "weapon", 33, 40),
        ("March Ring", "equipment", 0, None),
        ("Vulnerary", "item", 2, None),
        ("Item", "item", 1, None),  # not in the game tables yet
        ("Fire", "spell", 7, 10),
        ("Thoron", "spell", 0, 4),
    ]
    # What each weapon and spell fights with, for its icon.
    assert [i.weapon for i in got] == ["sword", None, None, None, "reason", "reason"]

    # Slot zero is marked only when memory explicitly identifies the equipped weapon.
    assert [i.equipped for i in inventory(((16, 33), (22, 30)))] == [False, False]
    assert [i.equipped for i in inventory(((16, 33), (22, 30)), equipped_item_id=16)] == [True, False]
    assert [i.equipped for i in inventory(((22, 30),), equipped_item_id=16)] == [False]
    assert [i.equipped for i in inventory(((616, 100), (616, 50)), equipped_accessory_id=616)] == [True, False]


def test_units_carry_their_inventory(roster_import):
    tracker = BattleTracker()
    unit_sample = replace(acting(spells=(9,), items=((16, 40), (1000, 3))), spell_ids=(0,))
    foe_sample = replace(EnemySample("Brigand", 15, 100.0, 30, 30, 4), items=((22, 30), (616, 0)))
    tracker.update(BattleSample((unit_sample,), (foe_sample,)), "run", at(0))
    unit = tracker.battle.units[0]
    assert [(i.name, i.uses) for i in unit.inventory] == [("Iron Sword", 40), ("Vulnerary", 3), ("Fire", 9)]
    assert [(i.name, i.uses, i.equipped) for i in tracker.battle.enemy_stats[4].inventory] == [
        ("Iron Lance", 30, False), ("March Ring", 0, True),
    ]
    assert tracker.battle.enemy_stats[4].accessory == "March Ring"
    changed, _ = tracker.update(BattleSample((replace(unit_sample, items=((16, 39), (1000, 3))),), (foe_sample,)), "run", at(5))
    assert changed and unit.inventory[0].uses == 39
    assert Battle.model_validate(tracker.battle.model_dump(mode="json")).units[0].inventory == unit.inventory  # saved and loaded


def test_equipped_weapon_and_accessory_are_carried_into_battle_api():
    tracker = BattleTracker()
    sample = replace(
        acting(items=((16, 40), (616, 100), (22, 30))), equipped_weapon=True, equipped_item_id=16,
        accessory="March Ring", equipped_accessory_id=616,
    )
    tracker.update(BattleSample((sample,)), "run", at(0))
    unit = tracker.battle.units[0]
    assert [item.equipped for item in unit.inventory] == [True, True, False]
    assert unit.accessory == "March Ring"
    assert Battle.model_validate(tracker.battle.model_dump(mode="json")).units[0].accessory == "March Ring"


def test_losing_byleth_sinks_the_outlook():
    from app.battle import BattleUnitStats

    def unit(key, on_map=True):
        return BattleUnitStats(key=key, name=key.capitalize(), start_level=10, level=10, start=dict(STATS), now=dict(STATS), on_map=on_map)

    fine = battle(army_power=2000, enemy_power=1000, units=[unit("byleth"), unit("lysithea")])
    lost = battle(army_power=2000, enemy_power=1000, units=[unit("byleth", on_map=False), unit("lysithea")])
    assert outlook(fine)["chance"] > 0.5
    assert outlook(lost)["chance"] <= 0.1 and any(f["label"] == "Defeat" for f in outlook(lost)["factors"])




def test_trend_follows_hp_once_located():
    tracker = BattleTracker()
    tracker.update(located(fighter(cur=30), enemies=(foe(1, 40),)), "run", at(0))
    tracker.update(located(fighter(cur=15, spells=(9,)), enemies=(foe(1, 20),)), "run", at(5))
    first, last = tracker.battle.trend[0], tracker.battle.trend[-1]
    assert (first.army_hp, first.enemy_hp) == (1.0, 1.0) and (last.army_hp, last.enemy_hp) == (0.5, 0.5)


def test_fights_and_defeats_come_from_the_combat_counters_even_when_several_land_in_one_read():
    # Modelled on a real enemy phase that finished between two reads: four fights at once.
    def me(key, x, y, hp, fights, wins, start=(50, 35)):
        return ArmySample(key, key.capitalize(), "Mage", 18, dict(STATS, hp=45), (), (5,), hp, x, y, fights, wins, *start)

    def bandit(slot, x, y, hp, fights, wins=0):
        return EnemySample("Fighter", 16, 120.0, 36, hp, slot, x, y, "Bandit", fights, wins)

    before = BattleSample(
        (me("byleth", 3, 25, 41, 106, 43, (100, 43)), me("cyril", 2, 26, 39, 58, 35), me("hanneman", 2, 24, 31, 53, 30, (50, 30))),
        (bandit(1, 9, 9, 31, 1), bandit(2, 9, 12, 13, 1), bandit(3, 12, 9, 35, 0)),
        "k", 4, 6,
    )
    after = BattleSample(
        (me("byleth", 3, 25, 41, 107, 43, (100, 43)), me("cyril", 2, 26, 27, 59, 36), me("hanneman", 2, 24, 18, 54, 30, (50, 30))),
        # bandit 1 attacked Byleth (missed), bandit 2 attacked Cyril and died to his counter, bandit 3 hit Hanneman
        (bandit(1, 3, 24, 31, 2), bandit(2, 2, 27, 0, 2), bandit(3, 1, 24, 20, 1)),
        "k", 4, 6,
    )
    tracker = BattleTracker()
    tracker.update(before, "run", at(0))
    tracker.update(after, "run", at(1))
    battle = tracker.battle
    byleth, cyril, hanneman = battle.units
    assert battle.enemy_labels == {1: "Bandit 1", 2: "Bandit 2", 3: "Bandit 3"}
    assert (cyril.defeats, cyril.combats, byleth.combats) == (1, 9, 7)  # counters: 36 - 35 wins, 59 - 50 fights
    stats = battle.enemy_stats
    assert (stats[2].on_map, stats[2].combats, stats[3].combats) == (False, 2, 1)
    assert battle.enemies_now == 2 and battle.enemies_defeated == 1  # the defeated one stays in memory with 0 HP
    # Without the pool's records (or the game's history) nothing says who fought whom: no damage is made up.
    assert battle.log == [] and byleth.damage_dealt is None


@pytest.mark.parametrize("skip_enemy_phase", [False, True], ids=["one-action-per-read", "enemy-phase-between-reads"])
def test_the_games_history_drives_the_log_and_stats(skip_enemy_phase):
    from app.battle import STEP_ATTACK, HistoryStep, StepUnit

    def u(uid, hp, x, y):
        return StepUnit(uid, hp, x, y, 30 if uid.startswith("a:") else None)

    def me(key, hp, x, y):
        return ArmySample(key, key.capitalize(), "Mage", 16, dict(STATS, hp=40), (), (5,), hp, x, y)

    def brigand(slot, hp, x, y):
        return EnemySample("Brigand", 15, 100.0, 36, hp, slot, x, y)

    everyone = (u("a:byleth", 40, 3, 25), u("a:lysithea", 40, 1, 28), u("e:7", 36, 3, 21), u("e:8", 30, 9, 9))
    steps = [
        HistoryStep(1, 0, True, units=everyone),  # Fight!
        HistoryStep(1, 0, False, actor="a:byleth", moved=True, units=(u("a:byleth", 40, 2, 22),)),
        HistoryStep(1, 0, False, STEP_ATTACK, "a:lysithea", "e:7", units=(u("a:lysithea", 32, 1, 28), u("e:7", 19, 3, 21))),
        # The enemy phase starts; Brigand 2 moved without an entry of its own (folded in).
        HistoryStep(1, 1, True, units=(u("a:byleth", 40, 2, 22), u("a:lysithea", 32, 1, 28), u("e:7", 19, 3, 21), u("e:8", 30, 4, 9))),
        HistoryStep(1, 1, False, STEP_ATTACK, "e:7", "a:byleth", units=(u("a:byleth", 35, 2, 22), u("e:7", 0, 3, 22))),
        HistoryStep(2, 0, True, units=(u("a:byleth", 35, 2, 22), u("a:lysithea", 32, 1, 28), u("e:7", 0, 3, 22), u("e:8", 30, 4, 9))),
        HistoryStep(2, 0, False, 0x05, "a:lysithea", "a:byleth", units=(u("a:byleth", 40, 2, 22), u("a:lysithea", 32, 1, 28))),  # a heal
    ]

    def read(n, charges=6):
        turn = steps[n - 1].turn
        first = brigand(7, 0, 3, 22) if n >= 5 else brigand(7, 19, 3, 21)  # defeated in step 5
        return BattleSample((me("byleth", 40, 2, 22), me("lysithea", 32, 1, 28)), (first, brigand(8, 30, 4, 9)), "k", turn, charges, tuple(steps[:n]))

    tracker = BattleTracker()
    # Action Skip can add the entire enemy phase and the next phase marker to one read.
    reads = (1, 2, 3, 6, 7) if skip_enemy_phase else range(1, len(steps) + 1)
    for n in reads:
        tracker.update(read(n), "run", at(n))
    battle = tracker.battle
    log = [e.text for e in battle.log]
    assert log == [
        "Fight!",
        "Byleth moved.",
        "Lysithea's attack dealt 17 damage to Brigand 1. Brigand 1 hit back for 8.",
        "Began enemy phase.",
        "Brigand 1's attack dealt 5 damage to Byleth. Byleth hit back for 19.",
        "Byleth killed Brigand 1.",
        "Turn 2: began player phase.",
        "Lysithea restored 5 HP to Byleth.",
    ]
    assert battle.log[2].unit == "lysithea" and battle.log[2].target == "Brigand 1" and battle.log[4].target == "byleth"
    # The same, structured, for the page's per-unit fight lists.
    fights = [(e.actor_id, e.target_id, e.dealt, e.taken, e.phase) for e in battle.log if e.kind == "attack"]
    assert fights == [("a:lysithea", "e:7", 17, 8, 0), ("e:7", "a:byleth", 5, 19, 1)]
    assert (battle.log[5].actor_id, battle.log[5].target_id) == ("a:byleth", "e:7")  # the defeat
    assert (battle.log[1].actor_id, battle.log[7].restored, battle.log[7].target_id) == ("a:byleth", 5, "a:byleth")
    units = {x.key: x for x in battle.units}
    assert (units["byleth"].damage_dealt, units["byleth"].damage_taken, units["byleth"].healed, units["byleth"].tiles_moved) == (19, 5, 5, 4)
    assert (units["lysithea"].damage_dealt, units["lysithea"].damage_taken, units["lysithea"].healing_given) == (17, 8, 5)
    first, second = battle.enemy_stats[7], battle.enemy_stats[8]
    assert (first.damage_dealt, first.damage_taken, first.tiles_moved, first.defeated_by) == (13, 36, 1, "Byleth")
    assert second.tiles_moved == 5
    assert battle.enemies_defeated == 1

    # Started mid-battle: the game's history still covers it all.
    late = BattleTracker()
    late.update(read(len(steps)), "run", at(30))
    assert [e.text for e in late.battle.log] == log
    assert late.battle.units[0].damage_dealt == 19 and late.battle.enemy_stats[7].defeated_by == "Byleth"

    # A read that missed the history keeps the log as it was.
    tracker.update(BattleSample(read(len(steps)).army, read(len(steps)).enemies, "k", 2, 6), "run", at(40))
    assert [e.text for e in battle.log] == log

    # Divine Pulse back to before the enemy phase: the rest of the history is gone, and so are its effects.
    tracker.update(read(3, charges=5), "run", at(50))
    assert [e.text for e in battle.log][-2:] == ["Lysithea's attack dealt 17 damage to Brigand 1. Brigand 1 hit back for 8.", "Turned back time with Divine Pulse."]
    assert battle.divine_pulses == 1 and battle.enemies_defeated == 0 and units["byleth"].damage_taken == 0
    assert battle.enemy_stats[7].defeated_by is None and battle.enemy_stats[7].damage_taken == 17
    # Playing on from there: new entries follow the mark.
    tracker.update(BattleSample(read(3).army, read(3).enemies, "k", 1, 5, (*steps[:3], HistoryStep(1, 0, False, actor="a:byleth", units=(u("a:byleth", 40, 2, 22),)))), "run", at(55))
    assert [e.text for e in battle.log][-2:] == ["Turned back time with Divine Pulse.", "Byleth waited."]


def test_positions_and_the_map_size_follow_each_read():
    tracker = BattleTracker()
    tracker.update(located(fighter(x=3, y=29), fighter("claude", x=9, y=4), enemies=(EnemySample("Brigand", 15, 100.0, 40, 40, 1, 12, 7),)), "run", at(0))
    battle = tracker.battle
    units = {u.key: u for u in battle.units}
    assert (units["lysithea"].x, units["lysithea"].y, battle.enemy_stats[1].x, battle.enemy_stats[1].y) == (3, 29, 12, 7)
    assert (battle.map_w, battle.map_h) == (13, 30)
    # A move alone is a change worth showing.
    changed, _ = tracker.update(located(fighter(x=4, y=27), fighter("claude", x=9, y=4), enemies=(EnemySample("Brigand", 15, 100.0, 40, 40, 1, 12, 7),)), "run", at(5))
    assert changed and (units["lysithea"].x, units["lysithea"].y) == (4, 27)
    changed, _ = tracker.update(located(fighter(x=4, y=27), fighter("claude", x=9, y=4), enemies=(EnemySample("Brigand", 15, 100.0, 40, 40, 1, 11, 7),)), "run", at(7))
    assert changed and battle.enemy_stats[1].x == 11
    # A defeated unit keeps the tile it fell on; the map never shrinks; a read without a position keeps the last one.
    tracker.update(located(fighter(x=4, y=27), ArmySample("claude", "Claude", "Mage", 16, dict(STATS), (), (10,), 30), enemies=(EnemySample("Brigand", 15, 100.0, 40, 0, 1, 12, 7),)), "run", at(9))
    assert (battle.enemy_stats[1].x, battle.enemy_stats[1].on_map) == (12, False)
    assert (units["claude"].x, units["claude"].y) == (9, 4) and (battle.map_w, battle.map_h) == (13, 30)
    # Saved and loaded: the positions go with the battle.
    assert Battle.model_validate_json(battle.model_dump_json()).units[0].x == battle.units[0].x


def test_the_history_gives_where_everyone_stood_at_each_step():
    from app.battle import STEP_ATTACK, HistoryStep, StepUnit

    def u(uid, hp, x, y):
        return StepUnit(uid, hp, x, y, 30 if uid.startswith("a:") else None)

    me = ArmySample("byleth", "Byleth", "Noble", 16, dict(STATS), (), (5,), 30, 2, 22)
    steps = (
        HistoryStep(1, 0, True, units=(u("a:byleth", 30, 3, 25), u("e:7", 36, 3, 21))),
        HistoryStep(1, 0, False, actor="a:byleth", moved=True, units=(u("a:byleth", 30, 2, 22),)),
        HistoryStep(1, 0, False, STEP_ATTACK, "a:byleth", "e:7", units=(u("a:byleth", 30, 2, 22), u("e:7", 20, 3, 21))),
        HistoryStep(1, 1, True, units=(u("a:byleth", 30, 2, 22), u("e:7", 20, 3, 21))),
    )
    tracker = BattleTracker()
    tracker.update(BattleSample((me,), (EnemySample("Brigand", 15, 100.0, 36, 20, 7, 3, 21),), "k", 1, 3, steps), "run", at(0))
    battle = tracker.battle
    moves = [(m.step, m.turn, m.phase, m.actor, m.target, m.units) for m in battle.map_steps]
    assert moves == [
        (0, 1, 0, None, None, {"a:byleth": (3, 25, 30), "e:7": (3, 21, 36)}),  # everyone, where they started
        (1, 1, 0, "a:byleth", None, {"a:byleth": (2, 22, 30)}),
        (2, 1, 0, "a:byleth", "e:7", {"e:7": (3, 21, 20)}),  # only what changed
        (3, 1, 1, None, None, {}),
    ]
    assert (battle.map_w, battle.map_h) == (4, 26)
    # The steps line up with the log's.
    assert [e.step for e in battle.log] == [0, 1, 2, 3]


def test_enemies_are_named_again_when_their_names_change():
    # A battle started with wrong names (a unit using another character's name), then the names were corrected.
    def other(slot, name):
        return EnemySample("Fighter", 16, 120.0, 36, 36, slot, 1, slot, name=name)

    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), (other(1, "Bandit"), other(2, "Trader"), other(3, "Bandit")), "k"), "run", at(0))
    assert tracker.battle.enemy_labels == {1: "Bandit 1", 2: "Trader 1", 3: "Bandit 2"}
    tracker.update(BattleSample((army(),), (other(1, "Bandit"), other(2, "Bandit Leader"), other(3, "Bandit")), "k"), "run", at(1))
    assert tracker.battle.enemy_labels == {1: "Bandit 1", 2: "Bandit Leader 1", 3: "Bandit 2"}
    assert tracker.battle.enemy_stats[2].label == "Bandit Leader 1" and tracker.battle.enemy_stats[2].name == "Bandit Leader"


def test_characters_of_their_own_are_named_without_a_number():
    tracker = BattleTracker()
    jeralt = EnemySample("Paladin", 20, 150.0, 45, 45, 4, 1, 1, name="Jeralt", character=35)
    villager = EnemySample("Commoner", 16, 50.0, 26, 26, 5, 2, 2, name="Villager")
    tracker.update(BattleSample((army(),), (jeralt, villager), "k"), "run", at(0))
    assert tracker.battle.enemy_labels == {4: "Jeralt", 5: "Villager 1"}
    tracker.update(BattleSample((army(),), (jeralt, villager), "k"), "run", at(1))  # not numbered again
    assert tracker.battle.enemy_labels == {4: "Jeralt", 5: "Villager 1"}


def test_breakable_walls_are_objects_not_enemies():
    from app.battle import side_of

    assert side_of(4) == "object" and side_of(1, "Breakable Wall") == "object"
    assert (side_of(1), side_of(2), side_of(3), side_of(None)) == ("enemy", "ally", "third", "enemy")


def test_when_other_units_come_and_go_is_noted_for_the_replay():
    # The Remire Calamity: Tomas (an ally) is on the map from the start, Solon (an enemy) waits off it on the same
    # tile; when Tomas is revealed as Solon, Tomas leaves the map and Solon comes onto it. A reinforcement that hasn't
    # arrived stays off it.
    from app.battle import HistoryStep, StepUnit
    from app.gamemem.battle import BattleUnit

    me = ArmySample("byleth", "Byleth", "Noble", 16, dict(STATS), (), (5,), 30, 2, 2)

    def record(slot):
        return BattleUnit(0, False, 10, 0, {"hp": 30}, hp=30, x=5, y=5, slot=slot)

    def step(n, *units):
        return HistoryStep(1, 0, n == 0, actor=None if n == 0 else "a:byleth", units=tuple(StepUnit(uid, 30, 5, 5) for uid in units))

    everyone = ("a:byleth", "e:10", "e:11", "e:12")
    tomas = EnemySample("Noble", 10, 50.0, 30, 30, 10, 5, 5, name="Tomas", side="ally", character=55)
    solon = EnemySample("Dark Bishop", 10, 50.0, 30, 30, 11, 5, 5, name="Solon", side="enemy", character=39)
    tracker = BattleTracker()
    history = (step(0, *everyone), step(1, "a:byleth"))
    tracker.update(BattleSample((me,), (tomas,), "k", 1, 3, history, units=(record(10),), hidden=frozenset({"e:11", "e:12"})), "run", at(0))
    battle = tracker.battle
    assert battle.map_presence == {"e:11": [(0, False)], "e:12": [(0, False)]}
    # Seen while step 1 is the newest: the swap shows from step 2, the next one the game adds.
    history = (*history, step(2, "a:byleth"))
    tracker.update(BattleSample((me,), (solon,), "k", 1, 3, history[:2], units=(record(11),), hidden=frozenset({"e:10", "e:12"})), "run", at(1))
    assert battle.map_presence == {"e:10": [(2, False)], "e:11": [(0, False), (2, True)], "e:12": [(0, False)]}
    tracker.update(BattleSample((me,), (solon,), "k", 1, 3, history, units=(record(11),), hidden=frozenset({"e:10", "e:12"})), "run", at(2))
    assert battle.map_presence["e:10"] == [(2, False)]
    # The map as it stands: Tomas is off it, Solon on it, from this read alone.
    tomas_now, solon_now = battle.enemy_stats[10], battle.enemy_stats[11]
    assert (tomas_now.on_map, tomas_now.left, solon_now.on_map, solon_now.left) == (False, True, True, False)
    assert solon_now.label == "Solon" and solon_now.character == 39
    # Saved and loaded: it goes with the battle.
    assert Battle.model_validate_json(battle.model_dump_json()).map_presence == battle.map_presence
    # A unit seen before that a read doesn't have at all (its record gone) is off the map too.
    history = (*history, step(3, "a:byleth"))
    tracker.update(BattleSample((me,), (), "k", 1, 3, history, units=(record(1),), hidden=frozenset({"e:10", "e:12"})), "run", at(3))
    assert battle.map_presence["e:11"] == [(0, False), (2, True), (4, False)] and battle.enemy_stats[11].left


def test_every_read_shows_who_is_on_the_map_now():
    # The Remire Calamity: villagers flee in a cutscene (taken off the map, HP left); a defeated unit stays where it
    # fell; a read with no units (the pool not read) changes nothing.
    from app.gamemem.battle import BattleUnit

    me = ArmySample("byleth", "Byleth", "Noble", 16, dict(STATS), (), (5,), 30, 2, 2)
    pool_read = (BattleUnit(0, True, 16, 0, {"hp": 30}, hp=30, x=2, y=2, slot=1),)
    villager = EnemySample("Commoner", 1, 10.0, 26, 17, 20, 18, 6, name="Villager", side="ally")
    bandit = EnemySample("Brigand", 3, 20.0, 30, 30, 21, 4, 4, name="Bandit")
    tracker = BattleTracker()

    def read(t, *others, units=pool_read):
        return tracker.update(BattleSample((me,), others, "k", 1, 3, units=units), "run", at(t))

    read(0, villager, bandit)
    battle = tracker.battle
    gone, fell = battle.enemy_stats[20], battle.enemy_stats[21]
    read(1, units=())
    assert (gone.on_map, gone.left, fell.on_map) == (True, False, True)
    read(2, replace(bandit, hp=0))
    assert (gone.on_map, gone.left, gone.hp, (gone.x, gone.y)) == (False, True, 17, (18, 6))
    assert (fell.on_map, fell.left, fell.hp) == (False, False, 0)
    # Back on the map in a later read (time turned back): shown again.
    changed, _ = read(3, villager, bandit)
    assert changed and (gone.on_map, gone.left, fell.on_map) == (True, False, True)
    # The same record now holding someone else: everything about it is as read.
    read(4, villager, replace(bandit, class_name="Fighter", level=5, max_hp=35, hp=35, name="Thief"))
    assert (fell.class_name, fell.level, fell.max_hp, fell.name, fell.label) == ("Fighter", 5, 35, "Thief", "Thief 1")


def test_a_heal_with_an_attacks_action_code_is_a_heal():
    # In game, Heal steps carry action 0x03 (as a defeat does): the target getting HP back decides.
    from app.battle import STEP_DEFEAT, HistoryStep, StepUnit

    def u(uid, hp):
        return StepUnit(uid, hp, 1, 1, 40)

    def me(key, hp):
        return ArmySample(key, key.capitalize(), "Monk", 18, dict(STATS, hp=40), (), (5,), hp, 1, 1)

    steps = [
        HistoryStep(3, 0, True, units=(u("a:flayn", 13), u("a:lorenz", 8))),
        HistoryStep(3, 0, False, STEP_DEFEAT, "a:flayn", "a:lorenz", units=(u("a:flayn", 13), u("a:lorenz", 23))),
    ]
    tracker = BattleTracker()
    for n in (1, 2):
        sample = BattleSample((me("flayn", 13), me("lorenz", 8 if n == 1 else 23)), (), "k", 3, 6, tuple(steps[:n]))
        tracker.update(sample, "run", at(n))
    log = [(e.kind, e.text) for e in tracker.battle.log]
    assert log[-1] == ("heal", "Flayn restored 15 HP to Lorenz.")
    assert not [e for e in tracker.battle.log if e.kind == "attack"]


def test_staves_and_items_are_named_in_the_log(roster_import):
    from app.battle import STEP_ITEM, STEP_SPELL, STEP_WAIT, HistoryStep, StepUnit

    def u(uid, hp, x=1, y=1):
        return StepUnit(uid, hp, x, y, 40)

    def me(key, hp):
        return ArmySample(key, key.capitalize(), "Monk", 18, dict(STATS, hp=40), (), (5,), hp, 1, 1)

    steps = [
        HistoryStep(1, 0, True, units=(u("a:flayn", 30), u("a:lysithea", 20, 5, 5), u("a:manuela", 40))),
        # Rescue (36): Lysithea comes over, no HP changes. Before, this showed as "Flayn healed Lysithea +0 HP".
        HistoryStep(1, 0, False, STEP_SPELL, "a:flayn", "a:lysithea", units=(u("a:flayn", 30), u("a:lysithea", 20, 1, 2)), spell=36),
        # Heal (24) restores HP.
        HistoryStep(1, 0, False, STEP_SPELL, "a:manuela", "a:lysithea", units=(u("a:manuela", 40), u("a:lysithea", 30, 1, 2)), spell=24),
        # A Vulnerary (1000), and an item the tracker doesn't know.
        HistoryStep(1, 0, False, STEP_ITEM, "a:flayn", units=(u("a:flayn", 40),), item=1000),
        HistoryStep(1, 0, False, STEP_ITEM, "a:flayn", units=(u("a:flayn", 40),), item=1999),
        # Something not identified done to one of your own, with no HP change: not called a heal.
        HistoryStep(1, 0, False, 0x07, "a:manuela", "a:flayn", units=(u("a:manuela", 40), u("a:flayn", 40))),
        HistoryStep(1, 0, False, 0x07, "a:manuela", units=(u("a:manuela", 40),)),
        HistoryStep(1, 0, False, STEP_WAIT, "a:manuela", units=(u("a:manuela", 40),)),
    ]
    tracker = BattleTracker()
    army = (me("flayn", 40), me("lysithea", 30), me("manuela", 40))
    tracker.update(BattleSample(army, (), "k", 1, 3, tuple(steps)), "run", at(1))
    log = [(e.kind, e.text, e.detail, e.restored) for e in tracker.battle.log[1:]]
    assert log == [
        ("spell", "Flayn used Rescue on Lysithea.", "Rescue", None),
        ("heal", "Manuela used Heal on Lysithea. Restored 10 HP.", "Heal", 10),
        ("item", "Flayn used Vulnerary. Recovered 10 HP.", "Vulnerary", 10),
        ("item", "Flayn used an item.", None, None),
        ("act", "Manuela acted on Flayn.", None, None),
        ("act", "Manuela acted.", None, None),
        ("wait", "Manuela waited.", None, None),
    ]
    lys = next(x for x in tracker.battle.units if x.key == "lysithea")
    assert (lys.healed, lys.tiles_moved) == (10, 7)


def test_a_divine_pulse_keeps_the_undone_timeline_as_a_branch():
    from app.battle import STEP_ATTACK, HistoryStep, StepUnit

    def u(uid, hp, x=1, y=1):
        return StepUnit(uid, hp, x, y, 40 if uid.startswith("a:") else None)

    def me(key, hp):
        return ArmySample(key, key.capitalize(), "Mage", 16, dict(STATS, hp=40), (), (5,), hp, 1, 1)

    def brigand(hp):
        return EnemySample("Brigand", 15, 100.0, 36, hp, 7, 3, 3)

    start = HistoryStep(1, 0, True, units=(u("a:byleth", 40), u("a:lysithea", 40), u("e:7", 36)))
    moved = HistoryStep(1, 0, False, actor="a:byleth", moved=True, units=(u("a:byleth", 40, 2, 2),))
    enemy_phase = HistoryStep(1, 1, True, units=(u("a:byleth", 40, 2, 2), u("a:lysithea", 40), u("e:7", 36)))
    kill = HistoryStep(1, 1, False, STEP_ATTACK, "e:7", "a:lysithea", units=(u("a:lysithea", 0), u("e:7", 36)))
    hit = HistoryStep(1, 1, False, STEP_ATTACK, "e:7", "a:byleth", units=(u("a:byleth", 35, 2, 2), u("e:7", 30)))
    waited = HistoryStep(1, 0, False, actor="a:lysithea", units=(u("a:lysithea", 40),))

    tracker = BattleTracker()

    def read(n, steps, army, charges):
        tracker.update(BattleSample(army, (brigand(36),), "k", 1, charges, tuple(steps)), "run", at(n))

    both = (me("byleth", 40), me("lysithea", 40))
    for n, steps in enumerate(([start], [start, moved], [start, moved, enemy_phase]), 1):
        read(n, steps, both, 6)
    read(4, [start, moved, enemy_phase, kill], (me("byleth", 40),), 6)  # Lysithea fell
    battle = tracker.battle
    assert [e.kind for e in battle.events].count("left") == 1 and battle.enemy_stats[7].defeats == 1
    # Presence observations and delta frames belong to the timeline that was active when it was rewound.
    battle.map_presence = {"e:7": [(0, False), (2, True)]}
    original_steps = [step.model_dump() for step in battle.map_steps]

    # Divine Pulse back to the start of the enemy phase; this time the brigand attacks Byleth.
    read(5, [start, moved, enemy_phase, hit], (me("byleth", 35), me("lysithea", 40)), 5)
    assert "Lysithea fell." not in [e.text for e in battle.log] and "left" not in [e.kind for e in battle.events]
    assert [e.text for e in battle.log if e.kind == "pulse"] == ["Turned back time with Divine Pulse."]
    assert not [e for e in battle.events if e.kind == "divine_pulse"]  # (the log's line says it)
    [first] = battle.branches
    assert (first.id, first.parent, first.fork) == (1, 0, 3)
    assert [e.kind for e in first.log] == ["attack", "fell"] and [e.kind for e in first.events] == ["left"]
    assert [step.model_dump() for step in first.map_steps] == original_steps
    assert first.map_presence == {"e:7": [(0, False), (2, True)]}
    assert first.map_steps[-1].units["a:lysithea"][2] == 0
    assert battle.map_steps[-1].units["a:byleth"][2] == 35
    assert (battle.enemy_stats[7].combats, battle.enemy_stats[7].defeats) == (1, 0)  # the timeline that stands

    # A second Divine Pulse goes back further, before the first one's split: the first branch is now part of it.
    read(6, [start, waited], both, 4)
    second = battle.branches[1]
    assert (second.id, second.parent, second.fork) == (2, 0, 1)
    assert battle.branches[0].parent == 2
    assert [e.step for e in second.log if e.kind != "phase"] == [1, 3]  # Byleth's move and the hit on him
    assert second.map_steps[-1].units["a:byleth"][2] == 35
    assert first.map_steps[-1].units["a:lysithea"][2] == 0
    restored = Battle.model_validate_json(battle.model_dump_json())
    assert restored.branches == battle.branches


def test_a_unit_leaving_the_map_is_not_a_divine_pulse():
    """The history's entries list fewer units once one is off the map, "Fight!" too: that's no rewind."""
    me, foe, other = "a:lysithea", "e:5", "e:6"

    def step(actor=None, target=None, hp=20, gone=False, phase_start=False):
        units = (StepUnit(me, 30, 0, 0), StepUnit(foe, hp, 1, 0)) + (() if gone else (StepUnit(other, 20, 9, 9),))
        return HistoryStep(1, 0, phase_start, STEP_ATTACK if target else 0x0B, actor, target, False, units)

    tracker = BattleTracker()

    def read(n, steps, level=16, mag=None):
        values = {} if mag is None else {"mag": mag}
        tracker.update(BattleSample((army(level=level, **values),), (), "k", 1, 6, tuple(steps)), "run", at(n))

    read(0, [step(phase_start=True)])
    read(10, [step(phase_start=True), step(me, foe, hp=0)], level=17, mag=21)  # Lysithea's fight, a level-up
    # The other unit goes off the map: every entry, "Fight!" too, now leaves it out.
    read(20, [step(phase_start=True, gone=True), step(me, foe, hp=0, gone=True), step(me, gone=True)], level=17, mag=21)
    battle = tracker.battle
    assert battle.branches == [] and battle.divine_pulses == 0 and battle.level_ups == 1
    assert not [e for e in battle.log if e.kind == "pulse"]


def test_starting_the_map_over_is_a_new_battle_not_a_divine_pulse():
    def u(uid, hp, x=1, y=1):
        return StepUnit(uid, hp, x, y, 40 if uid.startswith("a:") else None)

    start = HistoryStep(1, 0, True, units=(u("a:byleth", 40), u("e:7", 36)))
    moved = HistoryStep(1, 0, False, actor="a:byleth", moved=True, units=(u("a:byleth", 40, 2, 2),))
    hit = HistoryStep(1, 0, False, STEP_ATTACK, "a:byleth", "e:7", units=(u("a:byleth", 40, 2, 2), u("e:7", 30)))
    byleth = ArmySample("byleth", "Byleth", "Mage", 16, dict(STATS, hp=40), (), (5,), 40, 1, 1)
    tracker = BattleTracker()

    def read(n, steps, charges, turn=1):
        return tracker.update(BattleSample((byleth,), (EnemySample("Brigand", 15, 100.0, 36, 36, 7, 3, 3),), "k", turn, charges, tuple(steps)), "run", at(n))

    read(1, [start], 6)
    read(2, [start, moved], 6)
    first = tracker.battle
    # A real Divine Pulse back to the start: through the Divine Pulse screen, a charge spent.
    read(3, [start], 0, turn=0)
    assert read(4, [start], 5) == (True, None)
    assert tracker.battle is first and len(first.branches) == 1
    read(5, [start, hit], 5)
    # The map started over (same battle key): the history is back to "Fight!" with no charge spent.
    start_again = HistoryStep(1, 0, True, units=(u("a:byleth", 40, 4, 4), u("e:7", 36)))
    changed, finished = read(6, [start_again], 6)
    assert changed and finished is first and tracker.battle is not first
    assert len(first.branches) == 1 and [e.kind for e in first.log if e.kind == "pulse"] == ["pulse"]
    again = tracker.battle
    assert again.branches == [] and again.divine_pulses == 0 and [e.text for e in again.log] == ["Fight!"]
    # The same "Fight!" again counts too (the deployment unchanged).
    read(7, [start_again, moved], 6)
    _, finished = read(8, [start_again], 6)
    assert finished is again and tracker.battle.branches == []


def test_a_record_off_the_map_is_flagged():
    data = bytearray(pool_bytes([(217, 16, 77, 24, 0, BATTLE_MARKER), (218, 16, 77, 24, 0, BATTLE_MARKER)]))
    data[2 * pool.RECORD_SIZE + 0xD6] = 0x23  # a reinforcement still to come
    units = pool.decode_pool(bytes(data), pool.RECORD_SIZE, set(), pool.BattleFields())
    assert [(u.character, u.off_map) for u in units] == [(217, False), (218, True)]


def test_changes_in_unknown_flag_bits_are_reported():
    from app.gamemem.battle import BattleUnit, FlagWatch

    def unit(slot, flags, character=111):
        return BattleUnit(character, False, 1, 1, {"hp": 26}, hp=26, slot=slot, flags=flags)

    watch = FlagWatch()
    # First read: a unit carrying a bit not known yet (0x08, as Solon has) is reported; 0x01 (on every unit) isn't.
    assert [(c.unit.slot, c.before, c.unknown) for c in watch.check([unit(1, 0x03), unit(2, 0x2B)])] == [(2, None, 0x08)]
    # Known bits (acted, on / off the map) changing aren't reported; 0x08 is, and 0x10 on the other unit.
    assert watch.check([unit(1, 0x07), unit(2, 0x0B)]) == []
    changes = watch.check([unit(1, 0x0F), unit(2, 0x1B)])
    assert [(c.unit.slot, c.before, c.after, c.unknown) for c in changes] == [(1, 0x07, 0x0F, 0x08), (2, 0x0B, 0x1B, 0x10)]
    # A record missing from a read is compared when it's back; a record now holding someone else is seen anew.
    assert watch.check([unit(1, 0x0F)]) == []
    assert [c.unit.slot for c in watch.check([unit(1, 0x0F), unit(2, 0x9B)])] == [2]
    assert [(c.before, c.unknown) for c in watch.check([unit(1, 0x03, character=155)])] == []
    assert watch.check([unit(1, 0x02, character=155)])[0].unknown == 0x01  # 0x01 changing is reported
    watch.reset()
    assert watch.check([unit(1, 0x03, character=155)]) == []


def test_a_unit_taken_off_the_map_with_hp_left_is_off_it():
    # +0xD6 bit 0x02 cleared: on a defeated unit (no HP), or a unit the story took off the map (Remire's villagers).
    data = bytearray(pool_bytes([(111, 1, 1, 26, 0, BATTLE_MARKER)] * 3))
    fields = pool.BattleFields(hp=0xDE)
    for i, (flags, hp) in enumerate([(0x03, 26), (0x01, 17), (0x01, 0)], start=1):
        data[i * pool.RECORD_SIZE + 0xD6], data[i * pool.RECORD_SIZE + 0xDE] = flags, hp
    units = pool.decode_pool(bytes(data), pool.RECORD_SIZE, set(), fields)
    assert [(u.hp, u.off_map) for u in units] == [(26, False), (17, True), (0, False)]


def test_a_battle_carried_on_after_a_bookmark():
    from app.battle import HistoryStep, continues

    me = ArmySample("byleth", "Byleth", "Noble", 16, dict(STATS), (), (5,), 30, 2, 2)
    fight, waited = HistoryStep(1, 0, True), HistoryStep(1, 0, False, actor="a:byleth")
    tracker = BattleTracker()
    tracker.update(BattleSample((me,), (), "k", 1, 3, (fight, waited)), "run", at(0))
    _, battle = tracker.update(BattleSample(()), "run", at(10))
    assert battle.ended_at is not None and battle.seconds() == 10
    # Same counters and the history going on past "Fight!": the same battle. Back at "Fight!": a restart.
    assert continues(BattleSample((me,), (), "k", 2, 3, (fight, waited)), battle)
    assert not continues(BattleSample((me,), (), "k", 1, 3, (fight,)), battle)
    assert not continues(BattleSample((me,), (), "other", 2, 3, (fight, waited)), battle)
    assert continues(BattleSample((me,), (), "k", 2, 3), battle) and not continues(BattleSample((me,), (), "k", 1, 3), battle)
    tracker.reopen(battle, at(100))  # 90 s away
    tracker.update(BattleSample((me,), (), "k", 1, 3, (fight, waited)), "run", at(105))
    assert tracker.battle is battle and battle.away_s == 90 and battle.seconds(at(105)) == 15
    assert [e.kind for e in battle.events] == ["start"] and [e.text for e in battle.log] == ["Fight!", "Byleth waited."]


def test_a_resumed_battle_keeps_when_things_happened_and_its_divine_pulses():
    me, foe = "a:lysithea", "e:5"

    def step(turn, actor=None, phase_start=False, x=0):
        return HistoryStep(turn, 0, phase_start, 0x0B, actor, None, True, (StepUnit(me, 30, x, 0), StepUnit(foe, 20, 9, 9)))

    start, moved, again = step(1, phase_start=True), step(1, me, x=1), step(1, me, x=2)
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), history=(start,)), "run", at(0))
    tracker.update(BattleSample((army(),), history=(start, moved)), "run", at(10))
    tracker.update(BattleSample((army(),), history=(start, moved, again)), "run", at(20))
    tracker.update(BattleSample((army(),), history=(start,)), "run", at(30))  # turned back to the start
    tracker.update(BattleSample((army(),), history=(start, moved)), "run", at(40))
    saved = Battle.model_validate_json(tracker.battle.model_dump_json())
    before = [(e.kind, e.t) for e in saved.log]

    restarted = BattleTracker()  # the tracker restarts mid-battle
    restarted.resume(saved)
    restarted.update(BattleSample((army(),), history=(start, moved)), "run", at(100))
    assert [(e.kind, e.t) for e in restarted.battle.log] == before
    assert any(e.kind == "pulse" for e in restarted.battle.log)


def test_units_keep_whether_they_acted():
    tracker = BattleTracker()
    me = fighter()
    tracker.update(located(replace(me, acted=False), fighter("claude")), "run", at(0))
    units = {u.key: u for u in tracker.battle.units}
    assert (units["lysithea"].acted, units["claude"].acted) == (False, None)
    tracker.update(located(replace(me, acted=True), fighter("claude")), "run", at(5))
    assert {u.key: u.acted for u in tracker.battle.units}["lysithea"] is True


def test_the_map_cursor_is_followed():
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), cursor=(3, 27)), "run", at(0))
    assert tracker.battle.cursor == (3, 27)
    assert tracker.update(BattleSample((army(),), cursor=(4, 27)), "run", at(1)) == (True, None)
    assert tracker.update(BattleSample((army(),), cursor=(4, 27)), "run", at(2)) == (False, None)
    tracker.update(BattleSample((army(),), cursor=(99, 0)), "run", at(3))  # off any map: kept where it was
    assert tracker.battle.cursor == (4, 27)


def test_combat_arts_rally_and_weapon_usage_from_the_history(roster_import):
    from app.battle import STEP_WAIT, HistoryStep, StepUnit

    bow, lance = 146, 22  # Iron Bow+, Iron Lance

    def u(uid, hp, x, y, items=(), abilities=()):
        return StepUnit(uid, hp, x, y, 30 if uid.startswith("a:") else None, items, (), (), abilities)

    def me(key):
        return ArmySample(key, key.capitalize(), "Archer", 16, dict(STATS, hp=40), (), (5,), 40, 1, 1)

    ignatz = lambda hp=40, uses=42, x=1, y=1: u("a:ignatz", hp, x, y, ((bow, uses),), (107,))  # noqa: E731 (Rally Speed)
    cyril = lambda x=2, y=1, uses=30: u("a:cyril", 40, x, y, ((lance, uses),))  # noqa: E731
    steps = [
        HistoryStep(1, 0, True, units=(ignatz(), cyril(), u("e:9", 30, 5, 5))),
        # Break Shot (costs 3): 4 damage, both stood.
        HistoryStep(1, 0, False, 0x01, "a:ignatz", "e:9", units=(ignatz(uses=39), u("e:9", 26, 5, 5)), art=38),
        # Swap on an ally, then a Canto move (the action byte says "wait").
        HistoryStep(1, 0, False, STEP_WAIT, "a:cyril", "a:ignatz", units=(cyril(x=1, y=1), ignatz(uses=39, x=2)), art=50),
        HistoryStep(1, 0, False, 0x17, "a:ignatz", "a:cyril", units=(ignatz(uses=39, x=2), cyril(x=1)), rally=True),
        # The enemy attacks Cyril, who counters with his lance.
        HistoryStep(1, 1, False, 0x00, "e:9", "a:cyril", units=(cyril(x=1, uses=29), u("e:9", 18, 5, 5))),
    ]
    tracker = BattleTracker()
    for n in range(1, len(steps) + 1):
        tracker.update(BattleSample((me("ignatz"), me("cyril")), (EnemySample("Brigand", 15, 100.0, 30, 30, 9),), "k", 1, 3, tuple(steps[:n])), "run", at(n))
    battle = tracker.battle
    log = [e.text for e in battle.log]
    assert log[1:] == [
        "Ignatz's Break Shot dealt 4 damage to Brigand 1.",
        "Cyril used Swap on Ignatz.",
        "Ignatz used Rally Speed on Cyril.",
        "Brigand 1's attack dealt 0 damage to Cyril. Cyril hit back for 8.",
    ]
    assert [e.detail for e in battle.log[1:4]] == ["Break Shot", "Swap", "Rally Speed"]
    units = {x.key: x for x in battle.units}
    used = {(x.kind, x.name): (x.times, x.spent, x.damage) for x in units["ignatz"].usage}
    assert used == {("weapon", "Iron Bow+"): (1, 3, 4), ("art", "Break Shot"): (1, 3, 4), ("rally", "Rally Speed"): (1, 0, 0)}
    used = {(x.kind, x.name): (x.times, x.spent, x.damage) for x in units["cyril"].usage}
    assert used == {("art", "Swap"): (1, 0, 0), ("weapon", "Iron Lance"): (1, 1, 8)}


def test_gambits_from_the_history_hit_everyone_in_their_area(roster_import):
    from app.battle import HistoryStep, StepUnit

    def u(uid, hp, x, y):
        return StepUnit(uid, hp, x, y, 30 if uid.startswith("a:") else None)

    def me(key):
        return ArmySample(key, key.capitalize(), "Mercenary", 16, dict(STATS, hp=40), (), (), 40, 1, 1)

    steps = [
        HistoryStep(1, 0, True, units=(u("a:byleth", 40, 3, 10), u("a:marianne", 30, 2, 15), u("e:9", 39, 9, 17), u("e:10", 41, 8, 17))),
        # Stride (made-up ID 25, not in the import): helps, changes no HP.
        HistoryStep(1, 0, False, 0x13, "a:marianne", "a:byleth", units=(u("a:marianne", 30, 2, 12), u("a:byleth", 40, 3, 10)), gambit=25),
        # Test Rally (ID 1 in the synthetic import) on two foes: 11 damage each, no counterattack.
        HistoryStep(1, 0, False, 0x13, "a:byleth", "e:10", units=(u("a:byleth", 40, 6, 17), u("e:9", 28, 9, 17), u("e:10", 30, 7, 17)), item=1103, gambit=1),
    ]
    tracker = BattleTracker()
    for n in range(1, len(steps) + 1):
        tracker.update(BattleSample((me("byleth"), me("marianne")), (EnemySample("Brigand", 15, 100.0, 39, 39, 9), EnemySample("Brigand", 15, 100.0, 41, 41, 10)), "k", 1, 3, tuple(steps[:n])), "run", at(n))
    battle = tracker.battle
    gambits = [e for e in battle.log if e.kind == "gambit"]
    # Only the unit aimed at is named; both hits count toward Byleth's damage.
    assert [e.text for e in gambits] == ["Marianne used Gambit 25 on Byleth.", "Byleth used Test Rally on Brigand 2."]
    assert [(e.detail, e.dealt) for e in gambits] == [("Gambit 25", None), ("Test Rally", 22)]
    units = {x.key: x for x in battle.units}
    used = {(x.kind, x.name): (x.times, x.damage) for x in units["byleth"].usage}
    assert used == {("gambit", "Test Rally"): (1, 22)}
    assert battle.units[0].key == "byleth"


def test_enemy_inventory_usage_follows_standing_history(roster_import):
    foe = EnemySample("Brigand", 15, 100.0, 30, 30, 9)
    player = StepUnit("a:lysithea", 30, 1, 1, 30)
    before = StepUnit("e:9", 30, 2, 1, 30, ((22, 30),))
    after = StepUnit("e:9", 30, 2, 1, 30, ((22, 29),))
    hurt = StepUnit("a:lysithea", 25, 1, 1, 30)
    steps = (
        HistoryStep(1, 0, True, units=(player, before)),
        HistoryStep(1, 1, False, STEP_ATTACK, "e:9", "a:lysithea", units=(hurt, after)),
    )
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), (foe,), "k", 1, 3, steps), "run", at(1))
    usage = tracker.battle.enemy_stats[9].usage
    assert [(u.kind, u.name, u.times, u.spent, u.damage) for u in usage] == [("weapon", "Iron Lance", 1, 1, 5)]
    tracker.update(BattleSample((army(),), (foe,), "k", 1, 2, steps[:1]), "run", at(2))
    assert tracker.battle.enemy_stats[9].usage == []


def test_breaking_a_monsters_hp_bar_is_damage_not_a_heal():
    """A multi-bar monster's HP refills when a bar breaks: the attack is logged as damage, never as a heal."""

    def u(uid, hp, x=1, y=1):
        return StepUnit(uid, hp, x, y, 40 if uid.startswith("a:") else None)

    start = HistoryStep(1, 0, True, units=(u("a:byleth", 40), u("e:7", 12)))
    hit = HistoryStep(1, 0, False, STEP_ATTACK, "a:byleth", "e:7", units=(u("a:byleth", 40), u("e:7", 90)))
    byleth = ArmySample("byleth", "Byleth", "Mage", 16, dict(STATS, hp=40), (), (5,), 40, 1, 1)
    tracker = BattleTracker()
    tracker.update(BattleSample((byleth,), (EnemySample("Beast", 15, 100.0, 12, 90, 7, 3, 3),), "k", 1, 6, (start, hit)), "run", at(1))
    battle = tracker.battle
    entry = battle.log[-1]
    assert entry.kind == "attack" and "broke one of" in entry.text and "restored" not in entry.text
    assert not [e for e in battle.log if e.kind == "heal"]
    assert battle.units[0].healing_given in (0, None)


def test_the_quest_a_battle_is_for_is_kept_and_battles_saved_before_it_load_without_one():
    from app.gamemem.battle import fields

    assert fields().quest == 0x1536FF  # app/data/battle_fields.json
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), scenario=66, quest=78), "run", T0)
    assert (tracker.battle.scenario, tracker.battle.quest) == (66, 78)
    tracker.update(BattleSample((army(),), scenario=66), "run", T0 + timedelta(seconds=1))  # not read this time: kept
    assert tracker.battle.quest == 78
    saved = tracker.battle.model_dump(mode="json")
    assert Battle.model_validate(saved).quest == 78
    del saved["quest"]  # a battle file from before the field
    assert Battle.model_validate(saved).quest is None


def _winning_blow(monkeypatch, *, filed_at=None):
    """A Skirmish at Dawn's last fight: Claude (a guest) defeats Kostas, levels up first (the level-up screen comes
    before the pool's HP changes), and the game files no history entry for it. With `filed_at`, the game does file
    it (any other fight): the history's entry then comes at that read."""
    from app.domain.combat import BattleUnit, Fight, Pairing

    claude, kostas = "a:claude", "e:20"

    def entry(phase_start, hp, actor=None, target=None):
        units = (StepUnit(claude, 26, 13, 8, 26), StepUnit(kostas, hp, 12, 7))
        return HistoryStep(6, 0, phase_start, STEP_ATTACK if target else 0x0B, actor, target, False, units)

    start, blow = entry(True, 7), entry(False, 0, claude, kostas)
    paired = []

    def pair_fights(before, after, **kw):
        paired.append(after)
        return Pairing((Fight(4, 20, 0, 7, 20, 1.0),), True)

    tracker = BattleTracker()
    monkeypatch.setattr(tracker.support, "pair_fights", pair_fights)

    def read(n, hp, level=1, history=(start,)):
        units = (
            BattleUnit(4, False, level, 0, {"hp": 26}, hp=26, x=13, y=8, combats=3 if hp == 0 else 2, victories=2 if hp == 0 else 1, slot=4),
            BattleUnit(43, False, 3, 0, {"hp": 29}, hp=hp, x=12, y=7, combats=3 if hp == 0 else 2, slot=20),
        )
        army = (ArmySample("claude", "Claude", "Archer", level, dict(STATS, str=STATS["str"] + level - 1), hp=26, x=13, y=8),)
        enemies = (EnemySample("Thief", 3, 50.0, 29, hp, 20, 12, 7, "Kostas", character=43),)
        sample = BattleSample(army, enemies, "k", 6, 0, history, units=units, army_slots={4: "claude"})
        tracker.update(sample, "run", at(n))

    read(0, 7)
    read(10, 7, level=2)  # the level-up screen
    read(17, 0, level=2)  # the fight's HP shows once it closes
    if filed_at is not None:
        read(filed_at, 0, level=2, history=(start, blow))
    read(30, 0, level=2, history=(start, blow) if filed_at is not None else (start,))
    return tracker, tracker.end(at(40)), paired


def test_the_action_that_wins_the_map_is_worked_out_and_logged_before_what_followed(monkeypatch):
    tracker, battle, paired = _winning_blow(monkeypatch)
    assert [(e.t, e.kind, e.text, e.confidence) for e in battle.log[-2:]] == [
        (17.0, "attack", "Claude's attack dealt 7 damage to Kostas.", 1.0),
        (17.0, "defeat", "Claude killed Kostas.", 1.0),
    ]
    # Paired with the guest on your side (the pairing only pairs opposite sides).
    assert [u.army for u in paired[-1] if u.slot == 4] == [True]
    # The level-up it earned showed first, but follows it.
    level_up = next(e for e in battle.events if e.kind == "level_up")
    assert level_up.t == 17.0
    assert [e.t for e in battle.events] == sorted(e.t for e in battle.events)
    kostas, claude = battle.enemy_stats[20], battle.units[0]
    assert (kostas.defeated_by, kostas.damage_taken, claude.damage_dealt) == ("Claude", 7, 7)
    assert (claude.combats, claude.defeats, kostas.combats) == (1, 1, 1)


def test_an_action_the_history_files_after_its_hp_shows_is_not_worked_out_too(monkeypatch):
    tracker, battle, paired = _winning_blow(monkeypatch, filed_at=18)
    assert [(e.t, e.kind, e.confidence) for e in battle.log[-2:]] == [(18.0, "attack", None), (18.0, "defeat", None)]
    assert len([e for e in battle.log if e.kind == "attack"]) == 1 and paired == []
    # The level-up moves to its fight's entry.
    assert next(e for e in battle.events if e.kind == "level_up").t == 18.0


def test_a_level_up_stays_put_when_a_new_phase_is_logged_next():
    me, foe = "a:lysithea", "e:5"
    units = (StepUnit(me, 30, 0, 0), StepUnit(foe, 20, 1, 0))
    start = HistoryStep(1, 0, True, units=units)
    enemy_phase = HistoryStep(1, 1, True, units=units)
    tracker = BattleTracker()
    tracker.update(BattleSample((army(),), history=(start,)), "run", at(0))
    tracker.update(BattleSample((army(level=17, mag=21),), history=(start,)), "run", at(10))
    tracker.update(BattleSample((army(level=17, mag=21),), history=(start, enemy_phase)), "run", at(12))
    assert next(e for e in tracker.battle.events if e.kind == "level_up").t == 10.0
