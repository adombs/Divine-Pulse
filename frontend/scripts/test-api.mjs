import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, errorDetail, UNREACHABLE } from "../src/api.ts";

async function withFetch(fake, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = original; }
}

const reply = (status, body, statusText = "") => async () => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
});

test("errorDetail reads the server's detail, FastAPI's validation list, then the status", () => {
  assert.equal(errorDetail({ detail: "Run not found" }, 404, "Not Found"), "Run not found");
  assert.equal(errorDetail({ detail: [{ msg: "Field required" }, { msg: "Too long" }] }, 422, ""), "Field required; Too long");
  // A JSON reply without a detail used to give an empty message.
  assert.equal(errorDetail({ error: "x" }, 500, "Internal Server Error"), "Internal Server Error");
  assert.equal(errorDetail(null, 502, ""), "Request failed (502)");
  assert.equal(errorDetail({ detail: "" }, 400, "Bad Request"), "Bad Request");
});

test("a tracker that can't be reached reads the same on WebView2 and WKWebView", async () => {
  for (const engineMessage of ["Failed to fetch", "Load failed"]) {
    await withFetch(async () => { throw new TypeError(engineMessage); }, async () => {
      await assert.rejects(api.runs(), (error) => error instanceof ApiError && error.message === UNREACHABLE && error.status === undefined);
    });
  }
});

test("failed replies carry the status; empty successes are null; missing game assets say so", async () => {
  await withFetch(reply(409, { detail: "A run with that name exists" }, "Conflict"), async () => {
    await assert.rejects(api.createRun("x"), (error) => error instanceof ApiError && error.status === 409 && error.message === "A run with that name exists");
  });
  await withFetch(reply(500, "<html>oops</html>", "Internal Server Error"), async () => {
    await assert.rejects(api.runs(), { message: "Internal Server Error" });
  });
  await withFetch(reply(404, { detail: "nope" }, "Not Found"), async () => {
    await assert.rejects(api.gameFilesStatus(), { message: "Not available" });
  });
  await withFetch(reply(204, undefined), async () => {
    assert.equal(await api.deleteRun("a"), null);
  });
});
