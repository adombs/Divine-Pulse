"""Who fought whom between two reads, when the game's battle history can't be read.

Every fight adds one to both sides' Battles counter and one to the winner's Victories counter (fe3h.py), so the
counters say which units fought and who defeated someone, but not who fought whom when several fights land between
two reads (a skipped enemy phase, a slow read). This works it out:

1. Hard rules. Each unit that fought is in as many fights as its counter went up; a fight is between one of yours
   and another unit; a unit starts at most one fight (one action each per phase); the attacker could reach the
   target (start within its Mv plus weapon range, and end in range of it, or within Mv with Canto); units left with
   no HP fell in their last fight, and Victories went up for whoever beat them.
2. Every pairing that passes is scored by how likely its fights give each unit's HP change, with the combat math
   (combat.py) and its hit and crit chances. Enemies act in pool order on the enemy phase (seen in the game's history:
   ascending pool index). Linked allies aren't known, so the attacker's link bonus is averaged over a few levels.
   Weapon and spell uses spent must equal the hits landed with them (seen live: a miss spends nothing), which tells
   which weapon hit and how many times. Only when no pairing fits that way are mismatches allowed, at a cost: a
   combat art spends extra uses, and a read can catch a record between its HP and its uses being written (the
   fixture's raw reads did, for one read, 0.12 s; the tracker's samples need two reads in a row to agree, which
   should filter that out). A fight started by a unit that stayed put this turn on one that moved is less likely.
3. The best pairing is returned with a confidence for each fight: its share of the likelihood of every pairing that
   has it, so 1.0 means no other pairing could explain the reads.

When the map's terrain is known (Battle.terrain), each side's tile bonus is part of the combat math (the defender's
tile where it stood, the attacker's where it ended); otherwise a small allowance covers it (ARMY_ATK / OTHER_ATK).

When no pairing explains the reads exactly (combat arts, gambits, healing between the reads...), the pairings are
ranked by how close their expected damage comes instead, and marked approximate.
"""

from __future__ import annotations

import math
import time
from collections import Counter
from dataclasses import dataclass, replace
from itertools import combinations_with_replacement, permutations, product

from ..domain.combat import BattleUnit, Fight as Fight, Pairing as Pairing
from .combat import (
    CANTO, FLYING, Arm, CombatData, Fighter, Link, combat_data, fight_stats, forecast_from, in_range, link_options, linked_allies,
    max_range, outcomes,
)
from .terrain import Ground, ground

# Damage can differ from the model by a point or two that links don't explain: battalions (in the fixture Hanneman's
# Thoron did 1 more than the model plus his links) and, when the map's terrain isn't known, the tile under the target
# (forest +1 Def, sand -2 Def). Your units have battalions, other units rarely. With the target's tile known only the
# battalions are left (tile effects are the game's own, the import's data/terrain.json), plus a little for the unexpected.
ARMY_ATK = ((0, 0.75), (1, 0.12), (2, 0.05), (-1, 0.08))
OTHER_ATK = ((0, 0.9), (-1, 0.07), (2, 0.03))
ARMY_ATK_ON_KNOWN_TILE = ((0, 0.8), (1, 0.12), (2, 0.05), (-1, 0.03))
OTHER_ATK_ON_KNOWN_TILE = ((0, 0.96), (-1, 0.02), (1, 0.02))
LINK_HIT_STEP = 3  # link Hit/Avo bonuses are rounded to this to keep the cases few (they move chances, not damage)
MAX_ASSIGNMENTS = 4000  # pairings considered at most (a whole turn between two reads has far fewer)
MAX_ORDERS = 6  # orders of the player's fights tried per pairing (the likeliest first)
TIME_BUDGET_S = 2.0  # pairings not scored by then are left out (Pairing.partial)
# How much a pairing loses per weapon use that doesn't match its hits (see _Scorer._fit), and for a fight started by a
# unit that didn't move on one that did (_Scorer._direction_prior).
USES_LATE, USES_EXTRA = 0.1, 0.02
MAX_LATE = 4  # uses that can be late at most (one fight's hits)
OTHER = ("other", 0)  # any weapon whose uses didn't drop
MAX_STATES = 3000  # ways the fights could have gone kept per step (the likeliest)
TARGET_MOVED = 0.3
# One of your units starting a fight on the enemy phase (both reads in it): only a few skills do that. Without this, a
# unit that fought the same enemy on both phases had its counterattack taken for an attack of its own.
ARMY_ON_ENEMY_PHASE = 0.05






