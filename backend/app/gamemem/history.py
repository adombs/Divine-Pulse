"""The game's own battle history: the list behind the Divine Pulse screen.

FE3H keeps one entry per point the player can turn time back to ("Fight!", "Byleth waited.", "Bandit's attack
dealt 9 damage to Lysithea.", "Began enemy phase."...). Each entry holds the state, after the event, of every
unit it changed, so the whole battle can be replayed from it: who acted, on whom, HP and position changes. It
covers the battle from its start whenever the tracker starts reading, with Action Skip on or off, and a Divine
Pulse simply cuts the list back.

Layout (FE3H 1.2.0, seen live and checked against the Divine Pulse screen):
- The entries sit in a heap of their own, one linked list per turn. The game's global data (GameMemory.GLOBALS)
  holds the number of entries and an array of pointers to each turn's first entry (see COUNT_AT). Pointers are
  Switch addresses (see GameMemory._find_arena).
- An entry: a 0x40-byte header, then "full" records for the player's units (the first 0x10C bytes of a battle
  record, same layout) and "compact" 0x64-byte records for the other units (which name their pool index).
- A phase start (and the first entry, "Fight!") holds every unit; an action holds the units it changed. Not
  every enemy action gets its own entry: the game folds some into the next one.
"""

from __future__ import annotations

import struct
from collections import Counter
from dataclasses import dataclass, field

# In the game's global data (offsets from GameMemory.GLOBALS[0]): u32 number of entries, then (at TURNS_AT) the
# Switch address of each turn's first entry, turn 1 first: each turn is a list of its own ("Began player phase.",
# its actions, "Began enemy phase.", ...), ending with a null link. Seen live over three turns.
COUNT_AT, TURNS_AT = 0xDE1A8, 0xDE228
MAX_TURNS = 100  # how many turn pointers to read at most (the list stops at the first null one)
# The history's heap keeps a pointer (at SELF_AT) to its own description in the global data (at SELF_TARGET):
# the difference between that pointer and where it points is where Switch memory starts in Eden's.
SELF_AT, SELF_TARGET = 0xDE1B0, 0xC1858

# Each entry follows a 0x20-byte heap header: Switch address of the previous block, then minus its size
# (the bytes used, rounded up to 16).
BLOCK_HEADER = 0x20

# Header
NEXT = 0x00  # u64 Switch address of the next entry (0 = none yet)
SIZE = 0x10  # u16 bytes used
TURN = 0x12  # u16
PHASE = 0x16  # u8: 0 player, 1 enemy, 2 other
TYPE = 0x17  # u8: TYPE_PHASE or TYPE_ACTION
ACTOR = 0x18  # u8 pool index of the unit that acted
ACTION = 0x19  # u8 what it did (ACTION_*)
FULL_COUNT = 0x1A
COMPACT_COUNT = 0x1B
MOVED = 0x26  # u8: 1 if it moved before acting ("Lysithea moved." rather than "waited.")
# The same byte in a spell's entry (ACTION_SPELL): the spell (data/spells.json). Seen live: Flayn's Rescue on
# Lysithea held 36 (Rescue), Manuela's spell on Byleth at full HP 34 (Ward); kills with Fire held 0 (Fire).
SPELL = 0x26
# The same byte in a combat art's entry: the art (data/combat-arts.json). Seen live: Ignatz's Break Shot held
# 38, Byleth's Swap 50, Lysithea's and Marianne's Draw Back 53, Cyril's Monster Breaker 23.
ART = 0x26
TARGET = 0x27  # u8 pool index of the unit acted on, 0xFF = none
# u16: the item used ("Flayn used Vulnerary." holds 1000). Attacks hold the damage the attacker dealt x 100 plus how
# the fight ended (ATTACK_*): 1303 "Byleth's attack dealt 13 damage" and both stood, 801 Hanneman's 8 that defeated the
# bandit, 2 a bandit that dealt nothing and fell to the counter. All nine attacks in the fixture fit.
ITEM = 0x28
# u8: what the unit did, as ACTION, except that ACTION turns into 0x0B when a Canto move follows (Marianne's
# Draw Back then a move: ACTION 0x0B, KIND 0x01 with the art and target set).
KIND = 0x24
HEADER = 0x40

