import test from "node:test";
import assert from "node:assert/strict";
import { cardsPerPage, chooseCardLayout, chunk, FADE_MS, LEGIBLE_FRACTION, legibleScale, PAGE_MS, pageScale, sceneAt, sidesOf } from "../src/exporting/teamPages.ts";
import { featuredWeapon } from "../src/exporting/mostUsed.ts";

const base = { minText: 14, frameHeight: 720, contentWidth: 520, roomWidth: 1248, minHeight: 190, roomHeight: 600 };

test("the smallest text is drawn at 2.0% of the frame's height where the room allows", () => {
  const k = pageScale(base);
  assert.ok(Math.abs(14 * k - 720 * 0.02) < 1e-9);
  // The same text in a 1080-high frame is 26 px at output size.
  assert.ok(Math.abs(pageScale({ ...base, frameHeight: 1080 }) * 14 - 21.6) < 1e-9);
});

test("legibleScale is the smallest text as a share of the frame's height", () => {
  assert.ok(Math.abs(legibleScale(10, 1000) - 2.0) < 1e-9);
  assert.equal(legibleScale(0, 1000), 1);
});

test("a narrow frame limits the scale by the width, and one card always fits", () => {
  const narrow = pageScale({ ...base, frameHeight: 1280, roomWidth: 688 });
  assert.ok(Math.abs(narrow - 688 / 520) < 1e-9);
  const short = pageScale({ ...base, roomHeight: 150 });
  assert.ok(Math.abs(short - 150 / 190) < 1e-9);
});

test("cards per page: as many as fit, never fewer than one", () => {
  assert.equal(cardsPerPage(560, 190, 12, 1.2), 2); // 2 * 228 + 12 = 468 <= 560 < 3 * 228 + 24
  assert.equal(cardsPerPage(1200, 190, 12, 1), 6);
  assert.equal(cardsPerPage(100, 190, 12, 1), 1);
  // A taller frame holds more cards than a wide one at the same legibility.
  const wide = cardsPerPage(600, 190, 12, pageScale({ ...base, frameHeight: 720 }));
  const tall = cardsPerPage(1200, 190, 12, pageScale({ ...base, frameHeight: 1280, roomWidth: 688 }));
  assert.ok(tall > wide);
});

test("chunk splits in order and covers everything", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
});

test("placements", () => {
  assert.deepEqual(sidesOf("start"), ["start"]);
  assert.deepEqual(sidesOf("end"), ["end"]);
  assert.deepEqual(sidesOf("both"), ["start", "end"]);
});

const segments = [{ id: "p1", ms: PAGE_MS }, { id: "replay", ms: 4000 }, { id: "p2", ms: PAGE_MS }];

test("a team page stays exactly one second and its crossfade is short, inside that second", () => {
  assert.equal(PAGE_MS, 1000);
  assert.ok(FADE_MS > 0 && FADE_MS <= 200);
  assert.equal(LEGIBLE_FRACTION, 0.02);
});

test("the video shows one scene except right at the cuts", () => {
  assert.deepEqual(sceneAt(segments, 0), { a: { index: 0, local: 0 }, b: null, mix: 0 });
  assert.deepEqual(sceneAt(segments, 500), { a: { index: 0, local: 500 }, b: null, mix: 0 });
  assert.deepEqual(sceneAt(segments, 3000), { a: { index: 1, local: 2000 }, b: null, mix: 0 });
  assert.equal(sceneAt(segments, 5500).a.index, 2);
});

test("a crossfade straddles the cut: half of it either side, the replay's clock not skipped", () => {
  const before = sceneAt(segments, 1000 - FADE_MS / 2 + 1);
  assert.equal(before.a.index, 0);
  assert.equal(before.b.index, 1);
  assert.equal(before.b.local, 0);
  assert.ok(before.mix > 0 && before.mix < 0.01);
  const cut = sceneAt(segments, 1000);
  assert.ok(Math.abs(cut.mix - 0.5) < 1e-9);
  const after = sceneAt(segments, 1000 + FADE_MS / 2 - 1);
  assert.equal(after.a.index, 0);
  assert.equal(after.a.local, 1000);
  assert.equal(after.b.index, 1);
  assert.equal(after.b.local, FADE_MS / 2 - 1);
  assert.ok(after.mix > 0.99);
  // Past the fade, the replay is alone.
  assert.equal(sceneAt(segments, 1000 + FADE_MS / 2).b, null);
  // Out of the replay into the last page.
  const out = sceneAt(segments, 5000);
  assert.equal(out.a.index, 1);
  assert.equal(out.b.index, 2);
  assert.equal(out.a.local, 4000);
});

test("two pages in a row crossfade into each other without losing their second", () => {
  const two = [{ id: "p1", ms: PAGE_MS }, { id: "p2", ms: PAGE_MS }, { id: "replay", ms: 3000 }];
  assert.equal(sceneAt(two, 400).b, null);
  assert.equal(sceneAt(two, PAGE_MS - FADE_MS / 2 + 1).b.index, 1);
  assert.equal(sceneAt(two, PAGE_MS + 500).a.index, 1);
});

test("no pages: the replay alone never fades", () => {
  assert.deepEqual(sceneAt([{ id: "replay", ms: 5000 }], 4900), { a: { index: 0, local: 4900 }, b: null, mix: 0 });
});

