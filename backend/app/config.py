"""Where the app's files live (paths) and the settings store, under the names the launcher, the window and the tests use."""

from .infrastructure.paths import (
    BONUSES_FILE as BONUSES_FILE,
    DATA_DIR as DATA_DIR,
    FRONTEND_DIST as FRONTEND_DIST,
    FROZEN as FROZEN,
)
from .infrastructure.settings import SettingsStore as SettingsStore
