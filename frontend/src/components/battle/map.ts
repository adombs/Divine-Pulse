/**
 * The battle on the map: where each unit stands now, or after any step of the game's history (to replay the battle).
 * Pure functions: the Minimap and the Map tab only render these.
 */
import type { Battle, BattleUnit, EnemyStats, MapStep, TerrainTile } from "../../api";
import type { Sprite } from "./mapIcons";
import { armyId, enemyId, LOW_HP, people } from "./model";

/** Battle maps are at most this many tiles across and down. */
export const MAP_SIZE = 32;

/** A unit on the map. */
export interface Piece {
  id: string;
  name: string;
  army: boolean;
  x: number;
  y: number;
  hp: number | null;
  max: number | null;
  /** Defeated, or fell: drawn faint where it went down. */
  down: boolean;
  class_name: string;
  /** What it fights with, for its badge ("sword", "bow", "reason"...; "" when not known). */
  weapon: string;
  /** What it is, to draw its sprite (mapIcons.spriteLayers). */
  sprite: Sprite;
  /** Not a unit but a thing with HP of its own (a breakable wall). */
  object: boolean;
}

export interface Board {
  /** Tiles across and down: the whole map when its terrain is known, else the part units have stood on. */
  w: number;
  h: number;
  pieces: Piece[];
  /** The map's terrain (null: not read): a terrain ID per tile, rows from y = 0, and what each ID is. */
  terrain: number[][] | null;
  tiles: Record<string, TerrainTile>;
  /** Which map it is (the import's data/maps.json; null: not known), for the game's own minimap of it. */
  mapId: number | null;
}

/**
 * How a tile is drawn: as the game's minimap paints it, with one of its tiles (mini-<tile>.png) or none (plains,
 * grass, bridges, stairs and outdoor floors are the bare grid). Which terrain gets which tile is from the game's own
 * minimaps; a terrain ID they don't show is
 * placed by what it does. In legend order:
 */
export type MinimapTile = "floor" | "forest" | "thicket" | "cover" | "sand" | "water" | "shoal" | "heal" | "hazard" | "siege" | "fliers" | "impassable";

export const MINIMAP_TILES: { tile: MinimapTile; label: string }[] = [
  { tile: "floor", label: "Floor" },
  { tile: "forest", label: "Forest" },
  { tile: "thicket", label: "Thicket" },
  { tile: "cover", label: "Cover" },
  { tile: "sand", label: "Sand" },
  { tile: "water", label: "Water" },
  { tile: "shoal", label: "Shoal" },
  { tile: "heal", label: "Heals" },
  { tile: "hazard", label: "Hurts" },
  { tile: "siege", label: "Siege Weapon" },
  { tile: "fliers", label: "Fliers Only" },
  { tile: "impassable", label: "Impassable" },
];

export type MinimapIndex = { cell: number; maps: number[]; tiles: Record<string, string | null> };
export const EMPTY_MINIMAP_INDEX: MinimapIndex = { cell: 1, maps: [], tiles: {} };

/** The minimap tile a terrain ID is painted with (null: the bare grid). */
export function minimapTile(id: number, t: TerrainTile | undefined, index: MinimapIndex = EMPTY_MINIMAP_INDEX): MinimapTile | null {
  const known = index.tiles[String(id)];
  if (known !== undefined) return known ? (known.replace("tile-", "") as MinimapTile) : null;
  if (!t) return null;
  if (t.enter === "none") return "impassable";
  if (t.enter === "fliers") return "fliers";
  if (t.heal > 0) return "heal";
  if (t.heal < 0) return "hazard";
  if (t.avo > 0 || t.defense > 0 || t.res > 0) return "forest";
  if (t.avo < 0 || t.defense < 0) return "sand";
  return null;
}

/** The game's own minimap of the map with this ID, and its pixels per tile (null: none). */
export function gameMinimap(mapId: number | null, index: MinimapIndex = EMPTY_MINIMAP_INDEX): { href: string; imported: string; cell: number } | null {
  if (mapId === null || !index.maps.includes(mapId)) return null;
  return { href: "", imported: `images/map/minimaps/${mapId}.png`, cell: index.cell };
}

