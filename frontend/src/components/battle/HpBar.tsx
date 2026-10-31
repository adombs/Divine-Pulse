/** A compact current-HP meter for battle lists and cards. */
import { Meter } from "../layout";

export interface HpBarProps {
  /** Current HP. Null means the game has not exposed current HP yet. */
  hp: number | null;
  /** Maximum HP, used for the meter scale and the number beside it. */
  max: number | null;
  className?: string;
}

/** An 8px-ish HP meter with its exact value on the same line. */
export function HpBar({ hp, max, className }: HpBarProps) {
  const known = hp !== null;
  const hasMax = max !== null && max > 0;
  const value = known && hasMax ? Math.max(0, Math.min(1, hp / max)) : 0;
  const text = known ? (hasMax ? `${hp} / ${max}` : String(hp)) : (hasMax ? `— / ${max}` : "—");
  return (
    <span className={`hp-bar${className ? ` ${className}` : ""}`} title={known ? (hasMax ? `${hp} / ${max} HP` : `${hp} HP`) : "Current HP isn't tracked yet"}>
      {known && hasMax && <Meter value={value} label={`${hp} of ${max} HP`} />}
      <span className="hp-bar-value">{text}</span>
    </span>
  );
}
