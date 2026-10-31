import test from "node:test";
import assert from "node:assert/strict";
import { createStartupController } from "../src/startup.ts";
import { createBattleSync } from "../src/battleSync.ts";
import { subscribeToEvents } from "../src/eventStream.ts";
import { createUnitsLoader } from "../src/requestGate.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function battle(id, runId, active = false) {
  return { id, run_id: runId, active, ended_at: null, outlook: null };
}

function trackedBattleState() {
  const state = { battle: null, recording: null };
  return {
    state,
    update: {
      battle(value) { state.battle = value; },
      recording(value) { state.recording = value; },
    },
  };
}

test("startup failure stays visible and retry commits a successful bootstrap", async () => {
  const states = [];
  let calls = 0;
  let committed = false;
  const retry = deferred();
  const controller = createStartupController(async () => {
    calls++;
    if (calls === 1) throw new Error("settings unavailable");
    if (calls === 2) return retry.promise;
    return () => { committed = true; };
  }, (state) => states.push(state));

  await controller.retry();
  assert.deepEqual(states.at(-1), { loading: false, error: "settings unavailable" });
  const pendingRetry = controller.retry();
  assert.deepEqual(states.at(-1), { loading: true, error: "settings unavailable" });
  retry.resolve(() => { committed = true; });
  await pendingRetry;
  assert.equal(committed, true);
  assert.deepEqual(states.at(-1), { loading: false, error: null });
});

test("a run switch loads the new units and ignores an older run response", async () => {
  const runA = deferred();
  const runB = deferred();
  const state = [];
  const loader = createUnitsLoader((runId) => runId === "run-a" ? runA.promise : runB.promise, (units) => state.push(units));
  loader.setRun("run-a", true);
  const requestA = loader.load();
  loader.setRun("run-b", true);
  assert.deepEqual(state.at(-1), []);
  const requestB = loader.load();
  runB.resolve(["unit-b"]);
  await requestB;
  runA.resolve(["unit-a"]);
  await requestA;
  assert.deepEqual(state.at(-1), ["unit-b"]);
});

test("invalidated startup replies cannot overwrite a newer retry", async () => {
  const first = deferred();
  const second = deferred();
  const states = [];
  let calls = 0;
  let committed = "";
  const controller = createStartupController(() => (++calls === 1 ? first.promise : second.promise), (state) => states.push(state));
  const oldAttempt = controller.retry();
  controller.invalidate();
  const newAttempt = controller.retry();
  first.resolve(() => { committed = "old"; });
  await oldAttempt;
  assert.equal(committed, "");
  second.resolve(() => { committed = "new"; });
  await newAttempt;
  assert.equal(committed, "new");
});

test("a delayed recording cannot replace a live battle", async () => {
  const history = deferred();
  const live = deferred();
  const shown = trackedBattleState();
  const sync = createBattleSync({
    battles: () => history.promise,
    battle: () => live.promise,
  }, shown.update, { missing() {}, failed() {} });
  sync.setRun("run-a");
  const loadingHistory = sync.loadRecording("recording", "run-a");
  const loadingBattle = sync.loadBattle();
  live.resolve({ battle: battle("live", "run-a", true) });
  await loadingBattle;
  history.resolve([battle("recording", "run-a")]);
  await loadingHistory;
  assert.equal(shown.state.battle.id, "live");
  assert.equal(shown.state.recording, null);
});

test("run switches invalidate delayed live and recording replies", async () => {
  const oldBattle = deferred();
  const oldHistory = deferred();
  const shown = trackedBattleState();
  const sync = createBattleSync({
    battle: () => oldBattle.promise,
    battles: () => oldHistory.promise,
  }, shown.update, { missing() {}, failed() {} });
  sync.setRun("run-a");
  const oldLiveRequest = sync.loadBattle();
  const oldHistoryRequest = sync.loadRecording("old-recording", "run-a");
  sync.setRun("run-b");
  oldBattle.resolve({ battle: battle("battle-a", "run-a", true) });
  oldHistory.resolve([battle("old-recording", "run-a")]);
  await Promise.all([oldLiveRequest, oldHistoryRequest]);
  assert.equal(shown.state.battle, null);
  assert.equal(shown.state.recording, null);
});

test("deleted recordings are reported and cleared", async () => {
  let missing = 0;
  const shown = trackedBattleState();
  const sync = createBattleSync({
    battle: async () => ({ battle: null }),
    battles: async () => [],
  }, shown.update, { missing: () => missing++, failed() {} });
  sync.setRun("run-a");
  sync.openRecording(battle("deleted", "run-a"));
  await sync.loadRecording("deleted", "run-a");
  assert.equal(shown.state.recording, null);
  assert.equal(missing, 1);
});

test("recording request failure clears the selected stale recording", async () => {
  let failed = 0;
  const shown = trackedBattleState();
  const sync = createBattleSync({
    battle: async () => ({ battle: null }),
    battles: async () => { throw new Error("offline"); },
  }, shown.update, { missing() {}, failed: () => failed++ });
  sync.setRun("run-a");
  sync.openRecording(battle("selected", "run-a"));
  await sync.loadRecording("selected", "run-a");
  assert.equal(shown.state.recording, null);
  assert.equal(failed, 1);
});

class FakeEventSource {
  listeners = new Map();
  onopen = null;
  onerror = null;
  closed = false;
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  close() { this.closed = true; }
  emit(name, data) { this.listeners.get(name)?.({ data }); }
}

test("SSE parse and async failures are contained, reconnect stays native, and cleanup closes listeners", async () => {
  const source = new FakeEventSource();
  const errors = [];
  const connections = [];
  const received = [];
  const cleanup = subscribeToEvents(source, {
    scan: async (data) => {
      received.push(data);
      if (data.fail) throw new Error("handler failed");
    },
  }, (connected) => connections.push(connected), (error) => errors.push(error));

  source.onopen();
  source.emit("scan", "{");
  source.emit("scan", JSON.stringify({ fail: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 2);
  assert.deepEqual(received, [{ fail: true }]);
  source.onerror();
  assert.deepEqual(connections, [true, false]);
  assert.equal(source.closed, false);
  assert.equal(source.listeners.size, 7);
  cleanup();
  assert.equal(source.closed, true);
  assert.equal(source.listeners.size, 0);
});
