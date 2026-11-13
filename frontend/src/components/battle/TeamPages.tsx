/**
 * Team pages for the video export (ReplayExport.tsx): the team's overview (a single column of the video's compact unit
 * cards, `VideoUnitCard`), as full frames shown before the replay, after it, or both, each for a second. A page draws the
 * cards at the size that keeps their smallest text legible in the frame (exporting/teamPages.ts has the arithmetic), as
 * many to a page as fit, flipping through pages until every unit picked is covered. The units, their order, fallen units
 * and faces follow Export Team's rules; each card's weapon or spell is the one the unit used most in the battle exported.
 */
import "./replay-export.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Battle, RunRoute, Unit } from "../../api";
import { plural } from "../../format";
import { featuredWeapon, type Featured } from "../../exporting/mostUsed";
import { chooseCardLayout, chunk, PLACEMENTS, sidesOf, type CardLayout, type Placement } from "../../exporting/teamPages";
import { CardBanner, RunIcon, Segmented } from "../ui";
import { FACES, layoutSlots, ORDER_BY, orderFor, pickRows, UnitSlots, type ExportFace, type OrderBy } from "../TeamExport";
import { buildRunLedger } from "./runStatsLedger";
import { countedBattles } from "./rosterRule";
import { VideoUnitCard, type CardShape } from "./TeamVideoCard";

/** The settings of the team pages, remembered with the video's other options. */
export interface TeamPagesOptions {
  overview: boolean;
  overviewAt: Placement;
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
  order: "joined:asc",
  fallen: true,
  face: "portrait",
  left: [],
  placed: [],
};

/** Team pages as saved, made safe to use (anything unknown falls back to its default; options this version no longer has, such as run statistics and the seconds a page stays, are dropped). */
export function sanitizeTeamPages(saved: unknown): TeamPagesOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof TeamPagesOptions, unknown>>;
  const placement = (v: unknown, fallback: Placement) => PLACEMENTS.find(([p]) => p === v)?.[0] ?? fallback;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, 500) : []);
  return {
    overview: s.overview === true,
    overviewAt: placement(s.overviewAt, DEFAULT_TEAM_PAGES.overviewAt),
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
  /** How the cards are drawn: on one line each, or stacked (a narrow frame). */
  shape: CardShape;
  /** 1-based, and how many pages there are. */
  number: number;
  of: number;
  units: Unit[];
  /** Every unit the pages cover. */
  all: Unit[];
  /** How many times bigger than natural the cards are drawn, and their natural width. */
  scale: number;
  contentW: number;
  /** How many cards fit a page of this frame. */
  perPage: number;
}

/** The shapes the pages choose between (`columns` only breaks a tie: the one-line card is preferred). */
const SHAPES: { shape: CardShape; columns: number }[] = [{ shape: "row", columns: 1 }, { shape: "stack", columns: 2 }];

