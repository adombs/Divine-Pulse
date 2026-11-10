import type { Battalion, BattalionStats, Gambit, GambitArea, ReferenceData, SkillKey, Stats, ReferenceItem, Magic, Character } from "./types";
import type { SupportData, SupportRank } from "./supports";
import structureData from "./structure.json" with { type: "json" };
import { RequiredGameAssetError } from "../requiredAssets.ts";

const SOURCES = [{ name: "your game files", url: "game-files" }, { name: "Fire Emblem Wiki (GFDL 1.3)", url: "https://fireemblemwiki.org" }];

const STAT_LABEL: Record<string, string> = {
  prot: "Prot", res: "Res", weight: "Wt", hp: "HP", str: "Str", mag: "Mag", dex: "Dex", spd: "Spd", lck: "Lck", def: "Def",
  mv: "Mov", cha: "Cha", hit: "Hit", crit: "Crit", avoid: "Avo", mt: "Mt", heal: "Heal", range: "Range",
};

/** The imported effects as short labels: "Prot 6 · Res +3 · Wt 6 · Restores 10% HP each turn"; zero values left out. */
export function effectText(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && value !== 0 && STAT_LABEL[key]) {
      const plain = key === "prot" || key === "weight";
      parts.push(`${STAT_LABEL[key]} ${plain || value < 0 ? "" : "+"}${value}`);
    } else if (key === "hp_restore_pct" && typeof value === "number") parts.push(`Restores ${value}% HP each turn`);
    else if (key === "monster_damage_pct" && typeof value === "number") parts.push(value === 50 ? "Halves damage from monsters" : `Monster damage ${value}%`);
    else if (key === "exp_pct" && typeof value === "number") parts.push(`EXP +${value}%`);
    else if (key === "skill_exp_pct" && typeof value === "number") parts.push(`Skill EXP +${value}%`);
    else if (key === "negate_crit" && value === true) parts.push("Negates critical hits");
    else if (key === "miracle" && value === true) parts.push("Miracle");
    else if (key === "nullify_weakness" && Array.isArray(value) && value.length)
      parts.push(value.length >= 4 ? "Nullifies class weaknesses" : `Nullifies ${value.map((v) => String(v)[0].toUpperCase() + String(v).slice(1)).join(" and ")} weakness`);
  }
  const order = (p: string) => (p.startsWith("Prot") ? 0 : p.startsWith("Res") ? 1 : p.startsWith("Wt") ? 9 : 5);
  return parts.sort((a, b) => order(a) - order(b)).join(" · ");
}

