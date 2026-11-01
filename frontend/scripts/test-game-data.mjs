import assert from "node:assert/strict";
import { buildCharacters, buildReference, buildSupports, itemSummary, spellSummary } from "../src/reference/gameData.ts";

const structure = { playableCharacters: [], playableClasses: [] };
const files = {
  abilities: { abilities: [{ id: 3, name: "Gift", description: "new" }] },
  items: { items: [{ id: 1000, name: "Potion", description: "Restore HP", amount: 10, uses: 3 }] },
};
const adapted = buildReference(files, { ability_description: { 3: "game text" } }, structure, []);
assert.equal(adapted.abilities[0].description, "game text");
assert.equal(adapted.items[0].effect, "Restore HP");
assert.deepEqual(buildReference({}, {}, structure, []).items, []);
assert.doesNotThrow(() => buildReference({ characters: { characters: [null, []] }, items: { items: "damaged" } }, {}, structure, []));
assert.match(itemSummary({ name: "Blade", kind: "Weapon", description: "A blade", might: 5, hit: 80, crit: 0, weight: 3, range: "1", uses: 20 }), /Mt 5.*Hit 80.*Crit 0.*Wt 3.*Range 1.*Uses 20/);
assert.match(spellSummary({ name: "Spark", type: "Black", might: 3, hit: 90, range: "1–2", uses: 10, effect: "Magic" }), /Magic\nMt 3/);

// Combat arts: weapon, range and stats come from the row's raw bytes.
const rawBytes = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const artRow = (id, bytes, extra = {}) => ({ id, name: `Art ${id}`, might: bytes[3], crit: bytes[4], hit: bytes[5], cost: bytes[10], raw: rawBytes(bytes), ...extra });
const blank = Array(18).fill(0);
const bowArt = artRow(1, blank.map((b, i) => ({ 3: 6, 4: 10, 5: 246, 10: 4, 11: 3, 12: 2, 13: 8 })[i] ?? b));
const utilityArt = artRow(2, blank.map((b, i) => ({ 5: 100, 11: 1, 12: 1, 13: 63 })[i] ?? b));
const swordArt = artRow(3, blank.map((b, i) => ({ 3: 0, 5: 15, 10: 3, 11: 2, 12: 2, 13: 1 })[i] ?? b));
const arts = buildReference({ "combat-arts": { combat_arts: [bowArt, utilityArt, swordArt] } }, {}, structure, []).combat_arts;
assert.deepEqual(arts[0], { name: "Art 1", weapon: "Bow", might: "6", hit: "-10", crit: "10", range: "2–3", cost: "4", description: "" });
assert.deepEqual(arts[1], { name: "Art 2", weapon: "Other", might: "", hit: "", crit: "", range: "1", cost: "", description: "" });
assert.deepEqual(arts[2], { name: "Art 3", weapon: "Sword", might: "0", hit: "15", crit: "", range: "2", cost: "3", description: "" });

// Classes sharing a name: the playable row wins; story-only rows carry no seal, gender limit or requirements.
const zeros = { hp: 0, str: 0, mag: 0, dex: 0, spd: 0, lck: 0, def: 0, res: 0, cha: 0 };
const classRow = (id, extra) => ({ id, name: "Twin", tier: 2, level: 10, base_mv: 5, bases: zeros, boosts: { ...zeros, mv: 0 }, growths: zeros, skill_bonus: {}, mounted: { ...zeros, mv: 0 }, types: {}, ...extra });
const certification = (selectable) => ({ selectable, gender: "female", seal_item: 900, requirements: { sword: 2, lance: 4 }, any_of: false });
const classFiles = { items: { items: [{ id: 900, name: "Seal" }] }, classes: { classes: [
  classRow(1, { tier: 3, level: 20, certification: certification(false), skill_bonus: { riding: 2 } }),
  classRow(2, { certification: certification(true), mounted: { ...zeros, mv: 2, spd: -1 }, skill_bonus: { riding: 0, flying: 2, sword: 1, lance: 0 } }),
] } };
const [twin] = buildReference(classFiles, {}, { playableCharacters: [], playableClasses: [2] }, []).classes;
assert.equal(twin.tier, "Intermediate");
assert.equal(twin.level, 10);
assert.equal(twin.seal, "Seal");
assert.equal(twin.gender, "Female");
assert.deepEqual(twin.requirements, [{ skill: "sword", rank: "D" }, { skill: "lance", rank: "C" }]);
assert.deepEqual(twin.mount_boosts, { mv: 2, spd: -1 });
assert.deepEqual(twin.skill_bonus, { flying: 2, sword: 1 });
assert.deepEqual(twin.proficient, ["sword", "flying"]);
const [storyTwin] = buildReference(classFiles, {}, { playableCharacters: [], playableClasses: [1] }, []).classes;
assert.equal(storyTwin.seal, null);
assert.equal(storyTwin.gender, null);
assert.deepEqual(storyTwin.requirements, []);

