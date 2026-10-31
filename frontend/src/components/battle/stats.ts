/**
 * A run's battles added up: totals and records for the run, and each of your characters over every battle they
 * were in. Pure functions over finished battles, like model.ts.
 */
import type { Battle, BattleUnit, Usage, ValueKey } from "../../api";
import { armyId, Item, statGains, tally, timeline } from "./model";

/** A sum of numbers that may not be tracked: null while none of them is. */
function add(a: number | null, b: number | null | undefined): number | null {
  if (b === null || b === undefined) return a;
  return (a ?? 0) + b;
}

/** One character in one battle: what the Stats view lists under the character. */
export interface Appearance {
  battle: Battle;
  unit: BattleUnit;
  fights: number;
  defeats: number | null;
  /** Most defeats of anyone in the battle (and at least one). */
  mvp: boolean;
}

/** One character over the run's battles. */
export interface CharacterStats {
  key: string;
  name: string;
  /** Class and level in their latest battle; level in their first one. */
  class_name: string;
  level: number;
  first_level: number;
  battles: number;
  /** Battles they ended off the map (fell or retreated). */
  left: number;
  /** Battles in which they defeated the most. */
  mvp: number;
  fights: number;
  defeats: number | null;
  damage_dealt: number | null;
  damage_taken: number | null;
  healing_given: number | null;
  healed: number | null;
  tiles_moved: number | null;
  level_ups: number;
  stat_points: number;
  gains: Partial<Record<ValueKey, number>>;
  weapon_uses: number;
  spells_cast: number;
  item_uses: number;
  /** Weapons, spells, combat arts, items and Rally used, over the battles where the game's history was read. */
  usage: Usage[];
  /** Time in battle, in seconds. */
  seconds: number;
  /** Newest first. */
  appearances: Appearance[];
}

export interface RunStats {
  battles: number;
  seconds: number;
  longest: Battle | null;
  shortest: Battle | null;
  /** Over the battles whose turns were read. */
  turns: number | null;
  turn_battles: number;
  most_turns: Battle | null;
  divine_pulses: number;
  /** Battles finished without one. */
  no_pulse: number;
  most_pulses: Battle | null;
  fights: number;
  defeats: number | null;
  /** Times one of your units left a battle (fell or retreated). */
  losses: number;
  /** Battles finished with every unit still on the map. */
  flawless: number;
  enemies: number;
  damage_dealt: number | null;
  damage_taken: number | null;
  healing: number | null;
  tiles_moved: number | null;
  level_ups: number;
  stat_points: number;
  weapon_uses: number;
  spells_cast: number;
  item_uses: number;
  /** Units deployed per battle, on average. */
  deployed: number;
  /** Different characters who fought at least once. */
  characters: number;
}

/** Every finished battle's timeline, worked out once. */
export function timelines(battles: Battle[]): Map<string, Item[]> {
  return new Map(battles.map((b) => [b.id, timeline(b)]));
}

/** Each character over the run's battles, most battles first. `battles` are newest first, like the history. */
export function characterStats(battles: Battle[], items: Map<string, Item[]> = timelines(battles)): CharacterStats[] {
  const out = new Map<string, CharacterStats>();
  for (const b of battles) {
    const log = items.get(b.id) ?? [];
    const counts = b.units.map((u) => tally(log, armyId(u.key), { fights: u.combats, defeats: u.defeats }));
    const best = Math.max(0, ...counts.map((c) => c.defeats ?? 0));
    b.units.forEach((u, i) => {
      const c = out.get(u.key) ?? {
        key: u.key,
        name: u.name,
        class_name: u.class_name,
        level: u.level,
        first_level: u.start_level,
        battles: 0,
        left: 0,
        mvp: 0,
        fights: 0,
        defeats: null,
        damage_dealt: null,
        damage_taken: null,
        healing_given: null,
        healed: null,
        tiles_moved: null,
        level_ups: 0,
        stat_points: 0,
        gains: {},
        weapon_uses: 0,
        spells_cast: 0,
        item_uses: 0,
        usage: [],
        seconds: 0,
        appearances: [],
      };
      const { fights, defeats } = counts[i];
      const mvp = best > 0 && (defeats ?? 0) === best;
      // Battles come newest first, so the first one seen sets the name and class, and the last the starting level.
      c.first_level = u.start_level;
      c.battles += 1;
      if (!u.on_map) c.left += 1;
      if (mvp) c.mvp += 1;
      c.fights += fights;
      c.defeats = add(c.defeats, defeats);
      c.damage_dealt = add(c.damage_dealt, u.damage_dealt);
      c.damage_taken = add(c.damage_taken, u.damage_taken);
      c.healing_given = add(c.healing_given, u.healing_given);
      c.healed = add(c.healed, u.healed);
      c.tiles_moved = add(c.tiles_moved, u.tiles_moved);
      c.level_ups += u.level_ups;
      c.stat_points += statGains(u);
      for (const [k, v] of Object.entries(u.gains) as [ValueKey, number | undefined][]) {
        if (v) c.gains[k] = (c.gains[k] ?? 0) + v;
      }
      c.weapon_uses += u.weapon_uses;
      c.spells_cast += u.spells_cast;
      c.item_uses += u.item_uses;
      c.usage = mergeUsage([c.usage, u.usage]);
      c.seconds += b.seconds;
      c.appearances.push({ battle: b, unit: u, fights, defeats, mvp });
      out.set(u.key, c);
    });
  }
  return [...out.values()].sort((a, b) => b.battles - a.battles || a.name.localeCompare(b.name));
}

