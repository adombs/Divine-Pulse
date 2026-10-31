/** Every timeline of the battle as a tree growing top to bottom: the timeline that stands is the trunk, and each one
 * a Divine Pulse undid branches off (greyed out) where time was turned back to. Hover a path to see its actions
 * and captions; click to pin it, and the view fits its rows. All paths share the battle's first node and their common history.
 *
 * The view: about ten dots down by default, a zoom slider, drag to pan, and it centres each new action as it comes
 * in. Picking a Divine Pulse use replays it: the view zooms in on the moment it was used, a marker runs back along the
 * undone timeline to the moment time went back to, and the view zooms out again. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Item, mergeHits, TimelineColumn } from "./model";
import { ZoomSlider } from "./camera";
import { ItemRow } from "./parts";
import "./log.css";

const IN_VIEW = 10; // dots down the view by default
const REPLAY_IN_VIEW = 5; // and while a Divine Pulse use is replayed
const ZOOM_LEVELS = 10; // stops on the zoom slider
const MIN_STEP = 8; // px per history position, zoomed out all the way
const CAPTION_WIDTH = 300; // the log row a path shows beside its dots
const AXIS = 46; // turn labels, left of the timelines
const PAD = 14;
const CARD_GAP = 10; // px between a dot and the card it grows into
const CARD_MARGIN = 8; // px the card keeps from the window's edges
const DRAG = 4; // px a press has to move to be a drag rather than a click
const REPLAY_SPEED = 5; // history positions per second, for the marker
const ZOOM_MS = 650;
const PULSE_MS = 900;

interface Props {
  columns: TimelineColumn[];
  /** A Divine Pulse picked (numbered, so picking one again replays it): 1 and on replays that use, 0 goes back to the
   * start of the battle, before any. */
  jump?: { pulse: number; n: number } | null;
  /** History position selected by the replay slider, on the standing timeline. */
  current?: number | null;
}

interface Lane {
  id: number;
  parent: number | null;
  fork: number;
  at: number;
  first: number;
  last: number;
  rows: [number, Item[]][];
}

/** A point in the tree's own units: history position down (fx), timeline (column index) across (fy). Fractions are in
 * between. */
interface Spot {
  fx: number;
  fy: number;
}

/** Timelines left to right: each one's branches around it, the earliest nearest, alternately left and right, each with
 * its own branches around it in turn. */
