import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

// A guest's battle data counts toward statistics only while its key is on the run's roster now.
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { countsForRun, countedBattle, countedBattles } = await vite.ssrLoadModule("/src/components/battle/rosterRule.ts");
const { characterStats, runAwards, runStats } = await vite.ssrLoadModule("/src/components/battle/stats.ts");
const { armyTotals, timeline } = await vite.ssrLoadModule("/src/components/battle/model.ts");
const { moreStats } = await vite.ssrLoadModule("/src/components/battle/moreStats.ts");
const { buildRunLedger } = await vite.ssrLoadModule("/src/components/battle/runStatsLedger.ts");

const unit = (key, overrides = {}) => ({ key, name: `Test ${key}`, class_name: "Test Class", start_level: 1, level: 2,
  start: { hp: 20 }, now: { hp: 21 }, on_map: true, combats: 2, defeats: 1, damage_dealt: 12, damage_taken: 3,
  healing_given: 0, healed: 2, tiles_moved: 5, level_ups: 1, gains: { hp: 1 }, weapon_uses: 2, spells_cast: 0, item_uses: 1,
  broken_weapons: 0, ...overrides });
const attack = (key, overrides = {}) => ({ t: 1, turn: 1, phase: 0, kind: "attack", text: "Fight", unit: key, target: "Foe",
  actor_id: `a:${key}`, target_id: "e:4", dealt: 12, taken: 3, step: 1, ...overrides });
const battle = (id, units, overrides = {}) => ({ id, run_id: "run", started_at: `2026-01-0${id}T00:00:00Z`, ended_at: `2026-01-0${id}T00:01:30Z`,
  active: false, seconds: 90, units, events: [{ t: 2, kind: "level_up", text: "up", unit: units[units.length - 1].key, gains: {} }],
  log: units.map((u, i) => attack(u.key, { step: i + 1, t: i + 1 })),
  branches: [], enemy_stats: {}, enemy_labels: { 4: "Foe" }, map_steps: [], trend: [], turn: 2, enemies_start: 1, divine_pulses: 0,
  level_ups: units.length, stat_points: units.length, weapon_uses: 2 * units.length, spells_cast: 0, item_uses: units.length, ...overrides });

const alpha = unit("alpha");
const guest = unit("guest", { guest: true, damage_dealt: 100, defeats: 5, combats: 7, on_map: false });
const source = () => [battle("1", [alpha, guest]), battle("2", [alpha])];

test("countsForRun: non-guests always count, guests only when on the roster", () => {
  assert.equal(countsForRun(alpha, new Set()), true);
  assert.equal(countsForRun(guest, new Set(["alpha"])), false);
  assert.equal(countsForRun(guest, new Set(["guest"])), true);
});

test("a guest not on the roster contributes nothing to totals, characters, awards or the ledger", () => {
  const counted = countedBattles(source(), new Set(["alpha"]));
  const chars = characterStats(counted);
  assert.deepEqual(chars.map((c) => c.key), ["alpha"]);
  const run = runStats(counted, chars);
  assert.equal(run.fights, 4);
  assert.equal(run.defeats, 2);
  assert.equal(run.damage_dealt, 24);
  assert.equal(run.losses, 0, "an off-map guest is not a unit lost");
  assert.equal(run.flawless, 2);
  assert.equal(run.characters, 1);
  assert.equal(run.deployed, 1);
  assert.equal(run.level_ups, 2);
  const [first] = counted;
  assert.equal(first.units.length, 1);
  assert.equal(first.level_ups, 1);
  assert.equal(first.weapon_uses, 2);
  assert.ok(!first.log.some((e) => e.unit === "guest" || e.actor_id === "a:guest"));
  assert.ok(!first.events.some((e) => e.unit === "guest"));
  assert.equal(armyTotals(first).fights, 2);
  assert.equal(moreStats(first, timeline(first)).units.length, 1);
  for (const key of runAwards(counted).characters.keys()) assert.notEqual(key, "guest");
  const ledger = buildRunLedger(counted, "characters");
  assert.deepEqual(ledger.rows.map((r) => r.id), ["alpha"]);
  assert.equal(ledger.totals.combat[4], 24);
  // Without the filter the guest would have polluted everything.
  assert.equal(runStats(source(), characterStats(source())).damage_dealt, 124);
});

test("the same guest counts fully once its key is on the roster", () => {
  const counted = countedBattles(source(), new Set(["alpha", "guest"]));
  assert.deepEqual(counted, source());
  const chars = characterStats(counted);
  assert.deepEqual(chars.map((c) => c.key).sort(), ["alpha", "guest"]);
  const run = runStats(counted, chars);
  assert.equal(run.damage_dealt, 124);
  assert.equal(run.losses, 1);
  assert.equal(run.flawless, 1);
  assert.equal(run.characters, 2);
});

test("non-guests are unaffected and an unchanged battle keeps its identity", () => {
  const plain = [battle("1", [alpha, unit("beta")])];
  assert.equal(countedBattles(plain, new Set()), plain, "no guests: the same array");
  assert.equal(countedBattle(plain[0], new Set()), plain[0]);
});

test("guests in branches and map history are left out too", () => {
  const b = battle("1", [alpha, guest], {
    map_steps: [{ step: 1, turn: 1, phase: 0, actor: "a:guest", target: null, units: { "a:alpha": [1, 1, 10], "a:guest": [2, 2, 5], "e:4": [3, 3, 9] } }],
    branches: [{ id: 1, parent: 0, fork: 1, turn: 1, at: 1, log: [attack("guest"), attack("alpha")], events: [], map_steps: [] }],
  });
  const out = countedBattle(b, new Set(["alpha"]));
  assert.deepEqual(Object.keys(out.map_steps[0].units).sort(), ["a:alpha", "e:4"]);
  assert.equal(out.map_steps[0].actor, null);
  assert.equal(out.branches[0].log.length, 1);
  assert.equal(b.units.length, 2, "the recorded battle itself is untouched");
});