@dataclass
class _Unit:
    slot: int
    army: bool
    before: BattleUnit
    after: BattleUnit
    fighter: Fighter
    fights: int
    kills: int
    spent: dict[tuple[str, int], int]
    hp_known: bool  # HP only went down (no healing in between), so it must match exactly
    origin: tuple[int | None, int | None]  # where it stood when the turn began (else at the first read)


def _spent(before: BattleUnit, after: BattleUnit, data: CombatData) -> dict[tuple[str, int], int] | None:
    """Uses spent per weapon or spell since the last read. None if any came back (time was turned back)."""

    def uses(u: BattleUnit) -> Counter:
        c: Counter = Counter()
        for item, n in u.items:
            if item in data.weapons:
                c[("item", item)] += n
        for spell, n in zip(u.spells, u.spell_uses):
            if spell is not None and spell in data.spells:
                c[("spell", spell)] += n
        return c

    b, a = uses(before), uses(after)
    out = {}
    for key, n in b.items():
        if key not in a:
            continue  # traded away, or broke (a weapon at 0 uses is dropped)
        if a[key] > n:
            return None
        if n > a[key]:
            out[key] = n - a[key]
    return out


def _distance(p: BattleUnit, q: BattleUnit) -> int | None:
    if None in (p.x, p.y, q.x, q.y):
        return None
    return abs(p.x - q.x) + abs(p.y - q.y)  # type: ignore[operator]


def _fight_distances(att: _Unit, dfn: _Unit) -> set[int]:
    """How far apart the two could have been when `att` attacked `dfn` (empty: it couldn't have)."""
    a = att.fighter
    reach = max((max_range(a, arm) for arm in a.arms), default=0)
    if reach == 0:
        return set()
    canto = a.has(CANTO)
    out: set[int] = set()
    for target in {(dfn.before.x, dfn.before.y), (dfn.after.x, dfn.after.y)}:
        if None in target:
            continue
        start = _distance(att.before, _at(target))
        end = _distance(att.after, _at(target))
        if start is None or end is None:
            continue
        if start > a.mv + reach:
            continue
        if canto:
            out |= {d for d in range(1, reach + 1) if abs(end - d) <= a.mv}
        else:
            out.add(end)
    return {d for d in out if any(in_range(a, arm, d) for arm in a.arms)}


def _at(xy: tuple) -> BattleUnit:
    return BattleUnit(0, False, 1, 0, {"hp": 1}, x=xy[0], y=xy[1])


