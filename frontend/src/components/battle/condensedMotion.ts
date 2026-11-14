import type { CondensedEntry } from "./replayLabels";

export const LOG_MOTION_MS = 220;
export interface MotionRow { entry: CondensedEntry; presence: number; opacity: number; }
export interface LogMotion { start: number; from: MotionRow[]; to: CondensedEntry[]; }
export function sampleLogMotion(motion: LogMotion, time: number): MotionRow[] {
  const p = Math.max(0, Math.min(1, (time - motion.start) / LOG_MOTION_MS));
  const ease = 1 - (1 - p) ** 3;
  const keys = new Set(motion.to.map((e) => e.key));
  const rows = [...motion.from, ...motion.to.filter((e) => !motion.from.some((r) => r.entry.key === e.key)).map((entry) => ({ entry, presence: 0, opacity: 0 }))];
  return rows.map((row) => {
    const index = motion.to.findIndex((e) => e.key === row.entry.key);
    const target = index < 0 ? 0 : (index + 1) / motion.to.length;
    return { entry: motion.to[index] ?? row.entry, presence: row.presence + ((keys.has(row.entry.key) ? 1 : 0) - row.presence) * ease, opacity: row.opacity + (target - row.opacity) * ease };
  }).filter((row) => row.presence > 0.0001);
}
export function startLogMotion(previous: LogMotion | null, entries: CondensedEntry[], time: number): LogMotion {
  return { start: time, from: previous && time >= previous.start ? sampleLogMotion(previous, time) : [], to: entries };
}
