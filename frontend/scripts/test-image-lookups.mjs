import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { battleWeapon, indexCrystalWeapons } from "../src/components/battle/unitAppearance.ts";

async function moduleWithStubs(path, stubs) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const stripped = source.replace(/^import .*;\r?\n/gm, "");
  return import(`data:text/javascript,${encodeURIComponent(`${stubs}\n${stripTypeScriptTypes(stripped)}`)}`);
}

test("portrait variants, repeated IDs, and generic class aliases use imported paths", async () => {
  globalThis.lookupFixture = {
    portraits: {
      app_keys: { edelgard: "base", edelgard_child: "child", hegemon_edelgard: "alternate", dimitri: "base2", dimitri_child: "child2", rhea: "other", seiros: "other-look", tomas: "t1", solon: "t2" },
      characters: { 2: { part1: "base" }, 3: { part1: "base2" }, 36: { part1: "other" }, 39: { part1: "t2" }, 55: { part1: "t1" }, 58: { part1: "other-look" }, 70: { part1: "child2" }, 71: { part1: "child" } },
      generic: [{ class: 10, gender: 0, files: ["images/portraits/example.png"] }], persons: {},
    },
    characters: { characters: [] },
  };
  const portraits = await moduleWithStubs("../src/portraits.ts", `
    const spoilerShown = () => true;
    const canonical = () => null;
    const loadGameJson = async (path) => globalThis.lookupFixture[path.includes('portraits') ? 'portraits' : 'characters'];
    const loadGameText = async () => ({});
    const gameLanguage = () => 'ENG_U';
    const objectIcon = () => null, OBJECT_NAMES = new Set();
    const bundledPortrait = (file) => 'portrait-key:' + file;
  `);
  await portraits.loadPortraitIndex();
  assert.equal(portraits.faceUrl({ character: 2, classId: 80 }, false), "portrait-key:hegemon_edelgard.png");
  assert.equal(portraits.faceUrl({ character: 71 }, false), "portrait-key:edelgard_child.png");
  assert.equal(portraits.faceUrl({ character: 70 }, false), "portrait-key:dimitri_child.png");
  assert.equal(portraits.faceUrl({ character: 58, name: "seiros" }, false), "portrait-key:seiros.png");
  assert.equal(portraits.faceUrl({ character: 39, name: "tomas" }, false), "portrait-key:tomas.png");
  assert.equal(portraits.faceUrl({ character: 55, name: "solon" }, false), "portrait-key:solon.png");
  assert.equal(portraits.faceUrl({ classId: 6 }, false), "images/portraits/example.png");
});

test("battle places resolve imported text and unmapped scenarios stay empty", async () => {
  const scenarios = await moduleWithStubs("../src/components/battle/scenarios.ts", `
    const scenarioData = { routes: {} };
    const gameLanguage = () => 'ENG_U';
    const loadGameText = async (category) => category === 'battle_place' ? { 7: 'Example place', 17: 'Another place' } : {};
  `);
  await scenarios.loadScenarioText();
  const battle = (scenario) => ({ scenario, units: [], map_name: "" });
  assert.equal(scenarios.battleName(battle(18)).place, "Example place");
  assert.equal(scenarios.battleName(battle(19)).place, "Another place");
  assert.equal(scenarios.battleName(battle(29)).place, null);
  assert.ok(scenarios.battleName(battle(86)).place);
});

test("factions pick banners and scenario enemies by ID, in any language", async () => {
  globalThis.indexCrystalWeaponsFixture = indexCrystalWeapons;
  globalThis.factionFixture = {
    factions: { characters: [{ id: 7, allegiance: 1 }, { id: 8, allegiance: 15 }, { id: 9, allegiance: 23 }], factions: [{ id: 1, name: "Empire" }, { id: 11, name: "Rogues" }, { id: 15, name: "Independents" }] },
    crests: { characters: [], crests: [] },
    weapons: { weapons: [{ id: 213, raw: "00".repeat(15) + "80" }] },
    text: { 1: "Kaiserreich", 11: "Schurken", 15: "Unabhängige" },
    banners: new Map(),
  };
  const factions = await moduleWithStubs("../src/components/battle/factions.ts", `
    const loadGameJson = async (path) => globalThis.factionFixture[path.includes('factions') ? 'factions' : path.includes('weapons') ? 'weapons' : 'crests'];
    const indexCrystalWeapons = globalThis.indexCrystalWeaponsFixture;
    const loadGameText = async (category) => category === 'faction' ? globalThis.factionFixture.text : {};
    const gameLanguage = () => 'GER';
    const factionBanners = globalThis.factionFixture.banners;
  `);
  await factions.loadBattleIndexes();
  assert.equal(factions.factionOf(7), "Kaiserreich");
  assert.equal(globalThis.factionFixture.banners.get("Kaiserreich"), "black-eagles");
  assert.equal(factions.factionOf(8, 0), "Schurken");
  assert.equal(factions.factionOf(8), "Unabhängige");
  assert.equal(factions.factionOf(9), "Underground Residents");
  assert.equal(battleWeapon({ weapon: "gauntlets", inventory: [{ id: 213, kind: "weapon", uses: 100 }] }), "crest-stone");
  indexCrystalWeapons([]);
});
