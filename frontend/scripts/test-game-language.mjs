import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

test("language defaults, falls back, and notifies on switching without downloading text", async () => {
  let saved = "JP";
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    if (url === "/api/game-assets/status") return { ok: true, json: async () => ({ available: true, languages: ["ENG_U", "GER"] }) };
    if (options?.method === "PUT") saved = JSON.parse(options.body).game_language;
    return { ok: true, json: async () => ({ game_language: saved }) };
  };
  const source = await readFile(new URL("../src/gameLanguage.ts", import.meta.url), "utf8");
  const assetUrl = new URL("../src/gameAssets.ts", import.meta.url).href;
  const language = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source.replace('"./gameAssets"', JSON.stringify(assetUrl))))}`);
  assert.equal(language.gameLanguage(), "ENG_U");
  await language.loadGameLanguage();
  assert.equal(language.gameLanguage(), "ENG_U");
  let notifications = 0;
  const unsubscribe = language.onGameLanguageChange(() => notifications++);
  await language.setGameLanguage("GER");
  assert.equal(language.gameLanguage(), "GER");
  assert.equal(saved, "GER");
  assert.ok(notifications >= 1);
  assert.ok(requests.every((url) => !url.includes("/text/")));
  unsubscribe();
});