// The files are optional and independently replaceable; validate their top-level shape before using them.
type Row = Record<string, any>;
const SKILL_KEYS: SkillKey[] = ["sword", "lance", "axe", "bow", "brawling", "reason", "faith", "authority", "heavy_armor", "riding", "flying"];
/** Stable keys and names by character ID, the same in every game language. */
const portraitEntries: Record<string, { key: string; name: string }> = Object.fromEntries(Object.entries(structureData.characterKeys).map(([id, key]) => [id, { key, name: key.split("_")[0].replace(/^./, (c) => c.toUpperCase()) }]));
/** Unused meal slots the game's item table still lists ("Dish 63"). */
const PLACEHOLDER_ITEMS = { first: 1089, last: 1125 };
export function itemSummary(item?: ReferenceItem): string {
  if (!item) return "";
  const fields = item.kind === "Weapon" ? [["Mt", item.might], ["Hit", item.hit], ["Crit", item.crit], ["Wt", item.weight], ["Range", item.range], ["Uses", item.uses]] : [];
  return [item.effect || item.description, fields.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => `${label} ${value}`).join(" · ")].filter(Boolean).join("\n");
}
export function spellSummary(spell?: Magic): string {
  if (!spell) return "";
  return [spell.description || spell.effect, `Mt ${spell.might} · Hit ${spell.hit} · Range ${spell.range} · Uses ${spell.uses}`].filter(Boolean).join("\n");
}
/** The description, then the decoded stat effects, as one sentence run. */
const itemEffect = (desc: string, bonuses: string) => [desc.replace(/\s*\n\s*/g, " ").trim(), bonuses].filter(Boolean).join(/[.!?]$/.test(desc.trim()) ? " " : " · ");
const rows = (value: unknown, key: string): Row[] => {
  if (!value || typeof value !== "object") return [];
  const list = (value as Row)[key];
  return Array.isArray(list) ? list.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r)) : [];
};
const normalName = (name: string) => name.replace(/[‘’]/g, "'");
const named = (list: Row[], name: string) => list.find((r) => typeof r.name === "string" && normalName(r.name) === normalName(name));
/** Spell ranges of 100 and up are a Mag-based reach; the row names the formula when it has one. */
const range = (r: Row, spell = false) => {
  const formula = typeof r.range_formula === "string" ? r.range_formula : "";
  if (formula === "all") return "All";
  if (formula) return `${r.min_range}–${formula[0].toUpperCase()}${formula.slice(1)}`;
  return spell && r.max_range >= 100 ? `${r.min_range}–Mag-based` : r.min_range === r.max_range ? String(r.min_range) : `${r.min_range}–${r.max_range}`;
};
const text = (value: unknown, fallback = "") => typeof value === "string" && value ? value : fallback;
const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const signed = (value: unknown) => typeof value === "number" && value >= 128 && value <= 255 ? value - 256 : value;
// A combat art's row `raw` bytes: [3] might, [4] crit, [5] hit, [10] cost, [11] longest and [12] shortest range, [13] weapon bit.
const rawByte = (r: Row, index: number) => typeof r.raw === "string" ? parseInt(r.raw.slice(index * 2, index * 2 + 2), 16) : NaN;
const ART_WEAPONS: Record<number, string> = { 1: "Sword", 2: "Lance", 4: "Axe", 8: "Bow", 16: "Brawling" };
export const artWeapon = (r: Row) => ART_WEAPONS[rawByte(r, 13)] ?? "Other";
const artRange = (r: Row) => {
  const longest = rawByte(r, 11), shortest = rawByte(r, 12);
  return longest > 0 && shortest > 0 ? (shortest === longest ? String(longest) : `${shortest}–${longest}`) : "";
};
/** Arts that deal no damage carry a 100 Hit placeholder and no Might: leave all of those blank. Other zeros stay blank except Might. */
const artStats = (r: Row) => {
  const might = number(signed(r.might), 0), crit = number(signed(r.crit), 0), hit = number(signed(r.hit), 0), cost = Math.abs(number(signed(r.cost), 0));
  const show = (value: number) => value ? String(value) : "";
  return hit === 100 && might === 0 && crit === 0 ? { might: "", hit: "", crit: "", cost: show(cost) } : { might: String(might), hit: show(hit), crit: show(crit), cost: show(cost) };
};
const stats = (base: Stats, values: unknown, hp: unknown): Stats => {
  const source = values && typeof values === "object" ? values as Row : {};
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, number(k === "hp" ? hp : source[k], v)])) as Stats;
};

