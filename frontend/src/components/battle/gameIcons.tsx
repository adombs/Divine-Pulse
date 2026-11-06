/**
 * The game's own icons wherever the battle pages name a weapon, spell or combat art, each with its name on hover:
 * weapon glyphs (tinted by the text colour) and the spell and combat art icons of the reference pages. (Army badges
 * are marks.tsx's TeamTag.)
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import "./battle.css";
import { artIconUrl, itemIconUrl, RefIcon, spellIconUrl } from "../../reference/icons";
import { Icon } from "../Icon";
import { WEAPON_LABEL } from "./mapIcons";
import { useGameImageUrl } from "../GameImage";
import { maskStyle } from "../gameImageSources";
import { CRYSTAL_ITEM_ICON } from "./unitAppearance";

const SOLID = new Set(["sword", "lance", "axe", "bow", "gauntlets", "reason", "faith"]);

/** A weapon's glyph (the game's, in the surrounding text colour): "sword", "lance", "axe", "bow", "gauntlets",
 * "reason", "faith" or "dark". No weapon means fists. `label` is the hover text (default: the weapon's name). */
export function WeaponIcon({ kind, label }: { kind?: string | null; label?: string }) {
  const k = kind && WEAPON_LABEL[kind] ? kind : null;
  const tip = label ?? (k ? WEAPON_LABEL[k] : "Fists");
  const imported = SOLID.has(k ?? "gauntlets") ? `images/icons/weapons/${k ?? "gauntlets"}.png` : `images/map/minimap-pieces/weapon-${k}.png`;
  const url = useGameImageUrl(imported);
  const crystal = useGameImageUrl(k === "crest-stone" ? CRYSTAL_ITEM_ICON : "");
  return url || crystal ? <span className="game-icon weapon" role="img" aria-label={tip} title={tip} style={maskStyle(url || crystal)} /> : null;
}

const KIND_LABEL = { weapon: "Weapon", spell: "Spell", art: "Combat art", item: "Item", equipment: "Equipment", other: "Item", rally: "Rally", gambit: "Gambit" } as const;

/** What a weapon, spell, combat art, item, piece of equipment or Rally is, as an icon: a weapon by its type, a spell by
 * its magic, an art by its own icon and its weapon's; the rest by the kit's. */
export function GearIcon({ kind, weapon, name }: { kind: keyof typeof KIND_LABEL; weapon?: string | null; name: string }) {
  const inferred = weapon ?? weaponKindFromName(name);
  const tip = `${KIND_LABEL[kind]}${inferred && WEAPON_LABEL[inferred] ? ` · ${WEAPON_LABEL[inferred]}` : ""}`;
  const own = kind === "weapon" || kind === "equipment" || kind === "item" || kind === "other" ? itemIconUrl(name) : null;
  if (own) return <span className="game-icon" title={tip}><RefIcon src={own} className="gear" /></span>;
  if (kind === "weapon") return <WeaponIcon kind={inferred} label={name} />;
  if (kind === "spell") {
    const src = spellIconUrl(name);
    return src ? <span className="game-icon" title={tip}><RefIcon src={src} className="gear" /></span> : <Icon name={CONCEPT_ICON.spell} title={tip} />;
  }
  if (kind === "art") {
    const src = artIconUrl(name);
    return src ? <span className="game-icon" title={tip}><RefIcon src={src} className="gear" /></span> : <Icon name={CONCEPT_ICON.art} title={tip} />;
  }
  return <Icon name={kind === "equipment" ? CONCEPT_ICON.equipment : kind === "rally" ? CONCEPT_ICON.rally : kind === "gambit" ? CONCEPT_ICON.battalion : CONCEPT_ICON.item} title={tip} />;
}

/** A saved inventory can lack its category; recover it from the game's weapon naming where it is unambiguous. */
function weaponKindFromName(name: string): string | null {
  const n = name.toLowerCase();
  if (/sword|blade|katana|rapier|wo dao/.test(n)) return "sword";
  if (/lance|spear|javelin|pike/.test(n)) return "lance";
  if (/axe|hatchet|hammer/.test(n)) return "axe";
  if (/bow|shot/.test(n)) return "bow";
  if (/gauntlet|knuckle|fist/.test(n)) return "gauntlets";
  return null;
}
