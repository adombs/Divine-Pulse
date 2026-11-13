import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { runLedgerTests } from "./test-run-stats-ledger.mjs";

// Load the real public modules through the project's TS resolver, including their real dependencies.
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { armyId, armyTotals, battleUnitStats, tally, timeline } = await vite.ssrLoadModule("/src/components/battle/model.ts");
const { AWARDS, battleAwards, moreStats } = await vite.ssrLoadModule("/src/components/battle/moreStats.ts");
const { characterStats, finishedAwardBattles, runAwards, runStats, runBattles } = await vite.ssrLoadModule("/src/components/battle/stats.ts");

test("History run ledgers", runLedgerTests);

const unit = (key = "alpha", overrides = {}) => ({ key, name: "Test Person", class_name: "Test Class", start_level: 1, level: 2,
  start: { hp: 20 }, now: { hp: 21 }, on_map: true, combats: 2, defeats: 1,
  damage_dealt: 12, damage_taken: 3, healing_given: 0, healed: 2, tiles_moved: 5,
  level_ups: 1, gains: { hp: 1, str: 2, mv: 1, def: -1 }, weapon_uses: 2, spells_cast: 0, item_uses: 1, broken_weapons: 0,
  ...overrides });
const attack = (overrides = {}) => ({ t: 1, turn: 1, phase: 0, kind: "attack", text: "Synthetic fight", unit: "alpha", target: "Test Foe",
  actor_id: "a:alpha", target_id: "e:4", dealt: 12, taken: 3, step: 1, ...overrides });
