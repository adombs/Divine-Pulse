/**
 * Replaying a battle on the map, beat by beat from the one chronology (chronicle.ts): which beat is shown (or now),
 * playing, and the controls, a timeline under the map. Shared by the Map tab and the Overview's map.
 *
 * Stepping forward one beat (Play, or Next step) animates it in stages, at the speed set in Settings > Appearance:
 * the unit acting moves first, then acts (an attack, a heal), then whoever fell or left the map fades away and
 * whoever arrived fades in. A Divine Pulse plays as a rewind: a badge in the middle of the map, and the steps it
 * undid played backwards, while the timeline and the log stay on the Divine Pulse. Any other jump shows the beat at once.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../Icon";
import { NotchedRange, StepSlider } from "../Slider";
import type { Battle } from "../../api";
import { plural } from "../../format";
import { clock } from "../../format";
import { hpShare, Item } from "./model";
import { Action, Board, boardAt, boardNow, Frame, stepAction, stepLabel, turnStarts } from "./map";
import type { Beat, Chronicle } from "./chronicle";
import { BattleNavContext, KeyNumber, keyNumbers } from "./parts";

/** Each stage of a step's animation at normal speed (ms): moving (a base, and per tile, up to a most), acting, the
 * fades, and a pause before the next step while playing (longer at the start of a phase, to read its banner). */
const MOVE_MS = { base: 140, tile: 90, most: 700 };
const ACT_MS = 560;
const FADE_MS = 420;
const HOLD_MS = 220;
const PHASE_HOLD_MS = 650;

/** A Divine Pulse's rewind (ms at normal speed): the badge popping in, each undone step (played at this many times the
 * speed of a step going forward), then the badge fading away. */
const REWIND_IN_MS = 380;
const REWIND_OUT_MS = 520;
const REWIND_SPEED = 2;

/** The replay speeds Settings offers. */
export const REPLAY_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3.5, 4] as const;

/** The same speed stops on the map, in Settings and in the video export. */
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
      fades ||= p.down !== q.down; // someone fell (or, played backwards, got up again)
    }
  }
  const scale = 1 / speed;
  const move = tiles ? Math.min(MOVE_MS.most, MOVE_MS.base + MOVE_MS.tile * tiles) * scale : 0;
  const act = move + (action && action.kind !== "none" ? ACT_MS * scale : 0);
  const fade = act + (fades ? FADE_MS * scale : 0);
  return { move, act, fade, total: fade + (phaseStart ? PHASE_HOLD_MS : HOLD_MS) * scale };
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** A Divine Pulse being rewound: the map before each undone step, the one after the last, and how long each takes. */
interface RewindPlan {
  boards: Board[];
  timings: Timing[];
  total: number;
}

function rewindPlan(battle: Battle, beat: Beat, speed: number): RewindPlan {
  const boards = beat.undo.map((f) => boardAt(battle, f));
  const timings = boards.slice(1).map((after, i) => timing(boards[i], after, null, false, speed * REWIND_SPEED));
  const run = timings.reduce((n, t) => n + t.total, 0);
  return { boards, timings, total: (REWIND_IN_MS + REWIND_OUT_MS) / speed + run };
}

/** A rewind `elapsed` ms in: the map to show, the undone step moving on it (if one is), and how visible the badge is (0-1). */
function rewindAt(plan: RewindPlan, elapsed: number, speed: number): { board: Board; animation: StepAnimation | null; badge: number } {
  const intro = REWIND_IN_MS / speed;
  const outro = REWIND_OUT_MS / speed;
  const ease = (k: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, k)))) / 2;
  const badge = elapsed < intro ? ease(elapsed / intro) : elapsed > plan.total - outro ? 1 - ease((elapsed - (plan.total - outro)) / outro) : 1;
  let t = elapsed - intro;
  for (let i = 0; t >= 0 && i < plan.timings.length; i++) {
    if (t < plan.timings[i].total) return { board: plan.boards[i + 1], animation: { before: plan.boards[i], action: null, timing: plan.timings[i], elapsed: t }, badge };
    t -= plan.timings[i].total;
  }
  return { board: plan.boards[t < 0 ? 0 : plan.boards.length - 1], animation: null, badge };
}

/** A Divine Pulse being played: how visible the rewind badge in the middle of the map is (0-1). */
export interface Rewind {
  badge: number;
}

/** Which beats attacked and which healed (for the arrows on the map). */
function actionKinds(chron: Chronicle): Map<number, "attack" | "heal"> {
  const result = new Map<number, "attack" | "heal">();
  for (const item of chron.items) {
    if (item.beat == null) continue;
    if (item.kind === "attack") result.set(item.beat, "attack");
    else if ((item.kind === "heal" || item.kind === "item") && !result.has(item.beat)) result.set(item.beat, "heal");
  }
  return result;
}

