"""The battle maps' music: the 20 battle themes, each in its calm (Rain) version, and which one each battle plays.

The game keeps its background music in Koei Tecmo stream banks (nx/sound/BGM.ktsl2stbin, and BGM_DLC.ktsl2stbin in the
Auxiliary Battle Maps DLC): a KTSR archive of KTSS streams, each Opus audio in Nintendo's framing (a 4-byte big-endian
packet size and a 4-byte final range before each packet). A battle theme is two streams in a row, its Rain then its
Thunder version; only the Rain versions, and only the battle themes (THEMES), are taken.

Each is rewrapped, not re-encoded, as an Ogg Opus file any browser can play:
    audio/bgm/<stream id>.ogg     the audio (the stream id is the bank's own, as 8 hex digits)
    data/music.json               each theme: its id, title, group, file, sample rate, samples and loop (start and
                                  length in samples, so a video can loop it seamlessly); and which theme each battle
                                  plays, by scenario id, from nx/data/fixed_scenario.bin (byte 29 of its row)

Titles are not in the game files: they're the official soundtrack's (Fire Emblem Wiki, GFDL 1.3), matched to the
streams by the battles that play them and by length.
"""

from __future__ import annotations

import mmap
from pathlib import Path
import struct

from . import Context

BANKS = {
    "base": (None, "nx/sound/BGM.ktsl2stbin"),
    "dlc": ("auxiliary_battle_maps", "BGM_DLC.ktsl2stbin"),
}

# The battle themes' Rain streams, by the bank's stream id: their bank, title and group (for the music picker).
THEMES: dict[int, tuple[str, str, str]] = {
    0x62435707: ("base", "Fódlan Winds", "Part I"),
    0x0CF7EC0F: ("base", "Dwelling of the Ancient Gods", "Part I"),
    0x5872A58D: ("base", "Blue Skies and a Battle", "Part I"),
    0x8BE11B06: ("base", "Tearing Through Heaven", "Part I"),
    0xB57EDF05: ("base", "Roar of Dominion", "Part I"),
    0xDF1CA304: ("base", "Chasing Daybreak", "Part II"),
    0x8210698C: ("base", "Between Heaven and Earth", "Part II"),
    0x08BA6703: ("base", "The Long Road", "Part II"),
    0x5BA3B472: ("base", "Shambhala (Area 17 Redux)", "Part II"),
    0x218C9310: ("base", "The Apex of the World", "Final battles"),
    0xABAE2D8B: ("base", "God-Shattering Star", "Final battles"),
    0xD54BF18A: ("base", "A Funeral of Flowers", "Final battles"),
    0xFA9BC2F8: ("base", "The Verge of Death", "Boss battles"),
    0x4DD74AF6: ("base", "Paths That Will Never Cross", "Boss battles"),
    0x9D8F8980: ("base", "Indomitable Will", "Boss battles"),
    0xF8FB4538: ("base", "Tempest of Seasons", "Paralogues and side battles"),
    0x723C28F3: ("dlc", "Corridor of the Tempest", "Paralogues and side battles"),
    0xB989E87F: ("dlc", "The Shackled Wolves", "Cindered Shadows"),
    0xD0FDFEF9: ("base", "Wrath Strike", "Cindered Shadows"),
    0x05223E6F: ("dlc", "At What Cost?", "Cindered Shadows"),
}

# fixed_scenario.bin section 0, byte 29: the battle's map theme, as the game numbers its music (a list in the
# executable: the base bank's streams 0-27 in order, then others). The numbers battles use, as stream ids.
SCENARIO_FILE = "fixed_scenario.bin"
SCENARIO_MUSIC_BYTE = 29
GAME_MUSIC: dict[int, int] = {
    0: 0x62435707, 2: 0x8BE11B06, 4: 0xB57EDF05, 6: 0xDF1CA304, 8: 0x08BA6703, 10: 0x5872A58D, 12: 0x8210698C,
    14: 0xABAE2D8B, 16: 0xD54BF18A, 18: 0x218C9310, 20: 0xF8FB4538, 24: 0x5BA3B472, 26: 0x0CF7EC0F,
    28: 0xB989E87F, 32: 0xD0FDFEF9, 44: 0xB989E87F, 46: 0x05223E6F,
}

