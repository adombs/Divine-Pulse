"""Estimated chance of winning the battle in progress.

A transparent heuristic, not a simulation: a few factors are added up and squashed into 3-97% with a logistic
curve. Each factor is reported with how many percentage points it moves the estimate, so the page can show why.

Units at risk of falling weigh the most: one whose loss loses the battle (Byleth, a house leader) takes the estimate
near the bottom; others cost less, since the battle goes on without them.

The estimate compares remaining HP and strength on both sides. It also accounts for progress, losses and level-ups.
"""

from __future__ import annotations

import heapq
import math

from .battle import CRITICAL, Battle

BASE = 0.6  # the player usually wins: a battle starts in their favour
STRENGTH_WEIGHT = 1.2
# A map is about even when the other units add up to this many times the army's strength: the player picks the
# fights, and enemies come a few at a time. (Seen live: an ordinary Hard map started at 3.1x.)
STRENGTH_PAR = 3.0
PROGRESS_WEIGHT = 2.5
LOSS_WEIGHT = 2.5
LEVEL_UP_WEIGHT = 0.05
LEVEL_UP_CAP = 0.4
HEALTH_WEIGHT = 3.0
CRITICAL_WEIGHT = 6.0  # enough to take any battle to the bottom of the scale

# Units at risk of falling: low on HP with other units in reach. One whose loss loses the battle (CRITICAL) weighs
# almost as much as having lost it; the others cost less, since the battle goes on without them.
# "In reach" is walked, not measured: another unit reaches one of yours when it can move (MOVE, through terrain and
# past its own side, never through yours) to a free tile from which its weapon hits it (melee 1, bows 2, magic 1-2).
# A unit boxed in by others can't be hit by melee at all.
MOVE = 5  # most units move 4-6
WEAPON_RANGE = {"bow": (2, 2), "reason": (1, 2), "faith": (1, 2), "dark": (1, 2)}  # anything else: (1, 1)
MOVE_COST = {"Forest": 2, "Sand": 2, "Shoal / snow": 2, "Thicket": 3, "Wasteland": 2, "Swamp / flames / crater": 2}
DANGER_HP = 0.35  # share of max HP: in danger with another unit in reach
EXPOSED_HP = 0.6  # exposed with another unit in reach
CROWD = 3  # exposed whatever its HP with this many in reach
RISK_WEIGHT = {(True, "danger"): 4.0, (True, "exposed"): 1.8, (False, "danger"): 0.7, (False, "exposed"): 0.3}
RISK_CAP = 2.0  # the most units that aren't critical can take off together

LOW, HIGH = 0.03, 0.97


def _chance(score: float) -> float:
    return min(HIGH, max(LOW, 1 / (1 + math.exp(-score))))


def _costs(battle: Battle) -> tuple[int, int, dict[tuple[int, int], int] | None]:
    """The map's size and, with its terrain known, what entering each tile costs on foot (impassable tiles left out)."""
    if not battle.terrain:
        return battle.map_w or 32, battle.map_h or 32, None
    costs: dict[tuple[int, int], int] = {}
    for y, row in enumerate(battle.terrain):
        for x, tile_id in enumerate(row):
            t = battle.terrain_tiles.get(tile_id)
            if t is None:
                costs[x, y] = 1
            elif t.enter == "all":
                costs[x, y] = MOVE_COST.get(t.effect, 1)
    return max((len(r) for r in battle.terrain), default=0), len(battle.terrain), costs


def _threats(battle: Battle) -> dict[tuple[int, int], int] | None:
    """How many other units can reach each tile with an attack this enemy phase (None: positions not read)."""
    others = [
        e
        for e in battle.enemy_stats.values()
        if e.on_map and e.x is not None and e.y is not None and (e.hp is None or e.hp > 0)
    ]
    if not others:
        return None
    w, h, costs = _costs(battle)
    mine = {
        (u.x, u.y)
        for u in battle.units
        if u.on_map and u.x is not None and u.y is not None and (u.hp is None or u.hp > 0)
    }
    theirs = {(e.x, e.y) for e in others}
    hits: dict[tuple[int, int], int] = {}
    for e in others:
        start = (e.x, e.y)
        best = {start: 0}
        todo = [(0, start)]
        while todo:
            spent, (x, y) = heapq.heappop(todo)
            if spent > best.get((x, y), MOVE + 1):
                continue
            for nxt in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if not (0 <= nxt[0] < w and 0 <= nxt[1] < h) or nxt in mine:
                    continue
                step = 1 if costs is None else costs.get(nxt)
                if step is None or spent + step > MOVE or spent + step >= best.get(nxt, MOVE + 1):
                    continue
                best[nxt] = spent + step
                heapq.heappush(todo, (spent + step, nxt))
        lo, hi = WEAPON_RANGE.get(e.weapon, (1, 1))
        reached: set[tuple[int, int]] = set()
        for x, y in best:
            if (x, y) != start and (x, y) in theirs:
                continue  # it can pass its own side but not stop on them
            for dx in range(-hi, hi + 1):
                for dy in range(-hi, hi + 1):
                    if lo <= abs(dx) + abs(dy) <= hi:
                        reached.add((x + dx, y + dy))
        for tile in reached:
            hits[tile] = hits.get(tile, 0) + 1
    return hits


