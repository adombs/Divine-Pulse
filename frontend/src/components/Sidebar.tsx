import { useState, type ReactNode } from "react";

/** A hover rail that also opens for keyboard focus, and closes with Escape without moving focus away. */
export function Sidebar({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const expanded = hovered || keyboardFocus;
  const collapse = () => {
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
        collapse();
      }}
    >
      {children}
    </aside>
  );
}
