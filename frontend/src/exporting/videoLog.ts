/**
 * Where a video's log goes and how much of it shows (components/battle/ReplayExport.tsx). Kept apart from the page so it
 * is tested on its own.
 */

/** Panel: the log has its own part of the frame, beside the map (16:9, 1.91:1) or under it (9:16, 4:5). Overlay: the log
 * sits on the map, in its bottom-right corner, and the map takes the whole frame. */
export type LogPlacement = "panel" | "overlay";
export const LOG_PLACEMENTS: [LogPlacement, string, string][] = [
  ["panel", "Panel", "Its own part of the frame, beside or under the map"],
  ["overlay", "Overlay", "On the map, in its bottom-right corner; the map gets the whole frame"],
];

/** The most log rows the Lines slider offers. */
export const MAX_LOG_LINES = 15;
/** The rows an overlay shows on Auto: enough to follow, little enough to leave the map in view. */
export const OVERLAY_AUTO_LINES = 5;

export interface VideoLogOptions {
  place: LogPlacement;
  /** The most rows shown at a time (the newest ones), or null for Auto: as many as fit in a panel, `OVERLAY_AUTO_LINES` on the map. */
  lines: number | null;
}
export const DEFAULT_VIDEO_LOG: VideoLogOptions = { place: "panel", lines: null };

export function sanitizeVideoLog(saved: unknown): VideoLogOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof VideoLogOptions, unknown>>;
  return {
    place: LOG_PLACEMENTS.find(([p]) => p === s.place)?.[0] ?? DEFAULT_VIDEO_LOG.place,
    lines: typeof s.lines === "number" && Number.isInteger(s.lines) && s.lines >= 1 && s.lines <= MAX_LOG_LINES ? s.lines : null,
  };
}

/** How many rows show at most (null: no limit, as many as fit). */
export const logLimit = (o: VideoLogOptions): number | null => o.lines ?? (o.place === "overlay" ? OVERLAY_AUTO_LINES : null);

/** The rows on screen: the newest `limit` of them (all with no limit). */
export const newestRows = <T>(rows: readonly T[], limit: number | null): readonly T[] => (limit === null || rows.length <= limit ? rows : rows.slice(rows.length - limit));