export function buildCharacters(files: Record<string, unknown>, texts: Record<string, Record<string, string>>, playable: number[], hidden: number[] = [], partlyHidden: number[] = [], dlc: number[] = [], apparentAge: number[] = []): Character[] {
  const chars = rows(files.characters, "characters");
  const abilities = rows(files.abilities, "abilities");
  const arts = rows(files["combat-arts"], "combat_arts");
  const spells = rows(files.spells, "spells");
  const crests = rows(files["crests-by-person"], "crests");
  const talents = rows(files.characters, "budding_talents");
  const zero = Object.fromEntries(["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha"].map((k) => [k, 0])) as Stats;
  const display = (row: Row, category: string) => text(texts[category]?.[String(row.id)], text(row.name));
  const ranked = (value: unknown, lookup: Row[], category: string) => Array.isArray(value) ? value.flatMap((entry: Row) => {
    const found = lookup.find((v) => v.id === entry?.id);
    return found && typeof entry.rank === "string" ? [{ name: display(found, category), rank: entry.rank, ...(SKILL_KEYS.includes(entry.skill) ? { skill: entry.skill } : {}) }] : [];
  }) : [];
  return playable.flatMap((id) => {
    const r = chars.find((c) => c.id === id);
    if (!r || typeof r.name !== "string" || !r.name) return [];
    const student = r.student ?? {};
    const talent = talents.find((t) => t.character === id);
    const unlocked = talent && (abilities.find((a) => a.id === talent.ability) ?? arts.find((a) => a.id === talent.combat_art));
    const skills = Object.fromEntries(SKILL_KEYS.map((key) => {
      const s = student.skills?.[key] ?? {};
      const budding = talent?.skill === key;
      return [key, { initial: s.start_rank === "E" ? "" : text(s.start_rank), aptitude: budding ? (s.proficiency === "weak" ? "weak_budding" : "budding") : s.proficiency === "strong" || s.proficiency === "weak" ? s.proficiency : null }];
    })) as Character["skills"];
    const mappedCrests = (Array.isArray(r.crests) ? r.crests : []).flatMap((crestId: number) => {
      const crest = crests.find((c) => c.id === crestId);
      if (!crest || typeof crest.name !== "string") return [];
      return [{ name: crest.name.replace(/^(Minor )?Crest of /, ""), major: crest.major === true }];
    });
    const hiddenCrests = hidden.includes(id) && mappedCrests.length ? mappedCrests : null;
    const visibleCrests = hiddenCrests ? (partlyHidden.includes(id) ? mappedCrests.slice(0, 1) : [{ name: "Mystery", major: mappedCrests[0].major }]) : mappedCrests;
    const personal = [student.personal_ability, student.personal_ability_upgraded].flatMap((abilityId) => {
      const ability = abilities.find((a) => a.id === abilityId);
      return ability ? [{ name: display(ability, "ability"), description: text(texts.ability_description?.[String(ability.id)], text(ability.description)) }] : [];
    });
    const house = id === 0 ? "Church of Seiros" : id >= 1045 ? "Other" : r.allegiance === 1 ? "Black Eagles" : r.allegiance === 2 ? "Blue Lions" : r.allegiance === 3 ? "Golden Deer" : id >= 1040 && id <= 1043 ? "Ashen Wolves" : [30, 31, 32, 33, 35].includes(id) ? "Knights of Seiros" : "Church of Seiros";
    const birthday = r.birthday?.month >= 1 && r.birthday?.month <= 12 && r.birthday?.day >= 1 && r.birthday?.day <= 31 ? `${r.birthday.month}/${r.birthday.day}` : "";
    const heightOf = (v: Row | undefined) => v && v.part1 > 0 && v.part1 < 255 ? `${v.part1} cm${v.part2 > 0 && v.part2 < 255 && v.part2 !== v.part1 ? ` → ${v.part2} cm (Part II)` : ""}` : "";
    const female = id === 0 ? chars.find((c) => c.id === 1) : undefined;
    const heights = female ? { male: heightOf(r.height), female: heightOf(female.height) } : undefined;
    const height = heights ? `${heights.male} (male) / ${heights.female} (female)` : heightOf(r.height);
    return [{ key: id === 0 ? "byleth" : portraitEntries[String(id)]?.key ?? "", name: text(texts.character_given?.[String(r.name_id)], r.name), full_name: text(texts.character_full?.[String(r.id)], text(r.full_name, text(texts.character_given?.[String(r.name_id)], r.name))), house, gender: id === 0 ? "Either" : r.gender === 1 ? "Female" : "Male", dlc: dlc.includes(id), bases: stats(zero, r.bases, r.hp?.base), growths: stats(zero, r.growths, r.hp?.growth), maxes: stats(zero, r.caps, r.hp?.cap), start_class: text(r.class), crests: visibleCrests, crests_spoiler: hiddenCrests, age: r.age > 0 && r.age < 100 ? `${r.age}${apparentAge.includes(id) ? " (by appearance)" : ""}` : "", birthday, height, heights, skills, budding: talent && unlocked ? { skill: talent.skill, unlock: text(unlocked.name), description: text(unlocked.description) } : null, personal, abilities: ranked(student.abilities, abilities, "ability"), arts: ranked(student.combat_arts, arts, "combat_art"), spells: { reason: ranked(student.spells?.reason, spells, "spell"), faith: ranked(student.spells?.faith, spells, "spell") } } as Character];
  });
}

