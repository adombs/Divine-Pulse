/**
 * The Roster's Mark menu: pick a brush (one of five shapes in one of five colors, or the eraser), then click units to
 * mark them. Clicking a unit that already wears the brush takes the mark off. Marks show beside names on the Roster.
 */
import { useState } from "react";
import type { Unit } from "../api";
import { MARK_COLORS, MARK_ICON, MARK_SHAPES, markLabel, parseMark, type Mark } from "../marks";
import { CONCEPT_ICON } from "../icons/concepts";
import { Dropdown } from "./common";
import { Icon } from "./Icon";
import { Portrait } from "./ui";

const BRUSH_KEY = "divine-pulse-mark-brush";
/** null: the eraser. */
type Brush = Mark | null;

function useBrush(): [Brush, (b: Brush) => void] {
  const [brush, setBrush] = useState<Brush>(() => {
    try {
      const saved = localStorage.getItem(BRUSH_KEY);
      if (saved === "erase") return null;
      if (parseMark(saved)) return saved as Mark;
    } catch {
      /* storage unavailable */
    }
    return "star-gold";
  });
  const update = (b: Brush) => {
    setBrush(b);
    try {
      localStorage.setItem(BRUSH_KEY, b ?? "erase");
    } catch {
      /* storage unavailable */
    }
  };
  return [brush, update];
}

/** A unit's mark as drawn beside its name; nothing for none. */
export function UnitMark({ mark, className = "" }: { mark: string | null | undefined; className?: string }) {
  const parsed = parseMark(mark);
  if (!parsed) return null;
  const label = markLabel(parsed.shape, parsed.color);
  return (
    <span className={`unit-mark mark-${parsed.color} ${className}`} title={label} aria-label={`Marked: ${label}`} role="img">
      <Icon name={MARK_ICON[parsed.shape]} weight="fill" />
    </span>
  );
}

interface Props {
  /** Every unit on the Roster, in the order it lists them. */
  units: Unit[];
  /** A unit's mark as it stands, including changes still being saved. */
  markOf: (u: Unit) => string | null;
  /** Show post-timeskip portraits. */
  part2: boolean;
  onChange: (marks: Record<string, Mark | null>) => void;
}

export function MarkMenu({ units, markOf, part2, onChange }: Props) {
  const [brush, setBrush] = useBrush();
  const marked = units.filter((u) => parseMark(markOf(u)));

  const apply = (u: Unit) => {
    const current = markOf(u);
    // Painting the same mark again takes it off, so a misclick is one click to undo.
    const next = brush === null || current === brush ? null : brush;
    if (next !== current) onChange({ [u.key]: next });
  };

  return (
    <Dropdown label="Mark">
      <div className="mark-menu">
        <fieldset className="mark-brushes">
          <legend>Brush</legend>
          <div className="mark-grid" role="group" aria-label="Shapes and colors">
            {MARK_COLORS.map((color) =>
              MARK_SHAPES.map((shape) => {
                const id: Mark = `${shape}-${color}`;
                const label = markLabel(shape, color);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`mark-swatch mark-${color}`}
                    aria-pressed={brush === id}
                    aria-label={label}
                    title={label}
                    onClick={() => setBrush(id)}
                  >
                    <Icon name={MARK_ICON[shape]} weight="fill" />
                  </button>
                );
              }),
            )}
          </div>
          <button type="button" className="mark-eraser" aria-pressed={brush === null} onClick={() => setBrush(null)}>
            <Icon name={CONCEPT_ICON.eraser} />
            Eraser
          </button>
        </fieldset>

        <p className="mark-hint">
          {brush === null ? "Click a unit to take its mark off." : "Click a unit to mark it. Click again to take the mark off."}
        </p>

        <ul className="mark-units" aria-label="Units">
          {units.map((u) => (
            <MarkUnitRow key={u.key} unit={u} mark={markOf(u)} brush={brush} part2={part2} onApply={apply} />
          ))}
        </ul>

        <div className="mark-foot">
          <span className="muted">{marked.length === 0 ? "No units marked" : `${marked.length} marked`}</span>
          <button
            type="button"
            className="btn small"
            disabled={marked.length === 0}
            onClick={() => onChange(Object.fromEntries(marked.map((u) => [u.key, null])))}
          >
            Clear All Marks
          </button>
        </div>
      </div>
    </Dropdown>
  );
}

function MarkUnitRow({
  unit,
  mark,
  brush,
  part2,
  onApply,
}: {
  unit: Unit;
  mark: string | null;
  brush: Brush;
  part2: boolean;
  onApply: (u: Unit) => void;
}) {
  const wearsBrush = brush !== null && mark === brush;
  return (
    <li>
      <button type="button" className="mark-unit" aria-pressed={wearsBrush} onClick={() => onApply(unit)}>
        <Portrait unit={unit} part2={part2} size={26} />
        <span className="mark-unit-name">{unit.name}</span>
        {parseMark(mark) ? <UnitMark mark={mark} /> : <span className="mark-empty" aria-hidden />}
      </button>
    </li>
  );
}
