# Character and generic portraits in the game dump

Entry ids, offsets, layouts and counts.

## Summary

- Every portrait is a 512x512 BC3 face texture in the user's dump: 1043 in base DATA entry **6123** and 115 in the
  loose Cindered Shadows file `patch4/nx/ui/still/face_school_normal_DLC.bin`.
- Entry 6123 and the DLC file are "still" packs: 1043 (base) and 115 (DLC) zlib-chunked G1Ts, one texture each. A face
  index runs 0..1042 in 6123 and continues at 1043+ in the DLC file (index 1043 = DLC item 0).
- The whole id to face chain is in `fixed_persondata.bin` (patch4): character id -> `AssetsID` (+0x18) -> AssetID row
  (section 1) -> portrait id -> Portraits row (section 16: 11 expression face indices) -> pack item. Expression 0 is
  the neutral face.
- Generic faces use the same tables: each generic person record points at the first portrait of its class+gender
  group; the other portraits in the group are the `_02`, `_03` ... variants. How the game picks a variant is not in
  the data files found.

## Sources found

| What | Where | Format | Status |
|---|---|---|---|
| Face art, base game (1043 items) | DATA entry 6123 (not patched) | pack: u32 count, count x (offset, size); each item a zlib-chunked G1T with 1 texture 512x512 BC3 (0x5B) | verified |
| Face art, Cindered Shadows (115 items) | `patch4/nx/ui/still/face_school_normal_DLC.bin` | same pack format, 512x512 BC3 | verified |
| Character id -> AssetsID | `patch4/nx/data/fixed_persondata.bin`, section 0, 0x50-byte records, u16 at +0x18 | binary table | verified |
| AssetsID -> portrait ids | same file, section 1 (600 x 18 bytes, 9 x i16) | binary table | verified (fields 2 and 4) |
| Portrait id -> face indices | same file, section 16 (600 x 24 bytes: 11 x i16 expressions + i16 flag) | binary table | verified |
| Small faces, 256x256 | entries 6126 (450 items), 6125 (98); DLC `face_btl_l_cmn_DLC.bin` (37) | same pack | likely (role inferred from size and look) |
| 3/4-pose uniform faces, 512x512 | 6127 (39), 6128 (40), 6124 (36); DLC `face_school_card_DLC.bin` (7), `face_war_card_DLC.bin` (7) | same pack | likely |
| Names `face_school`, `face_school_normal_DLC` | Only the four loose DLC files carry names (`face_btl_l_cmn_DLC`, `face_school_card_DLC`, `face_school_normal_DLC`, `face_war_card_DLC`, in `patch4/nx/ui/still/`). The strings `face_school`, `face_btl`, `face_war` do not occur in `patch_overrides.csv`, any loose file name other than those four, `nx/data`, `common/`, `nx/ui` of the patches, or the decompressed DATA unknown and small pack entries searched | n/a | base-game file names are probably only in the main executable, which the dump lacks |

The base DATA entries carry no names (DATA0 has only offsets), so 6123 = `face_school_normal` is inferred from the
DLC file continuing its index range (1043 + item) and having the same item format and size. Field names come from the
community template three-houses-research-team/010-binary-templates `PersonData.bt`; its AssetID field order did not
match the data, so the fields below were checked against image matches.

## How to extract

1. Read DATA0 record `<4Q>` (offset, size, stored, compressed) and DATA1 bytes as for any DATA entry.
2. Un-chunk, with one extra rule. Header: u32 chunk size (0x10000), u32 count, u32 total, then `count` u32 stored sizes;
   chunks are 0x80-aligned from the start of the item. A chunk whose stored size equals its decompressed size
   (`min(chunk size, total - done)`) is stored raw: no length prefix, no zlib. Without the rule about half of the items
   fail ("Error -3 while decompressing") because their last short chunk is raw. It may also explain part of the catalog's 97 `err` entries (not checked).
3. Pack: `n = u32 @0`, then n pairs `(offset, size)` from +4. Each item is a chunked G1T. Decode texture 0 (format 0x5B, BC3). Keep the alpha channel (transparent background).
4. Load `fixed_persondata.bin` from the newest patch (`patch4/nx/data/`). Header: u32, then `(ptr, size)` pairs. Each
   section has a 0x40 header with `count` at +4 and `stride` at +8; records start at +0x40. Section 0 = people
   (1201 x 0x50), 1 = AssetID (600 x 18), 16 = Portraits (600 x 24); section 16 is at 0x1E670 in the 1.2.0 file.
