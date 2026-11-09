/**
 * What the Battle page shows, worked out from a Battle: who's who (your units and the others), one timeline of
 * everything that happened (the game's action log and the tracker's events, merged), grouped by turn, and each
 * unit's fights and opponents. Pure functions: the components only render these.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { Battle, BattleEvent, BattleUnit, Branch, EnemyStats, LogEntry, ValueKey } from "../../api";
import { clock, plural } from "../../format";
import { battleName, KIND_LABEL } from "./scenarios";
import type { IconName } from "../Icon";

export const STAT_ORDER: ValueKey[] = ["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha", "mv"];
export const STAT_LABEL: Record<ValueKey, string> = {
  hp: "HP", mv: "Mv", str: "Str", mag: "Mag", dex: "Dex", spd: "Spd", lck: "Lck", def: "Def", res: "Res", cha: "Cha",
};
/** A weapon with this many uses left or fewer is running low; a unit at this share of its max HP or less is in danger. */
export const LOW_WEAPON = 3;
export const LOW_HP = 0.3;

export const TEXT = {
  actions: "Counted from what the unit spent: weapon durability, items and spell uses.",
  estimated:
    "The game's own record of the battle couldn't be read, so this fight was worked out from HP changes and the combat math. The percentage is how sure the tracker is of who fought whom.",
  notTracked: "Not tracked: this comes from the game's own record of the battle (the Divine Pulse list), which couldn't be read.",
  notLocated: "Not tracked yet: the game field it needs hasn't been located in memory.",
};

/** A unit in the battle, yours or another: "a:<key>" / "e:<slot>". */
export interface Who {
  id: string;
  name: string;
  army: boolean;
  unit?: BattleUnit;
  enemy?: EnemyStats;
}

export const armyId = (key: string) => `a:${key}`;
export const enemyId = (slot: number | string) => `e:${slot}`;

/** Everyone in the battle by id. */
export function people(battle: Battle): Map<string, Who> {
  const out = new Map<string, Who>();
  for (const u of battle.units) out.set(armyId(u.key), { id: armyId(u.key), name: u.name, army: true, unit: u });
  for (const [slot, e] of Object.entries(battle.enemy_stats ?? {})) out.set(enemyId(slot), { id: enemyId(slot), name: e.label, army: false, enemy: e });
  for (const [slot, label] of Object.entries(battle.enemy_labels ?? {})) {
    if (!out.has(enemyId(slot))) out.set(enemyId(slot), { id: enemyId(slot), name: label, army: false });
  }
  return out;
}

export function enemies(battle: Battle): EnemyStats[] {
  return Object.values(battle.enemy_stats ?? {}).sort((a, b) => a.slot - b.slot);
}

// The timeline

export type Category = "fight" | "defeat" | "move" | "support" | "growth" | "turn";


const LOG_CATEGORY: Record<LogEntry["kind"], Category> = {
  phase: "turn", move: "move", wait: "move", attack: "fight", defeat: "defeat", fell: "defeat", heal: "support", spell: "support", item: "support", art: "move", rally: "support", gambit: "fight", act: "move", pulse: "turn",
};
const EVENT_CATEGORY: Record<BattleEvent["kind"], Category> = {
  start: "turn", turn: "turn", end: "turn", divine_pulse: "turn", level_up: "growth", stat_up: "growth",
  joined: "move", left: "defeat", enemies: "defeat",
};

/** The icon for each kind of thing in the log (game log kinds, then the tracker's events). */
export const ICON: Record<string, IconName> = {
  phase: CONCEPT_ICON.phase,
  move: CONCEPT_ICON.move,
  wait: CONCEPT_ICON.wait,
  attack: CONCEPT_ICON.attack,
  defeat: CONCEPT_ICON.defeat,
  fell: CONCEPT_ICON.fell,
  heal: CONCEPT_ICON.heal,
  spell: CONCEPT_ICON.spell,
  item: CONCEPT_ICON.item,
  art: CONCEPT_ICON.art,
  rally: CONCEPT_ICON.rally,
  act: CONCEPT_ICON.act,
  pulse: CONCEPT_ICON.pulse,
  start: CONCEPT_ICON.start,
  turn: CONCEPT_ICON.turn,
  end: CONCEPT_ICON.end,
  divine_pulse: CONCEPT_ICON.pulse,
  level_up: CONCEPT_ICON.levelUp,
  stat_up: CONCEPT_ICON.statUp,
  joined: CONCEPT_ICON.joined,
  left: CONCEPT_ICON.left,
  enemies: CONCEPT_ICON.enemies,
  defeated: CONCEPT_ICON.defeat,
  // A battalion's gambit, once the tracker reads one (no gambit event is verified yet).
  gambit: CONCEPT_ICON.battalion,
};

