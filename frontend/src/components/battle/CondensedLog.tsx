/**
 * The condensed log: the replay's newest actions in the map's bottom-right corner (the Overview's map, and a video's
 * frame), one line each: who did it (their face), the action's icon, its name and its number, whom it was done to (their
 * face), and the defeat mark when that unit went down. Older lines fade a little; the newest is at the bottom. Its rows
 * come from replayLabels.ts `condensedEntries`; its text is the log's size.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { LogIcon, UnitFace, useBattleNav } from "./parts";
import { actionName, type CondensedEntry } from "./replayLabels";

export function CondensedLog({ entries, current, fade = 1, className }: {
  entries: CondensedEntry[];
  /** The beat on the map: its own rows fade in with `fade` (0-1) as its action plays. */
  current: number | null;
  fade?: number;
  className?: string;
}) {
  const nav = useBattleNav();
  if (!entries.length) return null;
  const nameOf = (id: string) => nav.people.get(id)?.name ?? "A unit";
  return (
    <ol className={`condensed-log${className ? ` ${className}` : ""}`} aria-label="Recent actions">
      {entries.map((e, n) => {
        const { actor, target } = e.item;
        const age = entries.length - 1 - n;
        const opacity = (e.beat === current ? fade : 1) * Math.max(0.55, 1 - 0.15 * age);
        return (
          <li key={e.key} className={`condensed-row tone-${e.tone}`} style={{ opacity }}>
            {actor && <UnitFace id={actor} name={nameOf(actor)} size="sm" />}
            <span className="condensed-action">
              <span className="condensed-icon">
                <LogIcon item={e.item} />
              </span>
              <span className="condensed-name">{actionName(e.item)}</span>
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
