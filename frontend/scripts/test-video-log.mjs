import test from "node:test";
import assert from "node:assert/strict";
import { cornerStacks, DEFAULT_VIDEO_LOG, MAX_CONDENSED_LINES, MAX_LOG_LINES, newestRows, placeOverlay, sanitizeVideoLog } from "../src/exporting/videoLog.ts";

const PLACED = { place: { condensed: "bottom-right", counter: "bottom-left", counts: "top-right" }, order: ["counts", "counter", "condensed"] };

test("a video has the log (as many lines as fit) and the condensed log, unless turned off", () => {
  assert.deepEqual(DEFAULT_VIDEO_LOG, { show: true, lines: null, condensed: true, condensedLines: 4, condensedSize: 1, counter: true, counterSize: 1, counts: true, countsSize: 1, ...PLACED });
  assert.deepEqual(sanitizeVideoLog(undefined), DEFAULT_VIDEO_LOG);
  assert.deepEqual(sanitizeVideoLog({ show: false, lines: 7, condensed: false, condensedLines: 6, condensedSize: 1.4, counter: false, counterSize: 0.8, counts: false, countsSize: 2 }), { show: false, lines: 7, condensed: false, condensedLines: 6, condensedSize: 1.4, counter: false, counterSize: 0.8, counts: false, countsSize: 2, ...PLACED });
  // A saved choice from before (log Panel or Overlay) keeps the log.
  assert.deepEqual(sanitizeVideoLog({ place: "overlay", lines: 5 }), { show: true, lines: 5, condensed: true, condensedLines: 4, condensedSize: 1, counter: true, counterSize: 1, counts: true, countsSize: 1, ...PLACED });
  assert.equal(sanitizeVideoLog({ lines: MAX_LOG_LINES + 1 }).lines, null);
  assert.equal(sanitizeVideoLog({ lines: 2.5 }).lines, null);
  assert.equal(sanitizeVideoLog({ condensedLines: MAX_CONDENSED_LINES + 1 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedLines: 0 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedSize: 1.33 }).condensedSize, 1);
  assert.equal(sanitizeVideoLog({ counterSize: 3 }).counterSize, 1);
});

test("the newest lines are the ones shown", () => {
  const rows = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(newestRows(rows, 2), [5, 6]);
  assert.deepEqual(newestRows(rows, 10), rows);
  assert.deepEqual(newestRows(rows, null), rows);
  assert.deepEqual(newestRows([], 3), []);
});

test("things over the map stack in their corner in the order they were put there", () => {
  let log = DEFAULT_VIDEO_LOG;
  assert.deepEqual(cornerStacks(log), { "top-left": [], "top-right": ["counts"], "bottom-left": ["counter"], "bottom-right": ["condensed"] });
  log = placeOverlay(log, "counts", "bottom-right");
  log = placeOverlay(log, "counter", "bottom-right");
  // The condensed log was there first: nearest the corner, then the counts, then the turn counter.
  assert.deepEqual(cornerStacks(log)["bottom-right"], ["condensed", "counts", "counter"]);
  // Moving one away and back puts it last.
  log = placeOverlay(placeOverlay(log, "condensed", "top-left"), "condensed", "bottom-right");
  assert.deepEqual(cornerStacks(log)["bottom-right"], ["counts", "counter", "condensed"]);
  // One turned off isn't in its stack; its place is kept.
  assert.deepEqual(cornerStacks({ ...log, counts: false })["bottom-right"], ["counter", "condensed"]);
  // Saved, it comes back the same; a bad corner or order falls back.
  assert.deepEqual(sanitizeVideoLog(JSON.parse(JSON.stringify(log))), log);
  const odd = sanitizeVideoLog({ place: { counts: "middle" }, order: ["counter", "nope", "counter"] });
  assert.equal(odd.place.counts, "top-right");
  assert.deepEqual(odd.order, ["counter", "counts", "condensed"]);
});