// The video's two card shapes, measured as the app draws them: one line each (1000 wide, ~64 high at 14 px text), or stacked (376 wide, ~180 high).
const shapes = [
  { columns: 1, w: 1000, h: 64 },
  { columns: 2, w: 376, h: 180 },
];
const fit = (aspect) => ({ minText: 14, gap: 14, ...aspect });
const FRAMES = {
  "16:9": { frameHeight: 720, roomWidth: 1248, roomHeight: 630 },
  "1.91:1": { frameHeight: 720, roomWidth: 1344, roomHeight: 630 },
  "9:16": { frameHeight: 1280, roomWidth: 688, roomHeight: 1160 },
  "4:5": { frameHeight: 900, roomWidth: 688, roomHeight: 780 },
};

test("cards: a wide frame takes the one-line card, a tall one the stacked card", () => {
  assert.equal(chooseCardLayout(shapes, fit(FRAMES["16:9"])).layout.columns, 1);
  assert.equal(chooseCardLayout(shapes, fit(FRAMES["1.91:1"])).layout.columns, 1);
  assert.equal(chooseCardLayout(shapes, fit(FRAMES["9:16"])).layout.columns, 2);
  assert.equal(chooseCardLayout(shapes, fit(FRAMES["4:5"])).layout.columns, 2);
});

test("pagination: at least three cards on a page in every aspect, with the text at 2% of the frame's height", () => {
  for (const [name, frame] of Object.entries(FRAMES)) {
    const pick = chooseCardLayout(shapes, fit(frame));
    assert.ok(pick.perPage >= 3, `${name}: ${pick.perPage} to a page`);
    assert.ok(14 * pick.scale >= frame.frameHeight * 0.02 - 1e-9, `${name}: text ${14 * pick.scale}`);
  }
});

test("pagination: pages flip until every unit is shown, in order, none twice", () => {
  const units = Array.from({ length: 23 }, (_, i) => `u${i}`);
  for (const frame of Object.values(FRAMES)) {
    const pick = chooseCardLayout(shapes, fit(frame));
    const pages = chunk(units, pick.perPage);
    assert.deepEqual(pages.flat(), units);
    assert.ok(pages.slice(0, -1).every((p) => p.length === pick.perPage));
  }
});

test("cards: when none reaches the legible size, the one drawn biggest wins", () => {
  const pick = chooseCardLayout(shapes, { minText: 14, gap: 14, frameHeight: 1280, roomWidth: 300, roomHeight: 1160 });
  assert.equal(pick.layout.columns, 2);
  assert.ok(pick.scale < (1280 * 0.02) / 14);
  assert.equal(chooseCardLayout([], fit(FRAMES["16:9"])), null);
});

test("cards: among shapes that read equally well, more cards to a page, then the wider", () => {
  const same = [{ columns: 1, w: 270, h: 300 }, { columns: 2, w: 527, h: 200 }];
  const pick = chooseCardLayout(same, { minText: 14, gap: 14, frameHeight: 720, roomWidth: 1248, roomHeight: 630 });
  assert.equal(pick.layout.columns, 2);
});

// --- The weapon or spell a card shows: the one used most in the battle ---

const use = (kind, name, times, weapon = null) => ({ kind, id: 1, name, times, spent: times, damage: 0, weapon });
const say = (unit, detail) => ({ t: 0, turn: 1, kind: "spell", text: "", unit, target: null, detail });

test("most used: the weapon or spell used in the most actions", () => {
  const usage = [use("weapon", "Iron Sword", 5, "sword"), use("spell", "Fire", 7, "reason"), use("art", "Wrath Strike", 9), use("item", "Vulnerary", 8)];
  assert.deepEqual(featuredWeapon(usage, [], "a", []), { kind: "spell", name: "Fire", weapon: "reason", times: 7 });
  assert.equal(featuredWeapon([use("weapon", "Iron Sword", 5, "sword"), use("weapon", "Iron Axe", 2)], [], "a", []).name, "Iron Sword");
});

test("most used: arts, items, Rallies and gambits never count, nor does a use of none", () => {
  assert.equal(featuredWeapon([use("art", "Wrath Strike", 4), use("item", "Vulnerary", 3), use("weapon", "Iron Sword", 0)], [], "a", []), null);
});

test("most used: a tie goes to the one the unit used last in the log", () => {
  const usage = [use("spell", "Fire", 3), use("spell", "Thunder", 3), use("weapon", "Iron Sword", 1)];
  const log = [say("a", "Thunder"), say("a", "Fire"), say("b", "Thunder")]; // b's Thunder is another unit's
  assert.equal(featuredWeapon(usage, log, "a", []).name, "Fire");
  assert.equal(featuredWeapon(usage, [say("a", "Fire"), say("a", "Thunder")], "a", []).name, "Thunder");
  // Nothing in the log to tell them apart: the game's order (most used first) stands.
  assert.equal(featuredWeapon(usage, [], "a", []).name, "Fire");
});

test("most used: no attacks in the battle falls back to the equipped weapon, or nothing", () => {
  const inventory = [
    { id: 1, name: "Vulnerary", kind: "item", uses: 3, full: 3 },
    { id: 2, name: "Iron Sword", kind: "weapon", uses: 30, full: 40, weapon: "sword" },
    { id: 3, name: "Steel Sword", kind: "weapon", uses: 25, full: 35, weapon: "sword", equipped: true },
  ];
  assert.deepEqual(featuredWeapon([], [], "a", inventory), { kind: "weapon", name: "Steel Sword", weapon: "sword", times: 0 });
  assert.equal(featuredWeapon(null, undefined, "a", inventory.slice(0, 2)).name, "Iron Sword");
  assert.equal(featuredWeapon(undefined, [], "a", [inventory[0]]), null);
  assert.equal(featuredWeapon(null, null, "a", null), null);
});
