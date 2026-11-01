"""The combat math (gamemem/combat.py) on made-up units and the made-up tables of helpers/synthetic_roster.py.
tests/test_combat_captures.py checks it against the game's own forecasts."""

from dataclasses import replace

import pytest

from app.gamemem.battle import BattleUnit
from app.gamemem.combat import Fighter, combat_stats, fight_stats, forecast_from, linked_allies, link_options, outcomes, true_hit, weapon_kind
from app.domain.combat import EQUIPPED_SPELL

SWORD, LANCE, TWIN, BOW, FIRE = 16, 22, 17, 72, 0
RAW = {"hp": 40, "str": 21, "mag": 12, "dex": 14, "spd": 18, "lck": 17, "def": 7, "res": 11, "mv": 4, "cha": 16}


def forecast(a, a_arm, d, d_arm, distance, *links, **kwargs):
    """Compose the same forecast stages used by the live pairing scorer."""
    return forecast_from(a, a_arm, d, d_arm, fight_stats(a, a_arm, d, d_arm, distance), *links, **kwargs)


@pytest.fixture(autouse=True)
def tables(roster_import):
    return roster_import


def unit(character=0, class_id=7, items=((SWORD, 40),), hp=40, army=True, x=1, y=1, spells=(), uses=(), **raw) -> BattleUnit:
    return BattleUnit(
        character, army, 17, class_id, {**RAW, **raw}, hp=hp, x=x, y=y, items=items, slot=character,
        spells=(*spells, *[None] * (12 - len(spells))), spell_uses=(*uses, *[0] * (12 - len(uses))),
    )


def fighter(**kw) -> Fighter:
    return Fighter.from_unit(unit(**kw))


def test_on_screen_stats_add_the_class_boosts():
    f = fighter()  # Mercenary: HP +1, Str +1, Spd +1
    assert (f.stats["hp"], f.stats["str"], f.stats["spd"], f.stats["def"]) == (41, 22, 19, 7)
    assert fighter(class_id=10).stats["mv"] == 7  # a mounted class moves further


def test_a_weapons_numbers_come_into_the_stats():
    f = fighter()
    s = combat_stats(f, f.arms[0])
    # Atk = Str 22 + Mt 5; Hit = Dex 14 + 80; Crit = (Dex + Lck) / 2; AS = Spd 19 - (Wt 5 - Str / 5)
    assert (s.atk, s.hit, s.crit, s.attack_speed, s.prt, s.rsl) == (27, 94, 15, 18, 7, 11)
    assert combat_stats(f, None).atk == 22  # no weapon: the status screen's own


def test_magic_uses_magic_and_resistance():
    mage = Fighter.from_unit(replace(unit(22, 14, items=(), spells=(FIRE,), uses=(10,)), equipped=EQUIPPED_SPELL + FIRE))
    foe = fighter(character=509, class_id=11, army=False)
    fire = mage.arms[0]
    assert fire.weapon.spell and mage.equipped == fire
    result = forecast(mage, fire, foe, None, 2)
    assert result.attacker.mt == mage.stats["mag"] + 5 - foe.stats["res"] and result.defender is None
    assert weapon_kind(mage.unit) == "reason"


def test_forecast_both_sides_and_doubling():
    a, d = fighter(), fighter(character=509, class_id=11, army=False, spd=18)
    fc = forecast(a, a.arms[0], d, d.arms[0], 1)
    assert (fc.attacker.mt, fc.defender.mt) == (27 - 7, 26 - 7)  # Atk 27 and 26 against Def 7 each
    assert fc.order == ("a", "d")
    # Four more Attack Speed than the foe strikes twice.
    slow = fighter(character=509, class_id=11, army=False, spd=10)
    assert forecast(a, a.arms[0], slow, slow.arms[0], 1).order == ("a", "d", "a")


def test_a_foe_out_of_reach_cant_counter():
    a, d = fighter(), fighter(character=509, class_id=11, army=False)
    assert forecast(a, a.arms[0], d, d.arms[0], 2).defender is None  # a sword only reaches one tile
    archer, near = fighter(items=((BOW, 40),)), fighter(character=509, army=False)
    assert forecast(archer, archer.arms[0], near, near.arms[0], 2).defender is None


def test_strikes_twice_weapons_and_effective_damage():
    twin = fighter(items=((TWIN, 30),))
    foe = fighter(character=509, class_id=11, army=False)
    assert forecast(twin, twin.arms[0], foe, None, 1).attacker.strikes_twice
    archer, flier, walker = fighter(items=((BOW, 40),)), fighter(character=510, class_id=32, army=False), foe
    on_flier = forecast(archer, archer.arms[0], flier, None, 2).attacker.mt
    on_walker = forecast(archer, archer.arms[0], walker, None, 2).attacker.mt
    assert on_flier - on_walker == 5 * 2 + walker.stats["def"] - flier.stats["def"]  # Mt x3 against fliers