def pair_fights(
    before: list[BattleUnit],
    after: list[BattleUnit],
    data: CombatData | None = None,
    budget: float = TIME_BUDGET_S,
    origins: dict[int, tuple[int, int]] | None = None,
    enemy_phase: bool = False,
    terrain: list[list[int]] | None = None,
) -> Pairing | None:
    """The fights between two reads of the battle pool. None if the reads can't be compared (time was turned back,
    or HP and positions aren't read). `origins`: where units stood when the turn began, by slot (a unit that moved
    this turn is likelier to have started a fight than one that didn't, even if it moved before the first read).
    `enemy_phase`: both reads are on the enemy phase (see enemy_phase_began), so your units didn't start fights.
    `terrain`: the map's terrain IDs (rows of tiles, Battle.terrain), to use each tile's real bonuses."""
    data = data or combat_data()
    army_characters = {u.character for u in after if u.army}
    old = {u.slot: u for u in before}
    units: dict[int, _Unit] = {}
    for u in after:
        if not u.army and u.character in army_characters:
            continue  # the pool's second record of one of your units
        b = old.get(u.slot)
        if b is None or b.character != u.character:
            continue
        if u.hp is None or b.hp is None or u.combats < b.combats or u.victories < b.victories:
            return None
        if u.combats == b.combats:
            continue
        spent = _spent(b, u, data)
        if spent is None:
            return None
        fighter = Fighter.from_unit(b, data)
        origin = (origins or {}).get(u.slot, (b.x, b.y))
        units[u.slot] = _Unit(u.slot, u.army, b, u, fighter, u.combats - b.combats, u.victories - b.victories, spent, u.hp <= b.hp, origin)
    if not units:
        return Pairing((), True)
    options = {
        (i, j): ds for i in units for j in units if units[i].army != units[j].army and (ds := _fight_distances(units[i], units[j]))
    }
    assignments = _assignments(units, options)
    if not assignments:
        return Pairing((), False)
    allies = [(u.slot, Fighter.from_unit(u, data), u.x, u.y) for u in after if u.army and u.hp and u.x is not None and u.y is not None]
    scorer = _Scorer(units, options, allies, terrain)
    scorer.enemy_phase = enemy_phase
    deadline = time.monotonic() + budget
    # The closest by expected damage first, so a search cut short by the time budget has the likeliest ones.
    assignments.sort(key=scorer.approximate, reverse=True)
    # Weapon and spell uses spent must equal the hits landed with them; only if no pairing explains the reads that way
    # (a combat art, or a read caught between a record's HP and uses being written) are they let off.
    for strict in (True, False):
        scorer.strict = strict
        scored = []
        for a in assignments:
            if time.monotonic() > deadline:
                break
            scored.append((a, *scorer.exact(a, deadline)))
        partial = len(scored) < len(assignments)
        total = sum(s for _, s, _ in scored)
        if total > 0:
            break
    exact = total > 0
    if not exact:
        scored = [(a, scorer.approximate(a), None) for a in assignments]
        total = sum(s for _, s, _ in scored)
        partial = False
    if total <= 0:
        return Pairing((), False, len(assignments))
    best, _, path = max(scored, key=lambda t: t[1])
    share: Counter = Counter()
    for a, s, _ in scored:
        for edge in set(a):
            share[edge] += s / total
    fights = []
    for n, (i, j) in enumerate(best):
        if path is not None:
            a_lost, d_lost, fell = path[n]
        else:
            a_lost, d_lost, fell = scorer.split(best, n)
        fights.append(Fight(i, j, a_lost, d_lost, fell, round(min(1.0, share[(i, j)]), 3)))
    return Pairing(tuple(fights), exact, len(assignments), partial)


def _assignments(units: dict[int, _Unit], options: dict[tuple[int, int], set[int]]) -> list[tuple[tuple[int, int], ...]]:
    """Every set of fights (attacker, defender) that gives each unit its number of fights, each unit starting at
    most one."""
    order = sorted(units, key=lambda s: (not units[s].army, s))
    out: list[tuple[tuple[int, int], ...]] = []

    def go(k: int, left: dict[int, int], started: frozenset[int], edges: tuple[tuple[int, int], ...]) -> None:
        if len(out) >= MAX_ASSIGNMENTS:
            return
        while k < len(order) and left[order[k]] == 0:
            k += 1
        if k == len(order):
            out.append(tuple(sorted(edges)))
            return
        u = order[k]
        choices = sorted(
            {(u, v) for v in units if (u, v) in options and left[v] > 0} | {(v, u) for v in units if (v, u) in options and left[v] > 0}
        )
        for picked in combinations_with_replacement(choices, left[u]):
            starters = [e[0] for e in picked]
            if len(set(starters)) != len(starters) or any(s in started for s in starters):
                continue
            need = Counter(e[1] if e[0] == u else e[0] for e in picked)
            if any(left[v] < n for v, n in need.items()):
                continue
            rest = dict(left)
            rest[u] = 0
            for v, n in need.items():
                rest[v] -= n
            go(k + 1, rest, started | set(starters), edges + picked)

    go(0, {s: u.fights for s, u in units.items()}, frozenset(), ())
    return list(dict.fromkeys(out))


