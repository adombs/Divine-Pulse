import test from "node:test";
import assert from "node:assert/strict";
import {
  addRule, ALL_SUGGESTIONS, cleanRuleText, fitScale, hasRule, MAX_RULES, moveRule, removeRule, RULE_DESCRIPTION_LEN, RULE_NAME_LEN,
  RULE_SUGGESTIONS, ruleError, rulesetColumns, rulesetPageMs, RULES_PAGE_MAX_MS, RULES_PAGE_MIN_MS, sanitizeRules, updateRule,
} from "../src/ruleset.ts";

const r = (name, description = "") => ({ name, description });

test("text is cleaned like the server cleans it", () => {
  assert.equal(cleanRuleText("  No \n Divine\tPulse  "), "No Divine Pulse");
});

test("a rule needs a name, fits the limits and isn't there twice", () => {
  assert.equal(ruleError(r("   "), []), "A rule needs a name.");
  assert.match(ruleError(r("x".repeat(RULE_NAME_LEN + 1)), []), /at most 60/);
  assert.match(ruleError(r("Ok", "x".repeat(RULE_DESCRIPTION_LEN + 1)), []), /at most 280/);
  assert.equal(ruleError(r("no divine-pulse"), [r("No Divine Pulse")]), "This run already has that rule.");
  assert.equal(ruleError(r("My own rule", "Anything goes"), [r("No Divine Pulse")]), null);
});

test("adding keeps order, cleans, and refuses duplicates and overflow", () => {
  let rules = addRule([], r(" Maddening ", " Hard "));
  rules = addRule(rules, r("Classic mode"));
  assert.deepEqual(rules, [r("Maddening", "Hard"), r("Classic mode")]);
  assert.deepEqual(addRule(rules, r("MADDENING")), rules);
  const full = Array.from({ length: MAX_RULES }, (_, i) => r(`Rule ${i}`));
  assert.equal(addRule(full, r("One more")).length, MAX_RULES);
  assert.ok(hasRule(rules, "classic MODE"));
  assert.ok(!hasRule(rules, "No DLC"));
});

test("editing a rule may keep its own name but not take another's", () => {
  const rules = [r("A"), r("B")];
  assert.deepEqual(updateRule(rules, 0, r("a", "now described")), [r("a", "now described"), r("B")]);
  assert.deepEqual(updateRule(rules, 0, r("b")), rules);
  assert.deepEqual(updateRule(rules, 5, r("C")), rules);
});

test("removing and moving", () => {
  const rules = [r("A"), r("B"), r("C")];
  assert.deepEqual(removeRule(rules, 1).map((x) => x.name), ["A", "C"]);
  assert.deepEqual(moveRule(rules, 0, 2).map((x) => x.name), ["B", "C", "A"]);
  assert.deepEqual(moveRule(rules, 2, 0).map((x) => x.name), ["C", "A", "B"]);
  assert.deepEqual(moveRule(rules, 1, 99).map((x) => x.name), ["A", "C", "B"]);
  assert.deepEqual(moveRule(rules, 1, -5).map((x) => x.name), ["B", "A", "C"]);
  assert.deepEqual(moveRule(rules, 7, 0), rules);
});

test("anything saved is made safe", () => {
  assert.deepEqual(sanitizeRules(null), []);
  assert.deepEqual(sanitizeRules([{ name: "A" }, { name: "a" }, { description: "no name" }, 3, { name: " B ", description: 5 }]), [r("A"), r("B")]);
});

test("the suggestions are valid, distinct and short", () => {
  assert.ok(RULE_SUGGESTIONS.length >= 4);
  let rules = [];
  for (const s of ALL_SUGGESTIONS) {
    assert.equal(ruleError(s, rules), null, s.name);
    assert.ok(s.description.length > 0 && s.description.length <= 100, s.name);
    rules = addRule(rules, s);
  }
  assert.equal(rules.length, ALL_SUGGESTIONS.length);
  for (const name of ["Maddening", "Classic mode", "No Divine Pulse", "No DLC", "No auxiliary battles", "No bought stat boosters", "House only", "Byleth solo", "Randomized classes", "Nuzlocke"]) {
    assert.ok(hasRule(rules, name), name);
  }
});

test("the picture's columns and the page's time on screen", () => {
  assert.equal(rulesetColumns(3, false), 1);
  assert.equal(rulesetColumns(10, false), 2);
  assert.equal(rulesetColumns(30, false), 3);
  assert.equal(rulesetColumns(8, true), 1);
  assert.equal(rulesetColumns(30, true), 2);
  assert.equal(rulesetPageMs(0), RULES_PAGE_MIN_MS);
  assert.ok(rulesetPageMs(5) > rulesetPageMs(1));
  assert.equal(rulesetPageMs(MAX_RULES), RULES_PAGE_MAX_MS);
  assert.equal(fitScale(500, 1000), 1);
  assert.equal(fitScale(2000, 1000), 0.5);
  assert.equal(fitScale(0, 1000), 1);
});
