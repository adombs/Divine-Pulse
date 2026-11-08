import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { NO_FILTERS, passes } = await vite.ssrLoadModule("/src/filters.ts");

test("the Alive / Dead filter keeps the run's living or dead; people not in the run are neither", () => {
  const alive = { key: "hilda", house: "Golden Deer", inRun: true, dead: false };
  const dead = { key: "raphael", house: "Golden Deer", inRun: true, dead: true };
  const outside = { key: "dimitri", house: "Blue Lions", inRun: false };
  const only = (status) => [alive, dead, outside].filter((p) => passes({ ...NO_FILTERS, status }, p)).map((p) => p.key);
  assert.deepEqual(only([]), ["hilda", "raphael", "dimitri"]);
  assert.deepEqual(only(["alive"]), ["hilda"]);
  assert.deepEqual(only(["dead"]), ["raphael"]);
  assert.deepEqual(only(["alive", "dead"]), ["hilda", "raphael"]);
});
