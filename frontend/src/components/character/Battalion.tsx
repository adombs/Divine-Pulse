/**
 * A unit's battalion, the same in every character view, laid out like the game's battalion panel: the battalion (icon,
 * name, endurance, description, the eight modifiers) beside its gambit (icon, name, uses, description, Mt, Hit and the
 * tiles it hits).
 *
 * The app shows only what it has: the player's import (data/battalions.json) and what's read from game memory (the
 * assignment, its experience and endurance, and gambit uses left in a battle). The level and its
 * modifiers follow from the experience and the import. Anything missing shows "—" with the reason, never a made-up
 * value.
 */
import { useState, type ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { battalionLevel, battalionReference } from "../../reference/battalions";
import type { BattleUnit, Unit } from "../../api";
import { BATTALION_STAT_KEYS, BATTALION_STAT_LABEL, useReference } from "../../reference/types";
import type { Battalion, BattalionStatKey, GambitArea } from "../../reference/types";
import { GameImage, useGameImageUrl } from "../GameImage";
import { Icon } from "../Icon";
import { BattalionLink } from "../Links";
import "./character.css";
import "./battalion.css";

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

/** A missing native icon is an explicit asset error, never an alternative picture. */
function BattalionIcon({ entry, size = "md", gambit = false }: { entry?: { icon?: string; name: string }; size?: "sm" | "md"; gambit?: boolean }) {
  if (!entry?.icon) return <span className={`bp-icon-error ${size}`} role="status" title={`${gambit ? "Gambit" : "Battalion"} icon: ${NOT_IMPORTED}`}>Icon missing</span>;
  return <GameImage imported={entry.icon} className={`bp-icon ${size}`} alt="" draggable={false} />;
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
  const [pickedLevel, setPickedLevel] = useState(1);
  const assigned = given ?? unit?.battalion;
  const entry = useBattalion(assigned, given === undefined ? unit?.battalion_id : undefined);
  const name = entry?.name ?? assigned;
  const general = scope === "reference";
  if (name === undefined || name === null) return <p className="muted">{scope === "battle" ? "Battalion assignment unknown: not recorded for this battle." : unit ? NOT_READ : "Battalions are tracked for your units."}</p>;
  if (!name) return <p className="muted">No battalion assigned.</p>;

  const unread = scope === "battle" ? NOT_RECORDED : NOT_READ;
  const progress = general ? null : battalionLevel(unit?.battalion_exp);
  const hasProgression = entry?.stats_by_level?.length === 5;
  const referenceLevel = hasProgression ? pickedLevel : 1;
  const level = general ? referenceLevel : progress?.level ?? null;
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
  const enduranceRatio = enduranceNow !== undefined && enduranceNow !== null && enduranceMax !== undefined && enduranceMax > 0
    ? Math.max(0, Math.min(1, enduranceNow / enduranceMax)) : null;

  return (
    <div className="bp-dossier">
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
        {enduranceRatio !== null && <div className={`bp-endurance-track${spent ? " spent" : ""}`} aria-hidden="true"><span style={{ width: `${enduranceRatio * 100}%` }} /></div>}
        <div className="bp-modifier-head">
          <h5 className="bp-section-title">{general && hasProgression ? "Level" : "Modifiers"}</h5>
          {general && hasProgression ? <div className="bp-level-picker" role="group" aria-label="Reference battalion level">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`Level ${n}`} aria-pressed={referenceLevel === n} title={`Show modifiers at level ${n}`} onClick={() => setPickedLevel(n)}>{n}</button>)}
          </div> : <span className="bp-stat-level">{level !== null ? `Level ${level}` : "Level 1 reference"}</span>}
        </div>
        <dl className="bp-stats" aria-label="Battalion modifiers">
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
          <dl className="bp-gambit-stats" aria-label="Gambit performance">
            <div className="bp-stat"><dt>Mt</dt><dd>{g?.might ?? <Missing why={`Mt: ${NOT_IMPORTED}`} />}</dd></div>
            <div className="bp-stat"><dt>Hit</dt><dd>{g?.hit ?? <Missing why={`Hit: ${NOT_IMPORTED}`} />}</dd></div>
            {g?.range && <div className="bp-stat"><dt>Range</dt><dd>{g.range[0] === g.range[1] ? g.range[0] : `${g.range[0]}–${g.range[1]}`}</dd></div>}
          </dl>
          <figure className="bp-target-area">
            <GambitAreaMap area={g?.area} name={g?.name} />
            <figcaption>Target area</figcaption>
          </figure>
        </div>
      </section>
    </div>
    </div>
  );
}

