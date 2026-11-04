"""Game tables as JSON: characters, classes, items, abilities, supports, gifts ... (data/*.json).

Numbers and ids come from the fixed_*.bin tables, names and descriptions from the English text (ENG_U). Everything is
keyed by the game's own ids; row layouts are in docs/game-assets/tables.md and docs/game-assets/social.md. Combat
tables retain `raw` hex for the memory reader.
"""

from __future__ import annotations

from collections.abc import Sequence
import re
import struct

from .. import archive, msgdata, tables
from ..tables import signed
from . import Context

STATS = ("str", "mag", "dex", "spd", "lck", "def", "res", "mv", "cha")
SKILLS = ("sword", "lance", "axe", "bow", "brawling", "reason", "faith", "authority", "heavy_armor", "riding", "flying")
RANKS = ("E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+")
PROFICIENCY = {1: "weak", 2: "normal", 3: "strong"}
CERT_GENDER = {0: "male", 1: "female", 2: "any"}  # classdata s1 +3
EFFECT_STAT = {3: "hp", 4: "str", 5: "mag", 6: "dex", 7: "spd", 8: "lck", 9: "def", 10: "res", 11: "mv", 12: "cha"}
EQUIPMENT_EFFECT = {**EFFECT_STAT, 14: "hit", 15: "crit", 16: "avoid", 19: "res"}
# Equipment effect types (row bytes 20/21, values in bytes 2/3), matched against the item descriptions: magic might, heal
# power and spell range bonuses, HP restored each turn (percent), EXP and skill EXP gain (percent), damage taken from
# monsters (percent), and switches (value 1) for Miracle and negating critical hits. 34 lists the class types whose
# weaknesses are nullified, as CLASS_TYPES bits.
EQUIPMENT_AMOUNT = {23: "mt", 37: "heal", 27: "range", 29: "hp_restore_pct", 91: "hp_restore_pct", 55: "exp_pct",
                    57: "skill_exp_pct", 35: "monster_damage_pct"}
EQUIPMENT_SWITCH = {33: "miracle", 36: "negate_crit"}
PLACEHOLDER = re.compile(r"(Item|Spare slot) \d+")
SUPPORT_RANKS = ((0x40, "C"), (0x20, "C+"), (0x10, "B"), (0x08, "B+"), (0x04, "A"), (0x02, "A+"), (0x01, "S"))
CLASS_TYPES = ((1, "infantry"), (2, "armored"), (4, "cavalry"), (8, "flying"))  # classdata s0 +0x51
SPELL_RANGE = {100: "mag/2", 111: "mag/4", 121: "mag/4", 130: "all"}  # max range codes >= 100 are formulas
FEMALE_CLASS_NAMES = {85: 100}  # War Monk -> War Cleric
FIRST_ITEM = 1000
PERSONS = 1201
STUDENT_IDS = 38  # ids 0-37 index the 45-row per-student sections directly; DLC characters sit at id - 1002
DLC_FIRST, DLC_LAST = 1040, 1046
EMPTY = 0xFF
GIFT_ROW_ID = {**{n: n for n in range(2, 37)}, **{n: n + 1002 for n in range(38, 45)}}  # presentdata s1 row -> person id

# English text indices in the 15,397-string file (docs/game-assets/text.md).
TEXT_FILE = 2
GIVEN, MIDDLE, SURNAME = 1157, 1731, 2305
CLASS, CLASS_DESCRIPTION, ITEM, ITEM_DESCRIPTION = 3453, 3554, 3656, 3856
WEAPON, WEAPON_DESCRIPTION, EQUIPMENT = 3746, 4246, 4556
ART, ART_DESCRIPTION, ABILITY, ABILITY_DESCRIPTION = 6014, 6314, 7236, 7536
SPELL, SPELL_DESCRIPTION, BATTALION, BATTALION_DESCRIPTION = 7836, 8136, 9096, 9297
GAMBIT, GAMBIT_DESCRIPTION = 6614, 6914
FACTION, CREST_MAJOR, CREST_MINOR, GIFT = 9498, 9590, 9612, 10142  # 10147 in the NUL-split pool, 5 less by string index
FACTIONS = 23
CRESTS = 22
MEAL, INGREDIENT = 9852, 5056
MEALS = 32
MEAL_PERSON_IDS = {**{n: n for n in range(2, 35)}, **{n: n + 1002 for n in (38, 39, 40, 41, 43, 44)}}

