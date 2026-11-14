"""A run's best unit, shown on its row on the home page."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass

from .battle import Battle, BattleUnitStats
from .runs import BestUnit

@dataclass
class _Totals:
    latest: BattleUnitStats  # as of the newest battle it was in: its look and current level
    damage: int = 0
    healing: int = 0
    kills: int = 0
    falls: int = 0
    deployments: int = 0  # finished battles it was on the map in (not as an adjutant)

    @property
    def score(self) -> int:
        """Damage dealt plus healing done, averaged over the battles it was deployed in (0 if none)."""
        if not self.deployments:
            return 0
        # Halves round up, as the frontend's Math.round does.
        return int((self.damage + self.healing) / self.deployments + 0.5)


def _totals(battles: Iterable[Battle], roster: Collection[str]) -> dict[str, _Totals]:
    """What each unit did over the run's finished battles. A guest is left out unless `roster` has it."""
    totals: dict[str, _Totals] = {}
    kept = set(roster)
    finished = sorted((b for b in battles if b.ended_at is not None), key=lambda b: b.started_at)
    for battle in finished:
        for unit in battle.units:
            if unit.guest and unit.key not in kept:
                continue  # a guest counts only for a unit the run has; it never becomes the best unit by itself
            total = totals.setdefault(unit.key, _Totals(latest=unit))
            total.latest = unit
            # An adjutant is in the battle without being on the map; that isn't a fall, and isn't a deployment, so
            # it doesn't count towards the score.
            total.falls += unit.fell
            if unit.adjutant_of is not None:
                continue
            total.deployments += 1
            total.damage += unit.damage_dealt or 0
            total.healing += unit.healing_given or 0
            total.kills += unit.defeats or 0
    return totals


def unit_scores(battles: Iterable[Battle], roster: Collection[str] = ()) -> dict[str, int]:
    """Every unit's run score: damage dealt plus healing done, averaged over its deployments (the finished battles it
    was in, not as an adjutant)."""
    return {key: total.score for key, total in _totals(battles, roster).items()}


def best_unit(battles: Iterable[Battle], roster: Collection[str] = ()) -> BestUnit | None:
    """The unit with the highest score over the run's finished battles. Ties go to more kills, then fewer falls, a
    higher level, and the earliest in `roster` (unit keys in recruitment order). None if nobody scored anything."""
    totals = _totals(battles, roster)
    if not totals:
        return None
    order = {key: i for i, key in enumerate(roster)}
    key, best = max(
        totals.items(),
        key=lambda item: (
            item[1].score,
            item[1].kills,
            -item[1].falls,
            item[1].latest.level,
            -order.get(item[0], len(order)),
        ),
    )
    if best.score <= 0:
        return None
    unit = best.latest
    return BestUnit(key=key, name=unit.name, class_id=unit.class_id, character=unit.character, female=unit.female, look=unit.look, score=best.score)