KTSS = b"KTSS"
OPUS = 0x09
# The bank keeps a stream's id 0x38 bytes before its KTSS header.
ID_BEFORE = 0x38


def _streams(blob) -> list[dict]:
    """Every KTSS stream in a bank (bytes or a memory map), in order: where it is and what its header says."""
    out = []
    pos = 0
    while True:
        pos = blob.find(KTSS, pos)
        if pos < 0:
            break
        size = struct.unpack_from("<I", blob, pos + 4)[0]
        if size < 0x80 or pos + size > len(blob):
            pos += 4
            continue
        codec = blob[pos + 0x20]
        channels = blob[pos + 0x29]
        rate, samples, loop_start, loop_length = struct.unpack_from("<IIii", blob, pos + 0x2C)
        out.append({
            "offset": pos,
            "size": size,
            "id": struct.unpack_from("<I", blob, pos - ID_BEFORE)[0] if pos >= ID_BEFORE else None,
            "codec": codec,
            "channels": channels,
            "rate": rate,
            "samples": samples,
            "loop_start": loop_start,
            "loop_length": loop_length,
            "data": struct.unpack_from("<I", blob, pos + 0x40)[0],
            "data_size": struct.unpack_from("<I", blob, pos + 0x44)[0],
            "frame": struct.unpack_from("<H", blob, pos + 0x52)[0],
            "preskip": struct.unpack_from("<H", blob, pos + 0x58)[0],
        })
        pos += size
    return out


# Ogg (RFC 3533): CRC-32 with polynomial 0x04C11DB7, not reflected, no final xor.
_CRC = []
for _n in range(256):
    _c = _n << 24
    for _ in range(8):
        _c = ((_c << 1) ^ 0x04C11DB7) if _c & 0x80000000 else (_c << 1)
    _CRC.append(_c & 0xFFFFFFFF)


def _crc(data: bytes) -> int:
    c = 0
    for byte in data:
        c = ((c << 8) & 0xFFFFFFFF) ^ _CRC[((c >> 24) & 0xFF) ^ byte]
    return c


