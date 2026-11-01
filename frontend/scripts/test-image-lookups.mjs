import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { battleWeapon, indexCrystalWeapons } from "../src/components/battle/unitAppearance.ts";
import { artWeapon } from "../src/reference/gameData.ts";

async function moduleWithStubs(path, stubs, compile = stripTypeScriptTypes) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const stripped = source.replace(/^import .*;\r?\n/gm, "");
  return import(`data:text/javascript,${encodeURIComponent(`${stubs}\n${compile(stripped)}`)}`);
}

const compileTsx = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;

test("a combat art's icon follows its weapon, whatever the art costs", async () => {
  // Byte 10 is the durability cost and byte 13 the weapon. Each cost below is also a valid-looking weapon number, so reading the wrong byte picks the wrong icon.
  const row = (id, name, cost, weapon) => {
    const bytes = Array(16).fill(0);
    bytes[10] = cost;
    bytes[13] = weapon;
    return { id, name, raw: bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  };
  globalThis.artFixture = {
    artWeapon,
    arts: [row(0, "Sword art", 3, 0x01), row(1, "Lance art", 5, 0x02), row(2, "Axe art", 1, 0x04), row(3, "Bow art", 2, 0x08), row(4, "Brawling art", 4, 0x10), row(5, "Any weapon art", 1, 0x3f)],
  };
  const icons = await moduleWithStubs("../src/reference/icons.tsx", `
    const React = {};
    const artWeapon = globalThis.artFixture.artWeapon;
    const loadGameJson = async (path) => path.includes('combat-arts') ? { combat_arts: globalThis.artFixture.arts } : {};
    const loadGameText = async () => ({});
    const gameLanguage = () => 'ENG_U';
  `, compileTsx);
  await icons.loadReferenceIcons();
  for (const [name, tile, weapon] of [["Sword art", "sword", "sword"], ["Lance art", "lance", "lance"], ["Axe art", "axe", "axe"], ["Bow art", "bow", "bow"], ["Brawling art", "brawling", "gauntlets"]]) {
    assert.equal(icons.artIconUrl(name), `images/icons/combat-arts/${tile}.png`);
    assert.equal(icons.artWeaponIconUrl(name), `images/icons/weapons/${weapon}.png`);
  }
  assert.equal(icons.artIconUrl("Any weapon art"), "images/icons/combat-arts/other.png");
  assert.equal(icons.artWeaponIconUrl("Any weapon art"), null);
});

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

test("Byleth's recorded hair overrides Part II settings for both genders", async () => {
  globalThis.bylethPortraitFixture = {
    app_keys: { byleth_m: "m-dark", byleth_m_2: "m-green", byleth_f: "f-dark", byleth_f_2: "f-green" },
    characters: { 0: { part1: "m-dark" }, 1: { part1: "f-dark" } },
  };
  const portraits = await moduleWithStubs("../src/portraits.ts", `
    const spoilerShown = () => false;
    const canonical = () => null;
    const loadGameJson = async (path) => path.includes('portraits') ? globalThis.bylethPortraitFixture : {};
    const loadGameText = async () => ({});
    const gameLanguage = () => 'ENG_U';
    const objectIcon = () => null, OBJECT_NAMES = new Set();
    const bundledPortrait = (file) => 'portrait-key:' + file;
  `);
  await portraits.loadPortraitIndex();
  for (const [character, gender, key] of [[0, "Male", "byleth_m"], [1, "Female", "byleth_f"]]) {
    for (const part2 of [false, true]) {
      assert.equal(portraits.faceUrl({ character, look: "green" }, part2), `portrait-key:${key}_2.png`);
      assert.equal(portraits.faceUrl({ character, look: "dark" }, part2), `portrait-key:${key}.png`);
      assert.equal(portraits.portraitUrl({ name: "Byleth", gender, look: "green" }, part2), `portrait-key:${key}_2.png`);
      assert.equal(portraits.portraitUrl({ name: "Byleth", gender, look: "dark" }, part2), `portrait-key:${key}.png`);
    }
  }
  assert.equal(portraits.portraitUrl({ name: "Byleth", gender: "Male", portrait_gender: "female", look: "green" }, false), "portrait-key:byleth_f_2.png");
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
