/**
 * The Roster's Mark menu: pick a brush (one of five shapes in one of five colors, or the eraser), then click units to
 * mark them. A unit wears up to MAX_MARKS different marks; clicking a unit that already wears the brush takes that
 * mark off, and the eraser takes all of them off. Marks show beside names on the Roster.
 */
import { useState, type CSSProperties } from "react";
import type { Unit } from "../api";
import { MARK_COLORS, MARK_ICON, MARK_SHAPES, MAX_MARKS, markLabel, parseMark, validMarks, type Mark } from "../marks";
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

/** A unit's marks as drawn beside its name, in the order they were put on; nothing for none. */
export function UnitMarks({ marks, className = "" }: { marks: readonly string[] | null | undefined; className?: string }) {
  const shown = validMarks(marks);
  if (!shown.length) return null;
  const labels = shown.map((m) => {
    const { shape, color } = parseMark(m)!;
    return markLabel(shape, color);
  });
  return (
    <span
      className={`unit-marks ${className}`}
      style={{ "--marks": shown.length } as CSSProperties}
      role="img"
      aria-label={`Marked: ${labels.join(", ")}`}
      title={labels.join(", ")}
    >
      {shown.map((m) => {
        const { shape, color } = parseMark(m)!;
        return (
          <span key={m} className={`unit-mark mark-${color}`}>
            <Icon name={MARK_ICON[shape]} weight="fill" />
          </span>
        );
      })}
    </span>
  );
}

interface Props {
  /** Every unit on the Roster, in the order it lists them. */
  units: Unit[];
  /** A unit's marks as they stand, including changes still being saved. */
  marksOf: (u: Unit) => Mark[];
  /** Show post-timeskip portraits. */
  part2: boolean;
  /** Each named unit's whole new list of marks. */
  onChange: (marks: Record<string, Mark[]>) => void;
}

export function MarkMenu({ units, marksOf, part2, onChange }: Props) {
  const [brush, setBrush] = useBrush();
  const marked = units.filter((u) => marksOf(u).length > 0);

  const apply = (u: Unit) => {
    const current = marksOf(u);
    if (brush === null) {
      if (current.length) onChange({ [u.key]: [] });
    } else if (current.includes(brush)) {
      // Painting a mark the unit already wears takes it off, so a misclick is one click to undo.
      onChange({ [u.key]: current.filter((m) => m !== brush) });
    } else if (current.length < MAX_MARKS) {
      onChange({ [u.key]: [...current, brush] });
    }
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
          {brush === null
            ? "Click a unit to take all its marks off."
            : `Click a unit to add the mark, again to take it off. Up to ${MAX_MARKS} marks each.`}
        </p>

        <ul className="mark-units" aria-label="Units">
          {units.map((u) => (
            <MarkUnitRow key={u.key} unit={u} marks={marksOf(u)} brush={brush} part2={part2} onApply={apply} />
          ))}
        </ul>

        <div className="mark-foot">
          <span className="muted">{marked.length === 0 ? "No units marked" : `${marked.length} marked`}</span>
          <button
            type="button"
            className="btn small"
            disabled={marked.length === 0}
            onClick={() => onChange(Object.fromEntries(marked.map((u) => [u.key, []])))}
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
  marks,
  brush,
  part2,
  onApply,
}: {
  unit: Unit;
  marks: Mark[];
  brush: Brush;
  part2: boolean;
  onApply: (u: Unit) => void;
}) {
  const wearsBrush = brush !== null && marks.includes(brush);
  // Full: the brush can't go on until one of the unit's marks comes off.
  const full = brush !== null && !wearsBrush && marks.length >= MAX_MARKS;
  return (
    <li>
      <button
        type="button"
        className={`mark-unit${full ? " full" : ""}`}
        aria-pressed={wearsBrush}
        aria-disabled={full || undefined}
        title={full ? `${unit.name} already has ${MAX_MARKS} marks. Click one of them with its brush, or use the Eraser.` : undefined}
        onClick={() => onApply(unit)}
      >
        <Portrait unit={unit} part2={part2} size={26} />
        <span className="mark-unit-name">{unit.name}</span>
        {marks.length ? <UnitMarks marks={marks} /> : <span className="mark-empty" aria-hidden />}
      </button>
    </li>
  );
}
