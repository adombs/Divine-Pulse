"""The battle themes' music (gamefiles/extract/music.py): Opus streams rewrapped as Ogg, and which themes are taken."""

import struct

from app.gamefiles.extract import music


def _ktss(stream_id: int, packets: list[bytes], *, samples: int = 1920) -> bytes:
    """A bank with one KTSS Opus stream: its id 0x38 bytes before the header, then Nintendo-framed packets."""
    header = bytearray(0x70)
    header[0:4] = b"KTSS"
    header[0x20] = music.OPUS
    header[0x29] = 2
    struct.pack_into("<IIii", header, 0x2C, 48000, samples, 120, samples - 120)
    data = b"".join(struct.pack(">II", len(p), 0) + p for p in packets)
    struct.pack_into("<II", header, 0x40, 0x70, len(data))
    struct.pack_into("<H", header, 0x52, 960)
    struct.pack_into("<H", header, 0x58, 312)
    struct.pack_into("<I", header, 4, len(header) + len(data))
    lead = bytearray(0x40)
    struct.pack_into("<I", lead, 0x40 - music.ID_BEFORE, stream_id)
    return bytes(lead) + bytes(header) + data


def _pages(ogg: bytes) -> list[tuple[int, int, bytes]]:
    """(flags, granule, page bytes) of each Ogg page, checking each page's CRC."""
    pages, pos = [], 0
    while pos < len(ogg):
        assert ogg[pos:pos + 4] == b"OggS"
        flags, granule = ogg[pos + 5], struct.unpack_from("<q", ogg, pos + 6)[0]
        count = ogg[pos + 26]
        size = 27 + count + sum(ogg[pos + 27:pos + 27 + count])
        page = ogg[pos:pos + size]
        crc = struct.unpack_from("<I", page, 22)[0]
        assert music._crc(page[:22] + b"\0\0\0\0" + page[26:]) == crc
        pages.append((flags, granule, page))
        pos += size
    return pages


def test_an_opus_stream_is_rewrapped_as_ogg_without_reencoding():
    # Two 20 ms CELT packets (TOC config 31: 960 samples each).
    packets = [bytes([0xF8]) + b"a" * 40, bytes([0xF8]) + b"b" * 50]
    bank = _ktss(0x62435707, packets)
    [stream] = music._streams(bank)
    assert stream["id"] == 0x62435707 and stream["channels"] == 2 and stream["preskip"] == 312
    ogg = music.to_ogg(bank, stream, serial=7)
    pages = _pages(ogg)
    assert pages[0][2][28:36] == b"OpusHead" and pages[0][0] & 2  # first page: the Opus header
    assert pages[1][2][28:36] == b"OpusTags"
    assert pages[-1][0] & 4 and pages[-1][1] == 1920  # last page, two packets of 960 samples
    for packet in packets:
        assert packet in ogg  # the audio is carried over as it was


def test_twenty_battle_themes_are_taken_rain_only_and_battles_map_to_them():
    assert len(music.THEMES) == 20
    assert len({title for _, title, _ in music.THEMES.values()}) == 20
    # Every theme a battle can play is one that is taken.
    assert set(music.GAME_MUSIC.values()) <= set(music.THEMES)
