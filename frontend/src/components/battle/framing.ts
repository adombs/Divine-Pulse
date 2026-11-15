/** The dynamic camera's framing rule, shared by the battle map (camera.tsx) and the video export. Pure, for tests. */

/**
 * Where a view `w` by `h` tiles big moves to from `from` (its top left; null: nowhere yet, so it centres) to keep
 * `follow` in frame: every tile followed at least `margin` of the zoom (`tiles` across) in from the view's edges.
 * Already so, it stays; otherwise it moves as little as gets them there. Tiles too far apart for that are centred. The
 * top left is kept between `low` and `high` (inside the map).
 */
export function framed(from: [number, number] | null, follow: [number, number][], [w, h]: [number, number], tiles: number, margin: number, high: [number, number], low: [number, number] = [0, 0]): [number, number] {
  const m = Math.max(0, margin) * tiles;
  const axis = (start: number | null, cells: number[], size: number, lo: number, hi: number) => {
    const first = Math.min(...cells);
    const last = Math.max(...cells) + 1;
    let at: number;
    if (start === null || last - first > size - 2 * m) at = (first + last) / 2 - size / 2;
    else if (first < start + m) at = first - m;
    else if (last > start + size - m) at = last + m - size;
    else at = start;
    return hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, at));
  };
  return [
    axis(from && from[0], follow.map(([x]) => x), w, low[0], high[0]),
    axis(from && from[1], follow.map(([, y]) => y), h, low[1], high[1]),
  ];
}
