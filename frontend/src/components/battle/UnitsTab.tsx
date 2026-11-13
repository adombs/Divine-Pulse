/**
 * Everyone in the battle, yours and the others, in one table: search, filter by side and by what happened to them,
 * sort by any column, and pick one to see its card beside the table (UnitPopup.tsx). Breakable walls aren't units
 * and don't show.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useState, type ReactNode } from "react";
import { FilterLabel } from "../FilterLabel";
import type { Battle, BattleUnit, EnemyStats, Unit } from "../../api";
import { CheckChips, CheckList, compareValues, FilterMenu, NoMatches, SearchBox, useSort } from "../common";
import { EmptyState, MasterDetail } from "../layout";
import { searchMatches } from "../../fuzzy";
import { armyFlags, Flag, Flags, lowHpFlag, Team, TeamTag, teamOf } from "./marks";
import { isObject } from "./map";
import { countsForRun } from "./rosterRule";
import { armyId, enemies, enemyId, hpShare, Item, tally } from "./model";
import { WeaponIcon } from "./gameIcons";
import { battleWeapon } from "./unitAppearance";
import { HouseMark, Num, UnitFace } from "./parts";
import { enemyStatus, UnitDetail } from "./UnitPopup";
import { HpBar } from "./HpBar";
import { deathText } from "../../deaths";

type Col = "name" | "level" | "hp" | "status" | "fights" | "dealt" | "taken" | "healing" | "defeats";
type State = "alive" | "defeated" | "left";

const SIDE_OPTIONS: [Team, ReactNode][] = [
  ["player", <span className="filter-label"><span aria-hidden="true"><TeamTag team="player" /></span>Your Units</span>],
  ["enemy", <span className="filter-label"><span aria-hidden="true"><TeamTag team="enemy" /></span>Enemy Units</span>],
  ["ally", <span className="filter-label"><span aria-hidden="true"><TeamTag team="ally" /></span>Ally Units</span>],
  ["third", <span className="filter-label"><span aria-hidden="true"><TeamTag team="third" /></span>Third Army</span>],
];
const STATE_OPTIONS: [State, ReactNode][] = [
  ["alive", <FilterLabel icon={CONCEPT_ICON.heal}>Alive</FilterLabel>],
  ["defeated", <FilterLabel icon={CONCEPT_ICON.defeat}>Killed</FilterLabel>],
  ["left", <FilterLabel icon={CONCEPT_ICON.left}>Left the Map</FilterLabel>],
];

/** One row of the table: one of your units or another unit on the map. */
interface Row {
  id: string;
  army: boolean;
  name: string;
  className: string;
  level: number;
  levelUps: number;
  hp: number | null;
  max: number;
  onMap: boolean;
  team: Team;
  flags: Flag[];
  fights: number | null;
  defeats: number | null;
  dealt: number | null;
  taken: number | null;
  healing: number | null;
  /** Why the numbers are blank when they aren't counted (a guest that never joined your army). */
  uncounted?: string;
  unit?: BattleUnit;
  enemy?: EnemyStats;
}

interface Props {
  battle: Battle;
  items: Item[];
  /** The unit whose card shows beside the table (else the first row's). */
  selected: string | null;
  onSelect: (id: string) => void;
  roster: Unit[];
  part2: boolean;
}

