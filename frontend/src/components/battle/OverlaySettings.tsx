import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { Switch } from "../ui";
import { StepSlider } from "../Slider";
import { cornerStacks, CORNERS, MAX_CONDENSED_LINES, OVERLAY_SIZES, type Corner, type Overlay, type VideoLogOptions, setCounterField, setCounterEnabled, placeOverlay, loadBattleOverlaySettings, saveBattleOverlaySettings } from "../../exporting/videoLog";
import "../export.css";
import "./replay-export.css";
const CORNER_NAME: Record<Corner, string> = { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-right": "Bottom right" };
const OVERLAY_NAME: Record<Overlay, string> = { condensed: "Condensed log", counter: "Turn counter", counts: "Unit counts" };

/** One thing the frame can show: its name and what it is, a switch, and its settings while it's on. */
export function LayoutSection({ title, note, on, onToggle, children, always }: { always?: ReactNode; title: string; note: string; on: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <section className={`layout-item${on ? " on" : ""}`}>
      <div className="layout-item-head">
        <div className="layout-item-text">
          <h4>{title}</h4>
          <p>{note}</p>
        </div>
        <Switch checked={on} onChange={onToggle} label={`Show the ${title.toLowerCase()}`} />
      </div>
      {always}
      {on && <div className="layout-item-body">{children}</div>}
    </section>
  );
}

/** Which of the map's corners something over it sits in: a small outline of the map whose corners are clicked (arrow
 * keys move between them). A corner's hover text names what else is already there. */
export function CornerPicker({ label, which, log, onChange }: { label: string; which: Overlay; log: VideoLogOptions; onChange: (corner: Corner) => void }) {
  const value = log.place[which];
  const stacks = cornerStacks(log);
  const refs = useRef<Partial<Record<Corner, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [v, h] = value.split("-") as ["top" | "bottom", "left" | "right"];
    const next: Corner | null =
      e.key === "ArrowUp" ? `top-${h}` : e.key === "ArrowDown" ? `bottom-${h}` : e.key === "ArrowLeft" ? `${v}-left` : e.key === "ArrowRight" ? `${v}-right` : null;
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="corner-field">
      <span className="field-label">Corner</span>
      <div className="corner-box" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {CORNERS.map((corner) => {
          const others = stacks[corner].filter((o) => o !== which);
          const picked = corner === value;
          return (
            <button
              key={corner}
              ref={(el) => { refs.current[corner] = el; }}
              type="button"
              role="radio"
              aria-checked={picked}
              tabIndex={picked ? 0 : -1}
              className={`corner-spot ${corner}${picked ? " on" : ""}`}
              title={`${CORNER_NAME[corner]}${others.length ? ` (with the ${others.map((o) => OVERLAY_NAME[o].toLowerCase()).join(" and ")})` : ""}`}
              aria-label={CORNER_NAME[corner]}
              onClick={() => onChange(corner)}
            />
          );
        })}
      </div>
      <span className="corner-name">{CORNER_NAME[value]}</span>
    </div>
  );
}

/** How big something over the map is (OVERLAY_SIZES), as a percentage. */
export function SizeSlider({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const pct = `${Math.round(value * 100)}%`;
  return (
    <StepSlider
      label="UI Size"
      stops={OVERLAY_SIZES.length}
      value={Math.max(0, OVERLAY_SIZES.indexOf(value as (typeof OVERLAY_SIZES)[number]))}
      onChange={(i) => onChange(OVERLAY_SIZES[i])}
      valueText={pct}
      after={<span className="team-pages-axis-value">{pct}</span>}
      variant="timeline"
      slim
    />
  );
}

export function CounterFields({ log, onChange }: { log: VideoLogOptions; onChange: (next: VideoLogOptions) => void }) {
  return <div className="overlay-counter-fields" role="group" aria-label="Turn counter contents">
    {([ ["counterTurn", "Turn count"], ["counterPhase", "Phase"], ["counterStep", "Step count"] ] as const).map(([field, label]) =>
      <label key={field}><input type="checkbox" checked={log[field]} onChange={(e) => onChange(setCounterField(log, field, e.target.checked))} /> {label}</label>)}
  </div>;
}
export function ZeroCounts({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="overlay-zero-counts"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> Include zero counts</label>;
}

/** The battle page's overlay choices, saved independently of the export settings. */
export function BattleReplaySettings() {
  const [layout, setLayout] = useState(loadBattleOverlaySettings);
  const updateLayout = (next: VideoLogOptions) => {
    setLayout(next);
    saveBattleOverlaySettings(next);
  };
  const patch = (changes: Partial<VideoLogOptions>) => updateLayout({ ...layout, ...changes });
  return <div className="export-group export-layout map-overlay-settings">
    {(["condensed", "counter", "counts"] as Overlay[]).map((item) => {
      const title = item === "condensed" ? "Condensed log" : item === "counter" ? "Turn counter" : "Unit counts";
      const sizeKey = item === "condensed" ? "condensedSize" : item === "counter" ? "counterSize" : "countsSize";
      return <LayoutSection key={item} title={title} note={item === "condensed" ? "The latest actions, over the map" : item === "counter" ? "Turn, phase and step, over the map" : "Each army's units on the map, and the killed"} on={layout[item]} onToggle={(on) => item === "counter" ? updateLayout(setCounterEnabled(layout, on)) : patch({ [item]: on })} always={item === "counter" ? <CounterFields log={layout} onChange={updateLayout} /> : undefined}>
        <CornerPicker label={`${title} corner`} which={item} log={layout} onChange={(corner) => updateLayout(placeOverlay(layout, item, corner))} />
        {item === "condensed" && <StepSlider label="# of Lines" stops={MAX_CONDENSED_LINES} value={layout.condensedLines - 1} onChange={(i) => patch({ condensedLines: i + 1 })} valueText={`${layout.condensedLines} at most`} after={<span className="team-pages-axis-value">{layout.condensedLines}</span>} variant="timeline" slim />}
        {item === "counts" && <ZeroCounts checked={layout.countsZero} onChange={(countsZero) => patch({ countsZero })} />}
        <SizeSlider value={layout[sizeKey]} onChange={(size) => patch({ [sizeKey]: size })} />
      </LayoutSection>;
    })}
  </div>;
}
