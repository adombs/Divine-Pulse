# 2D asset inventory of the game dump (topic `inventory`)

Research only. No images, no game prose.

## Summary

- The dump's DATA archive (base game + update 1.2.0 patches, and the Cindered Shadows DLC) holds 2,573 base entries
  and 181 DLC entries that contain G1T textures. Those entries hold 20,513 G1T files in total. 1,909 are top-level
  entries; the rest sit inside container entries (`pack?N` 759 entries, SCEN 47, RIVE 8).
- 25,736 textures were decoded to thumbnails (base 25,044, DLC 384, loose patch files 308). 143 textures used two
  formats the decoder of the time did not handle (`0x5E` 96, `0x03` 47; all in SCEN containers from entry 553 and
  661 onward). `0x5E` (BC6H) is decoded now (`g1t.py`); `0x03` is not. Decoded formats: BGRA8, BC1, BC3, BC6H, BC7.
- 2D UI art is concentrated in a few atlases: 6026 (icon atlas, 15 textures), 6050 (battle UI, 12), 6062 and its
  per-language siblings 6063-6073 (abbey/menu UI, 15), 6038-6049 (title, 4 each), 6109 (map sprites, 4), 6074
  (abbey minimap). 6026, 6050 and 6062 were checked by eye; 6038-6049, 6074 and 6109 were not (see the range table).
- Most of the rest is 3D model material (costume and armour UV atlases, normal maps), placeholder 1x1/4x4 textures
  (1,558 of them), and data-like maps (heat/ramp textures). None of that is UI art.

## Sources found

| What | Where (romfs) | Format | Status |
|---|---|---|---|
| G1T textures inside DATA entries (top-level) | DATA1 entries with `GT1G` at offset 0: 1,909 | G1T, BC1/BC3/BGRA8 (BC7 not seen in base) | verified (decoded) |
| G1T textures nested in containers | `pack?N` (759 entries), SCEN (47), RIVE (8) inside DATA entries | G1T at a non-zero offset; offsets inside the G1T are relative to its own `GT1G` | verified (found by magic scan; 20,513 hits) |
| Localised UI atlases 6038-6049 (title), 6050-6061 (battle UI), 6062-6073 (abbey UI) | DATA entries; patch overrides name `nx/ui/200_title`, `nx/ui/400_abbey` | G1T, BC3/BC1 | verified for 6026, 6050, 6062 (one language each viewed; others assumed same layout, not checked) |
| Icon atlas | DATA 6026 | G1T BC3, 15 textures | verified |
| Map sprites | DATA 6109 | G1T BGRA8, 4 textures | verified |
| Abbey minimap | DATA 6074; loose `patch4/nx/ui/401_abbey_minimap` | G1T BC3 | found (not viewed) |
| Loose G1T files in patches | 250 files: 217 `patch4/nx/action/texture` (model textures), 33 under `patch2-4/nx/ui` | zlib-chunked, named `.g1t.gz` (see How to extract) | verified (decode); 217 action textures are 3D model material, not viewed |
| Non-texture art containers (TM2 stills, .arc layouts, `still_event.bin`, `still_castle.bin`, `minimap.bin` 6122) | DATA 6122, 6143, 6145; patch `nx/ui/still*`, `nx/ui/layout` | raw, not G1T | found (not decoded here) |
| Fonts | DATA 71-75 (font atlases), loose `patch4/nx/ui/font/font00_JPN.g1t.gz`, `font02_CHN.g1t.gz` | G1T BC3 4096 px | found (not used) |
| Unit still icons | loose `patch3/nx/ui/still_station/still_icon_unit_P3.g1t.gz`, `patch4/.../still_icon_unit_P4.g1t.gz`, `still_station_DLC.g1t.gz` | G1T | found; likely portrait-type art, not viewed (see [portraits.md](portraits.md)) |
| DLC house emblems | loose `patch4/nx/ui/700_patch/700_patch.g1t.gz` (DLC romfs, 18 textures) | G1T BC3 | found |
| Non-G1T containers with no G1T inside | 21,213 `unknown` entries (no `GT1G` at any offset), KTSR 265 (audio), SPKG 132, DCL0 67, _OLS 53, SARC 52, KTSC 14, MDLK 4 (models), others | various | not reverse-engineered; kinds only |
| Failed zlib-chunk decode | 167 base entries (162 `incorrect header check`, 3 truncated, 2 other) | unknown compression | gap (see Gaps) |

Status key: verified = decoded and checked by eye; found = located and identified from headers or override
paths; gap = not solved.

## Range table

Entry numbers are DATA ids in `base` unless marked `dlc` or `loose`. "Textures" counts G1T textures inside the
range; "Viewed" says whether the textures were checked by eye. "App use" is a candidate only.

