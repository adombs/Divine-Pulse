import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** A hover rail that can also be held open, or dismissed without moving focus away. */
export function Sidebar({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const expanded = pinned || hovered || keyboardFocus;
  const collapse = () => {
    setPinned(false);
    setHovered(false);
    setKeyboardFocus(false);
  };

  return (
    <aside
      className="sidebar"
      data-expanded={expanded}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => { if (event.target.matches(":focus-visible")) setKeyboardFocus(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        event.stopPropagation();
        toggle.current?.focus();
        collapse();
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="side-tab side-nav-toggle"
        aria-expanded={expanded}
        aria-controls="sidebar-pages"
        aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
        title={expanded ? "Collapse navigation (Esc)" : "Expand navigation"}
        onClick={() => { if (expanded) collapse(); else setPinned(true); }}
      >
        <span className="side-diamond"><Icon name={expanded ? "prev" : "next"} /></span>
        <span className="side-label">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {children}
    </aside>
  );
}
