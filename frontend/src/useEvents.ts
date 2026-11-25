import { useEffect, useRef, useState } from "react";
import { createEventHub, EVENT_NAMES, EventHandlers } from "./eventStream";
import { gameAssetsChanged, loadGameAssetsStatus } from "./gameAssets";

const hub = createEventHub(() => new EventSource("/api/events"), {
  game_assets: (data) => { if (gameAssetsChanged(data)) void loadGameAssetsStatus(true); },
});

/** Subscribes to the backend's Server-Sent Events (one connection shared by every caller). Returns whether the
 * stream is connected. */
export function useEvents(handlers: EventHandlers): boolean {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => hub.subscribe(
    Object.fromEntries(EVENT_NAMES.map((name) => [name, (data: unknown) => ref.current[name]?.(data)])),
    setConnected,
  ), []);

  return connected;
}
