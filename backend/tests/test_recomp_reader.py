"""Reading the game from FE3H Recomp (the native Windows recompilation) instead of Eden, on the made-up army of
helpers/synthetic_roster.py, and the setting that chooses between the two."""

import pytest
from fastapi.testclient import TestClient

from app.bonuses import BonusTable
from app.config import BONUSES_FILE, SettingsStore
from app.gamemem import fe3h
from app.gamemem.emulators import EMULATORS
from app.gamemem.fe3h import GameMemory, GameMemoryError
from app.gamemem.readers import emulators_for
from app.gamemem.recomp import GUEST_HI, GUEST_LO, MIN_HEAP_REGION, RECOMP, RECOMP_EMULATORS
from app.infrastructure.events import EventBus
from app.infrastructure.polling import Scanner
from app.infrastructure.persistence import RunStore
from app.main import create_app
from app.system.memory import AccessDenied, Region
from helpers.synthetic_roster import DATA, NAME, ROSTER

V = fe3h.VERSIONS[0]
MAIN = GUEST_LO  # the recomp loads the main program at the start of its window


class FakeProcess:
    def __init__(self, memory, regions):
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


def recomp_process(build_id=V.build_id):
    memory = {MAIN: fe3h.MODULE_HEADER, MAIN + V.build_id_offset: build_id, MAIN + V.roster_offset: DATA}
    # The host program's own memory around the game's window, and the game's, which isn't a file or shared view.
    regions = [Region(0x1000, 0x1000, False), Region(MAIN, 0x2000000, False), Region(GUEST_HI + 0x1000, 0x1000, False)]
    return FakeProcess(memory, regions)


@pytest.fixture
def recomp(monkeypatch):
    processes = {}

    def open_process(pid):
        process = processes[pid]
        if isinstance(process, Exception):
            raise process
        return process

    monkeypatch.setattr(fe3h, "running", lambda emulators: [(emulators[0], pid) for pid in processes] if emulators[0] is RECOMP else [])
    monkeypatch.setattr(fe3h, "open_process", open_process)
    return processes


def test_the_game_is_read_from_the_recompiled_program(recomp):
    recomp[7] = recomp_process()
    memory = GameMemory(RECOMP_EMULATORS)
    snapshot = memory.read()
    assert snapshot.roster == ROSTER and snapshot.player_name == NAME
    assert memory.emulator is RECOMP and memory.version is V


def test_the_recomp_reader_explains_what_is_missing(recomp):
    with pytest.raises(GameMemoryError, match="FE3H Recomp isn't running"):
        GameMemory(RECOMP_EMULATORS).read()
    recomp[7] = FakeProcess({}, [Region(MAIN, 0x2000000, False)])
    with pytest.raises(GameMemoryError, match="isn't running in FE3H Recomp.*game version 1.2.0"):
        GameMemory(RECOMP_EMULATORS).read()
    recomp[7] = recomp_process(build_id=b"\x11" * 16)  # another version of the game
    with pytest.raises(GameMemoryError, match="isn't running in FE3H Recomp"):
        GameMemory(RECOMP_EMULATORS).read()
    recomp[7] = AccessDenied(5, "denied")
    with pytest.raises(GameMemoryError, match="won't let the tracker read FE3H Recomp's memory"):
        GameMemory(RECOMP_EMULATORS).read()


def test_a_game_outside_the_recomps_window_is_not_found(recomp):
    process = recomp_process()
    process._regions = [Region(GUEST_HI, 0x2000000, False)]  # nothing the recomp reserved for the game
    recomp[7] = process
    with pytest.raises(GameMemoryError, match="isn't running in FE3H Recomp"):
        GameMemory(RECOMP_EMULATORS).read()


def test_only_the_games_own_memory_is_searched_for_battles():
    heap = Region(GUEST_LO + 0x240000000, 4 * MIN_HEAP_REGION, False)
    process = FakeProcess({}, [
        Region(GUEST_LO - 0x1000, MIN_HEAP_REGION, False),  # the host program's, just before the window
        Region(GUEST_LO, MIN_HEAP_REGION // 2, False),  # too small to be the game's heap
        heap,
        Region(GUEST_HI - 0x1000, MIN_HEAP_REGION, False),  # runs past the window
    ])
    layout = RECOMP.layout
    assert list(layout.heap_regions(process)) == [heap]
    assert [r.base for r in layout.module_regions(process)] == [GUEST_LO, heap.base]
    assert list(layout.arena_candidates(process)) == [0]  # game addresses are the program's own


def test_each_setting_names_its_reader():
    assert emulators_for("eden") is EMULATORS and emulators_for("recomp") is RECOMP_EMULATORS
    assert emulators_for("something else") is EMULATORS


def test_the_setting_defaults_to_eden_and_is_saved(tmp_path):
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        assert client.get("/api/settings").json()["memory_reader"] == "eden"
        assert client.put("/api/settings", json={"memory_reader": "recomp"}).json()["memory_reader"] == "recomp"
        assert client.put("/api/settings", json={"memory_reader": "yuzu"}).status_code == 422
        assert client.get("/api/settings").json()["memory_reader"] == "recomp"
    assert SettingsStore(tmp_path / "settings.json").get().memory_reader == "recomp"


def test_the_connection_check_uses_the_chosen_reader(tmp_path, recomp):
    recomp[7] = recomp_process()
    app = create_app(tmp_path, background=False)
    with TestClient(app) as client:
        assert client.get("/api/memory/check").json() == {"ok": False, "message": "Eden isn't running."}
        client.put("/api/settings", json={"memory_reader": "recomp"})
        check = client.get("/api/memory/check").json()
        assert check["ok"] and "FE3H 1.2.0 in FE3H Recomp" in check["message"]


def test_the_scanner_changes_reader_when_the_setting_changes(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    scanner = Scanner(RunStore(tmp_path / "runs"), settings, EventBus(), BonusTable.load(BONUSES_FILE))
    assert scanner.memory.emulators is EMULATORS
    closed = []
    scanner.memory.close = lambda: closed.append(True)
    scanner._tick()
    assert closed == [] and scanner.memory.emulators is EMULATORS  # nothing changed: the connection is kept
    settings.update(memory_reader="recomp")
    scanner._tick()
    assert scanner.memory.emulators is RECOMP_EMULATORS and closed == [True]
    scanner._tick()
    assert closed == [True]
    settings.update(memory_reader="eden")
    scanner._tick()
    assert scanner.memory.emulators is EMULATORS and closed == [True, True]


def test_a_scanner_starts_with_the_saved_reader(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(memory_reader="recomp")
    scanner = Scanner(RunStore(tmp_path / "runs"), settings, EventBus(), BonusTable.load(BONUSES_FILE))
    assert scanner.memory.emulators is RECOMP_EMULATORS
