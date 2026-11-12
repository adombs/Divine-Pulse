"""Duplicate battles: copies of a one-time battle in one run, and which copy is the best to keep. Pure rules."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass

from .battle import Battle

# Scenarios that are never compared.
IGNORED_SCENARIOS = frozenset({95, 96, 98, 99})
# The auxiliary battles that can be fought again and again (the scenario ids; a battle quest on one is one-time).
REPEATABLE_SCENARIOS = range(61, 86)

Identity = tuple[int, int | None]


def identity(battle: Battle, quests: Collection[int]) -> Identity | None:
    """What battle this is within a run, (scenario, quest), or None for one that is never compared."""
    if battle.scenario is None or battle.scenario in IGNORED_SCENARIOS:
        return None
    quest = battle.quest if battle.quest is not None and battle.quest in quests else None
    return battle.scenario, quest


def repeatable(key: Identity) -> bool:
    scenario, quest = key
    return quest is None and scenario in REPEATABLE_SCENARIOS


def won(battle: Battle) -> bool:
    """Whether the battle ended with the enemy gone (the model records no result, so this is the closest sign)."""
    return battle.enemies_start > 0 and battle.enemies_now == 0


def rank(battle: Battle) -> tuple:
    """Higher is better: won, enemies defeated, turn reached, how much was logged, then the newest."""
    return (won(battle), battle.enemies_defeated or 0, battle.turn or 0, len(battle.log), battle.id)


def best(copies: Iterable[Battle]) -> Battle:
    return max(copies, key=rank)


@dataclass(frozen=True)
class DuplicateGroup:
    scenario: int
    quest: int | None
    battles: tuple[Battle, ...]  # newest first

    @property
    def best(self) -> Battle:
        return best(self.battles)

    @property
    def latest(self) -> Battle:
        """The newest copy (the one started last)."""
        return self.battles[0]

    def kept(self, mode: str) -> Battle | None:
        """The copy a setting keeps automatically: "keep_best" the best, "keep_latest" the newest; None for "ask"."""
        return self.best if mode == "keep_best" else self.latest if mode == "keep_latest" else None

    @property
    def name(self) -> str:
        return next((b.map_name for b in self.battles if b.map_name), "")


def groups(battles: Iterable[Battle], quests: Collection[int]) -> list[DuplicateGroup]:
    """Every one-time battle fought more than once, ordered by scenario (then quest)."""
    found: dict[Identity, list[Battle]] = {}
    for battle in battles:
        key = identity(battle, quests)
        if key is not None and not repeatable(key):
            found.setdefault(key, []).append(battle)
    return [
        DuplicateGroup(scenario, quest, tuple(sorted(copies, key=lambda b: b.id, reverse=True)))
        for (scenario, quest), copies in sorted(found.items(), key=lambda item: (item[0][0], item[0][1] or 0))
        if len(copies) > 1
    ]


def group_of(battle: Battle, history: Iterable[Battle], quests: Collection[int]) -> DuplicateGroup | None:
    """The duplicate group the battle belongs to in the history, if it forms one."""
    key = identity(battle, quests)
    if key is None or repeatable(key):
        return None
    return next((g for g in groups(history, quests) if (g.scenario, g.quest) == key), None)
