"""Portraits: referenced faces of the "still" packs, plus the named-character and generic views.

Chain: person row (+0x18 AssetsID) -> AssetID row (9 x i16; [4] Part 1, [2] Part 2,
[0] and [6] further looks) -> portrait id -> Portraits row (11 expression face indices) -> pack item. Face indices
below the base pack's length are items of DATA entry 6123; higher ones continue in the loose Cindered Shadows file.

    images/portraits/faces/<portrait id>/<expression>.png     neutral faces and character expressions, 512 px
    images/portraits/characters/<char id>[-part2|-<portrait id>].png
    images/portraits/generic/<class id>-<gender>-<nn>.png
    data/portraits.json                                       ids, names, files, and the current app's file keys
"""

from __future__ import annotations

from collections import Counter, defaultdict
from functools import lru_cache
import struct

from PIL import Image

from .. import g1t, msgdata, tables
from ..archive import maybe_unchunk, pack_items
from . import ENGLISH, Context

FACE_ENTRY = 6123
DLC_FACES = "nx/ui/still/face_school_normal_DLC.bin"
PERSON_TABLE = "nx/data/fixed_persondata.bin"
PEOPLE, ASSETS, PORTRAITS = 0, 1, 16
EXPRESSIONS = 11
NAMED_IDS = (*range(100), *range(1040, 1047))  # story characters, NPCs and the Cindered Shadows cast
NAME_BASE, CLASS_NAME_BASE = 1157, 3453  # indices into the ENG_U string table
# Looks no AssetID row references: Constance's second Part 1 and Part 2 faces follow her referenced ones.
FOLLOW_UP_LOOKS = {554: (555,), 560: (561,)}

