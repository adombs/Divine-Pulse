"""Battle lifecycle and timeline coordination over domain observations."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from pathlib import Path

from ..domain.battle import (
    STEP_WAIT,
    STEP_ATTACK,
    STEP_DEFEAT,
    STEP_ITEM,
    UsageKind,
    Usage,
    BattleUnitStats,
    BattleEvent,
    LogKind,
    LogEntry,
    Branch,
    EnemyStats,
    MAP_SIZE,
    MapStep,
    TrendPoint,
    Battle,
    ArmySample,
    EnemySample,
    StepUnit,
    RALLY_ABILITIES,
    PHASES,
    HistoryStep,
    used_in_step,
    BattleSample,
    PAIRING_BUDGET_S,
    APPROXIMATE_CONFIDENCE,
    WEAPONS,
    CONSUMABLES,
    _uses_by_item,
    _spent,
    power,
    _gain_text,
    _plus_text,
    _looks_like_level_up,
)
from ..domain.outlook import outlook
from ..domain.units import VALUE_KEYS, byleth_look, now
from ..domain.combat import EQUIPMENT
from .battle_support import BattleSupport


class BattleTracker:
    """Turns game-memory samples into battles. Not thread-safe: the scanner's worker owns it."""

    def __init__(self, support: BattleSupport, check_dir: Path | None = None) -> None:
        self.support = support
        self.battle: Battle | None = None
        self._last: BattleSample | None = None
        self._pulse_screen = False  # the Divine Pulse screen was open since the last sample
        # Developer check of the fight pairing (DIVINE_PULSE_PAIRING_CHECK=1): while the history is read, the fights are also
        # worked out without it, and the two are compared in a report written here when the battle ends.
        self.check_dir = check_dir
        # Work out fights from HP changes when the game's history can't be read (Settings > Battles).
        self.estimate_fights = True
        self._reset_history()

    def _reset_history(self) -> None:
        # The game's history as last read, when each entry was first seen (seconds into the battle), and where
        # time was turned back: (position in the history, when).
        self._history: tuple[HistoryStep, ...] = ()
        self._history_times: list[float] = []
        self._pulse_marks: list[tuple[int, float]] = []
        # Where each unit stood when the turn began (by pool slot), for working out fights without the history.
        self._origins: dict[int, tuple[int, int]] = {}
        self._origins_turn: int | None = None
        self._enemy_phase = False  # this turn's enemy phase has begun (gamemem.pairing.enemy_phase_began)
        self._shadow: list[dict] = []  # fights worked out alongside the history (check_dir)
        # When each history entry was first seen, from a battle saved before the tracker restarted (see resume).
        self._resumed_times: dict[int, float] = {}
        # Other units seen so far, on the map or off it (Battle.map_presence).
        self._presence_seen: set[str] = set()

    def resume(self, battle: Battle) -> None:
        """Carry on with a battle saved before the tracker restarted (see storage.BattleStore.load_active)."""
        self.battle, self._last = battle, None
        self._reset_history()
        self._presence_seen = set(battle.map_presence) | {f"e:{slot}" for slot in battle.enemy_stats}
        # Keep when each action happened and where time was turned back to: the history is read afresh.
        for e in battle.log:
            if e.step is None:
                continue
            if e.kind == "pulse":
                self._pulse_marks.append((e.step, e.t))
            else:
                self._resumed_times[e.step] = min(e.t, self._resumed_times.get(e.step, e.t))

    def reopen(self, battle: Battle, at: datetime | None = None) -> None:
        """Carry on with a battle filed as over that the game went back to: quit with a bookmark, then resumed
        (see continues). The time away isn't counted."""
        at = at or now()
        if battle.ended_at is not None:
            battle.away_s += max(0.0, (at - battle.ended_at).total_seconds())
        battle.ended_at = None
        battle.events = [e for e in battle.events if e.kind != "end"]
        self.resume(battle)

    @property
    def active(self) -> bool:
        return self.battle is not None

    def update(self, sample: BattleSample, run_id: str, at: datetime | None = None) -> tuple[bool, Battle | None]:
        """Feed one sample. Returns (changed, finished battle or None). An empty sample ends the battle."""
        at = at or now()
        if not sample.army:
            return (self.battle is not None), self.end(at)
        if (
            self.battle is None
            or self.battle.run_id != run_id
            or (sample.key and self.battle.key and sample.key != self.battle.key)
            or self._restarted(sample)
        ):
            finished = self.end(at) if self.battle else None
            self._pulse_screen = False
            self._start(sample, run_id, at)
            self._note_trend(at)
            return True, finished
        if sample.turn == 0 and self.battle.turn:
            # The Divine Pulse screen: the map shows earlier moments while the player scrolls. Wait until it
            # closes, then compare with how things were before it opened.
            self._pulse_screen = True
            return False, None
        if self._last is None:  # resumed: take this sample as the baseline for actions
            self._last = sample
        moved = self._set_cursor(sample)
        changed = self._step(sample, at)
        if changed:
            self._note_trend(at)
        return changed or moved, None

    def _restarted(self, sample: BattleSample) -> bool:
        """The same map started over (the chapter restarted, a save loaded) rather than time turned back: the
        game's history is back to its first entry, "Fight!", without the Divine Pulse screen or a charge spent.
        Its battle key stays the same, so this is the only sign of it. (Charges not read: taken as a Divine Pulse.)"""
        battle = self.battle
        if battle is None or len(self._history) < 2 or not sample.history or len(sample.history) > 1:
            return False
        if self._pulse_screen or sample.turn == 0:
            return False
        before, after = battle.divine_pulse_charges, sample.divine_pulse_charges
        return before is not None and after is not None and after >= before

    def _note_trend(self, at: datetime) -> None:
        battle = self.battle
        assert battle is not None

        def share(hp: int | None, max_hp: int | None) -> float | None:
            return round(hp / max_hp, 3) if hp is not None and max_hp else None

        point = TrendPoint(
            t=round(battle.seconds(at), 1),
            chance=outlook(battle)["chance"],
            army_hp=share(battle.army_hp, battle.army_max_hp),
            enemy_hp=share(battle.enemy_hp, battle.enemy_max_hp),
        )
        last = battle.trend[-1] if battle.trend else None
        if last is None or (last.chance, last.army_hp, last.enemy_hp) != (point.chance, point.army_hp, point.enemy_hp):
            battle.trend.append(point)

    def end(self, at: datetime | None = None) -> Battle | None:
        if self.battle is not None and self.check_dir is not None:
            self._write_pairing_check()
        battle, self.battle, self._last = self.battle, None, None
        self._reset_history()
        if battle is None:
            return None
        at = at or now()
        battle.ended_at = at
        battle.events.append(BattleEvent(t=battle.seconds(at), kind="end", text="Battle over"))
        return battle

    # Internals

    def _start(self, sample: BattleSample, run_id: str, at: datetime) -> None:
        units = [
            BattleUnitStats(
                key=a.key,
                name=a.name,
                class_name=a.class_name,
                start_level=a.level,
                level=a.level,
                start=dict(a.values),
                now=dict(a.values),
                adjutant_of=a.adjutant_of,
            )
            for a in sample.army
        ]
        self.battle = battle = Battle(
            id=at.strftime("%Y%m%d-%H%M%S"), run_id=run_id, key=sample.key, started_at=at, units=units
        )
        self._set_enemies(sample)
        self.battle.enemies_start = self.battle.enemies_now
        names = ", ".join(a.name for a in sample.army)
        enemies = f"; {self.battle.enemies_now} other units on the map" if sample.enemies else ""
        self.battle.events.append(
            BattleEvent(t=0, kind="start", text=f"Battle started with {len(units)} units ({names}){enemies}")
        )
        for unit, a in zip(units, sample.army):
            self._set_resources(unit, a)
        self._set_power(sample)
        self._set_located(sample)
        self._set_terrain(sample)
        self._set_scenario(sample)
        self._set_cursor(sample)
        if sample.turn:  # 0 on the Divine Pulse screen
            battle.turn = sample.turn
        battle.divine_pulse_charges = sample.divine_pulse_charges
        self._label_enemies(sample)
        self._track_enemies(sample)
        self._note_origins(sample)
        if sample.history:
            self._apply_history(sample, 0, rewound=False)
            self._track_presence(sample)
        self._last = sample

    def _step(self, sample: BattleSample, at: datetime) -> bool:
        battle = self.battle
        assert battle is not None
        t = battle.seconds(at)
        changed = self._set_terrain(sample)
        changed = self._set_scenario(sample) or changed
        by_key = {u.key: u for u in battle.units}
        previous = {a.key: a for a in self._last.army} if self._last else {}
        seen = set()
        # Back from the Divine Pulse screen with anything different: time was turned back.
        went_back = self._pulse_screen and self._differs(self._last, sample)
        self._pulse_screen = False
        stats_undone = False
        for a in sample.army:
            before = previous.get(a.key)
            if before is not None and by_key.get(a.key) is not None:
                if self._count_actions(by_key[a.key], before, a):
                    went_back = True
                    changed = True
                elif (before.items, before.spells) != (a.items, a.spells):
                    changed = True
            seen.add(a.key)
            unit = by_key.get(a.key)
            if unit is None:  # joined mid-battle (reinforcement or a late deployment)
                unit = BattleUnitStats(
                    key=a.key,
                    name=a.name,
                    class_name=a.class_name,
                    start_level=a.level,
                    level=a.level,
                    start=dict(a.values),
                    now=dict(a.values),
                    adjutant_of=a.adjutant_of,
                )
                battle.units.append(unit)
                battle.events.append(BattleEvent(t=t, kind="joined", unit=a.key, text=f"{a.name} joined the battle"))
                self._set_resources(unit, a)
                changed = True
                continue
            if not unit.on_map:
                unit.on_map = True
                changed = True
            if unit.adjutant_of != a.adjutant_of:
                unit.adjutant_of = a.adjutant_of
                changed = True
            if self._set_resources(unit, a):
                changed = True
            if (a.level, a.values) == (unit.level, unit.now):
                continue
            if self._grow(unit, a, t, history=bool(sample.history)):
                went_back = stats_undone = True  # undone: Divine Pulse
            changed = True
        for unit in battle.units:
            if unit.on_map and unit.key not in seen:
                unit.on_map = False
                battle.events.append(BattleEvent(t=t, kind="left", unit=unit.key, text=f"{unit.name} left the battle"))
                changed = True
        went_back = self._step_globals(sample, t) or went_back
        if went_back:
            battle.divine_pulses += 1
            # (With the game's history, its log already has a line for it, at the moment time went back to.)
            if not sample.history:
                text = "Turned back time with Divine Pulse" + (
                    ": a level-up or stat gain was undone." if stats_undone else "."
                )
                battle.events.append(BattleEvent(t=t, kind="divine_pulse", text=text))
            changed = True
        before = battle.enemies_now
        self._set_enemies(sample)
        if battle.enemies_now != before:
            word = "fewer" if battle.enemies_now < before else "more"
            battle.events.append(
                BattleEvent(
                    t=t,
                    kind="enemies",
                    text=f"{abs(before - battle.enemies_now)} {word} other units on the map ({battle.enemies_now} now)",
                )
            )
            changed = True
        self._set_power(sample)
        if self._set_located(sample):
            changed = True
        self._label_enemies(sample)
        if self._track_enemies(sample):
            changed = True
        if sample.history:
            if self.check_dir is not None and not went_back and self._last is not None:
                self._shadow_pair(self._last, sample, t)
            if self._apply_history(sample, t, went_back):
                changed = True
            if self._track_presence(sample):
                changed = True
        elif self.estimate_fights and not went_back and self._last is not None and self._pair(self._last, sample, t):
            changed = True
        self._note_origins(sample)  # (after pairing: fights in a read that starts a turn belong to the turn before)
        self._note_phase(
            self._last, sample
        )  # (after pairing too: fights in the read where it began may be your units')
        self._last = sample
        return changed

    def _grow(self, unit: BattleUnitStats, a: ArmySample, t: float, history: bool) -> bool:
        """Log a unit's level-up or stat gains and take its new values. Returns True if they went down instead,
        which only a Divine Pulse does."""
        battle = self.battle
        assert battle is not None
        diff = {k: a.values[k] - unit.now.get(k, 0) for k in VALUE_KEYS if a.values.get(k, 0) != unit.now.get(k, 0)}
        if a.class_name and unit.class_name and a.class_name != unit.class_name and a.level == unit.level:
            # Another class (a mounted unit's read without its mount, say): its boosts moved the values. Not growth.
            for k, v in diff.items():
                unit.start[k] = unit.start.get(k, 0) + v
            unit.now, unit.class_name = dict(a.values), a.class_name
            return False
        undone = a.level < unit.level or any(v < 0 for v in diff.values())
        if undone:
            # Without the game's history there is no branch to move the undone growth to (_branch_off): take it off
            # the log.
            if not history:
                self._undo_growth(unit, a)
            if a.level < unit.level or any(v < 0 for k, v in diff.items() if k != "mv"):
                unit.assumed_level_ups = 0
        elif a.level > unit.level:
            levels = a.level - unit.level
            # Gains already logged as a level-up from stats alone were this level-up: name the level on that line.
            assumed = min(levels, unit.assumed_level_ups)
            unit.assumed_level_ups -= assumed
            previous = next(
                (e for e in reversed(battle.events) if e.unit == a.key and e.kind == "level_up" and e.level is None),
                None,
            )
            if assumed and previous is not None:
                previous.level = unit.level + 1
                previous.gains = {
                    k: previous.gains.get(k, 0) + diff.get(k, 0)
                    for k in VALUE_KEYS
                    if previous.gains.get(k, 0) + diff.get(k, 0)
                }
                previous.text = f"{a.name} reached level {previous.level} ({_plus_text(previous.gains)})"
                diff = {}
            if levels > assumed:
                text = f"{a.name} reached level {a.level} ({_plus_text(diff)})"
                battle.events.append(
                    BattleEvent(t=t, kind="level_up", unit=a.key, gains=diff, level=a.level, text=text)
                )
        elif _looks_like_level_up(diff):
            # +1 in one or more stats and nothing else is what a level-up gives (stat boosters give +2): counted as
            # one until the level goes up too.
            unit.assumed_level_ups += 1
            battle.events.append(
                BattleEvent(
                    t=t, kind="level_up", unit=a.key, gains=diff, text=f"{a.name} leveled up ({_plus_text(diff)})"
                )
            )
        elif diff:
            battle.events.append(
                BattleEvent(t=t, kind="stat_up", unit=a.key, gains=diff, text=f"{a.name}: {_gain_text(diff)}")
            )
        unit.level, unit.now, unit.class_name = a.level, dict(a.values), a.class_name or unit.class_name
        return undone

    def _undo_growth(self, unit: BattleUnitStats, a: ArmySample) -> None:
        """Take the unit's level-ups and stat gains that a Divine Pulse undid off the log, newest first, until its
        values are back where they are now."""
        battle = self.battle
        assert battle is not None
        values, level = dict(unit.now), unit.level
        for e in reversed(list(battle.events)):
            if level <= a.level and all(values.get(k, 0) <= a.values.get(k, 0) for k in VALUE_KEYS):
                break
            if e.unit != unit.key or e.kind not in ("level_up", "stat_up"):
                continue
            battle.events.remove(e)
            for k, v in e.gains.items():
                values[k] = values.get(k, 0) - v
            if e.kind == "level_up" and e.level is not None:
                level = e.level - 1

    def _step_globals(self, sample: BattleSample, t: float) -> bool:
        """The turn and Divine Pulse charges. Returns True if they show time was turned back (the turn went down or
        a charge was spent)."""
        battle = self.battle
        assert battle is not None
        went_back = False
        if sample.turn:  # 0 on the Divine Pulse screen: not a turn
            if battle.turn is not None and sample.turn < battle.turn:
                went_back = True
            elif battle.turn is not None and sample.turn > battle.turn:
                battle.events.append(BattleEvent(t=t, kind="turn", text=f"Turn {sample.turn}"))
            battle.turn = sample.turn
        if sample.divine_pulse_charges is not None:
            before = battle.divine_pulse_charges
            if before is not None and sample.divine_pulse_charges < before:
                went_back = True
            battle.divine_pulse_charges = sample.divine_pulse_charges
        return went_back

    # Fights worked out without the history

    def _work_out(self, last: BattleSample, sample: BattleSample):
        if not last.units or not sample.units:
            return None

        return self.support.pair_fights(
            list(last.units),
            list(sample.units),
            budget=PAIRING_BUDGET_S,
            origins=self._origins,
            enemy_phase=self._enemy_phase,
            terrain=self.battle.terrain if self.battle else None,
        )

    def _shadow_pair(self, last: BattleSample, sample: BattleSample, t: float) -> None:
        result = self._work_out(last, sample)
        if result is None:
            return
        slots = {**last.army_slots, **sample.army_slots}

        def uid(slot: int | None) -> str | None:
            return None if slot is None else f"a:{slots[slot]}" if slot in slots else f"e:{slot}"

        for f in result.fights:
            self._shadow.append(
                {
                    "t": round(t, 1),
                    "turn": sample.turn,
                    "attacker": uid(f.attacker),
                    "defender": uid(f.defender),
                    "attacker_lost": f.attacker_lost,
                    "defender_lost": f.defender_lost,
                    "defeated": uid(f.defeated),
                    "confidence": f.confidence,
                    "exact": result.exact,
                    "partial": result.partial,
                    "candidates": result.candidates,
                }
            )

    def _write_pairing_check(self) -> None:
        """Compare the fights worked out alongside the history with the history's own (check_dir)."""
        battle = self.battle
        assert battle is not None and self.check_dir is not None
        truth = []
        state: dict[str, int] = {}
        for step in self._history:
            changes = {}
            for u in step.units:
                if u.uid in state:
                    changes[u.uid] = u.hp - state[u.uid]
                state[u.uid] = u.hp
            if (
                step.phase_start
                or step.target is None
                or changes.get(step.target, 0) > 0
                or self.support.support_spell(step)
            ):
                continue  # (healing and other staves have a target too)
            if (
                step.action in (STEP_ATTACK, STEP_DEFEAT)
                or changes.get(step.target, 0) < 0
                or changes.get(step.actor or "", 0) < 0
            ):
                truth.append(
                    {"turn": step.turn, "attacker": step.actor, "defender": step.target, "action": step.action}
                )
        unmatched = list(range(len(truth)))
        buckets: dict[str, list[int]] = {"under 0.6": [0, 0], "0.6-0.9": [0, 0], "0.9 and over": [0, 0]}
        pair_right = attacker_right = 0
        for f in self._shadow:
            same = [
                i for i in unmatched if {truth[i]["attacker"], truth[i]["defender"]} == {f["attacker"], f["defender"]}
            ]
            # The same two units can fight again: the one on the same turn, started by the same side, first.
            match = min(
                same,
                key=lambda i: (truth[i]["turn"] != f["turn"], truth[i]["attacker"] != f["attacker"], i),
                default=None,
            )
            right = match is not None and truth[match]["attacker"] == f["attacker"]
            if match is not None:
                unmatched.remove(match)
                pair_right += 1
                attacker_right += right
            f["right"] = right
            bucket = "under 0.6" if f["confidence"] < 0.6 else "0.6-0.9" if f["confidence"] < 0.9 else "0.9 and over"
            buckets[bucket][0] += right
            buckets[bucket][1] += 1
        report = {
            "battle": battle.id,
            "run": battle.run_id,
            "divine_pulses": battle.divine_pulses,
            "summary": {
                "history_fights": len(truth),
                "worked_out": len(self._shadow),
                "pair_right": pair_right,
                "attacker_right": attacker_right,
                "missed": len(unmatched),
                "right_by_confidence": {k: f"{r} of {n}" for k, (r, n) in buckets.items()},
            },
            "worked_out": self._shadow,
            "history": truth,
            "missed": [truth[i] for i in unmatched],
        }
        self.support.write_pairing_report(self.check_dir, f"{battle.run_id}-{battle.id}.json", report)

    def _note_phase(self, last: BattleSample | None, sample: BattleSample) -> None:
        if last is None or (sample.turn and sample.turn != last.turn):
            self._enemy_phase = False
        elif last.units and sample.units and self.support.enemy_phase_began(list(last.units), list(sample.units)):
            self._enemy_phase = True

    def _note_origins(self, sample: BattleSample) -> None:
        if sample.turn and sample.turn != self._origins_turn and sample.units:
            self._origins = {u.slot: (u.x, u.y) for u in sample.units if u.x is not None and u.y is not None}
            self._origins_turn = sample.turn

    def _pair(self, last: BattleSample, sample: BattleSample, t: float) -> bool:
        """Work out the fights since the last read from HP and counter changes (gamemem/pairing.py), when the game's
        history can't be read, and add them to the stats and the log. Returns whether anything was added."""
        result = self._work_out(last, sample)
        if result is None or not result.fights:
            return False
        battle = self.battle
        assert battle is not None
        units = {u.key: u for u in battle.units}
        slots = {**last.army_slots, **sample.army_slots}

        def name(slot: int) -> str:
            if slot in slots:
                unit = units.get(slots[slot])
                return unit.name if unit else "A unit"
            return battle.enemy_labels.get(slot) or "A unit"

        def credit(slot: int, dealt: int, taken: int) -> None:
            stats = units.get(slots[slot]) if slot in slots else battle.enemy_stats.get(slot)
            if stats is None:
                return
            stats.damage_dealt = (stats.damage_dealt or 0) + dealt
            stats.damage_taken = (stats.damage_taken or 0) + taken

        turn = sample.turn or battle.turn or 0

        def uid(slot: int | None) -> str | None:
            return None if slot is None else f"a:{slots[slot]}" if slot in slots else f"e:{slot}"

        for f in result.fights:
            credit(f.attacker, f.defender_lost, f.attacker_lost)
            credit(f.defender, f.attacker_lost, f.defender_lost)
            sure = f.confidence if result.exact else min(f.confidence, APPROXIMATE_CONFIDENCE)
            a_key, d_key = slots.get(f.attacker), slots.get(f.defender)
            target = d_key or name(f.defender)
            text = f"{name(f.attacker)}'s attack dealt {f.defender_lost} damage to {name(f.defender)}."
            if f.attacker_lost:
                text += f" {name(f.defender)} hit back for {f.attacker_lost}."
            phase = 0 if f.attacker in slots else 1  # your units start fights on the player phase, the others on theirs
            battle.log.append(
                LogEntry(
                    t=round(t, 1),
                    turn=turn,
                    kind="attack",
                    text=text,
                    unit=a_key,
                    target=target,
                    confidence=round(sure, 2),
                    actor_id=uid(f.attacker),
                    target_id=uid(f.defender),
                    dealt=f.defender_lost,
                    taken=f.attacker_lost,
                    phase=phase,
                )
            )
            if f.defeated is not None:
                winner = f.attacker if f.defeated == f.defender else f.defender
                if f.defeated in slots:
                    battle.log.append(
                        LogEntry(
                            t=round(t, 1),
                            turn=turn,
                            kind="fell",
                            text=f"{name(f.defeated)} fell.",
                            unit=slots[f.defeated],
                            confidence=round(sure, 2),
                            actor_id=uid(f.defeated),
                            target_id=uid(winner),
                            phase=phase,
                        )
                    )
                else:
                    stats = battle.enemy_stats.get(f.defeated)
                    if stats is not None:
                        stats.defeated_by = name(winner)
                    battle.log.append(
                        LogEntry(
                            t=round(t, 1),
                            turn=turn,
                            kind="defeat",
                            text=f"{name(winner)} killed {name(f.defeated)}.",
                            unit=slots.get(winner),
                            target=name(f.defeated),
                            confidence=round(sure, 2),
                            actor_id=uid(winner),
                            target_id=uid(f.defeated),
                            phase=phase,
                        )
                    )
        return True

    def _track_enemies(self, sample: BattleSample) -> bool:
        """Per-unit stats for the other units on the map (Battle.enemy_stats), as this read shows them: who each
        one is, where, its HP, and whether it's on the map at all. Damage and moves come from the game's history
        (_replay). Returns whether anything shown on the map changed."""
        battle = self.battle
        assert battle is not None

        def shown(stats: EnemyStats) -> tuple:
            return (
                stats.label,
                stats.name,
                stats.class_name,
                stats.level,
                stats.max_hp,
                stats.hp,
                stats.on_map,
                stats.left,
                stats.x,
                stats.y,
                stats.weapon,
                stats.class_id,
                stats.female,
                stats.side,
                stats.character,
                stats.person_id,
                stats.inventory,
            )

        before = {slot: shown(stats) for slot, stats in battle.enemy_stats.items()}
        read = set()
        for e in sample.enemies:
            if e.slot < 0:
                continue
            read.add(e.slot)
            stats = battle.enemy_stats.get(e.slot)
            if stats is None:
                stats = EnemyStats(slot=e.slot, label=battle.enemy_labels.get(e.slot, e.class_name or "Unit"))
                battle.enemy_stats[e.slot] = stats
            stats.name, stats.class_name, stats.level, stats.max_hp, stats.hp = (
                e.name,
                e.class_name,
                e.level,
                e.max_hp,
                e.hp,
            )
            stats.on_map, stats.left = e.alive, False
            if e.weapon:
                stats.weapon = e.weapon
            if e.items or e.spells:
                stats.inventory = self.support.inventory(
                    e.items,
                    e.spells,
                    e.spell_ids,
                    equipped_item_id=e.equipped_item_id if e.equipped_weapon else None,
                    equipped_accessory_id=next((item for item, _ in e.items if item in EQUIPMENT), None),
                )
                stats.accessory = next((item.name for item in stats.inventory if item.kind == "equipment"), None)
            stats.class_id, stats.female, stats.side, stats.character = e.class_id, e.female, e.side, e.character
            stats.person_id = e.person_id
            if e.x is not None and e.y is not None:
                stats.x, stats.y = e.x, e.y
            if e.combats is not None:
                stats.combats = e.combats
            if e.victories is not None:
                stats.defeats = e.victories
        # Not on the map in this read: taken off it (or gone from memory). A defeated unit stays where it fell. (No
        # units read at all: the battle pool couldn't be read this time, which says nothing about who is on the map.)
        for slot, stats in battle.enemy_stats.items():
            if sample.units and slot not in read and not (stats.hp is not None and stats.hp <= 0):
                stats.on_map, stats.left = False, True
        return {slot: shown(stats) for slot, stats in battle.enemy_stats.items()} != before

    @staticmethod
    def _differs(a: BattleSample | None, b: BattleSample) -> bool:
        """Whether anything a Divine Pulse would change differs between two samples."""
        if a is None:
            return False

        def army(s: BattleSample) -> dict:
            return {u.key: (u.level, u.values, u.items, u.spells, u.hp, u.x, u.y) for u in s.army}

        def others(s: BattleSample) -> dict:
            return {e.slot: (e.hp, e.x, e.y) for e in s.enemies}

        return army(a) != army(b) or others(a) != others(b)

    # Action log

    def _label_enemies(self, sample: BattleSample) -> None:
        """Name new other units "<name or class> <n>", numbered per name in pool order; a character of their own
        (Jeralt, Solon) by their name alone."""
        battle = self.battle
        assert battle is not None

        def fits(label: str, e: EnemySample) -> bool:
            if e.character is not None and e.name:
                return label == e.name
            return label.rpartition(" ")[0] == (e.name or e.class_name or "Unit")

        # A unit whose label no longer matches its name (the names were corrected since the battle started): number
        # them all again.
        if any(not fits(battle.enemy_labels[e.slot], e) for e in sample.enemies if e.slot in battle.enemy_labels):
            battle.enemy_labels = {}
        counts: dict[str, int] = {}
        for label in battle.enemy_labels.values():
            name, _, number = label.rpartition(" ")
            if number.isdigit():
                counts[name] = max(counts.get(name, 0), int(number))
        for e in sorted(sample.enemies, key=lambda e: e.slot):
            if e.slot >= 0 and e.slot not in battle.enemy_labels:
                if e.character is not None and e.name:
                    battle.enemy_labels[e.slot] = e.name
                    continue
                name = e.name or e.class_name or "Unit"
                counts[name] = counts.get(name, 0) + 1
                battle.enemy_labels[e.slot] = f"{name} {counts[name]}"
        names = {e.slot: e.name for e in sample.enemies}
        for slot, stats in battle.enemy_stats.items():
            stats.label = battle.enemy_labels.get(slot, stats.label)
            stats.name = names.get(slot, stats.name)

    # The game's own history

    def _apply_history(self, sample: BattleSample, t: float, rewound: bool) -> bool:
        """Rebuild the action log and the damage, healing and movement stats from the game's history, which covers
        the whole battle whenever the tracker started. `rewound`: this sample shows time was turned back. Returns
        whether anything changed."""
        battle = self.battle
        assert battle is not None
        steps = sample.history
        keep = 0
        for old, new in zip(self._history, steps):
            # The units an entry lists depend on who is on the map now (scanner.history_steps leaves out the units
            # off it), so a unit leaving or joining changes even "Fight!": only what happened tells a rewind.
            if replace(old, units=()) != replace(new, units=()):
                break
            keep += 1
        # A Divine Pulse cuts the list back to the moment chosen. (The newest entry may still be filled in, so
        # only an older one going away counts on its own.)
        if self._history and (rewound or keep < len(self._history) - 1):
            self._branch_off(keep, t)
            self._pulse_marks = [(pos, at) for pos, at in self._pulse_marks if pos <= keep] + [(keep, t)]
        self._history_times = self._history_times[:keep] + [
            self._resumed_times.get(i, t) for i in range(keep, len(steps))
        ]
        self._resumed_times = {}
        self._history = steps

        def snapshot() -> tuple:
            return (
                [(e.kind, e.text) for e in battle.log],
                [(u.damage_dealt, u.damage_taken, u.healed, u.healing_given, u.tiles_moved) for u in battle.units],
                len(battle.map_steps),
                battle.map_steps[-1] if battle.map_steps else None,
            )

        before = snapshot()
        self._replay(sample)
        return snapshot() != before

    def _track_presence(self, sample: BattleSample) -> bool:
        """Note other units coming onto the map or leaving it without being defeated (Battle.map_presence), against
        the game's history. Returns whether anything changed."""
        battle = self.battle
        assert battle is not None
        if not battle.map_steps:
            return False
        # A change seen now shows from the next step: the game adds an entry only once the next action starts.
        at = len(battle.map_steps)
        changed = False
        # Time turned back: forget what was seen after the moment it went back to.
        for uid, marks in list(battle.map_presence.items()):
            kept = [m for m in marks if m[0] <= at]
            if kept != marks:
                changed = True
                if kept:
                    battle.map_presence[uid] = kept
                else:
                    del battle.map_presence[uid]
        on = {f"e:{u.slot}" for u in sample.units if not u.army and u.slot >= 0}
        # (A unit seen before that this read doesn't have at all is off the map too.)
        for uid in sorted(on | sample.hidden | (self._presence_seen if sample.units else set())):
            visible = uid in on and uid not in sample.hidden
            marks = battle.map_presence.get(uid, [])
            if uid not in self._presence_seen:
                self._presence_seen.add(uid)
                if not visible and not marks:
                    # Off the map when first seen: a reinforcement still to come (or a unit gone before the tracker
                    # started following the battle).
                    battle.map_presence[uid] = [(0, False)]
                    changed = True
                continue
            if visible == (marks[-1][1] if marks else True):
                continue
            stats = battle.enemy_stats.get(int(uid[2:]))
            if not visible and stats is not None and stats.hp == 0:
                continue  # defeated, not taken off the map: the replay shows it fall
            if marks and marks[-1][0] == at:
                marks.pop()
            else:
                marks.append((at, visible))
            if marks:
                battle.map_presence[uid] = marks
            else:
                battle.map_presence.pop(uid, None)
            changed = True
        return changed

    # What a unit leaving, joining or growing looked like in a timeline that was undone: these go with its branch.
    BRANCH_EVENTS = ("left", "joined", "level_up", "stat_up", "enemies")

    def _branch_off(self, keep: int, t: float) -> None:
        """Time was turned back to history position `keep`: keep what happened after it as a branch (Branch)."""
        battle = self.battle
        assert battle is not None
        undone = [e for e in battle.log if e.step is not None and e.step >= keep and e.kind != "pulse"]
        # An action's entry shows up only when the next action starts, so what was seen from the moment entry
        # keep - 1 showed up (a level-up in action `keep`, say) was undone too.
        since = (self._history_times[keep - 1] if keep <= len(self._history_times) else t) if keep else 0.0
        moved = [e for e in battle.events if e.t >= since and e.kind in self.BRANCH_EVENTS]
        self._shadow = [
            f for f in self._shadow if f["t"] < since
        ]  # (the pairing check scores the timeline that stands)
        if not undone and not moved:
            return
        battle.events = [e for e in battle.events if not (e.t >= since and e.kind in self.BRANCH_EVENTS)]
        branch = Branch(
            id=max((b.id for b in battle.branches), default=0) + 1,
            fork=keep,
            turn=self._history[keep].turn if keep < len(self._history) else None,
            at=round(t, 1),
            log=undone,
            events=moved,
        )
        # Branches that split off the standing timeline after this point split off the one being undone now.
        for b in battle.branches:
            if b.parent == 0 and b.fork > keep:
                b.parent = branch.id
        battle.branches.append(branch)

    def _replay(self, sample: BattleSample) -> None:
        battle = self.battle
        assert battle is not None
        steps, times = self._history, self._history_times
        unit_names = {f"a:{u.key}": u.name for u in battle.units}

        def name(uid: str | None) -> str:
            if uid is None:
                return "A unit"
            if uid.startswith("a:"):
                return unit_names.get(uid) or sample.other_names.get(uid) or "A unit"
            return battle.enemy_labels.get(int(uid[2:])) or sample.other_names.get(uid) or "A unit"

        def key(uid: str | None) -> str | None:
            return uid[2:] if uid and uid.startswith("a:") else None

        def aim(uid: str | None) -> str | None:
            return key(uid) or (name(uid) if uid else None)

        state: dict[str, StepUnit] = {}
        dealt: dict[str, int] = {}
        taken: dict[str, int] = {}
        healed: dict[str, int] = {}
        given: dict[str, int] = {}
        tiles: dict[str, int] = {}
        killed_by: dict[str, str | None] = {}  # other units defeated -> who did it
        log: list[LogEntry] = []
        marks = sorted(self._pulse_marks)

        step_index: int | None = None

        def add(
            at: float, turn: int, kind: LogKind, text: str, unit: str | None = None, target: str | None = None, **fields
        ) -> None:
            fields.setdefault("step", step_index)
            log.append(LogEntry(t=round(at, 1), turn=turn, kind=kind, text=text, unit=unit, target=target, **fields))

        def bump(d: dict[str, int], uid: str, n: int) -> None:
            d[uid] = d.get(uid, 0) + n

        fought: dict[str, int] = {}
        fell_to: dict[str, str | None] = {}  # your units that fell -> who did it
        usage: dict[str, dict[tuple[UsageKind, int], Usage]] = {}

        def use(uid: str, kind: UsageKind, ident: int, name_: str, spent: int = 0, damage: int = 0) -> None:
            u = usage.setdefault(uid, {}).setdefault(
                (kind, ident), Usage(kind=kind, id=ident, name=name_, weapon=self.support.weapon_kind(kind, ident))
            )
            u.times += 1
            u.spent += spent
            u.damage += damage

        map_steps: list[MapStep] = []
        for i, step in enumerate(steps):
            step_index = i
            for pos, at in marks:
                if pos == i:
                    add(at, step.turn, "pulse", "Turned back time with Divine Pulse.")
            at = times[i] if i < len(times) else 0.0
            changes: dict[str, tuple[int, StepUnit]] = {}  # HP change (a level-up's HP aside) and the state before
            placed: dict[str, tuple[int, int, int]] = {}  # units this step moved, hurt or healed: where they are now
            before: dict[str, StepUnit] = {}
            for u in step.units:
                prev = state.get(u.uid)
                if prev is not None:
                    before[u.uid] = prev
                if prev is None or (prev.x, prev.y, prev.hp) != (u.x, u.y, u.hp):
                    placed[u.uid] = (u.x, u.y, u.hp)
                if prev is not None:
                    bump(tiles, u.uid, abs(u.x - prev.x) + abs(u.y - prev.y))
                    grown = max(0, u.max_hp - prev.max_hp) if u.max_hp is not None and prev.max_hp is not None else 0
                    changes[u.uid] = (u.hp - prev.hp - grown, prev)
                state[u.uid] = u
            hurt = {uid: -d for uid, (d, _) in changes.items() if d < 0}
            gain = {uid: d for uid, (d, _) in changes.items() if d > 0}
            a, target = step.actor, step.target
            # An attack on a monster with several HP bars refills its HP when a bar breaks: that's damage (the bar's
            # remaining HP, at least), never a heal by the attacker. Nobody heals across sides.
            bar_broken = (
                target is not None
                and target in gain
                and not step.phase_start
                and a is not None
                and a.startswith("a:") != target.startswith("a:")
                and self.support.support_spell(step) is None  # a green unit's staff on yours is still a heal
            )
            if bar_broken:
                hurt[target] = changes[target][1].hp
                del gain[target]
            map_steps.append(MapStep(step=i, turn=step.turn, phase=step.phase, actor=a, target=target, units=placed))
            self._note_extent((x, y) for x, y, _ in placed.values())

            def by(uid: str) -> str | None:  # who caused a change to this unit: the other side of the action
                return None if step.phase_start else target if uid == a else a if uid == target else None  # noqa: B023

            if not step.phase_start:
                # What each unit in the action used, and the damage it dealt with it (an attacker's, or a
                # counterattack's). A combat art's durability cost is its weapon's: counted for both.
                worn = 0
                for uid, prev in before.items():
                    other = target if uid == a else a if uid == target else None
                    damage = hurt.get(other, 0) if other is not None else 0
                    for kind, ident, spent in used_in_step(prev, state[uid]):
                        label = self.support.item_name(ident) if kind != "spell" else self.support.spell_name(ident)
                        use(uid, kind, ident, label, spent, damage if kind != "item" else 0)
                        if uid == a and kind == "weapon":
                            worn += spent
                if a is not None:
                    if step.art is not None:
                        use(
                            a,
                            "art",
                            step.art,
                            self.support.art_name(step.art),
                            worn,
                            hurt.get(target, 0) if target is not None else 0,
                        )
                    elif step.rally:
                        me = state.get(a)
                        rallies = [x for x in me.abilities if x in RALLY_ABILITIES] if me is not None else []
                        use(a, "rally", rallies[0] if len(rallies) == 1 else 0, self.support.rally_name(me))
            for uid, n in gain.items():
                bump(healed, uid, n)
                if a is not None and uid != a and not step.phase_start:
                    bump(given, a, n)
            for uid, n in hurt.items():
                bump(taken, uid, n)
                if (source := by(uid)) is not None:
                    bump(dealt, source, n)
            if step.phase_start:
                if i == 0:
                    text = "Fight!"
                elif step.phase == 0:
                    text = f"Turn {step.turn}: began player phase."
                else:
                    text = f"Began {PHASES.get(step.phase, 'other')} phase."
                add(at, step.turn, "phase", text, phase=step.phase)
            elif step.art is not None and not (
                target is not None and (target in hurt or not (a and a.startswith("a:") and target.startswith("a:")))
            ):
                # A combat art that isn't an attack: on one of your own (Swap, Draw Back...) or on nobody.
                art = self.support.art_name(step.art)
                on = f" on {name(target)}" if target is not None else ""
                restored = gain.get(a or "") if target is None else None
                text = f"{name(a)} used {art}{on}." + (f" Recovered {restored} HP." if restored else "")
                add(
                    at,
                    step.turn,
                    "art",
                    text,
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    restored=restored,
                    phase=step.phase,
                    detail=art,
                )
            elif step.rally:
                rally = self.support.rally_name(state.get(a or ""))
                on = f" on {name(target)}" if target is not None else ""
                add(
                    at,
                    step.turn,
                    "rally",
                    f"{name(a)} used {rally}{on}.",
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    phase=step.phase,
                    detail=rally,
                )
            elif (spell := self.support.support_spell(step)) is not None and (target is None or target not in hurt):
                # A staff: "Flayn used Rescue on Lysithea.", with the HP it restored if any (Fortify heals everyone near).
                restored = gain.get(target, 0) if target is not None else sum(n for uid, n in gain.items() if uid != a)
                on = f" on {name(target)}" if target is not None else ""
                add(
                    at,
                    step.turn,
                    "heal" if restored else "spell",
                    f"{name(a)} used {spell}{on}." + (f" Restored {restored} HP." if restored else ""),
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    restored=restored or None,
                    phase=step.phase,
                    detail=spell,
                )
            elif step.action == STEP_ITEM and target is None:
                item = self.support.item_used(step)
                text = f"{name(a)} used {item or 'an item'}." + (f" Recovered {gain[a]} HP." if a in gain else "")
                add(
                    at,
                    step.turn,
                    "item",
                    text,
                    key(a),
                    actor_id=a,
                    restored=gain.get(a or ""),
                    phase=step.phase,
                    detail=item,
                )
            # A heal has a target too, and its action code can be an attack's (0x03, seen in game): a target that got
            # HP back was healed, not attacked.
            elif target is not None and (
                target in hurt
                or (
                    (step.action in (STEP_ATTACK, STEP_DEFEAT) or step.art is not None)
                    and target not in gain
                    and not (a and a.startswith("a:") and target.startswith("a:"))
                )
            ):
                art = self.support.art_name(step.art) if step.art is not None else None
                text = f"{name(a)}'s {art or 'attack'} dealt {hurt.get(target, 0)} damage to {name(target)}."
                if bar_broken:
                    text = f"{name(a)}'s {art or 'attack'} broke one of {name(target)}'s HP bars."
                if a in hurt:
                    text += f" {name(target)} hit back for {hurt[a]}."
                add(
                    at,
                    step.turn,
                    "attack",
                    text,
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    dealt=hurt.get(target, 0),
                    taken=hurt.get(a or "", 0),
                    phase=step.phase,
                    detail=art,
                )
                for uid in (a, target):
                    if uid is not None:
                        bump(fought, uid, 1)
            elif target is not None and target in gain:
                add(
                    at,
                    step.turn,
                    "heal",
                    f"{name(a)} restored {gain[target]} HP to {name(target)}.",
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    restored=gain[target],
                    phase=step.phase,
                )
            elif target is not None and a and a.startswith("a:") and target.startswith("a:"):
                # Something done to one of your own that changed no HP and isn't identified: not an attack.
                add(
                    at,
                    step.turn,
                    "act",
                    f"{name(a)} acted on {name(target)}.",
                    key(a),
                    aim(target),
                    actor_id=a,
                    target_id=target,
                    phase=step.phase,
                )
            elif a in gain:
                add(
                    at,
                    step.turn,
                    "item",
                    f"{name(a)} recovered {gain[a]} HP.",
                    key(a),
                    actor_id=a,
                    restored=gain[a],
                    phase=step.phase,
                )
            elif step.action == STEP_WAIT:
                add(
                    at,
                    step.turn,
                    "move" if step.moved else "wait",
                    f"{name(a)} {'moved' if step.moved else 'waited'}.",
                    key(a),
                    actor_id=a,
                    phase=step.phase,
                )
            else:
                add(at, step.turn, "act", f"{name(a)} acted.", key(a), actor_id=a, phase=step.phase)
            for uid, (_, prev) in changes.items():
                if state[uid].hp > 0 or prev.hp <= 0:
                    continue
                source = by(uid)
                if uid.startswith("a:"):
                    fell_to[uid] = source
                    add(
                        at,
                        step.turn,
                        "fell",
                        f"{name(uid)} fell.",
                        key(uid),
                        actor_id=uid,
                        target_id=source,
                        phase=step.phase,
                    )
                else:
                    killed_by[uid] = source
                    if source is not None:
                        add(
                            at,
                            step.turn,
                            "defeat",
                            f"{name(source)} killed {name(uid)}.",
                            key(source),
                            aim(uid),
                            actor_id=source,
                            target_id=uid,
                            phase=step.phase,
                        )
                    else:
                        add(
                            at,
                            step.turn,
                            "defeat",
                            f"{name(uid)} was killed.",
                            target=aim(uid),
                            target_id=uid,
                            phase=step.phase,
                        )
        step_index = None
        for pos, at in marks:
            if pos >= len(steps):
                add(at, steps[-1].turn if steps else 0, "pulse", "Turned back time with Divine Pulse.", step=pos)

        battle.log = log
        battle.map_steps = map_steps
        for unit in battle.units:
            uid = f"a:{unit.key}"
            if uid in state:
                unit.damage_dealt, unit.damage_taken = dealt.get(uid, 0), taken.get(uid, 0)
                unit.healed, unit.healing_given = healed.get(uid, 0), given.get(uid, 0)
                unit.tiles_moved = tiles.get(uid, 0)
                unit.usage = sorted(usage.get(uid, {}).values(), key=lambda u: (-u.times, -u.spent, u.name))
        for slot, stats in battle.enemy_stats.items():
            uid = f"e:{slot}"
            if uid in state:
                stats.usage = sorted(usage.get(uid, {}).values(), key=lambda u: (-u.times, -u.spent, u.name))
                stats.damage_dealt, stats.damage_taken = dealt.get(uid, 0), taken.get(uid, 0)
                stats.tiles_moved = tiles.get(uid, 0)
                source = killed_by.get(uid)
                stats.defeated_by = name(source) if source is not None else None
                # The other units' fight and defeat counters aren't turned back by a Divine Pulse (yours are): count
                # them from the history instead.
                stats.combats = fought.get(uid, 0)
                stats.defeats = sum(1 for s in (*killed_by.values(), *fell_to.values()) if s == uid)

    def _set_located(self, sample: BattleSample) -> bool:
        """Army and enemy HP totals, when current HP is located. Returns whether they changed."""
        battle = self.battle
        assert battle is not None
        before = (battle.army_hp, battle.enemy_hp, [(u.x, u.y, u.acted) for u in battle.units])
        by_key = {u.key: u for u in battle.units}
        for a in sample.army:
            unit = by_key.get(a.key)
            if unit is not None and a.x is not None and a.y is not None:
                unit.x, unit.y = a.x, a.y
            if unit is not None:
                unit.acted = a.acted
                unit.class_id, unit.character, unit.female = a.class_id, a.character, a.female
                unit.weapon = a.weapon
                unit.look = byleth_look(battle.scenario, True) if a.character in (0, 1) else None
        army = [a for a in sample.army if a.hp is not None]
        if army:
            battle.army_hp = sum(a.hp for a in army)
            battle.army_max_hp = sum(a.values.get("hp", 0) for a in army)
            for a in army:
                unit = by_key.get(a.key)
                if unit is not None:
                    unit.hp = a.hp
        # Fights and defeats this battle, exact: the counters now against the roster's from before the battle.
        units = {u.key: u for u in battle.units}
        for a in sample.army:
            unit = units.get(a.key)
            if unit is not None and None not in (a.combats, a.combats_start):
                unit.combats = max(0, a.combats - a.combats_start)
            if unit is not None and None not in (a.victories, a.victories_start):
                unit.defeats = max(0, a.victories - a.victories_start)
        enemies = [e for e in sample.enemies if e.hp is not None and e.is_unit]
        if enemies:
            battle.enemy_hp = sum(max(0, e.hp) for e in enemies)
            battle.enemy_max_hp = sum(e.max_hp for e in enemies)
            battle.enemies_defeated = sum(1 for e in enemies if e.hp <= 0)  # defeated units stay in memory with no HP
        self._note_extent((a.x, a.y) for a in (*sample.army, *sample.enemies))
        return (battle.army_hp, battle.enemy_hp, [(u.x, u.y, u.acted) for u in battle.units]) != before

    def _set_terrain(self, sample: BattleSample) -> bool:
        """Keep the map's terrain once known (the import's data/maps.json; a later read for another map replaces it).
        Returns whether it changed."""
        battle = self.battle
        assert battle is not None
        if not sample.terrain:
            return False
        grid = [list(row) for row in sample.terrain]
        if grid == battle.terrain:
            return False
        battle.terrain = grid
        battle.terrain_tiles = self.support.terrain_tiles(grid)
        battle.map_id = sample.map_id
        self._note_extent([(len(grid[0]) - 1, len(grid) - 1)] if grid and grid[0] else [])
        return True

    def _set_scenario(self, sample: BattleSample) -> bool:
        """Which battle this is, once read. Returns whether it changed."""
        battle = self.battle
        assert battle is not None
        if sample.scenario is None or sample.scenario == battle.scenario:
            return False
        battle.scenario = sample.scenario
        battle.map_name = self.support.scenario_name(sample.scenario)
        return True

    def _set_cursor(self, sample: BattleSample) -> bool:
        """Where the map cursor is, once read. Returns whether it moved."""
        battle = self.battle
        assert battle is not None
        cursor = sample.cursor
        if cursor is None or not all(0 <= v < MAP_SIZE for v in cursor) or cursor == battle.cursor:
            return False
        battle.cursor = cursor
        return True

    def _note_extent(self, positions) -> None:
        """Grow the map's known size (Battle.map_w / map_h) to cover these (x, y) positions."""
        battle = self.battle
        assert battle is not None
        for x, y in positions:
            if x is None or y is None or not (0 <= x < MAP_SIZE and 0 <= y < MAP_SIZE):
                continue  # (not placed on the map, or not a position)
            battle.map_w = max(battle.map_w or 0, x + 1)
            battle.map_h = max(battle.map_h or 0, y + 1)

    def _set_resources(self, unit: BattleUnitStats, a: ArmySample) -> bool:
        """What the unit has left: spell uses, weapon durability, consumables. Returns whether it changed."""
        if not a.spells:
            return False  # its battle record wasn't read this time
        before = (
            unit.spell_uses_left,
            unit.spell_uses_full,
            unit.weakest_weapon,
            unit.broken_weapons,
            unit.consumables_left,
            unit.inventory,
            unit.arts,
            unit.accessory,
        )
        unit.inventory = self.support.inventory(
            a.items,
            a.spells,
            a.spell_ids,
            equipped_item_id=a.equipped_item_id if a.equipped_weapon else None,
            equipped_accessory_id=a.equipped_accessory_id,
        )
        unit.accessory = a.accessory
        unit.arts = list(a.arts)
        weapons = [uses for item, uses in a.items if item in WEAPONS]
        unit.spell_uses_left = sum(a.spells)
        unit.spell_uses_full = max(unit.spell_uses_full or 0, unit.spell_uses_left)
        unit.weakest_weapon = min((n for n in weapons if n > 0), default=None)
        unit.broken_weapons = sum(1 for n in weapons if n == 0)
        unit.consumables_left = sum(uses for item, uses in a.items if item in CONSUMABLES)
        return (
            unit.spell_uses_left,
            unit.spell_uses_full,
            unit.weakest_weapon,
            unit.broken_weapons,
            unit.consumables_left,
            unit.inventory,
            unit.arts,
            unit.accessory,
        ) != before

    @staticmethod
    def _count_actions(unit: BattleUnitStats, before: ArmySample, after: ArmySample) -> bool:
        """Add what the unit spent since the last sample. Returns True if spell uses came back, which only happens
        when time is turned back."""
        if not before.spells or not after.spells:
            return False  # the unit's battle record wasn't read for one of the samples: nothing to compare
        unit.weapon_uses = max(
            0, unit.weapon_uses + _spent(_uses_by_item(before.items, WEAPONS), _uses_by_item(after.items, WEAPONS))
        )
        unit.item_uses = max(
            0,
            unit.item_uses + _spent(_uses_by_item(before.items, CONSUMABLES), _uses_by_item(after.items, CONSUMABLES)),
        )
        if len(before.spells) != len(after.spells):
            return False
        # A slot going from 0 to full is a spell just learned (a rank-up mid-battle), not uses coming back.
        returned = sum(n - b for b, n in zip(before.spells, after.spells) if n > b > 0)
        unit.spells_cast += sum(b - n for b, n in zip(before.spells, after.spells) if b > n)
        if returned:
            unit.spells_cast = max(0, unit.spells_cast - returned)  # undone: those casts didn't happen after all
            return True
        return False

    def _set_enemies(self, sample: BattleSample) -> None:
        battle = self.battle
        assert battle is not None
        battle.enemies_now = sum(1 for e in sample.enemies if e.alive and e.is_unit)

    def _set_power(self, sample: BattleSample) -> None:
        battle = self.battle
        assert battle is not None
        battle.army_power = round(sum(power(a.values, a.level) for a in sample.army if a.adjutant_of is None), 1)
        battle.enemy_power = round(sum(e.power for e in sample.enemies if e.alive and e.is_unit), 1)
