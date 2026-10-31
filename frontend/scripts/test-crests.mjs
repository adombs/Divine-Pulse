import assert from "node:assert/strict";
import { crestLabel, crestName } from "../src/reference/crests.ts";

for (const name of ["Mystery", "Major Mystery", "Minor Crest of Mystery", "Mystery Mystery", "Major Crest of Mystery Crest of Mystery"]) {
  assert.equal(crestName(name), "Mystery Crest");
  assert.equal(crestLabel(name, true), "Mystery Crest");
  assert.equal(crestLabel(name, false), "Mystery Crest");
}
assert.equal(crestName("Blaiddyd"), "Blaiddyd");
assert.equal(crestLabel("Blaiddyd", true), "Major Crest of Blaiddyd");
assert.equal(crestLabel("Seiros", false), "Minor Crest of Seiros");
