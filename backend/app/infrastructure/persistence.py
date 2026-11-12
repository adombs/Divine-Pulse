"""One JSON file per run in data/runs/ (RunStore), and the run's finished battles in data/battles/ (BattleStore)."""

from __future__ import annotations

import os
import re
import threading
import logging
from pathlib import Path
from collections.abc import Callable, Collection, Mapping

from pydantic import TypeAdapter

from ..domain.battle import Battle, BattleUnitStats
from ..domain.best_unit import best_unit
from ..domain.ebst import EbstConfig
from ..domain.runs import MAIN_SCENARIOS, BestUnit, ChapterRef, RunSummary
from ..domain.membership import on_roster
from ..domain.units import Unit, byleth_look, now
from ..domain.runs import Run
from .saved_models import Run as SavedRun, decode_battle, decode_battles
import json
from .route_inference import route_of
from ..application.ports import MissingRecord
from .json_files import atomic_write_bytes, atomic_write_text, preserve_original, read_with_backup

_BATTLES = TypeAdapter(list[Battle])
log = logging.getLogger(__name__)


class NotFound(MissingRecord):
    pass


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "run"


def _route_snapshot(b: Battle) -> Battle:
    return Battle(
        id=b.id,
        run_id=b.run_id,
        started_at=b.started_at,
        ended_at=b.ended_at,
        scenario=b.scenario,
        map_name=b.map_name,
        units=[
            BattleUnitStats(
                key=u.key,
                name=u.name,
                character=u.character,
                guest=u.guest,
                class_name=u.class_name,
                level=u.level,
                start_level=u.start_level,
                start={},
                now={},
                on_map=u.on_map,
                damage_dealt=u.damage_dealt,
                healing_given=u.healing_given,
                defeats=u.defeats,
                adjutant_of=u.adjutant_of,
                class_id=u.class_id,
                female=u.female,
                look=u.look,
            )
            for u in b.units
        ],
    )


