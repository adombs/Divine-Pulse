import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed, importSteps } from "../src/components/game-files/progress.ts";

const job = (fields) => ({ state: "running", phase: "starting", done: 0, total: 8, error: null, ...fields });

test("an NSP import starts by unpacking, with the package and its file counts", () => {
  const view = importSteps(job({ source: "nsp", phase: "extracting", total: 0,
    step: { label: "Unpacking base.nsp (1 of 3)", done: 1200, total: 4500, current: "data.nca" } }));
  assert.deepEqual(view.steps, ["Unpack NSP files", "Import game data", "Check imported files"]);
  assert.equal(view.current, 0);
  assert.equal(view.detail, "Unpacking base.nsp (1 of 3)");
  assert.equal(view.done, 1200);
  assert.equal(view.total, 4500);
  assert.match(view.note, /^1,?200 of 4,?500 files · data\.nca$/);
});

test("before the extractor reports, unpacking has no count", () => {
  const view = importSteps(job({ source: "nsp", phase: "extracting", total: 0 }));
  assert.equal(view.detail, "Unpacking NSP files");
  assert.equal(view.total, 0);
  assert.equal(view.note, "");
});

test("importing names the part and counts the parts", () => {
  const view = importSteps(job({ source: "nsp", phase: "portraits", done: 3, files: 812 }));
  assert.equal(view.current, 1);
  assert.equal(view.detail, "Importing portraits (4 of 7)");
  assert.deepEqual([view.done, view.total], [3, 7]);
  assert.match(view.note, /^812 files written$/);
});

test("a dump folder import has no unpacking step", () => {
  assert.deepEqual(importSteps(job({ source: "dump" })).steps, ["Import game data", "Check imported files"]);
  assert.equal(importSteps(job({ source: "dump", phase: "music", done: 6 })).current, 0);
  assert.equal(importSteps(job({ source: "dump", phase: "music", done: 6 })).detail, "Importing music (7 of 7)");
  assert.equal(importSteps(job({ source: "dump", phase: "verify", done: 7 })).current, 1);
  assert.equal(importSteps(job({ phase: "starting" })).detail, "Getting ready");
});

test("elapsed time reads as a clock", () => {
  assert.equal(formatElapsed(5), "0:05");
  assert.equal(formatElapsed(192), "3:12");
  assert.equal(formatElapsed(3725), "1:02:05");
  assert.equal(formatElapsed(-3), "0:00");
});
