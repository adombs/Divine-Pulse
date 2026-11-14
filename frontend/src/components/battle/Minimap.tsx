/**
 * The battle map as a grid of tiles with every unit on it, each in its army's colour (yours blue, enemies red, allies
 * green, a third army yellow, breakable walls grey): as the game's map sprite, or drawn like the game's minimap, a
 * rounded badge with their portrait or the game's icon for the weapon they fight with
 * (fists for the unarmed), as Settings > Appearance says (`mapLook`). Units that fell or left the map
 * aren't drawn: in a replay they fade away.
 * When the map's terrain is known it's drawn as the game's minimap draws it: the game's own minimap of the map when
 * there is one (map.gameMinimap); an unavailable native image stays explicit, with the game's icons for
 * chests, doors, levers and seals, Crest Stones, traps, breakable walls and warp tiles; hovering a tile names it. A unit's HP shows as a thin bar just under its tile (not a breakable wall's). A replay step being
 * animated (`animation`, replay.tsx) plays in stages: the move, then the attack (the attacker lunges, the attack's
 * badge pops in between the two) or heal (a green pulse on whoever is healed), then the fades. A step shown sums up as
 * a trail in the mover's colour from where it set out, a line to whoever it attacked or healed and that badge, with the
 * log's icons (model.ICON); the fallen carry the log's badge too. Hovering a unit says who it is and what it stands on,
 * and picking one (click, or Enter when focused) calls `onPick`; the picked one is framed. `cursor` draws the game's
 * tile cursor where it is in the game.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import "../character/panels.css";
import { MapImage, useGameImageUrl } from "../GameImage";
import { loadGameJson, onGameAssetsChange } from "../../gameAssets";
import { faceUrl } from "../../portraits";
import { PortraitPhaseContext } from "../../appearance";
import { flushSync } from "react-dom";
import { KeyboardEvent, memo, PointerEvent as ReactPointerEvent, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Collapse } from "../disclosure";
import type { Battle } from "../../api";
import { Section } from "../layout";
import type { TerrainTile } from "../../api";
import { Action, Board, boardNow, EMPTY_MINIMAP_INDEX, describe, describeTile, gameMinimap, hasMap, MINIMAP_TILES, minimapTile, type MinimapIndex, Piece, TILE_MARKS, tileAt, tileMark, tileMarks, terrainRuns } from "./map";
import { ActionBadge, MapLook, miniBadge, miniImage, objectIcon, SpriteIndex, spriteLayers, TileMarkGlyph, UnitSprite, useSprites, WEAPON_LABEL, WeaponGlyph } from "./mapIcons";
import { ICON, LOW_HP } from "./model";
import { TEAM_LABEL } from "./marks";
import { Icon } from "../Icon";
import { CORNERS, cornerStacks, loadBattleOverlaySettings, overlaySizeStyle } from "../../exporting/videoLog";
import { NotchedRange } from "../Slider";
import { BattleNavContext, useBattleNav } from "./parts";
import { CameraTools, DEFAULT_ZOOM, view, ZOOM_TILES, zoomText, useMapCamera } from "./camera";
import { followed, Replay, ReplayBanner, ReplayBar, StepAnimation } from "./replay";
import { CondensedLog } from "./CondensedLog";

interface Props {
  board: Board;
  /** Ring this unit; with `focus`, fade the others so it stands out (and show it even if it fell). */
  selected?: string | null;
  focus?: boolean;
  /** Arrows for what a step of a replay did (the move, and the attack or heal). */
  action?: Action | null;
  /** The replay step being animated, if one is. */
  animation?: StepAnimation | null;
  onPick?: (id: string) => void;
  /** "compact" in cards (no HP bars, smaller), "full" on the Map tab. */
  size?: "compact" | "full";
  /** Story phase for standalone thumbnails, which resolve faces directly from each recorded identity. */
  part2?: boolean;
  label: string;
  /** Zoomed in: the part of the map in view, in tiles (none: the whole map). */
  zoom?: Zoom | null;
  /** The tile the game's map cursor is on. */
  cursor?: [number, number] | null;
  /** The wheel turned over the map, at (x, y) in tiles (to zoom there). */
  onWheelAt?: (x: number, y: number, deltaY: number) => void;
  /** The map dragged by (dx, dy) tiles (to pan a zoomed view). */
  onDrag?: (dx: number, dy: number) => void;
}

function useMinimapIndex(): MinimapIndex {
  const [index, setIndex] = useState<MinimapIndex>(EMPTY_MINIMAP_INDEX);
  useEffect(() => {
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setIndex(EMPTY_MINIMAP_INDEX);
      void loadGameJson<MinimapIndex>("data/minimap-terrain.json").then((data) => {
        if (generation === current && data && Array.isArray(data.maps) && typeof data.cell === "number" && data.cell > 0 && data.tiles && typeof data.tiles === "object") setIndex(data);
      });
    };
    load();
    const off = onGameAssetsChange(load);
    return () => { generation++; off(); };
  }, []);
  return index;
}

