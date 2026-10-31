"""The game's archive: DATA0.bin (index) and DATA1.bin (data), the patch folders that override entries, and the
zlib-chunk container most entries and loose files use."""

from __future__ import annotations

from functools import cached_property
from pathlib import Path
import struct
import zlib

ENTRY = struct.Struct("<4Q")  # DATA0.bin: offset in DATA1.bin, size, stored size, compressed flag
INFO = struct.Struct("<4Q256s")  # patchN/INFO0.bin: entry id, size, stored size, compressed flag, rom:/ path


def unchunk(raw: bytes) -> bytes:
    """A zlib-chunk file: u32 chunk size, u32 chunk count, u32 total size, then each chunk's stored size; the chunks
    start 0x80-aligned. A chunk whose stored size equals its unpacked size is stored as is; any other chunk is a u32
    length and a zlib stream. (Files named .g1t.gz are this format too, not gzip.)"""
    chunk_size, count, total = struct.unpack_from("<3I", raw, 0)
    sizes = struct.unpack_from(f"<{count}I", raw, 12)
    at = (12 + 4 * count + 0x7F) & ~0x7F
    out = bytearray()
    for stored in sizes:
        if stored == min(chunk_size, total - len(out)):
            out += raw[at : at + stored]
        else:
            length = struct.unpack_from("<I", raw, at)[0]
            out += zlib.decompress(raw[at + 4 : at + 4 + length])
        at = (at + stored + 0x7F) & ~0x7F
    if len(out) != total:
        raise ValueError(f"zlib-chunk file unpacked to {len(out)} bytes, header says {total}")
    return bytes(out)


def is_chunked(raw: bytes) -> bool:
    """Whether raw has a consistent zlib-chunk header (power-of-two chunk size, count covering the total, and the
    stored sizes fitting in the file)."""
    if len(raw) < 16:
        return False
    chunk_size, count, total = struct.unpack_from("<3I", raw, 0)
    if not chunk_size or chunk_size & (chunk_size - 1) or not count or 12 + 4 * count > len(raw):
        return False
    if count != -(-total // chunk_size):
        return False
    stored = struct.unpack_from(f"<{count}I", raw, 12)
    return all(0 < s <= chunk_size for s in stored) and sum(stored) <= len(raw)


def maybe_unchunk(raw: bytes) -> bytes:
    """Unpack a zlib-chunk file; any other file (a plain table, a G1T) is returned unchanged."""
    return unchunk(raw) if is_chunked(raw) else raw


def pack_items(data: bytes) -> list[bytes]:
    """A pack (the "still" face files, the minimap file): u32 count, then count x (offset, size)."""
    count = struct.unpack_from("<I", data, 0)[0]
    items = []
    for n in range(count):
        offset, size = struct.unpack_from("<II", data, 4 + 8 * n)
        items.append(data[offset : offset + size])
    return items


class Archive:
    """One dumped RomFS: DATA0/DATA1 entries plus loose files, with the newest patch folder winning."""

    def __init__(self, romfs: Path, updates: list[Path] | None = None):
        self.romfs = Path(romfs)
        self.roots = list(dict.fromkeys([self.romfs, *(Path(root) for root in updates or [])]))
        if not (self.romfs / "DATA0.bin").is_file() or not (self.romfs / "DATA1.bin").is_file():
            raise FileNotFoundError(f"{self.romfs} has no DATA0.bin / DATA1.bin")

    @cached_property
    def index(self) -> bytes:
        return (self.romfs / "DATA0.bin").read_bytes()

    @property
    def count(self) -> int:
        return len(self.index) // ENTRY.size

    @cached_property
    def patches(self) -> list[Path]:
        """patchN folders, newest first."""
        found = [p for root in self.roots for p in root.glob("patch*") if p.is_dir() and p.name[5:].isdigit()]
        return sorted(found, key=lambda p: int(p.name[5:]), reverse=True)

    @cached_property
    def overrides(self) -> dict[int, Path]:
        """Entry id -> the newest available loose patch file that replaces it."""
        found = {}
        for patch in self.patches:
            info = patch / "INFO0.bin"
            if not info.is_file():
                continue
            table = info.read_bytes()
            for at in range(0, len(table) - INFO.size + 1, INFO.size):
                entry, _, _, _, path = INFO.unpack_from(table, at)
                rel = path.split(b"\0", 1)[0].decode("utf-8", "replace").removeprefix("rom:/")
                path = patch.parent / rel
                if path.is_file():
                    found.setdefault(entry, path)
        return found

    def resolve(self, rel: str | Path) -> Path | None:
        """A loose file by its path below a patch folder or the RomFS root (e.g. nx/data/fixed_persondata.bin),
        taking the newest patch that has it."""
        for root in [*self.patches, *reversed(self.roots)]:
            path = root / rel
            if path.is_file():
                return path
        return None

    def entry_info(self, entry: int) -> tuple[int, int, int, int]:
        return ENTRY.unpack_from(self.index, entry * ENTRY.size)

    def read(self, entry: int, *, patched: bool = True) -> bytes:
        """An entry's unpacked bytes; a patch file replaces the entry when one exists."""
        if patched and entry in self.overrides:
            return maybe_unchunk(self.overrides[entry].read_bytes())
        offset, size, stored, compressed = self.entry_info(entry)
        if size == 0:
            return b""
        with open(self.romfs / "DATA1.bin", "rb") as data:
            data.seek(offset)
            raw = data.read(stored if compressed else size)
        return unchunk(raw) if compressed else raw

    def read_file(self, rel: str | Path) -> bytes:
        """A loose file (newest patch first), unpacked if it is a zlib-chunk file."""
        path = self.resolve(rel)
        if path is None:
            raise FileNotFoundError(f"{rel} is in no patch folder of {self.romfs}")
        return maybe_unchunk(path.read_bytes())
