"""The icons family: glyph, tile and banner helpers on synthetic images; one real-dump run when a dump is given."""

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image
import pytest

from app.gamefiles import dump
from app.gamefiles.extract import Context, icons
from app.gamefiles.output import Output


def test_percentile_is_linear():
    assert icons.percentile([0.0, 10.0], 50) == 5.0
    assert icons.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 20) == pytest.approx(1.8)
    assert icons.percentile([7.0], 99) == 7.0


def test_glyph_is_white_with_the_light_part_as_alpha():
    tile = Image.new("RGBA", (10, 10), (20, 20, 20, 255))
    for x in range(3, 7):
        for y in range(3, 7):
            tile.putpixel((x, y), (250, 250, 250, 255))
    out = icons.glyph(tile)
    assert out.getpixel((0, 0)) == (255, 255, 255, 0)
    assert out.getpixel((4, 4))[3] > 200
    assert out.getpixel((4, 4))[:3] == (255, 255, 255)


def test_skill_glyph_trims_and_pads_square():
    tile = Image.new("RGBA", (40, 40), (20, 20, 20, 255))
    for x in range(10, 20):
        for y in range(5, 25):
            tile.putpixel((x, y), (250, 250, 250, 255))
    out = icons.skill_glyph(tile)
    assert out is not None and out.width == out.height == 20 + 8
    assert icons.skill_glyph(Image.new("RGBA", (8, 8), (0, 0, 0, 0))) is None


def test_strip_low_alpha_edges_keeps_interior_antialiasing():
    tile = Image.new("RGBA", (7, 7), (9, 9, 9, 100))  # a faint fringe all around
    for x in range(2, 5):
        for y in range(2, 5):
            tile.putpixel((x, y), (200, 0, 0, 255))
    tile.putpixel((3, 3), (200, 0, 0, 100))  # faint but enclosed: stays
    out = icons.strip_low_alpha_edges(tile)
    assert out.getpixel((0, 0)) == (9, 9, 9, 0)
    assert out.getpixel((1, 1))[3] == 0
    assert out.getpixel((3, 3)) == (200, 0, 0, 100)
    assert out.getpixel((2, 2)) == (200, 0, 0, 255)


def test_trim_banner_crops_opaque_pixels_and_limits_height():
    part = Image.new("RGBA", (100, 500), (0, 0, 0, 0))
    for x in range(10, 60):
        for y in range(20, 420):
            part.putpixel((x, y), (255, 0, 0, 255))
    out = icons.trim_banner(part)
    assert out.height == icons.HOUSE_HEIGHT and out.width == round(50 * icons.HOUSE_HEIGHT / 400)
    small = Image.new("RGBA", (30, 30), (0, 0, 0, 0))
    small.putpixel((5, 5), (255, 255, 255, 255))
    assert icons.trim_banner(small).size == (1, 1)
    with pytest.raises(ValueError):
        icons.trim_banner(Image.new("RGBA", (4, 4)))


@pytest.mark.skipif(not os.environ.get("DIVINE_PULSE_GAME_DUMP"), reason="DIVINE_PULSE_GAME_DUMP is not set")
def test_icons_family_on_a_real_dump(tmp_path):
    ctx = Context(dump.find(Path(os.environ["DIVINE_PULSE_GAME_DUMP"])), Output(tmp_path), log=lambda text: None)
    icons.extract(ctx)
    files = ctx.out.files

    def count(prefix: str, suffix: str = ".png") -> int:
        return sum(1 for rel in files if rel.startswith(prefix) and rel.endswith(suffix))

    assert count("images/icons/weapons/") == 7
    assert count("images/icons/skills/") == 4
    assert count("images/icons/items/") == 3
    assert count("images/icons/combat-arts/") == 6
    assert count("images/icons/magic/") == 2
    assert count("images/houses/") == 13
    assert "images/icons/equip-mark.png" in files
    index = json.loads((tmp_path / "data/icons.json").read_text(encoding="utf-8"))
    assert index["icons"]["magic/white"]["path"] == "images/icons/magic/white.png"
