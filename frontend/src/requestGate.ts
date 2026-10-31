/** Invalidates replies when a newer request starts or its owning run changes. */
export function requestGate() {
  let version = 0;
  return {
    start() {
      const request = ++version;
      return () => request === version;
    },
    invalidate() { version++; },
  };
}

/** Loads units for the current run and ignores replies from requests that no longer own the view. */
export function createUnitsLoader<T>(
  loadUnits: (runId: string) => Promise<T[]>,
  update: (units: T[]) => void,
) {
  const gate = requestGate();
  let runId: string | null = null;
  let ready = false;
  return {
    setRun(nextRunId: string | null, isReady: boolean) {
      if (runId === nextRunId && ready === isReady) return;
      runId = nextRunId;
      ready = isReady;
      gate.invalidate();
      update([]);
    },
    async load() {
      if (!ready || !runId) {
        update([]);
        return;
      }
      const requestedRun = runId;
      const isCurrent = gate.start();
      try {
        const units = await loadUnits(requestedRun);
        if (isCurrent() && runId === requestedRun && ready) update(units);
      } catch {
        if (isCurrent() && runId === requestedRun && ready) update([]);
      }
    },
  };
}
