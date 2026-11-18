"""Game saves tied to runs (domain/saves.py), and the tracker holding back a save that isn't the active run's."""

import struct

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE, SettingsStore
from app.domain.saves import SaveFingerprint, SaveLineage, compare, decode_units, encode_units, locate, record
from app.domain.units import UnitPlan
from app.events import EventBus
from app.gamemem.fe3h import ROSTER_SIZE, SLOT_SIZE, Snapshot, save_fingerprint
from app.infrastructure.polling import Scanner
from app.storage import RunStore
from helpers.synthetic_roster import DATA, SLOT_OF

BATTLES, COMBATS, CHARACTER = 0xBC, 0x26, 0x24


def fp(**units):
    """A save from (character: counters) pairs, given as c<ID>=(battles, fights, victories, level, skill exp)."""
    return SaveFingerprint("Byleth|3/5", {int(k[1:]): v for k, v in units.items()})


# Matching


def test_compare_over_the_units_both_saves_have():
    assert compare({1: (1, 1, 1, 1, 1)}, {1: (1, 1, 1, 1, 1)}) == "eq"
    assert compare({1: (2, 1, 1, 1, 1), 2: (0, 0, 0, 1, 0)}, {1: (1, 1, 1, 1, 1)}) == "ge"
    assert compare({1: (1, 1, 1, 1, 1)}, {1: (2, 1, 1, 1, 1), 3: (9, 9, 9, 9, 9)}) == "le"
    assert compare({1: (2, 0, 1, 1, 1)}, {1: (1, 1, 1, 1, 1)}) is None  # another playthrough
    assert compare({1: (1, 1, 1, 1, 1)}, {2: (1, 1, 1, 1, 1)}) is None


def test_units_round_trip_through_their_text():
    units = {0: (3, 12, 4, 6, 250), 22: (1, 0, 0, 5, 0)}
    assert decode_units(encode_units(units)) == units


def lineage_of(*saves):
    lineage = SaveLineage()
    for save in saves:
        record(lineage, save, locate(lineage, save), in_battle=False)
    return lineage


def test_a_save_carries_on_moves_back_or_belongs_elsewhere():
    first = fp(c0=(1, 2, 1, 2, 30), c22=(1, 1, 0, 2, 20))
    second = fp(c0=(2, 5, 3, 3, 60), c22=(2, 4, 2, 3, 50))
    lineage = lineage_of(first, second)
    assert [c.parent for c in lineage.checkpoints] == [None, 1]  # a new checkpoint for each battle started
    # The save carries on (overwritten by later progress), between battles the newest checkpoint moves with it.
    later = fp(c0=(2, 6, 3, 4, 80), c22=(2, 4, 2, 3, 55))
    assert locate(lineage, later).kind == "after"
    assert record(lineage, later, locate(lineage, later), in_battle=False)
    assert len(lineage.checkpoints) == 2 and decode_units(lineage.checkpoints[-1].units) == later.units
    # An older save of the run: between two checkpoints.
    older = fp(c0=(1, 4, 2, 2, 40), c22=(1, 3, 1, 2, 30))
    assert locate(lineage, older).kind == "between"
    # Another playthrough: further on for one unit, behind for another.
    assert locate(lineage, fp(c0=(2, 9, 3, 3, 60), c22=(1, 1, 0, 2, 10))) is None
    # Another Byleth.
    assert locate(lineage, SaveFingerprint("Other|1/1", later.units)) is None


def test_an_older_save_played_on_is_a_branch_of_the_run():
    lineage = lineage_of(fp(c0=(1, 2, 1, 2, 30)), fp(c0=(2, 5, 3, 3, 60)))
    older = fp(c0=(1, 4, 2, 2, 40))
    record(lineage, older, locate(lineage, older), in_battle=False)
    branch = fp(c0=(2, 7, 2, 3, 41))  # its next battle, unlike the first time
    place = locate(lineage, branch)
    assert place is not None and place.kind == "after"


def test_a_divine_pulse_rewind_mid_battle_notes_nothing():
    lineage = lineage_of(fp(c0=(1, 2, 1, 2, 30)), fp(c0=(2, 5, 3, 3, 60)))
    rewound = fp(c0=(2, 4, 2, 3, 50))
    place = locate(lineage, rewound)
    assert place.kind == "between"
    assert not record(lineage, rewound, place, in_battle=True)