TYPE_PHASE = 0x0B
TYPE_ACTION = 0x0E
# 0x03: magic. Seen on attacks that defeated their target (ITEM as for an attack; mages' kills with Fire in the
# fixture) and on staves on an ally with ITEM 0 (Rescue, Ward: the spell is at SPELL). Weapon kills by counterattack
# stay 0x00.
ACTION_SPELL = 0x03
# A combat art, on an enemy (ITEM as for an attack) or on an ally (Swap, Draw Back: ITEM 0). The art is at ART.
ACTION_ART = 0x01
# Rally. TARGET is 0xFF: the entry ends with the character IDs (u8) of the unit that rallied and the one it rallied
# (Ignatz's Rally Speed on Cyril ended "15 22 ..": 21 Ignatz, 34 Cyril). Seen live once.
ACTION_RALLY = 0x17
RALLY_TAIL = 4
# A battalion's gambit (ACTION and KIND 0x13). The gambit's ID is at GAMBIT (the same byte as SPELL/ART; the
# battalion's gambit ID, as at +0x1F of its record), TARGET the unit aimed at (0xFF for one on the user's area) and
# ITEM as for an attack, for the target only; every unit it hit or moved follows with its new state. Seen live (1.2.0,
# 1.2.0): Byleth's Assembly (ID 1) on two bandits held 1103 (11 damage each), Marianne's Stride (ID 25)
# held 0 and listed seven of your units (the ones in its area).
ACTION_GAMBIT = 0x13
GAMBIT = 0x26
NO_UNIT = 0xFF

FULL_SIZE = 0x10C  # player's units: the start of a battle record (gamemem.battle offsets apply)
COMPACT_SIZE = 0x64  # other units
_FULL_CHARACTER, _FULL_MAX_HP = 0x24, 0x4C  # as in the roster slot layout
# Also as in the roster slot: 6 x (u16 item ID, u16 uses), the equipped abilities, spell uses and spell IDs. The
# history keeps them as they were after each action, so it shows which weapon an attack wore down (Ignatz's bow went
# from 42 to 39 uses with Break Shot, which costs 3).
_FULL_ABILITIES, _FULL_SPELL_USES, _FULL_SPELL_IDS, SPELL_SLOTS, NO_SPELL = 0x7F, 0x94, 0xA0, 12, 38
_COMPACT_HP, _COMPACT_INDEX, _COMPACT_X, _COMPACT_Y = 0x44, 0x47, 0x49, 0x4A

MAX_ENTRIES = 2000  # far more than a battle has; stops a bad read from looping


