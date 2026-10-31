/**
 * By Character: pick someone from the portrait rail, see every partner as a wide row with the highest rank
 * up front, and open a row for when each rank unlocks. The card beside it holds their monastery data.
 */
import { CONCEPT_ICON } from "../../../icons/concepts";
import { useSpoiler } from "../../../spoilers";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Unit } from "../../../api";
import { useReference } from "../../../reference/types";
import { AffiliationIcon } from "../../AffiliationIcon";
import {
  MonasteryPerson,
  SUPPORT_RANKS,
  SupportData,
  SupportPair,
  hasEnding,
} from "../../../reference/supports";
import { KeyPortrait } from "../../ui";
import { DetailCard, EmptyState, MasterDetail, Section } from "../../layout";
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
  isByleth,
  passesPeople,
  shortNote,
  visibleMaxRank,
} from "./shared";

type SortKey = "rank" | "name" | "house";

interface Props {
  data: SupportData;
  people: Person[];
  selected: string;
  onSelect: (name: string) => void;
  pairsFor: (name: string) => SupportPair[];
  routeOk: (p: SupportPair) => boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  units: Unit[];
  part2: boolean;
}

/** The people, as a row of portraits: one click picks one, arrow keys step along it. */
function CharacterRail({
  people,
  selected,
  onSelect,
  units,
  part2,
}: {
  people: Person[];
  selected: string;
  onSelect: (name: string) => void;
  units: Unit[];
  part2: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  // Follow the selection, but not on the first render: the portraits haven't loaded yet, so the rail would
  // scroll by whatever the tiles grow by.
  const shown = useRef(selected);
  useEffect(() => {
    if (shown.current === selected) return;
    shown.current = selected;
    rail.current?.querySelector(".sup-face.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selected]);
  const step = (from: number, d: number) => {
    if (!people.length) return;
    const next = people[(from + d + people.length) % people.length];
    onSelect(next.name);
    requestAnimationFrame(() => rail.current?.querySelector<HTMLButtonElement>(".sup-face.on")?.focus());
  };
  return (
    <div className="sup-rail" ref={rail} role="radiogroup" aria-label="Character">
      {people.map((p, i) => {
        const on = p.name === selected;
        return (
          <button
            key={p.name}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`sup-face${on ? " on" : ""}`}
            onClick={() => onSelect(p.name)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), step(i, 1));
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), step(i, -1));
              else if (e.key === "Home") (e.preventDefault(), step(-1, 1));
              else if (e.key === "End") (e.preventDefault(), step(0, -1));
            }}
          >
            <KeyPortrait portraitKey={p.key} name={p.label} part2={part2} size={40} />
            <span className="sup-face-name">{p.label}</span>
            {inRun(p, units) && (
              <span className="in-run sup-face-run" title="In your active run">
                <Icon name={CONCEPT_ICON.inRun} weight="fill" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ByCharacter({ data, people, selected, onSelect, pairsFor, routeOk, filters, setFilters, units, part2 }: Props) {
  const [showSupports] = useSpoiler("supports");
  const [peopleFilters] = usePeopleFilters();
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("rank");
  const [q, setQ] = useState("");
  const me = people.find((p) => p.name === selected) ?? people[0];
  const byName = useMemo(() => new Map(people.map((p) => [p.name, p] as const)), [people]);

  useEffect(() => setOpen(null), [me?.name]);

  const railPeople = people.filter((p) => passesPeople(peopleFilters, p, units));
  if (!me) return <EmptyState title="Nobody to show">Clear the filters to see the cast again.</EmptyState>;

  const all = pairsFor(me.name)
    .map((p) => ({ pair: p, other: byName.get(p.a === me.name ? p.b : p.a) }))
    .filter((r): r is { pair: SupportPair; other: Person } => !!r.other);
  const rows = all
    .filter(
      (r) =>
        routeOk(r.pair) &&
        passesPeople({ ...peopleFilters, routes: [] }, r.other, units) &&
        (!showSupports || !filters.endingsOnly || hasEnding(r.pair)) &&
        searchMatches(q, r.other.label, r.other.house),
    )
    .sort((x, y) => {
      if (sort === "name") return x.other.label.localeCompare(y.other.label);
      if (sort === "house") return HOUSES.indexOf(x.other.house) - HOUSES.indexOf(y.other.house) || x.other.label.localeCompare(y.other.label);
      return (
        SUPPORT_RANKS.indexOf(visibleMaxRank(y.pair)) - SUPPORT_RANKS.indexOf(visibleMaxRank(x.pair)) ||
        HOUSES.indexOf(x.other.house) - HOUSES.indexOf(y.other.house) ||
        x.other.label.localeCompare(y.other.label)
      );
    });
  const endings = all.filter((r) => hasEnding(r.pair)).length;
  const top = all.length ? all.map((r) => visibleMaxRank(r.pair)).sort((a, b) => SUPPORT_RANKS.indexOf(b) - SUPPORT_RANKS.indexOf(a))[0] : null;

  return (
    <>
      <CharacterRail people={railPeople} selected={me.name} onSelect={onSelect} units={units} part2={part2} />
      <MasterDetail wide detail={<PersonCard key={me.name} me={me} info={data.people[me.label]} part2={part2} />}>
        <div className="toolbar">
          <SearchBox placeholder="Search partners" value={q} onChange={setQ} />
          <Segmented
            label="Sort Partners"
            value={sort}
            onChange={setSort}
            options={[
              ["rank", "Rank"],
              ["name", "Name"],
              ["house", "House"],
            ]}
          />
          <FilterControls filters={filters} setFilters={setFilters} />
          <span className="sup-stats">
            <span title="Partners shown of all">{rows.length === all.length ? all.length : `${rows.length}/${all.length}`}</span>
            <Spoiler category="supports"><span className="ending" title="Paired endings">
              <Icon name={CONCEPT_ICON.ending} weight="fill" /> {endings}
            </span></Spoiler>
            {top && <RankBadge rank={top} />}
          </span>
        </div>
        <div className="table-wrap sup-scroll">
          <ul className="sup-rows">
            {rows.map(({ pair, other }) => {
              const isOpen = open === other.name;
              const note = shortNote(pair);
              return (
                <li key={other.name} className={`sup-row${isOpen ? " open" : ""}`}>
                  <div className="sup-row-head">
                    <button
                      type="button"
                      className="sup-row-btn"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : other.name)}
                    >
                      <RankBadge rank={visibleMaxRank(pair)} />
                      <KeyPortrait portraitKey={other.key} name={other.label} part2={part2} size={36} />
                      <span className="sup-row-text">
                        <span className="sup-row-name">
                          {other.label}
                          <AffiliationIcon house={other.house} />
                          {inRun(other, units) && (
                            <span className="in-run" title="In your active run">
                              <Icon name={CONCEPT_ICON.inRun} weight="fill" />
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="sup-row-marks">
                        <PairMarks pair={pair} a={me.name} b={other.name} />
                        {note && <NoteChip note={note} />}
                      </span>
                      <Icon name={CONCEPT_ICON.open} className={`sup-caret${isOpen ? " open" : ""}`} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="sup-row-body">
                      <RankTimeline p={pair} />
                      {pair.notes.length > 0 && (
                        <ul className="sup-notes">
                          {pair.notes.map((n) => (
                            <li key={n}><Spoiler category="supports">{n}</Spoiler><WikiCredit /></li>
                          ))}
                        </ul>
                      )}
                      <p className="sup-row-links">
                        <button type="button" className="btn small" onClick={() => onSelect(other.name)}>
                          {other.label}&rsquo;s supports <Icon name={CONCEPT_ICON.go} />
                        </button>
                        {other.charKey && (
                          <CharLink charKey={other.charKey}>
                            <span className="btn small as-link">
                              Characters page <Icon name={CONCEPT_ICON.go} />
                            </span>
                          </CharLink>
                        )}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length === 0 && (
            <NoMatches
              what="partners"
              onReset={() => {
                setQ("");
                setFilters({ ...filters, endingsOnly: false });
              }}
            />
          )}
        </div>
        <Legend />
      </MasterDetail>
    </>
  );
}

function Chips({ items, kind = "" }: { items?: string[]; kind?: string }) {
  if (!items?.length) return <span className="muted">—</span>;
  return (
    <span className="chip-list">
      {items.map((i) => (
        <span key={i} className={`item-chip ${kind}`}>
          {i}
        </span>
      ))}
    </span>
  );
}

function PersonCard({ me, info, part2 }: { me: Person; info?: MonasteryPerson; part2: boolean }) {
  const ref = useReference();
  const c = ref?.characters.find((x) => x.key === me.charKey);
  const faculty = /Church|Knights/.test(me.house);
  const count = (n?: unknown[]) => n?.length ?? 0;
  return (
    <DetailCard title={me.label} icon={<AffiliationIcon house={me.house} />} label={`${me.label} gifts and activities`}>
      <div className="sup-profile">
        <KeyPortrait portraitKey={me.key} name={me.label} part2={part2} size={96} />
        <dl className="profile-rows">
          {(c || isByleth(me.name)) && (
            <>
              <dt>Birthday</dt>
              <dd title="On their birthday, tea is free (no activity point) and flowers give a little support">
                {c?.birthday || (isByleth(me.name) ? "" : "—")}
              </dd>
            </>
          )}
        </dl>
      </div>

      {isByleth(me.name) ? (
        <p className="muted">Gifts go to the other person: pick someone else to see what they like.</p>
      ) : !info ? (
        <p className="muted">No monastery data for {me.label}.</p>
      ) : (
        <>
          <Section title="Gifts" icon={CONCEPT_ICON.gifts} summary={`${count(info.liked_gifts)} liked · ${count(info.lost_items)} lost items`}>
            <dl className="ref-facts gift-facts">
              <dt>Likes</dt>
              <dd>
                <Chips items={info.liked_gifts} kind="good" />
              </dd>
              <dt>Dislikes</dt>
              <dd>
                <Chips items={info.disliked_gifts} kind="bad" />
              </dd>
              <dt title="Return these for +20 support">Lost Items</dt>
              <dd>
                <Chips items={info.lost_items} />
              </dd>
            </dl>
            <p className="muted small">
              Liked +20 · neutral +10 · disliked 0 · lost item +20{faculty ? " · faculty get 45% more from gifts" : ""}
            </p>
          </Section>
        </>
      )}
      {me.charKey && (
        <p className="card-link">
          <CharLink charKey={me.charKey}>
            Stats and skills on the Characters page <Icon name={CONCEPT_ICON.go} />
          </CharLink>
        </p>
      )}
    </DetailCard>
  );
}
