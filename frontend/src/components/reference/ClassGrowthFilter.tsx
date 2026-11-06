import type { GameClass } from "../../reference/types";
import { TIERS } from "../../reference/types";
import { TierIcon } from "./TierIcon";

/** A native radio group keeps keyboard choice behavior while allowing the existing tier artwork. */
export function ClassGrowthFilter({ classes, value, onChange }: { classes: GameClass[]; value: string; onChange: (name: string) => void }) {
  const selected = classes.find((item) => item.name === value);
  return <div className="field" title="Growth rates in a class are the character's own plus the class's">
    <span>Growths in a class</span>
    <details className="class-growth-filter">
      <summary><span className="filter-label">{selected && <TierIcon tier={selected.tier} size={18} decorative />}{selected ? `+ ${selected.name}` : "Own growths only"}</span></summary>
      <fieldset className="checklist class-growth-choices" aria-label="Growths in a class">
        <div className="checklist-items">
          <label><input type="radio" name="growth-class" checked={!value} onChange={() => onChange("")} />Own growths only</label>
          {TIERS.flatMap((tier) => classes.filter((item) => item.tier === tier).map((item) => <label key={item.name} className={value === item.name ? "on" : ""}>
            <input type="radio" name="growth-class" aria-label={`${item.name}, ${tier} tier`} checked={value === item.name} onChange={() => onChange(item.name)} />
            <span className="filter-label"><TierIcon tier={tier} size={18} decorative />+ {item.name}</span>
          </label>))}
        </div>
      </fieldset>
    </details>
  </div>;
}
