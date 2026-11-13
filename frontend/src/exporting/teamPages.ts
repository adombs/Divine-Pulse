/**
 * The pure arithmetic of the video's team pages (components/battle/TeamPages.tsx): how big a page's content is drawn so it
 * stays legible, how many cards a page holds, which pages come where, and what is on screen at a moment of the
 * video (a page, the replay, or a crossfade between two). Nothing here touches the page, so it is tested on its own.
 */

/** Where a picture goes in the video: before the replay, after it, or both. */
export type Placement = "start" | "end" | "both";
export const PLACEMENTS: [Placement, string, string][] = [
  ["start", "Start", "Before the replay"],
  ["end", "End", "After the replay"],
  ["both", "Both", "Before and after the replay"],
];

/** The sides of the replay a placement puts a picture on. */
export const sidesOf = (placement: Placement): ("start" | "end")[] => (placement === "both" ? ["start", "end"] : [placement]);

/** How long each team page stays on screen (ms). */
export const PAGE_MS = 1000;
/** How long the crossfade between two scenes lasts (ms), half either side of the cut; well inside a page's second. */
export const FADE_MS = 200;
/** The smallest body text is drawn at least this share of the frame's height (about 22 px in a 1080p frame). */
export const LEGIBLE_FRACTION = 0.02;

/** How many times bigger than natural text of `minText` px must be drawn to be `LEGIBLE_FRACTION` of the frame's height. */
export const legibleScale = (minText: number, frameHeight: number): number => (minText > 0 ? (frameHeight * LEGIBLE_FRACTION) / minText : 1);

/**
 * How many times bigger than on the page a team page's content is drawn: big enough that its smallest body text
 * (`minText`, px on the page) is `LEGIBLE_FRACTION` of the frame's height, but no bigger than the room across (the
 * content's width must fit) or down (at least one card or row must fit). So legible wherever the room allows; where
 * the frame is too narrow for that, as big as the width lets it be.
 */
export function pageScale({ minText, frameHeight, contentWidth, roomWidth, minHeight, roomHeight }: {
  minText: number;
  frameHeight: number;
  contentWidth: number;
  roomWidth: number;
  /** The least height the content needs on a page (one card; the header, one row and the totals). */
  minHeight: number;
  roomHeight: number;
}): number {
  if (!(minText > 0) || !(contentWidth > 0) || !(minHeight > 0)) return 1;
  const legible = legibleScale(minText, frameHeight);
  return Math.max(0.1, Math.min(legible, roomWidth / contentWidth, roomHeight / minHeight));
}

/** How many cards of `cardHeight` (drawn at `scale`, `gap` apart, both px) a column `roomHeight` tall holds; never fewer than one. */
export function cardsPerPage(roomHeight: number, cardHeight: number, gap: number, scale: number): number {
  const each = cardHeight * scale;
  if (!(each > 0)) return 1;
  return Math.max(1, Math.floor((roomHeight + gap) / (each + gap)));
}

/** `items` in pages of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** A way to lay a loadout card out: how many columns it packs into, and how big that makes it (px, natural size). */
export interface CardLayout {
  columns: number;
  w: number;
  h: number;
}

/**
 * Which of a card's layouts a frame draws it in: the one whose text can be drawn biggest (the room across and down
 * permitting); among layouts that all reach the legible size, the one that holds the most cards to a page, then the
 * one that fills the frame's width best, then the fewest columns. A tall frame has room down but little across, so it gets a narrow, tall card; a wide one, a wide one.
 */
export function chooseCardLayout<L extends CardLayout>(layouts: readonly L[], o: { minText: number; frameHeight: number; roomWidth: number; roomHeight: number; gap: number }): { layout: L; scale: number; perPage: number } | null {
  const options = layouts
    .filter((l) => l.w > 0 && l.h > 0)
    .map((layout) => {
      const scale = pageScale({ minText: o.minText, frameHeight: o.frameHeight, contentWidth: layout.w, roomWidth: o.roomWidth, minHeight: layout.h, roomHeight: o.roomHeight });
      return { layout, scale, perPage: cardsPerPage(o.roomHeight, layout.h, o.gap, scale) };
    });
  if (!options.length) return null;
  const best = Math.max(...options.map((x) => x.scale));
  return options
    .filter((x) => x.scale >= best * 0.98)
    .sort((a, b) => b.perPage - a.perPage || b.layout.w - a.layout.w || a.layout.columns - b.layout.columns)[0];
}

/** A stretch of the video: what it is and how long it lasts (ms). */
export interface Segment {
  id: string;
  ms: number;
}

/** What the frame shows: scene `a` at `a.local` ms into it and, while one fades into the next, `b` at `mix` (0 to 1) over it. */
export interface Scene {
  a: { index: number; local: number };
  b: { index: number; local: number } | null;
  mix: number;
}

/** When each segment starts (ms into the video). */
export function segmentStarts(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of segments) {
    out.push(t);
    t += s.ms;
  }
  return out;
}

const smooth = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/**
 * What the video shows at `ms`: one segment, or, within half a `fade` of the cut between two, the two blended (the
 * earlier held at its last instant and the later at its first until the cut passes; the video's length stays the sum
 * of its segments, so the replay's own clock is never skipped).
 */
export function sceneAt(segments: readonly Segment[], ms: number, fade = FADE_MS): Scene {
  const starts = segmentStarts(segments);
  const n = segments.length;
  let i = 0;
  while (i + 1 < n && starts[i + 1] <= ms) i++;
  const at = (index: number) => ({ index, local: Math.max(0, Math.min(segments[index].ms, ms - starts[index])) });
  const end = starts[i] + segments[i].ms;
  if (i + 1 < n && ms > end - fade / 2) return { a: at(i), b: at(i + 1), mix: smooth((ms - (end - fade / 2)) / fade) };
  if (i > 0 && ms < starts[i] + fade / 2) return { a: at(i - 1), b: at(i), mix: smooth((ms - (starts[i] - fade / 2)) / fade) };
  return { a: at(i), b: null, mix: 0 };
}
