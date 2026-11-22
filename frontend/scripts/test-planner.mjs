import assert from "node:assert/strict";
import { canTakeClass, linkRoute, linkToken, mentionQuery, parseNotes, reaches, searchEntries, serializeNotes, targetsForClasses } from "../src/planner.ts";

// Notes keep their links through a save and a load.
const notes = "Pair with @[Dimitri](unit:dimitri) and get a @[Killing Edge](weapon:Killing Edge).\nThen @[Swordmaster](class:Swordmaster)";
const parts = parseNotes(notes);
assert.deepEqual(parts.filter((p) => "link" in p).map((p) => p.link), [
  { kind: "unit", id: "dimitri", label: "Dimitri" },
  { kind: "weapon", id: "Killing Edge", label: "Killing Edge" },
  { kind: "class", id: "Swordmaster", label: "Swordmaster" },
]);
assert.equal(serializeNotes(parts), notes);
// An unknown kind, or a hand-typed bracket, stays text.
assert.deepEqual(parseNotes("@[x](spaceship:y) [a](b)"), [{ text: "@[x](spaceship:y) [a](b)" }]);
assert.equal(linkToken({ kind: "item", id: "Odd)", label: "Odd]\nName" }), "@[Odd Name](item:Odd)");

assert.deepEqual(linkRoute({ kind: "unit", id: "felix" }), { page: "archive", tab: "characters", id: "felix" });
assert.deepEqual(linkRoute({ kind: "art", id: "Wrath Strike" }), { page: "archive", tab: "arts", q: "Wrath Strike" });

// The @ being typed.
assert.equal(mentionQuery("see @"), "");
assert.equal(mentionQuery("see @Dim"), "Dim");
assert.equal(mentionQuery("see @Killing Ed"), "Killing Ed");
assert.equal(mentionQuery("mail@home"), null);
assert.equal(mentionQuery("see @Dim  and"), null);
assert.equal(mentionQuery("no at here"), null);

const entries = [
  { kind: "class", id: "Swordmaster", label: "Swordmaster", icon: null },
  { kind: "weapon", id: "Silver Sword", label: "Silver Sword", icon: null },
  { kind: "unit", id: "sylvain", label: "Sylvain", icon: null },
  { kind: "item", id: "Seraph Robe", label: "Seraph Robe", icon: null },
];
assert.deepEqual(searchEntries(entries, "s").map((e) => e.id), ["sylvain", "Swordmaster", "Silver Sword", "Seraph Robe"]);
assert.deepEqual(searchEntries(entries, "sword").map((e) => e.id), ["Swordmaster", "Silver Sword"]);
assert.deepEqual(searchEntries(entries, "item s").map((e) => e.id), ["Seraph Robe"]);
assert.deepEqual(searchEntries(entries, "class ").map((e) => e.id), ["Swordmaster"]);
// A name that starts with a kind's name is still found by it.
assert.deepEqual(searchEntries([{ kind: "unit", id: "u", label: "Unit Zero", icon: null }], "unit").map((e) => e.id), ["u"]);

assert.equal(reaches("B+", "B"), true);
assert.equal(reaches("C", "B"), false);
assert.equal(reaches(undefined, "E"), false);
assert.deepEqual(
  targetsForClasses({ sword: "S", lance: "D" }, [
    { requirements: [{ skill: "sword", rank: "A" }, { skill: "lance", rank: "B" }], requirement_any: false },
    { requirements: [{ skill: "axe", rank: "D" }, { skill: "bow", rank: "D" }], requirement_any: true },
  ]),
  { sword: "S", lance: "B" },
);

// Classes a unit could take: gender and whose class it is count; skill ranks don't.
const felix = { key: "felix", gender: "Male", house: "Blue Lions", startClass: "Noble", has: ["Myrmidon"] };
const ingrid = { key: "ingrid", gender: "Female", house: "Blue Lions", startClass: "Noble", has: [] };
const takes = (who, name, gender = null) => canTakeClass(who, { name, gender });
assert.equal(takes(felix, "Swordmaster"), true);
assert.equal(takes(felix, "Falcon Knight", "Female"), false);
assert.equal(takes(ingrid, "Falcon Knight", "Female"), true);
assert.equal(takes(ingrid, "War Master", "Male"), false);
assert.equal(takes(felix, "Great Lord", "Male"), false);
assert.equal(takes({ ...felix, key: "dimitri" }, "Great Lord", "Male"), true);
assert.equal(takes(felix, "Lord"), false);
assert.equal(takes({ ...ingrid, key: "edelgard" }, "Lord"), true);
assert.equal(takes(felix, "Dancer"), true);
assert.equal(takes({ key: "seteth", gender: "Male", house: "Church of Seiros" }, "Dancer"), false);
assert.equal(takes(felix, "Noble"), true);
assert.equal(takes(felix, "Commoner"), false);
// Certified-only classes can be worked towards.
assert.equal(takes(felix, "Dark Bishop", "Male"), true);
assert.equal(takes(felix, "Trickster"), true);
// A class it is in or has mastered always counts, and the unknown rules nothing out.
assert.equal(takes({ ...felix, has: ["Commoner"] }, "Commoner"), true);
assert.equal(takes({ key: "byleth", gender: "" }, "Gremory", "Female"), true);
assert.equal(takes({ key: null, gender: "" }, "Lord"), true);
console.log("planner tests passed");
