import test from "node:test";
import assert from "node:assert/strict";
import { mixPiece, soundPlan } from "../src/exporting/soundtrack.ts";

// A theme of 10 samples at 1 Hz, looping samples 4 to 8 (4 long): the audio is its own index.
const audio = { sampleRate: 1, length: 10, duration: 10 };
const theme = { id: "a", file: "a.ogg", rate: 1, channels: 1, samples: 10, loop_start: 4, loop_length: 4 };
const input = [Array.from({ length: 10 }, (_, i) => i + 1)];
const render = (seconds, volume) => {
  const plan = soundPlan(theme, audio, seconds, volume);
  const out = [new Float32Array(plan.total)];
  mixPiece(input, out, 0, plan);
  return Array.from(out[0]);
};

test("the theme plays from its start, then round its loop", () => {
  assert.deepEqual(render(20, 1).slice(0, 14), [1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8, 5, 6]);
});

test("the end fades out to silence, from the volume set", () => {
  const out = render(9, 0.5); // fades over the last 2.5 s, from sample 6.5
  assert.equal(out[5], input[0][5] * 0.5);
  assert.ok(out[7] < out[6] && out[8] < out[7] && out[8] >= 0);
  assert.ok(Math.abs(out[8] - 5 * 0.5 * 0.4) < 1e-6); // the last sample (the loop's 5), 1.5 of the 2.5 s into the fade
});

test("a theme without a loop ends in silence", () => {
  const plan = soundPlan({ ...theme, loop_length: 0 }, audio, 12, 1);
  const out = [new Float32Array(plan.total)];
  mixPiece(input, out, 0, plan);
  assert.equal(out[0][9], 10);
  assert.deepEqual(Array.from(out[0].slice(10)), [0, 0]);
});

test("a piece in the middle is the same as that part of the whole", () => {
  const plan = soundPlan(theme, audio, 20, 0.8);
  const whole = [new Float32Array(plan.total)];
  mixPiece(input, whole, 0, plan);
  const piece = [new Float32Array(5)];
  mixPiece(input, piece, 7, plan);
  assert.deepEqual(Array.from(piece[0]), Array.from(whole[0].slice(7, 12)));
});
