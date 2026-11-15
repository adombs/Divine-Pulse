import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { rewindTrace, traceWindow } = await vite.ssrLoadModule("/src/components/battle/RewindIndicator.tsx");

test("the spiral fills outer to inner, holds, empties outer to inner, holds empty, and loops", () => {
  assert.deepEqual(traceWindow(0), { start: 0, shown: 0 });
  assert.deepEqual(traceWindow(950), { start: 0, shown: 0.5 }, "halfway through the fill");
  assert.deepEqual(traceWindow(2000), { start: 0, shown: 1 }, "held full");
  const emptying = traceWindow(2300 + 950);
  assert.equal(emptying.start, 0.5, "the outer half is gone first");
  assert.equal(emptying.shown, 0.5);
  assert.deepEqual(traceWindow(4400), { start: 1, shown: 0 }, "held empty");
  assert.deepEqual(traceWindow(4700 + 950), traceWindow(950), "it loops every 4.7 s");
  assert.deepEqual(traceWindow(1234, true), { start: 0, shown: 1 }, "reduced motion: held full");
});

test("in a rewind the cycle loops every two seconds, for as long as the rewind lasts", () => {
  assert.deepEqual(rewindTrace(0), { start: 0, shown: 0 });
  assert.equal(rewindTrace(900).shown, 1, "full just under halfway through the loop");
  assert.deepEqual(rewindTrace(1900), { start: 1, shown: 0 }, "empty at its end");
  assert.deepEqual(rewindTrace(6400), rewindTrace(400), "and again every two seconds");
  assert.deepEqual(rewindTrace(400), traceWindow(400 * 2.35), "the designed cycle, in two seconds");
  assert.deepEqual(rewindTrace(500, true), { start: 0, shown: 1 }, "reduced motion: held full");
});
