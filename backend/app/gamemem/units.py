"""Turn roster units into readings (app/readings.py) that app/handlers.py applies.

What the Status page shows, built from the game's own numbers:

    on screen = raw stat + class boost + mounted boost (mounted classes) + ability and accessory bonuses

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
        )

    def ability(self, ability_id: int) -> str | None:
        name = self.abilities[ability_id] if 0 <= ability_id < len(self.abilities) else None
        return _known_ability(name) if name else None


def _known_ability(name: str) -> str:
    """The tracker's spelling of an ability ("Lily’s Poise" with a curly apostrophe, as the Status page shows)."""
    return names.snap(name, names.abilities(), 0.9)


def unit_name(unit: RosterUnit, data: GameData, player_name: str | None) -> str:
    if unit.character in BYLETH_IDS and player_name:
        return player_name
    character = data.characters.get(unit.character)
    return character.name if character else f"Character {unit.character}"


def to_reading(
    unit: RosterUnit,
    data: GameData,
    bonuses: BonusTable,
    *,
    player_name: str | None = None,
    current_personal: str | None = None,
    scenario: int | None = None,
    in_battle: bool = False,
) -> UnitStatsReading:
    """The unit's Status-page values decoded from memory.

    `current_personal` is the personal ability already stored for the unit: the game keeps an upgraded
    ("+") version of a few personal abilities, and the stored one is kept if it's either version.
    """
    character = data.characters.get(unit.character, Character(name=f"Character {unit.character}"))
    game_class = data.classes.get(unit.class_id, GameClass(name=f"Unknown class {unit.class_id}"))
    name = unit_name(unit, data, player_name)

    personal = character.personal or ""
    if current_personal and character.personal_plus and names.normalize(current_personal) == names.normalize(_known_ability(character.personal_plus)):
        personal = character.personal_plus
    personal = _known_ability(personal) if personal else ""
    equipped = [a for a in (data.ability(i) for i in unit.abilities) if a]
    accessory = data.equipment[unit.accessory] if unit.accessory is not None and 0 <= unit.accessory < len(data.equipment) else None

    bonus = bonuses.compute(equipped, personal, accessory)
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
            # None means the assignment could not be named, whereas an empty string
            # explicitly clears a previously stored assignment.
            battalion=("" if unit.battalion is None else
                       (data.battalions[unit.battalion] or None)
                       if 0 <= unit.battalion < len(data.battalions) else None),
            skills=unit.skills,
        ),
        class_name=tidy_class(class_name) if class_name else None,
        gender=character.gender or None,
        game_id=unit.character,
        look=byleth_look(scenario, in_battle) if unit.character in BYLETH_IDS else None,
    )
