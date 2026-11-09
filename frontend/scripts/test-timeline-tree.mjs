import test from "node:test";
import assert from "node:assert/strict";
import { ancestry, buildLanes, byImportance, dots, openPath, uncovered } from "../src/components/battle/timelineTree.ts";

const item = (kind, text = kind) => ({ kind, text });
const column = (id, parent, fork, rows, at = 0) => ({ id, parent, fork, at, rows: new Map(rows) });
const index = (lanes) => new Map(lanes.map((l) => [l.id, l]));

// The trunk has actions at 0..6; branch 1 split off it at 3 (and has 3..4); branch 2 split off branch 1 at 4.
const columns = [
  column(0, null, 0, [[0, [item("phase")]], [1, [item("attack")]], [2, [item("move")]], [3, [item("pulse"), item("attack")]], [4, [item("wait")]], [6, [item("attack")]]]),
  column(1, 0, 3, [[3, [item("attack")]], [4, [item("attack"), item("defeat")]]], 100),
  column(2, 1, 4, [[4, [item("move")]]], 200),
];

test("lanes: Divine Pulse lines are left out, and branches sit around the timeline they split from", () => {
  const lanes = buildLanes(columns);
  assert.deepEqual([...lanes.map((l) => l.id)].sort(), [0, 1, 2]);
  assert.ok(lanes.every((l) => l.rows.every(([, items]) => items.every((i) => i.kind !== "pulse"))));
  // The trunk's step 3 keeps its attack, so the row survives without the pulse line.
  assert.equal(lanes.find((l) => l.id === 0).rows.find(([s]) => s === 3)[1].length, 1);
  // Branch 1 is next to the trunk, and branch 2 (its own branch) next to branch 1.
  const ids = lanes.map((l) => l.id);
  assert.equal(Math.abs(ids.indexOf(1) - ids.indexOf(0)), 1);
  assert.equal(Math.abs(ids.indexOf(2) - ids.indexOf(1)), 1);
});

test("lanes: a timeline whose only lines were Divine Pulses has no lane", () => {
  const lanes = buildLanes([columns[0], column(1, 0, 3, [[3, [item("pulse")]]], 100)]);
  assert.deepEqual(lanes.map((l) => l.id), [0]);
});

test("a path runs from the trunk to the lane, each part ending where the next splits off", () => {
  const byId = index(buildLanes(columns));
  assert.deepEqual(ancestry(byId, 2).map((p) => [p.lane.id, p.end]), [[0, 2], [1, 3], [2, 4]].map(([id, end]) => [id, end]));
  assert.deepEqual(ancestry(byId, 0).map((p) => [p.lane.id, p.end]), [[0, 6]]);
  assert.deepEqual([...openPath(byId, 1)], [[0, 2], [1, 4]]);
  assert.equal(openPath(byId, null).size, 0);
});

test("dots: every lane's ends and forks, plus everything on the open path, each position once", () => {
  const lanes = buildLanes(columns);
  const byId = index(lanes);
  const closed = dots(lanes, openPath(byId, null), null).map((d) => d.key).sort();
  assert.deepEqual(closed, ["0-0", "0-2", "0-6", "1-3", "1-4", "2-4"].sort());
  const open = dots(lanes, openPath(byId, 1), null);
  assert.deepEqual(open.filter((d) => d.open).map((d) => d.key).sort(), ["0-0", "0-1", "0-2", "1-3", "1-4"]);
  assert.equal(new Set(open.map((d) => d.key)).size, open.length, "a position is never a dot twice");
});

test("dots: the replay's position on the trunk is a dot of its own", () => {
  const lanes = buildLanes(columns);
  const here = dots(lanes, new Map(), 4).filter((d) => d.active);
  assert.deepEqual(here.map((d) => d.key), ["0-4"]);
});

test("dots count up from the top of their lane, for the side their log rows alternate to", () => {
  const lanes = buildLanes(columns);
  const trunk = dots(lanes, openPath(index(lanes), 0), null).filter((d) => d.lane.id === 0);
  assert.deepEqual(trunk.map((d) => d.index), trunk.map((_, i) => i));
});

test("log rows that would cover each other: the earlier one stays, the later is hidden", () => {
  const box = (key, top, bottom, left = 0, right = 100) => ({ key, left, right, top, bottom });
  assert.deepEqual([...uncovered([box("a", 0, 50), box("b", 40, 90), box("c", 60, 100)])].sort(), ["a", "c"]);
  assert.deepEqual([...uncovered([box("a", 0, 50), box("b", 0, 50, 200, 300)])].sort(), ["a", "b"], "side by side is fine");
  assert.deepEqual([...uncovered([box("a", 0, 50), box("b", 51, 90)])], ["a"], "touching rows still need their margin");
});

test("the current position's row gets laid out first, and keeps its place", () => {
  const rows = [{ key: "a", active: false }, { key: "b", active: true }, { key: "c", active: false }];
  assert.deepEqual(byImportance(rows).map((r) => r.key), ["b", "a", "c"]);
});