class _Scorer:
    def __init__(self, units: dict[int, _Unit], options: dict[tuple[int, int], set[int]], allies: list | None = None, terrain: list[list[int]] | None = None):
        self.units = units
        self.terrain = terrain
        self.options = options
        self.allies = allies or []  # your units on the map: (slot, Fighter, x, y)
        self._link_cache: dict[tuple[int, int], tuple[tuple[Link, float], ...]] = {}
        self._index: dict[tuple, dict[tuple, list]] = {}
        self.strict = True  # uses spent must equal hits exactly (else _fit's penalties)
        self.enemy_phase = False
        self._cache: dict[tuple, dict[tuple, float]] = {}

    def _fight(self, i: int, j: int, hp_i: int, hp_j: int) -> dict[tuple, float]:
        """Outcomes of `i` attacking `j` from these HPs: (lost_i, lost_j, (arm key, hits) of i, of j) -> chance,
        averaged over the distances, weapons and link levels possible."""
        key = (i, j, hp_i, hp_j)
        if key in self._cache:
            return self._cache[key]
        a, d = self.units[i].fighter, self.units[j].fighter
        a, d = _with_hp(a, hp_i), _with_hp(d, hp_j)
        result: dict[tuple, float] = {}
        cases = []
        for dist in sorted(self.options[(i, j)]):
            arms = [arm for arm in a.arms if in_range(a, arm, dist)]
            # Which weapon the defender has equipped isn't read: any of them (or none).
            d_arms: list[Arm | None] = list(d.arms) or [None]
            cases += [(dist, arm, d_arm) for arm in arms for d_arm in d_arms]
        if not cases:
            self._cache[key] = result
            return result
        weight = 1 / len(cases)
        spent_i, spent_j = self.units[i].spent, self.units[j].spent

        def used(arm: Arm, hits: int, spent: dict) -> tuple | None:
            # Hits with a weapon whose uses didn't drop all count the same (see _fit): one state for them.
            return None if not hits else (arm.key if arm.key in spent else OTHER, hits)

        links, d_links = self._links(i, j), self._defender_links(j, i)
        a_ground, d_ground = self._ground(i, attacking=True), self._ground(j, attacking=False)
        for dist, arm, d_arm in cases:
            stats = fight_stats(a, arm, d, d_arm, dist)
            for (link, p_link), (d_link, p_d) in product(links, d_links):
                fc = forecast_from(a, arm, d, d_arm, stats, link, d_link, a_ground or Ground(), d_ground or Ground())
                for o, p in outcomes(fc, hp_i, hp_j).items():
                    k = (o.a_lost, o.d_lost, used(arm, o.a_hits, spent_i), used(d_arm, o.d_hits, spent_j) if d_arm else None)
                    result[k] = result.get(k, 0.0) + p * p_link * p_d * weight
        self._cache[key] = result
        return result

    def _matching(self, i: int, j: int, hp_i: int, hp_j: int, lost_i: int | None, lost_j: int | None) -> list[tuple[tuple, float]]:
        """The outcomes of `i` attacking `j` (_fight) where each side lost what's asked (None: anything)."""
        key = (i, j, hp_i, hp_j)
        index = self._index.get(key)
        if index is None:
            index = {}
            for item in self._fight(i, j, hp_i, hp_j).items():
                li, lj = item[0][0], item[0][1]
                for k in ((li, lj), (li, None), (None, lj), (None, None)):
                    index.setdefault(k, []).append(item)
            self._index[key] = index
        return index.get((lost_i, lost_j), [])

    def _links(self, i: int, j: int) -> tuple[tuple[Link, float], ...]:
        """What `i` might have had on top of the model attacking `j`, with chances: its linked allies (none on the
        enemy phase) and ARMY_ATK / OTHER_ATK."""
        known = self._ground(j, attacking=False) is not None
        if not self.units[i].army:
            return tuple((Link(extra), p) for extra, p in (OTHER_ATK_ON_KNOWN_TILE if known else OTHER_ATK))
        key = (i, j)
        if key not in self._link_cache:
            target = self.units[j].before
            linked = linked_allies(i, (target.x, target.y), self.allies) if target.x is not None and target.y is not None else []
            allowance = ARMY_ATK_ON_KNOWN_TILE if known else ARMY_ATK
            options = [(replace(link, atk=link.atk + extra), p * q) for link, p in link_options(self.units[i].fighter, linked) for extra, q in allowance]
            self._link_cache[key] = _merge(options)
        return self._link_cache[key]

    def _defender_links(self, j: int, i: int | None = None) -> tuple[tuple[Link, float], ...]:
        """The same for `j`'s counterattacks on `i` (None: on a tile not known)."""
        known = i is not None and self._ground(i, attacking=True) is not None
        if self.units[j].army:
            allowance = ARMY_ATK_ON_KNOWN_TILE if known else ARMY_ATK
        else:
            allowance = OTHER_ATK_ON_KNOWN_TILE if known else OTHER_ATK
        return tuple((Link(extra), p) for extra, p in allowance)

    def _ground(self, slot: int, attacking: bool) -> Ground | None:
        """What the tile `slot` fought on added to it (nothing for fliers), or None when that tile isn't known: no
        terrain, or the unit moved and where it stood when it fought can't be told (a defender that also acted, an
        attacker with Canto, which moves on after attacking)."""
        if not self.terrain:
            return None
        u = self.units[slot]
        moved = (u.before.x, u.before.y) != (u.after.x, u.after.y)
        if moved and (not attacking or u.fighter.has(CANTO)):
            return None
        x, y = (u.after.x, u.after.y) if attacking else (u.before.x, u.before.y)
        if x is None or y is None or not (0 <= y < len(self.terrain) and 0 <= x < len(self.terrain[y])):
            return None
        return ground(self.terrain[y][x], flying=FLYING in u.fighter.moves)

    def _orders(self, assignment: tuple[tuple[int, int], ...]) -> list[list[tuple[int, int]]]:
        """Orders the fights could have happened in: the enemy phase in pool order; your fights in any order (only
        fights on the same unit need trying both ways), before or after the enemy phase."""
        yours = [e for e in assignment if self.units[e[0]].army]
        theirs = sorted((e for e in assignment if not self.units[e[0]].army), key=lambda e: e[0])
        groups: dict[int, list[tuple[int, int]]] = {}
        for e in yours:
            groups.setdefault(e[1], []).append(e)
        # The likeliest order first: whoever got a victory last on its target.
        per_group = [list(permutations(sorted(g, key=lambda e: (self.units[e[0]].kills > 0, e[0])))) for g in groups.values()]
        orders = []
        for combo in product(*per_group):
            mine = [e for g in combo for e in g]
            orders.append(mine + theirs)
            if mine and theirs:
                orders.append(theirs + mine)
            if len(orders) >= MAX_ORDERS:
                break
        return orders or [[]]

    def exact(self, assignment: tuple[tuple[int, int], ...], deadline: float = math.inf) -> tuple[float, list[tuple[int, int, int | None]] | None]:
        """Chance of the reads given these fights (averaged over the orders tried), and the likeliest HP loss in each
        fight, in assignment order."""
        units = self.units
        slots = sorted(units)
        index = {s: n for n, s in enumerate(slots)}
        total, best_p, best_path = 0.0, 0.0, None
        orders = self._orders(assignment)
        for order in orders:
            # State: per unit (hp, hits by arm, kills), with the chance of reaching it and its likeliest path.
            start = tuple((units[s].before.hp or 0, (), 0) for s in slots)
            states: dict[tuple, tuple[float, float, tuple]] = {start: (1.0, 1.0, ())}
            last = {s: n for n, edge in enumerate(order) for s in edge}
            for step_no, (i, j) in enumerate(order):
                ni, nj = index[i], index[j]
                ui, uj = units[i], units[j]
                final_i, final_j = last[i] == step_no, last[j] == step_no
                nxt: dict[tuple, tuple[float, float, tuple]] = {}
                for state, (p, bp, path) in states.items():
                    (hp_i, h_i, k_i), (hp_j, h_j, k_j) = state[ni], state[nj]
                    if hp_i <= 0 or hp_j <= 0:
                        continue
                    # A unit's last fight must leave it as the second read shows it: only those outcomes.
                    need_i = hp_i - (ui.after.hp or 0) if final_i and ui.hp_known else None
                    need_j = hp_j - (uj.after.hp or 0) if final_j and uj.hp_known else None
                    for (lost_i, lost_j, hits_i, hits_j), q in self._matching(i, j, hp_i, hp_j, need_i, need_j):
                        left_i, left_j = hp_i - lost_i, hp_j - lost_j
                        ki, kj = k_i + (left_j <= 0), k_j + (left_i <= 0)
                        if ki > ui.kills or kj > uj.kills:
                            continue
                        if not (_settled(ui, left_i, ki) if final_i else left_i > 0):
                            continue
                        if not (_settled(uj, left_j, kj) if final_j else left_j > 0):
                            continue
                        hi, hj = _add(h_i, hits_i), _add(h_j, hits_j)
                        late = 0 if self.strict else MAX_LATE
                        if (hits_i and hi[hits_i[0]] > ui.spent.get(hits_i[0], 0) + late) or (
                            hits_j and hj[hits_j[0]] > uj.spent.get(hits_j[0], 0) + late
                        ):
                            continue
                        new = list(state)
                        new[ni] = (left_i, tuple(sorted(hi.items())) if hits_i else h_i, ki)
                        new[nj] = (left_j, tuple(sorted(hj.items())) if hits_j else h_j, kj)
                        key = tuple(new)
                        fell = j if left_j <= 0 else i if left_i <= 0 else None
                        step = path + (((i, j), lost_i, lost_j, fell),)
                        np_, nbp = p * q, bp * q
                        old = nxt.get(key)
                        if old is None:
                            nxt[key] = (np_, nbp, step)
                        elif nbp > old[1]:
                            nxt[key] = (old[0] + np_, nbp, step)
                        else:
                            nxt[key] = (old[0] + np_, old[1], old[2])
                if len(nxt) > MAX_STATES:  # keep the likeliest
                    nxt = dict(sorted(nxt.items(), key=lambda kv: -kv[1][0])[:MAX_STATES])
                states = nxt
                if not states or time.monotonic() > deadline:
                    break
            if time.monotonic() > deadline:
                return 0.0, None
            for state, (p, bp, path) in states.items():
                fit = 1.0
                for s, (hp, hits, kills) in zip(slots, state):
                    fit *= self._fit(s, hp, dict(hits), kills)
                    if fit == 0:
                        break
                if fit:
                    total += p * fit / len(orders)
                    if bp * fit > best_p:
                        best_p, best_path = bp * fit, path
        if best_path is None:
            return 0.0, None
        total *= self._direction_prior(assignment)
        by_edge: dict[tuple[int, int], list[tuple[int, int, int | None]]] = {}
        for edge, lost_i, lost_j, fell in best_path:
            by_edge.setdefault(edge, []).append((lost_i, lost_j, fell))
        return total, [by_edge[e].pop(0) for e in assignment]

    def _fit(self, slot: int, hp: int, hits: dict, kills: int) -> float:
        """How well a unit's end state fits the second read: 0 if it can't be, less than 1 if only its uses differ."""
        u = self.units[slot]
        after = u.after.hp or 0
        if u.hp_known and max(0, hp) != after:
            return 0.0
        if (hp <= 0) != (after <= 0) or kills != u.kills:
            return 0.0
        if self.strict:
            return 1.0 if all(u.spent.get(k, 0) == hits.get(k, 0) for k in set(hits) | set(u.spent)) else 0.0
        fit = 1.0
        for key in set(hits) | set(u.spent):
            diff = u.spent.get(key, 0) - hits.get(key, 0)
            # Fewer spent than hit: the record's uses are written a moment after its HP (seen live: one read later).
            # More spent: a combat art, or uses from an earlier fight showing late.
            fit *= USES_LATE ** -diff if diff < 0 else USES_EXTRA**diff
        return fit

    def _direction_prior(self, assignment: tuple[tuple[int, int], ...]) -> float:
        """Units that moved between the reads are usually the ones that acted: a fight started by a unit that stayed put
        on one that moved is less likely (the target would have had to move on an action of its own first)."""
        prior = 1.0
        for i, j in assignment:
            if not _moved(self.units[i]) and _moved(self.units[j]):
                prior *= TARGET_MOVED
            if self.enemy_phase and self.units[i].army:
                prior *= ARMY_ON_ENEMY_PHASE
        return prior

    def _expected(self, assignment: tuple[tuple[int, int], ...]) -> tuple[dict[int, float], dict[int, float]]:
        lost: dict[int, float] = {s: 0.0 for s in self.units}
        var: dict[int, float] = {s: 0.0 for s in self.units}
        for i, j in assignment:
            dist = self._fight(i, j, self.units[i].before.hp or 1, self.units[j].before.hp or 1)
            for side, idx in ((i, 0), (j, 1)):
                mean = sum(k[idx] * p for k, p in dist.items())
                lost[side] += mean
                var[side] += sum((k[idx] - mean) ** 2 * p for k, p in dist.items())
        return lost, var

    def approximate(self, assignment: tuple[tuple[int, int], ...]) -> float:
        """How close the fights' expected damage comes to each unit's HP change (a Gaussian score)."""
        lost, var = self._expected(assignment)
        score = 0.0
        for s, u in self.units.items():
            if not u.hp_known:
                continue
            seen = (u.before.hp or 0) - (u.after.hp or 0)
            score -= (seen - lost[s]) ** 2 / (2 * (var[s] + 9))
        return math.exp(score) * self._direction_prior(assignment)

    def split(self, assignment: tuple[tuple[int, int], ...], n: int) -> tuple[int, int, int | None]:
        """HP lost on each side of fight `n` when only the totals are known: each unit's loss shared out by the fights'
        expected damage."""
        i, j = assignment[n]
        out = []
        for side in (i, j):
            seen = max(0, (self.units[side].before.hp or 0) - (self.units[side].after.hp or 0))
            shares = []
            for k, (p, q) in enumerate(assignment):
                if side in (p, q):
                    dist = self._fight(p, q, self.units[p].before.hp or 1, self.units[q].before.hp or 1)
                    shares.append((k, sum(key[0 if side == p else 1] * c for key, c in dist.items())))
            total = sum(s for _, s in shares) or len(shares)
            mine = next(s for k, s in shares if k == n) if total else 1
            out.append(round(seen * (mine / total if total else 1 / len(shares))))
        fell = None
        for side in (j, i):
            u = self.units[side]
            if u.after.hp == 0 and (u.before.hp or 0) > 0 and max(k for k, (p, q) in enumerate(assignment) if side in (p, q)) == n:
                fell = side
                break
        return out[0], out[1], fell


