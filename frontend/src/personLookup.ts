export interface PortraitData {
  persons?: Record<string, { name?: string; face?: string | null }>;
  characters?: Record<string, { expressions?: { part1?: (string | null)[]; part2?: (string | null)[] } }>;
}

// The research contact sheet shows slot 3 as the distressed expression across the cast.
export const HURT_EXPRESSION = 3;

export function expressionPaths(data: PortraitData | null, id: number | null | undefined, part2: boolean): (string | null)[] {
  if (id == null) return [];
  const expressions = data?.characters?.[String(id)]?.expressions;
  return (part2 ? expressions?.part2 : expressions?.part1) ?? [];
}

export function personFor(data: PortraitData | null, id: number | null | undefined) {
  return id == null ? undefined : data?.persons?.[String(id)];
}