# The tracker


class FakeMemory:
    def __init__(self):
        self.roster = bytearray(DATA[:ROSTER_SIZE])
        self.name = DATA[ROSTER_SIZE:]
        self.in_battle: tuple[int, ...] = ()

    def read(self):
        return Snapshot(bytes(self.roster), self.name, in_battle=self.in_battle, battle_key="k" if self.in_battle else "")

    def set_counts(self, character, battles, fights):
        base = SLOT_OF[character] * SLOT_SIZE
        struct.pack_into("<H", self.roster, base + BATTLES, battles)
        struct.pack_into("<H", self.roster, base + COMBATS, fights)


@pytest.fixture
def scanner(tmp_path, roster_import):
    settings = SettingsStore(tmp_path / "settings.json")
    store = RunStore(tmp_path / "runs")
    run = store.create("Run A")
    settings.update(active_run_id=run.id)
    return Scanner(store, settings, EventBus(), BonusTable.load(BONUSES_FILE), memory=FakeMemory())


def sync(sc, reads=2):
    for _ in range(reads):
        sc._tick()


def no_save_loaded(memory, byleth=True):
    """The game before a save is loaded: no army, or only the stand-in Byleth with no battle fought."""
    for slot in range(len(memory.roster) // SLOT_SIZE):
        if not (byleth and slot == SLOT_OF[0]):
            struct.pack_into("<H", memory.roster, slot * SLOT_SIZE + CHARACTER, 0xFFFF)
    if byleth:
        memory.set_counts(0, 0, 0)


def other_playthrough(memory):
    """Change the save in the game to another playthrough's (Lysithea further on, Leonie behind)."""
    memory.set_counts(22, 9, 9)
    memory.set_counts(25, 0, 0)


def test_switching_runs_does_not_sync_the_other_runs_save_into_it(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    assert len(scanner.store.get(a).units) == 15 and scanner.store.get(a).saves.checkpoints
    # Run B has a save of its own; switching to it with run A's save in the game syncs nothing into it.
    b = scanner.store.create("Run B")
    original = bytes(memory.roster)
    other_playthrough(memory)
    scanner.store.record_save(b.id, save_fingerprint(bytes(memory.roster), memory.name), None, False)
    memory.roster[:] = original
    scanner.settings.update(active_run_id=b.id)
    sync(scanner, 3)
    assert scanner.store.get(b.id).units == {}
    status = scanner.auto_status()
    assert status["state"] == "held"
    assert [m["id"] for m in status["save_prompt"]["matches"]] == [a]
    # Switching back syncs as before.
    scanner.settings.update(active_run_id=a)
    sync(scanner)
    assert scanner.auto_status()["save_prompt"] is None and scanner.auto_status()["state"] == "watching"


def test_matches_are_listed_newest_run_first(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    save = save_fingerprint(bytes(memory.roster), memory.name)
    older, newer = scanner.store.create("Older"), scanner.store.create("Newer")
    scanner.store.record_save(older.id, save, None, False)
    scanner.store.record_save(newer.id, save, None, False)
    a = scanner.settings.get().active_run_id
    other_playthrough(memory)
    sync(scanner)  # run A follows another save
    memory.roster[:] = DATA[:ROSTER_SIZE]
    memory.set_counts(22, 3, 5)
    sync(scanner)
    assert [m["name"] for m in scanner.auto_status()["save_prompt"]["matches"]] == ["Newer", "Older"]
    assert scanner.store.get(a).units["lysithea"].game_id == 22


def test_a_save_of_no_run_asks_and_sync_with_this_run_takes_it(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    other_playthrough(memory)
    sync(scanner, 3)
    assert scanner.auto_status()["save_prompt"] == {"run_id": a, "matches": []}
    before = scanner.store.get(a).units["lysithea"].model_copy(deep=True)
    scanner.store.apply_units(a, {"lysithea": before.model_copy(update={"plan": UnitPlan(notes="keep me")})})
    scanner.sync_save()
    scanner._job(scanner._jobs.get_nowait())
    sync(scanner)
    run = scanner.store.get(a)
    assert scanner.auto_status()["save_prompt"] is None
    # The run follows the new save; the roster it had is kept, plans included.
    assert run.roster_snapshot is not None and run.roster_snapshot.units["lysithea"].plan.notes == "keep me"
    assert len([c for c in run.saves.checkpoints if c.parent is None]) == 2


def test_playing_on_with_a_held_save_syncs_it(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    other_playthrough(memory)
    sync(scanner, 3)
    assert scanner.auto_status()["state"] == "held"
    memory.set_counts(22, 9, 12)  # the held save moves on
    sync(scanner, 4)
    assert scanner.auto_status()["save_prompt"] is None
    assert scanner.store.get(a).units["lysithea"].game_id == 22
    assert len([c for c in scanner.store.get(a).saves.checkpoints if c.parent is None]) == 2


def test_starting_a_battle_with_a_held_save_syncs_it(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    other_playthrough(memory)
    sync(scanner, 3)
    assert scanner.auto_status()["state"] == "held"
    memory.in_battle = (22,)
    sync(scanner, 3)
    assert scanner.auto_status()["save_prompt"] is None
    assert len([c for c in scanner.store.get(a).saves.checkpoints if c.parent is None]) == 2


def test_an_older_save_of_the_run_rolls_back_quietly(scanner):
    memory = scanner.memory
    memory.set_counts(22, 1, 2)
    sync(scanner)
    memory.set_counts(22, 2, 4)
    sync(scanner)
    memory.set_counts(22, 3, 6)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    memory.set_counts(22, 2, 5)  # an older save
    sync(scanner)
    status = scanner.auto_status()
    assert status["save_prompt"] is None and status["state"] == "watching"
    assert scanner.store.get(a).roster_snapshot is not None


def test_a_new_run_takes_a_save_no_run_has(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    b = scanner.store.create("Run B")
    other_playthrough(memory)
    scanner.settings.update(active_run_id=b.id)
    sync(scanner)
    assert len(scanner.store.get(b.id).units) == 15
    assert scanner.auto_status()["save_prompt"] is None


def test_a_battles_roster_snapshot_keeps_the_units_plans(scanner, tmp_path):
    from app.storage import BattleStore

    sync(scanner)
    a = scanner.settings.get().active_run_id
    unit = scanner.store.get(a).units["lysithea"]
    scanner.store.apply_units(a, {"lysithea": unit.model_copy(update={"plan": UnitPlan(notes="Gremory")})})
    scanner.battle_store = BattleStore(tmp_path / "battles")
    scanner.memory.in_battle = (22,)
    sync(scanner, 3)
    battle = scanner.current_battle()
    assert battle.roster_snapshot["lysithea"].plan.notes == "Gremory"


def test_a_blank_save_is_a_save_not_yet_loaded():
    assert SaveFingerprint("|", {}).blank
    assert fp(c0=(0, 0, 0, 1, 0)).blank and fp(c1=(0, 0, 0, 1, 0)).blank
    assert not fp(c0=(1, 0, 0, 1, 0)).blank  # a battle fought
    assert not fp(c0=(0, 0, 0, 1, 0), c22=(0, 0, 0, 1, 0)).blank  # more than Byleth


@pytest.mark.parametrize("byleth", [True, False])
def test_no_save_loaded_neither_asks_nor_syncs(scanner, byleth):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    units = scanner.store.get(a).units
    no_save_loaded(memory, byleth)
    sync(scanner, 3)
    assert scanner.auto_status()["save_prompt"] is None
    assert scanner.store.get(a).units == units
    # Nor in a new run: nothing is synced into it until a save is loaded.
    b = scanner.store.create("Run B")
    scanner.settings.update(active_run_id=b.id)
    sync(scanner, 3)
    assert scanner.auto_status()["save_prompt"] is None
    assert scanner.store.get(b.id).units == {} and not scanner.store.get(b.id).saves.checkpoints


def test_a_battle_with_the_stand_in_byleth_asks_when_the_run_has_a_save(scanner):
    memory = scanner.memory
    memory.set_counts(22, 3, 5)
    sync(scanner)
    a = scanner.settings.get().active_run_id
    units = scanner.store.get(a).units
    no_save_loaded(memory)
    sync(scanner, 3)
    memory.in_battle = (0,)
    sync(scanner, 3)
    assert scanner.auto_status()["save_prompt"] == {"run_id": a, "matches": []}
    assert scanner.store.get(a).units == units
