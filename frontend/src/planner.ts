/**
 * The Roster's Planner, without React: what can be linked from a unit's notes (every Archive entry), how a link is
 * written in the saved text (@[label](kind:id)), where it opens, and the plan's skill-rank arithmetic.
 */
import type { Route } from "./routes";
import { EXCLUSIVE_CLASS_OWNERS } from "./reference/classSprites.ts";
import { WEAPON_RANKS } from "./reference/weaponRanks.ts";

export type LinkKind = "unit" | "class" | "art" | "ability" | "spell" | "weapon" | "item" | "battalion" | "crest";
export const LINK_KINDS: readonly LinkKind[] = ["unit", "class", "art", "ability", "spell", "weapon", "item", "battalion", "crest"];
export const KIND_LABEL: Record<LinkKind, string> = {
  unit: "Unit", class: "Class", art: "Combat art", ability: "Ability", spell: "Spell", weapon: "Weapon", item: "Item", battalion: "Battalion", crest: "Crest",
};

/** One linkable Archive entry. `icon` is the game-asset path of its in-game icon, null for none (units never get one). */
export interface ArchiveEntry {
  kind: LinkKind;
  id: string;
  label: string;
  icon: string | null;
}

export interface NoteLink { kind: LinkKind; id: string; label: string }
export type NotePart = { text: string } | { link: NoteLink };

const TOKEN = /@\[([^\]\n]{1,120})\]\(([a-z]+):([^)\n]{1,120})\)/g;
const clean = (s: string, banned: RegExp) => s.replace(banned, " ").replace(/\s+/g, " ").trim();

/** A link as the saved notes write it. */
export function linkToken(link: NoteLink): string {
  return `@[${clean(link.label, /[\]\n]/g) || link.id}](${link.kind}:${clean(link.id, /[)\n]/g)})`;
}

/** Saved notes cut into plain text and links. A token of an unknown kind stays text. */
export function parseNotes(text: string): NotePart[] {
  const parts: NotePart[] = [];
  let end = 0;
  for (const m of text.matchAll(TOKEN)) {
    const kind = m[2] as LinkKind;
    if (!LINK_KINDS.includes(kind)) continue;
    if (m.index! > end) parts.push({ text: text.slice(end, m.index) });
    parts.push({ link: { kind, id: m[3], label: m[1] } });
    end = m.index! + m[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}

/** Notes parts back into the saved text. */
export const serializeNotes = (parts: NotePart[]) => parts.map((p) => ("link" in p ? linkToken(p.link) : p.text)).join("");

/** The page a link opens: its entry in the Archive. */
export function linkRoute(link: Pick<NoteLink, "kind" | "id">): Route {
  const { kind, id } = link;
  switch (kind) {
    case "unit": return { page: "archive", tab: "characters", id };
    case "class": return { page: "archive", tab: "classes", id };
    case "battalion": return { page: "archive", tab: "battalions", id };
    case "crest": return { page: "archive", tab: "crests", id };
    case "art": return { page: "archive", tab: "arts", q: id };
    case "ability": return { page: "archive", tab: "abilities", q: id };
    case "spell": return { page: "archive", tab: "magic", q: id };
    case "weapon": return { page: "archive", tab: "weapons", q: id };
    case "item": return { page: "archive", tab: "items", q: id };
  }
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'").toLowerCase();

/**
 * The entries matching what was typed after @, best first: a name that starts with it, then one with a word that
 * does, then one that contains it. A first word that names a kind ("item", "class") narrows to that kind:
 * "@class sword" finds Swordmaster. Units come first among equals, as they're linked most.
 */
export function searchEntries(entries: readonly ArchiveEntry[], typed: string, limit = 8): ArchiveEntry[] {
  let query = fold(typed.trim());
  let only: LinkKind | null = null;
  const [first, ...rest] = query.split(/\s+/);
  const named = LINK_KINDS.find((k) => k === first || fold(KIND_LABEL[k]) === first || (k === "art" && first === "arts"));
  if (named && (rest.length || query.endsWith(" ") || typed.endsWith(" "))) {
    only = named;
    query = rest.join(" ");
  }
  const scored: [number, number, ArchiveEntry][] = [];
  entries.forEach((e, i) => {
    if (only && e.kind !== only) return;
    const name = fold(e.label);
    const score = !query ? 0 : name.startsWith(query) ? 0 : name.split(/[\s-]+/).some((w) => w.startsWith(query)) ? 1 : name.includes(query) ? 2 : -1;
    if (score >= 0) scored.push([score * 10 + (e.kind === "unit" ? 0 : 1), i, e]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((s) => s[2]);
}

/** The @ being typed before the caret in `before` (the text of the line so far): its query, or null when none. */
export function mentionQuery(before: string): string | null {
  const m = /(^|\s)@([^\s@][^@\n]{0,30}|)$/.exec(before);
  if (!m) return null;
  // Two spaces in a row, or a sentence carrying on, ends the link.
  if (/\s\s/.test(m[2]) || m[2].split(/\s+/).length > 4) return null;
  return m[2];
}

export const rankIndex = (rank: string | undefined | null) => (rank ? WEAPON_RANKS.indexOf(rank as (typeof WEAPON_RANKS)[number]) : -1);

/** Whether a current rank reaches a target rank. */
export const reaches = (current: string | undefined | null, target: string) => rankIndex(current) >= rankIndex(target);

/**
 * Each skill's target raised to what the classes need (a class that needs only one of several skills is left out:
 * which to train is the player's call). Targets already higher stay.
 */
export function targetsForClasses<K extends string>(
  targets: Partial<Record<K, string>>,
  classes: readonly { requirements: { skill: K; rank: string }[]; requirement_any: boolean }[],
): Partial<Record<K, string>> {
  const out = { ...targets };
  for (const c of classes) {
    if (c.requirement_any) continue;
    for (const r of c.requirements) if (rankIndex(r.rank) > rankIndex(out[r.skill])) out[r.skill] = r.rank;
  }
  return out;
}

const LORDS = new Set(["edelgard", "dimitri", "claude"]);
const STUDENT_HOUSES = new Set(["Black Eagles", "Blue Lions", "Golden Deer", "Ashen Wolves"]);

/** Who is being planned for, as far as it's known. */
export interface ClassCandidate {
  /** Characters page key; null for a unit no character is known for. */
  key: string | null;
  /** "Male" or "Female"; "" when not known (Byleth before joining). */
  gender: string;
  house?: string;
  startClass?: string;
  /** Classes it is in or has mastered: those it can take, whatever the rules say. */
  has?: readonly string[];
}

/**
 * Whether a unit could ever take a class: one for the other gender, another character's own, the lords' Lord, the
 * students' Dancer and the other of Noble and Commoner are out. Skill ranks, level and earlier certifications don't
 * count, as those can be worked towards. What isn't known rules nothing out.
 */
export function canTakeClass(who: ClassCandidate, c: { name: string; gender: string | null }): boolean {
  if (who.has?.includes(c.name)) return true;
  if (c.gender && who.gender && c.gender !== who.gender) return false;
  const owner = EXCLUSIVE_CLASS_OWNERS[c.name];
  if (owner) return !who.key || who.key === owner;
  switch (c.name) {
    case "Lord": return !who.key || LORDS.has(who.key);
    case "Dancer": return !who.house || STUDENT_HOUSES.has(who.house);
    case "Noble": return who.startClass !== "Commoner";
    case "Commoner": return who.startClass !== "Noble";
    default: return true;
  }
}
