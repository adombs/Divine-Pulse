/**
 * Team pages for the video export (ReplayExport.tsx): the team's overview (a column of loadout cards) and run statistics
 * (the statistics table), as full frames shown before the replay, after it, or both. A page is the team images'
 * own pieces (`LoadoutCard`, `StatsTable`, TeamExport.tsx) drawn at the size that keeps their smallest body text legible
 * in the frame (exporting/teamPages.ts has the arithmetic), as many to a page as fit, flipping through pages until every
 * unit picked is covered. The units, their order, fallen units and faces follow Export Team's rules.
 */
import "./replay-export.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Battle, RunRoute, Unit } from "../../api";
import { plural } from "../../format";
import { chooseCardLayout, chunk, legibleScale, pageScale, PAGE_SECONDS, paginateRows, PLACEMENTS, planColumns, sidesOf, type CardLayout, type ColumnGroup, type Placement } from "../../exporting/teamPages";
import { StepSlider } from "../Slider";
import { CardBanner, RunIcon, Segmented } from "../ui";
import { FACES, layoutSlots, LoadoutCard, ORDER_BY, orderFor, pickRows, StatsTable, STAT_COLUMNS, statGroup, UnitSlots, type ExportFace, type OrderBy, type StatColumn } from "../TeamExport";
import { buildRunLedger } from "./runStatsLedger";
import { countedBattles } from "./rosterRule";

/** The settings of the team pages, remembered with the video's other options. */
export interface TeamPagesOptions {
  overview: boolean;
  overviewAt: Placement;
  stats: boolean;
  statsAt: Placement;
  /** How long each page stays, in whole seconds. */
  seconds: number;
  order: OrderBy;
  /** Whether units that died are in the pages (greyed). */
  fallen: boolean;
  face: ExportFace;
  /** Keys of units unticked. */
  left: string[];
  /** The units in their slots (see TeamExport.tsx `layoutSlots`). */
  placed: (string | null)[];
}

export const DEFAULT_TEAM_PAGES: TeamPagesOptions = {
  overview: false,
  overviewAt: "start",
  stats: false,
  statsAt: "end",
  seconds: PAGE_SECONDS.usual,
  order: "joined:asc",
  fallen: true,
  face: "portrait",
  left: [],
  placed: [],
};

/** Team pages as saved, made safe to use (anything unknown falls back to its default). */
export function sanitizeTeamPages(saved: unknown): TeamPagesOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof TeamPagesOptions, unknown>>;
  const placement = (v: unknown, fallback: Placement) => PLACEMENTS.find(([p]) => p === v)?.[0] ?? fallback;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, 500) : []);
  return {
    overview: s.overview === true,
    overviewAt: placement(s.overviewAt, DEFAULT_TEAM_PAGES.overviewAt),
    stats: s.stats === true,
    statsAt: placement(s.statsAt, DEFAULT_TEAM_PAGES.statsAt),
    seconds: Number.isInteger(s.seconds) && (s.seconds as number) >= PAGE_SECONDS.min && (s.seconds as number) <= PAGE_SECONDS.max ? (s.seconds as number) : DEFAULT_TEAM_PAGES.seconds,
    order: s.order === "custom" || ORDER_BY.some(([id]) => id === s.order) ? (s.order as OrderBy) : DEFAULT_TEAM_PAGES.order,
    fallen: s.fallen !== false,
    face: FACES.some(([f]) => f === s.face) ? (s.face as ExportFace) : DEFAULT_TEAM_PAGES.face,
    left: strings(s.left),
    placed: Array.isArray(s.placed) ? s.placed.slice(0, 500).map((k) => (typeof k === "string" ? k : null)) : [],
  };
}

/** Units side by side in the picker (it is only a list; the pages are one column). */
const PICKER_COLUMNS = 3;
/** A frame's padding and the gap under its title strip (px, as the replay's frame has them), and between cards. */
const PAD = 16;
const GAP = 12;
const CARD_GAP = 14;

/** The frame the pages fill (CSS px) and its title strip's height. */
export interface PageFrame {
  width: number;
  height: number;
  titleH: number;
  /** Whether the frame is taller than wide (its title strip has the facts on a line of their own). */
  portrait: boolean;
}