export interface Zoom {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** A unit as drawn at this moment: where (possibly between tiles), how opaque, and the HP its bar shows. */
interface Drawn {
  piece: Piece;
  x: number;
  y: number;
  opacity: number;
  hp: number | null;
}

/** What a step's effect draws at this moment: the attack's or heal's badge popping in at (bx, by), and a ring where
 * the blow lands or a pulse on the unit healed, at (x, y). */
interface Effect {
  kind: "attack" | "heal";
  x: number;
  y: number;
  bx: number;
  by: number;
  /** How far along it is (0-1). */
  t: number;
}

/** Where a step's attack or heal badge goes: between the two units, or on the unit's corner when it heals itself. */
function badgeSpot(actor: Piece, target: Piece | undefined): [number, number] {
  return target && target.id !== actor.id ? [(actor.x + actor.span / 2 + target.x + target.span / 2) / 2, (actor.y + actor.span / 2 + target.y + target.span / 2) / 2] : [actor.x + actor.span * 0.82, actor.y + actor.span * 0.18];
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
/** How far along a stage from `start` to `end` (ms) is at `now`: 1 once done, or if it takes no time. */
const progress = (now: number, start: number, end: number) => (end > start ? clamp01((now - start) / (end - start)) : 1);
// How far toward its target an attacker lunges (tiles), and when in the attack the blow lands (0-1).
const LUNGE = 0.42;
const IMPACT = 0.5;

/** Everyone as drawn at this moment of a step's animation, and its effects; or the step as it stands. */
function stage(board: Board, animation: StepAnimation | null | undefined, keep: string | null): { drawn: Drawn[]; effects: Effect[] } {
  if (!animation) {
    return {
      drawn: board.pieces.filter((p) => !p.down || p.id === keep).map((p) => ({ piece: p, x: p.x, y: p.y, opacity: 1, hp: p.hp })),
      effects: [],
    };
  }
  const { before, action, timing, elapsed } = animation;
  const move = ease(progress(elapsed, 0, timing.move));
  const act = progress(elapsed, timing.move, timing.act);
  const fade = progress(elapsed, timing.act, timing.fade);
  const landed = act >= IMPACT;
  const was = new Map(before.pieces.map((p) => [p.id, p]));
  const now = new Map(board.pieces.map((p) => [p.id, p]));
  const drawn: Drawn[] = [];
  const effects: Effect[] = [];
  const actor = action ? now.get(action.actor) : undefined;
  const target = action?.target ? now.get(action.target) : undefined;
  for (const p of board.pieces) {
    const q = was.get(p.id);
    if (q?.down && p.down) continue; // gone before this step
    if (!q) {
      if (!p.down) drawn.push({ piece: p, x: p.x, y: p.y, opacity: fade, hp: p.hp }); // arrived: fades in
      continue;
    }
    let x = q.x + (p.x - q.x) * move;
    let y = q.y + (p.y - q.y) * move;
    if (action?.kind === "attack" && actor && target && p.id === actor.id && act > 0 && act < 1) {
      // The attacker lunges at its target and back: the blow lands at the peak.
      const dx = target.x - actor.x;
      const dy = target.y - actor.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.sin(Math.PI * act) * Math.min(LUNGE, Math.max(0, length - 0.55));
      x += (dx / length) * reach;
      y += (dy / length) * reach;
    }
    const fell = p.down && !q.down;
    const revived = q.down && !p.down; // played backwards, a unit that fell gets up again
    drawn.push({ piece: p, x, y, opacity: fell ? 1 - fade : revived ? fade : 1, hp: landed ? p.hp : q.hp });
  }
  for (const q of before.pieces) {
    if (!q.down && !now.has(q.id)) drawn.push({ piece: q, x: q.x, y: q.y, opacity: 1 - fade, hp: q.hp }); // left the map
  }
  if (action && actor && act > 0 && act < 1) {
    const [bx, by] = badgeSpot(actor, target);
    if (action.kind === "attack" && target) {
      effects.push({ kind: "attack", x: bx, y: by, bx, by, t: act });
    } else if (action.kind === "heal") {
      const healed = target ?? actor;
      effects.push({ kind: "heal", x: healed.x + healed.span / 2, y: healed.y + healed.span / 2, bx, by, t: act });
    }
  }
  return { drawn, effects };
}

export function Minimap({ board, selected, focus, action, animation, onPick, size = "full", part2 = false, label, zoom, cursor, onWheelAt, onDrag }: Props) {
  const automatic = useContext(PortraitPhaseContext) === "auto";
  const uid = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  // A drag that just ended swallows the click the browser sends after it (once).
  const dragged = useRef(false);
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    svg.current?.classList.remove("dragging");
    if (!d) return;
    if (d.moved) {
      dragged.current = true;
      window.setTimeout(() => (dragged.current = false), 0);
      if (svg.current?.hasPointerCapture(d.id)) svg.current.releasePointerCapture(d.id);
    }
  };
  const view = useRef(zoom);
  view.current = zoom;
  /** A pointer position in tiles on the (possibly zoomed) map. */
  const toTiles = (clientX: number, clientY: number): [number, number] | null => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const z = view.current;
    return z ? [p.x + z.x0, p.y + z.y0] : [p.x, p.y];
  };
  const wheel = useRef(onWheelAt);
  wheel.current = onWheelAt;
  const wheelable = !!onWheelAt;
  useEffect(() => {
    // Not React's onWheel: it's passive, and the page mustn't scroll while the map zooms.
    const el = svg.current;
    if (!el || !wheelable) return;
    const handler = (e: WheelEvent) => {
      const at = toTiles(e.clientX, e.clientY);
      if (!at || !wheel.current) return;
      e.preventDefault();
      wheel.current(at[0], at[1], e.deltaY);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelable]);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!onDrag || !zoom || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !onDrag) return;
    // The button was let go somewhere we didn't hear about (outside the window, over a menu): the drag is over.
    if (e.buttons === 0) return endDrag();
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    if (!d.moved) {
      svg.current?.setPointerCapture(e.pointerId);
      svg.current?.classList.add("dragging");
    }
    d.moved = true;
    const perTile = svg.current?.getScreenCTM()?.a ?? 1; // screen pixels per tile
    onDrag((d.x - e.clientX) / perTile, (d.y - e.clientY) / perTile);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const { w, h, pieces, terrain, tiles } = board;
  // The game's own minimap; missing native artwork remains an explicit unavailable state.
  const index = useMinimapIndex();
  const candidate = gameMinimap(board.mapId, index);
  const ownUrl = useGameImageUrl(candidate?.imported ?? "");
  const own = candidate && ownUrl ? { ...candidate, href: ownUrl } : null;
  const runs = useMemo(() => (terrain ? terrainRuns(terrain) : []), [terrain]);
  const marks = useMemo(() => (terrain ? tileMarks(terrain, tiles) : []), [terrain, tiles]);
  // Breakable walls already broken: their icon goes.
  const broken = new Set(pieces.filter((p) => p.object && p.down).map((p) => `${p.x},${p.y}`));
  const nav = useContext(BattleNavContext);
  const portraitOf = nav?.portrait;
  const look = nav?.mapLook ?? DEFAULT_LOOK;
  const sprites = useSprites();
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const actor = action ? byId.get(action.actor) : undefined;
  const target = action?.target ? byId.get(action.target) : undefined;
  const { drawn, effects } = stage(board, animation, focus ? (selected ?? null) : null);
  // The trail of a step's move once its unit got there, the line to whoever it attacked or healed from then on, and
  // that badge once the action's own pops in is over.
  const moved = !animation || animation.elapsed >= animation.timing.move;
  const acted = !animation || animation.elapsed >= animation.timing.act;
  // The acting unit's army: its arrows, badges and impact rings take that army's colour (as the replay labels do).
  const side = actor ? (actor.army ? "player" : actor.sprite.side) : "player";
  const aimed = action?.kind === "attack" || action?.kind === "heal" ? action.kind : null;
  const mid = (n: number) => n + 0.5;
  const pick = (id: string) => onPick?.(id);
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(id);
    }
  };

  return (
    <svg
      ref={svg}
      className={`minimap ${size}${zoom ? " zoomed" : ""}${animation ? " animating" : ""}`}
      viewBox={zoom ? `0 0 ${zoom.w} ${zoom.h}` : `-0.15 -0.15 ${w + 0.3} ${h + 0.3}`}
      style={{ aspectRatio: zoom ? `${zoom.w} / ${zoom.h}` : `${w + 0.3} / ${h + 0.3}` }}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onClickCapture={(e) => {
        // A drag isn't a click on the unit it ended over.
        if (dragged.current) e.stopPropagation();
      }}
      onPointerLeave={() => {
        if (!drag.current?.moved) drag.current = null;
      }}
    >
      <defs>
        {/* The inside of a portrait badge, in a token's own tile coordinates. */}
        <clipPath id={`${uid}-inset`}>
          <rect x={PORTRAIT.x + PORTRAIT_EDGE} y={PORTRAIT.y + PORTRAIT_EDGE} width={PORTRAIT.w - 2 * PORTRAIT_EDGE} height={PORTRAIT.h - 2 * PORTRAIT_EDGE} rx={PORTRAIT.r - PORTRAIT_EDGE} />
        </clipPath>
        {/* The minimap's grid cell and its tiles, one per tile (a tile a little inside its cell, so the grid shows
            between them as in the game's minimaps). */}
        <pattern id={`${uid}-grid`} width={1} height={1} patternUnits="userSpaceOnUse">
          <MapImage href={miniImage("grid")} width={1} height={1} preserveAspectRatio="none" />
        </pattern>
      </defs>
      <g className="map-zoom" style={zoom ? { transform: `translate(${-zoom.x0}px, ${-zoom.y0}px)` } : undefined}>
      <rect className="map-ground" x={0} y={0} width={w} height={h} />
      {own && terrain ? (
        // Its grid line runs round it: a pixel past the map on each side. own.href is the imported file's URL,
        // already loaded, so it's drawn as is (MapImage only resolves the bundled names).
        <image
          className="map-own"
          href={own.href}
          x={-1 / own.cell}
          y={-1 / own.cell}
          width={Math.max(...terrain.map((row) => row.length)) + 2 / own.cell}
          height={terrain.length + 2 / own.cell}
          preserveAspectRatio="none"
        />
      ) : (
        <text x={0} y={0.5} className="game-asset-map-missing" data-asset-error="missing">{terrain ? "Map image unavailable; reprocess your game files" : "Terrain not recorded"}</text>
      )}
      {terrain && (
        <g className="map-terrain" shapeRendering="crispEdges">
          {runs.map((r) => {
            const t = tiles[String(r.id)];
            return (
              <rect key={`${r.x},${r.y}`} className="map-tile" x={r.x} y={r.y} width={r.w} height={1} fill="transparent">
                {size === "full" && <title>{t ? describeTile(t) : `Terrain ${r.id}`}</title>}
              </rect>
            );
          })}
        </g>
      )}
      {marks.length > 0 && (
        <g className="map-marks">
          {marks
            .filter((m) => !broken.has(`${m.x},${m.y}`))
            .map((m) => (
              <g key={`${m.x},${m.y}`} transform={`translate(${m.x} ${m.y})`}>
                <TileMarkGlyph mark={m.mark} />
              </g>
            ))}
        </g>
      )}
      {moved && actor && action?.from && (
        <g className={`map-tone ${side}`}>
          <Trail key={`${action.actor} ${action.from}`} id={`${uid}-move`} from={[action.from[0] + actor.span / 2, action.from[1] + actor.span / 2]} to={[actor.x + actor.span / 2, actor.y + actor.span / 2]} gap={[0.2, 0.36 * actor.span]} />
          <ActionBadge kind="move" cx={mid(action.from[0])} cy={mid(action.from[1])} r={0.17} />
        </g>
      )}
      {drawn.map((d) => (
        <Token
          key={d.piece.id}
          piece={d.piece}
          x={d.x}
          y={d.y}
          opacity={d.opacity}
          hp={d.hp}
          tile={tileAt(board, d.piece.x, d.piece.y)}
          portrait={portraitOf ? portraitOf(d.piece.id) : faceUrl({ ...d.piece.sprite, name: d.piece.name, seed: d.piece.id }, part2, automatic)}
          importedFace={nav?.importedFace?.(d.piece.id) ?? null}
          sprites={sprites}
          look={look}
          clip={`url(#${uid}-inset)`}
          full={size === "full"}
          selected={d.piece.id === selected}
          faded={!!focus && !!selected && d.piece.id !== selected}
          acting={d.piece.id === action?.actor || d.piece.id === action?.target}
          targeted={action?.kind === "attack" && d.piece.id === action.target}
          onPick={onPick ? pick : undefined}
          onKey={onPick ? onKey : undefined}
        />
      ))}
      {moved && actor && target && (
        <g className={`map-tone ${aimed ? side : "aim"}`}>
          <Trail key={`${actor.id} ${target.id}`} id={`${uid}-aim`} from={[actor.x + actor.span / 2, actor.y + actor.span / 2]} to={[target.x + target.span / 2, target.y + target.span / 2]} gap={[0.36 * actor.span, 0.36 * target.span]} />
        </g>
      )}
      {acted && aimed && actor && (aimed === "heal" || target) && (
        <g transform={`translate(${badgeSpot(actor, target).join(" ")})`}>
          <ActionBadge kind={aimed} team={side} cx={0} cy={0} />
        </g>
      )}
      {effects.map((e, i) => {
        // The badge grows in toward the moment the blow lands (or the heal is given), a little past full size, and
        // settles; a ring spreads from where it lands, or rings pulse on whoever is healed.
        const grow = clamp01(e.t / IMPACT);
        const after = clamp01((e.t - IMPACT) / (1 - IMPACT));
        const scale = 0.55 + 0.45 * ease(grow) + 0.14 * Math.sin(Math.PI * after);
        return (
          <g key={i} className={`map-effect map-tone ${side}`}>
            {e.kind === "attack"
              ? after > 0 && <circle className="map-effect-ring" cx={e.x} cy={e.y} r={0.22 + 0.36 * after} style={{ opacity: 0.8 * (1 - after) }} />
              : [0, 0.35].map((delay) => {
                  const t = clamp01((e.t - delay) / 0.65);
                  return t > 0 && t < 1 ? <circle key={delay} className="map-effect-ring" cx={e.x} cy={e.y} r={0.25 + 0.45 * t} style={{ opacity: 0.8 * (1 - t) }} /> : null;
                })}
            {e.kind === "heal" && <circle className="map-effect-glow" cx={e.x} cy={e.y} r={0.42} style={{ opacity: 0.4 * Math.sin(Math.PI * e.t) }} />}
            <g transform={`translate(${e.bx} ${e.by}) scale(${scale})`} style={{ opacity: clamp01(e.t / 0.15) }}>
              <ActionBadge kind={e.kind} team={side} cx={0} cy={0} />
            </g>
          </g>
        );
      })}
      {cursor && (
        <g className="map-game-cursor" style={{ transform: `translate(${cursor[0]}px, ${cursor[1]}px)` }}>
          <MapImage className="map-cursor game" href={miniImage("cursor")} x={-0.2} y={-0.2} width={1.4} height={1.4} />
        </g>
      )}
      </g>
    </svg>
  );
}

