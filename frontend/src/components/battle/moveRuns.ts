/**
 * Moves played together: consecutive beats of one phase that only move units (nobody attacks, heals, uses anything,
 * arrives, leaves, falls or gets up, and the log has nothing but moves for them) replay as one animation, everyone
 * moving at once from where they stood before the first. A phase or turn changing, or a Divine Pulse, ends a run. Pure
 * functions: replay.tsx and the video export play the runs.
 */
import type { Frame, StepKinds } from "./map";
import type { Item } from "./model";
import { shown } from "./stillBeats";

/** What a beat has to show for the test. */
export interface RunCandidate {
  step: { turn: number; phase: number; actor: string | null };
  frame: Frame;
  pulse: number | null;
  segment: number;
}

/** For each beat: `end`, the last beat of the run it is in (itself when in none), and `from`, the beat whose map it
 * plays from (the one before it; for the last beat of a run, the one before the run). */
export interface MoveRuns {
  end: number[];
  from: number[];
}

/** Log rows a beat of moves can have: the moves and waits themselves, and the phase or turn that starts with them. */
const MOVE_ROWS = new Set(["move", "wait", "phase", "turn", "start"]);

/** Whether going from one map to the next only moves units: someone moved, and nobody arrived, left, fell or got up. */
export function onlyMoves(before: Frame, after: Frame): boolean {
  const was = shown(before);
  const now = shown(after);
  let moved = false;
  for (const [id, [x, y, down]] of now) {
    const q = was.get(id);
    if (!q) {
      if (!down) return false; // arrived
    } else if (q[2] !== down) return false; // fell or got up
    else if (!down && (q[0] !== x || q[1] !== y)) moved = true;
  }
  for (const [id, q] of was) if (!q[2] && !now.has(id)) return false; // left the map
  return moved;
}

export function moveRuns(beats: RunCandidate[], items: Item[], kinds?: StepKinds, acting?: ReadonlySet<number>): MoveRuns {
  const busy = new Set<number>();
  for (const item of items) if (item.beat != null && !item.heading && !MOVE_ROWS.has(item.kind)) busy.add(item.beat);
  const plain = beats.map((b, i) =>
    i > 0 && b.pulse === null && b.step.actor != null && !busy.has(i) && !acting?.has(i) && !kinds?.has(i) && onlyMoves(beats[i - 1].frame, b.frame),
  );
  const together = (i: number) => {
    const a = beats[i - 1];
    const b = beats[i];
    return plain[i - 1] && plain[i] && a.step.turn === b.step.turn && a.step.phase === b.step.phase && a.segment === b.segment;
  };
  return collect(beats.length, (i) => plain[i], together);
}

/**
 * Attacks played together: consecutive beats of one phase in which different units (or the same one again) attack the
 * same target replay as one animation, the attackers moving at once and then striking one shortly after another, so
 * their order still shows. A phase or turn changing, a Divine Pulse, or another target ends a run.
 */
export function attackRuns(beats: (RunCandidate & { step: { target?: string | null } })[], kinds?: StepKinds): MoveRuns {
  const target = (i: number) => {
    const b = beats[i];
    const t = b.step.target;
    return i > 0 && b.pulse === null && b.step.actor != null && kinds?.get(i) === "attack" && t && t !== b.step.actor ? t : null;
  };
  const together = (i: number) => {
    const a = beats[i - 1];
    const b = beats[i];
    const t = target(i);
    return t !== null && target(i - 1) === t && a.step.turn === b.step.turn && a.step.phase === b.step.phase && a.segment === b.segment;
  };
  return collect(beats.length, (i) => target(i) !== null, together);
}

/** Both kinds of run in one (they never overlap: a beat of moves has no attack in it). */
export function mergeRuns(a: MoveRuns, b: MoveRuns): MoveRuns {
  const inRun = (r: MoveRuns, i: number) => r.end[i] !== i || r.from[i] !== Math.max(0, i - 1);
  return {
    end: a.end.map((e, i) => (inRun(a, i) ? e : b.end[i])),
    from: a.from.map((f, i) => (inRun(a, i) ? f : b.from[i])),
  };
}

/** The runs of `n` beats: from each beat that can start one, on through every next beat `together` with the one before. */
function collect(n: number, member: (i: number) => boolean, together: (i: number) => boolean): MoveRuns {
  const end = Array.from({ length: n }, (_, i) => i);
  const from = Array.from({ length: n }, (_, i) => Math.max(0, i - 1));
  for (let s = 1; s < n; s++) {
    if (!member(s)) continue;
    let e = s;
    while (e + 1 < n && together(e + 1)) e++;
    if (e > s) {
      for (let k = s; k <= e; k++) end[k] = e;
      from[e] = s - 1;
    }
    s = e;
  }
  return { end, from };
}
