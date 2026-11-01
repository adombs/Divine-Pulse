"""Memory mode: decoding the roster, turning it into readings, and finding the game in Eden, on the made-up army of
helpers/synthetic_roster.py. tests/test_gamemem_captures.py checks the same against a roster read from a real game."""

import struct

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE
from app.gamemem import fe3h
from app.gamemem.fe3h import GameMemory, GameMemoryError, RosterUnit, decode_player_name, decode_roster
from app.gamemem.units import GameData, to_reading
from app.gamemem.emulators import EMULATORS
from app.handlers import apply_unit_stats
from app.infrastructure.saved_models import Run
from app.system.memory import AccessDenied, Region
from helpers.synthetic_roster import ARMY, DATA, KEYS, NAME, ROSTER, SLOT_OF

# What the Status page would show for these units (hp, mv, str, mag, dex, spd, lck, def, res, cha).
ON_SCREEN = {
    "Byleth": (41, 4, 22, 12, 14, 21, 17, 7, 11, 16),  # Mercenary, HP +5, Speed +2
    "Lorenz": (33, 8, 20, 9, 21, 12, 8, 11, 10, 14),  # mounted Cavalier: Spd -2, Mv +3, Movement +1
    "Leonie": (38, 8, 21, 10, 27, 13, 13, 15, 5, 13),  # Cavalier with a March Ring (Mv +1)
    "Lysithea": (30, 4, 3, 26, 14, 13, 8, 4, 12, 11),  # Mage
    "Marianne": (33, 4, 5, 20, 14, 12, 14, 8, 23, 13),  # Priest
    "Gilbert": (30, 4, 16, 3, 10, 11, 8, 14, 5, 10),  # Noble: no class boost
}


@pytest.fixture
def data(roster_import):
    return GameData.load()


@pytest.fixture
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
    assert raphael.abilities == (10, 2, 3, 1, 7)
    accessories = {u.character: u.accessory for u in units}
    assert accessories[25] == 16  # Leonie: March Ring
    assert accessories[23] == 2  # Marianne: Steel Shield
    assert accessories[19] is None  # Lorenz: none


def test_decodes_inventory_and_learned_spells(data, bonuses):
    units = {u.character: u for u in decode_roster(ROSTER)}
    assert units[0].items == ((22, 10), (72, 15), (21, 40), (44, 33), (21, 20), (1000, 3))
    assert units[0].spells == ()
    assert units[19].spells[:3] == ((0, 10), (9, 10), (2, 3))  # Lorenz
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
    assert got["Hanneman"].abilities.battalion == "Test Magic Corps"
    assert got["Manuela"].abilities.battalion == "Test Monks"
    assert got["Claude"].abilities.battalion == ""
    # Battalion ID 0 assigned to Byleth, slot 0.
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
    assert (leonie.full_name, leonie.class_name, leonie.gender) == ("Leonie Test", "Cavalier", "Female")
    assert leonie.abilities.equipped == ["Strength +2", "Bow Prowess Lv 3", "HP +5", "Close Counter", "Dexterity +4"]
    assert (leonie.abilities.personal, leonie.abilities.accessory) == ("Rivalry", "March Ring")
    assert leonie.blue == {"hp", "str", "dex"}  # Mv is not shown in blue
    assert got["Flayn"].full_name == "Flayn"
    assert got["Hanneman"].full_name == "Hanneman Test"
    assert "Authority Lv 1" in got["Manuela"].abilities.equipped
    assert got["Byleth"].full_name == "Byleth" and got["Byleth"].gender == "Male"
    assert all(r.game_id is not None for r in got.values())
    assert got["Manuela"].abilities.arts == ["Wrath Strike", "Grounder", "Hexblade"]
    assert got["Lysithea"].abilities.arts == ["Draw Back"]  # the other two slots are empty


def test_upgraded_personal_ability_is_kept(data, bonuses):
    claude = next(u for u in decode_roster(ROSTER) if u.character == 4)
    assert to_reading(claude, data, bonuses).abilities.personal == "Keen Lineage"
    assert to_reading(claude, data, bonuses, current_personal="Keen Lineage+").abilities.personal == "Keen Lineage+"


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
    # Generic characters take their name by name ID, not by their own ID.
    assert data.generic_names[114] == "Bandit"
    assert (data.generic_names[508], data.generic_names[509], data.generic_names[510]) == ("Bandit Leader", "Bandit", "Thief")


# Finding the game


V = fe3h.VERSIONS[0]
MAIN = 0x1_0000_0000


class FakeProcess:
    def __init__(self, memory: dict[int, bytes], regions: list[Region]):
        self.memory, self._regions, self.closed = memory, regions, False

    def regions(self):
        return iter(self._regions)

    def read(self, address, size):
        for base, blob in self.memory.items():
            if base <= address and address + size <= base + len(blob):
                return blob[address - base : address - base + size]
        return None

    def close(self):
        self.closed = True