/** One thing that happened: from the game's log or one of the tracker's events. */
export interface Item {
  key: string;
  t: number;
  turn: number | null;
  phase: number | null;
  kind: string;
  category: Category;
  text: string;
  /** A phase start ("Began enemy phase.") or a new turn: a sub-heading in the log. */
  heading: boolean;
  actor: string | null;
  target: string | null;
  dealt: number | null;
  taken: number | null;
  restored: number | null;
  /** The spell or item used ("Rescue", "Vulnerary"), if known. */
  detail?: string | null;
  /** Estimated fights only (0-1). */
  confidence: number | null;
  /** The timeline it happened in: 0 the one that stands, else a Branch's id (undone by Divine Pulse). */
  branch: number;
  /** Position in the game's history (MapStep.step); null for the tracker's events. */
  step: number | null;
  /** A double hit shown as one row (see mergeHits): every hit's numbers, and the positions of all of them. */
  hits?: { dealt: number | null; taken: number | null }[];
  steps?: number[];
  /** The one chronology (chronicle.ts) only. The replay beat this happened at (null: none to show it at; absent: the
   * item is not from the chronology), and every beat of a merged double hit. */
  beat?: number | null;
  beats?: number[];
  /** Which Divine Pulse (0 for the first) turned this back, and the beat that use is (null: not on the replay). */
  undoneBy?: number | null;
  undoneAt?: number | null;
  /** The row of a Divine Pulse use: which one (0 for the first). */
  pulse?: number;
  /** Its target was defeated in the same step (the "defeated" row it replaces is not shown). */
  defeated?: boolean;
}

/** Hits in a row by the same unit on the same target (a double attack, the game logs each) as one row with a pill for
 * each hit. Oldest first in and out. */
