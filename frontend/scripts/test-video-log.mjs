import test from "node:test";
import assert from "node:assert/strict";
import { cornerStacks, DEFAULT_VIDEO_LOG, MAX_CONDENSED_LINES, placeOverlay, sanitizeVideoLog, setCounterField, setCounterEnabled, loadBattleOverlaySettings, saveBattleOverlaySettings } from "../src/exporting/videoLog.ts";

const PLACED = { place: { condensed: "bottom-right", counter: "bottom-left", counts: "top-right" }, order: ["counts", "counter", "condensed"] };

test("a video has the log (as many lines as fit) and the condensed log, unless turned off", () => {
  assert.deepEqual(DEFAULT_VIDEO_LOG, { show: true, condensed: true, condensedLines: 4, condensedSize: 1, counter: true, counterSize: 1, counterTurn: true, counterPhase: true, counterStep: true, counts: true, countsSize: 1, countsZero: true, ...PLACED });
  assert.deepEqual(sanitizeVideoLog(undefined), DEFAULT_VIDEO_LOG);
  assert.equal("lines" in sanitizeVideoLog({ lines: 7 }), false, "old dedicated-log limits are discarded");
  assert.deepEqual(sanitizeVideoLog({ show: false, lines: 7, condensed: false, condensedLines: 6, condensedSize: 1.4, counter: false, counterSize: 0.8, counts: false, countsSize: 2 }), { show: false, condensed: false, condensedLines: 6, condensedSize: 1.4, counter: false, counterSize: 0.8, counterTurn: true, counterPhase: true, counterStep: true, counts: false, countsSize: 2, countsZero: true, ...PLACED });
  // A saved choice from before (log Panel or Overlay) keeps the log.
  assert.deepEqual(sanitizeVideoLog({ place: "overlay", lines: 5 }), { show: true, condensed: true, condensedLines: 4, condensedSize: 1, counter: true, counterSize: 1, counterTurn: true, counterPhase: true, counterStep: true, counts: true, countsSize: 1, countsZero: true, ...PLACED });
  assert.equal(sanitizeVideoLog({ condensedLines: MAX_CONDENSED_LINES + 1 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedLines: 0 }).condensedLines, 4);
  assert.equal(sanitizeVideoLog({ condensedSize: 1.33 }).condensedSize, 1);
  assert.equal(sanitizeVideoLog({ counterSize: 3 }).counterSize, 1);
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

test("counter fields control visibility and can be re-enabled", () => {
  let log = DEFAULT_VIDEO_LOG;
  log = setCounterField(setCounterField(setCounterField(log, "counterTurn", false), "counterPhase", false), "counterStep", false);
  assert.equal(log.counter, false);
  log = setCounterField(log, "counterPhase", true);
  assert.equal(log.counter, true);
  assert.equal(log.counterTurn, false);
  log = setCounterEnabled(setCounterField(log, "counterPhase", false), true);
  assert.equal(log.counter, true);
  assert.equal(log.counterTurn && log.counterPhase && log.counterStep, true);
  assert.equal(sanitizeVideoLog({ counterTurn: false, counterPhase: false, counterStep: false }).counter, false);
  assert.equal(sanitizeVideoLog({ countsZero: false }).countsZero, false);
});

test("battle replay settings preserve the existing saved map layout", () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const saved = { ...DEFAULT_VIDEO_LOG, condensedLines: 2, counterPhase: false, countsZero: false };
    saveBattleOverlaySettings(saved);
    assert.deepEqual(loadBattleOverlaySettings(), saved);
    assert.ok(values.has("divine-pulse-map-overlays"));
    values.set("divine-pulse-map-overlays", "invalid");
    assert.deepEqual(loadBattleOverlaySettings(), DEFAULT_VIDEO_LOG);
  } finally { delete globalThis.localStorage; }
});
