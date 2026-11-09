import { canonical } from "../fuzzy.ts";
const STORY_CLASSES = new Set(["Enlightened One", "Armored Lord", "High Lord", "Emperor", "Great Lord", "Wyvern Master", "Barbarossa"]);
export const isStoryClass = (name: string) => STORY_CLASSES.has(name);
export interface NameMatch { start: number; end: number; name: string }
/** Game terms that contain a linkable name but aren't about it ("Hero's Relic" is not the Hero class). */
const NOT_LINKS = ["Hero's Relic", "Heroes' Relic"];
const isWord = (s: string) => /[\p{L}\p{N}_]/u.test(s);

/** The names by their first letter, longest first, lowercased once: looking at a position then tries a few names, not all of them. */
interface NameIndex { byFirst: Map<string, { name: string; lower: string }[]>; notLinks: { term: string; lower: string }[] }
const indexes = new WeakMap<string[], NameIndex>();
function indexOf(names: string[]): NameIndex {
  const known = indexes.get(names);
  if (known) return known;
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const byFirst = new Map<string, { name: string; lower: string }[]>();
  for (const name of sorted) {
    const lower = name.toLocaleLowerCase();
    const list = byFirst.get(lower[0]);
    if (list) list.push({ name, lower });
    else byFirst.set(lower[0], [{ name, lower }]);
  }
  const have = new Set(sorted);
  const index = { byFirst, notLinks: NOT_LINKS.filter((t) => !have.has(t)).map((term) => ({ term, lower: term.toLocaleLowerCase() })) };
  indexes.set(names, index);
  return index;
}

/** Where each of `names` appears in `text` as a whole word, the longest name first. Pass the same array again to reuse its index. */
export function matchNames(text: string, names: string[]): NameMatch[] {
  const lower = text.toLocaleLowerCase();
  // A lowercase form of a different length (rare letters) can't be compared in place; take the plain way.
  if (lower.length !== text.length) return matchNamesPlainly(text, names);
  const { byFirst, notLinks } = indexOf(names);
  const result: NameMatch[] = [];
  for (let i = 0; i < text.length;) {
    const term = notLinks.find((t) => lower.startsWith(t.lower, i));
    if (term) { i += term.term.length; continue; }
    const name = !i || !isWord(text[i - 1]) ? byFirst.get(lower[i])?.find((n) => lower.startsWith(n.lower, i) && (i + n.name.length === text.length || !isWord(text[i + n.name.length]))) : undefined;
    if (name) { result.push({ start: i, end: i + name.name.length, name: name.name }); i += name.name.length; } else i++;
  }
  return result;
}

function matchNamesPlainly(text: string, names: string[]): NameMatch[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const result: NameMatch[] = [];
  for (let i = 0; i < text.length;) {
    const term = NOT_LINKS.find((t) => !sorted.includes(t) && text.slice(i, i + t.length).toLocaleLowerCase() === t.toLocaleLowerCase());
    if (term) { i += term.length; continue; }
    const name = sorted.find((n) => text.slice(i, i + n.length).toLocaleLowerCase() === n.toLocaleLowerCase() && (!i || !isWord(text[i - 1])) && (i + n.length === text.length || !isWord(text[i + n.length])));
    if (name) { result.push({ start: i, end: i + name.length, name }); i += name.length; } else i++;
  }
  return result;
}

/** Text cut into plain pieces and pieces that name something in `names` (to show the named ones as links). */
export function nameParts(text: string, names: string[]): { text: string; name?: string }[] {
  const parts: { text: string; name?: string }[] = [];
  let end = 0;
  for (const m of matchNames(text, names)) {
    if (m.start > end) parts.push({ text: text.slice(end, m.start) });
    parts.push({ text: text.slice(m.start, m.end), name: m.name });
    end = m.end;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}

/** The battalion whose entry shows a gambit: the one the unit has when it has that gambit (several battalions can
 * share one), else the first that does. Null when no battalion has a gambit of that name. */
export function gambitOwner(battalions: { name: string; gambit?: { name: string } }[], gambit: string, preferred?: string | null): string | null {
  const have = battalions.filter((b) => b.gambit?.name);
  const known = canonical(gambit, have.map((b) => b.gambit!.name));
  if (!known) return null;
  const owners = have.filter((b) => b.gambit!.name === known);
  return (owners.find((b) => b.name === preferred) ?? owners[0]).name;
}
