"""Where FE3H keeps its unit roster in the emulator's memory, and how to decode it.


Eden maps the Switch's memory into its own address space so that a game address `a`
lives at host address `base + a` ("fastmem"; emulators.py says where each emulator keeps it). The game's main program sits near Switch address 0x80000000 (not
at a fixed one: 0x80004000 in one session, 0x8077B000 in another), and the roster is a global inside it: 60 slots
of 0x24C bytes, one per character the save knows about. Only the layout relative to the main program is fixed, so
it is found again on every connect.

During a battle the game works on copies of the deployed units and writes them back to the roster only when
the battle ends, so a level-up mid-battle shows only in the copy. The copies live in the heap, so they are found
by a scan (about 2 s) when a battle starts, then re-read cheaply on every poll.
"""

from __future__ import annotations

import hashlib
import logging
import re
import struct
import threading
import time
from dataclasses import dataclass, field

from ..domain.combat import EQUIPPED_SPELL as EQUIPPED_SPELL
from ..system import MEMORY_ACCESS_HELP
from ..system.memory import AccessDenied, ProcessMemory, open_process
from ..domain.battalions import valid_endurance, valid_exp, valid_uses
from ..domain.units import SkillProgress
from .emulators import EMULATORS, Emulator, MemoryLayout, names, running
from .skills import decode_skill_progress

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class GameVersion:
    name: str
    build_id: bytes
    build_id_offset: int  # GNU build-id note, from the start of the main program
    roster_offset: int  # slot 0, from the start of the main program


VERSIONS = (
    GameVersion("1.2.0", bytes.fromhex("89048449BA238C8CF565518B83BF02D3"), 0x19E3840, 0x1B127E4),
)

# The main program starts with a zero word, then the offset (8) of its MOD0 header.
MODULE_HEADER = b"\0\0\0\0\x08\0\0\0MOD0"

SLOTS = 60
SLOT_SIZE = 0x24C
ROSTER_SIZE = SLOTS * SLOT_SIZE
# The player's name for Byleth follows the last slot, as "\x1bN0<name>\x1bN1".
PLAYER_NAME_SIZE = 0x40

