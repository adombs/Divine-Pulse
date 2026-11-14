/**
 * The logs of a video (components/battle/ReplayExport.tsx): the log, its own part of the frame beside the map (16:9,
 * 1.91:1) or under it (9:16, 4:5), with how many of its rows show; and the condensed log, the newest actions as one line
 * each in the map's bottom-right corner (CondensedLog.tsx); and what else sits over the map, the turn counter and the
 * legend's counts. Without the log, the map takes the whole frame under the title. Kept apart from the page so it is
 * tested on its own.
 */
import type { CSSProperties } from "react";

/** The most condensed log rows its Lines slider offers, and how many it shows unless set. */
export const MAX_CONDENSED_LINES = 8;
export const DEFAULT_CONDENSED_LINES = 4;
/** The sizes the condensed log, the turn counter and the legend's counts can be (against their own size), smallest to
 * largest. */
export const CONDENSED_SIZES = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2] as const;
export const OVERLAY_SIZES = CONDENSED_SIZES;

/** An overlay's size as the style it carries: each overlay's CSS sets its text to its own base size times
 * `--overlay-size`, so its size never depends on the text around it or on the other overlays. */
export const overlaySizeStyle = (size: number) => ({ "--overlay-size": size }) as CSSProperties;

export interface VideoLogOptions {
  /** Whether the frame has the log. */
  show: boolean;
  /** Whether the map has the condensed log in its corner. */
  condensed: boolean;
  /** The most condensed log rows shown at a time (the newest ones). */
  condensedLines: number;
  /** How big the condensed log is (one of CONDENSED_SIZES; 1 is the log's text size). */
  condensedSize: number;
  /** Whether the map has the turn counter (Turn 3/12 · Player Phase · Step 45/69), and how big. */
  counter: boolean;
  counterSize: number;
  counterTurn: boolean;
  counterPhase: boolean;
  counterStep: boolean;
  /** Whether the map has the legend's counts (units standing in each army, and the killed), and how big. */
  counts: boolean;
  countsSize: number;
  countsZero: boolean;
  /** The map's corner each of those is in. */
  place: Record<Overlay, Corner>;
  /** The order they were put in their corners (oldest first): in a corner, the first is nearest the corner, the rest
   * stacked down from a top corner or up from a bottom one. */
  order: Overlay[];
}

/** What can sit over the video's map, and where. */
export type Overlay = "condensed" | "counter" | "counts";
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const OVERLAYS: readonly Overlay[] = ["condensed", "counter", "counts"];
export const CORNERS: readonly Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const DEFAULT_PLACE: Record<Overlay, Corner> = { condensed: "bottom-right", counter: "bottom-left", counts: "top-right" };
const DEFAULT_ORDER: Overlay[] = ["counts", "counter", "condensed"];

/** Put `which` in `corner`: it goes last in that corner's stack (furthest from the corner). */
export function placeOverlay(log: VideoLogOptions, which: Overlay, corner: Corner): VideoLogOptions {
  return { ...log, place: { ...log.place, [which]: corner }, order: [...log.order.filter((o) => o !== which), which] };
}

/** What each corner holds, of the ones shown, nearest the corner first. */
export function cornerStacks(log: VideoLogOptions): Record<Corner, Overlay[]> {
  const shown: Record<Overlay, boolean> = { condensed: log.condensed, counter: log.counter, counts: log.counts };
  const out = Object.fromEntries(CORNERS.map((c) => [c, [] as Overlay[]])) as Record<Corner, Overlay[]>;
  for (const o of log.order) if (shown[o]) out[log.place[o]].push(o);
  return out;
}
export const DEFAULT_VIDEO_LOG: VideoLogOptions = { show: true, condensed: true, condensedLines: DEFAULT_CONDENSED_LINES, condensedSize: 1, counter: true, counterSize: 1, counterTurn: true, counterPhase: true, counterStep: true, counts: true, countsSize: 1, countsZero: true,
  place: DEFAULT_PLACE, order: DEFAULT_ORDER,
};

const size = (saved: unknown) => ((OVERLAY_SIZES as readonly unknown[]).includes(saved) ? (saved as number) : 1);

export function sanitizeVideoLog(saved: unknown): VideoLogOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof VideoLogOptions, unknown>>;
  return {
    show: s.show !== false,
    condensed: s.condensed !== false,
    condensedLines:
      typeof s.condensedLines === "number" && Number.isInteger(s.condensedLines) && s.condensedLines >= 1 && s.condensedLines <= MAX_CONDENSED_LINES ? s.condensedLines : DEFAULT_CONDENSED_LINES,
    condensedSize: size(s.condensedSize),
    counter: s.counter !== false && (s.counterTurn !== false || s.counterPhase !== false || s.counterStep !== false),
    counterSize: size(s.counterSize),
    counterTurn: s.counterTurn !== false,
    counterPhase: s.counterPhase !== false,
    counterStep: s.counterStep !== false,
    counts: s.counts !== false,
    countsSize: size(s.countsSize),
    countsZero: s.countsZero !== false,
    place: Object.fromEntries(OVERLAYS.map((o) => {
      const saved = (s.place && typeof s.place === "object" ? s.place : {}) as Record<string, unknown>;
      return [o, (CORNERS as readonly unknown[]).includes(saved[o]) ? saved[o] : DEFAULT_PLACE[o]];
    })) as Record<Overlay, Corner>,
    // Every overlay once, in the saved order, any missing after.
    order: [...new Set([...(Array.isArray(s.order) ? s.order : []).filter((o): o is Overlay => (OVERLAYS as readonly unknown[]).includes(o)), ...DEFAULT_ORDER])],
  };
}

/** Selecting a counter field turns the counter on; clearing the last one turns it off. */
export function setCounterField(log: VideoLogOptions, field: "counterTurn" | "counterPhase" | "counterStep", enabled: boolean): VideoLogOptions {
  const next = { ...log, [field]: enabled };
  return { ...next, counter: next.counterTurn || next.counterPhase || next.counterStep };
}

export function setCounterEnabled(log: VideoLogOptions, enabled: boolean): VideoLogOptions {
  return enabled && !log.counterTurn && !log.counterPhase && !log.counterStep
    ? { ...log, counter: true, counterTurn: true, counterPhase: true, counterStep: true }
    : { ...log, counter: enabled };
}

/** Battle-page overlays are stored independently from the video export layout. */
export const BATTLE_OVERLAYS_KEY = "divine-pulse-map-overlays";
export function loadBattleOverlaySettings(): VideoLogOptions {
  try { return sanitizeVideoLog(JSON.parse(localStorage.getItem(BATTLE_OVERLAYS_KEY) ?? "{}")); }
  catch { return DEFAULT_VIDEO_LOG; }
}
export function saveBattleOverlaySettings(layout: VideoLogOptions): void {
  try { localStorage.setItem(BATTLE_OVERLAYS_KEY, JSON.stringify(layout)); } catch { /* Session only. */ }
}
