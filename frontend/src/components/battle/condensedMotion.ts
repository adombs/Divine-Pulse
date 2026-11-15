/**
 * How the condensed log's rows move. The log has a fixed number of slots, filled from the bottom: a new row grows in at
 * the bottom and pushes the others up, while the top slot's row (or, before the log is full, an empty slot) shrinks
 * away. Starting empty, filling up and scrolling once full therefore all move the same way. A row's opacity follows its
 * slot (its age), never how many rows there are.
 */

export const LOG_MOTION_MS = 220;
/** The key prefix of an empty slot. */
export const BLANK = "blank:";

export interface Keyed { key: string; }
export interface MotionRow<T extends Keyed = Keyed> { entry: T; presence: number; opacity: number; }
export interface LogMotion<T extends Keyed = Keyed> { start: number; from: MotionRow<T>[]; to: T[]; slots: number; }

export const isBlank = (entry: Keyed) => entry.key.startsWith(BLANK);

/** `entries` (oldest first) in `slots` slots: the newest `slots` of them, under empty slots for the rest. The empty slots
 * are keyed so the top one is the one that goes when a row comes in. */
export function fillSlots<T extends Keyed>(entries: T[], slots: number): T[] {
  const rows = entries.slice(Math.max(0, entries.length - slots));
  const empty = Math.max(0, slots - rows.length);
  return [...Array.from({ length: empty }, (_, j) => ({ key: `${BLANK}${empty - 1 - j}` }) as T), ...rows];
}

export function sampleLogMotion<T extends Keyed>(motion: LogMotion<T>, time: number): MotionRow<T>[] {
  const p = Math.max(0, Math.min(1, (time - motion.start) / LOG_MOTION_MS));
  const ease = 1 - (1 - p) ** 3;
  const keys = new Set(motion.to.map((e) => e.key));
  const slots = Math.max(1, motion.slots);
  return merged(motion).map((row) => {
    const index = motion.to.findIndex((e) => e.key === row.entry.key);
    // By its slot: the newest (bottom) row is full, each slot up a step fainter; gone, it fades out.
    const target = index < 0 ? 0 : Math.max(0, (slots - (motion.to.length - 1 - index)) / slots);
    return { entry: motion.to[index] ?? row.entry, presence: row.presence + ((keys.has(row.entry.key) ? 1 : 0) - row.presence) * ease, opacity: row.opacity + (target - row.opacity) * ease };
  }).filter((row) => row.presence > 0.0001);
}

/** The rows on their way out where they were, and the rows coming in where they go (just above the next row they precede). */
function merged<T extends Keyed>(motion: LogMotion<T>): MotionRow<T>[] {
  const was = new Set(motion.from.map((r) => r.entry.key));
  const out: MotionRow<T>[] = [];
  const coming: MotionRow<T>[] = [];
  let i = 0;
  for (const entry of motion.to) {
    if (!was.has(entry.key)) {
      coming.push({ entry, presence: 0, opacity: 0 });
      continue;
    }
    while (i < motion.from.length) {
      const row = motion.from[i++];
      if (row.entry.key === entry.key) {
        out.push(...coming.splice(0), row);
        break;
      }
      out.push(row);
    }
  }
  return [...out, ...motion.from.slice(i), ...coming];
}

/** A move to `entries` from wherever `previous` is at `time`. With none (or the clock gone back), the rows come in, but
 * empty slots are simply there. */
export function startLogMotion<T extends Keyed>(previous: LogMotion<T> | null, entries: T[], time: number, slots = entries.length): LogMotion<T> {
  const from = previous && time >= previous.start
    ? sampleLogMotion(previous, time)
    : entries.filter(isBlank).map((entry) => ({ entry, presence: 1, opacity: 0 }));
  return { start: time, from, to: entries, slots };
}
