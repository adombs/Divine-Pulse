"""The game's battle history (the Divine Pulse list) as recorded from your own game (see helpers/captures.py)."""


import pytest

from app.gamemem import history as h
from helpers import captures
from test_history import decode

pytestmark = pytest.mark.needs_captures
NO_CAPTURE = {"frames": [], "history": [], "entries": []}
BATTLE = captures.read_json("battle", "oil_and_water_turn2.json", default=NO_CAPTURE)
ARTS = captures.read_json("battle", "arts_and_rally.json", default=NO_CAPTURE)


def test_a_skipped_enemy_phase_keeps_every_fight_in_the_history():
    # Recorded live: turn 2's enemy phase played with Action Skip on finished between two reads.
    data = BATTLE
    history = data["history"]
    attacks = [e for e in history if e["turn"] == 2 and e["phase"] == 1 and e["target"] is not None]
    first = history.index(attacks[0])
    # (An action's entry is added only when the next one starts, so the read before it may already show the fight.)
    before = next(f for f in reversed(data["frames"]) if f["history_entries"] < first)
    after = data["frames"][-1]
    fights = {u["slot"]: u["combats"] for u in before["units"]}
    new_fights = sum(u["combats"] - fights[u["slot"]] for u in after["units"] if u["slot"] in fights) // 2
    assert new_fights == len(attacks) == 2
    assert {e["action"] for e in attacks} == {0x00, h.ACTION_SPELL}  # one killed its target, one didn't


def test_an_attacks_item_field_is_its_damage_and_outcome_in_a_recording():
    data = BATTLE
    seen = {}
    attacks = 0
    for e in data["history"]:
        before = dict(seen)
        for u in e["units"]:
            seen[(u["character"], u["index"])] = u["hp"]
        if e["phase_start"] or e["target"] is None or e["action"] == 0x05:
            continue
        dealt, outcome = divmod(e["item"], 100)
        hp = {k: v for k, v in seen.items() if before.get(k, v) != v}  # units whose HP changed
        lost = {k: before[k] - v for k, v in hp.items()}
        assert dealt in lost.values() or dealt == 0
        fell = [k for k, v in hp.items() if v == 0]
        assert (outcome == 3) == (not fell)
        attacks += 1
    assert attacks == 9


def test_combat_arts_and_rally_entries():
    # Recorded live: arts on enemies and on allies, an art followed by a Canto move, and Rally.
    data = ARTS
    entries = [decode(bytes.fromhex(e["data"])) for e in data["entries"]]
    arts = [(e.actor, e.art, e.target, e.item) for e in entries if e.art is not None]
    assert arts == [(4, 38, 31, 403), (11, 53, 9, 0), (0, 50, 7, 0), (7, 23, 31, 2203), (8, 53, 7, 0)]
    assert not any(e.moved for e in entries if e.art is not None)
    break_shot = entries[0]
    ignatz = next(u for u in break_shot.units if u.character == 21)
    assert ignatz.items[0] == (146, 39)  # the bow it used: 42 uses before, Break Shot costs 3
    rally = next(e for e in entries if e.rally)
    assert (rally.actor, rally.target, rally.rallied, rally.art) == (4, None, 34, None)
    assert 107 in next(u for u in rally.units if u.character == 21).abilities  # Rally Speed
