/**
 * A unit's battalion, the same in every character view, laid out like the game's battalion panel: the battalion (icon,
 * name, endurance, description, the eight modifiers) beside its gambit (icon, name, uses, description, Mt, Hit and the
 * tiles it hits).
 *
 * The app shows only what it has: the player's import (data/battalions.json) and what's read from game memory.
 * Anything missing shows "—" with the reason, never a made-up value. The assignment itself is read from a memory
 * location that isn't confirmed yet, so it's marked as unconfirmed.
 */
import type { ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { canonical } from "../../fuzzy";
import type { Unit } from "../../api";
import { BATTALION_STAT_KEYS, BATTALION_STAT_LABEL, useReference } from "../../reference/types";
import type { Battalion, BattalionStatKey, GambitArea } from "../../reference/types";
import { GameImage } from "../GameImage";
import { Icon } from "../Icon";
import { BattalionLink } from "../Links";
import "./character.css";

export const UNCONFIRMED_BATTALION =
  "Read from game memory at a place that isn't confirmed yet, so it may be wrong. Check it in game.";
const NOT_IMPORTED = "Not in your imported game files yet.";
const NOT_READ = "Not read from the game yet.";

/** The import's entry for a battalion name (matched loosely, as names saved by older versions may differ). */
export function useBattalion(name: string | null | undefined): Battalion | undefined {
  const ref = useReference();
  const list = ref?.battalions ?? [];
  if (!name || !list.length) return undefined;
  const known = canonical(name, list.map((b) => b.name));
  return known ? list.find((b) => b.name === known) : undefined;
}

/** A compact badge for the hero: the flag, the name (linked to the Archive) and its endurance. `name` is the unit's
 * assignment: undefined when it hasn't been read, "" for none. */
export function BattalionBadge({ unit }: { unit: Pick<Unit, "battalion" | "battalion_endurance" | "battalion_endurance_max"> | undefined }) {
  const name = unit?.battalion;
  const entry = useBattalion(name);
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
  const max = unit?.battalion_endurance_max ?? entry?.endurance;
  const now = unit?.battalion_endurance;
  return (
    <span className="cv-battalion" title={entry?.description || name}>
      <BattalionIcon entry={entry} size="sm" />
      <span className="cv-battalion-name">
        <BattalionLink name={name} />
      </span>
      {max !== undefined && max !== null && (
        <span className="cv-battalion-end" title={now === undefined || now === null ? "Endurance; what's left isn't read yet" : "Endurance left of most"}>
          {now === undefined || now === null ? `End ${max}` : `${now}/${max}`}
        </span>
      )}
      <span className="cv-unconfirmed" title={UNCONFIRMED_BATTALION} aria-label="Unconfirmed">?</span>
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

/**
 * The battalion panel. `unit` is the run's unit (its assignment and what's been read of it); `scope` says whether it
 * sits in a battle window (the figures are still the run's, as last read), the Roster, or the Archive ("reference":
 * the battalion itself, `name`, with no unit).
 */
export function BattalionPanel({ unit, name: given, scope }: { unit?: Unit; name?: string; scope: "battle" | "run" | "reference" }) {
  const name = given ?? unit?.battalion;
  const entry = useBattalion(name);
  const general = scope === "reference";
  if (name === undefined || name === null) return <p className="muted">{unit ? NOT_READ : "Battalions are tracked for your units."}</p>;
  if (!name) return <p className="muted">No battalion assigned.</p>;

  const level = unit?.battalion_level ?? null;
  const read = unit?.battalion_stats ?? null;
  const imported = level !== null && entry?.stats_by_level?.[level - 1] ? entry.stats_by_level[level - 1] : entry?.stats;
  const importedAt = level !== null && entry?.stats_by_level?.[level - 1] ? `at level ${level}` : "at level 1";
  const stat = (k: BattalionStatKey): ReactNode => {
    const r = read?.[k];
    if (r) {
      return (
        <>
          <span className={`bp-val ${tone(r.value)}`}>{signed(r.value)}</span>
          {r.adjust !== undefined && r.adjust !== 0 && (
            <span className={`bp-adj ${tone(r.adjust)}`} title="The panel's separate adjustment">
              <Icon name={CONCEPT_ICON.next} />
              {signed(r.adjust)}
            </span>
          )}
        </>
      );
    }
    const v = imported?.[k];
    if (v !== undefined) return <span className={`bp-val ${tone(v)}`} title={`From your imported game files, ${importedAt}`}>{signed(v)}</span>;
    return <Missing why={`${BATTALION_STAT_LABEL[k]}: ${NOT_IMPORTED}`} />;
  };
  const enduranceMax = unit?.battalion_endurance_max ?? entry?.endurance;
  const enduranceNow = unit?.battalion_endurance;
  const g = entry?.gambit;
  const usesMax = unit?.gambit_uses_max ?? g?.uses;
  const usesNow = unit?.gambit_uses;
  const missingParts = [
    !entry?.icon && "battalion icon",
    !general && (enduranceNow === undefined || enduranceNow === null) && "endurance left",
    !read && !imported && "modifiers",
    !g && "gambit",
    g && !g.icon && "gambit icon",
    !general && g && (usesNow === undefined || usesNow === null) && "gambit uses left",
    g && !g.area && "gambit area",
  ].filter(Boolean) as string[];

  return (
    <div className="bp" aria-label={`${name} battalion`}>
      <section className="bp-half bp-battalion" aria-label="Battalion">
        <header className="bp-head">
          <BattalionIcon entry={entry} />
          <h4 className="bp-name">
            <BattalionLink name={name} />
            {level !== null && <span className="bp-level">Lv {level}</span>}
          </h4>
          <span className="bp-gauge" title={general ? "Endurance" : "Endurance left of most"}>
            <span className="bp-gauge-label">Endurance</span>
            <span className="bp-gauge-num">
              {!general && <>
                {enduranceNow ?? <Missing why={`Endurance left: ${NOT_READ}`} />}
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
          <span className="bp-gauge" title={general ? "Uses per battle" : "Uses left of most"}>
            <span className="bp-gauge-label">Uses</span>
            <span className="bp-gauge-num">
              {!general && <>
                {usesNow ?? <Missing why={`Uses left: ${NOT_READ}`} />}
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
      {general ? (
        missingParts.length > 0 && <p className="bp-note">Not in your imported game files yet: {missingParts.join(", ")}.</p>
      ) : (
        <p className="bp-note">
          <span className="cv-unconfirmed" aria-hidden>?</span>
          <span>
            {scope === "battle" ? "The run's battalion as last read, not just this battle's. " : ""}
            {UNCONFIRMED_BATTALION}
            {missingParts.length > 0 && ` Not available yet: ${missingParts.join(", ")}.`}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The tiles a gambit hits, as a little map: the user's tile in blue (with its facing), the tiles hit in gold. The
 * area faces up (away from the user). Without the area, an empty frame says it isn't in the import.
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
  const xs = [...area.cells.map((c) => c[0]), origin[0]];
  const ys = [...area.cells.map((c) => c[1]), origin[1]];
  // One empty tile of margin around the tiles drawn, and at least 5 x 5 so a small area doesn't look huge.
  let [minX, maxX, minY, maxY] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
  while (maxX - minX + 1 < 5) { minX -= 1; if (maxX - minX + 1 < 5) maxX += 1; }
  while (maxY - minY + 1 < 5) { minY -= 1; if (maxY - minY + 1 < 5) maxY += 1; }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const hit = new Set(area.cells.map(([x, y]) => `${x},${y}`));
  const label = `${name ? `${name}: ` : ""}hits ${area.cells.length} ${area.cells.length === 1 ? "tile" : "tiles"}; the user's tile is blue and the area faces up, away from them`;
  const tiles = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const isOrigin = x === origin[0] && y === origin[1];
      tiles.push(<rect key={`${x},${y}`} className={`bp-tile${hit.has(`${x},${y}`) ? " hit" : ""}${isOrigin ? " origin" : ""}`} x={x - minX + 0.06} y={y - minY + 0.06} width={0.88} height={0.88} rx={0.12} />);
    }
  }
  const ox = origin[0] - minX + 0.5;
  const oy = origin[1] - minY + 0.5;
  return (
    <svg className="bp-area" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} style={{ aspectRatio: `${w} / ${h}` }}>
      <title>{label}</title>
      {tiles}
      {/* The user, facing the area. */}
      <path className="bp-facing" d={`M ${ox} ${oy - 0.26} L ${ox + 0.24} ${oy + 0.18} L ${ox} ${oy + 0.06} L ${ox - 0.24} ${oy + 0.18} Z`} />
    </svg>
  );
}
