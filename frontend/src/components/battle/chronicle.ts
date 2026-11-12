/**
 * One chronology of a whole battle, undone actions included, as it really happened: the actions up to a Divine Pulse,
 * the Divine Pulse itself, then what was done after it. Each use of Divine Pulse turns time back, and the game's history
 * is cut back to the position it was turned back to; what was undone is kept in a Branch, with the map history as it
 * stood just before (a snapshot). The chronicle lays them end to end:
 *
 *   segment 0: the actions up to Divine Pulse 1 (snapshot 0), then Divine Pulse 1,
 *   segment 1: the actions after it up to Divine Pulse 2 (snapshot 1), then Divine Pulse 2, ... the last segment
 *   is what stands (the battle's own map history).
 *
 * The replay steps through the beats (one per action that animates something, one per Divine Pulse; a still action is
 * left out, see stillBeats.ts), and the log has a row for each action. Pure
 * functions: the replay and the log only render these.
 */
import type { Battle, Branch, MapStep } from "../../api";
import { Frame, frames } from "./map";
import { build, Item, pulseSummary } from "./model";
import { actingBeats } from "./replayLabels";
import { renumber, stillBeats } from "./stillBeats";

/** One notch of the replay: an action, or a use of Divine Pulse. */
export interface Beat {
  /** The map step (its `step` is the beat's own index in the chronicle, so every beat is unique). */
  step: MapStep;
  /** The history position of the action (null for a Divine Pulse). */
  pos: number | null;
  /** How many Divine Pulse uses came before it. */
  segment: number;
  /** Which use of Divine Pulse this is (0 for the first); null for an action. */
  pulse: number | null;
  /** Where everyone stood after it (for a Divine Pulse: after time was turned back). */
  frame: Frame;
  /** A Divine Pulse only: where everyone stood while it undid its steps, last step undone first, ending on `frame`. */
  undo: Frame[];
  /** When it happened (seconds into the battle). */
  t: number;
}

/** One use of Divine Pulse. */
export interface Pulse {
  index: number;
  /** Its beat (null: this recording can't replay it). */
  beat: number | null;
  turn: number | null;
  /** When it was used (seconds into the battle). */
  t: number;
}

export interface Chronicle {
  beats: Beat[];
  /** Everything that happened, in order, with the Divine Pulse rows (what the statistics read). */
  items: Item[];
  /** The log as shown: `items`, with the defeat of a step folded into the row of its action. */
  log: Item[];
  pulses: Pulse[];
  /** Whether every use of Divine Pulse can be replayed on the map (older recordings kept no map history for them). */
  complete: boolean;
}

const EMPTY: Frame = new Map();

/** Which beats attacked and which healed (for the arrows on the map): beat -> "attack" / "heal". */
export function actionKinds(items: Item[]): Map<number, "attack" | "heal"> {
  const result = new Map<number, "attack" | "heal">();
  for (const item of items) {
    if (item.beat == null || item.rehomed) continue;
    if (item.kind === "attack") result.set(item.beat, "attack");
    else if ((item.kind === "heal" || item.kind === "item") && !result.has(item.beat)) result.set(item.beat, "heal");
  }
  return result;
}

/** The replay beat where an army unit (its key) fell in the timeline that stands, the last time it did (null: it
 * didn't, or this recording can't replay it). */
export function fallBeat(chron: Chronicle, key: string): number | null {
  const actor = `a:${key}`;
  const fall = chron.items.filter((i) => i.kind === "fell" && i.actor === actor && i.undoneBy == null && i.pulse === undefined).at(-1);
  return fall ? (fall.beats?.[0] ?? fall.beat ?? null) : null;
}

/** The Divine Pulse uses in the order they happened. */
export const sortedBranches = (battle: Battle): Branch[] => [...(battle.branches ?? [])].sort((a, b) => a.at - b.at);

/** Whether a log entry is the Divine Pulse that `branch` made (the chronicle shows its own row instead). */
const isPulseOf = (branch: Branch, kind: string, step: number | null | undefined, t: number) =>
  kind === "pulse" && branch.fork === step && Math.abs(branch.at - t) < 1;