// A trail's arrowhead: how long and how wide each side of it (tiles).
const HEAD = 0.24;
const HEAD_W = 0.14;

/**
 * A soft line between two tile centres in its group's tone (`--tone`, styles.css .map-tone), faint where it sets out
 * and full at its rounded arrowhead, over a light shadow so it reads on any ground. It stops short of what's at either
 * end (`gap`, tiles: about a token's radius, or the badge it starts from) so its head stays visible. In tiles, so it
 * scales with the units at every zoom.
 */
function Trail({ id, from, to, gap: [g1, g2] }: { id: string; from: [number, number]; to: [number, number]; gap: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length <= g1 + g2 + HEAD) return null;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const [sx, sy] = [x1 + ux * g1, y1 + uy * g1];
  const [ex, ey] = [x2 - ux * g2, y2 - uy * g2];
  const [bx, by] = [ex - ux * HEAD, ey - uy * HEAD];
  const head = `M ${ex} ${ey} L ${bx - uy * HEAD_W} ${by + ux * HEAD_W} L ${bx + uy * HEAD_W} ${by - ux * HEAD_W} Z`;
  return (
    <g className="map-trail">
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={sx} y1={sy} x2={bx} y2={by}>
        <stop offset={0} className="map-trail-faint" />
        <stop offset={1} className="map-trail-full" />
      </linearGradient>
      <path className="map-trail-shadow" d={`M ${sx} ${sy} L ${bx} ${by} ${head}`} />
      <line className="map-trail-line" x1={sx} y1={sy} x2={bx} y2={by} stroke={`url(#${id})`} />
      <path className="map-trail-head" d={head} />
    </g>
  );
}

