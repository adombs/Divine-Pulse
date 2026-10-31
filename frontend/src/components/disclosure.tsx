/**
 * Showing more on request, the same way everywhere: `Collapse` slides a body open and shut; an `Accordion` keeps one
 * of its sections open at a time (opening one closes the others), so a card's sections all fit on screen as headers
 * with a preview and none is out of sight below the fold. Detail cards are accordions: their Sections and Folds join
 * in by themselves.
 */
import { createContext, ReactNode, useContext, useId, useState } from "react";

/** A body that slides open and shut. What's inside is only rendered once it has been opened. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className={`collapse${open ? " open" : ""}`} inert={!open}>
      <div className="collapse-inner">{seen && children}</div>
    </div>
  );
}

interface AccordionState {
  /** The open section's id; undefined until one is picked (then each section's own default holds). */
  open: string | null | undefined;
  setOpen: (id: string | null) => void;
}

const AccordionContext = createContext<AccordionState | null>(null);

/** One section open at a time among the Sections and Folds inside. */
export function Accordion({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  return <AccordionContext.Provider value={{ open, setOpen }}>{children}</AccordionContext.Provider>;
}

/** Sections inside are laid out as usual (an accordion further up doesn't reach them). */
export function NoAccordion({ children }: { children: ReactNode }) {
  return <AccordionContext.Provider value={null}>{children}</AccordionContext.Provider>;
}

export const useInAccordion = () => useContext(AccordionContext) !== null;

/**
 * Whether a section is open and how to toggle it: one of the accordion's sections when there is one, else on its own.
 * `id` names it in the accordion (its title, usually).
 */
export function useDisclosure(id: string | undefined, initial = false) {
  const accordion = useContext(AccordionContext);
  const auto = useId();
  const key = id ?? auto;
  const [own, setOwn] = useState(initial);
  if (accordion) {
    const open = accordion.open === undefined ? initial : accordion.open === key;
    return { open, toggle: () => accordion.setOpen(open ? null : key) };
  }
  return { open: own, toggle: () => setOwn((o) => !o) };
}
