"""Reading the game from Ryujinx's family (Astris on macOS, Ryubing): the main program found inside the emulated RAM
block, and the battle history's Switch addresses found 2 MiB block by block. Made-up memory: the army of
helpers/synthetic_roster.py and history entries like test_history's."""

import struct

import pytest

from app.gamemem import fe3h
from app.gamemem import history as h
from app.gamemem.fe3h import GameMemory
from app.gamemem.readers import emulators_for
from app.gamemem.ryujinx import BLOCK, RYUJINX, RYUJINX_EMULATORS, GuestRam, runs
from app.system.memory import Region, search
from helpers.synthetic_roster import DATA, NAME, ROSTER

from test_gamemem import battle_copy
from test_history import compact, entry, full, unit

V = fe3h.VERSIONS[0]
RAM = 0x70_0000_0000  # host address of the emulated RAM block (Switch physical address 0)
RAM_SIZE = 64 << 20
MAIN_PA, MAIN_VA = 0x0100_4000, 0x0800_4000  # the main program: not at the start of a region
HEAP_PA = 0x0360_0000  # a battle copy
# The history: turn 1's entries in one 2 MiB block of Switch addresses, turn 2's in another, each mapped to its own
# physical block (only the offset within 2 MiB is the same).
FIRST, FIRST_PA = 0x21_4510_1FD0, 0x02C0_0000 + 0x10_1FD0
TURN2, TURN2_PA = 0x21_4590_0FD0, 0x0300_0000 + 0x10_0FD0


class FakeProcess:
    """A Ryujinx-like process: the RAM block in four back-to-back regions (as macOS lists Astris's), a small region
    elsewhere, and an address-space reservation that can't be read."""

    pid = 11

    def __init__(self, ram: bytes):
        self.ram = ram
        quarter = RAM_SIZE // 4
        self._regions = [Region(0x1000_0000, 0x10000, False, True)]
        self._regions += [Region(RAM + i * quarter, quarter, i % 2 == 0, True) for i in range(4)]
        self._regions.append(Region(0x80_0000_0000, 1 << 40, False, False))
        self.closed = False

    def regions(self):
        return iter(self._regions)

    def read(self, address, size):
        if RAM <= address and address + size <= RAM + RAM_SIZE:
            return self.ram[address - RAM : address - RAM + size]
        if 0x1000_0000 <= address and address + size <= 0x1001_0000:
            return bytes(size)
        return None

    def alive(self):
        return True

    def close(self):
        self.closed = True


def blocks(*entries: tuple[bytes, int]) -> bytes:
    """Heap blocks (header, then the entry), each entry's NEXT link set."""
    out = b""
    for data, nxt in entries:
        data = struct.pack("<Q", nxt) + data[8:]
        size = (len(data) + 15) & ~15
        out += struct.pack("<Qq", 0, -size) + b"\0" * 0x10 + data.ljust(size, b"\0")
    return out


def ryujinx_ram(history: bool = True) -> bytes:
    ram = bytearray(RAM_SIZE)

    def put(pa: int, data: bytes) -> None:
        ram[pa : pa + len(data)] = data

    put(MAIN_PA, fe3h.MODULE_HEADER)
    put(MAIN_PA + V.build_id_offset, V.build_id)
    put(MAIN_PA + V.roster_offset, DATA)
    copy = battle_copy()
    put(HEAP_PA, fe3h.BATTLE_MARKER + b"\0" * (fe3h.BATTLE_MARKER_TO_COPY - len(fe3h.BATTLE_MARKER)) + copy)
    if history:
        fight = entry(fulls=(full(22, 33, 1, 28),), compacts=(compact(20, 41, 1, 7),))
        second = FIRST + h.BLOCK_HEADER + ((len(fight) + 15) & ~15)
        moved = entry(number=1, start=False, actor=0, moved=True, fulls=(full(22, 33, 1, 27),))
        phase = entry(turn=2, fulls=(full(22, 33, 1, 27),), compacts=(compact(20, 41, 1, 8),))
        put(FIRST_PA - h.BLOCK_HEADER, blocks((fight, second), (moved, 0)))
        put(TURN2_PA - h.BLOCK_HEADER, blocks((phase, 0)))
        g = MAIN_PA + GameMemory.GLOBALS[0]
        top = bytearray(h.TURNS_AT + 8 * h.MAX_TURNS - h.COUNT_AT)
        struct.pack_into("<I", top, 0, 3)
        struct.pack_into("<QQ", top, h.TURNS_AT - h.COUNT_AT, FIRST, TURN2)
        # The heap's pointer to the global data: right for the main program, not for the history's heap.
        struct.pack_into("<Q", top, h.SELF_AT - h.COUNT_AT, MAIN_VA + GameMemory.GLOBALS[0] + h.SELF_TARGET)
        put(g + h.COUNT_AT, bytes(top))
    return bytes(ram)


