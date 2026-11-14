/**
 * The condensed labels a replay beat puts on the map: the core of its log entries, from their structured fields (never
 * their text), placed on the unit they are about. The arrow already says who acted on whom, so a label carries only the
 * action: an attack's damage, the art or spell used, HP restored, an item, a Rally or a gambit. No label for moves,
 * waits, phase starts or a unit falling (it disappears). The same entries make the condensed log (`condensedEntries`): the
 * newest actions as one line each in the map's corner (CondensedLog.tsx), which is what the replay shows. Pure.
 */
import type { Item } from "./model";

/** The kinds of log entry that have a label. */
const LABELLED = new Set(["attack", "heal", "item", "spell", "art", "rally", "gambit"]);

export type LabelTone = "attack" | "heal" | "plain";

export interface MapLabel {
  key: string;
  /** The unit it is drawn above (a piece id). */
  unit: string;
  /** The concept icon (model.ICON key: "attack", "heal", "art", "spell", "item", "rally", "gambit") for when the game has none. */
  kind: string;
  /** The game's own icon (an imported image path), if one is known. */
  game: string | null;
  /** The name of the art, spell, item, Rally or gambit. */
  name: string | null;
  /** The number: damage ("12", "12 · 12") or HP restored ("+21"). */
  value: string | null;
  tone: LabelTone;
  /** The unit that did it (its piece id): the label takes the colour of that unit's army. */
  by: string | null;
  /** That unit's army, filled in by the replay from the map (see useReplay). */
  side?: string;
  /** Where the unit stood before this step, for one no longer on the map after it (a target the action defeated). */
  at?: { x: number; y: number; span: number };
}

/** Where the game's icons for names are looked up (reference/icons.tsx); each null when unknown. */
export interface LabelIcons {
  art(name: string): string | null;
  spell(name: string): string | null;
  item(name: string): string | null;
  ability(name: string): string | null;
}

const usable = (item: Item) => !item.heading && !item.rehomed && LABELLED.has(item.kind) && (item.actor != null || item.target != null);

/** The beats that have a label to show (a Rally, a gambit... where nobody moves still needs its beat). */
export function actingBeats(items: Item[]): Set<number> {
  const out = new Set<number>();
  for (const item of items) if (item.beat != null && usable(item)) out.add(item.beat);
  return out;
}

const num = (n: number | null | undefined) => (n ?? 0) > 0;

/** The labels of a beat, from the chronicle's items (the order they were done in). */
export function beatLabels(items: Item[], beat: number, icons: LabelIcons): MapLabel[] {
  const mine = items.filter((item) => item.beat === beat && usable(item));
  const out: MapLabel[] = [];
  // A double attack is logged as a hit each: one label with every hit's damage.
  const fights: { first: Item; hits: Item[] }[] = [];
  for (const item of mine) {
    if (item.kind !== "attack") continue;
    const last = fights.find((f) => f.first.actor === item.actor && f.first.target === item.target && f.first.detail === item.detail);
    if (last) last.hits.push(item);
    else fights.push({ first: item, hits: [item] });
  }
  const done = new Set<Item>();
  mine.forEach((item, n) => {
    const key = `${beat}:${n}`;
    const on = item.target ?? item.actor!;
    const detail = item.detail || null;
    if (item.kind === "attack") {
      const fight = fights.find((f) => f.hits.includes(item));
      if (!fight || done.has(fight.first)) return;
      done.add(fight.first);
      const dealt = fight.hits.map((h) => h.dealt);
      const taken = fight.hits.map((h) => h.taken);
      const value = dealt.some((d) => d != null) ? dealt.map((d) => d ?? 0).join(" · ") : null;
      const game = detail ? (icons.art(detail) ?? icons.spell(detail) ?? icons.item(detail)) : null;
      if (value !== null || detail) out.push({ key, unit: on, kind: detail ? "art" : "attack", game, name: detail, value, tone: "attack", by: item.actor });
      if (taken.some(num) && item.actor) out.push({ key: `${key}:counter`, unit: item.actor, kind: "attack", game: null, name: null, value: taken.map((t) => t ?? 0).join(" · "), tone: "attack", by: item.target });
    } else if (item.kind === "heal") {
      const value = num(item.restored) ? `+${item.restored}` : null;
      const game = detail ? icons.spell(detail) : null;
      if (value !== null || detail) out.push({ key, unit: on, kind: "heal", game, name: value === null ? detail : null, value, tone: "heal", by: item.actor });
    } else if (item.kind === "item") {
      const value = num(item.restored) ? `+${item.restored}` : null;
      if (value !== null || detail) out.push({ key, unit: item.actor ?? on, kind: "item", game: detail ? icons.item(detail) : null, name: detail, value, tone: value ? "heal" : "plain", by: item.actor });
    } else if (item.kind === "art" || item.kind === "spell") {
      const dealt = num(item.dealt);
      const value = dealt ? String(item.dealt) : num(item.restored) ? `+${item.restored}` : null;
      const game = detail ? (item.kind === "art" ? (icons.art(detail) ?? icons.spell(detail)) : (icons.spell(detail) ?? icons.art(detail))) : null;
      if (value !== null || detail) out.push({ key, unit: on, kind: item.kind, game, name: detail, value, tone: dealt ? "attack" : value ? "heal" : "plain", by: item.actor });
    } else if (item.kind === "rally") {
      if (detail) out.push({ key, unit: on, kind: "rally", game: icons.ability(detail), name: detail, value: null, tone: "plain", by: item.actor });
    } else if (item.kind === "gambit") {
      const dealt = num(item.dealt);
      const value = dealt ? String(item.dealt) : num(item.restored) ? `+${item.restored}` : null;
      if (value !== null || detail) out.push({ key, unit: on, kind: "gambit", game: null, name: detail, value, tone: dealt ? "attack" : value ? "heal" : "plain", by: item.actor });
    }
  });
  return out;
}

