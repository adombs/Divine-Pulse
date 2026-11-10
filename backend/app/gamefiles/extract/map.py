"""Battle maps: terrain grids, terrain effects, map sprites (class bodies, heads) and the minimaps.

The sprite rectangles come from the user's main executable (rects.map_sprites / rects.battle_ui), not from files
in the repo; the labels of the minimap atlas sprites are the table below.

Writes data/maps.json, data/terrain.json, data/class-sprites.json, data/minimap-terrain.json, images/map/class-sprites.png,
images/map/map-heads.png, images/map/minimap-pieces/<name>.png and images/map/minimaps/<map id>.png.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import struct

from PIL import Image

from .. import g1t, rects
from ..archive import Archive, pack_items, unchunk
from . import Context

BATTLE_UI, SPRITES, MINIMAPS_ENTRY = 6050, 6109, 6122
MINIMAPS_FILE = Path("nx") / "ui" / "still" / "minimap.bin"

# Terrain grids: entries 365 + map id of the archive (8-byte header, 32 x 32 tiles of terrain id + second id).
GRID, HEADER, GRID_BYTES = 32, 8, 8 + 32 * 32 * 2
TERRAIN_IDS = 115
FIRST_TERRAIN_ENTRY, MAX_MAPS = 365, 256
CINDERED_FIRST_MAP = 38  # the Cindered Shadows grids, in order, are maps 38-41
TERRAIN_NAME = 5502  # F2[5502 + terrain id]
SCENARIO_FILE, SCENARIO_MAP_BYTE = "fixed_scenario.bin", 32  # each scenario row's map id (checked against recorded battles)
MOVE_GROUPS = {
    0: "Impassable", 1: "Fliers only", 2: "Normal", 3: "Forest", 4: "Sand", 5: "Thicket", 6: "Shoal / snow",
    9: "Swamp / flames / crater", 10: "Special", 11: "Stairs", 12: "Wasteland",
}

# Minimap atlas (battle UI texture 10): sprite id -> file name. The ids are the battle UI table's (201-280).
MINIMAP_TEXTURE = 10
MINIMAP_PIECES = {
    201: "tile-heal", 202: "tile-impassable", 203: "tile-forest", 204: "tile-thicket", 205: "tile-sand",
    206: "tile-fliers", 207: "tile-hazard", 208: "tile-shoal", 209: "tile-water", 210: "tile-floor",
    211: "tile-siege", 212: "tile-cover", 216: "range-cell", 220: "grid", 221: "range-grid",
    223: "range-chevron", 224: "badge-player", 225: "badge-enemy", 226: "badge-ally",
    228: "range-player", 229: "range-enemy",
    227: "badge-third", 241: "cursor", 242: "cursor-target", 252: "door", 253: "lever", 254: "crest-stone",
    255: "trap", 256: "chest", 257: "chest-open", 258: "wall", 259: "warp", 268: "weapon-sword",
    269: "weapon-lance", 270: "weapon-axe", 271: "weapon-bow", 272: "weapon-gauntlets", 273: "weapon-faith",
    274: "weapon-reason", 275: "weapon-dark", 276: "weapon-crest-stone",
}
GRID_SPRITE, GRID_CELL = 220, (2, 2, 26, 26)  # the grid piece is one 24 px cell of the range panel's grid
TERRAIN_TILES = (
    "tile-heal", "tile-impassable", "tile-forest", "tile-thicket", "tile-sand", "tile-fliers", "tile-hazard",
    "tile-shoal", "tile-water", "tile-floor", "tile-siege", "tile-cover",
)
# Per-map minimap images: map n is image n (0-36), maps 38-41 are images 44-47, and images 37-43 are other states of
# maps 7, 13, 14, 21, 22, 6 and 18 (the one that matches the terrain grid is kept).
MINIMAP_INDEX = {**{m: m for m in range(37)}, 38: 44, 39: 45, 40: 46, 41: 47}
MINIMAP_VARIANTS = {7: 37, 13: 38, 14: 39, 21: 40, 22: 41, 6: 42, 18: 43}
MAP_CELL, MAP_ORIGIN = 24, 72
SWATCH_DISTANCE = 60

# Map sprites. A slot is one 32 x 32 (heads 20 x 20) picture; each part comes in four army colours in a row.
ARMIES = (("player", 0), ("enemy", 2), ("ally", 1), ("third", 3))
FIRST_SPRITE, LAST_SPRITE, BODY_SLOT = 100, 177, 309  # sprite ids 100-177: slot 4 x id + 309 + colour
MOUNTED = (116, 117, 135, 136, 137, 138, 139, 150, 151, 152, 155, 156, 157, 158, 159, 160, 161, 162)
MOUNT_SLOT = 1395
GENERIC_HEADS = {"m": 1348, "f": 1360}
# Finished character sprites, by character ID. Byleth to Seteth (0-26) take four slots each (an army colour per slot) at
# 4 x ID. Flayn (27) to Jeralt (35) take eight (two looks) from slot 112, the slots before it being unused; Rhea (36)
# and Sothis (37) follow with four each. Only 0-34 have a head of their own (slot 1021 + ID): Jeralt, Rhea and Sothis
# are finished sprites with the head in them. Matched pixel for pixel against the sprites fedatamine.com shows.
CHARACTER_HEAD, CHARACTERS, HEADED_CHARACTERS = 1021, 38, 35
FIRST_EIGHT_SLOT_CHARACTER, EIGHT_SLOT_START = 27, 112
LAST_EIGHT_SLOT_CHARACTER = 35
RHEA_SLOT = EIGHT_SLOT_START + 8 * (LAST_EIGHT_SLOT_CHARACTER - FIRST_EIGHT_SLOT_CHARACTER + 1)  # 184; Sothis is 188


def character_slot(character: int) -> int:
    """First map sprite slot (the player's colour) of a character's finished sprite."""
    if character < FIRST_EIGHT_SLOT_CHARACTER:
        return 4 * character
    if character <= LAST_EIGHT_SLOT_CHARACTER:
        return EIGHT_SLOT_START + 8 * (character - FIRST_EIGHT_SLOT_CHARACTER)
    return RHEA_SLOT + 4 * (character - LAST_EIGHT_SLOT_CHARACTER - 1)


# Byleth's green-haired look (after the Sothis merge): finished sprite slot (+ colour) and head slot, by character ID
# (0 male, 1 female). Matched pixel for pixel: the head is the one drawn inside the finished sprite.
GREEN_BYLETH = {0: (233, 1368), 1: (249, 1369)}
HEAD_X, HEAD_Y, MOUNTED_HEAD_Y, HEAD_SIZE = 6, 2, -4, 20
SPRITE_SIZE, SPRITE_TOP = 32, 6
# Generic Noble (0) and Commoner (1) units wear a character's finished sprite with the head taken off.
GENERIC_BODIES = {0: {"m": 6, "f": 23}, 1: {"m": 20, "f": 25}}
FINISHED_CLASSES = {42: {"m": 668, "f": 672}, 44: {"m": 680}, 17: {"m": 684}}


def decode_grid(data: bytes) -> tuple[list[list[int]], list[list[int]]] | None:
    """Terrain ids and second ids of a grid, cropped to the map's real size; None if it is not a terrain grid."""
    if len(data) < GRID_BYTES:
        return None
    body = data[HEADER:GRID_BYTES]
    first, second = body[0::2], body[1::2]
    if max(first) >= TERRAIN_IDS:
        return None
    used = [(x, y) for y in range(GRID) for x in range(GRID) if first[y * GRID + x]]
    if not used:
        return None
    w, h = max(x for x, _ in used) + 1, max(y for _, y in used) + 1
    return [list(first[y * GRID : y * GRID + w]) for y in range(h)], [list(second[y * GRID : y * GRID + w]) for y in range(h)]


def archive_grids(archive: Archive) -> dict[int, list[list[int]]]:
    """The terrain grids of one archive by map id (entry - 365)."""
    found = {}
    for map_id in range(MAX_MAPS):
        entry = FIRST_TERRAIN_ENTRY + map_id
        if entry >= archive.count:
            break
        _, size, _, compressed = archive.entry_info(entry)
        if compressed or size != GRID_BYTES:
            continue
        decoded = decode_grid(archive.read(entry, patched=False))
        if decoded is not None:
            found[map_id] = decoded[0]
    return found


def hex_rows(grid: list[list[int]]) -> list[str]:
    return ["".join(f"{t:02x}" for t in row) for row in grid]


def maps(ctx: Context) -> dict[int, list[list[int]]]:
    grids = dict(archive_grids(ctx.base))
    dlc = ctx.dlc("cindered_shadows")
    if dlc is None:
        ctx.skip("Cindered Shadows DLC not found: maps 38-41 left out")
    else:
        for n, (_, grid) in enumerate(sorted(archive_grids(dlc).items())):
            grids.setdefault(CINDERED_FIRST_MAP + n, grid)
    grids = dict(sorted(grids.items()))
    ctx.out.json(
        "data/maps.json",
        {"maps": {str(m): hex_rows(g) for m, g in grids.items()}, "scenarios": scenario_maps(ctx, grids)},
        source=f"DATA {FIRST_TERRAIN_ENTRY} + map id (maps 38-41: Cindered Shadows DATA 465-468); "
        f"nx/data/{SCENARIO_FILE} section 0 byte {SCENARIO_MAP_BYTE} (scenarios)",
    )
    return grids


def scenario_maps(ctx: Context, grids: dict[int, list[list[int]]]) -> dict[str, int]:
    """Scenario id -> the map it is fought on (fixed_scenario.bin section 0, byte 32), for maps that have a grid.
    The game's in-memory map value can read 0 for a battle, so the scenario is the reliable way to the map."""
    try:
        rows = ctx.table(SCENARIO_FILE, 0)
    except FileNotFoundError:
        ctx.skip(f"{SCENARIO_FILE} not found: no scenario -> map table")
        return {}
    return {
        str(scenario): row[SCENARIO_MAP_BYTE]
        for scenario, row in enumerate(rows)
        if len(row) > SCENARIO_MAP_BYTE and row[SCENARIO_MAP_BYTE] in grids
    }


def terrain(ctx: Context) -> None:
    """Terrain effects from fixed_stagedata.bin section 0 (14-byte rows: 4 unknown bytes, Def, Res, Avoid, Heal %,
    wall HP, unused, movement group, flags)."""
    try:
        rows = ctx.table("fixed_stagedata.bin", 0)
    except FileNotFoundError:
        ctx.skip("fixed_stagedata.bin not found: no terrain.json")
        return
    names = ctx.text()[2]
    tiles = {}
    for terrain_id, row in enumerate(rows[:TERRAIN_IDS]):
        defense, res, avo, heal, wall_hp, _unused, move = struct.unpack_from("<bbbbBBb", row, 4)
        name = names[TERRAIN_NAME + terrain_id] if TERRAIN_NAME + terrain_id < len(names) else ""
        tiles[str(terrain_id)] = {
            "name": name.strip(),
            "avo": avo,
            "def": defense,
            "res": res,
            "heal": heal,
            "wall_hp": wall_hp,
            "enter": "none" if move == 0 else "fliers" if move == 1 else "all",
            "move_name": MOVE_GROUPS.get(move, "Normal"),
        }
    ctx.out.json("data/terrain.json", {"tiles": tiles}, source="nx/data/fixed_stagedata.bin section 0; text F2[5502 + id]")


def class_sprite_ids(ctx: Context) -> dict[int, dict[str, int]]:
    """Class id -> {"m"/"f": sprite id} for classes with a generic map sprite (fixed_classdata.bin: u16s at +8 / +10)."""
    out = {}
    for cls, row in enumerate(ctx.table("fixed_classdata.bin", 0)):
        male, female = struct.unpack_from("<HH", row, 8)
        ids = {g: s for g, s in (("m", male), ("f", female)) if FIRST_SPRITE <= s <= LAST_SPRITE}
        if ids:
            out[cls] = ids
    return out


def headless(sprite: Image.Image, head: Image.Image) -> Image.Image:
    """A finished sprite with the head drawn at (HEAD_X, HEAD_Y) taken off, pixel for pixel."""
    out = sprite.copy()
    mask = head.getchannel("A").point(lambda a: 255 if a else 0)
    out.paste((0, 0, 0, 0), (HEAD_X, HEAD_Y), mask)
    return out


def class_sprites(ctx: Context) -> None:
    """The map sprites in layers, as the game draws them: an atlas of bodies (a row per class sprite, mounts drawn in,
    no head) and finished character sprites, a column per army; an atlas of heads; and their index."""
    if ctx.main is None:
        ctx.skip("no ExeFS: map sprite rectangles unavailable, no class sprites or map heads")
        return
    slots = rects.map_sprites(ctx.main)
    data = ctx.base.read(SPRITES)
    textures = [g1t.texture(data, n) for n in range(4)]

    def part(slot: int) -> Image.Image | None:
        rect = slots[slot]
        if rect.empty or (rect.id == 0 and slot > 0):  # unused slots are zero-filled records (id 0, a 32 x 32 rect)
            return None
        return textures[rect.texture].crop(rect.box)

    def cell(*layers: Image.Image) -> Image.Image:
        out = Image.new("RGBA", (SPRITE_SIZE, SPRITE_SIZE + SPRITE_TOP))
        for layer in layers:
            out.alpha_composite(layer, (0, SPRITE_TOP))
        return out

    def body(sprite_id: int, colour: int) -> Image.Image | None:
        image = part(4 * sprite_id + BODY_SLOT + colour)
        if image is None or not image.getbbox():
            return None  # lords and the like are drawn per character only
        if sprite_id in MOUNTED:
            return cell(part(MOUNT_SLOT + 4 * MOUNTED.index(sprite_id) + colour), image)
        return cell(image)

    cells: list[list[Image.Image]] = []
    rows: dict[int, int] = {}
    classes: dict[str, dict[str, int]] = {}
    mounted: list[int] = []
    for cls, ids in class_sprite_ids(ctx).items():
        for gender, sprite_id in ids.items():
            if sprite_id not in rows:
                row = [body(sprite_id, c) for _, c in ARMIES]
                if row[0] is None:
                    continue
                rows[sprite_id] = len(cells)
                if sprite_id in MOUNTED:
                    mounted.append(len(cells))
                cells.append(row)
            classes.setdefault(str(cls), {})[gender] = rows[sprite_id]
    characters: dict[str, int] = {}
    for character in range(CHARACTERS):
        characters[str(character)] = len(cells)
        cells.append([cell(part(character_slot(character) + c)) for _, c in ARMIES])
    for cls, donors in GENERIC_BODIES.items():
        for gender, character in donors.items():
            classes.setdefault(str(cls), {})[gender] = len(cells)
            head = part(CHARACTER_HEAD + character)
            cells.append([cell(headless(part(character_slot(character) + c), head)) for _, c in ARMIES])
    finished: dict[str, dict[str, int]] = {}
    for cls, genders in FINISHED_CLASSES.items():
        for gender, slot in genders.items():
            finished.setdefault(str(cls), {})[gender] = len(cells)
            cells.append([cell(part(slot + c)) for _, c in ARMIES])
    green_rows: dict[str, int] = {}
    for character, (slot, _) in GREEN_BYLETH.items():
        green_rows[str(character)] = len(cells)
        cells.append([cell(part(slot + c)) for _, c in ARMIES])
    w, h = SPRITE_SIZE, SPRITE_SIZE + SPRITE_TOP
    atlas = Image.new("RGBA", (w * len(ARMIES), h * len(cells)))
    for r, row in enumerate(cells):
        for c, image in enumerate(row):
            atlas.alpha_composite(image, (c * w, r * h))

    head_slots = [GENERIC_HEADS["m"], GENERIC_HEADS["f"], *(CHARACTER_HEAD + c for c in range(HEADED_CHARACTERS))]
    green_heads = {}
    for character, (_, head_slot) in GREEN_BYLETH.items():
        green_heads[str(character)] = len(head_slots)
        head_slots.append(head_slot)
    heads = Image.new("RGBA", (HEAD_SIZE, HEAD_SIZE * len(head_slots)))
    for r, slot in enumerate(head_slots):
        heads.alpha_composite(part(slot), (0, r * HEAD_SIZE))
    source = f"DATA {SPRITES} with exefs main+{rects.MAP_SPRITES[0]:#x}"
    ctx.out.image("images/map/class-sprites.png", atlas, source=source)
    ctx.out.image("images/map/map-heads.png", heads, source=source)
    ctx.out.json(
        "data/class-sprites.json",
        {
            "cell": [w, h],
            "armies": [army for army, _ in ARMIES],
            "rows": len(cells),
            "classes": classes,
            "mounted": mounted,
            "characters": characters,
            "finished_classes": finished,
            "head_cell": [HEAD_SIZE, HEAD_SIZE],
            "head_at": [HEAD_X, SPRITE_TOP + HEAD_Y],
            "mounted_head_at": [HEAD_X, SPRITE_TOP + MOUNTED_HEAD_Y],
            "heads": {"m": 0, "f": 1, "characters": {str(c): 2 + c for c in range(HEADED_CHARACTERS)}, "rows": len(head_slots)},
            # Looks of a character that changes with the story: Byleth's green hair, by character ID.
            "looks": {"green": {"characters": green_rows, "heads": green_heads}},
        },
        source=f"{source}; nx/data/fixed_classdata.bin section 0",
    )


def minimap_atlas(ctx: Context) -> tuple[Image.Image, dict[str, tuple[int, int, int, int]]] | None:
    """Battle UI texture 10 and the rectangle of each labelled piece, writing the pieces."""
    if ctx.main is None:
        ctx.skip("no ExeFS: battle UI rectangles unavailable, no minimap pieces or minimaps")
        return None
    atlas = g1t.texture(ctx.base.read(BATTLE_UI), MINIMAP_TEXTURE)
    found = {r.id: r for r in rects.battle_ui(ctx.main) if r.texture == MINIMAP_TEXTURE}
    for sprite_id, name in MINIMAP_PIECES.items():
        rect = found.get(sprite_id)
        if rect is None or rect.empty:
            ctx.skip(f"minimap piece {name} (sprite {sprite_id}) has no rectangle")
            continue
        box = rect.box
        if sprite_id == GRID_SPRITE:
            x0, y0, x1, y1 = GRID_CELL
            box = (rect.x + x0, rect.y + y0, rect.x + x1, rect.y + y1)
        ctx.out.image(
            f"images/map/minimap-pieces/{name}.png",
            atlas.crop(box),
            source=f"DATA {BATTLE_UI} texture {MINIMAP_TEXTURE} sprite {sprite_id}",
        )
    return atlas, {name: found[sid].box for sid, name in MINIMAP_PIECES.items() if sid in found and not found[sid].empty}


def minimaps(ctx: Context, grids: dict[int, list[list[int]]]) -> None:
    """The game's minimap of each map, cropped to the map (with its grid line), and which minimap tile each terrain
    id is painted with, from matching the images against the terrain grids."""
    atlas = minimap_atlas(ctx)
    if atlas is None:
        return
    pieces, boxes = atlas
    swatch = {}
    for name in TERRAIN_TILES:
        if name in boxes:
            x, y, _, _ = boxes[name]
            swatch[name] = pieces.getpixel((x + 16, y + 16))
    path = ctx.base.resolve(MINIMAPS_FILE)
    if path is not None:
        data, origin = path.read_bytes(), f"{MINIMAPS_FILE.as_posix()} (newest patch)"
    else:
        data, origin = ctx.base.read(MINIMAPS_ENTRY), f"DATA {MINIMAPS_ENTRY}"
    items = pack_items(data)
    cache: dict[int, Image.Image] = {}

    def image(n: int) -> Image.Image:
        if n not in cache:
            cache[n] = g1t.texture(unchunk(items[n]), 0)
        return cache[n]

    def colour(img: Image.Image, x: int, y: int) -> str | None:
        """The minimap tile a map cell is painted with (None: bare grid, "?": no swatch close enough)."""
        px = img.getpixel((MAP_ORIGIN + MAP_CELL * x + MAP_CELL // 2, MAP_ORIGIN + MAP_CELL * y + MAP_CELL // 2))
        if px[3] < 40:
            return None
        name, distance = min(((n, sum(abs(a - b) for a, b in zip(c, px))) for n, c in swatch.items()), key=lambda t: t[1])
        return name if distance < SWATCH_DISTANCE else "?"

    def tally(img: Image.Image, rows: list[list[int]]) -> dict[int, Counter]:
        seen: dict[int, Counter] = defaultdict(Counter)
        for y, row in enumerate(rows):
            for x, t in enumerate(row):
                if MAP_ORIGIN + MAP_CELL * (y + 1) <= img.height and MAP_ORIGIN + MAP_CELL * (x + 1) <= img.width:
                    seen[t][colour(img, x, y)] += 1
        return seen

    # Which tile each terrain gets, from the maps with a single state; then each variant map's images scored on it.
    seen: dict[int, Counter] = defaultdict(Counter)
    for m, rows in grids.items():
        if m in MINIMAP_VARIANTS or MINIMAP_INDEX.get(m, len(items)) >= len(items):
            continue
        for t, c in tally(image(MINIMAP_INDEX[m]), rows).items():
            seen[t].update(c)
    # Ties go to a painted tile over the bare grid, then by name, so the result does not depend on map order.
    tiles = {t: min(c.items(), key=lambda kv: (-kv[1], kv[0] is None, str(kv[0])))[0] for t, c in sorted(seen.items())}

    def score(n: int, rows: list[list[int]]) -> float:
        got = tally(image(n), rows)
        hits = sum(c[tiles[t]] for t, c in got.items() if t in tiles)
        return hits / max(1, sum(sum(c.values()) for t, c in got.items() if t in tiles))

    shipped = []
    for m, rows in grids.items():
        n = MINIMAP_INDEX.get(m)
        if n is None:
            continue
        if m in MINIMAP_VARIANTS and MINIMAP_VARIANTS[m] < len(items) and score(MINIMAP_VARIANTS[m], rows) > score(n, rows):
            n = MINIMAP_VARIANTS[m]
        if n >= len(items):
            continue
        w, h = max(len(r) for r in rows), len(rows)
        crop = image(n).crop((MAP_ORIGIN - 1, MAP_ORIGIN - 1, MAP_ORIGIN + MAP_CELL * w + 1, MAP_ORIGIN + MAP_CELL * h + 1))
        ctx.out.image(f"images/map/minimaps/{m}.png", crop, source=f"{origin} image {n}")
        shipped.append(m)
    ctx.out.json(
        "data/minimap-terrain.json",
        {
            "cell": MAP_CELL,
            "maps": shipped,
            "tiles": {str(t): v for t, v in tiles.items() if v != "?"},
        },
        source=f"{origin}, matched against data/maps.json",
    )


def extract(ctx: Context) -> None:
    grids = maps(ctx)
    terrain(ctx)
    class_sprites(ctx)
    minimaps(ctx, grids)
