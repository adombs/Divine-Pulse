/** Which game class ID each class name has, and the character each class is drawn as in the Archive. Shared by the
 * Archive's class sprites and the character views' map sprites (components/character). */
/**
 * The unit each class is shown as: the character the game and its players most associate with it, by Characters page
 * key, with the game's class ID for the body sprite (frontend/public/game/class-sprites.json). A class only one
 * character can be in (the lords' unique classes, Death Knight) uses that character. Where the atlas has no body for
 * the class — the lords' classes, the DLC fliers — the character's own finished sprite stands in; where the atlas has
 * no head for the character (the Ashen Wolves, Jeritza), the body gets a generic head of the right gender.
 */
export const EXCLUSIVE_CLASS_OWNERS: Record<string, string> = {
  "Enlightened One": "byleth",
  "Armored Lord": "edelgard",
  Emperor: "edelgard",
  "High Lord": "dimitri",
  "Great Lord": "dimitri",
  "Wyvern Master": "claude",
  Barbarossa: "claude",
  "Death Knight": "jeritza",
};

export const CLASS_UNIT: Record<string, { id: number; who: string }> = {
  // Exclusive classes keep their canonical owners and do not consume a character in the
  // rotation. Ordinary classes use every playable character once before beginning repeats.
  Noble: { id: 0, who: "edelgard" },
  Commoner: { id: 1, who: "byleth" },
  Dancer: { id: 43, who: "dorothea" }, // the songstress of the Black Eagles
  "Enlightened One": { id: 42, who: "byleth" },
  "Armored Lord": { id: 56, who: "edelgard" },
  "High Lord": { id: 57, who: "dimitri" },
  "Wyvern Master": { id: 58, who: "claude" },
  Emperor: { id: 40, who: "edelgard" },
  "Great Lord": { id: 44, who: "dimitri" },
  Barbarossa: { id: 17, who: "claude" },
  // Beginner
  Myrmidon: { id: 2, who: "felix" },
  Soldier: { id: 3, who: "ingrid" },
  Fighter: { id: 4, who: "anna" },
  Monk: { id: 5, who: "linhardt" },
  // Intermediate
  Lord: { id: 6, who: "dimitri" }, // one of the three house leaders eligible for the shared class
  Mercenary: { id: 7, who: "leonie" }, // Jeralt's apprentice mercenary
  Thief: { id: 8, who: "ashe" }, // a thief before House Gaspard took him in
  "Armored Knight": { id: 9, who: "dedue" },
  Cavalier: { id: 10, who: "ferdinand" },
  Brigand: { id: 11, who: "raphael" },
  Archer: { id: 12, who: "ignatz" },
  Brawler: { id: 13, who: "balthus" },
  Mage: { id: 14, who: "lysithea" },
  "Dark Mage": { id: 15, who: "hubert" },
  Priest: { id: 16, who: "mercedes" },
  "Pegasus Knight": { id: 23, who: "annette" },
  // Advanced
  Hero: { id: 18, who: "alois" },
  Swordmaster: { id: 19, who: "catherine" },
  Assassin: { id: 20, who: "petra" },
  "Fortress Knight": { id: 21, who: "gilbert" },
  Paladin: { id: 22, who: "sylvain" },
  "Wyvern Rider": { id: 24, who: "cyril" },
  Warrior: { id: 25, who: "hilda" },
  Sniper: { id: 26, who: "shamir" },
  Grappler: { id: 27, who: "caspar" },
  Warlock: { id: 28, who: "hanneman" },
  "Dark Bishop": { id: 29, who: "jeritza" },
  Bishop: { id: 30, who: "flayn" },
  // Master
  "Falcon Knight": { id: 31, who: "marianne" },
  "Wyvern Lord": { id: 32, who: "seteth" },
  "Mortal Savant": { id: 33, who: "manuela" },
  "Great Knight": { id: 34, who: "lorenz" },
  "Bow Knight": { id: 35, who: "claude" },
  "Dark Knight": { id: 36, who: "hapi" },
  "Holy Knight": { id: 37, who: "bernadetta" },
  "War Master": { id: 38, who: "jeralt" },
  Gremory: { id: 39, who: "constance" },
  // DLC (Cindered Shadows): the Ashen Wolves have no map head, so these fall back to a generic one.
  Trickster: { id: 84, who: "yuri" },
  "War Monk": { id: 85, who: "balthus" },
  "War Cleric": { id: 85, who: "mercedes" },
  "Dark Flier": { id: 86, who: "annette" },
  Valkyrie: { id: 87, who: "marianne" },
  "Death Knight": { id: 59, who: "jeritza" },
};

const CLASS_IDS = new Map(Object.entries(CLASS_UNIT).map(([name, pick]) => [name.toLowerCase(), pick.id]));

/** The game's class ID for a class name (as the roster or reference data spells it), or null when it isn't known. */
export function classIdOf(name: string | null | undefined): number | null {
  return name ? CLASS_IDS.get(name.trim().toLowerCase()) ?? null : null;
}
