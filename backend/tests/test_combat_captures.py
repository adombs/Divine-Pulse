"""The combat math (gamemem/combat.py) against the game's own forecasts and status screens, recorded from your own
game (see helpers/captures.py) and checked with your own import."""

from dataclasses import replace

import pytest

from app.gamemem.battle import RECORD_SIZE, BattleUnit, decode_record
from app.gamemem.combat import Fighter, Link, combat_stats, outcomes
from test_combat import forecast
from helpers import captures

pytestmark = [pytest.mark.needs_captures, pytest.mark.needs_game_import]
NO_CAPTURE = {"frames": [], "forecasts": [], "status": [], "history": []}


def fixture_units(frame: dict) -> list[BattleUnit]:
    """A recorded frame's units, decoded from their raw record bytes like a live read."""
    units = []
    for u in frame["units"]:
        record = bytes.fromhex(u["record"])
        unit = decode_record(record + bytes(RECORD_SIZE - len(record)), 0, {u["character"]} if u["army"] else set())
        units.append(replace(unit, army=u["army"], hp=u["hp"], x=u["x"], y=u["y"], slot=u["slot"]))
    return units


DATA = captures.read_json("battle", "oil_and_water_turn2.json", default=NO_CAPTURE)
UNITS = fixture_units(DATA["frames"][0]) if DATA["frames"] else []


def weapon_name(weapon) -> str:
    from app.infrastructure import game_tables

    return game_tables.memory()["spells" if weapon.spell else "weapons"][str(weapon.id)]["name"]


def army_unit(character: int) -> BattleUnit:
    return next(u for u in UNITS if u.army and u.character == character)


def other_at(x: int, y: int) -> BattleUnit:
    return next(u for u in UNITS if not u.army and (u.x, u.y) == (x, y))


def test_decodes_abilities_and_spells_from_the_record():
    lysithea = army_unit(22)
    assert lysithea.abilities == (28, 32, 64, 66, 88)  # Reason Lv 4, Faith Lv 3, HP +5, Magic +2, Fiendish Blow
    assert lysithea.spells[10] == 0 and lysithea.spell_uses[10] == 10  # Fire, the Mage class's spell
    assert army_unit(28).spells[2] == 4  # Hanneman's Thoron
    assert army_unit(0).spells == (None,) * 12


@pytest.mark.parametrize("status", DATA["status"], ids=lambda s: str(s["character"]))
def test_status_screens(status):
    unit = next(u for u in UNITS if u.character == status["character"] and (u.x, u.y) == tuple(status["at"]) and (u.army or u.character != 0))
    f = Fighter.from_unit(unit)
    arm = next(a for a in f.arms if a.weapon.id == status["weapon"])
    s = combat_stats(f, arm)
    assert {k: f.stats[k] for k in status["stats"]} == status["stats"]
    shows = status["shows"]
    assert (s.atk, s.hit, s.crit, s.attack_speed, s.prt, s.rsl, s.avo) == (
        shows["atk"], shows["hit"], shows["crit"], shows["as"], shows["prt"], shows["rsl"], shows["avo"],
    )


# What linked allies added to the attacker in each forecast (Atk, Hit, Avo): the part the model can't know exactly (it
# depends on support ranks). Everything else in the forecast must come out exactly. Lorenz's Hit is capped at 100, so
# any link of +3 Hit or more fits; Hanneman's target can't counter, so his link's Avo doesn't show. Hanneman's +1 Atk
# and Lysithea's Avo 1 short of her +3 aren't from links (see test_linked_allies): battalions, probably.
LINKS = [Link(1, 13, 13), Link(1, 13, 13), Link(0, 3, 2), Link(1, 13, 13), Link(0, 3, 5), Link(0, 5, 5), Link(1, 6, 0)]
# Where Lorenz attacked from (he moved on with Canto, so the forecast didn't record it): see frame 9.
LORENZ_AT = (2, 27)


