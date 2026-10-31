"""Find the battle fields the Battle page still needs, from a battle recording (recorder.py).

Each detector looks for the fingerprint a field must have, across every frame and every unit, and ranks the
candidate offsets. The results are leads to confirm against what happened in game, not answers:

- current HP: a byte in each unit's record that equals max HP at the start, never exceeds it, and changes;
- map position: two neighbouring bytes, small numbers, that differ between units in the same frame and change
  over time;
- turn counter: a global that starts small, only goes up, one at a time, and changes at least once;
- Divine Pulse charges: a small global that only goes down (and drops when the tracker saw a Divine Pulse);
- defeated units: records that stop being active during the battle.

Used by tools/analyze_battle_recording.py.
"""

from __future__ import annotations

import struct
from collections import Counter, defaultdict
from dataclasses import dataclass

from .battle import RECORD_SIZE, is_active_record
from .fe3h import _HP, BATTLE_MARKER_TO_COPY
from .recorder import Frame

BATTLE_PART = range(0x24C, RECORD_SIZE - BATTLE_MARKER_TO_COPY)  # battle-only fields after the slot layout
MAIN_START = 0x80004000  # Switch address of the main program


@dataclass
class Candidate:
    offset: int
    score: float
    detail: str


def unit_records(frame: Frame) -> dict[int, bytes]:
    """Active records in the frame, by address (stable across frames of one battle, unlike the offset in the pool
    window, which moves when an army unit leaves the map)."""
    if not frame.army:
        return {}
    start = next(iter(frame.army.values())) % RECORD_SIZE
    out = {}
    for offset in range(start, len(frame.pool) - RECORD_SIZE + 1, RECORD_SIZE):
        if is_active_record(frame.pool, offset):
            out[frame.pool_base + offset] = frame.pool[offset : offset + RECORD_SIZE]
    return out


def _series(frames: list[Frame]) -> dict[int, list[bytes]]:
    """Each record's bytes over the frames where it's active."""
    out: dict[int, list[bytes]] = defaultdict(list)
    for frame in frames:
        for offset, record in unit_records(frame).items():
            out[offset].append(record)
    return out


def hp_candidates(frames: list[Frame]) -> list[Candidate]:
    series = _series(frames)
    scores = []
    for o in BATTLE_PART:
        starts_full = changes = over = units = 0
        for records in series.values():
            max_hp = records[0][_HP]
            values = [r[o] for r in records]
            units += 1
            starts_full += values[0] == max_hp
            changes += len(set(values)) > 1
            over += any(v > max_hp or v == 0 and i == 0 for i, v in enumerate(values))
        if not units or over > units // 4:
            continue
        score = starts_full / units + 0.5 * changes / units - over / units
        if starts_full:
            scores.append(Candidate(o, round(score, 3), f"equals max HP at the start for {starts_full}/{units} units; changes for {changes}; above max for {over}"))
    return sorted(scores, key=lambda c: -c.score)[:8]


def position_candidates(frames: list[Frame]) -> list[Candidate]:
    scores = []
    for o in BATTLE_PART:
        if o + 1 >= RECORD_SIZE:
            continue
        unique_frames = small = frames_seen = spread = 0
        moved = set()
        last: dict[int, tuple[int, int]] = {}
        for frame in frames:
            records = unit_records(frame)
            if len(records) < 2:
                continue
            frames_seen += 1
            pairs = {k: (r[o], r[o + 1]) for k, r in records.items()}
            small += all(x < 64 and y < 64 for x, y in pairs.values())
            unique_frames += len(set(pairs.values())) == len(pairs)
            # On a real map both coordinates vary between units.
            spread += len({x for x, _ in pairs.values()}) > 1 and len({y for _, y in pairs.values()}) > 1
            for k, p in pairs.items():
                if k in last and last[k] != p:
                    moved.add(k)
                last[k] = p
        if not frames_seen:
            continue
        score = (unique_frames + small) / (2 * frames_seen) + 0.5 * min(1.0, len(moved) / 3)
        if small == frames_seen and unique_frames >= frames_seen * 0.9 and spread >= frames_seen * 0.5:
            scores.append(Candidate(o, round(score, 3), f"pairs unique per unit in {unique_frames}/{frames_seen} frames; {len(moved)} units moved"))
    return sorted(scores, key=lambda c: -c.score)[:8]


def _global_series(frames: list[Frame], fmt: str) -> dict[int, list[int]]:
    size = struct.calcsize(fmt)
    out: dict[int, list[int]] = defaultdict(list)
    usable = [f for f in frames if f.globals]
    if not usable:
        return {}
    length = min(len(f.globals) for f in usable)
    for frame in usable:
        values = struct.unpack_from(f"<{length // size}{fmt}", frame.globals)
        for i, v in enumerate(values):
            out[i * size].append(v)
    return out


