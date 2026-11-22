import { test } from "node:test";
import assert from "node:assert/strict";
import * as sources from "../src/components/gameImageSources.ts";
import { bundledPortrait, importedPortrait, importedMapImage, maskStyle } from "../src/components/gameImageSources.ts";
import { gameAssetsAvailable, loadGameAssetsStatus, onGameAssetsChange, gameAssetUrl } from "../src/gameAssets.ts";
import { gameAssetsChanged, loadGameJson, loadGameText } from "../src/gameAssets.ts";
import { assertAssetPath, assetIssues, clearAssetIssues, onAssetIssuesChange } from "../src/requiredAssets.ts";

test("images have no bundled fallback", () => {
  assert.equal("imageSources" in sources, false);
  assert.deepEqual(maskStyle(""), {});
  assert.deepEqual(maskStyle("/game-assets/a.png"), { maskImage: "url(/game-assets/a.png)", WebkitMaskImage: "url(/game-assets/a.png)" });
});

test("availability toggles candidates and notifies subscribers", async () => {
  const original = globalThis.fetch;
  let available = false;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ available }) });
  const seen = [];
  const off = onGameAssetsChange((status) => seen.push(status.available));
  try {
    await loadGameAssetsStatus(true);
    assert.equal(gameAssetsAvailable(), false);
    available = true;
    await loadGameAssetsStatus(true);
    assert.equal(gameAssetsAvailable(), true);
    assert.equal(gameAssetUrl("a.png"), "/game-assets/a.png");
    available = false;
    await loadGameAssetsStatus(true);
    assert.deepEqual(seen, [false, true, false]); // Explicit refresh also retries pending/failed asset consumers.
    assert.equal(gameAssetsAvailable(), false);
  } finally { off(); globalThis.fetch = original; }
});

test("an older status reply that lands after a newer one doesn't overwrite it", async () => {
  const original = globalThis.fetch;
  const replies = [];
  globalThis.fetch = () => new Promise((resolve) => replies.push(resolve));
  const reply = (i, available) => replies[i]({ ok: true, json: async () => ({ available }) });
  try {
    const older = loadGameAssetsStatus(true);
    const newer = loadGameAssetsStatus(true);
    reply(1, true);
    assert.equal((await newer).available, true);
    reply(0, false);
    assert.equal((await older).available, true, "the older request resolves to the newer answer");
    assert.equal(gameAssetsAvailable(), true);
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ available: false }) });
    await loadGameAssetsStatus(true);
    globalThis.fetch = original;
  }
});

test("only a finished import or removed files count as a change of the game files", () => {
  assert.equal(gameAssetsChanged({ available: true, job: { state: "running" } }), false);
  assert.equal(gameAssetsChanged({ available: false, job: { state: "running" } }), false);
  assert.equal(gameAssetsChanged({ available: true, job: { state: "done" } }), true);
  assert.equal(gameAssetsChanged({ available: false, job: { state: "idle" } }), true);
  assert.equal(gameAssetsChanged({ available: true, job: { state: "failed" } }), false);
  assert.equal(gameAssetsChanged(null), false);
});

test("portrait keys resolve through the imported index", () => {
  assert.equal(importedPortrait(bundledPortrait("sample.png"), { app_keys: { sample: "images/portraits/sample.png" } }), "images/portraits/sample.png");
  assert.equal(importedPortrait(bundledPortrait("missing.png"), { app_keys: {} }), null);
});

test("asset paths reject traversal and absolute paths instead of requesting unrelated files", () => {
  for (const path of ['', '../image.png', '/image.png', 'a/../b', 'a\\b', 'C:/image.png', 'a//b']) {
    assert.throws(() => assertAssetPath(path), /Invalid game asset path/);
  }
  assert.equal(gameAssetUrl('images/a file.png'), '/game-assets/images/a%20file.png');
});

test("missing required JSON is an explicit issue and refreshing the import permits recovery", async () => {
  const original = globalThis.fetch;
  let repaired = false;
  globalThis.fetch = async (url) => url === '/api/game-assets/status'
    ? { ok: true, json: async () => ({ available: true, created: 'test-import' }) }
    : repaired ? { ok: true, json: async () => ({ rows: [1] }) } : { ok: false, status: 404 };
  let notifications = 0;
  const off = onAssetIssuesChange(() => notifications++);
  try {
    await loadGameAssetsStatus(true);
    assert.equal(await loadGameJson('data/required.json'), null);
    assert.deepEqual(assetIssues().map(({ path, reason }) => ({ path, reason })), [{ path: 'data/required.json', reason: 'missing' }]);
    repaired = true;
    await loadGameAssetsStatus(true);
    assert.deepEqual(await loadGameJson('data/required.json'), { rows: [1] });
    assert.equal(assetIssues().length, 0);
    assert.ok(notifications >= 2);
  } finally { off(); clearAssetIssues(); globalThis.fetch = original; }
});

test("requested text categories reject malformed or absent data and accept valid empty categories", async () => {
  const original = globalThis.fetch;
  let categories = {};
  globalThis.fetch = async (url) => ({ ok: true, json: async () => url === '/api/game-assets/status'
    ? { available: true } : { categories } });
  try {
    for (const invalid of [{}, { item: [] }, { item: { '1': null } }, { item: { unknown: 'Name' } }]) {
      categories = invalid;
      await loadGameAssetsStatus(true);
      await assert.rejects(loadGameText('item'), /Missing or invalid text category item/);
    }
    categories = { item: {} };
    await loadGameAssetsStatus(true);
    assert.deepEqual(await loadGameText('item'), {});
  } finally { clearAssetIssues(); globalThis.fetch = original; }
});

test("an imported JSON file with a non-object root is unreadable, never a successful empty reference", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => url === '/api/game-assets/status'
    ? { available: true } : [] });
  try {
    await loadGameAssetsStatus(true);
    assert.equal(await loadGameJson('data/items.json'), null);
    assert.ok(assetIssues().some((issue) => issue.path === 'data/items.json' && issue.reason === 'unreadable'));
  } finally { clearAssetIssues(); globalThis.fetch = original; }
});
