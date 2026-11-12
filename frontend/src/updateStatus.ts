// The startup update check, shared by the banner and the app (events). Settings holds which version was dismissed.
import { useSyncExternalStore } from "react";
import { api, UpdateStatus } from "./api";

interface State { status: UpdateStatus | null; dismissed: string | null }

let state: State = { status: null, dismissed: null };
const listeners = new Set<() => void>();

function publish(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Load the check's result and the dismissed version; a failure leaves the banner hidden. */
export async function loadUpdate(): Promise<void> {
  try {
    const [status, settings] = await Promise.all([api.update(), api.settings()]);
    publish({ status, dismissed: settings.update_dismissed ?? null });
  } catch { /* the banner is only a convenience */ }
}

/** The `update` server event: a check finished. */
export function acceptUpdate(status: UpdateStatus | null) {
  if (status && typeof status.available === "boolean") publish({ status });
}

export function setUpdateDismissed(version: string | null | undefined) {
  publish({ dismissed: version || null });
}

/** Hide the banner for the version it shows. */
export async function dismissUpdate(version: string): Promise<void> {
  const saved = await api.saveSettings({ update_dismissed: version });
  setUpdateDismissed(saved.update_dismissed ?? version);
}

/** The status to announce, or null when there is nothing new or it was dismissed. */
export function useUpdateBanner(): UpdateStatus | null {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
  const status = s.status;
  return status && status.available && status.latest && status.latest !== s.dismissed ? status : null;
}
