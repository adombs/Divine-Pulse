"""The fixed_*.bin data tables (nx/data/ in the newest patch folder).

A file is u32 section count, then (u32 offset, u32 size) per section. A table section starts with a 0x40-byte header
(tag 00 19 12 16, u32 row count at +4, u32 row size at +8) and then the rows. Some sections are not tables."""

from __future__ import annotations

import struct


class Table:
    def __init__(self, data: bytes, offset: int, size: int):
        self.data, self.offset, self.size = data, offset, size

    @property
    def count(self) -> int:
        return struct.unpack_from("<I", self.data, self.offset + 4)[0]

    @property
    def stride(self) -> int:
        return struct.unpack_from("<I", self.data, self.offset + 8)[0]

    def row(self, n: int) -> bytes:
        if not 0 <= n < self.count:
            raise IndexError(n)
        at = self.offset + 0x40 + n * self.stride
        return self.data[at : at + self.stride]

    def rows(self) -> list[bytes]:
        return [self.row(n) for n in range(self.count)]


def sections(data: bytes) -> list[Table]:
    count = struct.unpack_from("<I", data, 0)[0]
    return [Table(data, *struct.unpack_from("<II", data, 4 + 8 * n)) for n in range(count)]


def rows(data: bytes, section: int) -> list[bytes]:
    return sections(data)[section].rows()


def signed(byte: int) -> int:
    return byte - 256 if byte > 127 else byte
