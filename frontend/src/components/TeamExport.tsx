/**
 * Export Team (the Roster page's header, beside Back): two images of the units picked (all of them unless some are
 * left out), previewed as they will be saved. Overview: each unit's stats, BST, equipment, spells, combat arts,
 * abilities and battalion as last read. Run statistics: each unit's combat and growth over the run's finished battles
 * (History's Character Stats, `buildRunLedger`) and its three most telling records.
 *
 * Both are drawn from the page itself (snapshot.ts), at 1.5 times their size here.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import "./team-export.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, LABELS, type Battle, type RunSummary, type Unit, type ValueKey } from "../api";
import { tidyAbility } from "../appearance";
import { plural } from "../format";
import { AbilityIcon, ArtIcon, ItemIcon } from "../reference/icons";
import { elementPng } from "../exporting/snapshot";
import { safeFilename, saveFiles } from "../exporting/save";
import { GearIcon } from "./battle/gameIcons";
import { AWARDS } from "./battle/moreStats";
import { buildRunLedger, type LedgerRow } from "./battle/runStatsLedger";
import { ExportActions, type ExportStatus } from "./ExportActions";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { CardBanner, Portrait, RunIcon } from "./ui";
import { THEME_OPTIONS, themeClass, useExportThemes, type ExportTheme } from "../exporting/theme";
import { StepSlider } from "./Slider";

/** Each image's width on the page (CSS pixels); it is saved at its chosen size (SIZES) times that. */
const WIDTH = 1500;
/** The image sizes offered: how many times the preview's size each image is saved at. */
const SIZES: [number, string][] = [
  [1, "Small: for chats and messages"],
  [1.5, "Medium: for most uses"],
  [2, "Large: for big screens"],
  [3, "Extra large: for printing"],
];
const IMAGE_OPTIONS_KEY = "divine-pulse-export-team";

/** The images' own options, remembered between exports: their size and theme, and which of the two to save. */
interface ImageOptions {
  size: number;
  theme: ExportTheme;
  loadouts: boolean;
  stats: boolean;
}
const DEFAULT_IMAGE_OPTIONS: ImageOptions = { size: 1.5, theme: "app", loadouts: true, stats: true };

function loadImageOptions(): ImageOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(IMAGE_OPTIONS_KEY) ?? "{}") as Partial<ImageOptions>;
    return {
      size: SIZES.some(([k]) => k === saved.size) ? saved.size! : DEFAULT_IMAGE_OPTIONS.size,
      theme: THEME_OPTIONS.some(([t]) => t === saved.theme) ? saved.theme! : DEFAULT_IMAGE_OPTIONS.theme,
      loadouts: saved.loadouts !== false,
      stats: saved.stats !== false,
    };
  } catch {
    return DEFAULT_IMAGE_OPTIONS;
  }
}

/** How many units the loadouts put side by side (the choices). */
const PER_ROW = [1, 2, 3, 4, 5, 6];
const LAYOUT_KEY = "divine-pulse-team-export-layout";

function readPerRow(): number {
  try {
    const saved = (JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as { perRow?: number }).perRow ?? 0;
    return PER_ROW.includes(saved) ? saved : 3;
  } catch {
    return 3;
  }
}

const STATS: ValueKey[] = ["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha", "mv"];
/** The stats a base stat total adds up (all but movement). */
const BST_STATS: ValueKey[] = ["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha"];

/** The unit's base stat total: its base stats added up, without bonuses from items, abilities or battalions. */
export const baseStatTotal = (unit: Unit) => BST_STATS.reduce((n, k) => n + (unit.base_values[k] ?? 0), 0);

export function TeamExportButton({ run, units, part2 }: { run: RunSummary; units: Unit[]; part2: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn small" onClick={() => setOpen(true)} disabled={!units.length} title={units.length ? "Save images of the team's loadouts and run statistics, to share" : "No units in this run yet"}>
        <Icon name={CONCEPT_ICON.share} /> Export Team
      </button>
      {open && <TeamExportDialog run={run} units={units} part2={part2} onClose={() => setOpen(false)} />}
    </>
  );
}

