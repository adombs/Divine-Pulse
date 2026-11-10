/**
 * Unit headshots, imported from the player's own game files (data/portraits.json; see gameAssets.ts).
 * `<key>.png` is the Part I (academy) portrait, `<key>_2.png` the Part II (after the timeskip)
 * one, where the character has one.
 */
import type { Unit } from "./api";
import { spoilerShown } from "./spoilers";
import { canonical } from "./fuzzy";
import { loadGameJson, loadGameText } from "./gameAssets";
import { gameLanguage } from "./gameLanguage";
import { objectIcon, OBJECT_NAMES } from "./components/battle/mapIcons";
import { bundledPortrait } from "./components/gameImageSources";

export type PortraitPhase = "auto" | "part1" | "part2";

/** House leaders change into these classes at the start of Part II (and later). */
const TIMESKIP_CLASSES: Record<string, string[]> = {
  edelgard: ["armored lord", "emperor"],
  dimitri: ["high lord", "great lord"],
  claude: ["wyvern master", "barbarossa"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L} ]/gu, "").trim();

// ---- Portrait keys, from the manifest: every character (named, NPC, DLC) and every extra look (Seiros, child…) ----
interface Looks {
  part1: string;
  part2?: string;
}

/** key ("rhea", "byleth_f", "seiros", "dimitri_child") -> files. */
const LOOKS = new Map<string, Looks>();
/** Normalised character name ("lord arundel", "rhea", "death knight") -> key. */
const NAME_KEY = new Map<string, string>();
let NAMED: string[] = [];
const CHARACTER_IDS = new Map<string, number>();

interface ImportedPortraits {
  app_keys?: Record<string, string>;
  characters?: Record<string, { name?: string; part1?: string; part2?: string }>;
  generic?: { class: number; class_name?: string; gender: number; files: string[] }[];
  persons?: Record<string, { name?: string; face?: string | null }>;
}

const CHARACTER_KEYS: Record<number, string> = { 58: "rhea", 70: "dimitri", 71: "edelgard", 85: "pallard", 86: "gilbert", 99: "edelgard", 1045: "jeritza", 1046: "anna" };
const FIRST_CHILD = { child: "edelgard_child.png", hegemon: "hegemon_edelgard.png" };
const SECOND_CHILD = { child: "dimitri_child.png" };
const VARIANTS: Record<number, Record<string, string>> = {
  2: FIRST_CHILD, 3: SECOND_CHILD,
  36: { seiros: "seiros.png" }, 39: { tomas: "tomas.png" }, 55: { solon: "solon.png" },
  58: { seiros: "seiros.png" }, 70: SECOND_CHILD, 71: FIRST_CHILD, 99: FIRST_CHILD,
};
const CLASS_ALIASES: Record<number, number> = {
  6: 10, 17: 25, 41: 34, 42: 29, 44: 22, 45: 22, 46: 30, 49: 8, 50: 11, 51: 22,
  52: 21, 53: 10, 54: 23, 55: 30, 56: 9, 57: 22, 58: 32, 81: 66, 82: 79, 83: 67,
  85: 84, 87: 86, 88: 0, 89: 63, 92: 68,
};
const CLASS_KEYS: Record<number, string> = { 40: "edelgard_2", 47: "flame_emperor", 48: "flame_emperor", 59: "death_knight", 91: "death_knight" };
const numbered = (stem: string, count: number) => Array.from({ length: count }, (_, n) => `generic/${stem}_${String(n + 1).padStart(2, "0")}`);
const CLASS_EXTRA: Record<number, { male?: string[]; female?: string[] }> = {
  0: { male: ["generic/commoner"] }, 2: { female: numbered("myrmidon_f", 3) },
  3: { male: numbered("soldier", 7) }, 4: { male: numbered("fighter", 8) }, 7: { male: numbered("mercenary", 8) },
  39: { male: ["generic/gremory_03"] }, 43: { male: ["generic/dancer"] },
  72: { male: ["immaculate_one_2", "immaculate_one_3"] }, 73: { male: ["immaculate_one", "immaculate_one_3"] },
  74: { male: ["immaculate_one", "immaculate_one_2"] }, 75: { male: numbered("hero", 4) }, 76: { male: numbered("hero", 4) },
};
const PERSON_KEYS: Record<number, string[]> = {
  0: ["byleth_m"], 155: ["generic/commoner"], 156: numbered("bishop", 3),
  212: ["immaculate_one", "immaculate_one_2", "immaculate_one_3"], 215: ["wind_caller"], 216: ["immovable"],
};

