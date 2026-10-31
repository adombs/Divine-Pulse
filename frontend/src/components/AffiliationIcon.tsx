import { Icon } from "./Icon";
import { CONCEPT_ICON } from "../icons/concepts";
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

/** Known factions without a dedicated identified emblem use a native army pennant, never an unrelated house. */
export function affiliationBanner(house?: string | null, side: AffiliationSide = "enemy"): string {
  if (!house || house === "Other") return BANNER.Other;
  return factionBanners.get(house) ?? BANNER[house] ?? `army-${side === "object" ? "enemy" : side}`;
}

export function AffiliationIcon({ house, side, bare = false }: { house?: string | null; side?: AffiliationSide; bare?: boolean }) {
  const [showCrests] = useSpoiler("crests");
  const src = bundledHouse(affiliationBanner(house === "Professor" && !showCrests ? "Other" : house, side));
  const imported = src;
  if (bare) return <GameImage className="affiliation-icon" imported={imported} alt={house || "Other"} title={house || "Other"} draggable={false} fallback={<Icon name={CONCEPT_ICON.affiliation} className="affiliation-icon" title={house || "Other"} />} />;
  return (
    <span className="crest house" role="img" aria-label={house || "Other"} title={house || undefined}>
      <GameImage imported={imported} alt="" draggable={false} fallback={<Icon name={CONCEPT_ICON.affiliation} />} />
    </span>
  );
}

/** The banner icon for the unit with this Characters page key (see characterKeyOfUnit); undefined keeps the crest. */
export function useAffiliationIcon(charKey: string | null | undefined): ReactNode {
  const ref = useReference();
  const house = houseOfCharacter(ref, charKey);
  return house ? <AffiliationIcon house={house} /> : undefined;
}
