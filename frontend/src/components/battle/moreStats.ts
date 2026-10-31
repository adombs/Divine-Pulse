/**
 * The More stats tab's records for one battle: biggest blows, closest calls, rampages, who the other side went for, and
 * what Divine Pulse undid. Pure functions over the battle and its timeline (model.ts), like the rest of the page.
 */
import type { Battle } from "../../api";
import { armyId, Item, mergeHits, tally } from "./model";

/** One hit: who dealt it to whom, and when. */
export interface Blow {
  by: string;
  on: string;
  amount: number;
  turn: number | null;
}

export interface UnitRecord {
  id: string;
  value: number;
  turn?: number | null;
  /** Out of how many, where the record is a share (enemy attacks that did no damage...). */
  of?: number;
}

export interface PulseStats {
  uses: number;
  /** Actions the undone timelines had and your units' falls in them. */
  undone: number;
  falls: string[];
}

export interface MoreStats {
  fights: number;
  biggestHit: Blow | null;
  biggestTaken: Blow | null;
  /** Lowest HP one of your units got down to without falling, at half HP or less (needs the history's map steps). */
  closestCall: (UnitRecord & { max: number }) | null;
  /** Most of the other side defeated by one unit in one turn (2 or more). */
  rampage: UnitRecord | null;
  /** Defeated in one fight from full HP. */
  oneRound: UnitRecord | null;
  /** Attacked most by the other side. */
  mostWanted: UnitRecord | null;
  /** Most enemy attacks that did no damage (missed, or nothing got through); `of` the attacks. */
  untouchable: UnitRecord | null;
  /** Most damage dealt hitting back. */
  counters: UnitRecord | null;
  firstBlood: (UnitRecord & { target: string }) | null;
  lastBlow: (UnitRecord & { target: string }) | null;
  /** A unit on the map the whole battle that never fought, healed or used anything; value: tiles moved (-1 not read). */
  bench: UnitRecord | null;
  /** The biggest share of your army's damage one unit dealt (0-1). */
  carry: UnitRecord | null;
  pulses: PulseStats | null;
  /** Damage your units dealt and took, and defeats, each turn. */
  perTurn: { turn: number; dealt: number; taken: number; defeats: number }[];
  /** Fights and HP restored each turn. */
  activity: { turn: number; fights: number; healed: number }[];
  /** Where each side stood when each turn ended (the last step of the turn): units standing and the HP they had. */
  board: { turn: number; army: number; foes: number; armyHp: number; foeHp: number }[];
  /** Your units, one row each, for the per-unit charts. */
  units: UnitRow[];
}

export interface UnitRow {
  id: string;
  dealt: number;
  taken: number;
  healing: number;
  healed: number;
  tiles: number;
  weapons: number;
  spells: number;
  items: number;
  defeats: number;
  fights: number;
  /** Lowest HP it got down to, from the map steps, and its max HP (null without them). */
  low: number | null;
  max: number;
}

const isArmy = (id: string | null): id is string => !!id && id.startsWith("a:");

/** Units that fight your army: enemies and third armies (not allies or things like walls). */
function foes(battle: Battle): (id: string | null) => boolean {
  return (id) => {
    if (!id || !id.startsWith("e:")) return false;
    const side = battle.enemy_stats?.[id.slice(2)]?.side;
    return side === undefined || side === "enemy" || side === "third";
  };
}

/** The highest `value` (first one on ties), when it's at least `min`. */
function best(counts: Map<string, number>, min = 1): UnitRecord | null {
  let out: UnitRecord | null = null;
  for (const [id, value] of counts) if (value >= min && (!out || value > out.value)) out = { id, value };
  return out;
}

const bump = (m: Map<string, number>, id: string, n = 1) => m.set(id, (m.get(id) ?? 0) + n);

/** Biggest hits your army dealt and took (one entry in the game's history is one hit). */
export function blows(items: Item[], isFoe: (id: string | null) => boolean): { dealt: Blow | null; taken: Blow | null } {
  let dealt: Blow | null = null;
  let taken: Blow | null = null;
  const consider = (by: string | null, on: string | null, amount: number | null, turn: number | null) => {
    if (!by || !on || !amount) return;
    const blow = { by, on, amount, turn };
    if (isArmy(by) && isFoe(on) && (!dealt || amount > dealt.amount)) dealt = blow;
    if (isFoe(by) && isArmy(on) && (!taken || amount > taken.amount)) taken = blow;
  };
  for (const i of items) {
    if (i.kind !== "attack") continue;
    consider(i.actor, i.target, i.dealt, i.turn);
    consider(i.target, i.actor, i.taken, i.turn);
  }
  return { dealt, taken };
}

