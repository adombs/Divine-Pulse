/**
 * All Pairings: every support in the game, either as a searchable list (the default: 300-odd pairs read
 * far better than a 41-column grid) or as the matrix, rebuilt with portrait heads, large cells and a
 * cross-hair. Both fill the same card, so a pairing is one click from either.
 */
import { CONCEPT_ICON } from "../../../icons/concepts";
import { useSpoiler } from "../../../spoilers";
import { useMemo, useState } from "react";
import type { Unit } from "../../../api";
import { SUPPORT_RANKS, SupportData, SupportPair, hasEnding } from "../../../reference/supports";
import { KeyPortrait } from "../../ui";
import { DetailCard, EmptyState, MasterDetail, Section } from "../../layout";
import { AffiliationIcon } from "../../AffiliationIcon";
import { NoMatches, SearchBox, Segmented, Spoiler } from "../../common";
import { Icon } from "../../Icon";
import { usePeopleFilters } from "../../../filters";
import { searchMatches } from "../../../fuzzy";
import { CharLink } from "../../Links";
import {
  Filters,
  FilterControls,
  HOUSES,
  Legend,
  NoteChip,
  PairMarks,
  Person,
  RankBadge,
  RankTimeline,
  WikiCredit,
  inRun,
  passesPeople,
  rankClass,
  sameBase,
  shortNote,
  visibleMaxRank,
  visibleRanks,
} from "./shared";

type View = "list" | "matrix";
type SortKey = "rank" | "name";

interface Props {
  data: SupportData;
  people: Person[];
  part2: boolean;
  units: Unit[];
  routeOk: (p: SupportPair) => boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onOpen: (name: string) => void;
}

interface Row {
  pair: SupportPair;
  a: Person;
  b: Person;
  id: string;
}

