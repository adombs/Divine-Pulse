/**
 * The app's sliders. `NotchedRange` is the one control under all of them: a bar with notches inside and the part up
 * to the value filled. `StepSlider` is the plain kind (zoom, text size): a few evenly spaced stops, each a notch.
 * It can add a leading icon and use the replay timeline's taller treatment. The replay's timeline uses NotchedRange's
 * taller "timeline" look, with a notch per step coloured by phase.
 */
import { ReactNode, useRef } from "react";
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
  /** "timeline": as tall as the buttons beside it, squared off, with a bar for a thumb. */
  variant?: "timeline";
  step?: number | "any";
}) {
  const span = Math.max(1, p.max - p.min);
  const pct = (v: number) => `${((v - p.min) / span) * 100}%`;
  const box = useRef<HTMLSpanElement>(null);
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
    <span ref={box} className={`notched${p.variant ? ` ${p.variant}` : ""}${p.className ? ` ${p.className}` : ""}`} style={{ ["--at" as string]: pct(p.value) }}>
      <span className="notched-track" aria-hidden>
        <span className="notched-fill" />
        {p.notches.map((n) => (
          <span key={n.at} className={`notch ${n.className ?? ""}`} style={{ left: pct(n.at) }} />
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
        aria-valuetext={p.valueText}
      />
    </span>
  );
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
      />
      {after}
    </span>
  );
}