/** What a tile holds, as the game's minimap marks it with an icon: a chest, a door, a lever or seal, a Crest Stone,
 * a trap, a breakable wall, a warp tile. */
export type TileMark = "chest" | "door" | "lever" | "crest" | "trap" | "breakable" | "warp";

export const TILE_MARKS: { mark: TileMark; label: string }[] = [
  { mark: "chest", label: "Chest" },
  { mark: "door", label: "Door / gate" },
  { mark: "lever", label: "Lever / seal" },
  { mark: "crest", label: "Crest Stone" },
  { mark: "trap", label: "Trap" },
  { mark: "breakable", label: "Breakable Wall" },
  { mark: "warp", label: "Warp Tile" },
];

// Terrain IDs of breakable walls (the import's data/terrain.json), for battles saved before the tiles said so.
const BREAKABLE_IDS = new Set([38, 95]);
// The terrain IDs the game's minimap puts an icon on (its code switches on the terrain ID; docs/minimap-atlas.md).
const MARK_BY_ID: Record<number, TileMark> = { 46: "chest", 17: "door", 72: "door", 107: "door", 51: "lever", 108: "lever", 78: "crest", 50: "trap", 64: "trap", 69: "warp" };

/** The icon on a tile with this terrain ID, if the game's minimap has one. */
export function tileMark(id: number, t: TerrainTile | undefined): TileMark | null {
  return (t?.wall_hp ?? 0) > 0 || BREAKABLE_IDS.has(id) ? "breakable" : (MARK_BY_ID[id] ?? null);
}

/** The tile at (x, y), or null when the terrain isn't known there. */
export function tileAt(board: Pick<Board, "terrain" | "tiles">, x: number, y: number): TerrainTile | null {
  const id = board.terrain?.[y]?.[x];
  return id === undefined ? null : (board.tiles[String(id)] ?? null);
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** "Avo +30, Def +1": what a tile adds to the unit on it ("" for none). */
export function tileBonuses(t: TerrainTile): string {
  const parts: string[] = [];
  if (t.avo) parts.push(`Avo ${signed(t.avo)}`);
  if (t.defense) parts.push(`Def ${signed(t.defense)}`);
  if (t.res) parts.push(`Res ${signed(t.res)}`);
  if (t.heal) parts.push(t.heal > 0 ? `heals ${t.heal}% a turn` : `${-t.heal}% damage a turn`);
  return parts.join(", ");
}

/** "Forest (Avo +30, Def +1)", "Cliff (fliers only)": a tile's name with what it does. */
export function describeTile(t: TerrainTile): string {
  const extra = t.enter === "none" ? "impassable" : t.enter === "fliers" ? "fliers only" : tileBonuses(t);
  return extra ? `${t.name} (${extra})` : t.name;
}

/** Runs of the same tile along each row: one rect each to draw (a few hundred instead of up to 1,024). */
export interface TerrainRun {
  x: number;
  y: number;
  w: number;
  id: number;
}

export function terrainRuns(terrain: number[][]): TerrainRun[] {
  const out: TerrainRun[] = [];
  terrain.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      out.push({ x, y, w: end - x, id: row[x] });
      x = end;
    }
  });
  return out;
}

/** The tiles with something on them (TileMark), or that heal ("heal"), to draw an icon on. */
export function tileMarks(terrain: number[][], tiles: Record<string, TerrainTile>): { x: number; y: number; mark: TileMark }[] {
  const out: { x: number; y: number; mark: TileMark }[] = [];
  terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      const mark = tileMark(id, tiles[String(id)]);
      if (mark) out.push({ x, y, mark });
    }),
  );
  return out;
}

/** Where every unit stood after a step: uid -> [x, y, HP]. */
export type Frame = Map<string, [number, number, number]>;

const onMap = (x: number | null | undefined, y: number | null | undefined): boolean =>
  x !== null && x !== undefined && y !== null && y !== undefined && x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;

/** Whether any position was read in this battle (battles saved before positions were kept have none). */
export function hasMap(battle: Battle): boolean {
  return (
    battle.units.some((u) => onMap(u.x, u.y)) ||
    Object.values(battle.enemy_stats ?? {}).some((e) => onMap(e.x, e.y)) ||
    (battle.map_steps?.length ?? 0) > 0
  );
}

