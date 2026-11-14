/**
 * Export Team (the Roster page's header, beside Back): two images of the units picked (all of them unless some are
 * left out), previewed as they will be saved. Overview: each unit's portrait and map sprite, stats, BST, equipment, spells, combat arts,
 * abilities, mastered classes and battalion as last read. Run statistics: each unit's combat and growth over the run's finished battles
 * (History's Character Stats, `buildRunLedger`) and its three most telling records.
 *
 * Both are drawn from the page itself (snapshot.ts), at 1.5 times their size here. Each is as big as its content (Auto),
 * or padded out to an aspect ratio (the video export's: 16:9, 1.91:1, 9:16, 4:5), the content in the middle.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import "./team-export.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, LABELS, type Battle, type RunSummary, type Unit, type ValueKey } from "../api";
import { tidyAbility } from "../appearance";
import { plural } from "../format";
import { SCORE_EXPLANATION, fmtScore } from "../score";
import { deathText } from "../deaths";
import { masteredClasses } from "../classMastery";
import { useReference } from "../reference/types";
import { TierIcon } from "./reference/TierIcon";
import { AbilityIcon, ArtIcon, ItemIcon } from "../reference/icons";
import { elementPng, picturePixels, pictureSize } from "../exporting/snapshot";
import { safeFilename, saveFiles } from "../exporting/save";
import { GearIcon } from "./battle/gameIcons";
import { SpriteFigure, unitSprite, useHasSprite } from "./character/CharacterFace";
import { AWARDS } from "./battle/moreStats";
import { isByleth } from "../portraits";
import { buildRunLedger, type LedgerRow } from "./battle/runStatsLedger";
import { countedBattles } from "./battle/rosterRule";
import { ExportActions, type ExportStatus } from "./ExportActions";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { CardBanner, Portrait, RunIcon, Segmented } from "./ui";
import { StepSlider } from "./Slider";

/** The run statistics image's least width on the page (CSS pixels); it is saved at its chosen size (SIZES) times its size. */
const WIDTH = 1500;
/** The image sizes offered: how many times the preview's size each image is saved at. */
export const SIZES: [number, string][] = [
  [1, "S"],
  [1.5, "M"],
  [2, "L"],
  [3, "XL"],
];
/** The images' shapes: as big as the content (auto), or padded out to a width over height. */
export type Aspect = "auto" | "16:9" | "1.91:1" | "9:16" | "4:5";
export const ASPECTS: [Aspect, string, string][] = [
  ["auto", "Auto", "As big as the content"],
  ["16:9", "16:9", "Padded out to 16:9"],
  ["1.91:1", "1.91:1", "Padded out to 1.91:1"],
  ["9:16", "9:16", "Padded out to 9:16"],
  ["4:5", "4:5", "Padded out to 4:5"],
];
export const ASPECT_RATIO: Record<Exclude<Aspect, "auto">, number> = { "16:9": 16 / 9, "1.91:1": 1.91, "9:16": 9 / 16, "4:5": 4 / 5 };
const IMAGE_OPTIONS_KEY = "divine-pulse-export-team";

/** The images' own options, remembered between exports: their size, and which of the two to save. */
interface ImageOptions {
  size: number;
  loadouts: boolean;
  stats: boolean;
  /** Whether units that died (Classic mode) are in the images (greyed). */
  fallen: boolean;
  /** How a unit's face is drawn: its portrait or its map sprite. */
  face: ExportFace;
  /** The images' shape. */
  aspect: Aspect;
}
export type ExportFace = "portrait" | "sprite";
export const FACES: [ExportFace, string][] = [
  ["portrait", "Portrait"],
  ["sprite", "Sprite"],
];
const DEFAULT_IMAGE_OPTIONS: ImageOptions = { size: 1.5, loadouts: true, stats: true, fallen: true, face: "portrait", aspect: "auto" };

