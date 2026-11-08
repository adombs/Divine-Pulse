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
        self.gambit_uses: dict[int, int] = {}  # by character, read from battle copies

    def read(self):
        if self.error:
            raise GameMemoryError(self.error)
        uses = tuple(sorted((c, n) for c, n in self.gambit_uses.items() if c in self.in_battle))
        return Snapshot(bytes(self.roster), self.name, in_battle=self.in_battle, battle_key=self.battle_key if self.in_battle else "", scenario=self.scenario, gambit_uses=uses)


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
    monkeypatch.setattr(scanner, "_publish_status", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("report failed")))
    scanner._poll()
    assert len(calls) == 2


def test_adds_the_whole_army_after_two_matching_reads(scanner):
    scanner._tick()  # first read: wait for a second one to agree
    assert units(scanner) == {}
    scanner._tick()
    got = units(scanner)
    assert len(got) == 15
    leonie = got["leonie"]
    assert (leonie.displayed["mv"], leonie.displayed["dex"], leonie.accessory) == (8, 27, "March Ring")
    assert leonie.bonuses == {"str": 2, "hp": 5, "dex": 4, "mv": 1}
    assert leonie.source == "memory" and leonie.game_id == 25
    assert scanner.auto_status()["seeing"] == "15 units"


def test_battalion_observation_survives_missing_import_and_clears_on_removal(scanner):
    from dataclasses import replace
    from types import SimpleNamespace

    class Process:
        roster = bytearray(DATA[:ROSTER_SIZE])

        def read(self, address, size):
            version = VERSIONS[0]
            if address == version.build_id_offset:
                return version.build_id
            if address == version.roster_offset:
                return bytes(self.roster) + DATA[ROSTER_SIZE:]
            return None

    process = Process()
    memory = GameMemory()
    memory._process = process
    memory.version = VERSIONS[0]
    memory.emulator = SimpleNamespace(layout=SimpleNamespace(heap_regions=lambda _: ()))
    scanner.memory = memory

    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == "Test Magic Corps"
    assert units(scanner)["hanneman"].battalion_id == 4

    # A transient empty-marker read is not a confirmed removal.
    slot = SLOT_OF[28] * SLOT_SIZE
    original_marker = process.roster[slot + 0x18:slot + 0x1A]
    struct.pack_into("<H", process.roster, slot + 0x18, 0xFFFF)
    scanner._tick()
    process.roster[slot + 0x18:slot + 0x1A] = original_marker
    scanner._tick()
    assert units(scanner)["hanneman"].battalion_id == 4

    # An assigned ID with no imported name is unknown, not an empty assignment.
    data = scanner._data()
    scanner._game_data = replace(data, battalions=[])
    process.roster[slot + MAG] += 1
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == "Test Magic Corps"
    assert units(scanner)["hanneman"].battalion_id == 4

    # An unrecognized ID is also unknown, not proof that the slot is empty.
    scanner._game_data = data
    process.roster[slot + 0x1E] = 255
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == "Test Magic Corps"
    assert units(scanner)["hanneman"].battalion_id == 4

    # A clear slot is an observed removal, even when the old ID byte is stale.
    struct.pack_into("<H", process.roster, slot + 0x18, 0xFFFF)
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == ""
    assert scanner.store.get(scanner.run_id).units["hanneman"].battalion == ""
    assert scanner.store.get(scanner.run_id).units["hanneman"].battalion_id is None


def test_battalion_only_identity_change_is_saved_even_with_duplicate_names(scanner):
    from dataclasses import replace

    scanner._tick()
    scanner._tick()
    names = list(scanner._data().battalions)
    names[3] = names[4]
    scanner._game_data = replace(scanner._data(), battalions=names)
    slot = SLOT_OF[28] * SLOT_SIZE
    scanner.memory.roster[slot + 0x1E] = 3
    scanner._tick()
    scanner._tick()
    saved = units(scanner)["hanneman"]
    assert saved.battalion == names[4] and saved.battalion_id == 3


def test_import_language_refreshes_unchanged_memory_and_keeps_missing_assignment(scanner, roster_import, monkeypatch):
    language = ["ENG_U"]
    original_text = roster_import.text

    def text(category, *args, **kwargs):
        if category == "battalion" and language[0] == "GER":
            return {"4": "Test translated corps"}
        return original_text(category, *args, **kwargs)

    monkeypatch.setattr(roster_import, "text", text)
    monkeypatch.setattr(roster_import, "language", lambda: language[0])
    scanner._tick()
    scanner._tick()
    language[0] = "GER"
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == "Test translated corps"
    assert units(scanner)["hanneman"].battalion_id == 4

    # A fresh/incomplete import generation may temporarily have no battalion rows at all.
    original_json = roster_import.json
    monkeypatch.setattr(roster_import, "json", lambda rel, *args, **kwargs:
                        {"battalions": []} if rel == "data/battalions.json" else original_json(rel, *args, **kwargs))
    # Rewrite the synthetic manifest as a real reimport does, creating a fresh table-cache generation.
    manifest = roster_import.root / "manifest.json"
    manifest.write_text(manifest.read_text("utf-8") + "\n", encoding="utf-8")
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == "Test translated corps"
    assert units(scanner)["hanneman"].battalion_id == 4


