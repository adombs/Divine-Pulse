"""The game-file readers on small synthetic files (no game data in the repo)."""

from __future__ import annotations

import hashlib
from pathlib import Path
import struct
import zlib

from PIL import Image
import pytest

from app.gamefiles import archive, g1t, msgdata, nso, tables, verify
from app.gamefiles.output import Output


def chunked(data: bytes, chunk_size: int, raw_chunks: set[int] = frozenset()) -> bytes:
    """A zlib-chunk file; chunks whose index is in raw_chunks are stored uncompressed, as the game does when zlib
    would not make them smaller."""
    pieces = [data[at : at + chunk_size] for at in range(0, len(data), chunk_size)]
    bodies = []
    for n, piece in enumerate(pieces):
        if n in raw_chunks:
            bodies.append(piece)
        else:
            packed = zlib.compress(piece)
            bodies.append(struct.pack("<I", len(packed)) + packed)
    head = struct.pack(f"<3I{len(pieces)}I", chunk_size, len(pieces), len(data), *(len(b) for b in bodies))
    out = bytearray(head)
    for body in bodies:
        out += b"\0" * (-len(out) % 0x80)
        out += body
    return bytes(out)


def test_unchunk_reads_zlib_and_raw_chunks():
    data = bytes(range(256)) * 300
    assert archive.unchunk(chunked(data, 0x4000)) == data
    # The bug this fixes: the last short chunk is stored raw (stored size == unpacked size, no zlib).
    assert archive.unchunk(chunked(data, 0x4000, {4})) == data
    assert archive.unchunk(chunked(data, 0x4000, {0, 2})) == data


def test_unchunk_rejects_wrong_total():
    raw = bytearray(chunked(b"x" * 100, 0x40))
    struct.pack_into("<I", raw, 8, 101)
    with pytest.raises(ValueError):
        archive.unchunk(bytes(raw))


def make_romfs(tmp_path: Path) -> Path:
    romfs = tmp_path / "romfs"
    (romfs / "patch4" / "nx" / "data").mkdir(parents=True)
    entries = [b"plain entry", chunked(b"packed entry" * 50, 0x80, {1})]
    index, blob = bytearray(), bytearray()
    for n, body in enumerate(entries):
        size = len(b"packed entry" * 50) if n else len(body)
        index += archive.ENTRY.pack(len(blob), size, len(body), n)
        blob += body
    (romfs / "DATA0.bin").write_bytes(bytes(index))
    (romfs / "DATA1.bin").write_bytes(bytes(blob))
    (romfs / "patch4" / "nx" / "data" / "override.bin").write_bytes(b"newer entry")
    info = archive.INFO.pack(0, 11, 11, 0, b"rom:/patch4/nx/data/override.bin")
    (romfs / "patch4" / "INFO0.bin").write_bytes(info)
    return romfs


def test_archive_entries_overrides_and_loose_files(tmp_path):
    romfs = make_romfs(tmp_path)
    found = archive.Archive(romfs)
    assert found.read(0) == b"newer entry"
    assert found.read(0, patched=False) == b"plain entry"
    assert found.read(1) == b"packed entry" * 50
    assert found.read_file("nx/data/override.bin") == b"newer entry"
    assert found.resolve("nx/data/missing.bin") is None


def test_archive_combines_separate_update_roots(tmp_path):
    from app.gamefiles.dump import GameDump
    from app.gamefiles.extract import Context

    romfs = make_romfs(tmp_path)
    update = tmp_path / "update"
    patch = update / "patch5"
    (patch / "nx" / "data").mkdir(parents=True)
    (patch / "nx" / "data" / "override.bin").write_bytes(b"latest")
    (patch / "INFO0.bin").write_bytes(
        archive.INFO.pack(0, 6, 6, 0, b"rom:/patch5/nx/data/override.bin")
    )
    (update / "loose.bin").write_bytes(b"update loose")
    ctx = Context(GameDump(romfs, updates=[romfs, update]), Output(tmp_path / "out"))
    assert ctx.base.read(0) == b"latest"
    assert ctx.base.read(0, patched=False) == b"plain entry"
    assert ctx.base.read_file("nx/data/override.bin") == b"latest"
    assert ctx.base.read_file("loose.bin") == b"update loose"
    (patch / "INFO0.bin").write_bytes(b"")
    assert archive.Archive(romfs, [update]).read(0) == b"newer entry"


def test_pack_items():
    items = [b"first", b"second!"]
    head = struct.pack("<5I", 2, 20, 5, 25, 7)
    assert archive.pack_items(head + b"".join(items)) == items


