"""Battle values, observations and pure rules. No runtime or file access."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .combat import BattleUnit
from .inventory import InventoryItem
from .units import VALUE_KEYS, Unit, now, unit_key


# Losing Byleth or a house leader loses the battle; the outlook counts that.
CRITICAL = {"byleth": "Byleth", "edelgard": "Edelgard", "dimitri": "Dimitri", "claude": "Claude"}

EventKind = Literal[
    "start", "turn", "level_up", "stat_up", "divine_pulse", "joined", "left", "enemies", "end"
]


UsageKind = Literal["weapon", "spell", "art", "item", "rally", "gambit"]


class Usage(BaseModel):
    """A weapon, spell, combat art, item or Rally a unit used in a battle, counted from the game's history."""

    kind: UsageKind
    id: int  # item, spell, combat art or ability ID
    name: str
    times: int = 0  # actions it was used in (a weapon's counterattacks too)
    spent: int = 0  # uses it cost: durability (a combat art's cost included), spell casts, items
    damage: int = 0  # damage dealt with it

    # Resolved at the reference-data boundary; kept in saved/API representations.
    weapon: str | None = None


class BattleUnitStats(BaseModel):
    """One army unit in a battle."""

    key: str  # unit key in the run
    name: str
    class_name: str = ""
    # On your side (team 0) in this battle without being in your army's roster: the house leaders in the prologue.
    # Logged and counted as your unit for the battle (its stats go to the run's totals under `key`), but it never
    # makes or changes a run unit, the roster or a death.
    guest: bool = False
    start_level: int
    level: int
    # On-screen values (hp is max HP), at the start of the battle and now.
    start: dict[str, int]
    now: dict[str, int]
    on_map: bool = True
    # Actions, counted from what the unit spent: weapon durability, consumable items, spell uses.
    weapon_uses: int = 0
    item_uses: int = 0
    spells_cast: int = 0
    # What the unit has left, from its battle record (None until it's read).
    spell_uses_left: int | None = None
    spell_uses_full: int | None = None  # the most seen this battle (full at the start), for "7 of 12"
    weakest_weapon: int | None = None  # uses left of its most worn weapon that isn't broken
    broken_weapons: int = 0  # weapons with no uses left
    consumables_left: int | None = None  # uses left of Vulneraries and other consumables
    inventory: list[InventoryItem] = Field(default_factory=list)  # its items, then its spells, as last read
    accessory: str | None = None  # equipped roster accessory, when known
    arts: list[str] = Field(default_factory=list)  # equipped combat arts, as last read
    # The battalion assignment observed for this battle, never filled from today's roster on load.
    # None = not recorded/unknown (including old files); "" = observed without an assignment.
    battalion: str | None = None
    battalion_id: int | None = Field(default=None, ge=0, le=255)
    # Its state in this battle, as last read (None = not recorded: older files, or not read): cumulative experience,
    # endurance left, gambit uses left. `start`/`now` leave out the battalion's Charm, so spent endurance isn't a
    # stat loss.
    battalion_exp: int | None = Field(default=None, ge=0, le=400)
    battalion_endurance: int | None = Field(default=None, ge=0)
    gambit_uses: int | None = Field(default=None, ge=0)
    # Rattled by a gambit, as last read (its battalion's modifiers don't apply); None = not read.
    rattled: bool | None = None
    # What it used, most used first, from the game's history (None = not tracked: the history couldn't be read).
    usage: list[Usage] | None = None
    hp: int | None = None  # current HP (None until read)
    x: int | None = None  # map position, as last read (None until read)
    y: int | None = None
    acted: bool | None = None  # has acted this phase, as last read (None until read)
    # From the game's history of the battle (None = not tracked: the history couldn't be read).
    damage_taken: int | None = None
    healed: int | None = None  # HP the unit got back (healing received)
    healing_given: int | None = None  # HP it restored to other units
    damage_dealt: int | None = None
    tiles_moved: int | None = None
    # From its Battles / Victories counters (None until read).
    defeats: int | None = None  # other units it defeated
    combats: int | None = None  # fights this battle
    adjutant_of: str | None = None  # key of the unit it's the adjutant of: in the battle, but not on the map
    # For its sprite on the map (game memory only): the game's class and character IDs, and whether it's female.
    class_id: int | None = None
    character: int | None = None
    female: bool = False
    look: str | None = None  # Byleth's hair in this battle ("dark" or "green"), by the battle's scenario
    # The faction ID on its battle record, as the game keeps it (gamemem.battle.ALLEGIANCE; None = not read, or an older file).
    allegiance: int | None = Field(default=None, ge=0, le=255)
    weapon: str = ""  # what it fights with (combat.weapon_kind), for its map badge
    # Level-ups seen only as stat gains of +1 each (a level-up's), before the level itself went up (see
    # BattleTracker._grow).
    assumed_level_ups: int = 0

    @property
    def level_ups(self) -> int:
        return max(0, self.level - self.start_level) + self.assumed_level_ups

    @property
    def fell(self) -> bool:
        """Lost to the battle: off the map, or still in the game's record with no HP left. (An adjutant is in the
        battle without being on the map; that isn't a fall.)"""
        return self.adjutant_of is None and (not self.on_map or (self.hp is not None and self.hp <= 0))

    def gains(self) -> dict[str, int]:
        return {k: self.now[k] - self.start[k] for k in VALUE_KEYS if self.now.get(k, 0) != self.start.get(k, 0)}