/** Defeats of the other side that took one fight from full HP, by unit: the target had lost no HP in an earlier fight. */
export function oneRoundDefeats(items: Item[], isFoe: (id: string | null) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  const hurt = new Set<string>();
  const fights = mergeHits(items.filter((i) => i.kind === "attack" || i.kind === "defeat"));
  fights.forEach((f, n) => {
    if (f.kind === "defeat") {
      if (isArmy(f.actor) && isFoe(f.target) && !hurt.has(f.target!)) bump(out, f.actor);
      return;
    }
    const hits = f.hits ?? [{ dealt: f.dealt, taken: f.taken }];
    // The defeat that ends a fight comes right after it: whoever it defeated isn't marked hurt before it's counted.
    const next = fights[n + 1];
    const defeated = next?.kind === "defeat" ? next.target : null;
    if (f.target && f.target !== defeated && hits.some((h) => (h.dealt ?? 0) > 0)) hurt.add(f.target);
    if (f.actor && f.actor !== defeated && hits.some((h) => (h.taken ?? 0) > 0)) hurt.add(f.actor);
  });
  return out;
}

/** Most defeats by one unit in one turn. */
export function rampage(items: Item[], isFoe: (id: string | null) => boolean): UnitRecord | null {
  const counts = new Map<string, number>();
  for (const i of items) if (i.kind === "defeat" && isArmy(i.actor) && isFoe(i.target)) bump(counts, `${i.turn ?? 0}|${i.actor}`);
  const top = best(counts, 2);
  if (!top) return null;
  const [turn, id] = top.id.split("|");
  return { id, value: top.value, turn: Number(turn) || null };
}

/** Lowest share of max HP one of your units got down to without falling (half or less), from where everyone stood after
 * each step. */
export function closestCall(battle: Battle): (UnitRecord & { max: number }) | null {
  const max = new Map(battle.units.map((u) => [armyId(u.key), u.now.hp || u.start.hp]));
  let out: (UnitRecord & { max: number }) | null = null;
  for (const s of battle.map_steps ?? []) {
    for (const [id, [, , hp]] of Object.entries(s.units)) {
      const full = max.get(id);
      if (!full || hp <= 0 || hp > full / 2) continue;
      // Lowest share of max HP; ties go to the lowest HP, then the earliest.
      if (!out || hp / full < out.value / out.max || (hp / full === out.value / out.max && hp < out.value)) {
        out = { id, value: hp, max: full, turn: s.turn };
      }
    }
  }
  return out;
}

/** What the timelines Divine Pulse undid had in them. */
export function pulseStats(battle: Battle): PulseStats | null {
  if (!battle.divine_pulses) return null;
  const branches = battle.branches ?? [];
  const names = new Map(battle.units.map((u) => [armyId(u.key), u.name]));
  let undone = 0;
  const falls: string[] = [];
  for (const b of branches) {
    for (const e of b.log) {
      if (e.kind === "phase" || e.kind === "pulse") continue;
      undone += 1;
      if (e.kind === "fell" && isArmy(e.actor_id ?? null)) falls.push(names.get(e.actor_id!) ?? "A unit");
    }
  }
  return { uses: battle.divine_pulses, undone, falls };
}

/** A unit on the map from start to end of a finished battle that never fought or used anything (the one that moved least). */
export function benchWarmer(battle: Battle, items: Item[]): UnitRecord | null {
  const busy = new Set<string>();
  for (const i of items) if (i.kind !== "move" && i.kind !== "wait" && i.actor) busy.add(i.actor);
  if (battle.active || items.filter((i) => i.kind === "attack").length < 4) return null;
  let out: UnitRecord | null = null;
  for (const u of battle.units) {
    const id = armyId(u.key);
    if (!u.on_map || u.adjutant_of || busy.has(id) || u.weapon_uses || u.spells_cast || u.item_uses) continue;
    if (tally(items, id, { fights: u.combats, defeats: u.defeats }).fights) continue;
    const tiles = u.tiles_moved ?? -1;
    if (!out || tiles < out.value) out = { id, value: tiles };
  }
  return out;
}

export function moreStats(battle: Battle, items: Item[]): MoreStats {
  const isFoe = foes(battle);
  const attacks = items.filter((i) => i.kind === "attack");
  const hit = blows(items, isFoe);

  const targeted = new Map<string, number>();
  const clean = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const i of attacks) {
    if (!isFoe(i.actor) || !isArmy(i.target)) continue;
    bump(targeted, i.target);
    if (!i.dealt) bump(clean, i.target);
    if (i.taken) bump(counters, i.target, i.taken);
  }
  const untouched = best(clean, 3);

  const defeats = items.filter((i) => i.kind === "defeat" && isArmy(i.actor) && isFoe(i.target));
  const blood = (i: Item | undefined) => (i ? { id: i.actor!, value: 1, turn: i.turn, target: i.target! } : null);

  const dealtBy = battle.units.filter((u) => (u.damage_dealt ?? 0) > 0);
  const total = dealtBy.reduce((n, u) => n + (u.damage_dealt ?? 0), 0);
  const top = [...dealtBy].sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0))[0];

  return {
    fights: attacks.length,
    biggestHit: hit.dealt,
    biggestTaken: hit.taken,
    closestCall: closestCall(battle),
    rampage: rampage(items, isFoe),
    oneRound: best(oneRoundDefeats(items, isFoe), 2),
    mostWanted: best(targeted, 2),
    untouchable: untouched && { ...untouched, of: targeted.get(untouched.id) },
    counters: best(counters),
    firstBlood: blood(defeats[0]),
    lastBlow: battle.active || defeats.length < 2 ? null : blood(defeats[defeats.length - 1]),
    bench: benchWarmer(battle, items),
    carry: dealtBy.length >= 2 && top ? { id: armyId(top.key), value: (top.damage_dealt ?? 0) / total } : null,
    pulses: pulseStats(battle),
    perTurn: perTurn(items, isFoe, battle.turn),
    activity: activity(items, battle.turn),
    board: board(battle, isFoe),
    units: unitRows(battle, items),
  };
}

