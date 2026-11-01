"""A unit's inventory as the battle pages show it: each item with its name, uses left and full uses.

The battle record holds six (item ID, uses) pairs and, separately, the spell in each spell slot with its uses left
(gamemem/battle.py). Item IDs fall into ranges (docs/reading-game-memory.md): weapons 10-509, equipment 600-649,
items 1000-1199. Weapon, spell, equipment, item, combat art and ability names come from the game's own tables
from the import.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from ..domain.inventory import InventoryItem as InventoryItem
from . import game_tables

WEAPONS = range(10, 510)
EQUIPMENT = range(600, 650)
ITEMS = range(1000, 1200)

@dataclass(frozen=True)
class _Tables:
    weapons: dict[int, tuple[str, int]]  # item ID -> (name, uses when new)
    spells: dict[int, tuple[str, int]]  # spell ID -> (name, uses per battle)
    equipment: tuple[str | None, ...]  # by equipment ID (item ID - 600)
    arts: dict[int, str] = field(default_factory=dict)  # combat art ID -> name
    abilities: tuple[str | None, ...] = ()  # by ability ID
    items: dict[int, str] = field(default_factory=dict)  # item ID (1000 on) -> name
    skills: dict[tuple[str, int], int] = field(default_factory=dict)  # ("weapon" | "spell", ID) -> weapon skill
    crest_stones: frozenset[int] = frozenset()


# The game's weapon "skill" (which rank a weapon or spell uses) by the icon names of the map (gamemem/combat.py).
_SKILL_KINDS = ("sword", "lance", "axe", "bow", "gauntlets", "reason", "faith", "dark")


def weapon_kind(kind: str, item: int) -> str | None:
    if kind not in ("weapon", "spell"):
        return None
    if kind == "weapon" and item in _tables().crest_stones:
        return "crest-stone"
    skill = _tables().skills.get((kind, item))
    return _SKILL_KINDS[skill] if skill is not None and 0 <= skill < len(_SKILL_KINDS) else None


def crest_stone_flag(row: dict) -> bool:
    """The weapon row's crystal icon flag; absent or incomplete old rows have no flag."""
    try:
        raw = bytes.fromhex(row.get("raw") or "")
    except (TypeError, ValueError):
        return False
    return len(raw) > 0x0F and bool(raw[0x0F] & 0x80)


def _tables() -> _Tables:
    return _load_tables(game_tables.generation())


@lru_cache(maxsize=2)
def _load_tables(_generation: tuple) -> _Tables:
    try:
        data = game_tables.memory()
    except (OSError, ValueError):
        return _Tables({}, {}, ())

    def rows(table: dict) -> dict[int, tuple[str, int]]:
        return {int(k): (v["name"], v["uses"]) for k, v in table.items() if v.get("name")}

    return _Tables(
        rows(data.get("weapons", {})),
        rows(data.get("spells", {})),
        tuple(data.get("equipment", ())),
        {int(k): v["name"] for k, v in data.get("combat_arts", {}).items()},
        tuple(data.get("abilities", ())),
        {int(k): v for k, v in data.get("items", {}).items()},
        {
            (kind, int(k)): v["skill"]
            for kind, table in (("weapon", "weapons"), ("spell", "spells"))
            for k, v in data.get(table, {}).items()
            if "skill" in v
        },
        frozenset(int(k) for k, v in data.get("weapons", {}).items() if crest_stone_flag(v)),
    )


def item_name(item: int) -> str:
    """The name of an inventory item ID: a weapon, equipment or item (Vulnerary)."""
    return inventory(((item, 0),))[0].name


def spell_name(spell: int) -> str:
    return _tables().spells.get(spell, (f"Spell {spell}", None))[0]


def art_name(art: int) -> str:
    return _tables().arts.get(art, f"Combat art {art}")


def ability_name(ability: int) -> str | None:
    abilities = _tables().abilities
    return abilities[ability] if 0 <= ability < len(abilities) else None


def inventory(
    items: tuple[tuple[int, int], ...],
    spell_uses: tuple[int, ...] = (),
    spells: tuple[int | None, ...] = (),
    *,
    equipped_item_id: int | None = None,
    equipped_accessory_id: int | None = None,
) -> list[InventoryItem]:
    """The items (as (item ID, uses left)) then the spells (each slot's spell ID and uses left; None = empty slot)."""
    t = _tables()
    out = []
    equipped_weapon_marked = False
    equipped_accessory_marked = False
    for item, uses in items:
        equipped_weapon = equipped_item_id is not None and item == equipped_item_id and not equipped_weapon_marked
        equipped_accessory = item == equipped_accessory_id and not equipped_accessory_marked
        equipped = equipped_weapon or equipped_accessory
        equipped_weapon_marked |= equipped_weapon
        equipped_accessory_marked |= equipped_accessory
        if item in WEAPONS:
            name, full = t.weapons.get(item, (f"Weapon {item}", None))
            out.append(InventoryItem(id=item, name=name, kind="weapon", uses=uses, full=full, equipped=equipped))
        elif item in EQUIPMENT:
            n = item - EQUIPMENT.start
            name = t.equipment[n] if n < len(t.equipment) and t.equipment[n] else f"Equipment {n}"
            out.append(InventoryItem(id=item, name=name, kind="equipment", uses=uses, equipped=equipped_accessory))
        elif item in ITEMS:
            out.append(
                InventoryItem(id=item, name=t.items.get(item) or "Item", kind="item", uses=uses)
            )
        else:
            out.append(InventoryItem(id=item, name=f"Item {item}", kind="other", uses=uses))
    for spell, uses in zip(spells, spell_uses):
        if spell is None:
            continue
        name, full = t.spells.get(spell, (f"Spell {spell}", None))
        out.append(InventoryItem(id=spell, name=name, kind="spell", uses=uses, full=full))
    return [item.model_copy(update={"weapon": weapon_kind(item.kind, item.id)}) for item in out]
