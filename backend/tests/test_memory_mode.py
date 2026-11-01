"""The scanner reading the game's roster from memory."""

import struct
import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE, SettingsStore
from app.events import EventBus
from app.gamemem.fe3h import ROSTER_SIZE, SLOT_SIZE, VERSIONS, GameMemory, GameMemoryError, Snapshot
from app.domain.units import Unit
from app.infrastructure.polling import Scanner
from app.storage import RunStore
from helpers.synthetic_roster import DATA, SLOT_OF

LYSITHEA_SLOT = SLOT_OF[22]  # roster slot of Lysithea (character 22)
MAG = 0x4F  # Mag in a slot


class FakeMemory:
    def __init__(self):
        self.roster = bytearray(DATA[:ROSTER_SIZE])
        self.name = DATA[ROSTER_SIZE:]
        self.error: str | None = None
        self.in_battle: tuple[int, ...] = ()
        self.enemies = 0
        self.battle_key = ""
        self.scenario: int | None = None

    def read(self):
        if self.error:
            raise GameMemoryError(self.error)
        return Snapshot(bytes(self.roster), self.name, in_battle=self.in_battle, battle_key=self.battle_key if self.in_battle else "", scenario=self.scenario)


@pytest.fixture
def scanner(tmp_path, roster_import):
    settings = SettingsStore(tmp_path / "settings.json")
    store = RunStore(tmp_path / "runs")
    run = store.create("Test run")
    settings.update(active_run_id=run.id)
    sc = Scanner(store, settings, EventBus(), BonusTable.load(BONUSES_FILE), memory=FakeMemory())
    sc.run_id = run.id
    return sc


def units(sc):
    return sc.store.get(sc.run_id).units


def test_short_roster_is_not_a_snapshot():
    class Process:
        def read(self, address, size):
            return VERSIONS[0].build_id if size == 16 else b"short"

    memory = GameMemory()
    memory._process = Process()
    memory.version = VERSIONS[0]
    assert memory._read_once() is None


def test_memory_io_error_disconnects():
    class Process:
        def read(self, address, size):
            raise OSError("process exited")

        def close(self):
            pass

    memory = GameMemory()
    memory._process = Process()
    memory.version = VERSIONS[0]
    with pytest.raises(GameMemoryError, match="Lost contact"):
        memory.read()
    assert memory._process is None


def test_poller_survives_failure_reporting(scanner, monkeypatch):
    calls = []

    def tick():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError("read failed")
        scanner._jobs.put(None)

    monkeypatch.setattr(scanner, "_tick", tick)
    monkeypatch.setattr(scanner, "_record", lambda *args: (_ for _ in ()).throw(RuntimeError("report failed")))
    scanner._poll()
    assert len(calls) == 2


def test_adds_the_whole_army_in_one_entry(scanner):
    scanner._tick()  # first read: wait for a second one to agree
    assert units(scanner) == {}
    scanner._tick()
    got = units(scanner)
    assert len(got) == 15
    leonie = got["leonie"]
    assert (leonie.displayed["mv"], leonie.displayed["dex"], leonie.accessory) == (8, 27, "March Ring")
    assert leonie.bonuses == {"str": 2, "hp": 5, "dex": 4, "mv": 1}
    assert leonie.source == "memory" and leonie.game_id == 25
    [entry] = scanner.log_entries()
    assert entry.is_new_unit and entry.can_undo and entry.screen == "Game memory"
    assert entry.message.startswith("Added Byleth, Claude, Lorenz and 12 more")
    assert scanner.auto_status()["seeing"] == "15 units"


def test_unchanged_game_logs_nothing(scanner):
    for _ in range(5):
        scanner._tick()
    assert len(scanner.log_entries()) == 1


def test_a_change_is_applied_once_two_reads_agree(scanner):
    scanner._tick()
    scanner._tick()
    scanner.memory.roster[LYSITHEA_SLOT * SLOT_SIZE + MAG] += 1  # level up: Mag 22 -> 23
    scanner._tick()
    assert units(scanner)["lysithea"].displayed["mag"] == 26
    scanner._tick()
    assert units(scanner)["lysithea"].displayed["mag"] == 27
    entry = scanner.log_entries()[0]
    assert entry.message == "Updated Lysithea" and entry.unit_key == "lysithea"