| Entry / range | Kind | Count | Description | App use | Viewed |
|---|---|---|---|---|---|
| 71-75 | g1t (font atlases) | 5 | Font atlases, BC3 4096 px; overrides name the JPN font for 71 and the CHN font for 73 | none | yes |
| 551-552 | g1t | 2 | 256 px flat textures, a 256x2 strip and 16x16 bits (BGRA8) | none | yes |
| 553 | magic:SCEN | 1 | Scenario container; its 2 textures use format `0x03` (not decoded) | none | no |
| 557 | pack | 4 | Mixed 256-512 px: normal map, greyscale noise and a ramp (BC1/BC3) | none | yes |
| 661-698, 721-722, 762-765, 774 | magic:SCEN | ~150 | Scenario-held BC1 512-2048 px grey/white masks and height/terrain-like layers; some 0x5E/0x03 (skipped) | none, likely map data (not verified) | yes |
| 885-917, 978, 993-1318 | pack, RIVE | ~30 | BC3 256 px pink noise tiles and RIVE animation containers | none | yes |
| 1377-1680 | g1t (4x4 and 512 px) | 192 + 69 + 19 + 21 | Mostly 4x4 BC1 single-pixel placeholders (1377-1568, 1640-1680); 1570-1638 are 512 px BC1 with mixed content | none for the 4x4 ones; 1570-1638 not viewed | partly (4x4 yes) |
| 2121-2128 | g1t | 8 | BC1 1024 px | unknown | no |
| 2185-2287 | g1t (4x4) | 103 | Mostly 4x4 BC1 placeholders | none | yes |
| 2391-2428 | pack | 507 | Normal maps (blue/purple), dark 1024-2048 px materials | none (3D material) | yes |
| 2451, 2484, 2492-2493 | pack | 24 | 1024 px BC1/BC3/BGRA8 mixes; 2493 has red mask and small coloured sprites | unknown | yes |
| 2494-2530 | pack | 12,155 | Mostly 128 px BC1 heat/ramp maps in red and yellow; 16 px dots | none (data/effect lookup, not art) | yes |
| 2555-2560 | pack | 4,435 | 128 px BC1 | unknown | no |
| 2595-2802 | pack | ~350 | Mixed 4x4 placeholders, 256-512 px BC1/BC3 | unknown | no |
| 3120-3534 | pack | ~700 | 1024 px BC1 costume and outfit UV atlases (dresses, shirts) with blue normal-map backgrounds, plus 4x4 and 128 px | none (3D character clothing) | yes |
| 3620-3642 | pack | ~50 | BC3 64 px and BC1 128-256 px | unknown | no |
| 5916-5926, 6022 | override paths name effect `.bin` files | - | Not checked for G1T content (override paths only) | - | no |
| 6026 | g1t (icon atlas) | 15 | Tex 0 item/skill tiles on dark; 1 ability icons on purple; 2 full item grid (2048); 3 strip; 4 status tokens; 5-7 parchment/grunge backgrounds; 8 house shields with crests (2048); 9 controller button icons; 10 wing/emblem set; 11-14 character face portraits (512, BC3) | items, skills, abilities, house crests, weapon/stat icons, menu backgrounds, portraits ([portraits.md](portraits.md)) | yes |
| 6038-6049 | g1t (title) | 4 each | Title screen, per language (2048/1024 BC3); overrides `nx/ui/200_title` | title art, maybe logo (not verified) | no |
| 6050 | g1t (battle UI, ENG/JP) | 12 | 0 level-up glow arc; 1 unit/class icon sheet; 2 level-up panel; 3 gauge frames and banners; 4 stage/battle text panels (JP); 5 result text; 6 window frames; 7 arrow/bracket bits; 8 digit font; 9 phase banners; 10 minimap pieces; 11 small frames and weapon marks | phase banners, frames, digits, minimap pieces | yes. 6051-6061 not checked |
| 6062 | g1t (abbey/menu UI, ENG) | 15 | 0 result card (2048); 1 button strip; 2 purple panel (2048); 3 item/status strip; 4 purple panel; 5 list panel (JP); 6 parchment frame; 7 banners with heraldry (2048); 8-11 tall ribbon masks; 12 four shields; 13 HIT/GREAT/PERFECT text; 14 battle bar | menu frames, shield/crest flags, hit labels | yes. 6063-6073 not checked |
| 6074 | g1t (abbey minimap) | 2 | 4096x2048 BC3 and 1024 px BC3 | maps (later) | no |
| 6109 | g1t (map sprites, BGRA8) | 4 | 0 1024 px; 1-2 512 px; 3 128 px (sizes from the catalog) | class sprites, map heads | no |
| 6122, 6143, 6145, 6159-6165 | raw binaries (not G1T) | - | Minimap, castle and event stills (6122 is the minimap); talk camera data | minimap | no |
| 919-939 (dlc) | g1t | 19 | 1024 BC1 costume UV atlases | none (3D) | yes |
| 700_patch (dlc, loose) | g1t | 18 | House emblem set (BC3 512) | house emblems | no |
| loose 0-12, 13-25 (patch2/3 nx/ui) | g1t | 26 | Title and abbey UI, per language; same content as 6038-6073 | as DATA above | no |
| loose 25 (still_icon_unit_P3), 248, 249 | g1t | 3 | Unit still icons; `still_station_DLC` has 128 textures | portrait-type art, see [portraits.md](portraits.md) | no |
| loose 29-92 (patch4 nx/action/texture) | g1t | 217 | Class model material textures (armour/costume albedo) | none (3D) | yes |
| loose 247 (`stl_cnv_event_315.tm2.g1t`) | g1t | 1 | 2048 px BGRA8 event still | event art (not verified) | no |