# Entry numbers in DATA0 for dumps whose patch folder does not carry the loose file.
DATA_ENTRIES = {
    "fixed_data.bin": 6,
    "fixed_growthdata.bin": 9,
    "fixed_classdata.bin": 11,
    "fixed_persondata.bin": 12,
    "fixed_skill.bin": 15,
    "fixed_presentdata.bin": 28,
    "fixed_lobby_activity.bin": 26,
}


class Text:
    """Cleaned strings of the English text file by index; "" when the slot is missing."""

    def __init__(self, strings: Sequence[str]):
        self.strings = strings

    def __call__(self, index: int) -> str:
        return msgdata.clean(self.strings[index]) if 0 <= index < len(self.strings) else ""


def u16(row: bytes, at: int) -> int:
    return struct.unpack_from("<H", row, at)[0]


def u32(row: bytes, at: int) -> int:
    return struct.unpack_from("<I", row, at)[0]


def keep(*groups: Sequence[int]) -> list[int]:
    return [v for g in groups for v in g if v != EMPTY]


def _is_sections(raw: bytes) -> bool:
    """True when raw is a plain fixed_*.bin: section count, then (offset, size) pairs inside the file."""
    if len(raw) < 12:
        return False
    count = u32(raw, 0)
    if not 1 <= count < 64 or 4 + 8 * count > len(raw):
        return False
    first, size = struct.unpack_from("<II", raw, 4)
    return first == 4 + 8 * count and first + size <= len(raw)


def load(ctx: Context, name: str) -> bytes | None:
    """A fixed_*.bin as plain bytes: the loose patch file (these are not zlib-chunked), else its DATA entry."""
    path = ctx.base.resolve(f"nx/data/{name}")
    raw = path.read_bytes() if path else ctx.base.read(DATA_ENTRIES[name]) if name in DATA_ENTRIES else None
    if raw is not None and not _is_sections(raw):
        raw = archive.maybe_unchunk(raw)
    return raw if raw is not None and _is_sections(raw) else None


def ranked(pairs: Sequence[tuple[int, int]]) -> list[dict]:
    return [{"id": n, "rank": RANKS[r] if r < len(RANKS) else None} for n, r in pairs]


def person(row: bytes, text: Text) -> dict:
    name_id = u16(row, 0x12)
    month = row[0x1C]
    stat = lambda at: dict(zip(STATS, row[at : at + 9], strict=True))  # noqa: E731
    return {
        "name_id": name_id,
        "name": text(GIVEN + name_id),
        "class": text(CLASS + row[0x1A]),
        "age": row[0x1B],
        "birthday": {"month": month, "day": row[0x1E]} if month else None,
        "height": {"part1": row[0x2F], "part2": row[0x30]},
        "allegiance": row[0x24],
        "gender": row[0x26],
        "crests": [c for c in row[0x2C:0x2E] if c < 2 * CRESTS],
        "hp": {"base": row[0x2B], "growth": row[0x29], "cap": row[0x22]},
        "bases": stat(0x33),
        "growths": stat(0x3C),
        "caps": stat(0x45),
    }


def student(rows: dict[str, list[bytes]], at: int) -> dict:
    """The per-student sections of persondata for section row `at`."""
    ranks = rows["ranks"][at]
    skills = {}
    for n, skill in enumerate(SKILLS):
        start = ranks[9 + n]
        skills[skill] = {
            "start_rank": RANKS[start] if start < len(RANKS) else None,
            "proficiency": PROFICIENCY.get(ranks[20 + n]),
        }
    spells = rows["spells"][at]
    learned = rows["abilities"][at]
    arts = rows["arts"][at]
    return {
        "skills": skills,
        "personal_ability": learned[20] if learned[20] != EMPTY else None,
        "personal_ability_upgraded": learned[21] if learned[21] != EMPTY else None,
        "abilities": [
            {"id": a, "rank": RANKS[r] if r < len(RANKS) else None, "skill": SKILLS[s] if s < len(SKILLS) else None}
            for s, a, r in zip(learned[0:20], learned[22:42], learned[42:62], strict=True)
            if a != EMPTY
        ],
        "combat_arts": [
            {"id": a, "rank": RANKS[r] if r < len(RANKS) else None, "skill": SKILLS[s] if s < len(SKILLS) else None}
            for a, s, r in zip(arts[0:10], arts[10:20], arts[20:30], strict=True)
            if s != EMPTY and a != EMPTY
        ],
        "spells": {
            "faith": ranked([(s, r) for s, r in zip(spells[10:15], spells[0:5], strict=True) if s != EMPTY]),
            "reason": ranked([(s, r) for s, r in zip(spells[5:10], spells[15:20], strict=True) if s != EMPTY]),
        },
    }


