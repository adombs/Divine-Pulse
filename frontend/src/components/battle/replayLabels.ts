/**
 * The condensed labels a replay beat puts on the map: the core of its log entries, from their structured fields (never
 * their text), placed on the unit they are about. The arrow already says who acted on whom, so a label carries only the
 * action: an attack's damage, the art or spell used, HP restored, an item, a Rally or a gambit. No label for moves,
 * waits, phase starts or a unit falling (it disappears). Pure: Minimap.tsx draws them.
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
