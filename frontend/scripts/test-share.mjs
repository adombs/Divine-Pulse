import test from "node:test";
import assert from "node:assert/strict";
import { clampShare, LOW_SHARE, MID_SHARE, shareTone } from "../src/share.ts";

test("a share reads the same in a meter and on the map", () => {
  assert.equal(shareTone(0), "bad");
  assert.equal(shareTone(LOW_SHARE), "bad");
  // The meter rounded to a percentage first, so 30.4% was red there and amber on the map.
  assert.equal(shareTone(0.304), "warn");
  assert.equal(shareTone(MID_SHARE), "warn");
  assert.equal(shareTone(0.61), "good");
  assert.equal(shareTone(1.5), "good");
  assert.equal(shareTone(-1), "bad");
  assert.equal(clampShare(2), 1);
  assert.equal(clampShare(-0.2), 0);
});