def _merge(options: list[tuple[Link, float]]) -> tuple[tuple[Link, float], ...]:
    """Options with the same Atk and Hit/Avo (rounded to LINK_HIT_STEP) as one; the unlikeliest dropped."""
    merged: dict[tuple[int, int], float] = {}
    for link, p in options:
        key = (link.atk, round(link.hit / LINK_HIT_STEP) * LINK_HIT_STEP)
        merged[key] = merged.get(key, 0.0) + p
    kept = [(Link(atk, hit, hit), p) for (atk, hit), p in merged.items() if p >= 0.005]
    total = sum(p for _, p in kept)
    return tuple((link, p / total) for link, p in kept)


def _add(hits: tuple, landed: tuple | None) -> dict:
    d = dict(hits)
    if landed:
        d[landed[0]] = d.get(landed[0], 0) + landed[1]
    return d


def _settled(u: _Unit, hp: int, kills: int) -> bool:
    """After its last fight a unit must be as the second read shows it: HP (unless it was healed too), alive or not,
    and its victories."""
    after = u.after.hp or 0
    if (hp <= 0) != (after <= 0) or kills != u.kills:
        return False
    return not u.hp_known or max(0, hp) == after


def enemy_phase_began(before: list[BattleUnit], after: list[BattleUnit]) -> bool:
    """Whether the enemy phase began between two reads of the same turn: your units' acted flags (set once a unit's
    action is over) were cleared, as they are when a phase begins."""
    return any(u.acted for u in before if u.army) and not any(u.acted for u in after if u.army and u.acted is not None)


def _moved(u: _Unit) -> bool:
    return u.origin != (u.after.x, u.after.y)


def _with_hp(f: Fighter, hp: int) -> Fighter:
    return replace(f, hp=hp)
