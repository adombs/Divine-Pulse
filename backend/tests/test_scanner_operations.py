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
    assert reader.log_entries() == []
    reader._tick()
    reader._tick()
    assert len(attempts) == 2
    assert len(reader.store.get(run_id).units) == len(attempts[-1]) > 1
    assert reader.log_entries()[0].can_undo


def test_failed_undo_remains_available_and_can_be_retried(reader, monkeypatch):
    reader._tick()
    reader._tick()
    run_id = reader.settings.get().active_run_id
    before = reader.store.get(run_id)
    apply = reader.store.apply_units

    def fail(_run_id, _units):
        raise OSError("disk full")

    monkeypatch.setattr(reader.store, "apply_units", fail)
    with pytest.raises(OSError, match="disk full"):
        reader.undo()
    assert reader.log_entries()[0].can_undo
    assert reader.store.get(run_id) == before
    monkeypatch.setattr(reader.store, "apply_units", apply)
    reader.undo()
    assert reader.store.get(run_id).units == {}
    assert not reader.log_entries()[0].can_undo


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
