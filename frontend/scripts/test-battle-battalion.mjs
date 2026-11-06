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
      stats: { phys_atk: 2 }, gambit: { name: "Tactic A", description: "Reference tactic A", uses: 2 } },
    { id: 1, name: "Current Company B", description: "Roster reference B", endurance: 60,
      stats: { phys_atk: 8 }, gambit: { name: "Tactic B", description: "Reference tactic B", uses: 3 } },
  ],
};
const values = { hp: 30, mv: 4, str: 10, mag: 5, dex: 8, spd: 9, lck: 6, def: 7, res: 3, cha: 4 };
const current = {
  key: "test-unit", name: "Test Unit", full_name: "Test Unit", class_name: "Test Class",
  displayed: values, personal_ability: "", abilities: [], battalion: "Current Company B", battalion_id: 1,
  // Deliberately different runtime values must never leak from the current roster into a historical panel.
  battalion_level: 5, battalion_endurance: 59, gambit_uses: 3,
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
      assert.match(html, /Modifiers are level 1 reference values/);
      assert.doesNotMatch(html, /Company B|Tactic B|Lv 5|>59</);
    });
    await t.test("This Run keeps current roster B", () => {
      const html = render(h(BattalionPanel, { unit: current, scope: "run" }));
      assert.match(html, /Current Company B/);
      assert.match(html, /Tactic B/);
      assert.match(html, /Lv 5/);
      assert.doesNotMatch(html, /Company A|Assignment recorded for this battle/);
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
