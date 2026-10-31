/**
 * Fuzzy matching for names, classes and abilities: the same rules as the backend (backend/app/names.py), so a
 * suggestion shown while typing is what the server will store. Tolerates case, accents, punctuation, spacing,
 * Confusable characters (0/O, 1/l/I, rn/m) and small typos; numbers must agree ("Lv 2" never matches "Lv 3").
 */

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONFUSABLE: Record<string, string> = { "0": "o", "1": "l", i: "l", "|": "l", "5": "s", "8": "b" };

function shape(text: string): string {
  return normalize(text)
    .replace(/[01i|58]/g, (c) => CONFUSABLE[c])
    .replace(/rn/g, "m")
    .replace(/ /g, "");
}

/** Real numbers ("Lv 2", "+5"), not digits used in place of letters ("Hi1da", "B0w"). */
const numbers = (text: string) => (text.match(/\d+(?![a-z])/g) ?? []).join(",");

/** difflib-style ratio: 2 * matches / total length, from the longest common subsequence of characters. */
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}

/** 0..1 similarity between two names. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (numbers(na) !== numbers(nb)) return 0;
  const sa = shape(a);
  const sb = shape(b);
  if (sa === sb) return 0.97;
  return Math.max(ratio(na, nb), ratio(sa, sb) * 0.98);
}

export interface Match {
  value: string;
  score: number;
}

export function bestMatch(text: string, choices: Iterable<string>, threshold = 0.75): Match | null {
  let best: Match | null = null;
  for (const c of choices) {
    const score = similarity(text, c);
    if (!best || score > best.score) {
      best = { value: c, score };
      if (score >= 1) break;
    }
  }
  return best && best.score >= threshold ? best : null;
}

/** The canonical spelling of a known name, or null when nothing is close enough. */
export function canonical(text: string, choices: Iterable<string>, threshold = 0.75): string | null {
  return bestMatch(text, choices, threshold)?.value ?? null;
}

/**
 * Search: every word of the query must appear in one of the texts, either as part of a word ("pro" finds
 * "Prowess") or as a close match for a longer word ("lysithia" finds "Lysithea", "gremroy" finds "Gremory").
 */
export function searchMatches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(texts.filter(Boolean).join(" "));
  if (hay.includes(q)) return true;
  const words = hay.split(" ");
  return q.split(" ").every(
    (term) => hay.includes(term) || (term.length >= 4 && words.some((w) => Math.abs(w.length - term.length) <= 2 && similarity(term, w) >= 0.8)),
  );
}