def turn_candidates(frames: list[Frame]) -> list[Candidate]:
    out = []
    for offset, values in _global_series(frames, "I").items():
        if not 1 <= values[0] <= 5 or values[-1] == values[0] or values[-1] > 200:
            continue
        steps = [b - a for a, b in zip(values, values[1:]) if b != a]
        if steps and all(s == 1 for s in steps):
            out.append(Candidate(offset, len(steps), f"{values[0]} → {values[-1]}, only ever +1 ({len(steps)} times); address {MAIN_START + 0x19E4000 + offset:#x}"))
    return sorted(out, key=lambda c: -c.score)[:8]


def pulse_candidates(frames: list[Frame]) -> list[Candidate]:
    pulses = [f.meta.get("divine_pulses", 0) for f in frames if f.globals]
    pulse_frames = {i for i in range(1, len(pulses)) if pulses[i] > pulses[i - 1]}
    out = []
    for offset, values in _global_series(frames, "B").items():
        if not 1 <= values[0] <= 20 or values[-1] >= values[0]:
            continue
        drops = [i for i in range(1, len(values)) if values[i] < values[i - 1]]
        if any(values[i] > values[i - 1] for i in range(1, len(values))):
            continue
        matched = sum(1 for i in drops if i in pulse_frames or i + 1 in pulse_frames)
        out.append(Candidate(offset, matched * 2 + len(drops), f"{values[0]} → {values[-1]}, dropped {len(drops)} times ({matched} near a detected Divine Pulse); address {MAIN_START + 0x19E4000 + offset:#x}"))
    return sorted(out, key=lambda c: -c.score)[:8]


def defeated_records(frames: list[Frame]) -> list[str]:
    """Records active at some point that later stop being active, with when."""
    first_seen: dict[int, float] = {}
    last_seen: dict[int, float] = {}
    character: dict[int, int] = {}
    for frame in frames:
        for offset, record in unit_records(frame).items():
            first_seen.setdefault(offset, frame.t)
            last_seen[offset] = frame.t
            character[offset] = struct.unpack_from("<H", record, 0x24)[0]
    end = frames[-1].t if frames else 0
    return [f"record at {o:#x} (character {character[o]}) active {first_seen[o]:.0f}s–{last_seen[o]:.0f}s" for o in sorted(last_seen) if last_seen[o] < end]


# How sure the top candidate must be to be written by `proposal`: (lowest score, lead over the runner-up).
CONFIDENT = {"hp": (1.15, 0.1), "position": (1.2, 0.05), "turn": (2, 1), "divine_pulse_charges": (3, 1)}


def confident(candidates: list[Candidate], min_score: float, lead: float) -> Candidate | None:
    """The top candidate if it scores at least `min_score` and leads the next one by `lead`."""
    if not candidates or candidates[0].score < min_score:
        return None
    if len(candidates) > 1 and candidates[0].score - candidates[1].score < lead:
        return None
    return candidates[0]


def proposal(frames: list[Frame]) -> dict[str, dict[str, str]]:
    """The fields the recording points to clearly enough to use, as battle_fields.json sections (hex strings).
    Fields without a clear winner are left out: check those by hand in the report."""
    unit: dict[str, str] = {}
    globals_: dict[str, str] = {}
    if c := confident(hp_candidates(frames), *CONFIDENT["hp"]):
        unit["hp"] = f"{c.offset:#x}"
    if c := confident(position_candidates(frames), *CONFIDENT["position"]):
        unit["x"], unit["y"] = f"{c.offset:#x}", f"{c.offset + 1:#x}"
    if c := confident(turn_candidates(frames), *CONFIDENT["turn"]):
        globals_["turn"] = f"{c.offset:#x}"
    if c := confident(pulse_candidates(frames), *CONFIDENT["divine_pulse_charges"]):
        globals_["divine_pulse_charges"] = f"{c.offset:#x}"
    return {"unit": unit, "globals": globals_}


def report(frames: list[Frame]) -> str:
    lines = [f"{len(frames)} frames over {frames[-1].t - frames[0].t:.0f} s" if frames else "No frames."]
    if not frames:
        return lines[0]
    counts = Counter(len(unit_records(f)) for f in frames)
    lines.append(f"Active records per frame: {dict(sorted(counts.items()))}")

    def section(title: str, candidates: list[Candidate], what: str) -> None:
        lines.append(f"\n{title}")
        if not candidates:
            lines.append("  (none)")
        for c in candidates:
            lines.append(f"  {what} {c.offset:#x}  score {c.score}  {c.detail}")

    section("Current HP (offset in each unit record):", hp_candidates(frames), "+")
    section("Map position (x at offset, y at offset + 1):", position_candidates(frames), "+")
    section("Turn counter (offset in the global data):", turn_candidates(frames), "globals +")
    section("Divine Pulse charges (offset in the global data):", pulse_candidates(frames), "globals +")
    gone = defeated_records(frames)
    lines.append("\nRecords that stopped being active during the battle (defeated units?):")
    if gone:
        lines.extend(f"  {g}" for g in gone)
    else:
        lines.append("  (none)")
    return "\n".join(lines)
