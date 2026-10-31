# Finding FE3H's unit roster in memory

How the live unit data of Fire Emblem: Three Houses was located inside a running Switch emulator. It's written as a
walkthrough for someone learning reverse engineering: each step says what was tried, what was seen and what it teaches,
dead ends included.

**Setup:** FE3H 1.2.0 · Eden emulator on Windows · Python with ctypes and capstone · read-only access

## The answer, in three hops

1. Open the `eden.exe` process for reading only.
2. Find the game's main program: the mapped memory region that starts with `00 00 00 00 08 00 00 00 "MOD0"` and has
   the 1.2.0 build ID at `+0x19E3840`. On the Switch side it sits at `0x80004000`.
3. Read the roster at `main + 0x1B127E4` (Switch address `0x81B167E4`): 60 slots of `0x24C` bytes, one per
   character.

```
on screen = raw stat + class boost + mounted boost + ability bonuses + accessory
```

## Before you start

| Term | Meaning |
|---|---|
| Host | The PC. A host address is where a byte really sits inside `eden.exe`. |
| Guest | The emulated Switch. A guest address is the address the game itself uses. |
| Little-endian | Numbers are stored low byte first, so the 2-byte value `0x0014` appears in memory as `14 00`. |
| Ground truth | Values you already know. Here: the tracker's readings of 15 units (stats, class, abilities) from the Status page. |

