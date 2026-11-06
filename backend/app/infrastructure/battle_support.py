"""Concrete reference, fight-estimation, and diagnostic adapters."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..gamemem.pairing import enemy_phase_began, pair_fights
from .inventory import art_name, inventory, item_name, spell_name, weapon_kind
from .battle_data import gambit_name, item_used, rally_name, scenario_name, support_spell, terrain_tiles

log = logging.getLogger(__name__)


class DefaultBattleSupport:
    inventory = staticmethod(inventory)
    item_name = staticmethod(item_name)
    spell_name = staticmethod(spell_name)
    art_name = staticmethod(art_name)
    weapon_kind = staticmethod(weapon_kind)
    rally_name = staticmethod(rally_name)
    gambit_name = staticmethod(gambit_name)
    support_spell = staticmethod(support_spell)
    item_used = staticmethod(item_used)
    terrain_tiles = staticmethod(terrain_tiles)
    scenario_name = staticmethod(scenario_name)
    pair_fights = staticmethod(pair_fights)
    enemy_phase_began = staticmethod(enemy_phase_began)

    @staticmethod
    def write_pairing_report(directory: Path, name: str, report: dict) -> None:
        try:
            directory.mkdir(parents=True, exist_ok=True)
            (directory / name).write_text(json.dumps(report, indent=1), "utf-8")
        except OSError:
            log.exception("Could not save fight-pairing diagnostic report")
