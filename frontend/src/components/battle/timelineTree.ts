/**
 * What the log's tree shows, worked out from the timelines (model.timelineColumns): which timelines get a lane and in
 * what order, the path from the trunk to a lane, which of a lane's actions are dots, and which dots can show their log
 * row without covering another. Pure functions: Timelines.tsx only draws them.
 *
 * One rule runs through it: a dot's log row is shown once. The row grown out of a dot you point at (the card) replaces
 * the dot's row on the tree, and while a card is open the tree's other rows step back (see `peeking` in Timelines).
 */
import type { Item, TimelineColumn } from "./model";

/** One timeline's actions in the tree: each history position it has, oldest first. */
export interface Lane {
  id: number;
  parent: number | null;
  fork: number;
  at: number;
  first: number;
  last: number;
  rows: [number, Item[]][];
}

/** A lane's stretch of a path: the lane, and the last history position the path follows it to. */
export interface PathPart {
  lane: Lane;
  end: number;
}

/** A dot of the tree: one history position of one lane. */
export interface Dot {
  key: string;
  lane: Lane;
  step: number;
  items: Item[];
  /** Which of its lane's dots it is, top down (the sides its log rows alternate between). */
  index: number;
  /** On the replay's current position (the trunk only). */
  active: boolean;
  /** On the path that is open (hovered or pinned), so it shows its log row. */
  open: boolean;
}

/** The timelines that have actions to show (Divine Pulse lines left out: the branches show where time went back), in tree
 * order. */
export function buildLanes(columns: TimelineColumn[]): Lane[] {
  const lanes: Lane[] = [];
  for (const c of columns) {
    const rows = [...c.rows]
      .map(([step, items]) => [step, items.filter((i) => i.kind !== "pulse")] as [number, Item[]])
      .filter(([, items]) => items.length > 0)
      .sort((a, b) => a[0] - b[0]);
    if (!rows.length) continue;
    lanes.push({ id: c.id, parent: c.parent, fork: c.fork, at: c.at, first: rows[0][0], last: rows[rows.length - 1][0], rows });
  }
  const trunk = lanes.find((l) => l.id === 0);
  return trunk ? order(lanes, trunk) : lanes;
}

/** Timelines left to right: each one's branches around it, the earliest nearest, alternately left and right, each with
 * its own branches around it in turn. */
function order(lanes: Lane[], trunk: Lane): Lane[] {
  const children = (id: number) => lanes.filter((l) => l.parent === id).sort((a, b) => a.fork - b.fork || a.id - b.id);
  const band = (lane: Lane): Lane[] => {
    const kids = children(lane.id);
    const above = kids.filter((_, i) => i % 2 === 0).reverse();
    const below = kids.filter((_, i) => i % 2 === 1);
    return [...above.flatMap(band), lane, ...below.flatMap(band)];
  };
  return band(trunk);
}

/** The path to a lane: its ancestors from the trunk down, each followed up to where the next one splits off (the lane
 * itself to its last action), so every path starts at the battle's first node. */
export function ancestry(byId: Map<number, Lane>, id: number): PathPart[] {
  const parts: PathPart[] = [];
  let end = Infinity;
  for (let l = byId.get(id); l; l = l.parent === null ? undefined : byId.get(l.parent)) {
    parts.unshift({ lane: l, end: Math.min(l.last, end) });
    const parent = l.parent === null ? undefined : byId.get(l.parent);
    // Sparse history has no node at fork - 1: join the last actual row before the split.
    end = parent?.rows.filter(([step]) => step < l.fork).at(-1)?.[0] ?? parent?.first ?? 0;
  }
  return parts;
}

/** How far the open path follows each lane (lane id -> last history position); empty when no path is open. */
export function openPath(byId: Map<number, Lane>, id: number | null): Map<number, number> {
  return new Map(id === null ? [] : ancestry(byId, id).map(({ lane, end }) => [lane.id, end]));
}

/** The dots of the tree: where a lane starts (the trunk's first action), where it ends, where another splits off it,
 * every action on the open path, and the replay's current position on the trunk. */
export function dots(lanes: Lane[], open: Map<number, number>, current: number | null): Dot[] {
  const out: Dot[] = [];
  for (const lane of lanes) {
    const forks = new Set(
      lanes
        .filter((child) => child.parent === lane.id)
        .map((child) => lane.rows.filter(([s]) => s < child.fork).at(-1)?.[0] ?? lane.first),
    );
    const end = open.get(lane.id);
    let index = 0;
    for (const [step, items] of lane.rows) {
      const active = lane.id === 0 && step === current;
      const onPath = end !== undefined && step <= end;
      if (!((lane.parent === null && step === lane.first) || step === lane.last || forks.has(step) || onPath || active)) continue;
      out.push({ key: `${lane.id}-${step}`, lane, step, items, index: index++, active, open: onPath });
    }
  }
  return out;
}

/** A log row that wants to be shown beside its dot: where it would sit on screen. */
export interface Slot {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MARGIN_X = 4;
const MARGIN_Y = 3;

/** Which log rows can be shown without covering each other. `slots` come in the order they matter (the current one
 * first, then the rest as they stand on the tree): a row is dropped when a row already kept is in its way. */
export function uncovered(slots: Slot[]): Set<string> {
  const kept: Slot[] = [];
  for (const s of slots) {
    const covered = kept.some(
      (k) => s.left < k.right + MARGIN_X && s.right > k.left - MARGIN_X && s.top < k.bottom + MARGIN_Y && s.bottom > k.top - MARGIN_Y,
    );
    if (!covered) kept.push(s);
  }
  return new Set(kept.map((s) => s.key));
}

/** The rows to lay out, most important first: the one on the current position, then those on the open path. */
export function byImportance<T extends { active: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.active) - Number(a.active));
}
