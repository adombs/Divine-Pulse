import test from "node:test";
import assert from "node:assert/strict";
import { cardsPerPage, chooseCardLayout, chunk, planColumns, FADE_MS, legibleScale, pageScale, paginateRows, sceneAt, sidesOf } from "../src/exporting/teamPages.ts";

const base = { minText: 14, frameHeight: 720, contentWidth: 520, roomWidth: 1248, minHeight: 190, roomHeight: 600 };

test("the smallest text is drawn at 2.4% of the frame's height where the room allows", () => {
  const k = pageScale(base);
  assert.ok(Math.abs(14 * k - 720 * 0.024) < 1e-9);
  // The same text in a 1080-high frame is 26 px at output size.
  assert.ok(Math.abs(pageScale({ ...base, frameHeight: 1080 }) * 14 - 25.92) < 1e-9);
});

test("legibleScale is the smallest text as a share of the frame's height", () => {
  assert.ok(Math.abs(legibleScale(10, 1000) - 2.4) < 1e-9);
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

test("rows are paged to the room, the header on each and the totals on the last page", () => {
  const rows = Array(7).fill(40);
  // capacity 200, header 30: 4 rows a page (30 + 160); the 3 left plus 50 of totals fit.
  assert.deepEqual(paginateRows(rows, 200, 30, 50), [[0, 1, 2, 3], [4, 5, 6]]);
  // Totals that would not fit give up the second half of the last rows to a page of their own, not one row alone.
  assert.deepEqual(paginateRows(Array(4).fill(40), 200, 30, 50), [[0, 1], [2, 3]]);
  assert.deepEqual(paginateRows(Array(5).fill(40), 230, 30, 50), [[0, 1], [2, 3, 4]]);
  assert.deepEqual(paginateRows([40], 10, 30, 50), [[0]]);
  assert.deepEqual(paginateRows([], 200, 30, 50), []);
  assert.deepEqual(paginateRows(rows, 200, 30, 50).flat(), [0, 1, 2, 3, 4, 5, 6]);
});

test("placements", () => {
  assert.deepEqual(sidesOf("start"), ["start"]);
  assert.deepEqual(sidesOf("end"), ["end"]);
  assert.deepEqual(sidesOf("both"), ["start", "end"]);
});

const segments = [{ id: "p1", ms: 4000 }, { id: "replay", ms: 10000 }, { id: "p2", ms: 4000 }];

test("the video shows one scene except right at the cuts", () => {
  assert.deepEqual(sceneAt(segments, 0), { a: { index: 0, local: 0 }, b: null, mix: 0 });
  assert.deepEqual(sceneAt(segments, 2000), { a: { index: 0, local: 2000 }, b: null, mix: 0 });
  assert.deepEqual(sceneAt(segments, 8000), { a: { index: 1, local: 4000 }, b: null, mix: 0 });
  assert.equal(sceneAt(segments, 18000).a.index, 2);
});

test("a crossfade straddles the cut: half of it either side, the replay's clock not skipped", () => {
  const before = sceneAt(segments, 4000 - FADE_MS / 2 + 1);
  assert.equal(before.a.index, 0);
  assert.equal(before.b.index, 1);
  assert.equal(before.b.local, 0);
  assert.ok(before.mix > 0 && before.mix < 0.01);
  const cut = sceneAt(segments, 4000);
  assert.ok(Math.abs(cut.mix - 0.5) < 1e-9);
  const after = sceneAt(segments, 4000 + FADE_MS / 2 - 1);
  assert.equal(after.a.index, 0);
  assert.equal(after.a.local, 4000);
  assert.equal(after.b.index, 1);
  assert.equal(after.b.local, FADE_MS / 2 - 1);
  assert.ok(after.mix > 0.99);
  // Past the fade, the replay is alone.
  assert.equal(sceneAt(segments, 4000 + FADE_MS / 2).b, null);
  // Out of the replay into the last page.
  const out = sceneAt(segments, 14000);
  assert.equal(out.a.index, 1);
  assert.equal(out.b.index, 2);
  assert.equal(out.a.local, 10000);
});

test("no pages: the replay alone never fades", () => {
  assert.deepEqual(sceneAt([{ id: "replay", ms: 5000 }], 4900), { a: { index: 0, local: 4900 }, b: null, mix: 0 });
});

const col = (id, w) => ({ id, w });
const groups = [
  { id: "combat", columns: [col("c0", 50), col("c1", 50), col("c2", 50), col("c3", 50)] },
  { id: "growth", columns: [col("g0", 60), col("g1", 60)] },
  { id: "records", columns: [col("score", 50), col("records", 150)] },
];

test("columns: everything on one page where it fits", () => {
  assert.deepEqual(planColumns(groups, 150, 800), [["c0", "c1", "c2", "c3", "g0", "g1", "score", "records"]]);
});

test("columns: groups stay whole and share a page where they fit", () => {
  // 150 for the unit leaves 250: Combat (200) alone; Growth (120) with nothing else of 130+; Records (200) next.
  assert.deepEqual(planColumns(groups, 150, 400), [["c0", "c1", "c2", "c3"], ["g0", "g1"], ["score", "records"]]);
  // 150 + 330: Combat and Growth (320) share a page; the Records (200) do not fit beside them.
  assert.deepEqual(planColumns(groups, 150, 480), [["c0", "c1", "c2", "c3", "g0", "g1"], ["score", "records"]]);
});

test("columns: a group too wide for a page is split evenly, never losing or repeating a column", () => {
  const pages = planColumns(groups, 150, 320); // 170 across
  assert.deepEqual(pages[0], ["c0", "c1", "c2"].slice(0, pages[0].length));
  assert.deepEqual(pages.flat(), ["c0", "c1", "c2", "c3", "g0", "g1", "score", "records"].filter((id) => pages.flat().includes(id)));
  assert.equal(new Set(pages.flat()).size, 8);
  const width = (ids) => ids.reduce((n, id) => n + groups.flatMap((g) => g.columns).find((c) => c.id === id).w, 0);
  for (const page of pages.slice(0, 3)) assert.ok(width(page) <= 170 || page.length === 1);
  // Combat's four columns of 50 over 170: two and two, not three and one.
  assert.deepEqual(pages.slice(0, 2), [["c0", "c1"], ["c2", "c3"]]);
});

test("columns: a column wider than the room still gets a page", () => {
  assert.deepEqual(planColumns([{ id: "r", columns: [col("records", 300)] }], 150, 200), [["records"]]);
  assert.deepEqual(planColumns([], 150, 200), []);
});

test("every page keeps the unit beside it: no page is wider than the room unless it is one column", () => {
  for (const maxW of [260, 300, 360, 420, 600]) {
    for (const page of planColumns(groups, 150, maxW)) {
      const w = page.reduce((n, id) => n + groups.flatMap((g) => g.columns).find((c) => c.id === id).w, 0);
      assert.ok(150 + w <= maxW || page.length === 1, `${maxW}: ${page}`);
    }
  }
});

const layouts = [
  { columns: 1, w: 270, h: 700 },
  { columns: 2, w: 527, h: 420 },
  { columns: 3, w: 790, h: 300 },
];
const room = { minText: 14, gap: 14 };

test("cards: a tall frame takes the narrow card, a wide one the wide card", () => {
  const tall = chooseCardLayout(layouts, { ...room, frameHeight: 1280, roomWidth: 688, roomHeight: 1100 });
  assert.equal(tall.layout.columns, 1);
  const wide = chooseCardLayout(layouts, { ...room, frameHeight: 720, roomWidth: 1248, roomHeight: 630 });
  assert.ok(wide.layout.columns >= 2);
  assert.ok(wide.scale >= 14 * 0 + (720 * 0.024) / 14 - 1e-9);
});

test("cards: when none reaches the legible size, the one drawn biggest wins", () => {
  // 1100 high holds a 700-high card at 1.57 (not the 2.2 wanted); the 420-high card is 688 / 527 = 1.3 wide at most.
  const pick = chooseCardLayout(layouts, { ...room, frameHeight: 1280, roomWidth: 688, roomHeight: 1100 });
  assert.equal(pick.layout.columns, 1);
  assert.ok(pick.scale > 1.3);
  assert.equal(chooseCardLayout([], { ...room, frameHeight: 720, roomWidth: 1000, roomHeight: 600 }), null);
});

test("cards: among layouts that read equally well, more cards to a page, then the wider", () => {
  const same = [{ columns: 1, w: 270, h: 300 }, { columns: 2, w: 527, h: 200 }];
  const pick = chooseCardLayout(same, { ...room, frameHeight: 720, roomWidth: 1248, roomHeight: 630 });
  assert.equal(pick.layout.columns, 2);
});
