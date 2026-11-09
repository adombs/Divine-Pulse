/**
 * The shared people filters (affiliation, current run, route), as fields for a page's Filters dropdown and
 * as removable chips next to it. The same state is used on every page (see filters.ts).
 */
import { AFFILIATIONS, NO_FILTERS, PeopleFilters, usePeopleFilters, type LifeStatus } from "../filters";
import { ROUTES, type RouteId } from "../reference/supports";
import { RunIcon, Switch } from "./ui";
import { Icon } from "./Icon";
import { AffiliationIcon } from "./AffiliationIcon";
import { CheckChips, CheckList, FilterChip, SpoilerButton } from "./common";
import { useSpoiler } from "../spoilers";
import { CONCEPT_ICON } from "../icons/concepts";
import { FilterLabel } from "./FilterLabel";

const AFFILIATION_OPTIONS = AFFILIATIONS.map(
  (a) =>
    [
      a,
      <span key={a} className="with-crest">
        <span className="crest-sm" aria-hidden="true">
          <AffiliationIcon house={a} />
        </span>
        {a}
      </span>,
    ] as const,
);
const ROUTE_OPTIONS = ROUTES.map((r) => [r.id, <span key={r.id} className="with-crest"><span className="crest-sm" aria-hidden="true"><RunIcon route={r.id} /></span>{r.name}</span>] as const);

const STATUS_OPTIONS = ([["alive", "Alive"], ["dead", "Dead"]] as const).map(
  ([s, label]) => [s, <FilterLabel key={s} icon={s === "alive" ? CONCEPT_ICON.alive : CONCEPT_ICON.dead}>{label}</FilterLabel>] as const,
);

type Field = "affiliation" | "run" | "route" | "status";
const ALL: Field[] = ["affiliation", "run", "status", "route"];

export function PeopleFilterFields({ fields = ALL }: { fields?: Field[] }) {
  const [f, setF] = usePeopleFilters();
  const [showRoutes, setShowRoutes] = useSpoiler("recruitment");
  const set = (patch: Partial<PeopleFilters>) => setF({ ...f, ...patch });
  return (
    <div className="people-filter-fields">
      {fields.includes("run") && <span className="filter-label"><Icon name={CONCEPT_ICON.inRun} /><Switch checked={f.runOnly} onChange={(runOnly) => set({ runOnly })} label="Current run only" /></span>}
      {fields.includes("status") && (
        <CheckList<LifeStatus>
          label="Status"
          columns={2}
          options={STATUS_OPTIONS}
          value={f.status}
          onChange={(status) => set({ status })}
        />
      )}
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
        <><SpoilerButton conceal onClick={() => setShowRoutes(false)} label="Hide route spoilers" /><CheckList<RouteId>
          label="Route"
          columns={2}
          options={ROUTE_OPTIONS}
          value={f.routes}
          onChange={(routes) => set({ routes })}
        /></>
      ) : <SpoilerButton onClick={() => setShowRoutes(true)} label="Show route spoilers" />)}
    </div>
  );
}

export function PeopleFilterChips({ fields = ALL }: { fields?: Field[] }) {
  const [f, setF] = usePeopleFilters();
  return (
    <>
      {fields.includes("run") && f.runOnly && <FilterChip onClear={() => setF({ ...f, runOnly: false })}><FilterLabel icon={CONCEPT_ICON.inRun}>Current run</FilterLabel></FilterChip>}
      {fields.includes("status") && <CheckChips options={STATUS_OPTIONS} value={f.status} onChange={(status) => setF({ ...f, status })} />}
      {fields.includes("affiliation") && (
        <CheckChips options={AFFILIATION_OPTIONS} value={f.affiliations} onChange={(affiliations) => setF({ ...f, affiliations })} />
      )}
      {fields.includes("route") && <CheckChips options={ROUTE_OPTIONS} value={f.routes} onChange={(routes) => setF({ ...f, routes })} />}
    </>
  );
}

/** How many of the given fields are active (for the Filters badge). */
export function usePeopleFilterCount(fields: Field[] = ALL): [number, () => void] {
  const [f, setF] = usePeopleFilters();
  const n = (fields.includes("affiliation") ? f.affiliations.length : 0) + (fields.includes("run") && f.runOnly ? 1 : 0) + (fields.includes("route") ? f.routes.length : 0)
    + (fields.includes("status") ? f.status.length : 0);
  const clear = () =>
    setF({
      affiliations: fields.includes("affiliation") ? NO_FILTERS.affiliations : f.affiliations,
      runOnly: fields.includes("run") ? false : f.runOnly,
      routes: fields.includes("route") ? NO_FILTERS.routes : f.routes,
      status: fields.includes("status") ? NO_FILTERS.status : f.status,
    });
  return [n, clear];
}
