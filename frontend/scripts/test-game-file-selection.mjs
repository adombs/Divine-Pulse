import assert from "node:assert/strict";
import test from "node:test";
import { mergeNspPaths } from "../src/components/game-files/selection.ts";

test("browsing another folder keeps earlier NSP files in order", () => {
  const base = mergeNspPaths([], ["C:\\Games\\base.nsp"]);
  const withUpdate = mergeNspPaths(base, ["D:\\Updates\\update.nsp", "E:\\DLC\\extra.nsp"]);
  assert.deepEqual(withUpdate, ["C:\\Games\\base.nsp", "D:\\Updates\\update.nsp", "E:\\DLC\\extra.nsp"]);
  assert.deepEqual(base, ["C:\\Games\\base.nsp"]);
});

test("duplicate Windows paths keep the first selection, including manual paths", () => {
  assert.deepEqual(mergeNspPaths(["C:\\Games\\base.nsp"], ["c:/games/BASE.nsp", "  \"D:\\Updates\\update.nsp\"  ", "D:/Updates/update.nsp", "", "  "]), ["C:\\Games\\base.nsp", "D:\\Updates\\update.nsp"]);
});

test("cancelling the picker preserves selection and removed files can be added again", () => {
  const selected = ["C:\\Games\\base.nsp", "D:\\Updates\\update.nsp"];
  assert.deepEqual(mergeNspPaths(selected, []), selected);
  const removed = selected.filter((path) => path !== "C:\\Games\\base.nsp");
  assert.deepEqual(mergeNspPaths(removed, ["C:\\Games\\base.nsp"]), ["D:\\Updates\\update.nsp", "C:\\Games\\base.nsp"]);
});
