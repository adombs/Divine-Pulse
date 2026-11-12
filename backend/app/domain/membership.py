"""Who is in the army (Unit.in_army), as the game's roster says.

The Roster shows the units in the army plus the dead (Unit.on_roster). A unit that leaves the army alive is not deleted:
it only stops being on the Roster, keeping its settings, death info and battles, and returns with them when the game
has it in the army again.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping

from .units import Unit


def on_roster(unit: Unit) -> bool:
    """Whether the Roster shows the unit: in the army, or dead (the game's word or the user's)."""
    return unit.in_army or unit.death is not None


def detect(units: Mapping[str, Unit], present: Collection[int]) -> dict[str, Unit]:
    """Changed units after a complete read of the roster outside a battle: `present` the character IDs whose slot has the
    in-army flag. Units with no game ID are left as they are.  Pass the units with any deaths.detect changes already applied, so the two combine."""
    return {
        key: unit.model_copy(update={"in_army": in_army})
        for key, unit in units.items()
        if unit.game_id is not None and unit.in_army != (in_army := unit.game_id in present)
    }