def game_process(main=MAIN, build_id=V.build_id):
    memory = {
        main: fe3h.MODULE_HEADER,
        main + V.build_id_offset: build_id,
        main + V.roster_offset: DATA,
    }
    return FakeProcess(memory, [Region(0x1000, 0x1000, True), Region(main, 0x2000000, True)])


@pytest.fixture
def emulator(monkeypatch):
    processes: dict[int, object] = {}

    def open_process(pid):
        p = processes[pid]
        if isinstance(p, Exception):
            raise p
        return p

    monkeypatch.setattr(fe3h, "running", lambda emulators: [(EMULATORS[0], pid) for pid in processes])
    monkeypatch.setattr(fe3h, "open_process", open_process)
    return processes


def test_reads_the_roster(emulator):
    emulator[7] = game_process()
    snapshot = GameMemory().read()
    assert snapshot.roster == ROSTER and snapshot.player_name == NAME


def test_explains_what_is_missing(emulator):
    with pytest.raises(GameMemoryError, match="Eden isn't running"):
        GameMemory().read()
    emulator[7] = FakeProcess({}, [Region(0x1000, 0x1000, True)])
    with pytest.raises(GameMemoryError, match="isn't running in Eden"):
        GameMemory().read()
    emulator[7] = game_process(build_id=b"\x11" * 16)  # another version
    with pytest.raises(GameMemoryError, match="isn't running in Eden"):
        GameMemory().read()
    emulator.clear()
    emulator[7] = AccessDenied(5, "denied")
    with pytest.raises(GameMemoryError, match="won't let the tracker read Eden's memory"):  # and what to do, per OS
        GameMemory().read()


def test_finds_the_game_again_after_a_restart(emulator):
    emulator[7] = first = game_process()
    memory = GameMemory()
    memory.read()
    emulator[7] = game_process(main=MAIN + 0x4000_0000)  # restarted: loaded somewhere else
    first.memory[MAIN + V.build_id_offset] = b"\0" * 16  # old memory no longer holds the game
    assert memory.read().roster == ROSTER
    assert first.closed


def test_lost_game_is_reported(emulator):
    emulator[7] = process = game_process()
    memory = GameMemory()
    memory.read()
    process.memory.clear()  # game closed, Eden still open
    with pytest.raises(GameMemoryError, match="isn't running in Eden"):
        memory.read()
    assert memory._process is None


# Battles: the game updates copies of the deployed units, and the roster only when the battle ends.

LYSITHEA = SLOT_OF[22]  # roster slot of Lysithea (character 22)


def battle_copy(slot_index=LYSITHEA, level_up=True, counter_behind=1) -> bytes:
    slot = ROSTER[slot_index * fe3h.SLOT_SIZE : (slot_index + 1) * fe3h.SLOT_SIZE]
    copy = bytearray(slot[: fe3h.BATTLE_COPY_READ])
    struct.pack_into("<H", copy, 0xBC, struct.unpack_from("<H", slot, 0xBC)[0] - counter_behind)
    if level_up:
        copy[0x4A] += 1  # level 16 -> 17
        copy[0x4F] += 1  # Mag
        copy[0x56] += 1  # Cha
    return bytes(copy)


def lysithea(roster: bytes) -> RosterUnit:
    return next(u for u in decode_roster(roster) if u.character == 22)


def test_a_level_up_in_battle_is_merged():
    merged, used = fe3h.merge_battle(ROSTER, {22: battle_copy()})
    assert used == 1
    u = lysithea(merged)
    assert u.level == 17 and u.raw["mag"] == 23 and u.raw["cha"] == 12
    assert u.abilities == lysithea(ROSTER).abilities and u.accessory == lysithea(ROSTER).accessory


def test_battle_copies_that_are_not_newer_are_ignored():
    # Same numbers: the battle ended and the roster was written back (or nothing happened yet).
    assert fe3h.merge_battle(ROSTER, {22: battle_copy(level_up=False)}) == (ROSTER, 0)
    # Counter not one behind: left over from another battle, or the save was reloaded.
    assert fe3h.merge_battle(ROSTER, {22: battle_copy(counter_behind=0)}) == (ROSTER, 0)
    assert fe3h.merge_battle(ROSTER, {22: battle_copy(counter_behind=2)}) == (ROSTER, 0)
    # Lower stats than the roster can't be a battle in progress.
    lower = bytearray(battle_copy(level_up=False))
    lower[0x4F] -= 1
    assert fe3h.merge_battle(ROSTER, {22: bytes(lower)}) == (ROSTER, 0)
    # Another unit's copy at the address.
    assert fe3h.merge_battle(ROSTER, {22: battle_copy(slot_index=3)}) == (ROSTER, 0)


