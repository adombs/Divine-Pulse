"""Pure effective-BST setup values (the UI works out the numbers)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EbstType = Literal["auto", "physical", "magical", "flex"]
OtherKey = Literal["hp", "mv", "dex", "spd", "lck", "cha"]
OTHER_KEYS: tuple[str, ...] = ("hp", "mv", "dex", "spd", "lck", "cha")
DEFAULT_OTHER_KEYS: tuple[str, ...] = ("hp", "spd")


def ordered_others(stats: Iterable[str]) -> list[str]:
    chosen = set(stats)
    return [key for key in OTHER_KEYS if key in chosen]


class EbstConfig(BaseModel):
    """How offense, defense, and the individually toggled stats contribute to eBST."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    offense: EbstType = "auto"
    defense: EbstType = "auto"
    stats: list[OtherKey] = Field(default_factory=lambda: list(DEFAULT_OTHER_KEYS))

    @field_validator("stats")
    @classmethod
    def _canonical_stats(cls, stats: list[OtherKey]) -> list[OtherKey]:
        # Domain configurations accept only supported keys and keep one canonical order.
        return ordered_others(stats)