export function buildReference(files: Record<string, unknown>, texts: Record<string, Record<string, string>>, structure: { playableCharacters: number[]; playableClasses: number[]; hiddenCrests?: number[]; partlyHiddenCrests?: number[]; dlcCharacters?: number[]; apparentAge?: number[] }, wikiClasses: { name: string; text: string }[]): ReferenceData {
  const zero = Object.fromEntries(["hp", "str", "mag", "dex", "spd", "lck", "def", "res", "cha"].map((k) => [k, 0])) as Stats;
  const classStats = { ...zero, mv: 0 };
  const abilities = rows(files.abilities, "abilities");
  const arts = rows(files["combat-arts"], "combat_arts");
  const spells = rows(files.spells, "spells");
  const items = rows(files.items, "items");
  const names = rows(files["crests-by-person"], "crests");
  // Bearers list every crest except the story reveal of a partly hidden unit.
  const characters = buildCharacters(files, {}, structure.playableCharacters, structure.partlyHiddenCrests, structure.partlyHiddenCrests);
  const classRows = rows(files.classes, "classes").filter((r) => structure.playableClasses.includes(r.id) && typeof r.name === "string" && r.name);
  const classes = classRows.flatMap((r) => [r.name, ...(typeof r.female_name === "string" && r.female_name !== r.name ? [r.female_name] : [])].map((name) => ({
    name, tier: (r.id >= 84 ? "DLC" : ["Unique", "Beginner", "Intermediate", "Advanced", "Master"][r.tier] ?? "Unique") as ReferenceData["classes"][number]["tier"], level: null, seal: r.certification?.selectable ? text(items.find((item) => item.id === r.certification?.seal_item)?.name) || null : null, gender: r.female_name ? (name === r.female_name ? "Female" as const : "Male" as const) : r.certification?.selectable && r.certification.gender === "male" ? "Male" as const : r.certification?.selectable && r.certification.gender === "female" ? "Female" as const : null, restriction: wikiClasses.find((w) => w.name === name)?.text ?? "", requirements: [], requirement_any: r.certification?.any_of === true, bases: classStats, boosts: classStats, mount_boosts: {}, growths: zero, skill_bonus: {}, proficient: [], abilities: [], mastery_ability: "", mastery_art: "", types: [],
  })));
  const base: ReferenceData = {
    sources: SOURCES, characters, classes,
    abilities: abilities.filter((r) => typeof r.name === "string" && r.name).map((r) => ({ name: r.name, description: "" })),
    combat_arts: arts.filter((r) => typeof r.name === "string" && r.name).map((r) => ({ name: r.name, weapon: artWeapon(r), ...artStats(r), range: artRange(r), description: "" })),
    magic: spells.filter((r) => typeof r.name === "string" && r.name).map((r) => ({ name: r.name, type: r.skill === 6 ? "White" : r.skill === 7 ? "Dark" : "Black", might: 0, hit: 0, range: "", uses: 0, effect: "" })),
    items: [], crests: names.filter((r) => r.major && typeof r.name === "string" && r.name).map((r) => {
      const name = r.name.replace(/^(Minor )?Crest of /, "");
      const bearers = { major: [] as string[], minor: [] as string[] };
      for (const character of characters) for (const crest of character.crests) if (crest.name === name) bearers[crest.major ? "major" : "minor"].push(character.name);
      return { name, effect: "", bearers };
    }), battalions: [],
  };
  return { ...enrichReference(base, files, texts, structure.playableClasses), characters: buildCharacters(files, texts, structure.playableCharacters, structure.hiddenCrests, structure.partlyHiddenCrests, structure.dlcCharacters, structure.apparentAge) };
}

