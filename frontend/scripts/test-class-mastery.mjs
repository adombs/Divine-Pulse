import test from "node:test";
import assert from "node:assert/strict";
import { masteredClasses } from "../src/classMastery.ts";

const CLASSES = [
  { name: "Fighter", tier: "Beginner" },
  { name: "Monk", tier: "Beginner" },
  { name: "Mage", tier: "Intermediate" },
  { name: "Warlock", tier: "Advanced" },
  { name: "War Master", tier: "Master" },
  { name: "Dancer", tier: "Unique" },
];

test("a unit that was never read has no mastery list, one that mastered nothing has an empty one", () => {
  assert.equal(masteredClasses(undefined, CLASSES), null);
  assert.equal(masteredClasses(null, CLASSES), null);
  assert.deepEqual(masteredClasses([], CLASSES), []);
});

test("mastered classes keep the game's order (lowest tier first) and each gets its tier", () => {
  const result = masteredClasses(["Noble", "Fighter", "Monk", "Mage", "Warlock", "Dancer"], [...CLASSES, { name: "Noble", tier: "Unique" }]);
  assert.deepEqual(result.map((c) => c.name), ["Noble", "Fighter", "Monk", "Mage", "Warlock", "Dancer"]);
  assert.deepEqual(result.map((c) => c.tier), ["Unique", "Beginner", "Beginner", "Intermediate", "Advanced", "Unique"]);
});

test("a class the Archive doesn't know keeps its name and its place, with no tier", () => {
  const result = masteredClasses(["Fighter", "Mystery Class"], CLASSES);
  assert.deepEqual(result, [{ name: "Fighter", tier: "Beginner" }, { name: "Mystery Class", tier: null }]);
});

test("a close spelling still finds its class, and no Archive data leaves every tier unknown", () => {
  assert.equal(masteredClasses(["Warlok"], CLASSES)[0].tier, "Advanced");
  assert.deepEqual(masteredClasses(["Fighter"], undefined), [{ name: "Fighter", tier: null }]);
});
