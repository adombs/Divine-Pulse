import "./class-mastery.css";
import type { Unit } from "../../api";
import { masteredClasses } from "../../classMastery";
import { useReference } from "../../reference/types";
import { ClassLink } from "../Links";
import { TierIcon } from "../reference/TierIcon";

/**
 * The classes a unit has mastered, lowest tier first (the order the game read them in), each with its tier's plate (as the Archive's Classes show it).
 * Says so when the game hasn't been read for it yet (a unit saved before mastery was read) rather than claiming none.
 */
export function ClassMasteryPanel({ unit }: { unit: Unit }) {
  const ref = useReference();
  const mastered = masteredClasses(unit.mastered_classes, ref?.classes);
  if (mastered === null) return <p className="muted">Not read yet. It is read from the game the next time the roster is.</p>;
  if (mastered.length === 0) return <p className="muted">No class mastered yet</p>;
  return (
    <ul className="item-list mastery-list" aria-label={`${unit.name}'s mastered classes`}>
      {mastered.map((c) => (
        <li key={c.name}>
          <span>
            {c.tier && <TierIcon tier={c.tier} size={22} decorative />}
            <ClassLink name={c.name} />
          </span>
          {c.tier && <span className="rank">{c.tier}</span>}
        </li>
      ))}
    </ul>
  );
}
