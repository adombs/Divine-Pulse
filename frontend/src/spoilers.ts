/** Browser-wide spoiler choices: every category starts hidden, and every reveal is remembered. */
import { useSyncExternalStore } from "react";

export const SPOILER_CATEGORIES = {
  crests: { label: "Hidden crests", hint: "Crests revealed later in the story, including unit cards." },
  recruitment: { label: "Recruitment and route conditions", hint: "Story choices that affect who joins or leaves." },
  portraits: { label: "Post-timeskip portraits", hint: "Later appearances, subject to the Portraits choice in Appearance." },
  identities: { label: "Hidden identities", hint: "The characters behind masked appearances." },
  storyClasses: { label: "Story classes", hint: "Classes revealed through the story." },
  supports: { label: "Support conditions and endings", hint: "Route and chapter conditions, and potential paired endings." },
} as const;
export type SpoilerCategory = keyof typeof SPOILER_CATEGORIES;
export type SpoilerPreferences = Record<SpoilerCategory, boolean>;
const KEY = "divine-pulse-spoilers";
const HIDDEN: SpoilerPreferences = { crests: false, recruitment: false, portraits: false, identities: false, storyClasses: false, supports: false };

function read(): SpoilerPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") {
      return Object.fromEntries(Object.keys(HIDDEN).map((key) => [key, (saved as Record<string, unknown>)[key] === true])) as SpoilerPreferences;
    }
  } catch { /* Storage may be unavailable; keep this session's choices. */ }
  return { ...HIDDEN };
}
let preferences = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key === KEY || event.key === null) {
    preferences = read();
    emit();
  }
};
export function subscribeSpoilers(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
const snapshot = () => preferences;

export function spoilerShown(category: SpoilerCategory): boolean { return preferences[category]; }
export function setSpoiler(category: SpoilerCategory, shown: boolean): void {
  preferences = { ...preferences, [category]: shown };
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Keep the choice in memory. */ }
  emit();
}
export function setAllSpoilers(shown: boolean): void {
  preferences = Object.fromEntries(Object.keys(HIDDEN).map((key) => [key, shown])) as SpoilerPreferences;
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Keep the choices in memory. */ }
  emit();
}
export function useSpoilers() {
  return { preferences: useSyncExternalStore(subscribeSpoilers, snapshot, () => HIDDEN), setSpoiler };
}
export function useSpoiler(category: SpoilerCategory): [boolean, (shown: boolean) => void] {
  const { preferences } = useSpoilers();
  return [preferences[category], (shown) => setSpoiler(category, shown)];
}
