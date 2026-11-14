/**
 * The condensed log: the replay's newest actions in the map's bottom-right corner (the Overview's map, and a video's
 * frame), one line each: who did it (their face), the action as an oval, and whom it was done to (their face). The
 * oval, styled like the log's number chips, holds the action's icon in the doer's army colour, its name for a combat
 * art, a spell, an active ability (a Rally) or a gambit, and its number. A combat art shows the weapon it is used with
 * (a star for one used with none) and a spell its magic's plain glyph; an attack shows the attacker's weapon, and a
 * heal, item, Rally or gambit its own icon. Older lines fade a little; the newest is at the bottom. Its rows come from
 * replayLabels.ts `condensedEntries`; its text is the log's size.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { abilityIconUrl, artWeaponKind, gambitIconUrl, isCombatArt, itemIconUrl, RefIcon, spellIconUrl, spellMagic } from "../../reference/icons";
import { Icon } from "../Icon";
import { WeaponIcon } from "./gameIcons";
import { ICON, type Item } from "./model";
import { sideOf, UnitFace, useBattleNav } from "./parts";
import { actionName, CONDENSED_MAX, type CondensedEntry } from "./replayLabels";

const isSpell = (name: string) => !!(spellMagic(name) || spellIconUrl(name));

/** The combat art an action used, if it was one: an art, or an attack made with one (not with a spell or an item). */
function artOf(item: Item): string | null {
  const d = item.detail;
  if (!d) return null;
  if (item.kind === "art") return d;
  if (item.kind !== "attack") return null;
  return isCombatArt(d) || !(isSpell(d) || itemIconUrl(d)) ? d : null;
}

/** The spell an action cast, if it was one: a spell, or an attack or heal made with one. */
function spellOf(item: Item): string | null {
  const d = item.detail;
  if (!d || artOf(item)) return null;
  if (item.kind === "spell") return d;
  return (item.kind === "attack" || item.kind === "heal") && isSpell(d) ? d : null;
}

/** The name an oval says: a combat art's, a spell's, a Rally's or a gambit's; none for the rest. */
const shownName = (item: Item): string | null => artOf(item) ?? spellOf(item) ?? (item.kind === "rally" || item.kind === "gambit" ? item.detail || null : null);

/** The game's icon of a name, or the concept's when the game has none. */
function Own({ src, concept, title, className }: { src: string | null; concept: keyof typeof CONCEPT_ICON; title: string; className?: string }) {
  return src ? <span className={`game-icon${className ? ` ${className}` : ""}`} title={title}><RefIcon src={src} /></span> : <Icon name={CONCEPT_ICON[concept]} title={title} />;
}

/** An action's picture: an art's weapon (or a star), a spell's magic, the attacker's weapon, or the game's own icon. */
function ActionIcon({ item }: { item: Item }) {
  const who = useBattleNav().people.get(item.actor ?? "");
  const d = item.detail;
  const title = actionName(item);
  const art = artOf(item);
  if (art) {
    const weapon = artWeaponKind(art);
    return weapon ? <WeaponIcon kind={weapon} label={art} /> : <Icon name={CONCEPT_ICON.star} title={art} weight="fill" className="condensed-star" />;
  }
  const spell = spellOf(item);
  if (spell) {
    const magic = spellMagic(spell);
    return magic ? <WeaponIcon kind={magic} label={spell} /> : <Icon name={CONCEPT_ICON.spell} title={spell} />;
  }
  switch (item.kind) {
    case "attack":
      if (d && itemIconUrl(d)) return <Own src={itemIconUrl(d)} concept="attack" title={d} className="condensed-round" />;
      return <WeaponIcon kind={who?.unit?.weapon ?? who?.enemy?.weapon} label="Attack" />;
    case "heal":
      return <Icon name={CONCEPT_ICON.heal} title={title} />;
    case "item":
      return <Own src={d ? itemIconUrl(d) : null} concept="item" title={title} className="condensed-round" />;
    case "rally":
      return <Own src={d ? abilityIconUrl(d) : null} concept="rally" title={title} className="condensed-round" />;
    case "gambit":
      return <Own src={d ? gambitIconUrl(d) : null} concept="battalion" title={title} className="condensed-gambit" />;
    default:
      return <Icon name={ICON[item.kind] ?? CONCEPT_ICON.wait} title={title} />;
  }
}

export function CondensedLog({ entries, current, fade = 1, lines = CONDENSED_MAX, size = 1, className }: {
  entries: CondensedEntry[];
  /** The beat on the map: its own rows fade in with `fade` (0-1) as its action plays. */
  current: number | null;
  fade?: number;
  /** The most rows shown (the newest). */
  lines?: number;
  /** How big it is against the text around it (1: the same). */
  size?: number;
  className?: string;
}) {
  const nav = useBattleNav();
  const shown = entries.slice(Math.max(0, entries.length - lines));
  if (!shown.length) return null;
  const nameOf = (id: string) => nav.people.get(id)?.name ?? "A unit";
  return (
    <ol className={`condensed-log${className ? ` ${className}` : ""}`} aria-label="Recent actions" style={size !== 1 ? { fontSize: `${size}em` } : undefined}>
      {shown.map((e, n) => {
        const { actor, target } = e.item;
        const age = shown.length - 1 - n;
        const opacity = (e.beat === current ? fade : 1) * Math.max(0.55, 1 - 0.12 * age);
        const named = shownName(e.item);
        return (
          <li key={e.key} className={`condensed-row tone-${e.tone}${actor ? ` by-${sideOf(nav, actor)}` : ""}`} style={{ opacity }} title={actionName(e.item)}>
            {actor && <UnitFace id={actor} name={nameOf(actor)} size="sm" />}
            <span className="condensed-action">
              <span className="condensed-icon">
                <ActionIcon item={e.item} />
              </span>
              {named && <span className="condensed-name">{named}</span>}
              {e.value && <span className="condensed-value">{e.value}</span>}
            </span>
            {target && target !== actor && <UnitFace id={target} name={nameOf(target)} size="sm" />}
          </li>
        );
      })}
    </ol>
  );
}
