import { useId } from "react";
import type { CSSProperties } from "react";
import type { Tier } from "../../reference/types";

/** The plate colours of the class-change screen: light, middle and dark edge of each tier's metal. */
export const TIER_METAL: Record<Tier, [string, string, string]> = {
  Beginner: ["#c9a27a", "#7c5636", "#3b2616"],
  Intermediate: ["#f4f6f8", "#a2aab3", "#4a5159"],
  Advanced: ["#f3d682", "#b58a2c", "#5a4010"],
  Master: ["#7d89e6", "#33399a", "#141a52"],
  Unique: ["#c79be0", "#7a4a9b", "#33184a"],
  DLC: ["#8fd3d0", "#2f8587", "#10393b"],
};
const CHEVRONS: Record<Tier, number> = { Beginner: 1, Intermediate: 2, Advanced: 3, Master: 4, Unique: 0, DLC: 3 };

/** A tier's metal as CSS custom properties (--tier-light, --tier-mid, --tier-dark), for styles tinted by the tier. */
export function tierMetalStyle(tier: Tier): CSSProperties {
  const [light, mid, dark] = TIER_METAL[tier];
  return { "--tier-light": light, "--tier-mid": mid, "--tier-dark": dark } as CSSProperties;
}

/** A class's tier as the game's metal plate: more chevrons for a higher tier, a diamond for unique classes.
 * `decorative` when the tier is named beside it: hidden from screen readers and without a tooltip. */
export function TierIcon({ tier, size = 36, decorative = false }: { tier: Tier; size?: number; decorative?: boolean }) {
  const [light, mid, dark] = TIER_METAL[tier];
  // One gradient per plate: a shared id breaks every plate when the first one sits in a hidden menu.
  const id = `tier-${tier}-${useId().replace(/[^\w-]/g, "")}`;
  const n = CHEVRONS[tier];
  return (
    <svg
      className="tier-icon"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `${tier} tier` })}
    >
      {!decorative && <title>{tier}</title>}
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d="M4 3h24l1 4v18l-13 5-13-5V7z" fill={`url(#${id})`} stroke={dark} strokeWidth="1.2" />
      <path d="M6 5.5h20v18.5l-10 3.8L6 24z" fill="none" stroke={light} strokeOpacity="0.7" strokeWidth="0.8" />
      {n === 0 ? (
        <path d="M16 9l5 6-5 6-5-6z" fill={light} stroke={dark} strokeWidth="0.8" />
      ) : (
        Array.from({ length: n }, (_, i) => {
          const y = 18 + ((n - 1) / 2 - i) * 5;
          return <path key={i} d={`M9 ${y}l7-5 7 5`} fill="none" stroke={light} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;
        })
      )}
    </svg>
  );
}

/** A tier's plate with its name beside it (the Classes filters and their chips). */
export function TierLabel({ tier }: { tier: Tier }) {
  return (
    <span className="tier-label">
      <TierIcon tier={tier} size={18} decorative />
      {tier}
    </span>
  );
}
