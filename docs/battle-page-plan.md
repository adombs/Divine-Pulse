# Battle page: plan

A dedicated page that takes over from the Roster while a battle is in progress (game memory mode), and keeps a
history of past battles. Someone glancing at it should see how the battle is going.

This file says what each feature needs, what the game data supports, and what is left.

## What the game data supports

Everything here comes from reading FE3H's memory in Eden (`backend/app/gamemem`, see
[reading-game-memory.md](reading-game-memory.md)).

| Data | Where | Verified? |
|---|---|---|
| Battle starts / ends | The roster's battle counters go up when a battle starts; the battle copies of the deployed units are cleared (level 0) when it ends | Yes, live (2 battles) |
| Who is deployed | Army units with a live battle copy | Yes, live |
| Levels and stats during the battle | The battle copies | Yes, live (level-ups seen as they happened) |
| Every unit on the map, enemies included | The battle copies sit in one pool of 0x330-byte records, players first, then enemies; each record has the slot layout | Yes, live: read every poll (`gamemem/battle.py`) |
| Enemy class, level, max HP, stats | Same slot layout as the roster | Seen once |
| Spell uses left (5 Reason, 5 Faith) | Slot `+0x94`–`+0x9D`; spell IDs at `+0xA0`–`+0xA9` | Yes: seen dropping live as spells were cast |
| Inventory (item ID, uses left) × 6 | Slot `+0x00`–`+0x17` | Layout yes; dropping in battle not yet seen |
| Current HP, map position | Record `+0xDE`, `+0xF2`/`+0xF3` | Yes, live |
| Has acted / in combat flags (not used: only for watching actions happen) | Record `+0xD6` / `+0xD7`, bit 0x04 | Yes, live |
| Fights and defeats | Lifetime Battles / Victories counters, record `+0x26`/`+0x28` | Yes, live |
| Turn number | Global data `+0xDEE00` (0 on the Divine Pulse screen) | Yes, live |
| Divine Pulse charges | Global data `+0xDB510` | Yes, live |
| The game's battle history (the Divine Pulse list): every action and phase, with the state of the units it changed | A list in a heap of its own, from the global data (`gamemem/history.py`) | Yes, live: checked entry by entry against the Divine Pulse screen |
| Defeated units | Unknown: maybe the record is cleared like at battle end | **Not verified** |
| Battle (scenario) id and map id | Global data `+0x163130` and `+0x16312c`, u16 each | Yes, live (see "Battle map terrain") |
| Battle objective | Unknown | **Not located** |

The unlocated fields need a live battle to find. The tracker records battle memory while you play, and `tools/analyze_battle_recording.py` lists candidate offsets from a recording.

## Features

