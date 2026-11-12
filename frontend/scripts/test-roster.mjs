import test from "node:test";
import assert from "node:assert/strict";
import { onRoster, rosterUnits } from "../src/roster.ts";

const death = { battle_id: null, battle_name: "", scenario: null, turn: null, step: null, t: null, manual: false };

test("the Roster shows the army and the dead, not units that left alive", () => {
  const units = [
    { key: "a", in_army: true, death: null },
    { key: "b", in_army: false, death: null },
    { key: "c", in_army: false, death },
    { key: "d", in_army: true, death },
  ];
  assert.deepEqual(rosterUnits(units).map((u) => u.key), ["a", "c", "d"]);
});

test("the server's on_roster wins, and older servers' units are all on the Roster", () => {
  assert.equal(onRoster({ on_roster: false, in_army: true }), false);
  assert.equal(onRoster({ on_roster: true, in_army: false }), true);
  assert.equal(onRoster({}), true);
  assert.equal(onRoster({ in_army: false }), false);
});
