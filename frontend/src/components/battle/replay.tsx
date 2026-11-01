/**
 * Replaying a battle on the map, step by step from the game's history: which step is shown (or now), playing, and
 * the controls, a timeline under the map. Shared by the Map tab and the Overview's map.
 *
 * Stepping forward one step (Play, or Next step) animates it in stages, at the speed set in Settings > Appearance:
 * the unit acting moves first, then acts (an attack, a heal), then whoever fell or left the map fades away and
 * whoever arrived fades in. Any other jump shows the step at once.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../Icon";
import { NotchedRange, StepSlider } from "../Slider";
import type { Battle } from "../../api";
import { plural } from "../../format";
import { clock } from "../../format";
import { hpShare, Item } from "./model";
import { Action, Board, boardAt, boardNow, Frame, frames, stepAction, stepLabel, turnStarts } from "./map";
import { replayPath } from "./replayPath";
import { BattleNavContext, KeyNumber, keyNumbers } from "./parts";

/** Each stage of a step's animation at normal speed (ms): moving (a base, and per tile, up to a most), acting, the
 * fades, and a pause before the next step while playing (longer at the start of a phase, to read its banner). */
const MOVE_MS = { base: 140, tile: 90, most: 700 };
const ACT_MS = 560;
const FADE_MS = 420;
const HOLD_MS = 220;
const PHASE_HOLD_MS = 650;

/** The replay speeds Settings offers. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** The same five speed stops on the map and in Settings. */
export function ReplaySpeedSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const stop = REPLAY_SPEEDS.reduce((best, speed, i) => Math.abs(speed - value) < Math.abs(REPLAY_SPEEDS[best] - value) ? i : best, 0);
  return (
    <StepSlider
      label="Replay speed"
      bare
      stops={REPLAY_SPEEDS.length}
      value={stop}
      onChange={(i) => onChange(REPLAY_SPEEDS[i])}
      valueText={`${value}× speed`}
      icon={CONCEPT_ICON.speed}
      variant="timeline"
      slim
      after={<span className="replay-speed-value">{value}×</span>}
    />
  );
}

/** When each stage of a step's animation ends (ms from the step's start): moving, acting, fading, and the step. */
export interface Timing {
  move: number;
  act: number;
  fade: number;
  total: number;
}

/** A step being animated: the map before it, what it did, and how far along it is (ms). */
export interface StepAnimation {
  before: Board;
  action: Action | null;
  timing: Timing;
  elapsed: number;
}

