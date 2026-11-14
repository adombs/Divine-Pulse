/**
 * Team pages for the video export (ReplayExport.tsx): the team's overview (a grid of the video's compact cards,
 * `VideoUnitCard`), as full frames shown before the replay or after it, each for a second. The player picks how many
 * columns and rows a page has, or leaves either Auto: as many as keep the cards' smallest text legible in the frame
 * (exporting/teamPages.ts has the arithmetic). Pages flip until every unit picked is covered. The units, their order,
 * fallen units and faces follow Export Team's rules; each card lists what the unit used in the battle exported.
 */
import "./replay-export.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Battle, RunRoute, Unit } from "../../api";
import { plural } from "../../format";
import { equippedAccessory, gambitUses, gearName, usageList, type CardGear } from "../../exporting/usageList";
import { chunk, fmtSeconds, MAX_COLUMNS, MAX_ROWS, PAGE_MS, PAGE_SECONDS, PLACEMENTS, planGrid, sanitizeSeconds, sidesOf, type Axis, type GridPlan, type Placement } from "../../exporting/teamPages";
import { CardBanner, RunIcon, Segmented } from "../ui";
import { StepSlider } from "../Slider";
import { FACES, layoutSlots, ORDER_BY, orderFor, pickRows, UnitSlots, type ExportFace, type OrderBy } from "../TeamExport";
import { buildRunLedger } from "./runStatsLedger";
import { countedBattles } from "./rosterRule";
import { VideoUnitCard } from "./TeamVideoCard";

/** The settings of the team pages, remembered with the video's other options. */
export interface TeamPagesOptions {
  overview: boolean;
  overviewAt: Placement;
  order: OrderBy;
  /** Whether units that died are in the pages (greyed). */
  fallen: boolean;
  /** Whether fallen units' cards are greyed out. */
  markFallen: boolean;
  face: ExportFace;
  /** Cards across and down a page; null is Auto (as many as keep the text legible). */
  columns: Axis;
  rows: Axis;
  /** How long each page stays on screen (one of `PAGE_SECONDS`). */
  seconds: number;
  /** Keys of units unticked. */
  left: string[];
  /** The units in their slots (see TeamExport.tsx `layoutSlots`). */
  placed: (string | null)[];
}

export const DEFAULT_TEAM_PAGES: TeamPagesOptions = {
  overview: false,
  overviewAt: "start",
  order: "joined:asc",
  fallen: true,
  markFallen: true,
  face: "portrait",
  columns: null,
  rows: null,
  seconds: PAGE_MS / 1000,
  left: [],
  placed: [],
};

/** Team pages as saved, made safe to use (anything unknown falls back to its default; options this version no longer has, such as run statistics, are dropped). */
export function sanitizeTeamPages(saved: unknown): TeamPagesOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof TeamPagesOptions, unknown>>;
  // "both" was once a choice: it is now Start.
  const placement = (v: unknown, fallback: Placement) => PLACEMENTS.find(([p]) => p === (v === "both" ? "start" : v))?.[0] ?? fallback;
  const axis = (v: unknown, max: number): Axis => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, 500) : []);
  return {
    overview: s.overview === true,
    overviewAt: placement(s.overviewAt, DEFAULT_TEAM_PAGES.overviewAt),
    order: s.order === "custom" || ORDER_BY.some(([id]) => id === s.order) ? (s.order as OrderBy) : DEFAULT_TEAM_PAGES.order,
    fallen: s.fallen !== false,
    markFallen: s.markFallen !== false,
    face: FACES.some(([f]) => f === s.face) ? (s.face as ExportFace) : DEFAULT_TEAM_PAGES.face,
    columns: axis(s.columns, MAX_COLUMNS),
    rows: axis(s.rows, MAX_ROWS),
    seconds: sanitizeSeconds(s.seconds, DEFAULT_TEAM_PAGES.seconds),
    left: strings(s.left),
    placed: Array.isArray(s.placed) ? s.placed.slice(0, 500).map((k) => (typeof k === "string" ? k : null)) : [],
  };
}

/** Units side by side in the picker (it is only a list; the pages have their own grid). */
const PICKER_COLUMNS = 3;
/** A frame's padding and the gap under its title strip (px, as the replay's frame has them), and between cards. */
const PAD = 16;
const GAP = 12;
const CARD_GAP = 8;

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
  /** 1-based, and how many pages there are. */
  number: number;
  of: number;
  units: Unit[];
  /** Every unit the pages cover. */
  all: Unit[];
  /** The page's grid (the same on every page of a video). */
  grid: GridPlan;
}

