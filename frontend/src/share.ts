/** A share of a whole (HP left, spell uses left), 0 to 1, and how it reads everywhere it is shown: at most LOW_SHARE
 * is low (red), at most MID_SHARE middling (amber). */
export const LOW_SHARE = 0.3;
export const MID_SHARE = 0.6;

export type ShareTone = "bad" | "warn" | "good";

/** The value kept within 0 and 1. */
export const clampShare = (value: number): number => Math.max(0, Math.min(1, value));

export function shareTone(share: number): ShareTone {
  const s = clampShare(share);
  return s <= LOW_SHARE ? "bad" : s <= MID_SHARE ? "warn" : "good";
}
