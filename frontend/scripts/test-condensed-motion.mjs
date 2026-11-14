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
