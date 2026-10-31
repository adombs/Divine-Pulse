import { useEffect, useRef, useState } from "react";
import { EventHandlers, subscribeToEvents } from "./eventStream";
import { loadGameAssetsStatus } from "./gameAssets";

/** Subscribes to the backend's Server-Sent Events. Returns whether the stream is connected. */
export function useEvents(handlers: EventHandlers): boolean {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/events");
    const gameAssets: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data?.job?.state === "done" || (data?.available === false && data?.job?.state !== "running")) void loadGameAssetsStatus(true);
        Promise.resolve(ref.current.game_assets?.(data)).catch((error) => console.error("Tracker event handler failed", error));
      }
      catch (error) { console.error("Tracker event handler failed", error); }
    };
    source.addEventListener("game_assets", gameAssets);
    const unsubscribe = subscribeToEvents(source, {
      hello: (data) => ref.current.hello?.(data),
      scan: (data) => ref.current.scan?.(data),
      scan_log: (data) => ref.current.scan_log?.(data),
      units_changed: (data) => ref.current.units_changed?.(data),
      runs_changed: (data) => ref.current.runs_changed?.(data),
      auto: (data) => ref.current.auto?.(data),
      battle: (data) => ref.current.battle?.(data),
    }, setConnected);
    return () => { source.removeEventListener("game_assets", gameAssets); unsubscribe(); };
  }, []);

  return connected;
}
