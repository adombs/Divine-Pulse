/**
 * The History page's body: the run in numbers, its battles (passed in), standout records, and each character over
 * every battle they were in.
 */
import { ReactNode, useMemo } from "react";
import type { Battle, Unit } from "../../api";
import { compareValues, useSort } from "../common";
import { MasterDetail, Section } from "../layout";
import { characterKeyOfUnit } from "../../portraits";
import { useNav } from "../../nav";
import { Portrait } from "../ui";
import { useAffiliationIcon } from "../AffiliationIcon";
import { CharacterPopup } from "../CharacterPopup";
import { CharLink } from "../Links";
import { clock, plural } from "../../format";
import "./history.css";
import { BattleKindChip } from "./BattleList";
import { Carousel } from "./Carousel";
import { battleName } from "./scenarios";
import { Num } from "./parts";
import { RunCharacterCard } from "./RunCharacterCard";
import { PortraitFlip, unitSprite } from "../character/CharacterFace";
import { CharacterStats, characterStats, leader, RunStats, runStats, timelines } from "./stats";

type Col = "name" | "battles" | "fights" | "defeats" | "dealt" | "taken" | "healing" | "level_ups" | "left";

interface Props {
  history: Battle[] | null;
  roster: Unit[];
  part2: boolean;
  /** The character open in the popup (unit key; in the URL, so Back returns to it). */
  selected: string | null;
  onSelect: (key: string, replace?: boolean) => void;
  /** Open a battle from the history, at a unit when `key` is given. */
  onOpen: (id: string, key?: string) => void;
  /** The battle cards (their own Section), shown under the run's numbers. */
  battlesSection: ReactNode;
}

