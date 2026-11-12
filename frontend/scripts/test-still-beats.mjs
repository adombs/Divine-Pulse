import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { chronicle } = await vite.ssrLoadModule("/src/components/battle/chronicle.ts");
const { animates, renumber, stillBeats } = await vite.ssrLoadModule("/src/components/battle/stillBeats.ts");
const { beatLabels, actingBeats } = await vite.ssrLoadModule("/src/components/battle/replayLabels.ts");

const frame = (...rows) => new Map(rows);
const A = "a:alpha";
const E = "e:1";

test("what animates: a unit moving, arriving, leaving, falling or getting up; HP alone does not", () => {
  const base = frame([A, [0, 0, 10]], [E, [3, 0, 10]]);
  assert.equal(animates(base, frame([A, [0, 0, 10]], [E, [3, 0, 10]])), false);
  assert.equal(animates(base, frame([A, [0, 0, 4]], [E, [3, 0, 10]])), false, "a hit alone is drawn by its arrow, not by moving");
  assert.equal(animates(base, frame([A, [1, 0, 10]], [E, [3, 0, 10]])), true, "moved");
  assert.equal(animates(base, frame([A, [0, 0, 10]])), true, "left the map");
  assert.equal(animates(frame([A, [0, 0, 10]]), base), true, "arrived");
  assert.equal(animates(base, frame([A, [0, 0, 10]], [E, [3, 0, 0]])), true, "fell");
  assert.equal(animates(frame([A, [0, 0, 10]], [E, [3, 0, 0]]), base), true, "got up");
  assert.equal(animates(frame([E, [3, 0, 0]]), frame()), false, "a unit already down dropping out of the data animates nothing");
});

const plain = (i, actor = null, target = null) => ({ step: i, turn: 1, phase: 0, actor, target, units: {} });

test("a run of phase-start beats collapses; a move, an attack without moving, a defeat and a Divine Pulse are kept", () => {
  const f0 = frame([A, [0, 0, 10]], [E, [3, 0, 10]]);
  const moved = frame([A, [1, 0, 10]], [E, [3, 0, 10]]);
  const gone = frame([A, [1, 0, 10]]);
  const beats = [
    { step: plain(0), frame: f0, pulse: null },
    { step: plain(1), frame: f0, pulse: null }, // phase start
    { step: plain(2), frame: f0, pulse: null }, // "Fight!"
    { step: plain(3, A), frame: moved, pulse: null }, // a move
    { step: plain(4, A, E), frame: moved, pulse: null }, // an attack, nobody moves
    { step: plain(5, A), frame: moved, pulse: null }, // waited where it stood
    { step: plain(6), frame: gone, pulse: null }, // a defeat only: the unit disappears
    { step: plain(7), frame: gone, pulse: null }, // still
    { step: plain(8), frame: gone, pulse: 0 }, // a Divine Pulse, even where nothing changes
    { step: plain(9), frame: gone, pulse: null }, // still, after the Divine Pulse
  ];
  const kinds = new Map([[4, "attack"]]);
  assert.deepEqual([...stillBeats(beats, kinds)].sort((a, b) => a - b), [1, 2, 5, 7, 9]);
  assert.deepEqual([...stillBeats(beats, kinds, new Set([5]))].sort((a, b) => a - b), [1, 2, 7, 9], "a beat with a label to show is kept");
  assert.deepEqual([...stillBeats(beats.slice(0, 1))], [], "the first beat is never removed");
});

test("renumbering points a removed beat at the next one kept (the previous when none follows)", () => {
  // Kept 0, 3, 4, 6 become 0, 1, 2, 3.
  assert.deepEqual(renumber(new Set([1, 2, 5, 7]), 8), [0, 1, 1, 1, 2, 3, 3, 3]);
  assert.deepEqual(renumber(new Set(), 3), [0, 1, 2]);
});

const entry = (position, kind, text, extra = {}) => ({ t: position + 1, turn: 1, phase: 0, kind, text, unit: "alpha", target: null, actor_id: A, target_id: null, step: position, ...extra });
const step = (position, extra = {}) => ({ step: position, turn: 1, phase: 0, actor: null, target: null, units: {}, ...extra });

const battle = () => ({
  units: [], events: [], map_presence: { [E]: [[0, true], [6, false]] },
  map_steps: [
    step(0, { actor: A, units: { [A]: [0, 0, 10], [E]: [3, 0, 10] } }),
    step(1), // Began enemy phase
    step(2), // Fight!
    step(3, { actor: A, units: { [A]: [1, 0, 10] } }), // alpha moved
    step(4, { actor: A, target: E, units: { [E]: [3, 0, 4] } }), // alpha attacked without moving
    step(5, { actor: A }), // alpha waited
    step(6), // the foe is gone
    step(7), // nothing
  ],
  log: [
    entry(0, "move", "alpha moved"),
    entry(1, "start", "Began enemy phase.", { actor_id: null, unit: null }),
    entry(2, "start", "Fight!", { actor_id: null, unit: null }),
    entry(3, "move", "alpha moved too"),
    entry(4, "attack", "alpha attacked the foe", { target_id: E, dealt: 6, taken: 0 }),
    entry(5, "wait", "alpha waited"),
    entry(6, "defeat", "alpha killed the foe", { target_id: E }),
    entry(7, "wait", "later"),
  ],
  branches: [],
});

