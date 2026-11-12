import type { DuplicateGroup } from "./api";

/** The copy to keep selected: the server's pick, else the newest. */
export function defaultKeep(group: DuplicateGroup): string {
  return group.battles.some((b) => b.id === group.best) ? group.best : group.battles[0]?.id ?? group.best;
}

/** The ids to discard when keeping one copy of a group. */
export function discardFor(group: DuplicateGroup, keep: string): string[] {
  return group.battles.filter((b) => b.id !== keep).map((b) => b.id);
}
