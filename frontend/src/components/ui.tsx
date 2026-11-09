import { ReactNode, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STAT_INFO } from "../statInfo";
import { EBST_TYPES, EbstType } from "../ebst";
import { AffiliationIcon } from "./AffiliationIcon";
import type { RunRoute, Unit } from "../api";
import { portraitUrl, portraitUrlForKey } from "../portraits";
import { PortraitPhaseContext } from "../appearance";
import { PortraitImage } from "./GameImage";
import { bundledHouse } from "./gameImageSources";

/** A section's header bar. `icon` goes before the title (a page header shows its page's icon). */
export function SectionHead({ children, right, icon }: { children: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2>
        {icon}
        {children}
      </h2>
      {right && <div className="sec-head-right">{right}</div>}
    </div>
  );
}

/** The tracker's pennant: the Divine Pulse swirl (public/brand/divine-pulse-mark.png), painted in the text colour through a mask. */
export function Crest() {
  return (
    <span className="crest" aria-hidden>
      <span className="crest-mark" />
    </span>
  );
}

/** Banner for the observed route (or Part I house); unknown runs retain the tracker crest. */
export const RUN_HOUSE: Record<RunRoute, string> = {
  "black-eagles": "Black Eagles", "blue-lions": "Blue Lions", "golden-deer": "Golden Deer",
  cf: "Black Eagles", ss: "Church of Seiros", am: "Blue Lions", vw: "Golden Deer",
};
const RUN_BANNER: Record<RunRoute, string> = {
  "black-eagles": "black-eagles", "blue-lions": "blue-lions", "golden-deer": "golden-deer",
  cf: "black-eagles", ss: "church-of-seiros", am: "blue-lions", vw: "golden-deer",
};
export const runIconUrl = (route?: RunRoute | null) => route ? bundledHouse(RUN_BANNER[route]) : null;
export function RunIcon({ route }: { route?: RunRoute | null }) {
  return route ? <AffiliationIcon house={RUN_HOUSE[route]} /> : <Crest />;
}


export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  );
}

/** One-of-several buttons ("Growth rates / Base stats / Max stats"). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size,
  disabled,
}: {
  value: T;
  options: readonly (readonly [T, ReactNode] | readonly [T, ReactNode, string])[];
  onChange: (v: T) => void;
  label: string;
  size?: "mini";
  /** Shows the choice but doesn't let it be changed. */
  disabled?: boolean;
}) {
  return (
    <div className={`segmented ${size ?? ""}`} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map(([id, text, title]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? "on" : ""} title={title} disabled={disabled} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Auto / Physical / Magical / Flex as a row of buttons, with a label in front. */
export function TypeButtons({ label, value, onChange }: { label: string; value: EbstType; onChange: (v: EbstType) => void }) {
  return (
    <div className="type-buttons">
      <span className="type-label">{label}</span>
      <Segmented
        label={label}
        value={value}
        onChange={onChange}
        options={EBST_TYPES.map(
          (t) =>
            [
              t.id,
              t.label,
              t.id === "auto" ? `${label}: the higher of the two` : t.id === "flex" ? `${label}: the average of the two` : `${label}: ${t.label}`,
            ] as const,
        )}
      />
    </div>
  );
}

/** The unit's imported headshot; unavailable files show an explicit sentinel. */
export function Portrait({ unit, part2, size = 36 }: { unit: Unit; part2: boolean; size?: number }) {
  const automatic = useContext(PortraitPhaseContext) === "auto";
  return <PortraitImg url={portraitUrl(unit, part2, automatic)} name={unit.name} size={size} />;
}

/** A headshot by portrait key ("edelgard", "byleth_f", …). */
export function KeyPortrait({ portraitKey, name, part2, size = 36 }: { portraitKey: string; name: string; part2: boolean; size?: number }) {
  const automatic = useContext(PortraitPhaseContext) === "auto";
  return <PortraitImg url={portraitUrlForKey(portraitKey, part2, undefined, automatic)} name={name} size={size} />;
}

function PortraitImg({ url, name, size }: { url: string | null; name: string; size: number }) {
  return <PortraitImage className="portrait" bundled={url} alt={`${name}'s portrait`} width={size} height={size} loading="lazy" draggable={false} />;
}

/**
 * When the detail card sits under the table (narrow windows, see the 1150px breakpoint in styles.css),
 * bring it into view after picking a row; side by side, it's already visible.
 */
export function revealCard() {
  if (!window.matchMedia("(max-width: 1150px)").matches) return;
  requestAnimationFrame(() => document.querySelector(".unit-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/**
 * Hover (or keyboard focus) explanation. The bubble is drawn on top of the page, so a scrolling table can't
 * clip it.
 */
export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 140;
    const x = Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160);
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);
  return (
    <span ref={ref} className="tip-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {pos &&
        createPortal(
          <div className={`tip ${pos.below ? "below" : ""}`} style={{ left: pos.x, top: pos.y }} role="tooltip">
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** A stat name with its explanation on hover. */
export function StatTip({ k, children, extra }: { k: string; children?: ReactNode; extra?: ReactNode }) {
  const info = STAT_INFO[k];
  if (!info) return <>{children}</>;
  return (
    <Tip
      tip={
        <>
          <b>{info.name}</b>
          <span>{info.text}</span>
          {extra && <span className="tip-extra">{extra}</span>}
        </>
      }
    >
      {children ?? info.name}
    </Tip>
  );
}

/** The purple name banner at the top of every detail card and dialog; `right` holds the card's actions; `icon` replaces the crest (a unit's card shows its affiliation). */
export function CardBanner({ title, right, icon }: { title: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="name-banner small">
      {icon ?? <Crest />}
      <span className="banner-title">{title}</span>
      {right && <span className="banner-actions">{right}</span>}
    </div>
  );
}
