import assert from "node:assert/strict";
import { gambitOwner, isStoryClass, matchNames, nameParts } from "../src/reference/links.ts";
assert.deepEqual(matchNames("Crest of Fraldarius and Aegis Shield; Aegis Shields", ["Aegis", "Aegis Shield", "Crest of Fraldarius"]).map((m) => m.name), ["Crest of Fraldarius", "Aegis Shield", "Aegis"]);
assert.deepEqual(matchNames("fireball Fire! wildfire", ["Fire"]).map((m) => m.name), ["Fire"]);
assert.deepEqual(matchNames("nothing", []), []);
assert.equal(isStoryClass("Barbarossa"), true);
assert.equal(isStoryClass("Dancer"), false);
assert.deepEqual(matchNames("Crest of Blaiddyd's might; (Dark Aegis Shield)", ["Crest of Blaiddyd", "Aegis Shield", "Dark Aegis Shield"]).map((m) => [m.start, m.name]), [[0, "Crest of Blaiddyd"], [28, "Dark Aegis Shield"]]);
assert.deepEqual(matchNames("RALLY Spd+4 firewall", ["Rally Spd+4", "Fire"]).map((m) => m.name), ["Rally Spd+4"]);
assert.deepEqual(matchNames("Lord Lordly Lords", ["Lord"]).map((m) => m.start), [0]);
assert.deepEqual(matchNames("Hero's Relic", ["Hero's Relic", "Hero"]).map((m) => m.name), ["Hero's Relic"]);
assert.ok(isStoryClass("Emperor") && isStoryClass("Armored Lord") && !isStoryClass("Dark Bishop"));
console.log("link matcher tests passed");
assert.deepEqual(matchNames("A Hero's Relic. The Hero class.", ["Hero"]).map((m) => m.start), [20]);
assert.deepEqual(nameParts("Battle started (Byleth, Lysithea Von Ordelia); 20 others", ["Byleth", "Lysithea Von Ordelia"]), [
  { text: "Battle started (" }, { text: "Byleth", name: "Byleth" }, { text: ", " }, { text: "Lysithea Von Ordelia", name: "Lysithea Von Ordelia" }, { text: "); 20 others" },
]);
assert.deepEqual(nameParts("no names", ["Byleth"]), [{ text: "no names" }]);
const companies = [{ name: "Alpha", gambit: { name: "Stride" } }, { name: "Beta", gambit: { name: "Stride" } }, { name: "Gamma" }, { name: "Delta", gambit: { name: "Assembly" } }];
assert.equal(gambitOwner(companies, "Stride"), "Alpha");
assert.equal(gambitOwner(companies, "Stride", "Beta"), "Beta");
assert.equal(gambitOwner(companies, "Stride", "Gamma"), "Alpha");
assert.equal(gambitOwner(companies, "assembly"), "Delta");
assert.equal(gambitOwner(companies, "Nothing like it"), null);
assert.equal(gambitOwner([], "Stride"), null);
