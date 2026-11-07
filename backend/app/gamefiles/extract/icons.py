"""Atlas-cut icons that need no executable table and the house banners.

Ability, crest and native item icons belong to exe_tables; map sprites and minimap pieces to map.
"""

from __future__ import annotations

from collections import deque

from PIL import Image

from .. import g1t
from . import Context

ICONS = 6026
DLC_ATLAS = "nx/ui/700_patch/700_patch.g1t.gz"

# Weapon-skill tiles in 6026 texture 0 (1024 x 1024): the plain dark 94 x 94 ones, as (x, y).
WEAPONS = {
    "sword": (393, 133),
    "lance": (493, 133),
    "axe": (593, 133),
    "bow": (1, 169),
    "gauntlets": (693, 169),
    # Reason covers black and dark magic (the two books); Faith uses the single white-magic tome.
    "reason": (249, 197),
    "faith": (793, 169),
}
WEAPON_TILE = 94
GLYPH_SIZE = 64
EQUIP_MARK = (198, 210, 246, 258)
# Skill symbols in 6026 texture 0 as (x0, y0, x1, y1); not all are 94 px (the horse and wing are 80) and the 10 px
# frame of the shield is left out so it does not become a filled box.
SKILLS = {
    "authority": (893, 205, 987, 299),
    "riding": (308, 440, 388, 520),
    "flying": (408, 440, 488, 520),
    "heavy-armor": (859, 315, 933, 389),
}
# 6026 texture 2 (2048 x 2048): 94 px tiles on a 100 px grid, tile (row, column) at (1 + 100 c, 33 + 100 r).
# Item tiles in the plain dark frame, by reference icon name.
ITEM_TILES = {"item/sword": (16, 3), "item/shield": (14, 8), "item/potion": (13, 18)}
# Combat arts (one per weapon type) and magic schools: (x, y) of the 94 px tile in 6026 texture 2.
COMBAT_ARTS = {
    "sword": (1301, 1733), "lance": (1401, 1733), "axe": (1501, 1733), "bow": (1601, 1733),
    "brawling": (1701, 1733), "other": (1201, 1733),
}
MAGIC = {"black": (1, 1633), "white": (1901, 1533)}
ICON_SIZE = 48
# The house pictures in 6026 texture 8: search box (x0, y0, x1, y1) around each; the picture is its opaque pixels.
HOUSE_TEXTURE = 8
HOUSE_HEIGHT = 160
BANNERS = {
    "church-of-seiros": (87, 20, 433, 500),
    "black-eagles": (613, 27, 933, 480),
    "blue-lions": (1127, 27, 1447, 480),
    "golden-deer": (73, 553, 433, 993),
    "agarthans": (620, 527, 927, 1013),
    "professor": (1107, 527, 1467, 1013),
    "knights-of-seiros": (1035, 1177, 1144, 1316),
    "army-ally": (1035, 1177, 1144, 1316),
    "army-enemy": (1671, 1081, 1780, 1220),
    "army-player": (1935, 1049, 2044, 1188),
    "army-third": (1515, 1093, 1624, 1232),
    "other": (87, 1053, 427, 1527),
}
# The wolf circling the hanging keys, with the pennant's own gold edge: 700_patch texture 1 (2048 x 1024).
DLC_TEXTURE, DLC_BANNER = 1, (1795, 425, 1888, 562)


def percentile(sorted_values: list[float], q: float) -> float:
    """numpy's default (linear) percentile of an ascending list."""
    at = (len(sorted_values) - 1) * q / 100
    low = int(at)
    high = min(low + 1, len(sorted_values) - 1)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (at - low)


def glyph(tile: Image.Image) -> Image.Image:
    """A weapon tile's light glyph as white on transparent (the dark tile dropped)."""
    raw = tile.convert("RGBA").tobytes()
    red, green, blue, opacity = raw[0::4], raw[1::4], raw[2::4], raw[3::4]
    light = [(r + g + b) / 3 for r, g, b in zip(red, green, blue, strict=True)]
    solid = sorted(v for v, a in zip(light, opacity, strict=True) if a > 200)
    back, fore = (percentile(solid, 20), percentile(solid, 99)) if solid else (0.0, 1.0)
    scale = max(1.0, fore - back)
    alpha = bytes(int(min(max((v - back) / scale, 0.0), 1.0) * (a / 255) * 255) for v, a in zip(light, opacity, strict=True))
    out = Image.new("RGBA", tile.size, (255, 255, 255, 0))
    out.putalpha(Image.frombytes("L", tile.size, alpha))
    return out


def skill_glyph(tile: Image.Image) -> Image.Image | None:
    """Trim a skill silhouette and pad it square with a small transparent border like the weapons."""
    image = glyph(tile)
    alpha = image.getchannel("A").point(lambda a: a if a >= 24 else 0)  # compression noise
    image.putalpha(alpha)
    box = alpha.getbbox()
    if box is None:
        return None
    image = image.crop(box)
    side = max(image.size) + 8
    out = Image.new("RGBA", (side, side))
    out.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    return out