def _page(serial: int, sequence: int, granule: int, packets: list[bytes], *, first=False, last=False) -> bytes:
    segments = []
    for packet in packets:
        n = len(packet)
        segments += [255] * (n // 255) + [n % 255]
    header = struct.pack("<4sBBqIIIB", b"OggS", 0, (2 if first else 0) | (4 if last else 0), granule, serial, sequence, 0, len(segments))
    page = header + bytes(segments) + b"".join(packets)
    crc = _crc(page)
    return page[:22] + struct.pack("<I", crc) + page[26:]


def _toc_samples(packet: bytes) -> int:
    """Samples (at 48 kHz) in an Opus packet, from its TOC byte (RFC 6716 3.1)."""
    if not packet:
        return 0
    toc = packet[0]
    config = toc >> 3
    if config < 12:
        per = (480, 960, 1920, 2880)[config & 3]
    elif config < 16:
        per = (480, 960)[config & 1]
    else:
        per = (120, 240, 480, 960)[config & 3]
    code = toc & 3
    frames = 1 if code == 0 else 2 if code in (1, 2) else (packet[1] & 0x3F if len(packet) > 1 else 1)
    return per * frames


def to_ogg(blob: bytes, stream: dict, serial: int) -> bytes:
    """A KTSS Opus stream as an Ogg Opus file (the same packets, in Ogg pages)."""
    if stream["codec"] != OPUS:
        raise ValueError(f"stream {stream['id']:08x} is not Opus")
    start = stream["offset"] + stream["data"]
    end = min(stream["offset"] + stream["size"], start + stream["data_size"])
    packets = []
    pos = start
    while pos + 8 <= end:
        size = struct.unpack_from(">I", blob, pos)[0]
        if size == 0 or pos + 8 + size > end:
            break
        packets.append(blob[pos + 8:pos + 8 + size])
        pos += 8 + size
    if not packets:
        raise ValueError(f"stream {stream['id']:08x} has no audio")
    channels = stream["channels"]
    head = struct.pack("<8sBBHIhB", b"OpusHead", 1, channels, stream["preskip"], stream["rate"], 0, 0 if channels <= 2 else 1)
    if channels > 2:
        head += bytes([1, channels - 1 if channels > 1 else 0]) + bytes(range(channels))
    vendor = b"Divine Pulse (rewrapped from the game's own stream)"
    tags = struct.pack("<8sI", b"OpusTags", len(vendor)) + vendor + struct.pack("<I", 0)
    pages = [_page(serial, 0, 0, [head], first=True), _page(serial, 1, 0, [tags])]
    sequence = 2
    granule = 0
    batch: list[bytes] = []
    batch_bytes = 0
    for i, packet in enumerate(packets):
        granule += _toc_samples(packet)
        batch.append(packet)
        batch_bytes += len(packet)
        last = i == len(packets) - 1
        if batch_bytes >= 4000 or len(batch) >= 50 or last:
            pages.append(_page(serial, sequence, granule, batch, last=last))
            sequence += 1
            batch, batch_bytes = [], 0
    return b"".join(pages)


def extract(ctx: Context) -> None:
    tracks = []
    for bank, (dlc, rel) in BANKS.items():
        wanted = {sid for sid, (b, _, _) in THEMES.items() if b == bank}
        root: Path | None = ctx.dump.romfs if dlc is None else ctx.dump.dlc.get(dlc)
        if root is None:
            ctx.skip(f"Auxiliary Battle Maps DLC not found: its battle themes ({rel})")
            continue
        path = Path(root) / rel
        if not path.is_file():
            ctx.skip(f"music: {rel} not found")
            continue
        with path.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as blob:
            found = {s["id"]: s for s in _streams(blob) if s["id"] in wanted}
            for sid in sorted(wanted, key=list(THEMES).index):
                stream = found.get(sid)
                if stream is None:
                    ctx.skip(f"music: {THEMES[sid][1]} ({sid:08x}) not in {rel}")
                    continue
                name = f"{sid:08x}"
                file_rel = f"audio/bgm/{name}.ogg"
                ctx.out.binary(file_rel, to_ogg(blob, stream, serial=sid), kind="audio", source=f"{rel} stream {name}")
                _, title, group = THEMES[sid]
                tracks.append({
                    "id": name,
                    "title": title,
                    "group": group,
                    "file": file_rel,
                    "rate": stream["rate"],
                    "channels": stream["channels"],
                    "samples": stream["samples"],
                    "loop_start": stream["loop_start"],
                    "loop_length": stream["loop_length"],
                })
        ctx.log(f"  {rel}: {sum(1 for t in tracks if THEMES[int(t['id'], 16)][0] == bank)} battle themes")
    if not tracks:
        return
    have = {t["id"] for t in tracks}
    scenarios = {}
    try:
        for scenario, row in enumerate(ctx.table(SCENARIO_FILE, 0)):
            sid = GAME_MUSIC.get(row[SCENARIO_MUSIC_BYTE]) if len(row) > SCENARIO_MUSIC_BYTE else None
            if sid is not None and f"{sid:08x}" in have:
                scenarios[str(scenario)] = f"{sid:08x}"
    except (KeyError, OSError, ValueError) as error:
        ctx.skip(f"music: {SCENARIO_FILE} unreadable ({error}); no default theme per battle")
    ctx.out.json("data/music.json", {"tracks": tracks, "scenarios": scenarios},
                 source=f"nx/sound stream banks; nx/data/{SCENARIO_FILE} section 0 byte {SCENARIO_MUSIC_BYTE}")