5. Named character: `a = u16 @ person+0x18`; `row = AssetID[a]` (9 x i16). `row[4]` = Part 1 portrait id,
   `row[2]` = Part 2 portrait id; -1 = none. `row[0]` (portraits 100..102 for Edelgard, Dimitri, Claude) and
   `row[6]` (506/507 for Byleth) are further single-texture looks. Constance: `row[4]` = 554
   (`constance`), `row[2]` = 560 (`constance_3`); `constance_2` is 555 and `constance_4` is 561 (not referenced by her
   row).
6. `Portraits[p]`: 11 i16 face indices (expression 0..10, -1 unused) then an i16 flag. Index below 1043 is item `index`
   of entry 6123; 1043 or more is item `index - 1043` of the DLC file (skip if the DLC file is absent). Element 0 is
   neutral.
7. Output element 0. No crop is needed: the texture is the finished bust on a transparent background. Scale to 256 if
   wanted. (Expression variants are the other elements; layers for eyes or mouth do not exist, each expression is a
   full texture.)

### Generic faces

- Generic people are records 100..1200 of section 0. `person+0x1A` = class id, `person+0x26` = gender, and
  `AssetID[a][4]` = portrait id of the first face of that class+gender group (197 myrmidon m, 205 myrmidon f, 209
  soldier, 221 fighter, 233 monk, 245 mercenary, 257 thief, ...). 119 distinct start ids are used.
- A group is the run of single-expression portraits from its start id to the next group's start: `generic/myrmidon_01`
  = 197, `_02` = 198 ... `_08` = 204, `myrmidon_f_01` = 205. The `_NN` suffix is the order within the run.
- Which variant a unit shows is not in these tables (persondata always references the `_01` portrait).

## Examples

| Portrait | Portrait id | Source | Face index |
|---|---|---|---|
| byleth_m / byleth_m_2 | 0 / 71 | 6123 | 0 / 394 |
| byleth_f / byleth_f_2 | 1 / 72 | 6123 | 6 / 400 |
| edelgard / edelgard_2 | 2 / 73 | 6123 | 12 / 406 |
| dimitri / _2 / _3 / _4 / _child | 3 / 74 / 99 / 98 / 58 | 6123 | 18 / 412 / 576 / 570 / 334 |
| claude / claude_2 | 4 / 75 | 6123 | 24 / 423 |
| hubert, ferdinand, linhardt, caspar | 5, 6, 7, 8 | 6123 | 30, 36, 42, 49 |
| edelgard_child / hegemon_edelgard | 59 / 547 | 6123 | 339 / 1038 |
| rhea / seiros | 36 / 57 | 6123 | 226 / 329 |
| constance, _2, _3, _4 | 554, 555, 560, 561 | DLC file | item 25, 31, 60, 66 |
| yuri / yuri_2 | - | DLC file | item 13 / 48 |
| balthus / balthus_2 | - | DLC file | item 19 / 54 |
| hapi / hapi_2 | - | DLC file | item 37 / 72 |
| aelfric, anna_2, jeritza_2 | - | DLC file | item 43, 7, 0 |
| immaculate_one, _2, _3 | 539, 540, 541 | 6123 | 1030, 1031, 1032 |
| black_beast, wandering_beast, umbral_beast, immovable, wind_caller | 527, 528, 597, 543, 542 | 6123 / DLC (umbral_beast is DLC item 112) | 1018, 1019, -, 1034, 1033 |

Face set sizes vary (6 or 7 expressions among the first characters), so the face index is never `id * 6`; always go
through the Portraits table.

## Gaps and what is still needed

- Base-game names for 6123-6128: only the DLC copies have names in the dump. A string search of the main executable (not
  in the dump) would confirm that 6123 is `face_school_normal`.
- Roles of 6124-6128 are inferred; the tables that index them were not located.
- The rule for choosing a generic variant (`_01` to `_08`).
- In the game tables, ids 70 and 71 use child Dimitri and Edelgard art (58, 59), id 58 uses Seiros (57), and ids 36,
  48, 49, 74 have no Part 2 portrait.
- Catalog entries 6159-6200 are small UI tables and were not decoded.

## Person and expression lookups

`data/portraits.json` includes `persons` keyed by person id with name and neutral face path (only for people whose face was written).
Generic people reference the first portrait for their class and gender; the actual in-game variant is unresolved.
Playable character entries include `expressions.part1` and `expressions.part2`, lists of existing face paths or
null slots. Expression meanings beyond the neutral slot are unverified.
