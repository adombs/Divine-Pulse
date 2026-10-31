"""The API accepts decoded skill data and defaults to empty when no reading exists."""

from app.domain.units import SkillProgress, Unit


def test_unit_defaults_to_no_current_skill_data():
    unit = Unit(name="Lysithea")

    assert unit.skills == {}


def test_unit_accepts_skill_rank_and_exp():
    unit = Unit(name="Lysithea", skills={"reason": {"rank": "A", "exp": 420}})

    assert unit.skills["reason"] == SkillProgress(rank="A", exp=420)