const Token = memo(function Token({
  piece: p,
  x,
  y,
  opacity,
  hp: hpNow,
  tile,
  portrait,
  importedFace,
  sprites,
  look,
  clip,
  full,
  selected,
  faded,
  acting,
  targeted,
  onPick,
  onKey,
}: {
  piece: Piece;
  x: number;
  y: number;
  opacity: number;
  hp: number | null;
  tile: TerrainTile | null;
  portrait: string | null;
  importedFace: string | null;
  sprites: SpriteIndex | null;
  look: MapLook;
  clip: string;
  full: boolean;
  selected: boolean;
  faded: boolean;
  acting: boolean;
  /** Attacked in the replay step: framed with the game's attack-target cursor. */
  targeted?: boolean;
  onPick?: (id: string) => void;
  onKey?: (e: KeyboardEvent, id: string) => void;
}) {
  const hp = hpNow === null || !p.max ? null : Math.max(0, Math.min(1, hpNow / p.max));
  const tone = hp === null ? "" : hp <= 0.3 ? "bad" : hp <= 0.6 ? "warn" : "good";
  // Down once the blow that felled it lands (until then, in a replay step, it shows the HP it had).
  const down = p.down && (hpNow ?? 0) <= 0;
  const low = !down && hp !== null && hp <= LOW_HP;
  const cls = ["map-piece", p.army ? "ally" : "foe", down ? "down" : "", low ? "low" : "", selected ? "selected" : "", faded ? "faded" : "", acting ? "acting" : "", onPick ? "pickable" : ""];
  const label = [describe(p, tile), !p.army && !p.object ? (WEAPON_LABEL[p.weapon] ?? "Unarmed") : null].filter(Boolean).join(" · ");
  const army = p.sprite.side;
  const named = p.army || p.sprite.character !== null;
  // Your army's settings cover every unit on your side: the house leaders in the prologue come from the battle records.
  const want = p.army || army === "player" ? look.mine : look.others;
  // A unit with no map sprite shows its portrait instead, on the map only; with no portrait either it shows "?".
  const layers = p.object || want !== "sprites" || !sprites ? null : spriteLayers(sprites, p.sprite, named);
  const importedFaceUrl = useGameImageUrl(importedFace ?? "");
  const spriteUrl = useGameImageUrl("images/map/class-sprites.png");
  const hasSprite = !!(sprites && layers && spriteUrl);
  const wantsFace = want === "portraits" || (want === "sprites" && !hasSprite);
  const face = !p.object && wantsFace ? (importedFace ? importedFaceUrl : portrait) : null;
  // The HP bar just under the unit's tile, as wide as its badge.
  const bar = face ? { x: PORTRAIT.x, w: PORTRAIT.w } : { x: BADGE.x, w: BADGE.size };
  return (
    <g
      className={cls.filter(Boolean).join(" ")}
      // Drawn in the tile's own coordinates and moved there, so a unit glides to its new tile.
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: opacity < 1 ? opacity : undefined }}
      role={onPick ? "button" : "img"}
      tabIndex={onPick ? 0 : undefined}
      aria-label={label}
      onClick={onPick ? () => onPick(p.id) : undefined}
      onKeyDown={onKey ? (e) => onKey(e, p.id) : undefined}
    >
      <title>{label}</title>
      <g className="map-footprint" transform={`scale(${p.span})`}>
      {/* A whole tile to hover and click, not just the token. */}
      <rect className="map-hit" x={0} y={0} width={1} height={1} />
      {p.object ? (
        <g className="map-token object">
          <MapImage href={objectIcon(p.name)} x={0} y={0} width={1} height={1} />
        </g>
      ) : hasSprite && sprites && layers ? (
        <g className="map-token sprite">
          <UnitSprite index={sprites} layers={layers} side={army} />
        </g>
      ) : want !== "badges" && !face ? (
        <g className="map-token unavailable" data-asset-error="missing"><title>{`${p.name}'s ${want === "sprites" ? "map sprite or portrait" : "portrait"} unavailable; reprocess your game files.`}</title><text x={0.5} y={0.5} className="game-asset-map-missing">?</text></g>
      ) : face ? (
        // A portrait: a rounded badge, a dark shade of the army's colour in a ring of it.
        <g className={`map-token ${army} portrait`}>
          <rect className="map-badge" x={PORTRAIT.x} y={PORTRAIT.y} width={PORTRAIT.w} height={PORTRAIT.h} rx={PORTRAIT.r} />
          <MapImage
            href={portrait ?? ""}
            imported={importedFace}
            x={PORTRAIT.x + PORTRAIT_EDGE}
            y={PORTRAIT.y + PORTRAIT_EDGE}
            width={PORTRAIT.w - 2 * PORTRAIT_EDGE}
            height={PORTRAIT.h - 2 * PORTRAIT_EDGE}
            clipPath={clip}
            preserveAspectRatio="xMidYMin slice"
          />
        </g>
      ) : (
        <g className={`map-token ${army}`}>
          <rect className="map-badge" x={BADGE.x} y={BADGE.y} width={BADGE.size} height={BADGE.size} rx={0.16} />
          <MapImage href={miniBadge(army)} x={BADGE.x} y={BADGE.y} width={BADGE.size} height={BADGE.size} />
          <WeaponGlyph kind={p.weapon} cx={0.5} cy={BADGE.y + BADGE.size / 2} size={BADGE.size * 0.8} />
        </g>
      )}
      {down && !p.object && <ActionBadge kind={p.army ? "fell" : "defeat"} cx={0.8} cy={0.2} r={0.17} />}
      {full && hp !== null && !down && !p.object && (
        <g className={`map-hp ${army} ${tone}`}>
          <rect className="map-hp-bg" x={bar.x} y={HP_Y} width={bar.w} height={HP_H} />
          <rect className="map-hp-fill" x={bar.x + HP_IN} y={HP_Y + HP_IN} width={Math.max(0.02, (bar.w - 2 * HP_IN) * hp)} height={HP_H - 2 * HP_IN} />
        </g>
      )}
      {(selected || acting) && <Cursor kind={selected ? "picked" : targeted ? "target" : "acting"} />}
      </g>
    </g>
  );
});

