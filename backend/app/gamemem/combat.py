"""Fire Emblem: Three Houses combat math, from the imported tables.

Used to work out who fought whom between two reads when the game's battle history can't be read (gamemem/pairing.py).
Checked against the game's combat forecasts and status screens:

    Atk  = Str (Mag for spells and magic weapons) + weapon Mt (x3 when effective) + ability bonuses
    Damage = Atk - Prt (Def) or - Rsl (Res) for magic, at least 0; a critical hit deals x3
    Hit  = Dex + weapon Hit (spells: (Dex + Lck) / 2 + spell Hit) + bonuses, minus the foe's avoid
    Avo  = AS + bonuses (against magic: (Spd + Lck) / 2 + bonuses)
    Crit = (Dex + Lck) / 2 + weapon Crit + bonuses, minus the foe's Lck + crit avoid bonuses
    AS   = Spd - max(0, Wt - Str / 5); 4 AS more than the foe strikes twice. Strikes-twice weapons (flag 0x20: Brave
           weapons, gauntlets) hit twice per attack.

On-screen stats are raw + class boosts (+ mounted boosts) + "always" stat abilities (HP +5, Magic +2...). A class's
abilities are the innate slots of its row in "class_abilities" (class_innate()): the Swordmaster's Swordfaire and
Sword Crit +10 show on its status screen, its Defense +2 doesn't, and a Fighter's mastery Strength +2 isn't in
Cyril's forecast.

Not modelled (the forecast can differ by these, see the reader):
- Linked allies ("linked attacks"): on the player phase, each ally that could attack the target from where it stands
  adds Hit and Avo to the attacker by support rank (fan wikis: +3 with no support if the pair can support at all,
  +5 C, +7 B, +10 A, +15 S; up to three allies, an adjutant as a fourth), and some bonded pairs +1-3 Atk. The tracker
  doesn't read support ranks. Every player-side forecast in the fixture had three or four allies in reach and shows a
  link: Byleth +1 Atk, +13 Hit, +13 Avo; Hanneman +1 Atk, +6 Hit; Lysithea +3 Hit, +2 Avo; Cyril +5 Hit, +5 Avo
  (Byleth's 13 and Lysithea's 2 don't fit those values: not understood yet). Pass `link`; gamemem/pairing.py weighs
  the possible links by how many allies are in reach.
- Gambits, combat arts, and skills that trigger by chance (Pavise, Miracle, Lethality...). A unit's battalion
  modifiers at its level do count, yours and enemies' (domain/battalions.py: Phys Atk or Mag Atk by the weapon, Hit,
  Crit, Avo, Prt, Rsl, Cha), none once its endurance is spent or while it is rattled.

Terrain counts when the tiles are known (`a_ground`, `d_ground`: terrain.ground(), nothing for fliers): a tile's Def or
Res comes off the damage the unit on it takes, its Avo off the Hit against it.
- Abilities whose condition isn't one of the few decoded below (adjacency, "when HP is full"...).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from ..domain.battalions import modifiers
from ..infrastructure import game_tables
from ..infrastructure.inventory import crest_stone_flag
from .battle import BattleUnit
from .terrain import NO_GROUND, Ground


# Weapon "skill" (which weapon rank it uses): 0 sword, 1 lance, 2 axe, 3 bow, 4 brawl, 5 reason, 6 faith, 7 dark magic.
SWORD, LANCE, AXE, BOW, BRAWL, REASON, FAITH, DARK = range(8)
# Weapon flags (+0x16) and effectiveness (+0x0E): the effectiveness bits match the "... Effect Null" abilities'
# amounts (1 infantry, 2 armored, 4 cavalry, 8 flying, 16 dragon, 32 monster); bows are 8, Armorslayer 2, Horseslayer 4,
# Rapier 6.
MAGIC_FLAG, STRIKES_TWICE_FLAG = 0x01, 0x20
ARMORED, CAVALRY, FLYING = 0x02, 0x04, 0x08
EFFECTIVE_FACTOR = 3
CRIT_FACTOR = 3
DOUBLING_AS = 4
# Classes by how they move (for effective weapons), by name as the game's class list has them.
ARMORED_CLASSES = {"Armored Knight", "Fortress Knight", "Great Knight", "Armored Lord", "Emperor"}
CAVALRY_CLASSES = {
    "Cavalier", "Paladin", "Great Knight", "Bow Knight", "Dark Knight", "Holy Knight", "Valkyrie", "Death Knight",
}
FLYING_CLASSES = {
    "Pegasus Knight", "Falcon Knight", "Wyvern Rider", "Wyvern Lord", "Wyvern Master", "Dark Flier", "Barbarossa",
}

# Ability effects (raw rows of 15 bytes): +0..+2 amounts (signed), +3 the weapon
# skill it needs (0xFF = none), +5/+6 when it applies, +0x0A..+0x0C what each amount changes, +0x0D/+0x0E arguments.
STAT_CODES = {3: "hp", 4: "str", 5: "mag", 6: "dex", 7: "spd", 8: "lck", 9: "def", 10: "res", 11: "mv", 12: "cha"}
COMBAT_CODES = {13: "atk", 14: "hit", 15: "crit", 16: "avo", 20: "crit_avo"}
# The "Blow" abilities (+6 to a stat when the unit attacks): Death Blow 22 Str, Fiendish Blow 23 Mag, Darting Blow 21
# Spd, Armored Blow 18 Def, Warding Blow 19 Res. Lysithea's Fire forecast (Mt 34) has Fiendish Blow's +6 Mag.
BLOW_CODES = {18: "def", 19: "res", 21: "spd", 22: "str", 23: "mag"}
BOW_RANGE = 26  # Bowrange +1 / +2
UNKNOWN_RANGE = 100
# When an effect applies (+5, +6). Others (gambits, adjacency, phases...) aren't decoded and are left out.
ALWAYS = (1, 1)
WIELDING = (1, 4)  # with a weapon of the skill at +3 (or +0x0D if +3 is 0xFF): prowess, -faire, Crit +10, Avo +20
INITIATING = (4, 8)  # the Blows, Murderous Intent
HP_AT_MOST = (1, 2)  # HP at most +0x0D percent of max HP (100: HP full): Defiant abilities, Confidence
BREAKER = (3, 14)  # wielding skill +0x0D against a foe wielding skill +0x0E (0x65 = magic): Swordbreaker...
ANY_MAGIC = 0x65
# Abilities that change the order of strikes, by their effect code (+0x0A), and Canto (move again after acting).
VANTAGE, DESPERATION, QUICK_RIPOSTE, CLOSE_COUNTER, CANTO = 28, 59, 60, 65, 46


def _signed(b: int) -> int:
    return b - 256 if b > 127 else b


@dataclass(frozen=True)
class Weapon:
    id: int  # item ID (weapons) or spell ID (spells)
    spell: bool
    skill: int
    might: int
    hit: int
    crit: int
    weight: int
    min_range: int
    max_range: int
    flags: int = 0
    effective: int = 0
    crest_stone: bool = False

    @property
    def magic(self) -> bool:
        return self.spell or bool(self.flags & MAGIC_FLAG)

    @property
    def strikes_twice(self) -> bool:
        return bool(self.flags & STRIKES_TWICE_FLAG)

    @classmethod
    def from_row(cls, key: int, row: dict, spell: bool) -> Weapon:
        try:
            raw = bytes.fromhex(row.get("raw") or "")
        except (TypeError, ValueError):
            raw = b""
        return cls(
            key, spell, row["skill"], row["might"], row["hit"], row["crit"], row["weight"],
            row["min_range"], row["max_range"], row["flags"], raw[0x0E] & 0x3F if len(raw) > 0x0E else 0,
            not spell and crest_stone_flag(row),
        )


@dataclass(frozen=True)
class Effect:
    amounts: tuple[int, int, int]
    codes: tuple[int, int, int]
    when: tuple[int, int]
    skill: int | None  # weapon skill it needs (prowess)
    arg1: int
    arg2: int

    @classmethod
    def from_raw(cls, raw: bytes) -> Effect:
        return cls(
            (_signed(raw[0]), _signed(raw[1]), _signed(raw[2])), (raw[10], raw[11], raw[12]), (raw[5], raw[6]),
            None if raw[3] == 0xFF else raw[3], raw[13], raw[14],
        )

    def changes(self) -> list[tuple[int, int]]:
        return [(c, a) for c, a in zip(self.codes, self.amounts) if c]


@dataclass(frozen=True)
class GameClassInfo:
    name: str
    boosts: dict[str, int]
    mounted: dict[str, int]
    abilities: tuple[int, ...]  # active class abilities (the mastery ability left out)


@dataclass(frozen=True)
class CombatData:
    weapons: dict[int, Weapon]
    spells: dict[int, Weapon]
    effects: dict[int, Effect]
    classes: dict[int, GameClassInfo]
    personal: dict[int, int]  # character ID -> personal ability ID
    names: dict[int, str] = field(default_factory=dict)  # character ID -> name as the support list writes it
    # Battalion modifiers at levels 1-5 by battalion ID (None where the import has no progression).
    battalion_stats: tuple = ()

    @classmethod
    def load(cls) -> CombatData:
        data = game_tables.memory()
        ability_ids = {name: i for i, name in enumerate(data["abilities"]) if name}
        class_abilities = data.get("class_abilities", {})
        return cls(
            weapons={int(k): Weapon.from_row(int(k), v, False) for k, v in data.get("weapons", {}).items()},
            spells={int(k): Weapon.from_row(int(k), v, True) for k, v in data.get("spells", {}).items()},
            effects={int(k): Effect.from_raw(bytes.fromhex(v["raw"])) for k, v in data.get("ability_effects", {}).items()},
            classes={
                int(k): GameClassInfo(v["name"], v.get("boosts", {}), v.get("mounted", {}), class_innate(class_abilities.get(k, []), data))
                for k, v in data["classes"].items()
            },
            personal={int(k): ability_ids[v["personal"]] for k, v in data["characters"].items() if v.get("personal") in ability_ids},
            names={int(k): f'{v["name"]} ({"M" if k == "0" else "F"})' if k in ("0", "1") else v["name"]
                   for k, v in data["characters"].items()},
            battalion_stats=tuple(data.get("battalion_stats", ())),
        )


def class_innate(row: list, data: dict) -> tuple[int, ...]:
    """A class's own (innate) abilities from its class abilities row:
    0 mastery, 1 not shown, 2-4 innate). Rows dumped before positions were kept list only the abilities present: then
    the first is taken as the mastery ability and the second dropped if it's what slot 1 holds (a stat bonus, an
    "X Crit +10" or a prowess: Myrmidon's Axe Crit +10, Lord's Lance Prowess Lv 2, Grappler's Pomp & Circumstance),
    which gives the guides' answer for every class checked."""
    if len(row) == 5:
        return tuple(a for a in row[2:] if a is not None)
    names = data.get("abilities", [])

    def name(a: int) -> str:
        return (names[a] if a < len(names) else None) or ""

    # Enemy-only variants of classes have no mastery ability: their first entry is one of the class's own.
    if not row or _innate_kind(name(row[0])):
        return tuple(a for a in row if a is not None)
    rest = list(row[1:])
    if not rest:
        return ()
    effect = data.get("ability_effects", {}).get(str(rest[0]))
    if effect is not None:
        raw = bytes.fromhex(effect["raw"])
        codes = {raw[10], raw[11], raw[12]} - {0}
        always_stat = (raw[5], raw[6]) == ALWAYS and codes <= set(STAT_CODES)
        crit_10 = codes == {15} and raw[0] == 10 and (raw[5], raw[6]) == WIELDING
        prowess = codes == {14, 16, 20}
        if always_stat or crit_10 or prowess:
            rest = rest[1:]
    return tuple(rest)


