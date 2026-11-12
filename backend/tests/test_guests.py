"""Guests: units on your side (team 0) that are not in the roster are logged as your units for that battle only."""

from __future__ import annotations

import copy
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from app.battle import ArmySample, Battle, BattleSample, BattleTracker, BattleUnitStats
from app.domain import deaths
from app.domain.battle import EnemySample, HistoryStep, LogEntry, StepUnit, guest_key
from app.domain.best_unit import best_unit
from app.domain.units import Unit, now
from app.infrastructure.route_inference import route_of
from app.infrastructure.saved_models import Run, decode_battle
from test_memory_mode import FakePoolUnit, scanner  # noqa: F401  (the scanner fixture)

T0 = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)


def test_a_team_zero_record_outside_the_roster_is_a_guest_army_unit(scanner):  # noqa: F811
    # Seteth (26) is no lord and not in the roster; scenario 20 is no prologue: only "team 0, not in the roster" counts.
    scanner.memory.scenario = 20
    scanner.memory.battle_units = lambda: [
        replace(FakePoolUnit(26, 20, 32), team=0, slot=1, hp=20, x=3, y=4),
        replace(FakePoolUnit(509, 5, 11), team=1, slot=2),
        replace(FakePoolUnit(900, 5, 3), team=2, slot=3),
    ]
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    sample = scanner._sample_battle(scanner.memory.read(), scanner.run_id)
    guest = next(a for a in sample.army if a.guest)
    assert (guest.key, guest.name, guest.character, guest.hp, guest.x, guest.y) == ("seteth", "Seteth", 26, 20, 3, 4)
    assert guest.level == 20 and guest.class_id == 32
    assert sample.army_slots[1] == "seteth"
    assert sorted((e.slot, e.side) for e in sample.enemies) == [(2, "enemy"), (3, "ally")]  # teams 1 and 2 unchanged
    battle = scanner.current_battle()
    assert [(u.key, u.guest) for u in battle.units] == [("lysithea", False), ("seteth", True)]
    assert battle.enemy_stats.keys() == {2, 3}
    assert battle.enemies_start == 1
    # Never a run unit or on the roster.
    assert "seteth" not in scanner.store.get(scanner.run_id).units


def test_a_guest_uses_the_run_units_key_for_its_character(scanner):  # noqa: F811
    scanner.store.put_unit(scanner.run_id, "the-bishop", Unit(name="Seteth", game_id=26))
    scanner.memory.battle_units = lambda: [replace(FakePoolUnit(26, 20, 32), team=0, slot=1)]
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    assert [u.key for u in scanner.current_battle().units] == ["lysithea", "the-bishop"]
    assert guest_key("Seteth", 26, 1, "", {"x": Unit(name="Seteth", game_id=26)}) == "x"
    assert guest_key("Soldier", None, 7) == "soldier-7"  # a generic unit has no character to carry over


def test_a_guest_who_joins_keeps_the_key_and_stops_being_a_guest():
    tracker = BattleTracker()
    guest = ArmySample("seteth", "Seteth", "Bishop", 20, {"hp": 30, "str": 10}, guest=True)
    tracker.update(BattleSample((guest,)), "run", T0)
    assert [(u.key, u.guest) for u in tracker.battle.units] == [("seteth", True)]
    changed, _ = tracker.update(BattleSample((replace(guest, guest=False),)), "run", T0 + timedelta(seconds=1))
    assert changed and [(u.key, u.guest) for u in tracker.battle.units] == [("seteth", False)]


def test_a_guest_fighting_is_logged_under_its_army_id():
    tracker = BattleTracker()
    guest = ArmySample("seteth", "Seteth", "Bishop", 20, {"hp": 30}, hp=30, x=1, y=1, guest=True)
    foe = EnemySample("Brigand", 5, 10.0, 20, 20, 9, 2, 1, name="Bandit")
    first = HistoryStep(1, 0, True, units=(StepUnit("a:seteth", 30, 1, 1), StepUnit("e:9", 20, 2, 1)))
    attack = HistoryStep(
        1, 0, False, actor="a:seteth", target="e:9",
        units=(StepUnit("a:seteth", 30, 1, 1), StepUnit("e:9", 5, 2, 1)),
    )
    slots = {1: "seteth"}
    tracker.update(BattleSample((guest,), (foe,), history=(first,), army_slots=slots), "run", T0)
    tracker.update(
        BattleSample((guest,), (foe,), history=(first, attack), army_slots=slots), "run", T0 + timedelta(seconds=1)
    )
    assert [e.actor_id for e in tracker.battle.log if e.kind == "attack"] == ["a:seteth"]
    assert tracker.battle.units[0].damage_dealt == 15


