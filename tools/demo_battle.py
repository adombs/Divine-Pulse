"""Run the tracker with a scripted battle, to see the Battle page without playing.

Starts the app on a throwaway data folder (your real data isn't touched) with a "Demo" run of Golden Deer units and
a battle that plays out by itself: units move, attack, cast, heal, level up, a Divine Pulse turns back time, other
units are defeated, one of yours leaves the battle, and the battle ends and is filed in the history. Then another
one starts.

The scripted battle includes current HP, positions, the turn and Divine Pulse charges, a made-up terrain map (drawn
by hand below, not taken from the game) and keeps a history like the game's (the list behind the Divine Pulse screen),
which the action log and the damage, healing and movement stats come from.

Dev-only. It needs an import of your own game (the Game files page, or `python -m app.gamefiles extract`), found where
the app keeps it or in DIVINE_PULSE_GAME_ASSETS:

    python tools/demo_battle.py [--port 8799] [--step 3]

then open http://127.0.0.1:8799/#/battle (from the Roster, the app switches to it when the battle starts).
"""

from __future__ import annotations

import argparse
import copy
import json
import random
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import uvicorn  # noqa: E402

from app.inventory import art_name  # noqa: E402
from app.infrastructure.paths import GAME_ASSETS_DIR  # noqa: E402
from app.battle import STEP_ATTACK, STEP_ITEM, STEP_SPELL, ArmySample, BattleSample, EnemySample, HistoryStep, StepUnit, power  # noqa: E402
from app.main import create_app  # noqa: E402
from app.domain.units import Unit  # noqa: E402

KEYS = ("hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha", "mv")
# name, class, level, stats in KEYS order, spell uses, weapon (item ID, uses)
ARMY = [
    ("Byleth", "Enlightened One", 22, (52, 30, 18, 28, 27, 21, 21, 15, 22, 6), (), (37, 24)),
    ("Claude", "Wyvern Rider", 21, (46, 28, 12, 31, 26, 14, 18, 10, 20, 7), (), (110, 30)),
    ("Lorenz", "Dark Knight", 20, (44, 20, 27, 18, 16, 10, 16, 21, 15, 7), (5, 3), (12, 20)),
    ("Raphael", "Grappler", 20, (60, 34, 5, 20, 15, 9, 20, 4, 9, 5), (), (170, 6)),
    ("Ignatz", "Sniper", 19, (38, 24, 10, 30, 24, 22, 11, 9, 12, 5), (), (102, 40)),
    ("Lysithea", "Gremory", 21, (33, 6, 38, 20, 24, 6, 7, 20, 15, 5), (6, 3, 2), ()),
    ("Marianne", "Holy Knight", 20, (37, 10, 30, 14, 18, 15, 10, 26, 18, 7), (8, 4, 2), ()),
    ("Hilda", "Wyvern Lord", 20, (48, 31, 6, 22, 21, 11, 21, 12, 14, 8), (), (130, 30)),
]
# The spell in each spell slot (game spell IDs, the import's spells.json), for the units' inventories.
SPELL_IDS = {"Lorenz": (0, 1), "Lysithea": (0, 4, 1), "Marianne": (29, 24, 26)}
FOES = [("Wyvern Rider", 19, 44)] * 4 + [("Sniper", 18, 36)] * 3 + [("Warlock", 18, 32)] * 2 + [("Fortress Knight", 20, 58)] * 3
# Villagers (generic Commoners and a Noble, unarmed), along the bottom edge.
FOES += [("Commoner", 5, 20)] * 2 + [("Noble", 6, 22)]
FOE_TILES = {12: (13, 13), 13: (15, 13), 14: (17, 13)}
# What they carry: items as (item ID, uses), and spells as (spell ID, uses).
FOE_ITEMS = {"Wyvern Rider": ((29, 25),), "Sniper": ((35, 30), (1000, 2)), "Fortress Knight": ((23, 25),)}
FOE_SPELLS = {"Warlock": ((0, 8), (3, 6))}
FOE_WEAPONS = {"Wyvern Rider": "axe", "Sniper": "bow", "Warlock": "reason", "Fortress Knight": "lance"}  # their map icons
FOE_CLASS_IDS = {"Wyvern Rider": 24, "Sniper": 26, "Warlock": 28, "Fortress Knight": 21, "Noble": 0, "Commoner": 1}  # the game's, for their sprites
# A few of the others in other armies (by FOES index), and some women, to show every sprite colour.
FOE_SIDES = {7: "ally", 8: "ally", 11: "third"}
FOE_WOMEN = {1, 5, 8, 13}
NAMED_FOES = {10: ("Seteth", 26)}  # a character of his own among the others (name, game character ID)
# The army's game IDs, for their sprites: class, character, and whether she's female.
ARMY_IDS = {
    "Byleth": (42, 0, False), "Claude": (24, 4, False), "Lorenz": (36, 19, False), "Raphael": (27, 20, False),
    "Ignatz": (26, 21, False), "Lysithea": (39, 22, True), "Marianne": (37, 23, True), "Hilda": (32, 24, True),
}
VULNERARY = 1000
# The scripted map, one letter per tile (terrain IDs as in the import's data/terrain.json): . plain, , grassland,
# f forest, t thicket, s sand, ~ river, = bridge, ^ cliff, # wall, F stronghold, + heal tile, w swamp.
TERRAIN_ART = """
^^^^^^^^^^^^^^^^^^^^
^^..,,ff..##.##..^^^
^...,fff..#F..#...^^
....,ff...#....#...^
..+.......#.##.#....
...t......~~=~~~~...
..ttt..~~~~...ww....
...t..~~ss=...www...
......~.ssss....f...
.,,...=..ss....fff..
.,,,..~.......fff...
......~~~......f..+.
..ff....~~~~=~~~....
.ffff.........,,,...
""".strip().splitlines()
TERRAIN_IDS = {".": 2, ",": 1, "f": 3, "t": 24, "s": 5, "~": 6, "=": 10, "^": 37, "#": 13, "F": 22, "+": 18, "w": 28}
TERRAIN = tuple(tuple(TERRAIN_IDS[c] for c in row) for row in TERRAIN_ART)
MAP_W, MAP_H = len(TERRAIN[0]), len(TERRAIN)  # the scripted map's size in tiles
BLOCKED = {6, 13, 37}  # river, wall, cliff: only fliers (or nobody) can stand there
MAP_ID = None  # --map: a real map from the import instead of the scripted one
FLIERS = {"Wyvern Rider", "Wyvern Lord"}
HEAL, WARD = 24, 34  # spell IDs (the import's spells.json); a staff's history entry names its spell
# Equipped combat arts by name (art IDs, the import's combat-arts.json); every third attack uses the first one, which
# costs 3 uses of its weapon here. Byleth rallies (Rally Speed) every fifth action.
ARTS = {"Byleth": (7, 1), "Claude": (30, 36), "Raphael": (20,), "Ignatz": (38, 30), "Hilda": (21, 10), "Lorenz": (10, 19)}
ART_COST = 3
RALLY, RALLY_SPEED = 0x17, 107


