import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Render the public battle detail and the real battalion panel. SSR cannot run the effects that register/select
// sections or load reference data, so supply only those two UI inputs; assignment selection stays production code.
const reference = {
  characters: [], classes: [], abilities: [], combat_arts: [], crests: [], magic: [], items: [],
  battalions: [
    { id: 0, name: "Translated Company A", description: "Recorded reference A", endurance: 40,
      stats: { phys_atk: 2, avo: 1 },
      stats_by_level: [1, 2, 3, 4, 5].map((n) => ({ phys_atk: 2, avo: n, rsl: -2 })),
      gambit: { name: "Tactic A", description: "Reference tactic A", uses: 2 } },
    { id: 1, name: "Current Company B", description: "Roster reference B", endurance: 60,
      stats: { phys_atk: 8 }, stats_by_level: [8, 8, 9, 9, 10].map((n) => ({ phys_atk: n })),
      gambit: { name: "Tactic B", description: "Reference tactic B", uses: 3 } },
  ],
};
const values = { hp: 30, mv: 4, str: 10, mag: 5, dex: 8, spd: 9, lck: 6, def: 7, res: 3, cha: 4 };
const current = {
  key: "test-unit", name: "Test Unit", full_name: "Test Unit", class_name: "Test Class",
  displayed: values, personal_ability: "", abilities: [], battalion: "Current Company B", battalion_id: 1,
  // Deliberately different runtime values must never leak from the current roster into a historical panel:
  // level 5 (400 exp), 59 endurance, and between battles (uses not read: refilled).
  battalion_exp: 400, battalion_endurance: 59, gambit_uses: null,
};
const recorded = {
  key: current.key, name: current.name, class_name: current.class_name, start_level: 1, level: 1,
  start: values, now: values, on_map: true, hp: 30, inventory: [], arts: [], gains: {}, level_ups: 0,
  weapon_uses: 0, item_uses: 0, spells_cast: 0, spell_uses_left: null, spell_uses_full: null,
  weakest_weapon: null, broken_weapons: 0, consumables_left: null,
  battalion: "Previous-language Company A", battalion_id: 0,
};

