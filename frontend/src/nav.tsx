/**
 * App navigation: which page, sub-page (tab) and entry (character, class, unit) is open. Every change is a
 * browser history entry (shown in the URL hash), so the Back button, Alt+← and the mouse's back button all
 * undo an accidental click.
 */
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fromHash, toHash } from "./routes";
import type { Route } from "./routes";
export type { Page } from "./routes";

export interface Nav {
  route: Route;
  /** Open a route (a new history entry unless `replace`). */
  go: (r: Route, opts?: { replace?: boolean }) => void;
  back: () => void;
  canBack: boolean;
}

const same = (a: Route, b: Route) => toHash(a) === toHash(b);

interface HistoryState {
  route: Route;
  idx: number;
}

export function useNavState(): Nav {
  const [state, setState] = useState<HistoryState>(() => {
    const route = fromHash(window.location.hash);
    const idx = (window.history.state as HistoryState | null)?.idx ?? 0;
    window.history.replaceState({ route, idx } satisfies HistoryState, "", toHash(route));
    return { route, idx };
  });

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state as HistoryState | null;
      setState(s?.route ? s : { route: fromHash(window.location.hash), idx: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The history call is a side effect, so it lives outside the state updater (which may run twice).
  const current = useRef(state);
  current.current = state;
  const go = useCallback((route: Route, opts?: { replace?: boolean }) => {
    const cur = current.current;
    if (same(cur.route, route)) return;
    const next = { route, idx: opts?.replace ? cur.idx : cur.idx + 1 };
    if (opts?.replace) window.history.replaceState(next, "", toHash(route));
    else window.history.pushState(next, "", toHash(route));
    current.current = next;
    setState(next);
  }, []);

  const back = useCallback(() => window.history.back(), []);
  return { route: state.route, go, back, canBack: state.idx > 0 };
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ nav, children }: { nav: Nav; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavProvider");
  return nav;
}
