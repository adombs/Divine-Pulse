"""Made-up saved runs and battles, written the way the app saves them, and the older shapes it still has to read."""

from datetime import datetime, timedelta, timezone

from app.domain.battle import Battle, BattleUnitStats, EnemyStats, LogEntry, Usage
from app.domain.inventory import InventoryItem
from app.domain.units import SkillProgress, Unit
from app.infrastructure.saved_models import Run

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
STATS = {"hp": 40, "mv": 4, "str": 20, "mag": 10, "dex": 14, "spd": 15, "lck": 12, "def": 8, "res": 7, "cha": 9}


def a_unit(name: str, **changes) -> Unit:
    fields = {
        "name": name, "full_name": f"{name} Test", "class_name": "Mercenary", "gender": "Female", "displayed": dict(STATS),
        "bonuses": {"hp": 5}, "manual_bonuses": {"str": 1}, "blue": ["hp"], "personal_ability": "Steady Hands",
        "abilities": ["HP +5", "Close Counter"], "accessory": "March Ring", "combat_arts": ["Wrath Strike"],
        "inventory": [InventoryItem(id=16, name="Iron Sword", kind="weapon", uses=33, full=40, equipped=True, weapon="sword"),
                      InventoryItem(id=14, name="Miasma", kind="spell", uses=5, weapon="dark")],
        "learned_abilities": ["HP +5"], "learned_arts": ["Wrath Strike"], "battalion": "Test Soldiers",
        "skills": {"sword": SkillProgress(rank="B", exp=171), "bow": SkillProgress(rank="C+", exp=14)},
        "source": "memory", "game_id": 4, "ebst_offense": "physical", "ebst_defense": "magical", "ebst_stats": ["hp", "spd"],
        "portrait_gender": "female", "look": "green", "updated_at": T0,
    }
    return Unit(**{**fields, **changes})


def saved_runs() -> dict[str, dict]:
    """Saved runs by case: what the app writes today, a bare one, and files from before newer fields existed."""
    full = Run(id="full", name="Full run", created_at=T0, updated_at=T0 + timedelta(hours=2), route="vw",
               units={"alder": a_unit("Alder"), "birch": a_unit("Birch", accessory=None, game_id=None, source="manual")})
    current = full.model_dump(mode="json")
    bare = {"id": "bare", "name": "Bare"}
    minimal_unit = {"name": "Cedar", "displayed": dict(STATS)}  # a unit saved before abilities, inventory and skills existed
    old = {"id": "old", "name": "Old", "units": {"cedar": minimal_unit}}
    # An inventory saved before the weapon icons were derived from the tables.
    old_icons = {"id": "old-icons", "name": "Old icons", "units": {"elm": {**minimal_unit, "name": "Elm", "inventory": [
        {"id": 14, "name": "Miasma", "kind": "spell", "uses": 5, "weapon": "faith"}]}}}
    return {"full": current, "bare": bare, "old": old, "old_icons": old_icons}


def a_battle(run_id="full", battle_id="b1", **changes) -> Battle:
    log = [LogEntry(t=0.0, turn=1, kind="phase", text="Fight!", step=0),
           LogEntry(t=4.0, turn=1, kind="attack", text="Alder's attack dealt 9 damage to Brigand 1.", actor_id="a:alder",
                    target_id="e:200", step=1, dealt=9)]
    fields = dict(
        id=battle_id, run_id=run_id, started_at=T0, ended_at=T0 + timedelta(minutes=30), scenario=0, map_name="First Trial",
        units=[BattleUnitStats(
            key="alder", name="Alder", start_level=16, level=17, start=dict(STATS), now=dict(STATS),
            inventory=[InventoryItem(id=14, name="Miasma", kind="spell", uses=5, weapon="dark")],
            usage=[Usage(kind="spell", id=14, name="Miasma", weapon="dark")],
        )],
        enemy_stats={200: EnemyStats(slot=200, label="Brigand 1", person_id=509)},
        log=log,
    )
    return Battle(**{**fields, **changes})
