import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIDEO_LOG, MAX_CONDENSED_LINES, MAX_LOG_LINES, newestRows, sanitizeVideoLog } from "../src/exporting/videoLog.ts";

test("a video has the log (as many lines as fit) and the condensed log, unless turned off", () => {
  assert.deepEqual(DEFAULT_VIDEO_LOG, { show: true, lines: null, condensed: true, condensedLines: 4, condensedSize: 1 });
  assert.deepEqual(sanitizeVideoLog(undefined), DEFAULT_VIDEO_LOG);
  assert.deepEqual(sanitizeVideoLog({ show: false, lines: 7, condensed: false, condensedLines: 6, condensedSize: 1.4 }), { show: false, lines: 7, condensed: false, condensedLines: 6, condensedSize: 1.4 });
  // A saved choice from before (log Panel or Overlay) keeps the log.
  assert.deepEqual(sanitizeVideoLog({ place: "overlay", lines: 5 }), { show: true, lines: 5, condensed: true, condensedLines: 4, condensedSize: 1 });
  assert.equal(sanitizeVideoLog({ lines: MAX_LOG_LINES + 1 }).lines, null);
  assert.equal(sanitizeVideoLog({ lines: 2.5 }).lines, null);
  assert.equal(sanitizeVideoLog({ condensedLines: MAX_CONDENSED_LINES + 1 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedLines: 0 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedSize: 1.33 }).condensedSize, 1);
});

test("the newest lines are the ones shown", () => {
  const rows = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(newestRows(rows, 2), [5, 6]);
  assert.deepEqual(newestRows(rows, 10), rows);
  assert.deepEqual(newestRows(rows, null), rows);
  assert.deepEqual(newestRows([], 3), []);
});
