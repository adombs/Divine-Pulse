from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import NoReturn

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from .. import __version__
from ..application.operations import (
    BattleMissing,
    OperationError,
    RunMissing,
    RunNameTaken,
    UnitMissing,
)
from .inputs import EbstIn, GameDumpIn, PortraitIn, RunName, SettingsIn
from ..domain.ebst import EbstConfig
from ..domain.scans import ScanLogEntry
from ..domain.runs import RunSummary
from ..domain.runs import Run
from ..domain.battle import Battle
from pydantic import ValidationError
from .responses import UnitOut
from .responses import RunsOut, battle_out
from .runtime import RuntimeView, runtime_for

router = APIRouter(prefix="/api")


@router.get("/game-assets/status")
def game_assets_status(request: Request) -> dict:
    return _state(request).game_import.status()


@router.get("/game-assets/candidates")
def game_assets_candidates(request: Request) -> dict:
    return {"candidates": _state(request).game_import.candidates()}


@router.post("/game-assets/scan")
def game_assets_scan(body: GameDumpIn, request: Request) -> dict:
    try:
        return _state(request).game_import.scan(body.dump)
    except (OSError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/game-assets/import", status_code=202)
def game_assets_import(body: GameDumpIn, request: Request) -> dict:
    try:
        return {"job": _state(request).game_import.start(body.dump)}
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/game-assets/verify")
def game_assets_verify(request: Request) -> dict:
    try:
        return _state(request).game_import.verify()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {"ok": False, "checked": 0, "errors": [str(exc)], "warnings": []}


@router.post("/game-assets/pick-folder")
def game_assets_pick_folder(request: Request) -> dict:
    pick = getattr(request.app.state, "pick_game_dump", None)
    if pick is None:
        raise HTTPException(501, "No desktop window (running in browser mode).")
    return {"path": pick()}


@router.delete("/game-assets")
def game_assets_delete(request: Request) -> None:
    try:
        _state(request).game_import.delete()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


def _state(request: Request) -> RuntimeView:
    return runtime_for(request)


def _raise_http(exc: OperationError) -> NoReturn:
    if isinstance(exc, RunNameTaken):
        raise HTTPException(409, str(exc)) from exc
    if isinstance(exc, RunMissing):
        raise HTTPException(404, "Run not found.") from exc
    if isinstance(exc, UnitMissing):
        raise HTTPException(404, "Unit not found.") from exc
    if isinstance(exc, BattleMissing):
        raise HTTPException(404, "Battle not found.") from exc
    raise exc


def _call[**P, R](operation: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
    try:
        return operation(*args, **kwargs)
    except OperationError as exc:
        _raise_http(exc)


@router.get("/runs")
def list_runs(request: Request) -> RunsOut:
    runs, active_id = _state(request).operations.list_runs()
    return RunsOut(runs=runs, active_run_id=active_id)


@router.post("/runs")
def create_run(body: RunName, request: Request) -> RunSummary:
    return _call(_state(request).operations.create_run, body.name)


@router.patch("/runs/{run_id}")
def rename_run(run_id: str, body: RunName, request: Request) -> None:
    _call(_state(request).operations.rename_run, run_id, body.name)


@router.delete("/runs/{run_id}")
def delete_run(run_id: str, request: Request) -> None:
    _call(_state(request).operations.delete_run, run_id)


@router.post("/runs/{run_id}/activate")
def activate_run(run_id: str, request: Request) -> None:
    _call(_state(request).operations.activate_run, run_id)


@router.get("/runs/{run_id}/ebst")
def get_run_ebst(run_id: str, request: Request) -> EbstConfig:
    return _call(_state(request).operations.get_run_ebst, run_id)


@router.put("/runs/{run_id}/ebst")
def set_run_ebst(run_id: str, body: EbstIn, request: Request) -> EbstConfig:
    return _call(
        _state(request).operations.set_run_ebst,
        run_id,
        body.model_dump(exclude_none=True),
    )


@router.get("/runs/{run_id}/units")
def list_units(run_id: str, request: Request) -> list[UnitOut]:
    pairs = _call(_state(request).operations.list_units, run_id)
    return [UnitOut.from_unit(key, unit) for key, unit in pairs]


@router.put("/runs/{run_id}/units/{key}/ebst")
def set_unit_ebst(run_id: str, key: str, body: EbstIn, request: Request) -> UnitOut:
    unit = _call(
        _state(request).operations.set_unit_ebst,
        run_id,
        key,
        body.model_dump(exclude_none=True),
    )
    return UnitOut.from_unit(key, unit)


@router.put("/runs/{run_id}/units/{key}/portrait")
def set_unit_portrait(run_id: str, key: str, body: PortraitIn, request: Request) -> UnitOut:
    unit = _call(
        _state(request).operations.set_unit_portrait,
        run_id,
        key,
        body.gender,
    )
    return UnitOut.from_unit(key, unit)


@router.delete("/runs/{run_id}/units/{key}")
def delete_unit(run_id: str, key: str, request: Request) -> None:
    _call(_state(request).operations.delete_unit, run_id, key)


@router.post("/scan/undo")
def undo_scan(request: Request) -> ScanLogEntry | None:
    return _state(request).operations.undo_scan()


@router.get("/scans")
def scan_log(request: Request) -> list[ScanLogEntry]:
    return _state(request).operations.scan_log()


@router.post("/window/show")
def show_window(request: Request) -> None:
    window = _state(request).operations.window
    if window is None:
        raise HTTPException(404, "No desktop window (running in browser mode).")
    try:
        window.show()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/settings")
def get_settings(request: Request):
    return _state(request).operations.get_settings()


@router.put("/settings")
def put_settings(body: SettingsIn, request: Request):
    return _state(request).operations.update_settings(body.model_dump())


@router.get("/auto")
def auto_status(request: Request) -> dict:
    return _state(request).operations.auto_status()


@router.get("/battle")
def current_battle(request: Request) -> dict:
    battle = _state(request).operations.current_battle()
    return {
        "battle": battle_out(battle, active=True, route=_state(request).operations.battle_route(battle))
        if battle
        else None
    }


@router.get("/runs/{run_id}/battles")
def run_battles(run_id: str, request: Request) -> list[dict]:
    battles = _call(_state(request).operations.run_battles, run_id)
    return [
        battle_out(battle, active=False, route=_state(request).operations.battle_route(battle))
        for battle in reversed(battles)
    ]


def _import_payload(body: dict, kind: str, fields: set[str]) -> None:
    """Accept the current export format for this kind of data."""
    formats = {f"divine-pulse-{kind}"}
    if set(body) != fields or body.get("format") not in formats or body.get("version") != 1:
        raise HTTPException(422, "Unsupported or invalid import file.")


@router.get("/runs/{run_id}/export")
def export_run(run_id: str, request: Request) -> dict:
    return _call(_state(request).operations.export_run, run_id)


@router.post("/runs/import")
def import_run(body: dict, request: Request) -> RunSummary:
    _import_payload(body, "run", {"format", "version", "run", "battles"})
    try:
        source = Run.model_validate(body["run"])
        battles = [Battle.model_validate(item) for item in body["battles"]]
        if any(battle.run_id != source.id for battle in battles):
            raise ValueError("A battle belongs to a different run.")
    except (ValidationError, TypeError, ValueError, KeyError) as exc:
        raise HTTPException(422, f"Invalid run file: {exc}") from exc
    return _state(request).operations.import_run(source, battles)


@router.get("/runs/{run_id}/battles/export")
def export_battles(run_id: str, request: Request) -> dict:
    return _call(_state(request).operations.export_battles, run_id)


@router.post("/runs/{run_id}/battles/import")
def import_battles(run_id: str, body: dict, request: Request) -> dict:
    _import_payload(body, "battles", {"format", "version", "battles"})
    try:
        battles = [Battle.model_validate(item) for item in body["battles"]]
    except (ValidationError, TypeError, ValueError, KeyError) as exc:
        raise HTTPException(422, f"Invalid battles file: {exc}") from exc
    return {"added": _call(_state(request).operations.import_battles, run_id, battles)}


@router.delete("/runs/{run_id}/battles/{battle_id}")
def delete_battle(run_id: str, battle_id: str, request: Request) -> None:
    _call(_state(request).operations.delete_battle, run_id, battle_id)


@router.get("/memory/check")
def check_memory(request: Request) -> dict:
    return _state(request).operations.check_memory()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "app": "divine-pulse", "version": __version__}


@router.get("/about")
def about(request: Request) -> dict:
    state = _state(request)
    return state.operations.about(desktop=state.desktop)


@router.post("/about/open-data-folder")
def open_data_folder(request: Request) -> None:
    try:
        _state(request).operations.open_data_folder()
    except OSError as exc:
        raise HTTPException(500, str(exc)) from exc


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    runtime = _state(request)
    bus = runtime.events
    q = bus.subscribe()

    async def stream():
        try:
            yield f"event: hello\ndata: {json.dumps({'notices': runtime.take_notices()})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(q.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if message is None:
                    break
                yield message
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
