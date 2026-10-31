/**
 * The shared people filters (affiliation, current run, route), as fields for a page's Filters dropdown and
 * as removable chips next to it. The same state is used on every page (see filters.ts).
 */
import { AFFILIATIONS, NO_FILTERS, PeopleFilters, usePeopleFilters } from "../filters";
import { ROUTES, type RouteId } from "../reference/supports";
import { Switch } from "./ui";
import { AffiliationIcon } from "./AffiliationIcon";
import { CheckChips, CheckList, FilterChip } from "./common";
import { useSpoiler } from "../spoilers";

const AFFILIATION_OPTIONS = AFFILIATIONS.map(
  (a) =>
    [
      a,
      <span key={a} className="with-crest">
        <span className="crest-sm">
          <AffiliationIcon house={a} />
        </span>
        {a}
      </span>,
    ] as const,
);
const ROUTE_OPTIONS = ROUTES.map((r) => [r.id, r.name] as const);

type Field = "affiliation" | "run" | "route";

export function PeopleFilterFields({ fields = ["affiliation", "run", "route"] }: { fields?: Field[] }) {
  const [f, setF] = usePeopleFilters();
  const [showRoutes, setShowRoutes] = useSpoiler("recruitment");
  const set = (patch: Partial<PeopleFilters>) => setF({ ...f, ...patch });
  return (
    <div className="people-filter-fields">
      {fields.includes("run") && <Switch checked={f.runOnly} onChange={(runOnly) => set({ runOnly })} label="Current run only" />}
      {fields.includes("affiliation") && (
        <CheckList
          label="Affiliation"
          columns={2}
          options={AFFILIATION_OPTIONS}
          value={f.affiliations}
          onChange={(affiliations) => set({ affiliations })}
        />
      )}
      {fields.includes("route") && (showRoutes ? (
        <CheckList<RouteId>
          label="Route"
          columns={2}
          options={ROUTE_OPTIONS}
          value={f.routes}
          onChange={(routes) => set({ routes })}
        />
      ) : <button type="button" className="link-btn" onClick={() => setShowRoutes(true)}>Show route spoilers</button>)}
    </div>
  );
}

export function PeopleFilterChips({ fields = ["affiliation", "run", "route"] }: { fields?: Field[] }) {
  const [f, setF] = usePeopleFilters();
  return (
    <>
      {fields.includes("run") && f.runOnly && <FilterChip onClear={() => setF({ ...f, runOnly: false })}>Current run</FilterChip>}
      {fields.includes("affiliation") && (
        <CheckChips options={AFFILIATION_OPTIONS} value={f.affiliations} onChange={(affiliations) => setF({ ...f, affiliations })} />
      )}
      {fields.includes("route") && <CheckChips options={ROUTE_OPTIONS} value={f.routes} onChange={(routes) => setF({ ...f, routes })} />}
    </>
  );
}

/** How many of the given fields are active (for the Filters badge). */
export function usePeopleFilterCount(fields: Field[] = ["affiliation", "run", "route"]): [number, () => void] {
  const [f, setF] = usePeopleFilters();
  const n = (fields.includes("affiliation") ? f.affiliations.length : 0) + (fields.includes("run") && f.runOnly ? 1 : 0) + (fields.includes("route") ? f.routes.length : 0);
  const clear = () =>
    setF({
      affiliations: fields.includes("affiliation") ? NO_FILTERS.affiliations : f.affiliations,
      runOnly: fields.includes("run") ? false : f.runOnly,
      routes: fields.includes("route") ? NO_FILTERS.routes : f.routes,
    });
  return [n, clear];
}
