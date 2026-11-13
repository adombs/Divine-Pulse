/**
 * What a unit used in one battle, for the video's team overview cards. The source is the battle's own record of what
 * each unit used (`BattleUnit.usage`, read from the game's history: how many actions each weapon, spell, combat art
 * and gambit was in); the battle's log orders a tie. Pure, so it is tested on its own.
 */
import type { LogEntry, Usage } from "../api";

/** A weapon, spell or combat art used in the battle, as a card lists it. */
export interface UsedItem {
  kind: "weapon" | "spell" | "art";
  name: string;
  /** The weapon or magic type, for its icon (as `InventoryItem.weapon`). */
  weapon: string | null;
  /** How many actions it was used in. */
  times: number;
}

/** Where the log last shows `unitKey` using `name` (a spell or art is named in the log; a weapon is not): -1 when it doesn't. */
function lastSeen(log: readonly LogEntry[] | null | undefined, unitKey: string, name: string): number {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (e.unit === unitKey && e.detail === name) return i;
  }
  return -1;
}

/**
 * Every weapon, spell and combat art the unit used in the battle, the most used first. On a tie the one the log shows
 * the unit using last comes first; where the log can't tell them apart (weapons are not named in it) the record's own
 * order stands. Items, Rallies and gambits are not listed, nor is anything used no times.
 */
export function usageList(usage: readonly Usage[] | null | undefined, log: readonly LogEntry[] | null | undefined, unitKey: string): UsedItem[] {
  return (usage ?? [])
    .map((u, order) => ({ u, order }))
    .filter(({ u }) => (u.kind === "weapon" || u.kind === "spell" || u.kind === "art") && u.times > 0)
    .map(({ u, order }) => ({ u, order, seen: lastSeen(log, unitKey, u.name) }))
    .sort((a, b) => b.u.times - a.u.times || b.seen - a.seen || a.order - b.order)
    .map(({ u }) => ({ kind: u.kind as UsedItem["kind"], name: u.name, weapon: u.weapon ?? null, times: u.times }));
}

/** How many times the unit's battalion gambit was used in the battle, or null when the record has none (not tracked, or never used). */
export function gambitUses(usage: readonly Usage[] | null | undefined): number | null {
  const total = (usage ?? []).filter((u) => u.kind === "gambit").reduce((sum, u) => sum + u.times, 0);
  return total > 0 ? total : null;
}

/** What a unit's card lists below its face: what it used, then its accessory and battalion (with the gambit count). */
export interface CardGear {
  used: UsedItem[];
  accessory: string | null;
  battalion: string | null;
  /** Gambit uses in the battle, when the record has them. */
  gambits: number | null;
}

/** The text of a unit's accessory or battalion: the battle's own record when it has one, else the roster's; blank is none. */
export const gearName = (recorded: string | null | undefined, roster: string | null | undefined): string | null => (recorded ?? roster ?? "").trim() || null;

/** How many slots a card's list has (2 columns x 5 rows), whatever the unit has. */
export const LIST_SLOTS = 10;

/** One slot of a card's list. */
export type CardSlot =
  | { type: "used"; item: UsedItem }
  | { type: "more"; count: number }
  | { type: "accessory"; name: string }
  | { type: "battalion"; name: string; gambits: number | null }
  | { type: "empty" };

/**
 * A card's list as exactly `slots` slots: what the unit used (most used first), then its accessory, then its battalion,
 * then empty slots. The accessory and battalion always get a slot when the unit has them, so what it used has the rest;
 * when that overflows, its last slot says how many more there are ("+N more", which counts the entry it replaces).
 */
export function cardSlots(gear: CardGear, slots = LIST_SLOTS): CardSlot[] {
  const reserved = (gear.accessory ? 1 : 0) + (gear.battalion ? 1 : 0);
  const room = Math.max(0, slots - reserved);
  const out: CardSlot[] = [];
  if (gear.used.length <= room) {
    for (const item of gear.used) out.push({ type: "used", item });
  } else {
    const shown = Math.max(0, room - 1);
    for (const item of gear.used.slice(0, shown)) out.push({ type: "used", item });
    if (room > 0) out.push({ type: "more", count: gear.used.length - shown });
  }
  if (gear.accessory) out.push({ type: "accessory", name: gear.accessory });
  if (gear.battalion) out.push({ type: "battalion", name: gear.battalion, gambits: gear.gambits });
  while (out.length < slots) out.push({ type: "empty" });
  return out.slice(0, slots);
}
