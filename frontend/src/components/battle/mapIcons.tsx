/**
 * The game's own icons for the battle map (imported from the game's UI textures): weapon glyphs for the other units' badges.
 * `kind` is EnemyStats.weapon ("sword", "lance", "axe", "bow", "gauntlets", "reason", "faith", "dark");
 * a unit with no weapon (a villager) fights with its fists, the game's gauntlets icon. The minimap's own pieces
 * (mini-*.png: its tiles, army badges, weapon glyphs, tile icons, cursors) come from its atlas, named by what the game
 * draws them for (our labels in tools/minimap_atlas.json). Units' sprites are put together from the game's
 * map sprite layers like the game does (class-sprites.png: class bodies and characters' finished sprites, a column per army; map-heads.png: heads;
 * their index in class-sprites.json).
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useEffect, useState } from "react";
import { ICON_PATHS } from "../iconPaths";
import { spoilerShown } from "../../spoilers";
import { ICON } from "./model";
import { MapImage, useGameImageUrl } from "../GameImage";
import { loadGameJson, onGameAssetsChange } from "../../gameAssets";
import { bundledGameImage } from "../gameImageSources";

export const WEAPON_LABEL: Record<string, string> = {
  sword: "Sword",
  lance: "Lance",
  axe: "Axe",
  bow: "Bow",
  gauntlets: "Gauntlets",
  reason: "Reason magic",
  faith: "Faith magic",
  dark: "Dark magic",
  "crest-stone": "Crest Stone Shard",
};

export const gameImage = (name: string) => bundledGameImage(`${name}.png`);

/** A weapon glyph centred on (cx, cy), `size` tiles across (white, for a badge): the minimap's own; no weapon is
 * fists. */
export function WeaponGlyph({ kind, cx, cy, size }: { kind?: string | null; cx: number; cy: number; size: number }) {
  const glyph = useGameImageUrl(miniWeapon(kind));
  return glyph
    ? <image className="map-glyph" href={glyph} x={cx - size / 2} y={cy - size / 2} width={size} height={size} />
    : <text x={cx} y={cy} className="game-asset-map-missing" data-asset-error="missing"><title>Weapon glyph unavailable; reprocess your game files.</title>?</text>;
}

/** The battle minimap's own pieces (mini-*.png, from the game's minimap atlas): its weapon glyphs, terrain tiles,
 * army badges and icons. */
export const miniImage = (name: string) => gameImage(`mini-${name}`);

/** The minimap's weapon glyph for EnemyStats.weapon: no weapon is fists. */
export const miniWeapon = (kind?: string | null) => miniImage(`weapon-${kind && WEAPON_LABEL[kind] ? kind : "gauntlets"}`);

/** The minimap's octagon badge for an army (objects have none: they're drawn as their icon). */
export const miniBadge = (side: Side) => miniImage(`badge-${side === "object" ? "enemy" : side}`);

/** The minimap's icon for a thing on the map that is a unit in the game (a breakable wall): on the map and as its
 * portrait. */
export const objectIcon = (name: string) => miniImage(OBJECT_ICONS[name] ?? "wall");

const OBJECT_ICONS: Record<string, string> = { "Breakable Wall": "wall" };

/** The game's names of things it keeps as units (backend battle.OBJECT_NAMES). */
export const OBJECT_NAMES: ReadonlySet<string> = new Set(Object.keys(OBJECT_ICONS));

/** A small round badge with the log's icon for a kind of action (model.ICON: "move", "attack", "heal", "fell"...),
 * centred on (cx, cy), `r` tiles in radius: where a step's unit set out, where an attack landed or a heal was given,
 * a unit that fell. Coloured by its kind (styles.css .map-act). */
export function ActionBadge({ kind, cx, cy, r = 0.2, team }: { kind: string; cx: number; cy: number; r?: number; team?: string }) {
  const paths: Partial<Record<string, string>> = ICON_PATHS[ICON[kind] ?? CONCEPT_ICON.wait];
  const s = r * 1.2;
  return (
    <g className={`map-act ${kind}${team ? ` team-${team}` : ""}`}>
      <circle cx={cx} cy={cy} r={r} />
      <svg x={cx - s / 2} y={cy - s / 2} width={s} height={s} viewBox="0 0 256 256" fill="currentColor" dangerouslySetInnerHTML={{ __html: paths.duotone ?? "" }} />
    </g>
  );
}

