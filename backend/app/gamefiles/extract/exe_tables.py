"""Tables read from the main executable, and the icons that need them.

Writes data/exe/item-icons.json, plus
images/icons/abilities/<ability id>.png, crests/<crest id>.png and items-native/<sprite id hex>.png.

How the icons are found:
- The icon rectangle table (main+0xD52D60, 725 records, id == index) is indexed by sprite id; it points into atlas 6026.
- An ability's sprite id is its icon index (fixed_skill.bin section 0, row byte +0x08) + 146. The 11 Cindered Shadows
  abilities (icon indices 238-250) are not in that table: the DLC atlas (700_patch texture 1) holds them, and their
  tile origins are listed here as coordinates (DLC_ABILITY_TILES), the way the game's own table would.
- Items, weapons, spells and equipment pick their sprite with the selector at main+0x5D2A20 (item_sprite_id).
- A crest id 0-21 is sprite 0x7A + id (the Dragon Sign selector), 96 px tiles of atlas 6026 texture 1.

"""

from __future__ import annotations

from collections.abc import Callable
from functools import cache
import struct

from PIL import Image

from .. import g1t, msgdata, rects
from . import Context

ICON_ATLAS = 6026
DLC_ATLAS = "nx/ui/700_patch/700_patch.g1t.gz"
DLC_TILE = 94
# Icon index -> tile origin in the DLC atlas (texture 1) for the Cindered Shadows abilities.
DLC_ABILITY_TILES = {
    238: (1737, 873), 239: (1637, 849), 241: (1905, 425), 242: (1953, 621), 243: (1953, 721), 244: (1749, 773),
    246: (1949, 821), 247: (1137, 849), 248: (1237, 849), 249: (1337, 849), 250: (1437, 849),
}  # fmt: skip
WEAPON_NAME = 3746  # msgdata file 2: weapon name = F2[3746 + item id]
WEAPON_FIRST_ID = 10
EQUIPMENT_SECTION, ITEM_SECTION, ITEM_FIRST_ID = 5, 6, 1000
WEAPON_SECTION, SPELL_SECTION = 0, 1


def item_sprite_id(raw: bytes, name: str = "") -> int | None:
    """Sprite id the game draws for a weapon, spell, equipment or item row (24 bytes), or None for no icon."""
    skill, crest, flags = raw[5], raw[9], raw[0x16]
    if raw[0x0F] & 0x80:
        return 0x204
    if skill <= 4:
        # Brokenness is live durability; only the game's explicit broken templates are stable rows.
        if name.lower().startswith("broken "):
            return 0x21D + skill
        if flags & 0x80:
            return 0x215 + skill
        if crest == 0x2C:
            return 0x205 + skill
        if crest == 0x2D:
            return 0x1FC + skill
        return (0x20D if crest < 0x56 else 0x1FC) + skill
    if skill in (5, 6, 7):
        return {5: 0x202, 6: 0x201, 7: 0x203}[skill]
    if skill == 8:
        category = raw[0x0D]
        if category > 3:
            return 0x1D4
        if flags & 0x80:
            return 0x1EA + category
        if crest == 0x2C:
            return 0x1E2 + category
        if crest < 0x56 and crest not in (0x2C, 0x2D):
            return 0x1E6 + category
        return 0x1D4 + category
    if skill in (9, 11):
        if raw[4] == 0x17 and crest != 0x56:
            return rects.CREST_ICON_BASE + crest
        return 0x1D4 + raw[0x0D]
    if skill == 10:
        return 0x1D7
    return None


def _rows(ctx: Context, name: str, section: int) -> list[bytes]:
    return ctx.table(name, section)


def _atlas(ctx: Context) -> Callable[[int], Image.Image]:
    data = ctx.base.read(ICON_ATLAS)

    @cache
    def texture(n: int) -> Image.Image:
        return g1t.texture(data, n)

    return texture


def _crop(atlas: Image.Image, rect: rects.Rect) -> Image.Image | None:
    if rect.empty or rect.x + rect.w > atlas.width or rect.y + rect.h > atlas.height:
        return None
    return atlas.crop(rect.box)


def _weapon_names(ctx: Context) -> list[str]:
    try:
        strings = ctx.text()[2]
    except Exception as error:  # a missing text file only costs the "Broken" template rule
        ctx.log(f"  no weapon names ({error}); broken-weapon templates use their intact sprite")
        return []
    return [msgdata.clean(s) for s in strings[WEAPON_NAME + WEAPON_FIRST_ID :]]


