import { crestLabel, crestName, isMysteryCrest } from "./crests";
import { SkillIcon } from "../components/SkillIcon";
import { SKILL_LABEL, type SkillKey } from "./types";
import "./icons.css";
import { loadGameJson, loadGameText } from "../gameAssets";
import { gameLanguage } from "../gameLanguage";
import { GameImage } from "../components/GameImage";
import { artWeapon } from "./gameData";

type Manifest = {
  abilities: Record<string, string>;
  crests: Record<string, { major?: string; minor?: string }>;
  arts: Record<string, { weapon: string; icon?: string }>;
  spells: Record<string, string>;
  items: Record<string, string>;
  native_items: Record<string, string>;
  native_spells: Record<string, string>;
};

const DATA: Manifest = { abilities: {}, crests: {}, arts: {}, spells: {}, items: {}, native_items: {}, native_spells: {} };

/** Names come from the game, saved data and hand typing, so match forgivingly. */
const norm = (name: string) => name.replace(/’/g, "'").toLowerCase().trim();

function index<T>(entries: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(entries).map(([name, value]) => [norm(name), value]));
}

let ABILITIES = index(DATA.abilities);
let CRESTS = index(DATA.crests);
let ARTS = index(DATA.arts);
let SPELLS = index(DATA.spells);
let ITEMS = index(DATA.items);
let NATIVE_ITEMS = index(DATA.native_items);
let NATIVE_SPELLS = index(DATA.native_spells);

export async function loadReferenceIcons(): Promise<void> {
  const kinds = ["abilities", "combat-arts", "spells", "weapons", "equipment", "items", "crests-by-person"];
  const files = await Promise.all(kinds.map((kind) => loadGameJson<Record<string, any>>(`data/${kind}.json`)));
  const [native, iconIndex] = await Promise.all([
    loadGameJson<Record<string, Record<string, number>>>("data/exe/item-icons.json"),
    loadGameJson<{ icons?: Record<string, { path: string }> }>("data/icons.json"),
  ]);
  const categories = ["ability", "combat_art", "spell", "weapon", "equipment", "item", "crest_major", "crest_minor"];
  const texts = await Promise.all(categories.map((category) => loadGameText(category, gameLanguage())));
  const [abilities, arts, spells, weapons, equipment, items, crests] = files;
  ABILITIES = new Map(); CRESTS = new Map(); ARTS = new Map(); SPELLS = new Map(); ITEMS = new Map(); NATIVE_ITEMS = new Map(); NATIVE_SPELLS = new Map();
  const add = (map: Map<string, string>, rows: any[], names: Record<string, string>, path: (row: any) => string) => {
    for (const row of rows ?? []) for (const name of [row.name, names[String(row.id)]]) if (name) map.set(norm(name), path(row));
  };
  add(ABILITIES, abilities?.abilities, texts[0], (r) => `images/icons/abilities/${r.id}.png`);
  const nativePath = (kind: string, row: any, fallback: string) => {
    const id = native?.[kind]?.[String(row.id)];
    return typeof id === "number" ? `images/icons/items-native/${id.toString(16).padStart(3, "0")}.png` : iconIndex?.icons?.[fallback]?.path ?? "";
  };
  add(SPELLS, spells?.spells, texts[2], (r) => nativePath("spells", r, `magic/${r.skill === 6 ? "white" : "black"}`));
  for (const [kind, rows, names, file] of [["weapons", weapons?.weapons, texts[3], "items/sword"], ["equipment", equipment?.equipment, texts[4], "items/shield"], ["items", items?.items, texts[5], "items/potion"]] as const)
    add(ITEMS, rows, names, (r) => nativePath(kind, r, file));
  for (const row of arts?.combat_arts ?? []) {
    const weapon = artWeapon(row).toLowerCase();
    for (const name of [row.name, texts[1][String(row.id)]]) if (name) ARTS.set(norm(name), { weapon, icon: `images/icons/combat-arts/${weapon}.png` });
  }
  for (const row of crests?.crests ?? []) {
    const name = texts[row.major ? 6 : 7][String(row.id)] ?? row.name;
    if (!name) continue;
    const key = norm(name.replace(/^(major|minor)\s+/i, "").replace(/^crest of /i, ""));
    const entry = CRESTS.get(key) ?? {};
    if (row.major) entry.major = `images/icons/crests/${row.id % 22}.png`; else entry.minor = `images/icons/crests/${row.id % 22}.png`;
    CRESTS.set(key, entry);
  }
}

/** Combat art weapon to weapon icon. */
const WEAPON_FILE: Record<string, string> = {
  sword: "sword",
  lance: "lance",
  axe: "axe",
  bow: "bow",
  brawling: "gauntlets",
  reason: "reason",
  faith: "faith",
};

const url = (file: string) => file;

export function abilityIconUrl(name: string): string | null {
  const file = ABILITIES.get(norm(name));
  return file ? url(file) : null;
}

export function crestIconUrl(name: string, major = true): string | null {
  const entry = CRESTS.get(norm(name.replace(/^(major|minor)\s+/i, "")));
  const file = entry && (major ? entry.major ?? entry.minor : entry.minor ?? entry.major);
  return file ? url(file) : null;
}

