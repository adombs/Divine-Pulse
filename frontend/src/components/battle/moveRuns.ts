/**
 * Actions played together: consecutive beats of one phase aimed at the same unit (several attacks on one enemy, heals
 * on one ally), or each unit at itself (moves, waits, a heal of its own: everyone moving at once), replay as one
 * animation. The replay may stagger them (replay.tsx) so their order still shows. A phase or turn changing, or a Divine
 * Pulse, ends a run. Pure functions: replay.tsx and the video export play the runs.
 */
import type { StepKinds } from "./map";

/** What a beat has to show for the test. */
export interface GroupCandidate {
  step: { turn: number; phase: number; actor: string | null; target?: string | null };
  pulse: number | null;
  segment: number;
}

/** For each beat: `end`, the last beat of the run it is in (itself when in none), and `from`, the beat whose map it
 * plays from (the one before it; for the last beat of a run, the one before the run). */
export interface MoveRuns {
  end: number[];
  from: number[];
}

/** The shared target of every action a unit does to itself alone (a move, a wait, a heal of its own). */
export const SELF = "self";

/** Whom a beat's action is aimed at: the other unit it attacks or helps, or SELF for anything a unit does on its own. */
export function beatTarget(beat: GroupCandidate, kind: "attack" | "heal" | undefined): string | null {
  if (beat.pulse !== null || beat.step.actor == null) return null;
  const target = beat.step.target;
  return kind && target && target !== beat.step.actor ? target : SELF;
}

/** Each beat's run of actions played together: consecutive beats of one phase aimed at the same unit, or each at its own
 * unit (SELF). A phase or turn changing, a Divine Pulse, or another target ends a run. */
export function actionRuns(beats: GroupCandidate[], kinds?: StepKinds): MoveRuns {
  const key = beats.map((b, i) => (i > 0 ? beatTarget(b, kinds?.get(i)) : null));
  const together = (i: number) => {
    const a = beats[i - 1];
    const b = beats[i];
    return key[i] !== null && key[i] === key[i - 1] && a.step.turn === b.step.turn && a.step.phase === b.step.phase && a.segment === b.segment;
  };
  return collect(beats.length, (i) => key[i] !== null, together);
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
