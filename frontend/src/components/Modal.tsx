/**
 * A window over the page (the full battle log): the page dims, the panel rises into view, and it sinks away again on
 * close (the close button, Escape, or a click outside it). Windows can open over each other (a character over the
 * log): Escape closes the top one.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CardBanner } from "./ui";
import { Icon } from "./Icon";

const CLOSE_MS = 200;
// The open windows, newest last.
const stack: object[] = [];

export function Modal({
  open,
  onClose,
  title,
  icon,
  actions,
  children,
  wide,
  className,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Replaces the crest in the banner. */
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  // Kept on screen a moment after closing, for the way out.
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && stack[stack.length - 1] === me) {
        const focusable = panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) { e.preventDefault(); panel.current?.focus(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current || !panel.current?.contains(document.activeElement))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
          e.preventDefault(); first.focus();
        }
      }
      if (e.key === "Escape" && stack[stack.length - 1] === me) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      before?.focus?.();
    };
  }, [open]);
  if (!shown) return null;
  return createPortal(
    <div className={`modal-backdrop${closing ? " closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)} tabIndex={-1} ref={panel}>
        <header className="modal-head">
          <CardBanner title={title} icon={icon} />
          <span className="modal-actions">
            {actions}
            <button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
              <Icon name={CONCEPT_ICON.close} />
            </button>
          </span>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