export function chronicle(battle: Battle): Chronicle {
  const branches = sortedBranches(battle);
  const P = branches.length;
  const complete = branches.every((b) => (b.map_steps?.length ?? 0) > 0);
  // Where each segment's own actions begin: the history position time was turned back to.
  const starts = [0, ...branches.map((b) => b.fork)];
  const snapshots = [...branches.map((b) => ({ steps: b.map_steps ?? [], presence: b.map_presence })), { steps: battle.map_steps ?? [], presence: battle.map_presence }];
  const all = snapshots.map((s) => frames(s.steps, s.presence));

  // Beats, and the beat of each (segment, history position).
  let beats: Beat[] = [];
  const at = snapshots.map(() => new Map<number, number>());
  let pulseBeat: (number | null)[] = branches.map(() => null);
  // Without a snapshot for every use, only what stands is replayed (as the last segment).
  for (const k of complete ? snapshots.keys() : [P]) {
    const { steps } = snapshots[k];
    const segment = complete ? k : P;
    steps.forEach((s, i) => {
      if (complete && s.step < starts[k]) return;
      const index = beats.length;
      at[segment].set(s.step, index);
      beats.push({ step: { ...s, step: index }, pos: s.step, segment, pulse: null, frame: all[k][i], undo: [], t: 0 });
    });
    if (!complete || k === P) continue;
    // The Divine Pulse: back to the last step before the fork; the steps after it are undone in reverse.
    const b = branches[k];
    const r = steps.reduce((n, s, i) => (s.step < b.fork ? i : n), -1);
    const rewound = r < 0 ? undefined : steps[r];
    const next = rewound ? snapshots[k + 1].steps.findIndex((s) => s.step === rewound.step) : -1;
    const frame = rewound ? (next >= 0 ? all[k + 1][next] : all[k][r]) : EMPTY;
    const undo = [...all[k].slice(Math.max(r, 0)).reverse(), ...(r < 0 ? [EMPTY] : [])];
    undo[undo.length - 1] = frame;
    const index = beats.length;
    pulseBeat[k] = index;
    beats.push({
      step: { step: index, turn: rewound?.turn ?? b.turn ?? steps.at(-1)?.turn ?? 1, phase: rewound?.phase ?? 0, actor: null, target: null, units: {} },
      pos: null, segment: k, pulse: k, frame, undo, t: b.at,
    });
  }

  // Items: every list of entries, each placed in the segment it was done in.
  const segmentOf = (k: number, step: number | null, t: number) => {
    if (step === null) return branches.filter((b) => b.at <= t).length;
    let found = 0;
    for (let j = 0; j <= k; j++) if (starts[j] <= step) found = j;
    return found;
  };
  const entries: { item: Item; segment: number; pos: number | null; order: number }[] = [];
  const add = (list: Item[], k: number) =>
    list.forEach((item) => {
      const segment = Math.min(k, segmentOf(k, item.step, item.t));
      const beat = item.step === null || !(complete || k === P) ? null : (at[complete ? segment : P].get(item.step) ?? null);
      entries.push({
        item: { ...item, beat, undoneBy: k < P ? k : null, undoneAt: k < P ? pulseBeat[k] : null },
        segment,
        pos: item.step,
        order: entries.length,
      });
    });
  const isPulse = (kind: string, step: number | null | undefined, t: number) => branches.some((b) => isPulseOf(b, kind, step, t));
  add(build(battle, battle.log.filter((e) => !isPulse(e.kind, e.step, e.t)), battle.events.filter((e) => !(e.kind === "divine_pulse" && branches.some((b) => Math.abs(b.at - e.t) < 2))), 0), P);
  branches.forEach((b, k) => {
    add(build(battle, b.log.filter((e) => !isPulse(e.kind, e.step, e.t)), b.events.filter((e) => !(e.kind === "divine_pulse" && branches.some((x) => Math.abs(x.at - e.t) < 2))), b.id), k);
  });
  // The Divine Pulse rows close their segment.
  branches.forEach((b, k) => {
    entries.push({
      item: {
        key: `pulse${b.id}`, t: b.at, turn: b.turn, phase: null, kind: "pulse", category: "turn", text: pulseSummary(b), heading: false,
        actor: null, target: null, dealt: null, taken: null, restored: null, confidence: null, branch: 0, step: null,
        beat: pulseBeat[k], undoneBy: null, undoneAt: null, pulse: k,
      },
      segment: k,
      pos: Infinity,
      order: entries.length,
    });
  });
  entries.sort((x, y) => x.segment - y.segment || Number(x.pos === Infinity) - Number(y.pos === Infinity) || x.item.t - y.item.t || (x.pos ?? 1e9) - (y.pos ?? 1e9) || x.order - y.order);

  // Still beats (nothing to animate) are not steps of the replay: leave them out, renumber the rest, and point every
  // index that was at a removed beat at the next one kept.
  const removed = stillBeats(beats, actionKinds(entries.map((e) => e.item)), actingBeats(entries.map((e) => e.item)));
  if (removed.size) {
    const to = renumber(removed, beats.length);
    const move = (i: number | null | undefined) => (i == null ? i : to[i]);
    for (const { item } of entries) {
      if (item.beat != null && removed.has(item.beat)) item.rehomed = true;
      item.beat = move(item.beat);
      item.undoneAt = move(item.undoneAt);
    }
    pulseBeat = pulseBeat.map((b) => move(b) as number | null);
    beats = beats.filter((_, i) => !removed.has(i)).map((b, i) => ({ ...b, step: { ...b.step, step: i } }));
  }

  // Turns for what has none (level-ups...): the turn of what came before.
  let turn: number | null = null;
  for (const { item } of entries) {
    if (item.turn !== null) turn = item.turn;
    else item.turn = turn;
  }

  // When each beat happened: the last thing done at or before it.
  let t = 0;
  const byBeat = new Map<number, number>();
  for (const { item } of entries) if (item.beat != null && !item.heading) byBeat.set(item.beat, Math.max(byBeat.get(item.beat) ?? 0, item.t));
  beats.forEach((beat, i) => {
    t = beat.pulse !== null ? branches[beat.pulse].at : Math.max(t, byBeat.get(i) ?? t);
    beat.t = t;
  });

  const items = entries.map((e) => e.item);
  const pulses: Pulse[] = branches.map((b, k) => ({ index: k, beat: pulseBeat[k], turn: b.turn, t: b.at }));
  return { beats, items, log: foldDefeats(entries), pulses, complete };
}

