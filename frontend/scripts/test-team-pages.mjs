import test from "node:test";
import assert from "node:assert/strict";
import { chunk, FADE_MS, fmtSeconds, LEGIBLE_FRACTION, legibleScale, MAX_COLUMNS, MAX_ROWS, PAGE_MS, PAGE_SECONDS, PLACEMENTS, planGrid, sanitizeSeconds, sceneAt, sidesOf } from "../src/exporting/teamPages.ts";
import { cardSlots, equippedAccessory, gambitUses, gearName, LIST_SLOTS, usageList } from "../src/exporting/usageList.ts";

test("the smallest text is 2.0% of the frame's short side", () => {
  assert.equal(LEGIBLE_FRACTION, 0.02);
  // 22 px text in a 1080 frame is already legible; 14 px must be drawn 1.54 times bigger.
  assert.ok(Math.abs(legibleScale(22, 1080) - 21.6 / 22) < 1e-9);
  assert.ok(Math.abs(legibleScale(14, 1080) - 21.6 / 14) < 1e-9);
  assert.ok(Math.abs(legibleScale(10, 1000) - 2.0) < 1e-9);
  assert.equal(legibleScale(0, 1000), 1);
});

test("chunk splits in order and covers everything", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
});

test("placements", () => {
  assert.deepEqual(sidesOf("start"), ["start"]);
  assert.deepEqual(sidesOf("end"), ["end"]);
  assert.deepEqual(PLACEMENTS.map(([p]) => p), ["start", "end"]);
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

// A compact card at its natural size: 460 wide, about 310 high, its smallest text 22 px.
const card = { w: 460, h: 310 };
const FRAMES = {
  "16:9": { frameShortSide: 720, roomWidth: 1248, roomHeight: 630 },
  "1.91:1": { frameShortSide: 720, roomWidth: 1344, roomHeight: 630 },
  "9:16": { frameShortSide: 720, roomWidth: 688, roomHeight: 1160 },
  "4:5": { frameShortSide: 720, roomWidth: 688, roomHeight: 780 },
};
const plan = (frame, o = {}) => planGrid({ minText: 22, gap: 8, card, columns: null, rows: null, count: 40, ...frame, ...o });
const floor = legibleScale(22, 720);

test("grid: Auto and Auto holds as many cards as keep the text legible, in every aspect", () => {
  for (const [name, frame] of Object.entries(FRAMES)) {
    const g = plan(frame);
    assert.ok(g.scale >= floor - 1e-9 && !g.small, `${name}: scale ${g.scale}`);
    assert.equal(g.perPage, g.columns * g.rows);
    // One more column or row would no longer be legible.
    const more = [plan(frame, { columns: g.columns + 1, rows: g.rows }), plan(frame, { columns: g.columns, rows: g.rows + 1 })];
    assert.ok(more.every((m) => m.small), `${name}: ${g.columns} x ${g.rows} is not the most`);
  }
  assert.ok(plan(FRAMES["9:16"]).rows > plan(FRAMES["16:9"]).rows, "a tall frame has more rows");
  assert.ok(plan(FRAMES["16:9"]).columns > plan(FRAMES["9:16"]).columns, "a wide frame has more columns");
});

test("grid: the 460 x 310 card fits 4 x 3 in a 16:9 frame and 2 x 5 in a 9:16 one, drawn at its natural size or a little under", () => {
  const wide = plan(FRAMES["16:9"]);
  assert.deepEqual([wide.columns, wide.rows], [4, 3]);
  const tall = plan(FRAMES["9:16"]);
  assert.deepEqual([tall.columns, tall.rows], [2, 5]);
  // Spare room goes around the cards, never into them: a card is never drawn bigger than its cell allows in either direction.
  for (const g of [wide, tall]) assert.ok(g.cellW >= card.w - 1e-6 && g.cellH >= card.h - 1e-6);
});

test("grid: the smallest text is at least 2.0% of the short side at Auto, 22 px at 1080p either way up", () => {
  for (const frame of Object.values(FRAMES)) assert.ok(22 * plan(frame).scale >= frame.frameShortSide * 0.02 - 1e-9);
  const g = plan({ frameShortSide: 1080, roomWidth: 1888, roomHeight: 888 });
  assert.ok(22 * g.scale >= 21.6 - 1e-9);
});

test("grid: a fixed axis overrides Auto and the other axis fills what fits", () => {
  const frame = FRAMES["16:9"];
  const two = plan(frame, { columns: 2 });
  assert.equal(two.columns, 2);
  assert.ok(two.rows >= 1 && two.scale >= floor - 1e-9);
  const rows3 = plan(FRAMES["9:16"], { rows: 3 });
  assert.equal(rows3.rows, 3);
  assert.ok(rows3.columns >= 1 && !rows3.small);
  assert.equal(plan(frame, { columns: 3, rows: 2 }).perPage, 6);
});

test("grid: fixed values that push the text below the floor are kept, drawn to fit, and flagged small", () => {
  const g = plan(FRAMES["16:9"], { columns: 6, rows: 5 });
  assert.equal(g.columns, 6);
  assert.equal(g.rows, 5);
  assert.ok(g.small);
  assert.ok(g.scale < floor);
  // It still fits the room: the grid drawn at that scale is no bigger than the room.
  assert.ok(g.width * g.scale <= FRAMES["16:9"].roomWidth + 1e-6 && g.height * g.scale <= FRAMES["16:9"].roomHeight + 1e-6);
  assert.ok(g.cellW >= card.w - 1e-6 && g.cellH >= card.h - 1e-6, "every card has at least its natural size");
  assert.ok(!plan(FRAMES["16:9"], { columns: 3, rows: 1 }).small);
});

test("grid: few units take the layout that draws them biggest, not the most empty cells", () => {
  const frame = FRAMES["16:9"];
  const all = plan(frame);
  const some = plan(frame, { count: 2 });
  assert.ok(some.perPage >= 2 && some.perPage < all.perPage);
  assert.ok(some.scale > all.scale);
  assert.equal(plan(frame, { count: 1 }).perPage, 1);
});

test("grid: columns and rows are bounded by what the Team tab offers, and a room too small for a card is still one", () => {
  assert.equal(MAX_COLUMNS, 6);
  assert.equal(MAX_ROWS, 8);
  const g = plan({ frameShortSide: 720, roomWidth: 200, roomHeight: 100 });
  assert.equal(g.perPage, 1);
  assert.ok(g.small);
  assert.equal(planGrid({ minText: 22, frameShortSide: 720, card, roomWidth: 0, roomHeight: 100, gap: 8, columns: null, rows: null, count: 3 }), null);
  const big = plan({ frameShortSide: 4000, roomWidth: 50000, roomHeight: 50000 });
  assert.ok(big.columns <= MAX_COLUMNS && big.rows <= MAX_ROWS);
});

test("pagination: pages flip until every unit is shown, in order, none twice", () => {
  const units = Array.from({ length: 23 }, (_, i) => `u${i}`);
  for (const frame of Object.values(FRAMES)) {
    const g = plan(frame, { count: units.length });
    const pages = chunk(units, g.perPage);
    assert.deepEqual(pages.flat(), units);
    assert.ok(pages.slice(0, -1).every((p) => p.length === g.perPage));
  }
  // The page count follows the grid: fewer cards to a page, more pages.
  assert.ok(chunk(units, plan(FRAMES["16:9"], { columns: 1, rows: 1 }).perPage).length > chunk(units, plan(FRAMES["16:9"]).perPage).length);
});

// --- What a card lists: what the unit used in the battle ---

const use = (kind, name, times, weapon = null) => ({ kind, id: 1, name, times, spent: times, damage: 0, weapon });
const say = (unit, detail) => ({ t: 0, turn: 1, kind: "spell", text: "", unit, target: null, detail });

test("usage list: every weapon, spell and art used, the most used first", () => {
  const usage = [use("weapon", "Iron Sword", 5, "sword"), use("spell", "Fire", 7, "reason"), use("art", "Wrath Strike", 9), use("item", "Vulnerary", 8), use("gambit", "Fire Emblem", 2), use("rally", "Rally Strength", 3)];
  assert.deepEqual(usageList(usage, [], "a").map((u) => [u.kind, u.name, u.times]), [["art", "Wrath Strike", 9], ["spell", "Fire", 7], ["weapon", "Iron Sword", 5]]);
  assert.deepEqual(usageList(usage, [], "a")[1], { kind: "spell", name: "Fire", weapon: "reason", times: 7 });
});

test("usage list: only what was used in this battle", () => {
  assert.deepEqual(usageList([use("weapon", "Iron Sword", 0), use("art", "Smite", 0)], [], "a"), []);
  assert.deepEqual(usageList(null, [], "a"), []);
  assert.deepEqual(usageList(undefined, undefined, "a"), []);
  assert.deepEqual(usageList([use("item", "Vulnerary", 3), use("rally", "Rally", 1)], [], "a"), []);
});

test("usage list: a tie goes to the one the unit used last in the log, else the record's order", () => {
  const usage = [use("spell", "Fire", 3), use("art", "Smite", 3), use("weapon", "Iron Sword", 3), use("weapon", "Iron Axe", 1)];
  const log = [say("a", "Smite"), say("a", "Fire"), say("b", "Smite")]; // b's Smite is another unit's
  assert.deepEqual(usageList(usage, log, "a").map((u) => u.name), ["Fire", "Smite", "Iron Sword", "Iron Axe"]);
  assert.deepEqual(usageList(usage, [say("a", "Fire"), say("a", "Smite")], "a").map((u) => u.name), ["Smite", "Fire", "Iron Sword", "Iron Axe"]);
  // Nothing in the log to tell them apart: the record's own order stands.
  assert.deepEqual(usageList(usage, [], "a").map((u) => u.name), ["Fire", "Smite", "Iron Sword", "Iron Axe"]);
});

test("gambit uses: the count when the record has one, else none", () => {
  assert.equal(gambitUses([use("gambit", "Fire Emblem", 2), use("weapon", "Iron Sword", 4)]), 2);
  assert.equal(gambitUses([use("gambit", "Fire Emblem", 1), use("gambit", "Other", 2)]), 3);
  assert.equal(gambitUses([use("weapon", "Iron Sword", 4)]), null);
  assert.equal(gambitUses(null), null);
});

test("battalion: the battle's own record, else the roster's, blank is none", () => {
  assert.equal(gearName("Corps", "Old"), "Corps");
  assert.equal(gearName(null, "Corps"), "Corps");
  assert.equal(gearName(undefined, undefined), null);
  assert.equal(gearName("", "Old battalion"), null);
  assert.equal(gearName(null, "  "), null);
});

test("equipped accessory: only the equipped one, never a carried spare", () => {
  const two = [{ name: "Shield A", kind: "equipment" }, { name: "Shield B", kind: "equipment", equipped: true }];
  assert.equal(equippedAccessory(two, "Shield A", "Shield A"), "Shield B");
  // No mark: the roster's equipped accessory stands over the battle's first-carried guess.
  assert.equal(equippedAccessory([{ name: "A", kind: "equipment" }, { name: "B", kind: "equipment" }], "A", "B"), "B");
  // Two carried, none marked, no roster: unknown, so none rather than a guess.
  assert.equal(equippedAccessory([{ name: "A", kind: "equipment" }, { name: "B", kind: "equipment" }], "A", null), null);
  // One carried, unmarked: it is the one.
  assert.equal(equippedAccessory([{ name: "A", kind: "equipment" }], "A", null), "A");
  assert.equal(equippedAccessory(undefined, null, null), null);
});

// --- The card's ten list slots ---

const used = (n) => Array.from({ length: n }, (_, i) => ({ kind: "weapon", name: `W${i}`, weapon: "sword", times: 20 - i }));
const gearOf = (n, accessory = null, battalion = null) => ({ used: used(n), accessory, battalion, gambits: battalion ? 2 : null });
const types = (g) => cardSlots(g).map((s) => s.type);

test("card slots: always exactly ten, whatever the unit has", () => {
  assert.equal(LIST_SLOTS, 10);
  for (const g of [gearOf(0), gearOf(1), gearOf(10), gearOf(12, "Ring", "Corps"), gearOf(3, "Ring"), gearOf(40, "Ring", "Corps")]) assert.equal(cardSlots(g).length, 10);
});

test("card slots: the top row is the item then the battalion, always there", () => {
  assert.deepEqual(types(gearOf(2, "Ring", "Corps")), ["accessory", "battalion", "used", "used", ...Array(6).fill("empty")]);
  assert.deepEqual(types(gearOf(0)), ["accessory", "battalion", ...Array(8).fill("empty")]);
  assert.deepEqual(cardSlots(gearOf(0)).slice(0, 2), [{ type: "accessory", name: null }, { type: "battalion", name: null, gambits: null }]);
  assert.deepEqual(cardSlots(gearOf(1, null, "Seiros Magic Corps"))[1], { type: "battalion", name: "Seiros Magic Corps", gambits: 2 });
});

test("card slots: eight used fill the rows above", () => {
  assert.deepEqual(types(gearOf(8, "Ring", "Corps")), ["accessory", "battalion", ...Array(8).fill("used")]);
});

test("card slots: more than eight turns the eighth into '+N more' (counting the entry it replaces)", () => {
  const s = cardSlots(gearOf(10, "Ring", "Corps"));
  assert.deepEqual(s.map((x) => x.type), ["accessory", "battalion", ...Array(7).fill("used"), "more"]);
  assert.deepEqual(s[9], { type: "more", count: 3 });
  assert.deepEqual(s.slice(2, 9).map((x) => x.item.name), ["W0", "W1", "W2", "W3", "W4", "W5", "W6"]);
  assert.deepEqual(cardSlots(gearOf(9))[9], { type: "more", count: 2 });
  assert.deepEqual(cardSlots(gearOf(9, "Ring"))[0], { type: "accessory", name: "Ring" });
});

test("a page's length is one of the offered seconds, each long enough for its crossfade", () => {
  assert.ok(PAGE_SECONDS.includes(PAGE_MS / 1000));
  assert.ok(PAGE_SECONDS.every((s, i) => s * 1000 > FADE_MS && (i === 0 || s > PAGE_SECONDS[i - 1])));
  assert.equal(sanitizeSeconds(2.5, 1), 2.5);
  assert.equal(sanitizeSeconds(2.7, 1), 1);
  assert.equal(sanitizeSeconds("3", 1), 1);
  assert.equal(sanitizeSeconds(undefined, null), null);
  assert.equal(fmtSeconds(1.5), (1.5).toLocaleString() + " s");
  // Longer pages push the replay back: the scene at a moment follows the lengths given.
  const long = [{ id: "p1", ms: 3000 }, { id: "replay", ms: 4000 }];
  assert.equal(sceneAt(long, 2000).a.index, 0);
  assert.equal(sceneAt(long, 3500).a.index, 1);
});
