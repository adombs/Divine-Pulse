/**
 * Pieces every Supports view uses: who can be supported (Person), the rank badges and timelines, the
 * note chips for route and DLC locks, and the page's filter menu. Styling lives in ../supports.css.
 */
import { CONCEPT_ICON } from "../../../icons/concepts";
import type { Unit } from "../../../api";
import { runCharacterKeys } from "../../../portraits";
import { AFFILIATIONS, PeopleFilters, passes, routesOf } from "../../../filters";
import {
  ROUTES,
  RULES,
  RouteId,
  SupportPair,
  SupportRank,
  pairRoutes,
} from "../../../reference/supports";
import { Switch } from "../../ui";
import { FilterChip, FilterMenu, Segmented, Spoiler, SpoilerButton } from "../../common";
import { useSpoiler, spoilerShown } from "../../../spoilers";
import { PeopleFilterChips, PeopleFilterFields, usePeopleFilterCount } from "../../PeopleFilters";
import { Icon } from "../../Icon";

export const HOUSES: readonly string[] = AFFILIATIONS;

/** Support partners who aren't playable units. */
export const NPC_HOUSE: Record<string, string> = { Rhea: "Church of Seiros", Sothis: "Other" };

/** One support participant: a playable unit (Byleth split into M / F) or Rhea / Sothis. */
export interface Person {
  name: string;
  label: string; // shown
  key: string; // portrait key
  house: string;
  charKey: string | null; // Characters page key
}

/** This page's own options; affiliation, current run and route are the shared people filters. */
export interface Filters {
  byleth: "M" | "F";
  endingsOnly: boolean;
}

export const isByleth = (n: string) => n.startsWith("Byleth");
export const sameBase = (a: string, b: string) => a === b || (isByleth(a) && isByleth(b));
export const visibleRanks = (pair: SupportPair): SupportRank[] => spoilerShown("supports") ? pair.ranks : pair.ranks.filter((rank) => rank !== "S" && rank !== "A+");
export const visibleMaxRank = (pair: SupportPair): SupportRank => visibleRanks(pair).at(-1) ?? "C";
export const rankClass = (r: SupportRank) => r.replace("+", "p").toLowerCase();

/** Key used for route availability and affiliation (Characters page key, or the NPC's name). */
export const personKey = (p: Person) => p.charKey ?? p.label.toLowerCase();

export function inRun(p: Person, units: Unit[]): boolean {
  return runCharacterKeys(units).has(personKey(p));
}

export function passesPeople(f: PeopleFilters, p: Person, units: Unit[]): boolean {
  return passes(f, { key: personKey(p), house: p.house, inRun: inRun(p, units) });
}

/** Route lock check for a pair: the pair itself must be possible there, and both people on that route. */
export function pairOnRoutes(p: SupportPair, a: Person, b: Person, routes: RouteId[]): boolean {
  if (!routes.length) return true;
  const own = pairRoutes(p);
  return routes.some(
    (r) => (!own || own.includes(r)) && routesOf(personKey(a)).includes(r) && routesOf(personKey(b)).includes(r),
  );
}

export function attackPair(a: string, b: string): boolean {
  const base = (n: string) => (isByleth(n) ? "Byleth" : n);
  return RULES.attackPairs.some(([x, y]) => (x === base(a) && y === base(b)) || (x === base(b) && y === base(a)));
}

/** The one short note worth showing in a row: a route lock, DLC or a chapter lock. */
export function shortNote(p: SupportPair): { text: string; title: string; kind: string } | null {
  const routes = pairRoutes(p);
  if (routes) {
    const abbr = (id: RouteId) => ({ cf: "CF", ss: "SS", am: "AM", vw: "VW" })[id];
    const name = (id: RouteId) => ROUTES.find((r) => r.id === id)!.name;
    const missing = ROUTES.find((r) => !routes.includes(r.id));
    return routes.length === 1
      ? { text: `${abbr(routes[0])} only`, title: `${name(routes[0])} only`, kind: "route" }
      : { text: `Not ${abbr(missing!.id)}`, title: `Not on ${missing!.name}`, kind: "route" };
  }
  if (p.notes.some((n) => /downloadable/i.test(n))) return { text: "DLC", title: "Needs the downloadable content", kind: "dlc" };
  if (p.notes.some((n) => /S-Supported/i.test(n))) return { text: "S only", title: "Only if Byleth has not S-Supported someone", kind: "lock" };
  if (p.notes.some((n) => /Chapter/i.test(n))) return { text: "Locked", title: "Chapter lock: see the notes", kind: "lock" };
  return null;
}