function loadImageOptions(): ImageOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(IMAGE_OPTIONS_KEY) ?? "{}") as Partial<ImageOptions>;
    return {
      size: SIZES.some(([k]) => k === saved.size) ? saved.size! : DEFAULT_IMAGE_OPTIONS.size,
      loadouts: saved.loadouts !== false,
      stats: saved.stats !== false,
      fallen: saved.fallen !== false,
      face: FACES.some(([f]) => f === saved.face) ? saved.face! : DEFAULT_IMAGE_OPTIONS.face,
      aspect: ASPECTS.some(([a]) => a === saved.aspect) ? saved.aspect! : DEFAULT_IMAGE_OPTIONS.aspect,
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

export const STATS: ValueKey[] = ["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha", "mv"];
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
  const [placed, setPlaced] = useState<(string | null)[]>(() => orderUnits(units, "joined", []));
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
  const slots = layoutSlots(placed, units.map((u) => u.key), perRow);
  // The images: each row of slots with the units it includes (rows left with none drop out), and those units in order.
  const rows = pickRows(slots, byKey, left, perRow, options.fallen);
  const chosen = rows.flat();
  const fallenCount = units.filter((u) => u.death).length;
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
  // Only units on the run's roster count (a guest's battle data is left out).
  const ledger = useMemo(() => (battles ? buildRunLedger(countedBattles(battles, new Set(units.map((u) => u.key))), "characters") : null), [battles, units]);
  // Ordering every unit at once: by BST, by deployments or by when they joined (each a fresh layout with no gaps), or
  // "custom" once a unit is dragged.
  const [orderBy, setOrderBy] = useState<OrderBy>("joined:asc");
  // The join order needs the run's battles, so it is laid out again once they are read (unless a unit was moved by hand).
  useEffect(() => {
    if (ledger && orderBy !== "custom") setPlaced(orderFor(units, orderBy, ledger.characters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger]);
  const applyOrder = (by: OrderBy) => {
    setOrderBy(by);
    if (by !== "custom") setPlaced(orderFor(units, by, ledger?.characters ?? []));
  };

  const loadouts = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLDivElement>(null);
  // Each image's size on the page (its saved size is that times the chosen size), kept up to date as it changes.
  const [sizes, setSizes] = useState<{ overview: [number, number]; stats: [number, number] }>({ overview: [0, 0], stats: [0, 0] });
  useEffect(() => {
    const measure = () => setSizes({
      overview: loadouts.current ? pictureSize(loadouts.current) : [0, 0],
      stats: stats.current ? pictureSize(stats.current) : [0, 0],
    });
    const observer = new ResizeObserver(measure);
    if (loadouts.current) observer.observe(loadouts.current);
    if (stats.current) observer.observe(stats.current);
    measure();
    return () => observer.disconnect();
  }, []);
  // Exactly the saved PNG's size (elementPng makes it from the same measure).
  const pixels = (size: [number, number]) => picturePixels(size, options.size).map((n) => n.toLocaleString()).join(" × ") + " px";
  // Each preview fits the window by default; "Full size" shows it as the page draws it, to read, scrolling sideways.
  const [fullSize, setFullSize] = useState({ overview: false, stats: false });
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
            <figcaption>
              Overview
              <Segmented size="mini" label="Overview preview" value={fullSize.overview ? "full" : "fit"} onChange={(v) => setFullSize((f) => ({ ...f, overview: v === "full" }))} options={[["fit", "Fit", "Shrink to the window"], ["full", "Full size", "As drawn, to read the details"]]} />
            </figcaption>
            <FitWidth actual={fullSize.overview}>
              <TeamSheet ref={loadouts} run={run} units={chosen} title="Team Overview" className="team-sheet-loadouts" width={900} aspect={options.aspect}>
                <div className="team-rows">
                  {rows.map((row, r) => (
                    <div key={r} className="team-row">
                      {row.map((u) => <LoadoutCard key={u.key} unit={u} part2={part2} face={options.face} />)}
                    </div>
                  ))}
                </div>
              </TeamSheet>
            </FitWidth>
          </figure>
          <figure className="team-export-figure">
            <figcaption>
              Run statistics
              <Segmented size="mini" label="Run statistics preview" value={fullSize.stats ? "full" : "fit"} onChange={(v) => setFullSize((f) => ({ ...f, stats: v === "full" }))} options={[["fit", "Fit", "Shrink to the window"], ["full", "Full size", "As drawn, to read the details"]]} />
            </figcaption>
            <FitWidth actual={fullSize.stats}>
              <TeamSheet ref={stats} run={run} units={chosen} title="Team Run Statistics" width={WIDTH} aspect={options.aspect} note={ledger ? plural(ledger.battles.length, "finished battle") : undefined}>
                {ledger ? <StatsTable units={chosen} rows={ledger.rows} totals={ledger.totals.records} part2={part2} face={options.face} />
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
                  <option key={id} value={id} disabled={id.startsWith("deployments") && !ledger}>{label}</option>
                ))}
              </select>
            </label>
            <label className={`team-include-fallen${fallenCount ? "" : " is-disabled"}`} title={fallenCount ? undefined : "No unit has died in this run"}>
              <input type="checkbox" checked={options.fallen} disabled={!fallenCount} onChange={(e) => setOption("fallen", e.target.checked)} />
              Include fallen units
              <small>{fallenCount || "none fallen"}</small>
            </label>
            <UnitSlots slots={slots} byKey={byKey} left={left} includeFallen={options.fallen} part2={part2} columns={perRow} onToggle={toggle} onPlace={(next) => { setPlaced(next); setOrderBy("custom"); }} />
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
              <div className="wide team-choice">
                <span className="field-label">Aspect ratio</span>
                <Segmented<Aspect> label="Aspect ratio" value={options.aspect} onChange={(v) => setOption("aspect", v)} options={ASPECTS} />
              </div>
              <div className="wide team-choice">
                <span className="field-label">Size</span>
                <Segmented<string> label="Image size" value={String(options.size)} onChange={(v) => setOption("size", Number(v))} options={SIZES.map(([k, label]) => [String(k), label] as const)} />
              </div>
              {(options.loadouts || options.stats) && (
                <p className="export-sizes wide">
                  {options.loadouts && <span>Overview <b>{pixels(sizes.overview)}</b></span>}
                  {options.stats && <span>Run statistics <b>{pixels(sizes.stats)}</b></span>}
                </p>
              )}
              <div className="wide team-choice">
                <span className="field-label">Faces</span>
                <Segmented<ExportFace> label="Faces" value={options.face} onChange={(v) => setOption("face", v)} options={FACES} />
              </div>
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

export type OrderCriterion = "bst" | "score" | "deployments" | "joined" | "name";
export type OrderBy = "custom" | `${OrderCriterion}:${"asc" | "desc"}`;

/** The ways to order every unit at once (besides arranging them by hand), each both ways. */
export const ORDER_BY: [Exclude<OrderBy, "custom">, string][] = [
  ["name:asc", "Name (Ascending)"],
  ["name:desc", "Name (Descending)"],
  ["bst:asc", "BST (Ascending)"],
  ["bst:desc", "BST (Descending)"],
  ["score:asc", "Score (Ascending)"],
  ["score:desc", "Score (Descending)"],
  ["deployments:asc", "Deployments (Ascending)"],
  ["deployments:desc", "Deployments (Descending)"],
  ["joined:asc", "Joined (Ascending)"],
  ["joined:desc", "Joined (Descending)"],
];

/** The units' keys for an order option such as "bst:desc" (see `orderUnits`). */
export const orderFor = (units: Unit[], by: Exclude<OrderBy, "custom">, characters: Parameters<typeof orderUnits>[2]) => {
  const [criterion, dir] = by.split(":") as [OrderCriterion, "asc" | "desc"];
  return orderUnits(units, criterion, characters, dir === "desc");
};

/**
 * The units' keys in the order asked for. Deployments and joining come from the run's finished battles: joined is
 * when a unit first fought (Byleth first), those who never have go last in the roster's order. Ties keep the roster's order.
 */
export function orderUnits(units: Unit[], by: OrderCriterion, characters: { key: string; battles: number; appearances: { battle: { started_at: string } }[] }[], descending = false): string[] {
  const stats = new Map(characters.map((c) => [c.key, c]));
  const joined = (u: Unit) => {
    const times = stats.get(u.key)?.appearances.map((a) => a.battle.started_at) ?? [];
    return times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
  };
  const value: Record<typeof by, (a: Unit, b: Unit) => number> = {
    bst: (a, b) => baseStatTotal(a) - baseStatTotal(b),
    score: (a, b) => (a.score ?? 0) - (b.score ?? 0),
    deployments: (a, b) => (stats.get(a.key)?.battles ?? 0) - (stats.get(b.key)?.battles ?? 0),
    joined: (a, b) => {
      // Byleth is there from the start, ahead of anyone who first fought in the same battle.
      const [ba, bb] = [isByleth(a), isByleth(b)];
      if (ba !== bb) return ba ? -1 : 1;
      const [ja, jb] = [joined(a), joined(b)];
      return ja === jb ? 0 : ja === null ? 1 : jb === null ? -1 : ja.localeCompare(jb);
    },
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const ascending = units.map((u, i) => ({ u, i })).sort((a, b) => value[by](a.u, b.u) || a.i - b.i).map(({ u }) => u.key);
  // Descending is the exact reverse of ascending.
  return descending ? ascending.reverse() : ascending;
}

/**
 * The images' rows: each row of slots with the units it includes (rows left with none drop out). A unit is left out
 * when unticked, or when it died (`death`) and the fallen are not included.
 */
export function pickRows(slots: (string | null)[], byKey: Map<string, Unit>, left: Set<string>, perRow: number, includeFallen: boolean): Unit[][] {
  const rows: Unit[][] = [];
  for (let i = 0; i < slots.length; i += perRow) {
    const row = slots.slice(i, i + perRow)
      .map((k) => (k === null ? undefined : byKey.get(k)))
      .filter((u): u is Unit => !!u && !left.has(u.key) && (includeFallen || !u.death));
    if (row.length) rows.push(row);
  }
  return rows;
}

/** The mark by a fallen unit's name in the unit list: the app's dead icon, with where it fell. */
function FellMark({ unit }: { unit: Unit }) {
  if (!unit.death) return null;
  return (
    <span className="team-fell-mark" title={deathText(unit)} role="img" aria-label={deathText(unit)}>
      <Icon name={CONCEPT_ICON.dead} />
    </span>
  );
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
export function UnitSlots({ slots, byKey, left, includeFallen, part2, columns, onToggle, onPlace }: {
  slots: (string | null)[];
  byKey: Map<string, Unit>;
  left: Set<string>;
  includeFallen: boolean;
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
          <li key={u.key} data-key={u.key} className={[left.has(u.key) ? "" : "on", u.death ? "fallen" : "", u.death && !includeFallen ? "omitted" : "", ...classes].join(" ")}>
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
              <input type="checkbox" checked={!left.has(u.key) && (includeFallen || !u.death)} disabled={!includeFallen && !!u.death} onChange={() => onToggle(u.key)} />
              <Portrait unit={u} part2={part2} size={24} />
              <span className="team-order-name">{u.name}</span>
              <FellMark unit={u} />
            </label>
          </li>
        );
      })}
    </ol>
  );
}

