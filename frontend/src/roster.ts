/**
 * Who the Roster shows (mirrors backend/app/domain/membership.py `on_roster`): the units the game has in the army, plus
 * the dead (the game's own flag, or marked by hand). A unit that left the army alive stays stored with its history, off
 * the Roster, and is back on it when the game has it in the army again. Pages about history (battles, statistics, the
 * History page) keep using every stored unit; only the Roster and what counts or links to it use this.
 */
import type { Unit } from "./api";

type RosterFields = Pick<Unit, "in_army" | "on_roster" | "death">;

export function onRoster(u: RosterFields): boolean {
  // Older servers don't send the fields: every unit was on the Roster then.
  return u.on_roster ?? (u.in_army !== false || !!u.death);
}

export function rosterUnits<T extends RosterFields>(units: T[]): T[] {
  return units.filter(onRoster);
}
