export type EventHandler = (data: unknown) => void | Promise<void>;
export type EventHandlers = Record<string, EventHandler>;

export interface EventSourceLike {
  onopen: EventSource["onopen"];
  onerror: EventSource["onerror"];
  addEventListener(name: string, listener: EventListener): void;
  removeEventListener(name: string, listener: EventListener): void;
  close(): void;
}

export function subscribeToEvents(
  source: EventSourceLike,
  handlers: EventHandlers,
  setConnected: (connected: boolean) => void,
  onError: (error: unknown) => void = (error) => console.error("Tracker event handler failed", error),
) {
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  const names = ["hello", "roster_warning", "units_changed", "runs_changed", "auto", "battle"];
  const listeners = names.map((name) => {
    const listener: EventListener = (event) => {
      if (name === "hello") setConnected(true);
      let data: unknown = null;
      try {
        const raw = (event as MessageEvent).data;
        data = raw ? JSON.parse(raw) : null;
      } catch (error) {
        onError(error);
        return;
      }
      try {
        Promise.resolve(handlers[name]?.(data)).catch(onError);
      } catch (error) {
        onError(error);
      }
    };
    source.addEventListener(name, listener);
    return [name, listener] as const;
  });
  return () => {
    listeners.forEach(([name, listener]) => source.removeEventListener(name, listener));
    source.close();
  };
}