export async function loadPortraitIndex(): Promise<void> {
  const [data, rows, names, otherNames] = await Promise.all([
    loadGameJson<ImportedPortraits>("data/portraits.json"),
    loadGameJson<{ characters?: { id: number; name_id?: number; name?: string }[] }>("data/characters.json"),
    loadGameText("character_given", gameLanguage()),
    loadGameText("npc_and_generic_names", gameLanguage()),
  ]);
  LOOKS.clear(); NAME_KEY.clear(); CHARACTER_IDS.clear();
  for (const key of Object.keys(CHARACTERS)) delete CHARACTERS[key];
  for (const key of Object.keys(GENERIC)) delete GENERIC[key];
  for (const key of Object.keys(NAMES)) delete NAMES[key];
  for (const [key, path] of Object.entries(data?.app_keys ?? {})) {
    LOOKS.set(key, { part1: `${key}.png`, part2: data?.app_keys?.[`${key}_2`] ? `${key}_2.png` : undefined });
    NAME_KEY.set(norm(key.replace(/_/g, " ")), key);
    for (const [id, c] of Object.entries(data?.characters ?? {})) {
      if (c.part1 !== path) continue;
      const n = Number(id);
      if (!CHARACTER_IDS.has(key) || n < CHARACTER_IDS.get(key)!) CHARACTER_IDS.set(key, n);
      CHARACTERS[id] = { key, name: c.name ?? "", part1: `${key}.png`, part2: data?.app_keys?.[`${key}_2`] ? `${key}_2.png` : undefined };
    }
  }
  for (const [id, key] of Object.entries(CHARACTER_KEYS)) {
    if (!data?.app_keys?.[key]) continue;
    CHARACTERS[id] = { key, name: data.characters?.[id]?.name ?? "", part1: `${key}.png`, part2: data.app_keys[`${key}_2`] ? `${key}_2.png` : undefined };
    const n = Number(id);
    if (!CHARACTER_IDS.has(key) || n < CHARACTER_IDS.get(key)!) CHARACTER_IDS.set(key, n);
  }
  for (const [id, variants] of Object.entries(VARIANTS)) if (CHARACTERS[id]) CHARACTERS[id].variants = variants;
  for (const row of rows?.characters ?? []) {
    const entry = CHARACTERS[String(row.id)];
    const name = names[String(row.id)] ?? otherNames[String(row.id)] ?? row.name;
    if (entry && name && !entry.key.startsWith("byleth")) NAME_KEY.set(norm(name), entry.key);
  }
  for (const row of data?.generic ?? []) {
    const entry = GENERIC[String(row.class)] ??= { name: row.class_name, male: [], female: [] };
    (row.gender === 1 ? entry.female : entry.male).push(...row.files);
  }
  for (const [id, source] of Object.entries(CLASS_ALIASES)) if (GENERIC[String(source)]) GENERIC[id] = GENERIC[String(source)];
  for (const [id, extra] of Object.entries(CLASS_EXTRA)) {
    const entry = GENERIC[id] ??= { male: [], female: [] };
    for (const gender of ["male", "female"] as const) for (const key of extra[gender] ?? []) {
      const path = data?.app_keys?.[key];
      if (path && !entry[gender].includes(path)) entry[gender].push(path);
    }
  }
  for (const [id, key] of Object.entries(CLASS_KEYS)) {
    const path = data?.app_keys?.[key];
    if (path) GENERIC[id] = { male: [path], female: [] };
  }
  for (const [id, person] of Object.entries(data?.persons ?? {})) {
    if (!person.name || !person.face || CHARACTERS[id]) continue;
    const name = otherNames[id] ?? names[id] ?? person.name;
    NAMES[nameSlug(name)] = { own: true, male: [person.face], female: [person.face] };
  }
  for (const [id, keys] of Object.entries(PERSON_KEYS)) {
    const name = names[id] ?? otherNames[id] ?? data?.persons?.[id]?.name;
    const paths = keys.map((key) => data?.app_keys?.[key]).filter((path): path is string => !!path);
    if (name && paths.length) NAMES[nameSlug(name)] = { own: true, male: paths, female: paths };
  }
  CLASS_BY_NAME.clear();
  for (const g of Object.values(GENERIC)) CLASS_BY_NAME.set(norm(g.name ?? ""), g);
  NAMED = [...LOOKS.keys()].filter((k) => !k.includes("_") && !k.startsWith("byleth"));
}

