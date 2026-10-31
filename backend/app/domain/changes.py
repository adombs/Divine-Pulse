"""Proposed unit changes produced by applying an observation."""

from __future__ import annotations

from dataclasses import dataclass, field

from .units import Unit


@dataclass
class UnitChange:
    key: str
    before: Unit | None
    after: Unit


@dataclass
class Outcome:
    subject: str
    changes: list[UnitChange] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def is_new(self) -> bool:
        return any(change.before is None for change in self.changes)

    @property
    def changed(self) -> bool:
        return any(change.before is None or not same_unit(change.before, change.after) for change in self.changes)


def same_unit(a: Unit, b: Unit) -> bool:
    """Compare the fields a scan can change, excluding timestamps."""
    keys = (
        "full_name",
        "class_name",
        "gender",
        "displayed",
        "bonuses",
        "personal_ability",
        "abilities",
        "accessory",
        "combat_arts",
        "inventory",
        "learned_abilities",
        "learned_arts",
        "battalion",
        "skills",
        "source",
        "look",
    )
    return (
        all(getattr(a, key) == getattr(b, key) for key in keys)
        and a.game_id == b.game_id
        and sorted(a.blue) == sorted(b.blue)
    )
