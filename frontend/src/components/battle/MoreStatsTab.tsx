/** More stats for this battle. A turn picked on a chart opens that turn's fights in a window. Charts without data
 * aren't drawn. */
import { CONCEPT_ICON } from "../../icons/concepts";
import { ReactNode, useRef, useState } from "react";
import type { Battle, BattleUnit } from "../../api";
import { Modal } from "../Modal";
import { Section, Tile, Tiles } from "../layout";
import { Icon, IconName } from "../Icon";
import { clock, plural } from "../../format";
import { armyId, armyTotals, Item, statGains } from "./model";
import { MoreStats, moreStats } from "./moreStats";
import { ItemList, TrendChart, WhoLink } from "./parts";
import { Empty, MirrorBars, Series, TurnColumns, TurnLines, UnitBars } from "./charts";
import { Carousel } from "./Carousel";
import "./morestats.css";

type Part = "totals" | "graphs";
type Group = "combat" | "support" | "flow" | "growth";
const GROUPS: Record<Group, string> = { combat: "Combat", support: "Support", flow: "Board", growth: "Growth & Supplies" };

const DEALT: Series = { label: "Dealt", color: "var(--dealt)" };
const TAKEN: Series = { label: "Taken", color: "var(--taken)" };
const HEAL: Series = { label: "Restored", color: "var(--heal)" };
const HEALED: Series = { label: "Received", color: "var(--healed)" };
const WALK: Series = { label: "Tiles", color: "var(--walk)" };
const FIGHTS: Series = { label: "Fights", color: "var(--accent)" };
const YOURS: Series = { label: "Yours", color: "var(--dealt)" };
const THEIRS: Series = { label: "Theirs", color: "var(--taken)" };

interface View {
  battle: Battle;
  seconds: number;
  stats: MoreStats;
  history: Battle[];
  /** Open a turn's fights. */
  pick: (turn: number) => void;
}

export function MoreStatsTab({ battle, items, seconds, history }: { battle: Battle; items: Item[]; seconds: number; history: Battle[] }) {
  const stats = moreStats(battle, items);
  const others = history.filter((b) => b.id !== battle.id && !b.active);
  const [part, setPart] = useState<Part>("totals");
  const [group, setGroup] = useState<Group>("combat");
  const [turn, setTurn] = useState<number | null>(null);
  // Kept while the window sinks away.
  const shown = useRef(1);
  if (turn !== null) shown.current = turn;
  const view: View = { battle, seconds, stats, history: others, pick: setTurn };
  return (
    <div className="more-stats">
      <div className="sub-tabs small ms-tabs" role="tablist" aria-label="More stats">
        <button type="button" role="tab" aria-selected={part === "totals"} className={part === "totals" ? "on" : ""} onClick={() => setPart("totals")}>Records</button>
        <button type="button" role="tab" aria-selected={part === "graphs"} className={part === "graphs" ? "on" : ""} onClick={() => setPart("graphs")}>Graphs</button>
      </div>
      {part === "graphs" && <div className="sub-tabs small ms-group-tabs" role="tablist" aria-label="Graph groups">
        {(Object.entries(GROUPS) as [Group, string][]).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={group === id} className={group === id ? "on" : ""} onClick={() => setGroup(id)}>{label}</button>)}
      </div>}
      <div key={part} className="ms-part view-enter">
        {part === "totals" && <TotalsPart {...view} />}
        {part === "graphs" && <GraphsPart view={view} group={group} />}
      </div>
      <Modal open={turn !== null} onClose={() => setTurn(null)} title={`Turn ${shown.current}`}>
        <ItemList items={items.filter((i) => i.turn === shown.current)} empty="Nothing happened this turn." />
      </Modal>
    </div>
  );
}

/** A titled box: what's in it fills the box and scrolls there when taller. A box with nothing to show isn't drawn. */
function Box({ title, right, ok = true, children }: { title: string; right?: ReactNode; ok?: boolean; children: ReactNode }) {
  if (!ok) return null;
  return (
    <Section title={title} right={right}>
      <div className="ms-fill">{children}</div>
    </Section>
  );
}

