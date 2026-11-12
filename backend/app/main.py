from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .composition import build_runtime
from .config import DATA_DIR, FRONTEND_DIST, SettingsStore
from .inputs import describe_errors
from .infrastructure.game_assets import GameAssetError, game_assets
from .interface.security import LocalOnly

log = logging.getLogger(__name__)


def create_app(data_dir: Path = DATA_DIR, background: bool = True, settings: SettingsStore | None = None) -> FastAPI:
    """`background=False` skips the game reader (used by tests). `settings`: the store the
    launcher already opened, so the app and the desktop window share one copy of the settings."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state = app.state
        state.events.bind(asyncio.get_running_loop())
        if background:
            state.scanner.start()
            state.runtime.updates.start()
        try:
            yield
        finally:
            state.runtime.close()

    app = FastAPI(title="Divine Pulse", lifespan=lifespan)
    app.add_middleware(LocalOnly)

    @app.exception_handler(RequestValidationError)
    async def readable_validation_error(_request: Request, exc: RequestValidationError):
        # One plain sentence the UI can show as-is, instead of pydantic's error list.
        return JSONResponse(status_code=422, content={"detail": describe_errors(list(exc.errors()))})

    @app.exception_handler(GameAssetError)
    async def required_game_asset_error(_request: Request, exc: GameAssetError):
        return JSONResponse(status_code=503, content={"detail": str(exc), "code": "game_asset_error",
                                                     "asset": exc.asset, "reason": exc.reason})

    runtime = build_runtime(data_dir, settings)
    app.state.runtime = runtime
    # Stable handles for desktop integration and existing test/tool callers.
    app.state.settings = runtime.settings
    app.state.store = runtime.store
    app.state.battles = runtime.battles
    app.state.events = runtime.events
    app.state.scanner = runtime.scanner
    app.include_router(router)

    @app.get("/game-assets/{path:path}", include_in_schema=False)
    def imported_asset(path: str) -> FileResponse:
        assets = game_assets()
        file = assets.path(path)
        if file is None:
            raise HTTPException(404, "Not found.")
        record = assets.manifest["files"][path]
        return FileResponse(file, headers={"ETag": f'"{record["sha256"]}"', "Cache-Control": "no-cache"})

    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "Not found.")  # unknown API route, not a page
            file = FRONTEND_DIST / path
            if path and file.is_file() and FRONTEND_DIST in file.resolve().parents:
                return FileResponse(file)
            # The page itself must never come from the window's cache, or an updated tracker keeps showing the
            # old UI (its hashed /assets files are safe to cache).
            return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})

    return app
