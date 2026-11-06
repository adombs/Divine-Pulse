"""Every unit on the battle map, decoded from the game's battle pool.

During a battle the game keeps one 0x330-byte record per unit on the map in a pool: the player's deployed units
first, then everyone else (enemies, and possibly other units). Each record starts with the roster slot layout
(see fe3h.py) and is followed by battle-only fields, and sits 0x14 bytes after a fixed marker. When the battle
ends the records are cleared (level 0, last marker byte 1).

Current HP and map position use the offsets in app/data/battle_fields.json. Unit flags distinguish units
off the map from those defeated; docs/battle-page-plan.md tracks the findings.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ..domain.combat import BattleUnit, NO_SPELL

from .fe3h import (
    _ABILITIES,
    _CHARACTER,
    _COMBATS,
    _CLASS,
    _EQUIPPED,
    _FLAGS,
    _HP,
    _LEVEL,
    _STATS,
    _VICTORIES,
    BATTLE_MARKER,
    BATTLE_MARKER_TO_COPY,
    EMPTY_ABILITY,
    IN_ARMY,
    STAT_ORDER,
    decode_battalion,
    gambit_uses,
    rattled,
)

RECORD_SIZE = 0x330
FIELDS_FILE = Path(__file__).resolve().parents[1] / "data" / "battle_fields.json"


@dataclass(frozen=True)
class BattleFields:
    """Offsets of the battle-only fields (None = not located yet). See app/data/battle_fields.json."""

    hp: int | None = None  # current HP, u8, in a unit record
    x: int | None = None  # map position, u8 each, in a unit record
    y: int | None = None
    turn: int | None = None  # u8 in the global data (0 on the Divine Pulse screen)
    divine_pulse_charges: int | None = None  # u8 in the global data
    scenario: int | None = None  # u16 in the global data: which battle this is (app/data/scenarios.json)
    map: int | None = None  # u16 in the global data: which map the battle is on (the import's data/maps.json)
    cursor_x: int | None = None  # i32 each in the global data: the tile the map cursor is on
    cursor_y: int | None = None

    @classmethod
    def load(cls, path: Path = FIELDS_FILE) -> BattleFields:
        try:
            data = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return cls()

        def offset(value) -> int | None:
            if value is None:
                return None
            return int(value, 16) if isinstance(value, str) else int(value)

        unit, globals_ = data.get("unit", {}), data.get("globals", {})
        return cls(
            hp=offset(unit.get("hp")),
            x=offset(unit.get("x")),
            y=offset(unit.get("y")),
            turn=offset(globals_.get("turn")),
            divine_pulse_charges=offset(globals_.get("divine_pulse_charges")),
            scenario=offset(globals_.get("scenario")),
            map=offset(globals_.get("map")),
            cursor_x=offset(globals_.get("cursor_x")),
            cursor_y=offset(globals_.get("cursor_y")),
        )


@lru_cache(maxsize=1)
def fields() -> BattleFields:
    return BattleFields.load()

# Uses left of each learned spell: 5 Reason then 5 Faith (the spells' IDs follow at +0xA0). Seen dropping live as
# spells were cast in battle.
# Set on a unit that has acted this phase (u8 flags, bit 0x04); cleared for everyone when a phase begins. Seen live:
# your units' flag set after their action and clear again on the enemy phase.
ACTED, ACTED_BIT = 0xD6, 0x04
# Same byte, bit 0x20: the unit isn't on the map. Seen live (Oil and Water): set on reinforcements that haven't
# arrived (full HP, never moved), on a house leader with a battle copy who wasn't deployed (at 0,0), and on the second
# record some army units have; never on a deployed unit. Defeated units clear bit 0x02 instead.
OFF_MAP_BIT = 0x20
# Bit 0x02: the unit is on the map. Cleared on defeated units (no HP left), and on units the story takes off the map
# with HP left: seen live (The Remire Calamity), the six Villagers cleared it one by one as they fled during the
# cutscene after Tomas turns out to be Solon, HP and tile untouched. Not seen clear on any other living unit (4
# recordings, Oil and Water and Remire).
ON_MAP_BIT = 0x02
# The bits of that byte whose meaning is known; FlagWatch logs changes to any other. Nothing about this byte was
# found online (cheat tables, the BSIC map-script tools); seen in 4 recordings (Oil and Water, The Remire Calamity):
# - 0x01: set on every record, never changed. Taken as normal (ALWAYS_SET_BIT); a change is still logged.
# - 0x08: only on Solon and the Death Knight in Remire, never changed (not on Oil and Water's Bandit Leader, so not
#   simply "boss"). Not known.
# - 0x10: only on breakable walls (team 4), never changed. Not known (maybe "an object, not a unit").
# - 0x40, 0x80: never seen.
KNOWN_FLAG_BITS = ON_MAP_BIT | ACTED_BIT | OFF_MAP_BIT
ALWAYS_SET_BIT = 0x01
# A unit's index in the pool (u8; the history names units by it), and on an adjutant (an army unit off the map), the
# index of the unit it's attached to. Seen live: Claude as Flayn's adjutant had 9 there, Flayn's index.
POOL_INDEX = 0xF0
# The side a unit is on (u8), the byte after the pool index: 0 the player's, 1 enemy; 2 and 3 for the other armies
# (the game's history keeps it as this + 1). Seen live (Oil and Water): 0 on every army unit, 1 on every bandit.
TEAM = 0xF1
ATTACHED_TO = 0x100
SPELL_USES = 0x94
SPELL_SLOTS = 12  # seen live: a 12th slot (+0x9E) dropped when Lysithea cast
# The spell in each of those slots (u8 spell ID, as in data/spells.json; NO_SPELL = empty). Seen: Lysithea's
# slot 10 is Fire (0), the Mage class's own spell, and Hanneman's slot 2 Thoron (4), whose uses dropped as he cast it.
SPELL_IDS = 0xA0
# How far around the army's records to look for the rest of the pool (records, not bytes).
POOL_BEFORE = 16
POOL_AFTER = 160




def is_active_record(data: bytes, offset: int) -> bool:
    """A unit currently on the map: marker intact and plausible unit data after it."""
    marker_at = offset - BATTLE_MARKER_TO_COPY
    if marker_at < 0 or offset + _FLAGS + 1 > len(data):
        return False
    if data[marker_at : marker_at + len(BATTLE_MARKER)] != BATTLE_MARKER:
        return False
    character = struct.unpack_from("<H", data, offset + _CHARACTER)[0]
    return character != 0xFFFF and 1 <= data[offset + _LEVEL] <= 99 and data[offset + _CLASS] < 100 and 1 <= data[offset + _HP] <= 99


def decode_record(data: bytes, offset: int, army_ids: set[int], located: BattleFields | None = None, base: int = 0) -> BattleUnit:
    """The unit whose record is at `offset` in `data`; `base` is the address `data` was read from."""
    character = struct.unpack_from("<H", data, offset + _CHARACTER)[0]
    raw = {"hp": data[offset + _HP], **{k: data[offset + _STATS + n] for n, k in enumerate(STAT_ORDER)}}
    army = character in army_ids and data[offset + _FLAGS] & IN_ARMY == IN_ARMY
    pairs = struct.unpack_from("<12H", data, offset)
    items = tuple((pairs[i], pairs[i + 1]) for i in range(0, 12, 2) if pairs[i] != 0xFFFF)
    spells = tuple(data[offset + SPELL_USES : offset + SPELL_USES + SPELL_SLOTS])
    spell_ids = tuple(None if n == NO_SPELL else n for n in data[offset + SPELL_IDS : offset + SPELL_IDS + SPELL_SLOTS])
    abilities = tuple(a for a in data[offset + _ABILITIES : offset + _ABILITIES + 5] if a != EMPTY_ABILITY)
    f = located if located is not None else fields()

    def at(field_offset: int | None) -> int | None:
        return data[offset + field_offset] if field_offset is not None and offset + field_offset < len(data) else None

    hp = at(f.hp)
    flags = data[offset + ACTED] if offset + ACTED < len(data) else None
    # Off the map: flagged so, or taken off it with HP left (a defeated unit stays where it fell).
    off_map = flags is not None and (bool(flags & OFF_MAP_BIT) or (not flags & ON_MAP_BIT and hp is not None and hp > 0))
    # Yours name their battalion's owner; other units' battalions have none (fe3h.decode_battalion).
    record = data[offset : offset + RECORD_SIZE]
    battalion, battalion_exp, battalion_endurance = decode_battalion(record, owned=army)
    return BattleUnit(
        character, army, data[offset + _LEVEL], data[offset + _CLASS], raw,
        hp=hp, x=at(f.x), y=at(f.y),
        combats=struct.unpack_from("<H", data, offset + _COMBATS)[0], victories=struct.unpack_from("<H", data, offset + _VICTORIES)[0], items=items, spell_uses=spells, slot=(base + offset) // RECORD_SIZE,
        abilities=abilities, spells=spell_ids,
        acted=bool(flags & ACTED_BIT) if flags is not None else None,
        off_map=off_map,
        pool_index=at(POOL_INDEX), attached_to=at(ATTACHED_TO), team=at(TEAM), flags=flags,
        equipped=struct.unpack_from("<H", data, offset + _EQUIPPED)[0],
        item_slot_0=pairs[0] if pairs[0] != 0xFFFF else None,
        battalion=battalion, battalion_exp=battalion_exp, battalion_endurance=battalion_endurance,
        gambit_uses=gambit_uses(record, owned=army),
        rattled=rattled(record),
    )


def decode_pool(data: bytes, first_record: int, army_ids: set[int], located: BattleFields | None = None, base: int = 0) -> list[BattleUnit]:
    """Units in a block of memory holding the pool, read from address `base`. `first_record` is the offset in
    `data` of any record; every 0x330 bytes from there (both ways) is checked."""
    start = first_record % RECORD_SIZE
    units = []
    for offset in range(start, len(data) - RECORD_SIZE + 1, RECORD_SIZE):
        if is_active_record(data, offset):
            units.append(decode_record(data, offset, army_ids, located, base))
    return units


def pool_window(addresses: list[int]) -> tuple[int, int]:
    """Host address range to read around the army's records to see the whole pool."""
    low, high = min(addresses), max(addresses)
    return low - POOL_BEFORE * RECORD_SIZE, high + POOL_AFTER * RECORD_SIZE


