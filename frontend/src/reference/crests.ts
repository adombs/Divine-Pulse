/** Imported crest names can include their own rank and repeat the mystery placeholder. */
export function isMysteryCrest(name: string): boolean {
  return /\bmystery\b/i.test(name);
}

export function crestName(name: string): string {
  return isMysteryCrest(name) ? "Mystery Crest" : name.replace(/^(?:(?:Major|Minor) )?Crest of /i, "");
}

export function crestLabel(name: string, major: boolean): string {
  return isMysteryCrest(name) ? "Mystery Crest" : `${crestName(name)} (${major ? "Major" : "Minor"})`;
}
