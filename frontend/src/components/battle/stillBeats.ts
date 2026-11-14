/**
 * Still beats: a step of the chronicle that animates nothing when replayed (a phase starting, "Fight!", a unit waiting
 * where it stands). They stay in the log but are not steps of the replay. Pure functions: chronicle.ts uses them to
 * leave such beats out and to point everything that referred to one at the next beat that is kept.
 */
import type { MapStep } from "../../api";
import { Frame, MAP_SIZE, stepAction, StepKinds } from "./map";

/** What a beat has to show for the test: its map step, the map after it, and whether it is a Divine Pulse. */
export interface StillCandidate {
  step: MapStep;
  frame: Frame;
  pulse: number | null;
}

/** Who is on the map in a frame, and whether they are down (as the map draws it: map.boardAt). */
export function shown(frame: Frame): Map<string, [number, number, boolean]> {
  const out = new Map<string, [number, number, boolean]>();
  for (const [id, [x, y, hp]] of frame) if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) out.set(id, [x, y, hp <= 0]);
  return out;
}

/** Whether going from one map to the next animates anything: a unit moved, arrived, left, fell or got up. (HP alone
 * changes nothing the replay plays.) */
export function animates(before: Frame, after: Frame): boolean {
  const was = shown(before);
  const now = shown(after);
  for (const [id, [x, y, down]] of now) {
    const q = was.get(id);
    if (!q) {
      if (!down) return true; // arrived
    } else if (q[0] !== x || q[1] !== y || q[2] !== down) return true; // moved, fell or got up
  }
  for (const [id, q] of was) if (!q[2] && !now.has(id)) return true; // left the map
  return false;
}

/**
 * The beats that are still, by index. Never the first, never a Divine Pulse. `acting` are beats that show something
 * on the map even where nothing moves (the labels of a Rally, a gambit...).
 */
export function stillBeats(beats: StillCandidate[], kinds?: StepKinds, acting?: ReadonlySet<number>): Set<number> {
  const steps = beats.map((b) => b.step);
  const frames = beats.map((b) => b.frame);
  const out = new Set<number>();
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].pulse !== null) continue;
    if (acting?.has(i)) continue;
    const action = stepAction(steps, frames, i, kinds);
    if (action && action.kind !== "none") continue;
    if (animates(frames[i - 1], frames[i])) continue;
    out.add(i);
  }
  return out;
}

/** Where each of `count` beats goes when `removed` are taken out: its new index, or for a removed beat the new index
 * of the next beat that is kept (the previous one when none follows). */
export function renumber(removed: ReadonlySet<number>, count: number): number[] {
  const to: number[] = new Array(count);
  let kept = 0;
  for (let i = 0; i < count; i++) if (!removed.has(i)) to[i] = kept++;
  let next = kept - 1;
  for (let i = count - 1; i >= 0; i--) {
    if (removed.has(i)) to[i] = Math.max(0, next);
    else next = to[i];
  }
  return to;
}