const battle = (overrides = {}) => ({ id: "one", run_id: "run", started_at: "2026-01-01T00:00:00Z", active: false, seconds: 90,
  ended_at: "2026-01-01T00:01:30Z",
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

test("finished scopes agree across popup, Share, character and run totals", () => {
    const { run } = compareScope(battle({ units: [unit(), unit("beta", { damage_dealt: 4, combats: 3, defeats: 0, adjutant_of: "alpha" })] }));
    assert.equal(run.fights, 5, "fight totals count unit participations, not attack rows");
    assert.equal(run.stat_points, 6, "positive non-movement stat gains only");
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

test("unknown is not zero, and totals add what was recorded", () => {
  const unknown = unit("alpha", { combats: null, defeats: null, damage_dealt: null, healing_given: null, damage_taken: null, healed: null, tiles_moved: null });
  const { run, share } = compareScope(battle({ units: [unknown, unit("beta")], log: [], events: [{ t: 0, kind: "start", text: "Started", unit: null }] }));
  // A unit with nothing recorded (an adjutant, say) doesn't blank the totals: they hold what the others recorded.
  assert.equal(run.fights, 2);
  assert.equal(run.damage_dealt, 12);
  assert.equal(run.healing, 0);
  assert.equal(share.units.find((u) => u.id === "a:alpha").metrics.dealt, null);
  const nothing = { combats: null, defeats: null, damage_dealt: null, healing_given: null, damage_taken: null, healed: null, tiles_moved: null };
  const blank = compareScope(battle({ units: [unit("alpha", nothing), unit("beta", nothing)], log: [] })).run;
  assert.equal(blank.fights, null);
  assert.equal(blank.damage_dealt, null);
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

test("a live battle excludes its stale history copy and large histories retain complete totals", () => {
  const old = battle({ units: [unit("alpha", { damage_dealt: 3 })] });
  const live = battle({ active: true, units: [unit("alpha", { damage_dealt: 25 })] });
  const list = runBattles([old, old], live);
  assert.deepEqual(list, []);
  assert.deepEqual(characterStats([live]), []);
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

// Every award uses the same real battle selector as More Stats, including timeline thresholds and tie rules.
function decoratedBattle(overrides = {}) {
  const kill = (step, actor, target) => ({ t: step, step, turn: 1, phase: 0, kind: "defeat", text: "Synthetic defeat",
    unit: actor.slice(2), target: "Test Foe", actor_id: actor, target_id: target });
  return battle({
    units: [unit("alpha", { combats: 4, defeats: 2, damage_dealt: 60, weapon_uses: 10, spells_cast: 1, tiles_moved: 10,
      usage: [{ kind: "spell", id: 1, name: "Test spell", times: 3, spent: 3, damage: 12 }] }),
    unit("beta", { combats: 4, defeats: 1, damage_dealt: 30, damage_taken: 15, healing_given: 20, spells_cast: 5,
      level_ups: 2, tiles_moved: 9, usage: [{ kind: "art", id: 2, name: "Test art", times: 3, spent: 3, damage: 12 }] }),
    unit("bench", { combats: 0, defeats: 0, damage_dealt: 0, damage_taken: 0, healed: 0, tiles_moved: 0,
      level_ups: 0, gains: {}, weapon_uses: 0, spells_cast: 0, item_uses: 0 })],
    log: [attack({ step: 1, t: 1, dealt: 30, taken: 0 }), kill(2, "a:alpha", "e:4"),
      attack({ step: 3, t: 3, target_id: "e:5", dealt: 30, taken: 0 }), kill(4, "a:alpha", "e:5"),
      ...[5, 6, 7].map((step) => attack({ step, t: step, actor_id: "e:6", target_id: "a:beta", dealt: 0, taken: 7 })),
      attack({ step: 8, t: 8, actor_id: "e:6", target_id: "a:beta", dealt: 15, taken: 7 }),
      kill(9, "a:beta", "e:6")],
    map_steps: [{ step: 8, turn: 1, units: { "a:alpha": [0, 0, 2], "a:beta": [1, 0, 1] } }],
    divine_pulses: 1,
    branches: [{ id: 1, parent: 0, fork: 1, at: 10, events: [], log: [
      attack({ actor_id: "a:bench", dealt: 999 }),
      { t: 10, kind: "fell", text: "Synthetic fall", actor_id: "a:alpha" },
    ] }], ...overrides,
  });
}

test("all existing award types have canonical recipients, values and run-selection parity", () => {
  const b = decoratedBattle();
  const winners = battleAwards(b, timeline(b));
  const expected = {
    mvp: ["a:alpha", 2], close: ["a:beta", 1], medic: ["a:beta", 20], carry: ["a:alpha", 67],
    hit: ["a:alpha", 30], rampage: ["a:alpha", 2], one: ["a:alpha", 2], fighter: ["a:alpha", 10],
    caster: ["a:beta", 5], signature: ["a:alpha", 3], ouch: ["a:beta", 15], wanted: ["a:beta", 4],
    untouchable: ["a:beta", 3], payback: ["a:beta", 28], sponge: ["a:beta", 15], grew: ["a:beta", "+3"],
    walker: ["a:alpha", 10], bench: ["a:bench", 0], first: ["a:alpha", "T1"], last: ["a:beta", "T1"],
  };
  assert.deepEqual(Object.fromEntries(winners.map((a) => [a.key, [a.id, a.value]])), expected);
  assert.deepEqual(new Set(Object.keys(expected)), new Set(AWARDS.map((a) => a.key)), "every actual award is covered");
  const twin = decoratedBattle({ id: "twin" });
  const run = runAwards([b, twin]);
  for (const source of [b, twin]) for (const a of battleAwards(source, timeline(source))) {
    assert.equal(run.totals[a.key], 2, `${a.key} counts battles, not score or uses`);
    assert.equal(run.characters.get(a.id.slice(2))[a.key], 2, `${a.key} goes to the battle recipient`);
  }
  assert.deepEqual(battleAwards(b, timeline(b, "all")), winners, "undone combat never changes an award winner");
});

test("award ties and thresholds preserve per-battle first-observed selection", () => {
  const tied = battle({ units: [unit("beta", { healing_given: 8 }), unit("alpha", { healing_given: 8 })], log: [] });
  const selected = battleAwards(tied, timeline(tied));
  for (const key of ["mvp", "medic", "fighter", "grew", "walker", "sponge", "carry"])
    assert.equal(selected.find((a) => a.key === key)?.id, "a:beta", `${key}: first unit wins a tie`);
  assert.equal(characterStats([tied]).find((c) => c.key === "alpha").mvp, 0, "run character card no longer awards every tied unit");
  assert.equal(characterStats([tied]).find((c) => c.key === "beta").mvp, 1);
  const below = decoratedBattle({ log: [attack({ dealt: 0, taken: 0 })], map_steps: [], divine_pulses: 0 });
  const keys = new Set(battleAwards(below, timeline(below)).map((a) => a.key));
  for (const key of ["hit", "ouch", "close", "rampage", "one", "wanted", "untouchable", "payback", "first", "last", "bench"])
    assert.equal(keys.has(key), false, `${key}: no award below the existing evidence threshold`);
  const many = battle({ units: Array.from({ length: 4 }, (_, n) => unit(`u${n}`, { damage_dealt: 10 })) });
  assert.equal(battleAwards(many, timeline(many)).some((a) => a.key === "carry"), false, "less than 30% earns no carry award");
});

test("run awards count only distinct confirmed finishes, with resumed live records excluded", () => {
  const old = decoratedBattle({ ended_at: "2026-01-01T00:01:00Z", units: [unit("old")] });
  const done = decoratedBattle();
  const second = decoratedBattle({ id: "second" });
  const live = decoratedBattle({ id: "live", active: true });
  const provisional = decoratedBattle({ id: "provisional", active: false, ended_at: null });
  const legacy = decoratedBattle({ id: "legacy", ended_at: undefined });
  for (const source of [[old, done, second, done, live, provisional, legacy], [legacy, provisional, live, done, second, old]]) {
    const result = runAwards(source);
    assert.equal(result.battles, 2);
    assert.equal(result.characters.get("alpha").mvp, 2);
    assert.equal(result.characters.has("old"), false, "latest confirmed snapshot wins independent of order");
    assert.equal(result.totals.mvp, 2);
  }
  assert.equal(runAwards([done, { ...done, active: true, ended_at: null }]).battles, 0, "a resumed battle cannot retain its saved finish");
  assert.equal(finishedAwardBattles([done, { ...done, run_id: "other-run" }]).length, 2, "battle ids are run-local");
});

test("award aggregation uses persistent identity and handles missing legacy evidence without guessing", () => {
  const first = decoratedBattle();
  const later = decoratedBattle({ id: "later", units: first.units.map((u) => ({ ...u, name: u.key === "alpha" ? "Renamed Person" : "Test Person" })) });
  const result = runAwards([first, later]);
  assert.equal(result.characters.size, 3, "same display names never merge different unit keys");
  assert.equal(result.characters.get("alpha").mvp, 2, "renamed characters keep their awards");
  assert.equal(result.characters.get("beta").mvp, 0);
  const unknown = battle({ units: [unit("alpha", { combats: null, defeats: null, damage_dealt: null, damage_taken: null,
    healing_given: null, tiles_moved: null, level_ups: 0, gains: {}, weapon_uses: 0, spells_cast: 0, item_uses: 0 })], log: [], map_steps: undefined });
  assert.deepEqual(battleAwards(unknown, timeline(unknown)), [], "missing history and metrics invent no awards");
  assert.equal(runAwards([unknown]).characters.get("alpha").mvp, 0);
  assert.equal(battleAwards(battle({ units: [unit(), unit("unknown", { defeats: null })], log: [] }), []).some((a) => a.key === "mvp"), false,
    "a partial kill ranking cannot prove an MVP");
});

test("Export Team's join order puts Byleth first, then by first battle", async () => {
  const { orderUnits } = await vite.ssrLoadModule("/src/components/TeamExport.tsx");
  const mk = (key, name, character) => ({ key, name, character, class_name: "Test Class", personal_ability: "", stats: {} });
  const units = [mk("seteth", "Seteth", 33), mk("hilda", "Hilda", 23), mk("byleth", "Byleth", 1)];
  const when = (started_at) => [{ battle: { started_at } }];
  const characters = [{ key: "seteth", battles: 1, appearances: when("2026-01-01") }, { key: "hilda", battles: 1, appearances: when("2026-01-02") },
    { key: "byleth", battles: 2, appearances: when("2026-01-01") }];
  assert.deepEqual(orderUnits(units, "joined", characters), ["byleth", "seteth", "hilda"]);
  assert.deepEqual(orderUnits(units, "joined", []), ["byleth", "seteth", "hilda"], "before the battles are read, Byleth still leads");
  assert.deepEqual(orderUnits(units, "joined", characters, true), ["hilda", "seteth", "byleth"], "descending is the exact reverse");
});

test("Export Team leaves out units that died unless the fallen are included", async () => {
  const { pickRows } = await vite.ssrLoadModule("/src/components/TeamExport.tsx");
  const mk = (key, dead = false) => ({ key, name: key, death: dead ? { battle_id: null, manual: true } : null });
  const byKey = new Map(["a", "b", "c", "d"].map((k) => [k, mk(k, k === "b" || k === "d")]));
  const slots = ["a", "b", "c", null, "d", null];
  const keys = (rows) => rows.map((r) => r.map((u) => u.key));
  assert.deepEqual(keys(pickRows(slots, byKey, new Set(), 3, true)), [["a", "b", "c"], ["d"]]);
  assert.deepEqual(keys(pickRows(slots, byKey, new Set(), 3, false)), [["a", "c"]]);
  assert.deepEqual(keys(pickRows(slots, byKey, new Set(["a"]), 3, true)), [["b", "c"], ["d"]]);
});