The tracker only ever *reads* memory (`PROCESS_VM_READ`) and never writes to it. The tools are Windows' `VirtualQueryEx` and `ReadProcessMemory` through Python's ctypes, plus the
[capstone](https://www.capstone-engine.org/) disassembler.

## 1. Survey the emulator's memory

*Goal: find where the Switch's RAM lives inside eden.exe.*

Walk the whole address space with `VirtualQueryEx` and listed the large regions.

```python
# every region of the process, start to end
addr = 0
while VirtualQueryEx(h, addr, byref(mbi), sizeof(mbi)):
    if mbi.State == MEM_COMMIT and mbi.RegionSize >= 64 << 20:
        print(hex(mbi.BaseAddress), hex(mbi.RegionSize), mbi.Type)
    addr = mbi.BaseAddress + mbi.RegionSize
```

One shared-memory region was exactly 4 GiB (`0x100000000` bytes): the Switch's 4 GiB of RAM. Next to it was a huge
reserved window, hundreds of GiB, with many small pieces mapped into it. That window is Eden's *fastmem*: it places
every Switch page at `host = base + guest address`, so once you know `base`, the game's own pointers can be followed
by adding one constant.

> **Lesson:** start with the shape of memory. A size that matches the hardware (4 GiB) is a strong clue.

## 2. Find the game's code and the base constant

*Goal: locate the main program, and the constant that turns guest addresses into host addresses.*

Eden's log lists each loaded module with its build ID (main: `89048449BA238C8C…`). Searching all readable memory for
those 16 bytes took about 2 minutes and found three copies. One was inside the fastmem window, at the end of a large
read-only region. That region begins with the program's header (`MOD0` at offset 8). That is the main module, at host
`0x1B590BD1000`.

To get the base constant, look at the pointers stored in main's data. Most fell between `0x80000000` and
`0x83FFFFFF`, and a 16 KiB loader module sits just before main. So guess loader = `0x80000000`,
main = `0x80004000`, base = `0x1B510BCD000`.

**Test:** follow 400 of those pointers. With that base, 339 landed on readable text. With two other candidate
bases, none did.

> **Lesson:** turn every guess into a test that can fail. 339 of 400 against 0 of 400 settles it.

> **Later:** the main program's Switch address isn't fixed. The address varies between launches (for example `0x8077B000`), found from
> pointers that must land exactly (heap blocks linking to each other, and a pointer the game keeps to its own
> data). `gamemem/history.py` works the base out that way on each connect instead of assuming it.

## 3. Search for values you know

*Goal: find one unit's record.*

For each of the 15 units, search the fastmem window (3 GiB, about 10 seconds) for its Str, Mag, Dex, Spd, Lck,
Def and Res as 7 bytes in a row.

**Mostly a miss:** only Catherine and Shamir turned up, twice each (once in the game's global data, once in a heap
copy). Every student failed, even ones scanned minutes earlier.

> **Lesson:** a failed search is information. These two were the only units whose stored numbers equal their
> on-screen numbers. Step 5 shows why.

## 4. Look at the neighbours

*Goal: find out what the two hits belong to.*

The two hits were 588 bytes (`0x24C`) apart, and Catherine and Shamir have consecutive character IDs (32 and 33).
That pointed to an array of 588-byte records, so dump memory at that spacing in both directions.

Out came 40 records, one per character, in ID order: Byleth, Edelgard, Dimitri, Claude and so on, each with a
plausible level and stats. All the students were there, just with slightly different numbers from the Status page.

A side observation: every character outside the army sat at exactly level 15, with stats well above their published
starting stats. The game evidently raises unrecruited characters as the story goes on. The code that
does it was not traced.

> **Lesson:** once you have one record, its neighbours give you the record size and the whole array.

## 5. Explain the differences

*Goal: find out why the students didn't match.*

Subtracting memory from the Status page for every unit and grouping the results by class shows that the difference depends only on the class: 

| Class | Units | Screen minus memory |
|---|---|---|
| Fighter | Raphael, Hilda, Cyril | Str +1 |
| Mage | Lysithea, Hanneman | Mag +1, Dex +1, Res +2 |
| Priest | Marianne, Manuela | Dex +1, Res +3 |
| Mercenary | Byleth, Ignatz | HP +1, Str +1, Spd +1, Mv +1 |
| Noble, Commoner | Catherine, Shamir | nothing |

So memory holds each unit's *raw* stats and the screen adds a class boost. Catherine and Shamir are in classes with
no boost, which is why only they matched in step 3.

> **Lesson:** differential analysis. Compare many known cases and look for what the differences have in common.

## 6. Confirm the layout with the game's code

*Goal: prove the record size, the array start and the field meanings, instead of guessing from data.*

The emulator has already decrypted and decompressed the game's code into memory, so main's 32 MiB can be copied straight
out. No keys or NSP extraction are needed. Disassemble it with capstone (ARM64).

```python
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
for ins in md.disasm(code[off:off + 160], 0x80004000 + off):
    print(hex(ins.address), ins.mnemonic, ins.op_str)
```

**Dead end:** listing every place the code builds an address near the records (ARM64 `adrp` + `add` pairs). The
busiest target, used 97 times, turned out to be "already initialized?" flags for unrelated data.

**Hit:** searching for instructions that load the record size, `0x24C`, found 158. Reading a few showed a loop
over the array:

```asm
ldrh  w10, [x9]           ; x9 = object + 0x668 = slot 0 + 0x24: a character ID
cmp   w10, #0x22          ; is it character 34 (Cyril)?
b.eq  found
ldrh  w10, [x9, #0x24c]   ; the next slot's ID, 0x24C bytes later
cmp   w10, #0x22
b.eq  found_next
add   x9, x9, #0x498      ; skip two slots (the loop is unrolled)
cmp   x10, #0x3c          ; 60 slots in total
b.lo  loop
...
mov   w9, #0x24c
madd  x8, x8, x9, x20     ; slot = object + index * 0x24C
ldrb  w8, [x8, #0x6f0]    ; object + 0x644 + 0xAC: the slot's flags
tbnz  w8, #1, ...         ; test bit 1
```

That one loop gives the slot count (60), the slot size (`0x24C`), where slots start (`object + 0x644`), the character
ID (`+0x24`) and a flags byte (`+0xAC`). Elsewhere the code does `orr w9, w9, #3` on that flags byte, which looks like
adding a unit to the army.

**Dead end:** the loop read its `object` from a global pointer that held 0 at the time.

**Hit:** the address list from the first dead end also contained `0x81B161A0`, which the code uses directly.
`0x81B161A0 + 0x644` lands exactly on Byleth's record. So the roster is a global object at a fixed address for this
game version, and no pointer chain is needed.

> **Lesson:** data tells you *what*; code tells you *how it's used*. A constant like a record size makes a good
> search key in code.

## 7. Decode the remaining fields

*Goal: name every byte the tracker needs.*

Raphael's slot (offsets from the start of the slot; rows without known fields left out):

```
+020  71 1d c3 1b 14 00 43 00 24 00 ff ff d7 00 01 00
+040  00 00 50 00 00 00 00 00 37 00 10 04 2a 05 13 07
+050  08 09 09 0d 04 04 0b 00 04 50 08 00 20 00 00 00
+070  00 00 00 00 00 20 00 02 00 00 00 00 00 00 00 0c
+080  a5 06 40 b1 16 14 0a 06 00 03 06 00 02 00 00 00
+0A0  26 26 26 26 26 26 26 26 26 26 26 26 03 00 04 ff
```

| Offset | Bytes | Meaning |
|---|---|---|
| `+0x24` | `14 00` | Character ID 20, Raphael |
| `+0x4A` | `10` | Level 16 (inferred; not checked against the screen) |
| `+0x4B` | `04` | Class 4. Raphael, Hilda and Cyril all have it, and the game's class-name list has Fighter in position 4 (step 8). |
| `+0x4C` | `2a` | HP 42 |
| `+0x4E` | `13 07 08 09 09 0d 04` | Str 19, Mag 7, Dex 8, Spd 9, Lck 9, Def 13, Res 4 |
| `+0x55` | `04 0b` | Mv 4, Cha 11 |
| `+0x7F` | `0c a5 06 40 b1` | Equipped abilities 12, 165, 6, 64, 177: Axe Prowess Lv 3, Lancebreaker, Lance Prowess Lv 2, HP +5, Weight -3 |
| `+0xAC` | `03` | Flags: both low bits set = in the army |

How the abilities were found: `40` and `44` were first spotted side by side in Byleth's slot. In the game's ability list
those are HP +5 (64) and Speed +2 (68), two of his abilities. After that, all five slots matched the tracker for all
15 units, in order. `ff` means an empty slot. The army flag was checked the same way: both low bits are set for
exactly the 15 army units and nobody else.

> **Lesson:** check each field against every unit you have, not just one.

## 8. Find the lookup tables

*Goal: turn IDs into names, and raw stats into on-screen stats.*

**Class boosts.** Step 5 gave three known rows (Fighter, Mage, Priest). Searching memory for each row's bytes and
keeping only places where Fighter (class 4), Mage (14) and Priest (16) sat at one common spacing leaves exactly one spacing: `0x76` bytes. Reading that table column by column gave the stat boosts, an HP boost column, and a second set of
boosts that only mounted classes have.

Cavaliers looked wrong at first: their Spd was one lower on screen than the class boost predicted. A randomizer's
feature list mentioned separate "mounting stat boosts", and those explain it: a mounted Cavalier gets Spd −2 and
Mv +3 on top of the class boost.

**Names.** Searching memory for the text `Myrmidon` found the game's class names stored one after another, separated
by zero bytes. A class ID is its position in that list (Noble = 0). Character and ability names are stored the same
way (Byleth = 0, Sword Prowess Lv 1 = 0).

**Cross-check:** the table gives the published Mv values: Paladin 8, Swordmaster 5, Fortress Knight 4.

> **Lesson:** once you know a few entries of a table, the spacing between them finds the rest of it.

## 9. Make it repeatable

*Goal: find everything again after a restart, when host addresses change.*

Host addresses change every launch; only the layout relative to the main module stays put. A short script lists
Eden's mapped regions, keeps the one that starts with the `MOD0` header and has the 1.2.0 build ID at the right
offset, and reads all 60 slots in one call. Finding the game takes about 50 ms; reading the whole roster takes about
7 microseconds.

```python
for r in mapped_regions(h):
    if read(h, r.base, 12) == b"\0\0\0\0\x08\0\0\0MOD0" \
       and read(h, r.base + 0x19E3840, 16) == BUILD_ID_1_2_0:
        roster = read(h, r.base + 0x1B127E4, 60 * 0x24C)
```

> **Lesson:** anchor on something unique and stable (a header plus a build ID), and check the game version before
> trusting fixed offsets.

## 10. Find the accessory

*Goal: the Status page includes accessory effects (a March Ring gives Mv +1), so find each unit's accessory.*

The first 24 bytes of every slot are the inventory: six pairs of (u16 item ID, u16 uses). Item IDs fall into
ranges, which the game's item lookup function spells out (it subtracts and compares, range by range): weapons
10–509, equipment 600–649, items 1000–1199, spells 4000+. A unit's accessory is the one inventory item in the
600 range; equipment ID = item ID − 600 (March Ring = 616 − 600 = 16).

**Dead end:** there is no separate "equipped accessory" field. Three units didn't match their
earlier scans because their accessories had been swapped since. Memory was right all along.

> **Lesson:** when the data disagrees with your ground truth, check whether the ground truth is out of date.
> Check against the screen.

## 11. Find what each accessory does

*Goal: know which accessories change a Status-page stat, and by how much.*

**Dead end:** the lookup function reads each item table through a global pointer, and those globals read as 0 in
Eden's view of memory. The reason is still open.

**Hit:** every game data table starts with the same 4-byte tag, `00 19 12 16`, followed by its entry count and entry
size. Searching memory for the tag listed every table, and four of them had exactly the counts from the lookup
function's ranges: 500 weapons, 38 spells, 50 equipment and 200 items. Entries start 0x40 bytes after the tag.

In the 50 equipment entries (0x18 bytes each), byte 20 is an effect type and byte 2 its amount: Speed Ring 7/2,
Goddess Ring 8/4, March Ring 11/1. Published values (Spd +2, Lck +4, Mv +1) make 7 Spd, 8 Lck and 11 Mv; the house
items use type 12 with 2, and a published accessory list confirms those give Cha +2.

The 500 weapon rows also have two bytes at `+0x08` and `+0x09` that initially looked like a two-byte icon index.
They are separate fields. `+0x09` is the native crest ID: Thunderbrand has 16 (Charon), Sword of the Creator has
21 (Flames), and Areadbhar has 8 (Blaiddyd); ordinary weapons use 86, which the character crest table marks as
None. `+0x08` follows weapon model variants (Iron Sword 5, Steel 6, Silver 7, Brave 8, Killing Edge 9, Training
Sword 10), so it is not an atlas rectangle index either. The atlas rectangle table at main `+0xD52D60` describes
the 6026 icon texture regions, but neither table byte directly selects those records. The importer keeps only the
raw row (`raw`) for these bytes; do not combine them into an `icon_index`.

> **Lesson:** a file format's header is a map. Once you know one table's header, you can find all of them.

## 12. Personal abilities and names

*Goal: everything else a Status page scan records.*

- **Personal ability.** Searching every data table for an offset where all 15 units' entries hold their personal
  ability ID. One table matched: 45 entries of 0x3E bytes, offset 0x14 (offset 0x15 holds the upgraded "+"
  version for Byleth and the house leaders). Its last entries also settled the DLC IDs: 1040–1046 are entries 38–44
  (Yuri, Balthus, Constance, Hapi, Aelfric, Jeritza, Anna).
- **Full names.** The game keeps given names, middle names and surnames as three lists by character ID. Joining them
  gives exactly what the Status page shows ("Lorenz Hellman Gloucester", "Hanneman von Essar", just "Catherine").
- **Byleth's name.** The name the player chose is stored right after the last roster slot, as
  `\x1bN0Byleth\x1bN1` (text markup around the name).

> **Lesson:** a brute-force test is fine when the test is strict. Requiring 15 matches at one offset left
> exactly one candidate out of 160 tables.

## 13. Follow a battle in progress

*Goal: a unit levelled up mid-battle, but the roster still showed the old stats.*

**What was seen:** comparing the roster with the earlier fixture, only two counters had changed (`+0xBA` and `+0xBC`,
each +1 when the battle started). Level and stats were untouched: the roster is only written when the battle ends.

**Value scan again:** search for Lysithea's slot pattern with each stat allowed to be the same or one higher.
Seven hits: the roster, its heap mirror, three level-16 copies, and two at level 17. One level-17 copy sat in an
array of 0x330-byte records holding every unit on the map, players first and then the enemies. Each record is a
full slot, followed by battle-only fields, and starts 0x14 bytes after a fixed 9-byte marker
(`04 03 00 00 00 00 00 00 00`). The other copies were in a more compact format, probably the turn history Divine
Pulse uses.

**Dead ends:** no pointer path from the game's globals reached the array within two hops, and no code indexes it by
0x330, so the array can't be found by following pointers the way the roster can.

**What works:** a scan for the marker over Eden's memory (about 2 s) finds the copies, and they are then re-read on
every poll (about 0.2 ms). Two checks keep stale copies out:

- the copy's battle counter is exactly one behind the roster's (the roster counts the battle when it starts), which
  rules out copies left over from an earlier battle or from before a reload;
- the copy is used only while it's *ahead* of the roster (a higher level, or the same level with higher stats),
  since stats only grow in battle. When the battle ends and the roster is written back, they're equal again.

The scan runs again whenever the roster's battle counters change, which happens when a battle starts.

> **Lesson:** when the data you found stops updating, look for a working copy. Games often edit a copy and commit it
> at a checkpoint.

## 14. Find the equipped weapon or spell

*Goal: Lysithea had a dark spell equipped, but the map showed a bow badge: the tracker guessed "the first weapon in
the inventory", and her Iron Bow was at the top.*

**Compare groups:** in one live read of the battle records (The Remire Calamity, 12 army records and the enemies), look
for a field that splits the units who should have a spell equipped (Hanneman and Manuela carry no weapons,
Lysithea had the dark spell) from those with a weapon. The u16 at `+0x2E` did:

| Unit | `+0x2E` | Reads as |
|---|---|---|
| Every unit with a weapon (all 7 army units, every bandit, soldier and boss with a weapon) | 1 | the weapon at the top of the inventory |
| Hanneman | 4000 | spell 0, Fire |
| Manuela, an enemy healer | 4028 | spell 28, Nosferatu |
| Lysithea | 4014 | spell 14, Miasma Δ (dark) |
| An enemy mage with Fire only | 4000 | Fire |
| An enemy with a Circe Staff and Death / Banshee / Miasma | 4017 | spell 17, Banshee Θ |
| Villagers with only a Vulnerary, breakable walls, units not deployed | `0xFFFF` | nothing |

**Check it moves:** the Oil and Water recording keeps the
raw record bytes. Lysithea's field goes from 4029 (Seraphim) to 4000 (Fire) in the same read that her Fire uses drop
from 10 to 9: casting a spell equips it. Hanneman's reads 4004 (Thoron), which explains why he linked an attack from
one tile though an Iron Bow (range 2) is at the top of his inventory. The roster slot has the same field (Lysithea's
was 4020, Dark Spikes Τ, from before the battle, while her battle copy had moved on to Miasma), and so do the Divine
Pulse history's full records (they're the first 0x10C bytes of a battle record).