def test_undo_reverts_the_whole_poll(scanner):
    scanner._tick()
    scanner._tick()
    scanner.undo()
    assert units(scanner) == {}
    scanner._tick()  # the game hasn't changed: the undo sticks
    assert units(scanner) == {}


def test_errors_show_in_the_status(scanner):
    scanner.memory.error = "Eden isn't running."
    scanner._tick()
    status = scanner.auto_status()
    assert (status["state"], status["message"]) == ("error", "Eden isn't running.")
    assert scanner.log_entries() == []
    scanner.memory.error = None
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["state"] == "watching" and len(units(scanner)) == 15


def test_renamed_unit_is_found_by_game_id(scanner):
    run = scanner.store.get(scanner.run_id)
    scanner.store.put_unit(run.id, "lysi", Unit(name="Lysi", game_id=22))
    scanner._tick()
    scanner._tick()
    got = units(scanner)
    assert "lysithea" not in got and got["lysi"].displayed["mag"] == 26


def test_existing_scanned_units_adopt_identity_without_changing_stats(scanner):
    scanner._tick()
    scanner._tick()
    before = units(scanner)["claude"]
    scanner.store.put_unit(scanner.run_id, "claude", before.model_copy(update={"source": "scan", "game_id": None}))
    scanner._reset()
    scanner._tick()
    scanner._tick()
    assert len(scanner.log_entries()) == 2  # identity adoption is a persisted change.
    adopted = units(scanner)["claude"]
    assert adopted.game_id == before.game_id and adopted.source == "memory"
    assert adopted.displayed == before.displayed
    assert len(units(scanner)) == 15


def test_reports_the_units_in_a_battle(scanner):
    # A unit added by hand has no game ID yet: it's still recognised by name.
    scanner.store.put_unit(scanner.run_id, "lysithea", Unit(name="Lysithea"))
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["battle"] == []
    scanner.memory.in_battle = (19, 22)  # a battle starts with Lorenz and Lysithea
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["battle"] == ["lorenz", "lysithea"]
    scanner.memory.in_battle = ()  # it ends
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["battle"] == []


def test_battle_is_cleared_when_the_game_is_lost(scanner):
    scanner.memory.in_battle = (22,)
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["battle"] == ["lysithea"]
    scanner.memory.error = "Eden isn't running."
    scanner._tick()
    assert scanner.auto_status()["battle"] == []
    scanner.memory.error = None
    scanner._reset()
    scanner._tick()
    scanner._tick()
    assert scanner.auto_status()["battle"] == ["lysithea"]


# Battle sessions


def FakePoolUnit(character, level, class_id, army=False):
    from app.gamemem.battle import BattleUnit

    raw = {"hp": 24, "str": 12, "mag": 3, "dex": 10, "spd": 16, "lck": 9, "def": 4, "res": 3, "mv": 4, "cha": 0}
    return BattleUnit(character, army, level, class_id, raw)


def test_a_battle_is_tracked_and_saved(scanner, tmp_path):
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77) for _ in range(scanner.memory.enemies)]
    scanner.memory.enemies = 6
    scanner.memory.in_battle = (19, 22)
    for _ in range(2):
        scanner._tick()
    battle = scanner.current_battle()
    assert [u.key for u in battle.units] == ["lorenz", "lysithea"]
    assert battle.enemies_start == 6

    scanner.memory.roster[LYSITHEA_SLOT * SLOT_SIZE + 0x4A] += 1  # level up mid-battle
    scanner.memory.roster[LYSITHEA_SLOT * SLOT_SIZE + MAG] += 1
    scanner.memory.enemies = 4
    for _ in range(2):
        scanner._tick()
    battle = scanner.current_battle()
    assert battle.level_ups == 1 and battle.enemies_now == 4
    assert [e.kind for e in battle.events] == ["start", "level_up", "enemies"]

    scanner.memory.in_battle = ()  # the battle ends
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle() is None
    [saved] = scanner.battle_store.list(scanner.run_id)
    assert saved.ended_at and saved.level_ups == 1 and saved.events[-1].kind == "end"


def test_losing_the_game_ends_the_battle(scanner, tmp_path):
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle() is not None
    scanner.memory.error = "Eden isn't running."
    scanner._tick()
    assert scanner.current_battle() is None and len(scanner.battle_store.list(scanner.run_id)) == 1


