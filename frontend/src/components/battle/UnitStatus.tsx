/**
 * Everyone on the board at a glance, for the Overview: yours, the enemy and any other army, filtered by team. HP, and
 * for your units what to watch out for on the unit itself (at risk of falling, out of magic, a weapon about to break,
 * fell). Follows the replay: at a step, each unit as it was after it (the map's board); otherwise as things stand now.
 * While a battle is followed live, your units yet to act this phase come first, lowest eBST first; those that have
 * acted are dimmed and marked. Breakable walls and other objects aren't listed.
 */
import { useState, type ReactNode } from "react";
import type { Battle, BattleUnit } from "../../api";
import { computeEbst, DEFAULT_CONFIG } from "../../ebst";
import { CheckList, FilterMenu } from "../common";
import { Section } from "../layout";
import { isObject } from "./map";
import { battleWeapon } from "./unitAppearance";
import { ACTED, adjutantFlag, armyFlags, AWAY, DEFEATED, FELL, Flag, Flags, hasFallen, lowHpFlag, Team, TeamTag, teamOf } from "./marks";
import { armyId, enemies, enemyId, LOW_HP, people } from "./model";
import { WeaponIcon } from "./gameIcons";
import { UnitFace, useBattleNav } from "./parts";
import { AffiliationIcon } from "../AffiliationIcon";
import type { Replay } from "./replay";
import { HpBar } from "./HpBar";

type ListTeam = Exclude<Team, "object">;

const TEAMS: readonly (readonly [ListTeam, ReactNode])[] = [
  ["player", <span className="filter-label"><span aria-hidden="true"><TeamTag team="player" /></span>Your Units</span>],
  ["ally", <span className="filter-label"><span aria-hidden="true"><TeamTag team="ally" /></span>Allies</span>],
  ["third", <span className="filter-label"><span aria-hidden="true"><TeamTag team="third" /></span>Third Army</span>],
  ["enemy", <span className="filter-label"><span aria-hidden="true"><TeamTag team="enemy" /></span>Enemies</span>],
];
const TEAM_ORDER: Record<ListTeam, number> = { player: 0, ally: 1, third: 2, enemy: 3 };

/** One row: a unit as it stands now or at the replay's step. `off`: fell, was defeated, or isn't on the map. */
interface Row {
  id: string;
  name: string;
  team: ListTeam;
  hp: number | null;
  max: number | null;
  off: boolean;
  acted: boolean;
  flags: Flag[];
  /** What it fights with (the map's weapon names); empty when not known. */
  weapon: string;
  unit?: BattleUnit;
}

const listTeam = (t: Team): ListTeam => (t === "object" ? "enemy" : t);
const withLowHp = (flags: Flag[], hp: number | null, max: number | null): Flag[] => {
  const low = lowHpFlag(hp, max);
  return low ? [...flags, low] : flags;
};

/** Everyone as things stand now: all your units, and the other units on the map or defeated (not those taken off). */
function rowsNow(battle: Battle): Row[] {
  const risks = new Map((battle.outlook?.at_risk ?? []).map((r) => [r.key, r]));
  const nameOf = (key: string) => battle.units.find((u) => u.key === key)?.name;
  const yours: Row[] = battle.units.map((u): Row => ({
    id: armyId(u.key), name: u.name, team: "player", hp: u.hp, max: u.now.hp, off: !u.on_map || hasFallen(u), acted: !!u.acted, weapon: u.weapon ?? "",
    flags: armyFlags(u, risks.get(u.key), u.adjutant_of ? nameOf(u.adjutant_of) : undefined), unit: u,
  }));
  const others: Row[] = enemies(battle)
    .filter((e) => !isObject(e) && !e.left)
    .map((e): Row => {
      const down = !e.on_map || (e.hp !== null && e.hp <= 0);
      const hp = e.hp === null ? null : Math.max(0, e.hp);
      return {
        id: enemyId(e.slot), name: e.label, team: listTeam(teamOf(e)), hp, max: e.max_hp, off: down, acted: false, weapon: battleWeapon(e),
        flags: down ? [DEFEATED] : withLowHp([], hp, e.max_hp),
      };
    });
  return [...yours, ...others];
}

/** Everyone as they were after the replay's step, from the map's board: your units not on it then are listed as off
 * the map; the others only when on it (defeated ones where they fell). */