**What's left open:** weapon users have only ever shown 1, with the weapon they use at the top of the inventory
(the game moves an equipped weapon there). Whether 1 means "a weapon" or "slot 0 + 1" isn't known; both read the same.

## The memory map

### Roster slot (0x24C bytes, 60 slots)

| Offset | Size | Field |
|---|---|---|
| `+0x00` | 6 × (u16, u16) | Inventory: item ID and uses. Item IDs 600–649 are equipment (the accessory) |
| `+0x24` | u16 | Character ID (`0xFFFF` = empty slot) |
| `+0x26`, `+0x28` | u16 | Lifetime "Battles" (fights) and "Victories" (units defeated) counters |
| `+0x2E` | u16 | Equipped: 4000 + spell ID for a spell, 1 for the weapon at the top of the inventory, `0xFFFF` nothing (step 14) |
| `+0x4A` | u8 | Level (inferred) |
| `+0x4B` | u8 | Class ID |
| `+0x4C` | u8 | HP (raw) |
| `+0x4D` | u8 | Unknown: 5 or 6 for units in use, 0 for benched ones |
| `+0x4E`–`0x54` | 7 × u8 | Str, Mag, Dex, Spd, Lck, Def, Res (raw) |
| `+0x55` | u8 | Mv (raw, 4 for everyone) |
| `+0x56` | u8 | Cha (raw) |
| `+0x7F`–`0x83` | 5 × u8 | Equipped ability IDs (`0xFF` = empty) |
| `+0x84`–`0x86` | 3 × u8 | Equipped combat art IDs (Sunder 0 … Pneuma Gale 79; 80 and up = empty) |
| `+0x94`–`0x9D` | 10 × u8 | Uses left of each learned spell: 5 Reason, then 5 Faith |
| `+0xA0`–`0xA9` | 10 × u8 | The learned spells' IDs, same order |
| `+0xAC` | u8 | Flags; `0x03` set = in the army |
| `+0xBA`, `+0xBC` | u16 | Battle counters; the roster counts a battle when it starts |

