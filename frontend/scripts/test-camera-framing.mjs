import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { framed } = await vite.ssrLoadModule("/src/components/battle/framing.ts");

// A 10-tile view on a 40 by 40 map at a 10% margin: one tile in from each edge must stay clear.
const size = [10, 10];
const high = [30, 30];
const frame = (from, follow, margin = 0.1) => framed(from, follow, size, 10, margin, high);

test("action a tile or more in from the edges: the camera stays put", () => {
  assert.deepEqual(frame([10, 10], [[11, 11]]), [10, 10], "on the inner edge, top left");
  assert.deepEqual(frame([10, 10], [[18, 18]]), [10, 10], "on the inner edge, bottom right");
  assert.deepEqual(frame([10, 10], [[12, 13], [17, 15]]), [10, 10], "several units, all in frame");
});

test("action too near an edge: the camera pans just far enough", () => {
  assert.deepEqual(frame([10, 10], [[10, 14]]), [9, 10], "on the left edge: one tile left");
  assert.deepEqual(frame([10, 10], [[19, 14]]), [11, 10], "on the right edge: one tile right");
  assert.deepEqual(frame([10, 10], [[25, 3]]), [17, 2], "well out of view: just enough to have it a tile in");
});

test("the margin follows the sensitivity, and the view stays on the map", () => {
  assert.deepEqual(frame([10, 10], [[12, 14]], 0.3), [9, 10], "a 3-tile margin pans sooner");
  assert.deepEqual(frame([10, 10], [[10, 14]], 0), [10, 10], "no margin: only once it leaves the view");
  assert.deepEqual(frame([10, 10], [[14, 14]], 0.5), [9.5, 9.5], "Centre: always centred");
  assert.deepEqual(frame([10, 10], [[0, 0]]), [0, 0], "the map's corner");
});

test("units too far apart for the margin, or no view before: centred on them", () => {
  assert.deepEqual(frame([10, 10], [[10, 14], [19, 14]]), [10, 10]);
  assert.deepEqual(frame(null, [[20, 20]]), [15.5, 15.5]);
});
