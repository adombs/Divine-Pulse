"""Memory mode against a roster read from your own game (see helpers/captures.py) and your own import: the readings
must match what the Status page showed."""

import struct

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE
from app.gamemem import fe3h
from app.gamemem.fe3h import ROSTER_SIZE, RosterUnit, decode_player_name, decode_roster
from app.gamemem.units import GameData, to_reading
from app.handlers import apply_unit_stats
from app.infrastructure.saved_models import Run
from helpers import captures

pytestmark = [pytest.mark.needs_captures, pytest.mark.needs_game_import]

DATA = captures.read_bytes("memory", "roster_1_2_0.bin")
ROSTER, NAME = DATA[:ROSTER_SIZE], DATA[ROSTER_SIZE:]
ARMY = {0, 4, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 32, 33, 34}

# What the Status page shows for these units (hp, mv, str, mag, dex, spd, lck, def, res, cha).
ON_SCREEN = {
    "Byleth": (40, 5, 22, 11, 14, 20, 17, 7, 11, 16),  # Mercenary, HP +5, Speed +2
    "Lorenz": (42, 7, 18, 10, 22, 13, 9, 12, 13, 14),  # mounted Cavalier: Spd -2, Mv +3
    "Leonie": (37, 8, 20, 12, 27, 17, 14, 16, 5, 13),  # Cavalier with a March Ring (Mv +1)
    "Lysithea": (32, 4, 5, 25, 17, 15, 8, 4, 12, 11),  # Mage
    "Marianne": (32, 4, 7, 23, 16, 12, 15, 8, 22, 13),  # Priest
    "Catherine": (38, 4, 17, 8, 12, 17, 10, 12, 8, 8),  # Noble: no class boost
}
KEYS = ("hp", "mv", "str", "mag", "dex", "spd", "lck", "def", "res", "cha")


@pytest.fixture(scope="module")
def data():
    return GameData.load()


@pytest.fixture(scope="module")
def bonuses():
    return BonusTable.load(BONUSES_FILE)


def readings(data, bonuses):
    name = decode_player_name(NAME)
    return {r.name_candidates[0]: r for r in (to_reading(u, data, bonuses, player_name=name) for u in decode_roster(ROSTER))}


def test_decodes_only_the_army():
    units = decode_roster(ROSTER)
    assert {u.character for u in units} == ARMY
    raphael = next(u for u in units if u.character == 20)
    assert (raphael.level, raphael.class_id) == (16, 4)
    assert raphael.raw == {"hp": 42, "str": 19, "mag": 7, "dex": 8, "spd": 9, "lck": 9, "def": 13, "res": 4, "mv": 4, "cha": 11}
    assert raphael.abilities == (12, 165, 6, 64, 177)
    accessories = {u.character: u.accessory for u in units}
    assert accessories[25] == 16  # Leonie: March Ring
    assert accessories[23] == 2  # Marianne: Steel Shield
    assert accessories[19] is None  # Lorenz: none


def test_decodes_inventory_and_learned_spells(data, bonuses):
    units = {u.character: u for u in decode_roster(ROSTER)}
    assert units[0].items == ((146, 10), (72, 15), (147, 45), (21, 33), (16, 20), (1001, 3))
    assert units[0].spells == ()
    assert units[19].spells[:3] == ((0, 10), (11, 10), (2, 3))  # Lorenz
    carried = {i.name: (i.kind, i.uses, i.equipped) for i in readings(data, bonuses)["Marianne"].abilities.inventory}
    assert carried["Steel Shield"] == ("equipment", 100, True)
    assert carried["Vulnerary"] == ("item", 3, False)
    assert any(k == "spell" for k, _, _ in carried.values())

    # An empty raw slot zero stays unequipped even when its weapon becomes the first compacted item.
    roster = bytearray(ROSTER)
    slot = next(
        i for i in range(fe3h.SLOTS)
        if struct.unpack_from("<H", roster, i * fe3h.SLOT_SIZE + fe3h._CHARACTER)[0] == 0
    )
    offset = slot * fe3h.SLOT_SIZE
    struct.pack_into("<12H", roster, offset + fe3h._ITEMS, 0xFFFF, 0, 16, 40, *([0xFFFF, 0] * 4))
    struct.pack_into("<H", roster, offset + fe3h._EQUIPPED, fe3h.EQUIPPED_WEAPON)
    unit = next(u for u in decode_roster(bytes(roster)) if u.character == 0)
    assert unit.item_slot_0 is None and unit.items == ((16, 40),)
    reading = to_reading(unit, data, bonuses, player_name="Test")
    assert reading.abilities.inventory[0].equipped is False


def test_decodes_learned_abilities_and_arts(data, bonuses):
    units = decode_roster(ROSTER)
    for u in units:  # whatever is equipped has been learned
        assert set(u.abilities) <= set(u.learned_abilities), u.character
        assert {a for a in u.arts if a < 80} <= set(u.learned_arts), u.character
    claude = readings(data, bonuses)["Claude"].abilities
    assert "Bow Prowess Lv 3" in claude.learned and "Bow Prowess Lv 1" not in claude.learned  # only the highest level
    assert {"Curved Shot", "Monster Blast"} <= set(claude.learned_arts)


