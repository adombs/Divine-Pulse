"""Construct the local backend. This is the only place that assembles all layers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import __version__
from .application.operations import BackendOperations
from .bonuses import BonusTable
from .infrastructure.events import EventBus
from .infrastructure.game_assets_import import GameAssetsImport
from .infrastructure.json_files import take_notices
from .gamemem.recorder import BattleRecorder
from .infrastructure.paths import BONUSES_FILE
from .infrastructure.persistence import BattleStore, RunStore
from .infrastructure.runtime_services import MemoryCheck, SystemAdapter
from .infrastructure.route_inference import route_of
from .infrastructure.settings import SettingsStore
from .infrastructure.game_assets import game_assets
from .interface.runtime import RuntimeView
from .infrastructure.polling import Scanner


@dataclass
class AppRuntime(RuntimeView):
    events: EventBus
    settings: SettingsStore
    store: RunStore
    battles: BattleStore
    scanner: Scanner

    def close(self) -> None:
        try:
            self.scanner.stop()
        finally:
            self.events.close()


def build_runtime(data_dir: Path, settings: SettingsStore | None = None) -> AppRuntime:
    settings = settings or SettingsStore(data_dir / "settings.json")
    game_assets().language = lambda: settings.get().game_language
    runs = RunStore(data_dir / "runs")
    battles = BattleStore(data_dir / "battles")
    runs.battles = battles
    battles.on_change = runs.refresh_route
    events = EventBus()
    scanner = Scanner(
        runs,
        settings,
        events,
        BonusTable.load(BONUSES_FILE),
        battles=battles,
        recorder=BattleRecorder(data_dir / "battle-recordings"),
    )
    operations = BackendOperations(
        runs=runs,
        battles=battles,
        settings=settings,
        events=events,
        scanner=scanner,
        memory_check=MemoryCheck(),
        system=SystemAdapter(),
        data_dir=settings.path.parent,
        route_resolver=lambda battle: route_of(None, [battle]),
        version=__version__,
    )
    return AppRuntime(operations, events, settings, runs, battles, scanner,
                      game_import=GameAssetsImport(settings, events), take_notices=take_notices)
