"""Which run a game save belongs to.

The tracker reads the game's memory, never its save files, so a save is recognised by its playthrough: Byleth's name
and birthday, and each unit's counters that only ever go up within one playthrough (battles started, fights,
victories, level, skill experience). A run keeps checkpoints of the saves it was synced with, as a tree: each one the
roster as it stood before a battle started, and the newest as it stands now. A save loaded in the game belongs to the
run when it is one of those checkpoints, carries on from the newest of a branch, or sits between two of them (an older
save of the run, rolled back to quietly). Saves overwritten by later progress and several saves of one playthrough
all match, and a run can hold several unrelated saves (one tree each) once the player syncs them with it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .units import now

# Each unit's counters, in this order: battles started, fights, victories, level, total skill experience.
Counters = tuple[int, int, int, int, int]
BATTLES = 0
BYLETH = {0, 1}  # character IDs: Byleth, male and female


@dataclass(frozen=True)
class SaveFingerprint:
    """A save as the game holds it now: Byleth's name and birthday ("Byleth|3/5"), and each army unit's counters by
    character ID."""

    player: str
    units: dict[int, Counters]

    @property
    def fresh(self) -> bool:
        """Before the first battle: every new game looks alike, so such a save belongs to whichever run is active."""
        return all(c[BATTLES] == 0 for c in self.units.values())

    @property
    def blank(self) -> bool:
        """No save loaded yet: the game holds no army, or only the stand-in Byleth it keeps before a save is loaded
        (no battle fought). Nothing to sync, and nothing to ask about until a battle starts with it."""
        return not self.units or (self.units.keys() <= BYLETH and self.fresh)


def encode_units(units: dict[int, Counters]) -> str:
    """Compact text for a checkpoint's units ("0:3.12.4.6.250 4:3.9.2.5.180"), so a run file stays small."""
    return " ".join(f"{character}:" + ".".join(map(str, c)) for character, c in sorted(units.items()))


def decode_units(text: str) -> dict[int, Counters]:
    units: dict[int, Counters] = {}
    for part in text.split():
        character, _, values = part.partition(":")
        numbers = tuple(int(v) for v in values.split("."))
        if len(numbers) == 5:
            units[int(character)] = numbers  # type: ignore[assignment]
    return units


class SaveCheckpoint(BaseModel):
    id: int
    parent: int | None = None  # None: the first checkpoint of a save synced with the run
    player: str
    units: str  # encode_units
    at: datetime = Field(default_factory=now)


class SaveLineage(BaseModel):
    """The checkpoints of the saves a run was synced with (see the module docstring)."""

    checkpoints: list[SaveCheckpoint] = Field(default_factory=list)
    next_id: int = 1


Order = Literal["eq", "ge", "le"]


def compare(a: dict[int, Counters], b: dict[int, Counters]) -> Order | None:
    """How save `a` stands to save `b` over the units both have: equal, ahead (every counter at least b's), behind,
    or None when neither (another playthrough) or they share no unit. Units only one of them has are ignored: units
    join and leave the army."""
    shared = a.keys() & b.keys()
    if not shared:
        return None
    ge = le = True
    for character in shared:
        x, y = a[character], b[character]
        if any(p < q for p, q in zip(x, y)):
            ge = False
        if any(p > q for p, q in zip(x, y)):
            le = False
        if not ge and not le:
            return None
    return "eq" if ge and le else "ge" if ge else "le"


@dataclass(frozen=True)
class Place:
    """Where a save sits in a run's checkpoints: on a checkpoint, after a branch's newest, or between a checkpoint and
    its child (an older save)."""

    kind: Literal["on", "after", "between"]
    checkpoint: int  # the checkpoint it is on or after, or the parent it follows when between


def locate(lineage: SaveLineage, save: SaveFingerprint) -> Place | None:
    """Where `save` sits in the run's checkpoints, or None when it isn't one of the run's saves."""
    points = [c for c in lineage.checkpoints if c.player == save.player]
    if not points:
        return None
    units = {c.id: decode_units(c.units) for c in points}
    has_child = {c.parent for c in lineage.checkpoints if c.parent is not None}
    order = {c.id: compare(save.units, units[c.id]) for c in points}
    for c in reversed(points):  # newest first
        if order[c.id] == "eq":
            return Place("on", c.id)
    for c in reversed(points):
        if order[c.id] == "ge" and c.id not in has_child:
            return Place("after", c.id)
    for c in reversed(points):
        if order[c.id] == "le" and c.parent is not None and order.get(c.parent) in ("ge", "eq"):
            return Place("between", c.parent)
    return None


def record(lineage: SaveLineage, save: SaveFingerprint, place: Place | None, in_battle: bool) -> bool:
    """Note `save` as synced with the run, where `locate` put it (None: a save new to the run, which starts a tree of
    its own). A new checkpoint starts when a battle has started since the last one; until then the newest one moves
    with the save. Returns whether the lineage changed."""
    units = encode_units(save.units)
    by_id = {c.id: c for c in lineage.checkpoints}
    if place is not None and place.kind == "on":
        return False
    if place is not None and place.kind == "after":
        newest = by_id[place.checkpoint]
        if not _battle_since(decode_units(newest.units), save.units):
            newest.units, newest.at = units, now()
            return True
        return _add(lineage, save, units, place.checkpoint)
    if place is not None and place.kind == "between":
        if in_battle:  # a Divine Pulse rewound the battle: the run is the same, nothing to note
            return False
        return _add(lineage, save, units, place.checkpoint)
    return _add(lineage, save, units, None)


def _battle_since(before: dict[int, Counters], after: dict[int, Counters]) -> bool:
    return any(after[c][BATTLES] > before[c][BATTLES] for c in before.keys() & after.keys())


def _add(lineage: SaveLineage, save: SaveFingerprint, units: str, parent: int | None) -> bool:
    lineage.checkpoints.append(SaveCheckpoint(id=lineage.next_id, parent=parent, player=save.player, units=units))
    lineage.next_id += 1
    return True
