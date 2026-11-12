"""What the other armies can do to each of your units before your next turn: who can reach it, the most they can deal
together, and the chance it falls (for the outlook, domain/outlook.py).

For each unit of yours:
- Reach is walked: another unit moves up to its Mv (paying each tile's cost for how it moves: MOVE_COST; past its own
  side but never through other units) to a free tile from which its equipped weapon reaches the unit.
- Each tile around a unit holds one attacker, so the most that can strike it is a matching of attackers to free tiles
  (a unit boxed in by others can't be hit by melee at all). The strongest attackers that fit are taken: the worst case.
- Each attack is the game's own forecast (combat.forecast_from: Atk against Def or Res with terrain, doubling, the unit's
  counter, true Hit against Avo, Crit against crit avoid) and every way it can go (combat.outcomes), carried from one
  attack to the next, strongest first. The chance it falls is the chance its HP runs out somewhere along the way; the
  most damage is every hit landing as a critical.

Not modelled: gambits, combat arts, chance-based skills, and the enemy AI (some units hold their ground or pick other
targets: this is what they *could* do, not what they will).
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, replace

from ..domain.combat import BattleUnit
from .combat import CAVALRY as CAVALRY_MOVE, FLYING, Arm, CombatData, Fighter, combat_data, fight_stats, forecast_from, in_range, max_range, outcomes
from .terrain import IMPASSABLE, ground, terrain

HOSTILE_TEAMS = frozenset({1, 3})  # the enemy and a third army (gamemem.battle.TEAM)
MAP = 32
# What entering a tile costs, by the tile's movement group (the import's terrain "move_name") and how the unit moves:
# (infantry, thieves, cavalry, mages, fliers, monsters). From the Fire Emblem Wiki's Three Houses terrain table
# (fireemblemwiki.org/wiki/Terrain/Nintendo_Switch_games): "Forest" is its Forest / Stronghold / Floor Trap row,
# "Thicket" its Thicket (Wilderness) / Fiery Floor row, "Special" its Heal Tile + / Throne / Cover rows. None: can't.
MOVE_COST: dict[str, tuple[int | None, ...]] = {
    "Normal": (1, 1, 1, 1, 1, 1),
    "Special": (1, 1, 1, 1, 1, 1),
    "Forest": (2, 1, 3, 2, 1, 2),
    "Thicket": (2, 1, 4, 1, 1, 2),
    "Sand": (2, 2, 4, 1, 1, 2),
    "Shoal / snow": (2, 2, 3, 2, 1, 2),
    "Wasteland": (1, 1, 2, 1, 1, 1),
    "Swamp / flames / crater": (1, 1, 2, 1, 1, 1),
    "Stairs": (1, 1, 3, 1, 1, None),
}
INFANTRY, THIEF, CAVALRY, MAGE, FLIER, MONSTER = range(6)
# Classes by how they move, as the same page groups them (armored classes move as infantry; anything not listed too).
MOVE_CLASSES = {
    THIEF: {"Assassin", "Brawler", "Grappler", "Thief", "Trickster"},
    CAVALRY: {"Bow Knight", "Cavalier", "Dark Knight", "Death Knight", "Great Knight", "Holy Knight", "Paladin", "Valkyrie"},
    MAGE: {"Agastya", "Bishop", "Dark Bishop", "Dark Mage", "Gremory", "Mage", "Monk", "Priest", "Verrat", "War Cleric", "War Monk", "Warlock"},
    MONSTER: {
        "Altered Demonic Beast", "Altered Golem", "Black Beast", "Demonic Beast", "Exp. Demonic Beast", "Giant Demonic Beast",
        "Golem", "Guardian Golem", "Hegemon Husk", "Lord of the Desert", "Lord of the Lake", "The Immaculate One", "Titanus",
        "Umbral Beast", "Wandering Beast", "Wild Demonic Beast", "Giant Wolf", "Giant Crawler",
    },
}
MAX_ATTACKERS = 8  # tiles around a unit within range 2 that can hold an attacker, at most considered


@dataclass(frozen=True)
class Threat:
    attackers: tuple[int, ...]  # slots of the units that could strike it, strongest first (as many as fit around it)
    max_damage: int  # the most they can deal together: every hit landing, as a critical
    expected: float  # HP it loses on average
    death: float  # chance it falls (0-1)


def move_kind(f: Fighter, data: CombatData) -> int:
    """How `f` moves (INFANTRY, THIEF... for MOVE_COST)."""
    if FLYING in f.moves:
        return FLIER
    info = data.classes.get(f.unit.class_id)
    name = info.name if info is not None else ""
    return next((kind for kind, names in MOVE_CLASSES.items() if name in names), CAVALRY if CAVALRY_MOVE in f.moves else INFANTRY)


def _cost(tile_id: int | None, kind: int) -> int | None:
    """What entering a tile costs a unit that moves as `kind` (None: can't)."""
    if tile_id is None:
        return 1
    info = terrain(tile_id)
    if info is None:
        return None if tile_id == IMPASSABLE else 1
    if info.enter == "none" or (info.enter == "fliers" and kind != FLIER):
        return None
    return MOVE_COST.get(info.move, MOVE_COST["Normal"])[kind]


def _stops(f: Fighter, units: list[BattleUnit], grid: list[list[int]] | None, kind: int = INFANTRY) -> set[tuple[int, int]]:
    """The tiles `f` (moving as `kind`) can end its move on."""
    u = f.unit
    blocked = {(o.x, o.y) for o in units if o.team != u.team}
    taken = {(o.x, o.y) for o in units if o is not u}
    w = max((len(r) for r in grid), default=MAP) if grid else MAP
    h = len(grid) if grid else MAP
    start = (u.x, u.y)
    best = {start: 0}
    todo = [(0, start)]
    while todo:
        spent, (x, y) = heapq.heappop(todo)
        if spent > best.get((x, y), f.mv + 1):
            continue
        for nxt in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= nxt[0] < w and 0 <= nxt[1] < h) or nxt in blocked:
                continue
            row = grid[nxt[1]] if grid else None
            step = _cost(row[nxt[0]] if row is not None and nxt[0] < len(row) else None, kind)
            if step is None or spent + step > f.mv or spent + step >= best.get(nxt, f.mv + 1):
                continue
            best[nxt] = spent + step
            heapq.heappush(todo, (spent + step, nxt))
    return {p for p in best if p == start or p not in taken}