class RunStore:
    def __init__(self, runs_dir: Path):
        self.dir = runs_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._cache: dict[str, Run] = {}
        self.battles: BattleStore | None = None
        # Only route evidence and unit totals are retained, never the maps/logs of archived battles.
        self._route_evidence: dict[str, list[Battle]] = {}
        self._best_units: dict[str, BestUnit | None] = {}

    def _path(self, run_id: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]+", run_id):
            raise NotFound(run_id)
        return self.dir / f"{run_id}.json"

    def _infer_route(self, run: Run) -> str | None:
        if run.id not in self._route_evidence:
            battles = self.battles.list(run.id) if self.battles else []
            active = self.battles.load_active(run.id) if self.battles else None
            self._route_evidence[run.id] = [_route_snapshot(b) for b in [*battles, *([active] if active else [])]]
        return route_of(run, self._route_evidence[run.id])

    def refresh_route(self, run_id: str, battle: Battle | None = None) -> None:
        with self._lock:
            self._best_units.pop(run_id, None)
            if battle is not None and run_id in self._route_evidence:
                evidence = self._route_evidence[run_id]
                evidence[:] = [b for b in evidence if b.id != battle.id]
                evidence.append(_route_snapshot(battle))
            else:
                self._route_evidence.pop(run_id, None)
            try:
                run = self.get(run_id)
            except NotFound:
                return
            if self._cache[run_id].route != run.route:
                self._save(run)

    def _save(self, run: Run) -> None:
        run = Run.model_validate(run.model_dump())
        run.route = self._infer_route(run)
        run.updated_at = now()
        path = self._path(run.id)
        atomic_write_text(path, run.model_dump_json(indent=2), backup=True)
        self._cache[run.id] = run
        self._best_units.pop(run.id, None)  # its roster order breaks ties

    # Runs

    def revision(self, run_id: str) -> tuple | None:
        """Changes whenever the run does, and costs nothing (get() copies the run); None until the run is loaded."""
        with self._lock:
            run = self._cache.get(run_id)
            return None if run is None else (run.updated_at, len(self._route_evidence.get(run_id, ())))

    def get(self, run_id: str) -> Run:
        with self._lock:
            if run_id not in self._cache:
                path = self._path(run_id)
                if not path.exists():
                    raise NotFound(run_id)
                self._cache[run_id] = read_with_backup(path, SavedRun.model_validate_json)
            run = self._cache[run_id].model_copy(deep=True)
            run.route = self._infer_route(run)
            # Recover rosters saved with the old Holy Tomb rule, including when the game isn't running.
            story = [b for b in self._route_evidence.get(run_id, []) if b.scenario in MAIN_SCENARIOS]
            latest = max(story, key=lambda b: b.started_at, default=None)
            if latest and byleth_look(latest.scenario, in_battle=latest.ended_at is None) == "green":
                for key, unit in run.units.items():
                    if unit.game_id in (0, 1) or (unit.game_id is None and key == "byleth"):
                        unit.look = "green"
            return run

    def list(self) -> list[RunSummary]:
        with self._lock:
            runs = []
            for path in self.dir.glob("*.json"):
                try:
                    runs.append(self.get(path.stem))
                except (OSError, ValueError, TypeError):
                    log.exception("Could not load run %s", path)
            runs.sort(key=lambda r: r.updated_at, reverse=True)
            return [
                RunSummary(
                    id=r.id,
                    name=r.name,
                    unit_count=sum(map(on_roster, r.units.values())),
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                    route=r.route,
                    **self._battle_facts(r),
                )
                for r in runs
            ]

    def _battle_facts(self, run: Run) -> dict:
        """The run's finished battles, the newest main-story battle (finished or in progress) and its best unit, from
        the route evidence already held, so listing runs never reads the battle files again."""
        evidence = self._route_evidence.get(run.id, [])
        story = [b for b in evidence if b.scenario is not None and b.scenario in MAIN_SCENARIOS]
        latest = max(story, key=lambda b: b.started_at, default=None)
        if run.id not in self._best_units:
            self._best_units[run.id] = best_unit(evidence, run.units)
        return {
            "battle_count": sum(b.ended_at is not None for b in evidence),
            "last_chapter": ChapterRef(scenario=latest.scenario, name=latest.map_name) if latest else None,
            "best_unit": self._best_units[run.id],
        }

    def create(self, name: str) -> Run:
        with self._lock:
            base = _slug(name)
            run_id, n = base, 2
            while self._path(run_id).exists():
                run_id, n = f"{base}-{n}", n + 1
            run = Run(id=run_id, name=name.strip())
            self._save(run)
            return run.model_copy(deep=True)

    def save(self, run: Run) -> None:
        with self._lock:
            if not self._path(run.id).exists():
                raise NotFound(run.id)
            self._save(run)

    def rename(self, run_id: str, name: str) -> Run:
        with self._lock:
            run = self.get(run_id)
            run.name = name.strip()
            self._save(run)
            return run

    def delete(self, run_id: str) -> None:
        """Moves the run file into runs/deleted/ instead of erasing it."""
        with self._lock:
            path = self._path(run_id)
            if not path.exists():
                raise NotFound(run_id)
            trash = self.dir / "deleted"
            trash.mkdir(exist_ok=True)
            os.replace(path, trash / f"{run_id}-{now():%Y%m%d-%H%M%S}.json")
            path.with_suffix(path.suffix + ".bak").unlink(missing_ok=True)
            self._cache.pop(run_id, None)
            self._route_evidence.pop(run_id, None)
            self._best_units.pop(run_id, None)

    # Units

    def put_unit(self, run_id: str, key: str, unit: Unit) -> None:
        self.apply_units(run_id, {key: unit})

    def apply_units(self, run_id: str, units: Mapping[str, Unit | None]) -> None:
        """Apply a roster batch with one locked run load and one durable save.

        A missing value deletes the key when present. New units inherit the run's
        current eBST defaults, matching ``put_unit``.
        """
        with self._lock:
            run = self.get(run_id)
            changed = False
            for key, unit in units.items():
                if unit is None:
                    if key in run.units:
                        del run.units[key]
                        changed = True
                    continue
                if key not in run.units:
                    unit = unit.model_copy(
                        update={
                            "ebst_offense": run.ebst_default.offense,
                            "ebst_defense": run.ebst_default.defense,
                            "ebst_stats": list(run.ebst_default.stats),
                        }
                    )
                run.units[key] = unit
                changed = True
            if not changed:
                return
            self._save(run)

    def set_ebst(self, run_id: str, config: EbstConfig) -> None:
        """Overwrite every unit and the future-unit default in one locked save."""
        with self._lock:
            run = self.get(run_id)
            run.ebst_default = config.model_copy(deep=True)
            for unit in run.units.values():
                unit.ebst_offense = config.offense
                unit.ebst_defense = config.defense
                unit.ebst_stats = list(config.stats)
            self._save(run)

