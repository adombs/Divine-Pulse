import pytest

from app import names
from app.classes import tidy_class
from app.roster import resolve_name


@pytest.fixture(autouse=True)
def tables(roster_import):
    return roster_import


def test_unknown_names_are_kept():
    assert resolve_name(["Xyzzy"], []) == "Xyzzy"


def test_existing_units_win_over_the_roster():
    assert resolve_name(["Profesor"], ["Professor"]) == "Professor"


@pytest.mark.parametrize(
    "reading, expected",
    [
        ("Gremroy", "Gremory"),
        ("wyvern 1ord", "Wyvern Lord"),
        ("Armoured Knight", "Armored Knight"),
        ("Pegasus Knigth", "Pegasus Knight"),
        ("", ""),
        ("Totally Custom", "Totally Custom"),
    ],
)
def test_classes(reading, expected):
    assert tidy_class(reading) == expected


def test_numbers_must_agree():
    # A misread level or bonus is never "corrected" into a different one.
    assert names.similarity("Lance Prowess Lv 2", "Lance Prowess Lv 3") == 0.0
    assert names.similarity("HP +5", "HP +3") == 0.0


def test_ocr_confusions_count_as_near_identical():
    assert names.similarity("Clairn", "Claim") > 0.95  # rn read for m
    assert names.similarity("B0w Knight", "Bow Knight") > 0.95


def test_clean_text_drops_control_characters():
    assert names.clean_text("a\x00b\tc\n  d") == "ab c d"
