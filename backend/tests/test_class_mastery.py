"""Class mastery: the per-class progress in a roster slot and which classes a unit counts as having mastered."""

import struct

import pytest

from app.bonuses import BonusTable
from app.config import BONUSES_FILE
from app.domain.units import Unit
from app.gamemem import fe3h
from app.gamemem.fe3h import MASTERY_PROGRESS, RosterUnit, decode_class_progress, decode_roster
from app.gamemem.units import GameData, to_reading
from helpers.synthetic_roster import KEYS, Slot, build_slot

FIGHTER, MONK, MERCENARY, MAGE, NOBLE = 4, 5, 7, 14, 0


@pytest.fixture
def data(roster_import):
    return GameData.load()


@pytest.fixture
def bonuses():
    return BonusTable.load(BONUSES_FILE)


def unit(class_progress=None, learned_arts=(), class_id=MERCENARY, character=0) -> RosterUnit:
    raw = {k: 10 for k in KEYS}
    return RosterUnit(character, 20, class_id, raw, (), None, learned_arts=tuple(learned_arts),
                      class_progress=class_progress or {})


def mastered(data, bonuses, **kwargs) -> list[str]:
    return to_reading(unit(**kwargs), data, bonuses).abilities.mastered_classes


def test_decodes_the_progress_of_each_class_by_id():
    slot = build_slot(Slot(4, class_id=MERCENARY, class_progress={MERCENARY: 69, 42: 9, 99: 100}))

    assert decode_class_progress(slot) == {MERCENARY: 69, 42: 9, 99: 100}
    assert decode_roster(slot)[0].class_progress == {MERCENARY: 69, 42: 9, 99: 100}


def test_a_slot_with_no_progress_or_a_truncated_one_reads_none():
    assert decode_class_progress(build_slot(Slot(4))) == {}
    assert decode_class_progress(build_slot(Slot(4))[: fe3h._CLASS_PROGRESS + 10]) == {}


def test_the_progress_field_ends_where_the_next_field_starts():
    slot = bytearray(build_slot(Slot(4)))
    struct.pack_into("<H", slot, fe3h._CLASS_PROGRESS + 2 * fe3h.CLASS_COUNT, 7)  # the field after class 99

    assert decode_class_progress(bytes(slot)) == {}


def test_a_class_at_the_maximum_progress_is_mastered(data, bonuses):
    assert mastered(data, bonuses, class_progress={MERCENARY: MASTERY_PROGRESS}) == ["Mercenary"]


def test_progress_short_of_the_maximum_is_not_mastery(data, bonuses):
    assert mastered(data, bonuses, class_progress={MERCENARY: MASTERY_PROGRESS - 1, MAGE: 3}) == []


def test_a_learned_mastery_art_marks_its_class_even_though_progress_reads_zero(data, bonuses):
    assert mastered(data, bonuses, learned_arts=(50, 53), class_progress={FIGHTER: 1}) == ["Fighter", "Monk"]


def test_a_mastery_art_below_the_mastery_range_proves_nothing(data, bonuses, monkeypatch):
    game_class = data.classes[FIGHTER]
    monkeypatch.setitem(data.classes, FIGHTER, type(game_class)(**{**game_class.__dict__, "mastery_art": 3}))

    assert mastered(data, bonuses, learned_arts=(3,)) == []


def test_classes_come_out_once_each_in_class_order_and_the_starting_classes_never_count(data, bonuses):
    result = mastered(data, bonuses, learned_arts=(53, 50),
                      class_progress={MAGE: 100, FIGHTER: 100, NOBLE: 100, 77: 100})

    assert result == ["Fighter", "Monk", "Mage"]


def test_a_class_without_a_mastery_reward_is_not_listed(data, bonuses):
    assert mastered(data, bonuses, class_progress={85: 100}) == []


def test_a_female_unit_gets_the_female_class_name(data, bonuses):
    reading = to_reading(unit(class_progress={85: 100}, character=23), data, bonuses)

    assert reading.abilities.mastered_classes == []  # no reward: still not listed
    data.classes[85] = type(data.classes[85])(**{**data.classes[85].__dict__, "masterable": True})
    assert to_reading(unit(class_progress={85: 100}, character=23), data, bonuses).abilities.mastered_classes == ["War Cleric"]


def test_a_stored_unit_keeps_the_field_and_an_older_one_loads_without_it():
    assert Unit(name="Byleth").mastered_classes is None
    assert Unit(name="Byleth", mastered_classes=[]).mastered_classes == []
    assert Unit.model_validate({"name": "Byleth", "mastered_classes": ["Fighter"]}).model_dump(mode="json")[
        "mastered_classes"] == ["Fighter"]