function order(lanes: Lane[]): Lane[] {
  const children = (id: number) => lanes.filter((l) => l.parent === id).sort((a, b) => a.fork - b.fork || a.id - b.id);
  const band = (lane: Lane): Lane[] => {
    const kids = children(lane.id);
    const above = kids.filter((_, i) => i % 2 === 0).reverse();
    const below = kids.filter((_, i) => i % 2 === 1);
    return [...above.flatMap(band), lane, ...below.flatMap(band)];
  };
  return band(lanes.find((l) => l.id === 0)!);
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const laneWidth = (step: number) => Math.min(44, Math.max(24, step * 0.55));

/** A cubic Bézier between two spots that leaves and arrives vertically (the shape of a branch's connector). */
function bend(a: Spot, b: Spot, k: number): Spot {
  const mid = (a.fx + b.fx) / 2;
  const u = 1 - k;
  const pts = [a, { fx: mid, fy: a.fy }, { fx: mid, fy: b.fy }, b];
  const w = [u * u * u, 3 * u * u * k, 3 * u * k * k, k * k * k];
  return { fx: pts.reduce((n, p, i) => n + w[i] * p.fx, 0), fy: pts.reduce((n, p, i) => n + w[i] * p.fy, 0) };
}

export function Timelines({ columns, jump, current = null }: Props) {
  // The timelines' actions (Divine Pulse lines left out: the branches show where time went back), in tree order.
  const lanes = useMemo(() => {
    const out: Lane[] = [];
    for (const c of columns) {
      const rows = [...c.rows]
        .map(([step, items]) => [step, items.filter((i) => i.kind !== "pulse")] as [number, Item[]])
        .filter(([, items]) => items.length > 0)
        .sort((a, b) => a[0] - b[0]);
      if (!rows.length) continue;
      out.push({ id: c.id, parent: c.parent, fork: c.fork, at: c.at, first: rows[0][0], last: rows[rows.length - 1][0], rows });
    }
    return order(out);
  }, [columns]);
  const byId = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);
  // Divine Pulse uses in order: the branch each one undid.
  const pulses = useMemo(() => lanes.filter((l) => l.parent !== null).sort((a, b) => a.at - b.at), [lanes]);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hoveredPath, setHoveredPath] = useState<number | null>(null);
  const toggle = (id: number) => {
    setPinned((old) => old === id ? null : id);
    if (pinned !== id) void fitPath(id);
  };
  const selected = hoveredPath ?? pinned;
  // A path includes its ancestors up to each fork, so every path starts at the shared Turn 1 node.
  const ancestry = (id: number): { lane: Lane; end: number }[] => {
    const result: { lane: Lane; end: number }[] = [];
    let end = Infinity;
    for (let l = byId.get(id); l; l = l.parent === null ? undefined : byId.get(l.parent)) {
      result.unshift({ lane: l, end: Math.min(l.last, end) });
      const parent = l.parent === null ? undefined : byId.get(l.parent);
      // Sparse history has no node at fork - 1: join the last actual row before the split.
      end = parent?.rows.filter(([step]) => step < l.fork).at(-1)?.[0] ?? parent?.first ?? 0;
    }
    return result;
  };
  const expanded = new Map(selected === null ? [] : ancestry(selected).map(({ lane, end }) => [lane.id, end]));

  // Zoom: px per history position, ten dots down the view until the slider moves.
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setView(el.clientHeight));
    seen.observe(el);
    setView(el.clientHeight);
    return () => seen.disconnect();
  }, []);
  const maxStep = Math.max(MIN_STEP * 2, view / 4);
  const fit = (n: number) => (view ? view / n : 40);
  const [zoom, setZoom] = useState<number | null>(null);
  const step = Math.min(maxStep, Math.max(MIN_STEP, zoom ?? fit(IN_VIEW)));
  const stepNow = useRef(step);
  stepNow.current = step;
  const dot = Math.min(14, Math.max(6, step * 0.2));
  const lane = laneWidth(step);
  // The slider has ZOOM_LEVELS stops, evenly spaced on a log scale: 0 all the way out, the last all the way in.
  const toSlider = (s: number) => Math.round((ZOOM_LEVELS - 1) * (Math.log(s / MIN_STEP) / Math.log(maxStep / MIN_STEP)));
  const fromSlider = (v: number) => MIN_STEP * Math.pow(maxStep / MIN_STEP, v / (ZOOM_LEVELS - 1));

  // On screen: a timeline's column across, a history position down.
  const px = (fy: number, s = step) => AXIS + CAPTION_WIDTH + fy * laneWidth(s) + laneWidth(s) / 2;
  const py = (fx: number, s = step) => PAD + fx * s + s / 2;
  const xOf = (id: number) => px(laneIndex.get(id)!);
  const yOf = (s: number) => py(s);
  const last = Math.max(...lanes.map((l) => l.last));
  const width = AXIS + CAPTION_WIDTH * 2 + lanes.length * lane + PAD;
  const height = PAD * 2 + (last + 1) * step;

  // Turns: where a turn's player phase begins.
  const turns = new Map<number, number>();
  for (const l of lanes)
    for (const [s, items] of l.rows)
      for (const i of items) if (i.kind === "phase" && i.phase === 0 && i.turn !== null && !turns.has(s)) turns.set(s, i.turn);

  // The camera. While a replay runs it holds the spot to keep in the middle, applied after every render (the zoom
  // changes the size of everything); otherwise the view is wherever it was scrolled or dragged to.
  const camera = useRef<Spot | null>(null);
  const marker = useRef<Spot | null>(null);
  const [, setFrame] = useState(0);
  const centre = (el: HTMLDivElement, spot: Spot) => {
    el.scrollLeft = px(spot.fy) - el.clientWidth / 2;
    el.scrollTop = py(spot.fx) - el.clientHeight / 2;
  };
  useLayoutEffect(() => {
    if (camera.current && box.current) centre(box.current, camera.current);
  });
  // The spot in the middle of the view now.
  const middle = (el: HTMLDivElement): Spot => ({
    fx: (el.scrollTop + el.clientHeight / 2 - PAD - step / 2) / step,
    fy: (el.scrollLeft + el.clientWidth / 2 - AXIS - CAPTION_WIDTH - lane / 2) / lane,
  });
  // Zooming with the slider keeps the middle of the view where it was.
  const before = useRef(step);
  useLayoutEffect(() => {
    const el = box.current;
    const old = before.current;
    before.current = step;
    if (!el || old === step || camera.current) return;
    const fx = (el.scrollTop + el.clientHeight / 2 - PAD - old / 2) / old;
    el.scrollTop = py(fx) - el.clientHeight / 2;
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each new action is centred as it comes in (and the newest one when the view first shows).
  const trunkLast = byId.get(0)?.last ?? 0;
  const placed = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el || !view || camera.current) return;
    const spot = { fx: current ?? trunkLast, fy: laneIndex.get(0) ?? 0 };
    if (!placed.current) {
      placed.current = true;
      centre(el, spot);
    } else {
      el.scrollTo({ left: px(spot.fy) - el.clientWidth / 2, top: py(spot.fx) - el.clientHeight / 2, behavior: "smooth" });
    }
  }, [current, trunkLast, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag to pan. A press that moves is a drag, and the click it ends with doesn't open or close a branch.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  // The dot under the pointer (or focused), grown into its log row.
  const [hover, setHover] = useState<{ key: string; items: Item[]; at: DOMRect } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => { setHover(null); setHoveredPath(null); }, 200);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Replaying a Divine Pulse use. Each replay has a number; starting another one, or dragging, stops it.
  const replay = useRef(0);
  const [flash, setFlash] = useState<string | null>(null);
  const stop = () => {
    setHover(null);
    replay.current += 1;
    camera.current = marker.current = null;
  };
  const run = (ms: number, frame: (k: number) => void, id: number) =>
    new Promise<boolean>((done) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (replay.current !== id) return done(false);
        const k = Math.min(1, (now - t0) / ms);
        frame(ease(k));
        setFrame((n) => n + 1);
        if (k < 1) requestAnimationFrame(tick);
        else done(true);
      };
      requestAnimationFrame(tick);
    });
  const pause = (ms: number, id: number) => new Promise<boolean>((done) => setTimeout(() => done(replay.current === id), ms));
  const zoomTo = (to: number, from: Spot, target: Spot, id: number) => {
    const s0 = stepNow.current;
    return run(
      ZOOM_MS,
      (k) => {
        setZoom(s0 + (to - s0) * k);
        camera.current = { fx: from.fx + (target.fx - from.fx) * k, fy: from.fy + (target.fy - from.fy) * k };
      },
      id,
    );
  };

  const replayPulse = async (n: number) => {
    const l = pulses[n - 1];
    const el = box.current;
    if (!l || !el || l.parent === null) return;
    stop();
    const id = replay.current;
    const parent = byId.get(l.parent)!;
    // From the moment the Divine Pulse was used (the end of the timeline it undid) back to the moment time went back to
    // (the last action before the split, in the timeline it split from).
    const back = parent.rows.filter(([s]) => s < l.fork).map(([s]) => s);
    const dest = back.length ? back[back.length - 1] : Math.max(0, l.fork - 1);
    const bi = laneIndex.get(l.id)!;
    const pi = laneIndex.get(parent.id)!;
    const start = { fx: l.last, fy: bi };
    const firstSpot = { fx: l.first, fy: bi };
    const end = { fx: dest, fy: pi };
    setPinned(l.id);

    if (!(await zoomTo(fit(REPLAY_IN_VIEW), middle(el), start, id))) return;
    setFlash(`${l.id}-${l.last}`);
    if (!(await pause(PULSE_MS, id))) return;
    // The marker runs back along the branch, then along its connector to where it split off.
    const straight = l.last - l.first;
    const curve = Math.abs(l.first - dest) + Math.abs(bi - pi) * 0.5;
    const total = Math.max(0.1, straight + curve);
    const ms = Math.min(5000, Math.max(900, (total / REPLAY_SPEED) * 1000));
    marker.current = start;
    const moved = await run(
      ms,
      (k) => {
        const d = k * total;
        const spot = d <= straight ? { fx: l.last - d, fy: bi } : bend(firstSpot, end, Math.min(1, (d - straight) / Math.max(0.1, curve)));
        marker.current = camera.current = spot;
      },
      id,
    );
    if (!moved) return;
    marker.current = null;
    setFlash(`${parent.id}-${dest}`);
    if (!(await pause(PULSE_MS, id))) return;
    if (!(await zoomTo(fit(IN_VIEW), end, end, id))) return;
    camera.current = null;
    setZoom(null);
  };

  /** Back to where the battle started (Divine Pulse 0: before any was used), at the usual zoom. */
  const toStart = async () => {
    const el = box.current;
    if (!el) return;
    stop();
    const id = replay.current;
    const spot = { fx: Math.min(...lanes.map((l) => l.first)), fy: laneIndex.get(0) ?? 0 };
    if (!(await zoomTo(fit(IN_VIEW), middle(el), spot, id))) return;
    setFlash(`0-${byId.get(0)?.first ?? 0}`);
    camera.current = null;
    setZoom(null);
  };

  /** Zooms and pans so every row a path shows (the path and its ancestors, down to its last action) is in view. */
  const fitPath = async (pathId: number) => {
    const el = box.current;
    if (!el) return;
    const parts = ancestry(pathId);
    const rows = [parts[0].lane.first, ...parts.map((p) => p.end)];
    const [top, bottom] = [Math.min(...rows), Math.max(...rows)];
    const across = parts.map((p) => laneIndex.get(p.lane.id) ?? 0);
    const target = { fx: (top + bottom) / 2, fy: (Math.min(...across) + Math.max(...across)) / 2 };
    stop();
    const id = replay.current;
    const to = Math.min(maxStep, Math.max(MIN_STEP, (el.clientHeight - PAD * 2) / (bottom - top + 1)));
    if (!(await zoomTo(to, middle(el), target, id))) return;
    camera.current = null;
  };

  const lastJump = useRef(0);
  useEffect(() => {
    if (!jump || jump.n === lastJump.current) return;
    lastJump.current = jump.n;
    void (jump.pulse > 0 && jump.pulse <= pulses.length ? replayPulse(jump.pulse) : toStart());
  }, [jump]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const labels = [...(box.current?.querySelectorAll<HTMLElement>(".tl-caption") ?? [])];
    labels.sort((a, b) => Number(b.parentElement?.classList.contains("active")) - Number(a.parentElement?.classList.contains("active")));
    const occupied: DOMRect[] = [];
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      const collision = occupied.some((other) => rect.left < other.right + 4 && rect.right > other.left - 4 && rect.top < other.bottom + 3 && rect.bottom > other.top - 3);
      label.style.visibility = collision ? "hidden" : "visible";
      if (!collision) occupied.push(rect);
    }
  });

  const shownMarker = marker.current;
  // The tree's grid cells are a lane wide and a history position tall (or several, zoomed out), so panning from node to
  // node reads against it.
  const grid = {
    ["--tl-gx" as string]: `${lane * Math.ceil(20 / lane)}px`,
    ["--tl-gy" as string]: `${step * Math.ceil(20 / step)}px`,
    ["--tl-ox" as string]: `${AXIS + CAPTION_WIDTH + lane / 2}px`,
    ["--tl-oy" as string]: `${PAD + step / 2}px`,
  };
  return (
    <div className="timelines-wrap" style={{ ["--tl-dot" as string]: `${dot}px` }}>
      <div className="toolbar tl-toolbar">
        <span className="toolbar-end map-tools">
          <ZoomSlider
            stops={ZOOM_LEVELS}
            value={toSlider(step)}
            onChange={(v) => {
              stop();
              setZoom(fromSlider(v));
            }}
          />
        </span>
      </div>
      <div
        className={`timelines ${dragging ? "dragging" : ""}`}
        ref={box}
        role="figure"
        aria-label="Timelines of the battle"
        onScroll={() => hover && setHover(null)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const el = e.currentTarget;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG) return;
          if (!d.moved) {
            d.moved = true;
            stop();
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          e.currentTarget.scrollLeft = d.left - dx;
          e.currentTarget.scrollTop = d.top - dy;
        }}
        onPointerUp={(e) => {
          dragged.current = drag.current?.moved ?? false;
          drag.current = null;
          setDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (dragged.current) {
            dragged.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div className="timelines-canvas" style={{ width, height, ...grid }}>
          <svg width={width} height={height} aria-hidden>
            {[...turns].map(([s]) => (
              <line key={s} className="tl-turn" x1={4} x2={width} y1={yOf(s) - step / 2} y2={yOf(s) - step / 2} />
            ))}
            {lanes.map((l) => {
              const segments = ancestry(l.id);
              const d = segments.map(({ lane: part, end }, i) => {
                const x = xOf(part.id);
                if (!i) return `M ${x} ${yOf(part.first)} V ${yOf(end)}`;
                const prev = segments[i - 1];
                const x0 = xOf(prev.lane.id);
                const y0 = yOf(prev.end);
                const y1 = yOf(part.first);
                const mid = (y0 + y1) / 2;
                return `C ${x0} ${mid}, ${x} ${mid}, ${x} ${y1} V ${yOf(end)}`;
              }).join(" ");
              return (
                <g key={l.id} className={`tl-branch ${selected === l.id ? "open" : ""}`}
                  onPointerEnter={() => setHoveredPath(l.id)} onPointerLeave={() => setHoveredPath(null)}
                  onClick={() => toggle(l.id)}>
                  <path className={`tl-line ${l.parent === null ? "" : "undone"}`} d={d} />
                  <path className="tl-hit" d={d} />
                </g>
              );
            })}
          </svg>
          {[...turns].map(([s, turn]) => (
            <span key={s} className="tl-turn-label" style={{ top: yOf(s) - step / 2 + 2 }}>
              Turn {turn}
            </span>
          ))}
          {lanes.map((l) => {
            const branch = l.parent !== null;
            const forks = new Set(lanes.filter((child) => child.parent === l.id).map((child) => {
              const before = l.rows.filter(([s]) => s < child.fork);
              return before.at(-1)?.[0] ?? l.first;
            }));
            const shown = l.rows.filter(([s]) => (l.parent === null && s === l.first) || s === l.last || forks.has(s) ||
              (expanded.has(l.id) && s <= expanded.get(l.id)!) || (l.id === 0 && s === current));
            return shown.map(([s, items], index) => {
              const action = items.find((i) => !i.heading) ?? items[0];
              const text = items.map((i) => i.text).join(" · ");
              const key = `${l.id}-${s}`;
              const active = l.id === 0 && s === current;
              const caption = active || (expanded.has(l.id) && s <= expanded.get(l.id)!);
              const show = (el: HTMLElement) => {
                cancelHide();
                if (drag.current?.moved || camera.current) return;
                setHoveredPath(l.id);
                setHover({ key, items, at: el.getBoundingClientRect() });
              };
              const hide = () => {
                scheduleHide();
              };
              return (
                <div
                  key={key}
                  className={`tl-item ${branch ? "undone" : ""} ${expanded.has(l.id) ? "open" : ""} ${active ? "active" : ""} ${hover?.key === key ? "hovered" : ""} ${flash === key ? "flash" : ""}`}
                  style={{ left: xOf(l.id), top: yOf(s) }}
                  onAnimationEnd={(e) => e.animationName === "tl-flash" && setFlash(null)}
                  onPointerEnter={(e) => show(e.currentTarget.querySelector<HTMLElement>(".tl-node")!)}
                  onPointerLeave={hide}
                  onFocusCapture={(e) => e.target.matches(":focus-visible") && show(e.currentTarget.querySelector<HTMLElement>(".tl-node")!)}
                  onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hide(); }}
                >
                  <button
                    type="button"
                    className={`tl-node cat-${action.category} ${action.heading ? "heading" : ""}`}
                    aria-label={text}
                    aria-current={active || undefined}
                    aria-pressed={pinned === l.id}
                    onClick={() => toggle(l.id)}
                  />
                  {caption && (
                    <ol className={`log-list tl-caption ${(index + (laneIndex.get(l.id) ?? 0)) % 2 ? "left" : "right"}`} onClick={() => toggle(l.id)}>
                      {mergeHits(items).map((i) => (
                        <ItemRow key={i.key} item={i} />
                      ))}
                    </ol>
                  )}
                </div>
              );
            });
          })}
          {shownMarker && <span className="tl-marker" style={{ left: px(shownMarker.fy), top: py(shownMarker.fx) }} aria-hidden />}
        </div>
      </div>
      {hover && <NodeCard key={hover.key} items={hover.items} at={hover.at} onEnter={cancelHide} onLeave={scheduleHide} />}
    </div>
  );
}

