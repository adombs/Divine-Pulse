# Game memory map (FE3H 1.2.0 on Eden)

What the tracker knows about where Fire Emblem: Three Houses keeps its state in the emulator's memory, and how each
value was confirmed. The code is the source of truth for offsets (each constant has a comment with the evidence);
this page collects them in one place, adds what was learned but not used yet, and lists what was looked for and not
found, so later work doesn't repeat it.

Conventions: offsets are hex. "Seen live" means checked against the running game. u8/u16/u32/u64 are little-endian.

## Getting at the game

| What | Where | Code |
| --- | --- | --- |
| Process | `eden.exe`, read-only (`ReadProcessMemory`) | `system/memory.py`, `gamemem/emulators.py` |
| Switch memory | Eden "fastmem": Switch address `a` is at host `arena + a`, in mapped views. A 4 GiB block of physical RAM is a second view of the same memory; skip it when scanning. | `Fastmem` in `gamemem/emulators.py` |
| Arena (Switch address 0) | Found from the battle history's self-pointer (`history.SELF_AT` → `SELF_TARGET`), else just after the 4 GiB block. Seen: `0x247f4000000`. | `GameMemory._find_arena` |
| Main program | Starts with `00000000 08000000 "MOD0"`; not at a fixed address (Switch `0x80004000` one session, `0x8077B000` another). Version is matched by GNU build-id at main + `0x19E3840`. | `_find_main`, `VERSIONS` in `gamemem/fe3h.py` |
| Global data | main + `0x19E4000` to main + `0x1BCC000` (`.data`/`.bss`). Offsets below marked "globals" are from main + `0x19E4000`. | `GameMemory.GLOBALS` |

## Roster (main + `0x1B127E4`)

60 slots of `0x24C` bytes, one per character the save knows. Empty slot: character `0xFFFF`. During a battle the game
works on copies of the deployed units (the battle pool, below) and writes them back when the battle ends.