/** How long each beat takes when played (ms), at `speed`: its animation, or the hold of a beat with none to play. */
export function beatDurations(battle: Battle, chron: Chronicle, speed: number): number[] {
  const { beats } = chron;
  const steps = beats.map((b) => b.step);
  const all = beats.map((b) => b.frame);
  const kinds = actionKinds(chron);
  const boards = all.map((f) => boardAt(battle, f));
  return beats.map((beat, i) => {
    if (beat.pulse !== null) return rewindPlan(battle, beat, speed).total;
    if (i === 0) return PHASE_HOLD_MS / speed;
    return timing(boards[i - 1], boards[i], stepAction(steps, all, i, kinds), !steps[i]?.actor, speed).total;
  });
}

/** The tiles a camera keeps in view at each beat: the units acting in it (a beat with none keeps the one before's). */
export function beatFocus(battle: Battle, chron: Chronicle): [number, number][][] {
  const { beats } = chron;
  const steps = beats.map((b) => b.step);
  const all = beats.map((b) => b.frame);
  const kinds = actionKinds(chron);
  let last: [number, number][] = [];
  return beats.map((_, i) => {
    const follow = followed({ cursor: null, action: stepAction(steps, all, i, kinds), board: boardAt(battle, all[i]) });
    if (follow.length) last = follow;
    return last;
  });
}

export interface ReplayOptions {
  /** Play at this speed rather than the one set in Settings. */
  speed?: number;
  /** The caller moves the replay with `pose` (an export's own clock); it never plays on by itself. */
  manual?: boolean;
}