export function mergeHits(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (
      last && item.kind === "attack" && last.kind === "attack" && item.actor === last.actor && item.target === last.target &&
      item.turn === last.turn && item.phase === last.phase && item.branch === last.branch && item.detail === last.detail
    ) {
      last.hits = [...(last.hits ?? [{ dealt: last.dealt, taken: last.taken }]), { dealt: item.dealt, taken: item.taken }];
      last.steps = [...(last.steps ?? (last.step !== null ? [last.step] : [])), ...(item.step !== null ? [item.step] : [])];
      if (item.beat !== undefined) last.beats = [...(last.beats ?? (last.beat != null ? [last.beat] : [])), ...(item.beat != null ? [item.beat] : [])];
      last.defeated ||= item.defeated;
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

/** Which timeline the log shows: the one that stands (0), a branch a Divine Pulse undid, or all of them. */
export type TimelineView = number | "all";

/** Everything that happened, oldest first, in one timeline (see TimelineView). A branch's timeline is what led up to
 * it in the timelines it split from, then its own actions. */
export function timeline(battle: Battle, view: TimelineView = 0): Item[] {
  const branches = battle.branches ?? [];
  if (view === 0 || !branches.length) return build(battle, battle.log, battle.events, 0);
  if (view === "all") {
    const all = [build(battle, battle.log, battle.events, 0), ...branches.map((b) => build(battle, b.log, b.events, b.id))].flat();
    return withTurns(all.sort((x, y) => x.t - y.t || x.branch - y.branch));
  }
  const chain: Branch[] = [];
  for (let b = branches.find((x) => x.id === view); b; b = b.parent ? branches.find((x) => x.id === b!.parent) : undefined) chain.unshift(b);
  if (!chain.length) return build(battle, battle.log, battle.events, 0);
  // When each split happened: the first thing undone in the branch (or the Divine Pulse itself).
  const splitAt = (b: Branch) => Math.min(b.at, ...b.log.map((e) => e.t), ...b.events.map((e) => e.t));
  const parts: Item[][] = [];
  const before = (entries: LogEntry[], events: BattleEvent[], next: Branch | undefined, branch: number) =>
    build(
      battle,
      next ? entries.filter((e) => e.step !== null && e.step !== undefined && e.step < next.fork && e.kind !== "pulse") : entries,
      next ? events.filter((e) => e.t < splitAt(next)) : events,
      branch,
    );
  parts.push(before(battle.log, battle.events, chain[0], 0));
  chain.forEach((b, i) => parts.push(before(b.log, b.events, chain[i + 1], b.id)));
  return withTurns(parts.flat());
}

/** The branches as a tree, depth first. */
export function branchTree(battle: Battle): { branch: Branch }[] {
  const branches = battle.branches ?? [];
  const out: { branch: Branch }[] = [];
  const walk = (parent: number) =>
    branches
      .filter((b) => b.parent === parent)
      .sort((a, b) => a.fork - b.fork || a.id - b.id)
      .forEach((b) => {
        out.push({ branch: b });
        walk(b.id);
      });
  walk(0);
  return out;
}

/** One timeline for the Timelines view: its log grouped by position in the game's history, oldest first. */
export interface TimelineColumn {
  /** 0: the timeline that stands; else a Branch's id. */
  id: number;
  parent: number | null;
  /** History position it splits from its parent at (0 for the one that stands). */
  fork: number;
  /** When time was turned back from it (0 for the one that stands). */
  at: number;
  /** What happened at each history position: actions, with the tracker's events (level-ups...) after the action they followed. */
  rows: Map<number, Item[]>;
}

/** Every timeline as a column, the one that stands first, then the branches depth first. Null when the log has no
 * history positions (fights worked out from HP changes only). */
export function timelineColumns(battle: Battle, standing: Item[]): TimelineColumn[] | null {
  if (!standing.some((i) => i.step !== null)) return null;
  const column = (id: number, parent: number | null, fork: number, items: Item[], when = 0): TimelineColumn => {
    const rows = new Map<number, Item[]>();
    let at = fork;
    for (const item of items) {
      if (item.step !== null) at = item.step;
      if (!rows.has(at)) rows.set(at, []);
      rows.get(at)!.push(item);
    }
    return { id, parent, fork, at: when, rows };
  };
  return [
    column(0, null, 0, standing),
    ...branchTree(battle).map(({ branch }) => column(branch.id, branch.parent, branch.fork, build(battle, branch.log, branch.events, branch.id), branch.at)),
  ];
}

/** Give events (which have no turn of their own) the turn they fell in. */
function withTurns(items: Item[]): Item[] {
  let turn: number | null = null;
  for (const item of items) {
    if (item.turn !== null) turn = item.turn;
    else item.turn = turn;
  }
  return items;
}

/** The number in a turn event's text ("Turn 3"). */
function turnNumber(text: string): number | null {
  const m = text.match(/Turn (\d+)/);
  return m ? Number(m[1]) : null;
}

/** One timeline's items, oldest first: the game's log and the tracker's events (level-ups, Divine Pulses...). */
export function build(battle: Battle, entries: LogEntry[], tracked: BattleEvent[], branch: number): Item[] {
  const legacyId = (value: string | null, actor = false): string | null => {
    if (!value) return null;
    if (battle.units.some((u) => u.key === value)) return armyId(value);
    if (actor) return null;
    const matches = Object.entries(battle.enemy_labels ?? {}).filter(([, label]) => label === value);
    return matches.length === 1 ? enemyId(matches[0][0]) : null;
  };
  const log: Item[] = entries.map((e, i) => {
    const actor = e.actor_id ?? legacyId(e.unit, true);
    const target = e.target_id ?? legacyId(e.target);
    // Battles saved before staff use was told from attacks: no damage between your own units is no attack.
    const staff = e.kind === "attack" && !e.dealt && !e.taken && !!actor?.startsWith("a:") && !!target?.startsWith("a:");
    const kind = staff ? "heal" : e.kind;
    return {
      key: `b${branch}l${i}`,
      t: e.t,
      turn: e.turn ?? null,
      phase: e.phase ?? null,
      kind,
      category: LOG_CATEGORY[kind],
      text: e.kind === "pulse" ? pulseText(battle, e) : e.text,
      heading: e.kind === "phase",
      actor,
      target,
      dealt: e.dealt ?? null,
      taken: e.taken ?? null,
      restored: e.restored ?? (staff ? 0 : null),
      detail: e.detail ?? null,
      confidence: e.confidence ?? null,
      branch,
      step: e.step ?? null,
    };
  });

  // Tracker events, minus what the game's log already says better.
  const fell = new Set(log.filter((i) => i.kind === "fell").map((i) => i.actor));
  const logHasTurns = log.some((i) => i.kind === "phase");
  const logHasDefeats = log.some((i) => i.category === "defeat");
  const events: Item[] = tracked
    .filter((e) => !(e.kind === "turn" && logHasTurns) && !(e.kind === "left" && e.unit && fell.has(armyId(e.unit))))
    .filter((e) => !(e.kind === "enemies" && logHasDefeats))
    .map((e, i) => ({
      key: `b${branch}e${i}`,
      t: e.t,
      turn: e.kind === "turn" ? turnNumber(e.text) : null,
      phase: null,
      kind: e.kind,
      category: EVENT_CATEGORY[e.kind],
      text: e.text,
      heading: e.kind === "turn",
      actor: e.unit ? armyId(e.unit) : null,
      target: null,
      dealt: null,
      taken: null,
      restored: null,
      confidence: null,
      branch,
      step: null,
    }));

  // Merge by time (the log first on ties: its entries are seen together), and give events the turn they fell in.
  const merged: Item[] = [];
  let a = 0;
  let b = 0;
  while (a < log.length || b < events.length) {
    if (b >= events.length || (a < log.length && log[a].t <= events[b].t)) merged.push(log[a++]);
    else merged.push(events[b++]);
  }
  let turn: number | null = null;
  for (const item of merged) {
    if (item.turn !== null) turn = item.turn;
    else item.turn = turn;
  }
  return merged;
}

/** "Turned back time to turn 2 with Divine Pulse: 5 actions undone." */
function pulseText(battle: Battle, e: LogEntry): string {
  const undone = (battle.branches ?? []).find((b) => b.fork === e.step && Math.abs(b.at - e.t) < 1);
  return undone ? pulseSummary(undone) : e.text;
}

/** "Turned back time to turn 2 with Divine Pulse: 5 actions undone." (a defeat is part of the action that caused it). */
export function pulseSummary(undone: Branch): string {
  const actions = undone.log.filter((x) => x.kind !== "phase" && x.kind !== "pulse" && x.kind !== "defeat" && x.kind !== "fell").length;
  return `Turned back time${undone.turn !== null ? ` to turn ${undone.turn}` : ""} with Divine Pulse: ${actions} action${actions === 1 ? "" : "s"} undone.`;
}

export function involves(item: Item, id: string): boolean {
  return item.actor === id || item.target === id;
}

/** Damage `id` dealt and took in a fight item (its side may be either). */
export function sideOf(item: Item, id: string): { dealt: number; taken: number } {
  if (item.actor === id) return { dealt: item.dealt ?? 0, taken: item.taken ?? 0 };
  if (item.target === id) return { dealt: item.taken ?? 0, taken: item.dealt ?? 0 };
  return { dealt: 0, taken: 0 };
}


/** Fights and defeats for `id` from the log: what the game's counters say when they're read, else what the log shows. */
export function tally(items: Item[], id: string, counters: { fights?: number | null; defeats?: number | null } = {}) {
  let fights = 0;
  let defeats = 0;
  for (const i of items) {
    if (i.kind === "attack" && involves(i, id)) fights += 1;
    if ((i.kind === "defeat" && i.actor === id) || (i.kind === "fell" && i.target === id)) defeats += 1;
  }
  const logged = fights > 0 || defeats > 0;
  return {
    fights: counters.fights ?? (logged ? fights : null),
    defeats: counters.defeats ?? (logged ? defeats : null),
  };
}



export interface Opponent {
  id: string;
  fights: number;
  dealt: number;
  taken: number;
  /** "won": `id` was defeated by the unit whose opponents these are; "lost": it defeated that unit. */
  outcome: "won" | "lost" | null;
}

/** Who `id` fought, with the damage each way, most fights first. */
export function opponents(items: Item[], id: string): Opponent[] {
  const out = new Map<string, Opponent>();
  for (const item of items) {
    if (!involves(item, id)) continue;
    const other = item.actor === id ? item.target : item.actor;
    if (!other) continue;
    if (item.kind === "attack") {
      const o = out.get(other) ?? { id: other, fights: 0, dealt: 0, taken: 0, outcome: null };
      const side = sideOf(item, id);
      o.fights += 1;
      o.dealt += side.dealt;
      o.taken += side.taken;
      out.set(other, o);
    } else if (item.kind === "defeat" || item.kind === "fell") {
      const o = out.get(other) ?? { id: other, fights: 0, dealt: 0, taken: 0, outcome: null };
      // defeat: actor defeated target; fell: actor fell to target.
      const idWon = item.kind === "defeat" ? item.actor === id : item.target === id;
      o.outcome = idWon ? "won" : "lost";
      out.set(other, o);
    }
  }
  return [...out.values()].sort((a, b) => b.fights - a.fights || b.dealt - a.dealt);
}

// Unit status

export function hpShare(hp: number | null, max: number): number | null {
  return hp === null || !max ? null : hp / max;
}

/** What a unit on the map is running out of: low HP, magic, a weapon about to break. */
export function alertsFor(u: BattleUnit): string[] {
  const out: string[] = [];
  if (!u.on_map) return out;
  if (u.hp !== null && u.hp > 0 && u.hp <= LOW_HP * u.now.hp) out.push(`down to ${u.hp} of ${u.now.hp} HP`);
  if (u.spell_uses_full && u.spell_uses_left === 0) out.push("no spell uses left");
  if (u.weakest_weapon !== null && u.weakest_weapon <= LOW_WEAPON) out.push(`a weapon with ${plural(u.weakest_weapon, "use")} left`);
  if (u.broken_weapons > 0) out.push(u.broken_weapons === 1 ? "a broken weapon" : `${u.broken_weapons} broken weapons`);
  return out;
}

export function statGains(u: BattleUnit): number {
  return Object.entries(u.gains).reduce((n, [k, v]) => n + (k === "mv" ? 0 : Math.max(0, v ?? 0)), 0);
}

/** The army's damage, healing and movement totals (null while not tracked). */
export function armyTotals(battle: Battle) {
  const items = timeline(battle);
  const rows = battle.units.map((u) => battleUnitStats(battle, u, items));
  // What was recorded: an adjutant (in the battle, not on the map) has no history numbers, and that mustn't blank the army's.
  const sum = (pick: (u: ReturnType<typeof battleUnitStats>) => number | null) => partialSum(rows.map(pick)).value;
  return {
    fights: sum((u) => u.fights),
    dealt: sum((u) => u.dealt),
    taken: sum((u) => u.taken),
    healing: sum((u) => u.healing),
    tiles: sum((u) => u.tiles),
    defeats: sum((u) => u.defeats),
  };
}

/** A complete total only when every contributor is known. Zero is a recorded value. */
export function recordedSum(values: (number | null | undefined)[]): number | null {
  return values.length && values.every((v) => v !== null && v !== undefined)
    ? (values as number[]).reduce((n, v) => n + v, 0) : null;
}

/** What was recorded, with whether anything was missing. Null only when nothing was recorded. */
export function partialSum(values: (number | null | undefined)[]): { value: number | null; partial: boolean } {
  const known = values.filter((v): v is number => v !== null && v !== undefined);
  return { value: known.length ? known.reduce((n, v) => n + v, 0) : null, partial: known.length < values.length };
}

/** Canonical battle-scoped unit metrics. Backend metrics already exclude undone branches; never add log damage. */
export function battleUnitStats(battle: Battle, unit: BattleUnit, items: Item[] = timeline(battle)) {
  const counts = tally(items.filter((i) => i.branch === 0), armyId(unit.key), { fights: unit.combats, defeats: unit.defeats });
  return { ...counts, dealt: unit.damage_dealt ?? null, taken: unit.damage_taken ?? null,
    healing: unit.healing_given ?? null, healed: unit.healed ?? null, tiles: unit.tiles_moved ?? null };
}

/** The battle as plain text, to paste into a message or notes. */
export function battleSummary(battle: Battle, seconds: number): string {
  const lines: string[] = [];
  const when = new Date(battle.started_at).toLocaleString();
  const name = battleName(battle);
  lines.push(`${name.title}${battle.active ? " (in progress)" : ""} · ${when} · ${clock(seconds)}`);
  const where = [name.kind ? KIND_LABEL[name.kind] : "", name.place ?? ""].filter(Boolean);
  if (where.length) lines.push(where.join(" · "));
  const chance = battle.outlook?.chance;
  if (chance !== null && chance !== undefined) lines.push(`Outlook: ${Math.round(chance * 100)}% (estimate)`);
  lines.push(
    `Units: ${battle.units.length} · level-ups: ${battle.level_ups} · stat points: +${battle.stat_points} · weapon attacks: ${battle.weapon_uses} · spells: ${battle.spells_cast} · items: ${battle.item_uses} · Divine Pulse: ${battle.divine_pulses}`,
  );
  if (battle.enemies_start) lines.push(`Other units on the map: ${battle.enemies_now} of ${battle.enemies_start}`);
  const located = [
    battle.turn !== null && `turn ${battle.turn}`,
    battle.enemies_defeated !== null && `${battle.enemies_defeated} killed`,
    battle.army_hp !== null && battle.army_max_hp && `army HP ${battle.army_hp}/${battle.army_max_hp}`,
    battle.divine_pulse_charges !== null && `${battle.divine_pulse_charges} Divine Pulse charges left`,
  ].filter(Boolean);
  if (located.length) lines.push(located.join(" · "));
  lines.push("");
  for (const u of battle.units) {
    const gains = STAT_ORDER.filter((k) => u.gains[k]).map((k) => `${STAT_LABEL[k]} ${(u.gains[k] ?? 0) > 0 ? "+" : ""}${u.gains[k]}`);
    const level = u.level_ups ? `Lv ${u.start_level}→${u.level}` : `Lv ${u.level}`;
    const acts = [
      u.weapon_uses && `${u.weapon_uses} attacks`,
      u.spells_cast && `${u.spells_cast} spells`,
      u.item_uses && `${u.item_uses} items`,
      u.damage_dealt && `${u.damage_dealt} damage dealt`,
      u.defeats && `${u.defeats} killed`,
      u.damage_taken && `${u.damage_taken} taken`,
      u.healing_given && `${u.healing_given} HP healed`,
      u.tiles_moved && `${u.tiles_moved} tiles`,
    ].filter(Boolean);
    lines.push(
      `- ${u.name} (${u.class_name}), ${level}${gains.length ? `: ${gains.join(", ")}` : ""}${acts.length ? ` · ${acts.join(", ")}` : ""}${u.on_map ? "" : " · left the battle"}`,
    );
  }
  const foes = enemies(battle).filter((e) => e.combats > 0 || !e.on_map);
  if (foes.length) {
    lines.push("", "Other units:");
    for (const e of foes) {
      const parts = [
        `${plural(e.combats, "fight")}`,
        e.damage_dealt !== null && `${e.damage_dealt} dealt`,
        e.damage_taken !== null && `${e.damage_taken} taken`,
        !e.on_map && (e.left ? "left the map" : e.defeated_by ? `killed by ${e.defeated_by}` : "killed"),
      ].filter(Boolean);
      lines.push(`- ${e.label} (${e.class_name}, Lv ${e.level}) · ${parts.join(", ")}`);
    }
  }
  const notable = battle.events.filter((e) => e.kind === "level_up" || e.kind === "divine_pulse" || e.kind === "left");
  if (notable.length) {
    lines.push("", "Timeline:");
    for (const e of notable) lines.push(`  ${clock(e.t)} ${e.text}`);
  }
  return lines.join("\n");
}
