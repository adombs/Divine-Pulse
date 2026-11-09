/**
 * The app's sliders. `NotchedRange` is the one control under all of them: a bar with notches inside and the part up
 * to the value filled. `StepSlider` is the plain kind (zoom, text size): a few evenly spaced stops, each a notch.
 * It can add a leading icon and use the replay timeline's taller treatment. The replay's timeline uses NotchedRange's
 * taller "timeline" look, with a notch per step coloured by phase.
 */
import { ReactNode, useEffect, useRef, useState } from "react";
import { Icon, IconName } from "./Icon";

export interface Notch {
  at: number;
  className?: string;
}

/** A slider with notches drawn inside its bar (and the part up to the value filled). */
export function NotchedRange(p: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  notches: Notch[];
  label: string;
  valueText?: string;
  className?: string;
  /** Vertical controls increase from bottom to top. Horizontal is the default. */
  orientation?: "vertical";
  /** "timeline": as tall as the buttons beside it, squared off, with a bar for a thumb. */
  variant?: "timeline";
  step?: number | "any";
  /** Draws only as many of the notches as fit the bar's width (every 2nd, 5th, 10th...), so the bar's width is its
   * layout's to decide, never its number of stops'. The ends always have one. */
  fit?: boolean;
}) {
  const span = Math.max(1, p.max - p.min);
  const pct = (v: number) => `${((v - p.min) / span) * 100}%`;
  const box = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!p.fit || !el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [p.fit]);
  const every = p.fit ? notchStride(p.notches.length, width) : 1;
  const shown = every > 1 ? p.notches.filter((_, i) => i % every === 0 || i === p.notches.length - 1) : p.notches;
  // While the thumb is held the fill follows the input itself, at once: not after the re-render the new value brings
  // (slow when a map redraws with it) and not eased (it would trail behind a quick drag).
  const hold = () => {
    const el = box.current;
    if (!el) return;
    el.classList.add("held");
    const release = () => {
      el.classList.remove("held");
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };
  return (
    <span ref={box} className={`notched${p.variant ? ` ${p.variant}` : ""}${p.orientation ? ` ${p.orientation}` : ""}${p.className ? ` ${p.className}` : ""}`} style={{ ["--at" as string]: pct(p.value) }}>
      <span className="notched-track" aria-hidden>
        <span className="notched-fill" />
        {shown.map((n) => (
          <span key={n.at} className={`notch ${n.className ?? ""}`} style={p.orientation ? { bottom: pct(n.at) } : { left: pct(n.at) }} />
        ))}
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        onPointerDown={hold}
        onChange={(e) => {
          const v = Number(e.target.value);
          box.current?.style.setProperty("--at", pct(v));
          p.onChange(v);
        }}
        aria-label={p.label}
        aria-orientation={p.orientation}
        aria-valuetext={p.valueText}
      />
    </span>
  );
}

/** The least room between two notches that are drawn (px). */
const NOTCH_GAP = 6;
const STRIDES = [1, 2, 5, 10, 20, 25, 50, 100];

/** How many notches apart those drawn are, so that `count` of them across `width` px are at least NOTCH_GAP apart. */
export function notchStride(count: number, width: number): number {
  if (count < 2 || width <= 0) return 1;
  const gap = width / (count - 1);
  return STRIDES.find((k) => gap * k >= NOTCH_GAP) ?? STRIDES[STRIDES.length - 1];
}

/** A slider over `stops` evenly spaced stops (0 to stops - 1), a notch at each. `label` shows in front unless `bare`. */
export function StepSlider({
  label,
  stops,
  value,
  onChange,
  valueText,
  bare,
  after,
  icon,
  variant,
  slim,
}: {
  label: string;
  stops: number;
  value: number;
  onChange: (v: number) => void;
  valueText?: string;
  bare?: boolean;
  /** Shown after the slider (its value, a reset link). */
  after?: ReactNode;
  /** A single visual cue before a compact slider. */
  icon?: IconName;
  /** Use the squared, button-height replay timeline treatment. */
  variant?: "timeline";
  /** Half the timeline treatment's thickness (the map's zoom and speed sliders). */
  slim?: boolean;
}) {
  return (
    <span className="step-slider">
      {!bare && <span className="field-label">{label}</span>}
      {icon && <Icon name={icon} />}
      <NotchedRange
        min={0}
        max={stops - 1}
        value={value}
        onChange={onChange}
        notches={Array.from({ length: stops }, (_, i) => ({ at: i }))}
        label={label}
        valueText={valueText}
        variant={variant}
        className={slim ? "slim" : undefined}
        fit
      />
      {after}
    </span>
  );
}