/** A card's natural width (px): the width the hidden copies are measured at. */
const CARD_W = 460;

/** What the hidden copy of the cards measures: the tallest card at its natural width, and the smallest text on any. */
interface Measured {
  keys: string;
  h: number;
  minText: number;
}

/** The smallest font size (px) of text under `root`, leaving out what matches `skip`. */
function smallestText(root: Element, skip: string): number {
  let least = Infinity;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.closest(skip)) continue;
    if (!Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
    least = Math.min(least, parseFloat(getComputedStyle(el).fontSize));
  }
  return Number.isFinite(least) ? least : 0;
}

const EMPTY_GEAR: CardGear = { used: [], accessory: null, battalion: null, gambits: null };

export interface TeamPagesState {
  /** Hidden copies the pages are measured from; render once, anywhere in the window. */
  measure: ReactNode;
  enabled: boolean;
  slots: (string | null)[];
  byKey: Map<string, Unit>;
  chosen: Unit[];
  /** What each unit used in the battle, and its accessory and battalion, by unit key. */
  gear: Map<string, CardGear>;
  overview: TeamPage[];
  /** Pages before and after the replay, in order. */
  start: TeamPage[];
  end: TeamPage[];
  /** The roster's characters, for ordering (null until read). */
  characters: ReturnType<typeof buildRunLedger>["characters"] | null;
}