def test_a_tile_bonus_comes_off_the_damage_and_hit_against_the_unit_on_it():
    from app.gamemem.terrain import Ground

    a, d = fighter(), fighter(character=509, class_id=11, army=False)
    plain = forecast(a, a.arms[0], d, None, 1)
    woods = forecast(a, a.arms[0], d, None, 1, d_ground=Ground(avo=30, defense=1))
    assert woods.attacker.mt == plain.attacker.mt - 1 and woods.attacker.hit == plain.attacker.hit - 30


def test_true_hit_rolls_two_numbers():
    # A published analysis of the game: a displayed 80 lands 92.2% of the time, a displayed 10 only 2.1%.
    assert (round(true_hit(80), 3), round(true_hit(10), 3)) == (0.922, 0.021)
    assert (true_hit(0), true_hit(100)) == (0, 1)


def test_outcomes_add_up_and_include_what_happened():
    a, d = fighter(), fighter(character=509, class_id=11, army=False, spd=18)
    chances = outcomes(forecast(a, a.arms[0], d, d.arms[0], 1), 41, 30)
    assert sum(chances.values()) == pytest.approx(1)
    both_hit = [p for o, p in chances.items() if (o.a_hits, o.d_hits) == (1, 1)]
    assert both_hit and both_hit[0] > 0.5
    assert all(o.d_lost <= 30 and o.a_lost <= 41 for o in chances)


def test_allies_link_when_they_could_reach_the_target():
    fighters = [(1, fighter(character=0), 1, 1), (2, fighter(character=4, items=((LANCE, 40),)), 3, 1),
                (3, fighter(character=19, items=((BOW, 40),)), 4, 4), (4, fighter(character=20, hp=0), 1, 2)]
    # Slot 1 attacks the target at (2, 1): the lancer is 1 tile away, the archer 5, the fallen one doesn't count.
    linked = linked_allies(1, (2, 1), fighters)
    assert [f.unit.character for f in linked] == [4]
    options = link_options(fighter(character=0), linked)
    assert sum(p for _, p in options) == pytest.approx(1)


def test_what_a_unit_fights_with_follows_the_equipped_field():
    caster = replace(unit(22, 14, items=((SWORD, 40),), spells=(FIRE,), uses=(10,)), equipped=1)
    assert weapon_kind(caster) == "sword"
    assert weapon_kind(replace(caster, equipped=EQUIPPED_SPELL + FIRE)) == "reason"
    assert weapon_kind(replace(caster, items=())) == "reason"
    assert weapon_kind(unit(items=())) == ""


def test_crystal_weapon_icon_uses_raw_flag_without_changing_skill(monkeypatch):
    from app.gamemem.combat import CombatData, Weapon
    from app.infrastructure import inventory

    def row(skill, raw):
        return {"name": "Test", "uses": 20, "skill": skill, "might": 5, "hit": 80, "crit": 0,
                "weight": 2, "min_range": 1, "max_range": 1, "flags": 0, **raw}

    flagged = {"raw": "00" * 15 + "80"}
    rows = {"16": row(0, flagged), "17": row(4, flagged), "18": row(0, {}), "19": row(4, {"raw": "00"})}
    spells = {"0": row(5, flagged)}
    monkeypatch.setattr(inventory.game_tables, "memory", lambda: {
        "weapons": rows, "spells": spells, "abilities": [], "classes": {}, "characters": {},
    })
    inventory._load_tables.cache_clear()
    data = CombatData.load()
    for item, skill in ((16, 0), (17, 4)):
        assert data.weapons[item].skill == skill
        assert weapon_kind(unit(items=((item, 20),)), data) == "crest-stone"
        assert inventory.weapon_kind("weapon", item) == "crest-stone"
    for item, kind in ((18, "sword"), (19, "gauntlets")):
        assert weapon_kind(unit(items=((item, 20),)), data) == kind
        assert inventory.weapon_kind("weapon", item) == kind
    assert inventory.weapon_kind("spell", 0) == "reason"
    assert weapon_kind(replace(unit(items=((16, 20),), spells=(0,), uses=(10,)), equipped=EQUIPPED_SPELL), data) == "reason"
    assert Weapon.from_row(20, row(0, {"raw": "invalid"}), False).crest_stone is False
    inventory._load_tables.cache_clear()