class BattleEvent(BaseModel):
    t: float  # seconds since the battle started
    kind: EventKind
    text: str
    unit: str | None = None  # unit key
    gains: dict[str, int] = Field(default_factory=dict)
    level: int | None = None  # level_up: the level reached (None: not known yet, from stat gains alone)


# spell: a staff on a unit that changed no HP (Rescue, Ward, Silence...); art: a combat art that isn't an attack (Swap,
# Draw Back...); act: an action not identified.
LogKind = Literal[
    "phase", "move", "wait", "attack", "defeat", "fell", "heal", "spell", "item", "art", "rally", "gambit", "act", "pulse"
]


class LogEntry(BaseModel):
    """One line of the action log, like the game's Divine Pulse list ("Byleth's attack dealt 17 damage to ...")."""

    t: float  # seconds since the battle started
    turn: int | None = None
    kind: LogKind
    text: str
    unit: str | None = None  # army unit key of whoever acted, if one of yours
    target: str | None = None  # army unit key, or the other unit's label
    # A fight worked out from HP changes and the combat math because the game's history couldn't be read
    # (gamemem/pairing.py): how sure that pairing is (0-1). None: from the game's history, exact.
    confidence: float | None = None
    # The same, structured, so the page can list each unit's fights: who acted and on whom ("a:<key>" for yours,
    # "e:<slot>" for the others; for "fell" the unit that fell and who caused it), HP the target lost, HP the actor
    # lost (a counterattack), HP restored (healing, items), and the phase (0 player, 1 enemy, 2 other).
    actor_id: str | None = None
    target_id: str | None = None
    dealt: int | None = None
    taken: int | None = None
    restored: int | None = None
    phase: int | None = None
    detail: str | None = (
        None  # the spell, item, combat art or Rally used ("Rescue", "Vulnerary", "Smash"), when the history names it
    )
    # The position in the game's history of the action this line is about (None: not from the history). Lines from
    # the same position in two timelines are the same moment (see Branch).
    step: int | None = None


class Branch(BaseModel):
    """A timeline that a Divine Pulse undid: what happened in it from where time was turned back to.

    Branches form a tree. The timeline that still stands has id 0; a branch splits from its parent at history position
    `fork`: everything in the parent before that position happened in the branch too. A later Divine Pulse that goes
    back further than an earlier one moves the earlier branch under the new one."""

    id: int
    parent: int = 0
    fork: int  # history position the branch starts at
    turn: int | None = None  # the turn at that position
    at: float  # when time was turned back (seconds since the battle started)
    log: list[LogEntry] = Field(default_factory=list)  # the actions undone
    events: list[BattleEvent] = Field(
        default_factory=list
    )  # and what else the tracker saw then (units leaving, level-ups)
    # Complete pre-rewind replay, including the shared prefix. Older recordings may not have these snapshots.
    map_steps: list[MapStep] = Field(default_factory=list)
    map_presence: dict[str, list[tuple[int, bool]]] = Field(default_factory=dict)


# The army another unit is in: "player" is yours though it isn't in your roster yet (the house leaders in the
# prologue), "ally" fights on your side, "third" against both; "object" isn't a unit at all but a thing on the map
# with HP of its own (a breakable wall).
Side = Literal["player", "enemy", "ally", "third", "object"]
FOES = frozenset({"enemy", "third"})
# Team 4 (seen live, The Remire Calamity): the breakable walls, which the game keeps as units (class Noble).
OBJECT_TEAM = 4
OBJECT_NAMES = frozenset({"Breakable Wall"})


