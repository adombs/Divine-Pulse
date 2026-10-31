"""Fight pairing (gamemem/pairing.py) measured against the game's own history in a capture from your own game (see
helpers/captures.py): a turn's player phase and its skipped enemy phase."""

from dataclasses import replace

import pytest

from app.gamemem.pairing import enemy_phase_began, pair_fights
from helpers import captures
from test_combat_captures import DATA, NO_CAPTURE, fixture_units

pytestmark = [pytest.mark.needs_captures, pytest.mark.needs_game_import]

FRAMES = [fixture_units(f) for f in DATA["frames"]]
POOL_START = DATA["frames"][0]["pool_start"] if FRAMES else 0
# Where everyone stood when turn 2 began (the first frame: only one item use came before it).
ORIGINS = {u.slot: (u.x, u.y) for u in FRAMES[0]} if FRAMES else {}
# The fights in the game's history (attacker, defender), as pool slots.
HISTORY = [
    (POOL_START + e["actor"], POOL_START + e["target"]) for e in DATA["history"] if e["turn"] == 2 and e["target"] is not None
]
SURE = 0.6  # a fight the solver gets wrong must never be shown with more confidence than this


def fights_between(a: int, b: int, **kw):
    result = pair_fights(FRAMES[a], FRAMES[b], origins=ORIGINS, **kw)
    assert result is not None
    return result


def test_the_history_has_seven_fights():
    assert len(HISTORY) == 7


def test_every_fight_read_by_read():
    # The tracker compares each read with the one before: every fight comes out, with who started it. Lorenz's is the
    # closest call (0.66): the bandit's two hits on him fit either side starting the fight, and his linked allies and
    # his move earlier in the turn tip it.
    found = []
    for a in range(len(FRAMES) - 1):
        result = fights_between(a, a + 1)
        assert result.exact
        found += result.fights
    assert sorted((f.attacker, f.defender) for f in found) == sorted(HISTORY)
    assert all(f.confidence >= SURE for f in found)


def test_damage_and_defeats_read_by_read():
    by_pair = {}
    for a in range(len(FRAMES) - 1):
        for f in fights_between(a, a + 1).fights:
            by_pair[frozenset((f.attacker, f.defender))] = f
    bandit, byleth, lysithea, cyril = POOL_START + 39, POOL_START + 0, POOL_START + 8, POOL_START + 9
    f = by_pair[frozenset((byleth, bandit))]
    assert {f.attacker: f.attacker_lost, f.defender: f.defender_lost} == {byleth: 22, bandit: 13}
    assert by_pair[frozenset((POOL_START + 1, bandit))].defeated == bandit  # Hanneman finished it
    assert by_pair[frozenset((lysithea, POOL_START + 33))].defeated == POOL_START + 33
    assert by_pair[frozenset((POOL_START + 37, cyril))].defeated == cyril  # Cyril fell on the enemy phase
    assert by_pair[frozenset((POOL_START + 54, lysithea))].defeated == POOL_START + 54  # killed by her counter


def test_a_whole_turn_between_two_reads():
    # Seven fights at once, a unit in four of them. The two mages' kills fit either way round (both can reach both
    # targets, and Lysithea cast Fire three times this turn either way), so those two are shown as unsure.
    result = fights_between(0, len(FRAMES) - 1, budget=30)
    assert result.exact and not result.partial
    assert {frozenset((f.attacker, f.defender)) for f in result.fights if f.confidence >= SURE} <= {frozenset(e) for e in HISTORY}
    right = [f for f in result.fights if (f.attacker, f.defender) in HISTORY]
    assert len(right) >= 5
    for f in result.fights:
        if (f.attacker, f.defender) not in HISTORY:
            assert f.confidence < SURE, f


def test_a_short_time_budget_still_gives_the_likeliest():
    quick = fights_between(0, len(FRAMES) - 1, budget=0.3)
    assert quick.fights and len({frozenset((f.attacker, f.defender)) for f in quick.fights} & {frozenset(e) for e in HISTORY}) >= 4


def test_reads_that_cant_be_compared():
    # Time turned back: counters going down.
    later, earlier = FRAMES[4], FRAMES[3]
    assert pair_fights(later, earlier) is None
    # HP not read.
    blind = [replace(u, hp=None) for u in FRAMES[4]]
    assert pair_fights(FRAMES[3], blind) is None
    # Nothing happened.
    assert pair_fights(FRAMES[1], FRAMES[2]).fights == ()


@pytest.mark.parametrize("budget", [2.0])
def test_one_fight_is_quick(budget):
    import time

    start = time.monotonic()
    fights_between(3, 4, budget=budget)
    assert time.monotonic() - start < 0.5