function TeamExportDialog({ run, units, part2, onClose }: { run: RunSummary; units: Unit[]; part2: boolean; onClose: () => void }) {
  const [left, setLeft] = useState<Set<string>>(new Set());
  // The units in the order the images show them (the roster's to begin with); dragging a row moves it.
  // The units in slots, row by row (`perRow` to a row) as the loadouts show them; a slot can be empty (null). They
  // start in the roster's order; dragging a unit to another slot moves it there, or swaps it with the one there.
  const [placed, setPlaced] = useState<(string | null)[]>(() => units.map((u) => u.key));
  const byKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  // How many units the loadouts put side by side (the unit list on the right is laid out the same way).
  const [perRow, setPerRow] = useState(readPerRow);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ perRow }));
    } catch {
      // Not kept; fine.
    }
  }, [perRow]);
  const slots = layoutSlots(placed, units.map((u) => u.key), perRow);
  // The images: each row of slots with the units it includes (rows left with none drop out), and those units in order.
  const rows: Unit[][] = [];
  for (let i = 0; i < slots.length; i += perRow) {
    const row = slots.slice(i, i + perRow).filter((k): k is string => k !== null && !left.has(k)).map((k) => byKey.get(k)!);
    if (row.length) rows.push(row);
  }
  const chosen = rows.flat();
  const toggle = (key: string) => setLeft((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  // The run's battles, for its statistics.
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.battles(run.id).then(
      (b) => { if (live) setBattles(b); },
      (e: unknown) => { if (live) setLoadError((e as Error).message || "The run's battles couldn't be read."); },
    );
    return () => { live = false; };
  }, [run.id]);
  const ledger = useMemo(() => (battles ? buildRunLedger(battles, "characters") : null), [battles]);
  // Ordering every unit at once: by BST, by deployments or by when they joined (each a fresh layout with no gaps), or
  // "custom" once a unit is dragged.
  const [orderBy, setOrderBy] = useState<OrderBy>("custom");
  const applyOrder = (by: OrderBy) => {
    setOrderBy(by);
    if (by !== "custom") setPlaced(orderUnits(units, by, ledger?.characters ?? []));
  };

  useExportThemes();
  const [options, setOptionsState] = useState<ImageOptions>(loadImageOptions);
  const setOption = <K extends keyof ImageOptions>(key: K, value: ImageOptions[K]) => setOptionsState((o) => {
    const next = { ...o, [key]: value };
    try {
      localStorage.setItem(IMAGE_OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Not kept; fine.
    }
    return next;
  });
  const loadouts = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLDivElement>(null);
  // Each image's size on the page (its saved size is that times the chosen size), kept up to date as it changes.
  const [sizes, setSizes] = useState<{ overview: [number, number]; stats: [number, number] }>({ overview: [0, 0], stats: [0, 0] });
  useEffect(() => {
    const measure = () => setSizes({
      overview: [loadouts.current?.offsetWidth ?? 0, loadouts.current?.offsetHeight ?? 0],
      stats: [stats.current?.offsetWidth ?? 0, stats.current?.offsetHeight ?? 0],
    });
    const observer = new ResizeObserver(measure);
    if (loadouts.current) observer.observe(loadouts.current);
    if (stats.current) observer.observe(stats.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const pixels = ([w, h]: [number, number]) => `${Math.round(w * options.size).toLocaleString()} × ${Math.round(h * options.size).toLocaleString()} px`;
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const working = status.kind === "working";
  const base = safeFilename(run.name);

  const wanted = [
    ...(options.loadouts ? [{ el: loadouts, name: `${base} team overview.png` }] : []),
    ...(options.stats ? [{ el: stats, name: `${base} team run stats.png` }] : []),
  ];
  const exportImages = async () => {
    if (!wanted.length || wanted.some((w) => !w.el.current)) return;
    setStatus({ kind: "working", done: 0, total: wanted.length, label: "Making the images" });
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const w of wanted) {
        files.push({ name: w.name, blob: await elementPng(w.el.current!, options.size) });
        setStatus({ kind: "working", done: files.length, total: wanted.length, label: "Making the images" });
      }
      const saved = await saveFiles("png", files);
      setStatus(saved ? { kind: "saved", where: saved } : { kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message || "The images couldn't be made." });
    }
  };

  return (
    <Modal open wide className="team-export-modal" title="Export Team" onClose={() => { if (!working) onClose(); }}>
      <div className="team-export">
        <div className="team-export-preview" aria-label="Preview">
          <figure className="team-export-figure">
            <figcaption>Overview</figcaption>
            <FitWidth>
              <TeamSheet ref={loadouts} run={run} units={chosen} title="Team Overview" className="team-sheet-loadouts" theme={options.theme}>
                <div className="team-rows">
                  {rows.map((row, r) => (
                    <div key={r} className="team-row">
                      {row.map((u) => <LoadoutCard key={u.key} unit={u} part2={part2} />)}
                    </div>
                  ))}
                </div>
              </TeamSheet>
            </FitWidth>
          </figure>
          <figure className="team-export-figure">
            <figcaption>Run statistics</figcaption>
            <FitWidth width={WIDTH}>
              <TeamSheet ref={stats} run={run} units={chosen} title="Team Run Statistics" theme={options.theme} note={ledger ? plural(ledger.battles.length, "finished battle") : undefined}>
                {ledger ? <StatsTable units={chosen} rows={ledger.rows} totals={ledger.totals.records} part2={part2} />
                  : <p className="muted">{loadError ?? "Reading the run's battles…"}</p>}
              </TeamSheet>
            </FitWidth>
          </figure>
        </div>
        <aside className="export-side" aria-label="Team options">
          <fieldset className="export-group team-layout" disabled={working}>
            <legend>Overview</legend>
            <StepSlider
              label="Units per row"
              stops={PER_ROW.length}
              value={PER_ROW.indexOf(perRow)}
              onChange={(i) => setPerRow(PER_ROW[i])}
              valueText={`${perRow} side by side`}
              variant="timeline"
              slim
              after={<span className="team-layout-value">{perRow}</span>}
            />
          </fieldset>
          <fieldset className="export-group checklist team-export-units" disabled={working}>
            <legend>
              Units
              <button type="button" className="checklist-clear" onClick={() => setLeft(left.size ? new Set() : new Set(units.map((u) => u.key)))}>
                {left.size ? "Select all" : "Select none"}
              </button>
            </legend>
            <label className="team-order-by">
              Order
              <select value={orderBy} onChange={(e) => applyOrder(e.target.value as OrderBy)}>
                <option value="custom">Custom</option>
                {ORDER_BY.map(([id, label]) => (
                  <option key={id} value={id} disabled={(id === "deployments" || id === "joined") && !ledger}>{label}</option>
                ))}
              </select>
            </label>
            <UnitSlots slots={slots} byKey={byKey} left={left} part2={part2} columns={perRow} onToggle={toggle} onPlace={(next) => { setPlaced(next); setOrderBy("custom"); }} />
          </fieldset>
          <fieldset className="export-group" disabled={working}>
            <legend>Images</legend>
            <div className="team-images">
              <label>
                <input type="checkbox" checked={options.loadouts} onChange={(e) => setOption("loadouts", e.target.checked)} />
                Overview
              </label>
              <label>
                <input type="checkbox" checked={options.stats} onChange={(e) => setOption("stats", e.target.checked)} />
                Run statistics
              </label>
            </div>
            <div className="export-pairs">
              <label className="wide">
                Size
                <select value={options.size} onChange={(e) => setOption("size", Number(e.target.value))}>
                  {SIZES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              {(options.loadouts || options.stats) && (
                <p className="export-sizes wide">
                  {options.loadouts && <span>Overview <b>{pixels(sizes.overview)}</b></span>}
                  {options.stats && <span>Run statistics <b>{pixels(sizes.stats)}</b></span>}
                </p>
              )}
              <label className="wide">
                Theme
                <select value={options.theme} onChange={(e) => setOption("theme", e.target.value as ExportTheme)}>
                  {THEME_OPTIONS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
          <ExportActions
            facts={[plural(chosen.length, "unit"), wanted.length ? plural(wanted.length, "PNG image") : "No images picked"]}
            status={status}
            action={wanted.length === 1 ? "Export image…" : "Export images…"}
            disabled={!chosen.length || !wanted.length || (options.stats && !ledger)}
            onExport={() => void exportImages()}
          />
        </aside>
      </div>
    </Modal>
  );
}

type OrderBy = "custom" | "bst" | "deployments" | "joined" | "name";

/** The ways to order every unit at once (besides arranging them by hand). */
const ORDER_BY: [Exclude<OrderBy, "custom">, string][] = [
  ["bst", "BST (highest first)"],
  ["deployments", "Deployments (most first)"],
  ["joined", "Joined (first battle, earliest first)"],
  ["name", "Name"],
];

/**
 * The units' keys in the order asked for. Deployments and joining come from the run's finished battles: joined is
 * when a unit first fought, those who never have go last in the roster's order. Ties keep the roster's order.
 */
export function orderUnits(units: Unit[], by: Exclude<OrderBy, "custom">, characters: { key: string; battles: number; appearances: { battle: { started_at: string } }[] }[]): string[] {
  const stats = new Map(characters.map((c) => [c.key, c]));
  const joined = (u: Unit) => {
    const times = stats.get(u.key)?.appearances.map((a) => a.battle.started_at) ?? [];
    return times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
  };
  const value: Record<typeof by, (a: Unit, b: Unit) => number> = {
    bst: (a, b) => baseStatTotal(b) - baseStatTotal(a),
    deployments: (a, b) => (stats.get(b.key)?.battles ?? 0) - (stats.get(a.key)?.battles ?? 0),
    joined: (a, b) => {
      const [ja, jb] = [joined(a), joined(b)];
      return ja === jb ? 0 : ja === null ? 1 : jb === null ? -1 : ja.localeCompare(jb);
    },
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return units.map((u, i) => ({ u, i })).sort((a, b) => value[by](a.u, b.u) || a.i - b.i).map(({ u }) => u.key);
}

/**
 * The slots, as shown: `placed` with units it no longer has emptied, units it doesn't have yet put in its first empty
 * slots (or after the last), the empty slots at the end let go, then one empty row more to move units into.
 */
export function layoutSlots(placed: (string | null)[], keys: string[], perRow: number): (string | null)[] {
  const have = new Set(keys);
  const slots = placed.map((k) => (k !== null && have.has(k) ? k : null));
  for (const key of keys) {
    if (slots.includes(key)) continue;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = key;
    else slots.push(key);
  }
  while (slots.length && slots[slots.length - 1] === null) slots.pop();
  const rows = Math.ceil(slots.length / perRow) + 1;
  return [...slots, ...Array<null>(rows * perRow - slots.length).fill(null)];
}

/** `slots` with the unit in slot `from` moved to slot `to`, swapping places with the unit there, if any. */
export function moveSlot(slots: (string | null)[], from: number, to: number): (string | null)[] {
  const next = [...slots];
  [next[from], next[to]] = [next[to] ?? null, next[from] ?? null];
  return next;
}

/**
 * The units to include, in slots laid out as the loadouts are (`columns` to a row): a box to leave one out, and a
 * handle (six dots) to drag it to another slot, empty or not (they swap). Alt and an arrow key move the focused one
 * to the next slot that way.
 */
function UnitSlots({ slots, byKey, left, part2, columns, onToggle, onPlace }: {
  slots: (string | null)[];
  byKey: Map<string, Unit>;
  left: Set<string>;
  part2: boolean;
  columns: number;
  onToggle: (key: string) => void;
  onPlace: (slots: (string | null)[]) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // The slot being dragged from, and the one under the pointer.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const slotAt = (x: number, y: number) => (Array.from(list.current?.children ?? []) as HTMLElement[]).findIndex((el) => {
    const b = el.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  });
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from, over: from });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const over = slotAt(e.clientX, e.clientY);
    if (over >= 0 && over !== drag.over) setDrag({ ...drag, over });
  };
  const onPointerUp = () => {
    if (drag && drag.over !== drag.from) onPlace(moveSlot(slots, drag.from, drag.over));
    setDrag(null);
  };
  return (
    <ol className={`checklist-items team-order${drag ? " sorting" : ""}${columns > 2 ? " compact" : ""}`} ref={list} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label="Units, in the images' order">
      {slots.map((key, i) => {
        const u = key ? byKey.get(key) : undefined;
        const classes = [drag?.from === i ? "dragging" : "", drag && drag.over === i && drag.from !== i ? "over" : ""];
        if (!u) return <li key={`empty-${i}`} className={["empty", ...classes].join(" ")} aria-label={`Empty slot ${i + 1}`} />;
        return (
          <li key={u.key} data-key={u.key} className={[left.has(u.key) ? "" : "on", ...classes].join(" ")}>
            <span
              className="team-order-handle"
              role="button"
              tabIndex={0}
              aria-label={`Move ${u.name} (slot ${i + 1}); Alt and an arrow key`}
              title="Drag to another slot"
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
                if (!e.altKey || step === undefined) return;
                e.preventDefault();
                const to = i + step;
                if (to < 0 || to >= slots.length) return;
                onPlace(moveSlot(slots, i, to));
                // Keep the handle focused where the unit went.
                requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(u.key)}"] .team-order-handle`)?.focus());
              }}
            >
              <Icon name={CONCEPT_ICON.drag} />
            </span>
            <label title={u.name}>
              <input type="checkbox" checked={!left.has(u.key)} onChange={() => onToggle(u.key)} />
              <Portrait unit={u} part2={part2} size={24} />
              <span className="team-order-name">{u.name}</span>
            </label>
          </li>
        );
      })}
    </ol>
  );
}

