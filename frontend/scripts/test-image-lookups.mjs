import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "./strip-types.mjs";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { battleWeapon, indexCrystalWeapons } from "../src/components/battle/unitAppearance.ts";
import { artWeapon } from "../src/reference/gameData.ts";

async function moduleWithStubs(path, stubs, compile = stripTypeScriptTypes) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const stripped = source.replace(/^import .*;\r?\n/gm, "");
  return import(`data:text/javascript,${encodeURIComponent(`${stubs}\n${compile(stripped)}`)}`);
}

const compileTsx = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;

test("a unit with no map sprite shows its portrait on the map, and \"?\" when no art exists", async () => {
  globalThis.fallbackFixture = {
    React,
    atlas: true,
    index: { classes: {}, characters: {}, heads: { characters: {}, m: 0, f: 1 }, mounted: [] },
    portrait: "portrait-key:example.png",
    imported: null,
  };
  const icons = await moduleWithStubs("../src/components/battle/mapIcons.tsx", "const spoilerShown = () => false;", compileTsx);
  globalThis.fallbackFixture.spriteLayers = icons.spriteLayers;
  const stubs = `
    const f = globalThis.fallbackFixture;
    const React = f.React, memo = React.memo, createContext = React.createContext;
    const LOW_HP = 0.25, WEAPON_LABEL = {};
    const describe = () => 'Example unit';
    const useGameImageUrl = (path) => path.includes('class-sprites') ? (f.atlas ? path : '') : path;
    const spriteLayers = f.spriteLayers;
    const UnitSprite = () => React.createElement('image', { href: 'sprite.png' });
    const MapImage = ({ href, imported }) => React.createElement('image', { href: imported || href });
    const WeaponGlyph = () => React.createElement('image', { href: 'weapon.png' });
    const miniBadge = () => 'badge.png';
    const useContext = () => ({
      mapLook: { myFaces: f.myFaces || 'sprites', otherFaces: f.unitsLook || 'sprites' },
      portrait: () => f.portrait, importedFace: () => f.imported,
      people: new Map([['e:1', { enemy: {} }]]),
    });
    const useSprites = () => f.index;
    const spriteOf = () => ({ classId: 47, character: 47, female: true, side: 'enemy' });
    const isObject = () => false;
    const PortraitImage = ({ bundled }) => React.createElement('img', { src: bundled });
    const GameImage = ({ imported }) => React.createElement('img', { src: imported });
    const MissingGameAsset = ({ label }) => React.createElement('span', { 'data-asset-error': 'missing' }, label);
  `;
  const { Token } = await moduleWithStubs("../src/components/battle/Minimap.tsx", stubs, (source) => compileTsx(source + "\nexport { Token };"));
  const { UnitFace } = await moduleWithStubs("../src/components/battle/parts.tsx", stubs, compileTsx);
  const props = {
    piece: { name: "Example", sprite: { classId: 47, character: 47, female: true, side: "enemy" } },
    x: 0, y: 0, opacity: 1, hp: null, tile: null, clip: "", full: false,
  };
  const map = (want = "sprites", generic = false) => renderToStaticMarkup(React.createElement(Token, {
    ...props,
    piece: generic ? { ...props.piece, sprite: { ...props.piece.sprite, character: null } } : props.piece,
    sprites: globalThis.fallbackFixture.index,
    portrait: globalThis.fallbackFixture.portrait,
    importedFace: globalThis.fallbackFixture.imported,
    look: { mine: want, others: want },
  }));
  const face = () => renderToStaticMarkup(React.createElement(UnitFace, { id: "e:1", name: "Example" }));
  const f = globalThis.fallbackFixture;
  // On the map a unit with no sprite shows its portrait; lists and the "?" stay explicit about the missing sprite.
  assert.match(map(), /map-token enemy portrait/);
  assert.match(map("sprites", true), /map-token enemy portrait/);
  assert.match(face(), /data-asset-error="missing"/);
  assert.doesNotMatch(map(), /weapon\.png|initial/);
  f.portrait = null;
  assert.match(map(), /data-asset-error="missing"[^]*>\?</);
  f.portrait = "portrait-key:example.png";
  f.index.finished_classes = { 47: { f: 2 } };
  assert.match(map(), /map-token sprite/);
  assert.match(face(), /sprite\.png/);
  assert.match(map("portraits"), /map-token enemy portrait/);
  assert.match(map("badges"), /weapon\.png/);
  const ownershipLook = { mine: "portraits", others: "badges" };
  const token = (army) => renderToStaticMarkup(React.createElement(Token, {
    ...props, piece: { ...props.piece, army }, sprites: f.index, portrait: f.portrait,
    importedFace: null, look: ownershipLook,
  }));
  assert.match(token(true), /map-token enemy portrait/);
  assert.match(token(false), /weapon\.png/); // A named opponent still uses the other-units setting.
  // A unit on your side from the battle records (the prologue's house leaders) follows your army's setting.
  const yours = renderToStaticMarkup(React.createElement(Token, {
    ...props, piece: { ...props.piece, army: false, sprite: { ...props.piece.sprite, side: "player" } }, sprites: f.index,
    portrait: f.portrait, importedFace: null, look: ownershipLook,
  }));
  assert.match(yours, /map-token player portrait/);
  f.myFaces = "portraits";
  f.unitsLook = "sprites";
  assert.match(face(), /sprite\.png/);
  assert.match(renderToStaticMarkup(React.createElement(UnitFace, { id: "a:1", name: "Example" })), /example\.png/);
  f.atlas = false;
  assert.match(map(), /map-token enemy portrait/);
  f.index = null;
  f.imported = "images/portraits/example.png";
  f.portrait = null;
  assert.match(map(), /map-token enemy portrait/);
  assert.match(face(), /data-asset-error="missing"/);
  f.unitsLook = 'portraits';
  assert.match(face(), /images\/portraits\/example\.png/);
  f.imported = null;
  assert.match(map(), /data-asset-error="missing"[^]*>\?</);
  assert.doesNotMatch(map(), /weapon\.png|initial/);
});

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