def characters(ctx_rows: dict[str, list[bytes]], text: Text) -> dict:
    persons = ctx_rows["persons"]
    out = []
    for pid, row in enumerate(persons[:PERSONS]):
        record = {"id": pid, **person(row, text)}
        at = pid if pid < STUDENT_IDS else pid - 1002 if DLC_FIRST <= pid <= DLC_LAST else None
        if at is not None and at < len(ctx_rows["ranks"]):
            if pid < 35:
                record["full_name"] = " ".join(
                    p for p in (text(GIVEN + pid), text(MIDDLE + pid), text(SURNAME + pid)) if p
                )
            record["student"] = student(ctx_rows, at)
        out.append(record)
    budding = []
    for row in ctx_rows["budding"]:
        who = u16(row, 0)
        if who >= PERSONS:  # padding rows use id 2999
            continue
        budding.append(
            {
                "character": who,
                "skill": SKILLS[row[3]] if row[3] < len(SKILLS) else None,
                "combat_art": row[4] if row[4] != EMPTY else None,
                "ability": row[5] if row[5] != EMPTY else None,
            }
        )
    return {
        "characters": out,
        "budding_talents": sorted(budding, key=lambda b: (b["character"], b["skill"] or "")),
    }


def classes(class_rows: dict[str, list[bytes]], text: Text) -> list[dict]:
    levels = [r[0] for r in class_rows["tiers"]]
    out = []
    for cid, row in enumerate(class_rows["classes"]):
        cert, abilities = class_rows["certification"][cid], class_rows["abilities"][cid]
        tier = row[0x45]
        boosts = {"hp": signed(row[0x10]), **dict(zip(STATS, map(signed, row[0x27:0x30]), strict=True))}
        mounted = dict(zip(STATS, map(signed, row[0x30:0x39]), strict=True))
        kind = row[0x51]
        record = {
            "id": cid,
            "name": text(CLASS + cid),
            "description": text(CLASS_DESCRIPTION + cid),
            "tier": tier,
            "level": levels[tier] if tier < len(levels) else None,
            "types": {name: bool(kind & bit) for bit, name in CLASS_TYPES},
            "bases": {"hp": row[0x4B], **dict(zip(STATS[:7], row[0x55:0x5C], strict=True))},
            "base_mv": 4 + boosts["mv"] + mounted["mv"],
            "boosts": boosts,
            "mounted": mounted,
            "growths": {"hp": row[0x14], **dict(zip(STATS, row[0x15:0x1E], strict=True))},
            "skill_bonus": dict(zip(SKILLS, row[0x39:0x44], strict=True)),
            "certification": {
                "seal_item": FIRST_ITEM + cert[1] if cert[1] != EMPTY else None,
                "gender": CERT_GENDER.get(cert[3]),
                "selectable": cert[2] != 0,
                "requirements": {s: cert[4 + n] for n, s in enumerate(SKILLS) if cert[4 + n]},
                "any_of": tier == 1 and sum(bool(v) for v in cert[4:15]) > 1,
            },
            "mastery_ability": abilities[0] if abilities[0] != EMPTY else None,
            "mastery_art": abilities[1] if abilities[1] != EMPTY else None,
            "abilities": [a for a in abilities[2:5] if a != EMPTY],
        }
        if cid in FEMALE_CLASS_NAMES:
            record["female_name"] = text(CLASS + FEMALE_CLASS_NAMES[cid])
        out.append(record)
    return out


def item_fields(row: bytes) -> dict:
    return {
        "weapon_type": row[0x00],
        "skill": row[0x05],
        "rank": row[0x06],
        "max_range": row[0x07],
        "min_range": row[0x0A],
        "uses": row[0x0B],
        "might": row[0x10],
        "hit": row[0x11],
        "crit": row[0x12],
        "weight": row[0x13],
        "flags": row[0x16],
        "raw": row.hex(),
    }


