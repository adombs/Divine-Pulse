"""Battle recorder and the analysis that finds battle fields in a recording."""

import os
import struct

from app.gamemem import analysis
from app.gamemem.battle import RECORD_SIZE
from app.gamemem.fe3h import BATTLE_MARKER, BATTLE_MARKER_TO_COPY
from app.gamemem.recorder import BattleRecorder, find_recordings, pack_history, read_recording, unpack_history

HP_AT, X_AT, TURN_AT, PULSE_AT = 0x260, 0x270, 0x40, 0x81
UNITS = 5


def capture(step: int, gone: bool = False, shift: int = 0) -> dict:
    """A synthetic battle pool: UNITS records; current HP drops, units move, the turn goes up, pulses go down.
    `shift` records of padding move the window start back (as when an army unit leaves the map)."""
    pool = bytearray(RECORD_SIZE * (UNITS + 1))
    for i in range(UNITS):
        start = RECORD_SIZE * (i + 1)
        marker = BATTLE_MARKER if not (gone and i == UNITS - 1) else BATTLE_MARKER[:-1] + b"\x01"
        pool[start - BATTLE_MARKER_TO_COPY : start - BATTLE_MARKER_TO_COPY + len(marker)] = marker
        struct.pack_into("<H", pool, start + 0x24, 20 + i)
        pool[start + 0x4A], pool[start + 0x4B], pool[start + 0x4C] = 15, 4, 30 + i
        pool[start + 0xAC] = 0x03 if i < 2 else 0
        pool[start + HP_AT] = 30 + i - (step if i in (1, 3) else 0)  # units 1 and 3 take damage
        pool[start + X_AT], pool[start + X_AT + 1] = 3 + 8 * i + (step if i in (0, 2) else 0), 2 + i  # units 0 and 2 walk right
    globals_ = bytearray(0x400)
    struct.pack_into("<I", globals_, TURN_AT, 1 + step // 2)
    globals_[PULSE_AT] = 3 - (1 if step >= 3 else 0)
    pad = RECORD_SIZE * shift
    army = {20: pad + RECORD_SIZE, 21: pad + 2 * RECORD_SIZE}
    return {"pool_base": 0x10000 - pad, "pool": bytes(pad) + bytes(pool), "army": army, "globals": bytes(globals_), "roster": b"r" * 16}


def record(tmp_path, steps=6, shift_from=None) -> list:
    rec = BattleRecorder(tmp_path)
    rec.start("run-20261014-010000")
    for step in range(steps):
        note = {"divine_pulses": 1 if step >= 3 else 0}
        shift = 1 if shift_from is not None and step >= shift_from else 0
        rec.record(capture(step, gone=step >= 4, shift=shift), t=step * 10, note=note)
    path = rec.path
    rec.stop()
    return list(read_recording(path))


def test_frames_round_trip(tmp_path):
    rec = BattleRecorder(tmp_path)
    rec.start("b")
    assert rec.record(capture(0), 0)
    assert not rec.record(capture(0), 1)  # nothing changed: no frame
    assert rec.record(capture(1), 2)
    frames = list(read_recording(rec.path))
    assert len(frames) == 2
    assert frames[1].globals == capture(1)["globals"]  # rebuilt from the first frame and a diff
    assert frames[1].pool == capture(1)["pool"] and frames[1].roster == b"r" * 16
    assert frames[1].army == {20: RECORD_SIZE, 21: 2 * RECORD_SIZE}


def test_history_entries_are_recorded_when_they_change(tmp_path):
    first = [(0x21_0000_0990, b"\x0b" * 0x50)]
    then = [*first, (0x21_0000_0A00, b"\x0e" * 0x60)]
    rec = BattleRecorder(tmp_path)
    rec.start("h")
    assert rec.record({**capture(0), "history": pack_history(first)}, 0)
    assert rec.record({**capture(0), "history": pack_history(then)}, 1)  # only the history changed: a frame
    assert not rec.record({**capture(0), "history": pack_history(then)}, 2)
    assert rec.record({**capture(1), "history": pack_history(then)}, 3)  # history unchanged: carried forward
    frames = list(read_recording(rec.path))
    assert [unpack_history(f.history) for f in frames] == [first, then, then]
    assert unpack_history(b"") == []  # recordings made before the history was kept
    assert [f.history for f in record(tmp_path / "old")] == [b""] * 6  # captures without history still record


def test_old_recordings_are_pruned_and_size_is_capped(tmp_path):
    rec = BattleRecorder(tmp_path, keep=2, max_bytes=1)
    for name in ("a", "b", "c"):
        rec.start(name)
        rec.record(capture(0), 0)
        assert not rec.record(capture(1), 1)  # over the cap after the first frame
    assert len(list(tmp_path.glob("*.dprec"))) == 2


def test_recordings_under_the_old_extension_are_still_found_and_pruned(tmp_path):
    old = tmp_path / "before.fe3hrec"
    old.write_bytes(b"x")
    os.utime(old, (1, 1))
    rec = BattleRecorder(tmp_path, keep=1)
    rec.start("after")
    rec.record(capture(0), 0)
    assert find_recordings(tmp_path) == [rec.path]


def test_lowering_retention_keeps_the_active_recording_until_disabled(tmp_path):
    rec = BattleRecorder(tmp_path)
    for name in ("a", "b", "current"):
        rec.start(name)
    active = rec.path
    rec.set_limit(1)
    assert find_recordings(tmp_path) == [active]
    rec.set_limit(0)
    assert not rec.recording and find_recordings(tmp_path) == []


def test_analysis_finds_the_planted_fields(tmp_path):
    frames = record(tmp_path)
    assert analysis.hp_candidates(frames)[0].offset == HP_AT
    assert analysis.position_candidates(frames)[0].offset == X_AT
    assert analysis.turn_candidates(frames)[0].offset == TURN_AT
    assert analysis.pulse_candidates(frames)[0].offset == PULSE_AT
    [gone] = analysis.defeated_records(frames)
    assert "character 24" in gone
    text = analysis.report(frames)
    assert "Current HP" in text and f"{HP_AT:#x}" in text


def test_analysis_follows_records_when_the_window_moves(tmp_path):
    frames = record(tmp_path, shift_from=2)
    assert frames[2].pool_base != frames[1].pool_base
    assert analysis.hp_candidates(frames)[0].offset == HP_AT
    assert analysis.position_candidates(frames)[0].offset == X_AT
    [gone] = analysis.defeated_records(frames)  # only the unit that really left
    assert "character 24" in gone


def test_proposal_has_the_clear_winners(tmp_path):
    found = analysis.proposal(record(tmp_path))
    assert found == {
        "unit": {"hp": f"{HP_AT:#x}", "x": f"{X_AT:#x}", "y": f"{X_AT + 1:#x}"},
        "globals": {"turn": f"{TURN_AT:#x}", "divine_pulse_charges": f"{PULSE_AT:#x}"},
    }
    assert analysis.proposal(record(tmp_path / "short", steps=1)) == {"unit": {}, "globals": {}}  # nothing changed: no winner


def test_apply_writes_the_fields_file(tmp_path):
    import importlib.util
    import json
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("analyze", Path(__file__).resolve().parents[2] / "tools" / "analyze_battle_recording.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    path = tmp_path / "fields.json"
    path.write_text(json.dumps({"unit": {"hp": "0x99", "x": None}, "globals": {}}))
    changed = tool.apply({"unit": {"hp": "0x260", "x": "0x270"}, "globals": {"turn": "0x40"}}, path, force=False)
    assert changed == ["unit.x = 0x270", "globals.turn = 0x40"]  # hp was already filled in
    data = json.loads(path.read_text())
    assert data["unit"] == {"hp": "0x99", "x": "0x270"} and data["globals"] == {"turn": "0x40"}
    assert tool.apply({"unit": {"hp": "0x260"}}, path, force=True) == ["unit.hp = 0x260"]


def test_a_resumed_battle_carries_on_with_its_recording(tmp_path):
    rec = BattleRecorder(tmp_path)
    rec.start("b")
    rec.record(capture(0), 0)
    rec.stop()
    rec = BattleRecorder(tmp_path)  # the tracker restarted mid-battle
    rec.start("b")
    rec.record(capture(1), 10)
    frames = list(read_recording(rec.path))
    assert [f.t for f in frames] == [0, 10] and frames[1].globals == capture(1)["globals"]