export function portraitCharacterId(key: string): number | null { return CHARACTER_IDS.get(key) ?? null; }

/** True once a house leader in this run has their post-timeskip class. */
export function isPostTimeskip(units: Unit[]): boolean {
  return units.some((u) => (TIMESKIP_CLASSES[norm(u.name)] ?? []).includes(norm(u.class_name ?? "")));
}

/** Byleth can be renamed, so also recognise them by their unique personal ability. */
export function isByleth(u: Unit): boolean {
  return norm(u.name) === "byleth" || norm(u.personal_ability).replace(/ /g, "").startsWith("professor");
}


export function portraitKey(u: Unit): string | null {
  if (isByleth(u)) {
    const female = u.gender === "Female";
    return female ? "byleth_f" : "byleth_m";
  }
  return characterKeyOfName(u.name);
}

/** The portrait key of a character by name ("Edelgard", "Jeralt"), a misspelt one included; null for anyone else. */
export function characterKeyOfName(name: string): string | null {
  const full = norm(name);
  const exact = NAME_KEY.get(full) ?? NAME_KEY.get(full.split(" ")[0]);
  if (exact) return exact;
  // A misspelt name typed by hand ("Lysithia") still finds its portrait.
  return canonical(name, NAMED, 0.8);
}

/** Characters page key ("byleth", "edelgard") for a tracked unit, if it's a known character. */
export function characterKeyOfUnit(u: Unit): string | null {
  const k = portraitKey(u);
  return k ? (k.startsWith("byleth") ? "byleth" : k) : null;
}

/** Characters page keys of everyone in the active run. */
export function runCharacterKeys(units: Unit[]): Set<string> {
  return new Set(units.map(characterKeyOfUnit).filter((k): k is string => !!k));
}

/** Characters page keys of the active run's dead units. */
export function deadCharacterKeys(units: Unit[]): Set<string> {
  return new Set(units.filter((u) => u.death).map(characterKeyOfUnit).filter((k): k is string => !!k));
}

/** The tracked unit for a Characters page key, if the active run has one. */
export function unitForCharacter(key: string, units: Unit[]): Unit | undefined {
  return units.find((u) => characterKeyOfUnit(u) === key);
}

/** Portrait for a Characters page key: Byleth follows the run's Byleth (male by default). */
export function characterPortraitKey(key: string, units: Unit[] = []): string {
  if (key !== "byleth") return key;
  const u = unitForCharacter("byleth", units);
  if (u?.look) runBylethGreen = u.look === "green";
  return (u && portraitKey(u)) || "byleth_m";
}

/** Byleth's hair in the run as last read from the game, for the pages that draw them by portrait key. The game has two
 * faces for Byleth: dark hair, and green hair from the Sothis merge on (Part II too), which is the `_2` file. */
let runBylethGreen = false;

export function portraitUrl(u: Unit, part2: boolean, automatic = true): string | null {
  const key = portraitKey(u);
  const green = isByleth(u) && u.look ? u.look === "green" : undefined;
  return key ? portraitUrlForKey(key, part2, green, automatic) : null;
}

/** By portrait key ("edelgard", "byleth_f", …), for the reference pages. `green`: Byleth's green hair as the game has
 * it (not a spoiler: it's what the player's game shows), else the run's Byleth look, else the Part II setting. */
export function portraitUrlForKey(key: string, part2: boolean, green?: boolean, automatic = true): string | null {
  const looks = LOOKS.get(key);
  if (!looks) return null;
  if (automatic && key.startsWith("byleth") && (green !== undefined || runBylethGreen)) return bundledPortrait((green ?? runBylethGreen) && looks.part2 ? looks.part2 : looks.part1);
  return bundledPortrait(part2 && spoilerShown("portraits") && looks.part2 ? looks.part2 : looks.part1);
}

export function showPart2(phase: PortraitPhase, units: Unit[]): boolean {
  return spoilerShown("portraits") && (phase === "part2" || (phase === "auto" && isPostTimeskip(units)));
}

// ---- Any unit in a battle, by the game's own IDs ----

interface ManifestCharacter {
  name: string;
  key: string;
  part1: string;
  part2?: string;
  variants?: Record<string, string>;
}
interface ManifestGeneric {
  name?: string;
  male: string[];
  female: string[];
}
const CHARACTERS: Record<string, ManifestCharacter> = {};
const GENERIC: Record<string, ManifestGeneric> = {};
/** Every unit name that can appear in a battle ("rampaging villager", "titanus"), by normalised name. `own`: art made
 * for that unit, used ahead of its class; otherwise a generic face picked for the name, the last resort after the class. */