function enrichReference(base: ReferenceData, files: Record<string, unknown>, texts: Record<string, Record<string, string>> = {}, playableClasses: number[] = []): ReferenceData {
  const classes = rows(files.classes, "classes");
  const abilities = rows(files.abilities, "abilities");
  const arts = rows(files["combat-arts"], "combat_arts");
  const spells = rows(files.spells, "spells");
  const weapons = rows(files.weapons, "weapons");
  const equipment = rows(files.equipment, "equipment");
  const items = rows(files.items, "items");
  const description = (r: Row, category: string) => text(texts?.[category]?.[String(r.id)], text(r.description));
  const refAbilities = base.abilities.map((a) => {
    const r = named(abilities, a.name); return r ? { ...a, description: description(r, "ability_description") || a.description } : a;
  });
  const refArts = base.combat_arts.map((a) => {
    const r = named(arts, a.name); return r ? { ...a, description: description(r, "combat_art_description") || a.description } : a;
  });
  const refMagic = base.magic.map((a) => {
    const r = named(spells, a.name); return r ? { ...a, might: number(r.might, a.might), hit: number(r.hit, a.hit), uses: number(r.uses, a.uses), range: typeof r.min_range === "number" && typeof r.max_range === "number" ? range(r, true) : a.range, description: description(r, "spell_description") || a.description, effect: description(r, "spell_description") || a.effect } : a;
  });
  const refItems = base.items.map((a) => {
    const r = named(weapons, a.name) ?? named(equipment, a.name) ?? named(items, a.name);
    if (!r) return a;
    const category = weapons.includes(r) ? "weapon_description" : items.includes(r) ? "item_description" : "equipment_description";
    const desc = description(r, category);
    const effects = r.effects && typeof r.effects === "object" && !Array.isArray(r.effects) ? Object.fromEntries(Object.entries(r.effects).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined;
    const bonuses = effectText(r.effects);
    return { ...a, description: desc, effect: itemEffect(desc, bonuses) || a.effect, effects, amount: number(r.amount, 0), might: number(r.might, a.might ?? 0), hit: number(r.hit, a.hit ?? 0), crit: number(r.crit, a.crit ?? 0), weight: number(r.weight, a.weight ?? 0), uses: number(r.uses, a.uses ?? 0), range: typeof r.min_range === "number" && typeof r.max_range === "number" ? range(r) : a.range };
  });
  const knownItems = new Set(refItems.map((item) => item.name));
  for (const [list, kind, category] of [[weapons, "Weapon", "weapon_description"], [equipment, "Equipment", "equipment_description"], [items, "Item", "item_description"]] as const) {
    for (const r of list) {
      if (typeof r.name !== "string" || !r.name || knownItems.has(r.name)) continue;
      if (kind === "Item" && r.id >= PLACEHOLDER_ITEMS.first && r.id <= PLACEHOLDER_ITEMS.last) continue;
      knownItems.add(r.name);
      const desc = description(r, category);
      const effects = r.effects && typeof r.effects === "object" && !Array.isArray(r.effects) ? Object.fromEntries(Object.entries(r.effects).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined;
      const bonuses = effectText(r.effects);
      const weaponType = ["Other", "Sword", "Lance", "Axe", "Bow", "Gauntlet", "Magic"][r.weapon_type] ?? "Other";
      const rank = ["E", "D", "C", "B", "A", "S"][r.rank];
      refItems.push({ name: r.name, kind, description: desc, effect: itemEffect(desc, bonuses), effects, amount: number(r.amount, 0), might: number(r.might, 0), hit: number(r.hit, 0), crit: number(r.crit, 0), weight: number(r.weight, 0), uses: number(r.uses, 0), range: typeof r.min_range === "number" && typeof r.max_range === "number" ? range(r) : undefined, ...(kind === "Weapon" ? { weapon_type: weaponType, rank, flags: r.flags } : {}) });
    }
  }
  return {
    ...base,
    sources: base.sources,
    abilities: refAbilities, combat_arts: refArts, magic: refMagic, items: refItems,
    classes: base.classes.map((c) => {
      const playable = classes.filter((v) => playableClasses.includes(v.id));
      const r = named(playable, c.name) ?? playable.find((v) => v.female_name === c.name) ?? named(classes, c.name) ?? classes.find((v) => v.female_name === c.name);
      if (!r) return c;
      const bases = { ...stats(c.bases, r.bases, r.bases?.hp), mv: number(r.base_mv, c.bases.mv) };
      const abilityName = (id: unknown) => abilities.find((a) => a.id === id)?.name;
      const artName = (id: unknown) => arts.find((a) => a.id === id)?.name;
      const nonzero = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n !== 0)) : undefined;
      const bonus = nonzero(r.skill_bonus) ?? c.skill_bonus;
      const growths = r.growths && typeof r.growths === "object" ? Object.fromEntries(Object.entries(r.growths).map(([k, v]) => [k, signed(v)])) : {};
      const requirements = r.certification?.requirements;
      const ranks = ["E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+"];
      const mappedRequirements = r.certification?.selectable && requirements && typeof requirements === "object" && !Array.isArray(requirements) ? SKILL_KEYS.flatMap((skill) => typeof requirements[skill] === "number" && ranks[requirements[skill]] ? [{ skill, rank: ranks[requirements[skill]] }] : []) : c.requirements;
      const types = r.types && typeof r.types === "object" ? (["Infantry", "Armored", "Cavalry", "Flying"] as const).filter((t) => r.types[t.toLowerCase()] === true) : c.types;
      return { ...c, description: description(r, "class_description") || c.description, level: number(r.level, c.level ?? 0) || null, requirements: mappedRequirements, types, bases, boosts: { ...c.boosts, ...(r.boosts && typeof r.boosts === "object" && !Array.isArray(r.boosts) ? Object.fromEntries(Object.entries(r.boosts).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) : {}) }, mount_boosts: nonzero(r.mounted) ?? c.mount_boosts, growths: stats(c.growths, growths, growths.hp), skill_bonus: bonus, proficient: SKILL_KEYS.filter((key) => typeof bonus[key] === "number" && bonus[key] > 0), abilities: Array.isArray(r.abilities) && abilities.length && r.abilities.every((id: unknown) => typeof abilityName(id) === "string") ? r.abilities.map(abilityName) : c.abilities, mastery_ability: text(abilityName(r.mastery_ability), c.mastery_ability), mastery_art: text(artName(r.mastery_art), c.mastery_art) };
    }),
    crests: base.crests.map((c) => {
      const names = rows(files["crests-by-person"], "crests");
      const r = names.find((v) => v.major && (v.name === `Crest of ${c.name}` || v.name === c.name));
      if (!r) return c;
      const major = text(texts?.crest_major_description?.[String(r.id)]);
      const minor = text(texts?.crest_minor_description?.[String(r.id)]);
      return { ...c, major_description: major || c.major_description, minor_description: minor || c.minor_description, effect: major || minor || c.effect };
    }),
    battalions: rows(files.battalions, "battalions").length ? rows(files.battalions, "battalions").map((r) => parseBattalion({
      ...r,
      name: text(texts?.battalion?.[String(r.id)], text(r.name)),
      gambit: isBRow(r.gambit) ? {
        ...r.gambit,
        name: text(texts?.gambit?.[String(r.gambit.id)], text(r.gambit.name)),
        description: text(texts?.gambit_description?.[String(r.gambit.id)], text(r.gambit.description)),
      } : r.gambit,
    }, description(r, "battalion_description"))).filter((b): b is Battalion => !!b) : base.battalions,
  };
}

