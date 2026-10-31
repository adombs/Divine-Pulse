import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReference } from "../src/reference/gameData.ts";

const wiki = JSON.parse(readFileSync(new URL("../src/reference/wiki/fe-wiki.json", import.meta.url)));
assert(wiki.classes.length > 0 && wiki.supports.some((p) => p.notes.length));
assert([...wiki.classes, ...wiki.supports].every((p) => p.url.startsWith("https://fireemblemwiki.org/wiki/")));
const structure = { playableCharacters: [], playableClasses: [] };
const adapted = buildReference({ abilities: { abilities: [{ id: 1, name: "Ability" }] } }, { ability_description: { 1: "Text" } }, structure, []);
assert.equal(adapted.abilities[0].description, "Text");
assert.deepEqual(buildReference({}, {}, structure, []).characters, []);
