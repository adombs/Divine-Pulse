/**
 * The rewind indicator: shown in the middle of the map while a Divine Pulse turns time back (on the battle page and in
 * a video). The Divine Pulse spiral traces itself, filling from its outer tip to the centre curl, holding, then emptying
 * the same way, over a faint copy that keeps its shape in view; under it "Rewinding N Steps" and a thin bar, both
 * following how much of the spiral shows (N counts up to the steps being undone as it fills).
 *
 * The cycle (fill, hold, empty, hold) loops every two seconds for as long as the rewind lasts. It is one SVG, so it scales evenly with the map and draws the same in a video's frames.
 * Its clock is the rewind's own (`elapsed`), not the screen's, so a video shows exactly what the preview did.
 */
import { useId, useMemo } from "react";

/** The spiral's centreline, outer tip to centre curl, in the glyph's 200 × 308 frame (public/brand/glyph-cream.png). */
const TRACE = "M118,18 C92,50 48,92 34,142 C24,182 30,228 58,256 C84,282 128,288 156,262 C180,240 184,208 164,184 C147,164 120,162 109,180 C100,196 107,212 124,214";
const GLYPH = "/brand/glyph-cream.png";

/** One cycle's proportions (ms, as designed): fill, hold full, empty, hold empty. A rewind plays it in LOOP_MS (rewindTrace). */
const FILL = 1900;
const HOLD_FULL = 400;
const EMPTY = 1900;
const HOLD_EMPTY = 500;
const CYCLE = FILL + HOLD_FULL + EMPTY + HOLD_EMPTY;

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** The part of the spiral showing `t` ms into a cycle: from `start` along it, `shown` long (shares of its length). */
export function traceWindow(t: number, reduced = false): { start: number; shown: number } {
  if (reduced) return { start: 0, shown: 1 };
  const at = ((t % CYCLE) + CYCLE) % CYCLE;
  if (at < FILL) return { start: 0, shown: ease(at / FILL) };
  if (at < FILL + HOLD_FULL) return { start: 0, shown: 1 };
  if (at < FILL + HOLD_FULL + EMPTY) {
    const k = ease((at - FILL - HOLD_FULL) / EMPTY);
    return { start: k, shown: 1 - k };
  }
  return { start: 1, shown: 0 };
}

let traceLength: number | null = null;
/** The centreline's length in the glyph's frame (measured once). */
function lengthOfTrace(): number {
  if (traceLength !== null) return traceLength;
  try {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", TRACE);
    traceLength = path.getTotalLength() || 560;
  } catch {
    traceLength = 560;
  }
  return traceLength;
}

const reducedMotion = () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) ?? false;

/** How long one loop of the cycle takes in a rewind (ms). */
export const LOOP_MS = 2000;

/** The part of the spiral showing `elapsed` ms into a rewind: the cycle, played in LOOP_MS, over and over. */
export function rewindTrace(elapsed: number, reduced = false): { start: number; shown: number } {
  return traceWindow((Math.max(0, elapsed) * CYCLE) / LOOP_MS, reduced);
}

export function RewindIndicator({ steps, elapsed }: { steps: number; elapsed: number }) {
  const uid = useId().replace(/:/g, "");
  const length = useMemo(lengthOfTrace, []);
  const { start, shown } = rewindTrace(elapsed, reducedMotion());
  const n = Math.round(shown * steps);
  // One dash `shown` long, moved to begin `start` along the path: only that stretch of the spiral is unmasked.
  const dash = shown <= 0.0001 ? `0 ${length}` : `${shown * length} ${length}`;
  return (
    <svg className="rewind-indicator" viewBox="0 0 320 384" role="img" aria-label={`Rewinding ${steps} ${steps === 1 ? "step" : "steps"}`}>
      <defs>
        <mask id={`${uid}-trace`} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="308">
          <path d={TRACE} fill="none" stroke="#fff" strokeWidth={48} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeDashoffset={shown <= 0.0001 ? 0 : -start * length} />
        </mask>
      </defs>
      <rect className="rewind-panel" x={0} y={0} width={320} height={384} rx={22} />
      <g transform="translate(80 28) scale(0.8)">
        <image className="rewind-glyph-ghost" href={GLYPH} x={0} y={0} width={200} height={308} />
        <image className="rewind-glyph" href={GLYPH} x={0} y={0} width={200} height={308} mask={`url(#${uid}-trace)`} />
      </g>
      <text className="rewind-label" x={160} y={316} textAnchor="middle">
        Rewinding <tspan className="rewind-label-num">{n}</tspan> {n === 1 ? "Step" : "Steps"}
      </text>
      <rect className="rewind-track" x={50} y={340} width={220} height={4} rx={2} />
      <rect className="rewind-track-fill" x={50} y={340} width={220 * shown} height={4} rx={2} />
    </svg>
  );
}