/** A dot's log row, grown out of the dot: beside it, inside the window, above everything (so no scroll box cuts it
 * off). */
function NodeCard({ items, at, onEnter, onLeave }: { items: Item[]; at: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; ox: number; oy: number } | null>(null);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    const [vw, vh] = [document.documentElement.clientWidth, document.documentElement.clientHeight];
    const [cx, cy] = [at.left + at.width / 2, at.top + at.height / 2];
    // Right of the dot if it fits, else left of it; level with it, kept inside the window.
    let left = cx + CARD_GAP + w <= vw - CARD_MARGIN ? cx + CARD_GAP : cx - CARD_GAP - w;
    left = Math.max(CARD_MARGIN, Math.min(left, vw - CARD_MARGIN - w));
    const top = Math.max(CARD_MARGIN, Math.min(cy - h / 2, vh - CARD_MARGIN - h));
    setPlace({ left, top, ox: cx - left, oy: cy - top });
  }, [at]);
  const style = place
    ? { left: place.left, top: place.top, ["--ox" as string]: `${place.ox}px`, ["--oy" as string]: `${place.oy}px` }
    : { left: 0, top: 0, visibility: "hidden" as const };
  return createPortal(
    <div className={`tl-card ${place ? "shown" : ""}`} ref={card} style={style} role="tooltip" onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <ol className="log-list">
        {mergeHits(items).map((i) => (
          <ItemRow key={i.key} item={i} />
        ))}
      </ol>
    </div>,
    document.body,
  );
}