/** Which army a unit is in, for its colour on the map ("object": a breakable wall). */
export type Side = "player" | "enemy" | "ally" | "third" | "object";

/** What a unit on the map is, to draw its sprite: the game's class ID (null: not known), its gender, its army, and
 * for a character of their own (not a generic unit), the game's character ID. */
export interface Sprite {
  classId: number | null;
  female: boolean;
  side: Side;
  character: number | null;
  /** Byleth's hair: "green" draws the sprite from after the Sothis merge. */
  look?: string | null;
}

/** How a kind of unit is drawn on the map: a badge in its army's colour with its portrait, its map sprite, or a badge
 * with its weapon's glyph, like the game's minimap. */
export type UnitLook = "portraits" | "sprites" | "badges";

/** How a unit's face is drawn in lists (the Units section, a unit's card): the same choice as the map, with plain
 * portraits or sprites. */
export type FaceLook = "portraits" | "sprites";

export const FACE_LOOKS: readonly (readonly [FaceLook, string])[] = [
  ["portraits", "Portraits"],
  ["sprites", "Sprites"],
];

export const UNIT_LOOKS: readonly (readonly [UnitLook, string])[] = [
  ["portraits", "Portraits"],
  ["sprites", "Sprites"],
  ["badges", "Weapon Badges"],
];

/** How your units and other units are drawn in battle. */
export interface MapLook {
  mine: UnitLook;
  others: UnitLook;
  myFaces: FaceLook;
  otherFaces: FaceLook;
}

/** Class and character sprite atlas index. */
export interface SpriteIndex {
  /** One sprite's size in class-sprites.png (pixels), its columns (by army) and rows. */
  cell: [number, number];
  armies: Side[];
  rows: number;
  /** Class ID -> body row by gender; rows with a mount; character ID -> their finished sprite's row. */
  classes: Record<string, { m?: number; f?: number }>;
  mounted: number[];
  characters: Record<string, number>;
  /** Special classes with verified complete sprites (heads already included). */
  finished_classes?: Record<string, { m?: number; f?: number }>;
  /** A character's finished sprite in a class, by character ID then class ID (Jeralt as a Paladin; absent in imports
   * made before the importer read them). */
  character_classes?: Record<string, Record<string, number>>;
  /** map-heads.png: one head's size, where it goes in a body's cell (higher on a mount), and its rows. */
  head_cell: [number, number];
  head_at: [number, number];
  mounted_head_at: [number, number];
  heads: { m: number; f: number; characters: Record<string, number>; rows: number };
  /** Class ID -> the first row of its generic head by gender, then a row per army in `armies` order (absent in imports
   * made before the importer read them). */
  class_heads?: Record<string, { m?: number; f?: number }>;
  /** Other looks of a character, by character ID: finished sprite rows and head rows (absent in imports made before
   * the importer read them, which then draw the first look). */
  looks?: Record<string, { characters: Record<string, number>; heads: Record<string, number> }>;
}

/** The sprite atlases' index, once loaded (null until then, or if it can't be). */
export function useSprites(): SpriteIndex | null {
  const [index, setIndex] = useState<SpriteIndex | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setIndex(null);
      void loadGameJson<SpriteIndex>("data/class-sprites.json").then((imported) => {
        if (live && current === generation) setIndex(imported);
      });
    };
    load();
    const off = onGameAssetsChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return index;
}

interface Layers {
  row: number;
  head: number | null;
  mounted: boolean;
}

/** The head the game gives a unit with no head of its own: its class's generic head in its army's colour (Thieves get
 * the red-haired thief's head as enemies, a Paladin the blond one), else the plain generic head of imports made
 * before the importer read class heads. */
function classHead(index: SpriteIndex, s: Sprite, gender: "m" | "f"): number {
  const first = s.classId === null ? undefined : index.class_heads?.[s.classId]?.[gender];
  const army = index.armies.indexOf(s.side === "object" ? "enemy" : s.side);
  return first !== undefined && army >= 0 ? first + army : index.heads[gender];
}