/** An image at its real width (`width`, or as wide as its content), scaled down to fit the preview's width. */
function FitWidth({ width, children }: { width?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    const measure = () => setSize([box.current?.clientWidth ?? 0, inner.current?.offsetWidth ?? 0, inner.current?.offsetHeight ?? 0]);
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, []);
  const k = size[0] && size[1] ? Math.min(1, size[0] / size[1]) : 0;
  return (
    <div className="team-export-room" ref={box}>
      <div className="team-export-fit" style={{ height: size[2] * k, width: size[1] * k || undefined }}>
        <div ref={inner} style={{ width: width ?? "max-content", transform: `scale(${k})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
    </div>
  );
}

/** One image: the run's banner with the date and the credit, then its body. */
function TeamSheet({ run, units, title, note, className, theme, children, ref }: { run: RunSummary; units: Unit[]; title: string; note?: string; className?: string; theme: ExportTheme; children: ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return (
    // The picture is taken of the outer box: it carries the image's theme, so the sheet inside is drawn in it.
    <div ref={ref} className={`team-sheet-theme ${themeClass(theme)}`}>
      <div className={`team-sheet${className ? ` ${className}` : ""}`}>
        <header className="team-sheet-title">
          <CardBanner title={`${run.name} · ${title}`} icon={<RunIcon route={run.route} />} />
          <div className="team-sheet-meta">
            <span>{[plural(units.length, "unit"), note, date].filter(Boolean).join(" · ")}</span>
            <span className="team-sheet-credit">Divine Pulse <span>· by Adombs</span></span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

/** One thing on a loadout card: the head (who, BST, stats), a section's title, one of its lines, or the battalion. A
 * title stays with the line after it. */
interface Piece {
  key: string;
  node: ReactNode;
  title?: boolean;
}

/** A loadout card's columns: each this wide (px), the space between them and between pieces, and its padding. */
const CARD_COLUMN = 244;
const CARD_GAP = 14;
const PIECE_GAP = 2;
const CARD_PAD = 12;

/**
 * Packs pieces of the given heights into columns no taller than `room`, in order: a piece that doesn't fit starts the
 * next column, and so does a title whose first line wouldn't fit under it. A section's lines carry straight on into
 * the next column (its title isn't shown again). A piece taller than the room gets a column of its own.
 */
export function packColumns(heights: number[], titles: boolean[], room: number): number[][] {
  const columns: number[][] = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    const need = titles[i] && i + 1 < heights.length ? h + PIECE_GAP + heights[i + 1] : h;
    if (used > 0 && used + PIECE_GAP + need > room) {
      columns.push([]);
      used = 0;
    }
    columns[columns.length - 1].push(i);
    used += (used > 0 ? PIECE_GAP : 0) + h;
  });
  return columns;
}

/** A unit's loadout: who it is, its stats and BST, then what it carries and knows in columns beside that, no taller
 * than it, so every card is the same height. */
function LoadoutCard({ unit, part2 }: { unit: Unit; part2: boolean }) {
  const carried = (unit.inventory ?? []).filter((it) => it.kind !== "spell");
  const spells = (unit.inventory ?? []).filter((it) => it.kind === "spell");
  const abilities = [unit.personal_ability, ...unit.abilities].filter(Boolean).map(tidyAbility);
  const pieces: Piece[] = [{
    key: "head",
    node: (
      <div className="team-card-top">
        <header className="team-card-head">
          <Portrait unit={unit} part2={part2} size={64} />
          <div className="team-card-name">
            <b>{unit.name}</b>
            <span>{unit.class_name || "—"}</span>
          </div>
          <span className="team-card-bst" title="Base stat total: the base stats added up, without bonuses">
            <small>BST</small>
            {baseStatTotal(unit)}
          </span>
        </header>
        <dl className="team-card-stats">
          {STATS.map((k) => (
            <div key={k} className={unit.blue.includes(k) ? "boosted" : undefined}>
              <dt>{LABELS[k]}</dt>
              <dd>{unit.displayed[k]}</dd>
            </div>
          ))}
        </dl>
      </div>
    ),
  }];
  const section = (title: string, lines: { key: string; icon: ReactNode; name: string; uses?: string }[]) => {
    if (!lines.length) return;
    pieces.push({ key: `title-${title}`, title: true, node: <h4 className="team-gear-title">{title}</h4> });
    for (const line of lines) {
      pieces.push({
        key: `${title}-${line.key}`,
        node: (
          <div className="team-gear-line">
            {line.icon}
            <span className="team-gear-name">{line.name}</span>
            {line.uses && <span className="team-gear-uses">{line.uses}</span>}
          </div>
        ),
      });
    }
  };
  section("Equipment", [
    ...carried.map((it, i) => ({ key: `${it.id}-${i}`, icon: <GearIcon kind={it.kind === "other" ? "item" : it.kind} weapon={it.weapon} name={it.name} />, name: it.name, uses: it.full ? `${it.uses}/${it.full}` : `×${it.uses}` })),
    ...(unit.accessory && !carried.some((it) => it.name === unit.accessory) ? [{ key: "accessory", icon: <ItemIcon name={unit.accessory} />, name: unit.accessory }] : []),
  ]);
  section("Spells", spells.map((it, i) => ({ key: `${it.id}-${i}`, icon: <GearIcon kind="spell" weapon={it.weapon} name={it.name} />, name: it.name, uses: it.full ? `${it.uses}/${it.full}` : String(it.uses) })));
  section("Combat Arts", (unit.combat_arts ?? []).map((a) => ({ key: a, icon: <ArtIcon name={a} />, name: a })));
  section("Abilities", abilities.map((a, i) => ({ key: `${a}-${i}`, icon: <AbilityIcon name={a} />, name: a })));
  pieces.push({
    key: "battalion",
    node: (
      <p className="team-card-battalion">
        <Icon name={CONCEPT_ICON.battalion} />
        {unit.battalion || (unit.battalion === "" ? "No battalion" : "Battalion not read yet")}
      </p>
    ),
  });

  // Each piece is measured where it is drawn (a column's width doesn't change its height), then packed into columns.
  const card = useRef<HTMLElement>(null);
  const whole = [pieces.map((_, i) => i)];
  const [columns, setColumns] = useState<number[][]>(whole);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const heights: number[] = [];
    for (const node of Array.from(el.querySelectorAll<HTMLElement>("[data-piece]"))) heights[Number(node.dataset.piece)] = node.offsetHeight;
    if (heights.length !== pieces.length || heights.some((h) => h === undefined)) return;
    const next = packColumns(heights, pieces.map((p) => !!p.title), heights[0]);
    setColumns((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
  }); // every render: cheap, and settles after one pass since a piece's height doesn't depend on its column
  const shown = columns.flat().length === pieces.length ? columns : whole;
  return (
    <article ref={card} className="team-card" style={{ padding: CARD_PAD, gap: CARD_GAP }}>
      {shown.map((column, c) => (
        <div key={c} className="team-card-col" style={{ width: CARD_COLUMN, gap: PIECE_GAP }}>
          {column.map((i) => (
            <div key={pieces[i].key} data-piece={i} className={pieces[i].title ? "team-piece title" : "team-piece"}>
              {pieces[i].node}
            </div>
          ))}
        </div>
      ))}
    </article>
  );
}

const COMBAT = ["Battles", "Fights", "Kills", "Dealt", "Taken", "Healing", "Received", "Tiles"];
const GROWTH = ["Level-ups", "Stat ups", "Weapon attacks", "Spells", "Items"];

/** Records worth showing first: a Bench Warmer counts for half (it says least about how a unit fought). */
const RECORD_WEIGHT: Partial<Record<string, number>> = { bench: 0.5 };

/**
 * A unit's three most telling records: those it holds the biggest share of across the run (ties: the most times
 * received, then the order History lists them). Battle-wide records (no one unit's) are left out.
 */
export function topRecords(row: LedgerRow | undefined, totals: (number | null)[], n = 3): { key: string; title: string; icon: string; count: number }[] {
  if (!row) return [];
  return AWARDS.map((a, i) => ({ a, i, count: row.values.records[i] ?? 0, total: totals[i] ?? 0 }))
    .filter((r) => !("battleWide" in r.a) && r.count > 0)
    .map((r) => ({ ...r, score: (r.count / Math.max(r.count, r.total)) * (RECORD_WEIGHT[r.a.key] ?? 1) }))
    .sort((x, y) => y.score - x.score || y.count - x.count || x.i - y.i)
    .slice(0, n)
    .map((r) => ({ key: r.a.key, title: r.a.title, icon: r.a.icon, count: r.count }));
}

const cell = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString());

/** The picked units' run statistics, one row each, with the team's totals. */
function StatsTable({ units, rows, totals, part2 }: { units: Unit[]; rows: LedgerRow[]; totals: (number | null)[]; part2: boolean }) {
  const byKey = new Map(rows.map((r) => [r.id, r]));
  const sum = (part: "combat" | "growth", i: number) => {
    const values = units.map((u) => byKey.get(u.key)?.values[part][i]);
    return values.some((v) => v !== null && v !== undefined) ? values.reduce<number>((n, v) => n + (v ?? 0), 0) : null;
  };
  return (
    <table className="team-stats">
      <thead>
        <tr className="team-stats-groups">
          <th />
          <th colSpan={COMBAT.length}>Combat</th>
          <th colSpan={GROWTH.length}>Growth</th>
          <th>Top records</th>
        </tr>
        <tr>
          <th className="team-stats-unit">Unit</th>
          {COMBAT.map((c, i) => <th key={c} className={i === 0 ? "group-start" : ""}>{c}</th>)}
          {GROWTH.map((c, i) => <th key={c} className={i === 0 ? "group-start" : ""}>{c}</th>)}
          <th className="group-start team-stats-records">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {units.map((u) => {
          const row = byKey.get(u.key);
          const top = topRecords(row, totals);
          return (
            <tr key={u.key} className={row ? "" : "unrecorded"}>
              <th scope="row" className="team-stats-unit">
                <span>
                  <Portrait unit={u} part2={part2} size={32} />
                  <span>
                    <b>{u.name}</b>
                    <small>{u.class_name}</small>
                  </span>
                </span>
              </th>
              {COMBAT.map((c, i) => <td key={c} className={i === 0 ? "group-start" : ""}>{row ? cell(row.values.combat[i]) : "—"}</td>)}
              {GROWTH.map((c, i) => <td key={c} className={i === 0 ? "group-start" : ""}>{row ? cell(row.values.growth[i]) : "—"}</td>)}
              <td className="group-start team-stats-records">
                {top.length ? (
                  <span className="team-records">
                    {top.map((r) => (
                      <span key={r.key} className="team-record">
                        <Icon name={CONCEPT_ICON[r.icon as keyof typeof CONCEPT_ICON]} />
                        {r.title}
                        {r.count > 1 && <b>×{r.count}</b>}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">{row ? "None yet" : "No battles yet"}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="team-stats-unit">Team</th>
          {COMBAT.map((c, i) => <td key={c} className={i === 0 ? "group-start" : ""}>{cell(sum("combat", i))}</td>)}
          {GROWTH.map((c, i) => <td key={c} className={i === 0 ? "group-start" : ""}>{cell(sum("growth", i))}</td>)}
          <td className="group-start" />
        </tr>
      </tfoot>
    </table>
  );
}
