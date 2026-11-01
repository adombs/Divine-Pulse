import type { Battle } from "../../api";

/** A snapshot is a complete history, including any earlier branches in its ancestry. */
export function replayPath(battle: Battle, pulse: number | null) {
  if (pulse === null) return { steps: battle.map_steps ?? [], presence: battle.map_presence ?? {}, available: true };
  const branch = [...(battle.branches ?? [])].sort((a, b) => a.at - b.at)[pulse];
  const steps = branch?.map_steps ?? [];
  return { steps, presence: branch?.map_presence ?? {}, available: steps.length > 0 };
}
