import type { Battle } from "./api";

export interface BattleApi {
  battle(): Promise<{ battle: Battle | null }>;
  battles(runId: string): Promise<Battle[]>;
}

export function createBattleSync(
  client: BattleApi,
  update: { battle(value: Battle | null): void; recording(value: Battle | null): void },
  notify: { missing(): void; failed(): void },
) {
  let liveRequest = 0;
  let recordingRequest = 0;
  let activeRunId: string | null = null;
  let battle: Battle | null = null;

  const setRun = (runId: string | null) => {
    if (activeRunId === runId) return;
    activeRunId = runId;
    liveRequest++;
    recordingRequest++;
    battle = null;
    update.battle(null);
    update.recording(null);
  };

  const loadRecording = async (id: string, runId: string) => {
    const request = ++recordingRequest;
    try {
      const history = await client.battles(runId);
      if (request !== recordingRequest || activeRunId !== runId || battle?.active) return;
      const found = history.find((item) => item.id === id) ?? null;
      update.recording(found);
      if (!found) notify.missing();
    } catch {
      if (request === recordingRequest && activeRunId === runId && !battle?.active) {
        update.recording(null);
        notify.failed();
      }
    }
  };

  const loadBattle = async () => {
    const request = ++liveRequest;
    try {
      const next = (await client.battle()).battle;
      if (request !== liveRequest || (next && activeRunId && next.run_id !== activeRunId)) return;
      const previous = battle;
      battle = next?.active ? next : null;
      update.battle(battle);
      if (next?.active) update.recording(null);
      else if (next && activeRunId === next.run_id) update.recording(next);
      else if (previous?.active) {
        update.recording({ ...previous, active: false, ended_at: previous.ended_at ?? new Date().toISOString(), outlook: null });
        void loadRecording(previous.id, previous.run_id);
      }
    } catch {
      // A temporary failure leaves the last live battle visible.
    }
  };

  const openRecording = (selected: Battle) => {
    if (battle?.active) return false;
    update.recording(selected);
    return true;
  };

  const clearRecording = () => {
    recordingRequest++;
    update.recording(null);
  };

  return { setRun, loadBattle, loadRecording, openRecording, clearRecording };
}