def weapons(rows: list[bytes], text: Text) -> list[dict]:
    out = []
    for n, row in enumerate(rows):
        item = 10 + n  # weapon item ids start at 10
        name = text(WEAPON + item)
        if name and name != "TBD":
            out.append(
                {
                    "id": item,
                    "name": name,
                    "description": text(WEAPON_DESCRIPTION + item),
                    **item_fields(row),
                }
            )
    return out


def spells(rows: list[bytes], text: Text) -> list[dict]:
    out = []
    for n, row in enumerate(rows):
        name = text(SPELL + n)
        if name and name != "TBD":
            fields = item_fields(row)
            out.append(
                {
                    "id": n,
                    "name": name,
                    "description": text(SPELL_DESCRIPTION + n),
                    **fields,
                    "range_formula": SPELL_RANGE.get(fields["max_range"]),
                }
            )
    return out


def equipment(rows: list[bytes], text: Text) -> list[dict]:
    out = []
    for n, row in enumerate(rows):
        name = text(EQUIPMENT + n)
        if not name or (PLACEHOLDER.fullmatch(name) and not text(4606 + n)):
            continue  # unused slots the game names "Item 43" and so on
        effects = {"prot": row[0x10], "weight": row[0x13]}
        for kind, amount in ((row[20], row[2]), (row[21], row[3])):
            if kind in EQUIPMENT_EFFECT:
                effects[EQUIPMENT_EFFECT[kind]] = signed(amount)
            elif kind in EQUIPMENT_AMOUNT:
                effects[EQUIPMENT_AMOUNT[kind]] = amount
            elif kind in EQUIPMENT_SWITCH:
                effects[EQUIPMENT_SWITCH[kind]] = True
            elif kind == 34:
                effects["nullify_weakness"] = [name for bit, name in CLASS_TYPES if amount & bit]
        out.append({"id": n, "name": name, "description": text(4606 + n), "effects": effects})
    return out


def items(rows: list[bytes], text: Text) -> list[dict]:
    """Consumables and other items: row n is item 1000 + n (+0xB uses, +0x10 amount, e.g. HP a Vulnerary heals)."""
    out = []
    for n, row in enumerate(rows):
        item = FIRST_ITEM + n
        name = text(ITEM + item)
        if name not in ("", "0", "TBD") and not PLACEHOLDER.fullmatch(name):  # unused slots read "0" or "Spare slot 15"
            out.append(
                {
                    "id": item,
                    "name": name,
                    "description": text(ITEM_DESCRIPTION + item),
                    "uses": row[0x0B],
                    "amount": row[0x10],
                }
            )
    return out


def combat_arts(rows: list[bytes], text: Text) -> list[dict]:
    out = []
    for n, row in enumerate(rows):
        name = text(ART + n)
        if name and name != "TBD":
            out.append(
                {
                    "id": n,
                    "name": name,
                    "description": text(ART_DESCRIPTION + n),
                    "might": row[0x03],
                    "crit": row[0x04],
                    "hit": row[0x05],
                    "cost": signed(row[0x0A]),
                    "raw": row.hex(),
                }
            )
    return out


def abilities(rows: list[bytes], text: Text) -> list[dict]:
    out = []
    for n, row in enumerate(rows):
        name = text(ABILITY + n)
        if name and name != "TBD":
            out.append(
                {
                    "id": n,
                    "name": name,
                    "description": text(ABILITY_DESCRIPTION + n),
                    "amounts": [signed(b) for b in row[0:3]],
                    "weapon_type": row[3],
                    "stats": list(row[0x0A:0x0D]),
                    "raw": row.hex(),
                }
            )
    return out