const turnTitle = (turn: number, text: string) => `Turn ${turn}: ${text} (click for its fights)`;

// Parts

function TotalsPart({ battle, seconds, stats, history }: View) {
  return (
    <>
      <Totals battle={battle} seconds={seconds} fights={stats.fights} />
      <div className="ms-grid auto totals">
        <Records battle={battle} stats={stats} />
        <Compared battle={battle} seconds={seconds} history={history} />
      </div>
    </>
  );
}

/** Everything per unit: damage, healing, defeats, fights, gear used, tiles moved and the lowest HP each reached. */
function UnitsPart({ battle, stats, group }: View & { group: Group }) {
  const growth = battle.units
    .map((u) => ({ id: armyId(u.key), gain: statGains(u), levels: u.level_ups }))
    .filter((r) => r.gain > 0 || r.levels > 0)
    .sort((a, b) => b.gain - a.gain)
    .map((r) => ({ id: r.id, values: [r.gain], note: `+${r.gain}${r.levels ? ` · ${plural(r.levels, "level")}` : ""}` }));
  const dealt = stats.units.filter((u) => u.dealt || u.taken).sort((a, b) => b.dealt - a.dealt || b.taken - a.taken);
  const heal = stats.units.filter((u) => u.healing || u.healed).sort((a, b) => b.healing - a.healing || b.healed - a.healed);
  const defeats = stats.units.filter((u) => u.defeats > 0).sort((a, b) => b.defeats - a.defeats);
  const low = stats.units.filter((u) => u.low !== null).sort((a, b) => a.low! / a.max - b.low! / b.max);
  const walked = stats.units.filter((u) => u.tiles > 0).sort((a, b) => b.tiles - a.tiles);
  const used = stats.units
    .filter((u) => u.weapons || u.spells || u.items)
    .sort((a, b) => b.weapons + b.spells + b.items - (a.weapons + a.spells + a.items))
    .map((u) => ({ id: u.id, values: [u.weapons, u.spells, u.items] }));
  const fights = stats.units.filter((u) => u.fights > 0).sort((a, b) => b.fights - a.fights);
  const received = stats.units.filter((u) => u.healed > 0).sort((a, b) => b.healed - a.healed);
  const efficiency = stats.units.filter((u) => u.fights > 0).sort((a, b) => b.dealt / b.fights - a.dealt / a.fights);
  const broken = battle.units.reduce((n, u) => n + u.broken_weapons, 0);
  const groups: [Group, ReactNode][] = [
    [
      "combat",
      <>
        <Box title="Damage by Unit" ok={dealt.length > 0}>
          <MirrorBars rows={dealt.map((u) => ({ id: u.id, left: u.taken, right: u.dealt }))} left={TAKEN} right={DEALT} />
        </Box>
        <Box title="Kills" ok={defeats.length > 0}>
          <UnitBars rows={defeats.map((u) => ({ id: u.id, values: [u.defeats] }))} series={[{ label: "Killed", color: "var(--taken)" }]} />
        </Box>
        <Box title="Fights by Unit" ok={fights.length > 0}>
          <UnitBars rows={fights.map((u) => ({ id: u.id, values: [u.fights] }))} series={[FIGHTS]} />
        </Box>
        <Box title="Damage per Fight" ok={efficiency.length > 0}>
          <UnitBars rows={efficiency.map((u) => ({ id: u.id, values: [u.dealt / u.fights], note: `${(u.dealt / u.fights).toFixed(1)}` }))} series={[DEALT]} />
        </Box>
      </>,
    ],
    [
      "support",
      <>
        <Box title="Healing by Unit" ok={heal.length > 0}>
          <MirrorBars rows={heal.map((u) => ({ id: u.id, left: u.healed, right: u.healing }))} left={HEALED} right={HEAL} />
        </Box>
        <Box title="Healing Received" ok={received.length > 0}>
          <UnitBars rows={received.map((u) => ({ id: u.id, values: [u.healed] }))} series={[HEALED]} />
        </Box>
        <Box title="Lowest HP Reached" ok={low.length > 0}>
          <UnitBars rows={low.map((u) => ({ id: u.id, values: [u.low!], of: u.max, note: `${u.low} / ${u.max}` }))} series={[{ label: "HP", color: "var(--heal)" }]} />
        </Box>
      </>,
    ],
    [
      "flow",
      <Box title="Tiles Moved" ok={walked.length > 0}>
        <UnitBars rows={walked.map((u) => ({ id: u.id, values: [u.tiles] }))} series={[WALK]} />
      </Box>,
    ],
    [
      "growth",
      <>
        <Box title="Growth by Unit" ok={growth.length > 0}>
          <UnitBars rows={growth} series={[{ label: "Stat points", color: "var(--accent)" }]} />
        </Box>
        <Box title="Weapons, Spells & Items" ok={used.length > 0} right={broken > 0 ? <span className="muted">{plural(broken, "weapon")} broken</span> : undefined}>
          <UnitBars
            rows={used}
            series={[
              { label: "Weapon attacks", color: "var(--dealt)" },
              { label: "Spells", color: "var(--walk)" },
              { label: "Items", color: "var(--heal)" },
            ]}
          />
        </Box>
      </>,
    ],
  ];
  return <Grouped group={group} groups={groups} />;
}