### Battle record (0x330 bytes, one per unit on the map)

The slot layout above, then battle-only fields. The records sit in one array, players first, found by scanning for
the marker `04 03 00 00 00 00 00 00 00` (0x14 bytes before each record; see step 13). Located with the battle
recorder and `tools/analyze_battle_recording.py`; the offsets the tracker reads are in
`backend/app/data/battle_fields.json`.

| Offset | Size | Field |
|---|---|---|
| `+0xD6`, `+0xD7` | u8 | Has acted / in combat (bit `0x04`); not used by the tracker |
| `+0xDE` | u8 | Current HP (0 for a defeated unit, whose record stays in the array) |
| `+0xF2`, `+0xF3` | u8 | Map position, x then y (x across from the left, y down from the top) |

### Battle globals

Offsets from the start of the game's global data (`GameMemory.GLOBALS[0]`, main program + `0x19E4000`):

| Offset | Size | Field |
|---|---|---|
| `+0xDB510` | u8 | Divine Pulse charges left |
| `+0xDEE00` | u8 | Turn number (0 while the Divine Pulse screen is open) |
| `+0xDE1A8` | u32 | Number of entries in the battle history (the Divine Pulse list) |
| `+0xDE228` | 100 × u64 | Switch address of each turn's first history entry (`gamemem/history.py` decodes them) |
| `+0x16312C` | u16 | Map id: the battle map's terrain grid |
| `+0x163130` | u16 | Scenario id: which battle it is; `0xFF` outside a battle |

### Battle history entries: what each action holds

Header layout is in `gamemem/history.py`. The action byte (`+0x19`, repeated at `+0x24`, with the actor at `+0x25`)
and the two fields after it, as seen so far (FE3H 1.2.0; Oil and Water fixtures plus a live read):

| Action | `+0x26` (u8) | `+0x28` ITEM (u16) | Seen as |
|---|---|---|---|
| `0x0B` | 1 moved, 0 stayed | 0, or an attack's damage × 100 + outcome when a target is set | "Byleth moved." / "waited."; an attack before a Canto move |
| `0x00` | 0 | damage × 100 + outcome (1 target fell, 2 attacker fell, 3 both stood) | a weapon attack |
| `0x03` | spell ID | as for an attack, or 0 | magic: kills with Fire (ITEM ≠ 0); staves with ITEM 0: Rescue (36) on an ally, Ward (34) on a unit at full HP |
| `0x05` | 0 | item ID: 1000 Vulnerary (consumables start at 1000) | "Flayn used Vulnerary." |
| `0x01` | combat art ID | as for an attack, or 0 on an ally | "Ignatz's Break Shot dealt 4 damage…", "Byleth used Swap on Claude." |
| `0x17` | `0xFF` | 0 | Rally; TARGET is `0xFF` and the entry ends with the u8 character IDs of the unit that rallied and the one rallied |

The Divine Pulse screen words these as "X waited.", "X moved.", "X's attack dealt N damage to Y.", "X used
Vulnerary.", "X used Rescue." and "Began enemy phase."; nothing online lists the screen's wording, so it comes from
the game. Combat arts and Rally were seen live. An
art followed by a Canto move turns `+0x19` into `0x0B` but keeps `0x01` at `+0x24`, with the art and target set, so
the action is read from `+0x24`. Full records carry the inventory and spell uses after each action, which shows the
weapon an action wore down. Not seen yet, so logged as "X acted" (or "X acted on Y" between your own units): gambits,
Dance, trades, opening doors and chests, seizing and visiting. Heal on a hurt ally was seen with action `0x03` before ITEM and `+0x26` were decoded, so it's assumed to
match Rescue (spell at `+0x26`); a heal with any other code still shows as healing from the HP it restored.