/** The picked units, the pages they make in this frame, and the hidden copies it takes to measure them. */
export function useTeamPages({ team, update, units, history, battle, part2, frame }: {
  team: TeamPagesOptions;
  update: (patch: Partial<TeamPagesOptions>) => void;
  units: Unit[];
  history: Battle[];
  /** The battle exported: each card lists what the unit used in it. */
  battle: Battle;
  part2: boolean;
  frame: PageFrame;
}): TeamPagesState {
  const byKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const enabled = team.overview && units.length > 0;
  // The run's battles as statistics see them (only units on the roster count), as Export Team reads them; they order the units.
  const ledger = useMemo(() => (units.length ? buildRunLedger(countedBattles(history, new Set(units.map((u) => u.key))), "characters") : null), [history, units]);
  const slots = useMemo(() => layoutSlots(team.placed, units.map((u) => u.key), PICKER_COLUMNS), [team.placed, units]);
  const left = useMemo(() => new Set(team.left), [team.left]);
  const chosen = useMemo(() => pickRows(slots, byKey, left, PICKER_COLUMNS, team.fallen).flat(), [slots, byKey, left, team.fallen]);
  const gear = useMemo(() => {
    const out = new Map<string, CardGear>();
    for (const u of units) {
      const b = battle.units.find((x) => x.key === u.key);
      out.set(u.key, {
        used: usageList(b?.usage, battle.log, u.key),
        accessory: battle.roster_snapshot ? u.accessory : equippedAccessory(b?.inventory, b?.accessory, u.accessory),
        battalion: battle.roster_snapshot ? u.battalion ?? null : gearName(b?.battalion, u.battalion),
        battalionId: battle.roster_snapshot ? u.battalion_id : b?.battalion ? b.battalion_id : u.battalion_id,
        gambits: gambitUses(b?.usage),
      });
    }
    return out;
  }, [units, battle]);

  // An order other than Custom lays every unit out again once the battles are read (joined and deployments need them).
  useEffect(() => {
    if (!ledger || team.order === "custom") return;
    const next = orderFor(units, team.order, ledger.characters);
    if (JSON.stringify(next) !== JSON.stringify(team.placed)) update({ placed: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, units, team.order]);

  // Hidden copies of every card at their natural size, measured for the pages.
  const host = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const key = `${chosen.map((u) => u.key).join(",")}|${team.face}`;
  useLayoutEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    const measure = () => {
      const cards = Array.from(el.querySelectorAll<HTMLElement>(".vcard"));
      if (!cards.length) return;
      const least = Math.min(...cards.map((c) => smallestText(c, "[data-asset-error]")).filter((n) => n > 0));
      const next: Measured = { keys: key, h: Math.max(...cards.map((n) => n.offsetHeight)), minText: Number.isFinite(least) ? least : 0 };
      setMeasured((now) => (now && JSON.stringify(now) === JSON.stringify(next) ? now : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [enabled, key]);

  const pages = useMemo(() => {
    if (!enabled || !measured || measured.keys !== key || !chosen.length) return [] as TeamPage[];
    const grid = planGrid({
      minText: measured.minText, frameShortSide: Math.min(frame.width, frame.height), card: { w: CARD_W, h: measured.h },
      roomWidth: frame.width - 2 * PAD, roomHeight: frame.height - 2 * PAD - frame.titleH - GAP, gap: CARD_GAP,
      columns: team.columns, rows: team.rows, count: chosen.length,
    });
    if (!grid) return [];
    const groups = chunk(chosen, grid.perPage);
    return groups.map((g, i): TeamPage => ({ id: `overview-${i + 1}`, number: i + 1, of: groups.length, units: g, all: chosen, grid }));
  }, [enabled, measured, key, chosen, frame.width, frame.height, frame.titleH, team.columns, team.rows]);

  const sides = sidesOf(team.overviewAt);
  const measure = enabled ? (
    <div ref={host} className="team-page-measure" aria-hidden>
      {chosen.map((u) => <div key={u.key} className="vcard-natural"><VideoUnitCard unit={u} part2={part2} face={team.face} markFallen={team.markFallen} gear={gear.get(u.key) ?? EMPTY_GEAR} /></div>)}
    </div>
  ) : null;
  return {
    measure, enabled, slots, byKey, chosen, gear,
    overview: pages,
    start: enabled && sides.includes("start") ? pages : [],
    end: enabled && sides.includes("end") ? pages : [],
    characters: ledger ? ledger.characters : null,
  };
}

/** One page, at the frame's exact size: the title strip (the run, the picture, "2 / 4") over the grid of cards. */
export function TeamPageView({ page, frame, run, part2, face, markFallen, gear, ref }: {
  page: TeamPage;
  frame: PageFrame;
  run: { name: string; route: RunRoute | null };
  part2: boolean;
  face: ExportFace;
  markFallen: boolean;
  gear: Map<string, CardGear>;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const g = page.grid;
  return (
    <div ref={ref} className={`team-page${frame.portrait ? " team-page-tall" : ""}`} style={{ width: frame.width, height: frame.height, gridTemplateRows: `${frame.titleH}px minmax(0, 1fr)` }}>
      <header className="replay-stage-title">
        <CardBanner title={`${run.name} · Team Overview`} icon={<RunIcon route={run.route} />} />
        <div className="replay-stage-meta">
          <span className="replay-stage-facts">{[plural(page.all.length, "unit"), page.of > 1 ? `${page.number} / ${page.of}` : null].filter(Boolean).join(" · ")}</span>
          <span className="replay-stage-credit">Divine Pulse <span>· by Adombs</span></span>
        </div>
      </header>
      <div className="team-page-body">
        <div className="team-page-fit" style={{ width: g.width * g.scale, height: g.height * g.scale }}>
          <div
            className="team-page-content"
            style={{
              width: g.width, height: g.height, gap: g.gap, transform: `scale(${g.scale})`, transformOrigin: "0 0",
              gridTemplateColumns: `repeat(${g.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${g.rows}, minmax(0, 1fr))`,
            }}
          >
            {page.units.map((u) => <VideoUnitCard key={u.key} unit={u} part2={part2} face={face} markFallen={markFallen} gear={gear.get(u.key) ?? EMPTY_GEAR} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Team tab: whether the overview is in the video and where, then which units in what order and with which faces. */
export function TeamPagesSection({ team, update, pages, units, part2 }: {
  team: TeamPagesOptions;
  update: (patch: Partial<TeamPagesOptions>) => void;
  pages: TeamPagesState;
  units: Unit[];
  part2: boolean;
}) {
  const small = pages.overview[0]?.grid.small ? pages.overview[0].grid : null;
  const fallenCount = units.filter((u) => u.death).length;
  const toggle = (key: string) => update({ left: team.left.includes(key) ? team.left.filter((k) => k !== key) : [...team.left, key] });
  return (
    <div className="team-tab">
      <div className="team-pages-choice">
        <label>
          <input type="checkbox" checked={team.overview} onChange={(e) => update({ overview: e.target.checked })} />
          Team overview
        </label>
        {team.overview && <Segmented<Placement> size="mini" label="Team overview placement" value={team.overviewAt} onChange={(overviewAt) => update({ overviewAt })} options={PLACEMENTS} />}
        {team.overview && pages.overview.length > 0 && <small className="team-pages-count" aria-live="polite">{plural(pages.overview.length, "page")}, {fmtSeconds(team.seconds)} each</small>}
      </div>
      {team.overview && (
        <div className="team-pages-grid">
          <AxisSlider label="Columns" max={MAX_COLUMNS} value={team.columns} onChange={(columns) => update({ columns })} />
          <AxisSlider label="Rows" max={MAX_ROWS} value={team.rows} onChange={(rows) => update({ rows })} />
          <SecondsSlider label="Each page" value={team.seconds} onChange={(seconds) => update({ seconds: seconds ?? DEFAULT_TEAM_PAGES.seconds })} />
          {small && <p className="team-pages-note" role="status">Text will be small at {small.columns} × {small.rows}</p>}
        </div>
      )}
      {team.overview && pages.chosen.length === 0 && (
        <p className="team-pages-note" role="status">No units are ticked, so there are no pages. Tick some under Units.</p>
      )}
      {team.overview && (
        <div className="team-pages-units">
          <div className="team-units-bar">
            <label className="team-order-by">
              Order
              <select value={team.order} onChange={(e) => {
                const order = e.target.value as OrderBy;
                update(order === "custom" || !pages.characters ? { order } : { order, placed: orderFor(units, order, pages.characters) });
              }}>
                <option value="custom">Custom</option>
                {ORDER_BY.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <div className="team-order-by">
              Faces
              <Segmented<ExportFace> size="mini" label="Faces" value={team.face} onChange={(face) => update({ face })} options={FACES} />
            </div>
          </div>
          <div className="team-units-bar">
            <span className="team-units-count">Units <small>{pages.chosen.length} of {units.length}</small></span>
            <button type="button" className="checklist-clear" onClick={() => update({ left: team.left.length ? [] : units.map((u) => u.key) })}>
              {team.left.length ? "Select all" : "Select none"}
            </button>
          </div>
          <div className="team-fallen-options" title={fallenCount ? undefined : "No unit has died in this run"}>
            <label className={`team-include-fallen${fallenCount ? "" : " is-disabled"}`}>
              <input type="checkbox" checked={team.fallen} disabled={!fallenCount} onChange={(e) => update({ fallen: e.target.checked })} />
              Include fallen units <small>{fallenCount || "none fallen"}</small>
            </label>
            <label className={`team-include-fallen${fallenCount ? "" : " is-disabled"}`}>
              <input type="checkbox" checked={team.markFallen} disabled={!fallenCount} onChange={(e) => update({ markFallen: e.target.checked })} />
              Mark fallen units
            </label>
          </div>
          <div className="team-units-grid">
            <UnitSlots slots={pages.slots} byKey={pages.byKey} left={new Set(team.left)} includeFallen={team.fallen} part2={part2} columns={PICKER_COLUMNS} onToggle={toggle} onPlace={(placed) => update({ placed, order: "custom" })} />
          </div>
        </div>
      )}
    </div>
  );
}

/** How long a page of the video stays on screen, as a slider over `PAGE_SECONDS`; with `auto`, an Auto stop (null) comes first. */
export function SecondsSlider({ label, value, onChange, auto }: { label: string; value: number | null; onChange: (v: number | null) => void; auto?: string }) {
  const offset = auto ? 1 : 0;
  const index = value === null ? 0 : Math.max(0, PAGE_SECONDS.indexOf(value)) + offset;
  const text = value === null ? `Auto${auto ? ` (${auto})` : ""}` : fmtSeconds(value);
  return (
    <StepSlider
      label={label}
      stops={PAGE_SECONDS.length + offset}
      value={index}
      onChange={(i) => onChange(auto && i === 0 ? null : PAGE_SECONDS[i - offset])}
      valueText={text}
      after={<span className="team-pages-axis-value">{value === null ? "Auto" : fmtSeconds(value)}</span>}
      variant="timeline"
      slim
    />
  );
}

/** A grid axis as a slider: Auto, then 1 to `max`. */
function AxisSlider({ label, max, value, onChange }: { label: string; max: number; value: Axis; onChange: (v: Axis) => void }) {
  return (
    <StepSlider
      label={label}
      stops={max + 1}
      value={value ?? 0}
      onChange={(i) => onChange(i === 0 ? null : i)}
      valueText={value ? `${value}` : "Auto"}
      after={<span className="team-pages-axis-value">{value ?? "Auto"}</span>}
      variant="timeline"
      slim
    />
  );
}