@pytest.fixture
def ryujinx(monkeypatch):
    processes = {}
    monkeypatch.setattr(fe3h, "running", lambda emulators: [(RYUJINX, pid) for pid in processes])
    monkeypatch.setattr(fe3h, "open_process", lambda pid: processes[pid])
    return processes


def test_the_reader_setting_names_ryujinx():
    assert emulators_for("ryujinx") is RYUJINX_EMULATORS
    assert {"astris", "ryujinx.exe"} <= RYUJINX.executables  # Astris on macOS, Ryubing on Windows


def test_the_roster_is_read_from_inside_the_ram_block(ryujinx):
    ryujinx[11] = FakeProcess(ryujinx_ram())
    memory = GameMemory(RYUJINX_EMULATORS)
    snapshot = memory.read(battle=False)
    assert snapshot.roster == ROSTER and snapshot.player_name == NAME
    assert memory._main == RAM + MAIN_PA and memory.emulator is RYUJINX
    assert RYUJINX.layout.ram(ryujinx[11]) == (RAM, RAM + RAM_SIZE)  # the whole stretch, not one region of it


def test_the_battle_and_its_history_are_found_block_by_block(ryujinx):
    ryujinx[11] = FakeProcess(ryujinx_ram())
    memory = GameMemory(RYUJINX_EMULATORS)
    copies = memory._find_battle_copies(memory.read(battle=False).roster)  # (as the background scan would)
    assert list(copies.values()) == [RAM + HEAP_PA + fe3h.BATTLE_MARKER_TO_COPY]
    memory._copies = copies
    units = [unit(500, True, 1, 27, 33, character=22), unit(520, False, 1, 8, 41)]
    entries, start = memory.battle_history(units)
    assert [(e.turn, e.phase_start) for e in entries] == [(1, True), (1, False), (2, True)]
    assert entries[2].units[1] == h.HistoryUnit(None, 20, 41, 1, 8) and start == 500
    # One offset per 2 MiB block of Switch addresses, each found where the entry is.
    assert memory._blocks == {FIRST // BLOCK: RAM + FIRST_PA - FIRST, TURN2 // BLOCK: RAM + TURN2_PA - TURN2}


def test_no_history_when_it_isnt_in_the_ram(ryujinx):
    ram = bytearray(ryujinx_ram())
    ram[FIRST_PA - h.BLOCK_HEADER : FIRST_PA + 0x200] = bytes(0x220)  # the first entry isn't there
    ryujinx[11] = FakeProcess(bytes(ram))
    memory = GameMemory(RYUJINX_EMULATORS)
    memory._copies = memory._find_battle_copies(memory.read(battle=False).roster)
    assert memory.battle_history([unit(500, True, 1, 27, 33, character=22)]) is None


def test_a_view_of_the_game_s_memory_comes_after_the_ram_block():
    """Ryujinx's host-mapped modes map the game a second time at its virtual addresses: the RAM block (the
    largest stretch) is tried first, and kept as the RAM once the caller settles on it."""
    process = FakeProcess(ryujinx_ram(history=False))
    view = 0x1000_0000
    process.read = lambda address, size, real=process.read: (
        (fe3h.MODULE_HEADER + bytes(size))[:size] if address == view else real(address, size)
    )
    layout = GuestRam()
    found = list(layout.main_candidates(process, fe3h.MODULE_HEADER))
    assert found == [RAM + MAIN_PA, view]
    assert layout.ram(process) == (view, view + 0x10000)  # the last one yielded


def test_runs_join_back_to_back_regions():
    regions = [Region(0, 0x10, True), Region(0x10, 0x10, False), Region(0x40, 0x10, True)]
    assert runs(regions) == [(0, 0x20), (0x40, 0x50)]


def test_search_reads_in_pieces_without_a_native_search():
    class Plain:
        def read(self, address, size):
            data = bytes(64) + b"MOD0" + bytes(60) + b"MOD0"
            return data[address : address + size] if address + size <= len(data) else data[address:] or None

    assert search(Plain(), 0, 132, b"MOD0") == [64, 128]
    assert search(Plain(), 0, 132, b"MOD0", alignment=0x80) == [128]
