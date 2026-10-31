/** The small charts of the More stats tab: mirrored bars, one-sided bars, per-turn columns and per-turn lines. They
 * share the page's dealt / taken look (styles.css, `.more-stats`); every one fills the box it's in. */
import type { ReactNode } from "react";
import { WhoLink } from "./parts";

export interface Series {
  label: string;
  /** A CSS colour (`var(--dealt)`). */
  color: string;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.label} className="chart-key" style={{ ["--k" as string]: s.color }}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Each unit's two numbers on one scale: the left one grows left, the right one right. */
export function MirrorBars({ rows, left, right }: { rows: { id: string; left: number; right: number }[]; left: Series; right: Series }) {
  const l = Math.max(0, ...rows.map((r) => r.left));
  const r = Math.max(1, ...rows.map((x) => x.right));
  // Bars on each side get room in proportion to their biggest value, so both sides share one scale.
  const columns = `2.2rem ${l}fr auto ${r}fr 2.2rem`;
  return (
    <figure className="unit-damage">
      <Legend series={[right, left]} />
      <div className="mirror-bars" style={{ gridTemplateColumns: columns }}>
        {rows.map((x) => (
          <div key={x.id} className="mirror-row" title={`${x.right} ${right.label.toLowerCase()}, ${x.left} ${left.label.toLowerCase()}`}>
            <small className="bar-val">{x.left || ""}</small>
            <span className="bar-side taken">{x.left > 0 && <span style={{ width: `${(100 * x.left) / Math.max(1, l)}%`, background: left.color }} />}</span>
            <span className="bar-name">
              <WhoLink id={x.id} />
            </span>
            <span className="bar-side dealt">{x.right > 0 && <span style={{ width: `${(100 * x.right) / r}%`, background: right.color }} />}</span>
            <small className="bar-val left">{x.right || ""}</small>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** One bar per unit, each made of segments (one colour per kind of thing); the total at its end. `of` makes every bar a share of its own whole. */
export function UnitBars({ rows, series }: { rows: { id: string; values: number[]; of?: number; note?: string }[]; series: Series[] }) {
  const max = Math.max(1, ...rows.map((r) => r.of ?? r.values.reduce((n, v) => n + v, 0)));
  return (
    <figure className="unit-bars">
      {series.length > 1 && <Legend series={series} />}
      <div className="hbars">
        {rows.map((r) => {
          const total = r.values.reduce((n, v) => n + v, 0);
          return (
            <div key={r.id} className="hbar-row" title={series.map((s, i) => `${r.values[i]} ${s.label.toLowerCase()}`).join(", ")}>
              <span className="hbar-name">
                <WhoLink id={r.id} />
              </span>
              <span className="hbar-track">
                {r.values.map((v, i) => v > 0 && <span key={i} style={{ width: `${(100 * v) / max}%`, background: series[i].color }} />)}
              </span>
              <small className="bar-val">{r.note ?? total}</small>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export interface TurnRow {
  turn: number;
  values: number[];
  title: string;
}

const every = (n: number) => (n > 16 ? 5 : n > 10 ? 2 : 1);

/** Paired (or single) columns for every turn; a click on one picks the turn. */
export function TurnColumns({ rows, series, onPick }: { rows: TurnRow[]; series: Series[]; onPick?: (turn: number) => void }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const step = every(rows.length);
  return (
    <figure className="turn-damage">
      <Legend series={series} />
      <div className="turn-plot">
        <span className="turn-max">{max}</span>
        {rows.map((r) => (
          <button key={r.turn} type="button" className="turn-col" title={r.title} onClick={() => onPick?.(r.turn)} disabled={!onPick}>
            <div className="turn-bars">
              {r.values.map((v, i) => (
                <span key={i} style={{ height: `${(100 * v) / max}%`, background: series[i].color }} />
              ))}
            </div>
            <span className="turn-label">{r.turn === 1 || r.turn % step === 0 ? r.turn : ""}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

/** Lines over the turns (one point per turn), on one scale from 0. */
export function TurnLines({ rows, series, onPick }: { rows: TurnRow[]; series: Series[]; onPick?: (turn: number) => void }) {
  const W = 600;
  const H = 100;
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const x = (n: number) => (rows.length < 2 ? W / 2 : (W * (n + 0.5)) / rows.length);
  const y = (v: number) => H - (H * v) / max;
  const step = every(rows.length);
  return (
    <figure className="turn-damage turn-lines">
      <Legend series={series} />
      <div className="turn-plot">
        <span className="turn-max">
          {max}
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
          {series.map((s, k) => (
            <path key={s.label} d={rows.map((r, n) => `${n ? "L" : "M"} ${x(n)} ${y(r.values[k])}`).join(" ")} style={{ stroke: s.color }} />
          ))}
        </svg>
        {rows.map((r) => (
          <button key={r.turn} type="button" className="turn-col" title={r.title} onClick={() => onPick?.(r.turn)} disabled={!onPick}>
            <span className="turn-hit" />
            <span className="turn-label">{r.turn === 1 || r.turn % step === 0 ? r.turn : ""}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

/** A titled box that fills its grid cell; the chart scrolls inside it when it's taller. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