@pytest.mark.parametrize("i", range(len(DATA["forecasts"])))
def test_forecasts(i):
    fc = DATA["forecasts"][i]
    a = Fighter.from_unit(army_unit(fc["attacker"]))
    d = Fighter.from_unit(other_at(*fc["defender_at"]), hp=fc["defender_hp"])
    if "weapon" in fc:
        arm = next(x for x in a.arms if x.weapon.id == fc["weapon"] and not x.weapon.spell)
    else:
        arm = next(x for x in a.arms if x.weapon.spell and x.weapon.id == fc["spell"])
    at = fc["attacker_at"] or LORENZ_AT
    distance = abs(at[0] - fc["defender_at"][0]) + abs(at[1] - fc["defender_at"][1])
    result = forecast(a, arm, d, d.arms[0] if d.arms else None, distance, LINKS[i])
    shown = fc["attacker_shows"]
    assert (result.attacker.mt, result.attacker.hit, result.attacker.crit, result.order.count("a") > 1) == (shown["mt"], shown["hit"], shown["crit"], shown["x2"])
    if fc["defender_shows"] is None:
        assert result.defender is None
    else:
        shown = fc["defender_shows"]
        assert result.defender is not None
        assert (result.defender.mt, result.defender.hit, result.defender.crit, result.order.count("d") > 1) == (shown["mt"], shown["hit"], shown["crit"], shown["x2"])


def test_without_links_only_the_attackers_side_moves():
    # Damage the defender deals and both crits don't depend on links at all.
    fc = DATA["forecasts"][4]  # Lorenz: the bandit doubles him
    a, d = Fighter.from_unit(army_unit(19)), Fighter.from_unit(other_at(3, 27), hp=24)
    arm = next(x for x in a.arms if x.weapon.id == fc["weapon"])
    plain = forecast(a, arm, d, d.arms[0], 1)
    assert (plain.attacker.mt, plain.defender.mt, plain.defender.crit) == (16, 17, 5)
    assert plain.order == ("a", "d", "d")
    assert plain.defender.hit > fc["defender_shows"]["hit"]  # Lorenz's linked allies made him harder to hit


def test_outcomes_of_lorenzs_fight_include_what_happened():
    a, d = Fighter.from_unit(army_unit(19)), Fighter.from_unit(other_at(3, 27), hp=24)
    arm = next(x for x in a.arms if x.weapon.id == 24)
    chances = outcomes(forecast(a, arm, d, d.arms[0], 1, LINKS[4]), 42, 24)
    assert sum(chances.values()) == pytest.approx(1)
    # He hit for 16 and took 17 twice (frames 7-10).
    happened = [(o, p) for o, p in chances.items() if (o.a_lost, o.d_lost, o.a_hits, o.d_hits) == (34, 16, 1, 2)]
    assert happened and happened[0][1] > 0.3


def test_strikes_twice_weapons_and_effective_damage():
    brawler = Fighter.from_unit(other_at(5, 15))  # Steel Gauntlets
    pegasus = Fighter.from_unit(other_at(9, 3))
    archer = Fighter.from_unit(other_at(0, 15))  # Steel Bow
    fc = forecast(brawler, brawler.arms[0], Fighter.from_unit(army_unit(0)), None, 1)
    assert fc.attacker.strikes_twice and fc.defender is None
    bow = forecast(archer, archer.arms[0], pegasus, pegasus.arms[0], 2)
    plain = forecast(archer, archer.arms[0], brawler, brawler.arms[0], 2)
    # Bows are effective against fliers: Mt x3 (Steel Bow Mt 9 -> 27).
    assert bow.attacker.mt - plain.attacker.mt == 18 + brawler.stats["def"] - pegasus.stats["def"]
    assert bow.defender is None  # a lance can't reach two tiles


def test_true_hit_rolls_two_numbers():
    from app.gamemem.combat import true_hit

    # A published analysis of the game: a displayed 80 lands 92.2% of the time, a displayed 10 only 2.1%.
    assert (round(true_hit(80), 3), round(true_hit(10), 3)) == (0.922, 0.021)
    assert (true_hit(0), true_hit(100)) == (0, 1)


def test_sword_of_the_creator_reaches_two_tiles():
    from app.gamemem.combat import max_range

    byleth = Fighter.from_unit(army_unit(0))
    sword = next(a for a in byleth.arms if weapon_name(a.weapon) == "Sword of the Creator")
    assert sword.weapon.max_range == 150 and max_range(byleth, sword) == 2  # the game shows Rng 1-2 (the table's 150 isn't its reach)


