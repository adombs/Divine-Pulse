# Byleth's looks: portrait, map sprite and what selects them

## Summary

- The game has **two** Byleth looks, not three: dark blue hair, and green hair after the Sothis merge. Part II reuses
  the green one; there is no separate Part II portrait or sprite. (Portraits 71 and 72 are the green face, not an outfit change.)
- Each look has a portrait and a finished map sprite in the dump, so both come from the user's own dump.
- **Not found: a field that holds the look.** The persondata record, the roster slot and the globals around the
  scenario id carry nothing that differs between the looks. The story's scenario id is the best selector found, and
  is read from memory between battles too. After scenario 10 (The Sealed Forest Snare), the persisted `Unit.look`
  switches to green. Scenario 11 (Conflict in the Holy Tomb) is already after the merge, including during battle.

## Portraits

`fixed_persondata.bin`, as in [portraits.md](portraits.md): character id 0 / 1 -> `AssetsID` (+0x18) = 0 / 1 ->
AssetID row (section 1).

| Row | `row[4]` (Part I) | `row[2]` (Part II) | `row[6]` (other) |
|---|---|---|---|
| 0 (Byleth M) | portrait 0 -> DATA 6123 face 0, dark hair | portrait 71 -> face 394, green hair | 506 -> face 997 (a veiled figure, not Byleth) |
| 1 (Byleth F) | portrait 1 -> face 6, dark hair | portrait 72 -> face 400, green hair | 507 -> face 998 (not Byleth) |

Checked by eye: portraits 0/1 are dark blue hair, 71/72 green, in all six expressions.
Nothing else in the AssetID rows differs between the looks.

## Map sprites

Rect table read from the user's ExeFS `main` at 0x1291510 (1477 slots; not written to a file), atlas in DATA 6109.

| Look | Male (char 0) | Female (char 1) |
|---|---|---|
| Dark, finished sprite | slots 0-3 (blue, green, red, yellow) | slots 4-7 |
| Dark, head | slot 1021 | slot 1022 |
| Green, finished sprite | slots 233-236 (237-240 share the same rects) | slots 249-252 (253-256 share them) |
| Green, head | slot 1368 | slot 1369 |

Checked by pixel: the 20x20 head inside each finished sprite (at x 6, y 2) matches its head slot with a mean absolute
difference of 2.4 (M dark: 2.6 vs 1021; M green: 2.4 vs 1368; F dark: 3.0 vs 1022; F green: 5.7 vs 1369). The green
slots are glowing-green-haired Byleth in the same pose and colours as the dark ones.

The importer (`backend/app/gamefiles/extract/map.py`) appends the green finished sprites to `class-sprites.png` and
the green heads to `map-heads.png` and lists them in `class-sprites.json` as `looks.green.characters` / `looks.green.heads`
(by character ID). The portrait needs nothing new.

## What selects the look

Searched, with the game running a save after the merge (read-only memory reads):

- The roster slot (0x24C bytes) of Byleth: no appearance, model or portrait field; it has the same layout as any unit.
- The persondata record (0x50 bytes) is static; both looks hang off the same record via `row[4]` / `row[2]`.
- Globals near the scenario id (main + 0x19E4000 + 0x163100..0x163180): `+0x163128` u32 = 0x11, `+0x16312c` u16 = map
  id 60, `+0x163130` u16 = scenario id (11), `+0x163132` u16 = 11. The scenario id is the story state the app tracks.
  Outside a battle it keeps the id of the last battle fought (0xFF only at the title
  screen).
- Not done: disassembling the main module to find the game's own test, and looking at saves from before and after
  chapter 11.

### Rule used

`byleth_look(scenario, in_battle)` in `backend/app/domain/units.py`:

- scenario 0-9: dark.
- scenario 10: green after the battle (the id is the last battle fought); the cutscene transition during chapter 10
  is not tracked, so its battle recording retains dark hair.
- scenario 11-37 (Holy Tomb and the rest of the main story, Part II): green, both during and between battles.
- scenario 38 and up (paralogues, auxiliary battles, Cindered Shadows) and unknown: no change, since a paralogue can
  be fought before the merge and the game keeps its id too. The last known look stays.

A save before chapter 10 starts as `dark` only once a scenario has been read; until then the app keeps its old
behaviour (the Part I/II portrait switch). The same goes for a new run whose first read is scenario 38 or up: it has no
last known look, so it shows the Part I/II switch until a main-story battle is fought.

### Verified live

- One state: a save in Pegasus Moon on the monastery calendar screen, `scenario` = 11, not in a battle, Byleth's
  portrait on the screen shown with green hair. This fits the rule (11 between battles = green).
- Not verified: any dark-hair state, the chapter 11 battle itself, a new-game-plus start, Part II. These need saves
  from before chapter 11, during it, and after the timeskip.

## In the app

- Backend: `Snapshot.scenario` (read every poll, `GameMemory._scenario`), `UnitStatsReading.look`, `Unit.look`
  ("dark" / "green" / null, saved with the run), and `BattleUnitStats.look` (from the battle's own scenario, so an old
  battle replays with the hair it had). Auxiliary battles retain the saved roster look. Loading saved battles repairs
  the old chapter-11 dark-hair value without rewriting files on read; roster recovery uses the latest recorded
  main-story battle, and does not change a run with no story evidence.
- Frontend: `portraitUrl(unit)` uses the green face when `unit.look` is green, whatever the Part II setting; the
  Characters and Classes pages follow the run's Byleth (`characterPortraitKey`); the battle map's Byleth sprite uses
  `looks.green` from `class-sprites.json` when present. The manual Byleth portrait gender setting still picks M or F.
