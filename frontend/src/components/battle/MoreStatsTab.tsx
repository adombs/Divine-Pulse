/**
 * More stats for this battle, in two parts.
 * - Records: the battle's ledger (its numbers, the headline ones large), the standout moments grouped into themed
 *   columns of a carousel, and this battle against the run's other finished battles. A name in the standouts opens
 *   that character over the whole run (the run's finished battles), not just this battle.
 * - Graphs: one topic at a time (Combat, Support, Board, Growth), time charts across the top and per-unit charts
 *   below. A turn picked on a chart opens that turn's fights in a window. Charts without data aren't drawn.
 * Styles: records.css and graphs.css (scoped to .more-stats).
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { CSSProperties, KeyboardEvent, ReactNode, useMemo, useRef, useState } from "react";
import type { Battle, BattleUnit } from "../../api";
import { useNav } from "../../nav";
import { characterKeyOfName } from "../../portraits";
import { Modal } from "../Modal";
import { CharacterPopup } from "../CharacterPopup";
import { Icon, IconName } from "../Icon";
import { clock, plural } from "../../format";
import { armyId, armyTotals, Item, statGains } from "./model";
import { MoreStats, moreStats } from "./moreStats";
import { BattleNav, BattleNavContext, HouseMark, ItemList, TrendChart, UnitFace, useBattleNav, WhoLink } from "./parts";
import { Empty, MirrorBars, Series, TurnColumns, TurnLines, UnitBars } from "./charts";
import { Carousel } from "./Carousel";
import { characterStats, timelines } from "./stats";
import { RunCharacterCard } from "./RunCharacterCard";
import "./morestats.css";
import "./records.css";
import "./graphs.css";

type Part = "totals" | "graphs";
type Group = "combat" | "support" | "flow" | "growth";
const PARTS: [Part, string][] = [["totals", "Records"], ["graphs", "Graphs"]];
const GROUPS: [Group, string][] = [["combat", "Combat"], ["support", "Support"], ["flow", "Board"], ["growth", "Growth & Supplies"]];

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
  /** The run's other finished battles. */
  history: Battle[];
  /** Open a turn's fights. */
  pick: (turn: number) => void;
}

export function MoreStatsTab({ battle, items, seconds, history }: { battle: Battle; items: Item[]; seconds: number; history: Battle[] }) {
  const stats = useMemo(() => moreStats(battle, items), [battle, items]);
  const others = useMemo(() => history.filter((b) => b.id !== battle.id && !b.active), [history, battle.id]);
  const [part, setPart] = useState<Part>("totals");
  const [group, setGroup] = useState<Group>("combat");
  const [turn, setTurn] = useState<number | null>(null);
  // Kept while the window sinks away.
  const shown = useRef(1);
  if (turn !== null) shown.current = turn;
  const view: View = { battle, seconds, stats, history: others, pick: setTurn };
  return (
    <div className={`more-stats part-${part}`}>
      <div className="ms-toolbar">
        <TabStrip label="More stats" value={part} options={PARTS} onChange={setPart} className="sub-tabs small ms-tabs" panel="ms-part" />
        {part === "graphs" && <TabStrip label="Graph topics" value={group} options={GROUPS} onChange={setGroup} className="segmented ms-topics" panel="ms-part" />}
      </div>
      <div key={part === "graphs" ? `graphs-${group}` : part} id="ms-part" role="tabpanel" aria-label={part === "graphs" ? GROUPS.find(([g]) => g === group)?.[1] : "Records"} className="ms-part view-enter">
        {part === "totals" && <RecordsPart {...view} />}
        {part === "graphs" && <GraphsPart view={view} group={group} />}
      </div>
      <Modal open={turn !== null} onClose={() => setTurn(null)} title={`Turn ${shown.current}`}>
        <ItemList items={items.filter((i) => i.turn === shown.current)} empty="Nothing happened this turn." />
      </Modal>
    </div>
  );
}

