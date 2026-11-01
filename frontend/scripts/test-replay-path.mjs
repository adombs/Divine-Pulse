import test from "node:test";
import assert from "node:assert/strict";
import { replayPath } from "../src/components/battle/replayPath.ts";

const step = (step, actor) => ({ step, turn: 1, phase: 0, actor, target: null, units: {} });

test("selecting Divine Pulse uses replays their recorded snapshots in chronological order", () => {
  const common = step(0, "common");
  const first = [common, step(1, "first failed path")];
  const second = [common, step(1, "retry"), step(2, "nested failed path")];
  const standing = [common, step(1, "standing path")];
  const firstPresence = { "e:1": [[0, false], [1, true]] };
  const secondPresence = { "e:2": [[0, false], [2, true]] };
  const standingPresence = { "e:3": [[0, false]] };
  // Deliberately out of time order; the second branch was nested under the first.
  const battle = {
    map_steps: standing, map_presence: standingPresence,
    branches: [
      { id: 2, parent: 1, fork: 2, at: 20, map_steps: second, map_presence: secondPresence },
      { id: 1, parent: 0, fork: 1, at: 10, map_steps: first, map_presence: firstPresence },
    ],
  };
  assert.deepEqual(replayPath(battle, 0), { steps: first, presence: firstPresence, available: true });
  assert.deepEqual(replayPath(battle, 1), { steps: second, presence: secondPresence, available: true });
  assert.deepEqual(replayPath(battle, null), { steps: standing, presence: standingPresence, available: true });
  assert.deepEqual(battle.branches.map((branch) => branch.id), [2, 1], "selection must not reorder the saved branches");
});

test("an older branch without a map snapshot cannot replay the standing path by mistake", () => {
  const battle = {
    map_steps: [step(0, "standing")], map_presence: {},
    branches: [{ id: 1, parent: 0, fork: 0, at: 1 }],
  };
  const path = replayPath(battle, 0);
  assert.equal(path.available, false);
  assert.deepEqual(path.steps, []);
  assert.equal(replayPath(battle, null).available, true);
});

test("an empty recorded snapshot is unavailable", () => {
  const battle = {
    map_steps: [step(0, "standing")],
    branches: [{ id: 1, parent: 0, fork: 0, at: 1, map_steps: [], map_presence: {} }],
  };
  const path = replayPath(battle, 0);
  assert.equal(path.available, false);
  assert.deepEqual(path.steps, []);
});