function unitRows(battle: Battle, items: Item[]): UnitRow[] {
  const lows = new Map<string, number>();
  for (const s of battle.map_steps ?? []) {
    for (const [id, [, , hp]] of Object.entries(s.units)) if (isArmy(id) && hp > 0 && hp < (lows.get(id) ?? Infinity)) lows.set(id, hp);
  }
  return battle.units
    .filter((u) => !u.adjutant_of)
    .map((u) => {
      const id = armyId(u.key);
      return {
        id,
        dealt: u.damage_dealt ?? 0,
        taken: u.damage_taken ?? 0,
        healing: u.healing_given ?? 0,
        healed: u.healed ?? 0,
        tiles: u.tiles_moved ?? 0,
        weapons: u.weapon_uses,
        spells: u.spells_cast,
        items: u.item_uses,
        defeats: u.defeats ?? 0,
        fights: tally(items, id, { fights: u.combats, defeats: u.defeats }).fights,
        low: lows.get(id) ?? null,
        max: u.now.hp || u.start.hp,
      };
    });
}

/** Fights and HP restored by turn. */
export function activity(items: Item[], turns: number | null = null): MoreStats["activity"] {
  const rows = new Map<number, MoreStats["activity"][number]>();
  const row = (turn: number) => rows.get(turn) ?? rows.set(turn, { turn, fights: 0, healed: 0 }).get(turn)!;
  for (const i of items) {
    if (i.turn === null) continue;
    if (i.kind === "attack") row(i.turn).fights += 1;
    else if (i.kind === "heal") row(i.turn).healed += i.restored ?? 0;
  }
  const last = Math.max(turns ?? 0, ...rows.keys());
  return Array.from({ length: last }, (_, n) => rows.get(n + 1) ?? { turn: n + 1, fights: 0, healed: 0 });
}

/** Units standing and their HP at the end of each turn, from the map steps (each lists only the units it changed, so
 * everyone else keeps their last HP). Empty without them. */
export function board(battle: Battle, isFoe: (id: string | null) => boolean): MoreStats["board"] {
  const hp = new Map<string, number>();
  const out: MoreStats["board"] = [];
  const snap = (turn: number) => {
    const row = { turn, army: 0, foes: 0, armyHp: 0, foeHp: 0 };
    for (const [id, left] of hp) {
      if (left <= 0) continue;
      if (isArmy(id)) (row.army += 1), (row.armyHp += left);
      else if (isFoe(id)) (row.foes += 1), (row.foeHp += left);
    }
    return row;
  };
  const steps = battle.map_steps ?? [];
  steps.forEach((s, n) => {
    for (const [id, [, , left]] of Object.entries(s.units)) hp.set(id, left);
    if (n === steps.length - 1 || steps[n + 1].turn !== s.turn) out.push(snap(s.turn));
  });
  return out;
}

/** Damage your units dealt to and took from the other side, and their defeats, by turn (every turn from 1 to `turns`
 * or the last one in the log). */
export function perTurn(items: Item[], isFoe: (id: string | null) => boolean, turns: number | null = null): MoreStats["perTurn"] {
  const rows = new Map<number, MoreStats["perTurn"][number]>();
  const row = (turn: number) => rows.get(turn) ?? rows.set(turn, { turn, dealt: 0, taken: 0, defeats: 0 }).get(turn)!;
  for (const i of items) {
    if (i.turn === null) continue;
    if (i.kind === "defeat" && isArmy(i.actor) && isFoe(i.target)) row(i.turn).defeats += 1;
    if (i.kind !== "attack") continue;
    if (isArmy(i.actor) && isFoe(i.target)) {
      row(i.turn).dealt += i.dealt ?? 0;
      row(i.turn).taken += i.taken ?? 0;
    } else if (isFoe(i.actor) && isArmy(i.target)) {
      row(i.turn).dealt += i.taken ?? 0;
      row(i.turn).taken += i.dealt ?? 0;
    }
  }
  const last = Math.max(turns ?? 0, ...rows.keys());
  return Array.from({ length: last }, (_, n) => rows.get(n + 1) ?? { turn: n + 1, dealt: 0, taken: 0, defeats: 0 });
}