class Demo:
    """The scripted battle's state, one action at a time."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.battle = 0

    def start(self) -> None:
        self.battle += 1
        self.turn, self.charges, self.step = 1, 4, 0
        self.army = {
            name.lower(): {
                "name": name, "class": cls, "level": level, "values": dict(zip(KEYS, stats)), "hp": stats[0],
                "x": 2 + i % 4, "y": 6 + i // 4 * 2, "spells": list(spells) + [0] * (10 - len(spells)),
                "items": ([weapon] if weapon else []) + [(VULNERARY, 3)], "on_map": True, "acted": False,
            }
            for i, (name, cls, level, stats, spells, weapon) in enumerate(ARMY)
        }
        self.foes = {
            slot: {"class": c, "level": lv, "max": hp, "hp": hp, "x": 11 + slot % 4 * 2, "y": 2 + (slot - 100) // 4 * 4}
            | dict(zip(("x", "y"), FOE_TILES.get(slot - 100, ())))
            for slot, (c, lv, hp) in enumerate(FOES, start=100)
        }
        self.saved = None
        self.history = [HistoryStep(1, 0, True, units=self.everyone())]  # "Fight!"

    def me(self, key: str) -> StepUnit:
        u = self.army[key]
        spells = (SPELL_IDS.get(u["name"], ()) + (None,) * 10)[: len(u["spells"])]
        abilities = (RALLY_SPEED,) if u["name"] == "Byleth" else ()
        return StepUnit(f"a:{key}", u["hp"], u["x"], u["y"], u["values"]["hp"], tuple(u["items"]), tuple(u["spells"]), spells, abilities)

    def foe(self, slot: int) -> StepUnit:
        f = self.foes[slot]
        return StepUnit(f"e:{slot}", f["hp"], f["x"], f["y"])

    def everyone(self) -> tuple[StepUnit, ...]:
        return tuple(self.me(k) for k, u in self.army.items() if u["on_map"]) + tuple(self.foe(slot) for slot in self.foes)

    def sample(self) -> BattleSample:
        army = tuple(
            ArmySample(
                key, u["name"], u["class"], u["level"], dict(u["values"]), tuple(u["items"]), tuple(u["spells"]), u["hp"], u["x"], u["y"], acted=u["acted"],
                class_id=ARMY_IDS[u["name"]][0], character=ARMY_IDS[u["name"]][1], female=ARMY_IDS[u["name"]][2],
                spell_ids=(SPELL_IDS.get(u["name"], ()) + (None,) * 10)[: len(u["spells"])],
                arts=tuple(art_name(a) for a in ARTS.get(u["name"], ())),
            )
            for key, u in sorted(self.army.items())
            if u["on_map"]
        )
        foes = tuple(
            EnemySample(
                f["class"], f["level"], round(power({"hp": f["max"], "str": 20, "def": 15}, f["level"]), 1), f["max"], f["hp"], slot, f["x"], f["y"],
                weapon=FOE_WEAPONS.get(f["class"], ""), class_id=FOE_CLASS_IDS.get(f["class"]),
                female=slot - 100 in FOE_WOMEN, side=FOE_SIDES.get(slot - 100, "enemy"),
                name=NAMED_FOES.get(slot - 100, ("", None))[0], character=NAMED_FOES.get(slot - 100, ("", None))[1],
                items=FOE_ITEMS.get(f["class"], ()), spells=tuple(n for _, n in FOE_SPELLS.get(f["class"], ())),
                spell_ids=tuple(i for i, _ in FOE_SPELLS.get(f["class"], ())),
            )
            for slot, f in self.foes.items()
        )
        return BattleSample(army, foes, f"demo-{self.battle}", self.turn, self.charges, tuple(self.history), terrain=TERRAIN, scenario=7, map_id=MAP_ID)

    def place(self, unit: dict, x: int, y: int) -> None:
        """Put a unit on (x, y), or the nearest tile it can stand on."""
        x, y = min(MAP_W - 1, max(0, x)), min(MAP_H - 1, max(0, y))
        if unit["class"] not in FLIERS:
            free = [(abs(i - x) + abs(j - y), i, j) for j in range(MAP_H) for i in range(MAP_W) if TERRAIN[j][i] not in BLOCKED]
            _, x, y = min(free)
        unit["x"], unit["y"] = x, y

    def act(self) -> bool:
        """One unit acts. Returns False when the battle is over."""
        self.step += 1
        rng = self.rng
        if self.step == 8:
            self.saved = copy.deepcopy((self.army, self.foes, self.turn, self.history))
        if self.step == 12 and self.saved is not None:  # Divine Pulse: back to how things were 4 actions ago
            self.army, self.foes, self.turn, self.history = copy.deepcopy(self.saved)
            self.charges -= 1
            return True
        if self.step % 4 == 0:
            self.turn += 1
            for u in self.army.values():
                u["acted"] = False
            self.history.append(HistoryStep(self.turn, 0, True, units=self.everyone()))  # "Began player phase."
        alive = [slot for slot, f in self.foes.items() if f["hp"] > 0]
        keys = [k for k, u in self.army.items() if u["on_map"]]
        if not alive:
            return False
        key = rng.choice([k for k in keys if not self.army[k]["acted"]] or keys)
        unit = self.army[key]
        unit["acted"] = True
        self.place(unit, unit["x"] + rng.randint(-2, 3), unit["y"] + rng.randint(-2, 2))
        if unit["name"] == "Marianne" and unit["spells"][1] > 0 and self.step % 2 == 0:  # heal the most hurt
            hurt = min(keys, key=lambda k: self.army[k]["hp"] / self.army[k]["values"]["hp"])
            unit["spells"][1] -= 1
            full = self.army[hurt]["hp"] >= self.army[hurt]["values"]["hp"]  # no one hurt: Ward instead
            self.army[hurt]["hp"] = min(self.army[hurt]["values"]["hp"], self.army[hurt]["hp"] + 15)
            step = HistoryStep(self.turn, 0, False, STEP_SPELL, f"a:{key}", f"a:{hurt}", False, (self.me(hurt), self.me(key)), spell=WARD if full else HEAL)
            self.history.append(step)
            return True
        if unit["name"] == "Byleth" and self.step % 5 == 0 and len(keys) > 1:  # Rally an ally
            other = rng.choice([k for k in keys if k != key])
            self.history.append(HistoryStep(self.turn, 0, False, RALLY, f"a:{key}", f"a:{other}", False, (self.me(key), self.me(other)), rally=True))
            return True
        slot = rng.choice(alive)
        foe = self.foes[slot]
        self.place(unit, foe["x"] - 1, foe["y"])  # moves next to its target
        art = ARTS[unit["name"]][0] if unit["name"] in ARTS and self.step % 3 == 0 else None
        if unit["items"] and unit["items"][0][0] != VULNERARY:
            item, uses = unit["items"][0]
            unit["items"][0] = (item, max(0, uses - (ART_COST if art is not None else 1)))
        elif unit["spells"][0] > 0:
            unit["spells"][0] -= 1
        foe["hp"] = max(0, foe["hp"] - rng.randint(12, 30))
        if foe["hp"] > 0:  # counterattack
            unit["hp"] = max(1, unit["hp"] - rng.randint(3, 14))
        self.history.append(HistoryStep(self.turn, 0, False, STEP_ATTACK, f"a:{key}", f"e:{slot}", True, (self.me(key), self.foe(slot)), art=art))
        item, uses = unit["items"][-1] if unit["items"] else (0, 0)
        if unit["hp"] < unit["values"]["hp"] // 3 and item == VULNERARY and uses > 0:
            unit["items"][-1] = (item, uses - 1) if uses > 1 else None
            unit["items"] = [i for i in unit["items"] if i is not None]
            unit["hp"] = min(unit["values"]["hp"], unit["hp"] + 10)
            self.history.append(HistoryStep(self.turn, 0, False, STEP_ITEM, f"a:{key}", units=(self.me(key),), item=VULNERARY))
        if self.step in (6, 15) or (foe["hp"] == 0 and rng.random() < 0.3):  # level-up
            unit["level"] += 1
            for k in rng.sample(KEYS[:9], 3):
                unit["values"][k] += 1
                if k == "hp":
                    unit["hp"] += 1
        if self.step == 18:
            self.army["ignatz"]["on_map"] = False  # fell (or retreated)
        return True


def use_map(map_id: int) -> None:
    """Play on a real map: its terrain from the import's maps.json, units kept off tiles they can't stand on."""
    global TERRAIN, MAP_W, MAP_H, BLOCKED, MAP_ID
    data = GAME_ASSETS_DIR / "data"
    rows = json.loads((data / "maps.json").read_text(encoding="utf-8"))["maps"][str(map_id)]
    TERRAIN = tuple(tuple(int(row[i : i + 2], 16) for i in range(0, len(row), 2)) for row in rows)
    MAP_W, MAP_H, MAP_ID = len(TERRAIN[0]), len(TERRAIN), map_id
    tiles = json.loads((data / "terrain.json").read_text(encoding="utf-8"))["tiles"]
    BLOCKED = {int(t) for t, row in tiles.items() if row["enter"] != "all"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--step", type=float, default=3.0, help="seconds between actions")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--map", type=int, help="play on this map from the import (its terrain and the game's minimap of it)")
    args = parser.parse_args()
    if not (GAME_ASSETS_DIR / "manifest.json").is_file():
        sys.exit(f"No game files imported at {GAME_ASSETS_DIR}. Import your game first (the Game files page, or "
                 "`python -m app.gamefiles extract`), or point DIVINE_PULSE_GAME_ASSETS at an import.")
    if args.map is not None:
        use_map(args.map)

    data = Path(tempfile.mkdtemp(prefix="divine-pulse-demo-"))
    app = create_app(data, background=False)
    state = app.state
    run = state.store.create("Demo")
    for name, cls, _level, stats, _spells, _weapon in ARMY:
        state.store.put_unit(run.id, name.lower(), Unit(name=name, class_name=cls, displayed=dict(zip(KEYS, stats))))
    state.settings.update(active_run_id=run.id)

    def play() -> None:
        demo = Demo(args.seed)
        time.sleep(2)
        while True:
            demo.start()
            state.scanner.feed_battle(demo.sample(), run.id)
            while demo.act():
                time.sleep(args.step)
                state.scanner.feed_battle(demo.sample(), run.id)
            state.scanner.feed_battle(BattleSample(()), run.id)  # over: filed in the history
            time.sleep(4 * args.step)

    threading.Thread(target=play, name="demo-battle", daemon=True).start()
    print(f"Demo data in {data}\nOpen http://127.0.0.1:{args.port}/#/battle  (Ctrl+C to stop)")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