const referenceFiles = ["characters", "classes", "abilities", "combat-arts", "spells", "weapons", "equipment", "items", "crests-by-person", "battalions"];
const categories = ["ability_description", "combat_art_description", "spell_description", "weapon_description", "item_description", "equipment_description", "class_description", "crest_major_description", "crest_minor_description", "battalion_description", "gambit", "gambit_description", "ability", "combat_art", "spell", "weapon", "item", "equipment", "class", "character_given", "character_full", "crest_major", "crest_minor", "battalion"];
export async function loadImportedReference(structure: Parameters<typeof buildReference>[2], wikiClasses: Parameters<typeof buildReference>[3]): Promise<ReferenceData> {
  const { gameAssetsAvailable, loadGameJson, loadGameText } = await import("../gameAssets");
  if (!gameAssetsAvailable()) return buildReference({}, {}, structure, wikiClasses);
  try {
    const { gameLanguage } = await import("../gameLanguage");
    const language = gameLanguage();
    const [files, texts] = await Promise.all([Promise.all(referenceFiles.map((name) => loadGameJson(`data/${name}.json`))), Promise.all(categories.map((name) => loadGameText(name, language)))]);
    const missing = files.findIndex((file) => file === null);
    if (missing >= 0) throw new RequiredGameAssetError(`data/${referenceFiles[missing]}.json`);
    const adapted = buildReference(Object.fromEntries(referenceFiles.map((name, i) => [name, files[i]])), Object.fromEntries(categories.map((name, i) => [name, texts[i]])), structure, wikiClasses);
    const translations = new Map<string, string>();
    const sources = Object.fromEntries(referenceFiles.map((name, i) => [name, files[i]]));
    for (const [file, key, category] of [["abilities", "abilities", "ability"], ["combat-arts", "combat_arts", "combat_art"], ["spells", "spells", "spell"], ["weapons", "weapons", "weapon"], ["items", "items", "item"], ["equipment", "equipment", "equipment"], ["classes", "classes", "class"], ["battalions", "battalions", "battalion"], ["characters", "characters", "character_given"], ["characters", "characters", "character_full"]]) {
      const names = texts[categories.indexOf(category)];
      for (const row of rows(sources[file], key)) {
        const id = category === "character_given" ? row.name_id : row.id;
        const name = category === "character_full" ? row.full_name : row.name;
        if (typeof name === "string" && names?.[String(id)]) translations.set(name, names[String(id)]);
      }
    }
    const translate = (value: any): any => typeof value === "string" ? translations.get(value) ?? value : Array.isArray(value) ? value.map(translate) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, translate(entry)])) : value;
    return translate(adapted) as ReferenceData;
  } catch (error) {
    if (error instanceof RequiredGameAssetError) throw error;
    throw new RequiredGameAssetError("data/reference", error instanceof Error ? error.message : "Reference data unreadable");
  }
}

