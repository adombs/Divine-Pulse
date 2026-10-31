"""A BattleTracker wired to the bundled game data, and the battle values the tests and tools/demo_battle.py use."""

from pathlib import Path

from .application.battle_tracking import BattleTracker as _BattleTracker
from .domain.battle import (
    STEP_ATTACK as STEP_ATTACK,
    STEP_DEFEAT as STEP_DEFEAT,
    STEP_ITEM as STEP_ITEM,
    STEP_SPELL as STEP_SPELL,
    STEP_WAIT as STEP_WAIT,
    ArmySample as ArmySample,
    Battle as Battle,
    BattleSample as BattleSample,
    BattleUnitStats as BattleUnitStats,
    EnemySample as EnemySample,
    EnemyStats as EnemyStats,
    HistoryStep as HistoryStep,
    StepUnit as StepUnit,
    continues as continues,
    power as power,
    side_of as side_of,
)
from .infrastructure.battle_data import (
    scenario_name as scenario_name,
    terrain_tiles as terrain_tiles,
)
from .infrastructure.battle_support import DefaultBattleSupport


class BattleTracker(_BattleTracker):
    """Construct the application tracker with the bundled runtime adapters."""

    def __init__(self, check_dir: Path | None = None) -> None:
        super().__init__(DefaultBattleSupport(), check_dir)
