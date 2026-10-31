/**
 * Effective BST.
 *
 * Offense  Auto: max(Str, Mag)  Physical: Str  Magical: Mag  Flex: (Str + Mag) / 2
 * Defense  Auto: max(Def, Res)  Physical: Def  Magical: Res  Flex: (Def + Res) / 2
 *
 *   eBST = (offense + defense + the toggled stats) / (2 + how many are toggled)
 *
 * whichever of HP, Mv, Dex, Spd, Lck, Cha are toggled on. With HP and Spd on (the default) that
 * is (HP + offense + defense + Spd) / 4; with nothing toggled it is the average of the two types.
 */
import type { ValueKey } from "./api";

export type EbstType = "auto" | "physical" | "magical" | "flex";

export const EBST_TYPES: { id: EbstType; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "the higher of the two" },
  { id: "physical", label: "Physical", hint: "" },
  { id: "magical", label: "Magical", hint: "" },
  { id: "flex", label: "Flex", hint: "average of the two" },
];

/** Stats toggled individually for eBST; Str/Mag and Def/Res are covered by the offense/defense types. */
export const OTHER_KEYS = ["hp", "mv", "dex", "spd", "lck", "cha"] as const;
export type OtherKey = (typeof OTHER_KEYS)[number];

export interface EbstConfig {
  offense: EbstType;
  defense: EbstType;
  stats: OtherKey[];
}

export interface EbstResult {
  ebst: number;
  /** Stats eBST uses (for dimming the rest). */
  used: Set<ValueKey>;
}

function pick(values: Record<ValueKey, number>, kind: EbstType, physical: ValueKey, magical: ValueKey): [number, ValueKey[]] {
  const p = values[physical] ?? 0;
  const m = values[magical] ?? 0;
  switch (kind) {
    case "physical":
      return [p, [physical]];
    case "magical":
      return [m, [magical]];
    case "flex":
      return [(p + m) / 2, [physical, magical]];
    default:
      return p >= m ? [p, [physical]] : [m, [magical]];
  }
}

export function computeEbst(values: Record<ValueKey, number>, cfg: EbstConfig): EbstResult {
  const [off, offUsed] = pick(values, cfg.offense, "str", "mag");
  const [def, defUsed] = pick(values, cfg.defense, "def", "res");
  const others = OTHER_KEYS.filter((k) => cfg.stats.includes(k));
  const sum = off + def + others.reduce((s, k) => s + (values[k] ?? 0), 0);
  const ebst = sum / (2 + others.length);
  return { ebst, used: new Set<ValueKey>([...offUsed, ...defUsed, ...others]) };
}

export const typeLabel = (t: EbstType) => EBST_TYPES.find((x) => x.id === t)?.label ?? t;

export const fmtEbst = (v: number) => v.toFixed(1);

export const DEFAULT_CONFIG: EbstConfig = { offense: "auto", defense: "auto", stats: ["hp", "spd"] };
