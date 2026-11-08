"""The map family of the game-file importer: synthetic inputs, plus a run on a real dump when one is given."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct
from types import SimpleNamespace

from PIL import Image, ImageDraw
import pytest

from app.gamefiles.extract import map as maps
from app.gamefiles.output import Output
from test_gamefiles_core import chunked, make_g1t


def grid(tiles: dict[tuple[int, int], int]) -> bytes:
    body = bytearray(maps.GRID * maps.GRID * 2)
    for (x, y), terrain in tiles.items():
        body[(y * maps.GRID + x) * 2] = terrain
        body[(y * maps.GRID + x) * 2 + 1] = 0xEE
    return bytes(8) + bytes(body)


def test_decode_grid_crops_to_the_map():
    first, second = maps.decode_grid(grid({(0, 0): 2, (2, 0): 3, (1, 1): 4}))
    assert first == [[2, 0, 3], [0, 4, 0]]
    assert second == [[0xEE, 0, 0xEE], [0, 0xEE, 0]]


def test_decode_grid_rejects_other_data():
    assert maps.decode_grid(b"short") is None
    assert maps.decode_grid(grid({})) is None  # all impassable
    assert maps.decode_grid(grid({(0, 0): maps.TERRAIN_IDS})) is None  # not a terrain id


def test_character_sprite_slots():
    # Checked against the sprites fedatamine.com shows for each character: Seteth is 4 slots at 4 x ID; Flayn to
    # Jeralt have two looks of four from slot 112; Rhea and Sothis follow with one look each.
    slots = {0: 0, 1: 4, 2: 8, 25: 100, 26: 104, 27: 112, 28: 120, 33: 160, 34: 168, 35: 176, 36: 184, 37: 188}
    assert {c: maps.character_slot(c) for c in slots} == slots
    assert maps.character_slot(maps.CHARACTERS - 1) == 188
    assert maps.HEADED_CHARACTERS == 35  # Jeralt, Rhea and Sothis have no head slot of their own


def test_hex_rows():
    assert maps.hex_rows([[0, 10, 255], [1, 2, 3]]) == ["000aff", "010203"]


def test_headless_clears_only_the_head_pixels():
    sprite = Image.new("RGBA", (32, 32), (10, 20, 30, 255))
    head = Image.new("RGBA", (20, 20))
    head.putpixel((0, 0), (1, 2, 3, 255))
    out = maps.headless(sprite, head)
    assert out.getpixel((maps.HEAD_X, maps.HEAD_Y)) == (0, 0, 0, 0)
    assert out.getpixel((maps.HEAD_X + 1, maps.HEAD_Y)) == (10, 20, 30, 255)
    assert sprite.getpixel((maps.HEAD_X, maps.HEAD_Y)) == (10, 20, 30, 255)


class FakeContext:
    def __init__(self, tmp_path: Path, rows: list[bytes], names: list[str]):
        self.out = Output(tmp_path)
        self.rows, self.names = rows, names
        self.skipped: list[str] = []

    def table(self, name: str, section: int) -> list[bytes]:
        return self.rows

    def text(self) -> list[list[str]]:
        return [[], [], self.names]

    def skip(self, what: str) -> None:
        self.skipped.append(what)


def stage_row(defense: int, res: int, avo: int, heal: int, wall_hp: int, move: int) -> bytes:
    return bytes(4) + struct.pack("<bbbbBBb", defense, res, avo, heal, wall_hp, 0, move) + bytes(3)


def test_terrain_effects_and_names(tmp_path):
    # Hand-built records model distinct terrain types instead of combining wall HP,
    # poison damage, and a movement restriction on a single made-up tile.
    rows = [stage_row(0, 0, 0, 0, 0, 0)] * 81
    names = [""] * (maps.TERRAIN_NAME + len(rows))
    for tile_id, name, row in (
        (0, "Impassable", stage_row(0, 0, 0, 0, 0, 0)),
        (2, "Plain  ", stage_row(0, 0, 0, 0, 0, 2)),
        (3, "Forest", stage_row(1, 0, 30, 0, 0, 3)),
        (6, "River", stage_row(0, 0, 0, 0, 0, 1)),
        (38, "Breakable Wall", stage_row(0, 0, 0, 0, 20, 0)),
        (39, "Snow", stage_row(0, 0, -20, 0, 0, 6)),
        (80, "Poison", stage_row(0, 0, 0, -10, 0, 9)),
    ):
        names[maps.TERRAIN_NAME + tile_id] = name
        rows[tile_id] = row
    ctx = FakeContext(tmp_path, rows, names)
    maps.terrain(ctx)
    tiles = json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]
    assert tiles["0"]["enter"] == "none" and tiles["2"]["enter"] == "all" and tiles["6"]["enter"] == "fliers"
    assert tiles["2"]["name"] == "Plain"
    assert tiles["3"] == {
        "name": "Forest", "avo": 30, "def": 1, "res": 0, "heal": 0, "wall_hp": 0, "enter": "all",
        "move_name": "Forest",
    }
    assert tiles["38"]["enter"] == "none" and tiles["38"]["wall_hp"] == 20
    assert tiles["39"]["avo"] == -20 and tiles["80"]["heal"] == -10


def test_terrain_ids_are_capped(tmp_path):
    ctx = FakeContext(tmp_path, [stage_row(0, 0, 0, 0, 0, 2)] * 128, [])
    maps.terrain(ctx)
    assert len(json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]) == maps.TERRAIN_IDS


def test_minimap_tables_are_consistent():
    assert maps.MINIMAP_PIECES[276] == "weapon-crest-stone"
    assert set(maps.MINIMAP_VARIANTS).isdisjoint({38, 39, 40, 41})
    assert set(maps.MINIMAP_INDEX.values()).isdisjoint(maps.MINIMAP_VARIANTS.values())
    assert set(maps.TERRAIN_TILES) <= set(maps.MINIMAP_PIECES.values())


def minimap_pack(images: dict[int, Image.Image]) -> bytes:
    """Build a still-image pack with generated pixels and empty unused slots."""
    count = max(images) + 1
    index = bytearray(struct.pack("<I", count))
    contents = bytearray()
    for slot in range(count):
        item = chunked(make_g1t(images[slot]), 0x4000) if slot in images else b""
        index.extend(struct.pack("<II", 4 + 8 * count + len(contents), len(item)))
        contents.extend(item)
    return bytes(index + contents)


def test_minimap_import_crops_native_cells_and_selects_the_matching_map_state(tmp_path, monkeypatch):
    # Use made-up artwork with the game's geometry: 32 px atlas swatches, 24 px map cells,
    # a transparent bare grid, and a bridge whose tile changes between the two map states.
    forest, water, bare, border = (30, 125, 50, 255), (20, 80, 215, 255), (0, 0, 0, 0), (90, 85, 80, 100)
    atlas = Image.new("RGBA", (128, 64))
    atlas.paste(forest, (0, 0, 32, 32))
    atlas.paste(water, (32, 0, 64, 32))
    atlas.paste(border, (66, 2, 90, 26))
    rects = [maps.rects.Rect(128, 64, 10, sprite, x, 0, width, height)
             for sprite, x, width, height in [(203, 0, 32, 32), (209, 32, 32, 32), (220, 64, 56, 48)]]

    def picture(cells):
        image = Image.new("RGBA", (256, 128))
        draw = ImageDraw.Draw(image)
        draw.rectangle((71, 71, 144, 120), outline=border)
        for y, row in enumerate(cells):
            for x, color in enumerate(row):
                left, top = 72 + x * 24, 72 + y * 24
                draw.rectangle((left, top, left + 23, top + 23), outline=border, fill=color)
        return image

    reference = picture([[forest, water, bare], [bare, water, bare]])
    raised = picture([[forest, water, bare], [bare, water, forest]])
    lowered = picture([[forest, water, bare], [bare, bare, forest]])
    pack = minimap_pack({0: reference, 7: raised, 37: lowered})
    decode_texture = maps.g1t.texture
    monkeypatch.setattr(maps.rects, "battle_ui", lambda _: rects)
    monkeypatch.setattr(maps.g1t, "texture", lambda data, n: atlas if data == b"test atlas" and n == 10
                        else decode_texture(data, n))
    inputs = {maps.BATTLE_UI: b"test atlas", maps.MINIMAPS_ENTRY: pack}
    ctx = SimpleNamespace(main=object(), out=Output(tmp_path), skip=lambda _: None,
                          base=SimpleNamespace(resolve=lambda _: None, read=inputs.__getitem__))

    maps.minimaps(ctx, {0: [[3, 6, 2], [2, 6, 10]], 7: [[3, 6, 2], [2, 10, 3]]})

    index = json.loads((tmp_path / "data/minimap-terrain.json").read_text("utf-8"))
    assert index == {"cell": 24, "maps": [0, 7], "tiles": {"2": None, "3": "tile-forest", "6": "tile-water", "10": None}}
    with Image.open(tmp_path / "images/map/minimaps/7.png") as image:
        assert image.size == (74, 50)
        assert image.getpixel((0, 0)) == border
        assert image.getpixel((37, 13)) == water
        assert image.getpixel((37, 37)) == bare  # the lowered bridge uses the grid, not the water swatch
    with Image.open(tmp_path / "images/map/minimap-pieces/grid.png") as image:
        assert image.size == (24, 24)
        assert image.getpixel((0, 0)) == border
    with Image.open(tmp_path / "images/map/minimap-pieces/tile-forest.png") as image:
        assert image.size == (32, 32)
        assert image.getpixel((16, 16)) == forest


DUMP = os.environ.get("DIVINE_PULSE_GAME_DUMP")


@pytest.mark.skipif(not DUMP, reason="DIVINE_PULSE_GAME_DUMP is not set")
def test_map_family_on_a_real_dump(tmp_path):
    from app.gamefiles import dump
    from app.gamefiles.extract import Context, run

    ctx = Context(dump=dump.find(Path(DUMP)), out=Output(tmp_path), log=lambda _: None)
    run(ctx, ["map"])
    files = ctx.out.files

    def count(prefix: str) -> int:
        return sum(1 for rel in files if rel.startswith(prefix))

    expected = 41 if "cindered_shadows" in ctx.dump.dlc else 37  # that DLC adds four maps
    grids = json.loads((tmp_path / "data" / "maps.json").read_text("utf-8"))["maps"]
    assert len(grids) == expected
    assert len(json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]) == maps.TERRAIN_IDS
    assert count("images/map/minimaps/") == expected
    assert count("images/map/minimap-pieces/") == len(maps.MINIMAP_PIECES)
    index = json.loads((tmp_path / "data/minimap-terrain.json").read_text("utf-8"))
    assert set(map(str, index["maps"])) == set(grids)
    assert index["cell"] == 24
    assert {key: index["tiles"][key] for key in ("2", "3", "6", "10")} == {
        "2": None, "3": "tile-forest", "6": "tile-water", "10": None,
    }
    for map_id, rows in grids.items():
        width, height = max(len(bytes.fromhex(row)) for row in rows), len(rows)
        with Image.open(tmp_path / f"images/map/minimaps/{map_id}.png") as image:
            assert image.size == (24 * width + 2, 24 * height + 2)
            assert image.getbbox() is not None, f"map {map_id} is blank"
    for name, size in {"range-cell": (24, 24), "range-grid": (218, 146), "range-chevron": (96, 96),
                       "range-player": (64, 64), "range-enemy": (64, 64),
                       "grid": (24, 24), "tile-forest": (32, 32), "tile-water": (32, 32)}.items():
        with Image.open(tmp_path / "images/map/minimap-pieces" / f"{name}.png") as image:
            assert image.size == size
            assert image.getbbox() is not None, f"{name} is blank"
    # The documented FE3H 1.2.0 swatches must survive extraction pixel for pixel.
    # The expected pixels come from this local dump, never from a checked-in image.
    atlas = maps.g1t.texture(ctx.base.read(maps.BATTLE_UI), maps.MINIMAP_TEXTURE)
    for name, box in {"tile-forest": (992, 36, 1024, 68), "tile-water": (600, 384, 632, 416)}.items():
        with Image.open(tmp_path / "images/map/minimap-pieces" / f"{name}.png") as image:
            assert image.tobytes() == atlas.crop(box).tobytes(), name
    assert {"images/map/class-sprites.png", "images/map/map-heads.png", "data/class-sprites.json"} <= set(files)
    sprites = json.loads((tmp_path / "data/class-sprites.json").read_text("utf-8"))
    assert set(sprites["characters"]) == {str(c) for c in range(maps.CHARACTERS)}
    assert set(sprites["heads"]["characters"]) == {str(c) for c in range(maps.HEADED_CHARACTERS)}
    # Each character's finished sprite is the one at its slot, whatever order the rows are in.
    rows = json.loads((tmp_path / "data/class-sprites.json").read_text("utf-8"))
    atlas_h = rows["cell"][1]
    slots = maps.rects.map_sprites(ctx.main)
    textures = [maps.g1t.texture(ctx.base.read(maps.SPRITES), n) for n in range(4)]
    with Image.open(tmp_path / "images/map/class-sprites.png") as atlas:
        for character in (28, 34, 35, 36, 37):
            rect = slots[maps.character_slot(character)]
            expected = textures[rect.texture].crop(rect.box)
            row = sprites["characters"][str(character)]
            cell = atlas.crop((0, row * atlas_h + maps.SPRITE_TOP, maps.SPRITE_SIZE, row * atlas_h + atlas_h))
            assert cell.tobytes() == expected.tobytes(), character
