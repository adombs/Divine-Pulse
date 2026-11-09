"""A run's best unit, shown on its row on the home page."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass

from .battle import Battle, BattleUnitStats
from .runs import BestUnit

MVP_POINTS = 1000


@dataclass
class _Totals:
    latest: BattleUnitStats  # as of the newest battle it was in: its look and current level
    mvps: int = 0
    damage: int = 0
    healing: int = 0
    kills: int = 0
    falls: int = 0

    @property
    def score(self) -> int:
        return MVP_POINTS * self.mvps + self.damage + self.healing


def best_unit(battles: Iterable[Battle], roster: Collection[str] = ()) -> BestUnit | None:
    """The unit with the highest score over the run's finished battles. Ties go to more kills, then fewer falls, a
    higher level, and the earliest in `roster` (unit keys in recruitment order). None if nobody scored anything."""
    totals: dict[str, _Totals] = {}
    finished = sorted((b for b in battles if b.ended_at is not None), key=lambda b: b.started_at)
    for battle in finished:
        # A battle's MVP is whoever defeated the most (at least one, ties shared), as on the Stats page.
        most = max((u.defeats or 0 for u in battle.units), default=0)
        for unit in battle.units:
            total = totals.setdefault(unit.key, _Totals(latest=unit))
            total.latest = unit
            total.mvps += most > 0 and unit.defeats == most
            total.damage += unit.damage_dealt or 0
            total.healing += unit.healing_given or 0
            total.kills += unit.defeats or 0
            # An adjutant is in the battle without being on the map; that isn't a fall.
            total.falls += unit.fell
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
    return BestUnit(key=key, name=unit.name, class_id=unit.class_id, character=unit.character, female=unit.female, look=unit.look)