Non-G1T containers, one line each (from head bytes and override paths only):

- `msgdata.bin`, `scrdata.bin`, `UTF8TBL_*` (patch4 `common/common`, `nx/ui/font`): text tables (not in this inventory).
- `fixed_*.bin` (patch4 `nx/data`): game tables (classes, persons, skills, maps); fixed-table format.
- `nx/event/*` (`.bin`, `.dat`; 2,552 loose files under patch4 alone): dialogue and event scripts (talk_* folders).
- `nx/sound/*.ktsl2*`: audio (KTSR, 265 entries).
- `nx/action/model`, `nx/action/motion`: 3D meshes and animations (MDLK and `unknown`).
- `nx/effect`, `nx/shader`: effect data and shaders (`.spkg`).
- `nx/stage/*`: stage info, terrain, collision (maps).

## How to extract

1. Read the catalog in DATA0.bin: each 32-byte record is `<4Q` = offset in DATA1.bin, size, stored size, compressed
   flag. Skip records with size 0.
2. Read `stored` bytes at `offset` from DATA1.bin when compressed, else `size` bytes. If compressed, decompress with
   the zlib-chunk reader (also the format of the loose `.g1t.gz` files; they are NOT gzip despite the name):
   `count = u32(raw, 4)`, `sizes = u32[count]` at offset 12, chunk data starts at `(12 + 4*count + 0x7F) & ~0x7F`.
   Each chunk: `u32 length` then a zlib stream (a chunk whose stored size equals its unpacked size is stored raw; `archive.unchunk` handles both); the next chunk starts at `(at + chunk_size + 0x7F) & ~0x7F`.
3. Find G1T files: scan the decompressed bytes for `GT1G`. Every hit is a G1T starting there. Validate with:
   count at `+0x10` in 1..512, table at `+0x0C`, each texture offset `table + 4*n` inside the file.
4. Texture `n`: `head = table + u32(table + 4*n)`; format byte at `head+1`, dimensions byte at `head+2`
   (width = `1 << (b & 0xF)`, height = `1 << (b >> 4)`), extra-header size u32 at `head+8` (0x0C/0x10/0x14 when
   present), data starts at `head + 8 + extra`.
5. Formats: `0x01` BGRA8 raw (4 bytes/px); `0x59` BC1 (8 bytes per 4x4);
   `0x5B` BC3 (16 bytes per 4x4); `0x5E` BC6H (16 bytes per 4x4); `0x5F` BC7 (16 bytes per 4x4). Other values (seen: `0x03`) are not decoded.
6. Patch override: for an entry id, the patch folders' INFO0 records (`archive.py` `overrides`) give the newest file path; the file is
   at `romfs/patchN/...`. Prefer it over DATA when present.

## Gaps and what is still needed

- 47 textures in format `0x03` (SCEN containers, entries 553 and 661+) are not decoded. Need a decoder
  or confirmation that they are not needed.
- 167 base entries fail the zlib-chunk reader (`incorrect header check`). Their compression is unknown; some may be
  G1T containers. Not inventoried further.
- 21,213 `unknown` entries contain no G1T magic. Their kinds are unidentified; only the magic scan was done.
- 6051-6061, 6063-6073 (per-language UI atlases) and 6038-6049 were not viewed; the assumption is that they share
  the layout of their ENG sibling.
- Unit still icons (loose `still_icon_unit_*`) and the title/event stills need a look for portrait or logo use.
- Battle map 6122 and other still `.bin` files are raw, not G1T; they need their own reader.
