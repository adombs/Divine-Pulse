import assert from "node:assert/strict";
import test from "node:test";
import { altKeyName, detectPlatform, historyButtonStep, historyKeyStep, isMacAppWindow, isSafariEngine, keyLabel } from "../src/platform.ts";

const WEBVIEW2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";
const WKWEBVIEW = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

test("the platform comes from the browser's own report", () => {
  assert.equal(detectPlatform({ platform: "MacIntel", userAgent: WKWEBVIEW }), "macos");
  assert.equal(detectPlatform({ platform: "", userAgent: SAFARI }), "macos");
  assert.equal(detectPlatform({ platform: "Win32", userAgent: WEBVIEW2 }), "windows");
  assert.equal(detectPlatform({}), "windows");
  // Linux's WebKitGTK and Qt web views (pywebview's renderers there).
  assert.equal(detectPlatform({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)" }), "linux");
  assert.equal(detectPlatform({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.140.0 Chrome/140.0.0.0 Safari/537.36" }), "linux");
});

test("only the macOS app's window is Safari's engine without Safari's Back menu", () => {
  assert.equal(isSafariEngine(WKWEBVIEW), true);
  assert.equal(isSafariEngine(SAFARI), true);
  assert.equal(isSafariEngine(WEBVIEW2), false);
  assert.equal(isSafariEngine(CHROME_MAC), false);
  assert.equal(isSafariEngine("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.140.0 Chrome/140.0.0.0 Safari/537.36"), false);
  assert.equal(isMacAppWindow(WKWEBVIEW), true);
  assert.equal(isMacAppWindow(SAFARI), false);
  assert.equal(isMacAppWindow(WEBVIEW2), false);
  assert.equal(isMacAppWindow(CHROME_MAC), false);
});

test("shortcuts are written the platform's way", () => {
  assert.equal(keyLabel(["Alt", "←"], false), "Alt+←");
  assert.equal(keyLabel(["Alt", "←"], true), "⌥←");
  assert.equal(keyLabel(["Cmd", "["], true), "⌘[");
  assert.equal(keyLabel(["Ctrl", "Shift", "S"], true), "⌃⇧S");
  assert.equal(altKeyName(true), "Option");
  assert.equal(altKeyName(false), "Alt");
});

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test("⌘[ and ⌘] step through history; other keys and modifiers don't", () => {
  assert.equal(historyKeyStep(key("[", { metaKey: true })), -1);
  assert.equal(historyKeyStep(key("]", { metaKey: true })), 1);
  assert.equal(historyKeyStep(key("[")), null);
  assert.equal(historyKeyStep(key("[", { ctrlKey: true })), null);
  assert.equal(historyKeyStep(key("[", { metaKey: true, shiftKey: true })), null);
  assert.equal(historyKeyStep(key("[", { metaKey: true, altKey: true })), null);
  assert.equal(historyKeyStep(key("f", { metaKey: true })), null);
});

test("the mouse's back and forward buttons step through history", () => {
  assert.equal(historyButtonStep(3), -1);
  assert.equal(historyButtonStep(4), 1);
  for (const b of [0, 1, 2]) assert.equal(historyButtonStep(b), null);
});
