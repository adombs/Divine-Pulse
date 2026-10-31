/**
 * Marks on a unit in the battle's lists (the Overview's units, the Units tab): its team as the log's army dot
 * (yours blue, allies green, a third army yellow, enemies red), and what's going on with it
 * as small icons, each saying what it means on hover.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { AtRisk, BattleUnit, EnemyStats } from "../../api";
import { plural } from "../../format";
import { Icon, IconName } from "../Icon";
import { isObject } from "./map";
import { LOW_HP, LOW_WEAPON } from "./model";

export type Team = "player" | "ally" | "third" | "enemy" | "object";

export const TEAM_LABEL: Record<Team, string> = { player: "Yours", ally: "Ally", third: "Third Army", enemy: "Enemy", object: "Object" };

export function teamOf(e?: EnemyStats): Team {
  if (!e) return "player";
  if (isObject(e)) return "object";
  return e.side === "ally" || e.side === "third" ? e.side : "enemy";
}

/** A unit's army as the dot the log puts before names (yours blue, enemies red, allies green, a third army yellow). */
export function TeamTag({ team }: { team: Team }) {
  return <span className={`team-dot team-${team}`} role="img" aria-label={TEAM_LABEL[team]} title={TEAM_LABEL[team]} />;
}

export interface Flag {
  icon: IconName;
  title: string;
  tone: "bad" | "warn" | "info" | "quiet";
}

export const FELL: Flag = { icon: CONCEPT_ICON.fell, title: "Fell", tone: "bad" };
export const DEFEATED: Flag = { icon: CONCEPT_ICON.defeat, title: "Killed", tone: "bad" };
export const AWAY: Flag = { icon: CONCEPT_ICON.left, title: "Not on the map", tone: "warn" };
export const ACTED: Flag = { icon: CONCEPT_ICON.done, title: "Has acted this phase", tone: "quiet" };
export const adjutantFlag = (of?: string): Flag => ({ icon: CONCEPT_ICON.adjutant, title: of ? `Adjutant to ${of}` : "Adjutant: fights beside another unit", tone: "info" });

/** Low HP: some left, at most LOW_HP of its max. */
export function lowHpFlag(hp: number | null, max: number | null): Flag | null {
  if (hp === null || !max || hp <= 0 || hp / max > LOW_HP) return null;
  return { icon: CONCEPT_ICON.lowHp, title: `Low HP: ${hp} of ${max}`, tone: "warn" };
}

/** One of your units as things stand now: fell, adjutant, at risk of falling, out of magic, weapons worn out. */
export function armyFlags(u: BattleUnit, risk: AtRisk | undefined, adjutantOf?: string): Flag[] {
  if (u.adjutant_of) return [adjutantFlag(adjutantOf)];
  if (!u.on_map) return [{ icon: CONCEPT_ICON.fell, title: "Left the battle (fell or retreated)", tone: "bad" }];
  const out: Flag[] = [];
  if (risk) {
    const near = risk.near ? ` · ${plural(risk.near, "other unit")} in reach` : "";
    if (risk.critical) out.push({ icon: CONCEPT_ICON.critical, title: `Could fall, and losing them loses the battle${near}`, tone: "bad" });
    else out.push({ icon: CONCEPT_ICON.danger, title: `${risk.level === "danger" ? "In danger" : "Exposed"}: could fall${near}`, tone: risk.level === "danger" ? "bad" : "warn" });
  }
  const low = lowHpFlag(u.hp, u.now.hp);
  if (low) out.push(low);
  if (u.spell_uses_full && u.spell_uses_left === 0) out.push({ icon: CONCEPT_ICON.noMagic, title: "No spell uses left", tone: "warn" });
  if (u.broken_weapons > 0) out.push({ icon: CONCEPT_ICON.broken, title: plural(u.broken_weapons, "broken weapon"), tone: "warn" });
  else if (u.weakest_weapon !== null && u.weakest_weapon <= LOW_WEAPON)
    out.push({ icon: CONCEPT_ICON.worn, title: `A weapon with ${plural(u.weakest_weapon, "use")} left`, tone: "warn" });
  return out;
}

export function Flags({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <span className="unit-flags">
      {flags.map((f) => (
        <span key={f.icon} className={`unit-flag ${f.tone}`} title={f.title}>
          <Icon name={f.icon} title={f.title} />
        </span>
      ))}
    </span>
  );
}