export function Pairings({ data, people, part2, units, routeOk, filters, setFilters, onOpen }: Props) {
  const [showSupports] = useSpoiler("supports");
  const [peopleFilters] = usePeopleFilters();
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<SortKey>("rank");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const byName = useMemo(() => new Map(people.map((p) => [p.name, p] as const)), [people]);
  const shown = people.filter((p) => passesPeople({ ...peopleFilters, routes: [] }, p, units));
  const inView = useMemo(() => new Set(shown.map((p) => p.name)), [shown]);

  const all = useMemo<Row[]>(
    () =>
      data.pairs
        .map((pair) => {
          const a = byName.get(pair.a);
          const b = byName.get(pair.b);
          return a && b ? { pair, a, b, id: `${pair.a}|${pair.b}` } : null;
        })
        .filter((r): r is Row => !!r),
    [data, byName],
  );

  const rows = all
    .filter(
      (r) =>
        inView.has(r.a.name) &&
        inView.has(r.b.name) &&
        routeOk(r.pair) &&
        (!showSupports || !filters.endingsOnly || hasEnding(r.pair)) &&
        searchMatches(q, r.a.label, r.b.label, `${r.a.label} ${r.b.label}`),
    )
    .sort((x, y) => {
      if (sort === "name") return x.a.label.localeCompare(y.a.label) || x.b.label.localeCompare(y.b.label);
      return (
        SUPPORT_RANKS.indexOf(visibleMaxRank(y.pair)) - SUPPORT_RANKS.indexOf(visibleMaxRank(x.pair)) ||
        HOUSES.indexOf(x.a.house) - HOUSES.indexOf(y.a.house) ||
        x.a.label.localeCompare(y.a.label) ||
        x.b.label.localeCompare(y.b.label)
      );
    });

  const current = all.find((r) => r.id === picked) ?? rows[0] ?? null;

  return (
    <MasterDetail wide detail={<PairCard row={current} part2={part2} onOpen={onOpen} />}>
      <div className="toolbar">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            ["list", "List"],
            ["matrix", "Matrix"],
          ]}
        />
        {view === "list" && (
          <>
            <SearchBox placeholder="Search names" value={q} onChange={setQ} />
            <Segmented
              label="Sort Pairings"
              value={sort}
              onChange={setSort}
              options={[
                ["rank", "Rank"],
                ["name", "Name"],
              ]}
            />
          </>
        )}
        <FilterControls filters={filters} setFilters={setFilters} />
      </div>
      {view === "list" ? (
        <>
          <div className="table-wrap sup-scroll">
            <ul className="sup-rows pairs">
              {rows.map((r) => {
                const note = shortNote(r.pair);
                const on = current?.id === r.id;
                return (
                  <li key={r.id} className={`sup-row${on ? " picked" : ""}`}>
                    <button
                      type="button"
                      className="sup-row-btn"
                      aria-pressed={on}
                      onClick={() => setPicked(r.id)}
                    >
                      <RankBadge rank={visibleMaxRank(r.pair)} />
                      <span className="sup-duo">
                        <KeyPortrait portraitKey={r.a.key} name={r.a.label} part2={part2} size={34} />
                        <KeyPortrait portraitKey={r.b.key} name={r.b.label} part2={part2} size={34} />
                      </span>
                      <span className="sup-row-text">
                        <span className="sup-row-name">
                          {r.a.label} &amp; {r.b.label}
                          <AffiliationIcon house={r.a.house} />
                          {r.b.house !== r.a.house && <AffiliationIcon house={r.b.house} />}
                        </span>
                      </span>
                      <span className="sup-row-marks">
                        <PairMarks pair={r.pair} a={r.a.name} b={r.b.name} />
                        {note && <NoteChip note={note} />}
                        {(inRun(r.a, units) || inRun(r.b, units)) && (
                          <span className="in-run" title="In your active run">
                            <Icon name={CONCEPT_ICON.inRun} weight="fill" />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {rows.length === 0 && (
              <NoMatches
                what="pairings"
                onReset={() => {
                  setQ("");
                  setFilters({ ...filters, endingsOnly: false });
                }}
              />
            )}
          </div>
          <Legend />
        </>
      ) : (
        <Matrix
          people={shown}
          pairs={all}
          part2={part2}
          routeOk={routeOk}
          picked={current?.id ?? null}
          onPick={setPicked}
          onOpen={onOpen}
        />
      )}
    </MasterDetail>
  );
}

/* ------------------------------------------------------------------ Matrix */

function Matrix({
  people,
  pairs,
  part2,
  routeOk,
  picked,
  onPick,
  onOpen,
}: {
  people: Person[];
  pairs: Row[];
  part2: boolean;
  routeOk: (p: SupportPair) => boolean;
  picked: string | null;
  onPick: (id: string) => void;
  onOpen: (name: string) => void;
}) {
  const [showSupports] = useSpoiler("supports");
  const [hot, setHot] = useState<[number, number] | null>(null);
  const lookup = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of pairs) {
      m.set(`${r.a.name}|${r.b.name}`, r);
      m.set(`${r.b.name}|${r.a.name}`, r);
    }
    return m;
  }, [pairs]);

  if (!people.length) return <EmptyState title="Nobody to show">Clear the filters to see the matrix again.</EmptyState>;

  return (
    <>
      <div className="matrix-wrap sup-matrix-wrap" onMouseLeave={() => setHot(null)}>
        <table className="sup-matrix">
          <caption className="sr-only">Highest support rank for every pair</caption>
          <thead>
            <tr>
              <th className="corner" />
              {people.map((p, j) => (
                <th key={p.name} scope="col" className={hot?.[1] === j ? "hot" : ""}>
                  <button type="button" className="sup-head" onClick={() => onOpen(p.name)} title={`${p.label}'s supports`}>
                    <KeyPortrait portraitKey={p.key} name={p.label} part2={part2} size={28} />
                    <span className="sup-head-abbr">{p.label.slice(0, 3)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((row, i) => (
              <tr key={row.name} className={hot?.[0] === i ? "hot" : ""}>
                <th scope="row" className="sup-row-head">
                  <button type="button" className="sup-head row" onClick={() => onOpen(row.name)} title={`${row.label}'s supports`}>
                    <KeyPortrait portraitKey={row.key} name={row.label} part2={part2} size={26} />
                    <span>{row.label}</span>
                  </button>
                </th>
                {people.map((col, j) => {
                  if (sameBase(row.name, col.name)) return <td key={col.name} className="self" />;
                  const r = lookup.get(`${row.name}|${col.name}`);
                  const cls = [
                    r ? `has r-${rankClass(visibleMaxRank(r.pair))}` : "none",
                    r && showSupports && !routeOk(r.pair) ? "locked" : "",
                    hot?.[1] === j ? "hot" : "",
                    r && r.id === picked ? "picked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={col.name} className={cls} onMouseEnter={() => setHot([i, j])}>
                      {r ? (
                        <button
                          type="button"
                          className="sup-cell"
                          aria-pressed={r.id === picked}
                          aria-label={`${row.label} and ${col.label}: up to ${visibleMaxRank(r.pair)}`}
                          onFocus={() => setHot([i, j])}
                          onClick={() => onPick(r.id)}
                        >
                          {visibleMaxRank(r.pair)}
                        </button>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend ranks />
    </>
  );
}

/* ------------------------------------------------------------------ The pairing's card */

function PairCard({ row, part2, onOpen }: { row: Row | null; part2: boolean; onOpen: (name: string) => void }) {
  const [showSupports] = useSpoiler("supports");
  if (!row)
    return (
      <DetailCard title="No pairing" label="No pairing">
        <EmptyState title="Nothing to show">Clear the search and filters to see the game&rsquo;s supports.</EmptyState>
      </DetailCard>
    );
  const { pair, a, b } = row;
  const note = shortNote(pair);
  return (
    <DetailCard title={`${a.label} & ${b.label}`} label={`${a.label} and ${b.label}`}>
      <div className="sup-pair-head">
        {[a, b].map((p) => (
          <button key={p.name} type="button" className="sup-pair-face" onClick={() => onOpen(p.name)}>
            <KeyPortrait portraitKey={p.key} name={p.label} part2={part2} size={56} />
            <span className="sup-pair-name">{p.label}</span>
            <AffiliationIcon house={p.house} />
            <span className="sup-pair-go">
              Their supports <Icon name={CONCEPT_ICON.go} />
            </span>
          </button>
        ))}
      </div>
      <div className="sup-pair-top">
        <RankBadge rank={visibleMaxRank(pair)} />
        <span className="sup-pair-top-text">Highest Rank</span>
        <PairMarks pair={pair} a={a.name} b={b.name} />
        {note && <NoteChip note={note} />}
      </div>
      <Section title="Support Ranks" icon={CONCEPT_ICON.supports} summary={visibleRanks(pair).join(" · ")}>
        <RankTimeline p={pair} />
      </Section>
      <Section title="Notes" icon={CONCEPT_ICON.info} summary={showSupports ? (pair.notes.length ? `${pair.notes.length}` : "None") : "Hidden"}>
        {pair.notes.length ? (
          <ul className="sup-notes">
            {pair.notes.map((n) => (
              <li key={n}><Spoiler category="supports">{n}</Spoiler><WikiCredit /></li>
            ))}
          </ul>
        ) : (
          <p className="muted">No route locks or special conditions.</p>
        )}
      </Section>
      <p className="card-link">
        {[a, b].map(
          (p) =>
            p.charKey && (
              <CharLink key={p.name} charKey={p.charKey}>
                {p.label} in the Archive <Icon name={CONCEPT_ICON.go} />
              </CharLink>
            ),
        )}
      </p>
    </DetailCard>
  );
}
