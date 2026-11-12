"""User settings values and their supported ranges, independent of storage."""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field, model_validator

DEFAULT_PORT = 8765
DEFAULT_ROSTER_INTERVAL = 1.0
DEFAULT_BATTLE_INTERVAL = 0.1
WindowMode = Literal["windowed", "fullscreen"]
# Where the game is read from: Eden (the emulator) or FE3H Recomp (the native Windows recompilation).
MemoryReader = Literal["eden", "recomp"]
# What to do with another copy of a one-time battle in a run: keep the best copy automatically, or ask.
DuplicateBattles = Literal["keep_best", "ask"]
GameLanguage = Literal["JP", "ENG_E", "ENG_U", "GER", "FRA_E", "FRA_U", "ESP_E", "ESP_U", "ITA", "KOR", "TWN", "CHN"]
GAME_LANGUAGES = tuple(GameLanguage.__args__)


class WindowGeometry(TypedDict, total=False):
    x: int
    y: int
    width: int
    height: int
    maximized: bool


class Settings(BaseModel):
    max_recordings: int = Field(3, ge=0, le=1000)

    @model_validator(mode="before")
    @classmethod
    def _migrate_recording_limit(cls, value):
        if isinstance(value, dict) and "max_recordings" not in value and value.get("record_battles") is False:
            return {**value, "max_recordings": 0}
        return value

    active_run_id: str | None = None
    installation_version: str | None = None
    replace_import: bool = False
    port: int = Field(DEFAULT_PORT, ge=1024, le=65535)
    window: WindowGeometry | None = None
    window_mode: WindowMode = "windowed"
    memory_reader: MemoryReader = "eden"
    duplicate_battles: DuplicateBattles = "keep_best"