| Offset | Type | Meaning |
| --- | --- | --- |
| `0x00` | 6 × (u16 item, u16 uses) | Inventory; `0xFFFF` = empty. Items 600-649 are equipment (the accessory). |
| `0x18` | u16 | Battalion owner (character ID; `0xFFFF` = none) |
| `0x1A` / `0x1C` | u16 / u16 | Battalion cumulative exp / endurance left |
| `0x1E` / `0x1F` | u8 / u8 | Battalion ID (200 = none) / gambit ID |
| `0x24` | u16 | Character ID (0 Byleth M, 1 Byleth F, 2 Edelgard, 3 Dimitri, 4 Claude … 35 Jeralt … 1040+ DLC) |
| `0x26` / `0x28` | u16 / u16 | Lifetime "Battles" (fights) / "Victories" (units defeated) |
| `0x2E` | u16 | Equipped: 1 = top inventory weapon, `EQUIPPED_SPELL` + spell ID, `0xFFFF` = nothing |
| `0x32` | 11 × u16 | Weapon/skill exp (`gamemem/skills.py`) |
| `0x4A` / `0x4B` | u8 / u8 | Level / class ID (`data/classes.json`) |
| `0x4C` | u8 | Max HP (raw, before class boosts) |
| `0x4E` | 9 × u8 | Str, Mag, Dex, Spd, Lck, Def, Res, Mv, Cha (raw) |
| `0x57` | 10 bytes | Learned combat arts (bitset, IDs 0-79) |
| `0x61` | 30 bytes | Learned abilities (bitset, IDs 0-239; skill-rank abilities keep only the highest level) |
| `0x7F` | 5 × u8 | Equipped abilities (`0xFF` = empty) |
| `0x84` | 3 × u8 | Equipped combat arts (80+ = empty) |
| `0x88` | 11 × u8 | Skill ranks (`gamemem/skills.py`) |
| `0x94` / `0xA0` | 12 × u8 / 12 × u8 | Spell uses left / spell IDs (38 = empty) |
| `0xAC` | u32 | Flags: bit 0 available, bit 1 joined (both = in the army), bit 3 dead (not yet confirmed live) |
| `0xBC` | u16 | Battle counter (the roster counts a battle when it starts; the battle copy doesn't) |
| `0x112` | u16 per class | Progress toward each class's mastery |
| `0x1E7` | 100 × u8 | Class mastered (1) per class ID |

Not in the slot: Byleth's birthday, any sprite or portrait ID.

## The player block (right after the roster: main + `0x1B127E4` + 60 × `0x24C`)

| Offset | Type | Meaning |
| --- | --- | --- |
| `0x00` | text, up to `0x29` | Byleth's name as the player typed it, as `"\x1bN0<name>\x1bN1"` |
| `0x29` | u8 | Byleth's birth month, **0 = January**. Seen live: a save born on 3/5 held 2. |
| `0x2A` | u8 | Byleth's birth day (1-31). Seen live: 5. |
| `0x2B` | u16 | `0xFFFF` (unknown) |
| `0x3C` | u32 | 9 (unknown) |
| `0x40` | u32 | `0x19DF0` (unknown) |

The same block (name, then `02 05 ff ff`) also appears in the heap, apparently copies of the save. The tracker reads
the first `0x40` bytes with the roster (`PLAYER_NAME_SIZE`); `decode_player_name` and `decode_player_birthday` in
`gamemem/fe3h.py` decode it.

How the birthday was found: no `03 05` or `05 03` byte pair sits near the roster, in Byleth's slot or anywhere in the
globals, but the bytes right after the name are `02 05`. The month-first order matches the game's character table,
whose birthdays are a 1-based month then the day (Edelgard: 6, 22). Here the month is 0-based. If a save ever reads
wrong, the other reading (day − 1 first, then month) would give 5/3; confirm with a Byleth born on a day above 12.

## Battle pool (heap)

One `0x330`-byte record per unit on the map, each `0x14` bytes after the marker `04 03 00 00 00 00 00 00 00`. The
player's deployed units come first. Each record starts with the roster slot layout (above) and continues with
battle-only fields. Found by scanning the heap for the marker when a battle starts (`_find_battle_copies`), then
re-read cheaply. Cleared when the battle ends (level 0).

| Offset | Type | Meaning |
| --- | --- | --- |
| `0xDE` | u8 | Current HP (`app/data/battle_fields.json`) |
| `0xD6` | u8 flags | `0x01` always set; `0x02` on the map (cleared when defeated or taken off by the story); `0x04` acted this phase; `0x08` only on Solon and the Death Knight in Remire (unknown); `0x10` breakable walls; `0x20` not on the map (reinforcements still to come, undeployed leaders, adjutants) |
| `0xE0` | u8 | Bit `0x80`: rattled (hit by an offensive gambit) |
| `0xF0` | u8 | Pool index (the history names units by it) |
| `0xF1` | u8 | **Team**: 0 yours, 1 enemy, 2 ally, 3 third army, 4 objects (breakable walls) |
| `0xF2` / `0xF3` | u8 / u8 | Map x / y |
| `0xF5` | u8 | Gambit uses left (battle copies only) |
| `0x100` | u8 | On an adjutant: the pool index of the unit it's attached to |
| `0x109` | u8 | Allegiance (an ID in `data/factions.json`: 0 Church, 1 Empire, 2 Kingdom, 3 Alliance, 9 Thieves…) |

Team 0 is not "in your roster". Seen live in the prologue (A Skirmish at Dawn): Byleth, Edelgard, Dimitri and Claude
are all team 0 and the game draws all four in your colour, but only Byleth has the in-army flags, because the house
leaders haven't joined yet. Jeralt is team 2 (ally), Kostas and his thieves team 1. `domain/battle.side_of` maps team
0 to "player" for these units.

The tracker logs any on-map team-0 record that is not an army/roster unit as a guest army unit of that battle
(`BattleUnitStats.guest`, `a:<key>` ids), by the rule alone: team 0 and not in the roster. Its key is the run unit's
whose `game_id` is the character, else the name's key, so its stats carry over if the character joins later or
leaves and comes back. Guests never create or change run units, the roster or deaths. Teams 1-4 are unchanged.

## Battle globals (offsets from main + `0x19E4000`)

| Offset | Type | Meaning |
| --- | --- | --- |
| `0xDB0C4` / `0xDB0C8` | i32 / i32 | Map cursor x / y |
| `0xDB510` | u8 | Divine Pulse charges |
| `0xDEE00` | u8 | Turn (0 on the Divine Pulse screen) |
| `0xDE1A8` | u32 | Number of battle history entries |
| `0xDE228` | u64 array | Switch address of each turn's first history entry |
| `0x1536FF` | u8 | Quest the battle is for (151 or more = none) |
| `0x16312C` | u16 | Map ID (`data/maps.json`) |
| `0x163130` | u16 | Scenario (`app/data/scenarios.json`); `0xFF` outside a battle |

Battle history entry layout (the Divine Pulse list): see the module docstring and constants in `gamemem/history.py`.

When things show up (recording of A Skirmish at Dawn, Claude's last attack on Kostas):

- **The action that wins the map gets no history entry.** The count stayed at 48 from the previous action until the
  battle ended, when it dropped to 0. The tracker works that fight out from HP changes at the end of the battle
  (`BattleTracker._settle_unfiled`).
- **A level-up shows before its action is filed.** The unit's level and stats change in its battle record when the
  level-up screen opens (270.4 s). HP, the Battles/Victories counters and the history entry change only once it
  closes (277.1 s for the HP; 5 s later for Byleth's entry for the Thief 6 fight). The tracker moves the level-up to
  when its action was logged (`BattleTracker._order_growth`).
- An action's HP usually reaches the pool a read or two before its history entry (Thief 5's defeat: HP 0 at 248.3 s,
  entry at 248.9 s).

## Map sprites: what the game draws and where it comes from

The game builds a generic unit's map sprite at runtime from two pieces of one texture atlas (DATA entry `SPRITES`,
rectangles from the main executable; `gamefiles/extract/map.py`). Each piece comes in four army colours, in the order
blue (yours, team 0), green (ally, team 2), red (enemy, team 1), yellow (third army, team 3).

| Piece | Slot | Chosen by |
| --- | --- | --- |
| Body | `309 + 4 × sprite + colour` (sprite 100-177) | The class's sprite ID by gender: `fixed_classdata.bin` section 0, u16 male at `+0x08`, u16 female at `+0x0A` |
| Mount | `1395 + 4 × MOUNTED.index(sprite) + colour` | The same sprite ID |
| Student's head | `1021 + character` (characters 0-34) | The character |
| Generic head | `1056 + 4 × (sprite − 100) + colour` | The same sprite ID as the body |
| Finished sprite (head drawn in) | `4 × character` (0-26), `112 + 8 × (character − 27)` (27-35), Rhea `184`, Sothis `188` | The character |
| Second look, in their own class | `112 + 8 × (character − 27) + 4` (27-35) | The character and class (Jeralt as a Paladin) |

Checked against the game's own unit list (prologue): Thieves and Ruffians (classes 49 and 50) share sprite 112 and
draw head `1056 + 48 + colour`, the red-haired thief in red; Kostas (character 43, no head of his own) draws the same.
Jeralt as a Paladin (class 51) draws his own second look, slots `180`-`183` (`112 + 8 × 8 + 4` + colour): mounted,
with his own head, not the Paladin body with its generic helmet head (`1056 + 140` + colour) and not his first look on
foot (`176`-`179`). The faculty characters 27-35 each have such a second look in their own class (Flayn in white,
Hanneman's hat, Gilbert's shield, Shamir's bow…); only Jeralt needs it, the others having heads of their own. Noble and Commoner (sprites 108-111) have no body (the importer builds headless ones from
characters' finished sprites for generic Nobles and Commoners); Noble's generic head slots (`1088`-`1095`) are empty,
Commoner's (`1096`-`1103`) hold grey heads. A student in either class wears their finished sprite (Byleth as a
Commoner, the house leaders as Nobles).

The game draws the same sprite on the unit's info panel and beside the class on the Skill Level page.

### Looked for in memory and not found (so far)

- **No sprite, body or head ID in the unit's battle record.** Searched every byte and u16 of all 20 records of the
  prologue for 112/113 (the thief sprite), the head set (83-86, slots 1104-1107) on every thief and 135/136/175-178/
  1196-1197 on Jeralt: no offset matches.
- **No pairing of body and head slots in the heap.** Scanning 3.2 GiB of heap for u16/u32 head slot 1106 within 64
  bytes of body slot 759 (thief, red), or 1197 near 850 (Jeralt, green), gives dozens of chance matches with no
  common layout.
- **Pointers to the unit records.** Each record's Switch address appears in the heap: a block around
  `0x248764a1xxx` holds many pointers per unit, and an array of `0x330`-byte objects (one per non-player unit,
  thieves and the off-map allies, none for Byleth or the leaders) points at its record from `+0x1DC`. It looks like
  AI state; nothing in it is a sprite ID. The map's drawing objects haven't been found.

To keep looking: diff the heap around those pointer blocks while one unit changes class (a Seal), or while the map
redraws a unit that changes army. The probe scripts used for all of this read through `GameMemory` (connect,
`read()` until `_copies` is set, `battle_units()`, `capture_battle()` for the raw pool).

## Game tables (not memory, but needed to read it)

`fixed_persondata.bin` section 0, `0x50`-byte rows by character ID: `+0x12` u16 name ID, `+0x14` u16 (0 on every row
looked at), `+0x16` and `+0x18` u16 IDs (the character ID for students; the generic Thief, 164, holds 60 and 110:
unknown, probably portrait and voice), `+0x1A` class, `+0x1B` age, `+0x1C` birth month (1-based), `+0x1E` birth day,
`+0x24` allegiance, `+0x26` gender. More in `gamefiles/extract/data.py`.
