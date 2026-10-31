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