def strip_low_alpha_edges(tile: Image.Image) -> Image.Image:
    """Make the low-alpha pixels connected to a tile edge fully transparent; interior antialiasing stays."""
    rgba = tile.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    seen = [[False] * width for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.extend(((0, x), (height - 1, x)))
    for y in range(height):
        queue.extend(((y, 0), (y, width - 1)))
    while queue:
        y, x = queue.popleft()
        if seen[y][x] or pixels[x, y][3] >= 224:
            continue
        seen[y][x] = True
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and not seen[ny][nx]:
                queue.append((ny, nx))
    for y in range(height):
        for x in range(width):
            if seen[y][x]:
                r, g, b, _ = pixels[x, y]
                pixels[x, y] = (r, g, b, 0)
    return rgba


def resized(image: Image.Image) -> Image.Image:
    if image.width == GLYPH_SIZE:
        return image
    return image.resize((GLYPH_SIZE, round(image.height * GLYPH_SIZE / image.width)), Image.Resampling.LANCZOS)


def trim_banner(part: Image.Image) -> Image.Image:
    """A house picture cropped to its opaque pixels and scaled down to HOUSE_HEIGHT."""
    box = part.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box is None:
        raise ValueError("banner area is empty")
    part = part.crop(box)
    scale = min(1.0, HOUSE_HEIGHT / part.height)
    return part.resize((max(1, round(part.width * scale)), round(part.height * scale)), Image.Resampling.LANCZOS)


class Index:
    """data/icons.json: name -> output path."""

    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.icons: dict[str, dict] = {}

    def add(self, name: str, rel: str, image: Image.Image, source: str) -> None:
        self.ctx.out.image(rel, image, source=source)
        if name in {"items/sword", "items/shield", "items/potion", "magic/black", "magic/white"}:
            self.icons[name] = {"path": rel}


def box(x: int, y: int) -> tuple[int, int, int, int]:
    return x, y, x + WEAPON_TILE, y + WEAPON_TILE


def cut_weapons(index: Index, tex0: Image.Image) -> None:
    for name, (x, y) in WEAPONS.items():
        rect = box(x, y)
        source = f"DATA {ICONS} texture 0 rect {rect}"
        tile = tex0.crop(rect)
        index.add(f"weapons/{name}", f"images/icons/weapons/{name}.png", resized(glyph(tile)), source)
    for name, rect in SKILLS.items():
        image = skill_glyph(tex0.crop(rect))
        if image is None:
            index.ctx.skip(f"skill icon {name}: no visible glyph at {rect}")
            continue
        source = f"DATA {ICONS} texture 0 rect {rect}"
        index.add(f"skills/{name}", f"images/icons/skills/{name}.png", resized(image), source)
    rect = EQUIP_MARK
    index.add("equip-mark", "images/icons/equip-mark.png", tex0.crop(rect), f"DATA {ICONS} texture 0 rect {rect}")


def cut_tiles(index: Index, tex2: Image.Image) -> None:
    """The 94 px tiles of 6026 texture 2 that are shown at 48 px: items, combat arts, magic schools."""

    def tile(name: str, rel: str, rect: tuple[int, int, int, int]) -> None:
        image = strip_low_alpha_edges(tex2.crop(rect).resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS))
        index.add(name, rel, image, f"DATA {ICONS} texture 2 rect {rect}")

    for name, (row, col) in ITEM_TILES.items():
        file = name.removeprefix("item/")
        tile(f"items/{file}", f"images/icons/items/{file}.png", box(1 + 100 * col, 33 + 100 * row))
    for name, (x, y) in COMBAT_ARTS.items():
        tile(f"combat-arts/{name}", f"images/icons/combat-arts/{name}.png", box(x, y))
    for name, (x, y) in MAGIC.items():
        tile(f"magic/{name}", f"images/icons/magic/{name}.png", box(x, y))


def cut_houses(index: Index, tex8: Image.Image, dlc: Image.Image | None) -> None:
    for name, rect in BANNERS.items():
        index.add(
            f"houses/{name}", f"images/houses/{name}.png", trim_banner(tex8.crop(rect)),
            f"DATA {ICONS} texture {HOUSE_TEXTURE} rect {rect}",
        )
    if dlc is None:
        index.ctx.skip(f"houses/ashen-wolves: {DLC_ATLAS} is not in this dump")
        return
    rect = DLC_BANNER
    index.add(
        "houses/ashen-wolves", "images/houses/ashen-wolves.png", trim_banner(dlc.crop(rect)),
        f"{DLC_ATLAS} texture {DLC_TEXTURE} rect {rect}",
    )


def extract(ctx: Context) -> None:
    archive = ctx.base
    index = Index(ctx)
    icons = archive.read(ICONS)
    cut_weapons(index, g1t.texture(icons, 0))
    cut_tiles(index, g1t.texture(icons, 2))
    dlc = None
    dlc_data = archive.resolve(DLC_ATLAS) and archive.read_file(DLC_ATLAS)
    if dlc_data:
        dlc = g1t.texture(dlc_data, DLC_TEXTURE)
    cut_houses(index, g1t.texture(icons, HOUSE_TEXTURE), dlc)

    ctx.out.json(
        "data/icons.json",
        {"icons": index.icons},
        source="icons family: atlas cuts",
    )
