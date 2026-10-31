"""Inventory values stored on a unit; game-table lookup belongs to the adapter."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

InventoryKind = Literal["weapon", "equipment", "item", "spell", "other"]


class InventoryItem(BaseModel):
    """One item or spell a unit carries, using the existing saved/API field names."""

    id: int
    name: str
    kind: InventoryKind
    uses: int
    full: int | None = None
    equipped: bool = False
    # Filled by the game-data adapter. Persisting it preserves current JSON/API output.
    weapon: str | None = None
