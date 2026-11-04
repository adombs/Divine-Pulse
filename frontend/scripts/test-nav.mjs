import test from "node:test";
import assert from "node:assert/strict";
import { fromHash, toHash } from "../src/routes.ts";

test("battle recording routes use the canonical id segment and preserve q", () => {
  const route = { page: "battle", id: "chapter 1/record", q: "unit key" };
  const hash = toHash(route);
  assert.equal(hash, "#/battle/chapter%201%2Frecord?q=unit%20key");
  assert.deepEqual(fromHash(hash), route);
});

test("old Characters page links open the Archive's Characters and Crests tabs", () => {
  assert.deepEqual(fromHash("#/characters/characters/hilda"), { page: "archive", tab: "characters", id: "hilda", q: undefined });
  assert.deepEqual(fromHash("#/characters/crests/Goneril"), { page: "archive", tab: "crests", id: "Goneril", q: undefined });
  assert.deepEqual(fromHash("#/characters"), { page: "archive", tab: "characters", id: undefined, q: undefined });
  assert.equal(toHash({ page: "archive", tab: "battalions", id: "Test Company" }), "#/archive/battalions/Test%20Company");
});

test("the Archive's cards are general only: no run stats, gear, abilities or battalion", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["../src/components/reference/CharactersPage.tsx", "../src/components/reference/ArchivePage.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const runField of ["base_values", "inventory", "unit.abilities", "unit.personal_ability", "unit.combat_arts", "accessory", "unit.battalion", "u.battalion", "BattalionPanel unit=", "BattalionBadge", "Equipped in your run", ">Yours<", "In this run"]) {
      assert.equal(source.includes(runField), false, `${file} shows run data (${runField})`);
    }
  }
});

test("malformed percent escapes safely fall back to Home", () => {
  assert.deepEqual(fromHash("#/battle/%E0%A4%A"), { page: "home" });
});
