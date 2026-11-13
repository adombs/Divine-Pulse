import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

export async function runLedgerTests(t) {
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, appType: "custom",
  optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null, hmr: false }, esbuild: { jsx: "automatic" },
  plugins: [{ name: "ledger-review-inputs", enforce: "pre", transform(source, id) {
    // Supply the portal host for server rendering; the public popup and recorded-statistics path stay real.
    if (id.endsWith("/components/Modal.tsx")) return `export function Modal({ open, title, children }) { return open ? <section aria-label={title}>{children}</section> : null; }`;
    if (id.includes("/battle/RunStatsPopup.tsx") && id.includes("review=records")) {
      assert.ok(source.includes('useState<LedgerPart>("combat")'));
      return source.replace('useState<LedgerPart>("combat")', 'useState<LedgerPart>("records")');
    }
  } }],
});
try {
const { buildRunLedger, selectLedgerRows, unitScores } = await vite.ssrLoadModule("/src/components/battle/runStatsLedger.ts");
const { AWARDS } = await vite.ssrLoadModule("/src/components/battle/moreStats.ts");
const unit = (key, overrides = {}) => ({ key, name: `Test ${key}`, class_name: "Synthetic Class", start_level: 1, level: 2,
  start: { hp: 20 }, now: { hp: 21 }, on_map: true, combats: 2, defeats: 1, damage_dealt: 12, damage_taken: 3,
  healing_given: 0, healed: 2, tiles_moved: 5, level_ups: 1, gains: { hp: 1 }, weapon_uses: 2, spells_cast: 0, item_uses: 1,
  ...overrides });
const battle = (id, overrides = {}) => ({ id, run_id: "test-run", started_at: `2026-01-0${id}T00:00:00Z`, ended_at: `2026-01-0${id}T00:01:30Z`,
  active: false, seconds: 90, units: [unit("alpha")], events: [], log: [], branches: [], enemy_stats: {}, enemy_labels: {},
  map_steps: [], trend: [], turn: 2, enemies_start: 1, divine_pulses: 0, level_ups: 1, stat_points: 1, weapon_uses: 2, spells_cast: 0, item_uses: 1,
  ...overrides });

await t.test("the battle ledger retains newest-first order and numeric time sorting", () => {
  const source = [battle("1", { seconds: 620 }), battle("3", { seconds: 95 }), battle("2", { seconds: 2700 })];
  const data = buildRunLedger(source, "battles");
  assert.deepEqual(data.rows.map((r) => r.id), ["3", "2", "1"]);
  assert.deepEqual(selectLedgerRows(data.rows, "combat", "", { column: 0, direction: "ascending" }).map((r) => r.id), ["3", "1", "2"]);
  assert.deepEqual(data.rows.map((r) => r.id), ["3", "2", "1"], "sorting must not mutate default order");
  assert.equal(data.totals.combat[0], 3415);
});

await t.test("search and sorting never recompute the entire-run totals", () => {
  const data = buildRunLedger([battle("1", { units: [unit("alpha"), unit("beta", { name: "Beta Archer", class_name: "Test Archer" })] })], "characters");
  const before = structuredClone(data.totals);
  assert.deepEqual(selectLedgerRows(data.rows, "combat", " beta archer ", null).map((r) => r.id), ["beta"]);
  assert.equal(selectLedgerRows(data.rows, "combat", "no match", null).length, 0);
  assert.deepEqual(data.totals, before);
  assert.equal(data.totals.combat[4], 24);
});

await t.test("character rows use the latest recorded native sprite identity", () => {
  const earlier = battle("1", { units: [unit("alpha", { class_id: 4, character: 1, female: true, look: "dark" })] });
  const latest = battle("2", { units: [unit("alpha", { class_id: 42, character: 1, female: true, look: "green" })] });
  for (const source of [[earlier, latest], [latest, earlier]]) {
    const [row] = buildRunLedger(source, "characters").rows;
    assert.deepEqual(row.sprite, { classId: 42, character: 1, female: true, look: "green", side: "player" });
  }
});

await t.test("battle rows keep History's scenario classification", () => {
  for (const [scenario, kind] of [[7, "mission"], [40, "paralogue"], [61, "auxiliary"], [86, "dlc"], [999, null]]) {
    const [row] = buildRunLedger([battle("1", { scenario })], "battles").rows;
    assert.equal(row.kind, kind);
    assert.equal(row.sprite, undefined);
  }
});

await t.test("a battle's type is read from its scenario id: five kinds, named the same everywhere", async () => {
  const { KINDS, KIND_LABEL, KIND_PLURAL, battleName, kindOfScenario, searchText } = await vite.ssrLoadModule("/src/components/battle/scenarios.ts");
  assert.deepEqual(KINDS, ["mission", "auxiliary", "paralogue", "quest", "dlc"]);
  assert.deepEqual(KINDS.map((k) => KIND_PLURAL[k]), ["Mission Battles", "Auxiliary Battles", "Paralogue Battles", "Quest Battles", "DLC Battles"]);
  assert.deepEqual(KINDS.map((k) => KIND_LABEL[k]), ["Mission Battle", "Auxiliary Battle", "Paralogue Battle", "Quest Battle", "DLC Battle"]);
  // Battles recorded before the rename carry only their scenario id (no stored type), so they take the new kinds as they are read.
  const expected = { mission: [0, 7, 28, 37], paralogue: [38, 52, 60, 93, 94, 97], auxiliary: [61, 74, 80], dlc: [81, 82, 85, 86, 92] };
  for (const [kind, ids] of Object.entries(expected)) for (const id of ids) assert.equal(kindOfScenario(id), kind, `scenario ${id}`);
  // A quest battle runs on an ordinary scenario and map, so no scenario id is a quest: the battle's quest says it.
  for (let id = 0; id < 256; id += 1) assert.notEqual(kindOfScenario(id), "quest", `scenario ${id}`);
  for (const id of [95, 96, 98, 99, 100, 254]) assert.equal(kindOfScenario(id), null, `scenario ${id}`);
  assert.equal(battleName(battle("1", { scenario: 82 })).kind, "dlc");
  assert.equal(battleName(battle("1", { scenario: 999 })).kind, null);
  assert.match(searchText(battle("1", { scenario: 7 })), /mission battle/);

  // Quest Battles: the quest (its row in the quest table) is on the battle, and only a quest with a battle counts.
  const asked = { quest: 78, scenario: 66, map_name: "Synthetic Map" };
  assert.equal(battleName(battle("1", asked)).kind, "quest");
  assert.equal(battleName(battle("1", { ...asked, quest: 5 })).kind, "auxiliary", "a quest without a battle is not a quest battle");
  assert.equal(battleName(battle("1", { ...asked, quest: null })).kind, "auxiliary");
  assert.equal(battleName(battle("1", { scenario: 66, map_name: "Synthetic Map" })).kind, "auxiliary", "a battle saved before the quest field");
  assert.equal(battleName(battle("1", { ...asked, scenario: 7, quest: 126 })).title, "Synthetic Map", "no chapter on a quest battle");
  assert.match(searchText(battle("1", asked)), /quest battle/);
  // Its title is the quest's name once the game's text has it, else its map's name.
  const served = (categories) => async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).endsWith("/status")) return ok({ available: true, created: String(Math.random()) });
    if (String(url).includes("ENG_U.json")) return ok({ categories });
    return { ok: false, status: 404, json: async () => null };
  };
  const assets = await vite.ssrLoadModule("/src/gameAssets.ts");
  const realFetch = globalThis.fetch;
  try {
    for (const [categories, title] of [
      [{ scenario_title: {}, battle_place: {}, quest_title: { 78: "Synthetic Quest" } }, "Synthetic Quest"],
      [{ scenario_title: {}, battle_place: {} }, "Synthetic Map"], // game files imported before quest names were read
    ]) {
      globalThis.fetch = served(categories);
      await assets.loadGameAssetsStatus(true);
      await (await vite.ssrLoadModule("/src/components/battle/scenarios.ts")).loadScenarioText();
      assert.equal(battleName(battle("1", asked)).title, title);
      assert.equal(battleName(battle("1", { ...asked, quest: null })).title, "Synthetic Map");
    }
  } finally { globalThis.fetch = realFetch; }
  for (const text of [...Object.values(KIND_LABEL), ...Object.values(KIND_PLURAL)]) assert.doesNotMatch(text, /main/i);
});

