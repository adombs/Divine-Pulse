"""Background worker that reads FE3H running in an emulator (Eden) and keeps the active run up to date.

Every `auto_interval_s` (`battle_interval_s` during a battle) it reads the whole army from game memory
(app/gamemem). A change is applied once two reads in a row agree, and each poll that changed anything is
saved atomically. It also follows the battle in progress for the Battle page.

How a reading changes the data lives in app/handlers.py.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from functools import partial
from datetime import timedelta

from ..domain.battle import (
    ArmySample,
    Battle,
    BattleEvent,
    BattleSample,
    EnemySample,
    HistoryStep,
    StepUnit,
    continues,
    power,
    side_of,
)
from ..bonuses import BonusTable
from ..config import SettingsStore
from ..domain.settings import DEFAULT_BATTLE_INTERVAL, DEFAULT_ROSTER_INTERVAL
from ..events import EventBus
from .game_assets import game_assets
from . import game_tables
from ..gamemem.battle import FlagWatch
from ..gamemem.combat import weapon_kind
from ..gamemem.fe3h import EQUIPPED_WEAPON, ROSTER_SIZE, GameMemory, GameMemoryError, Snapshot, decode_player_name, decode_roster
from ..gamemem.readers import emulators_for
from ..gamemem.recorder import BattleRecorder
from ..gamemem.units import SCREEN_TITLE as MEMORY_TITLE
from ..gamemem.units import GameData, to_reading, unit_name
from ..inventory import EQUIPMENT, item_name
from ..handlers import handle
from ..application.roster_tracking import RosterUpdates
from ..application.battle_tracking import BattleTracker
from .battle_support import DefaultBattleSupport
from ..domain import deaths
from ..domain.changes import UnitChange
from ..domain.units import unit_key
from ..storage import BattleStore, NotFound, RunStore

log = logging.getLogger(__name__)

NEEDS_IMPORT = "Import your game files first"


def history_steps(entries: list, start: int | None, keys: dict[int, str], on_map: list) -> tuple[HistoryStep, ...]:
    """The game's battle history (gamemem.history.HistoryEntry) with units named the tracker's way: "a:<key>" for
    the army, "e:<slot>" for the others. `start`: the pool slot of index 0 (none yet: no history)."""
    if start is None:
        return ()
    # Army units not on the map (adjutants) are left out: the history lists them too. Other units off the map now
    # (reinforcements still to come, a unit the story took off it) stay in: when each is on the map is tracked as
    # the battle goes (Battle.map_presence), as they come and go.
    hidden = {f"a:{keys[u.character]}" for u in on_map if u.off_map and u.army and u.character in keys}
    on_map = [u for u in on_map if not u.off_map]
    army = {u.slot: keys[u.character] for u in on_map if u.army and u.character in keys}
    # A unit that fell has no live battle copy any more, so its record no longer reads as the army's. (Some army
    # units also have a second record that isn't theirs to play: only a character with no army record is taken.)
    fielded = {keys[u.character] for u in on_map if u.army and u.character in keys}
    for u in on_map:
        if not u.army and u.character in keys and keys[u.character] not in fielded and u.hp == 0:
            army[u.slot] = keys[u.character]

    def uid(index: int | None) -> str | None:
        if index is None:
            return None
        slot = start + index
        return f"a:{army[slot]}" if slot in army else f"e:{slot}"

    steps = []
    for entry in entries:
        units = []
        for u in entry.units:
            if u.character is None:
                units.append(StepUnit(uid(u.index), u.hp, u.x, u.y))
            elif u.character in keys:
                units.append(
                    StepUnit(
                        f"a:{keys[u.character]}", u.hp, u.x, u.y, u.max_hp, u.items, u.spell_uses, u.spells, u.abilities
                    )
                )
        units = [u for u in units if u.uid not in hidden]
        target = uid(entry.target)
        if entry.rallied is not None and entry.rallied in keys:  # Rally names the unit rallied by character ID
            target = f"a:{keys[entry.rallied]}"
        steps.append(
            HistoryStep(
                entry.turn,
                entry.phase,
                entry.phase_start,
                entry.action,
                uid(entry.actor),
                target,
                entry.moved,
                tuple(units),
                entry.item,
                entry.spell,
                entry.art,
                entry.rally,
                entry.gambit,
            )
        )
    return tuple(steps)


class Scanner:
    def __init__(
        self,
        store: RunStore,
        settings: SettingsStore,
        events: EventBus,
        bonuses: BonusTable,
        memory: GameMemory | None = None,
        battles: BattleStore | None = None,
        recorder: BattleRecorder | None = None,
    ):
        self.store = store
        self.settings = settings
        self.events = events
        self.bonuses = bonuses
        self.roster_updates = RosterUpdates(store, partial(handle, bonuses=bonuses))
        self._reader = settings.get().memory_reader
        self.memory = memory or GameMemory(emulators_for(self._reader))
        self._game_data: GameData | None = None
        self._game_generation: tuple | None = None
        # Battle in progress (game memory only): the tracker, finished battles' store, and the last sample seen
        # (a sample is used once two reads in a row agree, like unit updates).
        self.battle_store = battles
        self.recorder = recorder
        # The last check for dead units that loaded the battles: (run ID, units missing, battles file stamp).
        self._deaths_checked: tuple | None = None
        self._battles = BattleTracker(DefaultBattleSupport())
        self._battle_sample: BattleSample | None = None
        self._sample_made: tuple[tuple, BattleSample] | None = None  # the last battle sample and what it was made from
        self._flag_watch = FlagWatch()  # every unit's flags byte, read to read: unknown bits that change are logged
        self._battle_lock = threading.Lock()
        self._leftovers_checked: set[str] = set()  # runs checked for a battle that ended while the tracker was off
        self._jobs: queue.Queue[str | None] = queue.Queue()
        self._thread: threading.Thread | None = None
        # Worker thread only: a snapshot seen once (applied when the next read agrees),
        # and the (run id, snapshot) last applied, so an unchanged game isn't processed again.
        self._mem_pending: Snapshot | None = None
        self._mem_applied: tuple[str, Snapshot] | None = None
        self._mem_seeing: str | None = None  # e.g. "15 units", shown in the status
        # Keys (in the active run) of the units in the battle in progress, read from game memory.
        self._battle: list[str] = []
        self._status = {"state": "off", "screen": None, "seeing": None, "message": ""}

    # Public API (thread-safe)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="scanner", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop polling before releasing the memory connection and recorder."""
        self._jobs.put(None)
        if self._thread is not None:
            # Finish the current local memory read before its handles and event
            # loop are released. Closing the runtime must not leave a live worker.
            self._thread.join()
        else:
            self._close_resources()

    def _close_resources(self) -> None:
        try:
            self._end_battle()
        finally:
            self._release_memory()

    def _release_memory(self) -> None:
        close = getattr(self.memory, "close", None)
        if close is not None:
            close()
        if self.recorder is not None:
            self.recorder.stop()

    def wake(self) -> None:
        """Read the game again straight away (and forget what was read so far)."""
        self._jobs.put("wake")

    def settings_changed(self) -> None:
        """Call after settings change so the loop picks them up immediately."""
        self.wake()
        self._publish_status(
            self._status["state"], self._status["screen"], self._status["seeing"], self._status["message"], force=True
        )

    def auto_status(self) -> dict:
        return {"battle": list(self._battle), **self._status}

    def current_battle(self) -> Battle | None:
        """A copy of the battle in progress in the active run (game memory only), or None."""
        run_id = self.settings.get().active_run_id
        with self._battle_lock:
            battle = self._battles.battle
            return battle.model_copy(deep=True) if battle and run_id and battle.run_id == run_id else None

    # Worker loop

    def _run(self) -> None:
        try:
            self._poll()
        finally:
            self._close_resources()

    def _poll(self) -> None:
        next_tick = time.monotonic()
        while True:
            try:
                job = self._jobs.get(timeout=max(0.0, next_tick - time.monotonic()))
            except queue.Empty:
                job = "tick"
            if job is None:
                return
            try:
                if job == "tick":
                    started = time.monotonic()
                    self._tick()
                    next_tick = started + self.tick_interval()  # (the interval counts from the start of the read)
                else:
                    next_tick = time.monotonic()
                    self._reset()
            except Exception:  # never let the worker die
                log.exception("Read failed")
                try:
                    self._publish_status("error", MEMORY_TITLE, message="Lost contact with the game. Retrying…")
                except Exception:
                    log.exception("Could not report read failure")
                next_tick = time.monotonic() + self.tick_interval()

    def tick_interval(self) -> float:
        """Seconds to the next read: the battle interval while a battle is in progress."""
        return DEFAULT_BATTLE_INTERVAL if self._battles.active else DEFAULT_ROSTER_INTERVAL

    def _publish_status(
        self, state: str, screen: str | None = None, seeing: str | None = None, message: str = "", force: bool = False
    ) -> None:
        new = {"state": state, "screen": screen, "seeing": seeing, "message": message}
        if new != self._status or force:
            self._status = new
            self.events.publish("auto", self.auto_status())

    def _reset(self) -> None:
        self._mem_pending, self._mem_applied = None, None

    def _use_reader(self, reader: str) -> None:
        """Look for the game in another program (Settings > Game) from the next read on."""
        if reader == self._reader:
            return
        self._reader = reader
        if isinstance(self.memory, GameMemory):
            self.memory.emulators = emulators_for(reader)
            self.memory.close()  # connects again, to the other program, on the next read
        self._reset()

    def _tick(self) -> None:
        settings = self.settings.get()
        self._use_reader(settings.memory_reader)
        if self.recorder is not None:
            self.recorder.set_limit(settings.max_recordings)
        if not settings.active_run_id:
            if self._battles.active:
                self._end_battle()  # battles belong to a run: none is followed without one
            self._publish_status("no_run", message="Create or select a run to start tracking.")
            return
        if not game_assets().available:
            # The memory tables come from the imported game files: without them nothing is read.
            self._mem_pending, self._battle = None, []
            self._end_battle()
            self._publish_status("error", MEMORY_TITLE, message=NEEDS_IMPORT)
            return
        with game_tables.pinned():  # one read of the game makes hundreds of table lookups: check the tables once
            self._memory_tick()

    # Game memory

    def _memory_tick(self) -> None:
        run_id = self.settings.get().active_run_id or ""
        try:
            snapshot = self.memory.read()
        except GameMemoryError as exc:
            if self._status["state"] == "watching":
                self.events.publish("roster_warning", {"message": str(exc)})
            self._mem_pending = None
            self._battle = []
            self._end_battle()  # the game is gone, so is the battle
            self._publish_status("error", MEMORY_TITLE, message=str(exc))
            return
        self._data()  # a new import/language must also refresh an otherwise unchanged snapshot
        self._track_battle(snapshot, run_id)
        if self._mem_applied == (run_id, snapshot):
            self._publish_status("watching", MEMORY_TITLE, self._mem_seeing)
            return
        if snapshot != self._mem_pending:
            # Changed since the last read: wait for the next read to agree, so a unit caught halfway
            # through an update in game is never stored.
            self._mem_pending = snapshot
            return
        self._mem_pending = None
        self._apply_memory(snapshot)

    def _track_battle(self, snapshot: Snapshot, run_id: str) -> None:
        if not run_id:  # battles belong to a run: none is followed without one
            if self._battles.active:
                self._end_battle()
            return
        if not snapshot.in_battle and not self._battles.active:
            self._battle_sample = None
            self._record_battle()
            self._file_leftover_battle(run_id)
            return
        sample = self._sample_battle(snapshot, run_id)
        if sample != self._battle_sample:  # wait for the next read to agree
            self._battle_sample = sample
            self._record_battle()
            return
        if sample.army and not self._battles.active:
            self._resume_battle(sample, run_id)
        self.feed_battle(sample, run_id)
        self._record_battle()

    def feed_battle(self, sample: BattleSample, run_id: str) -> None:
        """Step the battle with one agreed sample: save it, file it when it ends, tell the page. Worker thread only
        (tools/demo_battle.py also feeds a scripted battle through it)."""
        with self._battle_lock:
            changed, finished = self._battles.update(sample, run_id)
        if finished and self.recorder is not None:
            self.recorder.stop()
        self._save_battle(finished)
        if changed and self._battles.battle is not None and self.battle_store is not None:
            try:
                self.battle_store.save_active(self._battles.battle)
            except Exception:
                log.exception("Could not save the battle in progress")
        if changed or finished:
            self.events.publish("battle", {"active": self._battles.active})

    def _file_leftover_battle(self, run_id: str) -> None:
        """Outside a battle, a battle saved as in progress ended while the tracker wasn't running: file it in the
        history (checked once per run)."""
        if self.battle_store is None or run_id in self._leftovers_checked:
            return
        self._leftovers_checked.add(run_id)
        saved = self.battle_store.load_active(run_id)
        if saved is not None:
            self._close_leftover(saved)
            self.events.publish("battle", {"active": False})

    def _close_leftover(self, saved: Battle) -> None:
        last = saved.events[-1].t if saved.events else 0
        saved.ended_at = saved.started_at + timedelta(seconds=last)
        saved.events.append(
            BattleEvent(t=last, kind="end", text="Battle over (it ended while the tracker wasn't running)")
        )
        self._save_battle(saved)

    def _resume_battle(self, sample: BattleSample, run_id: str) -> None:
        """A battle is starting: carry on with the one saved before the tracker restarted, if it's the same battle
        (a saved battle that isn't this one ended while the tracker wasn't running: keep it in the history). Or the
        game is back in the battle it quit with a bookmark: carry on with that one, the run's newest."""
        if self.battle_store is None:
            return
        saved = self.battle_store.load_active(run_id)
        if saved is not None:
            if saved.key and saved.key == sample.key:
                with self._battle_lock:
                    self._battles.resume(saved)
                log.info("Resumed the battle that started at %s", saved.started_at)
                return
            self._close_leftover(saved)
        try:
            latest = self.battle_store.list(run_id)[-1:]
        except Exception:
            log.exception("Could not read the battle history")
            return
        if latest and continues(sample, latest[0]):
            battle = self.battle_store.take_latest(run_id, sample.key)
            if battle is not None:
                with self._battle_lock:
                    self._battles.reopen(battle)
                log.info(
                    "Back in the battle that started at %s (resumed from a bookmark): carrying on with it",
                    battle.started_at,
                )
                self.events.publish("battle", {"active": True})

    def _record_battle(self) -> None:
        """Save raw battle memory while a battle is in progress."""
        recorder = self.recorder
        if recorder is None:
            return
        battle = self._battles.battle
        if battle is None or not recorder.keep:
            if recorder.recording:
                recorder.stop()
            return
        if not recorder.recording:
            recorder.start(f"{battle.run_id}-{battle.id}")
        capture = getattr(self.memory, "capture_battle", None)
        data = capture() if capture else None
        if data:
            note = {
                "events": len(battle.events),
                "divine_pulses": battle.divine_pulses,
                "enemies": battle.enemies_now,
                "level_ups": battle.level_ups,
            }
            recorder.record(data, battle.seconds(), note)

    def _end_battle(self) -> None:
        with self._battle_lock:
            finished = self._battles.end()
        self._battle_sample = None
        if self.recorder is not None:
            self.recorder.stop()
        if finished:
            self._save_battle(finished)
            self.events.publish("battle", {"active": False})

    def _save_battle(self, battle: Battle | None) -> None:
        if battle is None or self.battle_store is None:
            return
        try:
            self.store.get(battle.run_id)
        except NotFound:  # the run was deleted during the battle
            self.battle_store.clear_active(battle.run_id)
            return
        try:
            self.battle_store.add(battle)
            self.battle_store.clear_active(battle.run_id)
        except Exception:
            log.exception("Could not save the battle")
            return
        # Read the army again now the battle is filed, even if it hasn't changed: a unit that fell for good is
        # missing from it (see _detect_deaths).
        self._mem_applied = None

    def _sample_battle(self, snapshot: Snapshot, run_id: str) -> BattleSample:
        """The army units in the battle (on-screen values) and the other units on the map."""
        if not snapshot.in_battle:
            self._flag_watch.reset()
            return BattleSample(())
        data = self._data()
        battle_units = getattr(self.memory, "battle_units", None)
        pool = battle_units() if battle_units else []
        globals_ = getattr(self.memory, "battle_globals", None)
        located = globals_() if globals_ else {}
        self._log_flag_changes(pool, data, located.get("turn"))
        history = getattr(self.memory, "battle_history", None)
        read = history(pool) if history and pool else None
        # Everything the sample is made of. Between two reads nothing in the game usually changed (most are
        # between actions), and then the sample is the one just made: working it out again is most of a read's cost.
        revision = self.store.revision(run_id)
        key = (snapshot, tuple(pool), located, read, id(data), revision)
        if revision is not None and self._sample_made is not None and self._sample_made[0] == key:
            return self._sample_made[1]
        sample = self._build_sample(snapshot, run_id, data, pool, located, read)
        self._sample_made = (key, sample)
        return sample

    def _build_sample(self, snapshot: Snapshot, run_id: str, data: GameData, pool: list, located: dict, read) -> BattleSample:
        try:
            run = self.store.get(run_id)
            units = run.units
        except NotFound:
            units = {}
        player_name = decode_player_name(snapshot.player_name)
        # Units in the pool that aren't on the map: adjutants, and reinforcements still to come.
        on_map = [u for u in pool if not u.off_map and not _stand_in(u)]
        records = {u.character: u for u in on_map if u.army}
        by_index = {u.pool_index: u.character for u in on_map if u.army and u.pool_index is not None}
        # An army unit off the map is the adjutant of the unit it's attached to; with none, it isn't in the battle.
        benched = {u.character: u for u in pool if u.army and u.off_map and u.character not in records}
        adjutants = {c: by_index.get(u.attached_to) for c, u in benched.items()}
        start_counts = {c: (fights, wins) for c, fights, wins in snapshot.start_counts}
        gambit_uses = dict(snapshot.gambit_uses)
        army = []
        # Character ID -> unit key, for the game's history: the whole army, since units that fell are no longer in
        # the battle but are still in its history.
        keys: dict[int, str] = {}
        army_names: dict[str, str] = {}  # uid -> name, for units the history names that aren't in the battle any more
        roster = decode_roster(snapshot.roster)
        for unit in roster:
            name = unit_name(unit, data, player_name)
            keys[unit.character] = next((k for k, u in units.items() if u.game_id == unit.character), None) or unit_key(
                name
            )
            stored = units.get(keys[unit.character])
            army_names[f"a:{keys[unit.character]}"] = stored.name if stored else name
        for unit in roster:
            if unit.character not in snapshot.in_battle or adjutants.get(unit.character, unit.character) is None:
                continue
            key = keys[unit.character]
            stored = units.get(key)
            reading = to_reading(
                unit,
                data,
                self.bonuses,
                player_name=player_name,
                current_personal=stored.personal_ability if stored else None,
                scenario=snapshot.scenario,
                in_battle=True,
                gambit_uses=gambit_uses.get(unit.character),
            )
            ability = reading.abilities
            # The battle's values are the unit's own: the battalion's Charm leaves them when its endurance runs out,
            # which isn't a stat going down (that only happens with a Divine Pulse).
            own_values = {k: v - (ability.battalion_bonus or {}).get(k, 0) for k, v in reading.values.items()}
            name = stored.name if stored else reading.name_candidates[0]
            record = records.get(unit.character) or benched.get(unit.character)
            items, spells = (record.items, record.spell_uses) if record else ((), ())
            accessory_id = (
                next((item for item, _ in record.items if item in EQUIPMENT), None)
                if record
                else (EQUIPMENT.start + unit.accessory if unit.accessory is not None else None)
            )
            accessory = item_name(accessory_id) if accessory_id is not None else None
            hp, x, y = (record.hp, record.x, record.y) if unit.character in records else (None, None, None)
            combats, victories = (record.combats, record.victories) if record else (None, None)
            combats_start, victories_start = start_counts.get(unit.character, (None, None))
            partner = adjutants.get(unit.character)
            army.append(
                ArmySample(
                    key,
                    name,
                    reading.class_name or "",
                    unit.level,
                    own_values,
                    items,
                    spells,
                    hp,
                    x,
                    y,
                    combats,
                    victories,
                    combats_start,
                    victories_start,
                    record.acted if record else None,
                    keys.get(partner) if partner is not None else None,
                    unit.class_id,
                    unit.character,
                    unit.character in data.female,
                    _weapon(record) if record else "",
                    record.spells if record else (),
                    tuple(data.combat_arts.get(art, f"Combat art {art}") for art in unit.arts),
                    record.equipped == EQUIPPED_WEAPON if record else False,
                    record.item_slot_0 if record else None,
                    accessory,
                    accessory_id,
                    look=reading.look if reading.look is not None else stored.look if stored else None,
                    # An unresolved name keeps the stored assignment; its runtime state isn't attached to it.
                    battalion=(ability.battalion if ability.battalion is not None
                               else stored.battalion if stored else None),
                    battalion_id=(ability.battalion_id if ability.battalion is not None
                                  else stored.battalion_id if stored else None),
                    battalion_exp=ability.battalion_exp,
                    battalion_endurance=ability.battalion_endurance,
                    gambit_uses=ability.gambit_uses,
                    rattled=record.rattled if record else None,
                )
            )
        enemies = []
        # Your own characters are never the other side: the pool also holds a second record of some army units, and
        # the records of your units that fell (still in the roster, no longer in the battle).
        own = {u.character for u in pool if u.army} | {u.character for u in roster}
        for other in on_map:
            if other.army or other.character in own:
                continue
            game_class = data.classes.get(other.class_id)
            name, character = _other_name(other.character, data)
            values = {k: v + (game_class.boosts.get(k, 0) if game_class else 0) for k, v in other.raw.items()}
            enemies.append(
                EnemySample(
                    game_class.name if game_class else "",
                    other.level,
                    round(power(values, other.level), 1),
                    values.get("hp", 0),
                    other.hp,
                    other.slot,
                    other.x,
                    other.y,
                    # A defeated unit's record stays in the pool with no HP left: kept, so its last fight counts.
                    name,
                    other.combats,
                    other.victories,
                    _weapon(other),
                    other.class_id,
                    other.character in data.female,
                    side_of(other.team, name),
                    character,
                    other.character,
                    other.items,
                    other.spell_uses,
                    other.spells,
                    other.equipped == EQUIPPED_WEAPON,
                    other.item_slot_0,
                )
            )
        terrain_of = getattr(self.memory, "battle_terrain", None)
        on_this_map = terrain_of(on_map) if terrain_of and on_map else None
        steps = history_steps(*read, keys, pool) if read else ()
        return BattleSample(
            tuple(sorted(army, key=lambda a: a.key)),
            tuple(sorted(enemies, key=lambda e: (e.class_name, e.level, e.power, e.slot))),
            snapshot.battle_key,
            located.get("turn"),
            located.get("divine_pulse_charges"),
            steps,
            {**army_names, **{f"e:{u.slot}": _other_name(u.character, data)[0] for u in pool if not u.army}}
            if steps
            else {},
            # For working out fights from HP changes when the history can't be read (gamemem/pairing.py).
            tuple(on_map),
            {u.slot: keys[u.character] for u in on_map if u.army and u.character in keys},
            on_this_map[1] if on_this_map else None,
            located.get("scenario"),
            on_this_map[0] if on_this_map else None,
            (located["cursor_x"], located["cursor_y"])
            if located.get("cursor_x") is not None and located.get("cursor_y") is not None
            else None,
            # Other units in the pool but not on the map now: reinforcements still to come, and units the story took
            # off it (Tomas when he turns out to be Solon), for when to show them in the replay.
            frozenset(
                f"e:{u.slot}" for u in pool if (u.off_map or _stand_in(u)) and not u.army and u.character not in own
            ),
        )

    def _log_flag_changes(self, pool: list, data: GameData, turn: int | None) -> None:
        """Log every change, since the last read, in a bit of a unit's flags byte whose meaning isn't known yet
        (gamemem.battle.KNOWN_FLAG_BITS), with what the unit looked like then, to work out what the bit means."""
        for c in self._flag_watch.check(pool):
            u = c.unit
            name = (
                data.characters[u.character].name
                if u.character in data.characters
                else _other_name(u.character, data)[0]
            )
            what = (
                f"first seen with flags 0x{c.after:02x}, unknown bits 0x{c.unknown:02x} set"
                if c.before is None
                else f"flags 0x{c.before:02x} -> 0x{c.after:02x}, bits 0x{c.unknown:02x} "
                + ("set" if c.after & c.unknown == c.unknown else "cleared" if not c.after & c.unknown else "changed")
            )
            log.info(
                "Unknown unit flag: %s (character %d, class %d, slot %d, team %s) %s; turn %s, HP %s/%d, tile %s, %s, acted %s",
                name or "unit",
                u.character,
                u.class_id,
                u.slot,
                u.team,
                what,
                turn,
                u.hp,
                u.max_hp,
                (u.x, u.y),
                "off the map" if u.off_map else "on the map",
                u.acted,
            )

    def _data(self) -> GameData:
        generation = game_tables.generation()
        if self._game_data is None or generation != self._game_generation:
            self._game_data = GameData.load()
            self._game_generation = generation
            self._reset()
        return self._game_data

    def _apply_memory(self, snapshot: Snapshot) -> None:
        with self.roster_updates.lock:
            self._apply_roster(snapshot)

    def _apply_roster(self, snapshot: Snapshot) -> None:
        """Save complete observations and warn about unreadable units."""
        run_id = self.settings.get().active_run_id or ""
        try:
            run = self.store.get(run_id)
        except NotFound:
            message = f"Active run '{run_id}' no longer exists."
            self._battle = []
            self._publish_status("no_run", message=message)
            return

        data = self._data()
        player_name = decode_player_name(snapshot.player_name)
        if len(snapshot.roster) != ROSTER_SIZE:
            self.events.publish("roster_warning", {"message": "The roster could not be read completely."})
            self._mem_applied = (run_id, snapshot)
            return
        decoded = decode_roster(snapshot.roster)
        roster = [unit for unit in decoded if unit.level and unit.raw["hp"]]
        if len(roster) != len(decoded):
            self.events.publish("roster_warning", {"message": "Some units could not be read and were not updated."})

        def readings():
            for unit in roster:
                stored = next((u for u in run.units.values() if u.game_id == unit.character), None)
                if stored is None:
                    stored = run.units.get(unit_key(unit_name(unit, data, player_name)))
                yield to_reading(
                    unit,
                    data,
                    self.bonuses,
                    player_name=player_name,
                    current_personal=stored.personal_ability if stored else None,
                    scenario=snapshot.scenario,
                    in_battle=bool(snapshot.in_battle),
                    gambit_uses=uses.get(unit.character),
                )

        uses = dict(snapshot.gambit_uses)
        result = self.roster_updates.apply(run, readings())
        if decoded and not snapshot.in_battle and not self._battles.active:
            # A complete read of the army between battles: who fell for good is missing from it.
            result.changes.extend(self._detect_deaths(run, {unit.character for unit in decoded}))
        changes = result.changes
        warnings, key_of = result.warnings, result.keys
        self._mem_applied = (run_id, snapshot)
        battle = [key_of[c] for c in snapshot.in_battle if c in key_of]
        self._battle = battle  # published with the status just below
        seeing = f"{len(roster)} unit{'s' if len(roster) != 1 else ''}"
        if snapshot.battle_units:
            seeing += f", {snapshot.battle_units} from the battle in progress"
        self._mem_seeing = seeing
        self._publish_status("watching", MEMORY_TITLE, seeing)

        if warnings:
            self.events.publish("roster_warning", {"message": "\n".join(warnings)})
        if changes:
            single = changes[0] if len(changes) == 1 else None
            self.events.publish("units_changed", {"run_id": run_id, "unit_key": single.key if single else None})


    def _detect_deaths(self, run, present: set[int]) -> list[UnitChange]:
        """Mark the units that fell for good as dead, and units back in the army as alive (domain/deaths.py). The
        battles are only loaded when a unit is missing that wasn't when they were last looked at."""
        missing = deaths.missing_units(run.units, present)
        battles = None
        if missing and self.battle_store is not None:
            checked = (run.id, frozenset(missing), self.battle_store.stamp(run.id))
            if checked != self._deaths_checked:
                battles = self.battle_store.list(run.id)
                self._deaths_checked = checked
        changed = deaths.detect(run.units, present, battles)
        if not changed:
            return []
        out = [UnitChange(key, run.units[key], unit) for key, unit in changed.items()]
        try:
            self.store.apply_units(run.id, changed)
        except Exception:
            log.exception("Could not save the units' deaths")
            return []
        run.units.update(changed)
        for key, unit in changed.items():
            if unit.death is not None:
                log.info("%s fell for good in battle %s", key, unit.death.battle_id)
            else:
                log.info("%s is back in the army: alive", key)
        return out


def _stand_in(unit) -> bool:
    """A record in the pool that isn't a unit on the map though it isn't flagged off it: max HP 1. Seen in The Remire
    Calamity: two "Rampaging Villagers" (34 HP of 1) on the tiles where two real ones appear later, gone when the
    reinforcements come."""
    return not unit.army and unit.raw.get("hp", 0) <= 1


def _other_name(character: int, data: GameData) -> tuple[str, int | None]:
    """The name of a unit that isn't yours, and its character ID if it's a character of their own (a student such as
    Lorenz, or a story character such as Jeralt or Solon) rather than a generic unit ("Bandit")."""
    named = data.characters.get(character)
    if named:
        return named.name, character
    if character in data.npc_names:
        return data.npc_names[character], character
    return data.generic_names.get(character, ""), None


def _weapon(unit) -> str:
    """The map icon's weapon for a unit (combat.weapon_kind), "" if the game data can't say."""
    try:
        return weapon_kind(unit)
    except Exception:
        return ""