### Other game data tables

Each table starts with the tag `00 19 12 16`, then a u32 entry count and a u32 entry size; entries start 0x40 bytes
after the tag. The tables live in the heap, so they are found by tag, count and size.

| Table | Entries × size | Used for |
|---|---|---|
| Classes | 100 × 0x76 | HP boost at +0x10, Str…Cha boosts at +0x27, mounted boosts at +0x30 |
| Equipment | 50 × 0x18 | Effect type at +20 with its amount at +2 (second effect at +21 / +3) |
| Character extras | 45 × 0x3E | Personal ability at +0x14, upgraded version at +0x15 |

### Class table entry (0x76 bytes, 100 classes)

The table lives in the heap, so its address changes every launch. Which byte an entry starts on is unconfirmed, so
positions are given relative to the Str boost:

- HP boost: 23 bytes before the Str boost.
- Str, Mag, Dex, Spd, Lck, Def, Res, Mv, Cha boosts: 9 signed bytes starting at the Str boost.
- Mounted boosts in the same order: the next 9 bytes.

## Techniques used

| Technique | What it is |
|---|---|
| Value scan | Search memory for numbers you already know. |
| Stride analysis | The gap between two known records gives the record size, and from it the array. |
| Differential analysis | Compare memory with the screen across many cases; the pattern in the differences reveals hidden rules. |
| Constant search | Find code by searching for a number it has to use, such as a record size. |
| Cross-references | Find the code that builds a given address (on ARM64, `adrp` + `add` pairs). |
| Validation | Check every field against every known unit, and check tables against outside sources. |

## Open questions

- How the game reaches its battle unit array is still unknown; memory mode finds it by scanning.
- The map's terrain grid isn't in memory in the layout of the game's terrain files; the tracker uses the map id above to look up the terrain it reads from the player's import.
- The byte at `+0x4D` is unexplained.
- When the upgraded "+" personal ability applies isn't known; memory mode keeps whichever version is already stored.
- Battalion bonuses aren't handled; none of the tested units had a battalion.
- Some global pointers (the item tables', the roster object's) read as 0 in Eden's view of memory. Everything that
  mattered could be reached another way, but the reason is still open.
- The offsets are for version 1.2.0 only, and Eden's fastmem setting must be on (it is by default).

## Appendix: ID tables

Read from the game's own text and class data in memory.

### Characters (slot field +0x24)

IDs 0–57 come from the game's name list; 1040+ are the Cindered Shadows and DLC units.

| ID | Character | ID | Character |
|---|---|---|---|
| 0 | Byleth (male) | 33 | Shamir |
| 1 | Byleth (female) | 34 | Cyril |
| 2 | Edelgard | 35 | Jeralt |
| 3 | Dimitri | 36 | Rhea |
| 4 | Claude | 37 | Sothis |
| 5 | Hubert | 38 | Kronya |
| 6 | Ferdinand | 39 | Solon |
| 7 | Linhardt | 40 | Thales |
| 8 | Caspar | 41 | Cornelia |
| 9 | Bernadetta | 42 | Death Knight |
| 10 | Dorothea | 43 | Kostas |
| 11 | Petra | 44 | Lonato |
| 12 | Dedue | 45 | Miklan |
| 13 | Felix | 46 | Randolph |
| 14 | Ashe | 47 | Flame Emperor |
| 15 | Sylvain | 48 | Anna |
| 16 | Mercedes | 49 | Jeritza |
| 17 | Annette | 50 | Rodrigue |
| 18 | Ingrid | 51 | Judith |
| 19 | Lorenz | 52 | Nader |
| 20 | Raphael | 53 | Monica |
| 21 | Ignatz | 54 | Lord Arundel |
| 22 | Lysithea | 55 | Tomas |
| 23 | Marianne | 56 | Nemesis |
| 24 | Hilda | 57 | Seiros |
| 25 | Leonie | 1040 | Yuri |
| 26 | Seteth | 1041 | Balthus |
| 27 | Flayn | 1042 | Constance |
| 28 | Hanneman | 1043 | Hapi |
| 29 | Manuela | 1044 | Aelfric |
| 30 | Gilbert | 1045 | Jeritza |
| 31 | Alois | 1046 | Anna |
| 32 | Catherine |  |  |

### Classes (slot field +0x4B) with boosts

