import { test } from "node:test";
import assert from "node:assert/strict";
import * as sources from "../src/components/gameImageSources.ts";
import { bundledPortrait, importedPortrait, importedMapImage, maskStyle } from "../src/components/gameImageSources.ts";
import { gameAssetsAvailable, loadGameAssetsStatus, onGameAssetsChange, gameAssetUrl } from "../src/gameAssets.ts";

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
    assert.deepEqual(seen, [true, false]);
    assert.equal(gameAssetsAvailable(), false);
  } finally { off(); globalThis.fetch = original; }
});

test("portrait keys resolve through the imported index", () => {
  assert.equal(importedPortrait(bundledPortrait("sample.png"), { app_keys: { sample: "images/portraits/sample.png" } }), "images/portraits/sample.png");
  assert.equal(importedPortrait(bundledPortrait("missing.png"), { app_keys: {} }), null);
});
