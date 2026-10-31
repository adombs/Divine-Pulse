"""Focused coverage for the domain models and rules."""

import pytest
from pydantic import ValidationError

from app.domain.ebst import EbstConfig
from app.domain.handlers import apply_unit_stats
from app.domain.inventory import InventoryItem
from app.domain.readings import UnitStatsReading
from app.domain.runs import Run
from app.domain.units import SkillProgress, Unit


class NoBonuses:
    def compute(self, equipped, personal, accessory):
        return {}


def test_domain_models_keep_existing_saved_field_names():
    unit = Unit(
        name="Lysithea",
        game_id=22,
        inventory=[InventoryItem(id=24, name="Heal", kind="spell", uses=5, weapon="faith")],
        skills={"reason": {"rank": "A+", "exp": 420}},
    )
    saved = unit.model_dump(mode="json")

    assert saved["game_id"] == 22
    assert saved["ebst_offense"] == "auto" and saved["ebst_stats"] == ["hp", "spd"]
    assert saved["inventory"][0]["weapon"] == "faith"
    assert saved["skills"]["reason"] == {"rank": "A+", "exp": 420}


def test_ebst_config_rejects_unknown_keys_and_canonicalizes_supported_keys():
    with pytest.raises(ValidationError):
        EbstConfig(stats=["hp", "bogus"])

    config = EbstConfig(stats=["cha", "hp", "hp"])
    assert config.stats == ["hp", "cha"]


def test_skill_progress_preserves_nonnegative_exp_without_domain_cap():
    assert SkillProgress(rank="S+", exp=100000).exp == 100000


def test_character_identity_only_change_is_not_discarded():
    run = Run(id="run", name="Run", units={"lysithea": Unit(name="Lysithea")})
    reading = UnitStatsReading(screen="memory", name_candidates=["Lysithea"], values={}, game_id=22)

    result = apply_unit_stats(reading, run, NoBonuses(), lambda candidates, existing: candidates[0])

    assert result.changed
    assert result.changes[0].after.game_id == 22


def test_domain_unit_rejects_unknown_stat_keys_and_negative_game_ids():
    with pytest.raises(ValidationError):
        Unit(name="Lysithea", displayed={"hp": 30, "luck": 9})
    with pytest.raises(ValidationError):
        Unit(name="Lysithea", game_id=-1)


def test_domain_updates_cannot_assign_an_invalid_source():
    unit = Unit(name="Lysithea", source="memory")
    with pytest.raises(ValidationError):
        unit.source = "mystery"
    assert unit.source == "memory"