/** How the battle went turn by turn: the outlook, damage, healing, fights and who was left standing. */
function TurnsPart({ battle, seconds, stats, pick, group }: View & { group: Group }) {
  const turns = stats.perTurn;
  const activity = stats.activity;
  const board = stats.board;
  const groups: [Group, ReactNode][] = [
    [
      "combat",
      <>
        <Box title="Damage per Turn" ok={turns.length > 1 && turns.some((t) => t.dealt || t.taken)}>
          <TurnColumns
            series={[DEALT, TAKEN]}
            onPick={pick}
            rows={turns.map((t) => ({
              turn: t.turn,
              values: [t.dealt, t.taken],
              title: turnTitle(t.turn, `${t.dealt} dealt, ${t.taken} taken${t.defeats ? `, ${plural(t.defeats, "kill")}` : ""}`),
            }))}
          />
        </Box>
        <Box title="Fights per Turn" ok={activity.some((t) => t.fights > 0)}>
          <TurnColumns series={[FIGHTS]} onPick={pick} rows={activity.map((t) => ({ turn: t.turn, values: [t.fights], title: turnTitle(t.turn, plural(t.fights, "fight")) }))} />
        </Box>
      </>,
    ],
    [
      "support",
      <Box title="Healing per Turn" ok={activity.some((t) => t.healed > 0)}>
        <TurnColumns series={[HEAL]} onPick={pick} rows={activity.map((t) => ({ turn: t.turn, values: [t.healed], title: turnTitle(t.turn, `${t.healed} HP restored`) }))} />
      </Box>,
    ],
    [
      "flow",
      <>
        <Box title="Outlook" ok={battle.trend.length > 1}>
          <TrendChart trend={battle.trend} seconds={seconds} events={battle.events} />
        </Box>
        <Box title="Units Standing" ok={board.length > 1}>
          <TurnLines series={[YOURS, THEIRS]} onPick={pick} rows={board.map((b) => ({ turn: b.turn, values: [b.army, b.foes], title: turnTitle(b.turn, `${b.army} of yours, ${b.foes} of theirs standing`) }))} />
        </Box>
        <Box title="HP Left" ok={board.length > 1}>
          <TurnLines series={[YOURS, THEIRS]} onPick={pick} rows={board.map((b) => ({ turn: b.turn, values: [b.armyHp, b.foeHp], title: turnTitle(b.turn, `${b.armyHp} HP yours, ${b.foeHp} HP theirs`) }))} />
        </Box>
      </>,
    ],
  ];
  return <Grouped group={group} groups={groups} />;
}

function Grouped({ group, groups }: { group: Group; groups: [Group, ReactNode][] }) {
  return <>{groups.find(([g]) => g === group)?.[1]}</>;
}