def side_of(team: int | None, name: str = "") -> Side:
    """The army for a unit record's team byte (gamemem.battle.TEAM), as the game colours it: 0 yours (seen live: Edelgard,
    Dimitri and Claude in the prologue, before they're in the roster), 1 enemy, 2 allies (Jeralt there), 3 a third
    army; 4 objects (breakable walls, also known by name). Unread: enemy."""
    if team == OBJECT_TEAM or name in OBJECT_NAMES:
        return "object"
    return {0: "player", 2: "ally", 3: "third"}.get(team, "enemy")


class EnemyStats(BaseModel):
    """One of the other units on the map, over the battle."""

    slot: int  # pool slot
    label: str  # "Bandit 3"
    name: str = ""  # the game's name for it ("Bandit"), else empty
    class_name: str = ""
    level: int = 0
    max_hp: int = 0
    hp: int | None = None
    combats: int = 0  # fights this battle (its Battles counter starts at 0)
    defeats: int = 0  # your units it defeated (its Victories counter)
    # From the game's history of the battle (None = not tracked: the history couldn't be read).
    damage_dealt: int | None = None  # to your units
    damage_taken: int | None = None
    tiles_moved: int | None = None
    defeated_by: str | None = None  # name of the unit that defeated it
    on_map: bool = True  # on the map with HP left, as last read
    # Taken off the map with HP left, as last read: the story removed it (Tomas when he turns out to be Solon, the
    # villagers fleeing), or it escaped. Not drawn on the map.
    left: bool = False
    weapon: str = ""  # what it fights with (combat.weapon_kind), for its map icon
    x: int | None = None  # map position, as last read (a defeated unit keeps the tile it fell on)
    y: int | None = None
    # For its sprite on the map: the game's class ID (None: not read), whether it's female, its army, and for a
    # character with a name of their own (not a generic unit), the game's character ID.
    class_id: int | None = None
    female: bool = False
    side: Side = "enemy"
    character: int | None = None
    person_id: int | None = None  # persondata row, including generic enemies
    allegiance: int | None = Field(default=None, ge=0, le=255)  # as BattleUnitStats.allegiance
    inventory: list[InventoryItem] = Field(default_factory=list)  # as BattleUnitStats.inventory
    accessory: str | None = None
    usage: list[Usage] | None = None  # standing history, including enemy attacks and counterattacks


MAP_SIZE = 32  # battle maps are at most 32 x 32 tiles (the game's terrain grids are that size)


class MapStep(BaseModel):
    """Where units stood after one step of the game's history (the standing timeline), for replaying the battle on
    the map. Only the units the step changed are listed; the first step lists everyone."""

    step: int  # position in the history (LogEntry.step)
    turn: int
    phase: int  # 0 player, 1 enemy, 2 other
    actor: str | None = None  # uids: "a:<key>" for yours, "e:<slot>" for others
    target: str | None = None
    units: dict[str, tuple[int, int, int]] = Field(default_factory=dict)  # uid -> (x, y, HP)


class TerrainTile(BaseModel):
    """One kind of tile on the battle map (gamemem/terrain.py, the import's data/terrain.json)."""

    name: str  # "Forest"
    kind: str  # colour group: plain, floor, forest, water, mountain, wall, bridge, sand, heal, hazard, fort
    effect: str = ""  # the game's movement group ("Forest", "Fliers only")
    avo: int = 0
    defense: int = 0
    res: int = 0
    heal: int = 0  # % of max HP per turn (negative: damage)
    enter: str = "all"  # who can stand on it: all, fliers, none
    wall_hp: int = 0  # a breakable wall's HP (0: not breakable)


class UnitThreat(BaseModel):
    """What the other armies could do to one of your units before your next turn (gamemem/threat.py)."""

    attackers: list[str] = Field(default_factory=list)  # uids ("e:<slot>") of those that could strike it, strongest first
    max_damage: int = 0  # the most they can deal together: every hit landing as a critical
    expected: float = 0.0  # HP it loses on average
    death: float = 0.0  # chance it falls (0-1), with Hit, Avo and Crit


class TrendPoint(BaseModel):
    t: float  # seconds since the battle started
    chance: float  # outlook at that moment (0-1)
    army_hp: float | None = None  # share of max HP the army and the other units had (0-1), once current HP is located
    enemy_hp: float | None = None


