/**
 * The records carousel (History's Records, the Battle page's records): cards in one row that scroll on their own,
 * without end, when they don't all fit; drag, the wheel, the arrows and the arrow keys move it. Each row is an `<li>`
 * holding one focusable element (the copy that closes the loop takes them out of the tab order). The controls sit
 * beside the cards, never over them, with a pause button for the motion; reduced motion never scrolls on its own.
 */
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import "./carousel.css";

// Hovering a card or the controls holds the carousel still.
const HOVER_TARGET = ".award-grid > li, .award-controls";

/** One complete copy beyond the visible records lets the last slide join seamlessly to the first. */
export function Carousel({ rows, label = "records" }: { rows: ReactNode[]; label?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const offset = useRef(0);
  const lastFrame = useRef<number | null>(null);
  const drag = useRef<{ x: number; offset: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  const [size, setSize] = useState({ overflow: false, stride: 0, cycle: 0 });
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const render = () => {
    if (track.current) track.current.style.transform = `translateX(${-offset.current}px)`;
  };
  const normalize = () => {
    if (size.cycle) offset.current = ((offset.current % size.cycle) + size.cycle) % size.cycle;
  };
  const hoverTarget = (target: EventTarget | null, x?: number, y?: number) => {
    const el = viewport.current;
    const card = target instanceof Element ? target.closest(HOVER_TARGET) : null;
    // Inert loop copies do not receive pointer events; test their card bounds instead.
    const copy = el && x !== undefined && y !== undefined && target instanceof Node && el.contains(target)
      && Array.from(el.querySelectorAll(".award-copy > li")).some((item) => {
        const rect = item.getBoundingClientRect();
        return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
      });
    setHovered((!!card && !!el?.contains(card)) || !!copy);
  };
  const move = (amount: number) => {
    if (!size.cycle) return;
    offset.current += amount;
    normalize();
    render();
  };

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    const el = viewport.current;
    const original = list.current;
    if (!el || !original) return;
    const measure = () => {
      const first = original.children[0] as HTMLElement | undefined;
      const gap = parseFloat(getComputedStyle(original).columnGap) || 0;
      const next = {
        overflow: original.scrollWidth > el.clientWidth + 1,
        stride: (first?.getBoundingClientRect().width ?? 0) + gap,
        cycle: original.scrollWidth + gap,
      };
      setSize((old) => old.overflow === next.overflow && old.stride === next.stride && old.cycle === next.cycle ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(original);
    measure();
    return () => observer.disconnect();
  }, [rows.length]);
  useLayoutEffect(() => {
    if (!size.overflow) offset.current = 0;
    else normalize();
    render();
  }, [size.overflow, size.cycle]);
  useEffect(() => {
    if (!size.overflow || !size.cycle || reduced || paused) return;
    let frame = 0;
    const tick = (now: number) => {
      if (lastFrame.current !== null && !hovered && !focused && !drag.current) {
        offset.current += ((now - lastFrame.current) * 20) / 1000;
        normalize();
        render();
      }
      lastFrame.current = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      lastFrame.current = null;
    };
  }, [size.overflow, size.cycle, reduced, paused, hovered, focused]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // Mouse clicks must not leave a focused card or arrow holding the animation paused.
    setFocused(false);
    if (!size.overflow || event.button !== 0 || (event.target as HTMLElement).closest(".award-controls")) return;
    drag.current = { x: event.clientX, offset: offset.current, moved: false, pointerId: event.pointerId };
  };
  const dragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    if (!drag.current.moved && Math.abs(event.clientX - drag.current.x) > 5) {
      drag.current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!drag.current.moved) return;
    offset.current = drag.current.offset + drag.current.x - event.clientX;
    normalize();
    render();
  };
  const endDrag = (event: Pick<PointerEvent, "clientX" | "clientY" | "pointerType">) => {
    if (!drag.current) return;
    const ended = drag.current;
    drag.current = null;
    if (ended.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (viewport.current?.hasPointerCapture(ended.pointerId)) viewport.current.releasePointerCapture(ended.pointerId);
    }
    hoverTarget(event.pointerType === "touch" ? null : document.elementFromPoint(event.clientX, event.clientY), event.clientX, event.clientY);
  };

  useEffect(() => {
    // A release can happen outside the viewport before a drag starts capturing the pointer.
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!size.overflow) return;
      const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!amount) return;
      event.preventDefault();
      move(amount);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [size.overflow, size.cycle]);

  return (
    <div className={`award-carousel${size.overflow ? " overflowing" : ""}${size.overflow && !reduced && !paused ? " looping" : ""}`} ref={viewport}
      role="region" aria-roledescription="carousel" aria-label={label}
      onPointerOver={(event) => { if (event.pointerType !== "touch") hoverTarget(event.target, event.clientX, event.clientY); }}
      onPointerOut={(event) => { if (event.pointerType !== "touch") hoverTarget(event.relatedTarget, event.clientX, event.clientY); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        const target = event.target;
        setFocused((target as HTMLElement).matches(":focus-visible"));
        if (list.current?.contains(target) !== true || !(target as HTMLElement).matches(":focus-visible")) return;
        requestAnimationFrame(() => {
          if (!viewport.current || !list.current || document.activeElement !== target) return;
          const card = (target as HTMLElement).getBoundingClientRect();
          const bounds = (viewport.current.querySelector(".award-window") ?? viewport.current).getBoundingClientRect();
          if (card.left < bounds.left + 32 || card.right > bounds.right - 32) {
            offset.current = (offset.current + card.left - bounds.left - 32 + size.cycle) % size.cycle;
            render();
          }
          // Browsers may also scroll the overflow container natively when a descendant receives focus.
          viewport.current.scrollLeft = 0;
          const win = viewport.current.querySelector<HTMLElement>(".award-window");
          if (win) win.scrollLeft = 0;
        });
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
      }}
      onPointerDown={beginDrag} onPointerMove={(event) => {
        if (event.pointerType !== "touch") hoverTarget(document.elementFromPoint(event.clientX, event.clientY), event.clientX, event.clientY);
        dragMove(event);
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        setFocused(true);
        if (event.key === "ArrowLeft") { event.preventDefault(); move(-size.stride); }
        if (event.key === "ArrowRight") { event.preventDefault(); move(size.stride); }
      }}>
      <div className="award-window">
        <div className="award-track" ref={track}>
          <ul className="award-grid" ref={list}>{rows}</ul>
          {size.overflow && <ul className="award-grid award-copy" aria-hidden="true" inert>{rows}</ul>}
        </div>
      </div>
      {size.overflow && (
        <div className="award-controls">
          <button type="button" className="award-arrow prev" aria-label={`Previous ${label}`} title={`Previous ${label}`} onClick={() => move(-size.stride)}>
            <Icon name={CONCEPT_ICON.prev} />
          </button>
          {!reduced && (
            <button type="button" className="award-arrow pause" aria-pressed={paused} aria-label={paused ? `Resume scrolling ${label}` : `Pause scrolling ${label}`}
              title={paused ? "Resume scrolling" : "Pause scrolling"} onClick={() => setPaused((p) => !p)}>
              <Icon name={paused ? CONCEPT_ICON.play : CONCEPT_ICON.pause} />
            </button>
          )}
          <button type="button" className="award-arrow next" aria-label={`Next ${label}`} title={`Next ${label}`} onClick={() => move(size.stride)}>
            <Icon name={CONCEPT_ICON.next} />
          </button>
        </div>
      )}
    </div>
  );
}
