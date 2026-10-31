"""Filesystem locations for user data and bundled application resources."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from ..domain.settings import DEFAULT_PORT as DEFAULT_PORT
from ..system import data_dir

APP_NAME = "Divine Pulse"
FROZEN = bool(getattr(sys, "frozen", False))
PROJECT_ROOT = Path(__file__).resolve().parents[3]
INSTALL_DIR = Path(sys.executable).resolve().parent if FROZEN else PROJECT_ROOT
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", PROJECT_ROOT))
def default_data_dir() -> Path:
    override = os.environ.get("DIVINE_PULSE_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if FROZEN:
        portable = INSTALL_DIR / "data"
        if portable.is_dir():
            return portable
        return data_dir(APP_NAME)
    return PROJECT_ROOT / "data"


def default_game_assets_dir(data: Path) -> Path:
    """Where assets extracted from the user's own game dump live (python -m app.gamefiles extract): the repository's
    game-assets/ folder from source, the data folder's game-assets/ in an installed copy."""
    override = os.environ.get("DIVINE_PULSE_GAME_ASSETS")
    if override:
        return Path(override).expanduser()
    return data / "game-assets" if FROZEN else PROJECT_ROOT / "game-assets"


DATA_DIR = default_data_dir()
GAME_ASSETS_DIR = default_game_assets_dir(DATA_DIR)
FRONTEND_DIST = RESOURCE_DIR / "frontend_dist" if FROZEN else PROJECT_ROOT / "frontend" / "dist"
BONUSES_FILE = Path(__file__).resolve().parents[1] / "data" / "bonuses.json"