def _match(options: list[set[tuple[int, int]]]) -> list[tuple[int, int]] | None:
    """A tile for each attacker, no two on one tile (None if they don't all fit)."""
    owner: dict[tuple[int, int], int] = {}

    def place(i: int, seen: set) -> bool:
        for tile in options[i]:
            if tile in seen:
                continue
            seen.add(tile)
            if tile not in owner or place(owner[tile], seen):
                owner[tile] = i
                return True
        return False

    for i in range(len(options)):
        if not place(i, set()):
            return None
    where = {i: tile for tile, i in owner.items()}
    return [where[i] for i in range(len(options))]


def _ground(grid: list[list[int]] | None, x: int, y: int, f: Fighter):
    tile = grid[y][x] if grid and 0 <= y < len(grid) and 0 <= x < len(grid[y]) else None
    return ground(tile, FLYING in f.moves)


def threats(
    units: list[BattleUnit],
    grid: list[list[int]] | None = None,
    spent: frozenset[int] = frozenset(),
    targets: set[int] | None = None,
    data: CombatData | None = None,
) -> dict[int, Threat]:
    """What the other armies' units (all but those in `spent`: they've acted this phase) can do to each of your units
    on the map (by slot; only those in `targets` if given) before your next turn."""
    data = data or combat_data()
    if not data.weapons:  # the game's tables aren't imported: nothing to work it out from
        return {}
    placed =[u for u in units if not u.off_map and u.x is not None and u.y is not None and (u.hp or 0) > 0]
    foes: list[tuple[Fighter, Arm, set[tuple[int, int]]]] = []
    for u in placed:
        if u.team not in HOSTILE_TEAMS or u.slot in spent:
            continue
        f = Fighter.from_unit(u, data)
        arm = f.equipped
        if arm is not None:
            foes.append((f, arm, _stops(f, placed, grid, move_kind(f, data))))
    out: dict[int, Threat] = {}
    for u in placed:
        if u.team != 0 or (targets is not None and u.slot not in targets):
            continue
        out[u.slot] = _threat(Fighter.from_unit(u, data), foes, grid)
    return out