HEAP = 0x2_0000_0000


def battle_process(copy: bytes):
    process = game_process()
    heap = b"\x11" * 0x40 + fe3h.BATTLE_MARKER + b"\0" * (fe3h.BATTLE_MARKER_TO_COPY - len(fe3h.BATTLE_MARKER)) + copy + b"\0" * 0x40
    process.memory[HEAP] = heap
    process._regions.append(Region(HEAP, len(heap), True))
    return process


def test_reads_the_battle_in_progress(emulator, monkeypatch):
    emulator[7] = process = battle_process(battle_copy())
    memory = GameMemory()
    scans = []
    real = memory._find_battle_copies
    monkeypatch.setattr(memory, "_find_battle_copies", lambda roster: scans.append(1) or real(roster))

    snapshot = memory.read()
    assert snapshot.battle_units == 1 and lysithea(snapshot.roster).level == 17
    assert memory.read() == snapshot and len(scans) == 1  # found once, then just re-read

    # The battle ends: the roster is written back and the copy is no longer newer.
    roster = bytearray(DATA)
    slot = LYSITHEA * fe3h.SLOT_SIZE
    roster[slot : slot + 0xAC] = battle_copy()[:0xAC]
    process.memory[MAIN + V.roster_offset] = bytes(roster)
    after = memory.read()
    assert after.battle_units == 0 and lysithea(after.roster).level == 17 and len(scans) == 1

    # A new battle starts (the roster's battle counter goes up): look for its copies again.
    struct.pack_into("<H", roster, slot + 0xBC, struct.unpack_from("<H", roster, slot + 0xBC)[0] + 1)
    process.memory[MAIN + V.roster_offset] = bytes(roster)
    memory.read()
    assert len(scans) == 2


def test_no_battle_means_no_repeated_scans(emulator, monkeypatch):
    emulator[7] = game_process()
    memory = GameMemory()
    scans = []
    monkeypatch.setattr(memory, "_find_battle_copies", lambda roster: scans.append(1) or {})
    for _ in range(5):
        assert memory.read().battle_units == 0
    assert len(scans) == 1  # retried only after BATTLE_RESCAN_S, and at most BATTLE_SCANS times


def test_quick_read_skips_the_battle(emulator, monkeypatch):
    emulator[7] = battle_process(battle_copy())
    snapshot = GameMemory().read(battle=False)
    assert snapshot.battle_units == 0 and lysithea(snapshot.roster).level == 16


def test_units_in_battle():
    assert fe3h.in_battle(ROSTER, {22: battle_copy(level_up=False)}) == (22,)  # in battle, nothing changed yet
    assert fe3h.in_battle(ROSTER, {22: battle_copy(counter_behind=0)}) == ()  # left over: not this battle
    assert fe3h.in_battle(ROSTER, {}) == ()


def test_a_unit_whose_flags_change_mid_battle_stays_in_it():
    # Dismounting clears flag 0x20, and other bits come and go: the unit is still in the battle and still levels up.
    for flags in (0x23, 0x0B):
        copy = bytearray(battle_copy())
        copy[0xAC] = flags
        assert fe3h.in_battle(ROSTER, {22: bytes(copy)}) == (22,)
        assert fe3h.merge_battle(ROSTER, {22: bytes(copy)})[1] == 1
    copy = bytearray(battle_copy())
    copy[0xAC] = 0x00  # not an army unit's
    assert fe3h.in_battle(ROSTER, {22: bytes(copy)}) == ()


@pytest.mark.parametrize(
    ("scenario", "look"),
    [(None, None), (0, "dark"), (9, "dark"), (10, "green"), (11, "green"), (20, "green"), (37, "green"), (38, None), (59, None)],
)
def test_byleths_look_follows_the_main_story_scenario(scenario, look):
    from app.domain.units import byleth_look

    assert byleth_look(scenario) == look


def test_the_merge_battle_itself_is_still_dark():
    from app.domain.units import byleth_look

    assert byleth_look(10, in_battle=True) == "dark"
    assert byleth_look(11, in_battle=True) == "green"
    assert byleth_look(12, in_battle=True) == "green"


def test_only_byleth_gets_a_look(data, bonuses):
    units = decode_roster(ROSTER)
    byleth = next(u for u in units if u.character == 0)
    claude = next(u for u in units if u.character == 4)
    assert to_reading(byleth, data, bonuses, scenario=12).look == "green"
    assert to_reading(byleth, data, bonuses, scenario=3).look == "dark"
    assert to_reading(byleth, data, bonuses).look is None
    assert to_reading(claude, data, bonuses, scenario=12).look is None