def guest_key(
    name: str, character: int | None, slot: int, class_name: str = "", units: Mapping[str, Unit] | None = None
) -> str:
    """The unit key a guest (a unit on your side, team 0, that isn't in the roster) is logged under. A named character
    reuses the run unit with that game ID if there is one, else the key its name gives (what the roster would use if
    they joined), so everything carries over when they join or come back. A generic unit has no character to carry
    over: its pool slot keeps it apart from others of the same name."""
    if character is not None:
        stored = next((k for k, u in (units or {}).items() if u.game_id == character), None)
        return stored or unit_key(name)
    return f"{unit_key(name or class_name or 'unit')}-{slot}"


def _swap_uid(uid: Any, moved: dict[str, str]) -> Any:
    return moved.get(uid, uid) if isinstance(uid, str) else uid


def _swap_log(entries: Any, moved: dict[str, str], keys: dict[str, str]) -> None:
    for entry in entries if isinstance(entries, list) else ():
        if not isinstance(entry, dict):
            continue
        actor, target = entry.get("actor_id"), entry.get("target_id")
        if actor in moved:
            entry["actor_id"] = moved[actor]
            entry["unit"] = keys[actor]
        if target in moved:
            entry["target_id"] = moved[target]
            if entry.get("target") is not None:
                entry["target"] = keys[target]


def _swap_steps(steps: Any, moved: dict[str, str]) -> None:
    for step in steps if isinstance(steps, list) else ():
        if not isinstance(step, dict):
            continue
        step["actor"], step["target"] = _swap_uid(step.get("actor"), moved), _swap_uid(step.get("target"), moved)
        if isinstance(step.get("units"), dict):
            step["units"] = {_swap_uid(uid, moved): v for uid, v in step["units"].items()}


def _swap_presence(presence: Any, moved: dict[str, str]) -> Any:
    if not isinstance(presence, dict):
        return presence
    out: dict = {}
    for uid, marks in presence.items():
        out.setdefault(_swap_uid(uid, moved), marks)
    return out


def upgrade_guests(data: dict) -> dict:
    """A battle saved before guests existed kept your side's units outside the roster among the other units
    (`enemy_stats`, side "player", as "e:<slot>"). Make them guest army units ("a:<key>") and rewrite every reference
    to them. Idempotent (nothing is left to move the second time) and non-destructive: works on a copy, and the file
    is only rewritten when the battle is saved for another reason."""
    stats = data.get("enemy_stats")
    if not isinstance(stats, dict):
        return data
    mine = {
        k: e for k, e in stats.items() if isinstance(e, dict) and e.get("side") == "player"
    }
    if not mine:
        return data
    data = dict(data)
    units = [dict(u) if isinstance(u, dict) else u for u in data.get("units") or []]
    have = {u.get("key") for u in units if isinstance(u, dict)}
    moved: dict[str, str] = {}
    keys: dict[str, str] = {}
    for k, e in sorted(mine.items(), key=lambda item: int(item[0])):
        slot = int(e.get("slot", k))
        name = e.get("name") or e.get("label") or ""
        key = guest_key(name, e.get("character"), slot, e.get("class_name") or "")
        moved[f"e:{slot}"] = f"a:{key}"
        keys[f"e:{slot}"] = key
        if key in have:
            continue  # already one of the battle's units: the references join it, nothing is duplicated
        have.add(key)
        max_hp = e.get("max_hp") or 0
        values = {"hp": max_hp} if max_hp else {}
        level = e.get("level") or 0
        units.append(
            {
                "key": key,
                "name": name or key,
                "class_name": e.get("class_name") or "",
                "guest": True,
                "start_level": level,
                "level": level,
                "start": dict(values),
                "now": dict(values),
                "on_map": bool(e.get("on_map", True)) and not e.get("left", False),
                "weapon": e.get("weapon") or "",
                "inventory": e.get("inventory") or [],
                "accessory": e.get("accessory"),
                "usage": e.get("usage"),
                "hp": e.get("hp"),
                "x": e.get("x"),
                "y": e.get("y"),
                "damage_dealt": e.get("damage_dealt"),
                "damage_taken": e.get("damage_taken"),
                "tiles_moved": e.get("tiles_moved"),
                "combats": e.get("combats"),
                "defeats": e.get("defeats"),
                "class_id": e.get("class_id"),
                "character": e.get("character"),
                "female": bool(e.get("female", False)),
                "allegiance": e.get("allegiance"),
            }
        )
    data["units"] = units
    data["enemy_stats"] = {k: e for k, e in stats.items() if k not in mine}
    gone = {int(e.get("slot", k)) for k, e in mine.items()}
    if isinstance(data.get("enemy_labels"), dict):
        data["enemy_labels"] = {k: v for k, v in data["enemy_labels"].items() if int(k) not in gone}
    log = [dict(e) if isinstance(e, dict) else e for e in data.get("log") or []]
    _swap_log(log, moved, keys)
    data["log"] = log
    steps = [dict(s) if isinstance(s, dict) else s for s in data.get("map_steps") or []]
    _swap_steps(steps, moved)
    data["map_steps"] = steps
    data["map_presence"] = _swap_presence(data.get("map_presence") or {}, moved)
    branches = []
    for b in data.get("branches") or []:
        if isinstance(b, dict):
            b = dict(b)
            b["log"] = [dict(e) if isinstance(e, dict) else e for e in b.get("log") or []]
            _swap_log(b["log"], moved, keys)
            b["map_steps"] = [dict(s) if isinstance(s, dict) else s for s in b.get("map_steps") or []]
            _swap_steps(b["map_steps"], moved)
            b["map_presence"] = _swap_presence(b.get("map_presence") or {}, moved)
        branches.append(b)
    data["branches"] = branches
    return data