/** Usage lists added up (a character over several battles), most used first. */
export function mergeUsage(lists: (Usage[] | null | undefined)[]): Usage[] {
  const out = new Map<string, Usage>();
  for (const list of lists) {
    for (const u of list ?? []) {
      const key = `${u.kind}-${u.id}-${u.name}`;
      const sum = out.get(key) ?? { ...u, times: 0, spent: 0, damage: 0 };
      sum.times += u.times;
      sum.spent += u.spent;
      sum.damage += u.damage;
      out.set(key, sum);
    }
  }
  return [...out.values()].sort((a, b) => b.times - a.times || b.spent - a.spent || a.name.localeCompare(b.name));
}

/** The run's battles added up, with its records. */
export function runStats(battles: Battle[], characters: CharacterStats[], items: Map<string, Item[]> = timelines(battles)): RunStats {
  const most = (pick: (b: Battle) => number | null, least = false): Battle | null => {
    let best: Battle | null = null;
    for (const b of battles) {
      const v = pick(b);
      if (v === null) continue;
      const cur = best ? pick(best)! : null;
      if (cur === null || (least ? v < cur : v > cur)) best = b;
    }
    return best;
  };
  const withTurns = battles.filter((b) => b.turn !== null);
  let fights = 0;
  for (const b of battles) fights += (items.get(b.id) ?? []).filter((i) => i.kind === "attack").length;
  const sum = (pick: (u: BattleUnit) => number | null) =>
    battles.reduce<number | null>((n, b) => b.units.reduce<number | null>((m, u) => add(m, pick(u)), n), null);
  return {
    battles: battles.length,
    seconds: battles.reduce((n, b) => n + b.seconds, 0),
    longest: most((b) => b.seconds),
    shortest: most((b) => b.seconds, true),
    turns: withTurns.length ? withTurns.reduce((n, b) => n + (b.turn ?? 0), 0) : null,
    turn_battles: withTurns.length,
    most_turns: most((b) => b.turn),
    divine_pulses: battles.reduce((n, b) => n + b.divine_pulses, 0),
    no_pulse: battles.filter((b) => b.divine_pulses === 0).length,
    most_pulses: most((b) => b.divine_pulses || null),
    fights,
    defeats: characters.reduce<number | null>((n, c) => add(n, c.defeats), null),
    losses: battles.reduce((n, b) => n + b.units.filter((u) => !u.on_map).length, 0),
    flawless: battles.filter((b) => b.units.length > 0 && b.units.every((u) => u.on_map)).length,
    enemies: battles.reduce((n, b) => n + b.enemies_start, 0),
    damage_dealt: sum((u) => u.damage_dealt),
    damage_taken: sum((u) => u.damage_taken),
    healing: sum((u) => u.healing_given),
    tiles_moved: sum((u) => u.tiles_moved),
    level_ups: battles.reduce((n, b) => n + b.level_ups, 0),
    stat_points: battles.reduce((n, b) => n + b.stat_points, 0),
    weapon_uses: battles.reduce((n, b) => n + b.weapon_uses, 0),
    spells_cast: battles.reduce((n, b) => n + b.spells_cast, 0),
    item_uses: battles.reduce((n, b) => n + b.item_uses, 0),
    deployed: battles.length ? battles.reduce((n, b) => n + b.units.length, 0) / battles.length : 0,
    characters: characters.length,
  };
}

/** The character with the highest `pick` (ties: most battles), or null when nobody has any. */
export function leader(characters: CharacterStats[], pick: (c: CharacterStats) => number | null): CharacterStats | null {
  let best: CharacterStats | null = null;
  for (const c of characters) {
    const v = pick(c);
    if (!v) continue;
    if (!best || v > (pick(best) ?? 0)) best = c;
  }
  return best;
}
