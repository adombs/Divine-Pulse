/**
 * The Roster's marks: shapes in colors the player puts beside a unit's name ("star-gold"), up to MAX_MARKS different
 * ones per unit, saved on the unit (Unit.marks). The backend accepts exactly these shapes and colors (backend/app/domain/units.py, MARK_SHAPES and
 * MARK_COLORS).
 */
import type { IconName } from "./components/Icon";
import { CONCEPT_ICON } from "./icons/concepts";

export const MARK_SHAPES = ["circle", "square", "triangle", "diamond", "star"] as const;
export const MARK_COLORS = ["red", "gold", "green", "blue", "violet"] as const;
export type MarkShape = (typeof MARK_SHAPES)[number];
export type MarkColor = (typeof MARK_COLORS)[number];
export type Mark = `${MarkShape}-${MarkColor}`;
/** The most marks one unit can wear (backend MAX_MARKS). */
export const MAX_MARKS = 5;

export const MARK_ICON: Record<MarkShape, IconName> = {
  circle: CONCEPT_ICON.markCircle,
  square: CONCEPT_ICON.markSquare,
  triangle: CONCEPT_ICON.markTriangle,
  diamond: CONCEPT_ICON.markDiamond,
  star: CONCEPT_ICON.markStar,
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A saved mark split into its shape and color; null for none, or for anything this version doesn't know. */
export function parseMark(value: string | null | undefined): { shape: MarkShape; color: MarkColor } | null {
  if (!value) return null;
  const [shape, color, extra] = value.split("-");
  if (extra !== undefined) return null;
  if (!(MARK_SHAPES as readonly string[]).includes(shape) || !(MARK_COLORS as readonly string[]).includes(color)) return null;
  return { shape: shape as MarkShape, color: color as MarkColor };
}

/** "Gold star". */
export const markLabel = (shape: MarkShape, color: MarkColor) => `${cap(color)} ${shape}`;

/** The marks of a saved list this version can draw, in order, without repeats, at most MAX_MARKS. */
export function validMarks(marks: readonly string[] | null | undefined): Mark[] {
  const out: Mark[] = [];
  for (const m of marks ?? []) if (parseMark(m) && !out.includes(m as Mark) && out.length < MAX_MARKS) out.push(m as Mark);
  return out;
}