def battalions(rows: list[bytes], text: Text, gambits: Sequence[bytes] = (),
               targets: Sequence[bytes] = ()) -> list[dict]:
    """Reference values from fixed_data sections 11, 3 and 8, indexed by their game IDs."""
    # Row fields: https://github.com/three-houses-research-team/010-binary-templates/blob/master/ItemData.bt
    # Growth is in tenths per level; the accumulated growth is rounded down, not each level's gain.
    offsets = {"phys_atk": 10, "mag_atk": 8, "hit": 11, "crit": 12,
               "avo": 13, "prt": 15, "rsl": 16, "cha": 36}
    growth_offsets = {"phys_atk": 19, "mag_atk": 9, "hit": 20, "crit": 21,
                      "avo": 22, "prt": 24, "rsl": 25}
    result = []
    for n, row in enumerate(rows):
        record = {"id": n, "name": text(BATTALION + n), "description": text(BATTALION_DESCRIPTION + n),
                  "endurance": u16(row, 6), "stats": {key: signed(row[at]) for key, at in offsets.items()}}
        record["stats_by_level"] = [
            {key: value + row[growth_offsets[key]] * (level - 1) // 10 if key in growth_offsets else value
             for key, value in record["stats"].items()}
            for level in range(1, 6)
        ]
        ident = row[39]
        if ident < len(gambits) and ident < len(targets) and text(GAMBIT + ident):
            attack, target = gambits[ident], targets[ident]
            record["gambit"] = {"id": ident, "name": text(GAMBIT + ident),
                                "description": text(GAMBIT_DESCRIPTION + ident), "uses": target[7],
                                "might": attack[16], "hit": attack[17], "range": [attack[10], attack[7]]}
        result.append(record)
    return result


def ranks(rows: list[bytes]) -> list[dict]:
    """Experience per skill rank (growthdata s2, a u16 per rank; the last, S+, is 0)."""
    return [{"rank": rank, "exp": u16(row, 0) or None} for rank, row in zip(RANKS, rows, strict=False)]


def supports(rows: list[bytes], names: dict[int, str]) -> list[dict]:
    """Pairs and the ranks they reach (persondata s10). Byleth is one id; the game marks S if either gender can."""
    out = []
    for row in rows:
        a, b = u16(row, 2), u16(row, 4)
        if a == 0xFFFF:
            continue
        mask = row[9]
        out.append(
            {
                "a": a,
                "b": b,
                "a_name": names.get(a, ""),
                "b_name": names.get(b, ""),
                "ranks": [r for bit, r in SUPPORT_RANKS if mask & bit],
            }
        )
    return sorted(out, key=lambda p: (p["a"], p["b"]))


def gifts(person_rows: list[bytes], text: Text) -> dict:
    """Liked/disliked gifts and lost items per character (presentdata s1), for support reference pages."""
    names = lambda ids: [{"id": i, "name": text(GIFT + i)} for i in ids if i != EMPTY]  # noqa: E731
    people = []
    for row_id, row in enumerate(person_rows):
        pid = GIFT_ROW_ID.get(row_id)
        if pid is None or all(b == EMPTY for b in row):
            continue
        people.append(
            {
                "character": pid,
                "lost_items": names(row[1:4]),
                "disliked": names(row[4:7]),
                "liked": names(keep(row[0:1], row[7:12])),
            }
        )
    return {"characters": sorted(people, key=lambda p: p["character"])}


def factions(person_rows: list[bytes], text: Text) -> dict:
    return {
        "factions": [{"id": n, "name": text(FACTION + n)} for n in range(FACTIONS)],
        "characters": [{"id": pid, "allegiance": row[0x24]} for pid, row in enumerate(person_rows[:PERSONS])],
    }


def crests_by_person(person_rows: list[bytes], text: Text) -> dict:
    names = [
        {"id": n, "name": text((CREST_MAJOR if n < CRESTS else CREST_MINOR) + n % CRESTS), "major": n < CRESTS}
        for n in range(2 * CRESTS)
    ]
    chars = [
        {"id": pid, "crests": [c for c in row[0x2C:0x2E] if c < 2 * CRESTS]}
        for pid, row in enumerate(person_rows[:PERSONS])
    ]
    return {"crests": names, "characters": [c for c in chars if c["crests"]]}


def section(raw: bytes, number: int) -> list[bytes]:
    return tables.rows(raw, number)