# The app's portrait files and the portrait id each one is, matched by image.
# The app finds the importer's files by these keys.
APP_PORTRAITS = """
    acheron:67 aelfric:557 alois:31 anna:48 anna_2:551 annette:17 annette_2:88 arundel:54 ashe:14 ashe_2:85
    balthus:553 balthus_2:559 bernadetta:9 bernadetta_2:80 black_beast:527 byleth_f:1 byleth_f_2:72 byleth_m:0
    byleth_m_2:71 caspar:8 caspar_2:79 catherine:32 claude:4 claude_2:75 constance:554 constance_2:555
    constance_3:560 constance_4:561 cornelia:41 cyril:34 cyril_2:97 death_knight:42 dedue:12 dedue_2:83
    dimitri:3 dimitri_2:74 dimitri_3:99 dimitri_4:98 dimitri_child:58 dorothea:10 dorothea_2:81 duke_aegir:61
    edelgard:2 edelgard_2:73 edelgard_child:59 felix:13 felix_2:84 ferdinand:6 ferdinand_2:77 flame_emperor:47
    flayn:27 fleche:62 fleche_2:69 generic/altered_demonic_beast:532 generic/altered_golem:536
    generic/archer_01:285 generic/archer_02:286 generic/archer_03:287 generic/archer_04:288
    generic/archer_05:289 generic/archer_06:290 generic/archer_07:291 generic/archer_08:292
    generic/archer_f_01:293 generic/archer_f_02:294 generic/armored_knight:269 generic/armored_knight_f:270
    generic/assassin_01:350 generic/assassin_02:352 generic/assassin_03:353 generic/assassin_04:354
    generic/assassin_05:357 generic/assassin_f:361 generic/bishop_01:427 generic/bishop_02:430
    generic/bishop_03:432 generic/bishop_f_01:435 generic/bishop_f_02:436 generic/bow_knight_01:459
    generic/bow_knight_02:462 generic/bow_knight_03:464 generic/bow_knight_f_01:467 generic/bow_knight_f_02:469
    generic/brawler_01:297 generic/brawler_02:300 generic/brigand_01:273 generic/brigand_02:274
    generic/brigand_03:276 generic/brigand_04:277 generic/brigand_05:280 generic/brigand_f_01:281
    generic/brigand_f_02:283 generic/cavalier:271 generic/cavalier_f:272 generic/commoner:137 generic/dancer:507
    generic/dark_bishop:426 generic/dark_flier:587 generic/dark_knight:472 generic/dark_knight_f:479
    generic/dark_mage:317 generic/demonic_beast:530 generic/experimental_demonic_beast:531
    generic/falcon_knight_01:439 generic/falcon_knight_02:440 generic/fighter_01:221 generic/fighter_02:222
    generic/fighter_03:223 generic/fighter_04:224 generic/fighter_05:225 generic/fighter_06:226
    generic/fighter_07:227 generic/fighter_08:228 generic/fighter_f_01:229 generic/fighter_f_02:231
    generic/flying_demonic_beast:534 generic/fortress_knight:362 generic/fortress_knight_f:363
    generic/giant_bird:544 generic/giant_crawler:545 generic/giant_demonic_beast:533 generic/giant_wolf:546
    generic/golem:535 generic/grappler_01:406 generic/grappler_02:411 generic/grappler_03:413
    generic/great_knight:457 generic/great_knight_f:458 generic/gremory_01:504 generic/gremory_02:505
    generic/gremory_03:506 generic/hero_01:330 generic/hero_02:331 generic/hero_03:333 generic/hero_04:334
    generic/holy_knight:483 generic/holy_knight_f:492 generic/mage_01:305 generic/mage_02:306
    generic/mage_03:307 generic/mage_04:308 generic/mage_05:309 generic/mage_06:310 generic/mage_07:311
    generic/mage_08:312 generic/mage_f_01:313 generic/mage_f_02:314 generic/mercenary_01:245
    generic/mercenary_02:246 generic/mercenary_03:247 generic/mercenary_04:248 generic/mercenary_05:249
    generic/mercenary_06:250 generic/mercenary_07:251 generic/mercenary_08:252 generic/mercenary_f_01:253
    generic/mercenary_f_02:255 generic/monk_01:233 generic/monk_02:234 generic/monk_03:235 generic/monk_04:236
    generic/monk_05:237 generic/monk_06:238 generic/monk_07:239 generic/monk_08:240 generic/monk_f_01:241
    generic/monk_f_02:242 generic/mortal_savant:455 generic/mortal_savant_f:456 generic/myrmidon_01:197
    generic/myrmidon_02:198 generic/myrmidon_03:199 generic/myrmidon_04:200 generic/myrmidon_05:201
    generic/myrmidon_06:202 generic/myrmidon_07:203 generic/myrmidon_08:204 generic/myrmidon_f_01:205
    generic/myrmidon_f_02:206 generic/myrmidon_f_03:207 generic/paladin:364 generic/paladin_f:365
    generic/pegasus_knight:367 generic/priest_01:318 generic/priest_02:319 generic/priest_03:320
    generic/priest_04:321 generic/priest_05:322 generic/priest_06:323 generic/priest_07:324
    generic/priest_08:325 generic/priest_f_01:326 generic/priest_f_02:327 generic/priest_f_03:328
    generic/priest_f_04:329 generic/sniper_01:394 generic/sniper_02:398 generic/sniper_f_01:402
    generic/sniper_f_02:403 generic/sniper_f_03:405 generic/soldier_01:209 generic/soldier_02:211
    generic/soldier_03:212 generic/soldier_04:213 generic/soldier_05:214 generic/soldier_06:215
    generic/soldier_07:216 generic/soldier_f:218 generic/stablehand:161 generic/swordmaster_01:338
    generic/swordmaster_02:341 generic/swordmaster_f_01:346 generic/swordmaster_f_02:347
    generic/swordmaster_f_03:348 generic/swordmaster_f_04:349 generic/thief_01:257 generic/thief_02:258
    generic/thief_03:259 generic/thief_04:260 generic/thief_05:261 generic/thief_06:262 generic/thief_07:263
    generic/thief_08:264 generic/thief_f_01:265 generic/thief_f_02:266 generic/titanus:537 generic/trickster:563
    generic/trickster_f:571 generic/valkyrie:591 generic/war_cleric:583 generic/war_master_01:495
    generic/war_master_02:498 generic/war_master_03:499 generic/war_monk:575 generic/warlock_01:414
    generic/warlock_02:417 generic/warlock_03:419 generic/warlock_f:425 generic/warrior_01:382
    generic/warrior_02:385 generic/warrior_03:386 generic/warrior_04:387 generic/warrior_f_01:390
    generic/warrior_f_02:391 generic/white_beast:538 generic/wild_demonic_beast:529 generic/wyvern_lord_01:443
    generic/wyvern_lord_02:447 generic/wyvern_lord_f:452 generic/wyvern_rider_01:370 generic/wyvern_rider_02:372
    generic/wyvern_rider_03:373 generic/wyvern_rider_04:375 generic/wyvern_rider_f_01:378
    generic/wyvern_rider_f_02:380 gilbert:30 gwendal:66 hanneman:28 hapi:556 hapi_2:562 hegemon_edelgard:547
    hilda:24 hilda_2:95 hubert:5 hubert_2:76 ignatz:21 ignatz_2:92 immaculate_one:539 immaculate_one_2:540
    immaculate_one_3:541 immovable:543 ingrid:18 ingrid_2:89 ionius:60 jeralt:35 jeritza:49 jeritza_2:550
    judith:51 kostas:43 kronya:38 ladislava:65 lambert:63 leonie:25 leonie_2:96 linhardt:7 linhardt_2:78
    lonato:44 lorenz:19 lorenz_2:90 lysithea:22 lysithea_2:93 manuela:29 marianne:23 marianne_2:94 mercedes:16
    mercedes_2:87 metodey:64 miklan:45 monica:53 nader:52 nemesis:56 pallard:68 petra:11 petra_2:82 randolph:46
    raphael:20 raphael_2:91 rhea:36 rhea_2:70 rodrigue:50 seiros:57 seteth:26 shamir:33 solon:39 sothis:37
    sylvain:15 sylvain_2:86 thales:40 tomas:55 umbral_beast:597 wandering_beast:528 wind_caller:542 yuri:552
    yuri_2:558
"""


