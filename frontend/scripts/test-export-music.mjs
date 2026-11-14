import test from "node:test";
import assert from "node:assert/strict";
import { addTrack, customPlan, mixPiece, soundPlan } from "../src/exporting/soundtrack.ts";

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

// --- The player's own audio ---

const mixCustom = (length, seconds, volume = 1) => {
  const plan = customPlan({ sampleRate: 1, length }, seconds, volume);
  const out = [new Float32Array(plan.total)];
  mixPiece([Array.from({ length }, (_, i) => i + 1)], out, 0, plan);
  return Array.from(out[0]);
};

test("your own audio shorter than the video loops from its start", () => {
  assert.deepEqual(mixCustom(4, 12).slice(0, 9), [1, 2, 3, 4, 1, 2, 3, 4, 1]);
});

test("your own audio longer than the video is cut at the video's end, with a one second fade-out", () => {
  const out = mixCustom(100, 10);
  assert.equal(out.length, 10);
  assert.deepEqual(out.slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(customPlan({ sampleRate: 1, length: 100 }, 10, 1).fadeStart, 9);
});

test("your own audio follows the volume set, and a very short video still fades", () => {
  assert.equal(mixCustom(4, 3, 0.5)[0], 0.5);
  const plan = customPlan({ sampleRate: 1, length: 4 }, 2, 1);
  assert.ok(plan.fadeStart < 2 && plan.fadeStart > 0);
});

test("the fade-out takes the last second to reach silence", () => {
  const plan = customPlan({ sampleRate: 10, length: 1000 }, 4, 1);
  const out = [new Float32Array(plan.total)];
  mixPiece([new Float32Array(1000).fill(1)], out, 0, plan);
  assert.equal(out[0][29], 1);
  assert.ok(out[0][35] < 0.6 && out[0][35] > 0.4);
  assert.ok(out[0][39] < 0.2);
});

test("music and uploaded audio mix with independent volume and looping", () => {
  const music = [new Float32Array(6)];
  const own = [new Float32Array(6)];
  mixPiece([[1, 1, 1, 1]], music, 0, customPlan({ sampleRate: 1, length: 4 }, 6, 0.25));
  mixPiece([[1, 0]], own, 0, customPlan({ sampleRate: 1, length: 2 }, 6, 0.5));
  addTrack(music, own);
  assert.deepEqual(Array.from(music[0].slice(0, 4)), [0.75, 0.25, 0.75, 0.25]);
});
