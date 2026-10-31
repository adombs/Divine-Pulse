/**
 * The window a character opens in, wherever one can be clicked. What it shows depends on where it was opened from:
 * - "battle": the unit in that battle (its stats, HP, inventory, what it did), from the Battle page (units, map, log);
 * - "roster": the run's unit (its Status page), from the Roster;
 * - "stats": the character over the run's battles, from History;
 * - "reference": the character in general (growths, classes, supports), from the Characters page.
 * Each page passes in its own card; the cards are DetailCards, which drop their banner inside the popup (the window
 * has its own). Closes on the X, Escape or a click outside it.
 */
import { createContext, ReactNode, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";

export type CharacterContext = "battle" | "roster" | "stats" | "reference";

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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  context: CharacterContext;
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
      title={last.current.title}
      icon={last.current.icon}
      actions={<span className="popup-card-actions" ref={setSlot} />}
      className={`character-popup ${context}`}
    >
      <InPopup.Provider value>
        <ActionSlot.Provider value={slot}>{last.current.children}</ActionSlot.Provider>
      </InPopup.Provider>
    </Modal>
  );
}
