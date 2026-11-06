"""The game's battle history (the Divine Pulse list): decoding it, finding it in memory, naming its units."""

from dataclasses import replace
import struct

from app.gamemem import history as h
from app.gamemem.battle import BattleFields, BattleUnit
from app.gamemem.fe3h import GameMemory
from app.gamemem.recorder import unpack_history
from app.system.memory import Region
from app.infrastructure.polling import history_steps

from test_gamemem import MAIN, battle_copy, battle_process, emulator  # noqa: F401 (fixture)

F = BattleFields.load()


def full(character, hp, x, y, max_hp=30) -> bytes:
    r = bytearray(h.FULL_SIZE)
    struct.pack_into("<H", r, 0x24, character)
    r[0x4C], r[F.hp], r[F.x], r[F.y] = max_hp, hp, x, y
    return bytes(r)


def compact(index, hp, x, y, team=2) -> bytes:
    r = bytearray(h.COMPACT_SIZE)
    r[0x44], r[0x46], r[0x47], r[0x49], r[0x4A] = hp, team, index, x, y
    return bytes(r)


def entry(turn=1, number=0, phase=0, start=True, action=0x0B, actor=None, target=None, moved=False, fulls=(), compacts=(), extra=b"", next_at=0) -> bytes:
    head = bytearray(h.HEADER)
    body = b"".join(fulls) + b"".join(compacts) + extra
    struct.pack_into("<QH", head, 0, next_at, 0)
    struct.pack_into("<HHB", head, h.SIZE, h.HEADER + len(body), turn, number)
    head[h.PHASE] = phase
    head[h.TYPE] = h.TYPE_PHASE if start else h.TYPE_ACTION
    head[h.ACTOR] = 0x64 if actor is None else actor
    head[h.ACTION] = 0x1B if start else action
    head[h.FULL_COUNT], head[h.COMPACT_COUNT] = len(fulls), len(compacts)
    head[h.MOVED] = 1 if moved else (0xFF if action == 0x00 else 0)
    head[h.TARGET] = h.NO_UNIT if target is None else target
    return bytes(head) + body


def decode(data: bytes) -> h.HistoryEntry:
    e = h.decode_entry(data, F.hp, F.x, F.y)
    assert e is not None
    return e


def test_decodes_phase_starts_and_actions():
    fight = decode(entry(fulls=(full(0, 41, 3, 29), full(22, 33, 1, 28)), compacts=(compact(33, 34, 2, 22),), extra=b"\x19" * 0x30))
    assert fight.phase_start and fight.turn == 1 and fight.actor is None
    assert fight.units == (
        h.HistoryUnit(0, None, 41, 3, 29, max_hp=30),
        h.HistoryUnit(22, None, 33, 1, 28, max_hp=30),
        h.HistoryUnit(None, 33, 34, 2, 22),
    )
    # "Bandit's attack dealt 9 damage to Lysithea." (pool indexes 33 and 8), on the enemy phase
    attack = decode(entry(number=4, phase=1, start=False, action=0x00, actor=33, target=8, fulls=(full(22, 24, 1, 27),), compacts=(compact(33, 1, 2, 27),)))
    assert (attack.phase, attack.actor, attack.target, attack.action, attack.moved) == (1, 33, 8, 0x00, False)
    moved = decode(entry(number=2, start=False, actor=8, moved=True, fulls=(full(22, 33, 1, 27),)))
    assert moved.moved and moved.target is None and moved.spell is None
    assert h.decode_entry(b"\0" * h.HEADER, F.hp, F.x, F.y) is None  # not an entry
    assert h.decode_entry(entry(fulls=(full(0, 41, 3, 29),))[:-1], F.hp, F.x, F.y) is None  # cut short


def test_decodes_a_gambit():
    data = bytearray(entry(start=False, action=h.ACTION_GAMBIT, actor=0, target=30, fulls=(full(0, 43, 6, 17),),
                           compacts=(compact(29, 28, 9, 17), compact(30, 30, 7, 17))))
    data[h.KIND], data[h.GAMBIT], data[h.MOVED] = h.ACTION_GAMBIT, 1, 1  # (MOVED is the gambit's byte)
    struct.pack_into("<H", data, h.ITEM, 1103)
    gambit = decode(bytes(data))
    assert (gambit.gambit, gambit.target, gambit.item, gambit.moved, gambit.art, gambit.rally) == (1, 30, 1103, False, None, False)
    assert [u.index for u in gambit.units if u.index is not None] == [29, 30]  # every unit it hit
    assert decode(entry(start=False, actor=8, moved=True, fulls=(full(22, 33, 1, 27),))).gambit is None