export function buildSupports(files: Record<string, unknown>, wiki: { a: string; b: string; avail: Partial<Record<SupportRank, string>>; notes: string[] }[], texts: Record<string, Record<string, string>> = {}, excludedPairs: number[][] = []): SupportData {
  const pairs = rows(files.supports, "pairs");
  const characters = rows(files.characters, "characters");
  const gifts = rows(files.gifts, "characters");
  const personName = (id: unknown, fallback: unknown) => {
    const person = characters.find((c) => c.id === id);
    return text(texts.character_given?.[String(person?.id)], text(fallback));
  };
  const updatedPairs = pairs.flatMap((p) => {
    if (typeof p.a_name !== "string" || typeof p.b_name !== "string" || !Array.isArray(p.ranks) || excludedPairs.some(([a, b]) => (p.a === a && p.b === b) || (p.a === b && p.b === a))) return [];
    const versions = p.a === 0 || p.b === 0 ? ["M", "F"] : [""];
    return versions.map((gender) => {
      const baseA = portraitEntries[String(p.a)]?.name ?? p.a_name;
      const baseB = portraitEntries[String(p.b)]?.name ?? p.b_name;
      const originalA = p.a === 0 ? `${baseA} (${gender})` : baseA;
      const originalB = p.b === 0 ? `${baseB} (${gender})` : baseB;
      const entry = wiki.find((w) => (w.a === originalA && w.b === originalB) || (w.a === originalB && w.b === originalA));
      const name = (id: unknown, original: string) => `${portraitEntries[String(id)]?.name ?? original.replace(/ \([MF]\)$/, "")}${id === 0 ? ` (${gender})` : ""}`;
      const ranks = (p.ranks as unknown[]).filter((rank): rank is SupportRank => typeof rank === "string" && ["C", "C+", "B", "B+", "A", "A+", "S"].includes(rank) && (rank !== "S" || !gender || !!entry?.avail.S));
      return { a: name(p.a, originalA), b: name(p.b, originalB), ranks, avail: entry?.avail ?? {}, notes: entry?.notes ?? [] };
    });
  });
  const people: SupportData["people"] = {};
  for (const gift of gifts) {
    const person = characters.find((c) => c.id === gift.character);
    if (!person || typeof person.name !== "string") continue;
    const names = (v: unknown) => Array.isArray(v) ? v.flatMap((x) => x && typeof x.name === "string" ? [text(texts.gift?.[String(x.id - 5)], x.name)] : []) : [];
    people[personName(person.id, person.name)] = { liked_gifts: names(gift.liked), disliked_gifts: names(gift.disliked), lost_items: names(gift.lost_items) };
  }
  const displayNames = Object.fromEntries(characters.flatMap((person) => {
    const canonical = portraitEntries[String(person.id)]?.name;
    return canonical ? [[canonical, personName(person.id, person.name)]] : [];
  }));
  const importedMeals = rows(files.meals, "meals");
  const mealPreferences = rows(files.meals, "characters");
  const mealNames = { ...Object.fromEntries(importedMeals.filter((m) => typeof m.name === "string").map((m) => [String(m.id), m.name])), ...texts.meal };
  const meals: SupportData["meals"] = Object.entries(mealNames)
    .filter(([id, name]) => /^(?:[0-9]|[12][0-9]|3[01])$/.test(id) && name.trim())
    .map(([id, name]) => {
      const row = importedMeals.find((m) => String(m.id) === id);
      const meal: SupportData["meals"][number] = { id, name };
      if (Array.isArray(row?.ingredients)) meal.ingredients = row.ingredients.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const { id: ingredientId, name: fallback, quantity } = item as Row;
        const ingredientName = text(texts.ingredient?.[String(ingredientId)], text(fallback));
        return Number.isInteger(ingredientId) && typeof quantity === "number" && quantity > 0 && ingredientName
          ? [{ id: ingredientId, name: ingredientName, quantity }] : [];
      });
      if (mealPreferences.length) meal.preferences = true;
      return meal;
    });
  for (const preference of mealPreferences) {
    const person = characters.find((c) => c.id === preference.character);
    if (!person || typeof person.name !== "string") continue;
    const name = personName(person.id, person.name);
    const names = (ids: unknown) => Array.isArray(ids) ? ids.flatMap((id) => {
      const meal = meals.find((m) => m.id === String(id));
      return meal ? [meal.name] : [];
    }) : [];
    people[name] = { ...people[name], liked_meals: names(preference.liked), disliked_meals: names(preference.disliked) };
  }
  return { names: displayNames, pairs: updatedPairs, people, meals };
}