/** How many rows the condensed log shows at most (the newest). */
export const CONDENSED_MAX = 4;

/** A row of the condensed log: who did what to whom, as one line. */
export interface CondensedEntry {
  key: string;
  /** The log row it comes from (a double attack: its first hit), for its actor, target, kind, art or spell, and icon. */
  item: Item;
  /** The beat it happened at (its last hit's, for a double attack). */
  beat: number;
  /** The number: damage ("12", "12 · 12") or HP restored ("+21"); null when there is none. */
  value: string | null;
  tone: LabelTone;
  /** Its target was defeated. */
  defeated: boolean;
}

/**
 * The condensed log at beat `at`: the newest `max` actions done up to it (attacks, heals, items, arts, spells, Rallies
 * and gambits, the same entries the labels are made from), oldest first. A double attack is one row with every hit's
 * damage; a row a Divine Pulse turned back is gone once the replay is at or past that use.
 */
export function condensedEntries(items: Item[], at: number, max = CONDENSED_MAX): CondensedEntry[] {
  const out: CondensedEntry[] = [];
  // The row before this one in the log: a double attack is two hits one after the other, with nothing between.
  let previous: Item | null = null;
  for (const item of items) {
    const before = previous;
    if (!item.heading) previous = item;
    if (item.heading || !LABELLED.has(item.kind) || (item.actor == null && item.target == null)) continue;
    if (item.beat == null || item.beat > at) continue;
    if (item.undoneAt != null && at >= item.undoneAt) continue;
    const last = out[out.length - 1];
    if (
      last && before?.kind === "attack" && before.beat === last.beat && item.kind === "attack" && last.item.kind === "attack" && item.actor === last.item.actor && item.target === last.item.target &&
      item.detail === last.item.detail && item.turn === last.item.turn && item.phase === last.item.phase
    ) {
      const hits = [...(last.item.hits ?? [{ dealt: last.item.dealt, taken: last.item.taken }]), { dealt: item.dealt, taken: item.taken }];
      last.item = { ...last.item, hits };
      last.beat = item.beat;
      last.defeated ||= !!item.defeated;
      last.value = hits.some((h) => h.dealt != null) ? hits.map((h) => h.dealt ?? 0).join(" · ") : null;
      continue;
    }
    const dealt = num(item.dealt);
    const restored = num(item.restored);
    const value = item.kind === "attack" ? (item.dealt != null ? String(item.dealt) : null)
      : item.kind === "rally" ? null
      : dealt ? String(item.dealt) : restored ? `+${item.restored}` : null;
    const tone: LabelTone = item.kind === "attack" || dealt ? "attack" : restored || item.kind === "heal" ? "heal" : "plain";
    out.push({ key: item.key, item, beat: item.beat, value, tone, defeated: !!item.defeated });
  }
  return out.slice(Math.max(0, out.length - max));
}

/** The words for an action in the condensed log: its art, spell, item, Rally or gambit by name, else what it was. */
export function actionName(item: Item): string {
  if (item.detail) return item.detail;
  return ({ attack: "Attack", heal: "Heal", item: "Item", spell: "Spell", art: "Combat Art", rally: "Rally", gambit: "Gambit" } as Record<string, string>)[item.kind] ?? "Action";
}
