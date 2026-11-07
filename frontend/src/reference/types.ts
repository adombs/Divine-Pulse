/**
 * Game reference data for the Characters and Classes pages.
 */
import { useEffect, useState } from "react";
import { onGameAssetsChange } from "../gameAssets";
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

/** A battalion's eight modifiers, as the game's battalion panel lists them. */
export const BATTALION_STAT_KEYS = ["phys_atk", "mag_atk", "hit", "crit", "avo", "prt", "rsl", "cha"] as const;
export type BattalionStatKey = (typeof BATTALION_STAT_KEYS)[number];
export const BATTALION_STAT_LABEL: Record<BattalionStatKey, string> = {
  phys_atk: "Phys Atk", mag_atk: "Mag Atk", hit: "Hit", crit: "Crit", avo: "Avo", prt: "Prt", rsl: "Rsl", cha: "Cha",
};
export type BattalionStats = Partial<Record<BattalionStatKey, number>>;

/** A gambit's area: the tiles it hits, relative to the user's tile (dx right, dy forward when negative). */
export interface GambitArea {
  cells: [number, number][];
  /** The user's tile, when it isn't (0, 0). */
  origin?: [number, number];
  /** Which way the area faces; "forward" is away from the user, drawn upward. */
  direction?: "forward";
  /** For an area centred on a foe: the tile it's aimed at. */
  target?: [number, number];
}

export interface Gambit {
  id?: number;
  name: string;
  description: string;
  /** game-assets relative image path. */
  icon?: string;
  /** Uses per battle. */
  uses?: number;
  might?: number;
  hit?: number;
  range?: [number, number];
  area?: GambitArea;
}

/** A battalion from the player's import (data/battalions.json). Every field past the name, description and endurance is
 * optional: the importer adds it only once it's verified, and the app shows "—" with the reason while it's missing. */
export interface Battalion {
  /** The game's battalion ID (absent in imports read before it was kept). */
  id?: number;
  name: string;
  description: string;
  /** Maximum endurance. */
  endurance: number;
  /** game-assets relative image path. */
  icon?: string;
  /** Modifiers at level 1, and by level (index 0 is level 1). */
  stats?: BattalionStats;
  stats_by_level?: BattalionStats[];
  gambit?: Gambit;
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
  battalions?: Battalion[];
}

let cache: Promise<ReferenceData> | null = null;

export function loadReference(): Promise<ReferenceData> {
  cache ??= loadImportedReference(structure, wiki.classes);
  return cache;
}

export function useReference(): ReferenceData | null {
  const [data, setData] = useState<ReferenceData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      cache = null;
      setError(null);
      loadReference().then((d) => live && current === generation && setData(d))
        .catch((e: unknown) => { if (live && current === generation) setError(e instanceof Error ? e : new Error(String(e))); });
    };
    refresh();
    const unsubscribe = onGameAssetsChange(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  if (error) throw error;
  return data;
}
