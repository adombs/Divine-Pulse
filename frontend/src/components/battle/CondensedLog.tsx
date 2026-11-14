/**
 * The condensed log: the replay's newest actions in the map's bottom-right corner (the Overview's map, and a video's
 * frame), one line each: who did it (their face), the action as an icon and its number, whom it was done to (their
 * face), and the defeat mark when that unit went down. A combat art, a spell and an active ability (a Rally) also
 * say their name; the rest is told by its picture: an attack by the weapon, a heal or item by its own icon, a gambit by
 * its own. Older lines fade a little; the newest is at the bottom. Its rows come from replayLabels.ts `condensedEntries`;
 * its text is the log's size.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { abilityIconUrl, gambitIconUrl, isCombatArt, itemIconUrl, RefIcon, spellIconUrl } from "../../reference/icons";
import { Icon } from "../Icon";
import { GearIcon, WeaponIcon } from "./gameIcons";
import { ICON, type Item } from "./model";
import { sideOf, UnitFace, useBattleNav } from "./parts";
import { actionName, CONDENSED_MAX, type CondensedEntry } from "./replayLabels";

/** The combat art an action used, if it was one: an art, or an attack made with one (not with a spell). */
function artOf(item: Item): string | null {
  const d = item.detail;
  if (!d) return null;
  if (item.kind === "art") return d;
  if (item.kind !== "attack") return null;
  return isCombatArt(d) || !(spellIconUrl(d) || itemIconUrl(d)) ? d : null;
}

/** The name a row says: a combat art's, a spell's (cast, or attacked with) or a Rally's; none for the rest. */
function shownName(item: Item): string | null {
  const d = item.detail || null;
  if (!d) return null;
  if (artOf(item)) return d;
  if (item.kind === "spell" || item.kind === "rally") return d;
  if ((item.kind === "attack" || item.kind === "heal") && spellIconUrl(d)) return d;
  return null;
}

/** The game's icon of a name, or the concept's when the game has none. */
function Own({ src, concept, title }: { src: string | null; concept: keyof typeof CONCEPT_ICON; title: string }) {
  return src ? <span className="game-icon" title={title}><RefIcon src={src} /></span> : <Icon name={CONCEPT_ICON[concept]} title={title} />;
}

/** An action's picture: the art's, the spell's, the item's, the Rally's ability, the gambit's, or the attacker's weapon. */
function ActionIcon({ item }: { item: Item }) {
  const who = useBattleNav().people.get(item.actor ?? "");
  const d = item.detail;
  const title = actionName(item);
  if (artOf(item)) return <GearIcon kind="art" name={d!} />;
  switch (item.kind) {
    case "attack":
      if (d && spellIconUrl(d)) return <Own src={spellIconUrl(d)} concept="spell" title={d} />;
      if (d && itemIconUrl(d)) return <Own src={itemIconUrl(d)} concept="attack" title={d} />;
      return <WeaponIcon kind={who?.unit?.weapon ?? who?.enemy?.weapon} label="Attack" />;
    case "spell":
    case "heal":
      return <Own src={d ? spellIconUrl(d) : null} concept={item.kind} title={title} />;
    case "item":
      return <Own src={d ? itemIconUrl(d) : null} concept="item" title={title} />;
    case "rally":
      return <Own src={d ? abilityIconUrl(d) : null} concept="rally" title={title} />;
    case "gambit":
      return <Own src={d ? gambitIconUrl(d) : null} concept="battalion" title={title} />;
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
        // A combat art's round badge stretches into an oval that holds its name, as the game's art badge would.
        const art = !!artOf(e.item);
        const icon = (
          <span className="condensed-icon">
            <ActionIcon item={e.item} />
          </span>
        );
        return (
          <li key={e.key} className={`condensed-row tone-${e.tone}${actor ? ` by-${sideOf(nav, actor)}` : ""}`} style={{ opacity }} title={actionName(e.item)}>
            {actor && <UnitFace id={actor} name={nameOf(actor)} size="sm" />}
            <span className="condensed-action">
              {art ? (
                <span className="condensed-art">
                  {icon}
                  <span className="condensed-name">{named}</span>
                </span>
              ) : (
                <>
                  {icon}
                  {named && <span className="condensed-name">{named}</span>}
                </>
              )}
              {e.value && <span className="condensed-value">{e.value}</span>}
            </span>
            {target && target !== actor && <UnitFace id={target} name={nameOf(target)} size="sm" />}
            {e.defeated && (
              <span className="condensed-defeat" title="Defeated">
                <Icon name={CONCEPT_ICON.defeat} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
