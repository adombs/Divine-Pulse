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

test("mastered classes are ordered by tier, keeping the game's order within a tier", () => {
  const result = masteredClasses(["Warlock", "Dancer", "Monk", "Mage", "Fighter", "War Master"], CLASSES);
  assert.deepEqual(result.map((c) => c.name), ["Monk", "Fighter", "Mage", "Warlock", "War Master", "Dancer"]);
  assert.deepEqual(result.map((c) => c.tier), ["Beginner", "Beginner", "Intermediate", "Advanced", "Master", "Unique"]);
});

test("a class the Archive doesn't know keeps its name, has no tier and comes last", () => {
  const result = masteredClasses(["Mystery Class", "Fighter"], CLASSES);
  assert.deepEqual(result, [{ name: "Fighter", tier: "Beginner" }, { name: "Mystery Class", tier: null }]);
});

test("a close spelling still finds its class, and no Archive data leaves every tier unknown", () => {
  assert.equal(masteredClasses(["Warlok"], CLASSES)[0].tier, "Advanced");
  assert.deepEqual(masteredClasses(["Fighter"], undefined), [{ name: "Fighter", tier: null }]);
});
