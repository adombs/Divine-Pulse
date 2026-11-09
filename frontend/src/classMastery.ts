import { canonical } from "./fuzzy.ts";
import type { Tier } from "./reference/types";

/** Tiers in the order a unit climbs them; the story and DLC classes come last. */
export const MASTERY_TIER_ORDER: Tier[] = ["Beginner", "Intermediate", "Advanced", "Master", "Unique", "DLC"];

export interface MasteredClass {
  name: string;
  /** null for a class the Archive doesn't know (it keeps the name the game gave and no plate). */
  tier: Tier | null;
}

/**
 * The classes a unit has mastered, lowest tier first (those within a tier keep the order the game read them in).
 * `names` undefined/null: not read from the game yet (a unit saved before mastery was read); [] is none mastered.
 * Names are matched to the Archive's classes by spelling, so a class keeps its plate whatever the language.
 */
export function masteredClasses(names: readonly string[] | null | undefined, classes: readonly { name: string; tier: Tier }[] | undefined): MasteredClass[] | null {
  if (!names) return null;
  const known = new Map((classes ?? []).map((c) => [c.name, c.tier] as const));
  const all = names.map((name, index) => {
    const match = known.has(name) ? name : classes ? canonical(name, known.keys()) : null;
    return { name, tier: match ? known.get(match) ?? null : null, index };
  });
  const rank = (tier: Tier | null) => (tier === null ? MASTERY_TIER_ORDER.length : MASTERY_TIER_ORDER.indexOf(tier));
  return all.sort((a, b) => rank(a.tier) - rank(b.tier) || a.index - b.index).map(({ name, tier }) => ({ name, tier }));
}
