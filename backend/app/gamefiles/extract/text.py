"""Names and descriptions in every language: text/<LANG>.json.

All of it is the 15,397-string table (file 2 of msgdata.bin); Person names
go through the person row's name id (u16 at +0x12 of fixed_persondata.bin section 0), so they are read here, not
from a fixed index.
"""

from __future__ import annotations

from dataclasses import dataclass
import struct

from .. import msgdata
from . import Context

TABLE = 2  # the file with names, descriptions and place names
PERSON_FILE = "fixed_persondata.bin"
PLAYABLE = tuple(range(35)) + tuple(range(1040, 1047))  # the 35 base characters and the 7 DLC characters
PERSONS = range(1201)


@dataclass(frozen=True)
class Category:
    name: str
    ids: range | tuple[int, ...]
    base: int
    via_person: bool = False  # index = base + the person row's name id, not base + id


CATEGORIES = (
    Category("character_given", PLAYABLE, 1157, True),
    Category("character_middle", range(35), 1731),
    Category("character_surname", range(35), 2305),
    Category(
        "npc_and_generic_names",
        tuple(i for i in PERSONS if i not in PLAYABLE),
        1157,
        True,
    ),
    Category("class", range(100), 3453),
    Category("class_description", range(100), 3554),
    Category("ability", range(250), 7236),
    Category("ability_description", range(250), 7536),
    Category("combat_art", range(80), 6014),
    Category("combat_art_description", range(80), 6314),
    Category("gambit", range(80), 6614),
    Category("gambit_description", range(80), 6914),
    Category("spell", range(38), 7836),
    Category("spell_description", range(38), 8136),
    Category("weapon", range(10, 510), 3746),
    Category("weapon_description", range(10, 310), 4246),
    Category("equipment", range(50), 4556),
    Category("equipment_description", range(50), 4606),
    Category("item", range(1000, 1055), 3656),
    Category("item_description", range(1000, 1055), 3856),
    Category("battalion", range(200), 9096),
    Category("battalion_description", range(200), 9297),
    Category("crest_major", range(22), 9590),
    Category("crest_minor", range(22), 9612),
    Category("crest_major_description", range(22), 9677),
    Category("crest_minor_description", range(22), 9699),
    Category("faction", range(23), 9498),
    Category("terrain", range(115), 5502),
    Category("scenario_title", range(100), 0),
    Category("battle_place", range(28), 957),
    Category("gift", range(245), 10147),
    Category("meal", range(32), 9852),
    Category("ingredient", range(96, 165), 5056),
)


def _person_name_ids(rows: list[bytes]) -> list[int]:
    return [struct.unpack_from("<H", row, 0x12)[0] for row in rows]


def _clean(strings: list[str], at: int) -> str:
    if not 0 <= at < len(strings):
        return ""
    text = msgdata.clean(strings[at])
    return "" if text in ("", "TBD") else text


def _language(strings: list[list[str]], name_ids: list[int]) -> dict[str, dict[str, str]]:
    table = strings[TABLE]
    categories: dict[str, dict[str, str]] = {}
    for category in CATEGORIES:
        found = {}
        for i in category.ids:
            index = category.base + (name_ids[i] if category.via_person else i)
            text = _clean(table, index)
            if text:
                found[str(i)] = text
        categories[category.name] = found
    categories["character_full"] = {}
    for i in range(35):
        parts = [
            categories[name].get(str(i), "") for name in ("character_given", "character_middle", "character_surname")
        ]
        full = " ".join(part for part in parts if part)
        if full:
            categories["character_full"][str(i)] = full
    del categories["character_middle"], categories["character_surname"]
    return categories


def extract(ctx: Context) -> None:
    source = msgdata.MSGDATA if ctx.base.resolve(msgdata.MSGDATA) else "DATA entry 0"
    name_ids = _person_name_ids(ctx.table(PERSON_FILE, 0))

    for language, lang in enumerate(msgdata.LANGUAGES):
        strings = ctx.text(language)
        data = {"categories": _language(strings, name_ids)}
        ctx.out.json(f"text/{lang}.json", data, source=f"{source} language {language} ({lang}), file {TABLE}")
    ctx.log(f"  text: {len(msgdata.LANGUAGES)} languages, {len(data['categories'])} categories")
