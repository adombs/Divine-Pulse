import assert from "node:assert/strict";
import test from "node:test";

let moduleId = 0;
const load = async (saved) => {
  let value = saved;
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => value ?? null, setItem: (_, next) => { value = next; } };
  const store = await import(`../src/spoilers.ts?test=${moduleId++}`);
  return { store, saved: () => value, write: (next) => { value = next; } };
};

test("all categories start hidden, including malformed and legacy-looking values", async () => {
  for (const saved of [null, "invalid", "[]", '{"crests":"true","portraits":1}']) {
    const { store } = await load(saved);
    for (const category of Object.keys(store.SPOILER_CATEGORIES)) assert.equal(store.spoilerShown(category), false);
  }
});

test("revealing one category persists it without revealing others, and survives reload", async () => {
  const { store, saved } = await load(null);
  store.setSpoiler("crests", true);
  assert.equal(store.spoilerShown("crests"), true);
  assert.equal(store.spoilerShown("portraits"), false);
  const reloaded = await load(saved());
  assert.equal(reloaded.store.spoilerShown("crests"), true);
  reloaded.store.setSpoiler("crests", false);
  assert.equal((await load(reloaded.saved())).store.spoilerShown("crests"), false);
});

test("subscriptions update for reveals, other tabs and clearing preferences", async () => {
  const { store, write } = await load(null);
  let changes = 0;
  const unsubscribe = store.subscribeSpoilers(() => { changes += 1; });
  store.setSpoiler("recruitment", true);
  assert.equal(changes, 1);
  write('{"portraits":true}');
  const event = new Event("storage");
  event.key = "divine-pulse-spoilers";
  window.dispatchEvent(event);
  assert.equal(changes, 2);
  assert.equal(store.spoilerShown("portraits"), true);
  assert.equal(store.spoilerShown("recruitment"), false);
  write(null);
  event.key = null;
  window.dispatchEvent(event);
  assert.equal(store.spoilerShown("portraits"), false);
  unsubscribe();
  store.setSpoiler("supports", true);
  assert.equal(changes, 3);
});

test("blocked storage keeps session choices usable", async () => {
  const { store } = await load(null);
  globalThis.localStorage.setItem = () => { throw new Error("blocked"); };
  store.setSpoiler("identities", true);
  assert.equal(store.spoilerShown("identities"), true);
});

test("bulk choices persist and notify subscribers once", async () => {
  const { store, saved } = await load(null);
  let changes = 0;
  const unsubscribe = store.subscribeSpoilers(() => { changes += 1; });
  store.setAllSpoilers(true);
  assert.equal(changes, 1);
  for (const category of Object.keys(store.SPOILER_CATEGORIES)) assert.equal(store.spoilerShown(category), true);
  assert.deepEqual(JSON.parse(saved()), Object.fromEntries(Object.keys(store.SPOILER_CATEGORIES).map((key) => [key, true])));
  store.setAllSpoilers(false);
  assert.equal(changes, 2);
  for (const category of Object.keys(store.SPOILER_CATEGORIES)) assert.equal(store.spoilerShown(category), false);
  unsubscribe();
});