class Faces:
    """The face textures: the base pack followed by the loose Cindered Shadows pack, addressed by face index."""

    def __init__(self, base: list[bytes], dlc: list[bytes]):
        self.base, self.dlc = base, dlc

    def __len__(self) -> int:
        return len(self.base) + len(self.dlc)

    def source(self, index: int) -> str:
        if index < len(self.base):
            return f"DATA {FACE_ENTRY} item {index}"
        return f"{DLC_FACES} item {index - len(self.base)}"

    @lru_cache(maxsize=64)  # noqa: B019 - one Faces per run
    def image(self, index: int) -> Image.Image:
        item = self.base[index] if index < len(self.base) else self.dlc[index - len(self.base)]
        return g1t.texture(maybe_unchunk(item), 0)


def load_faces(ctx: Context) -> Faces | None:
    try:
        base = pack_items(ctx.base.read(FACE_ENTRY))
    except (OSError, ValueError, struct.error) as error:
        ctx.skip(f"base face pack (DATA entry {FACE_ENTRY}): {error}")
        return None
    dlc: list[bytes] = []
    path = ctx.base.resolve(DLC_FACES)
    if path is None:
        ctx.skip(f"Cindered Shadows faces ({DLC_FACES} not in this dump)")
    else:
        dlc = pack_items(path.read_bytes())
    return Faces(base, dlc)


def person(row: bytes) -> dict[str, int]:
    return {
        "name": struct.unpack_from("<H", row, 0x12)[0],
        "asset": struct.unpack_from("<H", row, 0x18)[0],
        "class": row[0x1A],
        "gender": row[0x26],
    }