# Slot fields
_ITEMS = 0x00  # 6 x (u16 item ID, u16 uses)
# The equipped battalion, 8 bytes (hashcade/feth-save-editor's Battalion struct, embedded at +0x18): u16 owner
# (the character ID of the player's unit that owns it; 0xFFFF on other units, and on yours without one), u16
# cumulative experience, u16 endurance left, u8 battalion ID (NO_BATTALION_ID = none), u8 gambit ID. Checked live
# (1.2.0): Seiros Pegasus Co. -> Almyra Mercenaries -> none -> Seiros Pegasus Co. matched the IDs
# and the marker; using Assembly and taking damage moved experience 0 -> 46 -> 115 (level 2, Exp 15) and endurance
# 60 -> 51 in the battle copy, while the roster slot kept the values from before the battle. Enemies carry real
# battalions with owner 0xFFFF: 21 bandits held Thieves/Rogues/Bandits (173-175), 300 exp, endurance 75 (the import's).
_BATTALION_SLOT = 0x18
_BATTALION_EXP = 0x1A
_BATTALION_ENDURANCE = 0x1C
_BATTALION = 0x1E
_BATTALION_END = 0x20
NO_BATTALION = 0xFFFF
NO_BATTALION_ID = 200  # one past the last battalion; seen on every unit without one (gambit ID 80 beside it)
# Battle records: bit RATTLED_BIT of +RATTLED is set while the unit is rattled (hit by an offensive gambit: no
# battalion benefits, no movement). Seen live: set on exactly the two bandits Byleth's Assembly hit, at that moment,
# and on no other unit. When the game clears it wasn't observed; it's read as it is.
RATTLED, RATTLED_BIT = 0xE0, 0x80
# Battle copies only: the gambit uses left (u8). Seen live dropping 2 -> 1 -> 0 as Assembly was used, apart from the
# acted flags; 0 with no battalion. The game refills them after every battle.
GAMBIT_USES = 0xF5
_CHARACTER = 0x24  # u16; 0xFFFF = empty slot
_LEVEL = 0x4A
_CLASS = 0x4B
_HP = 0x4C
_STATS = 0x4E  # Str, Mag, Dex, Spd, Lck, Def, Res, Mv, Cha
_ABILITIES = 0x7F  # 5 equipped ability IDs; 0xFF = empty
# What the unit has learned, as bitsets (bit n of byte n // 8 = ID n): combat arts (10 bytes, IDs 0-79) and abilities
# (30 bytes, IDs 0-239). Every equipped ability and art of a 15-unit army is set in them; skill-rank abilities keep only
# the highest level (Sword Prowess Lv 3, not Lv 1 and 2).
_LEARNED_ARTS = 0x57
_LEARNED_ABILITIES = 0x61
LEARNED_ABILITIES = 240
# Class mastery progress: one u16 per class ID (data/classes.json, 100 classes) from _CLASS_PROGRESS to the field
# that follows (+0x1DA). Read from the 15-unit save we have: every unit's current class holds a value there (Mercenary
# 69, Archer 72, Warlock 100), classes used earlier keep a smaller one, and none exceeds 100 -- the game's class table
# holds no mastery requirement, so 100 is the highest value seen. Classes whose mastery art is learned read 0 there.
_CLASS_PROGRESS = 0x112
CLASS_COUNT = 100
MASTERY_PROGRESS = 100
# 3 equipped combat art IDs (data/combat-arts.json: Sunder 0, Wrath Strike 1 ... Pneuma Gale 79); 80 and up
# = empty slot. Checked on all 15 units of a save (Manuela: Wrath Strike, Grounder, Hexblade; Lysithea: Draw Back only).
_ARTS = 0x84
ART_SLOTS = 3
COMBAT_ARTS = 80
# The learned spells: 12 slots (5 Reason, 5 Faith, then more; as in gamemem/battle.py) of uses left (u8) at _SPELL_USES and spell IDs (u8, NO_SPELL = empty)
# at _SPELL_IDS (data/spells.json).
_SPELL_USES = 0x94
_SPELL_IDS = 0xA0
SPELL_SLOTS = 12
NO_SPELL = 38
_FLAGS = 0xAC
_BATTLES = 0xBC  # u16 battle counter: the roster counts a battle when it starts, the battle copy doesn't
# The unit's lifetime "Battles" (fights) and "Victories" (units defeated), u16 each. Seen live: both go up by one
# on each side of a fight the moment it happens, enemies start a battle at 0, and the roster slot keeps the
# counts from before the battle until it ends.
_COMBATS = 0x26
_VICTORIES = 0x28
# What the unit has equipped (u16): EQUIPPED_SPELL + the spell's ID for a spell, EQUIPPED_WEAPON for the weapon at the
# top of its inventory, 0xFFFF if it has nothing to fight with.
_EQUIPPED = 0x2E
EQUIPPED_WEAPON = 1
# The slot's flags (u32 at _FLAGS), as hashcade/feth-save-editor's enmCharacterFlags names them: bit 0 "Is Available"
# and bit 1 "Has Joined" (IN_ARMY: both set on every unit in the army), bit 3 "Is Dead". The dead bit isn't confirmed
# live yet: no permadeath has been read with it.
IN_ARMY = 0x03
DEAD = 0x08

# Battle copies have the slot layout (up to the flags) and sit this far after this marker.
BATTLE_MARKER = b"\x04\x03\x00\x00\x00\x00\x00\x00\x00"
BATTLE_MARKER_TO_COPY = 0x14
BATTLE_COPY_READ = GAMBIT_USES + 1
# After a battle starts, look for its copies this many times, this far apart, until they're found.
BATTLE_SCANS = 3
BATTLE_RESCAN_S = 10.0
NO_SCENARIO = 0xFF  # the scenario id outside a battle (seen at the title screen)

STAT_ORDER = ("str", "mag", "dex", "spd", "lck", "def", "res", "mv", "cha")
EMPTY_SLOT = 0xFFFF
EMPTY_ABILITY = 0xFF
# Inventory item IDs 600-649 are equipment (shields, rings, staves...): the unit's accessory.
EQUIPMENT_FIRST, EQUIPMENT_COUNT = 600, 50


class GameMemoryError(Exception):
    """Why the game can't be read right now. The message is shown to the user as is."""


@dataclass(frozen=True)
class RosterUnit:
    character: int  # character ID (0 = Byleth, 4 = Claude ... 1040+ = Cindered Shadows / DLC)
    level: int
    class_id: int
    raw: dict[str, int]  # hp, str ... res, mv, cha before any class or ability boost
    abilities: tuple[int, ...]  # equipped ability IDs
    accessory: int | None  # equipment ID (0 = Leather Shield ...), or None
    arts: tuple[int, ...] = ()  # equipped combat art IDs
    items: tuple[tuple[int, int], ...] = ()  # inventory as (item ID, uses left)
    spells: tuple[tuple[int, int], ...] = ()  # learned spells as (spell ID, uses left)
    battalion: int | None = None  # assigned battalion ID
    learned_abilities: tuple[int, ...] = ()
    learned_arts: tuple[int, ...] = ()
    equipped: int | None = None  # raw equipped field; EQUIPPED_WEAPON means item slot zero
    item_slot_0: int | None = None  # raw item ID at inventory slot zero, before empty slots are compacted
    skills: dict[str, SkillProgress] = field(default_factory=dict)
    # The assigned battalion's cumulative experience and endurance left (None with no battalion).
    battalion_exp: int | None = None
    battalion_endurance: int | None = None
    class_progress: dict[int, int] = field(default_factory=dict)  # class ID -> mastery progress (non-zero only)