await t.test("unknown observations remain distinct from zero and sort last both ways", () => {
  const data = buildRunLedger([battle("1", { units: [unit("unknown", { damage_dealt: null }), unit("zero", { damage_dealt: 0 }), unit("known", { damage_dealt: 14 })] })], "characters");
  assert.equal(data.totals.combat[4], 14); // what was recorded
  for (const [direction, expected] of [["ascending", ["zero", "known", "unknown"]], ["descending", ["known", "zero", "unknown"]]]) {
    assert.deepEqual(selectLedgerRows(data.rows, "combat", "", { column: 4, direction }).map((r) => r.id), expected);
  }
});

await t.test("Records retain canonical groups, finished-battle evidence and battle-wide sentinels", () => {
  const data = buildRunLedger([battle("1"), battle("2", { active: true, ended_at: null })], "characters");
  assert.equal(data.awards.battles, 1);
  assert.deepEqual(data.columns.records.map((c) => [c.key, c.label, c.group]), AWARDS.map((a) => [a.key, a.label, a.group]));
  for (let i = 0; i < AWARDS.length; i++) {
    if ("battleWide" in AWARDS[i]) assert.equal(data.rows[0].values.records[i], null);
    assert.equal(data.totals.records[i], data.awards.totals[AWARDS[i].key]);
  }
});

