"""Decoded battle-unit observations and equipment identifiers."""

from __future__ import annotations

from dataclasses import dataclass

EQUIPMENT = range(600, 650)
EQUIPPED_SPELL = 4000
NO_SPELL = 38


@dataclass(frozen=True)
class BattleUnit:
    character: int  # game character ID; generic enemies have their own IDs
    army: bool  # one of the player's units
    level: int
    class_id: int
    raw: dict[str, int]  # max HP and stats before class/ability boosts, as in the roster
    # Battle-only fields, not located yet: None until their offsets are confirmed.
    hp: int | None = None
    x: int | None = None
    y: int | None = None
    combats: int = 0  # lifetime fights and units defeated (enemies start the battle at 0)
    victories: int = 0
    # Inventory as (item ID, uses left), and uses left of each learned spell.
    items: tuple[tuple[int, int], ...] = ()
    spell_uses: tuple[int, ...] = ()
    slot: int = -1  # the record's address / RECORD_SIZE: stable for a unit during one battle, whatever window was read
    # Equipped ability IDs, and the spell in each spell slot (aligned with spell_uses; None = empty slot).
    abilities: tuple[int, ...] = ()
    spells: tuple[int | None, ...] = ()
    acted: bool | None = None  # has acted this phase (None: not read)
    off_map: bool = (
        False  # in the pool but not on the map: an adjutant, a reinforcement still to come, a unit the story removed
    )
    pool_index: int | None = None  # its index in the pool (POOL_INDEX)
    attached_to: int | None = None  # pool index of the unit an adjutant is attached to (only meaningful off the map)
    team: int | None = None  # TEAM: 0 the player's side, 1 enemy, 2 / 3 other armies
    allegiance: int | None = None  # ALLEGIANCE: the faction ID the game keeps on the record (data/factions.json)
    flags: int | None = None  # the raw flags byte (ACTED): acted, on the map, off the map, and bits not known yet
    equipped: int | None = None  # what it has equipped, as the game keeps it (fe3h._EQUIPPED); None: not read
    item_slot_0: int | None = None  # raw item ID at inventory slot zero, before empty slots are compacted
    # The equipped battalion (fe3h.decode_battalion), yours and other units': ID, cumulative experience, endurance
    # left and gambit uses left. None: no battalion, or not read.
    battalion: int | None = None
    battalion_exp: int | None = None
    battalion_endurance: int | None = None
    gambit_uses: int | None = None
    rattled: bool | None = None  # hit by a gambit: no battalion benefits (fe3h.RATTLED); None: not read

    @property
    def max_hp(self) -> int:
        return self.raw["hp"]

    @property
    def equipped_spell(self) -> int | None:
        """The spell it has equipped (its ID), None if it has a weapon or nothing equipped (or that isn't read)."""
        e = self.equipped
        return e - EQUIPPED_SPELL if e is not None and EQUIPPED_SPELL <= e < EQUIPPED_SPELL + NO_SPELL else None


@dataclass(frozen=True)
class Fight:
    """One fight worked out from two reads (units by pool slot)."""

    attacker: int
    defender: int
    attacker_lost: int  # HP each side lost in it (best explanation)
    defender_lost: int
    defeated: int | None  # slot of the unit that fell in it
    confidence: float  # 0-1


@dataclass(frozen=True)
class Pairing:
    fights: tuple[Fight, ...]
    exact: bool  # the combat math explains the reads exactly (else ranked by closeness)
    candidates: int = 0  # pairings that passed the hard rules
    partial: bool = False  # ran out of time before scoring them all: confidences are among those scored
