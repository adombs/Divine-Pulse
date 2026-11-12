// The active run's repeated one-time battles, shared by every page header (the warning button) and the app (events).
import { useSyncExternalStore } from "react";
import { api, DuplicateGroup, DuplicateGroups } from "./api";

export { defaultKeep, discardFor } from "./duplicateChoice";

/** The `duplicate_battles` server event: a repeat was resolved automatically. */
export interface DuplicateEvent {
  run_id: string;
  name: string;
  kept: string;
  kept_turn: number;
  discarded: string[];
}

const NONE: DuplicateGroup[] = [];
let runId: string | null = null;
let groups: DuplicateGroup[] = NONE;
const listeners = new Set<() => void>();

function publish(next: DuplicateGroup[]) {
  groups = next.length ? next : NONE;
  listeners.forEach((l) => l());
}

/** Point the store at a run (null: none). */
export function setDuplicateRun(id: string | null) {
  if (id === runId) return;
  runId = id;
  publish(NONE);
  void refreshDuplicates();
}

/** Reload the active run's groups; a failure leaves the last ones. */
export async function refreshDuplicates(): Promise<void> {
  const asked = runId;
  if (!asked) return;
  try {
    const result = await api.duplicateBattles(asked);
    if (asked === runId) publish(result.groups);
  } catch { /* the warning is only a convenience */ }
}

function apply(asked: string, result: DuplicateGroups) {
  if (asked === runId) publish(result.groups);
}

export async function resolveDuplicates(keep: string, discard: string[]): Promise<void> {
  if (!runId) return;
  const asked = runId;
  apply(asked, await api.resolveDuplicates(asked, keep, discard));
}

export async function restoreDuplicates(run: string, ids: string[]): Promise<void> {
  apply(run, await api.restoreBattles(run, ids));
}

export function useDuplicateGroups(): DuplicateGroup[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => groups,
    () => NONE,
  );
}
