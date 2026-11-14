/**
 * The pure arithmetic of the video's team pages (components/battle/TeamPages.tsx): how a page's grid of cards is laid out
 * and how big its content is drawn so it stays legible, which pages come where, and what is on screen at a moment of the
 * video (a page, the replay, or a crossfade between two). Nothing here touches the page, so it is tested on its own.
 */

/** Where a picture goes in the video: before the replay or after it. */
export type Placement = "start" | "end";
export const PLACEMENTS: [Placement, string, string][] = [
  ["start", "Start", "Before the replay"],
  ["end", "End", "After the replay"],
];

/** The sides of the replay a placement puts a picture on. */
export const sidesOf = (placement: Placement): ("start" | "end")[] => ([placement]);

/** How long each team page stays on screen by default (ms). */
export const PAGE_MS = 1000;
/** The lengths (seconds) a page of the video can be set to stay on screen; the shortest leaves room for the crossfade. */
export const PAGE_SECONDS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15];
/** A saved page length: one of `PAGE_SECONDS`, or `fallback`. */
export const sanitizeSeconds = <T extends number | null>(v: unknown, fallback: T): number | T =>
  typeof v === "number" && PAGE_SECONDS.includes(v) ? v : fallback;
/** Seconds as the Team tab writes them: "1 s", "1.5 s". */
export const fmtSeconds = (s: number): string => `${s.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
/** How long the crossfade between two scenes lasts (ms), half either side of the cut; well inside a page's second. */
export const FADE_MS = 200;
/** The smallest text is drawn at least this share of the frame's short side (about 22 px in a 1080p frame, either way up). */
export const LEGIBLE_FRACTION = 0.02;

/** How many times bigger than natural text of `minText` px must be drawn to be `LEGIBLE_FRACTION` of the frame's short side. */
export const legibleScale = (minText: number, frameShortSide: number): number => (minText > 0 ? (frameShortSide * LEGIBLE_FRACTION) / minText : 1);

/** `items` in pages of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** The most columns and rows the Team tab offers; Auto never goes past them. */
export const MAX_COLUMNS = 6;
export const MAX_ROWS = 8;

/** A grid axis the player fixed (a whole number), or null for Auto. */
export type Axis = number | null;

/** A page's grid: how many cards across and down, how big its contents are drawn, and what that makes of the cards. */
export interface GridPlan {
  columns: number;
  rows: number;
  /** Cards to a page (columns x rows). */
  perPage: number;
  /** How many times bigger than natural the cards are drawn. */
  scale: number;
  /** A card's cell and the gap between cells, in the cards' own (natural) pixels; the grid is `width` x `height` of them. */
  cellW: number;
  cellH: number;
  gap: number;
  width: number;
  height: number;
  /** True when the text comes out smaller than the legible size (only a fixed axis, or a frame too small for even one card, does that). */
  small: boolean;
}

/**
 * How a page's cards are laid out in a room (px): `columns` x `rows` cells, each `card` (its natural size, `minText` the
 * smallest text on it) drawn as big as its cell allows. An Auto axis (null) takes as many as keep the text at the legible
 * size (`LEGIBLE_FRACTION` of the frame's short side); when `count` cards fit one page that way, the layout that draws them
 * biggest is taken instead of more empty cells. A fixed axis is kept even where it pushes the text below that size (`small`).
 */
export function planGrid(o: {
  minText: number;
  frameShortSide: number;
  card: { w: number; h: number };
  roomWidth: number;
  roomHeight: number;
  /** Gap between cells, px at the frame's own size. */
  gap: number;
  columns: Axis;
  rows: Axis;
  count: number;
}): GridPlan | null {
  const { card, roomWidth, roomHeight, gap } = o;
  if (!(card.w > 0 && card.h > 0 && roomWidth > 0 && roomHeight > 0)) return null;
  const floor = legibleScale(o.minText, o.frameShortSide);
  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const options = (o.columns ? [o.columns] : upTo(MAX_COLUMNS)).flatMap((columns) => (o.rows ? [o.rows] : upTo(MAX_ROWS)).map((rows) => {
    const cw = (roomWidth - (columns - 1) * gap) / columns;
    const ch = (roomHeight - (rows - 1) * gap) / rows;
    return { columns, rows, perPage: columns * rows, scale: Math.min(cw / card.w, ch / card.h) };
  }));
  const legible = options.filter((x) => x.scale >= floor - 1e-9);
  // Where nothing reaches the legible size (a fixed axis, or a frame too small), the layout that draws the text biggest.
  const best = legible.length
    ? (() => {
        const holdsAll = legible.filter((x) => x.perPage >= o.count);
        return holdsAll.length ? holdsAll.sort((a, b) => b.scale - a.scale || a.perPage - b.perPage)[0] : legible.sort((a, b) => b.perPage - a.perPage || b.scale - a.scale)[0];
      })()
    : options.sort((a, b) => b.scale - a.scale || a.perPage - b.perPage)[0];
  const scale = Math.max(0.05, best.scale);
  return {
    columns: best.columns, rows: best.rows, perPage: best.perPage, scale,
    width: roomWidth / scale, height: roomHeight / scale, gap: gap / scale,
    cellW: (roomWidth - (best.columns - 1) * gap) / best.columns / scale,
    cellH: (roomHeight - (best.rows - 1) * gap) / best.rows / scale,
    small: scale < floor - 1e-9,
  };
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
