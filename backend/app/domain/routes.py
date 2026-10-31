"""Pure inference of a playthrough's house/route from explicit evidence."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .battle import Battle, BattleUnitStats
from .units import Unit

if TYPE_CHECKING:
    from .runs import Run


@dataclass(frozen=True)
class RouteReference:
    scenario_routes: Mapping[int, str]
    native_keys: Mapping[int, str]


HOUSES = {
    "black-eagles": {"edelgard", "hubert", "ferdinand", "linhardt", "caspar", "bernadetta", "dorothea", "petra"},
    "blue-lions": {"dimitri", "dedue", "felix", "ashe", "sylvain", "mercedes", "annette", "ingrid"},
    "golden-deer": {"claude", "lorenz", "raphael", "ignatz", "lysithea", "marianne", "hilda", "leonie"},
}
LORDS = {"edelgard": ("black-eagles", "cf"), "dimitri": ("blue-lions", "am"), "claude": ("golden-deer", "vw")}
PART_TWO_CLASSES = {"armored lord", "emperor", "high lord", "great lord", "wyvern master", "barbarossa"}


def _key(unit: Unit | BattleUnitStats, reference: RouteReference, fallback: str = "") -> str:
    character = unit.character if isinstance(unit, BattleUnitStats) else unit.game_id
    words = unit.name.lower().split()
    return reference.native_keys.get(character) or (words[0] if words else getattr(unit, "key", fallback).lower())


def _house(keys: set[str]) -> str | None:
    lords = [house for lord, (house, _) in LORDS.items() if lord in keys]
    if len(lords) == 1:
        return lords[0]
    counts = Counter({house: len(students & keys) for house, students in HOUSES.items()})
    best = counts.most_common(2)
    return best[0][0] if best[0][1] > best[1][1] else None


def route_of(run: Run | None, battles: list[Battle], reference: RouteReference) -> str | None:
    """Part I house, Part II route (cf/ss/am/vw), or None when evidence is insufficient."""
    # Saved battles are chronological; a currently active battle is appended by the store.
    for battle in reversed(battles):
        if battle.scenario in reference.scenario_routes:
            return reference.scenario_routes[battle.scenario]
    roster = {_key(u, reference, key) for key, u in run.units.items()} if run else set()
    part_two = [b for b in battles if b.scenario is not None and 13 <= b.scenario <= 37]
    late_class = any(u.class_name.lower() in PART_TWO_CLASSES for b in battles for u in b.units)
    late_roster = run is not None and any(u.class_name.lower() in PART_TWO_CLASSES for u in run.units.values())
    if part_two or late_class or late_roster:
        late_keys = {_key(u, reference) for b in part_two for u in b.units}
        # On auxiliary battles a lord's exclusive class also establishes Part II.
        late_keys |= {_key(u, reference) for b in battles for u in b.units if u.class_name.lower() in PART_TWO_CLASSES}
        if late_roster:
            late_keys |= {
                _key(u, reference, key) for key, u in run.units.items() if u.class_name.lower() in PART_TWO_CLASSES
            }
        routes = {route for lord, (_, route) in LORDS.items() if lord in late_keys}
        if len(routes) == 1:
            return routes.pop()
        if not routes and _house(roster | late_keys) == "black-eagles" and "edelgard" not in late_keys:
            return "ss"
        return None
    keys = roster | {_key(u, reference) for b in battles for u in b.units}
    return _house(keys)
