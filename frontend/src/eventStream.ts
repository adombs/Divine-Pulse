export type EventHandler = (data: unknown) => void | Promise<void>;
export type EventHandlers = Record<string, EventHandler>;

export interface EventSourceLike {
  onopen: EventSource["onopen"];
  onerror: EventSource["onerror"];
  addEventListener(name: string, listener: EventListener): void;
  removeEventListener(name: string, listener: EventListener): void;
  close(): void;
}

/** The named events the backend sends on /api/events. */
export const EVENT_NAMES = ["hello", "roster_warning", "units_changed", "runs_changed", "auto", "battle", "duplicate_battles", "update", "game_assets"] as const;

const logError = (error: unknown) => console.error("Tracker event handler failed", error);

export function subscribeToEvents(
  source: EventSourceLike,
  handlers: EventHandlers,
  setConnected: (connected: boolean) => void,
  onError: (error: unknown) => void = logError,
) {
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  const listeners = EVENT_NAMES.map((name) => {
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

export interface EventHub {
  /** Receive the stream's events and its connection state (told at once). Returns the unsubscribe. */
  subscribe(handlers: EventHandlers, onConnected: (connected: boolean) => void): () => void;
}

/**
 * One connection to the event stream, shared by everyone listening: it opens with the first subscriber and closes
 * after the last. Each page that listens would otherwise hold its own connection, and a browser allows only six
 * to the tracker at once (images and API calls queue behind them). `always` runs once per event, before the
 * subscribers, whoever is listening.
 */
export function createEventHub(open: () => EventSourceLike, always: EventHandlers = {}, onError: (error: unknown) => void = logError): EventHub {
  const subscribers = new Set<{ handlers: EventHandlers; onConnected: (connected: boolean) => void }>();
  let close: (() => void) | null = null;
  let connected = false;
  const setConnected = (value: boolean) => {
    if (value === connected) return;
    connected = value;
    subscribers.forEach((s) => s.onConnected(value));
  };
  const dispatch: EventHandlers = Object.fromEntries(EVENT_NAMES.map((name) => [name, (data: unknown) => {
    const runs = [always[name], ...[...subscribers].map((s) => s.handlers[name])].filter((h): h is EventHandler => !!h);
    for (const handler of runs) {
      try { Promise.resolve(handler(data)).catch(onError); } catch (error) { onError(error); }
    }
  }]));
  return {
    subscribe(handlers, onConnected) {
      const entry = { handlers, onConnected };
      subscribers.add(entry);
      if (!close) close = subscribeToEvents(open(), dispatch, setConnected, onError);
      onConnected(connected);
      return () => {
        if (!subscribers.delete(entry) || subscribers.size) return;
        close?.();
        close = null;
        connected = false;
      };
    },
  };
}