def _innate_kind(name: str) -> bool:
    """Abilities that are only ever a class's own, never its mastery ability (Canto, Charm, the -faires...)."""
    return (
        name in {"Canto", "Charm", "Locktouch", "Stealth", "Unarmed Combat", "Terrain Resistance", "Fire", "Heal", "Miasma Δ"}
        or name.endswith("faire") or name.startswith(("Bowrange", "Weight -")) or "Range +1" in name or "Uses x" in name
    )


def combat_data() -> CombatData:
    return _combat_data(game_tables.generation())


@lru_cache(maxsize=2)
def _combat_data(_generation: tuple) -> CombatData:
    return CombatData.load()


@dataclass(frozen=True)
class Arm:
    """Something a unit can attack with: an inventory weapon or a spell."""

    weapon: Weapon
    item_slot: int | None  # set for inventory weapons

    @property
    def key(self) -> tuple[str, int]:
        """What its uses are counted by: the item or spell ID (inventories can be reordered)."""
        return ("spell" if self.weapon.spell else "item", self.weapon.id)


@dataclass(frozen=True)
class Fighter:
    """A unit as the combat math sees it, built from its battle record."""

    unit: BattleUnit
    stats: dict[str, int]  # on-screen stats (hp = max HP)
    hp: int  # current HP
    effects: tuple[Effect, ...]
    arms: tuple[Arm, ...]  # weapons and spells with uses left
    moves: frozenset[int] = field(default_factory=frozenset)  # ARMORED / CAVALRY / FLYING
    # Its battalion's modifiers now (domain/battalions.modifiers); Cha is already in `stats`.
    battalion: dict[str, int] = field(default_factory=dict)

    @property
    def mv(self) -> int:
        return self.stats.get("mv", 4)

    def has(self, code: int) -> bool:
        return any(code in e.codes for e in self.effects)

    def arm(self, key: tuple[str, int]) -> Arm | None:
        return next((a for a in self.arms if a.key == key), None)

    @property
    def equipped(self) -> Arm | None:
        """What it has equipped: the spell the game says (BattleUnit.equipped_spell), else the first weapon in its
        inventory (the game keeps the equipped weapon at the top), None if it has neither with uses left."""
        spell = self.unit.equipped_spell
        arm = self.arm(("spell", spell)) if spell is not None else None
        return arm or next((a for a in self.arms if a.item_slot is not None), None)

    @classmethod
    def from_unit(cls, unit: BattleUnit, data: CombatData | None = None, hp: int | None = None) -> Fighter:
        data = data or combat_data()
        info = data.classes.get(unit.class_id, GameClassInfo("", {}, {}, ()))
        stats = {k: v + info.boosts.get(k, 0) + info.mounted.get(k, 0) for k, v in unit.raw.items()}
        ability_ids = list(dict.fromkeys([*unit.abilities, *info.abilities, *([data.personal[unit.character]] if unit.character in data.personal else [])]))
        effects = tuple(data.effects[a] for a in ability_ids if a in data.effects)
        for e in effects:
            if e.when == ALWAYS:
                for code, amount in e.changes():
                    if code in STAT_CODES:
                        stats[STAT_CODES[code]] = stats.get(STAT_CODES[code], 0) + amount
        arms = []
        for i, (item, uses) in enumerate(unit.items):
            w = data.weapons.get(item)
            if w is not None and uses > 0 and w.id > 15:  # (10-15: Unarmed and broken weapons)
                arms.append(Arm(w, i))
        for spell, uses in zip(unit.spells, unit.spell_uses):
            w = data.spells.get(spell) if spell is not None else None
            if w is not None and uses > 0 and w.might > 0:  # (healing and other staff-like spells have no Mt)
                arms.append(Arm(w, None))
        types = game_tables.class_types().get(unit.class_id)
        moves = frozenset(
            flag for flag, name, names in ((ARMORED, "armored", ARMORED_CLASSES), (CAVALRY, "cavalry", CAVALRY_CLASSES), (FLYING, "flying", FLYING_CLASSES))
            if (types.get(name, False) if types is not None else info.name in names)
        )
        battalion = {}
        if unit.battalion is not None and not unit.rattled and 0 <= unit.battalion < len(data.battalion_stats):
            battalion = modifiers(data.battalion_stats[unit.battalion], unit.battalion_exp, unit.battalion_endurance) or {}
        if battalion.get("cha"):
            stats["cha"] = stats.get("cha", 0) + battalion["cha"]
        return cls(unit, stats, unit.hp if hp is None else hp, effects, tuple(arms), moves, battalion)


