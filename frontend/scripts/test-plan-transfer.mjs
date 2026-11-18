import test from "node:test";
import assert from "node:assert/strict";
import { cleanPlan, nameOfKey, planIsEmpty, planTargets, plansFile, readPlansFile, runPlanEntries } from "../src/planTransfer.ts";

const EMPTY = { classes: [], skills: {}, arts: [], abilities: [], equipment: [], battalion: "", supports: [], notes: "" };
const plan = (over = {}) => ({ ...EMPTY, ...over });
// Characters page keys by unit name, as portraits.ts would find them; generics have none.
const characterKey = (u) => ({ Byleth: "byleth", Edelgard: "edelgard", Hubert: "hubert" })[u.name] ?? null;

test("a run's plans: the roster's first, then those kept for characters not there yet", () => {
  const units = [
    { key: "u2", name: "Edelgard", plan: plan({ classes: ["Armored Lord"] }) },
    { key: "u1", name: "Byleth", plan: plan() },
    { key: "u3", name: "Soldier", plan: plan({ notes: "generic" }) },
    { key: "u4", name: "Hubert" },
  ];
  const offRoster = { lysithea: plan({ notes: "Gremory" }), edelgard: plan({ notes: "stale" }), bernadetta: plan({ arts: ["Curved Shot"] }), hubert: plan({ notes: "joins later?" }) };
  const entries = runPlanEntries(units, offRoster, characterKey);
  assert.deepEqual(entries.map((e) => [e.key, e.name, e.unitKey]), [["edelgard", "Edelgard", "u2"], ["bernadetta", "Bernadetta", null], ["lysithea", "Lysithea", null]]);
});

test("plans go out to a file and come back", () => {
  const entries = [{ key: "edelgard", name: "Edelgard", plan: plan({ classes: ["Armored Lord"], skills: { axe: "A" }, supports: [{ partner: "hubert", rank: "A" }] }) }];
  const file = JSON.parse(JSON.stringify(plansFile("Crimson", entries)));
  assert.equal(file.format, "divine-pulse-plans");
  assert.deepEqual(readPlansFile(file), entries);
});

test("a file is checked and cleaned", () => {
  assert.throws(() => readPlansFile({ format: "divine-pulse-ruleset", rules: [] }), /ruleset file/);
  assert.throws(() => readPlansFile({ format: "divine-pulse-run" }), /run or battles/);
  assert.throws(() => readPlansFile([1, 2]), /isn't a plans file/);
  assert.throws(() => readPlansFile({ format: "divine-pulse-plans", plans: [{ key: "edelgard", plan: {} }] }), /no plans/);
  const read = readPlansFile({ format: "divine-pulse-plans", plans: [
    { key: "edelgard", plan: { classes: ["Lord", 3], supports: [{ partner: "hubert", rank: "Z" }, { partner: "byleth", rank: "S" }], skills: { axe: "A", bow: 2 } } },
    { key: "edelgard", plan: { notes: "duplicate" } },
    { key: "../bad", plan: { notes: "x" } },
    { key: "bernadetta", name: "  ", plan: { notes: "hide" } },
  ] });
  assert.deepEqual(read.map((e) => e.key), ["edelgard", "bernadetta"]);
  assert.deepEqual(read[0].plan, plan({ classes: ["Lord"], supports: [{ partner: "byleth", rank: "S" }], skills: { axe: "A" } }));
  assert.equal(read[1].name, "Bernadetta");
  assert.deepEqual(cleanPlan(null), EMPTY);
  assert.ok(planIsEmpty(plan({ notes: "   " })));
  assert.equal(nameOfKey("byleth_f"), "Byleth F");
});

test("an imported plan lands on the character's unit, or waits for them, and says what it replaces", () => {
  const units = [{ key: "u2", name: "Edelgard", plan: plan({ notes: "mine" }) }, { key: "u4", name: "Hubert", plan: plan() }];
  const entries = ["edelgard", "hubert", "lysithea", "petra"].map((key) => ({ key, name: nameOfKey(key), plan: plan({ notes: key }) }));
  const targets = planTargets(entries, units, { lysithea: plan({ notes: "kept" }) }, characterKey);
  assert.deepEqual(targets.map((t) => [t.key, t.unitKey, t.replaces]), [["edelgard", "u2", true], ["hubert", "u4", false], ["lysithea", null, true], ["petra", null, false]]);
});
