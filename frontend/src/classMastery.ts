import { canonical } from "./fuzzy.ts";
import type { Tier } from "./reference/types";

export interface MasteredClass {
  name: string;
  /** null for a class the Archive doesn't know (it keeps the name the game gave and no plate). */
  tier: Tier | null;
}

/**
 * The classes a unit has mastered, each with its tier for the plate, in the order they came in: the game's own tier
 * order, lowest first (Noble and Commoner, then Beginner up to Master, then the story and DLC classes), which the
 * Archive's plates can't give since Noble, Commoner and the story classes all show as "Unique".
 * `names` undefined/null: not read from the game yet (a unit saved before mastery was read); [] is none mastered.
 * Names are matched to the Archive's classes by spelling, so a class keeps its plate whatever the language.
 */
export function masteredClasses(names: readonly string[] | null | undefined, classes: readonly { name: string; tier: Tier }[] | undefined): MasteredClass[] | null {
  if (!names) return null;
  const known = new Map((classes ?? []).map((c) => [c.name, c.tier] as const));
  return names.map((name) => {
    const match = known.has(name) ? name : classes ? canonical(name, known.keys()) : null;
    return { name, tier: match ? known.get(match) ?? null : null };
  });
}