@dataclass(frozen=True)
class Link:
    """What linked allies add to the attacker (see linked_allies() and link_options())."""

    atk: int = 0
    hit: int = 0
    avo: int = 0


# Linked attacks (fe3h.com "Linked Attacks Guide", Serenes Forest "Linked Attacks & Gambit Boost"): on the player
# phase, allies that could attack the target from where they stand each add Hit and Avo to the attacker by their
# support rank with it (and Might for the pairs below); at most three, the ones highest in the deployment order, plus
# the attacker's adjutant. Since 1.2.0 a pair that can never support adds nothing.
LINK_BONUS = {None: (3, 0), "C": (5, 1), "B": (7, 2), "A": (10, 3), "S": (15, 5)}  # rank -> (Hit and Avo, Might)
MAX_LINKED = 3
MIGHT_PAIRS = {
    frozenset(p)
    for p in (
        ("Byleth", "Edelgard"), ("Byleth", "Dimitri"), ("Byleth", "Claude"), ("Byleth", "Flayn"), ("Byleth", "Yuri"),
        ("Edelgard", "Hubert"), ("Dimitri", "Dedue"), ("Claude", "Hilda"), ("Annette", "Mercedes"), ("Annette", "Gilbert"),
        ("Felix", "Ingrid"), ("Sylvain", "Felix"), ("Sylvain", "Ingrid"), ("Dorothea", "Manuela"), ("Seteth", "Flayn"),
        ("Ferdinand", "Lorenz"), ("Raphael", "Ignatz"), ("Catherine", "Shamir"), ("Alois", "Leonie"),
        ("Mercedes", "Jeritza"), ("Hilda", "Balthus"),
    )
}
# How likely each rank is when the tracker doesn't know it (support levels aren't read yet).
RANK_PRIOR = {None: 0.35, "C": 0.3, "B": 0.15, "A": 0.15, "S": 0.05}