export function useReplay(battle: Battle, chron: Chronicle, options: ReplayOptions = {}) {
  const nav = useContext(BattleNavContext);
  const asked = Number(options.speed ?? nav?.replaySpeed);
  const speed = asked > 0 && Number.isFinite(asked) ? asked : 1;
  const manual = !!options.manual;
  const { beats, pulses } = chron;
  const steps = useMemo(() => beats.map((b) => b.step), [beats]);
  const all = useMemo(() => beats.map((b) => b.frame), [beats]);
  const kinds = useMemo(() => actionKinds(chron), [chron]);
  const turns = useMemo(() => turnStarts(steps), [steps]);
  // The beat shown (an index into beats), or null for where things stand now.
  const [position, setAt] = useState<number | null>(null);
  const at = position !== null && position >= beats.length ? null : position;
  const [playing, setPlaying] = useState(false);
  // The beat being animated and when it started (performance.now()), and how far along it is.
  const [animating, setAnimating] = useState<{ step: number; start: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Bumped when the timeline is sent to a step on purpose (a log row picked): its thumb glides there rather than jumping.
  const [seeks, setSeeks] = useState(0);

  const boardOf = (i: number | null): Board => (i === null ? boardNow(battle) : boardAt(battle, all[i] ?? (new Map() as Frame)));
  const board = useMemo(() => boardOf(at), [battle, all, at]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = useMemo(() => (at === null ? null : stepAction(steps, all, at, kinds)), [steps, all, at, kinds]);
  const current = at === null ? null : beats[at];
  const running = animating !== null && at !== null && animating.step === at;
  const plan = useMemo(() => (running && current && current.pulse !== null ? rewindPlan(battle, current, speed) : null), [running, current, battle, speed]);
  const anim = useMemo(() => {
    if (!running || at === null || at === 0 || plan) return null;
    const before = boardOf(at - 1);
    return { before, action, timing: timing(before, board, action, !steps[at]?.actor, speed) };
  }, [running, at, board, action, speed, plan]); // eslint-disable-line react-hooks/exhaustive-deps
  // How long the beat being animated takes (null: nothing to animate).
  const total = plan ? plan.total : anim ? anim.timing.total : null;

  /** Show beat i, animated from the one before it. Past the last: back to now. */
  const advance = (i: number) => {
    if (i >= beats.length) {
      setPlaying(false);
      setAnimating(null);
      setAt(null);
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

  // The clock of the beat being animated; while playing, on to the next beat once it's done.
  useEffect(() => {
    if (manual || !animating || total === null) return;
    let frame = 0;
    const tick = (now: number) => {
      const t = now - animating.start;
      if (t < total) {
        setElapsed(t);
        frame = requestAnimationFrame(tick);
      } else if (playingRef.current) advanceRef.current(animating.step + 1);
      else setAnimating(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, total]);

  // Playing a beat with nothing to animate (the first, or with reduced motion): hold it a moment, then go on.
  useEffect(() => {
    if (manual || !playing || total !== null || at === null) return;
    const timer = window.setTimeout(() => advanceRef.current(at + 1), PHASE_HOLD_MS / speed);
    return () => window.clearTimeout(timer);
  }, [playing, total, at, speed]);

  const go = (i: number | null) => {
    setPlaying(false);
    setAnimating(null);
    setAt(i === null || i >= beats.length ? null : Math.max(0, i));
  };
  /** Shows beat i `elapsed` ms into its animation (a manual replay's clock). */
  const pose = (i: number, elapsed: number) => {
    const shown = Math.max(0, Math.min(beats.length - 1, i));
    setPlaying(false);
    setAt(shown);
    setAnimating({ step: shown, start: 0 });
    setElapsed(elapsed);
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
    if (!beats.length) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (at === null) {
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
  const label = at === null ? (battle.active ? "Now" : finalLabel) : current && current.pulse !== null ? `Divine Pulse ${current.pulse + 1} · Turn ${steps[at].turn}` : stepLabel(steps[at]);
  const detail = at === null ? `${plural(steps.length, "step")} to replay` : `step ${at + 1} of ${steps.length}`;
  const army = at === null ? (battle.active || finalPhase === undefined ? "now" : phaseArmy(finalPhase)) : phaseArmy(steps[at].phase);
  const cursor = at === null && battle.active && battle.cursor ? battle.cursor : null;
  // A Divine Pulse being played shows the map as it is undone, and the badge; any other beat, its own animation.
  const rewinding = plan ? rewindAt(plan, elapsed, speed) : null;
  const animation: StepAnimation | null = rewinding ? rewinding.animation : anim ? { ...anim, elapsed } : null;
  const rewind: Rewind | null = rewinding ? { badge: rewinding.badge } : null;
  return { steps, beats, pulses, turns, at, playing, board: rewinding ? rewinding.board : board, action, animation, rewind, cursor, go, seek, seeks, next, play, pose, label, detail, army };
}

export type Replay = ReturnType<typeof useReplay>;

/** The replay beat a log row happened at (null: it has none). */
export function beatOf(item: Item): number | null {
  return item.beats?.[0] ?? item.beat ?? null;
}

/** The key numbers and outlook as they stood at the beat shown (the battle's own when showing now). */
export function replayStats(battle: Battle, replay: Replay, seconds: number): { numbers: KeyNumber[]; chance: number | null; at: number | null } {
  const { at, steps, board, beats, pulses } = replay;
  // Finished battles have no live outlook. Their final trend point is the outlook at the end of playback.
  const now = battle.outlook?.chance ?? battle.trend.at(-1)?.chance ?? null;
  if (at === null) return { numbers: keyNumbers(battle, seconds), chance: now, at: null };
  const step = steps[at];
  const t = beats[at].t;
  const mine = board.pieces.filter((p) => p.army);
  const onMap = mine.filter((p) => !p.down).length;
  const others = board.pieces.filter((p) => !p.army && !p.object);
  const alive = others.filter((p) => !p.down).length;
  const hps = mine.map((p) => (p.hp === null || !p.max ? null : [p.hp, p.max] as const));
  const army = hps.length && hps.every((h) => h !== null) ? hpShare(hps.reduce((n, h) => n + h![0], 0), hps.reduce((n, h) => n + h![1], 0)) : null;
  const usedBy = pulses.filter((p) => p.t <= t).length;
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
export function followed({ cursor, action, board }: Pick<Replay, "cursor" | "action" | "board">): [number, number][] {
  if (cursor) return [cursor];
  const actor = action ? board.pieces.find((p) => p.id === action.actor) : undefined;
  const aimed = action?.target ? board.pieces.find((p) => p.id === action.target) : undefined;
  if (actor) return [[actor.x, actor.y], ...(action?.from ? [action.from] : []), ...(aimed ? [[aimed.x, aimed.y] as [number, number]] : [])];
  return [];
}

/** The army whose phase a step fell in, for the colour of its banner. */
const phaseArmy = (phase: number) => (phase === 0 ? "player" : phase === 1 ? "enemy" : "other");

/** The replay under the map: the buttons, and a timeline from the start (left) to now (right) with a notch per beat
 * (taller at each new turn, coloured by the phase's army). */
export function ReplayBar({ replay: r }: { replay: Replay }) {
  const { steps, beats, turns, at, playing, go } = r;
  const notches = useMemo(() => {
    const starts = new Set(turns.map((t) => t.index));
    return steps.map((s, i) => ({ at: i, className: `${phaseArmy(s.phase)}${starts.has(i) ? " major" : ""}${beats[i].pulse !== null ? " pulse" : ""}` }));
  }, [steps, beats, turns]);
  const end = steps.length;
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
        <IconButton icon={CONCEPT_ICON.next} onClick={r.next} disabled={at === null} label="Next step" className="replay-btn" />
        <IconButton icon={CONCEPT_ICON.last} onClick={() => go(null)} disabled={at === null} label="To the end" className="replay-btn" />
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
