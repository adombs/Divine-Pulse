import { canonical } from "../fuzzy.ts";
const STORY_CLASSES = new Set(["Enlightened One", "Armored Lord", "High Lord", "Emperor", "Great Lord", "Wyvern Master", "Barbarossa"]);
export const isStoryClass = (name: string) => STORY_CLASSES.has(name);
export interface NameMatch { start: number; end: number; name: string }
/** Game terms that contain a linkable name but aren't about it ("Hero's Relic" is not the Hero class). */
const NOT_LINKS = ["Hero's Relic", "Heroes' Relic"];
export function matchNames(text: string, names: string[]): NameMatch[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const result: NameMatch[] = [];
  const word = (s: string) => /[\p{L}\p{N}_]/u.test(s);
  for (let i = 0; i < text.length;) {
    const term = NOT_LINKS.find((t) => !sorted.includes(t) && text.slice(i, i + t.length).toLocaleLowerCase() === t.toLocaleLowerCase());
    if (term) { i += term.length; continue; }
    const name = sorted.find((n) => text.slice(i, i + n.length).toLocaleLowerCase() === n.toLocaleLowerCase() && (!i || !word(text[i - 1])) && (i + n.length === text.length || !word(text[i + n.length])));
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