export function artIconUrl(name: string): string | null {
  const file = ARTS.get(norm(name))?.icon;
  return file ? url(file) : null;
}

export function spellIconUrl(name: string): string | null {
  const key = norm(name);
  const file = NATIVE_SPELLS.get(key) ?? SPELLS.get(key);
  return file ? url(file) : null;
}

/** The icon of a weapon, shield, ring, staff, gem, consumable or key by its in-game name ("Steel Shield", "Vulnerary"). */
export function itemIconUrl(name: string): string | null {
  const key = norm(name);
  const file = NATIVE_ITEMS.get(key) ?? ITEMS.get(key) ?? ITEMS.get(key.replace(/\s*[+\u0370-\u03ff]+$/, ""));
  return file ? url(file) : null;
}

/** The weapon a combat art is used with, as its battle-map weapon icon. */
export function artWeaponIconUrl(name: string): string | null {
  const weapon = ARTS.get(norm(name))?.weapon;
  const file = weapon && WEAPON_FILE[weapon.toLowerCase()];
  return file ? `images/icons/weapons/${file}.png` : null;
}

/**
 * One decorative image. The name beside it is the accessible text, so the image is always hidden from
 * screen readers; it renders nothing at all when there is no icon for that name.
 */
export function RefIcon({ src, className = "" }: { src: string | null; className?: string }) {
  if (!src) return null;
  return <GameImage className={`ref-icon ${className}`.trim()} imported={src} alt="" aria-hidden loading="lazy" draggable={false} />;
}

/** An ability's icon, or nothing. */
export function AbilityIcon({ name }: { name: string }) {
  return <Group icons={[[abilityIconUrl(name), ""]]} />;
}

/** A crest's icon, Major or Minor (they differ in the game), or nothing. */
export function CrestIcon({ name, major = true }: { name: string; major?: boolean }) {
  return <Group icons={[[crestIconUrl(name, major), "crest-icon"]]} />;
}

/** An item's icon (weapon, shield, ring, staff, gem, consumable, key), or nothing. */
export function ItemIcon({ name }: { name: string }) {
  return <Group icons={[[itemIconUrl(name), ""]]} />;
}

/** A spell's icon (black, dark or white magic), or nothing. */
export function SpellIcon({ name }: { name: string }) {
  return <Group icons={[[spellIconUrl(name), ""]]} />;
}

/**
 * A combat art: its own icon and, next to it, the icon of the weapon it is used with, so the weapon is
 * clear at a glance. The game gives every art of a weapon the same icon, so a list that already says which
 * weapon an art belongs to passes `weapon={false}` and shows that icon on its own.
 */
export function ArtIcon({ name, weapon = false }: { name: string; weapon?: boolean }) {
  return (
    <Group
      icons={[
        [artIconUrl(name), ""],
        ...(weapon ? ([[artWeaponIconUrl(name), "weapon"]] as [string | null, string][]) : []),
      ]}
    />
  );
}


function Group({ icons }: { icons: [string | null, string][] }) {
  const found = icons.filter(([src]) => src);
  if (found.length === 0) return null;
  return (
    <span className="ref-icons" aria-hidden>
      {found.map(([src, className]) => (
        <RefIcon key={src} src={src} className={className} />
      ))}
    </span>
  );
}

/** A combat art's weapon ("Sword", "Brawling", ...) as its in-game icon with the name on hover; "Other" has no icon. */
export function WeaponIcon({ weapon }: { weapon: string }) {
  const file = WEAPON_FILE[weapon.toLowerCase()];
  if (!file) return <span className="ref-weapon-text">{weapon}</span>;
  return <GameImage className="ref-icon weapon-solo" imported={`images/icons/weapons/${file}.png`} fallback={<span className="ref-weapon-text">{weapon}</span>} alt={weapon} title={weapon} loading="lazy" draggable={false} />;
}

/** A crest as its in-game icon alone, "Major Crest of Blaiddyd" on hover. */
export function CrestMark({ name, major = true }: { name: string; major?: boolean }) {
  const src = crestIconUrl(name, major);
  const label = crestLabel(name, major);
  if (!src) return isMysteryCrest(name) ? null : <span className="ref-crest-text" title={label}>{crestName(name)}</span>;
  return <span role="img" aria-label={label} title={label}><RefIcon className="crest-icon" src={src} /></span>;
}

/**
 * Skills as their in-game icons (weapons) with the name on hover, in a row; `ranks` adds a letter after each.
 */
export function SkillIcons({
  skills,
  ranks,
}: {
  skills: readonly SkillKey[];
  ranks?: Partial<Record<SkillKey, string>>;
}) {
  return (
    <span className="ref-skills">
      {skills.map((s) => (
        <span key={s} className="ref-skill" title={ranks?.[s] ? `${SKILL_LABEL[s]} ${ranks[s]}` : undefined}>
          <SkillIcon skill={s} />
          {ranks?.[s] && <span className="ref-skill-rank">{ranks[s]}</span>}
        </span>
      ))}
    </span>
  );
}
