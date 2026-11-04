/**
 * The window a character opens in, wherever one can be clicked. What it shows depends on where it was opened from,
 * and its header says so (the scope tag):
 * - "battle": the unit in that battle (its stats, HP, inventory, what it did), from the Battle page (units, map, log);
 * - "roster": the run's unit (its Status page), from the Roster;
 * - "stats": the character over the run's battles, from History and the battle's Records;
 * - "reference": the character in general (growths, classes, supports), from the Archive.
 *
 * Every window is the same size (components/character/character.css: --character-popup-w / -h), whichever view and
 * section is showing: the card's hero stays put and the picked section scrolls inside it. Each page passes in its
 * own card; the cards are DetailCards, which drop their banner inside the popup (the window has its own). Closes on
 * the X, Escape or a click outside it.
 */
import { createContext, ReactNode, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import { ScopeTag } from "./character/CharacterHero";
import type { CharacterScope } from "./character/CharacterHero";
import "./character/character.css";

export type CharacterContext = "battle" | "roster" | "stats" | "reference";

const SCOPE_OF: Record<CharacterContext, CharacterScope> = { battle: "battle", roster: "run", stats: "stats", reference: "reference" };

const InPopup = createContext(false);
const ActionSlot = createContext<HTMLElement | null>(null);

/** Whether this is inside a character popup (cards leave out their own banner there). */
export const useInPopup = () => useContext(InPopup);

/** A card's actions, shown in the popup's own header beside the name instead of in the card. */
export function PopupActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionSlot);
  return slot ? createPortal(children, slot) : null;
}

export function CharacterPopup({
  open,
  onClose,
  title,
  icon,
  context,
  scope,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  context: CharacterContext;
  /** Replaces the header's scope tag (by default, the one for `context`). */
  scope?: ReactNode;
  children: ReactNode;
}) {
  // While it closes, it keeps showing the character it had.
  const last = useRef({ title, icon, children });
  if (open) last.current = { title, icon, children };
  // The card's own actions are drawn into the window's header, beside the name.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="cv-banner-name">{last.current.title}<span className="cv-popup-scope">{scope ?? <ScopeTag scope={SCOPE_OF[context]} />}</span></span>}
      ariaLabel={typeof last.current.title === "string" ? last.current.title : undefined}
      icon={last.current.icon}
      actions={
        <>
          <span className="popup-card-actions" ref={setSlot} />
        </>
      }
      className={`character-popup ${context}`}
    >
      <InPopup.Provider value>
        <ActionSlot.Provider value={slot}>{last.current.children}</ActionSlot.Provider>
      </InPopup.Provider>
    </Modal>
  );
}
