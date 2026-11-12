"""Capabilities battle tracking needs from reference data and external analysis."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from ..domain.battle import HistoryStep, StepUnit, TerrainTile
from ..domain.combat import BattleUnit, Pairing
from ..domain.inventory import InventoryItem


class BattleSupport(Protocol):
    def inventory(
        self,
        items: tuple[tuple[int, int], ...],
        spell_uses: tuple[int, ...] = (),
        spells: tuple[int | None, ...] = (),
        *,
        equipped_item_id: int | None = None,
        equipped_accessory_id: int | None = None,
    ) -> list[InventoryItem]: ...

    def item_name(self, ident: int) -> str: ...
    def spell_name(self, ident: int) -> str: ...
    def art_name(self, ident: int) -> str: ...
    def weapon_kind(self, kind: str, ident: int) -> str | None: ...
    def rally_name(self, unit: StepUnit | None) -> str: ...
    def gambit_name(self, ident: int) -> str: ...
    def support_spell(self, step: HistoryStep) -> str | None: ...
    def item_used(self, step: HistoryStep) -> str | None: ...
    def terrain_tiles(self, grid: list[list[int]]) -> dict[int, TerrainTile]: ...
    def scenario_name(self, scenario: int) -> str: ...

    def pair_fights(
        self,
        before: list[BattleUnit],
        after: list[BattleUnit],
        *,
        budget: float,
        origins: dict[int, tuple[int, int]],
        enemy_phase: bool,
        terrain: list[list[int]] | None,
    ) -> Pairing: ...

    def enemy_phase_began(self, before: list[BattleUnit], after: list[BattleUnit]) -> bool: ...

    def threats(
        self, units: list[BattleUnit], grid: list[list[int]] | None, spent: frozenset[int]
    ) -> dict[int, tuple[tuple[int, ...], int, float, float]]:
        """For each of your units on the map (by slot): who could strike it before your next turn, the most damage they
        can deal together, the HP it loses on average, and the chance it falls (gamemem/threat.py). Empty when the
        combat data isn't there."""
        ...

    def write_pairing_report(self, directory: Path, name: str, report: dict) -> None: ...