/** The map's terrain, if it was read and has a sensible shape (else null: the plain grid is drawn). */
function terrainOf(battle: Battle): number[][] | null {
  const t = battle.terrain;
  if (!t?.length || !t[0]?.length || t.length > MAP_SIZE || t.some((row) => !Array.isArray(row) || row.length > MAP_SIZE)) return null;
  return t;
}

function size(battle: Battle, pieces: Piece[]): Omit<Board, "pieces"> {
  const terrain = terrainOf(battle);
  const tw = terrain ? Math.max(...terrain.map((row) => row.length)) : 0;
  const w = Math.max(battle.map_w ?? 0, tw, ...pieces.map((p) => p.x + 1), 1);
  const h = Math.max(battle.map_h ?? 0, terrain?.length ?? 0, ...pieces.map((p) => p.y + 1), 1);
  return { w: Math.min(MAP_SIZE, w), h: Math.min(MAP_SIZE, h), terrain, tiles: terrain ? (battle.terrain_tiles ?? {}) : {}, mapId: terrain ? (battle.map_id ?? null) : null };
}

/** Everyone where they stand now: your units on the map, the other units (defeated ones where they fell). */
export function boardNow(battle: Battle): Board {
  const pieces: Piece[] = [];
  for (const u of battle.units) {
    if (!u.on_map || !onMap(u.x, u.y)) continue; // left the battle
    pieces.push({ id: armyId(u.key), name: u.name, army: true, x: u.x!, y: u.y!, hp: u.hp, max: u.now.hp, down: u.hp !== null && u.hp <= 0, class_name: u.class_name, weapon: u.weapon ?? "", sprite: armySprite(u), object: false });
  }
  for (const e of Object.values(battle.enemy_stats ?? {})) {
    if (e.left || !onMap(e.x, e.y)) continue; // taken off the map
    const down = !e.on_map || (e.hp !== null && e.hp <= 0);
    const object = isObject(e);
    pieces.push({ id: enemyId(e.slot), name: e.label, army: false, x: e.x!, y: e.y!, hp: e.hp === null ? null : Math.max(0, e.hp), max: e.max_hp, down, class_name: object ? "" : e.class_name, weapon: e.weapon ?? "", sprite: spriteOf(e), object });
  }
  return { ...size(battle, pieces), pieces: order(pieces) };
}

/** Where everyone on the map stood after each step of the history: frames[i] is the map after step i. Units off the
 * map then (`presence`: reinforcements still to come, a unit the story took off it) are left out. */
export function frames(steps: MapStep[], presence?: Battle["map_presence"]): Frame[] {
  const out: Frame[] = [];
  let state: Frame = new Map();
  steps.forEach((s, i) => {
    state = new Map(state);
    for (const [uid, at] of Object.entries(s.units)) state.set(uid, at);
    const shown = new Map(state);
    for (const [uid, marks] of Object.entries(presence ?? {})) if (!onMapAt(marks, i)) shown.delete(uid);
    out.push(shown);
  });
  return out;
}

/** Whether a unit is on the map at step i, from its presence marks (none: all along). */
export function onMapAt(marks: [number, boolean][], i: number): boolean {
  let on = true;
  for (const [step, visible] of marks) {
    if (step > i) break;
    on = visible;
  }
  return on;
}

/** The map after a step, from its frame. */
export function boardAt(battle: Battle, frame: Frame): Board {
  const who = people(battle);
  const pieces: Piece[] = [];
  for (const [id, [x, y, hp]] of frame) {
    if (!onMap(x, y)) continue;
    const w = who.get(id);
    const army = id.startsWith("a:");
    const max = w?.unit?.now.hp ?? w?.enemy?.max_hp ?? null;
    const object = !!w?.enemy && isObject(w.enemy);
    pieces.push({
      id, name: w?.name ?? "A unit", army, x, y, hp, max, down: hp <= 0,
      class_name: object ? "" : (w?.unit?.class_name ?? w?.enemy?.class_name ?? ""),
      weapon: w?.enemy?.weapon ?? w?.unit?.weapon ?? "",
      sprite: w?.unit ? armySprite(w.unit) : w?.enemy ? spriteOf(w.enemy) : UNKNOWN,
      object,
    });
  }
  return { ...size(battle, pieces), pieces: order(pieces) };
}

