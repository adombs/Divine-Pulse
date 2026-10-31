"""Known flat stat bonuses from abilities and equipment (app/data/bonuses.json)."""

from __future__ import annotations

import json
from pathlib import Path

from . import names


def _norm(name: str) -> str:
    return "".join(name.lower().split())


class BonusTable:
    def __init__(self, abilities: dict[str, dict[str, int]], equipment: dict[str, dict[str, int]]):
        self.abilities = {_norm(k): v for k, v in abilities.items()}
        self.equipment = {_norm(k): v for k, v in equipment.items()}

    @classmethod
    def load(cls, path: Path) -> BonusTable:
        data = json.loads(path.read_text("utf-8"))
        return cls(data.get("abilities", {}), data.get("equipment", {}))

    @staticmethod
    def _lookup(table: dict[str, dict[str, int]], name: str) -> dict[str, int]:
        key = _norm(name)
        if key in table:
            return table[key]
        # Allow for small spelling differences (names.similarity never matches "HP +5" with "HP +3").
        m = names.best_match(name, list(table), 0.9)
        return table[m.value] if m else {}

    def compute(self, abilities: list[str], personal_ability: str = "", accessory: str | None = None) -> dict[str, int]:
        total: dict[str, int] = {}
        sources = [self._lookup(self.abilities, a) for a in [*abilities, personal_ability] if a]
        if accessory:
            sources.append(self._lookup(self.equipment, accessory))
        for bonus in sources:
            for stat, amount in bonus.items():
                total[stat] = total.get(stat, 0) + amount
        return total
