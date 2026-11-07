"""List candidate game-memory offsets for the Battle page's missing fields, from a battle recording.

The tracker records battle memory while a battle is in progress (Settings > Testing and research > Record battles, on by
default) into battle-recordings/ in the data folder. After playing a battle, run:

    python tools/analyze_battle_recording.py                 # the newest recording
    python tools/analyze_battle_recording.py PATH.dprec    # a specific one
    python tools/analyze_battle_recording.py --apply         # also write the clear winners to battle_fields.json

It prints ranked candidates for current HP, map position, the turn counter and Divine Pulse charges, and the
records that went inactive (defeated units?). Confirm them against what happened in game. --apply writes only the
fields with a clear winner into backend/app/data/battle_fields.json, and keeps fields already filled in unless
--force; restart the tracker to use them.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import DATA_DIR  # noqa: E402
from app.gamemem.analysis import proposal, report  # noqa: E402
from app.gamemem.battle import FIELDS_FILE  # noqa: E402
from app.gamemem.recorder import find_recordings, read_recording  # noqa: E402


def apply(found: dict[str, dict[str, str]], path: Path, force: bool) -> list[str]:
    """Merge `found` into the fields file. Returns what changed, as "section.field = offset" lines."""
    data = json.loads(path.read_text("utf-8"))
    changed = []
    for section, fields in found.items():
        current = data.setdefault(section, {})
        for name, offset in fields.items():
            if current.get(name) is not None and not force:
                continue
            if current.get(name) != offset:
                current[name] = offset
                changed.append(f"{section}.{name} = {offset}")
    if changed:
        path.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recording", nargs="?", type=Path, help="a .dprec (or old .fe3hrec) file (default: the newest one)")
    parser.add_argument("--apply", action="store_true", help="write the fields with a clear winner to battle_fields.json")
    parser.add_argument("--force", action="store_true", help="with --apply, replace fields already filled in")
    args = parser.parse_args()

    path = args.recording
    if path is None:
        recordings = find_recordings(DATA_DIR / "battle-recordings")
        if not recordings:
            sys.exit(f"No recordings in {DATA_DIR / 'battle-recordings'}. Play a battle with the tracker running.")
        path = recordings[-1]
    frames = list(read_recording(path))
    print(f"{path.name}")
    print(report(frames))

    found = proposal(frames)
    clear = [f"{section}.{name} = {offset}" for section, fields in found.items() for name, offset in fields.items()]
    print("\nClear winners: " + (", ".join(clear) if clear else "none (check the candidates above by hand)"))
    if args.apply:
        changed = apply(found, FIELDS_FILE, args.force)
        if changed:
            print(f"Wrote {', '.join(changed)} to {FIELDS_FILE}. Restart the tracker to use them.")
        else:
            print(f"Nothing new to write to {FIELDS_FILE}.")


if __name__ == "__main__":
    main()