const NAMES: Record<string, ManifestGeneric & { own: boolean }> = {};
const nameSlug = (s: string) => s.toLowerCase().replace(/[^\p{L}? ]/gu, "").trim();

/** What identifies a unit for its face: the game's character ID (null: a generic unit), class ID, gender, its current
 * name (it changes: Tomas becomes Solon, Rhea Seiros) and a seed to pick among a class's generic faces. `object`: not
 * a unit but a thing the game keeps as one (a breakable wall; also known by its name). */
export interface Face {
  look?: string | null;
  object?: boolean;
  character?: number | null;
  classId?: number | null;
  female?: boolean;
  name?: string;
  seed?: string | number;
}

// Classes that change who a character looks like: the Flame Emperor and the Death Knight are other IDs' faces.
const FLAME_EMPEROR = new Set([47, 48]);
const DEATH_KNIGHT = new Set([59, 91]);
const HEGEMON = 80;
const NPC_CHILDHOOD = new Set([70, 71]);

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function fileOf(entry: ManifestCharacter, f: Face, part2: boolean, automatic: boolean): string {
  if (automatic && (f.character === 0 || f.character === 1) && f.look) return f.look === "green" ? entry.part2 ?? entry.part1 : entry.part1;
  const text = norm(f.name ?? "");
  const v = entry.variants ?? {};
  if (v.seiros && text.includes("seiros")) return v.seiros;
  if (v.solon && text.includes("solon")) return v.solon;
  if (v.tomas && text.includes("tomas")) return v.tomas;
  if (f.classId != null && FLAME_EMPEROR.has(f.classId) && entry.key !== "flame_emperor") return CHARACTERS["47"]?.part1 ?? entry.part1;
  if (f.classId != null && DEATH_KNIGHT.has(f.classId) && entry.key === "jeritza") return CHARACTERS["42"]?.part1 ?? entry.part1;
  if (v.hegemon && f.classId === HEGEMON) return v.hegemon;
  if (v.child && f.character != null && NPC_CHILDHOOD.has(f.character)) return v.child;
  return part2 && spoilerShown("portraits") && entry.part2 ? entry.part2 : entry.part1;
}

const CLASS_BY_NAME = new Map(Object.values(GENERIC).map((g) => [norm(g.name ?? ""), g]));
/** Last resort, no class known: a name that ends in a class ("Imperial Soldier", "Kingdom Knight"). */
function classNamed(text: string): ManifestGeneric | undefined {
  const words = text.split(" ");
  return CLASS_BY_NAME.get(text) ?? CLASS_BY_NAME.get(words.slice(-1)[0]) ?? CLASS_BY_NAME.get(words.slice(-2).join(" "));
}

/** A unit's face: its character's portrait (Part II once the story is there, other looks as it changes class or
 * name), else a generic one for its class and gender; null when there is none. Works for IDs not seen before. An
 * object (a breakable wall) has the battle map's icon for it, so it looks the same everywhere. */
/** Whether a face is a known character's own portrait (the one the Roster and Characters pages draw), not a generic. */
export function isCharacterFace(f: Face): boolean {
  if (f.character != null && CHARACTERS[String(f.character)]) return true;
  const key = NAME_KEY.get(norm(f.name ?? ""));
  return !!key && LOOKS.has(key);
}

export function faceUrl(f: Face, part2: boolean, automatic = true): string | null {
  if (f.object || OBJECT_NAMES.has(f.name ?? "")) return objectIcon(f.name ?? "");
  const entry = f.character != null ? CHARACTERS[String(f.character)] : undefined;
  if (!entry) {
    // No character ID (a tracked unit, an ID not in the tables): a known character name still has its face.
    const key = NAME_KEY.get(norm(f.name ?? ""));
    if (key && LOOKS.has(key)) return portraitUrlForKey(key, part2, undefined, automatic);
  }
  if (entry) return bundledPortrait(fileOf(entry, f, part2, automatic));
  const text = norm(f.name ?? "");
  const named = NAMES[nameSlug(f.name ?? "")];
  const g =
    (named?.own ? named : undefined) ??
    (f.classId != null ? GENERIC[String(f.classId)] : undefined) ??
    named ??
    classNamed(text);
  if (!g) return null;
  const list = f.female && g.female.length ? g.female : g.male.length ? g.male : g.female;
  return list.length ? list[hash(String(f.seed ?? 0)) % list.length] : null;
}
