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
 * map sprite on the right, the facts between them (the battle window). With `backFace` (the Roster and the
 * Archive), the face is part of the information card: the front shows the portrait, the back the map sprite.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  /** With `backFacts`: the face turns with the card, and this (the map sprite) is on the back. */
  backFace?: ReactNode;
  name?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const canFlip = !!backFacts;
  const carded = canFlip && backFace !== undefined;
  const flip = () => {
    restoreFocus.current = document.activeElement === frontButton.current || document.activeElement === backButton.current;
    setFlipped((value) => !value);
  };
  useLayoutEffect(() => {
    if (restoreFocus.current) {
      (flipped ? backButton : frontButton).current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [flipped]);
  const side = (rows: Fact[], reverse = false) => (
    <div className={`cv-info-side${reverse ? " cv-info-back" : ""}${carded ? " with-face" : ""}`} inert={canFlip && flipped !== reverse} aria-hidden={canFlip && flipped !== reverse ? true : undefined}>
      {carded && <div className="cv-info-face">{reverse ? backFace : face}</div>}
      <dl className="cv-facts">
        {rows.map(([label, value, key], i) => (
          <div className="cv-fact" key={key ?? (typeof label === "string" ? label : i)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {canFlip && <button ref={reverse ? backButton : frontButton} type="button" className="cv-information-toggle"
        tabIndex={flipped === reverse ? 0 : -1}
        aria-label={`Flip ${name}'s information card to ${reverse ? "front facts" : "biography"}`}
        title={`Show ${reverse ? "front facts" : "biography"}`}
        onClick={flip}>
        <Icon name={CONCEPT_ICON.flip} /> Flip
      </button>}
    </div>
  );
  return (
    <div className="cv-hero-box">
      <div className={`cv-hero ${layout} scope-${scope}${carded ? " carded" : ""}`}>
        {!carded && <div className="cv-hero-face">{face}</div>}
        <div className={`cv-information${flipped ? " is-flipped" : ""}`}
          role="group" aria-label={`${name} information`}
          onClick={canFlip ? (event) => {
            if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button], [role=link]")) return;
            flip();
          } : undefined}>
          <div className="cv-information-turn">
            {side(facts)}
            {backFacts && side(backFacts, true)}
          </div>
        </div>
        {layout === "split" && <div className="cv-hero-sprite">{sprite}</div>}
      </div>
    </div>
  );
}