def meals(recipe_rows: list[bytes], preference_rows: list[bytes], text: Text) -> dict:
    """Dining recipes (lobby_activity s1) and signed per-meal character preferences (s2)."""
    recipes = []
    for meal_id, row in enumerate(recipe_rows[:MEALS]):
        ingredients = []
        for slot in range(3):
            ingredient, quantity = u16(row, 2 * slot), row[14 + slot]
            if quantity:
                ingredients.append({"id": ingredient, "name": text(INGREDIENT + ingredient), "quantity": quantity})
        recipes.append({"id": meal_id, "name": text(MEAL + meal_id), "ingredients": ingredients})
    people = [
        {"character": pid,
         "liked": [i for i, row in enumerate(preference_rows[:MEALS]) if row[column] == 1],
         "disliked": [i for i, row in enumerate(preference_rows[:MEALS]) if row[column] == EMPTY]}
        for column, pid in MEAL_PERSON_IDS.items()
    ] if preference_rows else []
    return {"meals": recipes, "characters": people}


def write(ctx: Context, name: str, data, source: str) -> None:
    ctx.out.json(f"data/{name}.json", data, source=source)


def extract(ctx: Context) -> None:
    text_files = ctx.text()
    if len(text_files) <= TEXT_FILE:
        ctx.skip("data: the text file has no string table 2; nothing written")
        return
    text = Text(text_files[TEXT_FILE])
    files = {name: load(ctx, name) for name in DATA_ENTRIES}
    missing = [name for name, raw in files.items() if raw is None]
    for name in missing:
        ctx.skip(f"data: {name} not found; the tables that need it are not written")
    person, cls, fixed, skill, growth, present = (
        files["fixed_persondata.bin"],
        files["fixed_classdata.bin"],
        files["fixed_data.bin"],
        files["fixed_skill.bin"],
        files["fixed_growthdata.bin"],
        files["fixed_presentdata.bin"],
    )
    if person:
        src = "fixed_persondata.bin"
        rows = {
            "persons": section(person, 0),
            "ranks": section(person, 3),
            "spells": section(person, 4),
            "abilities": section(person, 5),
            "arts": section(person, 7),
            "budding": section(person, 11),
        }
        data = characters(rows, text)
        named = {c["id"]: c["name"] for c in data["characters"] if c["name"]}
        write(ctx, "characters", data, f"{src} sections 0, 3-5, 7, 11")
        write(ctx, "factions", factions(rows["persons"], text), f"{src} section 0 +0x24")
        write(ctx, "crests-by-person", crests_by_person(rows["persons"], text), f"{src} section 0 +0x2C/+0x2D")
        pairs = supports(section(person, 10), named)
        write(ctx, "supports", {"pairs": pairs}, f"{src} section 10")
    if cls:
        recs = classes(
            {
                "classes": section(cls, 0),
                "certification": section(cls, 1),
                "tiers": section(cls, 2),
                "abilities": section(cls, 3),
            },
            text,
        )
        write(ctx, "classes", {"classes": recs}, "fixed_classdata.bin sections 0-3")
    if fixed:
        src = "fixed_data.bin"
        recs = weapons(section(fixed, 0), text)
        write(ctx, "weapons", {"weapons": recs}, f"{src} section 0")
        recs = spells(section(fixed, 1), text)
        write(ctx, "spells", {"spells": recs}, f"{src} section 1")
        recs = equipment(section(fixed, 5), text)
        write(ctx, "equipment", {"equipment": recs}, f"{src} section 5")
        recs = items(section(fixed, 6), text)
        write(ctx, "items", {"items": recs}, f"{src} section 6")
        recs = combat_arts(section(fixed, 7), text)
        write(ctx, "combat-arts", {"combat_arts": recs}, f"{src} section 7")
        recs = battalions(section(fixed, 11), text, section(fixed, 3), section(fixed, 8))
        for rec in recs:
            icon = f"images/icons/battalions/{rec['id']}.png"
            if icon in ctx.out.files:
                rec["icon"] = icon
        write(ctx, "battalions", {"battalions": recs}, f"{src} sections 3, 8, 11")
    if skill:
        recs = abilities(section(skill, 0), text)
        write(ctx, "abilities", {"abilities": recs}, "fixed_skill.bin section 0")
    if growth:
        write(ctx, "ranks", {"ranks": ranks(section(growth, 2))}, "fixed_growthdata.bin section 2")
    if present:
        data = gifts(section(present, 1), text)
        write(ctx, "gifts", data, "fixed_presentdata.bin section 1")
    activity = files["fixed_lobby_activity.bin"]
    if activity:
        write(ctx, "meals", meals(section(activity, 1), section(activity, 2), text),
              "fixed_lobby_activity.bin sections 1-2")
