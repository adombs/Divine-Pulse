# Game text (msgdata.bin)

Format notes for the importer. Game: FE3H 1.2.0 RomFS dump. No game text is reproduced here, only layouts and
indices (short names appear as examples).

## Summary

- All UI, name and description text lives in one file, `patch4/common/common/msgdata.bin` (9,586,308 bytes), which
  overrides DATA entry 0 (`patch_overrides.csv`). Plain UTF-8, no compression, no encryption.
- 12 languages x 4 text files. **Every language has the same file count and the same string count per file
  (100 / 6806 / 15397 / 442), so one index rule works for all languages.**
- Names for every category are the game string at a fixed base index plus the game ID (table below). Generic and NPC
  names go through the person row's name ID (`fixed_persondata.bin`, +0x12).
- Not in msgdata: birthdays, ages, heights (only the labels "Height", "Likes", "Dislikes" exist; values are numbers
  in other tables), support pair lists, gift preferences, route/scenario IDs.

## Sources found

| What | Where | Format | Status |
|---|---|---|---|
| All message text | `patch4/common/common/msgdata.bin` (newest patch; DATA entry 0 is the older copy) | container below | verified |
| Per-event dialogue | `patch*/nx/event/talk_event`, `talk_castle`, `talk_scinario` `/text/<LANG>/*.bin` | different container: u32 1, u32 1, u32 0x20, size, then a table padded with `0xEEEEEEEE`; not decoded | likely, not decoded |
| Language folders | `JP ENG_E ENG_U GER FRA_E FRA_U ESP_E ESP_U ITA KOR TWN CHN` | same names as the msgdata languages | verified (names) |
| Person rows (name IDs) | `patch4/nx/data/fixed_persondata.bin` section 0 (0x50-byte rows, name ID u16 at +0x12) | 0x40 section header, see [tables](tables.md) | verified |
| Community refs | Progenitor numbering ("msgData/1.bin" idx 9498 = factions, 9590 = crests) equals **file 2** here (the 100-string file 0 is skipped or numbering differs) | | verified by index |

## Container layout

```
u32 nlang = 12; nlang x { u32 offset (absolute), u32 size }
language blob: u32 nfiles = 4; nfiles x { u32 off, u32 size }   (relative to the blob)
text file:
  +0x00 u32 0x134c58            (constant)
  +0x04 u32 size | 0x10000
  +0x08 u32 count | (flags<<16)  count = low 16 bits: 100 / 6806 / 15397 / 442
  +0x0c u32 0x14                 (offset base for the table)
  +0x10 u32 0xffffff00
  +0x14 count x u32 string offset, relative to 0x14
  then NUL-terminated UTF-8 strings (empty string = a lone NUL; many slots are empty or "TBD")
```

Language order (12): 0 JP, 1 ENG_E, 2 ENG_U, 3 GER, 4 FRA_E, 5 FRA_U, 6 ESP_E, 7 ESP_U, 8 ITA, 9 KOR, 10 TWN, 11 CHN.
The order inside the _E/_U pairs is inferred (language 6 has Spain wording "gafas/taberna/Convoy", 7 has Latin
American "lentes/posada/Carro"). ENG_E and ENG_U have identical text except 16 (file 1) + 66 (file 2) slots that are
blank in one of them (placeholders such as "Crops 24", cooking prompts); FRA likewise. ESP differs genuinely (146 / 502
/ 28 strings). Use whichever pair member is non-empty; for English either works.

Control codes: `\n` (0x0A) line breaks, and ESC (0x1B) sequences: `\x1b%s1 %s2 %s3` (name args), `%d1 %d2`
(numbers), `\x1bC1 ... \x1bR` (colour on / reset), `\x1bS0`, `\x1bEK0/EL0/EM0` (icons), `\x1bQ`, `\x1bA6`,
`\x1bP0-4`. Strip or translate them for display. A few names carry a trailing space
(`Baron Dominic `) or a zero-width space (weapons, spells; strip U+200B).

## Index rules (language independent; F2 = the 15,397-string table, file index 2)

| Category | Rule | Count |
|---|---|---|
| Scenario / battle title | `F2[scenario_id]` | 100 ids (96 non-null) |
| Given name (chars 0-34) | `F2[1157 + char_id]` | 35 |
| NPC and generic names | `F2[1157 + name_id]`, `name_id` = u16 at +0x12 of the person row | 1000 slots |
| Middle name / surname (chars 0-34) | `F2[1731 + id]` / `F2[2305 + id]`; full name = given + middle + surname | 35 |
| DLC given names (1040-1044) | via person row name ID (= `F2[1707 + id - 1040]`) | 5 |
| Class name | `F2[3453 + class_id]` (female forms follow at 3553, e.g. War Cleric) | 100 |
| Class description | `F2[3554 + class_id]` | 100 |
| Item name (ids 1000+) | `F2[3656 + item_id]` | 55 |
| Item description (ids 1000+) | `F2[3856 + item_id]` (Vulnerary = 4856) | |
| Weapon name (ids 10-509) | `F2[3746 + id]` | 223 |
| Weapon description | `F2[4246 + id]` (Unarmed 4256, Iron Sword 4262) | |
| Equipment name / description | `F2[4556 + equip_id]` / `F2[4606 + equip_id]` | 50 |
| Terrain name | `F2[5502 + terrain_id]` (descriptions elsewhere, e.g. 5775, 5839) | 115 |
| Combat art name / description | `F2[6014 + art_id]` / `F2[6314 + art_id]` | 80 |
| Ability name | `F2[7236 + ability_id]` | 250 (+2 "TBD") |
| Ability description (also personal ability and budding talent text) | `F2[7536 + ability_id]` | |
| Spell name / description | `F2[7836 + spell_id]` / `F2[8136 + spell_id]` | 38 |
| Faction (allegiance enum) | `F2[9498 + id]` | 23 |
| Battalion name / description | `F2[9096 + id]` / `F2[9297 + id]` | 200 |
| Crest name | major `F2[9590 + i]` = "Crest of X", minor `F2[9612 + i]` = "Minor Crest of X", i = 0-21 (native enum) | 22 |
| Crest description | major `F2[9677 + i]`, minor `F2[9699 + i]` | 22 + 22 |
| Battle place names | list at `F2[957..984]` in map order (file 1 `6528-6600` has territory-qualified variants); scenario-id link not resolved | ~28 |

## How to extract (importer)

1. Open `romfs/patch4/common/common/msgdata.bin` (fall back to the newest `patchN` that has it, then DATA entry 0).
2. Parse as above and pick the language blob (the importer reads ENG_U for its tables and writes every language).
3. For each wanted category compute the index from the table, decode UTF-8, strip ESC sequences, trailing spaces and
   U+200B, and keep `\n` or turn it into a space.
4. Generic and NPC names: read `fixed_persondata.bin` section 0 (header u32 nsec, then nsec x (off, size); rows start
   0x40 after the section offset), take the u16 at +0x12, look up `F2[1157 + that]`.
5. Other languages: the same indices.

## Not decoded

- Profile facts (birthday, age, height), likes/dislikes, gift preferences, supports: values are not text; they sit in
  other `fixed_*.bin` tables (persondata, presentdata, shopdata...); see [social](social.md). Only the labels exist
  (file 1 "Height" #796, "Likes" #931, "Dislikes" #932).
- Crest proc rates and item/skill stats are table values, not text.
- Scenario id to place name link and chapter numbers.
- No US vs EU English spelling difference found; the `_E`/`_U` order is inferred.
- Event dialogue files.
