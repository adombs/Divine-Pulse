/**
 * The people filters shared by every page that lists characters (Roster, Characters, Supports, a class's
 * "Who" tab): affiliation, current run and route. Each is "select all that apply"; nothing selected means no
 * filter. The choice is remembered and the same on every page.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ROUTES, type RouteId } from "./reference/supports";
import { useSpoiler } from "./spoilers";

export const AFFILIATIONS = [
  "Professor",
  "Black Eagles",
  "Blue Lions",
  "Golden Deer",
  "Ashen Wolves",
  "Church of Seiros",
  "Knights of Seiros",
  "Other",
] as const;

export type LifeStatus = "alive" | "dead";
export const LIFE_STATUSES: LifeStatus[] = ["alive", "dead"];

export interface PeopleFilters {
  affiliations: string[];
  /** Only units in the active run. */
  runOnly: boolean;
  routes: RouteId[];
  /** Alive or dead in the active run (people not in it are neither). */
  status: LifeStatus[];
}

export const NO_FILTERS: PeopleFilters = { affiliations: [], runOnly: false, routes: [], status: [] };

/**
 * Routes a character can be fielded on in Part II (Characters page key). From the recruitment notes: the
 * house leaders (and Hubert) stay with their own route; Jeritza only joins in Crimson Flower; Gilbert joins in
 * Azure Moon; Seteth, Flayn, Catherine and Cyril side with the church, so never on Crimson Flower; Rhea is only
 * an ally on Silver Snow. Everyone else can be recruited onto any route.
 */
const ONLY_ON: Record<string, RouteId[]> = {
  edelgard: ["cf"],
  hubert: ["cf"],
  jeritza: ["cf"],
  dimitri: ["am"],
  gilbert: ["am"],
  claude: ["vw"],
  rhea: ["ss"],
};
const NEVER_ON: Record<string, RouteId[]> = { seteth: ["cf"], flayn: ["cf"], catherine: ["cf"], cyril: ["cf"] };

export function routesOf(key: string): RouteId[] {
  const all = ROUTES.map((r) => r.id);
  if (ONLY_ON[key]) return ONLY_ON[key];
  if (NEVER_ON[key]) return all.filter((r) => !NEVER_ON[key].includes(r));
  return all;
}

/** Whether a person passes the filters. `key` is the Characters page key (lowercase name, "byleth"). */
export function passes(f: PeopleFilters, p: { key: string; house: string; inRun: boolean; dead?: boolean }, opts: { ignoreRun?: boolean } = {}): boolean {
  if (f.affiliations.length && !f.affiliations.includes(p.house)) return false;
  if (f.status.length && (!p.inRun || !f.status.includes(p.dead ? "dead" : "alive"))) return false;
  if (f.runOnly && !opts.ignoreRun && !p.inRun) return false;
  if (f.routes.length && !routesOf(p.key).some((r) => f.routes.includes(r))) return false;
  return true;
}

const STORE = "divine-pulse-people-filters";

const RUN_STORE = `${STORE}-run-only`;
type RunOnlyChoices = { loaded: boolean; empty: boolean };
function runOnlyChoices(): RunOnlyChoices {
  try {
    const saved = localStorage.getItem(RUN_STORE);
    if (saved) return { loaded: true, empty: false, ...JSON.parse(saved) as Partial<RunOnlyChoices> };
  } catch {
    /* storage unavailable: use the defaults */
  }
  return { loaded: true, empty: false };
}

export function usePeopleFiltersState(loadedRun = false): [PeopleFilters, (f: PeopleFilters) => void] {
  const [f, setF] = useState<PeopleFilters>(() => {
    try {
      const raw = localStorage.getItem(STORE);
      const stored = raw ? JSON.parse(raw) as Partial<PeopleFilters> : {};
      const status = Array.isArray(stored.status) ? stored.status.filter((s) => LIFE_STATUSES.includes(s)) : [];
      return { ...NO_FILTERS, ...stored, status, runOnly: false };
    } catch {
      return NO_FILTERS;
    }
  });
  const [choices, setChoices] = useState<RunOnlyChoices>(runOnlyChoices);
  const state = loadedRun ? "loaded" : "empty";
  const filters = { ...f, runOnly: choices[state] };
  const setFilters = useCallback((next: PeopleFilters) => {
    setF({ ...next, runOnly: false });
    const updated = { ...choices, [state]: next.runOnly };
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...next, runOnly: false }));
      localStorage.setItem(RUN_STORE, JSON.stringify(updated));
    } catch {
      /* storage unavailable: filters just aren't remembered */
    }
    setChoices(updated);
  }, [choices, state]);
  return [filters, setFilters];
}

export const PeopleFiltersContext = createContext<[PeopleFilters, (f: PeopleFilters) => void]>([NO_FILTERS, () => {}]);
export function usePeopleFilters(): [PeopleFilters, (f: PeopleFilters) => void] {
  const [filters, setFilters] = useContext(PeopleFiltersContext);
  const [showRoutes] = useSpoiler("recruitment");
  // A previously selected route must not invisibly filter people when its spoilers are hidden.
  const effective = useMemo(() => showRoutes ? filters : { ...filters, routes: [] }, [filters, showRoutes]);
  return [effective, setFilters];
}
