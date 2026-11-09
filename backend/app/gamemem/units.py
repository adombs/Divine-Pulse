"""Turn roster units into readings (app/readings.py) that app/handlers.py applies.

What the Status page shows, built from the game's own numbers:

    on screen = raw stat + class boost + mounted boost (mounted classes) + ability and accessory bonuses
                (+ the battalion's Charm in Cha, while it has endurance left)

Raw stats, the class, the equipped abilities and the accessory come from the roster (fe3h.py). Class boosts,
names and personal abilities come from the import, and ability/accessory bonuses from the
bonus table (app/data/bonuses.json).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import names
from ..bonuses import BonusTable
from ..classes import tidy_class
from ..inventory import EQUIPMENT, inventory
from ..infrastructure import game_tables
from ..domain import battalions as battalion_rules
from ..domain.units import VALUE_KEYS, byleth_look
from ..domain.readings import AbilityInfo, UnitStatsReading
from .fe3h import EQUIPPED_WEAPON, RosterUnit

SCREEN_ID = "memory"
SCREEN_TITLE = "Game memory"
# Byleth's character IDs (male, female): the only character the player can rename.
BYLETH_IDS = (0, 1)


@dataclass(frozen=True)
class Character:
    name: str
    full_name: str = ""
    gender: str = ""
    personal: str | None = None
    personal_plus: str | None = None


@dataclass(frozen=True)
class GameClass:
    name: str
    boosts: dict[str, int] = field(default_factory=dict)
    mounted: dict[str, int] = field(default_factory=dict)
    female_name: str | None = None
    tier: int = 0


@dataclass(frozen=True)
class GameData:
    characters: dict[int, Character]
    classes: dict[int, GameClass]
    abilities: list[str | None]
    equipment: list[str | None]
    # Names of generic characters by character ID ("Bandit"), as the game's Divine Pulse list names enemies.
    generic_names: dict[int, str] = field(default_factory=dict)
    # Names of the story characters who aren't in the roster (Jeralt, Solon, Tomas...), by character ID.
    npc_names: dict[int, str] = field(default_factory=dict)
    # Character IDs that are female, generic ones too (for the map's class sprites).
    female: frozenset[int] = frozenset()
    combat_arts: dict[int, str] = field(default_factory=dict)  # names by art ID
    battalions: list[str | None] = field(default_factory=list)  # names by battalion ID
    # Modifiers at levels 1-5 by battalion ID (None where the import has no progression).
    battalion_stats: list[list[dict[str, int]] | None] = field(default_factory=list)
    # The tracker's spelling of each ability name already looked up (known_ability). One GameData is one import and
    # language (the scanner loads a new one when either changes), so what it has worked out stays right for its life.
    _spelled: dict[str, str] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def load(cls) -> GameData:
        data = game_tables.memory()
        return cls(
            characters={int(k): Character(**v) for k, v in data["characters"].items()},
            classes={int(k): GameClass(**v) for k, v in data["classes"].items()},
            abilities=data["abilities"],
            equipment=data["equipment"],
            generic_names={int(k): v for k, v in data.get("generic_names", {}).items()},
            npc_names={int(k): v for k, v in data.get("npc_names", {}).items()},
            female=frozenset(data.get("female", ())),
            combat_arts={int(k): v["name"] for k, v in data.get("combat_arts", {}).items()},
            battalions=data.get("battalions", []),
            battalion_stats=data.get("battalion_stats", []),
        )

    def ability(self, ability_id: int) -> str | None:
        name = self.abilities[ability_id] if 0 <= ability_id < len(self.abilities) else None
        return self.known_ability(name) if name else None

    def known_ability(self, name: str) -> str:
        """The tracker's spelling of an ability ("Lily’s Poise" with a curly apostrophe, as the Status page shows).
        Matching a name against every ability is slow and the answer doesn't change, so it's worked out once."""
        spelled = self._spelled.get(name)
        if spelled is None:
            spelled = self._spelled[name] = names.snap(name, names.abilities(), 0.9)
        return spelled


def unit_name(unit: RosterUnit, data: GameData, player_name: str | None) -> str:
    if unit.character in BYLETH_IDS and player_name:
        return player_name
    character = data.characters.get(unit.character)
    return character.name if character else f"Character {unit.character}"


def mastered_classes(unit: RosterUnit, data: GameData, female: bool) -> list[str]:
    """The names of the classes the unit has mastered (the game's own flag for each), lowest tier first and, within a
    tier, in class order; a name shared by variants of a class comes once."""
    ranked = sorted((c for c in unit.mastered_classes if c in data.classes), key=lambda c: (data.classes[c].tier, c))
    found: dict[str, None] = {}
    for class_id in ranked:
        game_class = data.classes[class_id]
        found[tidy_class(game_class.female_name if female and game_class.female_name else game_class.name)] = None
    return list(found)


def to_reading(
    unit: RosterUnit,
    data: GameData,
    bonuses: BonusTable,
    *,
    player_name: str | None = None,
    current_personal: str | None = None,
    scenario: int | None = None,
    in_battle: bool = False,
    gambit_uses: int | None = None,
) -> UnitStatsReading:
    """The unit's Status-page values decoded from memory.

    `current_personal` is the personal ability already stored for the unit: the game keeps an upgraded
    ("+") version of a few personal abilities, and the stored one is kept if it's either version.
    `gambit_uses`: the uses left read from the unit's battle copy (only during a battle).
    """
    character = data.characters.get(unit.character, Character(name=f"Character {unit.character}"))
    game_class = data.classes.get(unit.class_id, GameClass(name=f"Unknown class {unit.class_id}"))
    name = unit_name(unit, data, player_name)

    personal = character.personal or ""
    if current_personal and character.personal_plus and names.normalize(current_personal) == names.normalize(data.known_ability(character.personal_plus)):
        personal = character.personal_plus
    personal = data.known_ability(personal) if personal else ""
    equipped = [a for a in (data.ability(i) for i in unit.abilities) if a]
    accessory = data.equipment[unit.accessory] if unit.accessory is not None and 0 <= unit.accessory < len(data.equipment) else None

    bonus = bonuses.compute(equipped, personal, accessory)
    # A missing import/name is unknown, not evidence that a stored assignment was removed.
    battalion = ("" if unit.battalion is None else
                 (data.battalions[unit.battalion] or None)
                 if 0 <= unit.battalion < len(data.battalions) else None)
    progression = (data.battalion_stats[unit.battalion]
                   if battalion and unit.battalion is not None and unit.battalion < len(data.battalion_stats) else None)
    modifiers = battalion_rules.modifiers(progression, unit.battalion_exp, unit.battalion_endurance) if battalion else None
    # The Status page counts the battalion's Charm in Cha; its other modifiers are combat values, not stats.
    battalion_bonus = {"cha": modifiers["cha"]} if modifiers and modifiers.get("cha") else {}
    for k, v in battalion_bonus.items():
        bonus = {**bonus, k: bonus.get(k, 0) + v}
    values = {
        k: unit.raw[k] + game_class.boosts.get(k, 0) + game_class.mounted.get(k, 0) + bonus.get(k, 0)
        for k in VALUE_KEYS
    }
    class_name = game_class.female_name if character.gender == "Female" and game_class.female_name else game_class.name
    full_name = name if unit.character in BYLETH_IDS else character.full_name or name
    return UnitStatsReading(
        screen=SCREEN_ID,
        name_candidates=[name],
        values=values,
        full_name=full_name,
        # The game shows boosted stats in blue, except Mv.
        blue={k for k, v in bonus.items() if v > 0 and k != "mv"},
        abilities=AbilityInfo(
            personal=personal,
            equipped=equipped,
            accessory=accessory,
            arts=[data.combat_arts.get(a, f"Combat art {a}") for a in unit.arts],
            inventory=inventory(
                unit.items, tuple(n for _, n in unit.spells), tuple(s for s, _ in unit.spells),
                equipped_item_id=unit.item_slot_0 if unit.equipped == EQUIPPED_WEAPON else None,
                equipped_accessory_id=EQUIPMENT.start + unit.accessory if unit.accessory is not None else None,
            ),
            learned=[a for a in (data.ability(i) for i in unit.learned_abilities) if a],
            learned_arts=[data.combat_arts[a] for a in unit.learned_arts if a in data.combat_arts],
            battalion=battalion,
            battalion_id=unit.battalion if battalion else None,
            battalion_exp=unit.battalion_exp if battalion else None,
            battalion_endurance=unit.battalion_endurance if battalion else None,
            # Uses are only in the battle copy; between battles the game refills them, so none are reported.
            gambit_uses=gambit_uses if battalion and in_battle else None,
            battalion_bonus=battalion_bonus if modifiers is not None else None,
            skills=unit.skills,
            mastered_classes=mastered_classes(unit, data, character.gender == "Female"),
        ),
        class_name=tidy_class(class_name) if class_name else None,
        gender=character.gender or None,
        game_id=unit.character,
        look=byleth_look(scenario, in_battle) if unit.character in BYLETH_IDS else None,
    )
