/**
 * Game reference data for the Characters and Classes pages.
 */
import { useEffect, useState } from "react";
import { onGameAssetsChange } from "../gameAssets";
import { onGameLanguageChange } from "../gameLanguage";
import { loadImportedReference } from "./gameData";
import wiki from "./wiki/fe-wiki.json";
import structure from "./structure.json";

export const STAT_KEYS = ["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;
export type ClassStats = Stats & { mv: number };

export const SKILL_KEYS = ["sword", "lance", "axe", "bow", "brawling", "reason", "faith", "authority", "heavy_armor", "riding", "flying"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export const SKILL_LABEL: Record<SkillKey, string> = {
  sword: "Sword",
  lance: "Lance",
  axe: "Axe",
  bow: "Bow",
  brawling: "Brawling",
  reason: "Reason",
  faith: "Faith",
  authority: "Authority",
  heavy_armor: "Heavy Armor",
  riding: "Riding",
  flying: "Flying",
};
export const STAT_LABEL: Record<StatKey | "mv", string> = {
  hp: "HP",
  str: "Str",
  mag: "Mag",
  dex: "Dex",
  spd: "Spd",
  lck: "Lck",
  def: "Def",
  res: "Res",
  cha: "Cha",
  mv: "Mv",
};

export type Aptitude = "strong" | "weak" | "budding" | "weak_budding" | null;

export interface Ranked {
  name: string;
  rank: string;
  skill?: SkillKey | "";
}

export interface CrestRef {
  name: string;
  major: boolean;
}

export interface Character {
  key: string;
  name: string;
  full_name: string;
  house: string;
  gender: "Male" | "Female" | "Either";
  dlc: boolean;
  bases: Stats;
  growths: Stats;
  maxes: Stats;
  start_class: string;
  crests: CrestRef[];
  /** What the crest column reveals behind its spoiler button, if anything. */
  crests_spoiler: CrestRef[] | null;
  age: string;
  birthday: string;
  height: string;
  skills: Record<SkillKey, { initial: string; aptitude: Aptitude }>;
  budding: { skill: SkillKey; unlock: string; description: string } | null;
  personal: { name: string; description: string }[];
  abilities: Ranked[];
  arts: Ranked[];
  spells: { reason: Ranked[]; faith: Ranked[] };
}

export type Tier = "Unique" | "Beginner" | "Intermediate" | "Advanced" | "Master" | "DLC";
export const TIERS: Tier[] = ["Unique", "Beginner", "Intermediate", "Advanced", "Master", "DLC"];

export interface GameClass {
  name: string;
  description?: string;
  tier: Tier;
  level: number | null;
  seal: string | null;
  gender: "Male" | "Female" | null;
  restriction: string;
  requirements: { skill: SkillKey; rank: string }[];
  /** Any one of the requirements is enough (Fighter, Monk). */
  requirement_any: boolean;
  /** Minimum stats in the class: changing into it raises lower stats to these. */
  bases: ClassStats;
  boosts: ClassStats;
  /** Extra boosts (or penalties) while mounted; lost when dismounted. */
  mount_boosts: Partial<ClassStats>;
  growths: Stats;
  skill_bonus: Partial<Record<SkillKey, number>>;
  proficient: SkillKey[];
  abilities: string[];
  mastery_ability: string;
  mastery_art: string;
  types: ("Infantry" | "Armored" | "Cavalry" | "Flying")[];
}

export interface Ability {
  name: string;
  description: string;
}

export interface CombatArt {
  name: string;
  weapon: string;
  might: string;
  hit: string;
  crit: string;
  range: string;
  cost: string;
  description: string;
}

export interface Magic {
  name: string;
  type: "Black" | "Dark" | "White";
  might: number;
  hit: number;
  range: string;
  uses: number;
  effect: string;
  description?: string;
}

export interface ReferenceItem {
  name: string;
  kind: string;
  weapon_type?: string;
  rank?: string;
  weight?: number;
  crit?: number;
  flags?: number;
  effect?: string;
  description?: string;
  effects?: Record<string, number>;
  amount?: number;
  might?: number;
  hit?: number;
  range?: string;
  uses?: number;
}

export interface Crest {
  name: string;
  effect: string;
  major_description?: string;
  minor_description?: string;
  /** Playable bearers (story reveals left out). */
  bearers: { major: string[]; minor: string[] };
}

export interface ReferenceData {
  sources: { name: string; url: string }[];
  characters: Character[];
  classes: GameClass[];
  abilities: Ability[];
  combat_arts: CombatArt[];
  crests: Crest[];
  magic: Magic[];
  items: ReferenceItem[];
  battalions?: { name: string; description: string; endurance: number }[];
}

let cache: Promise<ReferenceData> | null = null;

export function loadReference(): Promise<ReferenceData> {
  cache ??= loadImportedReference(structure, wiki.classes);
  return cache;
}

export function useReference(): ReferenceData | null {
  const [data, setData] = useState<ReferenceData | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      cache = null;
      loadReference().then((d) => live && current === generation && setData(d));
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
  return data;
}
