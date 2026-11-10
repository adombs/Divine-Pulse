/**
 * Marks on a unit in the battle's lists (the Overview's units, the Units tab): its team as the log's army dot
 * (yours blue, allies green, a third army yellow, enemies red), and what's going on with it
 * as small icons, each saying what it means on hover.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { AtRisk, Battle, BattleUnit, EnemyStats } from "../../api";
import { plural } from "../../format";
import { Icon, IconName } from "../Icon";
import { isObject } from "./map";
import { LOW_HP, LOW_WEAPON } from "./model";

export type Team = "player" | "ally" | "third" | "enemy" | "object";

export const TEAM_LABEL: Record<Team, string> = { player: "Yours", ally: "Ally", third: "Third Army", enemy: "Enemy", object: "Object" };

export function teamOf(e?: EnemyStats): Team {
  if (!e) return "player";
  if (isObject(e)) return "object";
  return e.side === "player" || e.side === "ally" || e.side === "third" ? e.side : "enemy";
}

/** How many units of one army are on the map now, of how many have been in the battle. */
export interface TeamCount {
  team: Team;
  now: number;
  of: number;
}

const TEAM_ORDER: Team[] = ["player", "ally", "enemy", "third"];

/** Units on the map by army, yours first (your army and your units outside the roster, as the house leaders in the
 * prologue). An army shows only once it has had a unit in the battle; reinforcements still to come don't count yet. */
export function teamCounts(battle: Battle): TeamCount[] {
  const counts = new Map<Team, TeamCount>(TEAM_ORDER.map((team) => [team, { team, now: 0, of: 0 }]));
  for (const u of battle.units) {
    const c = counts.get("player")!;
    c.of += 1;
    if (!isLost(u)) c.now += 1;
  }
  for (const e of Object.values(battle.enemy_stats ?? {})) {
    const team = teamOf(e);
    const c = counts.get(team);
    const defeated = (e.hp !== null && e.hp !== undefined && e.hp <= 0) || !!e.defeated_by;
    if (!c || !(e.on_map || e.left || defeated)) continue;
    c.of += 1;
    if (e.on_map && !defeated) c.now += 1;
  }
  return TEAM_ORDER.map((team) => counts.get(team)!).filter((c) => c.of > 0);
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

export const FELL: Flag = { icon: CONCEPT_ICON.fell, title: "Fallen", tone: "bad" };
export const DEFEATED: Flag = { icon: CONCEPT_ICON.defeat, title: "Killed", tone: "bad" };
export const AWAY: Flag = { icon: CONCEPT_ICON.left, title: "Not on the map", tone: "warn" };
export const ACTED: Flag = { icon: CONCEPT_ICON.done, title: "Has acted this phase", tone: "quiet" };
export const adjutantFlag = (of?: string): Flag => ({ icon: CONCEPT_ICON.adjutant, title: of ? `Adjutant to ${of}` : "Adjutant: fights beside another unit", tone: "info" });

/** Low HP: some left, at most LOW_HP of its max. */
export function lowHpFlag(hp: number | null, max: number | null): Flag | null {
  if (hp === null || !max || hp <= 0 || hp / max > LOW_HP) return null;
  return { icon: CONCEPT_ICON.lowHp, title: `Low HP: ${hp} of ${max}`, tone: "warn" };
}

/** Still on the map in the game's record, but out of HP: it fell. */
export const hasFallen = (u: BattleUnit): boolean => u.on_map && u.hp !== null && u.hp <= 0;

/** Lost to the battle: fell, or left the map altogether. An adjutant is in the battle without being on the map. */
export const isLost = (u: BattleUnit): boolean => !u.adjutant_of && (!u.on_map || hasFallen(u));

/** One of your units as things stand now: fell, adjutant, at risk of falling, out of magic, weapons worn out. */
export function armyFlags(u: BattleUnit, risk: AtRisk | undefined, adjutantOf?: string): Flag[] {
  if (u.adjutant_of) return [adjutantFlag(adjutantOf)];
  if (!u.on_map) return [{ icon: CONCEPT_ICON.fell, title: "Left the battle (fell or retreated)", tone: "bad" }];
  // A unit that fell leads with that; its other marks (a broken weapon) follow.
  const out: Flag[] = hasFallen(u) ? [FELL] : [];
  if (risk && !hasFallen(u)) {
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
