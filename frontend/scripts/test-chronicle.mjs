import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

// Load the real module through the project's TS resolver, with its real dependencies.
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { chronicle } = await vite.ssrLoadModule("/src/components/battle/chronicle.ts");

const step = (position, x) => ({ step: position, turn: 1 + Math.floor(position / 3), phase: 0, actor: "a:alpha", target: null, units: { "a:alpha": [x, 0, 10] } });
const entry = (position, t, text, extra = {}) => ({ t, turn: 1, kind: "move", text, unit: "alpha", target: null, actor_id: "a:alpha", target_id: null, step: position, ...extra });

// The first run did steps 0-4; Divine Pulse 1 turned back to position 3 (undoing 3 and 4); then 3, 4 and 5 were done again;
// Divine Pulse 2 turned back further, to position 2, and the battle went on with 2 and 3. Positions are the game's, and
// the same position can be a different action in each segment.
const first = [0, 1, 2, 3, 4].map((p) => step(p, p));
const second = [0, 1, 2].map((p) => step(p, p)).concat([3, 4, 5].map((p) => step(p, p + 10)));
const standing = [step(0, 0), step(1, 1), step(2, 20), step(3, 21)];

const battle = (branchSnapshots = true) => ({
  units: [], events: [], map_steps: standing, map_presence: {},
  log: [
    entry(0, 1, "first"),
    entry(1, 2, "second"),
    entry(3, 100, "Divine Pulse", { kind: "pulse" }),
    entry(2, 210, "after the second pulse"),
    entry(3, 211, "and again"),
  ],
  branches: [
    // Listed out of order on purpose: the order they were used in is by time.
    {
      id: 2, parent: 1, fork: 2, turn: 1, at: 200, events: [],
      log: [entry(2, 3, "undone by the second pulse"), entry(3, 110, "redone"), entry(4, 111, "redone and defeated", { kind: "attack", target_id: "e:1", dealt: 5, taken: 0 }),
        entry(4, 111, "alpha killed the foe", { kind: "defeat", target_id: "e:1" }), entry(5, 112, "last redone")],
      ...(branchSnapshots ? { map_steps: second, map_presence: {} } : {}),
    },
    {
      id: 1, parent: 0, fork: 3, turn: 2, at: 100, events: [],
      log: [entry(3, 4, "undone by the first pulse"), entry(4, 5, "undone attack", { kind: "attack", target_id: "e:1", dealt: 5, taken: 0 }), entry(4, 5, "alpha killed the foe", { kind: "defeat", target_id: "e:1" })],
      ...(branchSnapshots ? { map_steps: first, map_presence: {} } : {}),
    },
  ],
});

test("one chronology: what happened in order, with a row for each Divine Pulse where it was used", () => {
  const { items, pulses } = chronicle(battle());
  assert.deepEqual(items.filter((i) => i.kind !== "defeat").map((i) => i.text), [
    "first", "second", "undone by the second pulse", "undone by the first pulse", "undone attack",
    "Turned back time to turn 2 with Divine Pulse: 2 actions undone.",
    "redone", "redone and defeated", "last redone",
    "Turned back time to turn 1 with Divine Pulse: 4 actions undone.",
    "after the second pulse", "and again",
  ]);
  assert.equal(items.filter((i) => i.kind === "pulse").length, 2, "the game's own Divine Pulse line is replaced by the chronicle's row");
  assert.deepEqual(pulses.map((p) => [p.index, p.beat, p.turn]), [[0, 5, 2], [1, 9, 1]]);
});