/** What the hidden copy of the cards measures. */
interface Measured {
  keys: string;
  /** Each shape's card size, and the smallest text on a card. */
  layouts: (CardLayout & { shape: CardShape })[];
  cardText: number;
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

const finiteOr0 = (n: number) => (Number.isFinite(n) ? n : 0);

export interface TeamPagesState {
  /** Hidden copies the pages are measured from; render once, anywhere in the window. */
  measure: ReactNode;
  enabled: boolean;
  slots: (string | null)[];
  byKey: Map<string, Unit>;
  chosen: Unit[];
  /** Each unit's weapon or spell of the battle, by unit key. */
  featured: Map<string, Featured | null>;
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
  /** The battle exported: each card's weapon or spell is the unit's most used in it. */
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
  const featured = useMemo(() => {
    const out = new Map<string, Featured | null>();
    for (const u of units) {
      const inBattle = battle.units.find((b) => b.key === u.key);
      out.set(u.key, featuredWeapon(inBattle?.usage, battle.log, u.key, inBattle?.inventory?.length ? inBattle.inventory : u.inventory));
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

  // Hidden copies of every card (in each shape) at their natural size, measured for the pages.
  const host = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const key = `${chosen.map((u) => u.key).join(",")}|${team.face}`;
  useLayoutEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    const measure = () => {
      const layouts: Measured["layouts"] = [];
      for (const { shape, columns } of SHAPES) {
        const cards = Array.from(el.querySelectorAll<HTMLElement>(`[data-card-shape="${shape}"] .vcard`));
        if (!cards.length) continue;
        layouts.push({ shape, columns, w: Math.max(...cards.map((n) => n.offsetWidth)), h: Math.max(...cards.map((n) => n.offsetHeight)) });
      }
      const cardEls = Array.from(el.querySelectorAll<HTMLElement>('[data-card-shape="stack"] .vcard'));
      const next: Measured = { keys: key, layouts, cardText: finiteOr0(Math.min(...cardEls.map((c) => smallestText(c, "[data-asset-error]")).filter((n) => n > 0))) };
      setMeasured((now) => (now && JSON.stringify(now) === JSON.stringify(next) ? now : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [enabled, key]);

  const pages = useMemo(() => {
    if (!enabled || !measured || !measured.keys.startsWith(chosen.map((u) => u.key).join(",")) || !chosen.length) return [] as TeamPage[];
    const roomW = frame.width - 2 * PAD;
    const roomH = frame.height - 2 * PAD - frame.titleH - GAP;
    // The shape that lets the text be biggest in this frame (and then holds the most cards to a page).
    const pick = chooseCardLayout(measured.layouts, { minText: measured.cardText, frameHeight: frame.height, roomWidth: roomW, roomHeight: roomH, gap: CARD_GAP });
    if (!pick) return [];
    const groups = chunk(chosen, pick.perPage);
    return groups.map((g, i): TeamPage => ({ id: `overview-${i + 1}`, shape: pick.layout.shape, number: i + 1, of: groups.length, units: g, all: chosen, scale: pick.scale, contentW: pick.layout.w, perPage: pick.perPage }));
  }, [enabled, measured, chosen, frame.width, frame.height, frame.titleH]);

  const sides = sidesOf(team.overviewAt);
  const measure = enabled ? (
    <div ref={host} className="team-page-measure" aria-hidden>
      {SHAPES.map(({ shape }) => (
        <div key={shape} className="team-page-measure-cards" data-card-shape={shape}>
          {chosen.map((u) => <VideoUnitCard key={u.key} unit={u} part2={part2} face={team.face} shape={shape} featured={featured.get(u.key) ?? null} />)}
        </div>
      ))}
    </div>
  ) : null;
  return {
    measure, enabled, slots, byKey, chosen, featured,
    overview: pages,
    start: enabled && sides.includes("start") ? pages : [],
    end: enabled && sides.includes("end") ? pages : [],
    characters: ledger ? ledger.characters : null,
  };
}

/** One page, at the frame's exact size: the title strip (the run, the picture, "2 / 4") over the cards, centred. */
export function TeamPageView({ page, frame, run, part2, face, featured, ref }: {
  page: TeamPage;
  frame: PageFrame;
  run: { name: string; route: RunRoute | null };
  part2: boolean;
  face: ExportFace;
  featured: Map<string, Featured | null>;
  ref?: React.Ref<HTMLDivElement>;
}) {
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
        <div className="team-page-fit" style={{ width: page.contentW * page.scale }}>
          <div className="team-page-content" style={{ width: page.contentW, transform: `scale(${page.scale})`, transformOrigin: "0 0" }}>
            {page.units.map((u) => <VideoUnitCard key={u.key} unit={u} part2={part2} face={face} shape={page.shape} featured={featured.get(u.key) ?? null} />)}
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
        {team.overview && pages.overview.length > 0 && <small className="team-pages-count" aria-live="polite">{plural(pages.overview.length, "page")}, a second each</small>}
      </div>
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
            {fallenCount > 0 && (
              <label className="team-include-fallen">
                <input type="checkbox" checked={team.fallen} onChange={(e) => update({ fallen: e.target.checked })} />
                Fallen <small>{fallenCount}</small>
              </label>
            )}
            <button type="button" className="checklist-clear" onClick={() => update({ left: team.left.length ? [] : units.map((u) => u.key) })}>
              {team.left.length ? "Select all" : "Select none"}
            </button>
          </div>
          <div className="team-units-grid">
            <UnitSlots slots={pages.slots} byKey={pages.byKey} left={new Set(team.left)} includeFallen={team.fallen} part2={part2} columns={PICKER_COLUMNS} onToggle={toggle} onPlace={(placed) => update({ placed, order: "custom" })} />
          </div>
        </div>
      )}
    </div>
  );
}
