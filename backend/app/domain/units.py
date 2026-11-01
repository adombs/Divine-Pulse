"""Authoritative unit and skill value models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .ebst import DEFAULT_OTHER_KEYS, EbstConfig, EbstType, OtherKey, ordered_others
from .inventory import InventoryItem

STAT_KEYS = ("str", "mag", "dex", "spd", "lck", "def", "res", "cha")
VALUE_KEYS = ("hp", "mv", *STAT_KEYS)
ValueKey = Literal["hp", "mv", "str", "mag", "dex", "spd", "lck", "def", "res", "cha"]
PortraitGender = Literal["auto", "male", "female"]
SkillKey = Literal[
    "sword", "lance", "axe", "bow", "brawling", "reason", "faith", "authority", "heavy_armor", "riding", "flying"
]
SkillRank = Literal["E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+"]


def now() -> datetime:
    return datetime.now(timezone.utc)


def unit_key(name: str) -> str:
    """Normalized storage key, distinct from a game's character ID."""
    return " ".join(name.lower().split())


class SkillProgress(BaseModel):
    """Current progress decoded from the game's skill-rank fields."""

    rank: SkillRank
    # The decoder bounds this to the memory field width; stored domain data retains any nonnegative value.
    exp: int = Field(ge=0)


# Byleth's green-haired state is retained after chapter 10 (scenario 10). Chapter 11's Holy Tomb battle is already
# after the Sothis merge. The game has two looks (persondata portraits 0/1 and 71/72; Part II reuses green).
# docs/game-assets/byleth-looks.md.
SOTHIS_SCENARIO = 10
LAST_MAIN_SCENARIO = 37  # paralogues, auxiliary battles and Cindered Shadows come after


def byleth_look(scenario: int | None, in_battle: bool = False) -> Literal["dark", "green"] | None:
    """Byleth's hair for the story's scenario id: "dark" until the merge, "green" after it; None when the scenario isn't
    known. The game keeps the id of the last battle fought, so after scenario 10 the saved look switches to green.
    During scenario 10 (`in_battle`) the cutscene transition isn't tracked. Scenario 11 is always green. Only
    main-story scenarios count: a paralogue can come before the merge, and the game keeps its id too."""
    if scenario is None or not 0 <= scenario <= LAST_MAIN_SCENARIO:
        return None
    return "green" if scenario > SOTHIS_SCENARIO or (scenario == SOTHIS_SCENARIO and not in_battle) else "dark"


class Unit(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    name: str = Field(min_length=1)
    full_name: str = ""
    class_name: str = ""
    gender: str = ""
    displayed: dict[ValueKey, int] = Field(default_factory=lambda: {key: 0 for key in VALUE_KEYS})
    bonuses: dict[ValueKey, int] = Field(default_factory=dict)
    manual_bonuses: dict[ValueKey, int] = Field(default_factory=dict)
    blue: list[ValueKey] = Field(default_factory=list)
    personal_ability: str = ""
    abilities: list[str] = Field(default_factory=list)
    accessory: str | None = None
    combat_arts: list[str] = Field(default_factory=list)
    inventory: list[InventoryItem] = Field(default_factory=list)
    learned_abilities: list[str] = Field(default_factory=list)
    learned_arts: list[str] = Field(default_factory=list)
    battalion: str = ""
    skills: dict[SkillKey, SkillProgress] = Field(default_factory=dict)
    source: Literal["scan", "memory", "manual"] = "manual"
    game_id: int | None = Field(default=None, ge=0)
    updated_at: datetime = Field(default_factory=now)
    ebst_offense: EbstType = "auto"
    ebst_defense: EbstType = "auto"
    ebst_stats: list[OtherKey] = Field(default_factory=lambda: list(DEFAULT_OTHER_KEYS))
    portrait_gender: PortraitGender = "auto"
    # Byleth's hair as the game has it now: "dark" or "green" (from the Sothis merge on); None until read from memory.
    look: Literal["dark", "green"] | None = None

    def ebst_config(self) -> EbstConfig:
        return EbstConfig(offense=self.ebst_offense, defense=self.ebst_defense, stats=ordered_others(self.ebst_stats))

    def effective_bonus(self, key: str) -> int:
        return self.manual_bonuses.get(key, self.bonuses.get(key, 0))

    def base(self) -> dict[str, int]:
        return {key: self.displayed.get(key, 0) - self.effective_bonus(key) for key in VALUE_KEYS}


__all__ = [
    "PortraitGender",
    "SkillKey",
    "SkillProgress",
    "SkillRank",
    "STAT_KEYS",
    "Unit",
    "VALUE_KEYS",
    "byleth_look",
    "ValueKey",
    "now",
    "unit_key",
]