test("the chronicle leaves still beats out, renumbers the rest, and log rows point at the next beat kept", () => {
  const { beats, items } = chronicle(battle());
  // Kept: 0 (first), 3 (moved), 4 (attacked), 6 (the foe is gone). Left out: 1, 2, 5, 7.
  assert.deepEqual(beats.map((b) => b.pos), [0, 3, 4, 6]);
  assert.deepEqual(beats.map((b) => b.step.step), [0, 1, 2, 3], "each remaining beat has its own index");
  const beatOfRow = (text) => items.find((i) => i.text === text)?.beat;
  assert.equal(beatOfRow("Began enemy phase."), 1, "a phase start points at the next beat kept");
  assert.equal(beatOfRow("Fight!"), 1);
  assert.equal(beatOfRow("alpha attacked the foe"), 2);
  assert.equal(beatOfRow("alpha waited"), 3, "a wait points at the next beat kept");
  assert.equal(beatOfRow("later"), 3, "with none after it, at the previous one");
  assert.equal(items.find((i) => i.text === "Began enemy phase.").rehomed, true);
  assert.equal(items.find((i) => i.text === "alpha attacked the foe").rehomed, undefined);
  assert.equal(items.filter((i) => i.beat != null).every((i) => i.beat >= 0 && i.beat < beats.length), true);
});

test("Divine Pulse beats stay, with the indexes that point at them", () => {
  const first = [0, 1, 2, 3].map((p) => step(p, { actor: A, units: { [A]: [p, 0, 10] } }));
  const b = battle();
  b.map_steps = [step(0, { actor: A, units: { [A]: [0, 0, 10] } }), step(1), step(2, { actor: A, units: { [A]: [1, 0, 10] } })];
  b.map_presence = {};
  b.log = [entry(0, "move", "first"), entry(1, "start", "Began enemy phase.", { actor_id: null }), entry(2, "move", "again")];
  b.branches = [{
    id: 1, parent: 0, fork: 1, turn: 1, at: 100, events: [],
    log: [entry(1, "move", "undone")], map_steps: first, map_presence: {},
  }];
  const c = chronicle(b);
  assert.equal(c.pulses.length, 1);
  assert.equal(c.beats[c.pulses[0].beat].pulse, 0);
  assert.deepEqual(c.beats.map((x) => x.step.step), c.beats.map((_, i) => i));
  const undone = c.items.find((i) => i.text === "undone");
  assert.equal(undone.undoneAt, c.pulses[0].beat, "the row undone points at its Divine Pulse's new index");
  const row = c.items.find((i) => i.kind === "pulse");
  assert.equal(row.beat, c.pulses[0].beat);
});

const icons = { art: (n) => (n === "Frozen Lance" ? "art.png" : null), spell: (n) => (n === "Heal" ? "heal.png" : null), item: (n) => (n === "Vulnerary" ? "vul.png" : null), ability: () => null };
const row = (extra) => ({ key: "k", t: 0, turn: 1, phase: 0, kind: "attack", category: "fight", text: "never parsed", heading: false, actor: A, target: E, dealt: null, taken: null, restored: null, confidence: null, branch: 0, step: 1, beat: 2, ...extra });

test("labels: an attack shows its damage at the target and the counter at the actor; a double hit shows each number", () => {
  const out = beatLabels([row({ dealt: 12, taken: 3 }), row({ dealt: 12, taken: 0 })], 2, icons);
  assert.deepEqual(out.map((l) => [l.unit, l.kind, l.value, l.tone]), [[E, "attack", "12 · 12", "attack"], [A, "attack", "3 · 0", "attack"]]);
});

test("labels: a combat art shows its icon and name with the damage; heal and item show HP restored; no label for moves or deaths", () => {
  const art = beatLabels([row({ detail: "Frozen Lance", dealt: 21 })], 2, icons);
  assert.deepEqual(art.map((l) => [l.unit, l.kind, l.game, l.name, l.value]), [[E, "art", "art.png", "Frozen Lance", "21"]]);
  const heal = beatLabels([row({ kind: "heal", detail: "Heal", restored: 21 })], 2, icons);
  assert.deepEqual(heal.map((l) => [l.unit, l.kind, l.game, l.value, l.tone]), [[E, "heal", "heal.png", "+21", "heal"]]);
  const used = beatLabels([row({ kind: "item", detail: "Vulnerary", target: null, restored: 20 })], 2, icons);
  assert.deepEqual(used.map((l) => [l.unit, l.game, l.name, l.value]), [[A, "vul.png", "Vulnerary", "+20"]]);
  const rally = beatLabels([row({ kind: "rally", detail: "Rally Speed" })], 2, icons);
  assert.deepEqual(rally.map((l) => [l.kind, l.name, l.value]), [["rally", "Rally Speed", null]]);
  assert.deepEqual(beatLabels([row({ kind: "move" }), row({ kind: "defeat" }), row({ kind: "fell" }), row({ kind: "wait" }), row({ kind: "start", heading: true })], 2, icons), []);
  assert.deepEqual(beatLabels([row({ dealt: 5 })], 3, icons), [], "only the beat's own items");
  assert.deepEqual(beatLabels([row({ dealt: 5, rehomed: true })], 2, icons), [], "not the rows of a beat left out");
  assert.deepEqual([...actingBeats([row({ kind: "rally", detail: "x" }), row({ kind: "wait", beat: 4 })])], [2]);
});