/**
 * The log as shown: one row for each step of the map. A defeat is logged apart from the action that caused it ("Marianne
 * used Knightkneeler on Bandit" and "Marianne killed Bandit"): the defeat's row is left out, and its action's row says a
 * unit went down. A step with only a defeat keeps it. Level-ups and the like belong to no step and stay.
 */
function foldDefeats(entries: { item: Item; segment: number; pos: number | null }[]): Item[] {
  const isDefeat = (i: Item) => i.kind === "defeat" || i.kind === "fell";
  const key = (e: { segment: number; pos: number | null }) => `${e.segment}:${e.pos}`;
  const primary = new Map<string, Item>();
  for (const e of entries) {
    if (e.pos === null || e.pos === Infinity || e.item.heading || isDefeat(e.item) || e.item.kind === "pulse") continue;
    if (!primary.has(key(e))) primary.set(key(e), { ...e.item });
  }
  const kept = new Set<string>();
  const out: Item[] = [];
  for (const e of entries) {
    const k = key(e);
    if (e.pos !== null && e.pos !== Infinity && !e.item.heading && isDefeat(e.item)) {
      const main = primary.get(k);
      if (main) {
        main.defeated = true;
        continue;
      }
      if (kept.has(k)) continue;
      kept.add(k);
      out.push(e.item);
    } else if (primary.get(k)?.key === e.item.key) out.push(primary.get(k)!);
    else out.push(e.item);
  }
  return out;
}
