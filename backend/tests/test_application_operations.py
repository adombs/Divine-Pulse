from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.application.operations import (
    BackendOperations,
    RunMissing,
    RunNameTaken,
    UnitMissing,
)
from app.application.ports import MissingRecord
from app.domain.ebst import EbstConfig
from app.domain.runs import RunSummary
from app.domain.units import Unit
from app.infrastructure.saved_models import Run


class MemoryRuns:
    def __init__(self):
        self.values: dict[str, Run] = {}

    def list(self):
        return [
            RunSummary(
                id=run.id,
                name=run.name,
                unit_count=len(run.units),
                created_at=run.created_at,
                updated_at=run.updated_at,
                route=run.route,
            )
            for run in self.values.values()
        ]

    def get(self, run_id):
        if run_id not in self.values:
            raise MissingRecord(run_id)
        return self.values[run_id].model_copy(deep=True)

    def create(self, name):
        run_id = name.lower().replace(" ", "-")
        run = Run(id=run_id, name=name.strip())
        self.values[run_id] = run
        return run.model_copy(deep=True)

    def rename(self, run_id, name):
        run = self.get(run_id)
        run.name = name.strip()
        self.values[run_id] = run
        return run

    def delete(self, run_id):
        if run_id not in self.values:
            raise MissingRecord(run_id)
        del self.values[run_id]

    def put_unit(self, run_id, key, unit):
        run = self.get(run_id)
        run.units[key] = unit
        self.values[run_id] = run

    def set_ebst(self, run_id, config):
        run = self.get(run_id)
        run.ebst_default = config
        self.values[run_id] = run

    def delete_unit(self, run_id, key):
        run = self.get(run_id)
        if key not in run.units:
            raise MissingRecord(key)
        del run.units[key]
        self.values[run_id] = run


class MemoryBattles:
    def list(self, _run_id):
        return []

    def delete(self, _run_id, _battle_id):
        raise MissingRecord

    def delete_run(self, _run_id):
        pass


class MemorySettings:
    def __init__(self):
        self.value = MemorySettingsValue()

    def get(self):
        return self.value

    def update(self, **changes):
        self.value = MemorySettingsValue(**{**vars(self.value), **changes})
        return self.value


class MemorySettingsValue(SimpleNamespace):
    def __init__(self, active_run_id=None, window_mode="windowed", auto_interval_s=1.0):
        super().__init__(
            active_run_id=active_run_id,
            window_mode=window_mode,
            auto_interval_s=auto_interval_s,
        )

    def model_dump(self):
        return dict(vars(self))


class MemoryEvents:
    def __init__(self):
        self.items = []

    def publish(self, event, data=None):
        self.items.append((event, data))


class MemoryScanner:
    def current_battle(self):
        return None

    def undo(self):
        return None

    def log_entries(self):
        return []

    def auto_status(self):
        return {"state": "off"}

    def settings_changed(self):
        pass


@pytest.fixture
def operations(tmp_path):
    runs = MemoryRuns()
    settings = MemorySettings()
    events = MemoryEvents()
    ops = BackendOperations(
        runs=runs,
        battles=MemoryBattles(),
        settings=settings,
        events=events,
        scanner=MemoryScanner(),
        memory_check=SimpleNamespace(check=lambda: {"ok": True}),
        system=SimpleNamespace(open_folder=lambda _folder: None),
        data_dir=tmp_path,
        version="0.1.0",
    )
    return ops, runs, settings, events


def test_run_operations_activate_first_run_and_publish_after_success(operations):
    ops, runs, settings, events = operations
    created = ops.create_run("Azure Moon")

    assert created.id == "azure-moon"
    assert settings.get().active_run_id == created.id
    assert events.items == [("runs_changed", None)]

    ops.activate_run(created.id)
    assert settings.get().active_run_id == created.id
    assert events.items[-2:] == [("runs_changed", None), ("battle", {"active": False})]
    with pytest.raises(RunNameTaken, match="already a run"):
        ops.create_run("azure moon")
    with pytest.raises(RunMissing):
        ops.get_run("missing")
    assert len(runs.values) == 1


def test_partial_ebst_changes_preserve_unmentioned_fields(operations):
    ops, runs, _, events = operations
    created = ops.create_run("Run")
    runs.values[created.id].ebst_default = EbstConfig(offense="physical", defense="magical", stats=["hp", "dex"])
    runs.values[created.id].units["felix"] = Unit(
        name="Felix", ebst_offense="physical", ebst_defense="magical", ebst_stats=["hp", "dex"]
    )

    result = ops.set_run_ebst(created.id, {"defense": "flex"})
    assert result.model_dump() == {"offense": "physical", "defense": "flex", "stats": ["hp", "dex"]}
    unit_result = ops.set_unit_ebst(created.id, "felix", {"stats": ["cha"]})
    assert unit_result.ebst_offense == "physical"
    assert unit_result.ebst_defense == "magical"
    assert unit_result.ebst_stats == ["cha"]
    assert events.items[-2:] == [
        ("units_changed", {"run_id": created.id}),
        ("units_changed", {"run_id": created.id}),
    ]


def test_invalid_application_configuration_cannot_be_saved_or_announced(operations):
    from pydantic import ValidationError

    ops, runs, _, events = operations
    created = ops.create_run("Run")
    runs.values[created.id].units["felix"] = Unit(name="Felix")
    before = runs.get(created.id).model_dump()
    notifications = list(events.items)
    with pytest.raises(ValidationError):
        ops.set_run_ebst(created.id, {"defense": "resistance"})
    with pytest.raises(ValidationError):
        ops.set_unit_ebst(created.id, "felix", {"unexpected": "physical"})
    assert runs.get(created.id).model_dump() == before
    assert events.items == notifications


def test_unit_and_battle_missing_records_are_application_errors(operations):
    ops, _, _, _ = operations
    with pytest.raises(RunMissing):
        ops.list_units("missing")
    created = ops.create_run("Run")
    with pytest.raises(UnitMissing):
        ops.set_unit_portrait(created.id, "missing", "female")
    from app.application.operations import BattleMissing

    with pytest.raises(BattleMissing):
        ops.delete_battle(created.id, "missing")


def test_failed_unit_save_does_not_publish_durable_success(operations):
    ops, runs, _, events = operations
    created = ops.create_run("Run")
    runs.values[created.id].units["felix"] = Unit(name="Felix")

    def fail_save(*_args):
        raise OSError("disk full")

    runs.put_unit = fail_save
    event_count = len(events.items)
    with pytest.raises(OSError, match="disk full"):
        ops.set_unit_portrait(created.id, "felix", "female")
    assert len(events.items) == event_count


def test_setting_operation_returns_saved_values_and_data_folder_path(operations):
    ops, _, settings, _ = operations
    result = ops.update_settings({"auto_interval_s": 2.0})

    assert result["auto_interval_s"] == 2.0
    assert ops.about(desktop=False)["data_dir"] == str(ops.data_dir)
    assert ops.about(desktop=False)["desktop"] is False
    assert isinstance(ops.get_settings(), dict)
