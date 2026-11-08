"""Failure and lifecycle contracts across polling and application operations."""

import queue
import threading

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE, SettingsStore
from app.events import EventBus
from app.gamemem.fe3h import ROSTER_SIZE, GameMemoryError, Snapshot
from app.infrastructure.polling import Scanner
from app.storage import RunStore
from helpers.synthetic_roster import DATA


class Memory:
    def __init__(self):
        self.snapshot = Snapshot(DATA[:ROSTER_SIZE], DATA[ROSTER_SIZE:])
        self.closed = 0

    def read(self):
        return self.snapshot

    def close(self):
        self.closed += 1


@pytest.fixture
def reader(tmp_path, roster_import):
    settings = SettingsStore(tmp_path / "settings.json")
    store = RunStore(tmp_path / "runs")
    run = store.create("Test")
    settings.update(active_run_id=run.id)
    return Scanner(store, settings, EventBus(), BonusTable.load(BONUSES_FILE), memory=Memory())


def test_failed_roster_commit_is_atomic_and_retries_unchanged_snapshot(reader, monkeypatch):
    apply = reader.store.apply_units
    attempts = []

    def fail_once(run_id, units):
        attempts.append(units)
        if len(attempts) == 1:
            raise OSError("disk full")
        apply(run_id, units)

    monkeypatch.setattr(reader.store, "apply_units", fail_once)
    reader._tick()
    with pytest.raises(OSError, match="disk full"):
        reader._tick()
    run_id = reader.settings.get().active_run_id
    assert reader.store.get(run_id).units == {}
    assert reader._mem_applied is None
    reader._tick()
    reader._tick()
    assert len(attempts) == 2
    assert len(reader.store.get(run_id).units) == len(attempts[-1]) > 1


def test_unexpected_errors_do_not_spin_without_a_retry_delay(reader, monkeypatch):
    timeouts = []

    class Jobs:
        def get(self, timeout):
            timeouts.append(timeout)
            if len(timeouts) == 4:
                return None
            raise queue.Empty

    def fail():
        raise ValueError("invalid reference data")

    reader._jobs = Jobs()
    monkeypatch.setattr(reader, "_tick", fail)
    monkeypatch.setattr("app.infrastructure.polling.time.monotonic", lambda: 100.0)
    reader._run()
    assert timeouts == [0.0, 1.0, 1.0, 1.0]
    assert reader.memory.closed == 1


def test_stop_joins_worker_and_closes_memory(reader):
    sampled = threading.Event()

    def unavailable():
        sampled.set()
        raise GameMemoryError("emulator unavailable")

    reader.memory.read = unavailable
    reader.start()
    try:
        assert sampled.wait(timeout=2)
    finally:
        reader.stop()
    assert not reader._thread.is_alive()
    assert reader.memory.closed == 1


def test_a_unit_the_game_marks_dead_is_marked_dead(reader, tmp_path):
    import struct
    from datetime import datetime, timezone

    from app.domain.battle import Battle, BattleUnitStats, LogEntry
    from app.domain.units import Death, Unit
    from app.gamemem import fe3h
    from app.storage import BattleStore

    reader._tick()
    reader._tick()
    run_id = reader.settings.get().active_run_id
    units = reader.store.get(run_id).units
    (dead_key, dead_unit), (back_key, back) = list(units.items())[:2]
    reader.battle_store = BattleStore(tmp_path / "battles")
    reader.battle_store.add(Battle(
        id="forest", run_id=run_id, map_name="Battle in the Forest",
        started_at=datetime(2026, 11, 6, tzinfo=timezone.utc), ended_at=datetime(2026, 11, 6, tzinfo=timezone.utc),
        units=[BattleUnitStats(key=dead_key, name="X", start_level=1, level=1, start={}, now={})],
        log=[LogEntry(t=3.0, turn=2, kind="fell", text="X fell.", unit=dead_key, actor_id=f"a:{dead_key}", step=7)],
    ))
    reader.store.apply_units(run_id, {back_key: back.model_copy(update={"death": Death(battle_id="earlier")})})
    # The game sets the "Is Dead" bit on the first unit's roster slot.
    roster = bytearray(reader.memory.snapshot.roster)
    slot = next(i for i in range(fe3h.SLOTS)
                if struct.unpack_from("<H", roster, i * fe3h.SLOT_SIZE + fe3h._CHARACTER)[0] == dead_unit.game_id)
    flags = struct.unpack_from("<I", roster, slot * fe3h.SLOT_SIZE + fe3h._FLAGS)[0]
    struct.pack_into("<I", roster, slot * fe3h.SLOT_SIZE + fe3h._FLAGS, flags | fe3h.DEAD)
    reader.memory.snapshot = reader.memory.snapshot.__class__(bytes(roster), reader.memory.snapshot.player_name)
    reader._tick()
    reader._tick()
    units = reader.store.get(run_id).units
    assert units[dead_key].death is not None and (units[dead_key].death.battle_id, units[dead_key].death.step) == ("forest", 7)
    assert units[back_key].death is None  # in the army with no dead flag: alive after all
