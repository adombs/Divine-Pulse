import test from "node:test";
import assert from "node:assert/strict";
import { LOG_MOTION_MS, sampleLogMotion, startLogMotion } from "../src/components/battle/condensedMotion.ts";
const entry = (key) => ({ key });
test("new rows fade in, older rows fade out, and interrupted motion stays continuous", () => {
  const initial = startLogMotion(null, [entry("a"), entry("b")], 0);
  const settled = sampleLogMotion(initial, LOG_MOTION_MS);
  assert.deepEqual(settled.map(r => r.opacity), [.5, 1]);
  const next = startLogMotion(initial, [entry("b"), entry("c")], 300);
  const halfway = sampleLogMotion(next, 410);
  assert.ok(halfway.find(r => r.entry.key === "a").presence < 1);
  assert.ok(halfway.find(r => r.entry.key === "c").presence > 0);
  const interrupted = startLogMotion(next, [entry("c"), entry("d")], 410);
  assert.deepEqual(sampleLogMotion(interrupted, 410), halfway);
  assert.deepEqual(sampleLogMotion(next, 520).map(r => r.entry.key), ["b", "c"]);
});
test("scrubbing backwards resets transitions to the video clock", () => {
  const motion = startLogMotion(null, [entry("a")], 1000);
  const reset = startLogMotion(motion, [entry("b")], 0);
  assert.deepEqual(sampleLogMotion(reset, LOG_MOTION_MS).map(r => r.entry.key), ["b"]);
});
test("the log fills its slots from the bottom, moving just as it does once full", async () => {
  const { fillSlots, isBlank } = await import("../src/components/battle/condensedMotion.ts");
  const keys = (rows) => rows.map((r) => r.key ?? r.entry.key);
  assert.deepEqual(keys(fillSlots([], 3)), ["blank:2", "blank:1", "blank:0"], "empty: all slots blank");
  assert.deepEqual(keys(fillSlots([entry("a")], 3)), ["blank:1", "blank:0", "a"], "the first row in the bottom slot");
  assert.deepEqual(keys(fillSlots([entry("a"), entry("b"), entry("c"), entry("d")], 3)), ["b", "c", "d"], "full: the newest");
  // Empty slots are there from the start: the log doesn't grow.
  const start = startLogMotion(null, fillSlots([], 3), 0, 3);
  assert.deepEqual(sampleLogMotion(start, 0).map((r) => r.presence), [1, 1, 1]);
  // A row comes in at the bottom while the top slot goes, as when a full log scrolls.
  const one = startLogMotion(start, fillSlots([entry("a")], 3), 0, 3);
  const mid = sampleLogMotion(one, LOG_MOTION_MS / 2);
  assert.deepEqual(keys(mid), ["blank:2", "blank:1", "blank:0", "a"]);
  assert.ok(mid[0].presence < 1 && mid[3].presence > 0 && mid[1].presence === 1);
  const full = startLogMotion(null, fillSlots([entry("a"), entry("b"), entry("c")], 3), 0, 3);
  const scroll = startLogMotion(full, fillSlots([entry("a"), entry("b"), entry("c"), entry("d")], 3), 1000, 3);
  const scrolled = sampleLogMotion(scroll, 1000 + LOG_MOTION_MS / 2);
  assert.deepEqual(keys(scrolled), ["a", "b", "c", "d"]);
  assert.equal(scrolled[0].presence.toFixed(3), mid[0].presence.toFixed(3), "the top slot goes at the same pace");
  // Opacity follows the slot, not how many rows there are: the newest is full, one slot up a third fainter.
  const settledOne = sampleLogMotion(one, LOG_MOTION_MS).filter((r) => !isBlank(r.entry));
  assert.deepEqual(settledOne.map((r) => r.opacity), [1]);
  const two = startLogMotion(one, fillSlots([entry("a"), entry("b")], 3), 500, 3);
  assert.deepEqual(sampleLogMotion(two, 500 + LOG_MOTION_MS).filter((r) => !isBlank(r.entry)).map((r) => +r.opacity.toFixed(3)), [0.667, 1]);
});