function GraphsPart({ view, group }: { view: View; group: Group }) {
  return <div className="ms-grid auto charts view-enter">
    <UnitsPart {...view} group={group} />
    <TurnsPart {...view} group={group} />
  </div>;
}

// Totals

function Totals({ battle, seconds, fights }: { battle: Battle; seconds: number; fights: number }) {
  const t = armyTotals(battle);
  const broken = battle.units.reduce((n, u) => n + u.broken_weapons, 0);
  return (
    <Tiles>
      {fights > 0 && <Tile label="Fights" value={fights} />}
      <Tile label="Damage Dealt" value={t.dealt ?? "—"} note={t.defeats !== null ? `${t.defeats} killed` : undefined} />
      <Tile label="Damage Taken" value={t.taken ?? "—"} />
      <Tile label="Healing" value={t.healing ?? "—"} note="HP restored" />
      <Tile label="Level-ups" value={battle.level_ups} note={`+${battle.stat_points} stat points`} />
      <Tile label="Weapon Attacks" value={battle.weapon_uses} note={broken ? plural(broken, "weapon") + " broken" : "durability spent"} />
      <Tile label="Spells Cast" value={battle.spells_cast} />
      <Tile label="Items Used" value={battle.item_uses} />
      {battle.spell_uses_full ? (
        <Tile label="Magic Left" value={`${Math.round((100 * (battle.spell_uses_left ?? 0)) / battle.spell_uses_full)}%`} note={`${battle.spell_uses_left} of ${battle.spell_uses_full} uses`} />
      ) : null}
      <Tile label="Moved" value={t.tiles ?? "—"} note="tiles" />
      {battle.turn ? <Tile label="Per Turn" value={clock(seconds / battle.turn)} note="real time" /> : null}
    </Tiles>
  );
}

// Records

function Record({ icon, title, value, unit, children }: { icon: IconName; title: string; value: ReactNode; unit?: string; children: ReactNode }) {
  return (
    <div className="record">
      <span className="record-title">
        <Icon name={icon} />
        {title}
      </span>
      <span className="record-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="record-who">{children}</span>
    </div>
  );
}

const onTurn = (turn: number | null | undefined) => (turn ? <span className="muted"> · turn {turn}</span> : null);

