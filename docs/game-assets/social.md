# Game assets: supports, gifts, lost items and meals

Inputs: base game + update 1.2.0 RomFS (`patch4/nx/data/fixed_*.bin`; no patch file overrides these in DATA).
Strings are referenced by index only.

## Summary

- **Support pairs and reachable ranks: found, verified.** `fixed_persondata.bin` section 10: 270 rows, 267 real pairs.
- **Gift preferences and lost items: found, verified.** `fixed_presentdata.bin` section 1: one 17-byte row per
  character.
- **Meal recipes and preferences: found, verified.** `fixed_lobby_activity.bin` sections 1 and 2; see Dining below.
- **Not decoded:** meal events, tea preferences and tea topics, faculty training and advanced drills.

## Sources found

| What | Where | Format | Status |
|---|---|---|---|
| Support pairs + reachable ranks | `patch4/nx/data/fixed_persondata.bin`, section 10 (270 rows x 0xC) | rows below | verified |
| Gift likes/dislikes, lost items (per character) | `patch4/nx/data/fixed_presentdata.bin`, section 1 (45 rows x 0x11) | rows below | verified |
| Gift/lost item table (price etc., per item id 0-244) | `fixed_presentdata.bin` section 0 (245 rows x 0xC), section 2 (45 x 0x30), section 3 (10 x 2) | unread beyond first u16 | likely (names resolve via item id) |
| Gift/lost item names | `common/common/msgdata.bin` (patch4), language 1, file 2: pool string `10147 + item id` | NUL-split pool | verified |
| Dish names | same pool, `9857 + dish id` (0-31) | | verified |
| Imported meal names | indexed file 2 strings `9852 + dish id` (0-31), category `meal` | excludes unused slots | verified |
| Tea names | same pool, `5253 + tea id` (0-17) | | likely (names only) |
| Meal recipes | `fixed_lobby_activity.bin` (DATA entry 26), section 1 (100 x 18) | first 32 rows; material IDs and quantities | verified |
| Meal preferences | same file, section 2 (100 x 45) | first 32 rows; one signed byte per character column | verified |
| Ingredient names | indexed file 2 strings `5056 + material id` (96-164), category `ingredient` | fish, crops and meat | verified |
| Teas, tea topics, drills | not found | | not found |

Section format (as in [tables](tables.md)): `u32 n`; then `n` (offset, size) pairs of u32 at +4; at each table
section a `00 19 12 16` tag, `u32 count` at +4, `u32 stride` at +8, rows at section + 0x40.

### Support row (`fixed_persondata.bin` section 10, stride 0xC)

| Offset | Size | Meaning |
|---|---|---|
| +2 | u16 | character A id (0 = Byleth, both genders; 2-34 students/staff; 35 Jeralt; 36 Rhea; 1040-1046 DLC: Yuri, Balthus, Constance, Hapi, Aelfric, Jeritza, Anna) |
| +4 | u16 | character B id (same ids; DLC ids make byte +5 = 4) |
| +8 | u8 | unknown (0, 0x2D, 0x4B, 0x5A, 0x69, 0x78; looks like a growth/gain value) |
| +9 | u8 | reachable ranks as a bitmask: 0x40 C, 0x20 C+, 0x10 B, 0x08 B+, 0x04 A, 0x02 A+, 0x01 S. 0x80 is an always-on-ish flag. |
| +10 | u8 | unknown (1, 2, 3, 7) |

Rows `0xFFFF` in A (rows 267-269) are empty. Byleth appears once (id 0), so the game does not say which of M/F can
S-rank; it marks S if either gender can. The three lord-trio pairs (Edelgard/Dimitri/Claude) exist with mask 0
(no ranks).

### Gift row (`fixed_presentdata.bin` section 1, row = character id, stride 0x11, 0xFF = empty)

| Offset | Meaning |
|---|---|
| +0 | one extra liked item (flowers and other personal gifts; id >= 0xC5) |
| +1..+3 | the 3 lost items |
| +4..+6 | disliked gifts (up to 3) |
| +7..+11 | liked gifts (up to 5; plus the one at +0) |
| +12..+16 | other quest items (herbs, love letters, tea set, Gladiolus; not gifts) |

Item id -> name: pool string `10147 + id`. Rows: 2-34 are character ids; 35 Jeralt, 36 Rhea, 38 Yuri,
39 Balthus, 40 Constance, 41 Hapi, 43 Jeritza, 44 Anna (rows 0, 1, 37, 42 are empty: Byleth and Aelfric).

## How to extract

1. Read the file by the section format above. Use the newest of `patch4..patch1/nx/data/<name>` that exists, else
   the base `nx/data/`.
2. Support pairs: for each row of persondata section 10 with A != 0xFFFF, take `(A, B)` (order irrelevant) and
   decode ranks from byte +9. Byleth is the single id 0 row; 35/36 and 1040+ are NPC and DLC rows.
3. Gifts: for each character row read the bytes as in the table; look up names in the item-name pool.
4. Text: msgdata language 1 (English) file 2 is the item table; split the string area (starts at the first string
   offset, 0xF094 here) on NUL; do not index through the offset array (it holds mid-string offsets for later
   entries). Text decoding is in [text](text.md); this doc only needs the pool index formulas above.

## Not decoded

- Tea preferences and topics per character: not located. Earlier searches also missed meals in the fixed tables;
  the meal table is transposed (one row per dish, not per person). Recheck the actual layouts before ruling out a file.
- Meal events: not decoded.
- Faculty training and advanced drills: not located; `fixed_persondata` sections 3-9 (45 rows) hold per-student
  data (class, skills); not decoded.
- Tea topics are text in the pool; the per-character topic list was not located.
- Byleth S-rank gender split: not derivable (single row).

## Dining

For update 1.2.0, `fixed_lobby_activity.bin` section 1 has 100 rows with stride 18. Row 0-31 is the meal ID;
later rows are unused menu entries. At +0, +2 and +4 are three little-endian u16 material IDs. The corresponding
quantities are bytes +14, +15 and +16. A zero quantity means no ingredient; do not resolve the unused ID 0 as food.
Byte +13 is the menu ID (0-31 for these rows). Ingredient names use indexed message file 2 at `5056 + material ID`.

Section 2 has 100 rows with stride 45. Row 0-31 is again the meal ID. Each byte is a character's signed preference:
`01` liked, `FF` disliked, `00` neutral. Columns 2-34 are the base character IDs. Columns 38-41 and 43-44 map to
1040-1043 and 1045-1046; 0, 1, 35-37 and 42 are empty. Comparing all 32 meals across the 39 dining characters
matched all 1,248 entries in the prior reference. Row 32 is not a valid meal even though its preferences are nonzero.

The importer writes `data/meals.json`: `meals` contains `{id, name, ingredients: [{id, name, quantity}]}`;
`characters` contains `{character, liked: [meal ID], disliked: [meal ID]}`. The frontend resolves localized names
through `meal`, `ingredient` and `character_given`. Import format 3 marks older imports for reimport.
