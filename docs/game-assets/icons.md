# Game assets: UI icons (abilities, combat arts, magic, crests, other icon sets)

Research notes for the standalone importer. Entry ids, offsets, layouts, ids, counts and how to verify. All paths are
RomFS paths in the user's own dump.

## Summary

- Ability, combat art and magic icons are **pixel crops of the game's own atlas**: DATA entry **6026**, texture 2
  (2048x2048, BC3), plus the Cindered Shadows patch atlas `patch4/nx/ui/700_patch/700_patch.g1t.gz` texture 1
  (2048x1024). A tile is 94x94 on a 100 px grid.
- Coverage: **abilities 218 located** (204 in 6026 tex2, 11 in 700_patch tex1, 3 are the star tiles / Lily's Poise
  in 6026 tex2), **combat arts 6**, **magic 3**. The game's crest *glyphs* are the 22 purple tiles in **6026
  texture 1**. A cream disc badge with a "Crest" banner was not found in any atlas searched.
- The id-to-tile selection for abilities is a table field in the data files, not in the executable:
  `nx/data/fixed_skill.bin` section 0 (255 rows of 15 bytes, ability id = row), **byte +0x08 is the icon index**.
  Turning an icon index into a rectangle needs a rectangle table that lives in the main executable (the table at main
  `0xD52D60`, which the importer reads directly). The index to rectangle mapping was recovered empirically for 210
  indices.
- Items and spells use the main-executable selector and the table at main `0xD52D60`.

## Sources found

