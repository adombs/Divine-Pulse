/** Presentation data for History. Recorded-statistics functions remain the source of every value. */
import type { Battle } from "../../api";
import { armyTotals, partialSum, recordedSum, statGains } from "./model";
import { AWARDS } from "./moreStats";
import { SCORE_EXPLANATION } from "../../score";
import { armySprite } from "./map";
import type { Sprite } from "./mapIcons";
import { battleName, type Kind } from "./scenarios";
import { characterStats, runAwards, runBattles, runStats, timelines } from "./stats";

export type LedgerKind = "battles" | "characters";
export type LedgerPart = "combat" | "growth" | "records";
export interface LedgerColumn { key: string; label: string; hint?: string; group?: string }
export interface LedgerRow {
  id: string; name: string; note: string; live: boolean;
  sprite?: Sprite;
  kind?: Kind | null;
  values: Record<LedgerPart, (number | null)[]>;
}
export interface LedgerSort { column: number; direction: "ascending" | "descending" }
const metric = (key: string, label: string, hint?: string): LedgerColumn => ({ key, label, hint });

const MVP_POINTS = 1000;

/** Each unit's run score, as the backend's domain/best_unit.py works it out: over finished battles only, 1,000 per battle
 *  MVP (everyone whose defeats equal the battle's maximum, which must be at least 1, so ties are shared) plus damage
 *  dealt and healing given. */
export function unitScores(source: Battle[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const b of source) {
    if (!b.ended_at) continue;
    const most = b.units.reduce((m, u) => Math.max(m, u.defeats ?? 0), 0);
    for (const u of b.units) {
      const mvp = most > 0 && (u.defeats ?? 0) === most ? MVP_POINTS : 0;
      scores.set(u.key, (scores.get(u.key) ?? 0) + mvp + (u.damage_dealt ?? 0) + (u.healing_given ?? 0));
    }
  }
  return scores;
}

export function buildRunLedger(source: Battle[], kind: LedgerKind) {
  const battles = runBattles(source);
  const items = timelines(battles);
  const characters = characterStats(battles, items);
  const run = runStats(battles, characters, items);
  const awards = runAwards(source);
  const scores = unitScores(battles);
  const rows: LedgerRow[] = kind === "battles" ? battles.map((b) => {
    const t = armyTotals(b);
    const identity = battleName(b);
    return { id: b.id, name: identity.title, kind: identity.kind, note: new Date(b.started_at).toLocaleDateString(), live: b.active,
      values: {
        combat: [b.seconds, b.turn, t.fights, t.defeats, t.dealt, t.taken, t.healing, t.tiles],
        growth: [b.units.reduce((n, u) => n + u.level_ups, 0), b.units.reduce((n, u) => n + statGains(u), 0), b.weapon_uses, b.spells_cast, b.item_uses, b.divine_pulses], records: [],
      } };
  }) : characters.map((c) => ({ id: c.key, name: c.name, note: `${c.class_name} · Lv ${c.level}`, live: false,
    sprite: armySprite(c.appearances[0].unit),
    values: { combat: [scores.get(c.key) ?? 0, c.battles, c.fights, c.defeats, c.damage_dealt, c.damage_taken, c.healing_given, c.healed, c.tiles_moved],
      growth: [c.level_ups, c.stat_points, c.weapon_uses, c.spells_cast, c.item_uses],
      records: AWARDS.map((a) => "battleWide" in a ? null : awards.characters.get(c.key)?.[a.key] ?? 0) } }));
  const columns: Record<LedgerPart, LedgerColumn[]> = {
    combat: [...(kind === "characters" ? [metric("score", "Score", SCORE_EXPLANATION)] : []),
      kind === "battles" ? metric("seconds", "Time") : metric("battles", "Battles", "Battles this character appeared in; the total counts all character appearances"),
      ...(kind === "battles" ? [metric("turns", "Turns")] : []),
      metric("fights", "Fights", "Each character’s participation, from battle counters when read, otherwise recorded actions"),
      metric("kills", "Kills"), metric("dealt", "Dealt", "Damage dealt"), metric("taken", "Taken", "Damage taken"), metric("healing", "Healing", "Healing given"),
      ...(kind === "characters" ? [metric("received", "Received", "Healing received")] : []), metric("tiles", "Tiles", "Tiles moved")],
    growth: [metric("levels", "Level-ups"), metric("stats", "Stat increases"), metric("weapons", "Weapon attacks"), metric("spells", "Spells"), metric("items", "Items"),
      ...(kind === "battles" ? [metric("pulses", "Divine Pulse")] : [])],
    records: AWARDS.map((a) => ({ key: a.key, label: a.label, group: a.group,
      hint: "battleWide" in a ? "Battle-wide record; counted in the run total only" : `${a.title}: times received in finished battles` })),
  };
  // Damage, healing and movement totals add up what was recorded.
  const sums = { dealt: partialSum(battles.flatMap((b) => b.units.map((u) => u.damage_dealt))), taken: partialSum(battles.flatMap((b) => b.units.map((u) => u.damage_taken))),
    healing: partialSum(battles.flatMap((b) => b.units.map((u) => u.healing_given))), tiles: partialSum(battles.flatMap((b) => b.units.map((u) => u.tiles_moved))) };
  const totals: Record<LedgerPart, (number | null)[]> = {
    combat: kind === "battles" ? [run.seconds, run.turns, run.fights, run.defeats, sums.dealt.value, sums.taken.value, sums.healing.value, sums.tiles.value]
      : [[...scores.values()].reduce((n, v) => n + v, 0), characters.reduce((n, c) => n + c.battles, 0), run.fights, run.defeats, sums.dealt.value, sums.taken.value, sums.healing.value, recordedSum(characters.map((c) => c.healed)), sums.tiles.value],
    growth: [run.level_ups, run.stat_points, run.weapon_uses, run.spells_cast, run.item_uses, ...(kind === "battles" ? [run.divine_pulses] : [])],
    records: AWARDS.map((a) => awards.totals[a.key]),
  };
  return { battles, characters, run, awards, rows, columns, totals, sums };
}

/** Search never changes totals. Missing observations sort last in either direction. */
export function selectLedgerRows(rows: LedgerRow[], part: LedgerPart, query: string, sort: LedgerSort | null): LedgerRow[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => words.every((word) => `${r.name} ${r.note}${r.live ? " Live" : ""}`.toLocaleLowerCase().includes(word)));
  if (!sort) return shown;
  return shown.sort((a, b) => {
    const av = sort.column < 0 ? a.name : a.values[part][sort.column];
    const bv = sort.column < 0 ? b.name : b.values[part][sort.column];
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    const order = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sort.direction === "ascending" ? order : -order;
  });
}