/** One page of the video. */
export interface TeamPage {
  id: string;
  kind: "overview" | "stats";
  /** A statistics page's columns (the unit is always beside them; null: all) and what they are called. */
  columns: StatColumn[] | null;
  label: string;
  /** An overview page's cards: how many columns each is packed into (0: as the image does). */
  cardColumns: number;
  /** 1-based, and how many pages there are of its kind. */
  number: number;
  of: number;
  units: Unit[];
  /** Every unit the pictures cover (the statistics' Team row adds them all up). */
  all: Unit[];
  /** How many times bigger than natural the content is drawn, and its natural width. */
  scale: number;
  contentW: number;
  last: boolean;
}

/** The statistics table as measured in its compact form: the unit column, each other column, and the rows' and header's heights. */
interface TableSize {
  unitW: number;
  colW: Record<string, number>;
  headH: number;
  /** A row's height without and with the records, and the totals row's. */
  rowH: number[];
  recordsRowH: number[];
  footH: number;
  text: number;
}

/** Card layouts the pages choose between (columns to pack a card into; 0 is the image's own packing). */
const CARD_LAYOUTS = [1, 2, 3, 0];

/** What the hidden copy of the cards and the table measures. */
interface Measured {
  keys: string;
  /** Each card layout's size, and the smallest body text on a card. */
  layouts: (CardLayout & { choice: number })[];
  cardText: number;
  table: TableSize;
}

/** The smallest font size (px) of text under `root`, leaving out captions that match `skip` (labels in small caps). */
function smallestText(root: Element, skip: string): number {
  let least = Infinity;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.closest(skip)) continue;
    if (!Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
    least = Math.min(least, parseFloat(getComputedStyle(el).fontSize));
  }
  return Number.isFinite(least) ? least : 0;
}

const finiteOr0 = (n: number) => (Number.isFinite(n) ? n : 0);

/** Text on a card that is a caption rather than body (the stat labels, BST and Score captions, section titles). */
const CARD_CAPTIONS = "small, dt, h4, [data-asset-error]";
/** Likewise on the table (its headings, and a unit's class under its name). */
const TABLE_CAPTIONS = "thead, small, [data-asset-error]";
/** What the table's columns are split by: Combat, Growth, then the Score with the top records. */
const STAT_GROUPS = ["combat", "growth", "records"] as const;
const GROUP_NAME = { combat: "Combat", growth: "Growth", records: "Records" } as const;

export interface TeamPagesState {
  /** Hidden copies the pages are measured from; render once, anywhere in the window. */
  measure: ReactNode;
  enabled: boolean;
  slots: (string | null)[];
  byKey: Map<string, Unit>;
  ledger: ReturnType<typeof buildRunLedger> | null;
  chosen: Unit[];
  overview: TeamPage[];
  stats: TeamPage[];
  /** Pages before and after the replay, in order. */
  start: TeamPage[];
  end: TeamPage[];
}