/** The atlas rows to draw a unit from, as the game picks them from the unit's class, gender, army and character (all
 * read from memory): the class's body with the character's own head, else the class's generic head in the army's
 * colour; a character in Noble / Commoner (no body), or with no head of their own in a class with no body (Rhea,
 * Sothis), wears their finished sprite. Null: no sprite for it. */
export function spriteLayers(index: SpriteIndex, s: Sprite, named: boolean): Layers | null {
  // A character's uncovered head can identify a masked class before the story does.
  if (!spoilerShown("identities") && s.classId !== null && [47, 48, 59, 91].includes(s.classId)) named = false;
  const finished = s.classId === null ? undefined : index.finished_classes?.[s.classId];
  const finishedRow = finished && (s.female ? finished.f ?? finished.m : finished.m ?? finished.f);
  if (finishedRow !== undefined) return { row: finishedRow, head: null, mounted: false };
  // Only the green look has its own sprites; the dark one (before the Sothis merge) is the default art.
  const look = s.look && s.character !== null ? index.looks?.[s.look] : undefined;
  const bodies = s.classId === null ? undefined : index.classes[s.classId];
  const gender: "m" | "f" = bodies ? (s.female ? (bodies.f !== undefined ? "f" : "m") : (bodies.m !== undefined ? "m" : "f")) : s.female ? "f" : "m";
  const body = bodies?.[gender];
  const generic = () => (body === undefined ? null : { row: body, head: classHead(index, s, gender), mounted: index.mounted.includes(body) });
  if (!named || s.character === null) return generic();
  const key = String(s.character);
  const own = look ? look.characters[key] : index.characters[s.character];
  // A character's own sprite in their class (Jeralt mounted as a Paladin).
  const inClass = s.classId === null ? undefined : index.character_classes?.[key]?.[s.classId];
  if (inClass !== undefined) return { row: inClass, head: null, mounted: body !== undefined && index.mounted.includes(body) };
  if ((s.classId === 0 || s.classId === 1) && own !== undefined) return { row: own, head: null, mounted: false };
  const head = look ? look.heads[key] : index.heads.characters[s.character];
  if (head !== undefined) return body === undefined ? null : { row: body, head, mounted: index.mounted.includes(body) };
  // No head of their own (Jeralt, Kostas, the other named NPCs): the class's generic one, as the game draws them.
  if (body !== undefined) return generic();
  return own !== undefined ? { row: own, head: null, mounted: false } : null;
}

/** A unit's sprite standing on the tile at (0, 0) to (1, 1): as wide as the tile, its feet on the tile's bottom edge. */
export function UnitSprite({ index, layers, side }: { index: SpriteIndex; layers: Layers; side: Side }) {
  const [w, h] = index.cell;
  const col = index.armies.indexOf(side);
  if (col < 0) return <text className="game-asset-map-missing" data-asset-error="missing"><title>Army sprite unavailable; reprocess your game files.</title>?</text>;
  const top = 1 - h / w;
  const [hw, hh] = index.head_cell;
  const [hx, hy] = layers.mounted ? index.mounted_head_at : index.head_at;
  return (
    <>
      <svg className="map-sprite" x={0} y={top} width={1} height={h / w} viewBox={`${col * w} ${layers.row * h} ${w} ${h}`}>
        <MapImage href={gameImage("class-sprites")} width={w * index.armies.length} height={h * index.rows} />
      </svg>
      {layers.head !== null && (
        <svg className="map-sprite" x={hx / w} y={top + hy / w} width={hw / w} height={hh / w} viewBox={`0 ${layers.head * hh} ${hw} ${hh}`}>
          <MapImage href={gameImage("map-heads")} width={hw} height={hh * index.heads.rows} />
        </svg>
      )}
    </>
  );
}

/** The minimap's icon for each thing on a tile (map.TileMark), as the game picks them. */
const MARK_ICONS: Record<string, string> = { chest: "chest", door: "door", lever: "lever", crest: "crest-stone", trap: "trap", breakable: "wall", warp: "warp" };

/** The icon for what's on a tile (map.TileMark), drawn in the tile's own coordinates (0, 0) to (1, 1). */
export function TileMarkGlyph({ mark }: { mark: string }) {
  const icon = MARK_ICONS[mark];
  return icon ? <MapImage className={`map-mark map-mark-${mark}`} href={miniImage(icon)} x={0} y={0} width={1} height={1} /> : null;
}