function timing(before: Board, after: Board, action: Action | null, phaseStart: boolean, speed: number): Timing {
  const was = new Map(before.pieces.map((p) => [p.id, p]));
  const now = new Set(after.pieces.map((p) => p.id));
  let tiles = 0;
  let fades = before.pieces.some((q) => !q.down && !now.has(q.id)); // someone left the map
  for (const p of after.pieces) {
    const q = was.get(p.id);
    if (!q) fades ||= !p.down; // someone arrived
    else {
      tiles = Math.max(tiles, Math.abs(p.x - q.x) + Math.abs(p.y - q.y));
      fades ||= p.down && !q.down; // someone fell
    }
  }
  const scale = 1 / speed;
  const move = tiles ? Math.min(MOVE_MS.most, MOVE_MS.base + MOVE_MS.tile * tiles) * scale : 0;
  const act = move + (action && action.kind !== "none" ? ACT_MS * scale : 0);
  const fade = act + (fades ? FADE_MS * scale : 0);
  return { move, act, fade, total: fade + (phaseStart ? PHASE_HOLD_MS : HOLD_MS) * scale };
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function useReplay(battle: Battle, pulse: number | null = null, items?: Item[]) {
  const asked = Number(useContext(BattleNavContext)?.replaySpeed);
  const speed = asked > 0 && Number.isFinite(asked) ? asked : 1;
  const path = useMemo(() => replayPath(battle, pulse), [battle, pulse]);
  const { steps, presence, available } = path;
  const all = useMemo(() => frames(steps, presence), [steps, presence]);
  const kinds = useMemo(() => {
    const result = new Map<number, "attack" | "heal">();
    for (const item of items ?? []) {
      if (item.step === null) continue;
      if (item.kind === "attack") result.set(item.step, "attack");
      else if ((item.kind === "heal" || item.kind === "item") && !result.has(item.step)) result.set(item.step, "heal");
    }
    return result;
  }, [items]);
  const turns = useMemo(() => turnStarts(steps), [steps]);
  // The step shown (an index into steps), or null for where things stand now.
  const [position, setAt] = useState<number | null>(null);
  const at = position !== null && position >= steps.length ? null : position;
  const [playing, setPlaying] = useState(false);
  // The step being animated and when it started (performance.now()), and how far along it is.
  const [animating, setAnimating] = useState<{ step: number; start: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Bumped when the timeline is sent to a step on purpose (a log row picked): its thumb glides there rather than jumping.
  const [seeks, setSeeks] = useState(0);

  // Switching paths stops the old animation and starts at the selected path's first frame.
  useEffect(() => {
    setPlaying(false);
    setAnimating(null);
    setAt(pulse === null || !steps.length ? null : 0);
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  // A Divine Pulse can cut the history back past the step shown.
  useEffect(() => {
    if (position !== null && position >= steps.length) setAt(null);
  }, [position, steps.length]);

  const boardOf = (i: number | null): Board => (i === null && pulse === null ? boardNow(battle) : boardAt(battle, all[i ?? 0] ?? (new Map() as Frame)));
  const board = useMemo(() => boardOf(at), [battle, all, at, pulse]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = useMemo(() => (at === null ? null : stepAction(steps, all, at, kinds)), [steps, all, at, kinds]);
  const anim = useMemo(() => {
    if (!animating || at === null || animating.step !== at || at === 0) return null;
    const before = boardOf(at - 1);
    return { before, action, timing: timing(before, board, action, !steps[at]?.actor, speed) };
  }, [animating, at, board, action, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Show step i, animated from the one before it. Past the last step: back to now. */
  const advance = (i: number) => {
    if (i >= steps.length) {
      setPlaying(false);
      setAnimating(null);
      setAt(pulse === null ? null : Math.max(0, steps.length - 1));
      return;
    }
    setAt(i);
    setElapsed(0);
    setAnimating(reducedMotion() ? null : { step: i, start: performance.now() });
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // The clock of the step being animated; while playing, on to the next step once it's done.
  useEffect(() => {
    if (!animating || !anim) return;
    let frame = 0;
    const tick = (now: number) => {
      const t = now - animating.start;
      if (t < anim.timing.total) {
        setElapsed(t);
        frame = requestAnimationFrame(tick);
      } else if (playingRef.current) advanceRef.current(animating.step + 1);
      else setAnimating(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, anim]);

  // Playing a step with nothing to animate (the first, or with reduced motion): hold it a moment, then go on.
  useEffect(() => {
    if (!playing || anim || at === null) return;
    const timer = window.setTimeout(() => advanceRef.current(at + 1), PHASE_HOLD_MS / speed);
    return () => window.clearTimeout(timer);
  }, [playing, anim, at, speed]);

  const go = (i: number | null) => {
    setPlaying(false);
    setAnimating(null);
    setAt(i === null || i >= steps.length ? (pulse === null || !steps.length ? null : steps.length - 1) : Math.max(0, i));
  };
  const seek = (i: number) => {
    go(i);
    setSeeks((n) => n + 1);
  };
  const next = () => {
    setPlaying(false);
    if (at !== null) advance(at + 1);
  };
  const play = () => {
    if (!steps.length) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (at === null || (pulse !== null && at === steps.length - 1)) {
      setAnimating(null);
      setAt(0);
    } else if (!animating) advance(at + 1);
    setPlaying(true);
  };
  /** "Turn 3 · Player phase" for the step shown or, once finished, the final recorded turn/phase. */
  const final = steps.at(-1);
  const lastPhase = [...battle.log].reverse().find((entry) => entry.turn === battle.turn && entry.phase !== null && entry.phase !== undefined)?.phase;
  const finalPhase = lastPhase ?? final?.phase;
  const finalLabel = battle.turn !== null
    ? `Turn ${battle.turn}${finalPhase === undefined ? "" : ` · ${finalPhase === 0 ? "Player" : finalPhase === 1 ? "Enemy" : "Other"} phase`}`
    : final ? stepLabel(final) : "At the end";
  const label = at === null ? (battle.active ? "Now" : finalLabel) : stepLabel(steps[at]);
  const detail = at === null ? `${plural(steps.length, "step")} to replay` : `step ${at + 1} of ${steps.length}`;
  const army = at === null ? (battle.active || finalPhase === undefined ? "now" : phaseArmy(finalPhase)) : phaseArmy(steps[at].phase);
  const cursor = at === null && battle.active && battle.cursor ? battle.cursor : null;
  const animation: StepAnimation | null = anim ? { ...anim, elapsed } : null;
  return { steps, turns, at, playing, board, action, animation, cursor, go, seek, seeks, next, play, label, detail, army, available, historical: pulse !== null };
}

export type Replay = ReturnType<typeof useReplay>;

/** The whole log (actions, oldest first) and the history position of the step shown (null when showing now). */
export function replayLog(items: Item[], { steps, at }: Replay): { shown: Item[]; current: number | null } {
  const actions = items.filter((i) => !i.heading && i.branch === 0);
  return { shown: actions, current: at === null ? null : steps[at].step };
}

/** The index of the replay step a log row happened in (null: it has no step). */
export function stepOf(item: Item, steps: Replay["steps"]): number | null {
  const step = item.steps?.[0] ?? item.step;
  if (step === null || step === undefined) return null;
  const i = steps.findIndex((s) => s.step === step);
  return i < 0 ? null : i;
}

/** The key numbers and outlook as they stood at the step shown (the battle's own when showing now). */
export function replayStats(battle: Battle, replay: Replay, items: Item[], seconds: number): { numbers: KeyNumber[]; chance: number | null; at: number | null } {
  const { at, steps, board } = replay;
  // Finished battles have no live outlook. Their final trend point is the outlook at the end of playback.
  const now = battle.outlook?.chance ?? battle.trend.at(-1)?.chance ?? null;
  if (at === null) return { numbers: keyNumbers(battle, seconds), chance: now, at: null };
  const step = steps[at];
  const timed = items.filter((i) => i.branch === 0 && i.step !== null && i.step <= step.step);
  const t = timed.length ? timed[timed.length - 1].t : 0;
  const mine = board.pieces.filter((p) => p.army);
  const onMap = mine.filter((p) => !p.down).length;
  const others = board.pieces.filter((p) => !p.army && !p.object);
  const alive = others.filter((p) => !p.down).length;
  const hps = mine.map((p) => (p.hp === null || !p.max ? null : [p.hp, p.max] as const));
  const army = hps.length && hps.every((h) => h !== null) ? hpShare(hps.reduce((n, h) => n + h![0], 0), hps.reduce((n, h) => n + h![1], 0)) : null;
  const pulses = items.filter((i) => i.kind === "pulse" && i.branch === 0 && i.step !== null);
  const usedBy = pulses.filter((i) => i.step! <= step.step).length;
  const point = [...battle.trend].reverse().find((p) => p.t <= t) ?? battle.trend[0];
  const numbers: KeyNumber[] = [
    { label: "Time", value: clock(t), title: "Time in battle at this step" },
    { label: "Turn", value: String(step.turn) },
    { label: "Units", value: `${onMap}/${mine.length}`, title: mine.length - onMap ? `${mine.length - onMap} left the battle` : "Your units on the map", tone: mine.length - onMap ? "bad" : undefined },
  ];
  if (army !== null) numbers.push({ label: "HP", value: `${Math.round(army * 100)}%` });
  if (battle.enemies_start > 0) numbers.push({ label: "Enemies", value: `${alive}/${battle.enemies_start}`, title: "Other units on the map" });
  const charges = battle.divine_pulse_charges;
  numbers.push({
    label: "Divine Pulse",
    value: String(charges !== null ? charges + (pulses.length - usedBy) : usedBy),
    suffix: charges !== null ? "left" : "used",
  });
  const chance = point ? point.chance : now;
  if (chance !== null) numbers.push({ label: "Outlook", value: `${Math.round(chance * 100)}%`, title: "Estimated chance of winning at this step" });
  return { numbers, chance, at: t };
}

/** The tiles a camera keeps in view: the game's cursor live; in a replay, the units acting in the step; otherwise
 * the map's centre when no action is selected. */
export function followed({ cursor, action, board }: Replay): [number, number][] {
  if (cursor) return [cursor];
  const actor = action ? board.pieces.find((p) => p.id === action.actor) : undefined;
  const aimed = action?.target ? board.pieces.find((p) => p.id === action.target) : undefined;
  if (actor) return [[actor.x, actor.y], ...(action?.from ? [action.from] : []), ...(aimed ? [[aimed.x, aimed.y] as [number, number]] : [])];
  return [];
}

/** The army whose phase a step fell in, for the colour of its banner. */
const phaseArmy = (phase: number) => (phase === 0 ? "player" : phase === 1 ? "enemy" : "other");

/** The replay under the map: the buttons, and a timeline from the start (left) to now (right) with a notch per step
 * (taller at each new turn, coloured by the phase's army). */
export function ReplayBar({ replay: r }: { replay: Replay }) {
  const { steps, turns, at, playing, go } = r;
  const notches = useMemo(() => {
    const starts = new Set(turns.map((t) => t.index));
    return steps.map((s, i) => ({ at: i, className: `${phaseArmy(s.phase)}${starts.has(i) ? " major" : ""}` }));
  }, [steps, turns]);
  const end = r.historical ? steps.length - 1 : steps.length;
  const target = at ?? end;
  // After a seek (a log row picked) the thumb glides from where it was to the new step, rather than jumping.
  const [glide, setGlide] = useState<number | null>(null);
  const shown = useRef(target);
  const seen = useRef(r.seeks);
  useEffect(() => {
    if (seen.current === r.seeks) {
      shown.current = target;
      return;
    }
    seen.current = r.seeks;
    const from = shown.current;
    const start = performance.now();
    const ms = 480;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const value = from + (target - from) * (1 - Math.cos(Math.PI * k)) / 2;
      shown.current = value;
      if (k < 1) {
        setGlide(value);
        frame = requestAnimationFrame(tick);
      } else setGlide(null);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setGlide(null);
    };
  }, [r.seeks, target]);
  if (!steps.length) return null;
  return (
    <div className="replay-bar" role="group" aria-label="Replay the battle">
      <div className="replay-buttons">
        <IconButton icon={CONCEPT_ICON.first} onClick={() => go(0)} disabled={at === 0} label="To the beginning" className="replay-btn" />
        <IconButton icon={CONCEPT_ICON.prev} onClick={() => go((at ?? end) - 1)} disabled={at === 0} label="Previous step" className="replay-btn" />
        <IconButton icon={playing ? CONCEPT_ICON.pause : CONCEPT_ICON.play} primary onClick={r.play} pressed={playing} label={playing ? "Pause" : "Play"} className="replay-btn" />
        <IconButton icon={CONCEPT_ICON.next} onClick={r.next} disabled={at === null || (r.historical && at === end)} label="Next step" className="replay-btn" />
        <IconButton icon={CONCEPT_ICON.last} onClick={() => go(null)} disabled={at === null || (r.historical && at === end)} label="To the end" className="replay-btn" />
      </div>
      <NotchedRange
        className="replay-timeline"
        variant="timeline"
        min={0}
        max={end}
        value={glide ?? target}
        step={glide === null ? 1 : "any"}
        onChange={(v) => go(v)}
        notches={notches}
        label="Step of the battle"
        valueText={`${r.label}, ${r.detail}`}
      />
    </div>
  );
}

/** The step shown, in a banner of its army's colour (blue player, red enemy, green other, purple now). */
export function ReplayBanner({ replay: r }: { replay: Replay }) {
  if (!r.steps.length) return null;
  return (
    <p className={`replay-banner ${r.army}`} aria-live="polite">
      <b>{r.label}</b>
      <span>{r.detail}</span>
    </p>
  );
}