| ID | Class | Class boost | Mounted boost |
|---|---|---|---|
| 0 | Noble | – | – |
| 1 | Commoner | – | – |
| 2 | Myrmidon | Spd +1 | – |
| 3 | Soldier | Dex +1 | – |
| 4 | Fighter | Str +1 | – |
| 5 | Monk | Res +1 | – |
| 6 | Lord | HP +1, Spd +1, Lck +1, Mv +1, Cha +2 | – |
| 7 | Mercenary | HP +1, Str +1, Spd +1, Mv +1 | – |
| 8 | Thief | Dex +2, Spd +2, Mv +1 | – |
| 9 | Armored Knight | HP +3, Spd -2, Def +4, Res -1 | – |
| 10 | Cavalier | HP +1, Str +1, Dex +2, Spd +1, Def +1 | Spd -2, Mv +3 |
| 11 | Brigand | HP +2, Str +2, Mv +1 | – |
| 12 | Archer | Dex +2, Lck +2, Mv +1 | – |
| 13 | Brawler | HP +1, Dex +2, Spd +2, Res -1, Mv +1 | – |
| 14 | Mage | Mag +1, Dex +1, Res +2 | – |
| 15 | Dark Mage | Mag +2, Dex +1, Res +1 | – |
| 16 | Priest | Dex +1, Res +3 | – |
| 17 | Barbarossa | HP +3, Str +3, Dex +5, Def +2, Mv +2, Cha +2 | Spd +2, Mv +2 |
| 18 | Hero | HP +3, Str +2, Spd +2, Lck +1, Def +1, Mv +1 | – |
| 19 | Swordmaster | HP +1, Str +2, Dex +1, Spd +4, Def +1, Mv +1 | – |
| 20 | Assassin | Dex +3, Spd +5, Lck +1, Mv +2 | – |
| 21 | Fortress Knight | HP +5, Spd -6, Def +10 | – |
| 22 | Paladin | HP +2, Str +2, Dex +2, Spd +1, Def +2, Res +2, Mv +2 | Spd -2, Mv +2 |
| 23 | Pegasus Knight | Dex +3, Spd +2, Res +3, Mv +1 | Spd +2, Mv +2 |
| 24 | Wyvern Rider | HP +1, Str +2, Dex +1, Spd +1, Def +2, Mv +1 | Str +1, Spd +2, Mv +2 |
| 25 | Warrior | HP +3, Str +3, Spd +1, Lck +1, Def +1, Mv +1 | – |
| 26 | Sniper | Str +1, Dex +5, Lck +3, Mv +1 | – |
| 27 | Grappler | HP +2, Str +1, Dex +3, Spd +3, Def +1, Res -1, Mv +2 | – |
| 28 | Warlock | Mag +3, Dex +1, Spd +1, Res +4 | – |
| 29 | Dark Bishop | Mag +4, Dex +2, Res +3 | – |
| 30 | Bishop | HP +1, Mag +2, Dex +1, Res +5 | – |
| 31 | Falcon Knight | Dex +4, Spd +3, Res +4, Mv +2 | Str +1, Spd +2, Mv +2 |
| 32 | Wyvern Lord | HP +2, Str +2, Dex +1, Spd +2, Def +3, Mv +2 | Str +2, Spd +2, Mv +2 |
| 33 | Mortal Savant | HP +1, Str +1, Mag +2, Dex +1, Spd +1, Def +2, Res +2, Mv +2 | – |
| 34 | Great Knight | HP +5, Str +1, Spd -2, Def +6 | Spd -2, Def +2, Mv +3 |
| 35 | Bow Knight | HP +2, Str +1, Dex +3, Spd +3, Lck +1, Def +1, Mv +2 | Spd -2, Mv +2 |
| 36 | Dark Knight | HP +1, Str +1, Mag +2, Dex +2, Spd +1, Def +1, Res +3, Mv +2 | Spd -2, Def +1, Mv +1 |
| 37 | Holy Knight | HP +2, Str +1, Mag +1, Dex +2, Spd +1, Res +4, Mv +2 | Spd -2, Def +1, Mv +1 |
| 38 | War Master | HP +3, Str +5, Spd +2, Lck +1, Def +1, Mv +2 | – |
| 39 | Gremory | Mag +5, Dex +2, Spd +1, Res +4, Mv +1, Cha +2 | – |
| 40 | Emperor | HP +8, Spd -4, Lck +1, Def +8, Mv +1, Cha +2 | – |
| 41 | Agastya | HP +1, Mag +5, Def +2, Res +5, Cha +2 | – |
| 42 | Enlightened One | HP +1, Str +2, Mag +3, Dex +1, Spd +1, Lck +1, Def +2, Res +2, Mv +2, Cha +1 | – |
| 43 | Dancer | Str +1, Dex +3, Spd +3, Def +2, Res +1, Mv +2, Cha +2 | – |
| 44 | Great Lord | HP +5, Str +2, Spd +4, Lck +1, Def +1, Mv +2, Cha +2 | – |
| 45 | King of Liberation | HP +8, Str +3, Dex +2, Spd +3, Def +6, Res +4, Mv +1, Cha +2 | – |
| 46 | Saint | HP +1, Str +5, Mag +2, Dex +2, Lck +2, Def +5, Res +2, Mv +1, Cha +2 | – |
| 47 | Flame Emperor | HP +5, Spd -3, Def +5, Mv +1, Cha +2 | – |
| 48 | Flame Emperor | HP +5, Spd -3, Def +5, Mv +1, Cha +2 | – |
| 49 | Thief | Dex +1, Spd +1, Mv +1 | – |
| 50 | Ruffian | Spd +1 | – |
| 51 | Paladin | HP +3, Dex +1, Spd +1, Def +2, Res +2, Mv +2 | Str +2, Spd -2, Mv +2 |
| 52 | Fortress Knight | HP +5, Spd -6, Def +2 | – |
| 53 | Lord | HP +5, Str +2, Spd +4, Lck +1, Def +1, Mv +2, Cha +2 | – |
| 54 | Pegasus Knight | Dex +2, Spd +1, Res +2 | Spd +2, Mv +2 |
| 55 | Archbishop | HP +1, Str +2, Mag +2, Dex +2, Lck +2, Def +2, Res +2, Mv +1, Cha +2 | – |
| 56 | Armored Lord | HP +5, Spd -3, Def +5, Mv +1, Cha +2 | – |
| 57 | High Lord | HP +3, Str +1, Spd +3, Def +1, Mv +1, Cha +2 | – |
| 58 | Wyvern Master | HP +2, Str +1, Dex +3, Def +1, Cha +2 | Str +1, Spd +1, Mv +3 |
| 59 | Death Knight | HP +5, Str +2, Spd +3, Def +2, Res +3 | Str +1, Spd -2, Def +1, Mv +3 |
| 60 | Black Beast | – | – |
| 61 | Wandering Beast | – | – |
| 62 | Wild Demonic Beast | – | – |
| 63 | Demonic Beast | – | – |
| 64 | Exp. Demonic Beast | – | – |
| 65 | Altered Demonic Beast | – | – |
| 66 | Giant Demonic Beast | – | – |
| 67 | Flying Demonic Beast | Mv +1 | – |
| 68 | Golem | – | – |
| 69 | Altered Golem | – | – |
| 70 | Titanus | – | – |
| 71 | White Beast | Mv +1 | – |
| 72 | The Immaculate One | – | – |
| 73 | The Immaculate One | – | – |
| 74 | The Immaculate One | – | – |
| 75 | Lord of the Desert | – | – |
| 76 | Lord of the Lake | – | – |
| 77 | Giant Bird | Mv +2 | – |
| 78 | Giant Crawler | Mv +2 | – |
| 79 | Giant Wolf | Mv +2 | – |
| 80 | Hegemon Husk | – | – |
| 81 | King of Beasts | – | – |
| 82 | King of Fangs | Mv +2 | – |
| 83 | King of Wings | Mv +2 | – |
| 84 | Trickster | Dex +3, Spd +4, Lck +3, Res +1, Mv +1 | – |
| 85 | War Monk | HP +3, Str +2, Dex +1, Def +1, Res +1, Mv +2 | – |
| 86 | Dark Flier | Dex +3, Spd +2, Res +3, Mv +1 | Spd +2, Mv +2 |
| 87 | Valkyrie | HP +1, Mag +4, Res +1, Cha +2 | Spd -2, Def +1, Mv +2 |
| 88 | Umbral Beast | – | – |
| 89 | Verrat | Mag +3, Dex +1, Spd +1, Def +1, Res +4 | – |
| 90 | (unused) | – | – |
| 91 | Death Knight | HP +5, Str +3, Spd +3, Def +2, Res +3, Mv +1 | Str +1, Spd -2, Def +1, Mv +2 |
| 92 | Guardian Golem | – | – |
| 93 | (unused) | – | – |
| 94 | (unused) | – | – |
| 95 | (unused) | – | – |
| 96 | (unused) | – | – |
| 97 | (unused) | – | – |
| 98 | (unused) | – | – |
| 99 | (unused) | – | – |

