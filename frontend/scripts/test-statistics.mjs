import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

// Load the real public modules through the project's TS resolver, including their real dependencies.
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { armyId, armyTotals, battleUnitStats, tally, timeline } = await vite.ssrLoadModule("/src/components/battle/model.ts");
const { moreStats } = await vite.ssrLoadModule("/src/components/battle/moreStats.ts");
const { characterStats, runStats, runBattles } = await vite.ssrLoadModule("/src/components/battle/stats.ts");

const unit = (key = "alpha", overrides = {}) => ({ key, name: "Test Person", class_name: "Test Class", start_level: 1, level: 2,
  start: { hp: 20 }, now: { hp: 21 }, on_map: true, combats: 2, defeats: 1,
  damage_dealt: 12, damage_taken: 3, healing_given: 0, healed: 2, tiles_moved: 5,
  level_ups: 1, gains: { hp: 1, str: 2, mv: 1, def: -1 }, weapon_uses: 2, spells_cast: 0, item_uses: 1, broken_weapons: 0,
  ...overrides });
const attack = (overrides = {}) => ({ t: 1, turn: 1, phase: 0, kind: "attack", text: "Synthetic fight", unit: "alpha", target: "Test Foe",
  actor_id: "a:alpha", target_id: "e:4", dealt: 12, taken: 3, step: 1, ...overrides });
const battle = (overrides = {}) => ({ id: "one", run_id: "run", started_at: "2026-01-01T00:00:00Z", active: false, seconds: 90,
  units: [unit()], events: [], log: [attack()], branches: [], enemy_stats: {}, enemy_labels: { 4: "Test Foe" }, map_steps: [],
  trend: [], turn: 2, enemies_start: 1, divine_pulses: 0, level_ups: 1, stat_points: 3, weapon_uses: 2, spells_cast: 0, item_uses: 1,
  ...overrides });

function compareScope(b) {
  const items = timeline(b);
  const chars = characterStats([b]);
  const run = runStats([b], chars);
  const share = moreStats(b, items);
  for (const u of b.units) {
    const popup = tally(items, armyId(u.key), { fights: u.combats, defeats: u.defeats });
    const row = share.units.find((r) => r.id === armyId(u.key)).metrics;
    const c = chars.find((r) => r.key === u.key);
    assert.deepEqual({ fights: row.fights, defeats: row.defeats }, popup);
    assert.equal(c.fights, popup.fights);
    assert.equal(c.defeats, popup.defeats);
    for (const [a, field] of [["dealt", "damage_dealt"], ["taken", "damage_taken"], ["healing", "healing_given"], ["healed", "healed"], ["tiles", "tiles_moved"]]) {
      assert.equal(row[a], u[field]);
      assert.equal(c[field], row[a]);
    }
  }
  const total = armyTotals(b);
  assert.equal(run.fights, total.fights);
  assert.equal(share.fights, total.fights);
  assert.equal(run.defeats, total.defeats);
  assert.equal(run.damage_dealt, total.dealt);
  assert.equal(run.damage_taken, total.taken);
  assert.equal(run.healing, total.healing);
  assert.equal(run.tiles_moved, total.tiles);
  return { chars, run, share };
}

test("live and finished scopes agree across popup, Share, character and run totals", () => {
  for (const active of [true, false]) {
    const { run } = compareScope(battle({ active, units: [unit(), unit("beta", { damage_dealt: 4, combats: 3, defeats: 0, adjutant_of: "alpha" })] }));
    assert.equal(run.fights, 5, "fight totals count unit participations, not attack rows");
    assert.equal(run.stat_points, 6, "positive non-movement stat gains only");
  }
});

test("known battle counter wins even when log is larger or zero", () => {
  const b = battle({ log: [attack(), attack({ t: 2, step: 2 }), attack({ t: 3, step: 3 })], units: [unit("alpha", { combats: 0, defeats: 0 })] });
  assert.equal(compareScope(b).run.fights, 0);
  assert.equal(battleUnitStats(b, b.units[0]).defeats, 0);
});

test("rewound branches never enter standing statistics or per-turn observations", () => {
  const b = battle({ units: [unit("alpha", { combats: null, defeats: null })], branches: [{ id: 1, parent: 0, fork: 1, at: 9, log: [attack({ dealt: 999 })], events: [] }] });
  const { run, share } = compareScope(b);
  assert.equal(run.fights, 1);
  assert.equal(run.damage_dealt, 12);
  assert.equal(share.mvp, null, "zero recorded kills do not earn MVP");
  assert.equal(share.perTurn[0].dealt, 12);
  assert.equal(timeline(b, "all").filter((i) => i.kind === "attack").length, 2);
});

test("unknown is not zero, partial totals do not claim full coverage", () => {
  const unknown = unit("alpha", { combats: null, defeats: null, damage_dealt: null, healing_given: null, damage_taken: null, healed: null, tiles_moved: null });
  const { run, share } = compareScope(battle({ units: [unknown, unit("beta")], log: [], events: [{ t: 0, kind: "start", text: "Started", unit: null }] }));
  assert.equal(run.fights, null);
  assert.equal(run.damage_dealt, null);
  assert.equal(run.healing, null);
  assert.equal(share.units[0].metrics.dealt, null);
  assert.equal(share.carry, null);
  assert.equal(compareScope(battle({ units: [unit("alpha", { combats: 0, defeats: 0, damage_dealt: 0 })], log: [] })).run.damage_dealt, 0);
});

test("log fallback resolves stable keys and unambiguous old labels, never duplicate names", () => {
  const b = battle({ units: [unit("alpha", { combats: null, defeats: null }), unit("beta", { combats: null, defeats: null })],
    log: [attack({ actor_id: undefined, target_id: undefined })] });
  assert.equal(timeline(b)[0].actor, "a:alpha");
  assert.equal(timeline(b)[0].target, "e:4");
  const chars = characterStats([b]);
  assert.equal(chars.length, 2, "identical names do not merge distinct keys");
  assert.equal(chars.find((c) => c.key === "beta").fights, null);
  b.enemy_labels[8] = "Test Foe";
  assert.equal(timeline(b)[0].target, null, "slot reuse/ambiguous labels cannot be guessed");
  b.log[0].target_id = "e:8";
  assert.equal(timeline(b)[0].target, "e:8", "explicit identity takes precedence");
});

test("live replaces stale history once and large histories retain complete totals", () => {
  const old = battle({ units: [unit("alpha", { damage_dealt: 3 })] });
  const live = battle({ active: true, units: [unit("alpha", { damage_dealt: 25 })] });
  const list = runBattles([old, old], live);
  assert.equal(list.length, 1);
  assert.equal(runStats(list, characterStats(list)).damage_dealt, 25);
  const many = Array.from({ length: 1000 }, (_, n) => battle({ id: `b${n}` }));
  const chars = characterStats([...many, many[0]]);
  const total = runStats([...many, many[0]], chars);
  assert.equal(chars[0].battles, 1000);
  assert.equal(total.damage_dealt, 12000);
  assert.equal(total.fights, 2000);
  assert.equal(runStats([battle({ turn: null })], characterStats([battle({ turn: null })])).turns, null);
  const active = battle({ active: true, divine_pulses: 0 });
  const activeStats = runStats([active], characterStats([active]));
  assert.equal(activeStats.flawless, 0, "a live battle is not a finished flawless result");
  assert.equal(activeStats.no_pulse, 0);
});