SAVED = {
    "id": "20261111-045635", "run_id": "r", "started_at": "2026-11-11T04:56:35Z", "scenario": 0,
    "units": [{"key": "byleth", "name": "Byleth", "start_level": 1, "level": 1, "start": {"hp": 20}, "now": {"hp": 20}}],
    "enemies_start": 3, "enemies_now": 1, "enemies_defeated": 2,
    "enemy_labels": {"2946093204": "Claude", "5": "Thief 1"},
    "enemy_stats": {
        "2946093204": {
            "slot": 2946093204, "label": "Claude", "name": "Claude", "class_name": "Noble", "level": 4, "max_hp": 24,
            "hp": 12, "combats": 5, "defeats": 2, "side": "player", "character": 4, "x": 3, "y": 4, "female": False,
            "allegiance": 2, "on_map": True,
            "inventory": [{"id": 22, "name": "Iron Sword", "kind": "weapon", "uses": 30}],
        },
        "5": {"slot": 5, "label": "Thief 1", "name": "Thief", "hp": 0, "max_hp": 20, "side": "enemy"},
        "6": {"slot": 6, "label": "Jeralt", "name": "Jeralt", "hp": 30, "max_hp": 30, "side": "ally", "character": 3},
    },
    "log": [
        {"t": 1, "kind": "attack", "text": "x", "unit": None, "target": "Thief 1", "actor_id": "e:2946093204", "target_id": "e:5"},
        {"t": 2, "kind": "attack", "text": "y", "unit": None, "target": "Claude", "actor_id": "e:5", "target_id": "e:2946093204"},
        {"t": 3, "kind": "attack", "text": "z", "actor_id": "e:6", "target_id": "e:5"},
    ],
    "map_steps": [{
        "step": 0, "turn": 1, "phase": 0, "actor": "e:2946093204", "target": "e:5",
        "units": {"e:2946093204": [3, 4, 12], "e:5": [1, 1, 0], "a:byleth": [0, 0, 20]},
    }],
    "map_presence": {"e:2946093204": [[0, False]], "e:5": [[0, False]]},
    "branches": [{
        "id": 1, "fork": 0, "at": 1.0,
        "log": [{"t": 1, "kind": "attack", "text": "x", "actor_id": "e:2946093204", "target_id": "e:5"}],
        "map_steps": [{"step": 0, "turn": 1, "phase": 0, "units": {"e:2946093204": [3, 4, 12]}}],
        "map_presence": {"e:2946093204": [[0, False]]},
    }],
}


def test_a_stored_battle_with_your_side_among_the_others_is_upgraded():
    original = copy.deepcopy(SAVED)
    battle = decode_battle(SAVED)
    assert SAVED == original  # the source is untouched
    claude = next(u for u in battle.units if u.key == "claude")
    assert (claude.guest, claude.hp, claude.level, claude.start_level) == (True, 12, 4, 4)
    assert (claude.combats, claude.defeats, claude.character) == (5, 2, 4)
    assert (claude.x, claude.y, claude.allegiance, claude.now, claude.start) == (3, 4, 2, {"hp": 24}, {"hp": 24})
    assert [i.name for i in claude.inventory] == ["Iron Sword"]
    assert battle.enemy_stats.keys() == {5, 6}  # the thief and the ally stay where they were
    assert battle.enemy_labels == {5: "Thief 1"}
    assert [(e.actor_id, e.target_id, e.unit, e.target) for e in battle.log] == [
        ("a:claude", "e:5", "claude", "Thief 1"),
        ("e:5", "a:claude", None, "claude"),
        ("e:6", "e:5", None, None),
    ]
    step = battle.map_steps[0]
    assert (step.actor, set(step.units)) == ("a:claude", {"a:claude", "e:5", "a:byleth"})
    assert battle.map_presence == {"a:claude": [(0, False)], "e:5": [(0, False)]}
    branch = battle.branches[0]
    assert branch.log[0].actor_id == "a:claude" and set(branch.map_steps[0].units) == {"a:claude"}
    assert list(branch.map_presence) == ["a:claude"]
    assert (battle.enemies_start, battle.enemies_now, battle.enemies_defeated) == (3, 1, 2)  # foes only: unchanged
    # Idempotent: loading the upgraded form again changes nothing.
    assert Battle.model_validate(battle.model_dump(mode="json")) == battle


def test_an_upgrade_joins_a_unit_the_battle_already_has():
    data = copy.deepcopy(SAVED)
    data["units"].append(
        {"key": "claude", "name": "Claude", "start_level": 4, "level": 4, "start": {"hp": 24}, "now": {"hp": 24}}
    )
    battle = decode_battle(data)
    assert [u.key for u in battle.units].count("claude") == 1
    assert battle.log[0].actor_id == "a:claude"


def _unit(key, guest):
    return BattleUnitStats(key=key, name=key.title(), level=1, start_level=1, start={}, now={}, guest=guest)


def _battle(units, **fields):
    return Battle(id="b", run_id="t", started_at=now(), ended_at=now(), scenario=0, units=units, **fields)


def test_guests_are_no_evidence_for_the_route():
    # Three guests from three houses and a roster unit: the route is what the roster alone gives.
    guests = [_unit("edelgard", True), _unit("dimitri", True), _unit("claude", True)]
    mine = _unit("lysithea", False)
    run = Run(id="t", name="T", units={"lysithea": Unit(name="Lysithea")})
    assert route_of(run, [_battle([*guests, mine])]) == route_of(run, [_battle([mine])]) == "golden-deer"
    assert route_of(None, [_battle([*guests, mine])]) == route_of(None, [_battle([mine])])
    # With nobody else the guests alone give nothing, where the same units on the roster would be ambiguous too.
    assert route_of(Run(id="t", name="T"), [_battle(guests)]) is None
    assert route_of(None, [_battle([_unit("petra", False), *guests])]) == "black-eagles"


def test_a_guest_is_no_best_unit_and_its_fall_is_no_death():
    guests = [_unit("edelgard", True), _unit("claude", True)]
    for unit in guests:
        unit.damage_dealt = 500
    battle = _battle(guests)
    assert best_unit([battle], ["lysithea"]) is None
    assert best_unit([battle], ["claude"]).key == "claude"  # the run has it: its battle stats count
    battle.log = [LogEntry(t=1, kind="fell", text="f", unit="edelgard", actor_id="a:edelgard", step=1)]
    assert deaths.final_fall("edelgard", battle) is None and deaths.fall_of("edelgard", [battle]) is None