def test_pool_start_from_where_units_stand():
    entries = [decode(entry(compacts=(compact(20, 41, 1, 7), compact(30, 30, 9, 15), compact(31, 31, 1, 5))))]
    live = {1020: (1, 7, 41), 1030: (9, 15, 30), 1031: (1, 5, 31), 1050: (4, 4, 20)}
    assert h.pool_start(entries, live) == 1000
    assert h.pool_start(entries, {5: (0, 0, 1)}) is None


ARENA = 0x8000_0000  # host address of Switch address 0 in the fake emulator (the main program is at Switch 0x80000000)
FIRST = 0x21_0000_0990  # Switch addresses of the entries


def history_process():
    """A battle in progress, in turn 2: turn 1 is "Fight!" and "Lysithea moved."; turn 2 has begun."""
    process = battle_process(battle_copy())
    g = MAIN + GameMemory.GLOBALS[0]
    fight = entry(fulls=(full(22, 33, 1, 28),), compacts=(compact(20, 41, 1, 7),))
    second = FIRST + h.BLOCK_HEADER + ((len(fight) + 15) & ~15)
    moved = entry(number=1, start=False, actor=0, moved=True, fulls=(full(22, 33, 1, 27),))
    turn2 = second + h.BLOCK_HEADER + ((len(moved) + 15) & ~15)
    phase = entry(turn=2, fulls=(full(22, 33, 1, 27),), compacts=(compact(20, 41, 1, 8),))
    blocks = b""
    for data, nxt in ((fight, second), (moved, 0), (phase, 0)):  # each turn is a list of its own
        data = struct.pack("<Q", nxt) + data[8:]
        size = (len(data) + 15) & ~15
        blocks += struct.pack("<Qq", 0, -size) + b"\0" * 0x10 + data.ljust(size, b"\0")
    process.memory[ARENA + FIRST - h.BLOCK_HEADER] = blocks
    top = bytearray(h.TURNS_AT + 8 * h.MAX_TURNS - h.COUNT_AT)
    struct.pack_into("<I", top, 0, 3)
    struct.pack_into("<QQ", top, h.TURNS_AT - h.COUNT_AT, FIRST, turn2)
    struct.pack_into("<Q", top, h.SELF_AT - h.COUNT_AT, g + h.SELF_TARGET - ARENA)  # the heap's pointer to itself
    process.memory[g + h.COUNT_AT] = bytes(top)
    process._regions.append(Region(ARENA + FIRST - h.BLOCK_HEADER, len(blocks), True))
    return process


def unit(slot, army, x, y, hp, character=114) -> BattleUnit:
    return BattleUnit(character, army, 16, 5, {"hp": 40}, hp=hp, x=x, y=y, slot=slot)


def test_reads_the_history_in_memory(emulator):  # noqa: F811
    emulator[7] = history_process()
    memory = GameMemory()
    memory.read()
    units = [unit(500, True, 1, 27, 33, character=22), unit(520, False, 1, 8, 41)]
    entries, start = memory.battle_history(units)
    assert [(e.turn, e.phase_start) for e in entries] == [(1, True), (1, False), (2, True)]
    assert entries[1].moved and entries[2].units[1] == h.HistoryUnit(None, 20, 41, 1, 8)
    assert start == 500  # unit 20 stands where slot 520 is
    assert memory._arena == ARENA
    assert memory.battle_history(units) == (entries, start)  # (decoded entries are kept)
    # The battle recorder gets the same entries' bytes, in history order, for actions not decoded yet (gambits).
    from app.gamemem.battle import pool_window

    low, high = pool_window(list(memory._copies.values()))
    emulator[7].memory[low] = bytes(high - low)  # a blank pool around the copy, for capture_battle to read
    raw = unpack_history(memory.capture_battle()["history"])
    assert [address for address, _ in raw][0] == FIRST and len(raw) == 3
    assert [h.decode_entry(data, F.hp, F.x, F.y) for _, data in raw] == entries


def test_no_history_outside_a_battle(emulator):  # noqa: F811
    emulator[7] = history_process()
    memory = GameMemory()
    assert memory.battle_history([]) is None  # no battle read yet


