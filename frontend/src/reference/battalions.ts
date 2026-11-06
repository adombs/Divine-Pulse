import { canonical } from "../fuzzy";
import type { Battalion } from "./types";

/** IDs survive translations and duplicate names. Old recordings can still resolve an unambiguous name. */
export function battalionReference(list: readonly Battalion[], name?: string | null, id?: number | null): Battalion | undefined {
  if (!name) return undefined;
  if (id !== undefined && id !== null) return list.find((entry) => entry.id === id);
  const known = canonical(name, list.map((entry) => entry.name));
  const matches = known ? list.filter((entry) => entry.name === known) : [];
  return matches.length === 1 ? matches[0] : undefined;
}
