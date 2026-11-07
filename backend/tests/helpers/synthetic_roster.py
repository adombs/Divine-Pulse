"""A made-up army: roster memory bytes in the layout the reader parses, and the tables that name it.

The values are invented. The layout (slot size, field offsets) comes from app.gamemem.fe3h, and the character, class,
ability and item IDs are chosen to fall in the ranges the reader treats specially (equipment 600-649, items 1000+,
mounted classes, upgraded personal abilities...).
"""

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

from app.gamemem import fe3h

KEYS = ("hp", "mv", "str", "mag", "dex", "spd", "lck", "def", "res", "cha")

ABILITIES = {
    1: "Strength +2", 2: "Close Counter", 3: "HP +5", 4: "Bow Prowess Lv 1", 5: "Bow Prowess Lv 3",
    6: "Dexterity +4", 7: "Speed +2", 8: "Magic +2", 9: "Authority Lv 1", 10: "Sword Prowess Lv 3",
    11: "Reason Lv 4", 12: "Faith Lv 3", 13: "Movement +1", 14: "Rivalry", 15: "Keen Lineage",
    16: "Keen Lineage+", 17: "Sword Prowess Lv 1", 18: "Steady Hands", 19: "Lance Prowess Lv 2",
    20: "Lance Prowess Lv 3", 21: "Swordbreaker", 107: "Rally Speed",
}
PERSONAL = {0: 18, 4: 15, 25: 14}
PERSONAL_UPGRADED = {4: 16}
ARTS = {
    1: "Wrath Strike", 2: "Grounder", 3: "Hexblade", 7: "Curved Shot", 30: "Monster Blast", 38: "Break Shot", 50: "Swap",
    53: "Draw Back",
}
WEAPONS = {
    16: ("Iron Sword", 40), 21: ("Training Sword", 40), 22: ("Iron Lance", 40), 44: ("Iron Axe", 35), 72: ("Iron Bow", 45),
    34: ("Iron Staff", 20), 146: ("Iron Bow+", 50), 17: ("Twin Sword", 30),
}
# What differs from a plain sword: skill (0 sword, 1 lance, 2 axe, 3 bow, 6 faith), range, flags (0x20 strikes twice),
# and the weapon's effectiveness bits (8: against fliers).
WEAPON_TRAITS = {
    16: {}, 21: {}, 22: {"skill": 1}, 44: {"skill": 2}, 34: {"skill": 6}, 17: {"flags": 0x20},
    72: {"skill": 3, "min_range": 2, "max_range": 2, "effective": 8},
    146: {"skill": 3, "min_range": 2, "max_range": 2, "effective": 8},
}
TYPES = {10: {"cavalry": True}, 32: {"flying": True}}
SPELLS = {
    0: ("Fire", 10), 2: ("Thunder", 12), 4: ("Thoron", 4), 9: ("Recover", 10), 11: ("Wind", 10), 14: ("Miasma", 6),
    24: ("Heal", 8), 36: ("Rescue", 5),
}
SPELL_SKILLS = {0: 5, 2: 5, 4: 5, 9: 6, 11: 5, 14: 7, 24: 6, 36: 6}
EQUIPMENT = {2: "Steel Shield", 12: "Speed Ring", 16: "March Ring"}
ITEMS = {1000: "Vulnerary", 1002: "Elixir"}
BATTALIONS = {0: "Test Soldiers", 3: "Test Monks", 4: "Test Magic Corps", 5: "Test Wing Co."}
# Made-up level 1-5 modifiers for battalions whose import has a progression (the others are like an older import).
BATTALION_LEVELS = {
    5: [{"phys_atk": 2 + n // 2, "avo": 1 + n, "prt": n // 2, "rsl": 3 + n // 2, "cha": 5} for n in range(5)],
}
# Names of the other characters of the roster: given, full, gender (0 male, 1 female)
CHARACTERS = {
    0: ("Byleth", "Byleth", 0), 4: ("Claude", "Claude von Test", 0), 19: ("Lorenz", "Lorenz Test", 0),
    20: ("Raphael", "Raphael Test", 0), 21: ("Ignatz", "Ignatz Test", 0), 22: ("Lysithea", "Lysithea Test", 1),
    23: ("Marianne", "Marianne Test", 1), 24: ("Hilda", "Hilda Test", 1), 25: ("Leonie", "Leonie Test", 1),
    26: ("Seteth", "Seteth Test", 0), 27: ("Flayn", "Flayn", 1), 28: ("Hanneman", "Hanneman Test", 0),
    29: ("Manuela", "Manuela Test", 1), 32: ("Gilbert", "Gilbert Test", 0), 33: ("Alois", "Alois Test", 0),
    34: ("Cyril", "Cyril Test", 0), 900: ("Dancer", "Dancer", 1),
}
GENERIC = {114: "Bandit", 508: "Bandit Leader", 509: "Bandit", 510: "Thief", 35: "Jeralt", 39: "Solon",
           42: "Death Knight", 55: "Tomas", 198: "Breakable Wall"}
# id -> (name, boosts, mounted, female name)
CLASSES = {
    0: ("Noble", {}, {}, None), 1: ("Commoner", {}, {}, None), 3: ("Soldier", {}, {}, None),
    4: ("Fighter", {"str": 1, "def": 1}, {}, None), 5: ("Monk", {"res": 2}, {}, None),
    7: ("Mercenary", {"hp": 1, "str": 1, "spd": 1}, {}, None),
    10: ("Cavalier", {"str": 1, "def": 1}, {"mv": 3, "spd": -2}, None),
    11: ("Brigand", {}, {}, None), 12: ("Archer", {"dex": 2, "str": 1}, {}, None),
    14: ("Mage", {"mag": 2, "res": 2}, {}, None), 16: ("Priest", {"res": 3}, {}, None),
    19: ("Lord", {}, {}, None), 32: ("Wyvern Rider", {}, {}, None), 77: ("Giant Bird", {}, {}, None),
    85: ("War Monk", {"def": 1}, {}, "War Cleric"), 40: ("Gremory", {}, {}, None), 41: ("Wyvern Lord", {}, {}, None),
    42: ("Armored Knight", {}, {}, None), 43: ("Pegasus Knight", {}, {}, None),
}
NAME = b"\x1bN0Byleth\x1bN1".ljust(fe3h.PLAYER_NAME_SIZE, b"\0")


@dataclass
class Slot:
    character: int
    level: int = 15
    class_id: int = 0
    raw: dict[str, int] = field(default_factory=dict)  # hp, str ... cha; anything left out is 10
    abilities: tuple[int, ...] = ()
    arts: tuple[int, ...] = ()
    items: tuple[tuple[int, int], ...] = ((21, 40),)
    spells: tuple[tuple[int, int], ...] = ()  # (spell ID, uses left)
    learned_abilities: tuple[int, ...] | None = None  # everything equipped unless given
    learned_arts: tuple[int, ...] | None = None
    battalion: int | None = None
    equipped: int = fe3h.EQUIPPED_WEAPON
    counter: int = 20  # the battle counter
    flags: int = fe3h.IN_ARMY


def build_slot(s: Slot) -> bytes:
    out = bytearray(b"\0" * fe3h.SLOT_SIZE)
    raw = {k: 10 for k in KEYS} | s.raw
    padded = [*s.items, *[(fe3h.EMPTY_SLOT, 0)] * (6 - len(s.items))]
    struct.pack_into("<12H", out, fe3h._ITEMS, *[v for pair in padded for v in pair])
    struct.pack_into("<H", out, fe3h._BATTALION_SLOT, fe3h.NO_BATTALION if s.battalion is None else 0)
    out[fe3h._BATTALION] = s.battalion or 0
    struct.pack_into("<H", out, fe3h._CHARACTER, s.character)
    struct.pack_into("<H", out, fe3h._EQUIPPED, s.equipped)
    out[fe3h._LEVEL], out[fe3h._CLASS], out[fe3h._HP] = s.level, s.class_id, raw["hp"]
    for n, key in enumerate(fe3h.STAT_ORDER):
        out[fe3h._STATS + n] = raw[key]
    learned_arts = s.arts if s.learned_arts is None else s.learned_arts
    learned_abilities = s.abilities if s.learned_abilities is None else s.learned_abilities
    for ids, offset in ((learned_arts, fe3h._LEARNED_ARTS), (learned_abilities, fe3h._LEARNED_ABILITIES)):
        for n in ids:
            out[offset + n // 8] |= 1 << n % 8
    out[fe3h._ABILITIES : fe3h._ABILITIES + 5] = bytes([*s.abilities, *[fe3h.EMPTY_ABILITY] * (5 - len(s.abilities))])
    out[fe3h._ARTS : fe3h._ARTS + fe3h.ART_SLOTS] = bytes([*s.arts, *[255] * (fe3h.ART_SLOTS - len(s.arts))])
    spells = list(s.spells) + [(fe3h.NO_SPELL, 0)] * (fe3h.SPELL_SLOTS - len(s.spells))
    out[fe3h._SPELL_IDS : fe3h._SPELL_IDS + fe3h.SPELL_SLOTS] = bytes(i for i, _ in spells)
    out[fe3h._SPELL_USES : fe3h._SPELL_USES + fe3h.SPELL_SLOTS] = bytes(u for _, u in spells)
    out[fe3h._FLAGS] = s.flags
    struct.pack_into("<H", out, fe3h._BATTLES, s.counter)
    return bytes(out)


def _unit(character, level, class_id, raw, abilities, arts, **more) -> Slot:
    keys = ("hp", "str", "mag", "dex", "spd", "lck", "def", "res", "mv", "cha")
    return Slot(character, level, class_id, dict(zip(keys, raw)), abilities, arts, **more)


# The army: the 15 characters that are in the army, each in the roster slot numbered like its character.
# Raw stats: hp, str, mag, dex, spd, lck, def, res, mv, cha.
ARMY_SLOTS = [
    _unit(0, 17, 7, (35, 21, 12, 14, 18, 17, 7, 11, 4, 16), (10, 2, 3, 5, 7), (7, 30, 53),
          items=((22, 10), (72, 15), (21, 40), (44, 33), (21, 20), (1000, 3)), learned_abilities=(10, 2, 3, 4, 5, 7, 17)),
    _unit(4, 17, 12, (36, 20, 6, 20, 17, 12, 8, 7, 4, 15), (5, 2, 1, 6, 18), (7, 30)),
    _unit(19, 18, 10, (33, 17, 9, 21, 14, 8, 10, 10, 4, 14), (1, 2, 13), (30,), spells=((0, 10), (9, 10), (2, 3)),
          items=((22, 22),)),
    _unit(20, 16, 4, (42, 19, 7, 8, 9, 9, 13, 4, 4, 11), (10, 2, 3, 1, 7), (30, 22)),
    _unit(21, 18, 7, (30, 15, 4, 19, 12, 10, 6, 9, 4, 8), (3, 2, 1), (30, 1), items=((72, 44),)),
    _unit(22, 16, 14, (25, 3, 22, 14, 13, 8, 4, 10, 4, 11), (11, 12, 3, 8), (53,),
          items=((72, 34), (34, 8), (1002, 1)), spells=((0, 10), (14, 8)), equipped=fe3h.EQUIPPED_SPELL + 14),
    _unit(23, 16, 16, (28, 5, 20, 14, 12, 14, 8, 20, 4, 13), (12, 2, 3), (7, 30), items=((602, 100), (34, 12), (1000, 3)),
          spells=((9, 20), (24, 12))),
    _unit(24, 16, 4, (34, 24, 3, 16, 14, 11, 10, 6, 4, 12), (1, 4, 6, 10), (1, 2, 30), items=((44, 40), (1000, 2))),
    _unit(25, 17, 10, (33, 18, 10, 23, 15, 13, 14, 5, 4, 13), (1, 5, 3, 2, 6), (7, 53), items=((616, 1), (72, 40), (21, 30))),
    _unit(27, 15, 5, (32, 5, 16, 18, 14, 14, 9, 14, 4, 12), (12, 3, 9), (30, 2, 3), spells=((9, 10), (24, 12)),
          items=((34, 12),), battalion=None),
    _unit(28, 15, 14, (27, 4, 21, 17, 12, 11, 5, 17, 4, 10), (11, 3, 2, 8), (30, 53), spells=((2, 12), (11, 10)),
          items=((72, 30), (34, 12)), battalion=4),
    _unit(29, 15, 16, (26, 7, 18, 13, 14, 12, 6, 15, 4, 14), (9, 12), (1, 2, 3), spells=((24, 20), (9, 12)),
          items=((34, 12),), battalion=3),
    _unit(32, 13, 0, (30, 14, 3, 10, 9, 8, 14, 5, 4, 10), (1, 2, 7), (30, 22, 7), items=((22, 40),)),
    _unit(33, 13, 1, (28, 13, 2, 12, 10, 9, 9, 6, 4, 9), (7, 4, 2, 1), (30, 22, 7), items=((21, 40), (44, 20))),
    _unit(34, 18, 4, (38, 22, 2, 15, 18, 10, 7, 4, 4, 9), (12, 3, 2, 8, 6), (22, 23, 35)),
]
ARMY = {s.character for s in ARMY_SLOTS}
# Which character each roster slot holds: Byleth, then the others by ID, then the DLC characters; the rest are empty.
SLOT_CHARACTERS = [0, *range(2, 35), 1040, 1041, 1042, 1043, 1045, 1046]
SLOT_OF = {character: slot for slot, character in enumerate(SLOT_CHARACTERS)}


def build_roster(slots: list[Slot] | None = None) -> bytes:
    """All 60 roster slots. Characters that aren't given are in the save but not in the army."""
    units = {s.character: s for s in (ARMY_SLOTS if slots is None else slots)}
    out = []
    for i in range(fe3h.SLOTS):
        character = SLOT_CHARACTERS[i] if i < len(SLOT_CHARACTERS) else fe3h.EMPTY_SLOT
        out.append(build_slot(units.get(character) or Slot(character, flags=0, items=())))
    return b"".join(out)


ROSTER = build_roster()
DATA = ROSTER + NAME


def write_roster_tables(root: Path) -> None:
    """Add the tables that name the army to a fake import (helpers/fake_import.py)."""

    def write(relative, content):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
        manifest = json.loads((root / "manifest.json").read_text("utf-8"))
        manifest["files"][relative] = {}
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    weapon = {"weapon_type": 0, "skill": 0, "rank": 0, "max_range": 1, "min_range": 1, "might": 5, "hit": 80,
              "crit": 0, "weight": 5, "flags": 0}
    write("data/weapons.json", {"weapons": [
        {"id": i, "name": n, "uses": u, **weapon, **{k: v for k, v in WEAPON_TRAITS[i].items() if k != "effective"},
         "raw": "00" * 14 + f"{WEAPON_TRAITS[i].get('effective', 0):02x}" + "00" * 17}
        for i, (n, u) in WEAPONS.items()
    ]})
    write("data/spells.json", {"spells": [
        {"id": i, "name": n, "uses": u, **weapon, "skill": SPELL_SKILLS[i], "raw": "00" * 32} for i, (n, u) in SPELLS.items()
    ]})
    write("data/combat-arts.json", {"combat_arts": [
        {"id": i, "name": n, "might": 3, "hit": 0, "crit": 0, "cost": 2, "raw": ""} for i, n in ARTS.items()
    ]})
    write("data/abilities.json", {"abilities": [
        {"id": i, "name": n, "weapon_type": 255, "amounts": [0], "stats": [], "raw": "000000ff" + "00" * 11} for i, n in ABILITIES.items()
    ]})
    write("data/equipment.json", {"equipment": [{"id": i, "name": n} for i, n in EQUIPMENT.items()]})
    write("data/battalions.json", {"battalions": [
        {"id": i, "name": n, **({"endurance": 60, "stats": BATTALION_LEVELS[i][0], "stats_by_level": BATTALION_LEVELS[i],
                                 "gambit": {"id": 1, "name": "Test Rally", "uses": 2}} if i in BATTALION_LEVELS else {})}
        for i, n in BATTALIONS.items()
    ]})
    write("data/items.json", {"items": [{"id": i, "name": n} for i, n in ITEMS.items()]})
    write("data/classes.json", {"classes": [
        {"id": i, "name": n, "boosts": b, "mounted": m, "female_name": f, "mastery_ability": None,
         "mastery_art": None, "abilities": [], "types": TYPES.get(i, {})}
        for i, (n, b, m, f) in CLASSES.items()
    ]})
    write("data/characters.json", {"characters": [
        {"id": i, "name_id": i, "name": given, "full_name": full, "gender": gender,
         "student": {"personal_ability": PERSONAL.get(i), "personal_ability_upgraded": PERSONAL_UPGRADED.get(i)}}
        for i, (given, full, gender) in CHARACTERS.items()
    ]})
    write("text/ENG_U.json", {"categories": {
        "character_given": {str(i): c[0] for i, c in CHARACTERS.items()},
        "character_full": {str(i): c[1] for i, c in CHARACTERS.items()},
        "npc_and_generic_names": {str(i): n for i, n in GENERIC.items()},
        "class": {str(i): c[0] for i, c in CLASSES.items()},
        "ability": {str(i): n for i, n in ABILITIES.items()},
        "combat_art": {str(i): n for i, n in ARTS.items()},
        "weapon": {str(i): n for i, (n, _) in WEAPONS.items()},
        "spell": {str(i): n for i, (n, _) in SPELLS.items()},
        "equipment": {str(i): n for i, n in EQUIPMENT.items()},
        "item": {str(i): n for i, n in ITEMS.items()},
        "battalion": {str(i): n for i, n in BATTALIONS.items()},
        "gambit": {}, "terrain": {},
        "scenario_title": {"0": "First Trial"},
    }})