| What | Where | Format | Status |
|---|---|---|---|
| Ability icons (204 of 218) | DATA 6026 texture 2 | 2048x2048 BC3, 94x94 tiles | verified (pixel match) |
| Ability icons, tiles on grid | 6026 tex2: tile (col,row) at x = 100*col+1, y = 33+100*row, rows 1..19, cols 0..19 | | verified |
| Ability icons, one off-grid strip | 6026 tex2, y = 133, x = 529, 629, 729, 828, 928, 1030, 1130, 1230, 1330, 1430, 1529, 1629, 1729, 1829, 1929 (pitch about 100, x not on the 100 grid): Bow Prowess 2-5, Brawling Prowess 1-5, Reason 1-5, Faith 1 | | verified |
| Ability icons, Cindered Shadows (11: Lucky Seven, Transmute, Honorable Spirit, King of Grappling, Circadian Beat, Monstrous Appeal, Umbral Leech, Manifest Phantom, Enhanced Fortitude, Duelist's Blow, Uncanny Blow) | `patch4/nx/ui/700_patch/700_patch.g1t.gz` texture 1 (2048x1024); tiles at about x 1138-1952, y 425-873, 100 px pitch (refine to the 94 px tile when extracting) | file is chunked zlib (`unchunk`), not gzip, despite the name; BC3 | verified |
| Combat art icons (6, one per weapon type: sword, lance, axe, bow, brawling, other) | 6026 tex2 row 17 (y = 1733): x = 1301, 1401, 1501, 1601, 1701, 1201 (sword, lance, axe, bow, brawling, other) | | verified |
| Magic school icons (3: black, dark, white) | 6026 tex2: black (1,1633), dark (101,1633), white (1901,1533) | | verified |
| Personal / other / Lily's Poise (star tiles) | 6026 tex2 (1802,1733), (1902,1733), (701,533) | | likely |
| Crest glyphs (22) | 6026 texture 1 (512x512 BC3), 100 px pitch, 5 per row, reading order, row 5 has two; a 23rd frame-like tile follows (a chevron/arrow symbol) | purple tile with white glyph | verified present; id mapping likely |
| Crest badge (cream disc + "Crest" banner) | not found | | **not found** |
| Weapon-skill / weapon-type tiles, rank-style letters, equip marks | 6026 tex0 (1024x1024) | | verified |
| Rank letters E..S (12 stamps), grade stamps | 6026 tex2 row 0 (y 0-100), 6026 tex0 bottom-left A B C D S | | likely |
| Item / native item icons | 6026 tex2 via main rect table | | verified |
| House emblems | 6026 tex8 (2048x2048); banners 6062 tex7, 400_abbey tex8 | | verified |
| Controller button glyphs (A B X Y, D-pad, L R ZL ZR, stick clicks, +/-, home) | 6026 tex9 (512x512) | | verified present |
| Battle UI (status symbols, arrows, rank pips, minimap tiles, phase banners, damage numbers, HIT/MISS) | 6050 tex1 (symbols, 1024x512), tex2 (banners), tex6, tex8 (digits), tex9 (phase banners), tex10 (minimap tiles) | language variants 6050-6061 | verified present |
| Map UI | 6050 tex11 (weapon silhouettes, range marks) | | likely |
| Monastery UI (calendar digits, weekday, activity icons, glowing frames) | 6062 tex2 (2048x2048); 400_abbey tex4 | variants 6062-6073 | likely |
| Tea time / battalion-like UI frames | 6062 tex7 (banners), 400_abbey tex8, 6086 (frames) | | likely |
| Title / backgrounds / portraits (not icons) | 6038 (title art), 6026 tex11-14 (house leader faces), 700_patch tex5-17 (DLC faces) | | seen |
| Language variants | 6026-6037, 6050-6061, 6062-6073: same texture layout per language (catalog signatures); pixels between variants not diffed | | not compared |

## How to extract

1. Read DATA0 record `<4Q>` (offset, size, stored, compressed) for entry 6026 from `DATA0.bin`, read from `DATA1.bin`.
   If `compressed`, decode with the zlib chunk reader. Always apply the newest patch override from
   `patch_overrides.csv` for the entry id (6026 is not overridden in patch1-4).
2. Parse the G1T (`GT1G`): texture table offset at +0x0C, count at +0x10, per-texture header byte +1 = format
   (0x5B BC3), +2 = log2 width (low nibble) and height (high nibble), data after the 0x0C header.
3. For an ability: read `nx/data/fixed_skill.bin` from the newest patch (patch4). Header = `u32 count`, then
   `(offset, size)` pairs; section 0 starts with tag `00 19 12 16`, `u32 count` (255), `u32 entry size` (15), rows start
   at section offset + 0x40. Row layout seen: +0..2 effect amounts, +3 weapon type, **+0x08 icon index** (u8), +0x0A
   category/type. Row +0x04 is a second field that equals the icon index except where abilities share art.
4. Icon index to rectangle: the rectangle comes from a table in main (not in the dump). The empirical mapping: for
   indices 0..255 the tile order follows the index in runs: e.g. indices 31-82 are grid cells starting at (0,2) in
   reading order (cell = index+9 on a 20-column grid, rows from y=33), indices 1-12 are row 12 from (3,12), index 0 is
   (7,13), 13-14 are (8,13),(9,13); it breaks wherever empty cells are skipped. 210 indices are verified.
5. For the 11 Cindered Shadows abilities use `700_patch.g1t.gz` texture 1 (icon index 238-250; the order on the
   atlas is not by index).
6. Crop 94x94 at the tile origin (alpha edges: keep, the glow reaches the border), scale to the UI size.
7. Crests (finding; the importer instead crops the icon-table rect for sprite `0x7A + crest id` from texture 1): crop 6026 texture 1, 100x100 cell `(col*100, row*100)`, `col = i % 5`, `row = i // 5` for glyph index `i`
   0..21. The game reaches these through the item sprite selector as `0x7A + crest id`.

Verify a step by rendering the cropped tile and checking it by eye against the in-game icon.

## Ability icon index notes

The game has 250 abilities; 35 of them use the personal or other star tile in some listings: ids 92-94, 96, 98, 99,
101, 102, 104, 131, 134, 135, 137, 141, 151, 193-198, 209-218, 234, 236, 237, 245. They do have an icon index in
`fixed_skill.bin` (+0x08), so they are covered once the rectangle for that index is known (indices below 236 sit on
6026 tex2).

Crest glyph to crest similarity (white-on-purple glyph vs dark glyph on the badge, intersection over union, after
normalising size): strong for 13 of 22, so the glyph set is the same symbols; weak for the rest:

| Crest | Glyph index | IoU | | Crest | Glyph index | IoU |
|---|---|---|---|---|---|---|
| Aubin | 12 | 0.68 | | Goneril | 10 | 0.49 |
| Charon | 16 | 0.60 | | Seiros | 2 | 0.48 |
| Gautier | 13 | 0.58 | | Indech | 14 | 0.47 |
| The Beast | 15 | 0.58 | | Daphnel | 7 | 0.46 |
| Timotheos | 17 | 0.58 | | Gloucester | 9 | 0.41 |
| Cichol | 11 | 0.54 | | Lamine | 20 | 0.36 |
| Blaiddyd | 8 | 0.53 | | others (Cethleann, Chevalier, Dominic, Ernest, Flames, Fraldarius, Macuil, Noa, Riegan) | | below 0.30, unconfirmed |

The dump's `0x7A + crest id` (0x7A = 122) selector for Dragon Signs points at texture 1 of 6026 (22 glyph tiles). No
second set of sprites for minor crests was found in the dump.

## Icon atlas inventory (one line each)

| Entry / texture | Contents | Tile / size |
|---|---|---|
| 6026 tex0 | weapon-skill tiles (sword, lance, axe, bow, gauntlets, magic, flying, armor, cavalry...), grade letters, small UI glyphs | 1024x1024, mostly 94 px tiles |
| 6026 tex1 | 22 crest glyphs (+ one arrow symbol) | 512x512, 100 px cells |
| 6026 tex2 | ability, combat art, magic, item, status-symbol and rank tiles | 2048x2048, 94 px tiles on 100 px grid, y offset 33 |
| 6026 tex3 | one-off text strip | 2048x256 |
| 6026 tex4 | white shapes, "FIN" title, gauges and colour swatches | 2048x1024 |
| 6026 tex8 | house emblems, banners, crest shields | 2048x2048 |
| 6026 tex9 | controller button glyphs | 512x512, 64 px cells |
| 6026 tex10 | faint house crest art (background) | 1024x1024 |
| 6026 tex5-7, 11-14 | parchment, backgrounds, house leader faces | various |
| 6050 tex1 | battle status/state symbols, small icons (pause, play, fast-forward, lock, camera, arrows) | 1024x512, 20-40 px |
| 6050 tex2, 6, 3 | battle banners, name plates | 2048x1024, 1024x1024, 512x512 |
| 6050 tex8 | digit sets | 512x256 |
| 6050 tex9 | phase banners | 1024x1024 |
| 6050 tex10 | minimap tiles and colour squares | 1024x512 (rects from the battle UI table in `main`) |
| 6050 tex11 | weapon silhouettes, range shapes | 1024x512 |
| 6062 tex2, tex3 | monastery UI: calendar digits and weekdays, activity icons, gauges, buttons | 2048x2048 |
| 6062 tex7 | house banners, tea-time text | 2048x2048 |
| 6062 tex12 | house shields (crest frames) | 1024x1024 |
| 6086 | frames, plates, cursors | many small textures |
| 700_patch tex1 (patch4 loose) | 11 DLC ability icons, DLC UI frames | 2048x1024 |
| 700_patch tex0, 2-4 | DLC frames and masks | 512x512 |
| 400_abbey (patch3) | monastery UI duplicates, house banners, tea-time text | per-language file |
| 201_title_patch, 401_abbey_minimap | title art, minimap | |

Not located: weapon rank icons as separate sprites (rank letters are the 12 stamps in 6026 tex2 row 0 and tex0),
terrain icons (terrain is a minimap tile set in 6050 tex10), battalion icons, gift-category icons beyond the monastery
atlases (6062 tex2 likely). Item category icons are among the 6026 tex2 tiles (the native selector).

## Gaps and what is still needed

1. **Rectangle table in main.** The ability icon index (`fixed_skill.bin` +0x08) is clean data. The extractor reads
   the index-to-rectangle table at `0xD52D60` from ExeFS `main`.
2. **Dragon Sign / crest selector.** `0x7A + crest id` gives 122 and up, but the ability icon indices already use
   those same numbers (e.g. index 122 is a tile in 6026 tex2), so they must be different tables or flagged ids. The
   item sprite selector is implemented in `item_sprite_id`. The crest tile order (glyph index = crest id) is likely,
   not confirmed; the crest id order in the game's crest names still needs checking.
3. **Crest badge art.** The cream disc with the "Crest" banner was not found in 6026, 6038, 6050, 6062, 6074, 6086,
   6097, 6110, 71, or the 700/400/201/401 patch atlases. Possible places: UI layout archives
   (`patch*/nx/ui/layout/**/*.arc`), nested G1T inside the `unknown`-kind DATA entries, or the character-status screen
   archives. Otherwise the glyph from 6026 tex1 can be drawn on a frame of the app's own (the glyph recolours cleanly:
   white on alpha).
4. **Combat art selector.** The six art icons are per weapon type; which weapon type an art uses is in the art table
   (`fixed_data.bin` section 7, 80 rows of 18 bytes) only indirectly (the table has no icon field; the weapon comes
   from the item data).
5. **Cindered Shadows icon index order.** The 11 DLC abilities have icon indices 238-250 (240 and 245 unused) but are placed on 700_patch
   tex1 in a different order (e.g. index 239 at x 1637, index 238 at x 1737). Solved: the importer lists their coordinates
   (`DLC_ABILITY_TILES` in `exe_tables.py`).
6. 97 DATA entries fail zlib chunk decode; none were relevant to icons.