def support_pairs() -> dict[frozenset[str], tuple[str, ...]]:
    """Pairs that can support each other and their available ranks."""
    return _support_pairs(game_tables.generation())


@lru_cache(maxsize=2)
def _support_pairs(_generation: tuple) -> dict[frozenset[str], tuple[str, ...]]:
    source = game_tables.game_assets().json("data/supports.json") or {}
    characters = game_tables.memory()["characters"]
    imported = {}
    for row in source.get("pairs", []):
        first = characters.get(str(row["a"]), {}).get("name") or row.get("a_name", "")
        second = characters.get(str(row["b"]), {}).get("name") or row.get("b_name", "")
        ranks = tuple(dict.fromkeys(rank.rstrip("+") for rank in row["ranks"]))
        if not first or not second or not ranks:
            continue
        if row["a"] != 0:
            imported[frozenset((first, second))] = ranks
            continue
        for name, gender in ((f"{first} (M)", "male"), (f"{first} (F)", "female")):
            no_s = row["b"] in game_tables.byleth_no_s()[gender]
            imported[frozenset((name, second))] = tuple(r for r in ranks if r != "S") if no_s else ranks
    return imported
def can_link(f: Fighter, distance: int) -> bool:
    """Whether an ally could attack a unit `distance` tiles away from where it stands, with what it has equipped
    (Fighter.equipped). In the fixture Cyril, Steel Axe+ equipped, didn't link from two tiles though he carried bows,
    and Hanneman, Thoron equipped (an Iron Bow at the top of his inventory), linked from one tile. Where the game's
    equipped field isn't read (a unit built by hand), any spell counts too, as Hanneman's seemed to before it was
    found."""
    equipped = f.equipped
    if equipped is not None and in_range(f, equipped, distance):
        return True
    return f.unit.equipped is None and any(a.weapon.spell and in_range(f, a, distance) for a in f.arms)


