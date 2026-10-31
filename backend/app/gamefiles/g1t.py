"""G1T texture files (Koei Tecmo). On Switch the textures are stored linear (no block swizzle)."""

from __future__ import annotations

import struct

from PIL import Image

# Format byte -> (bytes per block or pixel, block size, Pillow decoder and argument).
FORMATS = {
    0x01: (4, 1, ("raw", "BGRA")),  # the map sprites only read right as BGRA
    0x59: (8, 4, ("bcn", 1)),
    0x5B: (16, 4, ("bcn", 3)),
    0x5E: (16, 4, ("bcn", 6)),
    0x5F: (16, 4, ("bcn", 7)),
}


def is_g1t(data: bytes) -> bool:
    return data[:4] == b"GT1G"


def header(g1t: bytes, n: int) -> tuple[int, int, int, int]:
    """(format, width, height, data offset) of texture n's first mip."""
    if not is_g1t(g1t):
        raise ValueError("not a G1T file")
    table = struct.unpack_from("<I", g1t, 0x0C)[0]
    head = table + struct.unpack_from("<I", g1t, table + 4 * n)[0]
    fmt, dims = g1t[head + 1], g1t[head + 2]
    extra = struct.unpack_from("<I", g1t, head + 8)[0]
    return fmt, 1 << (dims & 0xF), 1 << (dims >> 4), head + 8 + (extra if extra in (0x0C, 0x10, 0x14) else 0)


def texture(g1t: bytes, n: int = 0) -> Image.Image:
    """Texture n (first mip) as an RGBA image."""
    fmt, width, height, data = header(g1t, n)
    if fmt not in FORMATS:
        raise ValueError(f"G1T texture format 0x{fmt:02X} is not supported")
    unit, block, (decoder, arg) = FORMATS[fmt]
    if decoder == "raw":
        return Image.frombytes("RGBA", (width, height), g1t[data : data + width * height * unit], "raw", arg)
    size = max(width // block, 1) * max(height // block, 1) * unit
    mode = "RGB" if arg == 6 else "RGBA"  # BC6H has no alpha
    return Image.frombytes(mode, (width, height), g1t[data : data + size], "bcn", arg).convert("RGBA")