/** An image at its real width (as wide as its content), scaled down to fit the preview's width. */
export function FitWidth({ actual, children }: { actual?: boolean; children: ReactNode }) {
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
  const k = actual ? 1 : size[0] && size[1] ? Math.min(1, size[0] / size[1]) : 0;
  return (
    <div className={`team-export-room${actual ? " actual" : ""}`} ref={box}>
      <div className="team-export-fit" style={{ height: size[2] * k, width: size[1] * k || undefined }}>
        <div ref={inner} style={{ width: "max-content", transform: `scale(${k})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
    </div>
  );
}

/** The sheet's padding across (team-export.css `.team-sheet`), which its least width includes. */
const SHEET_PAD_X = 56;

/**
 * The least size that holds `[w, h]` at a width-over-height `ratio` (null: `[w, h]` itself), whole pixels: the content
 * keeps its size and the sheet grows around it, wider or taller.
 */
export function aspectSize([w, h]: [number, number], ratio: number | null): [number, number] {
  if (!ratio || !w || !h) return [w, h];
  return w / h < ratio ? [Math.ceil(h * ratio), h] : [w, Math.ceil(w / ratio)];
}

/**
 * One image: the run's banner with the date and the credit, then its body, at least `width` wide. At an aspect ratio
 * the sheet grows to it around its content, which stays in the middle at its own size (measured on its own, so the
 * sheet's size never feeds back into it).
 */
export function TeamSheet({ run, units, title, note, className, width, aspect, children, ref }: { run: Pick<RunSummary, "name" | "route">; /** Counted in the meta line (none: no count). */ units?: Unit[]; title: string; note?: string; className?: string; width: number; aspect: Aspect; children: ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const sheet = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The sheet's size around its content (its padding added), as Auto draws it.
  const [natural, setNatural] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const measure = () => {
      const [s, c] = [sheet.current, content.current];
      if (!s || !c) return;
      const style = getComputedStyle(s);
      const pad = (a: string, b: string) => parseFloat(style.getPropertyValue(a)) + parseFloat(style.getPropertyValue(b));
      const next: [number, number] = [c.offsetWidth + pad("padding-left", "padding-right"), c.offsetHeight + pad("padding-top", "padding-bottom")];
      setNatural((now) => (now[0] === next[0] && now[1] === next[1] ? now : next));
    };
    const observer = new ResizeObserver(measure);
    if (content.current) observer.observe(content.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const [w, h] = aspectSize(natural, aspect === "auto" ? null : ASPECT_RATIO[aspect]);
  const forced = aspect !== "auto" && natural[0] > 0;
  return (
    // The picture is taken of the outer box, exactly the sheet's size.
    <div ref={ref} className="team-sheet-theme">
      <div ref={sheet} className={`team-sheet${className ? ` ${className}` : ""}`} style={forced ? { width: w, height: h } : undefined}>
        <div ref={content} className="team-sheet-content" style={{ minWidth: width - SHEET_PAD_X }}>
        <header className="team-sheet-title">
          <CardBanner title={`${run.name} · ${title}`} icon={<RunIcon route={run.route} />} />
          <div className="team-sheet-meta">
            <span>{[units && plural(units.length, "unit"), note, date].filter(Boolean).join(" · ")}</span>
            <span className="team-sheet-credit">Divine Pulse <span>· by Adombs</span></span>
          </div>
        </header>
        {children}
        </div>
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

/**
 * Packs pieces into at most `maxColumns` columns, as short as that allows (the least room that does it), for the
 * video's tall frames, where a card narrower and taller than the image's is the one that can be read.
 */
export function packWithin(heights: number[], titles: boolean[], maxColumns: number): number[][] {
  const total = heights.reduce((n, h) => n + h + PIECE_GAP, 0);
  for (let room = Math.max(heights[0] ?? 0, 1); room < total; room += 4) {
    const columns = packColumns(heights, titles, room);
    if (columns.length <= maxColumns) return columns;
  }
  return [heights.map((_, i) => i)];
}

/**
 * A unit's face in an image: its portrait, or its map sprite in its class (in a disc like the portrait's). A unit with
 * no sprite (the game's sprites aren't imported, or none fits) keeps its portrait: an exported image should never carry
 * a "missing" mark.
 */
export function UnitFaceImage({ unit, part2, size, face }: { unit: Unit; part2: boolean; size: number; face: ExportFace }) {
  const sprite = useMemo(() => unitSprite(unit), [unit]);
  const has = useHasSprite(sprite);
  if (!has || face === "portrait") return <Portrait unit={unit} part2={part2} size={size} />;
  return (
    <span className="team-face-sprite" style={{ "--face": `${size}px` } as React.CSSProperties} role="img" aria-label={`${unit.name}'s map sprite${unit.class_name ? ` as a ${unit.class_name}` : ""}`}>
      <SpriteFigure sprite={sprite} />
    </span>
  );
}

/** A unit's loadout: who it is, its stats and BST, then what it carries and knows in columns beside that, no taller
 * than it, so every card is the same height. */
export function LoadoutCard({ unit, part2, face, maxColumns }: { unit: Unit; part2: boolean; face: ExportFace; maxColumns?: number }) {
  const carried = (unit.inventory ?? []).filter((it) => it.kind !== "spell");
  const spells = (unit.inventory ?? []).filter((it) => it.kind === "spell");
  const abilities = [unit.personal_ability, ...unit.abilities].filter(Boolean).map(tidyAbility);
  const reference = useReference();
  const pieces: Piece[] = [{
    key: "head",
    node: (
      <div className="team-card-top">
        <header className="team-card-head">
          <UnitFaceImage unit={unit} part2={part2} size={64} face={face} />
          <div className="team-card-name">
            <b>{unit.name}</b>
            <span>{unit.class_name || "—"}</span>
          </div>
          <div className="team-card-badges">
            <span className="team-card-bst" title="Base stat total: the base stats added up, without bonuses">
              <small>BST</small>
              {baseStatTotal(unit)}
            </span>
            <span className="team-card-score" title={`Run score: ${SCORE_EXPLANATION}`}>
              <small>Score</small>
              {fmtScore(unit.score)}
            </span>
          </div>
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
  // None mastered (or not read yet): no section, rather than a title over nothing.
  section("Class Mastery", (masteredClasses(unit.mastered_classes, reference?.classes) ?? []).map((c) => ({
    key: c.name,
    icon: c.tier ? <TierIcon tier={c.tier} size={22} decorative /> : <span />,
    name: c.name,
  })));
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
    const next = maxColumns ? packWithin(heights, pieces.map((p) => !!p.title), maxColumns) : packColumns(heights, pieces.map((p) => !!p.title), heights[0]);
    setColumns((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
  }); // every render: cheap, and settles after one pass since a piece's height doesn't depend on its column
  const shown = columns.flat().length === pieces.length ? columns : whole;
  return (
    <article ref={card} className={`team-card${unit.death ? " fallen" : ""}`} style={{ padding: CARD_PAD, gap: CARD_GAP }}>
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
 * received, then the order History lists them).
 */
export function topRecords(row: LedgerRow | undefined, totals: (number | null)[], n = 3): { key: string; title: string; icon: string; count: number }[] {
  if (!row) return [];
  return AWARDS.map((a, i) => ({ a, i, count: row.values.records[i] ?? 0, total: totals[i] ?? 0 }))
    .filter((r) => r.count > 0)
    .map((r) => ({ ...r, score: (r.count / Math.max(r.count, r.total)) * (RECORD_WEIGHT[r.a.key] ?? 1) }))
    .sort((x, y) => y.score - x.score || y.count - x.count || x.i - y.i)
    .slice(0, n)
    .map((r) => ({ key: r.a.key, title: r.a.title, icon: r.a.icon, count: r.count }));
}

const cell = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString());

/** A column of the statistics table: the unit's Score, one of the combat or growth counts, or the top records. */
export type StatColumn = "score" | `combat:${number}` | `growth:${number}` | "records";
/** Every column, in the order the image draws them. */
export const STAT_COLUMNS: StatColumn[] = ["score", ...COMBAT.map((_, i): StatColumn => `combat:${i}`), ...GROWTH.map((_, i): StatColumn => `growth:${i}`), "records"];
/** The heading a run of columns sits under (the Score has none). */
export const statGroup = (c: StatColumn): "score" | "combat" | "growth" | "records" => (c === "score" || c === "records" ? c : (c.split(":")[0] as "combat" | "growth"));
const GROUP_LABEL = { score: "", combat: "Combat", growth: "Growth", records: "Top records" } as const;
const columnLabel = (c: StatColumn) => (c === "score" ? "Score" : c === "records" ? "" : (c.startsWith("combat") ? COMBAT : GROWTH)[Number(c.split(":")[1])]);

/**
 * The picked units' run statistics, one row each, with the team's totals. A video's page draws some of the columns
 * (`columns`, the unit always beside them), in `compact` form: tighter cells, headings that wrap and records one under
 * another, so more columns fit a narrow frame at a size that can be read.
 */
export function StatsTable({ units, rows, totals, part2, face, totalsOf = units, showTotals = true, columns, compact = false, stackRecords = false }: {
  units: Unit[];
  rows: LedgerRow[];
  totals: (number | null)[];
  part2: boolean;
  face: ExportFace;
  /** The units the Team row adds up (default: the ones shown); a video's page of the table shows some of them. */
  totalsOf?: Unit[];
  /** Whether the Team row is drawn (a video's last page of its columns has it). */
  showTotals?: boolean;
  /** Which columns (default: all, in image order). */
  columns?: readonly StatColumn[];
  compact?: boolean;
  /** In a compact table, whether each unit's records are one under another (a narrow frame) or side by side. */
  stackRecords?: boolean;
}) {
  const shown = STAT_COLUMNS.filter((c) => !columns || columns.includes(c));
  const runs = shown.reduce<{ group: ReturnType<typeof statGroup>; n: number; first: StatColumn }[]>((out, c) => {
    const last = out[out.length - 1];
    if (last && last.group === statGroup(c)) last.n++;
    else out.push({ group: statGroup(c), n: 1, first: c });
    return out;
  }, []);
  const starts = new Set(runs.filter((r) => r.group !== "score").map((r) => r.first));
  const cls = (c: StatColumn, extra = "") => [starts.has(c) ? "group-start" : "", c === "score" ? "team-stats-score" : "", c === "records" ? "team-stats-records" : "", extra].filter(Boolean).join(" ") || undefined;
  const byKey = new Map(rows.map((r) => [r.id, r]));
  const sum = (part: "combat" | "growth", i: number) => {
    const values = totalsOf.map((u) => byKey.get(u.key)?.values[part][i]);
    return values.some((v) => v !== null && v !== undefined) ? values.reduce<number>((n, v) => n + (v ?? 0), 0) : null;
  };
  const body = (c: StatColumn, u: Unit, row: LedgerRow | undefined) => {
    if (c === "score") return fmtScore(u.score);
    if (c !== "records") {
      const [g, i] = c.split(":");
      return row ? cell(row.values[g as "combat" | "growth"][Number(i)]) : "—";
    }
    const top = topRecords(row, totals);
    return top.length ? (
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
    );
  };
  return (
    <table className={`team-stats${compact ? " compact" : ""}${compact && stackRecords ? " stacked" : ""}`}>
      <thead>
        <tr className="team-stats-groups">
          <th />
          {runs.map((r) => <th key={r.first} colSpan={r.n}>{GROUP_LABEL[r.group]}</th>)}
        </tr>
        <tr>
          <th className="team-stats-unit">Unit</th>
          {shown.map((c) => <th key={c} className={cls(c)} title={c === "score" ? `Run score: ${SCORE_EXPLANATION}` : undefined}>{c === "records" ? " " : columnLabel(c)}</th>)}
        </tr>
      </thead>
      <tbody>
        {units.map((u) => {
          const row = byKey.get(u.key);
          return (
            <tr key={u.key} className={[row ? "" : "unrecorded", u.death ? "fallen" : ""].filter(Boolean).join(" ")}>
              <th scope="row" className="team-stats-unit">
                <span>
                  <UnitFaceImage unit={u} part2={part2} size={32} face={face} />
                  <span>
                    <b>{u.name}</b>
                    <small>{u.class_name}</small>
                  </span>
                </span>
              </th>
              {shown.map((c) => <td key={c} className={cls(c)}>{body(c, u, row)}</td>)}
            </tr>
          );
        })}
      </tbody>
      {showTotals && <tfoot>
        <tr>
          <th scope="row" className="team-stats-unit">Team</th>
          {shown.map((c) => (
            <td key={c} className={cls(c)}>
              {c === "score" ? fmtScore(totalsOf.reduce((n, u) => n + (u.score ?? 0), 0)) : c === "records" ? null : cell(sum(statGroup(c) as "combat" | "growth", Number(c.split(":")[1])))}
            </td>
          ))}
        </tr>
      </tfoot>}
    </table>
  );
}
