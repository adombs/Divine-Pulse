/** Units that died in the run (Classic mode): how a death is put in words wherever a dead unit shows. */
import type { Unit } from "./api";

/** Where a unit died, in a few words ("Fell in Battle in the Forest, turn 2, to Bandit 21"). */
export function deathText(u: Pick<Unit, "death" | "name">): string {
  const d = u.death;
  if (!d) return "";
  if (!d.battle_id) return d.manual ? `${u.name} fell` : `${u.name} is dead (no recorded battle has the fall)`;
  const where = d.battle_name || "a battle";
  return `Fell in ${where}${d.turn != null ? `, turn ${d.turn}` : ""}${d.by ? `, to ${d.by}` : ""}`;
}
