"""Scan-log values shared by application operations and interfaces."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ScanLogEntry(BaseModel):
    id: int
    time: datetime
    status: Literal["ok", "warning", "rejected", "error"]
    message: str
    run_id: str | None = None
    unit_key: str | None = None
    unit_name: str | None = None
    is_new_unit: bool = False
    warnings: list[str] = Field(default_factory=list)
    can_undo: bool = False
    # Where it was read from, e.g. "Game memory".
    screen: str | None = None
