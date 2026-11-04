/**
 * A character's two faces, as every character view draws them: their portrait, and their map sprite in their class.
 *
 * - `PortraitFlip` (Roster, Archive): the portrait turns over to show the sprite while the pointer is on it, and stays
 *   turned when clicked or tapped (Enter or Space from the keyboard), until clicked again. With reduced motion it
 *   swaps without turning.
 * - `SpriteFigure`: the sprite alone, cropped to the figure and scaled to a box (the battle window shows it beside
 *   the portrait instead of flipping).
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { spriteLayers, UnitSprite, useSprites } from "../battle/mapIcons";
import type { Sprite } from "../battle/mapIcons";
import type { Unit } from "../../api";
import { portraitCharacterId, portraitKey } from "../../portraits";
import { classIdOf } from "../../reference/classSprites";
import "./character.css";

// Where the figure stands in a sprite cell (pixels): on foot, and on a mount, which is wider and taller.
const ON_FOOT = [4, 13, 24, 24] as const;
const MOUNTED = [2, 6, 30, 30] as const;

/** A unit's map sprite cropped to the figure, `size` pixels square (or the box's size when omitted). Null while
 * the atlas loads, or when it has no sprite for this class and character. */
export function SpriteFigure({ sprite, size, label }: { sprite: Sprite | null; size?: number; label?: string }) {
  const sprites = useSprites();
  if (!sprites || !sprite) return null;
  const layers = spriteLayers(sprites, sprite, true) ?? spriteLayers(sprites, sprite, false);
  if (!layers) return null;
  const [w, h] = sprites.cell;
  const [x, y, fw, fh] = layers.mounted ? MOUNTED : ON_FOOT;
  // UnitSprite draws in tiles, a tile as wide as the cell, with the cell's bottom on the tile's.
  const viewBox = `${x / w} ${(y - (h - w)) / w} ${fw / w} ${fh / w}`;
  return (
    <svg className="cv-sprite" viewBox={viewBox} width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <UnitSprite index={sprites} layers={layers} side={sprite.side} />
    </svg>
  );
}

/** Whether the sprite atlas can draw this sprite (to decide whether a portrait can flip at all). */
export function useHasSprite(sprite: Sprite | null): boolean {
  const sprites = useSprites();
  return !!(sprites && sprite && (spriteLayers(sprites, sprite, true) ?? spriteLayers(sprites, sprite, false)));
}

/**
 * The portrait, turning over to the map sprite on hover, and on click / tap / Enter / Space (which keeps it turned).
 * Without a sprite it's just the portrait. `className` is the class the sprite shows, for the label.
 */
export function PortraitFlip({
  portrait,
  sprite,
  name,
  className,
  size,
}: {
  portrait: ReactNode;
  sprite: Sprite | null;
  name: string;
  className?: string;
  size: number;
}) {
  const [turned, setTurned] = useState(false);
  // After a click, the pointer resting on it doesn't hold the sprite: the click's result shows until it leaves.
  const [held, setHeld] = useState(false);
  const has = useHasSprite(sprite);
  const style = { "--cv-face": `${size}px` } as CSSProperties;
  if (!has) {
    return (
      <span className="cv-face" style={style}>
        {portrait}
      </span>
    );
  }
  const what = className ? `${name}'s map sprite as a ${className}` : `${name}'s map sprite`;
  return (
    <button
      type="button"
      className={`cv-face cv-flip${turned ? " turned" : ""}${held ? " held" : ""}`}
      style={style}
      aria-pressed={turned}
      aria-label={`Show ${what}`}
      title={turned ? "Show the portrait" : "Show the map sprite"}
      onClick={() => {
        setTurned((t) => !t);
        setHeld(true);
      }}
      onPointerLeave={() => setHeld(false)}
    >
      <span className="cv-flip-card">
        <span className="cv-flip-side front">{portrait}</span>
        <span className="cv-flip-side back">
          <SpriteFigure sprite={sprite} />
        </span>
      </span>
      <span className="cv-flip-hint" aria-hidden>
        <Icon name={CONCEPT_ICON.flip} />
      </span>
    </button>
  );
}

/** The sprite for a run's unit: its class's body with its own head (Byleth by the run's look). Null when its class or
 * character isn't known. */
export function unitSprite(unit: Unit): Sprite | null {
  const classId = classIdOf(unit.class_name);
  const key = portraitKey(unit);
  const character = key ? portraitCharacterId(key) ?? portraitCharacterId(key.replace(/_[mf]$/, "")) : null;
  if (classId === null) return null;
  return { classId, female: key ? key.endsWith("_f") || unit.gender === "Female" : unit.gender === "Female", side: "player", character, look: unit.look ?? null };
}

/** The sprite for a character in a class (the Archive's card: their starting class), by portrait key. */
export function characterSprite(portraitKeyName: string, className: string, female: boolean): Sprite | null {
  const classId = classIdOf(className);
  if (classId === null) return null;
  const character = portraitCharacterId(portraitKeyName) ?? portraitCharacterId(portraitKeyName.replace(/_[mf]$/, ""));
  return { classId, female, side: "player", character };
}
