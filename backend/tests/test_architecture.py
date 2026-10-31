"""Enforce dependency direction and exercise the checker with prohibited imports."""

from pathlib import Path

import pytest

from architecture import check, violations_for


def test_backend_layer_boundaries():
    assert check(Path(__file__).resolve().parents[1]) == []


@pytest.mark.parametrize(
    ("module", "source"),
    [
        ("app.domain.units", "from fastapi import Request"),
        ("app.domain.units", "from ..storage import RunStore"),
        ("app.application.operations", "from ..infrastructure.persistence import RunStore"),
        ("app.application.operations", "def hidden():\n    from app.config import SettingsStore"),
        ("app.infrastructure.persistence", "from ..interface.api import router"),
        ("app.interface.api", "from ..gamemem.fe3h import GameMemory"),
        ("app.domain.units", "contents = path.read_text('utf-8')"),
    ],
)
def test_prohibited_dependencies_are_detected(module, source):
    assert violations_for(source, module)


def test_valid_inward_and_relative_imports_are_allowed():
    assert (
        violations_for(
            "from ..domain.units import Unit\nfrom .ports import RunRepository", "app.application.operations"
        )
        == []
    )
    assert (
        violations_for("from pydantic import BaseModel\nfrom .inventory import InventoryItem", "app.domain.units") == []
    )