| Feature | Needs | Status |
|---|---|---|
| Battle timer (real time since the battle started) | start/end | Done |
| Deployed units, with level and stats now vs at the start | battle copies | Done |
| Level-ups and stat gains during the battle, as a timeline | battle copies | Done |
| Divine Pulse uses (detected as time going backwards: a unit's level or stats drop mid-battle) | battle copies | Done (heuristic) |
| Enemy roster: count, classes, levels | battle pool | Done, decode unverified |
| Battle history per run (duration, units, level-ups, outcome) | start/end | Done |
| Run stats: totals and records over the run's battles, and each character over every battle they were in | battle history | Done (run stats) |
| Battle page that replaces the Roster during a battle, with a setting | the above | Done |
| Outlook: estimated % chance of success with the factors behind it | army vs enemy strength; HP once located | Done: v1 without HP |
| Battle memory recorder + offset analysis tool | — | Done |
| Resume the battle in progress after the tracker restarts | the roster's battle counters identify a battle | Done |
| Weapon attacks, spells cast and items used per unit (durability / spell uses spent; uses coming back = Divine Pulse) | inventory and spell uses in the battle copies | Done; spell uses seen live, weapons/items not yet confirmed |
| Current HP bars, army and enemy HP % | current HP | Done |
| Action log, damage dealt and taken, healing, tiles moved, for your units and each other unit | the game's history (the Divine Pulse list) | Done; not tracked when the history can't be read |
| Fights and defeats per unit, this battle | Battles / Victories counters | Done |
| Turn counter and turn events (turn going down = Divine Pulse) | turn number | Done |
| Divine Pulse charges left (a drop = a certain Divine Pulse) | charges | Done |
| Enemies defeated / remaining | current HP of the other units (defeated units stay in memory with no HP) | Done |
| What each unit has left: spell uses, its most worn weapon, broken weapons, consumables; army magic left; a "Running low" list | inventory and spell uses in the battle copies | Done|
| Fights worked out without the history (who fought whom, with a confidence) | Battles counters, HP, the combat math | Done |
| Battle map: every unit where it stands, and a replay step by step from the history | positions; the history | Done |
| Terrain on the map, what each unit stands on, real tile bonuses in fight pairing | map id; the imported map grids | Done; effects of tiles the wiki doesn't name are guessed |

## Design

### Backend

- `app/gamemem/battle.py`: decode the battle pool (every unit on the map) into `BattleUnit`s (`domain/combat.py`): character ID, army or
  not, level, class, raw stats, plus optional fields (`hp`, `x`, `y`) that stay `None` until their offsets are known.
- `app/application/battle_tracking.py`: `BattleTracker`, pure logic fed one sample per poll. It opens a `Battle` when units enter a
  battle, records a starting snapshot of each unit, turns changes into timeline events (level-up with stat gains,
  Divine Pulse, unit joined/left, enemy count changes), and closes the battle when it ends.
- `BattleStore` in `app/infrastructure/persistence.py`: finished battles are saved per run in `data/battles/<run id>.json` (the run file stays small).
- API: `GET /api/battle` (the battle in progress, or null), `GET /api/runs/{id}/battles` (history), and a `battle`
  live event whenever the battle changes.
- The scanner feeds the tracker on every game-memory poll.

### Outlook (chance of success)

A transparent estimate, not a simulation. Version 1 (no HP):

- Army strength: for each deployed unit, `level-weighted combat score` (HP + best offense + best defense + Spd),
  scaled by units still on the map.
- Enemy strength: the same score over enemies still on the map.
- `chance = logistic(a * ln(army / enemy) + b)`, with momentum from level-ups and a penalty per Divine Pulse used.
- The page shows the factors and says it's an estimate. Version 2 adds current HP (army HP % vs enemy HP %), which
  is the strongest signal once the field is found.

### Frontend

- New page **Battle** (tab between Roster and Characters). During a battle the app switches to it from the Roster
  automatically (setting *Battle Page*, on by default) and back when the battle ends.
- Layout: header (timer, units, enemies, Divine Pulses) · outlook gauge with factors · deployed units (level and
  stat gains, HP bars when available) · enemies by class · timeline. Columns for damage, healing and tiles moved
  show "not tracked yet" until their data exists.
- Outside a battle: the run's battle history, newest first; each opens the same summary read-only.

## Locating a field

Every field the Battle page uses is located (see the table at the top). To find a new one:

1. Play a battle with the tracker running (Settings → Testing → Record Battles is on by default). Note a
   few facts to check against, e.g. a unit's HP after it was hit, how far a unit moved, the turn number.
2. Run `python tools/analyze_battle_recording.py` (newest recording in `data/battle-recordings/`).
3. Check the top candidates against those facts. `--apply` writes the fields with a clear winner to
   `backend/app/data/battle_fields.json`; put any others there by hand (hex strings, e.g. `"hp": "0x2a4"`).
4. Restart the tracker, and check the field on the Battle page.
5. Mark its row above as verified, and add a test for it with synthetic data (recordings are from your game, so they stay out of
   the repository).

## Fight pairing when the game's history can't be read

The approach: when the history can't be read, work out who fought whom between two reads from the Battles
counters plus a model of the game's combat math, credit damage and defeats from the pairs, and show any pair it isn't
sure of with its best guess and a confidence score. When the history can be read it is exact and used instead.

What is known (FE3H 1.2.0, seen live):
- The history is one list per turn (pointers to each turn's first entry at global +0xDE228). Action codes: 0x0B wait
  (or Canto after an attack, with a target), 0x00 attack, 0x03 attack that defeated its target (not a counter-kill),
  0x05 item ("Flayn used Vulnerary"). An action's entry is added only when the next action starts. An attack's item
  field is the damage it dealt x 100 plus how it ended (1 target fell, 2 attacker fell, 3 both stood).
- Action Skip doesn't drop fights: a skipped enemy phase kept one attack entry per fight. Enemies act in ascending
  pool index on the enemy phase.
- A miss spends no weapon use; each hit spends one (Byleth, Lorenz, Cyril, the bandits). A record's uses are written
  a read after its HP (0.12 s apart in the fixture).
- Combat tables come from the player's import (`game-assets/data`). The effectiveness byte (weapon +0x0E) uses the
  same bits as the "... Effect Null" abilities (2 armored, 4 cavalry, 8 flying).

Done:
1. **Combat model** (`gamemem/combat.py`, `tests/test_combat.py`): both status screens exactly, and all seven
   forecasts exactly once the linked allies' bonus is given (support ranks aren't read; see "Open questions").
   A defender's weapon bonuses count even when it can't counter (Hanneman's Thoron at range 2).
2. **Solver** (`gamemem/pairing.py`, `tests/test_pairing.py`): hard rules, then a likelihood for each pairing from
   the combat model's hit and crit chances (an outcome DP over the fights in order), with a confidence per fight.
   Against the fixture's history: read by read, all seven of turn 2's fights with the right attacker (0.70-1.0);
   with the whole turn between two reads, everything but the two mages' interchangeable kills (shown at ~0.5).
3. **Tracker** (`BattleTracker._pair`): only when a read has no history; damage dealt / taken, defeated-by, "fell"
   and a log line per fight with its confidence; the Battle page shows "≈ 82%" or "best guess · 55%" and how many
   fights are estimated. As soon as the history is read again, everything is rebuilt from it.

Open questions (each one is a reason a forecast or a pairing can be off; fight-pairing-testing.md says how to measure them), with what fan sources say:
- **Linked allies: rule known, ranks not read.** ([fe3h.com], [Serenes Forest]) On the player phase, allies that could
  attack the target from where they stand link, at most three in deployment order (plus the attacker's adjutant);
  each adds Hit and Avo by support rank (+3 none, +5 C, +7 B, +10 A, +15 S), the listed bonded pairs also Might
  (+1/+2/+3/+5), and since 1.2.0 a pair that can never support adds nothing. Built in (combat.linked_allies,
  link_options, with the support table from the import). Against the fixture the rule picks allies whose possible links
  include every forecast's: Cyril, axe equipped, didn't link from two tiles though he carried bows; Hanneman, Iron
  Bow equipped, linked from one tile, so spells count (inferred, not in the guides); Byleth's +1 Mt is Flayn's.
  Not read: support ranks (the solver weighs each possible rank), adjutants, the deployment order (pool order assumed).
- **Two small offsets left over**: Hanneman's Thoron does 1 more than the model plus links, and Lysithea's Avo is 1
  short of her +3 link. Most likely their **battalions**, which add or remove Phys, Mag, Hit, Crit, Avo, Prt, Rsl and
  Charm while their endurance is above 0 (a unit's battalion takes half the damage it takes; [Fire Emblem Wiki:
  Battalion]). Battalions aren't located in memory, so the solver allows -1 to +2 on your units' damage.
- **Terrain**: forest +30 Avo and +1 Def; other tiles -2 Def, +1 Def and +20 Avo, +40 Avo, or Def / Res raises;
  none for fliers ([samurai-gamers terrain]). With the map's terrain known the solver uses the defender's real tile
  bonus (see "Battle map terrain"); without it it still allows -1 / +2 on other units' damage.
- **Hit rolls**: two rolls averaged, so 80 lands 92.2% and 10 lands 2.1% ([corridorsoftime]). Built in.
- **Class abilities**: the game's rows have five slots, 0 mastery, 1 one the class doesn't show (inactive on the maps
  seen; possibly for enemies on another difficulty), 2-4 the class's own. Matches the class-ability guide
  ([samurai-gamers classes]) for every class checked; built in (combat.class_innate). Left: Pegasus Knight's
  Lancefaire, which the game's row has and the guides don't.
- **Combat arts** (more weapon uses, other Mt / Hit) and **gambits** aren't modelled: a fight that needs them is
  matched approximately.
- **Spell misses**: assumed to spend no use, like weapons (no source found either way).
- **Effective weapons**: Might x3 (a forum claim; not confirmed for this game).
- **The Sword of the Creator** is range 1-2: the game's weapon list showed Rng 1-2 for it (Byleth, Oil and Water,
  1.2.0), though its table entry says 150. The Dark Sword of the Creator is taken to be the same (not seen).

[fe3h.com]: https://www.fe3h.com/linked_attacks
[Serenes Forest]: https://serenesforest.net/three-houses/miscellaneous/linked-attacks-gambit-boost/
[corridorsoftime]: https://corridorsoftime.substack.com/p/on-game-mechanics-pt-1
[Fire Emblem Wiki: Battalion]: https://fireemblemwiki.org/wiki/Battalion
[samurai-gamers terrain]: https://samurai-gamers.com/fire-emblem-three-houses/terrain-list/
[samurai-gamers classes]: https://samurai-gamers.com/fire-emblem-three-houses/class-abilities/

Settings (Battles): **Battle read interval** (0.1 s by default; how long a change takes to reach the page, and
how many fights land between two reads) and **Fight estimates** (on by default). Testing (Settings → Testing,
or the environment variables): **Check Fight Estimates** / `DIVINE_PULSE_PAIRING_CHECK=1` writes a report per battle
to `pairing-checks/` in the data folder comparing the pairing with the history; **Ignore the History** /
`DIVINE_PULSE_HIDE_HISTORY=1` makes the Battle page work fights out as if the history couldn't be
read. See [fight-pairing-testing.md](fight-pairing-testing.md).

## Battle map terrain

Done: the Map tab draws each map's terrain and fight pairing uses the real tile bonuses, for every map in the base game.

- **Terrain files** ([bsic], `src/terrain/TerrainData.kt`): an 8-byte header (unknown), then a fixed 32 × 32 grid, row
  by row from y = 0, of 2 bytes per tile: the terrain ID, then a second ID (unknown, not kept). A map's real size is
  the grid less its trailing Impassable (0) rows and columns. 115 terrain IDs are named (0 Impassable, 1 Grassland,
  2 Plain, 3 Forest, 6 River, 10 Bridge, 13 Wall...). They are entries **365 + map id** of DATA0.bin / DATA1.bin
  (not 365 + scenario id: 1.2.0 has 37 maps, 365-401, shared by the 100 battles). The Cindered Shadows DLC has its own
  archive with 4 more maps at entries 465-468, which are maps 38-41 (seen live: A Skirmish in Abyss, scenario 86, is
  map 39 and its 38 units fit entry 466; five of its battles' spawns fit these maps, the other four fit base maps). The Auxiliary Battle Maps DLC has no terrain files: its five
  battles reuse base maps.
- **Maps**: the importer writes every map's grid by map id into `game-assets/data`. The tracker reads the battle's map
  id from memory and looks the grid up.
- **Map icons**: cut from the game's UI textures by the importer. They
  are G1T files in DATA1.bin, stored linear on the Switch (not block-swizzled). Entry 6026 texture 0 is the main icon
  atlas (weapon-skill tiles); 6050-6061 are the battle UI atlases per language (texture 1: replay buttons and status
  icons, 2: phase banners, army diamonds, Level Up / Guard / Break text).
- **Minimap pieces: labelled**. Entry 6050 texture 10 is the battle minimap's atlas; every rect, what the
  game draws it for and the evidence are in [minimap-atlas.md](minimap-atlas.md) (rects from the main program's sprite
  table at main + 0xd588d0, uses from the minimap's drawing code). The game draws terrain from a pre-rendered minimap
  per map (entry 6122 / patch4 `nx/ui/still/minimap.bin`): the importer extracts those, and the app falls back to the
  atlas's tiles by terrain ID.
- **Map sprites: drawn**. The map draws units as the game's map sprites or as minimap badges, set in
  Settings > Appearance (stored in the browser): generic units as their class sprite or a badge with their weapon's
  icon (default sprites), characters of their own (yours, and others such as an enemy Seteth) as their own sprite or a
  badge with their portrait (default portraits). Their own sprite is their class's body with their head; in Noble /
  Commoner their finished sprite; in classes without a body (Lord, Enlightened One, Emperor ...) it falls back to the
  portrait badge. Colours by army: yours blue, enemies red, allies green, a third army yellow. The army is the unit
  record's team byte +0xF1 (0 your side, 1 enemy; the history's team byte is this + 1; seen live: 0 on the army, 1 on
  every bandit); 2 is taken as allies and 3 as a third army, and a unit on your side that isn't yours as an ally (not
  seen in a battle yet). Gender: `fixed_persondata.bin` rows (1201 x 0x50) +0x26, 0 male / 1 female (2 on monsters),
  (`gender` in the importer's character table).
- **Class map sprites: solved**, built into `class-sprites.png` (class bodies, mounts drawn in, and the
  characters' finished sprites; a column per army), `map-heads.png` and `class-sprites.json`. Entry 6109 has four textures on a 36 px grid (32 px
  cells). The rects aren't in the romfs: the main program has them, 1477 16-byte records at main + 0x1291510 (1.2.0:
  u16 texture width, height, texture, id, x, y, w, h), read by the importer directly from your ExeFS (not written to a file), indexed by slot.
  Generic units are layered like the game does: a headless body (slot 4 x sprite ID + 309 + colour), for the 18
  mounted sprite IDs a mount under it (slot 1395 + 4 x n + colour, n in sprite ID order), and a 20 x 20 head at x 6,
  y 2 (y -4 on a mount; both found by matching the game's own finished sprites pixel for pixel). Sprite IDs are
  `fixed_classdata.bin` section 0 (patch4/nx/data, 100 rows of 0x76) +8 male / +10 female; 100-177 have bodies
  (bodies for Lord, Emperor, Enlightened One, Great Lord, Flame Emperor, Barbarossa are empty: they're drawn per
  character; Valkyrie / Dark Flier, 178 / 179, use other slots and aren't built). The texture is BGRA (format 0x01;
  read as RGBA, skin came out blue): its four colours are blue, green, red, yellow. Characters' heads are slot 1021 +
  character ID (Byleth 0 / 1 ... Cyril 34, all matched by eye); their finished sprites slot 4 x character ID +
  colour (0-34: what Noble / Commoner show; after that other people and special classes, not mapped). Generic heads are
  a choice made here: in the game generic units vary (slots 1056-1394 hold hair and army-coloured class headgear); short hair
  (1348) for men, a ponytail (1360) for women.
- **Map id in memory: located**: u16 at globals `+0x16312c` (battle_fields.json `globals.map`): 0 in the
  prologue, 36 in Oil and Water. Checked: map 0 tile for tile against the game's own map screen, map 36 against where all 38 units stood. The grid picked is checked against the
  units every read (gamemem/terrain.battle_map: every unit on the map and on an enterable tile); if the id's map
  doesn't fit, the only map every unit fits is used, else none (the plain grid).
- **Scenario id: located**, u16 at globals `+0x163130`: 59 in Oil and Water, 0 in the prologue, 0xFF at the title
  (`Battle.scenario`, `Battle.map_name`; not shown yet). Which battles use which map comes from
  the map id at battle start; the battles' spawn files (entry 83 + 2 x scenario, 0x2C-byte records from +0x18, x / y
  at +0x19 / +0x1A) fit several maps each, so no static battle-to-map table is kept.
- **The grid isn't in memory** in the file's layout (nor any other layout tried, strides 1-64, with the minimap's
  colours as a pattern): the game keeps it some other way. The cursor's tile ID is in memory (3 on Forest, 1 on
  Grassland, same IDs as the files), only as UI state.
