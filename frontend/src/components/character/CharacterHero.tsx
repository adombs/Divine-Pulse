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
 * Layouts: "flip" puts the face beside the facts; "split" puts a larger portrait on the left and the
 * map sprite on the right, the facts between them (the battle window).
 */
import { useState, type ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import "./character.css";

export type CharacterScope = "battle" | "run" | "stats" | "reference";

export const SCOPE: Record<CharacterScope, { label: string; icon: IconName; title: string }> = {
  battle: { label: "This Battle", icon: CONCEPT_ICON.battle, title: "This unit as it was in this battle: its HP, gear and what it did here." },
  run: { label: "This Run", icon: CONCEPT_ICON.roster, title: "This run's unit, as last read from the game." },
  stats: { label: "This Run", icon: CONCEPT_ICON.history, title: "Added up over the run's finished battles." },
  reference: { label: "General", icon: CONCEPT_ICON.characters, title: "The character in general: the same in every run." },
};

/** What a character view covers: This Battle, This Run or General. */
export function ScopeTag({ scope }: { scope: CharacterScope }) {
  const s = SCOPE[scope];
  return (
    <span className={`cv-scope ${scope}`} title={s.title}>
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
  backFacts,
  backFace,
  name = "Character",
}: {
  layout: "flip" | "split";
  scope: CharacterScope;
  face: ReactNode;
  /** The map sprite, on the right ("split" only). */
  sprite?: ReactNode;
  facts: Fact[];
  /** Biography on the reverse. Links and controls keep their own actions. */
  backFacts?: Fact[];
  backFace?: ReactNode;
  name?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const canFlip = !!backFacts;
  const side = (rows: Fact[], reverse = false) => (
    <div className={`cv-hero ${layout} scope-${scope} cv-info-side${reverse ? " cv-info-back" : ""}`} inert={canFlip && flipped !== reverse} aria-hidden={canFlip && flipped !== reverse ? true : undefined}>
      <div className="cv-hero-face">{reverse ? backFace ?? face : face}</div>
      <dl className="cv-facts">
        {rows.map(([label, value, key], i) => (
          <div className="cv-fact" key={key ?? (typeof label === "string" ? label : i)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {layout === "split" && <div className="cv-hero-sprite">{sprite}</div>}
    </div>
  );
  return (
    <div className={`cv-hero-box${canFlip ? " cv-information" : ""}${flipped ? " is-flipped" : ""}`}
      role={canFlip ? "group" : undefined} aria-label={canFlip ? `${name} information` : undefined}
      onClick={canFlip ? (event) => {
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button], [role=link]")) return;
        setFlipped((value) => !value);
      } : undefined}
    >
      <div className="cv-information-turn">
        {side(facts)}
        {backFacts && side(backFacts, true)}
      </div>
      {canFlip && <button type="button" className="cv-information-toggle" aria-pressed={flipped}
        aria-label={`Show ${flipped ? "front" : "back"} of ${name}'s information card`}
        onClick={() => setFlipped((value) => !value)}>
        <Icon name={CONCEPT_ICON.flip} /> {flipped ? "Name, class & crest" : "More information"}
      </button>}
    </div>
  );
}
