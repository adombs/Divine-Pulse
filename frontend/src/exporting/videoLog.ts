/**
 * The logs of a video (components/battle/ReplayExport.tsx): the log, its own part of the frame beside the map (16:9,
 * 1.91:1) or under it (9:16, 4:5), with how many of its rows show; and the condensed log, the newest actions as one line
 * each in the map's bottom-right corner (CondensedLog.tsx). Without the log, the map takes the whole frame under the
 * title. Kept apart from the page so it is tested on its own.
 */

/** The most log rows the Lines slider offers. */
export const MAX_LOG_LINES = 15;

export interface VideoLogOptions {
  /** Whether the frame has the log. */
  show: boolean;
  /** The most of its rows shown at a time (the newest ones), or null for Auto: as many as fit. */
  lines: number | null;
  /** Whether the map has the condensed log in its corner. */
  condensed: boolean;
}
export const DEFAULT_VIDEO_LOG: VideoLogOptions = { show: true, lines: null, condensed: true };

export function sanitizeVideoLog(saved: unknown): VideoLogOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof VideoLogOptions, unknown>>;
  return {
    show: s.show !== false,
    lines: typeof s.lines === "number" && Number.isInteger(s.lines) && s.lines >= 1 && s.lines <= MAX_LOG_LINES ? s.lines : null,
    condensed: s.condensed !== false,
  };
}

/** The rows on screen: the newest `limit` of them (all with no limit). */
export const newestRows = <T>(rows: readonly T[], limit: number | null): readonly T[] => (limit === null || rows.length <= limit ? rows : rows.slice(rows.length - limit));