const DEFAULT_LOOK: MapLook = { mine: "portraits", others: "sprites", myFaces: "portraits", otherFaces: "portraits" };

/** A unit's octagon badge, nearly filling its tile. */
const BADGE = { x: 0.05, y: 0.05, size: 0.9 };
/** A portrait's rounded badge in its tile, and the width of its ring. */
const PORTRAIT = { x: 0.05, y: 0.05, w: 0.9, h: 0.9, r: 0.16 };
const PORTRAIT_EDGE = 0.06;
/** The HP bar: thin, black, just under the unit's tile (over the top of the tile below), the fill inset. */
const HP_Y = 1.01;
const HP_H = 0.11;
const HP_IN = 0.025;


/** Four rounded corners just around a tile: the unit picked (the app's accent) or one acting in the replay step (the
 * same, quieter). The game's own cursor is the minimap's. */
function Cursor({ kind }: { kind: "picked" | "acting" | "target" }) {
  const a = -0.03;
  const b = 1.03;
  const l = 0.27;
  const r = 0.1;
  const d = [
    `M ${a} ${a + l} V ${a + r} Q ${a} ${a} ${a + r} ${a} H ${a + l}`,
    `M ${b - l} ${a} H ${b - r} Q ${b} ${a} ${b} ${a + r} V ${a + l}`,
    `M ${b} ${b - l} V ${b - r} Q ${b} ${b} ${b - r} ${b} H ${b - l}`,
    `M ${a + l} ${b} H ${a + r} Q ${a} ${b} ${a} ${b - r} V ${b - l}`,
  ];
  return <path className={`map-cursor ${kind}`} d={d.join(" ")} />;
}

