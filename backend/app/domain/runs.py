"""Playthrough value model."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .ebst import EbstConfig
from .units import Unit, now


class Rule(BaseModel):
    """One self-imposed rule of a run (No Divine Pulse, Classic, a rule of the player's own): a short name and, if
    wanted, what it means."""

    name: str
    description: str = ""


# How many rules a ruleset holds, and how long a rule's name and description may be.
MAX_RULES = 40
RULE_NAME_LEN = 60
RULE_DESCRIPTION_LEN = 280


class Run(BaseModel):
    schema_version: Literal[1] = 1
    id: str
    name: str
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    units: dict[str, Unit] = Field(default_factory=dict)
    ebst_default: EbstConfig = Field(default_factory=EbstConfig)
    route: str | None = None
    # The run's self-imposed rules, in the order the player put them.
    ruleset: list[Rule] = Field(default_factory=list)


# The game's scenario ids for main-story chapters (the prologue to the last chapter of every route), as in
# frontend/src/components/battle/scenarios.ts; paralogues, auxiliary battles and Cindered Shadows come after.
MAIN_SCENARIOS = range(0, 38)


class ChapterRef(BaseModel):
    """A main-story battle: the game's scenario id and the battle's name ("" until read)."""

    scenario: int
    name: str = ""


class BestUnit(BaseModel):
    """The run's best unit (see best_unit.py), with what it takes to draw its sprite."""

    key: str
    name: str
    class_id: int | None = None
    character: int | None = None
    female: bool = False
    look: str | None = None
    score: int = 0  # its run score


class RunSummary(BaseModel):
    id: str
    name: str
    unit_count: int
    created_at: datetime
    updated_at: datetime
    route: str | None = None
    battle_count: int = 0
    last_chapter: ChapterRef | None = None
    best_unit: BestUnit | None = None