- **Terrain effects** (the importer's terrain table): per terrain ID a name ([bsic] `TerrainMapping.kt`) and the game's own effects from `fixed_stagedata.bin` (patch4/nx/data in 1.2.0; [010 templates]
  `fixed_stagedata.bt`): Def, Res, Avoid, heal %, breakable wall HP and the
  movement group (0 impassable, 1 fliers only, normal, forest, sand, thicket, shoal / snow, swamp / flames / crater,
  special, stairs, wasteland). Fliers get no bonuses, only the healing. Where it differs from the fan wikis: Snowfield
  -20 Avo, Poison 10% damage, Flames none, Healstone (62) heals 30%; Wall (13), Cliff, Peak, House, Rampart are
  fliers-only, Door, Pillar, Lever, Altar, Magic Seal and the raised drawbridge (72) nobody's. The file's second
  section is a move-cost table per movement type (not used yet).
- **Fight pairing** uses each side's tile when the terrain is known (gamemem/pairing.py `_Scorer._ground`): the
  defender's where it stood (unless it moved, i.e. also acted), the attacker's where it ended (unless it has Canto).
  The `-1 / +2` allowance then shrinks to the battalions plus a little slack (`*_ON_KNOWN_TILE`); without
  terrain it is as before. tests/test_pairing.py and tests/test_combat.py give the same results before and after
  (no terrain in the fixture).
- `Battle.terrain` is the first byte of each tile, cropped to the map, and `Battle.map_id` the map. Bridges lowered
  or walls broken during a battle aren't followed (the grid is the map's starting terrain).

[bsic]: https://github.com/three-houses-research-team/bsic
[010 templates]: https://github.com/three-houses-research-team/010-binary-templates
[Fire Emblem Wiki's terrain table]: https://fireemblemwiki.org/wiki/Terrain/Nintendo_Switch_games

## Later

- **More history entry types.** Seen so far: phase starts, wait/move (`0x0B`) and attack (`0x00`). Others (heals,
  items, combat arts, rallies, trades...) are told apart by HP changes and logged generically ("X acted.") until
  their codes are seen live.
- **Confirm weapon and item uses drop live** (spell uses have been seen dropping; durability hasn't yet).
- **Confirm the enemy decode** (classes, levels and counts of the other units on the map) against a real map.
- **Calibrate the outlook** once a few battles have results (the history shows its average at the end of battles
  won and lost).