def asset_row(assets: list[bytes], n: int) -> tuple[int, ...] | None:
    return struct.unpack_from("<9h", assets[n]) if 0 <= n < len(assets) else None


def expressions(row: bytes) -> tuple[int, ...]:
    return struct.unpack_from(f"<{EXPRESSIONS}h", row)


def string_table(ctx: Context) -> list[str] | None:
    try:
        return ctx.text(ENGLISH)[2]
    except (OSError, IndexError, ValueError, struct.error) as error:
        ctx.skip(f"names (msgdata: {error})")
        return None


def text_at(strings: list[str] | None, index: int) -> str:
    return msgdata.clean(strings[index]) if strings and 0 <= index < len(strings) else ""


def person_faces(people: list[bytes], assets: list[bytes], face_files: dict[int, list[str | None]],
                 strings: list[str] | None) -> dict[str, dict]:
    result = {}
    for cid, row in enumerate(people):
        info = person(row)
        found = asset_row(assets, info["asset"])
        if found and face_files.get(found[4], [None])[0]:
            pid = found[4]
            result[str(cid)] = {"name": text_at(strings, NAME_BASE + info["name"]), "face": face_files[pid][0]}
    return result


def character_expressions(part1: int, part2: int, face_files: dict[int, list[str | None]]) -> dict:
    return {"part1": face_files.get(part1, []), "part2": face_files.get(part2, [])}


def generic_groups(people: list[bytes], assets: list[bytes], portraits: list[bytes], reserved: set[int]) -> list[dict]:
    """Runs of portraits that start at a face the generic people reference. A run ends at the next start, at a portrait
    a named character uses, or at the first portrait without a neutral face."""
    refs: dict[int, Counter] = defaultdict(Counter)
    for n, row in enumerate(people):
        if n in NAMED_IDS:
            continue
        info = person(row)
        found = asset_row(assets, info["asset"])
        if found and found[4] >= 0 and found[4] not in reserved:
            refs[found[4]][(info["class"], info["gender"])] += 1
    starts = sorted(refs)
    groups = []
    for at, start in enumerate(starts):
        limit = starts[at + 1] if at + 1 < len(starts) else len(portraits)
        end = start
        while end < limit and end not in reserved and expressions(portraits[end])[0] >= 0:
            end += 1
        if end == start:
            continue
        (cls, gender), _ = min(refs[start].items(), key=lambda item: (-item[1], item[0]))
        groups.append({"class": cls, "gender": gender, "start": start, "portraits": list(range(start, end))})
    return groups