/** Who stood out and the battle's records, each a card; names open the unit's card. */
function Records({ battle, stats: s }: { battle: Battle; stats: MoreStats }) {
  const top = (pick: (u: BattleUnit) => number) => {
    const best = [...battle.units].sort((a, b) => pick(b) - pick(a))[0];
    return best && pick(best) > 0 ? best : null;
  };
  const mvp = top((u) => (u.defeats ?? 0) * 1000 + (u.damage_dealt ?? 0) / 1000);
  const sponge = top((u) => u.damage_taken ?? 0);
  const medic = top((u) => u.healing_given ?? 0);
  const walker = top((u) => u.tiles_moved ?? 0);
  const grew = top((u) => u.level_ups * 100 + statGains(u));
  const who = (u: BattleUnit) => <WhoLink id={armyId(u.key)} />;
  const caster = top((u) => u.spells_cast ?? 0);
  const fighter = top((u) => u.weapon_uses ?? 0);
  // The combat art or spell used most, by one unit.
  let signature: { unit: BattleUnit; name: string; times: number } | null = null;
  for (const u of battle.units)
    for (const m of u.usage ?? [])
      if ((m.kind === "art" || m.kind === "spell") && m.times > (signature?.times ?? 0)) signature = { unit: u, name: m.name, times: m.times };

  const cards: ReactNode[] = [
    mvp && (mvp.defeats ?? 0) > 0 && (
      <Record key="mvp" icon={CONCEPT_ICON.defeat} title="MVP" value={mvp.defeats} unit="killed">
        {who(mvp)}
      </Record>
    ),
    s.carry && s.carry.value >= 0.3 && (
      <Record key="carry" icon={CONCEPT_ICON.carry} title="Carried the Team" value={Math.round(s.carry.value * 100)} unit="% of damage">
        <WhoLink id={s.carry.id} />
      </Record>
    ),
    s.biggestHit && (
      <Record key="hit" icon={CONCEPT_ICON.attack} title="Heaviest Blow" value={s.biggestHit.amount} unit="damage">
        <WhoLink id={s.biggestHit.by} /> on <WhoLink id={s.biggestHit.on} />
        {onTurn(s.biggestHit.turn)}
      </Record>
    ),
    s.rampage && (
      <Record key="rampage" icon={CONCEPT_ICON.enemies} title="Rampage" value={s.rampage.value} unit="killed in one turn">
        <WhoLink id={s.rampage.id} />
        {onTurn(s.rampage.turn)}
      </Record>
    ),
    s.oneRound && (
      <Record key="one" icon={CONCEPT_ICON.end} title="One and Done" value={s.oneRound.value} unit="from full HP in one fight">
        <WhoLink id={s.oneRound.id} />
      </Record>
    ),
    s.closestCall && (
      <Record key="close" icon={CONCEPT_ICON.lowHp} title="Closest Call" value={s.closestCall.value} unit={`of ${s.closestCall.max} HP`}>
        <WhoLink id={s.closestCall.id} />
        {onTurn(s.closestCall.turn)}
      </Record>
    ),
    s.biggestTaken && (
      <Record key="ouch" icon={CONCEPT_ICON.danger} title="Ouch" value={s.biggestTaken.amount} unit="damage taken">
        <WhoLink id={s.biggestTaken.on} /> from <WhoLink id={s.biggestTaken.by} />
        {onTurn(s.biggestTaken.turn)}
      </Record>
    ),
    s.mostWanted && (
      <Record key="wanted" icon={CONCEPT_ICON.target} title="Most Wanted" value={s.mostWanted.value} unit="enemy attacks">
        <WhoLink id={s.mostWanted.id} />
      </Record>
    ),
    s.untouchable && (
      <Record key="untouchable" icon={CONCEPT_ICON.avoid} title="Untouchable" value={s.untouchable.value} unit={`of ${s.untouchable.of} attacks did nothing`}>
        <WhoLink id={s.untouchable.id} />
      </Record>
    ),
    s.counters && (
      <Record key="payback" icon={CONCEPT_ICON.counter} title="Payback" value={s.counters.value} unit="damage hitting back">
        <WhoLink id={s.counters.id} />
      </Record>
    ),
    signature && (
      <Record key="signature" icon={CONCEPT_ICON.art} title="Signature Move" value={signature.times} unit={`× ${signature.name}`}>
        {who(signature.unit)}
      </Record>
    ),
    caster && (
      <Record key="caster" icon={CONCEPT_ICON.spell} title="Spellslinger" value={caster.spells_cast} unit="spells cast">
        {who(caster)}
      </Record>
    ),
    fighter && (
      <Record key="fighter" icon={CONCEPT_ICON.attack} title="Weapon Master" value={fighter.weapon_uses} unit="weapon attacks">
        {who(fighter)}
      </Record>
    ),
    sponge && (
      <Record key="sponge" icon={CONCEPT_ICON.absorb} title="Damage Sponge" value={sponge.damage_taken} unit="damage taken">
        {who(sponge)}
      </Record>
    ),
    medic && (
      <Record key="medic" icon={CONCEPT_ICON.heal} title="Field Medic" value={medic.healing_given} unit="HP restored">
        {who(medic)}
      </Record>
    ),
    walker && (
      <Record key="walker" icon={CONCEPT_ICON.move} title="Marathon" value={walker.tiles_moved} unit="tiles">
        {who(walker)}
      </Record>
    ),
    grew && (
      <Record key="grew" icon={CONCEPT_ICON.levelUp} title="Glow-up" value={`+${statGains(grew)}`} unit={grew.level_ups ? `stats, ${plural(grew.level_ups, "level")}` : "stats"}>
        {who(grew)}
      </Record>
    ),
    s.bench && (
      <Record key="bench" icon={CONCEPT_ICON.wait} title="Bench Warmer" value={0} unit="fights">
        <WhoLink id={s.bench.id} />
        {s.bench.value >= 0 && <span className="muted"> · {plural(s.bench.value, "tile")} moved</span>}
      </Record>
    ),
    s.firstBlood && (
      <Record key="first" icon={CONCEPT_ICON.start} title="First Blood" value={s.firstBlood.turn ? `Turn ${s.firstBlood.turn}` : "—"}>
        <WhoLink id={s.firstBlood.id} /> on <WhoLink id={s.firstBlood.target} />
      </Record>
    ),
    s.lastBlow && (
      <Record key="last" icon={CONCEPT_ICON.finalBlow} title="Final Blow" value={s.lastBlow.turn ? `Turn ${s.lastBlow.turn}` : "—"}>
        <WhoLink id={s.lastBlow.id} /> on <WhoLink id={s.lastBlow.target} />
      </Record>
    ),
    s.pulses && (
      <Record key="pulse" icon={CONCEPT_ICON.pulse} title={s.pulses.falls.length ? "Didn't happen" : "Do-over"} value={s.pulses.uses} unit={s.pulses.uses === 1 ? "Divine Pulse" : "Divine Pulses"}>
        {s.pulses.undone ? `${plural(s.pulses.undone, "action")} undone` : "Turned back time"}
        {s.pulses.falls.length > 0 && <span className="muted"> · saved {[...new Set(s.pulses.falls)].join(", ")}</span>}
      </Record>
    ),
  ].filter(Boolean);
  if (!cards.length) return <Box title="Records" ok={false}>{null}</Box>;
  return (
    <Section title="Records">
      <div className="ms-fill">
        <div className="ms-record-carousel">
          <Carousel rows={Array.from({ length: Math.ceil(cards.length / 3) }, (_, index) => (
            <li key={index} className="ms-record-column">
              <div className="ms-record-stack">{cards.slice(index * 3, index * 3 + 3)}</div>
            </li>
          ))} />
        </div>
      </div>
    </Section>
  );
}

