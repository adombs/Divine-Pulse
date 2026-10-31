"""Load route-reference tables and adapt existing route queries."""

from __future__ import annotations

import json
from pathlib import Path

from ..domain.battle import Battle
from ..domain.routes import RouteReference, route_of as infer_route
from ..domain.runs import Run
from . import game_tables


def route_reference() -> RouteReference:
    data = Path(__file__).resolve().parents[1] / "data"
    scenarios = json.loads((data / "scenario_routes.json").read_text("utf-8"))
    characters = game_tables.memory()["characters"]
    return RouteReference(
        scenario_routes={int(key): value for key, value in scenarios["routes"].items()},
        native_keys={int(key): value["name"].lower().split()[0] for key, value in characters.items() if value["name"].split()},
    )


def route_of(run: Run | None, battles: list[Battle]) -> str | None:
    return infer_route(run, battles, route_reference())
