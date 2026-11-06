import assert from "node:assert/strict";
import test from "node:test";
import { WEAPON_RANKS, withinWeaponRank } from "../src/reference/weaponRanks.ts";

test("each discrete maximum includes all and only the ranks up to that stop", () => {
  for (const [limit, maximum] of WEAPON_RANKS.entries()) {
    for (const [at, rank] of WEAPON_RANKS.entries()) assert.equal(withinWeaponRank(rank, maximum), at <= limit, `${rank} at maximum ${maximum}`);
  }
});

test("Any includes unknown requirements while a real maximum preserves their uncertainty", () => {
  for (const rank of [...WEAPON_RANKS, undefined, "", "—", "unrecognized"]) assert.equal(withinWeaponRank(rank, null), true);
  for (const maximum of WEAPON_RANKS) {
    for (const rank of [undefined, "", "—", "unrecognized"]) assert.equal(withinWeaponRank(rank, maximum), false);
  }
});
