/**
 * The weapon or spell a unit used most in one battle, for the video's team overview cards. The source is the battle's
 * own record of what each unit used (`BattleUnit.usage`, read from the game's history: how many actions each weapon,
 * spell or art was in); the battle's log breaks a tie (the one used last wins). A unit that made no attack falls back
 * to the weapon it has equipped. Pure, so it is tested on its own.
 */
import type { InventoryItem, LogEntry, Usage } from "../api";

/** The item a card shows as the unit's weapon or spell. */
export interface Featured {
  kind: "weapon" | "spell";
  name: string;
  /** The weapon or magic type, for its icon (as `InventoryItem.weapon`). */
  weapon: string | null;
  /** How many actions it was used in in the battle (0: the unit's equipped weapon, used in none). */
  times: number;
}

/**
 * The single weapon or spell used in most actions; on a tie, the one the log shows the unit using last (a spell or art
 * is named in the log; a weapon is not, so among weapons the game's own order, most used first, decides). With no use at
 * all: the weapon equipped (as the game flags it, else the first weapon carried), or null when it carries none.
 */
export function featuredWeapon(usage: readonly Usage[] | null | undefined, log: readonly LogEntry[] | null | undefined, unitKey: string, inventory?: readonly InventoryItem[] | null): Featured | null {
  const used = (usage ?? []).filter((u) => (u.kind === "weapon" || u.kind === "spell") && u.times > 0);
  if (used.length) {
    const most = Math.max(...used.map((u) => u.times));
    const tied = used.filter((u) => u.times === most);
    const lastSeen = (u: Usage) => {
      for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
        const e = log![i];
        if (e.unit === unitKey && e.detail === u.name) return i;
      }
      return -1;
    };
    // Array order is the game's (most used first); a later log mention beats an earlier one, otherwise the first stays.
    const best = tied.reduce((a, b) => (lastSeen(b) > lastSeen(a) ? b : a));
    return { kind: best.kind as "weapon" | "spell", name: best.name, weapon: best.weapon ?? null, times: best.times };
  }
  const weapons = (inventory ?? []).filter((it) => it.kind === "weapon");
  const held = weapons.find((it) => it.equipped) ?? weapons[0];
  return held ? { kind: "weapon", name: held.name, weapon: held.weapon ?? null, times: 0 } : null;
}
