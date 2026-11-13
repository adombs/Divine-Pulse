/**
 * A unit's card in the video's team overview, a poster: the face with the name and class printed over it, the ten stats
 * in a 5 x 2 grid beside it with the abilities as bare icons centred in the space under them, and under both the list of
 * what the unit used in the battle (weapons, spells and combat arts, each with its count), its accessory and its
 * battalion. Nothing else (the Export Team picture's LoadoutCard has the rest). The card fills its grid cell: the list
 * keeps the height of the longest list on the page (`--list-h`, set by TeamPages.tsx) and the face takes all the room left.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { LABELS, type Unit } from "../../api";
import { tidyAbility } from "../../appearance";
import { AbilityIcon, ItemIcon } from "../../reference/icons";
import type { CardGear } from "../../exporting/usageList";
import { Icon } from "../Icon";
import { GearIcon } from "./gameIcons";
import { STATS, UnitFaceImage, type ExportFace } from "../TeamExport";

/** The face's width, and its least height, at the card's natural size (px). */
export const POSTER = 168;

export function VideoUnitCard({ unit, part2, face, gear, poster = POSTER }: { unit: Unit; part2: boolean; face: ExportFace; gear: CardGear; poster?: number }) {
  const abilities = [unit.personal_ability, ...unit.abilities].filter(Boolean).map(tidyAbility);
  const listed = gear.used.length > 0 || gear.accessory || gear.battalion;
  return (
    <article className={`vcard${unit.death ? " fallen" : ""}`} data-vcard style={{ "--poster": `${poster}px` } as React.CSSProperties}>
      <div className="vcard-poster">
        <UnitFaceImage unit={unit} part2={part2} size={poster} face={face} />
        <div className="vcard-name">
          <b>{unit.name}</b>
          <span>{unit.class_name || "—"}</span>
        </div>
      </div>
      <div className="vcard-side">
        <dl className="vcard-stats">
          {STATS.map((k) => (
            <div key={k} className={unit.blue.includes(k) ? "boosted" : undefined}>
              <dt>{LABELS[k]}</dt>
              <dd>{unit.displayed[k]}</dd>
            </div>
          ))}
        </dl>
        {abilities.length > 0 && (
          <div className="vcard-abilities">
            {abilities.map((a, i) => (
              <span key={`${a}-${i}`} role="img" aria-label={a} title={a}>
                <AbilityIcon name={a} />
              </span>
            ))}
          </div>
        )}
      </div>
      {listed && (
        <ul className="vcard-list">
          {gear.used.map((it) => (
            <li key={`${it.kind}-${it.name}`}>
              <GearIcon kind={it.kind} weapon={it.weapon} name={it.name} />
              <span className="vcard-item">{it.name}</span>
              <span className="vcard-times">×{it.times}</span>
            </li>
          ))}
          {gear.accessory && (
            <li className="vcard-accessory">
              <span className="vcard-glyph"><ItemIcon name={gear.accessory} /></span>
              <span className="vcard-item">{gear.accessory}</span>
            </li>
          )}
          {gear.battalion && (
            <li className="vcard-battalion">
              <span className="vcard-glyph"><Icon name={CONCEPT_ICON.battalion} /></span>
              <span className="vcard-item">{gear.battalion}</span>
              {gear.gambits != null && <span className="vcard-times">×{gear.gambits}</span>}
            </li>
          )}
        </ul>
      )}
    </article>
  );
}
