import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { actionRuns, beatTarget, SELF } = await vite.ssrLoadModule("/src/components/battle/moveRuns.ts");

const A = "a:alpha";
const B = "a:beta";
const E = "e:1";
const F = "e:2";
const beat = (actor, target = null, { turn = 1, phase = 1, pulse = null, segment = 0 } = {}) => ({ step: { turn, phase, actor, target }, pulse, segment });
const start = beat(null);

test("whom a beat is aimed at: the other unit attacked or helped, or the unit itself", () => {
  assert.equal(beatTarget(beat(E, A), "attack"), A);
  assert.equal(beatTarget(beat(A, B), "heal"), B);
  assert.equal(beatTarget(beat(A, A), "heal"), SELF, "a heal of its own");
  assert.equal(beatTarget(beat(E), undefined), SELF, "a move");
  assert.equal(beatTarget(beat(E, A), undefined), SELF, "a target but no attack or heal (a move past it)");
  assert.equal(beatTarget(beat(null, null, { pulse: 0 }), undefined), null, "a Divine Pulse");
});

test("moves and other actions of units on themselves play together, whoever does them", () => {
  const beats = [start, beat(E), beat(F), beat(E), beat(A, null, { turn: 2, phase: 0 }), beat(B, B, { turn: 2, phase: 0 })];
  const { end, from } = actionRuns(beats, new Map([[5, "heal"]]));
  assert.deepEqual(end, [0, 3, 3, 3, 5, 5], "the enemy phase's moves; the player phase's move and self-heal");
  assert.equal(from[3], 0, "a run plays from the map before its first beat");
  assert.equal(from[5], 3, "the player run plays from the end of the enemy phase");
  assert.deepEqual([from[1], from[2], from[4]], [0, 1, 3]);
});

test("actions on one unit play together; another target, a phase change or a Divine Pulse ends a run", () => {
  const beats = [start, beat(A, E), beat(B, E), beat(A, E), beat(B, F), beat(A, F, { turn: 2 }), beat(B, F, { turn: 2 })];
  const kinds = new Map(beats.map((_, i) => [i, "attack"]).slice(1));
  assert.deepEqual(actionRuns(beats, kinds).end, [0, 3, 3, 3, 4, 6, 6]);
  assert.deepEqual(actionRuns(beats, new Map([[1, "attack"], [3, "attack"]])).end, [0, 1, 2, 3, 4, 6, 6], "a move between attacks on E");
  const pulsed = [start, beat(E), beat(null, null, { pulse: 0 }), beat(F, null, { segment: 1 }), beat(E, null, { segment: 1 })];
  assert.deepEqual(actionRuns(pulsed).end, [0, 1, 2, 4, 4], "a Divine Pulse between moves");
});

test("an attack and moves stay apart", () => {
  const beats = [start, beat(E), beat(F, A), beat(E)];
  assert.deepEqual(actionRuns(beats, new Map([[2, "attack"]])).end, [0, 1, 2, 3]);
});