def make_g1t(image: Image.Image) -> bytes:
    pixels = image.convert("RGBA").tobytes("raw", "BGRA")
    log2 = (image.width.bit_length() - 1) | ((image.height.bit_length() - 1) << 4)
    texture = bytes([0, 0x01, log2, 0]) + struct.pack("<I", 0) + pixels
    head = b"GT1G0600" + struct.pack("<3I", 0x20 + 4 + len(texture), 0x1C, 1) + b"\0" * 8
    return head + struct.pack("<I", 4) + texture


def test_g1t_bgra_texture():
    source = Image.new("RGBA", (8, 4), (10, 20, 30, 255))
    source.putpixel((1, 2), (200, 100, 50, 128))
    data = make_g1t(source)
    assert g1t.is_g1t(data)
    assert g1t.texture(data).tobytes() == source.tobytes()


def test_tables_sections():
    rows = [bytes([n, n + 1, n + 2]) for n in range(4)]
    section = b"\x00\x19\x12\x16" + struct.pack("<II", 4, 3) + b"\0" * 0x34 + b"".join(rows)
    data = struct.pack("<3I", 1, 12, len(section)) + section
    assert tables.rows(data, 0) == rows
    assert tables.signed(0xFE) == -2


def test_msgdata_strings_and_clean():
    strings = ["", "Byleth", "\x1bC1Hit\x1bR +5​ "]
    body = b"".join(s.encode() + b"\0" for s in strings)
    starts, at = [], 4 * len(strings)
    for s in strings:
        starts.append(at)
        at += len(s.encode()) + 1
    text = struct.pack("<5I", 0x134C58, 0, len(strings), 0x14, 0xFFFFFF00) + struct.pack(f"<{len(strings)}I", *starts)
    text += body
    language = struct.pack("<3I", 1, 12, len(text)) + text
    data = struct.pack("<3I", 1, 12, len(language)) + language
    assert msgdata.files(data, 0) == [strings]
    assert msgdata.clean(strings[2]) == "Hit +5"


def lz4_literals(data: bytes) -> bytes:
    """An LZ4 block of literals then one match repeating the last 3 bytes (overlapping copy)."""
    token = (min(len(data), 15) << 4) | 6  # match length 6 + 4 = 10
    extra = bytes([len(data) - 15]) if len(data) >= 15 else b""
    return bytes([token]) + extra + data + struct.pack("<H", 3) + bytes([0x00])


def test_lz4_block_with_overlapping_match():
    out = nso.lz4_block(lz4_literals(b"abcdefghijklmnopq"), 17 + 10)
    assert out == b"abcdefghijklmnopq" + b"opqopqopqo"


def test_nso_image(tmp_path):
    text, ro, data = b"T" * 16, b"R" * 8, b"D" * 4
    head = bytearray(0x100)
    head[:4] = b"NSO0"
    struct.pack_into("<I", head, 0x0C, 0b111000)  # no compression, hashes checked
    for n, (seg, mem) in enumerate([(text, 0), (ro, 0x20), (data, 0x30)]):
        struct.pack_into("<III", head, 0x10 + 0x10 * n, 0x100 + sum(map(len, [text, ro, data][:n])), mem, len(seg))
        struct.pack_into("<I", head, 0x60 + 4 * n, len(seg))
        head[0xA0 + 0x20 * n : 0xC0 + 0x20 * n] = hashlib.sha256(seg).digest()
    head[0x40:0x50] = bytes(range(16))
    path = tmp_path / "main"
    path.write_bytes(bytes(head) + text + ro + data)
    main = nso.Executable(path)
    assert main.build_id == bytes(range(16)).hex().upper()
    assert main.read(0x20, 8) == ro and main.read(0x30, 4) == data


def test_verify_detects_damage_and_missing_files(tmp_path):
    out = Output(tmp_path / "out")
    out.image("images/a.png", Image.new("RGBA", (4, 4), (1, 2, 3, 255)), source="test")
    out.json("data/b.json", {"x": 1}, source="test")
    out.write_manifest(dump={"version": "1.2.0"}, families={})
    assert verify.check(out.root).ok

    (out.root / "data" / "b.json").write_text('{"x": 2}\n')
    assert any("damaged" in e for e in verify.check(out.root).errors)

    (out.root / "images" / "a.png").unlink()
    assert any("images/a.png: missing" in e for e in verify.check(out.root).errors)


def test_maybe_unchunk_leaves_plain_files_alone():
    table = struct.pack("<3I", 0x12, 0x98, 0x400) + b"\0" * 64
    assert archive.maybe_unchunk(table) == table
    assert archive.maybe_unchunk(b"GT1G" + b"\0" * 60).startswith(b"GT1G")
    data = b"chunked" * 40
    assert archive.maybe_unchunk(chunked(data, 0x40, {4})) == data
