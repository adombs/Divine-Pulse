"""The map family of the game-file importer: synthetic inputs, plus a run on a real dump when one is given."""

from __future__ import annotations

import json
import os
from pathlib import Path
import struct

from PIL import Image
import pytest

from app.gamefiles.extract import map as maps
from app.gamefiles.output import Output


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
    names = [""] * maps.TERRAIN_NAME + ["Impassable", "Plain  ", "Sky"]
    rows = [stage_row(0, 0, 0, 0, 0, 0), stage_row(0, 0, 0, 0, 0, 2), stage_row(-1, 2, 20, -10, 5, 1)]
    ctx = FakeContext(tmp_path, rows, names)
    maps.terrain(ctx)
    tiles = json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]
    assert tiles["0"]["enter"] == "none" and tiles["1"]["enter"] == "all" and tiles["2"]["enter"] == "fliers"
    assert tiles["1"]["name"] == "Plain"
    assert tiles["2"] | {"name": ""} == {
        "name": "", "avo": 20, "def": -1, "res": 2, "heal": -10, "wall_hp": 5, "enter": "fliers",
        "move_name": "Fliers only",
    }


def test_terrain_ids_are_capped(tmp_path):
    ctx = FakeContext(tmp_path, [stage_row(0, 0, 0, 0, 0, 2)] * 128, [])
    maps.terrain(ctx)
    assert len(json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]) == maps.TERRAIN_IDS


def test_minimap_tables_are_consistent():
    assert set(maps.MINIMAP_VARIANTS).isdisjoint({38, 39, 40, 41})
    assert set(maps.MINIMAP_INDEX.values()).isdisjoint(maps.MINIMAP_VARIANTS.values())
    assert set(maps.TERRAIN_TILES) <= set(maps.MINIMAP_PIECES.values())


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
    assert len(json.loads((tmp_path / "data" / "maps.json").read_text("utf-8"))["maps"]) == expected
    assert len(json.loads((tmp_path / "data" / "terrain.json").read_text("utf-8"))["tiles"]) == maps.TERRAIN_IDS
    assert count("images/map/minimaps/") == expected
    assert count("images/map/minimap-pieces/") == len(maps.MINIMAP_PIECES)
    assert {"images/map/class-sprites.png", "images/map/map-heads.png", "data/class-sprites.json"} <= set(files)