function rowsAt(battle: Battle, replay: Replay): Row[] {
  const who = people(battle);
  const pieces = new Map(replay.board.pieces.filter((p) => !p.object).map((p) => [p.id, p]));
  const yours: Row[] = battle.units.map((u): Row => {
    const id = armyId(u.key);
    const p = pieces.get(id);
    const weapon = u.weapon ?? "";
    if (!p) return { id, name: u.name, team: "player", hp: null, max: u.now.hp, off: true, acted: false, weapon, flags: [u.adjutant_of ? adjutantFlag() : AWAY], unit: u };
    const max = p.max ?? u.now.hp;
    return { id, name: u.name, team: "player", hp: p.hp, max, off: p.down, acted: false, weapon, flags: p.down ? [FELL] : withLowHp([], p.hp, max), unit: u };
  });
  const others: Row[] = [...pieces.values()]
    .filter((p) => !p.army)
    .map((p): Row => ({
      id: p.id, name: p.name, team: listTeam(teamOf(who.get(p.id)?.enemy)), hp: p.hp, max: p.max, off: p.down, acted: false, weapon: p.weapon,
      flags: p.down ? [DEFEATED] : withLowHp([], p.hp, p.max),
    }));
  return [...yours, ...others];
}

export function UnitStatus({ battle, replay }: { battle: Battle; replay: Replay }) {
  const nav = useBattleNav();
  const [teams, setTeams] = useState<ListTeam[]>([]);
  const live = replay.at === null;
  const all = live ? rowsNow(battle) : rowsAt(battle, replay);
  // The teams in the battle at all, so the filter doesn't change while the replay moves.
  const present = new Set<ListTeam>([...(battle.units.length ? (["player"] as ListTeam[]) : []), ...enemies(battle).filter((e) => !isObject(e)).map((e) => listTeam(teamOf(e)))]);
  const options = TEAMS.filter(([t]) => present.has(t));
  const shown = all.filter((r) => !teams.length || teams.includes(r.team));

  const fielded = all.filter((r) => r.team === "player" && !r.off && (r.hp === null || r.hp > 0));
  const steps = battle.map_steps ?? [];
  const enemyPhase = steps.length > 0 && steps[steps.length - 1].phase !== 0;
  const tracking = live && battle.active && fielded.some((r) => r.unit?.acted !== null && r.unit?.acted !== undefined) && !enemyPhase;
  const ebst = (r: Row) => (r.unit ? computeEbst(r.unit.now, nav.ebstConfig?.(r.unit.key) ?? DEFAULT_CONFIG).ebst : 0);
  const rank = (r: Row) => (r.off ? 2 : tracking && r.acted ? 1 : 0);
  const rows = [...shown].sort(
    (a, b) => TEAM_ORDER[a.team] - TEAM_ORDER[b.team] || rank(a) - rank(b) || (tracking ? ebst(a) - ebst(b) : 0) || a.name.localeCompare(b.name),
  );
  return (
    <Section
      title="Units"
      right={
        options.length > 1 && (
          <FilterMenu small count={teams.length} onClear={() => setTeams([])}>
            <CheckList label="Team" options={options} value={teams} onChange={setTeams} />
          </FilterMenu>
        )
      }
    >
      <ol className="unit-status">
        {rows.map((r) => {
          const hp = r.hp === null || !r.max ? null : Math.max(0, Math.min(1, r.hp / r.max));
          const low = hp !== null && hp > 0 && hp <= LOW_HP;
          const acted = !r.off && tracking && r.acted;
          return (
            <li key={r.id} className={r.off ? "off" : acted ? "acted" : ""}>
              <button type="button" className="unit-status-row" onClick={() => nav.open(r.id)} title={`Show ${r.name}`}>
                <UnitFace id={r.id} name={r.name} size="sm" />
                <span className="unit-status-name">
                  <b>{r.name}</b>
                  <AffiliationIcon house={nav.house?.(r.id)} side={r.team} bare />
                  <WeaponIcon kind={r.weapon} />
                  <span className="status-cell">
                    {(r.team === "player" ? nav.mapLook?.myFaces : nav.mapLook?.otherFaces) === "sprites" && <TeamTag team={r.team} />}
                    <Flags flags={acted ? [...r.flags, ACTED] : r.flags} />
                  </span>
                </span>
                <HpBar hp={r.hp} max={r.max} className={low ? "low" : undefined} />
              </button>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
