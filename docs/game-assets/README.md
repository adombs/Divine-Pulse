# Game assets from your own dump

Divine Pulse ships no game files. Portraits, icons, map art, names, descriptions and game tables are extracted from a
dump of **your own** copy of Fire Emblem: Three Houses into a local folder: `game-assets/` at the repository root when
running from source (git ignores it), or inside the data folder in an installed copy. This page says how to make that
folder, how to check it, and what is in it. How to dump the game: [dumping.md](dumping.md).

## What you need

| Part | Required | How to get it |
|---|---|---|
| Base game + update 1.2.0 RomFS (`DATA0.bin`, `DATA1.bin`, `patch1`-`patch4/`) | yes | nstool (`nstool -x` on the base NSP with the update applied), or an emulator's *Dump RomFS* |
| ExeFS `main` (1.2.0, build `89048449BA238C8CF565518B83BF02D3`) | yes | nstool's `exefs/`, or the emulator's ExeFS dump |
| DLC RomFS (any of the six) | optional | nstool on each DLC NSP, or *Dump RomFS* per DLC. Cindered Shadows (`010055D009F79001`) adds maps 38-41 |

Point the tool at the folder that holds them. It finds the parts by their files and by the title ids in folder
names, so nstool layouts (`romfs/`, `exefs/`, `DLC/[Name][TitleID]…/romfs`) and emulator layouts
(`<title id>/romfs`) both work. Nothing is decrypted here; the tool reads only files you already extracted.

## Commands (from `backend/`)

For the same verified import used by Settings, run `python -m app --import-game-files "<dump folder>"`;
the installed executable also accepts `--import-game-files "<dump folder>"`. Progress and errors are saved
in `game-assets-import.log` in the app's data folder.

```
.venv\Scripts\python -m app.gamefiles info "<dump folder>"       what was found, game version, which DLC
.venv\Scripts\python -m app.gamefiles extract "<dump folder>"    writes ../game-assets/ (about 40 s)
.venv\Scripts\python -m app.gamefiles verify                     checks ../game-assets/
```

`extract` takes `--out <folder>` and `--only <family> ...` (families: `exe_tables text data portraits icons map`).
It stops unless the dump is 1.2.0: the base game, the update and its ExeFS. A missing DLC is skipped with a reason,
never an error.

## Checking the assets

Import format 3 adds `data/meals.json` (dining recipes and character preferences) and localized `ingredient`
names. Reimport older game files in Settings to populate these fields.

`verify` checks the extracted files and exits non-zero on any error (the dump itself is checked before and during
extraction: a supported game build, and every archive must read):

1. **Present and undamaged.** Every file listed in `game-assets/manifest.json` exists, with the size and SHA-256 the
   extractor recorded.
2. **Readable.** Every PNG decodes, has the recorded size and the recorded pixel hash. (A fully transparent PNG is only a warning.)
   Every JSON file parses.

It doesn't compare the files with a stored copy, so what the app extracts can change between versions without
failing an import.

Extraction is deterministic: two runs on the same dump give identical file hashes in the manifest.

## Catalogue (1.2.0 + all DLC)

`source` in the manifest gives each file's origin (DATA entry and texture, loose file, table
section or executable offset).

| Folder | What | From |
|---|---|---|
| `images/portraits/faces/<portrait id>/<expression>.png` | Neutral faces of the portraits the app references, plus every expression of the playable characters' Part I and II portraits, 512 px | DATA 6123 face pack; Cindered Shadows faces from `patch4/nx/ui/still/face_school_normal_DLC.bin` |
| `images/portraits/characters/<char id>[-part2].png` | Neutral face per named character, Part 1 and Part 2, plus extra looks (`<char id>-<portrait id>.png`) | same, via `fixed_persondata` sections 0 → 1 → 16 |
| `images/portraits/generic/<class>-<gender>-<nn>.png` | Generic faces by class and gender | same |
| `images/icons/abilities/<ability id>.png` | Every ability icon, DLC included | atlas 6026 tex 2 (sprite = `fixed_skill` +0x08 + 146), DLC from `700_patch` tex 1 |
| `images/icons/crests/<crest id>.png` | Crest glyphs | atlas 6026 tex 1, sprite 0x7A + crest |
| `images/icons/items-native/<sprite>.png` | The weapon, spell, equipment and item icons the tables use | atlas 6026 via the icon table in `main` |
| `images/icons/{items,combat-arts,magic,weapons,skills}/`, `equip-mark.png` | Three item tiles (sword, shield, potion), six combat-art tiles, two magic tiles (black, white), seven weapon-type and four skill glyphs, the equip mark | atlas 6026 tex 0 and 2 |
| `images/houses/` | House and army banners | atlas 6026 tex 8, `700_patch` tex 1 |
| `images/map/` | Class sprites, map heads, minimap pieces, per-map minimaps | DATA 6109 and 6050 with rectangles from `main`; `nx/ui/still/minimap.bin` |
| `text/<LANG>.json` | 28 categories of names and descriptions in each of 12 languages (no index file) | `common/common/msgdata.bin` |
| `data/*.json` | Characters (bases, growths, caps, ranks, learnsets, budding talents, age, birthday, height), classes, weapons, spells, equipment, items, combat arts, abilities, battalions (name, description, endurance, modifiers, level progression and gambit details), rank EXP, supports, gifts and lost items, factions, crests, maps, terrain, class sprites, minimap terrain, portraits and five fallback icons | `nx/data/fixed_*.bin`, DATA 365+ |
| `data/exe/item-icons.json` | Weapon, spell, equipment and item id → native icon sprite id | `exefs/main` |

The sprite rectangle tables in `main` (map sprites, battle UI, icons) are read directly and not written to a file.
The full UI atlases are not exported either.

## Findings worth knowing

- Archive chunks that zlib would not shrink are stored raw. Older readers that assumed every chunk was zlib failed on
  167 entries; `app/gamefiles/archive.py` handles both.
- `.g1t.gz` files use the same zlib-chunk format, not gzip.
- The UI atlases come in language order JP, ENG_U, ENG_E, … (6050 is Japanese, 6051 English).
- Cindered Shadows (79001) holds maps 38-41 (its entries 465-468) but no data tables or 512 px faces; those live in
  the base game's patch4.
- `fixed_persondata` also has age (+0x1B), birth month and day (+0x1C, +0x1E) and heights (+0x2F, +0x30).

Research notes per topic: [text](text.md), [portraits](portraits.md), [Byleth looks](byleth-looks.md), [icons](icons.md), [tables](tables.md),
[social](social.md), [inventory](inventory.md).
