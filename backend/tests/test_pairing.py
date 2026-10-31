"""Fight pairing (gamemem/pairing.py) on made-up reads of the battle pool, with the tables of
helpers/synthetic_roster.py. tests/test_pairing_captures.py measures it against the game's own history."""

from dataclasses import replace

import pytest

from app.gamemem.battle import BattleUnit
from app.gamemem.pairing import enemy_phase_began, pair_fights

SWORD, LANCE = 16, 22
ARMY_SLOT, FOE_SLOT, OTHER_FOE_SLOT = 100, 200, 300
RAW = {"hp": 40, "str": 21, "mag": 12, "dex": 14, "spd": 18, "lck": 17, "def": 7, "res": 11, "mv": 4, "cha": 16}


@pytest.fixture(autouse=True)
def tables(roster_import):
    return roster_import


def unit(slot, character, class_id, army, hp, x, y, items, combats=0, victories=0, **raw) -> BattleUnit:
    return BattleUnit(
        character, army, 17, class_id, {**RAW, **raw}, hp=hp, x=x, y=y, items=items, slot=slot, combats=combats,
        victories=victories, spells=(None,) * 12, spell_uses=(0,) * 12,
    )


def mercenary(hp=41, uses=40, **kw):
    return unit(ARMY_SLOT, 0, 7, True, hp, 5, 5, ((SWORD, uses),), **kw)


def brigand(slot=FOE_SLOT, hp=30, uses=40, x=6, y=5, **kw):
    return unit(slot, 509, 11, False, hp, x, y, ((LANCE, uses),), **kw)


def fought(before, after, **kw):
    return pair_fights(before, after, **kw)


# Mercenary: Atk 27 against the brigand's Def 7 (20 damage). Brigand: Atk 26 against Def 7 (19). Equal Attack Speed, so
# one strike each.
BEFORE = [mercenary(), brigand()]
# The mercenary walked up to the brigand this turn, which makes it the likelier attacker.
ORIGINS = {ARMY_SLOT: (3, 5)}


def one_fight(attacker_hp_lost=19, defender_hp_lost=20, **after):
    return [
        mercenary(hp=41 - attacker_hp_lost, uses=39, combats=1, **after),
        brigand(hp=30 - defender_hp_lost, uses=39, combats=1),
    ]


def test_a_fight_is_found_with_who_started_it_and_the_damage():
    result = fought(BEFORE, one_fight(), origins=ORIGINS)
    assert result.exact
    [fight] = result.fights
    assert (fight.attacker, fight.defender) == (ARMY_SLOT, FOE_SLOT)
    assert (fight.attacker_lost, fight.defender_lost, fight.defeated) == (19, 20, None)
    assert fight.confidence >= 0.6


def test_a_defeat_is_credited_to_the_unit_that_won():
    after = [
        mercenary(hp=41, uses=39, combats=1, victories=1),
        replace(brigand(hp=0, uses=40, combats=1), hp=0),
    ]
    before = [mercenary(), brigand(hp=20)]
    [fight] = fought(before, after, origins=ORIGINS).fights
    assert fight.defeated == FOE_SLOT and (fight.attacker, fight.defender) == (ARMY_SLOT, FOE_SLOT)


def test_the_enemy_phase_settles_who_started_a_fight():
    # The same reads, read on the enemy phase: the brigand attacked.
    [fight] = fought(BEFORE, one_fight(), enemy_phase=True).fights
    assert (fight.attacker, fight.defender) == (FOE_SLOT, ARMY_SLOT)


def test_two_foes_each_get_their_own_fight():
    far = brigand(slot=OTHER_FOE_SLOT, x=4, y=5)
    before = [mercenary(), brigand(), far, unit(ARMY_SLOT + 1, 4, 12, True, 36, 6, 4, ((SWORD, 40),))]
    after = [
        mercenary(hp=41 - 19, uses=39, combats=1),
        brigand(hp=10, uses=39, combats=1),
        replace(far, combats=1, items=((LANCE, 39),), hp=30 - 20),
        unit(ARMY_SLOT + 1, 4, 12, True, 36 - 19, 6, 4, ((SWORD, 39),), combats=1),
    ]
    result = fought(before, after)
    assert len(result.fights) == 2
    assert {(f.attacker, f.defender) for f in result.fights} <= {
        (ARMY_SLOT, FOE_SLOT), (ARMY_SLOT, OTHER_FOE_SLOT), (ARMY_SLOT + 1, FOE_SLOT), (ARMY_SLOT + 1, OTHER_FOE_SLOT),
        (FOE_SLOT, ARMY_SLOT), (OTHER_FOE_SLOT, ARMY_SLOT), (FOE_SLOT, ARMY_SLOT + 1), (OTHER_FOE_SLOT, ARMY_SLOT + 1),
    }
    assert sorted(f.defender_lost + f.attacker_lost for f in result.fights) == [39, 39]


def test_a_foe_out_of_reach_is_not_paired():
    apart = [mercenary(), brigand(x=20)]
    result = fought(apart, [mercenary(hp=22, uses=39, combats=1), brigand(hp=10, uses=39, combats=1, x=20)])
    assert not result.fights and not result.exact


def test_reads_that_cant_be_compared():
    # Time turned back: counters going down.
    assert fought(one_fight(), BEFORE) is None
    # HP not read.
    assert fought(BEFORE, [replace(u, hp=None) for u in one_fight()]) is None
    # Weapon uses that came back.
    assert fought(one_fight(), [mercenary(uses=40, combats=2), brigand(hp=10, uses=39, combats=2)]) is None
    # Nothing happened.
    assert fought(BEFORE, BEFORE).fights == ()


def test_the_second_record_of_an_army_unit_is_not_a_foe():
    twin = replace(mercenary(), army=False, slot=ARMY_SLOT + 50)
    result = fought([*BEFORE, twin], [*one_fight(), replace(twin, hp=twin.hp)])
    assert len(result.fights) == 1


def test_enemy_phase_shows_in_the_acted_flags():
    done = replace(mercenary(), acted=True)
    fresh = replace(mercenary(), acted=False)
    assert enemy_phase_began([done, brigand()], [fresh, brigand()])
    assert not enemy_phase_began([fresh], [fresh]) and not enemy_phase_began([done], [done])


def test_every_fight_in_a_long_gap_is_paired_within_the_time_budget():
    foes = [brigand(slot=FOE_SLOT + n, x=6, y=4 + n) for n in range(3)]
    team = [unit(ARMY_SLOT + n, 4 + n, 12, True, 36, 5, 4 + n, ((SWORD, 40),)) for n in range(3)]
    before = [*team, *foes]
    after = [
        replace(u, hp=u.hp - 19, items=((SWORD, 39),), combats=1) for u in team
    ] + [replace(f, hp=10, items=((LANCE, 39),), combats=1) for f in foes]
    result = fought(before, after, budget=5)
    assert len(result.fights) == 3 and not result.partial