Some names repeat (two Thief, Paladin, Lord and Death Knight entries): the game keeps separate variants, for
example for enemies. Class 100 in the name list, War Cleric, is the female name of War Monk (85).

### Abilities (slot fields +0x7F–0x83)

| ID | Ability | ID | Ability |
|---|---|---|---|
| 0 | Sword Prowess Lv 1 | 125 | Fistbreaker |
| 1 | Sword Prowess Lv 2 | 126 | Tomebreaker |
| 2 | Sword Prowess Lv 3 | 127 | Model Leader |
| 3 | Sword Prowess Lv 4 | 128 | Defensive Tactics |
| 4 | Sword Prowess Lv 5 | 129 | Offensive Tactics |
| 5 | Lance Prowess Lv 1 | 130 | Fire |
| 6 | Lance Prowess Lv 2 | 131 | Miasma Δ |
| 7 | Lance Prowess Lv 3 | 132 | Heal |
| 8 | Lance Prowess Lv 4 | 133 | Renewal |
| 9 | Lance Prowess Lv 5 | 134 | Catnap |
| 10 | Axe Prowess Lv 1 | 135 | Goody Basket |
| 11 | Axe Prowess Lv 2 | 136 | Songstress |
| 12 | Axe Prowess Lv 3 | 137 | Hunter's Boon |
| 13 | Axe Prowess Lv 4 | 138 | Poison Strike |
| 14 | Axe Prowess Lv 5 | 139 | Live to Serve |
| 15 | Bow Prowess Lv 1 | 140 | Lifetaker |
| 16 | Bow Prowess Lv 2 | 141 | Survival Instinct |
| 17 | Bow Prowess Lv 3 | 142 | Lethality |
| 18 | Bow Prowess Lv 4 | 143 | Poison |
| 19 | Bow Prowess Lv 5 | 144 | Pavise |
| 20 | Brawling Prowess Lv 1 | 145 | Aegis |
| 21 | Brawling Prowess Lv 2 | 146 | Miracle |
| 22 | Brawling Prowess Lv 3 | 147 | Terrain Resistance |
| 23 | Brawling Prowess Lv 4 | 148 | Special Dance |
| 24 | Brawling Prowess Lv 5 | 149 | Paragon |
| 25 | Reason Lv 1 | 150 | Professor's Guidance |
| 26 | Reason Lv 2 | 151 | Discipline |
| 27 | Reason Lv 3 | 152 | Aptitude |
| 28 | Reason Lv 4 | 153 | Vantage |
| 29 | Reason Lv 5 | 155 | Desperation |
| 30 | Faith Lv 1 | 156 | Quick Riposte |
| 31 | Faith Lv 2 | 157 | Wrath |
| 32 | Faith Lv 3 | 158 | Dance |
| 33 | Faith Lv 4 | 159 | Steal |
| 34 | Faith Lv 5 | 160 | Locktouch |
| 35 | Authority Lv 1 | 161 | Stealth |
| 36 | Authority Lv 2 | 162 | Canto |
| 37 | Authority Lv 3 | 163 | Pass |
| 38 | Authority Lv 4 | 164 | Swordbreaker |
| 39 | Authority Lv 5 | 165 | Lancebreaker |
| 40 | Swordfaire | 166 | Bowrange +1 |
| 41 | Lancefaire | 167 | Bowrange +2 |
| 42 | Axefaire | 168 | Black Magic Range +1 |
| 43 | Bowfaire | 169 | Dark Magic Range +1 |
| 44 | Fistfaire | 170 | White Magic Range +1 |
| 45 | Black Tomefaire | 171 | Unarmed Combat |
| 46 | White Tomefaire | 172 | Black Magic Uses x2 |
| 47 | Dark Tomefaire | 173 | Dark Magic Uses x2 |
| 48 | Sword Crit +10 | 174 | White Magic Uses x2 |
| 49 | Lance Crit +10 | 175 | White Magic Heal +5 |
| 50 | Axe Crit +10 | 176 | White Magic Heal +10 |
| 51 | Bow Crit +10 | 177 | Weight -3 |
| 52 | Brawl Crit +10 | 178 | Weight -5 |
| 53 | Black Magic Crit +10 | 179 | Axebreaker |
| 54 | White Magic Crit +10 | 180 | Unsealable Magic |
| 55 | Dark Magic Crit +10 | 181 | Immune Status |
| 56 | Sword Avo +20 | 182 | General |
| 57 | Lance Avo +20 | 183 | Commander |
| 58 | Axe Avo +20 | 184 | Infinite Magic |
| 59 | Bow Avo +20 | 185 | Magic Bind |
| 60 | Brawl Avo +20 | 186 | Infantry Effect Null |
| 61 | Black Magic Avo +20 | 187 | Armored Effect Null |
| 62 | White Magic Avo +20 | 188 | Cavalry Effect Null |
| 63 | Dark Magic Avo +20 | 189 | Flying Effect Null |
| 64 | HP +5 | 190 | Dragon Effect Null |
| 65 | Strength +2 | 191 | Monster Effect Null |
| 66 | Magic +2 | 192 | Effect Null |
| 67 | Dexterity +4 | 193 | Air of Intimidation |
| 68 | Speed +2 | 194 | Vital Defense |
| 69 | Pomp & Circumstance | 195 | Giant Wings |
| 70 | Defense +2 | 196 | Anti-Magic Armor |
| 71 | Resistance +2 | 197 | Divine Dragon Horn |
| 72 | Movement +1 | 198 | Path of the Conqueror |
| 73 | Hit +20 | 199 | Noncombatant |
| 74 | Avo +10 | 200 | Battalion Desperation |
| 75 | Crit +20 | 201 | Cursed Power |
| 76 | Defiant Str | 202 | Anchor |
| 77 | Defiant Mag | 203 | Counterattack |
| 78 | Defiant Spd | 204 | Twin Crests |
| 79 | Defiant Def | 205 | Ancient Dragon Wrath |
| 80 | Defiant Res | 206 | Surging Light |
| 81 | Defiant Avo | 207 | Ancient Dragonskin |
| 82 | Defiant Crit | 208 | Keen Intuition |
| 83 | Imperial Lineage | 209 | Staunch Shield |
| 84 | Royal Lineage | 210 | Lone Wolf |
| 85 | Leicester Lineage | 211 | Fighting Spirit |
| 86 | Mastermind | 212 | Confidence |
| 87 | Death Blow | 213 | Persecution Complex |
| 88 | Fiendish Blow | 214 | Animal Friend |
| 89 | Darting Blow | 215 | Perseverance |
| 90 | Armored Blow | 216 | Crest Scholar |
| 91 | Warding Blow | 217 | Compassion |
| 92 | Officer Duty | 218 | Lockpick |
| 93 | Lady Knight | 219 | Battalion Vantage |
| 94 | Watchful Eye | 220 | Battalion Wrath |
| 95 | Distinguished House | 221 | Battalion Renewal |
| 96 | Veteran Knight | 222 | Black Magic Uses Up+ |
| 97 | Charm | 223 | Dark Magic Uses x4 |
| 98 | Advocate | 224 | White Magic Uses Up+ |
| 99 | Guardian | 225 | Mighty King of Legend |
| 100 | Lily's Poise | 226 | 10 Elites |
| 101 | Infirmary Master | 227 | Alert Stance |
| 102 | Philanderer | 228 | Alert Stance+ |
| 103 | Rivalry | 229 | Close Counter |
| 104 | Born Fighter | 230 | Professor's Guidance+ |
| 105 | Rally Strength | 231 | Imperial Lineage+ |
| 106 | Rally Magic | 232 | Royal Lineage+ |
| 107 | Rally Speed | 233 | Leicester Lineage+ |
| 108 | Rally Defense | 234 | Murderous Intent |
| 109 | Rally Resistance | 235 | Sacred Power |
| 110 | Rally Movement | 236 | Agarthan Technology |
| 111 | Rally Dexterity | 237 | Blade Breaker |
| 112 | Rally Luck | 238 | Lucky Seven |
| 113 | Rally Charm | 239 | Transmute |
| 114 | Seal Strength | 241 | Honorable Spirit |
| 115 | Seal Magic | 242 | King of Grappling |
| 116 | Seal Speed | 243 | Circadian Beat |
| 117 | Seal Defense | 244 | Monstrous Appeal |
| 118 | Seal Resistance | 245 | Business Prosperity |
| 119 | Seal Movement | 246 | Umbral Leech |
| 120 | Heartseeker | 247 | Manifest Phantom |
| 121 | Swordbreaker+ | 248 | Enhanced Fortitude |
| 122 | Lancebreaker+ | 250 | Duelist's Blow |
| 123 | Axebreaker+ | 251 | Uncanny Blow |
| 124 | Bowbreaker |  |  |