def linked_allies(attacker_slot: int, target: tuple[int, int], allies: list[tuple[int, Fighter, int, int]]) -> list[Fighter]:
    """The allies that link an attack on the unit at `target`: (slot, Fighter, x, y) of your units on the map, in
    deployment order (pool order); at most three."""
    out = []
    for slot, f, x, y in sorted(allies, key=lambda a: a[0]):
        if slot == attacker_slot or f.hp <= 0:
            continue
        if can_link(f, abs(x - target[0]) + abs(y - target[1])):
            out.append(f)
            if len(out) == MAX_LINKED:
                break
    return out


def link_options(attacker: Fighter, linked: list[Fighter], data: CombatData | None = None) -> tuple[tuple[Link, float], ...]:
    """What `linked` allies might add to `attacker`'s attack, with chances: exact for pairs that can't support (they
    add nothing), each possible rank weighed by RANK_PRIOR for the rest. Adjutants aren't counted (not read)."""
    data = data or combat_data()
    pairs = support_pairs()
    name = data.names.get(attacker.unit.character, "")
    totals: dict[tuple[int, int], float] = {(0, 0): 1.0}
    for ally in linked:
        other = data.names.get(ally.unit.character, "")
        ranks = pairs.get(frozenset((name, other)))
        if not ranks:
            continue
        might_pair = frozenset((name.split(" (")[0], other.split(" (")[0])) in MIGHT_PAIRS
        choices = [r for r in (None, "C", "B", "A", "S") if r is None or r in ranks]
        weight = sum(RANK_PRIOR[r] for r in choices)
        nxt: dict[tuple[int, int], float] = {}
        for (atk, hit), p in totals.items():
            for r in choices:
                bonus, might = LINK_BONUS[r]
                key = (atk + (might if might_pair else 0), hit + bonus)
                nxt[key] = nxt.get(key, 0.0) + p * RANK_PRIOR[r] / weight
        totals = nxt
    return tuple((Link(atk, hit, hit), p) for (atk, hit), p in sorted(totals.items()))


