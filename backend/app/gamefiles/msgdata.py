"""The game's text: common/common/msgdata.bin (newest patch; DATA entry 0 is the older copy).

    u32 language count (12), then (offset, size) per language, absolute
    language: u32 file count (4), then (offset, size) per file, relative to the language
    file: 5 x u32 header (string count in the low 16 bits of the third), then string offsets relative to 0x14,
          then NUL-terminated UTF-8 strings

Every language has the same string count per file, so one index rule works for all of them. Index rules for each
kind of name or description are mapped by the extractors.
"""

from __future__ import annotations

import re
import struct

MSGDATA = "common/common/msgdata.bin"
# The order inside the _E/_U pairs is inferred from wording (Spain Spanish is 6, Latin American 7).
LANGUAGES = ("JP", "ENG_E", "ENG_U", "GER", "FRA_E", "FRA_U", "ESP_E", "ESP_U", "ITA", "KOR", "TWN", "CHN")
CONTROL = re.compile(r"\x1b(?:%[sd]\d|C\d|EK\d|EL\d|EM\d|S\d|P\d|A\d|[RQ])")


def files(data: bytes, language: int) -> list[list[str]]:
    """Every string of one language, as [file][index]."""
    if not 0 <= language < struct.unpack_from("<I", data, 0)[0]:
        raise IndexError(f"no language {language}")
    blob = struct.unpack_from("<I", data, 4 + 8 * language)[0]
    out = []
    for n in range(struct.unpack_from("<I", data, blob)[0]):
        offset, size = struct.unpack_from("<II", data, blob + 4 + 8 * n)
        text = data[blob + offset : blob + offset + size]
        strings = struct.unpack_from("<I", text, 8)[0] & 0xFFFF
        base = struct.unpack_from("<I", text, 12)[0]
        starts = struct.unpack_from(f"<{strings}I", text, base)
        out.append([text[base + s : text.index(b"\0", base + s)].decode("utf-8") for s in starts])
    return out


def clean(text: str) -> str:
    """A string for display: control codes, zero-width spaces and edge spaces dropped, line breaks kept."""
    return CONTROL.sub("", text).replace("​", "").strip(" ")