def at_risk(battle: Battle) -> list[dict]:
    """Army units on the map that could fall: {"key", "name", "hp", "max_hp", "near", "level", "critical"}, most at
    risk first. `level` is "danger" or "exposed"; `near` is how many other units are in reach (None: positions not
    read, judged by HP alone)."""
    threats = _threats(battle)
    out = []
    for u in battle.units:
        max_hp = u.now.get("hp", 0)
        if not u.on_map or u.hp is None or u.hp <= 0 or not max_hp:
            continue
        share = u.hp / max_hp
        near = threats.get((u.x, u.y), 0) if u.x is not None and u.y is not None and threats is not None else None
        threatened = near is None or near > 0
        if threatened and share <= DANGER_HP:
            level = "danger"
        elif (threatened and share <= EXPOSED_HP) or (near or 0) >= CROWD:
            level = "exposed"
        else:
            continue
        out.append(
            {
                "key": u.key,
                "name": u.name,
                "hp": u.hp,
                "max_hp": max_hp,
                "near": near,
                "level": level,
                "critical": u.key in CRITICAL,
            }
        )
    return sorted(out, key=lambda r: (not r["critical"], r["level"] != "danger", r["hp"] / r["max_hp"]))


def _risk_text(r: dict) -> str:
    near = "" if r["near"] is None else f", {r['near']} in reach"
    return f"{r['name']} {r['hp']}/{r['max_hp']} HP{near}"


def factors(battle: Battle) -> list[tuple[str, float, str]]:
    """(label, score contribution, explanation) for each factor that applies."""
    out: list[tuple[str, float, str]] = []
    if battle.army_hp is not None and battle.army_max_hp and battle.enemy_hp is not None and battle.enemy_max_hp:
        mine, theirs = battle.army_hp / battle.army_max_hp, battle.enemy_hp / battle.enemy_max_hp
        out.append(
            (
                "Health",
                HEALTH_WEIGHT * (mine - theirs),
                f"Your units have {mine:.0%} of their HP, the other units {theirs:.0%}",
            )
        )
    if battle.enemy_power > 0 and battle.army_power > 0:
        ratio = battle.army_power / battle.enemy_power
        edge = min(10.0, max(0.1, ratio * STRENGTH_PAR))
        out.append(
            (
                "Strength",
                STRENGTH_WEIGHT * math.log(edge),
                f"The other units on the map have {1 / ratio:.1f}× your army's strength (about {STRENGTH_PAR:.0f}× is an even map)",
            )
        )
    if battle.enemies_start > 0:
        cleared = 1 - battle.enemies_now / battle.enemies_start
        if cleared:
            out.append(
                (
                    "Progress",
                    PROGRESS_WEIGHT * cleared,
                    f"{battle.enemies_start - battle.enemies_now} of {battle.enemies_start} other units gone from the map",
                )
            )
    deployed = len(battle.units)
    lost = sum(1 for u in battle.units if not u.on_map)
    critical = [u.name for u in battle.units if not u.on_map and u.key in CRITICAL]
    if critical:
        out.append(
            ("Defeat", -CRITICAL_WEIGHT, f"{' and '.join(critical)} left the battle: losing them loses the battle")
        )
    risks = at_risk(battle)
    leaders = [r for r in risks if r["critical"]]
    if leaders:
        score = sum(RISK_WEIGHT[True, r["level"]] for r in leaders)
        out.append(
            ("Defeat risk", -score, f"Losing them loses the battle: {'; '.join(_risk_text(r) for r in leaders)}")
        )
    rest = [r for r in risks if not r["critical"]]
    if rest:
        score = min(RISK_CAP, sum(RISK_WEIGHT[False, r["level"]] for r in rest))
        out.append(("At risk", -score, "; ".join(_risk_text(r) for r in rest)))
    if deployed and lost:
        out.append(("Losses", -LOSS_WEIGHT * lost / deployed, f"{lost} of {deployed} units no longer on the map"))
    if battle.level_ups:
        out.append(
            (
                "Momentum",
                min(LEVEL_UP_CAP, LEVEL_UP_WEIGHT * battle.level_ups),
                f"{battle.level_ups} level-up{'s' if battle.level_ups != 1 else ''} so far",
            )
        )
    return out


def outlook(battle: Battle) -> dict:
    """{"chance": 0-1, "confidence": "low" | "medium", "factors": [{"label", "points", "detail"}], "at_risk": [...]}.

    `points` is how much the factor moves the chance, in percentage points (with every other factor kept)."""
    parts = factors(battle)
    total = BASE + sum(score for _, score, _ in parts)
    chance = _chance(total)
    return {
        "chance": round(chance, 3),
        # Without current HP the estimate can't see how hurt either side is.
        "confidence": "medium" if battle.army_hp is not None and battle.enemy_hp is not None else "low",
        "factors": [
            {"label": label, "points": round((chance - _chance(total - score)) * 100, 1), "detail": detail}
            for label, score, detail in parts
        ],
        "at_risk": at_risk(battle),
    }