// The run

/** This battle against the run's other finished battles, on average. */
function Compared({ battle, seconds, history }: { battle: Battle; seconds: number; history: Battle[] }) {
  const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const avg = (pick: (b: Battle) => number | null): number | null => {
    const known = history.map(pick).filter((v): v is number => v !== null);
    return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
  };
  const lost = (b: Battle) => b.units.filter((u) => !u.on_map && !u.adjutant_of).length;
  const rows: [string, string | null, number | null, (n: number) => string][] = [
    ["Time", clock(seconds), avg((b) => b.seconds), clock],
    ["Turns", battle.turn !== null ? String(battle.turn) : null, avg((b) => b.turn), one],
    ["Damage Dealt", fmt(armyTotals(battle).dealt), avg((b) => armyTotals(b).dealt), (n) => String(Math.round(n))],
    ["Killed", fmt(armyTotals(battle).defeats), avg((b) => armyTotals(b).defeats), one],
    ["Units Lost", String(lost(battle)), avg(lost), one],
    ["Level-ups", String(battle.level_ups), avg((b) => b.level_ups), one],
    ["Stat points", `+${battle.stat_points}`, avg((b) => b.stat_points), (n) => `+${one(n)}`],
    ["Divine Pulse", String(battle.divine_pulses), avg((b) => b.divine_pulses), one],
  ];
  const shown = rows.filter(([, now, average]) => now !== null && average !== null);
  return (
    <Section title="Against Your Other Battles">
      <div className="ms-fill">
      {!history.length ? <Empty>No other finished battles in this run yet.</Empty> : (
      <table className="mini-table compare-table">
        <thead>
          <tr>
            <th className="left" />
            <th>This battle</th>
            <th>Average of {history.length}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(([label, now, average, f]) => (
            <tr key={label}>
              <td className="left">{label}</td>
              <td>{now}</td>
              <td>{f(average!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </div>
    </Section>
  );
}

const fmt = (n: number | null) => (n === null ? null : String(n));
