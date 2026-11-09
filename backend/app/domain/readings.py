"""Observations from a screen or game-memory read."""

from __future__ import annotations

from dataclasses import dataclass, field

from .inventory import InventoryItem
from .units import SkillKey, SkillProgress


@dataclass
class Reading:
    screen: str


@dataclass
class AbilityInfo:
    personal: str = ""
    equipped: list[str] = field(default_factory=list)
    accessory: str | None = None
    arts: list[str] | None = None
    inventory: list[InventoryItem] | None = None
    learned: list[str] | None = None
    learned_arts: list[str] | None = None
    battalion: str | None = None
    skills: dict[SkillKey, SkillProgress] | None = None
    mastered_classes: list[str] | None = None
    battalion_id: int | None = None  # meaningful only alongside a named assignment
    # Runtime state of a named assignment (None: not read): cumulative experience, endurance left, and gambit uses
    # left (battle only).
    battalion_exp: int | None = None
    battalion_endurance: int | None = None
    gambit_uses: int | None = None
    # What the battalion adds to the Status page's values ({"cha": 5}); {} for nothing (no endurance left), None when
    # it isn't known (no import progression). Already included in the reading's values.
    battalion_bonus: dict[str, int] | None = None


@dataclass
class UnitStatsReading(Reading):
    name_candidates: list[str]
    values: dict[str, int]
    full_name: str | None = None
    blue: set[str] = field(default_factory=set)
    abilities: AbilityInfo | None = None
    class_name: str | None = None
    gender: str | None = None
    game_id: int | None = None
    look: str | None = None  # Byleth's hair: "dark" or "green"
