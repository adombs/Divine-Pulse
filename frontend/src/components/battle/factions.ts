/** The game's own faction names, and the faction a battle record is tied to. */
import { loadGameJson, loadGameText } from "../../gameAssets";
import { gameLanguage } from "../../gameLanguage";
import { crestName } from "../../reference/crests";
import { factionBanners } from "../gameImageSources";
import { indexCrystalWeapons } from "./unitAppearance";

let CHARACTERS: Record<string, number> = {};
let FACTIONS: Record<string, string> = {};
let CRESTS: Record<string, { name: string; major: boolean }[]> = {};

// The game has no name for this allegiance (Abyss residents in the DLC).
const UNDERGROUND_RESIDENTS = 23;
const BANNERS: Record<number, string> = { 0: "church-of-seiros", 1: "black-eagles", 2: "blue-lions", 3: "golden-deer", 4: "agarthans" };

export async function loadBattleIndexes(): Promise<void> {
  const [data, crestData, factions, major, minor, weapons] = await Promise.all([
    loadGameJson<{ characters: { id: number; allegiance: number }[]; factions: { id: number; name: string }[] }>("data/factions.json"),
    loadGameJson<{ characters: { id: number; crests: number[] }[]; crests: { id: number; name: string; major: boolean }[] }>("data/crests-by-person.json"),
    loadGameText("faction", gameLanguage()), loadGameText("crest_major", gameLanguage()), loadGameText("crest_minor", gameLanguage()),
    loadGameJson<{ weapons: { id: number; raw?: string }[] }>("data/weapons.json"),
  ]);
  indexCrystalWeapons(weapons?.weapons ?? []);
  CHARACTERS = Object.fromEntries((data?.characters ?? []).map((r) => [r.id, r.allegiance]));
  FACTIONS = Object.fromEntries((data?.factions ?? []).map((r) => [r.id, factions[String(r.id)] ?? r.name]));
  FACTIONS[UNDERGROUND_RESIDENTS] = "Underground Residents";
  factionBanners.clear();
  for (const [id, banner] of Object.entries(BANNERS)) if (FACTIONS[id]) factionBanners.set(FACTIONS[id], banner);
  const names = new Map((crestData?.crests ?? []).map((r) => [r.id, { name: (r.major ? major : minor)[String(r.id)] ?? r.name, major: r.major }]));
  CRESTS = Object.fromEntries((crestData?.characters ?? []).map((r) => [r.id, r.crests.map((id) => names.get(id)).filter((c): c is { name: string; major: boolean } => !!c).map((c) => ({ ...c, name: crestName(c.name) }))]));
}
export function crestsOf(character: number | null | undefined) { return character == null ? undefined : CRESTS[String(character)]; }
/** The affiliation the game's battle record names now: its faction ID's name, as the game's text has it. Read from the
 * record each time it's polled, so a reveal that changes a unit's allegiance shows at once. Without the record's value
 * (a battle saved before it was kept), the character's own allegiance in the game's data; none for a unit without either. */
export function factionOf(allegiance: number | null | undefined, character?: number | null): string | undefined {
  const id = allegiance ?? (character == null ? undefined : CHARACTERS[String(character)]);
  return id === undefined ? undefined : FACTIONS[String(id)];
}
