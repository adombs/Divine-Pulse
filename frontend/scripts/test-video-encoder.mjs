import assert from "node:assert/strict";
import test from "node:test";
import { encoderLatency, videoCodec } from "../src/exporting/video.ts";

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