def test_battle_keeps_assignment_after_later_roster_changes(scanner, tmp_path):
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.in_battle = (28,)
    scanner._tick()
    scanner._tick()
    assert scanner.current_battle().units[0].battalion_id == 4
    scanner.memory.in_battle = ()
    scanner._tick()
    scanner._tick()
    struct.pack_into("<H", scanner.memory.roster, SLOT_OF[28] * SLOT_SIZE + 0x18, 0xFFFF)
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].battalion == ""
    [recorded] = scanner.battle_store.list(scanner.run_id)
    assert recorded.units[0].battalion == "Test Magic Corps"
    assert recorded.units[0].battalion_id == 4


HANNEMAN_BATTALION = SLOT_OF[28] * SLOT_SIZE + 0x18


def set_battalion(scanner, ident=5, exp=0, endurance=60, *, none=False):
    struct.pack_into("<HHHB", scanner.memory.roster, HANNEMAN_BATTALION, 0xFFFF if none else 0, exp, endurance, ident)
    scanner._tick()
    scanner._tick()
    return units(scanner)["hanneman"]


def test_battalion_runtime_level_and_charm_follow_assignment_changes(scanner):
    scanner._tick()
    scanner._tick()
    own_cha = units(scanner)["hanneman"].displayed["cha"]  # Test Magic Corps: an import without a progression
    assert units(scanner)["hanneman"].base()["cha"] == own_cha

    # A: a battalion with a progression. The Status page counts its Charm (blue) and base() stays the unit's own.
    a = set_battalion(scanner, 5, exp=0, endurance=60)
    assert (a.battalion, a.battalion_id, a.battalion_exp, a.battalion_endurance, a.gambit_uses) == ("Test Wing Co.", 5, 0, 60, None)
    assert a.displayed["cha"] == own_cha + 5 and a.bonuses["cha"] == 5 and "cha" in a.blue
    assert a.base()["cha"] == own_cha

    # B: no progression in the import. The runtime is still read; its Charm isn't known, so none is added.
    b = set_battalion(scanner, 4, exp=230, endurance=12)
    assert (b.battalion_id, b.battalion_exp, b.battalion_endurance) == (4, 230, 12)
    assert b.displayed["cha"] == own_cha and "cha" not in b.bonuses

    # None: removed, and the runtime with it.
    c = set_battalion(scanner, 200, exp=0, endurance=0, none=True)
    assert (c.battalion, c.battalion_id, c.battalion_exp, c.battalion_endurance) == ("", None, None, None)
    assert c.displayed["cha"] == own_cha

    # A again, at level 2 with endurance spent: assigned, but none of its modifiers apply.
    d = set_battalion(scanner, 5, exp=115, endurance=0)
    assert (d.battalion_id, d.battalion_exp, d.battalion_endurance) == (5, 115, 0)
    assert d.displayed["cha"] == own_cha and "cha" not in d.bonuses and d.base()["cha"] == own_cha


def test_battle_records_battalion_runtime_without_counting_spent_endurance_as_a_rewind(scanner, tmp_path):
    from app.domain.battle import BattleUnitStats
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    set_battalion(scanner, 5, exp=0, endurance=60)
    own_cha = units(scanner)["hanneman"].base()["cha"]
    scanner.memory.in_battle, scanner.memory.battle_key = (28,), "k1"
    scanner.memory.gambit_uses = {28: 2}
    scanner._tick()
    scanner._tick()
    [unit] = scanner.current_battle().units
    assert (unit.battalion_id, unit.battalion_exp, unit.battalion_endurance, unit.gambit_uses) == (5, 0, 60, 2)
    assert unit.now["cha"] == own_cha  # the battle's values are the unit's own
    assert units(scanner)["hanneman"].gambit_uses == 2

    # Assembly used (exp and uses change, no stat does), then endurance spent: the Charm leaves the Status page.
    scanner.memory.gambit_uses = {28: 1}
    set_battalion(scanner, 5, exp=46, endurance=60)
    scanner.memory.gambit_uses = {28: 0}
    hanneman = set_battalion(scanner, 5, exp=115, endurance=0)
    assert (hanneman.battalion_exp, hanneman.battalion_endurance, hanneman.gambit_uses) == (115, 0, 0)
    assert hanneman.displayed["cha"] == own_cha
    [unit] = scanner.current_battle().units
    assert (unit.battalion_exp, unit.battalion_endurance, unit.gambit_uses) == (115, 0, 0)
    assert unit.now["cha"] == own_cha and unit.start["cha"] == own_cha
    assert [e.kind for e in scanner.current_battle().events] == ["start"]  # no gains, no Divine Pulse

    # The battle ends: the game refills the uses, the run no longer reports them, the record keeps its values.
    scanner.memory.in_battle = ()
    scanner._tick()
    scanner._tick()
    assert units(scanner)["hanneman"].gambit_uses is None
    [recorded] = scanner.battle_store.list(scanner.run_id)
    assert (recorded.units[0].battalion_exp, recorded.units[0].battalion_endurance, recorded.units[0].gambit_uses) == (115, 0, 0)

    # Battles saved before runtime was recorded load as unknown, never as zero.
    old = BattleUnitStats.model_validate({"key": "x", "name": "X", "start_level": 1, "level": 1, "start": {}, "now": {},
                                          "battalion": "Test Wing Co.", "battalion_id": 5})
    assert (old.battalion_exp, old.battalion_endurance, old.gambit_uses) == (None, None, None)