await t.test("the public popup renders accessible topics, sorting and honest unknown totals", async () => {
  const { RunStatsPopup } = await vite.ssrLoadModule("/src/components/battle/RunStatsPopup.tsx");
  const html = renderToStaticMarkup(h(RunStatsPopup, { kind: "characters", onClose() {}, battles: [battle("1", { units: [unit("alpha", { damage_dealt: null })] })], error: false, onRetry() {} }));
  assert.match(html, /role="tablist" aria-label="Statistics topic"/);
  assert.match(html, /role="tab" aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html, /role="tab" aria-selected="false"[^>]*tabindex="-1"[^]*>Records<\/button>/);
  assert.match(html, /role="tabpanel" aria-labelledby=/);
  assert.match(html, /aria-sort="none"/);
  assert.match(html, /aria-label="Not fully recorded"/);
  assert.match(html, /class="run-stats-sprite"[^]*class="run-stats-name"/);
  assert.doesNotMatch(html, /run-stats-table-heading|run-stats-footnote|Select a column to compare|Run totals stay unchanged|Character comparison|Battle comparison/);
  assert.doesNotMatch(html, /<p>[^]*characters<\/p>/);
  assert.doesNotMatch(html, />Awards<\/button>/);
});

await t.test("the popup shows the recorded damage total when a unit has none", async () => {
  const { RunStatsPopup } = await vite.ssrLoadModule("/src/components/battle/RunStatsPopup.tsx?review=partial");
  const html = renderToStaticMarkup(h(RunStatsPopup, { kind: "characters", onClose() {}, battles: [battle("1", { units: [unit("a", { damage_dealt: null }), unit("b", { damage_dealt: 14 })] })], error: false, onRetry() {} }));
  assert.match(html, /Damage dealt<\/dt><dd>14<\/dd>/);
});

