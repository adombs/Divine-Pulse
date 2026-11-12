/**
 * The one rule for which units' battle data counts as the run's statistics.
 *
 * A guest (a unit on your side without being in the run's roster) is logged in the battle as one of Your Units, but its
 * numbers count toward statistics only while its key is on the run's roster now. Evaluated against the current roster, so
 * a guest who later joins counts retroactively. Everything that adds up "your" units goes through `countedBattle(s)`.
 */
import type { Battle, BattleEvent, BattleUnit, LogEntry, MapStep } from "../../api";
import { statGains } from "./model";

/** Whether a unit's battle data counts for the run: any non-guest does; a guest only if it's on the roster. */
export function countsForRun(unit: Pick<BattleUnit, "key" | "guest">, rosterKeys: ReadonlySet<string>): boolean {
  return !unit.guest || rosterKeys.has(unit.key);
}

/** The battle as statistics see it: guests that don't count are gone from its units, log, events, timelines and map
 * history, and the battle-wide sums over units are worked out again. The same battle when nothing is dropped.
 * (Game counters that can't be split by unit, such as enemies_defeated and army HP, are left as they are.) */
export function countedBattle(battle: Battle, rosterKeys: ReadonlySet<string>): Battle {
  const dropped = battle.units.filter((u) => !countsForRun(u, rosterKeys));
  if (!dropped.length) return battle;
  const keys = new Set(dropped.map((u) => u.key));
  const ids = new Set(dropped.map((u) => `a:${u.key}`));
  const mine = (id: string | null | undefined, legacy: string | null | undefined) =>
    id ? ids.has(id) : !!legacy && keys.has(legacy);
  const entry = (e: LogEntry) => !(mine(e.actor_id, e.unit) || mine(e.target_id, e.target));
  const event = (e: BattleEvent) => !(e.unit && keys.has(e.unit));
  const step = (s: MapStep): MapStep => ({
    ...s,
    actor: s.actor && ids.has(s.actor) ? null : s.actor,
    target: s.target && ids.has(s.target) ? null : s.target,
    units: Object.fromEntries(Object.entries(s.units).filter(([id]) => !ids.has(id))),
  });
  const units = battle.units.filter((u) => countsForRun(u, rosterKeys));
  const onMap = units.filter((u) => u.on_map);
  const known = (pick: (u: BattleUnit) => number | null | undefined) => {
    const values = onMap.map(pick).filter((v): v is number => v !== null && v !== undefined);
    return values.length ? values.reduce((n, v) => n + v, 0) : null;
  };
  return {
    ...battle,
    units,
    log: battle.log.filter(entry),
    events: battle.events.filter(event),
    branches: battle.branches?.map((b) => ({
      ...b,
      log: b.log.filter(entry),
      events: b.events.filter(event),
      map_steps: b.map_steps?.map(step),
      map_presence: b.map_presence && Object.fromEntries(Object.entries(b.map_presence).filter(([id]) => !ids.has(id))),
    })),
    map_steps: battle.map_steps?.map(step),
    map_presence: battle.map_presence && Object.fromEntries(Object.entries(battle.map_presence).filter(([id]) => !ids.has(id))),
    level_ups: units.reduce((n, u) => n + u.level_ups, 0),
    stat_points: units.reduce((n, u) => n + statGains(u), 0),
    weapon_uses: units.reduce((n, u) => n + u.weapon_uses, 0),
    spells_cast: units.reduce((n, u) => n + u.spells_cast, 0),
    item_uses: units.reduce((n, u) => n + u.item_uses, 0),
    spell_uses_left: known((u) => u.spell_uses_left),
    spell_uses_full: known((u) => u.spell_uses_full),
  };
}

/** `countedBattle` over a list (the same array when nothing changes, so memos stay stable). */
export function countedBattles(battles: Battle[], rosterKeys: ReadonlySet<string>): Battle[] {
  const out = battles.map((b) => countedBattle(b, rosterKeys));
  return out.every((b, i) => b === battles[i]) ? battles : out;
}