def _threat(me: Fighter, foes: list[tuple[Fighter, Arm, set[tuple[int, int]]]], grid) -> Threat:
    u = me.unit
    mine = me.equipped
    my_ground = _ground(grid, u.x, u.y, me)
    # Who could reach it, from which tiles, and how hard each hits from the best of them.
    reach = []
    for f, arm, stops in foes:
        tiles = {p for p in stops if arm.weapon.min_range <= abs(p[0] - u.x) + abs(p[1] - u.y) <= max_range(f, arm)}
        if not tiles:
            continue
        best = None
        for p in tiles:
            d = abs(p[0] - u.x) + abs(p[1] - u.y)
            fc = _forecast(f, arm, me, mine, d, _ground(grid, p[0], p[1], f), my_ground)
            worst = sum(1 for who in fc.order if who == "a") * (2 if fc.attacker.strikes_twice else 1)
            score = (fc.attacker.mt * worst, fc.attacker.hit)
            if best is None or score > best[0]:
                best = (score, fc)
        reach.append((best[0], f, arm, tiles))
    reach.sort(key=lambda r: r[0], reverse=True)
    # The strongest that fit around it, one to a tile.
    chosen: list[tuple[Fighter, Arm, set[tuple[int, int]]]] = []
    for _, f, arm, tiles in reach:
        if len(chosen) >= MAX_ATTACKERS:
            break
        if _match([t for _, _, t in chosen] + [tiles]) is not None:
            chosen.append((f, arm, tiles))
    tiles = _match([t for _, _, t in chosen]) or []
    # Carry its HP through each attack in turn.
    hp: dict[int, float] = {u.hp: 1.0}
    max_damage = 0
    for (f, arm, _), p in zip(chosen, tiles):
        d = abs(p[0] - u.x) + abs(p[1] - u.y)
        a_ground = _ground(grid, p[0], p[1], f)
        nxt: dict[int, float] = {}
        for left, chance in hp.items():
            if left <= 0:
                nxt[left] = nxt.get(left, 0.0) + chance
                continue
            fc = _forecast(f, arm, replace(me, hp=left), mine, d, a_ground, my_ground)
            for o, q in outcomes(fc, f.hp, left).items():
                after = left - o.d_lost
                nxt[after] = nxt.get(after, 0.0) + chance * q
        hp = nxt
        fc = _forecast(f, arm, me, mine, d, a_ground, my_ground)
        max_damage += max((o.d_lost for o in outcomes(fc, f.hp, 10_000)), default=0)
    death = sum(q for left, q in hp.items() if left <= 0)
    expected = sum(q * (u.hp - max(0, left)) for left, q in hp.items())
    return Threat(tuple(f.unit.slot for f, _, _ in chosen), max_damage, round(expected, 2), round(death, 4))


def _forecast(f: Fighter, arm: Arm, me: Fighter, mine: Arm | None, distance: int, a_ground, d_ground):
    counter = mine if mine is not None and in_range(me, mine, distance, counter=True) else None
    return forecast_from(f, arm, me, counter, fight_stats(f, arm, me, counter, distance), a_ground=a_ground, d_ground=d_ground)