@dataclass(frozen=True)
class HistoryUnit:
    """A unit's state after an entry's event. Player's units are known by character ID, others by pool index."""

    character: int | None  # player's units
    index: int | None  # other units: pool index
    hp: int
    x: int
    y: int
    max_hp: int | None = None  # player's units: raw max HP (the roster's), which a level-up raises
    # Player's units: inventory as (item ID, uses left), uses left and ID of each spell slot (None = empty slot), and
    # the equipped abilities. Not part of a unit's state as compared (where it is, its HP).
    items: tuple[tuple[int, int], ...] = field(default=(), compare=False)
    spell_uses: tuple[int, ...] = field(default=(), compare=False)
    spells: tuple[int | None, ...] = field(default=(), compare=False)
    abilities: tuple[int, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class HistoryEntry:
    turn: int
    phase: int  # 0 player, 1 enemy, 2 other
    phase_start: bool  # "Fight!" / "Began ... phase." rather than a unit's action
    action: int  # ACTION_* (unit actions only)
    actor: int | None  # pool indexes (unit actions only)
    target: int | None
    moved: bool
    units: tuple[HistoryUnit, ...]
    item: int = 0  # ITEM
    spell: int | None = None  # SPELL, for ACTION_SPELL
    art: int | None = None  # ART, for ACTION_ART (KIND)
    rally: bool = False  # ACTION_RALLY (KIND)
    rallied: int | None = None  # the character ID of the unit rallied (player's units only)
    gambit: int | None = None  # GAMBIT, for ACTION_GAMBIT (KIND): the gambit used (the battalion's gambit ID)


def decode_entry(data: bytes, hp: int, x: int, y: int) -> HistoryEntry | None:
    """One entry from its bytes (header and records). `hp`, `x`, `y`: where current HP and position are in a
    battle record (gamemem.battle.BattleFields). None if the bytes don't look like an entry."""
    if len(data) < HEADER or data[TYPE] not in (TYPE_PHASE, TYPE_ACTION):
        return None
    full, compact = data[FULL_COUNT], data[COMPACT_COUNT]
    if len(data) < HEADER + full * FULL_SIZE + compact * COMPACT_SIZE:
        return None
    units = []
    at = HEADER
    for _ in range(full):
        character = struct.unpack_from("<H", data, at + _FULL_CHARACTER)[0]
        pairs = struct.unpack_from("<12H", data, at)
        units.append(HistoryUnit(
            character, None, data[at + hp], data[at + x], data[at + y], max_hp=data[at + _FULL_MAX_HP],
            items=tuple((pairs[i], pairs[i + 1]) for i in range(0, 12, 2) if pairs[i] != 0xFFFF),
            spell_uses=tuple(data[at + _FULL_SPELL_USES : at + _FULL_SPELL_USES + SPELL_SLOTS]),
            spells=tuple(None if n == NO_SPELL else n for n in data[at + _FULL_SPELL_IDS : at + _FULL_SPELL_IDS + SPELL_SLOTS]),
            abilities=tuple(a for a in data[at + _FULL_ABILITIES : at + _FULL_ABILITIES + 5] if a != 0xFF),
        ))
        at += FULL_SIZE
    for _ in range(compact):
        units.append(HistoryUnit(None, data[at + _COMPACT_INDEX], data[at + _COMPACT_HP], data[at + _COMPACT_X], data[at + _COMPACT_Y]))
        at += COMPACT_SIZE
    action = data[TYPE] == TYPE_ACTION
    target = data[TARGET] if action and data[TARGET] != NO_UNIT else None
    kind = data[KIND] if action else None
    rallied = None
    if kind == ACTION_RALLY and len(data) >= max(HEADER, entry_size(data)) >= HEADER + RALLY_TAIL:
        tail = data[entry_size(data) - RALLY_TAIL :]
        # u8 character IDs: matched against the low byte of the units the entry holds (DLC characters are 1040+).
        rallied = next((u.character for u in units if u.character is not None and u.character & 0xFF == tail[1] and u.character & 0xFF != tail[0]), None)
    return HistoryEntry(
        turn=struct.unpack_from("<H", data, TURN)[0],
        phase=data[PHASE],
        phase_start=not action,
        action=data[ACTION] if action else 0,
        actor=data[ACTOR] if action else None,
        target=target,
        moved=action and data[ACTION] != ACTION_SPELL and kind not in (ACTION_ART, ACTION_GAMBIT) and data[MOVED] == 1,  # (an art's or gambit's ID is there)
        units=tuple(units),
        item=struct.unpack_from("<H", data, ITEM)[0] if action else 0,
        spell=data[SPELL] if action and data[ACTION] == ACTION_SPELL else None,
        art=data[ART] if kind == ACTION_ART else None,
        rally=kind == ACTION_RALLY,
        rallied=rallied,
        gambit=data[GAMBIT] if kind == ACTION_GAMBIT else None,
    )


def entry_size(header: bytes) -> int:
    return struct.unpack_from("<H", header, SIZE)[0]


def next_entry(header: bytes) -> int:
    return struct.unpack_from("<Q", header, NEXT)[0]


def looks_like_first(block: bytes) -> bool:
    """Whether `block` (the heap header then the entry header) is the history's first entry, "Fight!"."""
    if len(block) < BLOCK_HEADER + HEADER:
        return False
    allocated = -struct.unpack_from("<q", block, 8)[0]
    entry = block[BLOCK_HEADER:]
    used = entry_size(entry)
    return entry[TYPE] == TYPE_PHASE and entry[PHASE] == 0 and allocated == (used + 15) & ~15 and used >= HEADER


def latest_positions(entries: list[HistoryEntry]) -> dict[int, tuple[int, int, int]]:
    """Other units' last known (x, y, HP) by pool index."""
    out: dict[int, tuple[int, int, int]] = {}
    for entry in entries:
        for u in entry.units:
            if u.index is not None:
                out[u.index] = (u.x, u.y, u.hp)
    return out


def pool_start(entries: list[HistoryEntry], live: dict[int, tuple[int, int, int]]) -> int | None:
    """The pool slot of index 0 (gamemem.battle.BattleUnit.slot), from the other units the history and a live read
    both show at the same place with the same HP. `live`: (x, y, HP) by slot. None if nothing matches."""
    known = latest_positions(entries)
    where: dict[tuple[int, int, int], list[int]] = {}
    for slot, state in live.items():
        where.setdefault(state, []).append(slot)
    votes = Counter(slot - index for index, state in known.items() for slot in where.get(state, []))
    if not votes:
        return None
    best, count = votes.most_common(1)[0]
    return best if count * 2 >= min(len(known), len(live)) or count >= 3 else None