class Battle(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _upgrade(cls, data: Any) -> Any:
        return upgrade_guests(data) if isinstance(data, dict) else data

    id: str
    run_id: str
    # The game's identity for this battle (from its battle counters), so a restart of the tracker mid-battle
    # resumes it instead of starting over. Empty if unknown.
    key: str = ""
    started_at: datetime
    ended_at: datetime | None = None
    # Seconds the game was away from the battle (quit with a bookmark, then resumed): not counted in its time.
    away_s: float = 0
    units: list[BattleUnitStats] = Field(default_factory=list)
    # Immutable roster at battle start; None means this recording predates snapshots.
    roster_snapshot: dict[str, Unit] | None = None
    # New recordings wait for the first active turn; persisted so a restart during preparations is safe.
    roster_snapshot_pending: bool = False
    # Enemies and third-army units on the map (not your side's units outside the roster, allies or objects).
    enemies_start: int = 0
    enemies_now: int = 0
    army_power: float = 0
    enemy_power: float = 0
    divine_pulses: int = 0
    # Located-field stats (None until app/data/battle_fields.json has the offsets).
    turn: int | None = None
    divine_pulse_charges: int | None = None
    enemies_defeated: int | None = None  # enemies and third-army units on the map with no HP left
    army_hp: int | None = None  # current HP of the army units on the map, and their max
    army_max_hp: int | None = None
    enemy_hp: int | None = None  # same for the enemies and third-army units on the map
    enemy_max_hp: int | None = None
    # Names for the other units, "Bandit 3", by pool slot: the game's name for them (else their class), numbered
    # in pool order.
    enemy_labels: dict[int, str] = Field(default_factory=dict)
    # Each other unit's stats over the battle, by pool slot (needs current HP).
    enemy_stats: dict[int, EnemyStats] = Field(default_factory=dict)
    # The part of the map units have stood on so far (tiles; positions run 0 to size - 1), for the minimap. None
    # until a position is read. Only grows, so the map doesn't jump as units move.
    map_w: int | None = None
    map_h: int | None = None
    # Where everyone stood after each step of the game's history (empty if it couldn't be read), to replay the battle.
    map_steps: list[MapStep] = Field(default_factory=list)
    # When other units came onto the map or left it without being defeated, as the tracker saw it: uid -> (step,
    # on the map from that step) in order. A unit not listed was on the map all along. Reinforcements start off it;
    # a unit the story swaps for another (Tomas, revealed as Solon) leaves it.
    map_presence: dict[str, list[tuple[int, bool]]] = Field(default_factory=dict)
    # The map's terrain: a terrain ID per tile, rows from y = 0, cropped to the map's real size (None: not read), and
    # what each ID on it is.
    terrain: list[list[int]] | None = None
    terrain_tiles: dict[int, TerrainTile] = Field(default_factory=dict)
    # Which battle this is: the game's scenario id and its name ("Oil and Water"), and the map it's on, once read.
    scenario: int | None = None
    map_name: str = ""
    map_id: int | None = None
    # The quest the battle is for, as the game's quest table numbers it (None: not for a quest, or not read).
    quest: int | None = None
    # The tile the game's map cursor is on, as last read (None: not read). The minimap follows it.
    cursor: tuple[int, int] | None = None
    # Every action, as the game's Divine Pulse list shows them (from the game's history; empty if it couldn't be read).
    log: list[LogEntry] = Field(default_factory=list)
    events: list[BattleEvent] = Field(default_factory=list)
    # Timelines undone by Divine Pulse (see Branch); the log, events and stats above are the timeline that stands.
    branches: list[Branch] = Field(default_factory=list)
    # The outlook over the battle: a point whenever it changed.
    trend: list[TrendPoint] = Field(default_factory=list)
    # What the other armies could do to each of your units on the map before your next turn, as last worked out
    # (unit key -> UnitThreat; gamemem/threat.py). Empty when it can't be (no positions or combat data).
    threats: dict[str, UnitThreat] = Field(default_factory=dict)
    # The outlook (domain/outlook.outlook) as last worked out: at the start of the battle, when your phase ends and
    # after a Divine Pulse. It holds in between (None: not worked out yet, so it's worked out on demand).
    outlook_at: dict | None = None

    def seconds(self, at: datetime | None = None) -> float:
        end = self.ended_at or at or now()
        return max(0.0, (end - self.started_at).total_seconds() - self.away_s)

    @property
    def level_ups(self) -> int:
        return sum(u.level_ups for u in self.units)

    @property
    def weapon_uses(self) -> int:
        return sum(u.weapon_uses for u in self.units)

    @property
    def spells_cast(self) -> int:
        return sum(u.spells_cast for u in self.units)

    @property
    def item_uses(self) -> int:
        return sum(u.item_uses for u in self.units)

    @property
    def spell_uses_left(self) -> int | None:
        known = [u.spell_uses_left for u in self.units if u.on_map and u.spell_uses_left is not None]
        return sum(known) if known else None

    @property
    def spell_uses_full(self) -> int | None:
        known = [u.spell_uses_full for u in self.units if u.on_map and u.spell_uses_full is not None]
        return sum(known) if known else None

    @property
    def stat_points(self) -> int:
        """Stat points gained by the army in this battle (HP included, Mv not)."""
        return sum(v for u in self.units for k, v in u.gains().items() if k != "mv" and v > 0)


@dataclass(frozen=True)
class ArmySample:
    """One army unit in the battle, as read this poll."""

    key: str
    name: str
    class_name: str
    level: int
    values: dict[str, int]  # on-screen values; hp = max HP
    items: tuple[tuple[int, int], ...] = ()  # inventory as (item ID, uses left)
    spells: tuple[int, ...] = ()  # uses left of each learned spell
    hp: int | None = None  # current HP and map position, once located
    x: int | None = None
    y: int | None = None
    combats: int | None = None  # lifetime Battles and Victories counters, now and before the battle (roster)
    victories: int | None = None
    combats_start: int | None = None
    victories_start: int | None = None
    acted: bool | None = None  # has acted this phase (the game greys it out), None when not read
    adjutant_of: str | None = None  # BattleUnitStats.adjutant_of
    class_id: int | None = None  # as for BattleUnitStats
    character: int | None = None
    female: bool = False
    weapon: str = ""  # as for BattleUnitStats
    spell_ids: tuple[int | None, ...] = ()  # the spell in each slot of `spells` (None = empty slot)
    arts: tuple[str, ...] = ()  # equipped combat arts
    equipped_weapon: bool = False  # the game reported EQUIPPED_WEAPON; inventory slot zero is equipped
    equipped_item_id: int | None = None
    accessory: str | None = None
    equipped_accessory_id: int | None = None
    look: str | None = None  # retained roster look for auxiliary/paralogue scenarios
    allegiance: int | None = None  # as for BattleUnitStats
    battalion: str | None = None  # the assignment ("" none, None unknown), as for BattleUnitStats
    battalion_id: int | None = None
    battalion_exp: int | None = None  # as for BattleUnitStats
    battalion_endurance: int | None = None
    gambit_uses: int | None = None
    rattled: bool | None = None
    guest: bool = False  # as for BattleUnitStats


@dataclass(frozen=True)
class EnemySample:
    class_name: str
    level: int
    power: float
    max_hp: int = 0
    hp: int | None = None  # current HP, once located
    slot: int = -1  # pool position, to follow a unit between samples
    x: int | None = None  # map position, as for ArmySample
    y: int | None = None
    name: str = ""  # the game's name for it ("Bandit")
    combats: int | None = None  # Battles and Victories counters (0 at the start of a battle)
    victories: int | None = None
    weapon: str = ""  # what it fights with, as the map icon shows it (combat.weapon_kind: "sword", "bow", "reason"...)
    class_id: int | None = None  # as for EnemyStats
    female: bool = False
    side: Side = "enemy"
    character: int | None = None
    person_id: int | None = None
    allegiance: int | None = None  # as for BattleUnitStats
    items: tuple[tuple[int, int], ...] = ()  # as ArmySample
    spells: tuple[int, ...] = ()
    spell_ids: tuple[int | None, ...] = ()
    equipped_weapon: bool = False
    equipped_item_id: int | None = None

    @property
    def alive(self) -> bool:
        return self.hp is None or self.hp > 0

    @property
    def is_unit(self) -> bool:
        """A unit, not an object such as a breakable wall (left out of the other units' counts and power)."""
        return self.side != "object"

    @property
    def is_foe(self) -> bool:
        """Against you: an enemy or a third army (not your own side's units outside the roster, allies or objects)."""
        return self.side in FOES


@dataclass(frozen=True)
class StepUnit:
    """A unit's state after a step of the game's history. `uid`: "a:<key>" for yours, "e:<slot>" for others."""

    uid: str
    hp: int
    x: int
    y: int
    max_hp: int | None = None  # yours: raw max HP, to tell a level-up's HP from healing
    # Yours: inventory as (item ID, uses left), uses left and ID of each spell slot, equipped abilities: to tell what
    # an action used.
    items: tuple[tuple[int, int], ...] = ()
    spell_uses: tuple[int, ...] = ()
    spells: tuple[int | None, ...] = ()
    abilities: tuple[int, ...] = ()


# Unit actions in the game's history (gamemem.history.ACTION_*); others aren't identified yet. Combat arts and Rally
# are known by HistoryStep.art and .rally.
STEP_WAIT, STEP_ATTACK, STEP_DEFEAT, STEP_ITEM = 0x0B, 0x00, 0x03, 0x05
RALLY_ABILITIES = range(105, 114)  # Rally Strength ... Rally Charm (data/abilities.json)
STEP_SPELL = STEP_DEFEAT
# Spells that don't attack (data/spells.json): Heal, Recover, Physic, Fortify, Torch, Restore, Ward, Silence,
# Rescue, Warp.
SUPPORT_SPELLS = frozenset((24, 25, 26, 27, 32, 33, 34, 35, 36, 37))


PHASES = {0: "player", 1: "enemy"}


@dataclass(frozen=True)
class HistoryStep:
    """One entry of the game's own battle history, the list behind the Divine Pulse screen (gamemem.history)."""

    turn: int
    phase: int  # 0 player, 1 enemy, 2 other
    phase_start: bool  # "Fight!" / "Began ... phase."
    action: int = STEP_WAIT
    actor: str | None = None  # uids, as for StepUnit
    target: str | None = None
    moved: bool = False
    units: tuple[StepUnit, ...] = ()
    item: int = 0  # gamemem.history.ITEM: an item's ID, or an attack's damage and outcome
    spell: int | None = None  # gamemem.history.SPELL (magic only)
    art: int | None = None  # the combat art used (gamemem.history.ART)
    rally: bool = False  # Rally; `target` is the unit rallied
    gambit: int | None = None  # the battalion gambit used (gamemem.history.GAMBIT); every unit it hit follows


def used_in_step(before: StepUnit, after: StepUnit) -> list[tuple[UsageKind, int, int]]:
    """What a unit of yours spent between two history states: (kind, ID, uses) for each weapon, item and spell."""
    out: list[tuple[UsageKind, int, int]] = []
    left = dict(after.items)
    for item, uses in dict(before.items).items():
        # An item gone from the inventory was used up only if it had one use left (else traded or sent away).
        spent = uses - left[item] if item in left else (1 if uses == 1 else 0)
        if spent > 0 and (item in WEAPONS or item in CONSUMABLES):
            out.append(("weapon" if item in WEAPONS else "item", item, spent))
    if len(before.spell_uses) == len(after.spell_uses):
        for spell, b, n in zip(after.spells, before.spell_uses, after.spell_uses):
            if spell is not None and b > n:
                out.append(("spell", spell, b - n))
    return out


@dataclass(frozen=True)
class BattleSample:
    army: tuple[ArmySample, ...]
    enemies: tuple[EnemySample, ...] = ()
    key: str = ""  # Battle.key
    turn: int | None = None  # once located
    divine_pulse_charges: int | None = None
    # The game's history of the battle so far, oldest first (empty if it couldn't be read), and names for the
    # units it mentions that aren't yours or among `enemies` (by uid).
    history: tuple[HistoryStep, ...] = ()
    other_names: dict[str, str] = field(default_factory=dict)
    # Every record in the battle pool as read (yours and the others), and which of them are your units (slot -> unit
    # key): to work out fights from HP changes when the history can't be read.
    units: tuple[BattleUnit, ...] = ()
    army_slots: dict[int, str] = field(default_factory=dict)
    # The map's terrain IDs, rows from y = 0 (gamemem/terrain.py), once known; None when it can't be.
    terrain: tuple[tuple[int, ...], ...] | None = None
    scenario: int | None = None  # which battle this is (app/data/scenarios.json), once located
    map_id: int | None = None  # which map it's on (the import's data/maps.json), with `terrain`
    cursor: tuple[int, int] | None = None  # the tile the map cursor is on, once located
    hidden: frozenset[str] = frozenset()  # uids of other units in the pool but off the map now (scanner)
    quest: int | None = None  # the quest the battle is for (its row in the game's quest table), once located


# Time allowed to work out the fights between two reads (gamemem/pairing.py), and the most a pairing that the combat
# math couldn't match exactly is shown as sure of.
PAIRING_BUDGET_S = 1.0
APPROXIMATE_CONFIDENCE = 0.5

WEAPONS = range(10, 510)  # inventory item IDs (see gamemem/fe3h.py for the ranges)
CONSUMABLES = range(1000, 1200)


def _uses_by_item(items: tuple[tuple[int, int], ...], ids: range) -> dict[int, int]:
    out: dict[int, int] = {}
    for item, uses in items:
        if item in ids:
            out[item] = out.get(item, 0) + uses
    return out


def _spent(before: dict[int, int], after: dict[int, int]) -> int:
    """Uses spent between two inventories, minus uses that came back to an item the unit already had (time turned
    back). An item that disappears counts only if it had one use left (used up); otherwise it was traded or sent to
    the convoy."""
    spent = sum(
        max(0, uses - after[item]) if item in after else (uses if uses <= 1 else 0) for item, uses in before.items()
    )
    returned = sum(max(0, uses - before[item]) for item, uses in after.items() if item in before)
    return spent - returned


LABELS = {
    "hp": "HP",
    "mv": "Mv",
    "str": "Str",
    "mag": "Mag",
    "dex": "Dex",
    "spd": "Spd",
    "lck": "Lck",
    "def": "Def",
    "res": "Res",
    "cha": "Cha",
}


def power(values: dict[str, int], level: int) -> float:
    """A unit's fighting strength for the outlook: max HP, its better offense and defense, and Spd, weighted a
    little by level. Same scale for both sides."""
    offense = max(values.get("str", 0), values.get("mag", 0))
    defense = max(values.get("def", 0), values.get("res", 0))
    return (values.get("hp", 0) + 2 * offense + 1.5 * defense + 1.5 * values.get("spd", 0)) * (1 + level / 100)


def _gain_text(gains: dict[str, int]) -> str:
    return ", ".join(f"{LABELS.get(k, k)} {v:+d}" for k, v in gains.items())


def _plus_text(gains: dict[str, int]) -> str:
    return ", ".join(f"{LABELS.get(k, k)} +{v}" for k, v in gains.items() if v) or "no stat gains"


def _looks_like_level_up(diff: dict[str, int]) -> bool:
    """Stat changes only a level-up gives: +1 in one or more stats (Mv aside) and nothing else."""
    return bool(diff) and "mv" not in diff and all(v == 1 for v in diff.values())


def continues(sample: BattleSample, battle: Battle) -> bool:
    """Whether a battle starting with this sample is `battle` carried on (the game quit with a bookmark and was
    resumed, or a save from mid-battle was loaded) rather than a new one: the same battle key (the roster's counters,
    which change once a battle is over), and the game's history going on past "Fight!", where a restart of the map
    begins again. Without the history: past turn 1."""
    if not sample.key or sample.key != battle.key:
        return False
    return len(sample.history) > 1 if sample.history else (sample.turn or 0) > 1