const UNKNOWN: Sprite = { classId: null, female: false, side: "enemy", character: null };

/** A breakable wall: the game keeps it as a unit (class Noble; on the enemy's side in battles saved before objects
 * were told apart). */
export function isObject(e: EnemyStats): boolean {
  return e.side === "object" || e.name === "Breakable Wall";
}

export function spriteOf(e: EnemyStats): Sprite {
  return { classId: e.class_id ?? null, female: !!e.female, side: isObject(e) ? "object" : (e.side ?? "enemy"), character: e.character ?? null };
}

export function armySprite(u: BattleUnit): Sprite {
  return { classId: u.class_id ?? null, female: !!u.female, side: "player", character: u.character ?? null, look: u.look ?? null };
}

/** Units that went down first, so the living are drawn on top. */
function order(pieces: Piece[]): Piece[] {
  return pieces.sort((a, b) => Number(b.down) - Number(a.down));
}

/** A unit's HP share (0-1), or null when its HP isn't known. */
export function share(p: Piece): number | null {
  return p.hp === null || !p.max ? null : Math.max(0, Math.min(1, p.hp / p.max));
}

export const isLow = (p: Piece): boolean => !p.down && (share(p) ?? 1) <= LOW_HP;

/** "Byleth · Enlightened One · 40/52 HP · tile 3, 25 · Forest (Avo +30, Def +1)": a piece's tooltip. */
export function describe(p: Piece, tile?: TerrainTile | null): string {
  const hp = p.hp === null ? null : p.max ? `${p.hp}/${p.max} HP` : `${p.hp} HP`;
  const state = p.down ? (p.army ? "fell here" : "killed here") : hp;
  return [p.name, p.class_name, state, `tile ${p.x}, ${p.y}`, tile ? describeTile(tile) : null].filter(Boolean).join(" · ");
}

const PHASE: Record<number, string> = { 0: "Player phase", 1: "Enemy phase" };

/** "Turn 3 · Enemy phase": when a step happened. */
export function stepLabel(step: MapStep): string {
  return `Turn ${step.turn} · ${PHASE[step.phase] ?? "Other phase"}`;
}

/** What a step did on the map, for its arrows and animation: who acted, the tile it moved from (null if it didn't
 * move), whom it acted on, and how: an attack, help (a heal, an item), or nothing more. */
export interface Action {
  actor: string;
  from: [number, number] | null;
  target: string | null;
  kind: "attack" | "heal" | "none";
}

export type StepKinds = Map<number, "attack" | "heal">;

/** The kind of each step's action, from the log (history position -> "attack" / "heal"). */
export function stepKinds(battle: Battle): StepKinds {
  const out: StepKinds = new Map();
  for (const e of battle.log ?? []) {
    if (e.step === null || e.step === undefined) continue;
    if (e.kind === "attack") out.set(e.step, "attack");
    else if ((e.kind === "heal" || e.kind === "item") && !out.has(e.step)) out.set(e.step, "heal");
  }
  return out;
}

export function stepAction(steps: MapStep[], all: Frame[], i: number, kinds?: StepKinds): Action | null {
  const step = steps[i];
  if (!step?.actor) return null;
  const before = i > 0 ? all[i - 1].get(step.actor) : undefined;
  const after = all[i].get(step.actor);
  const moved = before !== undefined && after !== undefined && (before[0] !== after[0] || before[1] !== after[1]);
  const target = step.target && step.target !== step.actor ? step.target : null;
  const kind = kinds?.get(step.step);
  return {
    actor: step.actor,
    from: moved ? [before[0], before[1]] : null,
    target,
    kind: kind === "attack" ? (target ? "attack" : "none") : kind === "heal" ? "heal" : "none",
  };
}

/** The first step of each turn, for jumping turn by turn. */
export function turnStarts(steps: MapStep[]): { turn: number; index: number }[] {
  const out: { turn: number; index: number }[] = [];
  steps.forEach((s, i) => {
    if (!out.length || out[out.length - 1].turn !== s.turn) out.push({ turn: s.turn, index: i });
  });
  return out;
}
