/**
 * Support data (who supports whom, which ranks, when each rank can be unlocked) plus the monastery
 * activities that raise supports (gifts, lost items, meals).
 */
import { useEffect, useState } from "react";
import { onGameAssetsChange } from "../gameAssets";
import { onGameLanguageChange } from "../gameLanguage";
import { loadImportedSupports } from "./gameData";
import wiki from "./wiki/fe-wiki.json";
import structure from "./structure.json";

export const SUPPORT_RANKS = ["C", "C+", "B", "B+", "A", "A+", "S"] as const;
export type SupportRank = (typeof SUPPORT_RANKS)[number];

export interface SupportPair {
  /** Names as the wiki writes them; Byleth is "Byleth (M)" / "Byleth (F)". */
  a: string;
  b: string;
  ranks: SupportRank[];
  /** When each rank can be unlocked, e.g. "Available in Part II". */
  avail: Partial<Record<SupportRank, string>>;
  /** Route locks, DLC, rewards. */
  notes: string[];
}

export interface MonasteryPerson {
  lost_items?: string[];
  liked_gifts?: string[];
  disliked_gifts?: string[];
  liked_meals?: string[];
  disliked_meals?: string[];
}

export interface SupportData {
  names: Record<string, string>;
  pairs: SupportPair[];
  people: Record<string, MonasteryPerson>;
  meals: { id: string; name: string; ingredients?: { id: number; name: string; quantity: number }[]; preferences?: boolean }[];
}

let cache: Promise<SupportData> | null = null;

export function useSupports(): SupportData | null {
  const [data, setData] = useState<SupportData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      setError(null);
      cache = loadImportedSupports(wiki.supports, structure.excludedSupportPairs);
      cache.then((d) => live && current === generation && setData(d))
        .catch((e: unknown) => { if (live && current === generation) setError(e instanceof Error ? e : new Error(String(e))); });
    };
    refresh();
    const unsubscribe = onGameAssetsChange(refresh);
    const unsubscribeLanguage = onGameLanguageChange(refresh);
    return () => {
      live = false;
      unsubscribe();
      unsubscribeLanguage();
    };
  }, []);
  if (error) throw error;
  return data;
}

export const ROUTES = [
  { id: "cf", name: "Crimson Flower", house: "Black Eagles" },
  { id: "ss", name: "Silver Snow", house: "Black Eagles" },
  { id: "am", name: "Azure Moon", house: "Blue Lions" },
  { id: "vw", name: "Verdant Wind", house: "Golden Deer" },
] as const;
export type RouteId = (typeof ROUTES)[number]["id"];

/** Routes a pair can be raised on, from its notes; null = any route. */
export function pairRoutes(p: SupportPair): RouteId[] | null {
  const text = p.notes.join(" ");
  if (/only[^.]*Crimson Flower/i.test(text)) return ["cf"];
  if (/only[^.]*Azure Moon/i.test(text)) return ["am"];
  if (/only[^.]*Verdant Wind/i.test(text)) return ["vw"];
  if (/Cannot be supported on Crimson Flower/i.test(text)) return ["ss", "am", "vw"];
  return null;
}

/** The pair ends with a paired ending: S with Byleth, or A+ between two other units. */
export function hasEnding(p: SupportPair): boolean {
  return p.ranks.includes("S") || p.ranks.includes("A+");
}


/**
 * Support mechanics (Fire Emblem Wiki, "Support" → Three Houses). Kept here rather than scraped: they are
 * a handful of fixed numbers.
 */
export const RULES = {
  /** Pairs whose Linked Attacks also add Attack (others give Hit and Avoid only). */
  attackPairs: [
    ["Byleth", "Edelgard"],
    ["Byleth", "Dimitri"],
    ["Byleth", "Claude"],
    ["Byleth", "Flayn"],
    ["Byleth", "Yuri"],
    ["Edelgard", "Hubert"],
    ["Dimitri", "Dedue"],
    ["Claude", "Hilda"],
    ["Ferdinand", "Lorenz"],
    ["Dorothea", "Manuela"],
    ["Felix", "Sylvain"],
    ["Felix", "Ingrid"],
    ["Sylvain", "Ingrid"],
    ["Mercedes", "Annette"],
    ["Annette", "Gilbert"],
    ["Raphael", "Ignatz"],
    ["Leonie", "Alois"],
    ["Seteth", "Flayn"],
    ["Catherine", "Shamir"],
    ["Mercedes", "Jeritza"],
    ["Hilda", "Balthus"],
  ],
};
