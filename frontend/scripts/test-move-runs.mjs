import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { moveRuns, onlyMoves } = await vite.ssrLoadModule("/src/components/battle/moveRuns.ts");

const frame = (...rows) => new Map(rows);
const A = "a:alpha";
const B = "a:beta";
const E = "e:1";
const F = "e:2";
const beat = (actor, frame, { turn = 1, phase = 1, pulse = null, segment = 0 } = {}) => ({ step: { turn, phase, actor }, frame, pulse, segment });
const move = (i, actor) => ({ beat: i, kind: "move", heading: false, actor });

test("only moves: someone moved, and nobody arrived, left, fell or got up", () => {
  const base = frame([A, [0, 0, 10]], [E, [3, 0, 10]]);
  assert.equal(onlyMoves(base, frame([A, [0, 0, 10]], [E, [4, 0, 10]])), true);
  assert.equal(onlyMoves(base, base), false, "nobody moved");
  assert.equal(onlyMoves(base, frame([A, [0, 0, 10]], [E, [4, 0, 0]])), false, "fell");
  assert.equal(onlyMoves(base, frame([A, [0, 0, 10]])), false, "left the map");
  assert.equal(onlyMoves(frame([A, [0, 0, 10]]), base), false, "arrived");
});

// The enemy phase: E moves, F moves, E moves again; then the player phase starts with A moving and B moving.
const f0 = frame([A, [0, 0, 10]], [B, [1, 0, 10]], [E, [8, 8, 10]], [F, [9, 9, 10]]);
const f1 = frame([A, [0, 0, 10]], [B, [1, 0, 10]], [E, [7, 8, 10]], [F, [9, 9, 10]]);
const f2 = frame([A, [0, 0, 10]], [B, [1, 0, 10]], [E, [7, 8, 10]], [F, [9, 7, 10]]);
const f3 = frame([A, [0, 0, 10]], [B, [1, 0, 10]], [E, [6, 8, 10]], [F, [9, 7, 10]]);
const f4 = frame([A, [0, 1, 10]], [B, [1, 0, 10]], [E, [6, 8, 10]], [F, [9, 7, 10]]);
const f5 = frame([A, [0, 1, 10]], [B, [1, 1, 10]], [E, [6, 8, 10]], [F, [9, 7, 10]]);

test("consecutive moves of one phase play together, and a phase change starts a new run", () => {
  const beats = [beat(null, f0), beat(E, f1), beat(F, f2), beat(E, f3), beat(A, f4, { turn: 2, phase: 0 }), beat(B, f5, { turn: 2, phase: 0 })];
  const items = [1, 2, 3].map((i) => move(i, beats[i].step.actor)).concat([move(4, A), move(5, B)]);
  const { end, from } = moveRuns(beats, items);
  assert.deepEqual(end, [0, 3, 3, 3, 5, 5]);
  assert.equal(from[3], 0, "the enemy run plays from the map before its first move");
  assert.equal(from[5], 3, "the player run plays from the end of the enemy phase");
  assert.deepEqual([from[1], from[2], from[4]], [0, 1, 3]);
});

test("an attack, a log row other than a move, a label or a Divine Pulse breaks a run", () => {
  const beats = [beat(null, f0), beat(E, f1), beat(F, f2), beat(E, f3)];
  const items = [move(1, E), move(2, F), move(3, E)];
  assert.deepEqual(moveRuns(beats, items, new Map([[2, "attack"]])).end, [0, 1, 2, 3], "an attack in the middle");
  assert.deepEqual(moveRuns(beats, [...items, { beat: 2, kind: "level_up", heading: false }]).end, [0, 1, 2, 3], "a level-up row");
  assert.deepEqual(moveRuns(beats, items, undefined, new Set([2])).end, [0, 1, 2, 3], "a label (a Rally)");
  const pulsed = [beat(null, f0), beat(E, f1), beat(null, f1, { pulse: 0 }), beat(F, f2, { segment: 1 }), beat(E, f3, { segment: 1 })];
  assert.deepEqual(moveRuns(pulsed, items).end, [0, 1, 2, 4, 4], "a Divine Pulse between moves");
});

test("a lone move stays a beat of its own", () => {
  const beats = [beat(null, f0), beat(E, f1), beat(E, f1)];
  const { end, from } = moveRuns(beats, [move(1, E)]);
  assert.deepEqual(end, [0, 1, 2]);
  assert.deepEqual(from, [0, 0, 1]);
});