/** What's on the map and what its shapes mean, in one panel floating over the map's top right corner: the counts
 * (your units, the others, defeated) always, the legend for the units, the replay's marks and terrain when it's
 * opened, and hidden to a small button. Remembered per map (`place`). */
export function MapKey({ board, replay, place, includeZero = true }: { board: Board; replay?: boolean; place: string; includeZero?: boolean }) {
  const [mode, setModeState] = useState<KeyMode>(() => loadKeyMode(place));
  // Whether the panel is as narrow as its counts: closing, the legend drops away first, then the panel narrows.
  const [narrow, setNarrow] = useState(mode !== "open");
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const setMode = (m: KeyMode) => {
    const el = panel.current;
    window.clearTimeout(timer.current);
    if (el) {
      el.style.width = "";
      el.style.transition = "";
    }
    if (mode === "open" && m === "closed" && el) {
      // Pin the width while the legend collapses, then glide to the width of the counts alone.
      el.style.width = `${el.offsetWidth}px`;
      timer.current = window.setTimeout(() => {
        flushSync(() => setNarrow(true));
        const from = el.offsetWidth;
        el.style.transition = "none";
        el.style.width = "max-content";
        const to = el.getBoundingClientRect().width;
        el.style.width = `${from}px`;
        void el.offsetWidth;
        el.style.transition = "width 0.26s cubic-bezier(0.3, 0.7, 0.3, 1)";
        el.style.width = `${to}px`;
        timer.current = window.setTimeout(() => {
          el.style.width = "";
          el.style.transition = "";
        }, 290);
      }, 300);
    } else setNarrow(m !== "open");
    setModeState(m);
    try {
      localStorage.setItem(`divine-pulse-map-key-${place}`, m);
    } catch {
      // Not kept; fine.
    }
  };
  if (mode === "hidden") {
    return (
      <div className="map-key-panel hidden">
        <button type="button" className="map-key-show" onClick={() => setMode("closed")} title="Show the legend" aria-label="Show the legend">
          <Icon name={CONCEPT_ICON.info} />
        </button>
      </div>
    );
  }
  const open = mode === "open";
  return (
    <div ref={panel} className={`map-key-panel${open ? " open" : ""}${narrow ? " narrow" : ""}`} role="group" aria-label="Map Legend">
      <div className="map-key-head">
        <button type="button" className="map-key-toggle" aria-expanded={open} onClick={() => setMode(open ? "closed" : "open")} title={open ? "Close the legend" : "Open the legend"}>
          <MapCounts board={board} includeZero={includeZero} />
          <Icon name={CONCEPT_ICON.down} className="map-key-caret" />
        </button>
        <button type="button" className="map-key-hide" onClick={() => setMode("hidden")} title="Hide the legend" aria-label="Hide the legend">
          <Icon name={CONCEPT_ICON.hide} />
        </button>
      </div>
      <Collapse open={open}>
        <MapLegend replay={replay} board={board} />
      </Collapse>
    </div>
  );
}

