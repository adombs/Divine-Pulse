# Battalion integration

The importer supplies reference data (names, modifiers at each level, endurance, the gambit); the memory reader
supplies the assignment and its runtime state. The level, the modifiers that apply and the combat effects follow
from the two together.

## Memory fields (FE3H 1.2.0)

A roster slot embeds the equipped battalion at `+0x18`, 8 bytes, in the layout of hashcade/feth-save-editor's
`Battalion` struct (commit `083d123d`, `core/Structs/Battalion.cs`, embedded at `0x18` by `Character.cs`):

| Offset | Type | Field |
|---|---|---|
| `+0x18` | u16 | owner: the character ID of the player's unit that owns it (Byleth `0`, Marianne `23`); `0xFFFF` on other units, and on yours without one |
| `+0x1A` | u16 | cumulative experience |
| `+0x1C` | u16 | endurance left |
| `+0x1E` | u8 | battalion ID (the import's `data/battalions.json` row); `200` = none |
| `+0x1F` | u8 | gambit ID, as in the history and the import's `gambit` text (Seiros Pegasus Co. 1 Assembly, Seiros Holy Monks 25 Stride); `80` = none |

Battle copies also hold the **gambit uses left** at `+0xF5` (u8). The roster keeps its values from before the battle
until the battle ends, so experience, endurance and uses are read from the live battle copy whenever there is one, even
when no stat changed (`fe3h.merge_battle`). Between battles the game refills gambit uses, so none are reported then.

Evidence, kept outside the repository (no game bytes are committed): six read-only captures of one save in Eden,
each checked against the game's Battalion tab as the player changed it.

| State | Tab | `+18` | `+1A` | `+1C` | `+1E` | copy `+F5` |
|---|---|---|---|---|---|---|
| A | Seiros Pegasus Co., Lv 1, Exp 0, 60/60, Assembly 2/2 | 0 | 0 | 60 | 5 | 2 |
| B | Almyra Mercenaries, Lv 1, Exp 0, 30/30, Fusillade 2/2 | 0 | 0 | 30 | 106 | 2 |
| C | None | `FFFF` | 0 | 0 | 200 | 0 |
| D | Seiros Pegasus Co. again (all bytes back to A's) | 0 | 0 | 60 | 5 | 2 |
| E | Assembly used: Lv 1, Exp 46, 60/60, 1/2 | 0 | 46 | 60 | 5 | 1 |
| F | Lv 2, Exp 15, 51/60, 0/2 | 0 | 115 | 51 | 5 | 0 |

In E and F only the battle copy changed; the roster slot still read 0 / 60. The uses byte dropped apart from the
unit's acted flags (`+0xD6`). Replaying the six captures through `decode_roster`, `merge_battle` and
`battle_gambit_uses` gives exactly the values in the tab.

**Other units' battalions** use the same layout with owner `0xFFFF`: in a Verdant Wind battle all 21 bandits held
Thieves, Rogues or Bandits (173–175), 300 exp (level 4), endurance 75 (the import's maximum for those three) and 2 gambit
uses. So for your units the owner decides (`0xFFFF` = none); for others, an ID below 200 is a battalion.

**Rattled**: bit `0x80` of battle-record byte `+0xE0`. In the same battle Byleth's Assembly hit two bandits; the bit
was set on exactly those two at that moment and on no other unit. When the game clears it wasn't observed; the tracker
reads it as it is.

**Gambits in the battle history**: an entry with action and kind `0x13`, the gambit ID at `+0x26` (the byte a spell or
combat art uses), the unit aimed at in TARGET (`0xFF` for one on the user's area), and ITEM as an attack's, for the
target only. Every unit it hit (or helped) follows with its new state. Seen: Marianne's Stride (25), ITEM 0, with seven
of your units; Byleth's Assembly (1) on two bandits, ITEM 1103, each losing 11 HP. Each use gave the battalion 46 exp and
took one use. Recordings now keep the raw history entries (`gamemem.recorder`, "history" blob) for decoding more.

## Rules

`app/domain/battalions.py` holds them, and `frontend/src/reference/battalions.ts` mirrors the level rule.

- **Level** = experience / 100 + 1, levels 1-5, experience capped at 400 (feth-save-editor
  `core/SaveBuffer.Battalions.cs`, for build `89048449BA238C8CF565518B83BF02D3`). F: 115 = level 2, Exp 15. At level 5
  the panel shows no experience.
- **Modifiers at a level** come from the import's `stats_by_level`: a fixed growth in tenths per level added to the
  level 1 values, the accumulated growth rounded down. This matches Serenes Forest's tables and the game: Seiros
  Pegasus Co. is Phys Atk +2, Avo +1, Rsl +3, Cha +5 at level 1 and Avo +2 at level 2 (Avo grows 1 a level; Phys Atk,
  Prt and Rsl 0.5); Almyra Mercenaries is Phys Atk +3, Avo +5, Rsl −2, Cha +1 at level 1. Charm doesn't grow.
- **Endurance**: the battalion takes half the damage its unit takes (rounded down). It doesn't refill between
  battles; the player replenishes it. With none left the unit gets **none** of the modifiers (Fire Emblem Wiki,
  Battalion). The panel keeps showing them, struck through, with that reason.
- **Rattled** units (hit by an offensive gambit) also lose their battalion's modifiers and can't move (Fire Emblem
  Wiki, Gambit). The combat model drops a rattled unit's modifiers; the This Battle panel strikes them with that reason.
- **Gambit uses** are per battle and refilled after every map.

Sources: <https://fireemblemwiki.org/wiki/Battalion>, <https://fireemblemwiki.org/wiki/Gambit>,
<https://serenesforest.net/three-houses/battalions/>, and the game's own panels in the captures above. They agree on
every value that could be compared, so no extra game tests were run.

## Where the values show

- **Status values**: the game's Status page counts the battalion's Charm in Cha (blue, and in the stats total: 17
  with no battalion, 18 with Almyra Mercenaries, 22 with Seiros Pegasus Co.). The reading adds it to the value and to
  the unit's `bonuses`, so `Unit.base()` stays the unit's own Cha; nothing is added while the endurance is spent or
  when the import has no progression (an older import: the modifiers aren't known, so none is guessed). The other
  modifiers are combat numbers (Atk, Hit, Crit, Avo, Prt, Rsl), not stats.
- **Battle records** keep the unit's own values in `start`/`now` (without the battalion's Charm), so endurance running
  out mid-battle isn't taken for a stat loss, which only a Divine Pulse causes.
- **Combat model** (`gamemem/combat.py`, used to pair fights when the history can't be read): a unit's battalion,
  yours or an enemy's, adds Phys Atk (Mag Atk with magic), Hit, Crit, Avo (also against magic), Prt and Rsl at its level,
  and Cha; nothing while it is rattled or its endurance is spent.
- **Battle log**: "Byleth used Assembly on Bandit 2.", kind `gambit`: only the unit it was aimed at is named. Every
  unit it hit counts toward the user's damage dealt (the line's total, the user's usage and the battle's statistics).
- **Gambit area** (Battalion panel): the game's fixed 9 by 6 grid, gold tiles and one badge. A forward area has a blue
  upward badge below it; a centred area has a downward badge at its centre (red for an enemy target, blue for support).
  The target-centred preview does not show a separate user or target cursor.

## Run and battle contract

The run's unit keeps `battalion` (the last named observation), `battalion_id`, and its runtime state
`battalion_exp`, `battalion_endurance` and `gambit_uses` (during a battle; null between battles). The ID distinguishes
duplicate names and survives language changes. A named observation updates them all; an unresolved imported name
leaves the stored assignment alone; an empty string is an observed removal and clears the ID and the runtime state. A
missing observation (`None` in readings) clears nothing. The scanner waits for two matching snapshots before applying
changes, and refreshes imported names when the import or the game language changes even if the roster bytes haven't.

Each battle unit records the same five fields as observed during that battle, independently of later roster
updates, through saved battles and run/battle export and import. Null means not recorded (older files) or unknown;
an empty assignment means observed without one. The This Battle panel shows the battle's own level, endurance and
uses; This Run shows the roster's, with gambit uses full between battles. Older battles show unknown values and are
never backfilled from today's roster. Reference details resolve by the recorded ID first, including translated names.

## Not handled yet

- How long rattled lasts (the tracker follows the game's bit), and enemies' battalions in their own popups.
- Gambits on units the battle history doesn't list (the game folds some enemy actions into the next entry).
- Gambit areas for shapes no gambit uses (4, 9-11, 14: the monsters' large areas) are not mapped.

## Imported reference

The extractor reads battalion modifiers and five-level progression from `fixed_data.bin` section 11, gambit attack
parameters from section 3 and use counts from section 8, and exports battalion icons from the native atlas. Old
imports may contain only names, descriptions and endurance; reimporting adds the rest.

Each gambit also gets its **icon** and **area**, both read the way the game's own code reads them:

- Icon (`gambit.icon`, `images/icons/gambits/<gambit id>.png`): the selector at `main+0x5D9B10` picks sprite 0x23D
  (support) when section 3 `+0x04` (the effect) is 1-18 and bit `effect - 1` of `0x36DCB` is set, otherwise 0x23B
  (physical) or 0x23C (magic) by section 3 `+0x16` bit 0.
- Area (`gambit.area`): section 8 `+0x0A` is the shape, which the area builder at `main+0x41E4E0` turns into tiles.
  `cells` are `[dx, dy]` from the user's tile, `dy < 0` ahead; shapes that follow the user's facing carry
  `direction: "forward"`. The gambit panel's preview (`main+0x5D3EE0`) puts the target one tile ahead for those, and
  centres shapes 1 and 5 on the user for support effects (mask `0x2DB96`, plus effect 18), otherwise
  on the enemy target. A target-centred area puts the target at the minimum range straight ahead and names its tile
  in `target`; a user-centred one leaves the user's tile out, as the game's tile list does.

The preview renderer centres the area on the badge, independently of the attack's minimum range. In the native
218 by 146 pixel grid, the badge is at column 4, row 3 (zero-based), or row 4 for four tiles straight ahead. Cells
have a 24 pixel pitch and a 1 pixel outer grid border. The importer exports DATA 6050 texture 10 sprites 216 (gold
cell), 221 (complete grid), 223 (downward chevron), 228 (blue badge) and 229 (red badge) as `range-*` minimap pieces.
Badge and chevron sprites are scaled into the same 24 pixel cell; the chevron flips vertically for forward areas.
These selections and placement follow `main+0x5D3CD0..0x5D424C` and were compared with all eight used area shapes
in 34 original game previews at <https://www.fe3h.com/gambits>, including
<https://www.fe3h.com/gambits/group_flames>. Three DLC names lack individual screenshots but share checked shapes.
Import format 4 prompts older imports to refresh for these pieces and the gambit areas/icons.

| Shape | Tiles (target one ahead, or the centre) | Gambits (examples) |
| --- | --- | --- |
| 1 | centre and its 4 neighbours | Fusillade, Group Flames; Dance of the Goddess (on the user) |
| 2 | 5-3-1 triangle starting at the target | Blaze, Poison Tactic |
| 3 | the target and the tile behind it | Assembly, Onslaught |
| 5 | tiles within 2 steps of the centre | Wave Attack, Resonant Flames; Stride, Recovery Roar (on the user) |
| 6 | 4 tiles straight ahead | Assault Troop |
| 7 | 3 tiles across at the target | Group Lance Attack, Mad Melee |
| 8 | 5 across, 2 deep from the target | Raging Flames |
| 12 | 3 across, 2 deep from the target | Line of Lances, Resonant White Magic |
| 13 | 3 tiles straight ahead | (no gambit) |

The frontend resolves an assignment by ID first. If that ID is absent from the current import, it does not attach
another row's details just because the name matches. Older name-only assignments keep loose name matching when the
result is unambiguous. Battalion and gambit text follow the selected game language with the imported text as the
fallback. Without a known level, the panel shows level 1 reference values and says so.