def extract(ctx: Context) -> None:
    path = ctx.base.resolve(PERSON_TABLE)  # a plain table, not a zlib-chunk file
    if path is None:
        ctx.skip(f"{PERSON_TABLE} is not in this dump")
        return
    data = path.read_bytes()
    people, assets, portraits = (tables.rows(data, section) for section in (PEOPLE, ASSETS, PORTRAITS))
    faces = load_faces(ctx)
    if faces is None:
        return
    strings = string_table(ctx)
    ctx.log(f"  {len(portraits)} portraits, {len(faces)} faces ({len(faces.dlc)} from Cindered Shadows)")

    def valid(pid: int) -> bool:
        return 0 <= pid < len(portraits) and 0 <= expressions(portraits[pid])[0] < len(faces)

    def write(rel: str, pid: int) -> None:
        index = expressions(portraits[pid])[0]
        ctx.out.image(rel, faces.image(index), source=f"{faces.source(index)} (portrait {pid})")

    reserved = set()
    expression_ids = set()
    needed = {int(item.rsplit(":", 1)[1]) for item in APP_PORTRAITS.split()}
    for cid, row in enumerate(people):
        found = asset_row(assets, person(row)["asset"])
        if not found:
            continue
        needed.add(found[4])
        if cid in NAMED_IDS:
            reserved.update(p for p in (found[0], found[2], found[4], found[6]) if p >= 0)
        if cid < 35 or 1040 <= cid <= 1046:
            expression_ids.update((found[2], found[4]))
    reserved.update(p for pids in FOLLOW_UP_LOOKS.values() for p in pids)
    groups = generic_groups(people, assets, portraits, reserved)
    needed.update(reserved)
    needed.update(pid for group in groups for pid in group["portraits"])
    face_files: dict[int, list[str | None]] = {}
    for pid, row in enumerate(portraits):
        if pid not in needed:
            continue
        files: list[str | None] = []
        for expression, index in enumerate(expressions(row)):
            if 0 <= index < len(faces) and (expression == 0 or pid in expression_ids):
                rel = f"images/portraits/faces/{pid}/{expression}.png"
                ctx.out.image(
                    rel, faces.image(index), source=f"{faces.source(index)} (portrait {pid} expression {expression})"
                )
                files.append(rel)
            else:
                files.append(None)
        if any(files):
            face_files[pid] = files

    neutral: dict[int, str] = {}  # portrait id -> the nicest file for it (a character's, then a generic's, then faces/)
    named: dict[int, dict] = {}
    for cid in NAMED_IDS:
        if cid >= len(people):
            continue
        info = person(people[cid])
        found = asset_row(assets, info["asset"])
        if not found:
            continue
        part1, part2 = found[4], found[2]
        extras = [p for p in (found[0], found[6]) if p >= 0 and p not in (part1, part2)]
        for pid in (part1, part2):
            extras += [p for p in FOLLOW_UP_LOOKS.get(pid, ()) if p not in extras]
        entry: dict = {"name": text_at(strings, NAME_BASE + info["name"]), "part1": None, "part2": None, "extras": {}}
        if cid < 35 or 1040 <= cid <= 1046:
            entry["expressions"] = character_expressions(part1, part2, face_files)
        for key, pid, rel in (("part1", part1, f"{cid}.png"), ("part2", part2, f"{cid}-part2.png")):
            if valid(pid):
                entry[key] = f"images/portraits/characters/{rel}"
                write(entry[key], pid)
                neutral.setdefault(pid, entry[key])
        for pid in extras:
            if valid(pid):
                rel = f"images/portraits/characters/{cid}-{pid}.png"
                entry["extras"][str(pid)] = rel
                write(rel, pid)
                neutral.setdefault(pid, rel)
        if entry["part1"] or entry["part2"] or entry["extras"]:
            del entry["extras"]
            named[cid] = entry
    numbering: Counter = Counter()
    generic = []
    for group in groups:
        files = []
        for pid in group["portraits"]:
            if not valid(pid):
                continue
            numbering[group["class"], group["gender"]] += 1
            rel = f"images/portraits/generic/{group['class']}-{group['gender']}-{numbering[group['class'], group['gender']]:02d}.png"
            write(rel, pid)
            neutral.setdefault(pid, rel)
            files.append(rel)
        classname = text_at(strings, CLASS_NAME_BASE + group["class"])
        generic.append({"class": group["class"], "gender": group["gender"], "class_name": classname, "files": files})

    app_keys = {}
    persons = person_faces(people, assets, face_files, strings)
    for item in APP_PORTRAITS.split():
        key, pid = item.rsplit(":", 1)
        found = neutral.get(int(pid)) or (face_files.get(int(pid), [None])[0])
        if found:
            app_keys[key] = found
    ctx.out.json(
        "data/portraits.json",
        {
            "characters": {str(cid): entry for cid, entry in named.items()},
            "persons": persons,
            "generic": generic,
            "app_keys": app_keys,
        },
        source=f"{PERSON_TABLE} sections {PEOPLE}, {ASSETS}, {PORTRAITS}; DATA {FACE_ENTRY}; {DLC_FACES}",
    )
    ctx.log(
        f"  {len(named)} named characters, {len(generic)} generic groups, {len(app_keys)}/{len(APP_PORTRAITS.split())} app keys"
    )