/* ------------------------------------------------------------------ Rank marks */

/** The highest rank a pair reaches: the number worth seeing first. */
export function RankBadge({ rank }: { rank: SupportRank }) {
  const [shown] = useSpoiler("supports");
  if (!shown && (rank === "S" || rank === "A+")) rank = "A";
  return (
    <span className={`sup-badge r-${rankClass(rank)}`} title={`Highest rank: ${rank}`}>
      {rank}
    </span>
  );
}

/** Each rank with when it unlocks: the pair's whole story in one list. */
export function RankTimeline({ p }: { p: SupportPair }) {
  return (
    <ol className="sup-timeline">
      {visibleRanks(p).map((r) => (
        <li key={r}>
          <span className={`sup-rank r-${rankClass(r)}`}>{r}</span>
          <span className="sup-when"><Spoiler category="supports">{p.avail[r] || "Any Time"}</Spoiler>{p.avail[r] && <WikiCredit />}</span>
        </li>
      ))}
    </ol>
  );
}

export function WikiCredit() {
  return <div className="muted small"><a href="https://fireemblemwiki.org/wiki/List_of_supports_in_Fire_Emblem:_Three_Houses" target="_blank" rel="noreferrer">Fire Emblem Wiki</a></div>;
}

export function NoteChip({ note }: { note: { text: string; title: string; kind: string } }) {
  const [shown] = useSpoiler("supports");
  if (!shown) return <span className="sup-note-chip">Condition hidden</span>;
  return (
    <span className={`sup-note-chip ${note.kind}`} title={note.title}>
      {note.text}
    </span>
  );
}

/** Paired ending and Linked Attack marks, in that order. */
export function PairMarks({ pair, a, b }: { pair: SupportPair; a: string; b: string }) {
  const [shown] = useSpoiler("supports");
  const ending = shown && (pair.ranks.includes("S") || pair.ranks.includes("A+"));
  return (
    <>
      {ending && (
        <span
          className="ending"
          title={pair.ranks.includes("S") ? "S support: Byleth's paired ending" : "A+ support: paired ending"}
        >
          <Icon name={CONCEPT_ICON.ending} weight="fill" />
        </span>
      )}
      {attackPair(a, b) && (
        <span className="atk" title="Linked Attacks between these two also add Attack">
          <Icon name={CONCEPT_ICON.linked} />
        </span>
      )}
    </>
  );
}


/** What the marks under a list or the matrix mean. */
export function Legend({ ranks }: { ranks?: boolean }) {
  const [shown, setShown] = useSpoiler("supports");
  return (
    <p className="sup-legend">
      {ranks && shown && (
        <>
          <span className="sup-key">
            <span className="sup-rank r-s">S</span> Byleth&rsquo;s ending
          </span>
          <span className="sup-key">
            <span className="sup-rank r-ap">A+</span> paired ending
          </span>
        </>
      )}
      {shown ? (
        <span className="sup-key"><span className="ending"><Icon name={CONCEPT_ICON.ending} weight="fill" /></span> paired ending</span>
      ) : <SpoilerButton onClick={() => setShown(true)} label="Show support spoilers" />}
      <span className="sup-key">
        <span className="atk">
          <Icon name={CONCEPT_ICON.linked} />
        </span>
        Linked Attack adds Attack
      </span>
      <span className="sup-key">
        <span className="in-run">
          <Icon name={CONCEPT_ICON.inRun} weight="fill" />
        </span>
        in your run
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ Filters */

export function FilterControls({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const [shown, setShown] = useSpoiler("supports");
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const [peopleCount, clearPeople] = usePeopleFilterCount();
  const active = peopleCount + Number(shown && filters.endingsOnly);
  return (
    <FilterMenu
      count={active}
      onClear={() => {
        clearPeople();
        set({ endingsOnly: false });
      }}
      chips={
        <>
          {shown && filters.endingsOnly && (
            <FilterChip onClear={() => set({ endingsOnly: false })}>Paired Endings</FilterChip>
          )}
          <PeopleFilterChips />
        </>
      }
    >
      <div className="field">
        <span>Byleth</span>
        <Segmented
          size="mini"
          label="Byleth"
          value={filters.byleth}
          onChange={(byleth) => set({ byleth })}
          options={[
            ["M", "Male"],
            ["F", "Female"],
          ]}
        />
      </div>
      <Switch checked={shown && filters.endingsOnly} onChange={(v) => { if (v) setShown(true); set({ endingsOnly: v }); }} label="Paired endings only (shows support spoilers)" />
      <PeopleFilterFields />
    </FilterMenu>
  );
}
