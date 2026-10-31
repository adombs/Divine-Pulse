"""Battle tracking against a battle recorded from your own game (see helpers/captures.py): the fights worked out from
two reads must match the game's own history."""

import pytest

from app.battle import ArmySample, BattleSample, BattleTracker, EnemySample
from test_battle import STATS, at
from test_combat_captures import DATA, fixture_units

pytestmark = [pytest.mark.needs_captures, pytest.mark.needs_game_import]


def test_fights_are_worked_out_when_the_history_cant_be_read():
    # The fixture's reads over turn 2, as the scanner would sample them, with the game's history left out.
    names = {0: "byleth", 28: "hanneman", 29: "manuela", 27: "flayn", 19: "lorenz", 22: "lysithea", 34: "cyril", 4: "claude"}

    def sample(frame) -> BattleSample:
        units = fixture_units(frame)
        army = tuple(
            ArmySample(names[u.character], names[u.character].capitalize(), "", u.level, dict(STATS, hp=u.max_hp), u.items, u.spell_uses, u.hp, u.x, u.y, u.combats, u.victories)
            for u in units
            if u.army
        )
        others = tuple(
            EnemySample("Fighter", u.level, 100.0, u.max_hp, u.hp, u.slot, u.x, u.y, "Bandit", u.combats, u.victories)
            for u in units
            if not u.army and u.character not in names
        )
        return BattleSample(army, others, "oil", frame["turn"], frame["divine_pulse_charges"], units=tuple(units), army_slots={u.slot: names[u.character] for u in units if u.army})

    off = BattleTracker()
    off.estimate_fights = False  # (Settings > Battles: estimate fights, off)
    for n, frame in enumerate(DATA["frames"]):
        off.update(sample(frame), "run", at(n))
    assert off.battle.log == []

    tracker = BattleTracker()
    for n, frame in enumerate(DATA["frames"]):
        tracker.update(sample(frame), "run", at(n))
    battle = tracker.battle
    units = {u.key: u for u in battle.units}
    assert (units["byleth"].damage_dealt, units["byleth"].damage_taken) == (13, 22)
    assert (units["lorenz"].damage_dealt, units["lorenz"].damage_taken) == (16, 34)
    assert units["cyril"].damage_taken == 36 + 3
    worked_out = [e for e in battle.log if e.kind == "attack"]
    assert worked_out[0].actor_id == "a:lysithea" and worked_out[0].target_id.startswith("e:") and worked_out[0].dealt == 1
    assert [e.phase for e in worked_out] == [0, 0, 0, 0, 0, 1, 1]
    attacks = [e for e in battle.log if e.kind == "attack"]
    assert len(attacks) == 7 and all(e.confidence is not None and e.confidence >= 0.5 for e in attacks)
    assert attacks[0].text.startswith("Lysithea's attack dealt 1 damage to Bandit")
    assert [e.text for e in battle.log if e.kind == "fell"] == ["Cyril fell."]
    defeated_by = sorted(s.defeated_by for s in battle.enemy_stats.values() if s.defeated_by)
    assert defeated_by == ["Hanneman", "Lysithea", "Lysithea"]


def test_pairing_check_compares_with_the_history(tmp_path):
    # DIVINE_PULSE_PAIRING_CHECK: with the history read, the fights are also worked out without it and compared at the end.
    import json as json_

    from app.battle import HistoryStep, StepUnit

    names = {0: "byleth", 28: "hanneman", 29: "manuela", 27: "flayn", 19: "lorenz", 22: "lysithea", 34: "cyril", 4: "claude"}
    start = DATA["frames"][0]["pool_start"]
    army_slots = {u.slot: names[u.character] for u in fixture_units(DATA["frames"][0]) if u.army}

    def uid(index):
        if index is None:
            return None
        return f"a:{army_slots[start + index]}" if start + index in army_slots else f"e:{start + index}"

    def step(e) -> HistoryStep:
        units = tuple(
            StepUnit(f"a:{names[u['character']]}" if u["character"] is not None else f"e:{start + u['index']}", u["hp"], u["x"], u["y"], u["max_hp"])
            for u in e["units"]
        )
        return HistoryStep(e["turn"], e["phase"], e["phase_start"], e["action"], uid(e["actor"]), uid(e["target"]), e["moved"], units)

    history = [step(e) for e in DATA["history"]]
    tracker = BattleTracker(check_dir=tmp_path)
    for n, frame in enumerate(DATA["frames"]):
        units = fixture_units(frame)
        army = tuple(
            ArmySample(names[u.character], names[u.character].capitalize(), "", u.level, dict(STATS, hp=u.max_hp), u.items, u.spell_uses, u.hp, u.x, u.y, u.combats, u.victories)
            for u in units
            if u.army
        )
        others = tuple(
            EnemySample("Fighter", u.level, 100.0, u.max_hp, u.hp, u.slot, u.x, u.y, "Bandit", u.combats, u.victories)
            for u in units
            if not u.army and u.character not in names
        )
        tracker.update(
            BattleSample(army, others, "oil", frame["turn"], 6, tuple(history[: frame["history_entries"]]), units=tuple(units), army_slots=army_slots),
            "run", at(n),
        )
    tracker.end(at(99))
    report = json_.loads(next(tmp_path.glob("*.json")).read_text("utf-8"))
    summary = report["summary"]
    # Turn 1's two fights came before the recording, so only turn 2's seven could be worked out.
    assert (summary["history_fights"], summary["worked_out"], summary["pair_right"], summary["attacker_right"]) == (9, 7, 7, 7)
    assert [m["turn"] for m in report["missed"]] == [1, 1]