await t.test("Records renders group filtering and honest run-only sentinels without footer clutter", async () => {
  const { RunStatsPopup } = await vite.ssrLoadModule("/src/components/battle/RunStatsPopup.tsx?review=records");
  const html = renderToStaticMarkup(h(RunStatsPopup, { kind: "characters", onClose() {}, battles: [battle("1")], error: false, onRetry() {} }));
  assert.match(html, /Record group<select/);
  assert.match(html, /<option value="" selected="">All records<\/option>/);
  assert.match(html, /Battle-wide record; no character recipient/);
  assert.doesNotMatch(html, /run-stats-footnote|Records earned/);
});

await t.test("battle comparison shows type tags beside dates using History's shared colours", async () => {
  const { RunStatsPopup } = await vite.ssrLoadModule("/src/components/battle/RunStatsPopup.tsx");
  const battles = [7, 40, 61, 82, 86].map((scenario, index) => battle(String(index + 1), { scenario }));
  battles.push(battle("6", { scenario: 66, quest: 78 }));
  const html = renderToStaticMarkup(h(RunStatsPopup, { kind: "battles", onClose() {}, battles, error: false, onRetry() {} }));
  for (const kind of ["mission", "paralogue", "auxiliary", "quest", "dlc"]) assert.match(html, new RegExp(`class="run-stats-battle battle-kind-${kind}"`));
  for (const label of ["Mission Battle", "Paralogue Battle", "Auxiliary Battle", "Quest Battle", "DLC Battle"]) {
    assert.match(html, new RegExp(`class="run-stats-row-meta"><span>[^<]+</span><span class="run-stats-kind">${label}</span>`));
  }
  assert.doesNotMatch(html, /Select a column to compare|run-stats-footnote|Battle comparison/);
});

await t.test("run score: 1,000 per shared MVP plus damage and healing, finished battles only", () => {
  const u = (key, defeats, damage_dealt, healing_given) => unit(key, { defeats, damage_dealt, healing_given });
  const source = [
    battle("1", { units: [u("a", 3, 10, 5), u("b", 3, 20, 0), u("c", 1, 0, 7)] }),
    battle("2", { units: [u("a", 0, 4, 1), u("b", 0, 0, 0)] }),
    battle("3", { units: [u("a", 9, 999, 999)], ended_at: null, active: true }),
    battle("4", { units: [u("a", 1, 0, 0), u("b", 2, 1, 1)] }),
  ];
  const scores = unitScores(source);
  assert.equal(scores.get("a"), 1020);
  assert.equal(scores.get("b"), 2022);
  assert.equal(scores.get("c"), 7);
  const data = buildRunLedger(source, "characters");
  assert.equal(data.columns.combat[0].key, "score");
  assert.match(data.columns.combat[0].hint, /MVP/);
  const row = data.rows.find((r) => r.id === "b");
  assert.equal(row.values.combat[0], 2022);
  assert.equal(data.totals.combat[0], 1020 + 2022 + 7);
  assert.deepEqual(selectLedgerRows(data.rows, "combat", "", { column: 0, direction: "descending" }).map((r) => r.id), ["b", "a", "c"]);
  assert.equal(buildRunLedger(source, "battles").columns.combat.some((c) => c.key === "score"), false);
});

await t.test("loading, empty and error states provide a named status or recovery", async () => {
  const { RunStatsPopup } = await vite.ssrLoadModule("/src/components/battle/RunStatsPopup.tsx");
  const render = (props) => renderToStaticMarkup(h(RunStatsPopup, { kind: "battles", onClose() {}, onRetry() {}, error: false, battles: [], ...props }));
  assert.match(render({ battles: null }), /role="status" aria-busy="true"/);
  assert.match(render({}), /No recorded battles yet/);
  assert.match(render({ error: true }), /role="alert"[^]*Try again/);
});
} finally { await vite.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) test("History run ledgers", runLedgerTests);
