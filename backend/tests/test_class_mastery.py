"""Class mastery: the game's per-class "mastered" flags in a roster slot and the class names a unit reading carries."""

import struct

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE
from app.domain.units import Unit
from app.gamemem import fe3h
from app.gamemem.fe3h import RosterUnit, decode_mastered_classes, decode_roster
from app.gamemem.units import GameData, to_reading
from helpers.synthetic_roster import KEYS, Slot, build_slot

FIGHTER, MONK, MERCENARY, MAGE, NOBLE, COMMONER = 4, 5, 7, 14, 0, 1


@pytest.fixture
def data(roster_import):
    return GameData.load()


@pytest.fixture
def bonuses():
    return BonusTable.load(BONUSES_FILE)


def unit(mastered=(), class_id=MERCENARY, character=0) -> RosterUnit:
    return RosterUnit(character, 20, class_id, {k: 10 for k in KEYS}, (), None, mastered_classes=tuple(mastered))


def mastered(data, bonuses, **kwargs) -> list[str]:
    return to_reading(unit(**kwargs), data, bonuses).abilities.mastered_classes


def test_decodes_the_mastered_classes_by_id():
    slot = build_slot(Slot(4, class_id=MERCENARY, mastered_classes=(NOBLE, FIGHTER, 99)))

    assert decode_mastered_classes(slot) == (NOBLE, FIGHTER, 99)
    assert decode_roster(slot)[0].mastered_classes == (NOBLE, FIGHTER, 99)


def test_a_slot_with_no_flags_or_a_truncated_one_reads_none():
    assert decode_mastered_classes(build_slot(Slot(4))) == ()
    assert decode_mastered_classes(build_slot(Slot(4))[: fe3h._CLASS_MASTERED + 3]) == ()


def test_only_a_flag_of_one_counts_and_the_field_ends_with_the_slot():
    slot = bytearray(build_slot(Slot(4)))
    slot[fe3h._CLASS_MASTERED + FIGHTER] = 2
    slot[fe3h._CLASS_MASTERED + MONK] = 1
    assert fe3h._CLASS_MASTERED + fe3h.CLASS_COUNT == fe3h.SLOT_SIZE - 1  # class 99's flag is the slot's last byte but one

    assert decode_mastered_classes(bytes(slot)) == (MONK,)


def test_mastering_a_class_flips_its_flag_and_nothing_else_of_the_unit_reading(data, bonuses):
    """What the user's battle showed: the unit's progress toward the class went back to 0 and its flag went to 1."""
    before = bytearray(build_slot(Slot(0, class_id=MERCENARY, mastered_classes=(NOBLE,))))
    struct.pack_into("<H", before, 0x112 + 2 * MERCENARY, 98)  # nearly there, not yet mastered
    after = bytearray(before)
    struct.pack_into("<H", after, 0x112 + 2 * MERCENARY, 0)
    after[fe3h._CLASS_MASTERED + MERCENARY] = 1

    assert to_reading(decode_roster(bytes(before))[0], data, bonuses).abilities.mastered_classes == ["Noble"]
    assert to_reading(decode_roster(bytes(after))[0], data, bonuses).abilities.mastered_classes == ["Noble", "Mercenary"]


def test_the_names_come_out_once_each_lowest_tier_first(data, bonuses):
    assert mastered(data, bonuses, mastered=(MAGE, MONK, FIGHTER, COMMONER, NOBLE)) == [
        "Noble", "Commoner", "Fighter", "Monk", "Mage"]


def test_noble_and_commoner_are_mastered_like_any_other_class(data, bonuses):
    """Units master them (the flag is 0 on a unit still in the class), and they lead the list as the game's tier 0."""
    assert mastered(data, bonuses, mastered=(COMMONER,), class_id=COMMONER) == ["Commoner"]
    assert mastered(data, bonuses, mastered=(), class_id=NOBLE) == []


def test_a_class_unknown_to_the_import_is_not_listed(data, bonuses):
    assert mastered(data, bonuses, mastered=(FIGHTER, 98, 99)) == ["Fighter"]


def test_a_female_unit_gets_the_female_class_name(data, bonuses):
    assert to_reading(unit(mastered=(85,), character=23), data, bonuses).abilities.mastered_classes == ["War Cleric"]
    assert to_reading(unit(mastered=(85,), character=32), data, bonuses).abilities.mastered_classes == ["War Monk"]


def test_a_stored_unit_keeps_the_field_and_an_older_one_loads_without_it():
    assert Unit(name="Byleth").mastered_classes is None
    assert Unit(name="Byleth", mastered_classes=[]).mastered_classes == []
    assert Unit.model_validate({"name": "Byleth", "mastered_classes": ["Fighter"]}).model_dump(mode="json")[
        "mastered_classes"] == ["Fighter"]