// Characters: spoiler crests, learnsets, Byleth's two heights, apparent age, full name fallback.
const person = (id, extra = {}) => ({ id, name: `Unit ${id}`, name_id: id, gender: 0, allegiance: 1, class: "Noble", age: 20, height: { part1: 170, part2: 170 }, birthday: { month: 3, day: 4 }, bases: zeros, growths: zeros, caps: zeros, hp: { base: 1, growth: 2, cap: 3 }, crests: [], ...extra });
const characterFiles = {
  characters: { characters: [
    person(0, { student: {} }), person(1, { height: { part1: 160, part2: 160 } }),
    person(2, { age: 26, crests: [10, 11], student: {
      abilities: [{ id: 1, rank: "C", skill: "authority" }], combat_arts: [{ id: 1, rank: "B", skill: "bow" }],
      spells: { reason: [{ id: 0, rank: "D" }], faith: [] },
    } }),
    person(3, { crests: [10] }),
  ], budding_talents: [] },
  abilities: { abilities: [{ id: 1, name: "Learned" }] },
  "combat-arts": { combat_arts: [bowArt] },
  spells: { spells: [{ id: 0, name: "Spark", skill: 5 }] },
  "crests-by-person": { crests: [{ id: 10, name: "Crest of Alpha", major: true }, { id: 11, name: "Minor Crest of Beta", major: false }] },
};
const [byleth, partly, hidden] = buildCharacters(characterFiles, {}, [0, 2, 3], [2, 3], [2], [], [2]);
assert.equal(byleth.height, "170 cm (male) / 160 cm (female)");
assert.equal(byleth.full_name, "Unit 0");
assert.equal(partly.age, "26 (by appearance)");
assert.deepEqual(partly.abilities, [{ name: "Learned", rank: "C", skill: "authority" }]);
assert.deepEqual(partly.arts, [{ name: "Art 1", rank: "B", skill: "bow" }]);
assert.deepEqual(partly.spells.reason, [{ name: "Spark", rank: "D" }]);
assert.deepEqual(partly.crests, [{ name: "Alpha", major: true }]);
assert.deepEqual(partly.crests_spoiler, [{ name: "Alpha", major: true }, { name: "Beta", major: false }]);
assert.deepEqual(hidden.crests, [{ name: "Mystery", major: true }]);
assert.deepEqual(hidden.crests_spoiler, [{ name: "Alpha", major: true }]);
assert.equal(byleth.crests_spoiler, null);
const crestBearers = buildReference(characterFiles, {}, { playableCharacters: [0, 2, 3], playableClasses: [], hiddenCrests: [2, 3], partlyHiddenCrests: [2] }, []).crests;
assert.deepEqual(crestBearers[0].bearers, { major: ["Unit 2", "Unit 3"], minor: [] });

const social = buildSupports({ characters: { characters: [{ id: 501, name: "B" }] }, supports: { pairs: [{ a: 500, b: 501, a_name: "A", b_name: "B", ranks: ["C", "B"] }] },
  gifts: { characters: [{ character: 501, liked: [{ id: 6, name: "new" }], disliked: [], lost_items: [] }] } },
  [{ a: "A", b: "B", avail: { C: "later" }, notes: ["keep"] }]);
assert.deepEqual(social.pairs[0].ranks, ["C", "B"]);
assert.deepEqual(social.pairs[0].avail, { C: "later" });
assert.deepEqual(social.people.B.liked_gifts, ["new"]);
assert.deepEqual(buildSupports({}, []).pairs, []);
assert.deepEqual(buildSupports({}, []).meals, []);
assert.deepEqual(buildSupports({}, [], { meal: { 0: "First meal", 31: "Last meal", 32: "Unused dish", 5: " " } }).meals,
  [{ id: "0", name: "First meal" }, { id: "31", name: "Last meal" }]);

// Byleth pairs come in a male and a female version; S rank follows the wiki availability of each.
const bylethSocial = buildSupports({ characters: { characters: [{ id: 0, name: "Byleth" }, { id: 501, name: "B" }] }, supports: { pairs: [{ a: 0, b: 501, a_name: "Byleth", b_name: "B", ranks: ["C", "B", "A", "S"] }] } },
  [{ a: "Byleth (M)", b: "B", avail: { S: "later" }, notes: [] }, { a: "Byleth (F)", b: "B", avail: {}, notes: [] }]);
assert.equal(bylethSocial.pairs.length, 2);
assert.deepEqual(bylethSocial.pairs.map((p) => p.a), ["Byleth (M)", "Byleth (F)"]);
assert.deepEqual(bylethSocial.pairs[0].ranks, ["C", "B", "A", "S"]);
assert.deepEqual(bylethSocial.pairs[1].ranks, ["C", "B", "A"]);

// A gift without a text entry keeps the name from the import.
const giftSocial = buildSupports({ characters: { characters: [{ id: 501, name: "B" }] }, gifts: { characters: [{ character: 501, liked: [{ id: 2, name: "Plain" }, { id: 7, name: "Raw" }], disliked: [], lost_items: [] }] } }, [], { gift: { 2: "Spelled" } });
assert.deepEqual(giftSocial.people.B.liked_gifts, ["Plain", "Spelled"]);
console.log("game-data builder tests passed");
