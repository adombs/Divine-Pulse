"""The game's main executable from an ExeFS dump (exefs/main, an NSO0 file).

Some tables the UI needs (sprite rectangles, icon selectors) only exist in the program's read-only data. Addresses in
docs and tools are "main + offset", the offset into the loaded module: .text at 0, .rodata and .data at their memory
offsets from the header. Segments are LZ4 block compressed when the header's flag bit says so.
"""

from __future__ import annotations

from functools import cached_property
from pathlib import Path
import hashlib
import struct

SEGMENTS = ("text", "rodata", "data")


def lz4_block(src: bytes, size: int) -> bytes:
    """Decompress one raw LZ4 block (no frame) to exactly size bytes."""
    out = bytearray()
    at, end = 0, len(src)
    while at < end:
        token = src[at]
        at += 1
        literals = token >> 4
        if literals == 15:
            while True:
                extra = src[at]
                at += 1
                literals += extra
                if extra != 255:
                    break
        out += src[at : at + literals]
        at += literals
        if at >= end:
            break
        back = src[at] | (src[at + 1] << 8)
        at += 2
        length = token & 0xF
        if length == 15:
            while True:
                extra = src[at]
                at += 1
                length += extra
                if extra != 255:
                    break
        length += 4
        start = len(out) - back
        if back <= 0 or start < 0:
            raise ValueError("bad LZ4 match offset")
        if back >= length:
            out += out[start : start + length]
        else:  # overlapping copy repeats the last `back` bytes
            chunk = out[start:]
            out += (chunk * (length // back + 1))[:length]
    if len(out) != size:
        raise ValueError(f"LZ4 block unpacked to {len(out)} bytes, expected {size}")
    return bytes(out)


class Executable:
    """An NSO0 file, unpacked into one image laid out at the segments' memory offsets."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.raw = self.path.read_bytes()
        if self.raw[:4] != b"NSO0":
            raise ValueError(f"{self.path} is not an NSO file")

    @property
    def build_id(self) -> str:
        return self.raw[0x40:0x50].hex().upper()

    @cached_property
    def image(self) -> bytes:
        flags = struct.unpack_from("<I", self.raw, 0x0C)[0]
        layout = []
        for n, _ in enumerate(SEGMENTS):
            file_offset, memory_offset, size = struct.unpack_from("<III", self.raw, 0x10 + 0x10 * n)
            stored = struct.unpack_from("<I", self.raw, 0x60 + 4 * n)[0]
            data = self.raw[file_offset : file_offset + stored]
            if flags & (1 << n):
                data = lz4_block(data, size)
            if flags & (1 << (n + 3)):
                digest = self.raw[0xA0 + 0x20 * n : 0xC0 + 0x20 * n]
                if hashlib.sha256(data).digest() != digest:
                    raise ValueError(f"{self.path}: {SEGMENTS[n]} segment hash mismatch")
            layout.append((memory_offset, data))
        image = bytearray(max(offset + len(data) for offset, data in layout))
        for offset, data in layout:
            image[offset : offset + len(data)] = data
        return bytes(image)

    def read(self, offset: int, size: int) -> bytes:
        """size bytes at main + offset."""
        if offset < 0 or offset + size > len(self.image):
            raise IndexError(f"main+0x{offset:X} (+{size}) is outside the module")
        return self.image[offset : offset + size]