def decode_class_progress(record: bytes) -> dict[int, int]:
    """The non-zero class mastery progress of a roster slot, by class ID; a truncated slot yields none."""
    if len(record) < _CLASS_PROGRESS + CLASS_COUNT * 2:
        return {}
    values = struct.unpack_from(f"<{CLASS_COUNT}H", record, _CLASS_PROGRESS)
    return {class_id: value for class_id, value in enumerate(values) if value}


def decode_roster(data: bytes) -> list[RosterUnit]:
    """The units in the player's army, in roster order."""
    units = []
    for i in range(min(SLOTS, len(data) // SLOT_SIZE)):
        s = data[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
        character = struct.unpack_from("<H", s, _CHARACTER)[0]
        if character == EMPTY_SLOT or s[_FLAGS] & IN_ARMY != IN_ARMY:
            continue
        raw = {"hp": s[_HP], **{k: s[_STATS + n] for n, k in enumerate(STAT_ORDER)}}
        items = struct.unpack_from("<12H", s, _ITEMS)[::2]
        accessory = next((x - EQUIPMENT_FIRST for x in items if EQUIPMENT_FIRST <= x < EQUIPMENT_FIRST + EQUIPMENT_COUNT), None)
        abilities = tuple(a for a in s[_ABILITIES : _ABILITIES + 5] if a != EMPTY_ABILITY)
        carried = tuple((item, uses) for item, uses in zip(items, struct.unpack_from("<12H", s, _ITEMS)[1::2]) if item != EMPTY_SLOT)
        spells = tuple(
            (spell, uses)
            for spell, uses in zip(s[_SPELL_IDS : _SPELL_IDS + SPELL_SLOTS], s[_SPELL_USES : _SPELL_USES + SPELL_SLOTS])
            if spell < NO_SPELL
        )
        battalion, battalion_exp, battalion_endurance = decode_battalion(s)
        units.append(
            RosterUnit(
                character, s[_LEVEL], s[_CLASS], raw, abilities, accessory, decode_arts(s), carried, spells,
                battalion, _bits(s, _LEARNED_ABILITIES, LEARNED_ABILITIES), _bits(s, _LEARNED_ARTS, COMBAT_ARTS),
                struct.unpack_from("<H", s, _EQUIPPED)[0],
                struct.unpack_from("<H", s, _ITEMS)[0] if struct.unpack_from("<H", s, _ITEMS)[0] != EMPTY_SLOT else None,
                decode_skill_progress(s),
                battalion_exp,
                battalion_endurance,
                decode_class_progress(s),
            )
        )
    return units


def decode_dead(data: bytes) -> tuple[int, ...]:
    """Character IDs of the slots the game marks dead (Classic mode), whether or not they still count as in the army."""
    dead = []
    for i in range(min(SLOTS, len(data) // SLOT_SIZE)):
        s = data[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
        character = struct.unpack_from("<H", s, _CHARACTER)[0]
        if character != EMPTY_SLOT and struct.unpack_from("<I", s, _FLAGS)[0] & DEAD:
            dead.append(character)
    return tuple(dead)


def decode_battalion(record: bytes, owned: bool = True) -> tuple[int | None, int | None, int | None]:
    """The equipped battalion of a roster slot or battle record: (ID, cumulative experience, endurance left), all None
    with no battalion. `owned`: one of the player's units, whose battalion names its owner (a cleared owner is none);
    other units' battalions have no owner. Experience or endurance the game can't hold reads as None (unknown)."""
    if not _has_battalion(record, owned):
        return None, None, None
    exp, endurance = struct.unpack_from("<HH", record, _BATTALION_EXP)
    return record[_BATTALION], valid_exp(exp), valid_endurance(endurance)


def _has_battalion(record: bytes, owned: bool) -> bool:
    if owned:  # yours: the owner says (an ID outside the import is then unknown, not none)
        return struct.unpack_from("<H", record, _BATTALION_SLOT)[0] != NO_BATTALION
    return record[_BATTALION] < NO_BATTALION_ID


def gambit_uses(copy: bytes, owned: bool = True) -> int | None:
    """Gambit uses left in a battle copy or record; None with no battalion or a value the game can't hold."""
    if len(copy) <= GAMBIT_USES or not _has_battalion(copy, owned):
        return None
    return valid_uses(copy[GAMBIT_USES])


def rattled(record: bytes) -> bool | None:
    """Whether a battle record's unit is rattled; None if the record is too short to tell."""
    return bool(record[RATTLED] & RATTLED_BIT) if len(record) > RATTLED else None


def _bits(record: bytes, offset: int, count: int) -> tuple[int, ...]:
    return tuple(n for n in range(count) if record[offset + n // 8] >> (n % 8) & 1)


def decode_arts(record: bytes) -> tuple[int, ...]:
    """The equipped combat art IDs of a roster slot."""
    return tuple(a for a in record[_ARTS : _ARTS + ART_SLOTS] if a < COMBAT_ARTS)


_NAME_MARKUP = re.compile(r"\x1bN\d")


def decode_player_name(data: bytes) -> str | None:
    """Byleth's name as the player set it, or None if the field doesn't look like a name."""
    text = data.split(b"\0", 1)[0].decode("utf-8", "replace")
    name = " ".join(_NAME_MARKUP.sub(" ", text).split())
    return name if 0 < len(name) <= 20 and name.isprintable() and "�" not in name else None


def _counter(record: bytes) -> int:
    return struct.unpack_from("<H", record, _BATTLES)[0]


def _numbers(record: bytes) -> bytes:
    return record[_HP : _HP + 1] + record[_STATS : _STATS + len(STAT_ORDER)]


def is_live_copy(slot: bytes, copy: bytes) -> bool:
    """`copy` is this unit's copy for the battle in progress (not one left over from an earlier battle).

    Only the army bits of the flags have to match: the game changes the others mid-battle (seen live: 0x20 on a
    mounted unit, which dismounting clears, and 0x08 set for a while on an infantry unit)."""
    return (
        len(copy) >= BATTLE_COPY_READ
        and copy[_CHARACTER : _CHARACTER + 2] == slot[_CHARACTER : _CHARACTER + 2]
        and copy[_FLAGS] & IN_ARMY == IN_ARMY
        and 1 <= copy[_LEVEL] <= 99
        and copy[_CLASS] < 100
        and _counter(copy) + 1 == _counter(slot)
    )


def is_ahead(slot: bytes, copy: bytes) -> bool:
    """Stats only grow in a battle, so the copy is newer when it has a higher level, or the same level and
    higher stats. Once the battle ends and the roster is written back, they're equal and the roster is used."""
    if copy[_LEVEL] != slot[_LEVEL]:
        return copy[_LEVEL] > slot[_LEVEL]
    old, new = _numbers(slot), _numbers(copy)
    return old != new and all(n >= o for o, n in zip(old, new))


def merge_battle(roster: bytes, copies: dict[int, bytes]) -> tuple[bytes, int]:
    """The roster with each unit's live battle copy in place of its slot where the copy is newer.
    Returns the merged roster and how many units came from the battle.

    The battalion's experience and endurance change in the copy without any stat changing (using a gambit, taking
    damage), and the roster keeps the values from before the battle, so they come from every live copy."""
    out = bytearray(roster)
    used = 0
    for i in range(SLOTS):
        slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
        copy = copies.get(struct.unpack_from("<H", slot, _CHARACTER)[0])
        if copy is None or not is_live_copy(slot, copy):
            continue
        if is_ahead(slot, copy):
            out[i * SLOT_SIZE : i * SLOT_SIZE + _FLAGS] = copy[:_FLAGS]
            used += 1
        elif copy[_BATTALION_SLOT:_BATTALION_END] != slot[_BATTALION_SLOT:_BATTALION_END]:
            out[i * SLOT_SIZE + _BATTALION_SLOT : i * SLOT_SIZE + _BATTALION_END] = copy[_BATTALION_SLOT:_BATTALION_END]
    return bytes(out), used


def battle_gambit_uses(roster: bytes, copies: dict[int, bytes]) -> tuple[tuple[int, int], ...]:
    """(character ID, gambit uses left) of each army unit in the battle in progress that has a battalion."""
    found = []
    for i in range(SLOTS):
        slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
        character = struct.unpack_from("<H", slot, _CHARACTER)[0]
        copy = copies.get(character)
        if copy is not None and is_live_copy(slot, copy) and (uses := gambit_uses(copy)) is not None:
            found.append((character, uses))
    return tuple(sorted(found))


def in_battle(roster: bytes, copies: dict[int, bytes]) -> tuple[int, ...]:
    """Character IDs of the army units taking part in the battle in progress (empty outside a battle)."""
    found = []
    for i in range(SLOTS):
        slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
        character = struct.unpack_from("<H", slot, _CHARACTER)[0]
        copy = copies.get(character)
        if copy is not None and slot[_FLAGS] & IN_ARMY == IN_ARMY and is_live_copy(slot, copy):
            found.append(character)
    return tuple(sorted(found))


@dataclass(frozen=True)
class Snapshot:
    roster: bytes  # with newer battle copies merged in
    player_name: bytes
    battle_units: int = 0  # units whose values come from the battle in progress
    in_battle: tuple[int, ...] = ()  # character IDs of the units in the battle in progress
    # Identifies the battle in progress: the roster's battle counters, which go up once per battle.
    battle_key: str = ""
    # Each army unit's fights and victories from before the battle (the roster slot), by character ID.
    start_counts: tuple[tuple[int, int, int], ...] = ()
    # The story's scenario id (a main-story chapter: 11 = Conflict in the Holy Tomb), also read between battles.
    scenario: int | None = None
    # (character ID, gambit uses left) for the units in the battle in progress that have a battalion.
    gambit_uses: tuple[tuple[int, int], ...] = ()


class GameMemory:
    """Finds FE3H in a running emulator (emulators.py) and reads its roster.

    Connects on first use and again whenever a read fails (the emulator or the game was restarted). Every read first
    checks that the game's build ID is still where it was, so stale memory is never mistaken for the roster.
    """

    def __init__(self, emulators: tuple[Emulator, ...] = EMULATORS) -> None:
        self.emulators = emulators
        self._process: ProcessMemory | None = None
        self._main = 0
        self.version: GameVersion | None = None
        self.emulator: Emulator | None = None
        # Battle copies: host address by character ID, the roster's battle counters they were found for, and
        # when to look again if none were found yet.
        self._copies: dict[int, int] = {}
        self._counters: bytes | None = None
        self._scans_left = 0
        self._scan_at = 0.0
        # Where each character's copy was last found: the game tends to put a new battle's copies in the same
        # places, so these are checked first (a few small reads) and the full heap scan runs in the background.
        self._hints: dict[int, int] = {}
        self._generation = 0  # changes when the battle or the connection does, to drop a stale background scan
        # The battle history (battle_history): where Switch memory starts in Eden's, the pool slot of index 0, and
        # entries already decoded (with their raw bytes), by address and header, and the raw entries of the last
        # complete read in history order, for the battle recorder.
        self._arena: int | None = None
        self._arena_retry = 0.0  # when to look for it again after not finding it
        self._pool_start: int | None = None
        self._history: dict[tuple[int, bytes], tuple[object, bytes]] = {}
        self._history_count = 0
        self._history_raw: list[tuple[int, bytes]] = []

    def close(self) -> None:
        if self._process is not None:
            self._process.close()
        self._process, self._main, self.version, self.emulator = None, 0, None, None
        self._copies, self._counters, self._hints = {}, None, {}
        self._generation += 1
        self._arena, self._pool_start, self._history, self._history_raw = None, None, {}, []

    def read(self, battle: bool = True) -> Snapshot:
        """The roster, with the battle in progress merged in (unless `battle` is False)."""
        try:
            return self._read(battle)
        except (OSError, struct.error, IndexError) as exc:
            self.close()
            raise GameMemoryError("Lost contact with the game. Retrying…") from exc

    def _read(self, battle: bool) -> Snapshot:
        if self._process is None:
            self._connect()
        snapshot = self._read_once()
        if snapshot is None:  # the game moved or stopped: look for it again once
            self.close()
            self._connect()
            snapshot = self._read_once()
            if snapshot is None:
                self.close()
                raise GameMemoryError("Lost contact with the game. Retrying…")
        return self._with_battle(snapshot) if battle else snapshot

    def _with_battle(self, snapshot: Snapshot) -> Snapshot:
        roster = snapshot.roster
        counters = b"".join(roster[i * SLOT_SIZE + _BATTLES : i * SLOT_SIZE + _BATTLES + 2] for i in range(SLOTS))
        if counters != self._counters:  # first read, a battle started, or a save was loaded
            self._counters, self._copies = counters, {}
            self._generation += 1
            self._scans_left, self._scan_at = BATTLE_SCANS, 0.0
            self._pool_start, self._history, self._history_raw = None, {}, []
        if not self._copies and self._scans_left and time.monotonic() >= self._scan_at:
            self._scans_left -= 1
            self._scan_at = time.monotonic() + BATTLE_RESCAN_S
            hinted = self._hinted_copies(roster)
            if hinted:  # no wait: use where they were last time now, and let the full scan correct it
                self._copies = hinted
                self._scan_in_background(roster)
            else:
                self._copies = self._find_battle_copies(roster)
                self._hints = dict(self._copies) or self._hints
        copies = {}
        for character, address in list(self._copies.items()):
            data = self._process.read(address, BATTLE_COPY_READ) if self._process else None
            if data is None:
                del self._copies[character]
            else:
                copies[character] = data
        merged, used = merge_battle(roster, copies)
        fighting = in_battle(roster, copies)
        key = hashlib.sha1(counters).hexdigest()[:16] if fighting else ""
        start = []
        for i in range(SLOTS):
            slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
            character = struct.unpack_from("<H", slot, _CHARACTER)[0]
            if character in fighting:
                start.append((character, *struct.unpack_from("<HH", slot, _COMBATS)))
        return Snapshot(
            merged, snapshot.player_name, used, fighting, key, tuple(start), snapshot.scenario,
            battle_gambit_uses(roster, copies),
        )

    def battle_units(self) -> list:
        """Every unit on the battle map (gamemem.battle.BattleUnit), read around the army's battle copies.
        Empty outside a battle. Call after read(), which finds the copies."""
        from .battle import decode_pool, pool_window

        if self._process is None or not self._copies:
            return []
        low, high = pool_window(list(self._copies.values()))
        data = self._process.read(low, high - low)
        if data is None:  # part of the window isn't mapped: read from the first copy onwards only
            low = min(self._copies.values())
            data = self._process.read(low, high - low)
            if data is None:
                return []
        anchor = next(iter(self._copies.values())) - low
        return decode_pool(data, anchor, set(self._copies), base=low)  # the window moves when army units leave

    def battle_globals(self) -> dict[str, int | None]:
        """The battle's global fields located so far (app/data/battle_fields.json): turn number, Divine Pulse charges
        left, the scenario id (which battle it is), the map id (which map it's on) and the map cursor's tile. None for those not located yet,
        or outside a battle."""
        from .battle import fields

        f = fields()
        out: dict[str, int | None] = {"turn": None, "divine_pulse_charges": None, "scenario": None, "map": None, "cursor_x": None, "cursor_y": None}
        if self._process is None or not self._copies:
            return out
        base = self._main + self.GLOBALS[0]
        if f.turn is not None and (data := self._process.read(base + f.turn, 1)):
            out["turn"] = data[0]
        if f.divine_pulse_charges is not None and (data := self._process.read(base + f.divine_pulse_charges, 1)):
            out["divine_pulse_charges"] = data[0]
        if f.scenario is not None and (data := self._process.read(base + f.scenario, 2)):
            scenario = struct.unpack("<H", data)[0]
            out["scenario"] = scenario if scenario < NO_SCENARIO else None
        if f.map is not None and (data := self._process.read(base + f.map, 2)):
            out["map"] = struct.unpack("<H", data)[0]
        for name in ("cursor_x", "cursor_y"):
            if (at := getattr(f, name)) is not None and (data := self._process.read(base + at, 4)):
                out[name] = struct.unpack("<i", data)[0]
        return out

    def battle_terrain(self, units: list) -> tuple[int, tuple[tuple[int, ...], ...]] | None:
        """The battle's map id and terrain IDs (rows from y = 0, gamemem/terrain.py): the map the game says it is
        (globals "map"), checked against where the units stand. None outside a battle or for a map with no grid.
        `units`: battle_units() from the same poll."""
        from . import terrain as t

        if self._process is None or not self._copies:
            return None
        positions = [(u.x, u.y) for u in units if u.x is not None and u.y is not None and u.hp and (u.x, u.y) != (0, 0)]
        return t.battle_map(self.battle_globals().get("map"), positions)

    def battle_history(self, units: list) -> tuple[list, int | None] | None:
        """The game's battle history, the list behind the Divine Pulse screen (gamemem.history.HistoryEntry,
        oldest first), and the pool slot of index 0 to place the units it names (None until the history and
        `units` agree on it). None outside a battle or if the list can't be read. `units`: battle_units() from the
        same poll."""
        from . import history as h
        from .battle import fields

        f = fields()
        p = self._process
        if p is None or not self._copies or None in (f.hp, f.x, f.y):
            return None
        g = self._main + self.GLOBALS[0]
        top = p.read(g + h.COUNT_AT, h.TURNS_AT + 8 * h.MAX_TURNS - h.COUNT_AT)
        if top is None:
            return None
        heads = []
        for turn in range(h.MAX_TURNS):
            head = struct.unpack_from("<Q", top, h.TURNS_AT - h.COUNT_AT + 8 * turn)[0]
            if not head:
                break
            heads.append(head)
        if not heads:
            return None
        first = heads[0]
        count = struct.unpack_from("<I", top, 0)[0]
        if count < self._history_count:  # time was turned back: freed blocks get reused for new entries
            self._history = {}
        self._history_count = count
        if self._arena is None:
            if time.monotonic() < self._arena_retry:
                return None
            self._arena = self._find_arena(g, first)
            if self._arena is None:
                self._arena_retry = time.monotonic() + BATTLE_RESCAN_S * 3
                return None
        # One list per turn. (Pointers past the current turn may be left over from before time was turned back:
        # the entry count says where the history ends.)
        entries, raw = [], []
        seen: set[int] = set()
        for address in heads:
            if len(entries) >= count:
                break
            while address and address not in seen and len(seen) < h.MAX_ENTRIES:
                seen.add(address)
                at = address
                entry, address, data = self._history_entry(address, f)
                if entry is None:
                    return None  # changing under us (or not an entry): try again next poll
                entries.append(entry)
                raw.append((at, data))
        self._history_raw = raw
        if len(self._history) > 4 * h.MAX_ENTRIES:
            self._history = {}
        if self._pool_start is None:
            live = {u.slot: (u.x, u.y, u.hp) for u in units if not u.army and None not in (u.x, u.y, u.hp)}
            self._pool_start = h.pool_start(entries, live)
        return entries, self._pool_start

    def _history_entry(self, address: int, f) -> tuple[object | None, int, bytes]:
        """The decoded entry at a Switch address, the address of the next one (0 = none), and the entry's bytes."""
        from . import history as h

        host = self._arena + address
        header = self._process.read(host, h.HEADER)
        if header is None:
            return None, 0, b""
        key = (address, header)
        cached = self._history.get(key)
        if cached is None:
            data = self._process.read(host, max(h.HEADER, h.entry_size(header)))
            entry = h.decode_entry(data, f.hp, f.x, f.y) if data is not None else None
            if entry is None:
                return None, 0, b""
            cached = self._history[key] = (entry, data)
        return cached[0], h.next_entry(header), cached[1]

    def _find_arena(self, globals_at: int, first: int) -> int | None:
        """Where Switch address 0 is in Eden's memory, checked against the history's first entry."""
        from . import history as h

        p = self._process
        candidates = []
        own = p.read(globals_at + h.SELF_AT, 8)
        if own is not None:
            candidates.append(globals_at + h.SELF_TARGET - struct.unpack("<Q", own)[0])
        if self.emulator is not None:  # fallback: where the emulator was seen to keep it
            candidates += list(self.emulator.layout.arena_candidates(p))
        for arena in candidates:
            data = p.read(arena + first - h.BLOCK_HEADER, h.BLOCK_HEADER + h.HEADER)
            if data is not None and h.looks_like_first(data):
                log.info("Battle history found (Switch memory at %#x)", arena)
                return arena
        log.info("Battle history not found")
        return None

    # The game's global data (main program .data/.bss with values), recorded to find the turn counter etc.
    GLOBALS = (0x19E4000, 0x1BCC000)  # offsets from the start of the main program

    def capture_battle(self) -> dict | None:
        """Raw battle memory for the battle recorder (gamemem.recorder): the pool around the army's battle
        copies, the game's global data, the roster, and the battle history's entries as last read by
        battle_history() (their bytes, to decode actions the history module doesn't know yet, such as gambits).
        None outside a battle."""
        from .battle import pool_window
        from .recorder import pack_history

        if self._process is None or not self._copies or self.version is None:
            return None
        low, high = pool_window(list(self._copies.values()))
        pool = self._process.read(low, high - low)
        if pool is None:
            low = min(self._copies.values())
            pool = self._process.read(low, high - low)
        globals_ = self._process.read(self._main + self.GLOBALS[0], self.GLOBALS[1] - self.GLOBALS[0])
        roster = self._process.read(self._main + self.version.roster_offset, ROSTER_SIZE)
        if pool is None:
            return None
        return {
            "pool_base": low,
            "pool": pool,
            "army": {c: a - low for c, a in self._copies.items()},
            "globals": globals_ or b"",
            "roster": roster or b"",
            "history": pack_history(self._history_raw),
        }

    def _hinted_copies(self, roster: bytes) -> dict[int, int]:
        """The copies still where they were last found (the same checks as the scan, a few small reads)."""
        found = {}
        for i in range(SLOTS):
            slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
            character = struct.unpack_from("<H", slot, _CHARACTER)[0]
            address = self._hints.get(character)
            if address is None or slot[_FLAGS] & IN_ARMY != IN_ARMY or self._process is None:
                continue
            copy = self._process.read(address, BATTLE_COPY_READ)
            if copy and is_live_copy(slot, copy):
                found[character] = address
        return found

    def _scan_in_background(self, roster: bytes) -> None:
        generation = self._generation

        def run() -> None:
            try:
                found = self._find_battle_copies(roster)
            except Exception:  # the connection went away mid-scan: the next battle looks again
                log.debug("Background battle scan failed", exc_info=True)
                return
            if found and generation == self._generation:
                self._copies = found
                self._hints = dict(found)

        threading.Thread(target=run, name="battle-scan", daemon=True).start()

    def _find_battle_copies(self, roster: bytes) -> dict[int, int]:
        """Host address of each army unit's live battle copy (none outside a battle)."""
        slots = {}
        for i in range(SLOTS):
            slot = roster[i * SLOT_SIZE : (i + 1) * SLOT_SIZE]
            if slot[_FLAGS] & IN_ARMY == IN_ARMY:
                slots[struct.unpack_from("<H", slot, _CHARACTER)[0]] = slot
        started = time.monotonic()
        best: dict[int, tuple[bytes, int]] = {}
        for region in self.emulator.layout.heap_regions(self._process):
            for offset in range(0, region.size, 1 << 26):
                data = self._process.read(region.base + offset, min(1 << 26, region.size - offset))
                if data is None:
                    continue
                i = data.find(BATTLE_MARKER)
                while i != -1:
                    address = region.base + offset + i + BATTLE_MARKER_TO_COPY
                    copy = self._process.read(address, BATTLE_COPY_READ)
                    slot = slots.get(struct.unpack_from("<H", copy, _CHARACTER)[0]) if copy else None
                    if slot is not None and is_live_copy(slot, copy):
                        character = struct.unpack_from("<H", copy, _CHARACTER)[0]
                        if character not in best or (copy[_LEVEL], sum(_numbers(copy))) > (best[character][0][_LEVEL], sum(_numbers(best[character][0]))):
                            best[character] = (copy, address)
                    i = data.find(BATTLE_MARKER, i + 1)
        log.info("Battle scan: %d unit(s) in battle (%.1f s)", len(best), time.monotonic() - started)
        return {character: address for character, (_, address) in best.items()}

    def _read_once(self) -> Snapshot | None:
        p, v = self._process, self.version
        if p is None or v is None or p.read(self._main + v.build_id_offset, 16) != v.build_id:
            return None
        data = p.read(self._main + v.roster_offset, ROSTER_SIZE + PLAYER_NAME_SIZE)
        if data is None or len(data) != ROSTER_SIZE + PLAYER_NAME_SIZE:
            return None
        return Snapshot(data[:ROSTER_SIZE], data[ROSTER_SIZE:], scenario=self._scenario())

    def _scenario(self) -> int | None:
        from .battle import fields

        at = fields().scenario
        if self._process is None or at is None or not (data := self._process.read(self._main + self.GLOBALS[0] + at, 2)):
            return None
        scenario = struct.unpack("<H", data)[0]
        return scenario if scenario < NO_SCENARIO else None

    def _connect(self) -> None:
        try:
            found = running(self.emulators)
        except OSError as exc:
            raise GameMemoryError(str(exc)) from exc
        if not found:
            raise GameMemoryError(f"{names(self.emulators[:1])} isn't running.")
        denied: Emulator | None = None
        for emulator, pid in found:
            try:
                process = open_process(pid)
            except AccessDenied:
                denied = denied or emulator
                continue
            except OSError:
                continue
            main = _find_main(process, emulator.layout)
            if main:
                self._process, (self.version, self._main), self.emulator = process, main, emulator
                log.info("Reading FE3H %s from %s (process %d)", self.version.name, emulator.name, pid)
                return
            process.close()
        if denied is not None:
            raise GameMemoryError(MEMORY_ACCESS_HELP.format(emulator=denied.name))
        emulator = found[0][0]
        versions = ", ".join(v.name for v in VERSIONS)
        raise GameMemoryError(
            f"FE3H {versions} isn't running in {emulator.name}. Start the game (other versions aren't supported, and "
            f"{emulator.requirement})."
        )


def _find_main(process: ProcessMemory, layout: MemoryLayout) -> tuple[GameVersion, int] | None:
    """The game version and host address of its main program, if this emulator is running a known FE3H."""
    for region in layout.module_regions(process):
        if process.read(region.base, len(MODULE_HEADER)) != MODULE_HEADER:
            continue
        for version in VERSIONS:
            if process.read(region.base + version.build_id_offset, 16) == version.build_id:
                return version, region.base
    return None
