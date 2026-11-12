import test from "node:test";
import assert from "node:assert/strict";
import { defaultKeep, discardFor } from "../src/duplicateChoice.ts";

const copy = (id) => ({ id, started_at: "", ended_at: null, seconds: 1, turn: 1, enemies_defeated: 0, enemies_start: 0, log_len: 0 });
const group = (best) => ({ scenario: 3, quest: null, name: "x", best, battles: [copy("c"), copy("b"), copy("a")] });

test("the server's best copy is preselected, else the newest", () => {
  assert.equal(defaultKeep(group("a")), "a");
  assert.equal(defaultKeep(group("zzz")), "c");
});

test("keeping one copy discards the rest", () => {
  assert.deepEqual(discardFor(group("a"), "b"), ["c", "a"]);
});