def test_a_change_is_applied_once_two_reads_agree(scanner):
    scanner._tick()
    scanner._tick()
    scanner.memory.roster[LYSITHEA_SLOT * SLOT_SIZE + MAG] += 1  # level up: Mag 22 -> 23
    scanner._tick()
    assert units(scanner)["lysithea"].displayed["mag"] == 26
    scanner._tick()
    assert units(scanner)["lysithea"].displayed["mag"] == 27


def test_a_partial_roster_is_not_applied_and_reports_a_warning(scanner, monkeypatch):
    from dataclasses import replace

    read = scanner.memory.read
    monkeypatch.setattr(scanner.memory, "read", lambda: replace(read(), roster=bytes(10)))
    warnings = []
    scanner.events.add_listener(lambda event, data: warnings.append(data) if event == "roster_warning" else None)
    scanner._tick()
    scanner._tick()
    scanner._tick()
    assert units(scanner) == {}
    assert warnings == [{"message": "The roster could not be read completely."}]


def test_errors_show_in_the_status(scanner):
    scanner.memory.error = "Eden isn't running."
    scanner._tick()
    status = scanner.auto_status()
    assert (status["state"], status["message"]) == ("error", "Eden isn't running.")
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


def test_app_shutdown_files_the_battle_as_completed(scanner, tmp_path):
    from app.storage import BattleStore

    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.in_battle, scanner.memory.battle_key = (22,), "k1"
    for _ in range(2):
        scanner._tick()
    battle_id = scanner.current_battle().id
    scanner.stop()

    [saved] = scanner.battle_store.list(scanner.run_id)
    assert saved.id == battle_id and saved.ended_at is not None
    assert scanner.battle_store.load_active(scanner.run_id) is None


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
    assert scanner.tick_interval() == 1.0
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77)]
    scanner.memory.enemies = 1
    scanner.memory.in_battle = (19, 22)
    for _ in range(2):
        scanner._tick()
    assert scanner.current_battle() is not None
    assert scanner.tick_interval() == 0.1  # faster while the battle is on


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


def test_a_units_allegiance_follows_the_game_record_through_a_battle(scanner):
    # The record's faction ID is read on every poll, so a reveal that changes it (Chapter 11) shows at once; a read
    # without it leaves the last one.
    from dataclasses import replace

    unit = FakePoolUnit(509, 5, 11)
    scanner.memory.in_battle = (22,)
    for allegiance in (15, 6, None):
        scanner.memory.battle_units = lambda a=allegiance: [replace(unit, team=1, slot=1, allegiance=a)]
        for _ in range(2):
            scanner._tick()
        shown = scanner.current_battle().enemy_stats[1].allegiance
        assert shown == (allegiance if allegiance is not None else 6)
    assert scanner.current_battle().model_dump(mode="json")["enemy_stats"]["1"]["allegiance"] == 6


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
    scanner.memory.scenario = 10  # after chapter 10: persist the green look before Holy Tomb
    scanner._tick()
    scanner._tick()
    assert byleth().look == "green"
    scanner.memory.scenario = 83  # auxiliary battles don't reset the retained state
    scanner._tick()
    scanner._tick()
    assert byleth().look == "green"
    scanner.memory.scenario = None  # the title screen: the last look stays
    scanner._tick()
    scanner._tick()
    assert byleth().look == "green"
    assert next(u for u in units(scanner).values() if u.game_id == 4).look is None


def test_retained_byleth_look_reaches_auxiliary_battle_from_real_polling_path(scanner):
    scanner.memory.scenario = 10
    scanner._tick()
    scanner._tick()
    scanner.memory.scenario = 83
    scanner.memory.in_battle = (0,)
    scanner._tick()
    scanner._tick()
    byleth = next(u for u in scanner.current_battle().units if u.character == 0)
    assert byleth.look == "green"