export function StatsTab({ history, roster, part2, selected, onSelect, onOpen, battlesSection }: Props) {
  const battles = useMemo(() => history ?? [], [history]);
  const items = useMemo(() => timelines(battles), [battles]);
  const characters = useMemo(() => characterStats(battles, items), [battles, items]);
  const run = useMemo(() => runStats(battles, characters, items), [battles, characters, items]);
  const { sort, header } = useSort<Col>({ key: "battles", dir: -1 }, ["name"]);
  const nav = useNav();
  // (Before the early returns: hooks run on every render.)
  const shownUnit = roster.find((u) => u.key === selected && characters.some((c) => c.key === u.key));
  const popupIcon = useAffiliationIcon(shownUnit ? characterKeyOfUnit(shownUnit) : null);

  if (history === null) return <p className="muted">Loading…</p>;
  if (!battles.length) return <div className="stats-tab">{battlesSection}</div>;

  const value = (c: CharacterStats, key: Col): number | string => {
    switch (key) {
      case "name": return c.name;
      case "battles": return c.battles;
      case "fights": return c.fights;
      case "defeats": return c.defeats ?? -1;
      case "dealt": return c.damage_dealt ?? -1;
      case "taken": return c.damage_taken ?? -1;
      case "healing": return c.healing_given ?? -1;
      case "level_ups": return c.level_ups;
      case "left": return c.left;
    }
  };
  const rows = [...characters].sort((a, b) => sort.dir * compareValues(value(a, sort.key), value(b, sort.key)) || a.name.localeCompare(b.name));
  const current = characters.find((c) => c.key === selected);
  const missing = selected && !current ? (roster.find((u) => u.key === selected)?.name ?? null) : null;
  const pick = (key: string) => onSelect(key);
  const portraitOf = new Map(roster.map((u) => [u.key, u]));

  const list = (
    <>
      <div className="table-wrap">
        <table className="units battle-table">
          <thead>
            <tr>
              {header("name", "Unit", { className: "left" })}
              {header("battles", "Battles")}
              {header("fights", "Fights")}
              {header("defeats", "Kills", { title: "Other units killed" })}
              {header("dealt", "Dealt", { title: "Damage Dealt" })}
              {header("taken", "Taken", { title: "Damage Taken" })}
              {header("healing", "Healing", { title: "HP restored to other units" })}
              {header("level_ups", "Lv-ups", { title: "Level-ups in battle" })}
              {header("left", "Fell", { title: "Battles they ended off the map (fell or retreated)" })}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const unit = portraitOf.get(c.key);
              return (
                <tr
                  key={c.key}
                  className={current?.key === c.key ? "selected" : ""}
                  onClick={() => pick(c.key)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(c.key))}
                  tabIndex={0}
                  aria-selected={current?.key === c.key}
                >
                  <td className="left name-cell">
                    <span className="who">
                      {unit ? <Portrait unit={unit} part2={part2} size={34} /> : null}
                      <span className="who-text">
                        <span className="who-name">{c.name}</span>
                        <span className="who-class">
                          {c.class_name} · Lv {c.level}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{c.battles}</td>
                  <td className="num">{c.fights}</td>
                  <td className="num">
                    <Num value={c.defeats} />
                  </td>
                  <td className="num">
                    <Num value={c.damage_dealt} />
                  </td>
                  <td className="num">
                    <Num value={c.damage_taken} />
                  </td>
                  <td className="num">
                    <Num value={c.healing_given} />
                  </td>
                  <td className="num">{c.level_ups}</td>
                  <td className="num">{c.left}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div className="stats-tab">
      {missing && <p className="notice">{missing} hasn't been in a finished battle this run yet.</p>}
      <RunSummary run={run} battles={battles} onOpen={onOpen} />
      {battlesSection}
      <Records run={run} characters={characters} onOpen={onOpen} roster={portraitOf}
        part2={part2}
        onCharacter={onSelect}
      />
      {/* Fills the rest of the screen; the table and the card scroll in their own columns. */}
      <div className="stats-chars">
        <Section title="Characters">
          <MasterDetail detail={null} wide>
            {list}
          </MasterDetail>
        </Section>
      </div>
      <CharacterPopup open={!!current} onClose={() => nav.go({ page: "history", tab: "stats" }, { replace: true })} context="stats" title={current ? <CharLink charKey={shownUnit ? characterKeyOfUnit(shownUnit) : null} title="Base stats, growths and skills">{shownUnit?.full_name || current.name}</CharLink> : ""} icon={popupIcon}>
        {current && (() => {
          const unit = portraitOf.get(current.key);
          return (
            <RunCharacterCard
              stats={current}
              face={<PortraitFlip portrait={unit ? <Portrait unit={unit} part2={part2} size={88} /> : <span className="award-initial">{current.name[0]}</span>} sprite={unit ? unitSprite(unit) : null} name={current.name} className={unit?.class_name} size={88} />}
              className={unit?.class_name}
              icon={popupIcon}
              onOpen={onOpen}
              onRoster={unit ? () => nav.go({ page: "roster", id: unit.key }) : undefined}
            />
          );
        })()}
      </CharacterPopup>
    </div>
  );
}

const avg = (total: number, n: number) => (n ? Math.round((10 * total) / n) / 10 : 0);

/** The run in numbers: the record up front, then every figure in a strip. */
function RunSummary({ run, battles, onOpen }: { run: RunStats; battles: Battle[]; onOpen: (id: string) => void }) {
  const oldestFirst = [...battles].sort((x, y) => x.started_at.localeCompare(y.started_at)).slice(-PIPS);
  const figures: FigureProps[] = [
    { label: "Time in Battle", value: clock(run.seconds), note: `${clock(run.seconds / run.battles)} each` },
    { label: "Turns", value: run.turns ?? "—", note: run.turns !== null ? `${avg(run.turns, run.turn_battles)} per battle` : undefined },
    { label: "Units Lost", value: run.losses, note: plural(run.flawless, "flawless battle"), bad: run.losses > 0 },
    { label: "Level-ups", value: run.level_ups, note: `+${run.stat_points} stat points` },
    { label: "Divine Pulse", value: run.divine_pulses, note: `${plural(run.no_pulse, "battle")} without` },
    { label: "Fights", value: run.fights },
    ...(run.defeats !== null ? [{ label: "Kills", value: run.defeats }] : []),
    { label: "Damage", value: <Num value={run.damage_dealt} />, note: run.damage_taken !== null ? `dealt · ${run.damage_taken} taken` : "dealt" },
    { label: "Healing", value: <Num value={run.healing} />, note: "HP restored" },
    { label: "Supplies", value: run.weapon_uses + run.spells_cast + run.item_uses, note: `${run.weapon_uses} attacks · ${run.spells_cast} spells · ${run.item_uses} items` },
    { label: "Enemies Faced", value: run.enemies, note: `${avg(run.enemies, run.battles)} per battle` },
    { label: "Deployed", value: avg(run.deployed, 1), note: `units per battle · ${plural(run.characters, "character")} in all` },
  ];
  return (
    <section className="run-hero" aria-label="This Run">
      <div className="rh-record">
        <>
          <span className="rh-label">Battles</span>
          <span className="rh-score">{run.battles}</span>
          <span className="rh-note">recorded in this run</span>
        </>
        <span className="rh-pips">
          {oldestFirst.map((b) => {
            const title = battleName(b).title;
            return (
              <button
                key={b.id}
                type="button"
                className={`rh-pip ${battleName(b).kind ?? "unknown"}`}
                title={title}
                aria-label={`Open ${title}`}
                onClick={() => onOpen(b.id)}
              />
            );
          })}
        </span>
      </div>
      <div className="rh-figures">
        <Carousel label="figures" rows={figures.map((f) => <li key={f.label}><Figure {...f} /></li>)} />
      </div>
    </section>
  );
}

/** Recent battle types shown as pips. */
const PIPS = 40;

type FigureProps = { label: string; value: ReactNode; note?: string; bad?: boolean };

function Figure({ label, value, note, bad }: FigureProps) {
  return (
    <div className={`rh-figure ${bad ? "bad" : ""}`} tabIndex={0}>
      <span className="rh-label">{label}</span>
      <span className="rh-value">{value}</span>
      {note && <span className="rh-note">{note}</span>}
    </div>
  );
}

/** Who and which battle stood out. */
function Records({
  run,
  characters,
  roster,
  part2,
  onOpen,
  onCharacter,
}: {
  run: RunStats;
  characters: CharacterStats[];
  roster: Map<string, Unit>;
  part2: boolean;
  onOpen: (id: string) => void;
  onCharacter: (key: string) => void;
}) {
  const people: [string, (c: CharacterStats) => number | null, (n: number) => string][] = [
    ["Most battles", (c) => c.battles, (n) => plural(n, "battle")],
    ["Most kills", (c) => c.defeats, (n) => plural(n, "kill")],
    ["Most damage dealt", (c) => c.damage_dealt, (n) => `${n} damage`],
    ["Most healing", (c) => c.healing_given, (n) => `${n} HP restored`],
    ["Most level-ups", (c) => c.level_ups, (n) => plural(n, "level-up")],
    ["Top in most battles", (c) => c.mvp, (n) => `most kills in ${plural(n, "battle")}`],
    ["Fell most often", (c) => c.left, (n) => plural(n, "time")],
  ];
  const battles: [string, Battle | null, (b: Battle) => string][] = [
    ["Longest battle", run.longest, (b) => clock(b.seconds)],
    ["Quickest battle", run.battles > 1 ? run.shortest : null, (b) => clock(b.seconds)],
    ["Most turns", run.most_turns, (b) => plural(b.turn ?? 0, "turn")],
    ["Most Divine Pulses", run.most_pulses, (b) => plural(b.divine_pulses, "Divine Pulse")],
  ];
  const rows = [
    ...people.map(([label, pick, say]) => {
      const c = leader(characters, pick);
      const unit = c && roster.get(c.key);
      return c && (
        <li key={label}>
          <button type="button" className="award" onClick={() => onCharacter(c.key)} title={`${label}: ${c.name}, ${say(pick(c) ?? 0)}`}>
            <span className="award-lead">{unit ? <Portrait unit={unit} part2={part2} size={32} /> : <span className="award-initial">{c.name[0]}</span>}</span>
            <span className="award-text">
              <span className="award-label">{label}</span>
              <span className="award-name">{c.name}</span>
              <span className="award-value">{say(pick(c) ?? 0)}</span>
            </span>
          </button>
        </li>
      );
    }),
    ...battles.map(
      ([label, b, say]) =>
        b && (
          <li key={label}>
            <button type="button" className="award battle" onClick={() => onOpen(b.id)} title={`${label}: ${battleName(b).title}, ${say(b)}`}>
              <span className="award-lead">
                <BattleKindChip battle={b} />
              </span>
              <span className="award-text">
                <span className="award-label">{label}</span>
                <span className="award-name">{battleName(b).title}</span>
                <span className="award-value">{say(b)}</span>
              </span>
            </button>
          </li>
        ),
    ),
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <Section title="Records">
      <Carousel label="records" rows={rows} />
    </Section>
  );
}