/** The native gambit preview pieces, imported from the battle UI atlas. */
const PIECE = (name: string) => `images/map/minimap-pieces/${name}.png`;
const AREA_CELL = 24;
const AREA_WIDTH = 218;
const AREA_HEIGHT = 146;

/**
 * The game's fixed 9 x 6 preview. Forward areas sit above a blue upward badge; centred areas surround one downward
 * badge (red for an enemy target, blue for support). A centred attack never adds a separate user or target cursor.
 * Sprite transparency supplies the tile edges and the chevron's padding; all pieces occupy the same 24 px cell.
 */
export function GambitAreaMap({ area, name }: { area?: GambitArea; name?: string }) {
  const gridUrl = useGameImageUrl(PIECE("range-grid"));
  const cellUrl = useGameImageUrl(PIECE("range-cell"));
  const badgeUrl = useGameImageUrl(PIECE(area?.target ? "range-enemy" : "range-player"));
  const chevronUrl = useGameImageUrl(PIECE("range-chevron"));
  if (!area) {
    return (
      <div className="bp-area missing" role="alert">
        <strong>Target area unavailable</strong>
        <span>Import the required game files to display this area.</span>
      </div>
    );
  }
  if (!gridUrl || !cellUrl || !badgeUrl || !chevronUrl) return <div className="bp-area missing" role="status">
    <strong>Target area assets required</strong>
    <span>The native grid, tiles and marker must be supplied by your game-file import.</span>
  </div>;
  const origin = area.origin ?? [0, 0];
  const forward = area.direction === "forward";
  const centre = area.target ?? origin;
  // Four tiles straight ahead need the badge one row lower. All other native previews anchor on row 3.
  const row = forward ? Math.max(3, ...area.cells.map(([, y]) => origin[1] - y)) : 3;
  const at = ([x, y]: [number, number]) => ({ x: 1 + (4 + x - centre[0]) * AREA_CELL, y: 1 + (row + y - centre[1]) * AREA_CELL });
  const label = `${name ? `${name}: ` : ""}covers ${area.cells.length} ${area.cells.length === 1 ? "tile" : "tiles"}`
    + (area.target ? "; red target marker at the centre" : forward ? "; blue user marker facing up" : "; blue user marker at the centre");
  const marker = at(centre);
  return (
    <svg className="bp-area" viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`} role="img" aria-label={label}>
      <title>{label}</title>
      <image href={gridUrl} x={0} y={0} width={AREA_WIDTH} height={AREA_HEIGHT} />
      {area.cells.map((c) => {
        const p = at(c);
        return <g key={`${c[0]},${c[1]}`} transform={`translate(${p.x} ${p.y})`}>
          <image href={cellUrl} width={AREA_CELL} height={AREA_CELL} />
        </g>;
      })}
      <g className={`bp-marker ${area.target ? "foe" : "user"}`} transform={`translate(${marker.x} ${marker.y})`}>
        <image href={badgeUrl} width={AREA_CELL} height={AREA_CELL} />
        <g transform={forward ? `translate(0 ${AREA_CELL}) scale(1 -1)` : undefined}>
          <image href={chevronUrl} width={AREA_CELL} height={AREA_CELL} />
        </g>
      </g>
    </svg>
  );
}
