/**
 * A unit's card in the video's team overview, compact: a header line (name and class), under it a small face beside
 * the ten stats in a 5 x 2 grid with the abilities as a centred row of icons under them, and under both ten fixed slots (2 columns x 5 rows) listing what
 * the unit used in the battle (weapons, spells and combat arts, each with its count), the equipped item and the battalion in a fixed bottom row;
 * `cardSlots` (exporting/usageList.ts) fills them. Nothing else (the Export Team picture's LoadoutCard has the rest).
 * Every card is the same size, whatever the unit has, and keeps its own proportions: a taller grid cell leaves room around it, never inside it.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { LABELS, type Unit } from "../../api";
import { tidyAbility } from "../../appearance";
import { AbilityIcon, ItemIcon } from "../../reference/icons";
import { cardSlots, type CardGear } from "../../exporting/usageList";
import { Icon } from "../Icon";
import { GearIcon } from "./gameIcons";
import { STATS, UnitFaceImage, type ExportFace } from "../TeamExport";

/** The face's width and height at the card's natural size (px): about the height of the two rows of stats beside it. */
export const FACE = 100;

export function VideoUnitCard({ unit, part2, face, markFallen, gear }: { unit: Unit; part2: boolean; face: ExportFace; markFallen: boolean; gear: CardGear }) {
  const abilities = [unit.personal_ability, ...unit.abilities].filter(Boolean).map(tidyAbility);
  return (
    <article className={`vcard${markFallen && unit.death ? " fallen" : ""}`} data-vcard>
      <header className="vcard-head">
        <b className="vcard-name">{unit.name}</b>
        <span className="vcard-class">{unit.class_name || "—"}</span>
      </header>
      <div className="vcard-mid">
        <div className="vcard-face">
          <UnitFaceImage unit={unit} part2={part2} size={FACE} face={face} />
        </div>
        <div className="vcard-right">
          <dl className="vcard-stats">
            {STATS.map((k) => (
              <div key={k} className={unit.blue.includes(k) ? "boosted" : undefined}>
                <dt>{LABELS[k]}</dt>
                <dd>{unit.displayed[k]}</dd>
              </div>
            ))}
          </dl>
          <div className="vcard-abilities">
            {abilities.map((ab, i) => (
              <span key={`${ab}-${i}`} role="img" aria-label={ab} title={ab}>
                <AbilityIcon name={ab} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <ul className="vcard-list">
        {cardSlots(gear).map((slot, i) => {
          switch (slot.type) {
            case "used":
              return (
                <li key={i} title={slot.item.name}>
                  <GearIcon kind={slot.item.kind} weapon={slot.item.weapon} name={slot.item.name} />
                  <span className="vcard-item">{slot.item.name}</span>
                  <span className="vcard-times">×{slot.item.times}</span>
                </li>
              );
            case "more":
              return <li key={i} className="vcard-more"><span className="vcard-item">+{slot.count} more</span></li>;
            case "accessory":
              return (
                <li key={i} className={slot.name ? "vcard-accessory" : "vcard-none"} title={slot.name ?? undefined}>
                  <span className="vcard-glyph">{slot.name ? <ItemIcon name={slot.name} /> : <Icon name={CONCEPT_ICON.equipment} />}</span>
                  <span className="vcard-item">{slot.name ?? "No Equipment"}</span>
                </li>
              );
            case "battalion":
              return (
                <li key={i} className={slot.name ? "vcard-battalion" : "vcard-none"} title={slot.name ?? undefined}>
                  <span className="vcard-glyph"><Icon name={CONCEPT_ICON.battalion} /></span>
                  <span className="vcard-item">{slot.name ?? "No Battalion"}</span>
                  {slot.gambits != null && <span className="vcard-times">×{slot.gambits}</span>}
                </li>
              );
            default:
              return <li key={i} className="vcard-empty" aria-hidden />;
          }
        })}
      </ul>
    </article>
  );
}