/** The picked units, the pages they make in this frame, and the hidden copies it takes to measure them. */
export function useTeamPages({ team, update, units, history, part2, frame }: {
  team: TeamPagesOptions;
  update: (patch: Partial<TeamPagesOptions>) => void;
  units: Unit[];
  history: Battle[];
  part2: boolean;
  frame: PageFrame;
}): TeamPagesState {
  const byKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const enabled = (team.overview || team.stats) && units.length > 0;
  // The run's battles as statistics see them (only units on the roster count), as Export Team reads them.
  const ledger = useMemo(() => (units.length ? buildRunLedger(countedBattles(history, new Set(units.map((u) => u.key))), "characters") : null), [history, units]);
  const slots = useMemo(() => layoutSlots(team.placed, units.map((u) => u.key), PICKER_COLUMNS), [team.placed, units]);
  const left = useMemo(() => new Set(team.left), [team.left]);
  const chosen = useMemo(() => pickRows(slots, byKey, left, PICKER_COLUMNS, team.fallen).flat(), [slots, byKey, left, team.fallen]);

  // An order other than Custom lays every unit out again once the battles are read (joined and deployments need them).
  useEffect(() => {
    if (!ledger || team.order === "custom") return;
    const next = orderFor(units, team.order, ledger.characters);
    if (JSON.stringify(next) !== JSON.stringify(team.placed)) update({ placed: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, units, team.order]);

  // Hidden copies of every card (in each layout) and of the table at their natural size, measured for the pages.
  const host = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const key = `${chosen.map((u) => u.key).join(",")}|${team.face}|${ledger ? ledger.rows.length : 0}`;
  useLayoutEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    const measure = () => {
      const layouts: Measured["layouts"] = [];
      for (const c of CARD_LAYOUTS) {
        const cards = Array.from(el.querySelectorAll<HTMLElement>(`[data-card-layout="${c}"] .team-card`));
        if (!cards.length) continue;
        layouts.push({ choice: c, columns: c || Math.max(...cards.map((n) => n.querySelectorAll(".team-card-col").length)), w: Math.max(...cards.map((n) => n.offsetWidth)), h: Math.max(...cards.map((n) => n.offsetHeight)) });
      }
      const cardEls = Array.from(el.querySelectorAll<HTMLElement>('[data-card-layout="1"] .team-card'));
      const tableOf = (id: string) => el.querySelector<HTMLTableElement>(`[data-table="${id}"] table`);
      const all = tableOf("all");
      const base = tableOf("base");
      const rec = tableOf("records");
      const heads = Array.from(all?.tHead?.rows[1]?.cells ?? []);
      const colW: Record<string, number> = {};
      STAT_COLUMNS.forEach((c, i) => (colW[c] = heads[i + 1]?.offsetWidth ?? 0));
      const rowsOf = (t: HTMLTableElement | null) => Array.from(t?.tBodies[0]?.rows ?? []).map((r) => r.offsetHeight);
      const next: Measured = {
        keys: key,
        layouts,
        cardText: finiteOr0(Math.min(...cardEls.map((c) => smallestText(c, CARD_CAPTIONS)).filter((n) => n > 0))),
        table: {
          unitW: heads[0]?.offsetWidth ?? 0,
          colW,
          headH: base?.tHead?.offsetHeight ?? 0,
          rowH: rowsOf(base),
          recordsRowH: rowsOf(rec),
          footH: base?.tFoot?.offsetHeight ?? 0,
          text: all ? smallestText(all, TABLE_CAPTIONS) : 0,
        },
      };
      setMeasured((now) => (now && JSON.stringify(now) === JSON.stringify(next) ? now : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [enabled, key, team.overview, team.stats, frame.portrait]);

  const pages = useMemo(() => {
    const out = { overview: [] as TeamPage[], stats: [] as TeamPage[] };
    if (!enabled || !measured || !measured.keys.startsWith(chosen.map((u) => u.key).join(",")) || !chosen.length) return out;
    const roomW = frame.width - 2 * PAD;
    const roomH = frame.height - 2 * PAD - frame.titleH - GAP;
    if (team.overview) {
      // The card layout (how many columns it is packed into) that lets its text be biggest in this frame.
      const pick = chooseCardLayout(measured.layouts, { minText: measured.cardText, frameHeight: frame.height, roomWidth: roomW, roomHeight: roomH, gap: CARD_GAP });
      if (pick) {
        const groups = chunk(chosen, pick.perPage);
        const cardColumns = pick.layout.choice;
        out.overview = groups.map((g, i) => ({ id: `overview-${i + 1}`, kind: "overview", columns: null, label: "", cardColumns, number: i + 1, of: groups.length, units: g, all: chosen, scale: pick.scale, contentW: pick.layout.w, last: i === groups.length - 1 }));
      }
    }
    const t = measured.table;
    if (team.stats && ledger && t.rowH.length === chosen.length && t.recordsRowH.length === chosen.length && t.unitW > 0) {
      // The columns split into pages that each reach the legible size across (the unit's column on every one): Combat, Growth, and the Score with the records.
      const col = (id: StatColumn) => ({ id, w: t.colW[id] ?? 0 });
      const groups: ColumnGroup[] = STAT_GROUPS.map((g) => ({ id: g, columns: STAT_COLUMNS.filter((c) => (statGroup(c) === "score" ? "records" : statGroup(c)) === g).map(col) }));
      const maxW = roomW / legibleScale(t.text, frame.height);
      const sets = planColumns(groups, t.unitW, maxW).map((ids) => ids as StatColumn[]);
      const whole = sets.length === 1;
      const built = sets.map((ids) => {
        const columns = STAT_COLUMNS.filter((c) => ids.includes(c));
        const rowHs = columns.includes("records") ? t.recordsRowH : t.rowH;
        const contentW = t.unitW + columns.reduce((n, c) => n + (t.colW[c] ?? 0), 0);
        const scale = pageScale({ minText: t.text, frameHeight: frame.height, contentWidth: contentW, roomWidth: roomW, minHeight: t.headH + Math.min(...rowHs) + t.footH, roomHeight: roomH });
        const label = whole ? "" : STAT_GROUPS.filter((g) => columns.some((c) => (statGroup(c) === "score" ? "records" : statGroup(c)) === g)).map((g) => GROUP_NAME[g]).join(" & ");
        return { columns, contentW, scale, label, groups: paginateRows(rowHs, roomH / scale, t.headH, t.footH) };
      });
      const count = built.reduce((n, b) => n + b.groups.length, 0);
      let n = 0;
      for (const b of built) {
        b.groups.forEach((g, i) => {
          out.stats.push({ id: `stats-${++n}`, kind: "stats", columns: whole ? null : b.columns, label: b.label, cardColumns: 0, number: n, of: count, units: g.map((r) => chosen[r]), all: chosen, scale: b.scale, contentW: b.contentW, last: i === b.groups.length - 1 });
        });
      }
    }
    return out;
  }, [enabled, measured, chosen, frame.width, frame.height, frame.titleH, team.overview, team.stats, ledger]);

  const at = (side: "start" | "end") => [
    ...(team.overview && sidesOf(team.overviewAt).includes(side) ? pages.overview : []),
    ...(team.stats && sidesOf(team.statsAt).includes(side) ? pages.stats : []),
  ];
  const measure = enabled ? (
    <div ref={host} className="team-page-measure" aria-hidden>
      {team.overview && CARD_LAYOUTS.map((c) => (
        <div key={c} className="team-page-measure-cards" data-card-layout={c}>
          {chosen.map((u) => <LoadoutCard key={u.key} unit={u} part2={part2} face={team.face} maxColumns={c || undefined} />)}
        </div>
      ))}
      {team.stats && ledger && (
        <>
          {([["all", undefined], ["base", ["combat:0"]], ["records", ["records"]]] as [string, StatColumn[] | undefined][]).map(([id, columns]) => (
            <div key={id} data-table={id}>
              <StatsTable units={chosen} rows={ledger.rows} totals={ledger.totals.records} part2={part2} face={team.face} columns={columns} compact stackRecords={frame.portrait} />
            </div>
          ))}
        </>
      )}
    </div>
  ) : null;
  return { measure, enabled, slots, byKey, ledger, chosen, overview: pages.overview, stats: pages.stats, start: enabled ? at("start") : [], end: enabled ? at("end") : [] };
}

/** One page, at the frame's exact size: the title strip (the run, the picture, "2 / 4") over the content, centred. */
export function TeamPageView({ page, frame, run, ledger, part2, face, ref }: {
  page: TeamPage;
  frame: PageFrame;
  run: { name: string; route: RunRoute | null };
  ledger: TeamPagesState["ledger"];
  part2: boolean;
  face: ExportFace;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const title = page.kind === "overview" ? "Team Overview" : `Run Statistics${page.label ? ` · ${page.label}` : ""}`;
  return (
    <div ref={ref} className={`team-page${frame.portrait ? " team-page-tall" : ""}`} style={{ width: frame.width, height: frame.height, gridTemplateRows: `${frame.titleH}px minmax(0, 1fr)` }}>
      <header className="replay-stage-title">
        <CardBanner title={`${run.name} · ${title}`} icon={<RunIcon route={run.route} />} />
        <div className="replay-stage-meta">
          <span className="replay-stage-facts">{[plural(page.all.length, "unit"), page.of > 1 ? `${page.number} / ${page.of}` : null].filter(Boolean).join(" · ")}</span>
          <span className="replay-stage-credit">Divine Pulse <span>· by Adombs</span></span>
        </div>
      </header>
      <div className="team-page-body">
        <div className="team-page-fit" style={{ width: page.contentW * page.scale }}>
          <div className={`team-page-content ${page.kind === "overview" ? "team-page-cards" : "team-page-table"}`} style={{ width: page.contentW, transform: `scale(${page.scale})`, transformOrigin: "0 0" }}>
            {page.kind === "overview" ? (
              page.units.map((u) => <LoadoutCard key={u.key} unit={u} part2={part2} face={face} maxColumns={page.cardColumns || undefined} />)
            ) : ledger ? (
              <StatsTable units={page.units} rows={ledger.rows} totals={ledger.totals.records} part2={part2} face={face} totalsOf={page.all} showTotals={page.last} columns={page.columns ?? undefined} compact stackRecords={frame.portrait} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A picture of the team pages: a switch, and where it goes. */
function PageChoice({ label, on, at, count, onOn, onAt }: { label: string; on: boolean; at: Placement; count: number | null; onOn: (on: boolean) => void; onAt: (at: Placement) => void }) {
  return (
    <div className="team-pages-choice">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onOn(e.target.checked)} />
        {label}
      </label>
      {on && <Segmented<Placement> size="mini" label={`${label} placement`} value={at} onChange={onAt} options={PLACEMENTS} />}
      {on && count !== null && <small className="team-pages-count" aria-live="polite">{plural(count, "page")}</small>}
    </div>
  );
}

/** The video options' Team pages group: which pictures, where, for how long, and which units in what order. */
export function TeamPagesSection({ team, update, pages, units, part2 }: {
  team: TeamPagesOptions;
  update: (patch: Partial<TeamPagesOptions>) => void;
  pages: TeamPagesState;
  units: Unit[];
  part2: boolean;
}) {
  const fallenCount = units.filter((u) => u.death).length;
  const toggle = (key: string) => update({ left: team.left.includes(key) ? team.left.filter((k) => k !== key) : [...team.left, key] });
  const any = team.overview || team.stats;
  return (
    <>
      <PageChoice label="Team overview" on={team.overview} at={team.overviewAt} count={pages.overview.length || null} onOn={(overview) => update({ overview })} onAt={(overviewAt) => update({ overviewAt })} />
      <PageChoice label="Run statistics" on={team.stats} at={team.statsAt} count={pages.stats.length || null} onOn={(stats) => update({ stats })} onAt={(statsAt) => update({ statsAt })} />
      {any && pages.chosen.length === 0 && (
        <p className="team-pages-note" role="status">No units are ticked, so there are no pages. Tick some under Units.</p>
      )}
      {any && (
        <>
          <StepSlider
            label="Seconds per page"
            stops={PAGE_SECONDS.max - PAGE_SECONDS.min + 1}
            value={team.seconds - PAGE_SECONDS.min}
            onChange={(i) => update({ seconds: i + PAGE_SECONDS.min })}
            valueText={`${team.seconds} seconds`}
            variant="timeline"
            slim
            after={<span className="export-value">{team.seconds} s</span>}
          />
          <details className="team-pages-units">
            <summary>
              Units <small>{pages.chosen.length} of {units.length}</small>
            </summary>
            <div className="team-pages-units-body">
              <label className="team-order-by">
                Order
                <select value={team.order} onChange={(e) => {
                  const order = e.target.value as OrderBy;
                  update(order === "custom" || !pages.ledger ? { order } : { order, placed: orderFor(units, order, pages.ledger.characters) });
                }}>
                  <option value="custom">Custom</option>
                  {ORDER_BY.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <div className="team-order-by">
                Faces
                <Segmented<ExportFace> size="mini" label="Faces" value={team.face} onChange={(face) => update({ face })} options={FACES} />
              </div>
              {fallenCount > 0 && (
                <label className="team-include-fallen">
                  <input type="checkbox" checked={team.fallen} onChange={(e) => update({ fallen: e.target.checked })} />
                  Include fallen units
                  <small>{fallenCount}</small>
                </label>
              )}
              <button type="button" className="checklist-clear" onClick={() => update({ left: team.left.length ? [] : units.map((u) => u.key) })}>
                {team.left.length ? "Select all" : "Select none"}
              </button>
              <UnitSlots slots={pages.slots} byKey={pages.byKey} left={new Set(team.left)} includeFallen={team.fallen} part2={part2} columns={PICKER_COLUMNS} onToggle={toggle} onPlace={(placed) => update({ placed, order: "custom" })} />
            </div>
          </details>
        </>
      )}
    </>
  );
}
