"""Battle recorder: raw battle memory saved while a battle is in progress, to find the fields the Battle page still
needs (current HP, map position, turn number, Divine Pulse charges).

One file per battle in data/battle-recordings/, made of frames. Each frame is the battle pool (every unit record
around the army's), the game's global data and the roster at one moment. To keep files small, the global data is
stored in full in the first frame and as changed 8-byte words afterwards, the roster only when it changes, and
frames only when something changed. tools/analyze_battle_recording.py reads them.

Frame format: b"FRM1", u32 metadata length, metadata (JSON), u32 blob count, then per blob: u32 name length,
name, u32 data length, zlib-compressed data.
"""

from __future__ import annotations

import json
import logging
import struct
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

MAGIC = b"FRM1"
SUFFIX = ".dprec"
LEGACY_SUFFIX = ".fe3hrec"  # the name before the rename; still found and read
KEEP = 5  # recordings kept; the oldest are deleted
MAX_BYTES = 200 * 1024 * 1024  # stop recording a battle past this size


PAGE = 0x1000


def _word_diff(old: bytes, new: bytes) -> bytes:
    """(u32 offset, u64 value) for every 8-byte word that changed. Unchanged 4 KiB pages are skipped whole."""
    out = bytearray()
    size = min(len(old), len(new)) // 8 * 8
    for page in range(0, size, PAGE):
        end = min(page + PAGE, size)
        if old[page:end] == new[page:end]:
            continue
        for offset in range(page, end, 8):
            if old[offset : offset + 8] != new[offset : offset + 8]:
                out += struct.pack("<IQ", offset, struct.unpack_from("<Q", new, offset)[0])
    return bytes(out)


def _apply_word_diff(base: bytearray, diff: bytes) -> None:
    for i in range(0, len(diff), 12):
        offset, value = struct.unpack_from("<IQ", diff, i)
        struct.pack_into("<Q", base, offset, value)


def _frame(meta: dict, blobs: dict[str, bytes]) -> bytes:
    head = json.dumps(meta, separators=(",", ":")).encode()
    out = bytearray(MAGIC + struct.pack("<I", len(head)) + head + struct.pack("<I", len(blobs)))
    for name, data in blobs.items():
        packed = zlib.compress(data, 6)
        out += struct.pack("<I", len(name)) + name.encode() + struct.pack("<I", len(packed)) + packed
    return bytes(out)


class BattleRecorder:
    """Writes one recording per battle. Not thread-safe: the scanner's worker owns it."""

    def __init__(self, folder: Path, keep: int = KEEP, max_bytes: int = MAX_BYTES):
        self.folder = folder
        self.keep = keep
        self.max_bytes = max_bytes
        self.path: Path | None = None
        self._size = 0
        self._last: dict | None = None
        self._globals = b""
        self._roster = b""

    @property
    def recording(self) -> bool:
        return self.path is not None

    def start(self, name: str) -> None:
        self.stop()
        self.folder.mkdir(parents=True, exist_ok=True)
        self.path = self.folder / f"{name}{SUFFIX}"
        # The same battle again (the tracker restarted mid-battle): carry on with its recording. The first frame
        # after that is a full one, so read_recording rebuilds it like any other.
        self._size = self.path.stat().st_size if self.path.exists() else 0
        if not self._size:
            self.path.write_bytes(b"")
        self._last, self._globals, self._roster = None, b"", b""
        self._prune()
        log.info("Recording battle memory to %s", self.path.name)

    def record(self, capture: dict, t: float, note: dict | None = None) -> bool:
        """Append a frame if anything changed. Returns whether one was written."""
        path = self.path  # stop() may clear it meanwhile
        if path is None or self._size >= self.max_bytes:
            return False
        if self._last is not None and all(capture[k] == self._last[k] for k in ("pool", "globals", "roster", "pool_base")):
            return False
        meta = {"t": round(t, 2), "pool_base": capture["pool_base"], "army": {str(k): v for k, v in capture["army"].items()}, **(note or {})}
        blobs = {"pool": capture["pool"]}
        if not self._globals or len(self._globals) != len(capture["globals"]):
            blobs["globals"] = capture["globals"]
        elif capture["globals"] != self._globals:
            blobs["globals_diff"] = _word_diff(self._globals, capture["globals"])
        if capture["roster"] != self._roster:
            blobs["roster"] = capture["roster"]
        frame = _frame(meta, blobs)
        try:
            with path.open("ab") as f:
                f.write(frame)
        except OSError:
            log.exception("Could not write the battle recording")
            self.stop()
            return False
        self._size += len(frame)
        self._last, self._globals, self._roster = capture, capture["globals"], capture["roster"]
        if self._size >= self.max_bytes:
            log.warning("Battle recording %s reached %d MB; not recording the rest of this battle", path.name, self.max_bytes // 2**20)
        return True

    def stop(self) -> None:
        self.path, self._last = None, None

    def _prune(self) -> None:
        recordings = find_recordings(self.folder)
        for old in recordings[: max(0, len(recordings) - self.keep)]:
            try:
                old.unlink()
            except OSError:
                pass


def find_recordings(folder: Path) -> list[Path]:
    """The recordings in a folder, oldest first, under the current and the old file extension."""
    found = [p for suffix in (SUFFIX, LEGACY_SUFFIX) for p in folder.glob(f"*{suffix}")]
    return sorted(found, key=lambda p: p.stat().st_mtime)


@dataclass
class Frame:
    t: float
    meta: dict
    pool_base: int
    pool: bytes
    globals: bytes
    roster: bytes

    @property
    def army(self) -> dict[int, int]:
        """Character ID -> offset of its record in `pool`."""
        return {int(k): v for k, v in self.meta.get("army", {}).items()}


def read_recording(path: Path) -> Iterator[Frame]:
    """Frames with the global data and roster filled in from earlier frames."""
    data = path.read_bytes()
    pos = 0
    globals_ = bytearray()
    roster = b""
    while pos < len(data):
        if data[pos : pos + 4] != MAGIC:
            raise ValueError(f"{path.name}: bad frame at byte {pos}")
        (head_len,) = struct.unpack_from("<I", data, pos + 4)
        meta = json.loads(data[pos + 8 : pos + 8 + head_len])
        pos += 8 + head_len
        (count,) = struct.unpack_from("<I", data, pos)
        pos += 4
        blobs = {}
        for _ in range(count):
            (name_len,) = struct.unpack_from("<I", data, pos)
            name = data[pos + 4 : pos + 4 + name_len].decode()
            pos += 4 + name_len
            (size,) = struct.unpack_from("<I", data, pos)
            blobs[name] = zlib.decompress(data[pos + 4 : pos + 4 + size])
            pos += 4 + size
        if "globals" in blobs:
            globals_ = bytearray(blobs["globals"])
        elif "globals_diff" in blobs:
            _apply_word_diff(globals_, blobs["globals_diff"])
        if "roster" in blobs:
            roster = blobs["roster"]
        yield Frame(meta["t"], meta, meta["pool_base"], blobs["pool"], bytes(globals_), roster)