/** Tabs on one row: arrow keys, Home and End move between them (only the picked one is in the tab order). */
function TabStrip<T extends string>({ label, value, options, onChange, className, panel }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; className: string; panel: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent, i: number) => {
    const n = options.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to][0]);
    refs.current[to]?.focus();
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {options.map(([id, text], i) => (
        <button key={id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={value === id} aria-controls={panel}
          tabIndex={value === id ? 0 : -1} className={value === id ? "on" : ""} onClick={() => onChange(id)} onKeyDown={(e) => key(e, i)}>
          {text}
        </button>
      ))}
    </div>
  );
}

// Records

const LEFT: [Left, string][] = [["standouts", "Standouts"], ["share", "Share of the Fighting"]];
type Left = "standouts" | "share";

function RecordsPart({ battle, seconds, stats, history }: View) {
  // Short windows show one of the two left panels at a time, picked here; taller ones show both (records.css).
  const [left, setLeft] = useState<Left>("standouts");
  const share = shareRows(stats).length > 0;
  return (
    <div className="ms-records">
      <Ledger battle={battle} seconds={seconds} fights={stats.fights} />
      <div className="ms-records-body">
        <RunCards battle={battle} history={history}>
          <div className="ms-records-main" data-show={share ? left : "standouts"}>
            {share && <TabStrip label="Records panels" value={left} options={LEFT} onChange={setLeft} className="segmented ms-left-tabs" panel={`ms-${left}`} />}
            <Standouts battle={battle} stats={stats} />
            <Share stats={stats} />
          </div>
        </RunCards>
        <Compared battle={battle} seconds={seconds} history={history} />
      </div>
    </div>
  );
}

