import { loadGameAssetsStatus, onGameAssetsChange } from "./gameAssets";
import { reportAssetIssue } from "./requiredAssets.ts";

export const languages = {
  JP: "日本語", ENG_E: "English (UK)", ENG_U: "English (US)", GER: "Deutsch",
  FRA_E: "Français (Europe)", FRA_U: "Français (Canada)", ESP_E: "Español (Europa)",
  ESP_U: "Español (América)", ITA: "Italiano", KOR: "한국어", TWN: "繁體中文", CHN: "简体中文",
} as const;
export type GameLanguage = keyof typeof languages;
const listeners = new Set<() => void>();
let current: GameLanguage = "ENG_U";
let available: GameLanguage[] = [];
const valid = (value: unknown): value is GameLanguage => typeof value === "string" && value in languages;
const notify = () => listeners.forEach((listener) => listener());
export const gameLanguage = () => current;
export const availableGameLanguages = () => available;
export const onGameLanguageChange = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const gameLanguageLocale = () => ({ JP: "ja", ENG_E: "en-GB", ENG_U: "en-US", GER: "de", FRA_E: "fr-FR", FRA_U: "fr-CA", ESP_E: "es-ES", ESP_U: "es-MX", ITA: "it", KOR: "ko", TWN: "zh-TW", CHN: "zh-CN" })[current];

export async function loadGameLanguage() {
  const previous = current;
  const previousAvailable = available.join(",");
  const [response, status] = await Promise.all([
    fetch("/api/settings").then((r) => r.ok ? r.json() : null).catch(() => null),
    loadGameAssetsStatus(),
  ]);
  available = (status.languages ?? []).filter(valid);
  const saved = response?.game_language;
  if (!response) {
    reportAssetIssue("settings/game_language", "unreadable");
    return;
  }
  // A first-run default is allowed. An explicit selection is never silently replaced by another language.
  if (valid(saved)) {
    current = saved;
    if (status.available && !available.includes(saved)) reportAssetIssue(`text/${saved}.json`, "missing");
  } else {
    current = available.includes("ENG_U") ? "ENG_U" : available[0] ?? "ENG_U";
    if (status.available && !available.length) reportAssetIssue("text/(no imported languages)", "missing");
  }
  if (current !== previous || available.join(",") !== previousAvailable) notify();
}

export async function setGameLanguage(language: GameLanguage) {
  if (!available.includes(language)) return;
  // Read the latest settings so other settings are not overwritten by a stale copy.
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Could not load settings");
  const settings: Record<string, unknown> = await response.json();
  const saved = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, game_language: language, active_run_id: undefined, port: undefined, last_dump: undefined, window: undefined }) });
  if (!saved.ok) throw new Error("Could not save game language");
  current = language;
  notify();
}

onGameAssetsChange(() => { void loadGameLanguage(); });