/** The legend's counts: units standing in each army (your army with your units outside the roster, allies, enemies, a
 * third army), 0 included, in the legend's order, then the killed. Also on its own over a video's map. */
export function MapCounts({ board, includeZero = true }: { board: Board; includeZero?: boolean }) {
  const { pieces } = board;
  const standing = (side: string) => pieces.filter((p) => !p.object && !p.down && (p.army ? "player" : p.sprite.side) === side).length;
  const down = pieces.filter((p) => p.down && !p.object).length;
  return (
    <>
      {(["player", "enemy", "ally", "third"] as const).map((side) => {
        const n = standing(side);
        if (!includeZero && !n) return null;
        return (
          <span key={side} className={`map-count team-${side}${n ? "" : " zero"}`} title={COUNT_TITLE[side]}>
            {n}
          </span>
        );
      })}
      {(includeZero || down > 0) && <span className={`map-count down${down ? "" : " zero"}`} title="Killed">
        {down}
      </span>}
    </>
  );
}

const COUNT_TITLE = { player: `${TEAM_LABEL.player} on the map`, ally: `${TEAM_LABEL.ally} on the map`, enemy: `${TEAM_LABEL.enemy} on the map`, third: `${TEAM_LABEL.third} on the map` };

type KeyMode = "open" | "closed" | "hidden";

function loadKeyMode(place: string): KeyMode {
  try {
    const m = localStorage.getItem(`divine-pulse-map-key-${place}`);
    return m === "open" || m === "closed" || m === "hidden" ? m : "closed";
  } catch {
    return "closed";
  }
}