/** The battle's numbers: the exchange of damage and healing up front, everything else in a quieter grid. */
function Ledger({ battle, seconds, fights }: { battle: Battle; seconds: number; fights: number }) {
  const t = armyTotals(battle);
  const broken = battle.units.reduce((n, u) => n + u.broken_weapons, 0);
  const share = t.dealt !== null && t.taken !== null && t.dealt + t.taken > 0 ? t.dealt / (t.dealt + t.taken) : null;
  const ratio = t.dealt !== null && t.taken ? t.dealt / t.taken : null;
  const magic = battle.spell_uses_full ? (battle.spell_uses_left ?? 0) / battle.spell_uses_full : null;
  const minor: [string, ReactNode, ReactNode?][] = [
    ["Fights", fights || "—"],
    ["Level-ups", battle.level_ups, `+${battle.stat_points} stats`],
    ["Weapon attacks", battle.weapon_uses, broken ? <span className="bad">{plural(broken, "weapon")} broken</span> : undefined],
    ["Spells cast", battle.spells_cast],
    ["Items used", battle.item_uses],
    ["Tiles moved", t.tiles ?? "—"],
    ...(battle.turn ? [["Per turn", clock(seconds / battle.turn), "real time"] as [string, ReactNode, ReactNode]] : []),
    ...(magic !== null ? [["Magic left", `${Math.round(100 * magic)}%`, <span className="ledger-meter" title={`${battle.spell_uses_left} of ${battle.spell_uses_full} spell uses`}><span style={{ width: `${100 * magic}%` }} /></span>] as [string, ReactNode, ReactNode]] : []),
  ];
  return (
    <section className="ms-ledger" aria-label="The battle in numbers">
      <div className="ledger-main">
        <div className="ledger-figure dealt">
          <span className="ledger-label">Damage dealt</span>
          <span className="ledger-value">{t.dealt ?? "—"}</span>
          <span className="ledger-note">{t.defeats !== null ? plural(t.defeats, "kill") : " "}</span>
        </div>
        <div className="ledger-exchange" aria-hidden={share === null}>
          {share !== null && (
            <>
              <span className="exchange-bar" title={`${Math.round(share * 100)}% of the damage was yours`}>
                <span className="exchange-dealt" style={{ ["--share" as string]: share } as CSSProperties} />
              </span>
              <span className="ledger-note">{ratio !== null ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} : 1 exchange` : "untouched"}</span>
            </>
          )}
        </div>
        <div className="ledger-figure taken">
          <span className="ledger-label">Damage taken</span>
          <span className="ledger-value">{t.taken ?? "—"}</span>
          <span className="ledger-note"> </span>
        </div>
        <div className="ledger-figure heal">
          <span className="ledger-label">Healing</span>
          <span className="ledger-value">{t.healing ?? "—"}</span>
          <span className="ledger-note">HP restored</span>
        </div>
      </div>
      <dl className="ledger-minor">
        {minor.map(([label, value, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}{note ? <small>{note}</small> : null}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Names inside open the character over the whole run (the run's finished battles, this one included once it's over)
 * in the character popup; anyone without run stats (enemies, a unit only in a battle still going) opens as usual.
 */
function RunCards({ battle, history, children }: { battle: Battle; history: Battle[]; children: ReactNode }) {
  const parent = useBattleNav();
  const go = useNav().go;
  const [key, setKey] = useState<string | null>(null);
  const battles = useMemo(() => {
    const done = history.filter((b) => !b.active);
    return !battle.active && !done.some((b) => b.id === battle.id) ? [battle, ...done] : done;
  }, [history, battle]);
  const characters = useMemo(() => characterStats(battles, timelines(battles)), [battles]);
  const nav = useMemo<BattleNav>(() => ({
    ...parent,
    open: (id) => {
      const found = id.startsWith("a:") ? characters.find((c) => armyId(c.key) === id) : undefined;
      if (found) setKey(found.key);
      else parent.open(id);
    },
  }), [parent, characters]);
  const current = characters.find((c) => c.key === key);
  // While it closes, the popup keeps showing the character it had.
  const last = useRef(current);
  if (current) last.current = current;
  const c = current ?? last.current;
  const id = c ? armyId(c.key) : "";
  return (
    <BattleNavContext.Provider value={nav}>
      {children}
      <CharacterPopup open={!!current} onClose={() => setKey(null)} context="stats" title={c?.name ?? ""} icon={c ? <HouseMark id={id} /> : undefined}>
        {c && (
          <RunCharacterCard
            stats={c}
            portrait={<UnitFace id={id} name={c.name} size="lg" />}
            charKey={characterKeyOfName(c.name)}
            icon={<HouseMark id={id} />}
            onOpen={(battleId, at) => { setKey(null); go({ page: "battle", id: battleId, q: at }); }}
            onRoster={parent.ebstConfig?.(c.key) ? () => go({ page: "roster", id: c.key }) : undefined}
            onThisBattle={battle.units.some((u) => u.key === c.key) ? () => { setKey(null); parent.open(id); } : undefined}
          />
        )}
      </CharacterPopup>
    </BattleNavContext.Provider>
  );
}

function Record({ icon, title, value, unit, children }: { icon: IconName; title: string; value: ReactNode; unit?: string; children: ReactNode }) {
  return (
    <div className="standout">
      <span className="standout-icon" aria-hidden="true"><Icon name={icon} /></span>
      <span className="standout-text">
        <span className="standout-title">{title}</span>
        <span className="standout-who">{children}</span>
      </span>
      <span className="standout-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

const onTurn = (turn: number | null | undefined) => (turn ? <span className="muted"> · turn {turn}</span> : null);

/** Who stood out and the battle's moments, in four themed columns that scroll as a carousel when they don't fit. */
function Standouts({ battle, stats: s }: { battle: Battle; stats: MoreStats }) {
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

  const columns: [string, IconName, ReactNode[]][] = [
    ["Offense", CONCEPT_ICON.attack, [
      mvp && (mvp.defeats ?? 0) > 0 && <Record key="mvp" icon={CONCEPT_ICON.defeat} title="MVP" value={mvp.defeats} unit="killed">{who(mvp)}</Record>,
      s.carry && s.carry.value >= 0.3 && <Record key="carry" icon={CONCEPT_ICON.carry} title="Carried the Team" value={Math.round(s.carry.value * 100)} unit="% of damage"><WhoLink id={s.carry.id} /></Record>,
      s.biggestHit && <Record key="hit" icon={CONCEPT_ICON.attack} title="Heaviest Blow" value={s.biggestHit.amount} unit="damage"><WhoLink id={s.biggestHit.by} /> on <WhoLink id={s.biggestHit.on} />{onTurn(s.biggestHit.turn)}</Record>,
      s.rampage && <Record key="rampage" icon={CONCEPT_ICON.enemies} title="Rampage" value={s.rampage.value} unit="in one turn"><WhoLink id={s.rampage.id} />{onTurn(s.rampage.turn)}</Record>,
      s.oneRound && <Record key="one" icon={CONCEPT_ICON.end} title="One and Done" value={s.oneRound.value} unit="from full HP"><WhoLink id={s.oneRound.id} /></Record>,
      fighter && <Record key="fighter" icon={CONCEPT_ICON.attack} title="Weapon Master" value={fighter.weapon_uses} unit="attacks">{who(fighter)}</Record>,
      caster && <Record key="caster" icon={CONCEPT_ICON.spell} title="Spellslinger" value={caster.spells_cast} unit="spells">{who(caster)}</Record>,
      signature && <Record key="signature" icon={CONCEPT_ICON.art} title="Signature Move" value={signature.times} unit={`× ${signature.name}`}>{who(signature.unit)}</Record>,
    ]],
    ["Defense", CONCEPT_ICON.absorb, [
      s.closestCall && <Record key="close" icon={CONCEPT_ICON.lowHp} title="Closest Call" value={s.closestCall.value} unit={`of ${s.closestCall.max} HP`}><WhoLink id={s.closestCall.id} />{onTurn(s.closestCall.turn)}</Record>,
      s.biggestTaken && <Record key="ouch" icon={CONCEPT_ICON.danger} title="Ouch" value={s.biggestTaken.amount} unit="damage"><WhoLink id={s.biggestTaken.on} /> from <WhoLink id={s.biggestTaken.by} />{onTurn(s.biggestTaken.turn)}</Record>,
      s.mostWanted && <Record key="wanted" icon={CONCEPT_ICON.target} title="Most Wanted" value={s.mostWanted.value} unit="attacks on them"><WhoLink id={s.mostWanted.id} /></Record>,
      s.untouchable && <Record key="untouchable" icon={CONCEPT_ICON.avoid} title="Untouchable" value={s.untouchable.value} unit={`of ${s.untouchable.of} missed`}><WhoLink id={s.untouchable.id} /></Record>,
      s.counters && <Record key="payback" icon={CONCEPT_ICON.counter} title="Payback" value={s.counters.value} unit="countering"><WhoLink id={s.counters.id} /></Record>,
      sponge && <Record key="sponge" icon={CONCEPT_ICON.absorb} title="Damage Sponge" value={sponge.damage_taken} unit="taken">{who(sponge)}</Record>,
    ]],
    ["Support & Movement", CONCEPT_ICON.heal, [
      medic && <Record key="medic" icon={CONCEPT_ICON.heal} title="Field Medic" value={medic.healing_given} unit="HP restored">{who(medic)}</Record>,
      grew && <Record key="grew" icon={CONCEPT_ICON.levelUp} title="Glow-up" value={`+${statGains(grew)}`} unit={grew.level_ups ? `stats · ${plural(grew.level_ups, "level")}` : "stats"}>{who(grew)}</Record>,
      walker && <Record key="walker" icon={CONCEPT_ICON.move} title="Marathon" value={walker.tiles_moved} unit="tiles">{who(walker)}</Record>,
      s.bench && <Record key="bench" icon={CONCEPT_ICON.wait} title="Bench Warmer" value={0} unit="fights"><WhoLink id={s.bench.id} />{s.bench.value >= 0 && <span className="muted"> · {plural(s.bench.value, "tile")}</span>}</Record>,
    ]],
    ["Turning Points", CONCEPT_ICON.turn, [
      s.firstBlood && <Record key="first" icon={CONCEPT_ICON.start} title="First Blood" value={s.firstBlood.turn ? `T${s.firstBlood.turn}` : "—"}><WhoLink id={s.firstBlood.id} /> on <WhoLink id={s.firstBlood.target} /></Record>,
      s.lastBlow && <Record key="last" icon={CONCEPT_ICON.finalBlow} title="Final Blow" value={s.lastBlow.turn ? `T${s.lastBlow.turn}` : "—"}><WhoLink id={s.lastBlow.id} /> on <WhoLink id={s.lastBlow.target} /></Record>,
      s.pulses && (
        <Record key="pulse" icon={CONCEPT_ICON.pulse} title={s.pulses.falls.length ? "Didn't Happen" : "Do-over"} value={s.pulses.uses} unit={s.pulses.uses === 1 ? "Divine Pulse" : "Divine Pulses"}>
          {s.pulses.undone ? `${plural(s.pulses.undone, "action")} undone` : "Turned back time"}
          {s.pulses.falls.length > 0 && <span className="muted"> · saved {[...new Set(s.pulses.falls)].join(", ")}</span>}
        </Record>
      ),
    ]],
  ];
  const shown = columns.map(([title, icon, cards]) => [title, icon, cards.filter(Boolean)] as const).filter(([, , cards]) => cards.length);
  return (
    <section className="ms-panel ms-standouts" id="ms-standouts" aria-labelledby="ms-standouts-title">
      <header className="ms-panel-head">
        <h3 id="ms-standouts-title">Standouts</h3>
        <span className="ms-panel-hint">Select a name to see them across the whole run</span>
      </header>
      {!shown.length ? <Empty>Nothing stood out yet.</Empty> : (
        <div className="standout-carousel">
          <Carousel label="standout groups" rows={shown.map(([title, icon, cards]) => (
            <li key={title} className="standout-column">
              <div className="standout-stack" role="group" aria-label={title}>
                <h4 className="standout-group"><Icon name={icon} />{title}<span className="standout-count">{cards.length}</span></h4>
                <div className="standout-list">{cards}</div>
              </div>
            </li>
          ))} />
        </div>
      )}
    </section>
  );
}

/** Each of your units' part in the battle: their share of the army's damage, and their other numbers beside it. */
const shareRows = (stats: MoreStats) => stats.units.filter((u) => u.fights || u.dealt || u.healing || u.tiles).sort((a, b) => b.dealt - a.dealt || b.fights - a.fights);

function Share({ stats }: { stats: MoreStats }) {
  const rows = shareRows(stats);
  const total = rows.reduce((n, u) => n + u.dealt, 0);
  const top = Math.max(1, ...rows.map((u) => u.dealt));
  if (!rows.length) return null;
  return (
    <section className="ms-panel ms-share" id="ms-share" aria-labelledby="ms-share-title">
      <header className="ms-panel-head">
        <h3 id="ms-share-title">Share of the Fighting</h3>
        <span className="ms-panel-hint">your units, by damage dealt</span>
      </header>
      <div className="share-scroll">
        <table className="share-table">
          <thead>
            <tr>
              <th scope="col" className="left">Unit</th>
              <th scope="col" className="left share-col">Damage share</th>
              <th scope="col">Kills</th>
              <th scope="col">Fights</th>
              <th scope="col">Taken</th>
              <th scope="col">Healing</th>
              <th scope="col">Tiles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u, i) => (
              <tr key={u.id} style={{ ["--i" as string]: i } as CSSProperties}>
                <th scope="row" className="left"><WhoLink id={u.id} /></th>
                <td className="left share-col">
                  <span className="share-bar" aria-hidden="true"><span style={{ width: `${(100 * u.dealt) / top}%` }} /></span>
                  <span className="share-pct">{total ? `${Math.round((100 * u.dealt) / total)}%` : "—"}</span>
                </td>
                <td>{u.defeats}</td>
                <td>{u.fights}</td>
                <td>{u.taken}</td>
                <td>{u.healing}</td>
                <td>{u.tiles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Better = "more" | "less" | null;

/** This battle against the run's other finished battles, on average: a bar for this battle, a tick for the average. */
function Compared({ battle, seconds, history }: { battle: Battle; seconds: number; history: Battle[] }) {
  const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const avg = (pick: (b: Battle) => number | null): number | null => {
    const known = history.map(pick).filter((v): v is number => v !== null);
    return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
  };
  const lost = (b: Battle) => b.units.filter((u) => !u.on_map && !u.adjutant_of).length;
  const rows: [string, number | null, number | null, (n: number) => string, Better][] = [
    ["Time", seconds, avg((b) => b.seconds), clock, null],
    ["Turns", battle.turn, avg((b) => b.turn), one, null],
    ["Damage dealt", armyTotals(battle).dealt, avg((b) => armyTotals(b).dealt), (n) => String(Math.round(n)), "more"],
    ["Kills", armyTotals(battle).defeats, avg((b) => armyTotals(b).defeats), one, "more"],
    ["Units lost", lost(battle), avg(lost), one, "less"],
    ["Level-ups", battle.level_ups, avg((b) => b.level_ups), one, "more"],
    ["Stat points", battle.stat_points, avg((b) => b.stat_points), (n) => `+${one(n)}`, "more"],
    ["Divine Pulse", battle.divine_pulses, avg((b) => b.divine_pulses), one, null],
  ];
  const shown = rows.filter(([, now, average]) => now !== null && average !== null) as [string, number, number, (n: number) => string, Better][];
  return (
    <section className="ms-panel ms-compare" aria-labelledby="ms-compare-title">
      <header className="ms-panel-head">
        <h3 id="ms-compare-title">Against Your Other Battles</h3>
        {history.length > 0 && <span className="ms-panel-hint">average of {history.length}</span>}
      </header>
      {!history.length ? <Empty>No other finished battles in this run yet.</Empty> : (
        <ul className="compare-rows">
          {shown.map(([label, now, average, f, better], i) => {
            const scale = Math.max(now, average) * 1.12 || 1;
            const diff = average ? (now - average) / average : now ? 1 : 0;
            const tone = better === null || Math.abs(diff) < 0.05 ? "even" : (diff > 0) === (better === "more") ? "good" : "bad";
            const delta = Math.abs(diff) < 0.05 ? "about even" : `${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff) * 100)}%`;
            return (
              <li key={label} className={`compare-row ${tone}`} style={{ ["--i" as string]: i } as CSSProperties}
                title={`${label}: ${f(now)} this battle, ${f(average)} on average`}>
                <span className="compare-label">{label}</span>
                <span className="compare-now">{f(now)}</span>
                <span className="compare-delta">{delta}</span>
                <span className="cmp-track" aria-hidden="true">
                  <span className="cmp-fill" style={{ width: `${(100 * now) / scale}%` }} />
                  <span className="cmp-avg" style={{ left: `${(100 * average) / scale}%` }} />
                </span>
                <span className="compare-of">avg {f(average)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Graphs

type Chart = { key: string; title: string; kind: "time" | "unit"; ok: boolean; right?: ReactNode; node: ReactNode };

function GraphsPart({ view, group }: { view: View; group: Group }) {
  const charts = chartsFor(view, group).filter((c) => c.ok);
  const time = charts.filter((c) => c.kind === "time");
  const unit = charts.filter((c) => c.kind === "unit");
  const span = (n: number) => (n >= 4 ? 3 : 12 / n);
  if (!charts.length) return <div className="ms-graphs empty"><Empty>No data for these graphs in this battle yet.</Empty></div>;
  return (
    <div className={`ms-graphs rows-${(time.length ? 1 : 0) + (unit.length ? Math.ceil(unit.length / 4) : 0)}`}>
      {[...time.map((c) => [c, span(time.length)] as const), ...unit.map((c) => [c, span(unit.length)] as const)].map(([c, cols], i) => (
        <section key={c.key} className={`ms-chart ${c.kind}`} style={{ gridColumn: `span ${cols}`, ["--i" as string]: i } as CSSProperties} aria-label={c.title}>
          <header className="ms-chart-head">
            <h3>{c.title}</h3>
            {c.right}
          </header>
          <div className="ms-chart-body">{c.node}</div>
        </section>
      ))}
    </div>
  );
}

const turnTitle = (turn: number, text: string) => `Turn ${turn}: ${text} (select for its fights)`;

/** Every chart of a topic: per-turn ("time") and per-unit ones. */
function chartsFor({ battle, seconds, stats, pick }: View, group: Group): Chart[] {
  const turns = stats.perTurn;
  const activity = stats.activity;
  const board = stats.board;
  if (group === "combat") {
    const dealt = stats.units.filter((u) => u.dealt || u.taken).sort((a, b) => b.dealt - a.dealt || b.taken - a.taken);
    const defeats = stats.units.filter((u) => u.defeats > 0).sort((a, b) => b.defeats - a.defeats);
    const fights = stats.units.filter((u) => u.fights > 0).sort((a, b) => b.fights - a.fights);
    const efficiency = stats.units.filter((u) => u.fights > 0).sort((a, b) => b.dealt / b.fights - a.dealt / a.fights);
    return [
      { key: "dpt", title: "Damage per Turn", kind: "time", ok: turns.length > 1 && turns.some((t) => t.dealt || t.taken), node: (
        <TurnColumns series={[DEALT, TAKEN]} onPick={pick} rows={turns.map((t) => ({ turn: t.turn, values: [t.dealt, t.taken], title: turnTitle(t.turn, `${t.dealt} dealt, ${t.taken} taken${t.defeats ? `, ${plural(t.defeats, "kill")}` : ""}`) }))} />
      ) },
      { key: "fpt", title: "Fights per Turn", kind: "time", ok: activity.some((t) => t.fights > 0), node: (
        <TurnColumns series={[FIGHTS]} onPick={pick} rows={activity.map((t) => ({ turn: t.turn, values: [t.fights], title: turnTitle(t.turn, plural(t.fights, "fight")) }))} />
      ) },
      { key: "dbu", title: "Damage by Unit", kind: "unit", ok: dealt.length > 0, node: <MirrorBars rows={dealt.map((u) => ({ id: u.id, left: u.taken, right: u.dealt }))} left={TAKEN} right={DEALT} /> },
      { key: "kills", title: "Kills", kind: "unit", ok: defeats.length > 0, node: <UnitBars rows={defeats.map((u) => ({ id: u.id, values: [u.defeats] }))} series={[{ label: "Killed", color: "var(--taken)" }]} /> },
      { key: "fbu", title: "Fights by Unit", kind: "unit", ok: fights.length > 0, node: <UnitBars rows={fights.map((u) => ({ id: u.id, values: [u.fights] }))} series={[FIGHTS]} /> },
      { key: "dpf", title: "Damage per Fight", kind: "unit", ok: efficiency.length > 0, node: <UnitBars rows={efficiency.map((u) => ({ id: u.id, values: [u.dealt / u.fights], note: `${(u.dealt / u.fights).toFixed(1)}` }))} series={[DEALT]} /> },
    ];
  }
  if (group === "support") {
    const heal = stats.units.filter((u) => u.healing || u.healed).sort((a, b) => b.healing - a.healing || b.healed - a.healed);
    const received = stats.units.filter((u) => u.healed > 0).sort((a, b) => b.healed - a.healed);
    const low = stats.units.filter((u) => u.low !== null).sort((a, b) => a.low! / a.max - b.low! / b.max);
    return [
      { key: "hpt", title: "Healing per Turn", kind: "time", ok: activity.some((t) => t.healed > 0), node: (
        <TurnColumns series={[HEAL]} onPick={pick} rows={activity.map((t) => ({ turn: t.turn, values: [t.healed], title: turnTitle(t.turn, `${t.healed} HP restored`) }))} />
      ) },
      { key: "hbu", title: "Healing by Unit", kind: "unit", ok: heal.length > 0, node: <MirrorBars rows={heal.map((u) => ({ id: u.id, left: u.healed, right: u.healing }))} left={HEALED} right={HEAL} /> },
      { key: "recv", title: "Healing Received", kind: "unit", ok: received.length > 0, node: <UnitBars rows={received.map((u) => ({ id: u.id, values: [u.healed] }))} series={[HEALED]} /> },
      { key: "low", title: "Lowest HP Reached", kind: "unit", ok: low.length > 0, node: <UnitBars rows={low.map((u) => ({ id: u.id, values: [u.low!], of: u.max, note: `${u.low} / ${u.max}` }))} series={[{ label: "HP", color: "var(--heal)" }]} /> },
    ];
  }
  if (group === "flow") {
    const walked = stats.units.filter((u) => u.tiles > 0).sort((a, b) => b.tiles - a.tiles);
    return [
      { key: "outlook", title: "Outlook", kind: "time", ok: battle.trend.length > 1, node: <TrendChart trend={battle.trend} seconds={seconds} events={battle.events} /> },
      { key: "standing", title: "Units Standing", kind: "time", ok: board.length > 1, node: (
        <TurnLines series={[YOURS, THEIRS]} onPick={pick} rows={board.map((b) => ({ turn: b.turn, values: [b.army, b.foes], title: turnTitle(b.turn, `${b.army} of yours, ${b.foes} of theirs standing`) }))} />
      ) },
      { key: "hp", title: "HP Left", kind: "time", ok: board.length > 1, node: (
        <TurnLines series={[YOURS, THEIRS]} onPick={pick} rows={board.map((b) => ({ turn: b.turn, values: [b.armyHp, b.foeHp], title: turnTitle(b.turn, `${b.armyHp} HP yours, ${b.foeHp} HP theirs`) }))} />
      ) },
      { key: "tiles", title: "Tiles Moved", kind: "unit", ok: walked.length > 0, node: <UnitBars rows={walked.map((u) => ({ id: u.id, values: [u.tiles] }))} series={[WALK]} /> },
    ];
  }
  const growth = battle.units
    .map((u) => ({ id: armyId(u.key), gain: statGains(u), levels: u.level_ups }))
    .filter((r) => r.gain > 0 || r.levels > 0)
    .sort((a, b) => b.gain - a.gain)
    .map((r) => ({ id: r.id, values: [r.gain], note: `+${r.gain}${r.levels ? ` · ${plural(r.levels, "level")}` : ""}` }));
  const used = stats.units
    .filter((u) => u.weapons || u.spells || u.items)
    .sort((a, b) => b.weapons + b.spells + b.items - (a.weapons + a.spells + a.items))
    .map((u) => ({ id: u.id, values: [u.weapons, u.spells, u.items] }));
  const broken = battle.units.reduce((n, u) => n + u.broken_weapons, 0);
  return [
    { key: "growth", title: "Growth by Unit", kind: "unit", ok: growth.length > 0, node: <UnitBars rows={growth} series={[{ label: "Stat points", color: "var(--accent)" }]} /> },
    { key: "used", title: "Weapons, Spells & Items", kind: "unit", ok: used.length > 0, right: broken > 0 ? <span className="ms-chart-note">{plural(broken, "weapon")} broken</span> : undefined, node: (
      <UnitBars rows={used} series={[{ label: "Weapon attacks", color: "var(--dealt)" }, { label: "Spells", color: "var(--walk)" }, { label: "Items", color: "var(--heal)" }]} />
    ) },
  ];
}
