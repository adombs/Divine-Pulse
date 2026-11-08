import type { ReactNode } from "react";
import { type ReferenceData, useReference } from "../reference/types";
import { useSpoiler } from "../spoilers";
import { GameImage } from "./GameImage";
import { bundledHouse, factionBanners } from "./gameImageSources";

/** Reference houses plus the native allegiance values read from fixed_persondata. */
export type Affiliation = "Black Eagles" | "Blue Lions" | "Golden Deer" | "Church of Seiros" | "Knights of Seiros" | "Ashen Wolves" | "Professor" | "Other" | "Adrestian Empire" | "Holy Kingdom of Faerghus" | "Leicester Alliance" | "Agarthans" | "Almyra" | "Western Church" | "Resistance Army" | "Flame Emperor Army" | "Rogues" | "Rebel Army" | "Citizens" | "Children of the Goddess" | "Giant Beasts" | "Independents" | "Mercenaries" | "Liberation Army" | "Pirates" | "Faerghus Dukedom" | "Old Faerghus Territories" | "Underground Residents";

/** The game's own banner of each affiliation; Professor and Other have no house, so they get Byleth's flame crest and a neutral shield. */
const BANNER: Record<string, string> = {
  "Adrestian Empire": "black-eagles",
  "Holy Kingdom of Faerghus": "blue-lions",
  Kingdom: "blue-lions",
  "Leicester Alliance": "golden-deer",
  Alliance: "golden-deer",
  Agarthans: "agarthans",
  "Those Who Slither in the Dark": "agarthans",
  "Black Eagles": "black-eagles",
  "Blue Lions": "blue-lions",
  "Golden Deer": "golden-deer",
  "Church of Seiros": "church-of-seiros",
  "Knights of Seiros": "knights-of-seiros",
  "Ashen Wolves": "ashen-wolves",
  Professor: "professor",
  Other: "other",
};

/** Characters the reference data may lack; the reference wins where it has them. */
const KNOWN_HOUSE: Record<string, Affiliation> = { jeralt: "Knights of Seiros" };

/** The affiliation of a character by its Characters page key, from the reference data. */
export function houseOfCharacter(ref: ReferenceData | null | undefined, key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return ref?.characters.find((c) => c.key === key)?.house ?? KNOWN_HOUSE[key];
}

/** The game's banner for a unit's affiliation; an unknown one falls back to the neutral shield. */
export type AffiliationSide = "player" | "enemy" | "ally" | "third" | "object";

/** The game's army pennant of each side, for a unit whose own affiliation is unknown. */
const ARMY_BANNER: Partial<Record<AffiliationSide, string>> = {
  player: "army-player",
  enemy: "army-enemy",
  ally: "army-ally",
  third: "army-third",
};

/** The banner for an affiliation. With no known affiliation, a unit whose army is given gets that army's pennant
 * (the army is always known in battle); without an army there is no banner. */
export function affiliationBanner(house?: string | null, side?: AffiliationSide): string | null {
  const own = house ? factionBanners.get(house) ?? BANNER[house] : undefined;
  // The neutral "Other" shield is no answer for a unit on the map: its army's pennant fits better.
  const army = side ? ARMY_BANNER[side] ?? null : null;
  return own === "other" && army ? army : own ?? army;
}

const ARMY_NAME: Partial<Record<AffiliationSide, string>> = { player: "Your army", enemy: "Enemy army", ally: "Allied army", third: "Third army" };

export function AffiliationIcon({ house, side, bare = false }: { house?: string | null; side?: AffiliationSide; bare?: boolean }) {
  const [showCrests] = useSpoiler("crests");
  const banner = affiliationBanner(house === "Professor" && !showCrests ? "Other" : house, side);
  const imported = banner ? bundledHouse(banner) : null;
  const name = house || (side && side !== "object" ? ARMY_NAME[side] : undefined);
  if (bare) return <GameImage className="affiliation-icon" imported={imported} alt={name || "Affiliation"} title={name || "Other"} draggable={false} />;
  return (
    <span className="crest house" role="img" aria-label={name || "Other"} title={name || undefined}>
      <GameImage imported={imported} alt={name || "Affiliation"} draggable={false} />
    </span>
  );
}

/** The banner icon for the unit with this Characters page key (see characterKeyOfUnit); undefined keeps the crest. */
export function useAffiliationIcon(charKey: string | null | undefined): ReactNode {
  const ref = useReference();
  const house = houseOfCharacter(ref, charKey);
  return house ? <AffiliationIcon house={house} /> : undefined;
}