test("Byleth's recorded hair follows Auto and yields to explicit portrait phases", async () => {
  globalThis.bylethPortraitFixture = {
    app_keys: { byleth_m: "m-dark", byleth_m_2: "m-green", byleth_f: "f-dark", byleth_f_2: "f-green" },
    characters: { 0: { part1: "m-dark" }, 1: { part1: "f-dark" } },
  };
  const portraits = await moduleWithStubs("../src/portraits.ts", `
    const spoilerShown = () => true;
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
    assert.equal(portraits.faceUrl({ character, look: "green" }, false, false), `portrait-key:${key}.png`);
    assert.equal(portraits.faceUrl({ character, look: "dark" }, true, false), `portrait-key:${key}_2.png`);
    assert.equal(portraits.portraitUrl({ name: "Byleth", gender, look: "green" }, false, false), `portrait-key:${key}.png`);
    assert.equal(portraits.portraitUrl({ name: "Byleth", gender, look: "dark" }, true, false), `portrait-key:${key}_2.png`);
  }
  assert.equal(portraits.portraitUrl({ name: "Byleth", gender: "Male", portrait_gender: "female", look: "green" }, false), "portrait-key:byleth_m_2.png");
});

test("battle places resolve imported text and unmapped scenarios stay empty", async () => {
  const scenarios = await moduleWithStubs("../src/components/battle/scenarios.ts", `
    const scenarioData = { routes: {} };
    const questData = { quests: [] };
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

test("factions pick banners and names by ID, in any language", async () => {
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
  // The record's faction ID names the affiliation, with no scenario guessing; a character's own allegiance only stands in for a record without one.
  assert.equal(factions.factionOf(1), "Kaiserreich");
  assert.equal(globalThis.factionFixture.banners.get("Kaiserreich"), "black-eagles");
  assert.equal(factions.factionOf(null, 7), "Kaiserreich");
  assert.equal(factions.factionOf(15, 8), "Unabhängige");
  assert.equal(factions.factionOf(11, 8), "Schurken");
  assert.equal(factions.factionOf(23), "Underground Residents");
  assert.equal(factions.factionOf(null, 999), undefined);
  assert.equal(battleWeapon({ weapon: "gauntlets", inventory: [{ id: 213, kind: "weapon", uses: 100 }] }), "crest-stone");
  indexCrystalWeapons([]);
});

test("a unit with no known affiliation gets its army's banner", async () => {
  globalThis.bannerFixture = { factionBanners: new Map() };
  const mod = await moduleWithStubs("../src/components/AffiliationIcon.tsx", "const factionBanners = globalThis.bannerFixture.factionBanners;", compileTsx);
  assert.equal(mod.affiliationBanner(null, "enemy"), "army-enemy");
  assert.equal(mod.affiliationBanner(undefined, "ally"), "army-ally");
  assert.equal(mod.affiliationBanner(undefined, "third"), "army-third");
  assert.equal(mod.affiliationBanner(undefined, "player"), "army-player");
  assert.equal(mod.affiliationBanner("Black Eagles", "enemy"), "black-eagles");
  assert.equal(mod.affiliationBanner("Other", "enemy"), "army-enemy");
  assert.equal(mod.affiliationBanner("Other", "ally"), "army-ally");
  assert.equal(mod.affiliationBanner("Other", "third"), "army-third");
  assert.equal(mod.affiliationBanner("Other"), "other");
  assert.equal(mod.affiliationBanner("Flame Emperor Army", "enemy"), "army-enemy");
  assert.equal(mod.affiliationBanner(undefined, "object"), null);
  assert.equal(mod.affiliationBanner(undefined), null);
});

test("Jeralt as a Paladin rides in his own sprite, with his own head", async () => {
  globalThis.fallbackFixture = { React };
  const { spriteLayers } = await moduleWithStubs("../src/components/battle/mapIcons.tsx", "const spoilerShown = () => false;", compileTsx);
  const index = {
    armies: ["player", "enemy", "ally", "third"], classes: { 51: { m: 33 } }, characters: { 35: 105 }, mounted: [33],
    heads: { characters: {}, m: 0, f: 1 }, class_heads: { 51: { m: 169 } }, character_classes: { 35: { 51: 116 } },
  };
  assert.deepEqual(spriteLayers(index, { classId: 51, female: false, side: "ally", character: 35 }, true), { row: 116, head: null, mounted: false });
});
