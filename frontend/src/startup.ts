export interface StartupState {
  loading: boolean;
  error: string | null;
}

/** Keeps startup failures visible and gives the shell a retryable bootstrap action. */
export function createStartupController(load: () => Promise<() => void>, onState: (state: StartupState) => void) {
  let attempt = 0;
  let errorMessage: string | null = null;
  return {
    async retry() {
      const current = ++attempt;
      onState({ loading: true, error: errorMessage });
      try {
        const commit = await load();
        if (current === attempt) {
          commit();
          errorMessage = null;
          onState({ loading: false, error: errorMessage });
        }
      } catch (error) {
        if (current === attempt) {
          errorMessage = error instanceof Error ? error.message : String(error);
          onState({ loading: false, error: errorMessage });
        }
      }
    },
    invalidate() { attempt++; },
  };
}
