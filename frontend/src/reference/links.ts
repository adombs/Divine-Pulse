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