@dataclass(frozen=True)
class FlagChange:
    """A unit's flags byte changed in a bit whose meaning isn't known yet (outside KNOWN_FLAG_BITS), or (before
    None) a unit first seen with such a bit set, ALWAYS_SET_BIT aside."""

    unit: BattleUnit
    before: int | None
    after: int

    @property
    def unknown(self) -> int:
        """The unknown bits that changed (first seen: that are set)."""
        if self.before is None:
            return self.after & ~(KNOWN_FLAG_BITS | ALWAYS_SET_BIT) & 0xFF
        return (self.before ^ self.after) & ~KNOWN_FLAG_BITS & 0xFF


class FlagWatch:
    """Follows the flags byte of every record in the pool from one read to the next, to find what the bits not
    known yet mean. A record is followed by its slot while it holds the same character."""

    def __init__(self) -> None:
        self._seen: dict[int, tuple[int, int]] = {}  # slot -> (character, flags)

    def reset(self) -> None:
        self._seen = {}

    def check(self, units: list[BattleUnit]) -> list[FlagChange]:
        """The changes in unknown bits since the last read, for these units (all the pool's records), and the units
        first seen with unknown bits set."""
        out = []
        for u in units:
            if u.flags is None:
                continue
            before = self._seen.get(u.slot)
            if before is None or before[0] != u.character:
                change = FlagChange(u, None, u.flags)
            else:
                change = FlagChange(u, before[1], u.flags)
            if change.unknown:
                out.append(change)
            # (A record missing from a read keeps its last flags, to compare with when it's read again.)
            self._seen[u.slot] = (u.character, u.flags)
        return out