test("historical battalion detail uses the saved assignment independently of the current roster", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, watch: null }, esbuild: { jsx: "automatic" },
    plugins: [{
      name: "battalion-ssr-inputs",
      transform(source, id) {
        if (id.endsWith("/reference/types.ts")) {
          const hook = source.indexOf("export function useReference()");
          assert.ok(hook >= 0);
          return source.slice(0, hook) + `export function useReference() { return ${JSON.stringify(reference)}; }`;
        }
        if (id.endsWith("/components/layout.tsx")) {
          const selection = "const active = panes.some((p) => p.id === picked) ? picked : panes[0]?.id;";
          assert.ok(source.includes(selection));
          return source.replace(selection, 'const active = "Battalion";');
        }
      },
    }],
  });
  try {
    const { UnitDetail } = await server.ssrLoadModule("/src/components/battle/UnitPopup.tsx");
    const { BattalionPanel } = await server.ssrLoadModule("/src/components/character/Battalion.tsx");
    const { NavProvider } = await server.ssrLoadModule("/src/nav.tsx");
    const { BattleNavContext } = await server.ssrLoadModule("/src/components/battle/parts.tsx");
    const nav = { route: { page: "battle" }, go() {}, back() {}, canBack: false };
    const render = (element) => renderToStaticMarkup(h(NavProvider, { nav },
      h(BattleNavContext.Provider, { value: { people: new Map(), open() {} } }, element)));
    const battlePanel = (unit, roster = [current]) => render(h(UnitDetail, {
      battle: { units: [unit], events: [], log: [], enemy_stats: {} }, items: [],
      id: `a:${unit.key}`, roster, part2: false,
    }));

    await t.test("saved A wins over roster B, resolves ID zero after translation and excludes roster runtime state", () => {
      const html = battlePanel(recorded);
      assert.match(html, /Translated Company A/);
      assert.match(html, /Tactic A/);
      assert.match(html, /Assignment recorded for this battle/);
      assert.match(html, /Modifiers are level 1 reference values; the battalion level is not recorded for this battle/);
      assert.match(html, /Endurance left: Not recorded for this battle/);
      assert.doesNotMatch(html, /Company B|Tactic B|Lv 5|>59</);
    });
    await t.test("This Run keeps current roster B at its level, uses refilled between battles", () => {
      const html = render(h(BattalionPanel, { unit: current, scope: "run" }));
      assert.match(html, /Current Company B/);
      assert.match(html, /Tactic B/);
      assert.match(html, /Lv 5/);
      assert.doesNotMatch(html, /Exp \d/); // nothing more to earn at level 5
      assert.match(html, /title="From your imported game files, at level 5">\+10</);
      assert.match(html, />59<span class="bp-of">\/<\/span>60</);
      assert.match(html, /refills them after every battle[^]*>3<span class="bp-of">\/<\/span>3</);
      assert.doesNotMatch(html, /Company A|Assignment recorded for this battle|level 1 reference|unconfirmed/i);
    });
    await t.test("a recorded battle shows its own level, endurance and uses, not the roster's", () => {
      const html = battlePanel({ ...recorded, battalion_exp: 115, battalion_endurance: 31, gambit_uses: 1 });
      assert.match(html, /Lv 2<span class="bp-exp">Exp 15</);
      assert.match(html, /at level 2">\+2<[^]*at level 2">\+2</); // Phys Atk +2, Avo +2 at level 2
      assert.match(html, />−2</); // Rsl penalty, shown as a loss
      assert.match(html, />31<span class="bp-of">\/<\/span>40</);
      assert.match(html, />1<span class="bp-of">\/<\/span>2</);
      assert.doesNotMatch(html, /Lv 5|>59<|level 1 reference|endurance left,|gambit uses left/);
    });
    await t.test("spent endurance keeps the assignment but marks every modifier as not applying", () => {
      const html = battlePanel({ ...recorded, battalion_exp: 115, battalion_endurance: 0, gambit_uses: 0 });
      assert.match(html, /bp-gauge spent/);
      assert.match(html, /No endurance left: the unit gets none of these until the battalion is replenished/);
      assert.equal((html.match(/bp-val even spent/g) ?? []).length, 3);
      assert.doesNotMatch(html, /bp-val (up|down)/);
    });
    await t.test("a rattled unit's modifiers are marked as not applying, with endurance left", () => {
      const html = battlePanel({ ...recorded, battalion_exp: 115, battalion_endurance: 31, gambit_uses: 1, rattled: true });
      assert.match(html, /Rattled by a gambit when last read/);
      assert.equal((html.match(/bp-val even spent/g) ?? []).length, 3);
      assert.doesNotMatch(html, /No endurance left|bp-gauge spent/);
    });
    await t.test("battle uses that weren't recorded stay unknown rather than refilled", () => {
      const html = battlePanel({ ...recorded, battalion_exp: 0, battalion_endurance: 40, gambit_uses: null });
      assert.match(html, /Uses left: Not recorded for this battle/);
    });
    await t.test("older omitted fields and unavailable observations remain unknown despite roster B", () => {
      const old = { ...recorded };
      delete old.battalion;
      delete old.battalion_id;
      for (const unit of [old, { ...old, battalion: null, battalion_id: null }]) {
        const html = battlePanel(unit);
        assert.match(html, /Battalion assignment unknown: not recorded for this battle/);
        assert.doesNotMatch(html, /Company A|Company B|No battalion assigned/);
      }
    });
    await t.test("known removal stays distinct from unknown and never acquires roster B", () => {
      const html = battlePanel({ ...recorded, battalion: "", battalion_id: null });
      assert.match(html, /No battalion assigned/);
      assert.doesNotMatch(html, /Company A|Company B|assignment unknown/);
    });
    await t.test("history still works without a roster entry", () => {
      assert.match(battlePanel(recorded, []), /Translated Company A/);
    });
    await t.test("missing recorded ID does not borrow matching name reference details", () => {
      const html = battlePanel({ ...recorded, battalion: "Current Company B", battalion_id: 99 });
      assert.match(html, /Current Company B/);
      assert.doesNotMatch(html, /Roster reference B|Tactic B/);
    });
    await t.test("older name-only observations still resolve unambiguous reference details", () => {
      assert.match(battlePanel({ ...recorded, battalion: "Translated Company A", battalion_id: null }), /Tactic A/);
    });
  } finally {
    await server.close();
  }
});