def _abilities(ctx: Context, table: list[rects.Rect], atlas: Callable[[int], Image.Image]) -> None:
    try:
        rows = _rows(ctx, "fixed_skill.bin", 0)
    except FileNotFoundError:
        ctx.skip("ability icons: nx/data/fixed_skill.bin is missing")
        return
    icon_index = {n: row[8] for n, row in enumerate(rows)}
    dlc = None
    if ctx.base.resolve(DLC_ATLAS):
        dlc = g1t.texture(ctx.base.read_file(DLC_ATLAS), 1)
    for ability, index in icon_index.items():
        tile, source = None, ""
        if index in DLC_ABILITY_TILES:
            if dlc is not None:
                x, y = DLC_ABILITY_TILES[index]
                tile = dlc.crop((x, y, x + DLC_TILE, y + DLC_TILE))
                source = f"{DLC_ATLAS} texture 1 ({x},{y}) icon index {index}"
        elif (sprite := rects.ABILITY_ICON_BASE + index) < len(table):
            rect = table[sprite]
            if rect.texture == 2:
                tile = _crop(atlas(2), rect)
                source = f"DATA {ICON_ATLAS} texture 2 sprite {sprite} icon index {index}"
        if tile is None or tile.getchannel("A").getbbox() is None:
            continue
        rel = f"images/icons/abilities/{ability}.png"
        ctx.out.image(rel, tile, source=source)
    if dlc is None:
        ctx.skip("ability icons for the Cindered Shadows abilities: 700_patch atlas is missing")


def _crests(ctx: Context, table: list[rects.Rect], atlas: Callable[[int], Image.Image]) -> None:
    for crest in range(22):
        sprite = rects.CREST_ICON_BASE + crest
        tile = _crop(atlas(1), table[sprite])
        if tile is None:
            continue
        rel = f"images/icons/crests/{crest}.png"
        ctx.out.image(rel, tile, source=f"DATA {ICON_ATLAS} texture 1 sprite {sprite} (crest id {crest})")


def _items(ctx: Context, table: list[rects.Rect], atlas: Callable[[int], Image.Image]) -> dict:
    names = _weapon_names(ctx)
    sections = (
        ("weapons", "fixed_data.bin", WEAPON_SECTION, WEAPON_FIRST_ID),
        ("spells", "fixed_data.bin", SPELL_SECTION, 0),
        ("equipment", "fixed_data.bin", EQUIPMENT_SECTION, 0),
        ("items", "fixed_data.bin", ITEM_SECTION, ITEM_FIRST_ID),
    )
    kinds: dict[str, dict[str, int]] = {}
    for kind, name, section, first in sections:
        try:
            rows = _rows(ctx, name, section)
        except FileNotFoundError:
            ctx.skip(f"{kind} icons: nx/data/{name} is missing")
            continue
        found = {}
        for n, row in enumerate(rows):
            if not any(row):
                continue
            label = names[n] if kind == "weapons" and n < len(names) else ""
            sprite = item_sprite_id(row, label)
            if sprite is not None and sprite < len(table):
                found[str(first + n)] = sprite
        kinds[kind] = found
    for sprite in sorted({s for found in kinds.values() for s in found.values()}):
        if sprite >= len(table):
            continue
        rect = table[sprite]
        try:
            tile = _crop(atlas(rect.texture), rect)
        except (ValueError, struct.error):  # texture not in the atlas, or in a format the reader lacks
            tile = None
        if tile is None:
            continue
        rel = f"images/icons/items-native/{sprite:03x}.png"
        ctx.out.image(rel, tile, source=f"DATA {ICON_ATLAS} texture {rect.texture} sprite {sprite}")
    return kinds


def extract(ctx: Context) -> None:
    main = ctx.main
    if main is None:
        ctx.skip("exe_tables: no ExeFS main, so no sprite tables, ability, item or crest icons")
        return
    table = rects.icons(main)
    atlas = _atlas(ctx)
    _abilities(ctx, table, atlas)
    _crests(ctx, table, atlas)
    kinds = _items(ctx, table, atlas)
    ctx.out.json(
        "data/exe/item-icons.json",
        kinds,
        source="nx/data/fixed_data.bin rows through the item sprite selector (main+0x5D2A20)",
    )
