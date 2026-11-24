/** Keeping the battle log on its newest row while nothing is being replayed (parts.tsx's ItemList). Pure functions. */

/** A scroller's place, as the element has it. */
export interface ScrollPlace {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** How near the bottom still counts as at it (px). */
const NEAR = 24;

export const atBottom = (p: ScrollPlace): boolean => p.scrollHeight - p.clientHeight - p.scrollTop <= NEAR;

/** Whether the log keeps following after a scroll from `before` (its scrollTop then): reaching the bottom starts it,
 * scrolling up away from there stops it, and anything else (the glide down to a new row) leaves it as it was. */
export function followsAfterScroll(following: boolean, before: number, now: ScrollPlace): boolean {
  if (atBottom(now)) return true;
  return now.scrollTop < before ? false : following;
}
