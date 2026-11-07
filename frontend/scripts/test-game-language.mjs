import assert from "node:assert/strict";
import { test } from "node:test";
import { gameLanguage, gameLanguageLocale } from "../src/gameLanguage.ts";

test("the companion displays English game text", () => {
  assert.equal(gameLanguage(), "ENG_U");
  assert.equal(gameLanguageLocale(), "en-US");
});