/** What the shapes on the map mean, and with `board`'s terrain known, the kinds of tile on it and the icons on them. */
function MapLegend({ replay, board }: { replay?: boolean; board?: Board }) {
  const index = useMinimapIndex();
  const looks = new Set<string>();
  const marks = new Set<string>();
  if (board?.terrain) {
    for (const row of board.terrain) {
      for (const id of row) {
        const t = board.tiles[String(id)];
        const tile = minimapTile(id, t, index);
        const mark = tileMark(id, t);
        if (tile) looks.add(tile);
        if (mark) marks.add(mark);
      }
    }
  }
  const walls = board?.pieces.some((p) => p.object);
  return (
    <div className="map-legends">
      <p className="sub-title">Units</p>
      <p className="map-legend">
        <span className="map-key ally">{TEAM_LABEL.player}</span>
        <span className="map-key foe">{TEAM_LABEL.enemy}</span>
        <span className="map-key team-ally">{TEAM_LABEL.ally}</span>
        <span className="map-key team-third">{TEAM_LABEL.third}</span>
        {walls && <span className="map-key wall">Breakable Walls</span>}
        <span className="map-key down">Killed</span>
      </p>
      {replay && (
        <>
          <p className="sub-title">Replay</p>
          <p className="map-legend">
            {(
              [
                ["move", "Moved"],
                ["attack", "Attacked"],
                ["heal", "Healed"],
              ] as const
            ).map(([kind, text]) => (
              <span key={kind} className={`map-key act ${kind}`}>
                <Icon name={ICON[kind]} />
                {text}
              </span>
            ))}
          </p>
        </>
      )}
      {looks.size > 0 && (
        <>
          <p className="sub-title">Terrain</p>
          <p className="map-legend terrain-legend" aria-label="Terrain">
            {MINIMAP_TILES.filter((k) => looks.has(k.tile)).map((k) => (
              <span key={k.tile} className={`map-key tkey t-${k.tile}`}>
                {k.label}
              </span>
            ))}
            {TILE_MARKS.filter((k) => marks.has(k.mark)).map((k) => (
              <span key={k.mark} className="map-key mkey">
                <svg viewBox="0 0 1 1" aria-hidden="true">
                  <TileMarkGlyph mark={k.mark} />
                </svg>
                {k.label}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}

/** The map as it stands, small, in a unit's card: that unit ringed and the others faded (picking another opens its
 * card). Nothing when no position was read. */
export function MapSection({ battle, id }: { battle: Battle; id: string }) {
  const nav = useBattleNav();
  const board = useMemo(() => boardNow(battle), [battle]);
  const piece = board.pieces.find((p) => p.id === id);
  // Opens on the whole map and zooms in to the unit; the slider zooms around it.
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setLevel(DEFAULT_ZOOM));
    return () => cancelAnimationFrame(t);
  }, [id]);
  if (!hasMap(battle) || !piece) return null;
  const zoom = view([piece.x + piece.span / 2, piece.y + piece.span / 2], ZOOM_TILES[level], board);
  const tile = tileAt(board, piece.x, piece.y);
  const location = `${tile ? `${tile.name} ` : ""}(${piece.x},${piece.y})`;
  const locationLabel = `${piece.down ? (piece.army ? "Fell" : "Killed") : "Standing"} on ${location}`;
  return (
    <Section
      title="Position"
      summary={piece.down ? `${piece.army ? "Fell" : "Killed"} on ${piece.x}, ${piece.y}` : `Tile ${piece.x}, ${piece.y}`}
    >
      <div className="position-panel">
      <div className="position-map">
      <div className="position-map-zoom">
        <Icon name={CONCEPT_ICON.zoomIn} />
        <NotchedRange
          min={0} max={ZOOM_TILES.length - 1} value={level} onChange={setLevel}
          notches={ZOOM_TILES.map((_, at) => ({ at }))}
          label="Position map zoom" orientation="vertical" valueText={zoomText(level)}
          variant="timeline" className="slim"
        />
        <Icon name={CONCEPT_ICON.zoomOut} />
      </div>
      <div className="map-frame compact">
        <span className="position-map-location" aria-hidden title={tile ? describeTile(tile) : undefined}>{location}</span>
        <Minimap
          board={board}
          size="compact"
          selected={id}
          focus
          zoom={zoom}
          onPick={(other) => other !== id && nav.open(other)}
          label={`The battle map, with ${piece.name} ringed. ${locationLabel}`}
        />
      </div>
      </div>
      </div>
    </Section>
  );
}

/** The Overview's map: as big as the space it has, with the same replay as the Map tab along its side, following the
 * game's cursor live (or the action in a replay); picking a unit opens the Map tab at it. */
export function OverviewMap({ battle, replay }: { battle: Battle; replay: Replay }) {
  const nav = useBattleNav();
  const { board, at, cursor } = replay;
  const [layout] = useState(loadBattleOverlaySettings);
  const stacks = cornerStacks(layout);
  const camera = useMapCamera("overview", board, followed(replay), at === null ? `now ${cursor ?? ""}` : `step ${at}`);
  return (
    <div className="map-pane">
      {hasMap(battle) && (
        <div className="map-pane-head">
          <CameraTools camera={camera} />
        </div>
      )}
      <div className="map-frame fill">
        {hasMap(battle) ? (
          <Minimap
            board={board}
            action={replay.action}
            animation={replay.animation}
              onPick={(other) => nav.open(other)}
            label={at === null ? "The battle map now" : `The battle map at ${replay.label}`}
            zoom={camera.zoom}
            cursor={cursor}
            onWheelAt={camera.onWheelAt}
            onDrag={camera.onDrag}
          />
        ) : (
          <p className="muted small">No positions were read for this battle.</p>
        )}
        {replay.rewind && (
          <div className="rewind-badge" style={{ opacity: replay.rewind.badge, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * replay.rewind.badge})` }} aria-hidden>
            <Icon name={CONCEPT_ICON.pulse} />
          </div>
        )}
        {hasMap(battle) && CORNERS.map((corner) => (
          <div key={corner} className={`replay-stage-corner map-overlay-corner ${corner}`}>
            {stacks[corner].map((item) => item === "condensed" ?
              <CondensedLog key={item} entries={replay.condensed} current={replay.at} fade={replay.condensedShown} lines={layout.condensedLines} size={layout.condensedSize} /> :
              item === "counter" ? <ReplayBanner key={item} replay={replay} size={layout.counterSize} showTurn={layout.counterTurn} showPhase={layout.counterPhase} showStep={layout.counterStep} className="in-corner" /> :
              <div key={item} className="map-overlay-key" style={overlaySizeStyle(layout.countsSize)}><MapKey board={board} replay={replay.steps.length > 0} place="overview" includeZero={layout.countsZero} /></div>)}
          </div>
        ))}
      </div>
      {hasMap(battle) && <ReplayBar replay={replay} />}
    </div>
  );
}
