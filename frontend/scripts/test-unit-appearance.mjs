import test from "node:test";
import assert from "node:assert/strict";
import { battleWeapon, indexCrystalWeapons, mapSpan } from "../src/components/battle/unitAppearance.ts";

test("saved monster weapons recover the crystal flag without changing normal weapons or spells", () => {
  indexCrystalWeapons([{ id: 213, raw: "00".repeat(15) + "80" }, { id: 20, raw: "00".repeat(16) }, { id: 21, raw: "invalid" }]);
  const shard = { id: 213, kind: "weapon", uses: 100, equipped: true };
  for (const weapon of ["gauntlets", "sword", ""]) assert.equal(battleWeapon({ weapon, inventory: [shard] }), "crest-stone");
  assert.equal(battleWeapon({ weapon: "reason", inventory: [shard] }), "reason");
  assert.equal(battleWeapon({ weapon: "sword", inventory: [{ ...shard, id: 20 }] }), "sword");
  assert.equal(battleWeapon({ weapon: "sword", inventory: [{ ...shard, equipped: false, id: 20 }, { ...shard, equipped: false }] }), "sword");
  assert.equal(battleWeapon({ weapon: "crest-stone" }), "crest-stone");
  indexCrystalWeapons([]);
  assert.equal(battleWeapon({ weapon: "gauntlets", inventory: [shard] }), "gauntlets");
});

test("Demonic Beast footprint uses IDs before names and keeps other units at one tile", () => {
  assert.equal(mapSpan({ class_id: 63, class_name: "localized" }), 2);
  assert.equal(mapSpan({ class_id: 64, class_name: "localized" }), 2);
  assert.equal(mapSpan({ class_name: "Demonic Beast" }), 2);
  assert.equal(mapSpan({ class_name: "Exp. Demonic Beast" }), 2);
  assert.equal(mapSpan({ class_id: 66, class_name: "Demonic Beast" }), 1);
  assert.equal(mapSpan({ class_name: "Giant Demonic Beast" }), 1);
  assert.equal(mapSpan({ class_id: 0, class_name: "Noble" }), 1);
  assert.equal(mapSpan(undefined), 1);
});
