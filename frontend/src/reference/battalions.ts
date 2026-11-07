import { canonical } from "../fuzzy";
import type { Battalion } from "./types";

/** IDs survive translations and duplicate names. Old recordings can still resolve an unambiguous name. */
export function battalionReference(list: readonly Battalion[], name?: string | null, id?: number | null): Battalion | undefined {
  if (!name) return undefined;
  if (id !== undefined && id !== null) return list.find((entry) => entry.id === id);
  const known = canonical(name, list.map((entry) => entry.name));
  const matches = known ? list.filter((entry) => entry.name === known) : [];
  return matches.length === 1 ? matches[0] : undefined;
}

/** The game keeps a battalion's experience as one running total: 100 per level, levels 1-5, capped at 400
 *. */
export const BATTALION_MAX_LEVEL = 5;
const EXP_PER_LEVEL = 100;
const MAX_EXP = EXP_PER_LEVEL * (BATTALION_MAX_LEVEL - 1);

/** Level (1-5) and experience into it, as the game's panel shows them; null when the total isn't known. */
export function battalionLevel(exp: number | null | undefined): { level: number; exp: number } | null {
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp < 0 || exp > MAX_EXP) return null;
  const level = Math.min(BATTALION_MAX_LEVEL, Math.floor(exp / EXP_PER_LEVEL) + 1);
  return { level, exp: level === BATTALION_MAX_LEVEL ? 0 : exp - (level - 1) * EXP_PER_LEVEL };
}
