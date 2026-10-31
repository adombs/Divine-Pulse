"""Applying readings to stored units, including partial readings from screens that show
only some fields (e.g. a future level-up popup without Mv or abilities)."""

from app.bonuses import BonusTable
from app.config import BONUSES_FILE
from app.handlers import apply_unit_stats
from app.domain.units import SkillProgress, Unit
from app.infrastructure.saved_models import Run
from app.domain.readings import AbilityInfo, UnitStatsReading

TABLE = BonusTable.load(BONUSES_FILE)
FULL = dict(hp=32, mv=4, str=4, mag=23, dex=15, spd=13, lck=8, **{"def": 4}, res=11, cha=9)


def status_reading(**overrides):
    values = {**FULL, **overrides}
    return UnitStatsReading(
        screen="status",
        name_candidates=["Lysithea"],
        full_name="Lysithea von Ordelia",
        values=values,
        blue={"hp", "mag"},
        abilities=AbilityInfo(personal="Mastermind", equipped=["HP+5", "Magic+2"]),
    )


def run_with(unit: Unit | None = None) -> Run:
    run = Run(id="r", name="r")
    if unit:
        run.units["lysithea"] = unit
    return run


def test_new_unit_from_full_reading():
    out = apply_unit_stats(status_reading(), run_with(), TABLE)
    assert out.is_new and out.changed and out.warnings == []
    u = out.changes[0].after
    assert u.base()["mag"] == 21 and u.base()["hp"] == 27


def test_partial_reading_keeps_unshown_fields_and_bonuses():
    first = apply_unit_stats(status_reading(), run_with(), TABLE).changes[0].after
    # A level-up style screen: no Mv, no abilities, Mag +1 and still blue.
    level_up = UnitStatsReading(
        screen="level_up",
        name_candidates=["Lysithea"],
        values={k: v for k, v in {**FULL, "mag": 24}.items() if k != "mv"},
        blue={"hp", "mag"},
    )
    out = apply_unit_stats(level_up, run_with(first), TABLE)
    u = out.changes[0].after
    assert u.displayed["mv"] == 4  # kept
    assert u.bonuses == {"hp": 5, "mag": 2}  # kept from the Status scan
    assert u.base()["mag"] == 22
    assert u.full_name == "Lysithea von Ordelia"
    assert not out.is_new and out.changed


def test_blue_only_reset_for_shown_fields():
    first = apply_unit_stats(status_reading(), run_with(), TABLE).changes[0].after
    partial = UnitStatsReading(screen="x", name_candidates=["Lysithea"], values={"str": 5}, blue=set())
    u = apply_unit_stats(partial, run_with(first), TABLE).changes[0].after
    assert set(u.blue) == {"hp", "mag"}  # HP/Mag not shown: still blue


def test_identical_reading_is_not_a_change():
    first = apply_unit_stats(status_reading(), run_with(), TABLE).changes[0].after
    assert not apply_unit_stats(status_reading(), run_with(first), TABLE).changed


def test_skill_only_progress_change_is_persisted_and_reported():
    first = status_reading()
    first.abilities.skills = {"reason": SkillProgress(rank="A", exp=67)}
    unit = apply_unit_stats(first, run_with(), TABLE).changes[0].after
    changed = status_reading()
    changed.abilities.skills = {"reason": SkillProgress(rank="A", exp=68)}

    outcome = apply_unit_stats(changed, run_with(unit), TABLE)

    assert outcome.changed
    assert outcome.changes[0].after.skills["reason"].exp == 68


def test_reading_without_skill_data_keeps_stored_progress():
    memory = status_reading()
    memory.abilities.skills = {"reason": SkillProgress(rank="A", exp=67)}
    unit = apply_unit_stats(memory, run_with(), TABLE).changes[0].after
    partial = UnitStatsReading(screen="level_up", name_candidates=["Lysithea"], values={"mag": 24})

    updated = apply_unit_stats(partial, run_with(unit), TABLE).changes[0].after

    assert updated.skills == {"reason": SkillProgress(rank="A", exp=67)}


def test_class_and_gender_are_stored_and_kept_when_not_shown():
    reading = status_reading()
    reading.class_name, reading.gender = "Mage", "Female"
    first = apply_unit_stats(reading, run_with(), TABLE).changes[0].after
    assert (first.class_name, first.gender) == ("Mage", "Female")
    # A later screen without gender (level-up) updates the class but keeps the gender.
    promoted = UnitStatsReading(screen="level_up", name_candidates=["Lysithea"], values={"mag": 22},
                                class_name="Warlock")
    out = apply_unit_stats(promoted, run_with(first), TABLE)
    u = out.changes[0].after
    assert (u.class_name, u.gender) == ("Warlock", "Female") and out.changed