class BattleStore:
    """Finished battles, one JSON list per run in data/battles/<run id>.json (newest last)."""

    def __init__(self, battles_dir: Path):
        self.dir = battles_dir
        self.on_change: Callable[..., None] | None = None
        self._lock = threading.Lock()

    def _path(self, run_id: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]+", run_id):
            raise NotFound(run_id)
        return self.dir / f"{run_id}.json"

    def list(self, run_id: str) -> list[Battle]:
        with self._lock:
            path = self._path(run_id)
            if not path.exists():
                return []
            try:
                return read_with_backup(path, decode_battles)
            except (OSError, ValueError, TypeError):
                log.exception("Could not load battle history %s", path)
                return []

    def add(self, battle: Battle) -> None:
        with self._lock:
            path = self._path(battle.run_id)
            battles = read_with_backup(path, decode_battles) if path.exists() else []
            battles.append(battle)
            self._write(path, battles)
        if self.on_change:
            self.on_change(battle.run_id, battle)

    def extend(self, run_id: str, battles: list[Battle]) -> None:
        with self._lock:
            path = self._path(run_id)
            existing = read_with_backup(path, decode_battles) if path.exists() else []
            self._write(path, [*existing, *battles])
        if self.on_change:
            self.on_change(run_id)

    def replace(self, run_id: str, battles: list[Battle]) -> None:
        with self._lock:
            self._write(self._path(run_id), battles)
        if self.on_change:
            self.on_change(run_id)

    def delete(self, run_id: str, battle_id: str) -> None:
        with self._lock:
            path = self._path(run_id)
            battles = read_with_backup(path, decode_battles) if path.exists() else []
            kept = [b for b in battles if b.id != battle_id]
            if len(kept) == len(battles):
                raise NotFound(battle_id)
            self._write(path, kept)
        if self.on_change:
            self.on_change(run_id)

    # Copies of a battle the user (or "keep best") set aside, in data/battles/<run id>.discarded.json.

    def _discarded_path(self, run_id: str) -> Path:
        return self._path(run_id).with_suffix(".discarded.json")

    def discarded(self, run_id: str) -> list[Battle]:
        with self._lock:
            path = self._discarded_path(run_id)
            if not path.exists():
                return []
            try:
                return read_with_backup(path, decode_battles)
            except (OSError, ValueError, TypeError):
                log.exception("Could not load discarded battles %s", path)
                return []

    def discard(self, run_id: str, ids: Collection[str]) -> list[str]:
        """Move battles out of the history into the discarded file; returns the ids moved (unknown ids are ignored)."""
        with self._lock:
            path = self._path(run_id)
            battles = read_with_backup(path, decode_battles) if path.exists() else []
            moving = [b for b in battles if b.id in ids]
            if not moving:
                return []
            side = self._discarded_path(run_id)
            aside = read_with_backup(side, decode_battles) if side.exists() else []
            self._write(side, [*aside, *moving])  # set aside first: a failed second write loses nothing
            self._write(path, [b for b in battles if b.id not in ids])
        if self.on_change:
            self.on_change(run_id)
        return [b.id for b in moving]

    def restore(self, run_id: str, ids: Collection[str]) -> list[str]:
        """Move discarded battles back into the history (kept ordered by id); returns the ids moved."""
        with self._lock:
            side = self._discarded_path(run_id)
            aside = read_with_backup(side, decode_battles) if side.exists() else []
            moving = [b for b in aside if b.id in ids]
            if not moving:
                return []
            path = self._path(run_id)
            battles = read_with_backup(path, decode_battles) if path.exists() else []
            self._write(path, sorted([*battles, *moving], key=lambda b: b.id))
            self._write(side, [b for b in aside if b.id not in ids])
        if self.on_change:
            self.on_change(run_id)
        return [b.id for b in moving]

    def take_latest(self, run_id: str, key: str) -> Battle | None:
        """Take the newest battle of the run out of the history if its battle key is `key` (to carry on with it)."""
        with self._lock:
            path = self._path(run_id)
            battles = read_with_backup(path, decode_battles) if path.exists() else []
            if not key or not battles or battles[-1].key != key:
                return None
            battle = battles.pop()
            self._write(path, battles)
            return battle

    def delete_run(self, run_id: str) -> None:
        """Forget a deleted run's battles (a new run with the same name gets the same ID)."""
        with self._lock:
            path = self._path(run_id)
            path.unlink(missing_ok=True)
            self._active_path(run_id).unlink(missing_ok=True)
            path.with_suffix(path.suffix + ".bak").unlink(missing_ok=True)
            active = self._active_path(run_id)
            active.with_suffix(active.suffix + ".bak").unlink(missing_ok=True)
            side = self._discarded_path(run_id)
            side.unlink(missing_ok=True)
            side.with_suffix(side.suffix + ".bak").unlink(missing_ok=True)

    # The battle in progress, saved so a restart of the tracker mid-battle can resume it.

    def _active_path(self, run_id: str) -> Path:
        return self._path(run_id).with_suffix(".active.json")

    def save_active(self, battle: Battle) -> None:
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            path = self._active_path(battle.run_id)
            atomic_write_text(path, battle.model_dump_json(), backup=True)
        if self.on_change:
            self.on_change(battle.run_id, battle)

    def load_active(self, run_id: str) -> Battle | None:
        with self._lock:
            path = self._active_path(run_id)
            if not path.exists():
                return None
            try:
                return read_with_backup(path, lambda text: decode_battle(json.loads(text)))
            except (OSError, ValueError, TypeError):
                log.exception("Could not read active battle %s; preserving the unreadable file.", path)
                try:
                    preserve_original(path, suffix=".broken.json")
                    path.unlink()
                except OSError:
                    log.exception("Could not preserve unreadable active battle %s.", path)
                return None

    def clear_active(self, run_id: str) -> None:
        with self._lock:
            path = self._active_path(run_id)
            path.unlink(missing_ok=True)
            path.with_suffix(path.suffix + ".bak").unlink(missing_ok=True)
        if self.on_change:
            self.on_change(run_id)

    def _write(self, path: Path, battles: list[Battle]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        atomic_write_bytes(path, _BATTLES.dump_json(battles, indent=2), backup=True)
