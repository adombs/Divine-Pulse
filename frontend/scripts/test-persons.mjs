import { test } from "node:test";
import assert from "node:assert/strict";
import { expressionPaths, HURT_EXPRESSION, personFor } from "../src/personLookup.ts";

const data = {
  persons: { "43": { name: "Kostas", face: "images/portraits/faces/43/0.png" }, "150": { name: "Thief Leader", face: "images/portraits/faces/257/0.png" } },
  characters: { "2": { expressions: { part1: ["neutral", null, "determined", "hurt"], part2: ["later", null, null, "later-hurt"] } } },
};

test("persons are keyed by person ID and missing metadata is safe", () => {
  assert.equal(personFor(data, 150).name, "Thief Leader");
  assert.equal(personFor(data, 43).face, "images/portraits/faces/43/0.png");
  assert.equal(personFor(data, 257), undefined);
  assert.equal(personFor(null, 43), undefined);
});

test("expressions select the phase and preserve missing slots", () => {
  assert.equal(expressionPaths(data, 2, false)[HURT_EXPRESSION], "hurt");
  assert.equal(expressionPaths(data, 2, true)[HURT_EXPRESSION], "later-hurt");
  assert.equal(expressionPaths(data, 2, false)[1], null);
  assert.deepEqual(expressionPaths(data, 99, false), []);
});
