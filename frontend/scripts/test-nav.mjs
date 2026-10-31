import test from "node:test";
import assert from "node:assert/strict";
import { fromHash, toHash } from "../src/routes.ts";

test("battle recording routes use the canonical id segment and preserve q", () => {
  const route = { page: "battle", id: "chapter 1/record", q: "unit key" };
  const hash = toHash(route);
  assert.equal(hash, "#/battle/chapter%201%2Frecord?q=unit%20key");
  assert.deepEqual(fromHash(hash), route);
});

test("malformed percent escapes safely fall back to Home", () => {
  assert.deepEqual(fromHash("#/battle/%E0%A4%A"), { page: "home" });
});
