/** Native character allegiance, with conservative scenario fallback for anonymous reused templates. */
import { loadGameJson, loadGameText } from "../../gameAssets";
import { gameLanguage } from "../../gameLanguage";
import { factionBanners } from "../gameImageSources";

let CHARACTERS: Record<string, number> = {};
let FACTIONS: Record<string, string> = {};
let CRESTS: Record<string, { name: string; major: boolean }[]> = {};

const INDEPENDENTS = 15;
// The game has no name for this allegiance (Abyss residents in the DLC).
const UNDERGROUND_RESIDENTS = 23;
const BANNERS: Record<number, string> = { 0: "church-of-seiros", 1: "black-eagles", 2: "blue-lions", 3: "golden-deer", 4: "agarthans" };

export async function loadBattleIndexes(): Promise<void> {
  const [data, crestData, factions, major, minor] = await Promise.all([
    loadGameJson<{ characters: { id: number; allegiance: number }[]; factions: { id: number; name: string }[] }>("data/factions.json"),
    loadGameJson<{ characters: { id: number; crests: number[] }[]; crests: { id: number; name: string; major: boolean }[] }>("data/crests-by-person.json"),
    loadGameText("faction", gameLanguage()), loadGameText("crest_major", gameLanguage()), loadGameText("crest_minor", gameLanguage()),
  ]);
  CHARACTERS = Object.fromEntries((data?.characters ?? []).map((r) => [r.id, r.allegiance]));
  FACTIONS = Object.fromEntries((data?.factions ?? []).map((r) => [r.id, factions[String(r.id)] ?? r.name]));
  FACTIONS[UNDERGROUND_RESIDENTS] = "Underground Residents";
  factionBanners.clear();
  for (const [id, banner] of Object.entries(BANNERS)) if (FACTIONS[id]) factionBanners.set(FACTIONS[id], banner);
  const names = new Map((crestData?.crests ?? []).map((r) => [r.id, { name: (r.major ? major : minor)[String(r.id)] ?? r.name, major: r.major }]));
  CRESTS = Object.fromEntries((crestData?.characters ?? []).map((r) => [r.id, r.crests.map((id) => names.get(id)).filter((c): c is { name: string; major: boolean } => !!c).map((c) => ({ ...c, name: c.name.replace(/^crest of /i, "") }))]));
}
export function crestsOf(character: number | null | undefined) { return character == null ? undefined : CRESTS[String(character)]; }
// These scenarios have an unambiguous main enemy. Named/explicit native allegiances always win.
const ROGUES = 11, WESTERN_CHURCH = 6, AGARTHANS = 4;
const ENEMY: Record<number, number> = {
  0: ROGUES, 2: ROGUES, 4: WESTERN_CHURCH, 5: ROGUES, 6: WESTERN_CHURCH,
  10: AGARTHANS, 13: ROGUES, 26: AGARTHANS,
};

export function factionOf(character: number | null | undefined, scenario?: number | null, side = "enemy", house?: string | null): string {
  if (house) return house;
  const faction = character == null ? undefined : CHARACTERS[String(character)];
  const native = faction === undefined ? undefined : FACTIONS[String(faction)];
  // Independents is the default for anonymous templates, whose actual allegiance can be set by the scenario.
  const main = scenario != null ? FACTIONS[ENEMY[scenario]] : undefined;
  if ((!native || faction === INDEPENDENTS) && side === "enemy" && main) return main;
  return native ?? "Other";
}
