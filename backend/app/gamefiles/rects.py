"""Sprite rectangle tables in the main executable (1.2.0, build 89048449BA238C8CF565518B83BF02D3).

Each table is an array of 16-byte records: u16 texture width, texture height, texture index, sprite id, x, y, w, h.
Offsets are main + offset (see nso.py). Found by disassembly; see docs/battle-page-plan.md, docs/minimap-atlas.md
and docs/native-inventory-icons.md.
"""

from __future__ import annotations

from dataclasses import dataclass
import struct

from .nso import Executable

RECORD = struct.Struct("<8H")
MAP_SPRITES = (0x1291510, 1477)  # DATA 6109 map sprites (class bodies, mounts, heads)
BATTLE_UI = (0xD588D0, 295)  # DATA 6050 battle UI; texture 10 = ids 201-280 (minimap pieces)
ICONS = 0xD52D60  # DATA 6026 icon atlas; indexed by the item/ability sprite id the game's selectors return


@dataclass(frozen=True)
class Rect:
    texture_width: int
    texture_height: int
    texture: int
    id: int
    x: int
    y: int
    w: int
    h: int

    @property
    def box(self) -> tuple[int, int, int, int]:
        return self.x, self.y, self.x + self.w, self.y + self.h

    @property
    def empty(self) -> bool:
        return self.w == 0 or self.h == 0


def table(main: Executable, offset: int, count: int) -> list[Rect]:
    raw = main.read(offset, RECORD.size * count)
    return [Rect(*RECORD.unpack_from(raw, n * RECORD.size)) for n in range(count)]


def map_sprites(main: Executable) -> list[Rect]:
    return table(main, *MAP_SPRITES)


def battle_ui(main: Executable) -> list[Rect]:
    return table(main, *BATTLE_UI)


# The icon table holds one record per sprite id, id == index, for ids 0..724 (all in atlas 6026); at index 725 the id
# restarts at 0 and the next sprite table (another atlas) begins.
ICON_COUNT = 725
# An ability's icon index (fixed_skill.bin section 0, row byte +0x08) is the sprite id minus this base.
ABILITY_ICON_BASE = 146
CREST_ICON_BASE = 0x7A  # crest id 0-21 -> sprite 0x7A + id (the Dragon Sign selector); texture 1 of atlas 6026


def icons(main: Executable) -> list[Rect]:
    """The whole icon rectangle table, indexed by sprite id."""
    return table(main, ICONS, ICON_COUNT)