def test_a_battle_belongs_to_the_run_it_was_tracked_in(scanner, tmp_path):
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle().run_id == scanner.run_id
    # Another run loaded: this battle isn't shown in it.
    other = scanner.store.create("Other run")
    scanner.settings.update(active_run_id=other.id)
    assert scanner.current_battle() is None
    # No run loaded: no battle is followed at all.
    scanner.settings.update(active_run_id=None)
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle() is None and not scanner._battles.active
    assert len(scanner.battle_store.list(scanner.run_id)) == 1 and scanner.battle_store.list(other.id) == []


def test_a_restart_mid_battle_resumes_it(scanner, tmp_path):
    from app.storage import BattleStore

    store = BattleStore(tmp_path / "battles")
    scanner.battle_store = store
    scanner.memory.in_battle, scanner.memory.battle_key = (22,), "k1"
    for _ in range(2):
        scanner._tick()
    scanner.memory.roster[LYSITHEA_SLOT * SLOT_SIZE + 0x4A] += 1  # a level-up before the restart
    for _ in range(2):
        scanner._tick()
    before = scanner.current_battle()
    assert store.load_active(scanner.run_id).id == before.id

    restarted = Scanner(scanner.store, scanner.settings, EventBus(), scanner.bonuses, memory=scanner.memory, battles=store)
    for _ in range(2):
        restarted._tick()
    after = restarted.current_battle()
    assert after.id == before.id and [e.kind for e in after.events] == ["start", "level_up"]

    scanner.memory.in_battle = ()  # it ends: saved to history, the in-progress copy is cleared
    for _ in range(2):
        restarted._tick()
    assert [b.id for b in store.list(scanner.run_id)] == [before.id] and store.load_active(scanner.run_id) is None


def test_a_battle_quit_with_a_bookmark_and_resumed_is_the_same_battle(scanner, tmp_path):
    from app.storage import BattleStore

    store = BattleStore(tmp_path / "battles")
    scanner.battle_store = store
    scanner.memory.battle_globals = lambda: {"turn": 3}
    scanner.memory.in_battle, scanner.memory.battle_key = (22,), "k1"
    for _ in range(2):
        scanner._tick()
    first = scanner.current_battle()
    scanner.memory.in_battle = ()  # quit to the title screen with a bookmark: filed as over, for now
    for _ in range(2):
        scanner._tick()
    assert [b.id for b in store.list(scanner.run_id)] == [first.id]
    scanner.memory.in_battle = (22,)  # resumed: the same battle, carried on
    for _ in range(2):
        scanner._tick()
    again = scanner.current_battle()
    assert again.id == first.id and store.list(scanner.run_id) == [] and again.ended_at is None
    assert [e.kind for e in again.events] == ["start"] and again.away_s >= 0
    # The map restarted from the beginning (turn 1, same counters): a new battle.
    scanner.memory.in_battle = ()
    for _ in range(2):
        scanner._tick()
    scanner.memory.battle_globals = lambda: {"turn": 1}
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    assert scanner._battles.battle is not again
    assert [b.id for b in store.list(scanner.run_id)] == [first.id]


def test_a_battle_that_ended_while_the_tracker_was_off_goes_to_history(scanner, tmp_path):
    from app.storage import BattleStore

    store = BattleStore(tmp_path / "battles")
    scanner.battle_store = store
    scanner.memory.in_battle, scanner.memory.battle_key = (22,), "k1"
    for _ in range(2):
        scanner._tick()
    old = scanner.current_battle()

    restarted = Scanner(scanner.store, scanner.settings, EventBus(), scanner.bonuses, memory=scanner.memory, battles=store)
    scanner.memory.battle_key = "k2"  # a different battle now
    for _ in range(2):
        restarted._tick()
    assert restarted.current_battle().key == "k2"
    [finished] = store.list(scanner.run_id)
    assert finished.id == old.id and finished.ended_at and "wasn't running" in finished.events[-1].text


