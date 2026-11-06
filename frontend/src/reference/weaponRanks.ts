/** Display order shared by the discrete rank filter and its inclusive upper bound. */
export const WEAPON_RANKS = ["E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+"] as const;
export type WeaponRank = (typeof WEAPON_RANKS)[number];

/** Any includes unknown requirements; a selected limit includes only known ranks at or below it. */
export function withinWeaponRank(rank: string | undefined, maximum: WeaponRank | null): boolean {
  if (maximum === null) return true;
  const at = WEAPON_RANKS.findIndex((value) => value === rank);
  return at >= 0 && at <= WEAPON_RANKS.indexOf(maximum);
}