test("every action and every Divine Pulse is a beat; a Divine Pulse's map is the rewound one", () => {
  const { beats, complete } = chronicle(battle());
  assert.equal(complete, true);
  assert.equal(beats.length, 5 + 1 + 3 + 1 + 2);
  assert.deepEqual(beats.map((b) => b.step.step), beats.map((_, i) => i), "each beat has its own index");
  assert.deepEqual(beats.map((b) => b.pulse), [null, null, null, null, null, 0, null, null, null, 1, null, null]);
  assert.deepEqual(beats.map((b) => b.pos), [0, 1, 2, 3, 4, null, 3, 4, 5, null, 2, 3]);
  const fx = (frame) => frame.get("a:alpha")[0];
  const x = (beat) => fx(beat.frame);
  assert.equal(x(beats[4]), 4);
  assert.equal(x(beats[5]), 2, "after Divine Pulse 1 the map is as it stood after position 2");
  assert.equal(x(beats[6]), 13);
  assert.equal(x(beats[9]), 1, "after Divine Pulse 2 it is as it stood after position 1");
  // The steps undone are stepped back through last first, ending on the rewound map.
  assert.deepEqual(beats[5].undo.map(fx), [4, 3, 2]);
  assert.deepEqual(beats[9].undo.map(fx), [15, 14, 13, 2, 1]);
  assert.deepEqual(beats.map((b) => b.segment), [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
});

test("rows are on their beats, and know which Divine Pulse turned them back", () => {
  const { items } = chronicle(battle());
  const row = (text) => items.find((i) => i.text === text);
  assert.equal(row("first").beat, 0);
  assert.equal(row("undone by the second pulse").beat, 2, "position 2 was done in the first segment");
  assert.equal(row("undone by the first pulse").beat, 3);
  assert.equal(row("redone").beat, 6);
  assert.equal(row("after the second pulse").beat, 10, "the same position in the last segment is another beat");
  assert.equal(row("and again").beat, 11);
  assert.deepEqual([row("first"), row("and again")].map((i) => [i.undoneBy, i.undoneAt]), [[null, null], [null, null]]);
  assert.deepEqual([row("undone by the first pulse"), row("undone attack")].map((i) => [i.undoneBy, i.undoneAt]), [[0, 5], [0, 5]]);
  assert.deepEqual([row("undone by the second pulse"), row("redone")].map((i) => [i.undoneBy, i.undoneAt]), [[1, 9], [1, 9]]);
  const pulse = items.filter((i) => i.kind === "pulse");
  assert.deepEqual(pulse.map((i) => [i.pulse, i.beat]), [[0, 5], [1, 9]]);
});

test("a defeat is not a row of its own: the action that caused it says so", () => {
  const { items, log } = chronicle(battle());
  assert.equal(items.filter((i) => i.kind === "defeat").length, 2, "the statistics still see every defeat");
  assert.equal(log.filter((i) => i.kind === "defeat" || i.kind === "fell").length, 0);
  assert.equal(log.length, items.length - 2);
  assert.equal(log.find((i) => i.text === "undone attack").defeated, true);
  assert.equal(log.find((i) => i.text === "redone and defeated").defeated, true);
  assert.equal(log.find((i) => i.text === "first").defeated, undefined);
});

test("a step with only a defeat keeps it", () => {
  const b = battle();
  b.log.push(entry(7, 300, "alpha killed the foe", { kind: "defeat", target_id: "e:1" }), entry(7, 300, "alpha killed the foe", { kind: "defeat", target_id: "e:2" }));
  const { log } = chronicle(b);
  assert.equal(log.filter((i) => i.kind === "defeat").length, 1);
});

test("an older recording without the map before a rewind replays what stands, and cannot show what was undone", () => {
  const { beats, items, complete } = chronicle(battle(false));
  assert.equal(complete, false);
  assert.equal(beats.length, 4);
  assert.ok(beats.every((b) => b.pulse === null));
  const row = (text) => items.find((i) => i.text === text);
  assert.equal(row("undone by the first pulse").beat, null);
  assert.equal(row("first").beat, 0);
  assert.equal(row("and again").beat, 3);
  assert.equal(items.filter((i) => i.kind === "pulse").length, 2, "the log still has its Divine Pulse rows, not pickable");
  assert.ok(items.filter((i) => i.kind === "pulse").every((i) => i.beat === null));
});

test("a battle that never used Divine Pulse is its map history and its log", () => {
  const { beats, items, pulses } = chronicle({ units: [], events: [], map_steps: standing, log: [entry(0, 1, "only")], branches: [] });
  assert.equal(beats.length, 4);
  assert.deepEqual(pulses, []);
  assert.deepEqual(items.map((i) => [i.text, i.beat, i.undoneBy]), [["only", 0, null]]);
});

test("a unit's fall that stands is where a Roster death link opens the replay; an undone fall isn't", async () => {
  const { fallBeat } = await vite.ssrLoadModule("/src/components/battle/chronicle.ts");
  const fell = (position, t, extra = {}) => entry(position, t, "alpha fell.", { kind: "fell", ...extra });
  const b = battle();
  // Alpha fell in the first run (undone by the first pulse) and again in the timeline that stands.
  b.branches[1].log.push(fell(4, 5));
  b.log.push(fell(3, 211));
  const chron = chronicle(b);
  const beat = fallBeat(chron, "alpha");
  assert.notEqual(beat, null);
  const standingFall = chron.items.find((i) => i.kind === "fell" && i.undoneBy == null);
  assert.equal(beat, standingFall.beat);
  assert.equal(fallBeat(chron, "nobody"), null);
  // Only the undone fall: no link to a step.
  const undone = battle();
  undone.branches[1].log.push(fell(4, 5));
  assert.equal(fallBeat(chronicle(undone), "alpha"), null);
});
