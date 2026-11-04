/**
 * The top of every character view (the battle window, the Roster's card, the Archive's character card, the run's
 * stats window): the face, the key facts, and what the view covers.
 *
 * Each view says its scope, because the same character means different numbers in each:
 * - battle: the unit in one battle (HP then, what it did there);
 * - run: the run's unit as last read from the game (the Roster);
 * - stats: the character added up over the run's finished battles;
 * - reference: the character in general, the same in every run (the Archive).
 *
 * Layouts: "flip" puts the face (a PortraitFlip) beside the facts; "split" puts a larger portrait on the left and the
 * map sprite on the right, the facts between them (the battle window).
 */
import type { ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import "./character.css";

export type CharacterScope = "battle" | "run" | "stats" | "reference";

export const SCOPE: Record<CharacterScope, { label: string; icon: IconName; title: string }> = {
  battle: { label: "In this battle", icon: CONCEPT_ICON.battle, title: "This unit as it was in this battle: its HP, gear and what it did here." },
  run: { label: "This run", icon: CONCEPT_ICON.roster, title: "This run's unit, as last read from the game." },
  stats: { label: "Whole run", icon: CONCEPT_ICON.history, title: "Added up over the run's finished battles." },
  reference: { label: "General reference", icon: CONCEPT_ICON.characters, title: "The character in general: the same in every run." },
};

/** What a character view covers: In this battle, This run, Whole run or General reference. */
export function ScopeTag({ scope }: { scope: CharacterScope }) {
  const s = SCOPE[scope];
  return (
    <span className={`cv-scope ${scope}`} title={s.title}>
      <Icon name={s.icon} />
      {s.label}
    </span>
  );
}

export type Fact = [label: ReactNode, value: ReactNode] | [label: ReactNode, value: ReactNode, key: string];

export function CharacterHero({
  layout,
  scope,
  face,
  sprite,
  facts,
  meta,
}: {
  layout: "flip" | "split";
  scope: CharacterScope;
  face: ReactNode;
  /** The map sprite, on the right ("split" only). */
  sprite?: ReactNode;
  facts: Fact[];
  /** Beside the scope tag, under the facts (the battalion). */
  meta?: ReactNode;
}) {
  return (
    // The box is the size container: a narrow card lays the hero out differently (character.css).
    <div className="cv-hero-box">
      <div className={`cv-hero ${layout} scope-${scope}`}>
        <div className="cv-hero-face">{face}</div>
        <dl className="cv-facts">
          {facts.map(([label, value, key], i) => (
            <div className="cv-fact" key={key ?? (typeof label === "string" ? label : i)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {layout === "split" && <div className="cv-hero-sprite">{sprite}</div>}
        <div className="cv-hero-meta">
          <ScopeTag scope={scope} />
          {meta}
        </div>
      </div>
    </div>
  );
}
