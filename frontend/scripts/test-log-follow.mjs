import assert from "node:assert/strict";
import test from "node:test";
import { atBottom, followsAfterScroll } from "../src/components/battle/logFollow.ts";

const at = (scrollTop, scrollHeight = 1000) => ({ scrollTop, clientHeight: 400, scrollHeight });

test("the bottom counts from a little above it, and a list too short to scroll is at it", () => {
  assert.equal(atBottom(at(600)), true);
  assert.equal(atBottom(at(580)), true);
  assert.equal(atBottom(at(500)), false);
  assert.equal(atBottom(at(0, 300)), true);
});

test("gliding down to a new row keeps following", () => {
  assert.equal(followsAfterScroll(true, 600, at(620, 1200)), true);
});

test("scrolling up to read stops following, and scrolling down part of the way doesn't start it", () => {
  assert.equal(followsAfterScroll(true, 600, at(400)), false);
  assert.equal(followsAfterScroll(false, 400, at(500)), false);
});

test("scrolling back to the bottom follows again", () => {
  assert.equal(followsAfterScroll(false, 500, at(600)), true);
});

test("a shorter list, which moves the scroll up with its bottom, keeps following", () => {
  assert.equal(followsAfterScroll(true, 600, at(400, 800)), true);
});