# Who linked each player attack in the capture, by the game's rule (combat.linked_allies), and the Hit the forecast
# showed from them: (attacker, frame, target, allies, Hit).
LINKED = [
    (0, 3, (3, 27), ["Hanneman", "Flayn", "Lysithea"], 13),  # Flayn C with Byleth (+5, +1 Mt: a Might pair), one C, one none
    (22, 0, (2, 27), ["Hanneman", "Flayn"], 3),  # Hanneman's Thoron reaches 1 tile (his Iron Bow wouldn't); Flayn can't support her
    (19, 8, (3, 27), ["Byleth (M)", "Hanneman", "Flayn"], 5),  # (Lysithea, 4th in reach, left out); only Byleth can support him
    (34, 13, (3, 27), ["Byleth (M)", "Hanneman", "Flayn"], 5),
    (28, 15, (3, 27), ["Byleth (M)", "Flayn", "Lysithea"], 6),  # (Cyril, 4th, left out)
]


@pytest.mark.parametrize("case", LINKED, ids=lambda c: str(c[0]))
def test_linked_allies(case):
    from app.gamemem.combat import combat_data, link_options, linked_allies

    character, frame, target, expected, hit = case
    units = fixture_units(DATA["frames"][frame])
    allies = [(u.slot, Fighter.from_unit(u), u.x, u.y) for u in units if u.army and u.hp]
    attacker = next(f for _, f, _, _ in allies if f.unit.character == character)
    linked = linked_allies(attacker.unit.slot, target, allies)
    names = combat_data().names
    assert [names[f.unit.character] for f in linked] == expected
    assert hit in {link.hit for link, _ in link_options(attacker, linked)}


def test_cyril_with_an_axe_equipped_doesnt_link_from_two_tiles():
    from app.gamemem.combat import can_link

    cyril = Fighter.from_unit(army_unit(34))  # Steel Axe+ first; bows further down
    assert can_link(cyril, 1) and not can_link(cyril, 2)
    hanneman = Fighter.from_unit(army_unit(28))  # Iron Bow first, Thoron equipped
    assert weapon_name(hanneman.equipped.weapon) == "Thoron" and can_link(hanneman, 1)
    assert not can_link(Fighter.from_unit(replace(army_unit(28), equipped=1)), 1)  # with the bow equipped


def test_equipped_spell_or_weapon_from_the_record():
    from app.gamemem.combat import weapon_kind

    lysithea = army_unit(22)  # Iron Bow first in her inventory
    assert lysithea.equipped_spell == 29 and weapon_kind(lysithea) == "faith"  # Seraphim
    after_fire = next(u for u in fixture_units(DATA["frames"][1]) if u.army and u.character == 22)
    assert after_fire.equipped_spell == 0 and weapon_kind(after_fire) == "reason"  # casting Fire equipped it
    assert weapon_name(Fighter.from_unit(after_fire).equipped.weapon) == "Fire"
    # Seen live: Lysithea with Miasma (14) equipped showed a bow badge while the field went unread.
    assert weapon_kind(replace(lysithea, equipped=4014)) == "dark"
    assert weapon_kind(replace(lysithea, equipped=None)) == "bow"  # not read: the first weapon, as before
    byleth = army_unit(0)
    assert byleth.equipped == 1 and byleth.equipped_spell is None and weapon_kind(byleth) == "sword"
    assert Fighter.from_unit(byleth).equipped.item_slot == 0
    mages = [u for u in UNITS if not u.army and not u.items and u.equipped_spell == 0]  # the bandit mages: Fire
    assert mages and all(weapon_kind(u) == "reason" for u in mages)


def test_class_abilities_are_the_innate_ones():
    # As the class-ability guides list them: beginner classes have none of their own, the slot after the mastery
    # ability isn't the class's (Swordmaster's Defense +2, Myrmidon's Axe Crit +10, Lord's Lance Prowess Lv 2).
    from app.gamemem.combat import combat_data

    data = combat_data()
    from app.infrastructure import game_tables

    ability_names = game_tables.memory()["abilities"]

    def innate(class_id):
        return [ability_names[a] for a in data.classes[class_id].abilities]

    assert innate(2) == innate(3) == innate(4) == innate(5) == []  # Myrmidon, Soldier, Fighter, Monk
    assert innate(19) == ["Swordfaire", "Sword Crit +10"]
    assert innate(6) == ["Charm"]
    assert innate(20) == ["Swordfaire", "Locktouch", "Stealth"]  # Assassin (a full row: positions known)
    assert innate(38) == ["Fistfaire", "Axefaire", "Crit +20"]  # War Master: its Avo +10 is in the slot that isn't
    assert innate(52) == ["Axefaire", "Weight -5"]  # an enemy-only Fortress Knight: no mastery ability
