import assert from "node:assert/strict";
import test from "node:test";
import { encodableCodec, encoderLatency, videoCodec, vp9Codec } from "../src/exporting/video.ts";

const MAC_APP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const WEBVIEW2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

test("Safari's engine encodes in realtime mode, where its quality mode never returns a frame", () => {
  assert.equal(encoderLatency(MAC_APP), "realtime");
  assert.equal(encoderLatency(SAFARI), "realtime");
});

test("Chromium engines (the Windows app's WebView2) keep quality mode", () => {
  assert.equal(encoderLatency(WEBVIEW2), "quality");
  assert.equal(encoderLatency(CHROME_MAC), "quality");
});

test("the H.264 level follows the frame size and rate", () => {
  assert.equal(videoCodec(1920, 1080, 30), "avc1.640028");
  assert.equal(videoCodec(1920, 1080, 60), "avc1.64002a");
  assert.equal(videoCodec(2560, 1440, 60), "avc1.640033");
  assert.equal(videoCodec(3840, 2160, 60), "avc1.640034");
});

test("the VP9 level follows the frame size and rate", () => {
  assert.equal(vp9Codec(1920, 1080, 30), "vp09.00.40.08");
  assert.equal(vp9Codec(1920, 1080, 60), "vp09.00.41.08");
  assert.equal(vp9Codec(3840, 2160, 30), "vp09.00.50.08");
  assert.equal(vp9Codec(3840, 2160, 60), "vp09.00.51.08");
});

test("video is H.264 where the window can encode it, else VP9 (Linux's QtWebEngine), else nothing", async () => {
  const before = globalThis.VideoEncoder;
  const asked = [];
  const only = (...prefixes) => {
    globalThis.VideoEncoder = { isConfigSupported: async ({ codec }) => {
      asked.push(codec.slice(0, 4));
      return { supported: prefixes.some((p) => codec.startsWith(p)) };
    } };
  };
  try {
    only("avc1", "vp09");
    assert.equal(await encodableCodec(1920, 1080, 30), "avc");
    assert.deepEqual(asked, ["avc1"]);
    only("vp09");
    assert.equal(await encodableCodec(1920, 1080, 30), "vp9");
    only();
    assert.equal(await encodableCodec(1920, 1080, 30), null);
    globalThis.VideoEncoder = { isConfigSupported: async () => { throw new TypeError("unknown codec"); } };
    assert.equal(await encodableCodec(1920, 1080, 30), null);
    delete globalThis.VideoEncoder;
    assert.equal(await encodableCodec(1920, 1080, 30), null);
  } finally {
    if (before) globalThis.VideoEncoder = before;
  }
});

test("only Safari's engine counts as Safari, though Chromium's user agents also name AppleWebKit", async () => {
  const { isSafariEngine } = await import("../src/exporting/engine.ts");
  assert.equal(isSafariEngine(MAC_APP), true);
  assert.equal(isSafariEngine(SAFARI), true);
  assert.equal(isSafariEngine(WEBVIEW2), false);
  assert.equal(isSafariEngine(CHROME_MAC), false);
});