def test_a_leftover_battle_is_filed_when_no_battle_is_on(scanner, tmp_path):
    from datetime import datetime, timezone

    from app.battle import Battle
    from app.storage import BattleStore

    store = BattleStore(tmp_path / "battles")
    store.save_active(Battle(id="old", run_id=scanner.run_id, key="k0", started_at=datetime(2026, 10, 13, tzinfo=timezone.utc)))
    scanner.battle_store = store
    scanner._tick()  # no battle in game
    [filed] = store.list(scanner.run_id)
    assert filed.id == "old" and filed.ended_at and store.load_active(scanner.run_id) is None


def test_battles_are_read_on_their_own_interval(scanner):
    scanner.settings.update(auto_interval_s=2.0, battle_interval_s=0.5)
    assert scanner.tick_interval() == 2.0
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77)]
    scanner.memory.enemies = 1
    scanner.memory.in_battle = (19, 22)
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle() is not None
    assert scanner.tick_interval() == 0.5  # faster while the battle is on


def test_battle_switches_reach_the_tracker(scanner):
    scanner.settings.update(battle_estimate_fights=False, pairing_check=True)
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77)]
    scanner.memory.enemies = 1
    scanner.memory.in_battle = (19, 22)
    for _ in range(2):
        scanner._tick()
    assert scanner._battles.estimate_fights is False
    assert scanner._battles.check_dir is not None and scanner._battles.check_dir.name == "pairing-checks"


def test_a_unit_of_yours_that_fell_is_not_an_enemy(scanner):
    # Its record stays in the pool (not the army's any more: it has no battle copy) and it's still in the roster.
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77), FakePoolUnit(217, 16, 77), FakePoolUnit(19, 19, 3)]
    scanner.memory.in_battle = (22,)  # Lorenz (19) fell; Lysithea fights on
    for _ in range(2):
        scanner._tick()
    battle = scanner.current_battle()
    assert battle.enemies_start == 2


def test_reinforcements_still_to_come_are_left_out_and_adjutants_kept_off_the_map(scanner):
    # Reinforcements still to come and an adjutant (Claude, attached to Flayn) are in the pool,
    # flagged as off the map; the adjutant's record names its unit's pool index.
    from dataclasses import replace

    lysithea = replace(FakePoolUnit(22, 17, 14, army=True), pool_index=9)
    scanner.memory.battle_units = lambda: [
        FakePoolUnit(217, 16, 77), replace(FakePoolUnit(217, 16, 77), off_map=True), lysithea,
        replace(FakePoolUnit(19, 19, 3, army=True), off_map=True, pool_index=100, attached_to=9),
    ]
    scanner.memory.in_battle = (19, 22)  # Lorenz is Lysithea's adjutant
    for _ in range(2):
        scanner._tick()
    battle = scanner.current_battle()
    assert battle.enemies_start == 1
    assert [(u.key, u.on_map, u.adjutant_of, u.x) for u in battle.units] == [("lorenz", True, "lysithea", None), ("lysithea", True, None, None)]
    # Attached to no unit on the map: not in the battle.
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77), lysithea, replace(FakePoolUnit(19, 19, 3, army=True), off_map=True, attached_to=4)]
    sample = scanner._sample_battle(scanner.memory.read(), scanner.run_id)
    assert [a.key for a in sample.army] == ["lysithea"]


def test_other_units_carry_their_class_gender_army_and_character_for_the_map(scanner):
    # The team byte: 1 enemy, 2 an allied army, 3 a third army; generic character 900 is female in the game's data.
    from dataclasses import replace

    from app.gamemem.units import GameData

    assert 900 in GameData.load().female and 509 not in GameData.load().female
    scanner.memory.battle_units = lambda: [
        replace(FakePoolUnit(509, 5, 11), team=1, slot=1),
        replace(FakePoolUnit(900, 5, 3), team=2, slot=2),
        replace(FakePoolUnit(509, 5, 12), team=3, slot=3),
        replace(FakePoolUnit(26, 20, 32), team=1, slot=4),  # Seteth: a character of his own
    ]
    scanner.memory.in_battle = (22,)
    for _ in range(2):
        scanner._tick()
    stats = scanner.current_battle().enemy_stats
    assert [(s.class_id, s.female, s.side, s.character) for _, s in sorted(stats.items())] == [
        (11, False, "enemy", None), (3, True, "ally", None), (12, False, "third", None), (32, False, "enemy", 26),
    ]
    assert [s.person_id for _, s in sorted(stats.items())] == [509, 900, 509, 26]
    payload = scanner.current_battle().model_dump(mode="json")
    assert [payload["enemy_stats"][str(slot)]["person_id"] for slot in range(1, 5)] == [509, 900, 509, 26]
    from app.domain.battle import EnemyStats

    assert EnemyStats.model_validate({"slot": 1, "label": "old"}).person_id is None
    assert stats[4].name == "Seteth"