def test_links_come_from_the_allies_in_reach_and_only_on_the_player_phase():
    from app.gamemem.combat import Fighter
    from app.gamemem.pairing import ARMY_ATK, _Scorer, _Unit

    # Byleth on the Swordmaster bandit (frame 3): Hanneman, Flayn and Lysithea linked (test_combat).
    before, after = FRAMES[3], FRAMES[4]
    old = {u.slot: u for u in before}
    units = {
        s: _Unit(s, old[s].army, old[s], next(u for u in after if u.slot == s), Fighter.from_unit(old[s]), 1, 0, {}, True, (old[s].x, old[s].y))
        for s in (POOL_START + 0, POOL_START + 39)
    }
    allies = [(u.slot, Fighter.from_unit(u), u.x, u.y) for u in after if u.army and u.hp]
    scorer = _Scorer(units, {}, allies)
    byleth = scorer._links(POOL_START + 0, POOL_START + 39)
    assert abs(sum(p for _, p in byleth) - 1) < 1e-9
    assert any(link.atk == 1 and link.hit == 12 for link, _ in byleth)  # what he had: +1 Mt, +13 (rounded to 12)
    assert all(link.hit == 0 for link, _ in scorer._links(POOL_START + 39, POOL_START + 0))  # the enemy's attack: no links
    assert [link.atk for link, _ in scorer._defender_links(POOL_START + 0)] == [extra for extra, _ in ARMY_ATK]


def test_the_fight_is_found_even_when_a_read_caught_the_weapon_use_late():
    # Byleth's fight: frame 4 already has his HP change but not his Iron Sword's use (it shows on frame 5, 0.12 s
    # later). The tracker's samples need two reads in a row to agree, so it compares 3 with 5.
    late = fights_between(3, 4)
    settled = fights_between(3, 5)
    assert late.fights[0].attacker == POOL_START + 0  # still right, through the fallback
    assert [(f.attacker, f.defender) for f in settled.fights] == [(POOL_START + 0, POOL_START + 39)]
    assert fights_between(0, len(FRAMES) - 1, budget=30).exact  # the whole turn too


# turns 5-7 of the same map, read by the tracker every 0.5 s while the game's Auto-Battle played; turn 6's enemy phase
# twice (a Divine Pulse in between). Indexes below are its reads.
LATER = captures.read_json("battle", "oil_and_water_turns5_7.json", default=NO_CAPTURE)
LATER_FRAMES = [fixture_units(f) for f in LATER["frames"]]
P = LATER["frames"][0]["pool_start"] if LATER_FRAMES else 0
MANUELA, BYLETH, LORENZ = P + 4, P + 0, P + 7


def later(a: int, **kw):
    return pair_fights(LATER_FRAMES[a], LATER_FRAMES[a + 1], **kw)


def test_one_unit_attacked_twice_in_an_enemy_phase():
    # Bandits 11 and 14 (pool 42, 45) both attacked Manuela between two reads: 0 damage, then 18 (she fell), as the
    # game's Divine Pulse screen listed them.
    result = later(5)
    assert result.exact
    assert sorted((f.attacker, f.defender, f.defender_lost) for f in result.fights) == [(P + 42, MANUELA, 0), (P + 45, MANUELA, 18)]
    assert all(f.confidence >= SURE for f in result.fights)


def test_reads_across_a_divine_pulse_are_not_paired():
    # Read 8 is after time was turned back to the start of turn 6: Manuela is alive again.
    assert later(7) is None


def test_later_turns_fights_and_who_started_them():
    found = {a: [(f.attacker, f.defender) for f in later(a, enemy_phase=a == 11).fights] for a in (3, 4, 10, 11, 13)}
    assert found == {
        3: [(P + 53, BYLETH)],  # Bandit 22 attacked Byleth on the enemy phase (20 damage, hit back for 15)
        4: [(BYLETH, P + 53)],  # Byleth defeated it on turn 6
        10: [(BYLETH, P + 53)],  # and again after the Divine Pulse
        11: [(P + 50, LORENZ)],  # Bandit 19 attacked Lorenz on the enemy phase (16, hit back for 20)
        13: [(LORENZ, P + 50)],  # Lorenz defeated it on turn 7
    }


def test_the_enemy_phase_shows_in_the_acted_flags():
    # Your units' acted flags were set after their actions (read 1) and all cleared when the enemy phase began (read 2).
    assert enemy_phase_began(LATER_FRAMES[1], LATER_FRAMES[2])
    assert not enemy_phase_began(LATER_FRAMES[0], LATER_FRAMES[1]) and not enemy_phase_began(LATER_FRAMES[2], LATER_FRAMES[3])


def test_a_pair_that_fought_on_both_phases():
    # Manuela attacked Thief 1 on turn 5's player phase, and the Thief attacked her on the enemy phase (and fell to her
    # counter). The second fight looks the same either way round; knowing it's the enemy phase settles it.
    assert [(f.attacker, f.defender) for f in later(0).fights] == [(MANUELA, P + 30)]
    [guess] = later(2).fights
    assert guess.confidence < SURE  # without the phase: a guess, shown as one
    [fight] = later(2, enemy_phase=True).fights
    assert (fight.attacker, fight.defender) == (P + 30, MANUELA) and fight.confidence >= SURE
