import type { Tier } from "../../reference/types";

/** The plate colours of the class-change screen: light and dark edge of each tier's metal. */
const METAL: Record<Tier, [string, string, string]> = {
  Beginner: ["#c9a27a", "#7c5636", "#3b2616"],
  Intermediate: ["#f4f6f8", "#a2aab3", "#4a5159"],
  Advanced: ["#f3d682", "#b58a2c", "#5a4010"],
  Master: ["#7d89e6", "#33399a", "#141a52"],
  Unique: ["#c79be0", "#7a4a9b", "#33184a"],
  DLC: ["#8fd3d0", "#2f8587", "#10393b"],
};
const CHEVRONS: Record<Tier, number> = { Beginner: 1, Intermediate: 2, Advanced: 3, Master: 4, Unique: 0, DLC: 3 };

/** A class's tier as the game's metal plate: more chevrons for a higher tier, a diamond for unique classes. */
export function TierIcon({ tier, size = 36 }: { tier: Tier; size?: number }) {
  const [light, mid, dark] = METAL[tier];
  const id = `tier-${tier}`;
  const n = CHEVRONS[tier];
  return (
    <svg className="tier-icon" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={`${tier} tier`}>
      <title>{tier}</title>
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
