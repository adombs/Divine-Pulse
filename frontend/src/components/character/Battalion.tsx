/**
 * A unit's battalion, the same in every character view, laid out like the game's battalion panel: the battalion (icon,
 * name, endurance, description, the eight modifiers) beside its gambit (icon, name, uses, description, Mt, Hit and the
 * tiles it hits).
 *
 * The app shows only what it has: the player's import (data/battalions.json) and what's read from game memory (the
 * assignment, its experience and endurance, and gambit uses left in a battle; docs/battalions.md). The level and its
 * modifiers follow from the experience and the import. Anything missing shows "—" with the reason, never a made-up
 * value.
 */
import type { ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { battalionLevel, battalionReference } from "../../reference/battalions";
import type { BattleUnit, Unit } from "../../api";
import { BATTALION_STAT_KEYS, BATTALION_STAT_LABEL, useReference } from "../../reference/types";
import type { Battalion, BattalionStatKey, GambitArea } from "../../reference/types";
import { GameImage, MapImage } from "../GameImage";
import { Icon } from "../Icon";
import { BattalionLink } from "../Links";
import "./character.css";

const NOT_IMPORTED = "Not in your imported game files yet.";
const NOT_READ = "Not read from the game yet.";
const NOT_RECORDED = "Not recorded for this battle.";
const SPENT = "No endurance left: the unit gets none of these until the battalion is replenished.";
const RATTLED = "Rattled by a gambit when last read: the unit gets none of these until it recovers.";

/** The import's entry for a battalion name (matched loosely, as names saved by older versions may differ). */
export function useBattalion(name: string | null | undefined, id?: number | null): Battalion | undefined {
  const ref = useReference();
  return battalionReference(ref?.battalions ?? [], name, id);
}

/** Archive routes use names, so don't link an unresolved identity or a name shared by different rows. */
function BattalionName({ entry, name }: { entry?: Battalion; name: string }) {
  const ref = useReference();
  const ambiguous = ref?.battalions?.some((other) => other !== entry && other.name === entry?.name);
  return entry && !ambiguous ? <BattalionLink name={entry.name} /> : <>{name}</>;
}

/** A compact badge for the hero: the flag, the name (linked to the Archive) and its endurance. `name` is the unit's
 * assignment: undefined when it hasn't been read, "" for none. */
export function BattalionBadge({ unit }: { unit: Pick<Unit, "battalion" | "battalion_id" | "battalion_endurance"> | undefined }) {
  const assigned = unit?.battalion;
  const entry = useBattalion(assigned, unit?.battalion_id);
  const name = entry?.name ?? assigned;
  if (name === undefined || name === null) {
    return (
      <span className="cv-battalion none" title="Battalions are read from game memory; this unit hasn't been read with one yet.">
        <Icon name={CONCEPT_ICON.battalion} />
        Battalion not read
      </span>
    );
  }
  if (!name) {
    return (
      <span className="cv-battalion none">
        <Icon name={CONCEPT_ICON.battalion} />
        No battalion
      </span>
    );
  }
  const max = entry?.endurance;
  const now = unit?.battalion_endurance;
  return (
    <span className="cv-battalion" title={entry?.description || name}>
      <BattalionIcon entry={entry} size="sm" />
      <span className="cv-battalion-name">
        <BattalionName entry={entry} name={name} />
      </span>
      {max !== undefined && max !== null && (
        <span className="cv-battalion-end" title={now === undefined || now === null ? "Endurance; what's left isn't read yet" : "Endurance left of most"}>
          {now === undefined || now === null ? `End ${max}` : `${now}/${max}`}
        </span>
      )}
    </span>
  );
}

/** The battalion's own icon from the import, or an empty frame saying it isn't there (no stand-in picture). */
function BattalionIcon({ entry, size = "md", gambit = false }: { entry?: { icon?: string; name: string }; size?: "sm" | "md"; gambit?: boolean }) {
  const missing = (
    <span className={`bp-icon ${size} missing`} title={`${gambit ? "Gambit" : "Battalion"} icon: ${NOT_IMPORTED}`} aria-hidden />
  );
  // In the small badge, no icon at all rather than an empty frame.
  if (!entry?.icon) return size === "sm" ? null : missing;
  return <GameImage imported={entry.icon} className={`bp-icon ${size}`} alt="" draggable={false} fallback={size === "sm" ? null : missing} />;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "even");

/** "—" with why it's missing. */
const Missing = ({ why }: { why: string }) => (
  <span className="bp-missing" title={why}>
    —<span className="sr-only"> ({why})</span>
  </span>
);

type BattalionState = Pick<BattleUnit, "battalion" | "battalion_id" | "battalion_exp" | "battalion_endurance" | "gambit_uses"> & { rattled?: boolean | null };

/**
 * The battalion panel. `unit` is the selected battle's recorded assignment or the run's last-read unit, according
 * to `scope`. The Archive ("reference") supplies the battalion itself, `name`, with no unit.
 */
export function BattalionPanel({ unit, name: given, scope }: { unit?: BattalionState; name?: string; scope: "battle" | "run" | "reference" }) {
  const assigned = given ?? unit?.battalion;
  const entry = useBattalion(assigned, given === undefined ? unit?.battalion_id : undefined);
  const name = entry?.name ?? assigned;
  const general = scope === "reference";
  if (name === undefined || name === null) return <p className="muted">{scope === "battle" ? "Battalion assignment unknown: not recorded for this battle." : unit ? NOT_READ : "Battalions are tracked for your units."}</p>;
  if (!name) return <p className="muted">No battalion assigned.</p>;

  const unread = scope === "battle" ? NOT_RECORDED : NOT_READ;
  const progress = general ? null : battalionLevel(unit?.battalion_exp);
  const level = progress?.level ?? null;
  const atLevel = level !== null ? entry?.stats_by_level?.[level - 1] : undefined;
  const imported = atLevel ?? entry?.stats;
  const importedAt = atLevel ? `at level ${level}` : "at level 1";
  const enduranceMax = entry?.endurance;
  const enduranceNow = general ? undefined : unit?.battalion_endurance;
  const spent = enduranceNow === 0;
  const shaken = scope === "battle" && unit?.rattled === true;
  const off = spent ? SPENT : shaken ? RATTLED : null;
  const stat = (k: BattalionStatKey): ReactNode => {
    const v = imported?.[k];
    if (v === undefined) return <Missing why={`${BATTALION_STAT_LABEL[k]}: ${NOT_IMPORTED}`} />;
    return off
      ? <span className="bp-val even spent" title={off}>{signed(v)}</span>
      : <span className={`bp-val ${tone(v)}`} title={`From your imported game files, ${importedAt}`}>{signed(v)}</span>;
  };
  const g = entry?.gambit;
  const usesMax = g?.uses;
  // Between battles the game has refilled them: a run whose battalion state was read shows them full.
  const refilled = scope === "run" && (unit?.gambit_uses === undefined || unit?.gambit_uses === null) && progress !== null;
  const usesNow = refilled ? usesMax : unit?.gambit_uses;

  return (
    <div className="bp" aria-label={`${name} battalion`}>
      <section className="bp-half bp-battalion" aria-label="Battalion">
        <header className="bp-head">
          <BattalionIcon entry={entry} />
          <h4 className="bp-name">
            <BattalionName entry={entry} name={name} />
            {progress ? (
              <span className="bp-level" title={progress.level === 5 ? "Battalion level (the highest)" : "Battalion level, and experience toward the next (100 a level)"}>
                Lv {progress.level}
                {progress.level < 5 ? <span className="bp-exp">Exp {progress.exp}</span> : null}
              </span>
            ) : null}
          </h4>
          <span className={`bp-gauge${spent ? " spent" : ""}`} title={general ? "Endurance" : "Endurance left of most"}>
            <span className="bp-gauge-label">Endurance</span>
            <span className="bp-gauge-num">
              {!general && <>
                {enduranceNow ?? <Missing why={`Endurance left: ${unread}`} />}
                <span className="bp-of">/</span>
              </>}
              {enduranceMax ?? <Missing why={`Endurance: ${NOT_IMPORTED}`} />}
            </span>
          </span>
        </header>
        <p className="bp-desc">{entry?.description || <span className="muted">{NOT_IMPORTED}</span>}</p>
        <dl className="bp-stats">
          {BATTALION_STAT_KEYS.map((k) => (
            <div className="bp-stat" key={k}>
              <dt>{BATTALION_STAT_LABEL[k]}</dt>
              <dd>{stat(k)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="bp-half bp-gambit" aria-label="Gambit">
        <header className="bp-head">
          <BattalionIcon entry={g} gambit />
          <h4 className="bp-name">{g ? g.name : <span className="muted">Gambit</span>}</h4>
          <span className="bp-gauge" title={general ? "Uses per battle" : refilled ? "Uses per battle: the game refills them after every battle" : "Uses left of most"}>
            <span className="bp-gauge-label">Uses</span>
            <span className="bp-gauge-num">
              {!general && <>
                {usesNow ?? <Missing why={`Uses left: ${unread}`} />}
                <span className="bp-of">/</span>
              </>}
              {usesMax ?? <Missing why={`Uses: ${NOT_IMPORTED}`} />}
            </span>
          </span>
        </header>
        <p className="bp-desc">{g?.description || <span className="muted">{g ? NOT_IMPORTED : `Its gambit: ${NOT_IMPORTED}`}</span>}</p>
        <div className="bp-gambit-body">
          <dl className="bp-stats single">
            <div className="bp-stat"><dt>Mt</dt><dd>{g?.might ?? <Missing why={`Mt: ${NOT_IMPORTED}`} />}</dd></div>
            <div className="bp-stat"><dt>Hit</dt><dd>{g?.hit ?? <Missing why={`Hit: ${NOT_IMPORTED}`} />}</dd></div>
            {g?.range && <div className="bp-stat"><dt>Range</dt><dd>{g.range[0] === g.range[1] ? g.range[0] : `${g.range[0]}–${g.range[1]}`}</dd></div>}
          </dl>
          <GambitAreaMap area={g?.area} name={g?.name} />
        </div>
      </section>
    </div>
  );
}

/** The battle map's own pieces (the import's minimap set), so the area looks like the game's gambit panel. */
const PIECE = (name: string) => `images/map/minimap-pieces/${name}.png`;
// The area is drawn on at least this many tiles (wider than tall, like the game's panel), one tile of margin around it.
const AREA_MIN_W = 7;
const AREA_MIN_H = 5;

/**
 * The tiles a gambit covers, drawn like the game's gambit panel with the battle map's pieces: the minimap's grid,
 * the tiles covered in gold, the user as your army's badge facing up (the area is ahead of them) and, for a gambit
 * aimed at a foe, the game's target cursor on the tile it's aimed at. Without the area, an empty frame says so.
 */
export function GambitAreaMap({ area, name }: { area?: GambitArea; name?: string }) {
  if (!area) {
    return (
      <div className="bp-area missing" title={`Area: ${NOT_IMPORTED}`}>
        <span>Area not in your import</span>
      </div>
    );
  }
  const origin = area.origin ?? [0, 0];
  const points = [...area.cells, origin, ...(area.target ? [area.target] : [])];
  let [minX, maxX] = [Math.min(...points.map((p) => p[0])) - 1, Math.max(...points.map((p) => p[0])) + 1];
  let [minY, maxY] = [Math.min(...points.map((p) => p[1])) - 1, Math.max(...points.map((p) => p[1])) + 1];
  while (maxX - minX + 1 < AREA_MIN_W) { minX -= 1; if (maxX - minX + 1 < AREA_MIN_W) maxX += 1; }
  while (maxY - minY + 1 < AREA_MIN_H) { minY -= 1; if (maxY - minY + 1 < AREA_MIN_H) maxY += 1; }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const at = ([x, y]: [number, number]) => ({ x: x - minX, y: y - minY });
  const label = `${name ? `${name}: ` : ""}covers ${area.cells.length} ${area.cells.length === 1 ? "tile" : "tiles"}`
    + (area.target ? ", aimed at a foe" : "") + "; the user faces up";
  const grid = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      grid.push(
        <g key={`${x},${y}`}>
          <rect className="bp-cell" x={x} y={y} width={1} height={1} />
          <MapImage imported={PIECE("grid")} x={x} y={y} width={1} height={1} preserveAspectRatio="none" />
        </g>,
      );
    }
  }
  const user = at(origin);
  const target = area.target ? at(area.target) : null;
  return (
    <svg className="bp-area" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} style={{ width: `${w * 1.5}rem` }}>
      <title>{label}</title>
      {grid}
      {area.cells.map((c) => {
        const p = at(c);
        return <rect key={`${c[0]},${c[1]}`} className="bp-hit" x={p.x + 0.08} y={p.y + 0.08} width={0.84} height={0.84} rx={0.08} />;
      })}
      {/* The foe it's aimed at: an enemy badge inside the game's target cursor. */}
      {target && <>
        <circle className="bp-foe" cx={target.x + 0.5} cy={target.y + 0.5} r={0.26} />
        <MapImage imported={PIECE("badge-enemy")} x={target.x + 0.22} y={target.y + 0.22} width={0.56} height={0.56} />
        <MapImage imported={PIECE("cursor-target")} x={target.x - 0.1} y={target.y - 0.1} width={1.2} height={1.2} />
      </>}
      {/* The user: your army's badge (a plain disc without the import), facing the area. */}
      <circle className="bp-user" cx={user.x + 0.5} cy={user.y + 0.5} r={0.4} />
      <MapImage imported={PIECE("badge-player")} x={user.x + 0.08} y={user.y + 0.08} width={0.84} height={0.84} />
      <path className="bp-facing" d={`M ${user.x + 0.5} ${user.y + 0.24} L ${user.x + 0.74} ${user.y + 0.62} L ${user.x + 0.5} ${user.y + 0.5} L ${user.x + 0.26} ${user.y + 0.62} Z`} />
    </svg>
  );
}