@dataclass(frozen=True)
class CombatStats:
    """One side's numbers in a fight, before the foe's are taken off: what the status screen calls Atk, Hit..."""

    atk: int
    hit: int
    crit: int
    avo: int  # against physical attacks
    magic_avo: int
    crit_avo: int
    prt: int
    rsl: int
    attack_speed: int


def max_range(f: Fighter, arm: Arm) -> int:
    extra = sum(a for e in f.effects for c, a in e.changes() if c == BOW_RANGE) if arm.weapon.skill == BOW and not arm.weapon.magic else 0
    # The (Dark) Sword of the Creator's table says 150; the game's weapon list shows the Sword of the Creator as Rng 1-2
    # (seen in Oil and Water, 1.2.0). The Dark Sword of the Creator is taken to be the same.
    base = arm.weapon.max_range if arm.weapon.max_range < UNKNOWN_RANGE else 2
    return base + extra


def in_range(f: Fighter, arm: Arm, distance: int, counter: bool = False) -> bool:
    if arm.weapon.min_range <= distance <= max_range(f, arm):
        return True
    return counter and distance == 1 and f.has(CLOSE_COUNTER)


def combat_stats(f: Fighter, arm: Arm | None, foe: Fighter | None = None, foe_arm: Arm | None = None, initiating: bool = False) -> CombatStats:
    """`f`'s Atk, Hit... with `arm` (None: the status screen's numbers without a weapon's), against `foe`."""
    w = arm.weapon if arm else None
    stats = dict(f.stats)
    b = f.battalion
    bonus = {"atk": b.get("mag_atk" if w is not None and w.magic else "phys_atk", 0), "hit": b.get("hit", 0),
             "crit": b.get("crit", 0), "avo": b.get("avo", 0), "crit_avo": 0}
    for e in f.effects:
        if e.when == ALWAYS:
            applies, codes = True, COMBAT_CODES
        elif e.when == WIELDING:
            need = e.skill if e.skill is not None else e.arg1
            applies, codes = w is not None and w.skill == need, {**COMBAT_CODES, **STAT_CODES}
        elif e.when == INITIATING:
            applies, codes = initiating, {**COMBAT_CODES, **STAT_CODES, **BLOW_CODES}
        elif e.when == HP_AT_MOST:
            max_hp = max(1, f.stats.get("hp", 1))
            applies = f.hp >= max_hp if e.arg1 >= 100 else f.hp * 100 <= e.arg1 * max_hp
            codes = {**COMBAT_CODES, **STAT_CODES}
        elif e.when == BREAKER:
            foe_w = foe_arm.weapon if foe_arm else None
            own_ok = e.arg1 > DARK or (w is not None and w.skill == e.arg1)
            foe_ok = foe_w is not None and (foe_w.magic if e.arg2 == ANY_MAGIC else foe_w.skill == e.arg2)
            applies, codes = own_ok and foe_ok, COMBAT_CODES
        else:
            continue
        if not applies:
            continue
        for code, amount in e.changes():
            name = codes.get(code)
            if name in bonus:
                bonus[name] += amount
            elif name and not (e.when == ALWAYS and code in STAT_CODES):
                stats[name] = stats.get(name, 0) + amount
    strength, magic, dex, spd, lck = (stats.get(k, 0) for k in ("str", "mag", "dex", "spd", "lck"))
    weight = w.weight if w else 0
    attack_speed = spd - max(0, weight - strength // 5)
    if w is None:
        atk, hit, crit = strength, dex, (dex + lck) // 2
    else:
        might = w.might * (EFFECTIVE_FACTOR if foe is not None and w.effective & _move_bits(foe) else 1)
        atk = (magic if w.magic else strength) + might
        hit = ((dex + lck) // 2 if w.spell else dex) + w.hit
        crit = (dex + lck) // 2 + w.crit
    return CombatStats(
        atk=atk + bonus["atk"], hit=hit + bonus["hit"], crit=crit + bonus["crit"],
        avo=attack_speed + bonus["avo"], magic_avo=(spd + lck) // 2 + bonus["avo"], crit_avo=lck + bonus["crit_avo"],
        prt=stats.get("def", 0) + b.get("prt", 0), rsl=stats.get("res", 0) + b.get("rsl", 0),
        attack_speed=attack_speed,
    )


def _move_bits(f: Fighter) -> int:
    bits = 0
    for flag in f.moves:
        bits |= flag
    return bits or 0x01  # infantry


def _clamp(n: int) -> int:
    return max(0, min(100, n))


@dataclass(frozen=True)
class Side:
    """One side of a forecast, as the game shows it."""

    mt: int  # damage per hit
    hit: int  # %
    crit: int  # %
    strikes_twice: bool  # each attack is two hits (Brave weapons, gauntlets)


@dataclass(frozen=True)
class Forecast:
    attacker: Side
    defender: Side | None  # None: can't counter
    order: tuple[str, ...]  # strikes in order: "a" attacker, "d" defender


def fight_stats(a: Fighter, a_arm: Arm, d: Fighter, d_arm: Arm | None, distance: int) -> tuple[CombatStats, CombatStats, bool]:
    """Both sides' numbers for a fight and whether the defender can counter: the part that links don't
    change, to work out once when trying many links."""
    counter = d_arm is not None and in_range(d, d_arm, distance, counter=True)
    return combat_stats(a, a_arm, d, d_arm, initiating=True), combat_stats(d, d_arm, a, a_arm), counter


def forecast_from(
    a: Fighter, a_arm: Arm, d: Fighter, d_arm: Arm | None, stats: tuple[CombatStats, CombatStats, bool], link: Link = Link(),
    defender_link: Link = Link(), a_ground: Ground = NO_GROUND, d_ground: Ground = NO_GROUND,
) -> Forecast:
    sa, sd, counter = stats

    def side(own: CombatStats, own_arm: Arm, foe: CombatStats, own_link: Link, foe_link: Link, foe_ground: Ground) -> Side:
        w = own_arm.weapon
        guard = foe.rsl + foe_ground.res if w.magic else foe.prt + foe_ground.defense
        mt = max(0, own.atk + own_link.atk - guard)
        hit = _clamp(own.hit + own_link.hit - (foe.magic_avo if w.magic else foe.avo) - foe_link.avo - foe_ground.avo)
        return Side(mt, hit, _clamp(own.crit - foe.crit_avo), w.strikes_twice)

    a_x2 = sa.attack_speed - sd.attack_speed >= DOUBLING_AS
    attacker = side(sa, a_arm, sd, link, defender_link, d_ground)
    if not counter or d_arm is None:
        return Forecast(attacker, None, ("a",) * (2 if a_x2 else 1))
    d_x2 = sd.attack_speed - sa.attack_speed >= DOUBLING_AS
    max_hp = max(1, d.stats.get("hp", 1))
    if d.has(QUICK_RIPOSTE) and d.hp * 2 >= max_hp:
        d_x2 = True
    defender = side(sd, d_arm, sa, defender_link, link, a_ground)
    order = ["a", "d"]
    if d.has(VANTAGE) and d.hp * 2 <= max_hp:
        order = ["d", "a"]
    if a_x2:
        if a.has(DESPERATION) and a.hp * 2 <= max(1, a.stats.get("hp", 1)):
            order.insert(order.index("a") + 1, "a")
        else:
            order.append("a")
    if d_x2:
        order.append("d")
    return Forecast(attacker, defender, tuple(order))


@dataclass(frozen=True)
class Outcome:
    """One way a fight can end: HP lost and hits landed by each side, and who fell."""

    a_lost: int
    d_lost: int
    a_hits: int
    d_hits: int


def _true_hit(displayed: int) -> float:
    below = 2 * displayed  # pairs of rolls (a, b) with a + b < 2h
    return sum(min(s, 198 - s) + 1 for s in range(min(below, 199))) / 10000


TRUE_HIT = tuple(_true_hit(h) for h in range(101))


def true_hit(displayed: int) -> float:
    """The chance a displayed Hit actually lands. Three Houses rolls two numbers (0-99) and hits when their average is
    below the displayed Hit, so high rates land more often than shown and low ones less: 80 lands 92.2% of the time
    and 10 lands 2.1% (the figures a published analysis of the game gives). Crit is a single roll."""
    return TRUE_HIT[max(0, min(100, displayed))]


@lru_cache(maxsize=65536)
def outcomes(fc: Forecast, a_hp: int, d_hp: int) -> dict[Outcome, float]:
    """Every way the fight can go, with its chance (true_hit() for the displayed Hit, Crit as shown). Cached: don't
    change the result."""
    strikes: list[str] = []
    for who in fc.order:
        side = fc.attacker if who == "a" else fc.defender
        if side is None:
            continue
        strikes += [who] * (2 if side.strikes_twice else 1)
    result: dict[Outcome, float] = {}

    def go(i: int, ahp: int, dhp: int, ah: int, dh: int, p: float) -> None:
        if i == len(strikes) or ahp <= 0 or dhp <= 0 or p < 1e-9:
            key = Outcome(a_hp - max(0, ahp), d_hp - max(0, dhp), ah, dh)
            result[key] = result.get(key, 0.0) + p
            return
        who = strikes[i]
        side = fc.attacker if who == "a" else fc.defender
        assert side is not None
        hit, crit = true_hit(side.hit), side.crit / 100
        for landed, chance in ((None, 1 - hit), (side.mt, hit * (1 - crit)), (side.mt * CRIT_FACTOR, hit * crit)):
            if chance <= 0:
                continue
            if landed is None:
                go(i + 1, ahp, dhp, ah, dh, p * chance)
            elif who == "a":
                go(i + 1, ahp, dhp - landed, ah + 1, dh, p * chance)
            else:
                go(i + 1, ahp - landed, dhp, ah, dh + 1, p * chance)

    go(0, a_hp, d_hp, 0, 0, 1.0)
    return result


WEAPON_KINDS = {SWORD: "sword", LANCE: "lance", AXE: "axe", BOW: "bow", BRAWL: "gauntlets", REASON: "reason", FAITH: "faith", DARK: "dark"}


def weapon_kind(unit: BattleUnit, data: CombatData | None = None) -> str:
    """What the unit fights with, as the game's map icon shows it: the school ("reason", "faith", "dark") of the spell
    it has equipped (BattleUnit.equipped_spell; a healing spell shows as "faith"), else its equipped weapon's type
    (the first usable weapon in its inventory: the game keeps the equipped one at the top). Where the game's field
    says nothing (or isn't read): that weapon, else its first attack spell's school, else "faith" for a healer, else
    "" (nothing to fight with, or not known)."""
    data = data or combat_data()
    spell = data.spells.get(unit.equipped_spell) if unit.equipped_spell is not None else None
    if spell is not None:
        return WEAPON_KINDS.get(spell.skill, "")
    for item, uses in unit.items:
        w = data.weapons.get(item)
        if w is not None and uses > 0 and w.id > 15:  # (10-15: Unarmed and broken weapons)
            return "crest-stone" if w.crest_stone else WEAPON_KINDS.get(w.skill, "")
    spells = [data.spells.get(s) for s, n in zip(unit.spells, unit.spell_uses) if s is not None and n > 0]
    for w in spells:
        if w is not None and w.might > 0:
            return WEAPON_KINDS.get(w.skill, "")
    return "faith" if any(w is not None for w in spells) else ""