def test_other_units_are_named_from_the_game_data(roster_import):
    from app.gamemem.units import GameData
    from app.infrastructure.polling import _other_name

    data = GameData.load()
    # A student, a story character (Tomas, who turns out to be Solon) and a generic unit.
    assert _other_name(19, data) == ("Lorenz", 19)
    assert _other_name(55, data) == ("Tomas", 55) and _other_name(39, data) == ("Solon", 39)
    assert _other_name(35, data) == ("Jeralt", 35) and _other_name(42, data) == ("Death Knight", 42)
    assert _other_name(198, data) == ("Breakable Wall", None)


def test_stand_ins_with_one_max_hp_are_not_units_on_the_map():
    from app.gamemem.battle import BattleUnit
    from app.infrastructure.polling import _stand_in

    def record(max_hp, army=False):
        return BattleUnit(155, army, 16, 1, {"hp": max_hp}, hp=34)

    assert _stand_in(record(1)) and not _stand_in(record(33)) and not _stand_in(record(1, army=True))



def test_unknown_flag_changes_are_logged_on_every_read(scanner, caplog):
    from dataclasses import replace

    pool = [replace(FakePoolUnit(217, 16, 77), slot=5, flags=0x03)]
    scanner.memory.battle_units = lambda: pool
    scanner.memory.in_battle = (19, 22)
    scanner._tick()
    pool[0] = replace(pool[0], flags=0x07)  # acted: a known bit
    with caplog.at_level("INFO", logger="app.infrastructure.polling"):
        scanner._tick()
        assert "Unknown unit flag" not in caplog.text
        pool[0] = replace(pool[0], flags=0x47)  # 0x40: not known
        scanner._tick()
    line = next(r.getMessage() for r in caplog.records if "Unknown unit flag" in r.getMessage())
    assert "slot 5" in line and "flags 0x07 -> 0x47, bits 0x40 set" in line


class _Assets:
    def __init__(self, available):
        self.available = available


def test_memory_is_not_read_without_imported_game_files(scanner, monkeypatch):
    from app.infrastructure import polling

    monkeypatch.setattr(polling, "game_assets", lambda: _Assets(False))
    scanner.memory.read = lambda: (_ for _ in ()).throw(AssertionError("memory read without import"))
    scanner._tick()
    assert scanner._status["state"] == "error"
    assert scanner._status["message"] == "Import your game files first"


def test_memory_is_read_with_imported_game_files(scanner, monkeypatch):
    from app.infrastructure import polling

    monkeypatch.setattr(polling, "game_assets", lambda: _Assets(True))
    scanner._tick()
    scanner._tick()
    assert scanner._status["state"] == "watching"


def test_the_story_scenario_is_read_between_battles():
    class Process:
        def read(self, address, size):
            if size == 16:
                return VERSIONS[0].build_id
            if size == 2:
                return struct.pack("<H", 12)
            return DATA[: ROSTER_SIZE + 0x40]

    memory = GameMemory()
    memory._process = Process()
    memory.version = VERSIONS[0]
    assert memory._read_once().scenario == 12
    # What the tracker calls, with the battle in progress merged in: the scenario has to survive that too.
    memory._find_battle_copies = lambda roster: {}
    assert memory.read().scenario == 12


def test_a_memory_read_stores_byleths_look(scanner):
    def byleth():
        return next(u for u in units(scanner).values() if u.game_id == 0)

    scanner._tick()
    scanner._tick()
    assert byleth().look is None  # no scenario known yet
    scanner.memory.scenario = 5
    scanner._tick()
    scanner._tick()
    assert byleth().look == "dark"
    scanner.memory.scenario = 11
    scanner._tick()
    scanner._tick()
    assert byleth().look == "green"
    scanner.memory.scenario = None  # the title screen: the last look stays
    scanner._tick()
    scanner._tick()
    assert byleth().look == "green"
    assert next(u for u in units(scanner).values() if u.game_id == 4).look is None
