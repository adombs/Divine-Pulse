/**
 * Plans moved between runs as a file (Runs → Import/Export → Plans). A plan belongs to a character, not to one run's
 * unit, so the file keys each by Characters page key ("byleth", "edelgard"): a run takes it on the unit of that
 * character, or keeps it for them until they join. Nothing here touches the page, so it is tested on its own
 * (scripts/test-plan-transfer.mjs).
 */
import type { PlanSupport, UnitPlan } from "./api";

export const PLANS_FORMAT = "divine-pulse-plans";

/** One character's plan, as the file and the dialog list it. */
export interface PlanEntry {
  /** Characters page key. */
  key: string;
  name: string;
  plan: UnitPlan;
}

/** A run's own entry: also the roster unit holding it (null: kept for a character not on the roster yet). */
export interface RunPlanEntry extends PlanEntry {
  unitKey: string | null;
}

const PLAN_KEY = /^[a-z0-9_-]{1,40}$/;
const RANKS = new Set(["C", "B", "A", "A+", "S"]);

export const planIsEmpty = (p: UnitPlan | undefined | null): boolean =>
  !p || (!p.classes.length && !Object.keys(p.skills).length && !p.arts.length && !p.abilities.length && !p.equipment.length
    && !p.battalion && !(p.supports ?? []).length && !p.notes.trim());

/** "leonie" → "Leonie", for a character no unit names. */
export const nameOfKey = (key: string): string => key.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || key;

/**
 * Every plan a run has, roster first in its own order, then those kept for characters not on it yet (by name).
 * `characterKey` finds a unit's Characters page key (portraits.ts `characterKeyOfUnit`); units it can't name
 * (generics) have no plan to move.
 */
export function runPlanEntries(
  units: readonly { key: string; name: string; plan?: UnitPlan }[],
  offRoster: Readonly<Record<string, UnitPlan>>,
  characterKey: (unit: { key: string; name: string }) => string | null,
): RunPlanEntry[] {
  const out: RunPlanEntry[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const key = characterKey(unit);
    if (!key || seen.has(key) || planIsEmpty(unit.plan)) continue;
    seen.add(key);
    out.push({ key, name: unit.name, plan: unit.plan!, unitKey: unit.key });
  }
  const kept: RunPlanEntry[] = [];
  for (const [key, plan] of Object.entries(offRoster)) {
    if (seen.has(key) || planIsEmpty(plan) || units.some((u) => characterKey(u) === key)) continue;
    kept.push({ key, name: nameOfKey(key), plan, unitKey: null });
  }
  kept.sort((a, b) => a.name.localeCompare(b.name));
  return [...out, ...kept];
}

/** The chosen plans as the file they are exported to. */
export const plansFile = (runName: string, entries: readonly PlanEntry[]) => ({
  format: PLANS_FORMAT,
  version: 1,
  run: runName,
  plans: entries.map(({ key, name, plan }) => ({ key, name, plan })),
});

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** A plan from a file with anything that isn't one dropped (the server checks the rest). */
export function cleanPlan(raw: unknown): UnitPlan {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const skills: Record<string, string> = {};
  if (p.skills && typeof p.skills === "object") {
    for (const [k, v] of Object.entries(p.skills as Record<string, unknown>)) if (typeof v === "string") skills[k] = v;
  }
  const supports: PlanSupport[] = [];
  for (const s of Array.isArray(p.supports) ? p.supports : []) {
    const { partner, rank } = (s ?? {}) as Record<string, unknown>;
    if (typeof partner === "string" && typeof rank === "string" && RANKS.has(rank)) supports.push({ partner, rank: rank as PlanSupport["rank"] });
  }
  return {
    classes: strings(p.classes),
    skills: skills as UnitPlan["skills"],
    arts: strings(p.arts),
    abilities: strings(p.abilities),
    equipment: strings(p.equipment),
    battalion: typeof p.battalion === "string" ? p.battalion : "",
    supports,
    notes: typeof p.notes === "string" ? p.notes : "",
  };
}

/** The plans in a file being imported, one per character. Throws, saying why, when there are none. */
export function readPlansFile(payload: unknown): PlanEntry[] {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  if (!data || data.format !== PLANS_FORMAT) {
    if (data?.format === "divine-pulse-ruleset") throw new Error("This is a ruleset file, not plans.");
    if (data?.format === "divine-pulse-run" || data?.format === "divine-pulse-battles") throw new Error("This is a run or battles file, not plans.");
    throw new Error("This isn't a plans file.");
  }
  const out: PlanEntry[] = [];
  for (const item of Array.isArray(data.plans) ? data.plans : []) {
    const { key, name, plan } = (item ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !PLAN_KEY.test(key) || out.some((e) => e.key === key)) continue;
    const cleaned = cleanPlan(plan);
    if (planIsEmpty(cleaned)) continue;
    out.push({ key, name: typeof name === "string" && name.trim() ? name.trim() : nameOfKey(key), plan: cleaned });
  }
  if (!out.length) throw new Error("This file has no plans.");
  return out;
}

/** Where an imported plan goes in a run: onto its unit, or kept for the character; and whether it replaces one. */
export interface PlanTarget extends PlanEntry {
  unitKey: string | null;
  replaces: boolean;
}

export function planTargets(
  entries: readonly PlanEntry[],
  units: readonly { key: string; name: string; plan?: UnitPlan }[],
  offRoster: Readonly<Record<string, UnitPlan>>,
  characterKey: (unit: { key: string; name: string }) => string | null,
): PlanTarget[] {
  return entries.map((entry) => {
    const unit = units.find((u) => characterKey(u) === entry.key);
    return unit
      ? { ...entry, unitKey: unit.key, replaces: !planIsEmpty(unit.plan) }
      : { ...entry, unitKey: null, replaces: !planIsEmpty(offRoster[entry.key]) };
  });
}