def test_decodes_the_battalion(data, bonuses):
    units = {u.character: u for u in decode_roster(ROSTER)}
    assert (units[28].battalion, units[29].battalion) == (4, 3)  # Hanneman, Manuela
    assert all(u.battalion is None for c, u in units.items() if c not in (28, 29))
    got = readings(data, bonuses)
    assert got["Hanneman"].abilities.battalion == "Seiros Magic Corps"
    assert got["Manuela"].abilities.battalion == "Seiros Sacred Monks"
    assert got["Claude"].abilities.battalion == ""
    # Seen live: Church of Seiros Soldiers (ID 0) assigned to Byleth, slot 0.
    roster = bytearray(ROSTER)
    roster[0x18:0x1A] = bytes(2)
    roster[0x1E] = 0
    assert next(u for u in decode_roster(bytes(roster)) if u.character == 0).battalion == 0


def test_player_name():
    assert decode_player_name(NAME) == "Byleth"
    assert decode_player_name(b"\x1bN0Rowan\x1bN1\0\0") == "Rowan"
    assert decode_player_name(b"\0" * 8) is None
    assert decode_player_name(b"\xff\xfe\x01\0") is None


def test_on_screen_values(data, bonuses):
    got = readings(data, bonuses)
    for name, values in ON_SCREEN.items():
        assert tuple(got[name].values[k] for k in KEYS) == values, name


def test_status_page_values_from_memory(data, bonuses):
    got = readings(data, bonuses)
    leonie = got["Leonie"]
    assert (leonie.full_name, leonie.class_name, leonie.gender) == ("Leonie Pinelli", "Cavalier", "Female")
    assert leonie.abilities.equipped == ["Strength +2", "Bow Prowess Lv 3", "HP +5", "Close Counter", "Dexterity +4"]
    assert (leonie.abilities.personal, leonie.abilities.accessory) == ("Rivalry", "March Ring")
    assert leonie.blue == {"hp", "str", "dex"}  # Mv is not shown in blue
    assert got["Flayn"].full_name == "Flayn"
    assert got["Hanneman"].full_name == "Hanneman von Essar"
    assert "Authority Lv 1" in got["Hanneman"].abilities.equipped
    assert got["Byleth"].full_name == "Byleth" and got["Byleth"].gender == "Male"
    assert all(r.game_id is not None for r in got.values())
    assert got["Manuela"].abilities.arts == ["Wrath Strike", "Grounder", "Hexblade"]
    assert got["Lysithea"].abilities.arts == ["Draw Back"]  # the other two slots are empty


def test_upgraded_personal_ability_is_kept(data, bonuses):
    claude = next(u for u in decode_roster(ROSTER) if u.character == 4)
    assert to_reading(claude, data, bonuses).abilities.personal == "Leicester Lineage"
    assert to_reading(claude, data, bonuses, current_personal="Leicester Lineage+").abilities.personal == "Leicester Lineage+"


def test_skill_progress_flows_from_roster_bytes_to_unit_api(data, bonuses):
    roster = bytearray(ROSTER)
    slot = next(
        i for i in range(fe3h.SLOTS)
        if struct.unpack_from("<H", roster, i * fe3h.SLOT_SIZE + fe3h._CHARACTER)[0] == 0
    )
    start = slot * fe3h.SLOT_SIZE
    roster[start + 0x88 : start + 0x93] = bytes([6, 0, 0, 5, 1, 0, 1, 2, 0, 0, 0])
    struct.pack_into("<11H", roster, start + 0x32, 171, 28, 0, 14, 39, 32, 23, 48, 0, 0, 0)

    decoded = next(u for u in decode_roster(bytes(roster)) if u.character == 0)
    reading = to_reading(decoded, data, bonuses)
    run = Run(id="skills", name="Skills")
    outcome = apply_unit_stats(reading, run, bonuses)

    unit = outcome.changes[0].after
    assert unit.skills["sword"].rank == "B"
    assert unit.skills["sword"].exp == 171
    assert unit.skills["bow"].rank == "C+"
    assert unit.skills["bow"].exp == 14
    assert unit.model_dump(mode="json")["skills"]["sword"] == {"rank": "B", "exp": 171}


def test_female_class_name(data, bonuses):
    marianne = RosterUnit(23, 20, 85, {k: 10 for k in KEYS}, (), None)
    assert to_reading(marianne, data, bonuses).class_name == "War Cleric"


def test_unknown_character_and_class(data, bonuses):
    unit = RosterUnit(5000, 20, 123, {k: 10 for k in KEYS}, (), None)
    reading = to_reading(unit, data, bonuses)
    assert reading.name_candidates == ["Character 5000"]
    assert reading.class_name == "Unknown class 123"


def test_renamed_byleth(data, bonuses):
    byleth = next(u for u in decode_roster(ROSTER) if u.character == 0)
    r = to_reading(byleth, data, bonuses, player_name="Rowan")
    assert r.name_candidates == ["Rowan"] and r.full_name == "Rowan"


def test_enemy_names_are_the_ones_the_game_shows(data):
    # Generic characters take their name by name ID: on one map, characters 508-510 are bandits whose own IDs would
    # name monastery staff. Checked against the units' names on the map.
    assert data.generic_names[114] == "Bandit"
    assert (data.generic_names[508], data.generic_names[509], data.generic_names[510]) == ("Bandit Leader", "Bandit", "Thief")


def test_only_byleth_gets_a_look(data, bonuses):
    units = decode_roster(ROSTER)
    byleth = next(u for u in units if u.character == 0)
    claude = next(u for u in units if u.character == 4)
    assert to_reading(byleth, data, bonuses, scenario=12).look == "green"
    assert to_reading(byleth, data, bonuses, scenario=3).look == "dark"
    assert to_reading(byleth, data, bonuses).look is None
    assert to_reading(claude, data, bonuses, scenario=12).look is None