export async function loadImportedSupports(wiki: Parameters<typeof buildSupports>[1], excludedPairs: number[][]): Promise<SupportData> {
  const { gameAssetsAvailable, loadGameJson, loadGameText } = await import("../gameAssets");
  if (!gameAssetsAvailable()) return buildSupports({}, wiki);
  try {
    const { gameLanguage } = await import("../gameLanguage");
    const names = ["supports", "gifts", "characters", "meals"];
    const [values, characterGiven, gift, meal, ingredient] = await Promise.all([Promise.all(names.map((name) => loadGameJson(`data/${name}.json`))), loadGameText("character_given", gameLanguage()), loadGameText("gift", gameLanguage()), loadGameText("meal", gameLanguage()), loadGameText("ingredient", gameLanguage())]);
    const missing = values.findIndex((value) => value === null);
    if (missing >= 0) throw new RequiredGameAssetError(`data/${names[missing]}.json`);
    return buildSupports(Object.fromEntries(names.map((name, i) => [name, values[i]])), wiki, { character_given: characterGiven, gift, meal, ingredient }, excludedPairs);
  } catch (error) {
    if (error instanceof RequiredGameAssetError) throw error;
    throw new RequiredGameAssetError("data/supports", error instanceof Error ? error.message : "Support data unreadable");
  }
}

/* Battalion rows (data/battalions.json). Older imports may omit icons, modifiers and gambits;
   nothing is filled in that the import doesn't hold. */
type BRow = Record<string, unknown>;
// The modifiers in the panel's order (the same keys as BATTALION_STAT_KEYS in types.ts).
const BATTALION_KEYS = ["phys_atk", "mag_atk", "hit", "crit", "avo", "prt", "rsl", "cha"] as const;

const isBRow = (v: unknown): v is BRow => !!v && typeof v === "object" && !Array.isArray(v);
const bNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const bPair = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isInteger(n)) ? [v[0], v[1]] : undefined;

function bStats(v: unknown): BattalionStats | undefined {
  if (!isBRow(v)) return undefined;
  const out: BattalionStats = {};
  for (const k of BATTALION_KEYS) {
    const n = bNum(v[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function bArea(v: unknown): GambitArea | undefined {
  if (!isBRow(v) || !Array.isArray(v.cells)) return undefined;
  const cells = v.cells.map(bPair).filter((c): c is [number, number] => !!c);
  if (!cells.length) return undefined;
  const origin = bPair(v.origin);
  const target = bPair(v.target);
  return { cells, ...(origin ? { origin } : {}), ...(target ? { target } : {}), ...(v.direction === "forward" ? { direction: "forward" as const } : {}) };
}

function bGambit(v: unknown): Gambit | undefined {
  if (!isBRow(v)) return undefined;
  const name = bStr(v.name);
  if (!name) return undefined;
  const r = bPair(v.range);
  const a = bArea(v.area);
  const out: Gambit = { name, description: bStr(v.description) ?? "" };
  const id = bNum(v.id), icon = bStr(v.icon), uses = bNum(v.uses), might = bNum(v.might), hit = bNum(v.hit);
  if (id !== undefined) out.id = id;
  if (icon) out.icon = icon;
  if (uses !== undefined) out.uses = uses;
  if (might !== undefined) out.might = might;
  if (hit !== undefined) out.hit = hit;
  if (r) out.range = r;
  if (a) out.area = a;
  return out;
}

/** One import row as a Battalion, its description from the language's text when there is one. Null when unnamed. */
export function parseBattalion(r: BRow, description: string): Battalion | null {
  const name = bStr(r.name);
  if (!name) return null;
  const endurance = bNum(r.endurance);
  if (endurance === undefined || endurance < 0) throw new RequiredGameAssetError("data/battalions.json", "Battalion endurance missing or invalid");
  const out: Battalion = { name, description, endurance };
  const id = bNum(r.id), icon = bStr(r.icon), base = bStats(r.stats), g = bGambit(r.gambit);
  if (id !== undefined) out.id = id;
  if (icon) out.icon = icon;
  if (base) out.stats = base;
  if (Array.isArray(r.stats_by_level)) {
    const levels = r.stats_by_level.map(bStats);
    if (levels.length && levels.every(Boolean)) out.stats_by_level = levels as BattalionStats[];
  }
  if (g) out.gambit = g;
  return out;
}
