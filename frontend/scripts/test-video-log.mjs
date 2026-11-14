import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIDEO_LOG, LOG_PLACEMENTS, logLimit, MAX_LOG_LINES, newestRows, OVERLAY_AUTO_LINES, sanitizeVideoLog } from "../src/exporting/videoLog.ts";

test("the log is a panel with as many lines as fit, unless chosen otherwise", () => {
  assert.deepEqual(DEFAULT_VIDEO_LOG, { place: "panel", lines: null });
  assert.deepEqual(LOG_PLACEMENTS.map(([p]) => p), ["panel", "overlay"]);
  assert.deepEqual(sanitizeVideoLog(undefined), DEFAULT_VIDEO_LOG);
  assert.deepEqual(sanitizeVideoLog({ place: "overlay", lines: 7 }), { place: "overlay", lines: 7 });
  assert.deepEqual(sanitizeVideoLog({ place: "corner", lines: 0 }), DEFAULT_VIDEO_LOG);
  assert.equal(sanitizeVideoLog({ lines: MAX_LOG_LINES + 1 }).lines, null);
  assert.equal(sanitizeVideoLog({ lines: 2.5 }).lines, null);
});

test("Auto shows every line in a panel and a few on the map", () => {
  assert.equal(logLimit({ place: "panel", lines: null }), null);
  assert.equal(logLimit({ place: "overlay", lines: null }), OVERLAY_AUTO_LINES);
  assert.equal(logLimit({ place: "panel", lines: 3 }), 3);
  assert.equal(logLimit({ place: "overlay", lines: 9 }), 9);
});

test("the newest lines are the ones shown", () => {
  const rows = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(newestRows(rows, 2), [5, 6]);
  assert.deepEqual(newestRows(rows, 10), rows);
  assert.deepEqual(newestRows(rows, null), rows);
  assert.deepEqual(newestRows([], 3), []);
});
