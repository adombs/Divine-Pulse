"""Complete roster updates: propose changes and save once."""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Protocol

from ..domain.changes import Outcome, UnitChange
from ..domain.readings import UnitStatsReading
from ..domain.runs import Run
from ..domain.units import Unit


class RosterRepository(Protocol):
    def apply_units(self, run_id: str, units: Mapping[str, Unit | None]) -> None: ...


@dataclass
class RosterResult:
    changes: list[UnitChange] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    keys: dict[int, str] = field(default_factory=dict)


class RosterUpdates:
    """Failed saves do not complete an update."""

    def __init__(self, repository: RosterRepository, propose: Callable[[UnitStatsReading, Run], Outcome]):
        self.repository = repository
        self.propose = propose
        self.lock = threading.RLock()

    def apply(self, run: Run, readings: Iterable[UnitStatsReading]) -> RosterResult:
        result = RosterResult()
        with self.lock:
            for reading in readings:
                outcome = self.propose(reading, run)
                game_id = reading.game_id
                if game_id is not None and outcome.changes:
                    result.keys[game_id] = outcome.changes[0].key
                if not outcome.changed:
                    continue
                for change in outcome.changes:
                    result.changes.append(change)
                    run.units[change.key] = change.after
                result.warnings.extend(f"{outcome.subject}: {warning}" for warning in outcome.warnings)
            if result.changes:
                self.repository.apply_units(run.id, {change.key: change.after for change in result.changes})
        return result
