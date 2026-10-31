"""User settings values and their supported ranges, independent of storage."""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field, field_validator

DEFAULT_PORT = 8765
MIN_AUTO_INTERVAL = 0.1
MAX_AUTO_INTERVAL = 60.0
DEFAULT_BATTLE_INTERVAL = 0.1
WindowMode = Literal["windowed", "fullscreen"]
GameLanguage = Literal["JP", "ENG_E", "ENG_U", "GER", "FRA_E", "FRA_U", "ESP_E", "ESP_U", "ITA", "KOR", "TWN", "CHN"]
GAME_LANGUAGES = tuple(GameLanguage.__args__)


class WindowGeometry(TypedDict, total=False):
    x: int
    y: int
    width: int
    height: int
    maximized: bool


class Settings(BaseModel):
    game_language: GameLanguage = "ENG_U"

    @field_validator("game_language", mode="before")
    @classmethod
    def _game_language(cls, value):
        return value if value in GAME_LANGUAGES else "ENG_U"
    last_dump: str | None = None
    battle_filter_auto: bool = True
    battle_page_auto: bool = True
    battle_alerts: bool = True
    record_battles: bool = True
    battle_interval_s: float = Field(DEFAULT_BATTLE_INTERVAL, ge=MIN_AUTO_INTERVAL, le=MAX_AUTO_INTERVAL)
    battle_estimate_fights: bool = True
    pairing_check: bool = False
    hide_history: bool = False
    auto_interval_s: float = Field(1.0, ge=MIN_AUTO_INTERVAL, le=MAX_AUTO_INTERVAL)
    active_run_id: str | None = None
    port: int = Field(DEFAULT_PORT, ge=1024, le=65535)
    window: WindowGeometry | None = None
    window_mode: WindowMode = "windowed"
