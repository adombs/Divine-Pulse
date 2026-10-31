"""The reading handlers with the bonus table and name matching filled in."""

from __future__ import annotations

from collections.abc import Callable

from .bonuses import BonusTable
from .config import BONUSES_FILE
from .domain.changes import Outcome, UnitChange
from .domain.handlers import apply_unit_stats as _apply_unit_stats
from .domain.readings import Reading, UnitStatsReading
from .domain.runs import Run
from .roster import resolve_name


def _dependencies(bonuses: BonusTable | None) -> tuple[BonusTable, Callable]:
    return bonuses or BonusTable.load(BONUSES_FILE), resolve_name


def apply_unit_stats(reading: UnitStatsReading, run: Run, bonuses: BonusTable | None = None) -> Outcome:
    table, resolver = _dependencies(bonuses)
    return _apply_unit_stats(reading, run, table, resolver)


Handler = Callable[[Reading, Run, BonusTable | None], Outcome]
HANDLERS: dict[type[Reading], Handler] = {UnitStatsReading: apply_unit_stats}


def handle(reading: Reading, run: Run, bonuses: BonusTable | None = None) -> Outcome:
    handler = HANDLERS.get(type(reading))
    if handler is None:
        raise LookupError(f"No handler for {type(reading).__name__}")
    return handler(reading, run, bonuses)


__all__ = ["UnitChange", "apply_unit_stats", "handle"]