## Skill ranks and experience

Each `0x24C` roster slot contains 11 current skill rank bytes at `+0x88..+0x92` and the corresponding 11 little-endian
u16 experience values at `+0x32,+0x34,...,+0x46`. Their order is Sword, Lance, Axe, Bow, Brawling, Reason, Faith,
Authority, Heavy Armor, Riding, Flying. The EXP is progress within the current rank, not a cumulative total.

This layout is confirmed in FE3H 1.2.0's main module. At `main+0x969E4`, code loads the byte at `unit+0x88` and u16 at
`unit+0x32`, then repeats for each following skill and calls `main+0x3DD850` with indices 0 through 10. That routine
checks the skill index against 10 and the rank enum against 11, stores the values into internal per-skill arrays, and
mirrors them back to the roster offsets. The getter at `main+0x4114D0` reads rank byte `unit+0x88+index` after checking
that the skill index is at most 10.

Rank enum values are E, E+, D, D+, C, C+, B, B+, A, A+, S, S+. The game's `rank_exp` table lists the current-rank
increments E 40, E+ 60, D 80, D+ 120, C 160, C+ 220, B 280, B+ 360; it has no limit values for A and above. Decoder
validation therefore rejects EXP at or beyond the listed threshold for ranks E through B+, and preserves the u16
progress at higher ranks. This research used only read-only process memory and a local executable capture.

## Sources

- [FE Universe randomizer thread](https://feuniverse.us/t/fire-emblem-three-houses-randomizer-custom-build/9774), which
  lists "mounting stat boosts" as a separate class field.
- [Samurai Gamers' class base stats](https://samurai-gamers.com/fire-emblem-three-houses/class-base-stats/), for
  movement values.
- [Samurai Gamers' accessory list](https://samurai-gamers.com/fire-emblem-three-houses/accessory-list/), for accessory
  effects (Speed Ring, Goddess Ring, the house items).
