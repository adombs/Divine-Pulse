/**
 * A unit's card in the video's team overview: the smallest card that still reads in a frame. Face, name and class, the
 * stats, the weapon or spell it used most in the battle, its accessory and battalion, and its abilities as bare icons.
 * Nothing else (the Export Team picture's LoadoutCard has the rest). Drawn in one of two shapes: `row` (everything on
 * one line, for a wide frame) or `stack` (face and abilities over the stats over the gear, for a narrow one).
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { LABELS, type Unit } from "../../api";
import { tidyAbility } from "../../appearance";
import { AbilityIcon, ItemIcon } from "../../reference/icons";
import type { Featured } from "../../exporting/mostUsed";
import { Icon } from "../Icon";
import { GearIcon } from "./gameIcons";
import { STATS, UnitFaceImage, type ExportFace } from "../TeamExport";

export type CardShape = "row" | "stack";

export function VideoUnitCard({ unit, part2, face, shape, featured }: { unit: Unit; part2: boolean; face: ExportFace; shape: CardShape; featured: Featured | null }) {
  const abilities = [unit.personal_ability, ...unit.abilities].filter(Boolean).map(tidyAbility);
  return (
    <article className={`vcard vcard-${shape}${unit.death ? " fallen" : ""}`} data-vcard>
      <div className="vcard-face">
        <UnitFaceImage unit={unit} part2={part2} size={shape === "row" ? 48 : 40} face={face} />
      </div>
      <div className="vcard-id">
        <b>{unit.name}</b>
        <span>{unit.class_name || "—"}</span>
      </div>
      <dl className="vcard-stats">
        {STATS.map((k) => (
          <div key={k} className={unit.blue.includes(k) ? "boosted" : undefined}>
            <dt>{LABELS[k]}</dt>
            <dd>{unit.displayed[k]}</dd>
          </div>
        ))}
      </dl>
      <div className="vcard-gear">
        {featured && (
          <p>
            <GearIcon kind={featured.kind} weapon={featured.weapon} name={featured.name} />
            <span>{featured.name}</span>
          </p>
        )}
        {unit.accessory && (
          <p>
            <ItemIcon name={unit.accessory} />
            <span>{unit.accessory}</span>
          </p>
        )}
        {unit.battalion && (
          <p className="vcard-battalion">
            <Icon name={CONCEPT_ICON.battalion} />
            <span>{unit.battalion}</span>
          </p>
        )}
      </div>
      {abilities.length > 0 && (
        <div className="vcard-abilities">
          {abilities.map((a, i) => (
            <span key={`${a}-${i}`} role="img" aria-label={a} title={a}>
              <AbilityIcon name={a} />
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
