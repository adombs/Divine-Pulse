import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { splitRules } = await vite.ssrLoadModule("/src/exporting/snapshot.ts");

test("a picture's styles keep a var() shorthand that a longhand overrides, as written", () => {
  // Chromium's cssText turns this rule into blank longhands (font-size: ;), which a picture would drop.
  const css = ".team-stats thead th { font: 600 0.82rem var(--display); line-height: 1.15; }";
  assert.deepEqual(splitRules(css), [css]);
});

test("rules split at their closing brace, nested blocks, strings and comments included", () => {
  const css = `/* a { b } */ :root { --x: "}"; }
@import url("a.css");
@media (max-width: 600px) { .a { color: red; } .b { content: '{'; } }
@font-face { font-family: X; src: url(x.woff2); }`;
  assert.deepEqual(splitRules(css), [
    ':root { --x: "}"; }',
    "@media (max-width: 600px) { .a { color: red; } .b { content: '{'; } }",
    "@font-face { font-family: X; src: url(x.woff2); }",
  ]);
});
