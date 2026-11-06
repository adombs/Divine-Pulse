# Game data tables (characters, classes, abilities, items)

## Summary

- All numeric data the app uses lives in the loose `patch4/nx/data/fixed_*.bin` files (DATA0 entries 6-38, see
  `patch_overrides.csv`; a few resolve to `patch3`). No data needed here comes from the executable.
- Every file is `u32 sectionCount`, then `sectionCount x (u32 offset, u32 size)`; each section is a 0x40-byte header
  (`00 19 12 16`, `u32 count` at +4, `u32 stride` at +8) followed by `count x stride` rows. Most sections satisfy
  `count*stride+0x40 == size`; a few (`fixed_act_data` 19-22, 24-26, `fixed_data` 11, `fixed_skill` 1,
  `fixed_spotdata` 0) have a different size or stride: read rows by `count*stride` and treat those as unexamined.
- The flags the importer uses for unit types (`ARMORED/CAVALRY/FLYING = 0x02/0x04/0x08`) are the bits of
  `fixed_classdata` section 0 byte `+0x51`; the class-name sets can be derived from it.
- The full skill-rank EXP table including A, A+ and S is `fixed_growthdata` section 2.
- Not found: see Gaps.

## Sources found

Paths are `<romfs>\patch4\nx\data\`. Newest patch wins (`patch_overrides.csv`). Counts x stride are decimal.
"verified" = layout confirmed against the game's own values and text; "likely" = matches the 010 template shape only.

| File (DATA0 entry) | Sec | Count x stride | What | Status |
|---|---|---|---|---|
| fixed_persondata (12) | 0 | 1201 x 80 | Person rows by character ID (stats, crest, gender, allegiance, name id) | verified |
| | 1 | 600 x 18 | Asset IDs (models/portraits per character) | likely |
| | 2 | 116 x 8 | Voice IDs | likely |
| | 3 | 45 x 34 | Starting skill ranks, proficiency, certified classes | verified |
| | 4 | 45 x 20 | Spell learnset | verified |
| | 5 | 45 x 62 | Personal abilities, learned abilities + rank | verified |
| | 6 | 45 x 14 | Starting weapons | likely |
| | 7 | 45 x 30 | Combat art learnset | verified |
| | 8 | 45 x 25 | Linked-attack Hit/Avo/Mt by support rank | likely |
| | 9 | 23 x 30 | pairs of name IDs | unknown |
| | 10 | 270 x 12 | Support list (see [social](social.md)) | verified |
| | 11 | 240 x 6 | Budding (hidden) talents | verified |
| | 12 | 12 x 22 | unknown | unknown |
| | 13, 14 | 51 x 6 each | Faculty training / seminar interests | likely |
| | 15 | 320 x 3 | Character goals | likely |
| | 16 | 600 x 24 | Portrait expression IDs | likely |
| | 17 | 100 x 4 | Enemy personal skills (char u16, ability, pad) | likely |
| fixed_classdata (11) | 0 | 100 x 118 | Class rows | verified |
| | 1 | 100 x 15 | Certification requirements (min ranks, seal item, gender) | verified |
| | 2 | 7 x 1 | Tier levels `0,5,10,20,30,20,0` | verified |
| | 3 | 100 x 5 | Mastery ability, mastery art, 3 class abilities | verified |
| | 4-9 | 30x80, 120x40, 16x40, 80x14, 20x4, 60x4 | unknown | unknown |
| fixed_data (6) | 0 | 500 x 24 | Weapons, item ID = 10 + row | verified |
| | 1 | 38 x 24 | Spells (spell ID = row) | verified |
| | 2 | 3 x 24 | item-layout table | unknown |
| | 3, 4, 6 | 80 / 60 / 200 x 24 | more item-layout tables (misc/gift/battle items?) | unknown |
| | 5 | 50 x 24 | Equipment (shields, rings, pendants) | verified |
| | 7 | 80 x 18 | Combat arts (art ID = row) | verified |
| | 8-10, 12-15 | 80x13, 60x3, 96x4, 30x4, 60x6, 56x10, 10x1 | unknown | unknown |
| | 11 | 200 x 44 | battalion reference data | exported; see [integration](../battalions.md) |
| fixed_skill (15) | 0 | 255 x 15 | Ability effects by ability ID | verified |
| | 1 | 22 x 12 | unknown | unknown |
| fixed_growthdata (9) | 0 | 41 x 3 | descending triples | unknown |
| | 1 | 10 x 2 | unknown | unknown |
| | 2 | 12 x 2 (u16) | Skill-rank EXP 40,60,80,120,160,220,280,360,440,760,1080,0 | verified (first 8) |
| | 3-7 | 4x1, 7x2, 98x2, 38x1, 200x2 | unknown (EXP-curve-like, bitmasks) | unknown |
| fixed_act_data (13), fixed_materialdata (31), fixed_presentdata (28) | | | monastery, gifts, materials | not covered here (gifts: [social](social.md)) |

Other `fixed_*` files (areadata, calendardata, flow, gallery, gimmick, lobby_*, onlinedata, questiondata, scenario*,
shopdata, spotdata, stagedata, stageenvinfo, tutorial, warpdata, castle_regon_data, cut_in, freescenariodata,
groupworkdata) hold no field needed for this topic.

DLC: the Cindered Shadows RomFS contains no `fixed_*` tables. DLC characters (Yuri 1040, Balthus 1041, Constance 1042,
Hapi 1043, Aelfric 1044, Jeritza 1045, Anna 1046) are in the **base** `fixed_persondata` section 0 (row = character ID)
and in the 45-row sections at row `ID - 1002` (38-44). The budding table keys by the
full ID (u16, 1040+).

## How to extract

1. Open `patch4/nx/data/<file>`; if working from DATA0 instead, use the entry numbers in `patch_overrides.csv`.
2. `n = u32@0`; section i = `(off, size) = u32,u32 @ 4+8*i`; `count = u32@off+4`, `stride = u32@off+8`; row k is at
   `off + 0x40 + k*stride`.
3. Field offsets (little-endian; signed where noted):

**fixed_persondata sec 0 (row = character ID, 80 bytes)**

| Offset | Field |
|---|---|
| +0x12 u16 | name ID (into the given-name list) |
| +0x22 | HP cap |
| +0x24 | allegiance |
| +0x26 | gender: 0 male, 1 female, 2 other |
| +0x29 | HP growth |
| +0x2B | base HP |
| +0x2C, +0x2D | crest IDs: 0-21 major, 22-43 minor, 86 none; name index = id % 22 |
| +0x33..+0x3B | base Str, Mag, Dex, Spd, Lck, Def, Res, Mov, Cha |
| +0x3C..+0x44 | growths, same order |
| +0x45..+0x4D | caps, same order |

**45-row sections (row = character ID; DLC at ID - 1002)**
- Sec 3: `+9..19` start rank per skill (0 E, 1 E+, 2 D, 3 D+, 4 C, 5 C+, 6 B, 7 B+, 8 A, 9 A+, 10 S, 11 S+; the wiki leaves
  E blank), skill order Sword, Lance, Axe, Bow, Brawling, Reason, Faith, Authority, Heavy Armor, Riding, Flying;
  `+20..30` proficiency 1 weak, 2 normal, 3 strong.
- Sec 5: `+0..19` skill index per slot, `+20` personal ability, `+21` upgraded personal ability, `+22..41` learned
  ability IDs (0xFF empty), `+42..61` rank at which each is learned.
- Sec 7: `+0..9` art IDs (0xFF empty), `+10..19` skill index, `+20..29` rank.
- Sec 4: `+0..4` faith rank, `+5..9` reason spell IDs, `+10..14` faith spell IDs, `+15..19` reason rank.
- Budding sec 11 (240 rows; padding rows use ID 2999): `u16 character ID`, `+2` EXP needed, `+3` skill index,
  `+4` art ID or 0xFF, `+5` ability ID or 0xFF.

**fixed_classdata sec 0 (row = class ID, 118 bytes)**
- `+0x10` HP boost; `+0x14` HP growth, `+0x15..0x1D` growths Str..Cha; `+0x27..0x2F` boosts Str, Mag, Dex, Spd, Lck,
  Def, Res, Mov, Cha (signed); `+0x30..0x38` mounted changes, same order (signed);
  `+0x39..0x43` class skill EXP bonus per skill (skills with > 0 are the class's "proficient" skills);
  `+0x45` tier (1 Beginner, 2 Intermediate, 3 Advanced, 4 Master, 5 DLC, 0 or 6 Unique); `+0x4B` base HP;
  `+0x51` type bits (1 infantry, 2 armored, 4 cavalry, 8 flying); `+0x52` property bits (010 template: mounted,
  hand to hand, flying, magic; not compared); `+0x55..0x5B` base Str, Mag, Dex, Spd, Lck, Def, Res.
- Base Mov = `4 + boost Mov (+0x2E) + mounted Mov (+0x37)`. The constant 4 is not in the table.
- Sec 1: `+0` byte that is not the level (0 / 20 / 32 / 40), `+1` seal item (item ID = 1000 + byte: 3 Intermediate,
  4 Advanced, 6 Master, 255 none, 157-159 other seals), `+2/+3` gender flags (`+2` = 1 and `+3` = 0 male-only,
  `+3` = 1 female-only, `+3` = 2 any), `+4..14` required rank per skill (0 = none).
- Sec 2: level per tier `[0, 5, 10, 20, 30]` (tier byte indexes it; DLC tier 5 = 20).
- Sec 3: `+0` mastery ability, `+1` mastery art, `+2..4` class abilities (0xFF none).

**fixed_data**: item/spell rows (24 bytes) use these fields: `+0` weapon type (1 sword,
2 lance, 3 axe, 4 bow, 5 gauntlets), `+5` skill, `+6` rank (0 E to 4 A), `+7` max range, `+0xA` min range, `+0xB` uses,
`+0x10` Mt, `+0x11` Hit, `+0x12` Crit, `+0x13` Wt, `+0x16` flags. A spell max range >= 100 encodes a formula
(100 Mag/2, 111 and 121 Mag/4, 130 all). Equipment (sec 5): amounts `+2`, `+3`; effect types `+20`, `+21`
(3 HP, 4 Str, 5 Mag, 6 Dex, 7 Spd, 8 Lck, 9 Def, 10 Res, 11 Mov, 12 Cha). Arts (sec 7, 18 bytes): `+3` Mt, `+4` Crit,
`+5` Hit, `+0xA` cost (signed).

**fixed_skill sec 0 (255 x 15)**: amounts `+0..2` (signed), `+3` weapon type needed (0xFF any), effect types `+0xA..0xC`.

**fixed_growthdata sec 2**: u16 per rank in order E, E+, D, D+, C, C+, B, B+, A, A+, S, S+ (last 0).

4. Names and descriptions are in `msgdata.bin` ([text](text.md)). The tables refer to them by index (name ID, class ID,
   ability ID, item ID, art ID, spell ID); these are row-aligned with the text lists.

## Class type bits

Class sets by `+0x51` bit (class IDs in brackets):
- Armored (0x02): Armored Knight 9, Armored Lord 56, Emperor 40, Flame Emperor 47/48, Fortress Knight 21/52,
  Great Knight 34.
- Cavalry (0x04): Bow Knight, Cavalier, Dark Knight, Death Knight 59/91, Great Knight, Holy Knight, Paladin 22/51,
  Valkyrie.
- Flying (0x08): Barbarossa, Dark Flier, Falcon Knight, Pegasus Knight 23/54, Wyvern Lord, Wyvern Master, Wyvern Rider,
  plus monsters (Flying Demonic Beast, Giant Bird, King of Wings, White Beast).

Several class names occur at two IDs (Lord 6/53, Thief 8/49, Fortress Knight 21/52, Paladin 22/51, Pegasus Knight
23/54, Death Knight 59/91, Flame Emperor 47/48, The Immaculate One 72-74), so name matching is ambiguous; key by ID.

## Not decoded

- Not in the tables: recruitment prose, class restriction text, the any-of flag for classes with several requirements
  (inferred). Ability, art and crest descriptions are text ([text](text.md)). Age (+0x1B), birth month and day
  (+0x1C, +0x1E) and height (+0x2F, +0x30) are decoded and exported to `data/characters.json`.
- Recruitment stat/skill requirements not located; probably in scripts (`scrdata.bin`).
- Skill EXP gain amounts (Attack, Instruct, Group Task...) and per-level EXP not located. Candidates: growthdata
  sections 0, 1, 5, 7 and the small `fixed_data` sections 9-15. Unverified.
- Battalions: `fixed_data` s11 (200 x 44) supplies the imported reference fields; current runtime state is separate.
- Base Mov constant 4 is not in a table.
- Consumable/misc item numbers (IDs 1000+): data is likely in unexamined `fixed_data` sections 2-4 and 6.
- Tables come from the patch4 loose files; read patch files before DATA entries.

## Extended table fields

The importer exports battalion endurance, eight modifiers and five-level progression from section 11, plus gambit
parameters from section 3 and maximum uses from section 8. Section 8 `+0x0A` is the gambit's area shape and section 3
`+0x04` its effect (support effects centre radius areas on the user and pick the support icon); both are exported as
the gambit's area and icon, see [Battalion integration](../battalions.md#imported-reference). Current level, endurance and remaining uses are not read
from memory; see [Battalion integration](../battalions.md). Gift item rows hold price, lost-item flag and owner person id (not exported). Class certification rows hold the seal item, gender,
selectability and skill rank numbers; the level comes from the tier table. The any-of rule for beginner
classes with multiple requirements is inferred. Class descriptions are at text index 3554 plus the class id.
Equipment descriptions are at text index 4606 plus equipment id. Some later item descriptions are empty in the
text table.

Equipment section 5 has 24-byte rows. `+0x10` is protection and `+0x13` is weight: Leather through Silver
increase from 1 to 4 in both, while Talisman Shield distinguishes them (1 protection, 4 weight); Aegis Shield
has 6 of each. The two effect slots pair signed amounts at `+0x02/+0x03` with types at `+0x14/+0x15`.
Types 3–12 are the existing stat codes; 14 is hit, 15 crit, 16 avoid and 19 resilience. Accuracy, Critical,
Evasion and Speed Rings identify these typed effects, and the Talisman, Hexlock and Aegis Shields identify
resilience. Other effect types, including healing and crest-dependent effects, are not decoded here; `+0x0B` is 100 throughout these equipment rows, so equipment durability is not verified. Equipment might,
strength bonuses and any ability IDs are also unverified.

Consumable section rows already expose uses at `+0x0B` and a context-dependent amount at `+0x10`. Vulnerary,
Concoction and Elixir store 10/20/99 HP; permanent-stat items store their stat amounts. The amount is not always
the described number (Pure Water stores zero), so `+0x10` is not a universal healing or effect value.

### Equipment effect slots (fixed_data section 5, 24-byte rows)

Two effect slots: type at +0x14 with value at +0x02, and type at +0x15 with value at +0x03. Prot is at +0x10 and weight at
+0x13; equipment has no durability. Types:

| Type | Meaning | Value |
|---|---|---|
| 3-12 | stat bonus (hp, str, mag, dex, spd, lck, def, res, mv, cha) | signed amount |
| 14 / 15 / 16 / 19 | hit / crit / avoid / resilience | signed amount |
| 23 | magic might | amount |
| 27 | spell range | amount |
| 29, 91 | HP restored each turn | percent |
| 33 | Miracle | 1 |
| 34 | nullify class-type weaknesses | CLASS_TYPES bits |
| 35 | damage taken from monsters | percent (50 = halved) |
| 36 | negate foes' critical hits | 1 |
| 37 | heal power | amount |
| 55 / 57 | EXP / skill EXP gain | percent |

Still unknown: types 46 (Fetters of Dromi) and 85 (Chalice of Beginnings). Goddess Ring stores Luck 4. Slots 43-49 are unused (placeholder names, no description).