export function UnitsTab({ battle, items, selected, onSelect, roster, part2 }: Props) {
  const risks = new Map((battle.outlook?.at_risk ?? []).map((r) => [r.key, r]));
  const [sides, setSides] = useState<Team[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [query, setQuery] = useState("");
  const { sort, header } = useSort<Col>({ key: "status", dir: 1 }, ["name", "status"]);

  // Your units that died for good in this battle (the run's Roster has their death).
  // A guest that isn't on the run's roster is listed (it fought on your side) but its numbers aren't counted.
  const rosterKeys = new Set(roster.map((r) => r.key));
  const diedHere = (key: string) => roster.find((r) => r.key === key && r.death?.battle_id === battle.id);
  const all: Row[] = [
    ...battle.units.map((u) => {
      const t = tally(items, armyId(u.key), { fights: u.combats, defeats: u.defeats });
      const counts = countsForRun(u, rosterKeys);
      return {
        id: armyId(u.key),
        army: true,
        name: u.name,
        className: u.class_name,
        level: u.level,
        levelUps: u.level_ups,
        hp: u.hp,
        max: u.now.hp,
        onMap: u.on_map,
        team: "player" as Team,
        flags: diedHere(u.key)
          ? [{ icon: CONCEPT_ICON.dead, title: `Died here: ${deathText(diedHere(u.key)!)}`, tone: "bad" as const }]
          : armyFlags(u, battle.active ? risks.get(u.key) : undefined, u.adjutant_of ? nameOf(battle, u.adjutant_of) : undefined),
        uncounted: counts ? undefined : "Not counted: not in your army",
        fights: counts ? t.fights : null,
        defeats: counts ? t.defeats : null,
        dealt: counts ? u.damage_dealt : null,
        taken: counts ? u.damage_taken : null,
        healing: counts ? u.healing_given : null,
        unit: u,
      };
    }),
    ...enemies(battle)
      .filter((e) => !isObject(e))
      .map((e) => {
        const t = tally(items, enemyId(e.slot), { fights: e.combats, defeats: e.defeats });
        const hp = e.hp === null ? null : Math.max(0, e.hp);
        const low = e.on_map ? lowHpFlag(hp, e.max_hp) : null;
        return {
          id: enemyId(e.slot),
          army: false,
          name: e.label,
          className: e.class_name,
          level: e.level,
          levelUps: 0,
          hp,
          max: e.max_hp,
          onMap: e.on_map,
          team: teamOf(e),
          flags: e.on_map ? (low ? [low] : []) : [{ icon: e.left ? CONCEPT_ICON.left : CONCEPT_ICON.defeat, title: enemyStatus(e), tone: e.left ? "warn" : "bad" } as Flag],
          fights: t.fights,
          defeats: t.defeats ?? 0,
          dealt: e.damage_dealt,
          taken: e.damage_taken,
          healing: null,
          enemy: e,
        };
      }),
  ];
  if (!all.length) return <EmptyState title="No units yet">Everyone in the battle shows here once its data is read.</EmptyState>;

  const state = (r: Row): State => (r.onMap ? "alive" : r.enemy?.left ? "left" : "defeated");
  const value = (r: Row, key: Col): number | string => {
    switch (key) {
      case "name": return r.name;
      case "level": return r.level;
      case "hp": return r.hp === null ? -1 : hpShare(r.hp, r.max) ?? -1;
      case "status": return (r.onMap ? 0 : 2) + (r.army ? 0 : 1);
      case "fights": return r.fights ?? -1;
      case "dealt": return r.dealt ?? -1;
      case "taken": return r.taken ?? -1;
      case "healing": return r.healing ?? -1;
      case "defeats": return r.defeats ?? -1;
    }
  };
  const rows = all
    .filter((r) => (!query || searchMatches(query, r.name, r.className)) && (!sides.length || sides.includes(r.team)) && (!states.length || states.includes(state(r))))
    .sort((a, b) => sort.dir * compareValues(value(a, sort.key), value(b, sort.key)) || Number(b.army) - Number(a.army) || a.name.localeCompare(b.name));
  // Only the choices this battle has.
  const sideOptions = SIDE_OPTIONS.filter(([t]) => all.some((r) => r.team === t));
  const stateOptions = STATE_OPTIONS.filter(([s]) => s !== "left" || all.some((r) => state(r) === "left"));
  const shown = all.some((r) => r.id === selected) ? selected : (rows[0]?.id ?? all[0].id);
  const clear = () => {
    setSides([]);
    setStates([]);
  };

  return (
    <div className="list-page units-view">
      <MasterDetail wide detail={<UnitDetail battle={battle} items={items} id={shown} roster={roster} part2={part2} />}>
        <div className="toolbar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search units" />
          <FilterMenu
            count={sides.length + states.length}
            onClear={clear}
            chips={
              <>
                <CheckChips options={sideOptions} value={sides} onChange={setSides} />
                <CheckChips options={stateOptions} value={states} onChange={setStates} />
              </>
            }
          >
            <CheckList<Team> label="Side" options={sideOptions} value={sides} onChange={setSides} />
            <CheckList<State> label="Status" options={stateOptions} value={states} onChange={setStates} />
          </FilterMenu>
        </div>
        <div className="table-wrap">
          <table className="units battle-table">
            <thead>
              <tr>
                {header("name", "Unit", { className: "left" })}
                {header("level", "Lv")}
                {header("hp", "HP", { title: "Current HP (sort by share of max HP)" })}
                {header("status", "Status", { className: "left" })}
                {header("fights", "Fights")}
                {header("dealt", "Dealt", { title: "Damage Dealt" })}
                {header("taken", "Taken", { title: "Damage Taken" })}
                {header("healing", "Healing", { title: "HP restored to other units" })}
                {header("defeats", "Kills", { title: "Units killed" })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`${shown === r.id ? "selected" : ""} ${r.onMap ? "" : "off-map"}`}
                  onClick={() => onSelect(r.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(r.id))}
                  tabIndex={0}
                  aria-selected={shown === r.id}
                >
                  <td className="left name-cell">
                    <span className="who">
                      <UnitFace id={r.id} name={r.name} />
                      <span className="who-text">
                        <span className="who-name">
                          {r.name}
                          <HouseMark id={r.id} />
                          <WeaponIcon kind={battleWeapon(r.unit ?? r.enemy)} />
                        </span>
                        <span className="who-class">{r.className}</span>
                      </span>
                    </span>
                  </td>
                  <td className="num">
                    {r.level}
                    {r.levelUps > 0 && <span className="mark bonus">+{r.levelUps}</span>}
                  </td>
                  <td className="num">
                    <HpCell hp={r.hp} max={r.max} />
                  </td>
                  <td className="left">
                    <span className="status-cell">
                      <Flags flags={r.flags} />
                    </span>
                  </td>
                  <td className="num"><Num value={r.fights} why={r.uncounted} /></td>
                  <td className="num">
                    <Num value={r.dealt} why={r.uncounted} />
                  </td>
                  <td className="num">
                    <Num value={r.taken} why={r.uncounted} />
                  </td>
                  <td className="num">{r.army ? <Num value={r.healing} why={r.uncounted} /> : <span className="untracked">·</span>}</td>
                  <td className="num">
                    <Num value={r.defeats} why={r.uncounted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <NoMatches
              what="units"
              onReset={() => {
                setQuery("");
                clear();
              }}
            />
          )}
        </div>
      </MasterDetail>
    </div>
  );
}

const nameOf = (battle: Battle, key: string) => battle.units.find((u) => u.key === key)?.name ?? key;

export function HpCell({ hp, max }: { hp: number | null; max: number }) {
  return <HpBar hp={hp} max={max} />;
}