def test_history_units_get_the_trackers_names():
    entries = [
        decode(entry(fulls=(full(22, 33, 1, 28), full(99, 40, 0, 0)), compacts=(compact(20, 41, 1, 7),))),
        decode(entry(number=1, phase=1, start=False, action=0x00, actor=20, target=8, fulls=(full(22, 24, 1, 28),), compacts=(compact(20, 1, 1, 27),))),
    ]
    on_map = [unit(508, True, 1, 28, 24, character=22), unit(520, False, 1, 27, 1)]
    steps = history_steps(entries, 500, {22: "lysithea"}, on_map)
    assert [u.uid for u in steps[0].units] == ["a:lysithea", "e:520"]  # character 99 isn't in the army: left out
    assert steps[0].units[0].max_hp == 30
    assert (steps[1].actor, steps[1].target) == ("e:520", "a:lysithea")
    assert history_steps(entries, None, {22: "lysithea"}, on_map) == ()  # pool not placed yet
    # A unit that fell: its record isn't the army's any more, but it's still the same unit in the history.
    fallen = [unit(508, False, 1, 28, 0, character=22), unit(520, False, 1, 27, 1)]
    assert history_steps(entries, 500, {22: "lysithea"}, fallen)[1].target == "a:lysithea"
    # A second record of an army unit that's still in the battle isn't taken for it.
    twin = [unit(508, True, 1, 28, 24, character=22), unit(509, False, 1, 28, 0, character=22)]
    assert history_steps([decode(entry(start=False, actor=9))], 500, {22: "lysithea"}, twin)[0].actor == "e:509"
    # Army units off the map (not deployed) are left out of the steps; other units off it (a reinforcement still to
    # come) stay in, for when they arrive (the tracker notes when: Battle.map_presence).
    off = [replace(unit(508, True, 1, 28, 24, character=22), off_map=True), replace(unit(520, False, 1, 27, 1), off_map=True)]
    assert [u.uid for u in history_steps(entries, 500, {22: "lysithea"}, off)[0].units] == ["e:520"]


def test_a_spells_entry_names_the_spell():
    # Seen live: "Flayn used Rescue." on Lysithea, action 0x03, ITEM 0, the spell (36 Rescue) where "moved" is.
    data = bytearray(entry(start=False, action=h.ACTION_SPELL, actor=8, target=7, fulls=(full(22, 33, 11, 3), full(27, 35, 11, 4))))
    data[h.SPELL] = 36
    rescue = decode(bytes(data))
    assert (rescue.action, rescue.spell, rescue.item, rescue.target, rescue.moved) == (h.ACTION_SPELL, 36, 0, 7, False)
    # An item's entry holds the item's ID: 1000 Vulnerary.
    data = bytearray(entry(start=False, action=0x05, actor=6, fulls=(full(27, 13, 1, 1),)))
    struct.pack_into("<H", data, h.ITEM, 1000)
    vulnerary = decode(bytes(data))
    assert (vulnerary.item, vulnerary.spell) == (1000, None)


def test_an_attacks_item_field_is_its_damage_and_outcome():
    data = bytearray(entry(start=False, action=0x00, actor=33, target=8, fulls=(full(22, 24, 1, 27),)))
    struct.pack_into("<H", data, h.ITEM, 1303)
    attack = decode(bytes(data))
    dealt, outcome = divmod(attack.item, 100)
    assert (dealt, outcome) == (13, 3)
    struct.pack_into("<H", data, h.ITEM, 801)
    assert divmod(decode(bytes(data)).item, 100) == (8, 1)


def test_combat_arts_and_rally_entries():
    data = bytearray(entry(start=False, action=0x0B, actor=4, target=31, fulls=(full(21, 40, 1, 1),)))
    data[h.KIND], data[h.ART] = h.ACTION_ART, 38
    art = decode(bytes(data))
    assert (art.art, art.target, art.moved, art.rally) == (38, 31, False, False)
    # Rally has no target; the entry ends with the character IDs of the unit that rallied and the one it rallied.
    data = bytearray(entry(start=False, actor=7, fulls=(full(21, 40, 1, 1), full(34, 40, 2, 1)), extra=bytes([21, 34, 0, 0])))
    data[h.KIND], data[h.ACTION], data[h.TARGET] = h.ACTION_RALLY, h.ACTION_RALLY, h.NO_UNIT
    rally = decode(bytes(data))
    assert (rally.actor, rally.target, rally.rallied, rally.art, rally.rally) == (7, None, 34, None, True)
