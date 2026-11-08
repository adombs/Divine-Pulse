import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// The battle log's rows (the list; the tree draws the same rows) link everything that has a destination in the
// Archive or opens a unit's card, and leave plain what has none.
const reference = {
  characters: [], classes: [], abilities: [{ name: "Rally Speed" }], crests: [], items: [],
  combat_arts: [{ name: "Break Shot" }], magic: [{ name: "Rescue" }],
  battalions: [
    { name: "Alpha Company", description: "", endurance: 40, gambit: { name: "Stride", description: "" } },
    { name: "Beta Company", description: "", endurance: 40, gambit: { name: "Stride", description: "" } },
  ],
};
const army = (key, name, battalion) => [`a:${key}`, { id: `a:${key}`, name, army: true, unit: { key, name, battalion } }];
const people = new Map([
  army("marianne", "Marianne", "Beta Company"), army("raphael", "Raphael"), army("cyril", "Cyril"),
  ["e:1", { id: "e:1", name: "Bandit", army: false, enemy: { slot: 1, label: "Bandit", side: "enemy" } }],
]);
const row = (kind, extra) => ({
  key: kind, t: 0, turn: 1, phase: 0, kind, category: "fight", text: "", heading: false, actor: null, target: null,
  dealt: null, taken: null, restored: null, confidence: null, branch: 0, step: null, ...extra,
});

test("log rows link their units, gambits and other named things", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, watch: null }, esbuild: { jsx: "automatic" },
    plugins: [{
      name: "log-ssr-inputs",
      transform(source, id) {
        if (id.endsWith("/reference/types.ts")) {
          const hook = source.indexOf("export function useReference()");
          assert.ok(hook >= 0);
          return source.slice(0, hook) + `export function useReference() { return ${JSON.stringify(reference)}; }`;
        }
      },
    }],
  });
  try {
    const { ItemRow, BattleNavContext } = await server.ssrLoadModule("/src/components/battle/parts.tsx");
    const { NavProvider } = await server.ssrLoadModule("/src/nav.tsx");
    const nav = { route: { page: "battle" }, go() {}, back() {}, canBack: false };
    const render = (item) =>
      renderToStaticMarkup(h(NavProvider, { nav }, h(BattleNavContext.Provider, { value: { people, open() {} } }, h("ol", null, h(ItemRow, { item })))));
    const links = (html) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));

    await t.test("a gambit opens the battalion its user has, and its target opens a card", () => {
      const html = render(row("gambit", { actor: "a:marianne", target: "a:raphael", detail: "Stride", text: "Marianne used Stride on Raphael." }));
      assert.deepEqual(links(html), ["Marianne", "Stride", "Raphael"]);
      assert.match(html, /title="Open Beta Company in the Archive"/);
      assert.doesNotMatch(html, /Marianne used Stride/);
    });
    await t.test("a gambit nobody in the import has stays plain text", () => {
      const html = render(row("gambit", { actor: "a:raphael", detail: "Unknown Tactic" }));
      assert.deepEqual(links(html), ["Raphael"]);
      assert.match(html, /Unknown Tactic/);
    });
    await t.test("a gambit shows its damage", () => {
      assert.match(render(row("gambit", { actor: "a:marianne", target: "e:1", detail: "Stride", dealt: 11 })), /title="Damage Dealt"[^>]*>.*11/);
    });
    await t.test("battle start links each of your units", () => {
      const text = "Battle started with 3 units (Marianne, Raphael, Cyril); 20 other units on the map";
      const html = render(row("start", { text, category: "turn" }));
      assert.deepEqual(links(html), ["Marianne", "Raphael", "Cyril"]);
      assert.match(html, /; 20 other units on the map/);
    });
    await t.test("level-ups, joins and exits link the unit and keep the rest of the line", () => {
      const level = render(row("level_up", { actor: "a:cyril", text: "Cyril reached level 25 (HP +1, Mag +1, Spd +1)", category: "growth" }));
      assert.deepEqual(links(level), ["Cyril"]);
      assert.match(level, /reached level 25 \(HP \+1, Mag \+1, Spd \+1\)/);
      assert.deepEqual(links(render(row("joined", { actor: "a:cyril", text: "Cyril joined the battle" }))), ["Cyril"]);
      assert.deepEqual(links(render(row("left", { actor: "a:cyril", text: "Cyril left the battle" }))), ["Cyril"]);
      assert.deepEqual(links(render(row("stat_up", { actor: "a:cyril", text: "Cyril: Str +2" }))), ["Cyril"]);
    });
    await t.test("an event about a unit the battle doesn't know stays plain", () => {
      assert.deepEqual(links(render(row("joined", { actor: "a:ghost", text: "Ghost joined the battle" }))), []);
    });
    await t.test("attacks, arts, spells and rallies keep their links", () => {
      assert.deepEqual(links(render(row("attack", { actor: "a:raphael", target: "e:1", dealt: 25 }))), ["Raphael", "Bandit"]);
      assert.deepEqual(links(render(row("attack", { actor: "a:raphael", target: "e:1", detail: "Break Shot", dealt: 9 }))), ["Raphael", "Break Shot", "Bandit"]);
      assert.deepEqual(links(render(row("spell", { actor: "a:raphael", target: "a:cyril", detail: "Rescue" }))), ["Raphael", "Rescue", "Cyril"]);
      assert.deepEqual(links(render(row("rally", { actor: "a:raphael", target: "a:cyril", detail: "Rally Speed" }))), ["Raphael", "Rally Speed", "Cyril"]);
    });
  } finally {
    await server.close();
  }
});
