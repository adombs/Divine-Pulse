"""Complete user-facing operations, expressed against application ports."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable

from ..domain.battle import Battle
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..domain import deaths
from ..domain.text import normalize
from ..domain.ebst import EbstConfig
from ..domain.runs import Run, RunSummary
from ..domain.units import Unit
from .ports import (
    BattleRepository,
    EventPublisher,
    GameMemoryCheck,
    MissingRecord,
    RunRepository,
    ScannerOperations,
    SettingsRepository,
    SystemInformation,
    WindowOperations,
)


class OperationError(Exception):
    """Expected failure that an interface can map to its transport response."""


class RunMissing(OperationError):
    pass


class UnitMissing(OperationError):
    pass


class BattleMissing(OperationError):
    pass


class RunNameTaken(OperationError):
    def __init__(self, name: str):
        self.name = name
        super().__init__(f'There is already a run called "{name}".')


class RunInBattle(OperationError):
    pass


@dataclass
class BackendOperations:
    runs: RunRepository
    battles: BattleRepository
    settings: SettingsRepository
    events: EventPublisher
    scanner: ScannerOperations
    memory_check: GameMemoryCheck
    system: SystemInformation
    data_dir: Path
    version: str
    window: WindowOperations | None = None
    route_resolver: Callable[[Battle], str | None] | None = None

    def _unique_name(self, name: str, run_id: str | None = None) -> None:
        taken = next(
            (r for r in self.runs.list() if r.id != run_id and normalize(r.name) == normalize(name)),
            None,
        )
        if taken:
            raise RunNameTaken(taken.name)

    def list_runs(self) -> tuple[list[RunSummary], str | None]:
        return self.runs.list(), self.settings.get().active_run_id

    def create_run(self, name: str) -> RunSummary:
        self._unique_name(name)
        run = self.runs.create(name)
        if not self.settings.get().active_run_id:
            self.settings.update(active_run_id=run.id)
        self.events.publish("runs_changed")
        return RunSummary(
            id=run.id,
            name=run.name,
            unit_count=0,
            created_at=run.created_at,
            updated_at=run.updated_at,
        )

    def get_run(self, run_id: str) -> RunSummary:
        try:
            run = self.runs.get(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        return RunSummary(
            id=run.id,
            name=run.name,
            unit_count=len(run.units),
            created_at=run.created_at,
            updated_at=run.updated_at,
            route=run.route,
        )

    def rename_run(self, run_id: str, name: str) -> None:
        self._unique_name(name, run_id)
        try:
            self.runs.rename(run_id, name)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.events.publish("runs_changed")

    def delete_run(self, run_id: str) -> None:
        try:
            self.runs.delete(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.battles.delete_run(run_id)
        if self.settings.get().active_run_id == run_id:
            remaining = self.runs.list()
            self.settings.update(active_run_id=remaining[0].id if remaining else None)
        self.events.publish("runs_changed")

    def activate_run(self, run_id: str) -> None:
        try:
            self.runs.get(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.settings.update(active_run_id=run_id)
        self.events.publish("runs_changed")
        self.events.publish("battle", {"active": self.scanner.current_battle() is not None})

    def get_run_ebst(self, run_id: str) -> EbstConfig:
        try:
            return self.runs.get(run_id).ebst_default
        except MissingRecord as exc:
            raise RunMissing from exc

    def set_run_ebst(self, run_id: str, changes: dict[str, Any]) -> EbstConfig:
        try:
            current = self.runs.get(run_id).ebst_default
            config = EbstConfig.model_validate({**current.model_dump(), **changes})
            self.runs.set_ebst(run_id, config)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.events.publish("units_changed", {"run_id": run_id})
        return config

    def list_units(self, run_id: str) -> list[tuple[str, Unit]]:
        try:
            run = self.runs.get(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        return list(run.units.items())

    def _unit(self, run_id: str, key: str) -> tuple[Run, Unit]:
        try:
            run = self.runs.get(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        unit = run.units.get(key)
        if unit is None:
            raise UnitMissing(key)
        return run, unit

    def set_unit_ebst(self, run_id: str, key: str, changes: dict[str, Any]) -> Unit:
        _, unit = self._unit(run_id, key)
        config = EbstConfig.model_validate({**unit.ebst_config().model_dump(), **changes})
        update = {f"ebst_{field}": value for field, value in config.model_dump().items()}
        unit = Unit.model_validate({**unit.model_dump(), **update})
        try:
            self.runs.put_unit(run_id, key, unit)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.events.publish("units_changed", {"run_id": run_id})
        return unit

    def set_unit_dead(self, run_id: str, key: str, dead: bool) -> Unit:
        """Mark a unit dead (linked to where it last fell, if anywhere) or alive, overriding what was detected."""
        _, unit = self._unit(run_id, key)
        unit = deaths.mark(key, unit, dead, self.battles.list(run_id))
        try:
            self.runs.put_unit(run_id, key, unit)
        except MissingRecord as exc:
            raise RunMissing from exc
        self.events.publish("units_changed", {"run_id": run_id, "unit_key": key})
        return unit

    def get_settings(self) -> dict[str, Any]:
        return self.settings.get().model_dump()

    def update_settings(self, changes: dict[str, Any]) -> dict[str, Any]:
        saved = self.settings.update(**changes)
        self.scanner.settings_changed()
        if self.window is not None:
            self.window.set_mode(saved.window_mode)
        return saved.model_dump()

    def auto_status(self) -> dict[str, Any]:
        return self.scanner.auto_status()

    def current_battle(self) -> Battle | None:
        return self.scanner.current_battle()

    def battle_route(self, battle: Battle) -> str | None:
        return self.route_resolver(battle) if self.route_resolver is not None else None

    def run_battles(self, run_id: str) -> list[Battle]:
        try:
            return self.battles.list(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc

    def delete_battle(self, run_id: str, battle_id: str) -> None:
        try:
            self.battles.delete(run_id, battle_id)
        except MissingRecord as exc:
            raise BattleMissing from exc
        self.events.publish("battle", {"active": self.scanner.current_battle() is not None, "history": True})

    def export_run(self, run_id: str) -> dict[str, Any]:
        try:
            run = self.runs.get(run_id)
            battles = self.battles.list(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        return {"format": "divine-pulse-run", "version": 1, "run": run.model_dump(mode="json"),
                "battles": [battle.model_dump(mode="json") for battle in battles]}

    def export_battles(self, run_id: str) -> dict[str, Any]:
        return {"format": "divine-pulse-battles", "version": 1,
                "battles": [battle.model_dump(mode="json") for battle in self.run_battles(run_id)]}

    def import_run(self, source: Run, battles: list[Battle], name: str, overwrite: bool = False) -> RunSummary:
        existing = next((run for run in self.runs.list() if normalize(run.name) == normalize(name)), None)
        if existing and not overwrite:
            raise RunNameTaken(existing.name)
        live = self.scanner.current_battle()
        if existing and live and live.run_id == existing.id:
            raise RunInBattle("Finish the current battle before overwriting this run.")
        previous = self.runs.get(existing.id) if existing else None
        run_id = existing.id if existing else self.runs.create(name).id
        imported = source.model_copy(deep=True, update={"id": run_id, "name": name})
        copies = [battle.model_copy(deep=True, update={"id": uuid4().hex, "run_id": run_id}) for battle in battles]
        try:
            self.runs.save(imported)
            self.battles.replace(run_id, copies)
        except Exception:
            if previous is None:
                self.runs.delete(run_id)
            else:
                self.runs.save(previous)
            raise
        if not self.settings.get().active_run_id:
            self.settings.update(active_run_id=imported.id)
        self.events.publish("runs_changed")
        self.events.publish("battle", {"active": live is not None, "history": True})
        return self.get_run(imported.id)

    def import_battles(self, run_id: str, battles: list[Battle]) -> int:
        try:
            self.runs.get(run_id)
        except MissingRecord as exc:
            raise RunMissing from exc
        copies = [battle.model_copy(deep=True, update={"id": uuid4().hex, "run_id": run_id}) for battle in battles]
        if copies:
            self.battles.extend(run_id, copies)
            self.events.publish("battle", {"active": self.scanner.current_battle() is not None, "history": True})
        return len(copies)

    def check_memory(self) -> dict[str, Any]:
        return self.memory_check.check()

    def about(self, desktop: bool) -> dict[str, Any]:
        return {
            "version": self.version,
            "data_dir": str(self.data_dir),
            "desktop": desktop,
        }

    def open_data_folder(self) -> None:
        self.system.open_folder(self.data_dir)
