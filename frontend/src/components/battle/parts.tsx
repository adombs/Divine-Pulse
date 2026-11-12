/** Pieces the Battle page's tabs share: unit links, the log's rows, chips, the outlook card and chart. */
import { CONCEPT_ICON } from "../../icons/concepts";
import { createContext, Fragment, ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Battle, BattleEvent, BattleUnit, Outlook, TrendPoint, Usage, ValueKey } from "../../api";
import type { EbstConfig } from "../../ebst";
import { type FaceLook, type MapLook, spriteLayers, UnitSprite, useSprites } from "./mapIcons";
import { armySprite, isObject, spriteOf } from "./map";
import { clock, plural } from "../../format";
import { AffiliationIcon } from "../AffiliationIcon";
import { Icon } from "../Icon";
import { GameImage, MissingGameAsset, PortraitImage } from "../GameImage";
import { GearIcon, WeaponIcon } from "./gameIcons";
import { ArtIcon } from "../../reference/icons";
import { AbilityLink, ArtLink, GambitLink, ItemLink, SpellLink } from "../Links";
import { nameParts } from "../../reference/links";
import { isLost, TEAM_LABEL, TeamCount, teamCounts, TeamTag } from "./marks";
import { battleSummary, hpShare, ICON, Item, mergeHits, STAT_LABEL, STAT_ORDER, TEXT, Who } from "./model";

/** Opening a unit's card from anywhere on the page (names in the log, opponents, highlights). */
export interface BattleNav {
  people: Map<string, Who>;
  /** Open this unit in the character popup. */
  open: (id: string) => void;
  /** A unit's headshot URL (your units and other characters with a known portrait; null otherwise), for the map. */
  portrait?: (id: string) => string | null;
  importedFace?: (id: string) => string | null;
  /** How units are drawn on the map, and how fast a replay plays (1 normal), from Settings > Appearance. */
  mapLook?: MapLook;
  replaySpeed?: number;
  /** Changes the replay speed from the battle view (it is the Settings value, so it sticks). */
  setReplaySpeed?: (speed: number) => void;
  /** How a unit's eBST is worked out (its roster settings; null when it isn't in the roster). */
  ebstConfig?: (key: string) => EbstConfig | null;
  /** Whether one of your units is on the Roster (a unit that left the army alive keeps its history but has no card there). */
  onRoster?: (key: string) => boolean;
  /** The affiliation ("Golden Deer") of one of your units by id, when the roster knows it. */
  house?: (id: string) => string | undefined;
}

export const BattleNavContext = createContext<BattleNav | null>(null);

export function useBattleNav(): BattleNav {
  const nav = useContext(BattleNavContext);
  if (!nav) throw new Error("useBattleNav outside the Battle page");
  return nav;
}

/** The same bare affiliation pennant in every battle list, colored for the unit's army. */
export function HouseMark({ id }: { id: string }) {
  const nav = useBattleNav();
  const who = nav.people.get(id);
  return <AffiliationIcon house={nav.house?.(id)} side={who?.army ? "player" : who?.enemy?.side ?? "enemy"} bare />;
}

/** A unit's name that opens its card, marked with its army's colour (a small dot: yours blue, others red). */
export function WhoLink({ id, fallback = "A unit" }: { id: string | null; fallback?: string }) {
  const nav = useBattleNav();
  if (!id) return <span className="who-plain">{fallback}</span>;
  const who = nav.people.get(id);
  if (!who) return <span className="who-plain">{fallback}</span>;
  return (
    <button type="button" className={`who-link team-${who.army ? "player" : (who.enemy?.side ?? "enemy")}`} onClick={(e) => (e.stopPropagation(), nav.open(id))} title={`Show ${who.name}`}>
      {who.name}
    </button>
  );
}

/** Which army's phase a heading row starts (for its colour). */
const PHASE_CLASS = ["player", "enemy", "other", "other"];

/** One line of the log: time, the icon of what happened (tinted by its kind), and what happened, with names that open
 * the unit's card and the numbers as chips. Phase starts are thin banners in their army's colour. */
export function ItemRow({ item, current, future, undone = item.branch > 0, onSelect }: { item: Item; current?: boolean; future?: boolean; undone?: boolean; onSelect?: (item: Item) => void }) {
  const phase = item.heading && item.phase !== null ? PHASE_CLASS[item.phase] ?? "" : "";
  const pick = onSelect && !item.heading && (item.beat !== undefined ? item.beat !== null || !!item.beats?.length : item.step !== null || !!item.steps?.length);
  return (
    <li
      className={`log-row cat-${item.category} kind-${item.kind} ${item.heading ? `heading ${phase}` : ""} ${undone ? "undone" : ""} ${current ? "current" : ""} ${future ? "future" : ""} ${pick ? "pickable" : ""}`}
      aria-current={current || undefined}
      onClick={pick ? () => onSelect(item) : undefined}
      onKeyDown={pick ? (e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(item)) : undefined}
      tabIndex={pick ? 0 : undefined}
      title={pick ? "Show the battle at this point" : undefined}
    >
      <span className="log-time">{clock(item.t)}</span>
      <span className="log-icon">
        <LogIcon item={item} />
      </span>
      <span className="log-text">
        <ItemText item={item} />
        {item.defeated && (
          <span className="log-defeat" title="A unit went down">
            <Icon name={CONCEPT_ICON.defeat} />
          </span>
        )}
        {undone && (
          <span className="undone-badge" title="Turned back by Divine Pulse: this no longer stands">
            undone
          </span>
        )}
      </span>
    </li>
  );
}

/** A log row's icon: the game's own for a combat art, a spell or the weapon an attack was made with, else the kit's. */
function LogIcon({ item }: { item: Item }) {
  const who = useBattleNav().people.get(item.actor ?? "");
  const weapon = who?.unit?.weapon ?? who?.enemy?.weapon;
  if (item.detail && (item.kind === "attack" || item.kind === "art")) return <GearIcon kind="art" name={item.detail} />;
  if (item.detail && item.kind === "spell") return <GearIcon kind="spell" name={item.detail} />;
  if (item.kind === "attack") return <WeaponIcon kind={weapon} />;
  return <Icon name={ICON[item.kind] ?? CONCEPT_ICON.wait} />;
}

const Verb = ({ children }: { children: ReactNode }) => <span className="log-verb">{children}</span>;

/** Which army a unit in the log is in, as on the map: "player", or another unit's side ("enemy", "ally", "third"). */
function useSide(id: string | null): string {
  const who = useBattleNav().people.get(id ?? "");
  if (!who) return id?.startsWith("a:") ? "player" : "enemy";
  return who.army ? "player" : (who.enemy?.side ?? "enemy");
}

/** An exact number in the log: a grey chip with an icon in the colour of the army of the unit it belongs to. */
function NumChip({ who, icon, counter, title, children }: { who: string | null; icon: typeof CONCEPT_ICON.attack | typeof CONCEPT_ICON.heal; counter?: boolean; title: string; children: ReactNode }) {
  const side = useSide(who);
  return (
    <span className={`num-chip ${side}${counter ? " counter" : ""}`} title={title}>
      <Icon name={icon} /> {children}
    </span>
  );
}

function HpChip({ who, restored, title }: { who: string | null; restored: number | null; title: string }) {
  return (
    <span className="fight-numbers">
      <NumChip who={who} icon={CONCEPT_ICON.heal} title={title}>
        +{restored ?? 0} HP
      </NumChip>
    </span>
  );
}

function ItemText({ item }: { item: Item }) {
  if (item.kind === "attack") {
    return (
      <>
        <WhoLink id={item.actor} />
        {item.detail ? (
          <>
            {/* A combat art: "Ignatz used Break Shot on Bandit 2" */}
            <Verb>used</Verb>
            <span className="log-detail">
              <ArtIcon name={item.detail} weapon={false} />
              <ArtLink name={item.detail} />
            </span>
            <Verb>on</Verb>
          </>
        ) : (
          <Verb>attacked</Verb>
        )}
        <WhoLink id={item.target} />
        <span className="fight-numbers">
          {(item.hits ?? [{ dealt: item.dealt, taken: item.taken }]).map((h, n) => (
            <Fragment key={n}>
              <NumChip who={item.actor} icon={CONCEPT_ICON.attack} title="Damage Dealt">
                {h.dealt ?? 0}
              </NumChip>
              {(h.taken ?? 0) > 0 && (
                <NumChip who={item.target} icon={CONCEPT_ICON.attack} counter title="Damage the attacker took from the counterattack">
                  {h.taken}
                </NumChip>
              )}
            </Fragment>
          ))}
        </span>
      </>
    );
  }
  if (item.kind === "defeat" && item.actor) {
    return (
      <>
        <WhoLink id={item.actor} />
        <Verb>killed</Verb>
        <WhoLink id={item.target} />
      </>
    );
  }
  if (item.kind === "fell") {
    return (
      <>
        <WhoLink id={item.actor} />
        <Verb>fell</Verb>
        {item.target && (
          <>
            <Verb>to</Verb>
            <WhoLink id={item.target} />
          </>
        )}
      </>
    );
  }
  if ((item.kind === "heal" || item.kind === "spell" || item.kind === "art" || item.kind === "rally") && item.actor && (item.target || item.detail)) {
    // "Manuela used Heal on Byleth (+10 HP)", "Flayn used Rescue on Lysithea", "Byleth used Swap on Claude", "Byleth
    // used Rally Speed on Claude"; older battles: "Flayn healed Lorenz".
    return (
      <>
        <WhoLink id={item.actor} />
        {item.detail ? (
          <>
            <Verb>used</Verb>
            <span className="log-detail">{item.kind === "art" ? <><ArtIcon name={item.detail} weapon={false} /><ArtLink name={item.detail} /></> : item.kind === "rally" ? <AbilityLink name={item.detail} /> : <SpellLink name={item.detail} />}</span>
            {item.target && <Verb>on</Verb>}
          </>
        ) : (
          <Verb>healed</Verb>
        )}
        {item.target && <WhoLink id={item.target} />}
        {item.kind === "heal" && (item.restored ?? 0) > 0 && <HpChip who={item.actor} restored={item.restored} title="HP restored" />}
      </>
    );
  }
  if (item.kind === "gambit" && item.actor) {
    // "Marianne used Stride on Raphael": the gambit opens the battalion that has it, in the Archive.
    return <GambitText item={item} />;
  }
  if (item.kind === "item" && item.actor) {
    return (
      <>
        <WhoLink id={item.actor} />
        {item.detail ? (
          <>
            <Verb>used</Verb>
            <span className="log-detail"><ItemLink name={item.detail} /></span>
          </>
        ) : (
          <Verb>used an item</Verb>
        )}
        {(item.restored ?? 0) > 0 && <HpChip who={item.actor} restored={item.restored} title="HP recovered" />}
      </>
    );
  }
  if (item.kind === "act" && item.actor) {
    return (
      <>
        <WhoLink id={item.actor} />
        <Verb>{item.target ? "acted on" : "acted"}</Verb>
        {item.target && <WhoLink id={item.target} />}
      </>
    );
  }
  if ((item.kind === "move" || item.kind === "wait") && item.actor) {
    return (
      <>
        <WhoLink id={item.actor} />
        <Verb>{item.kind === "move" ? "moved" : "waited"}</Verb>
      </>
    );
  }
  if (item.kind === "start") return <span><StartText text={item.text} /></span>;
  if ((item.kind === "level_up" || item.kind === "stat_up" || item.kind === "joined" || item.kind === "left") && item.actor) {
    return <span><UnitText item={item} /></span>;
  }
  return <span className={item.heading ? "log-heading-text" : undefined}>{item.text}</span>;
}

/** A gambit's row: who used it, the gambit (a link to its battalion), on whom, and the damage or HP it gave. */
function GambitText({ item }: { item: Item }) {
  const who = useBattleNav().people.get(item.actor ?? "");
  const battalion = who?.unit?.battalion;
  return (
    <>
      <WhoLink id={item.actor} />
      {item.detail ? (
        <>
          <Verb>used</Verb>
          <span className="log-detail">
            <GambitLink name={item.detail} battalion={battalion} />
          </span>
          {item.target && <Verb>on</Verb>}
        </>
      ) : (
        <Verb>used a gambit</Verb>
      )}
      {item.target && <WhoLink id={item.target} />}
      {((item.dealt ?? 0) > 0 || (item.restored ?? 0) > 0) && (
        <span className="fight-numbers">
          {(item.dealt ?? 0) > 0 && (
            <NumChip who={item.actor} icon={CONCEPT_ICON.attack} title="Damage Dealt">
              {item.dealt}
            </NumChip>
          )}
          {(item.restored ?? 0) > 0 && (
            <NumChip who={item.actor} icon={CONCEPT_ICON.heal} title="HP restored">
              +{item.restored} HP
            </NumChip>
          )}
        </span>
      )}
    </>
  );
}

/** What a tracker event says about a unit ("Cyril joined the battle", "Byleth reached level 25 (HP +1)"), with the
 * unit's name opening its card. */
function UnitText({ item }: { item: Item }) {
  const who = useBattleNav().people.get(item.actor ?? "");
  if (!who || !item.text.startsWith(who.name)) return <>{item.text}</>;
  return (
    <>
      <WhoLink id={item.actor} />
      {item.text.slice(who.name.length)}
    </>
  );
}

/** "Battle started with 12 units (Byleth, Claude, ...); 20 other units on the map": each of your units opens its card. */
function StartText({ text }: { text: string }) {
  const people = useBattleNav().people;
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return <>{text}</>;
  const ids = new Map<string, string>();
  for (const who of people.values()) if (who.army && !ids.has(who.name)) ids.set(who.name, who.id);
  return (
    <>
      {text.slice(0, open + 1)}
      {nameParts(text.slice(open + 1, close), [...ids.keys()]).map((part, n) => (
        <Fragment key={n}>{part.name ? <WhoLink id={ids.get(part.name) ?? null} fallback={part.text} /> : part.text}</Fragment>
      ))}
      {text.slice(close)}
    </>
  );
}

/** A list of log rows in action order. */
export function ItemList({
  items,
  empty = "Nothing yet.",
  current,
  onSelect,
}: {
  items: Item[];
  empty?: string;
  current?: number | null;
  /** Makes rows pickable (the Overview: show the battle at that row); the row at `current` scrolls into view. */
  onSelect?: (item: Item) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Follows the replay; scrolling the list by hand is left alone until the replay moves on.
    const row = list.current?.querySelector<HTMLElement>("li.current");
    const box = list.current?.closest<HTMLElement>(".log-scroll");
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + (r.top - b.top) - b.height / 2 + r.height / 2, behavior: "smooth" });
  }, [current]);
  if (!items.length) return <p className="muted">{empty}</p>;
  const shown = mergeHits(items);
  // The chronology (chronicle.ts) is by replay beat, and a row is undone once the replay is at or past the Divine Pulse
  // that turned it back; any other list is by position in the game's history.
  const first = (i: Item) => (i.beat !== undefined ? i.beats?.[0] ?? i.beat : i.steps?.[0] ?? i.step);
  const isCurrent = (i: Item) => current != null && (i.beat !== undefined ? i.beat === current || !!i.beats?.includes(current) : i.step === current || !!i.steps?.includes(current));
  const isUndone = (i: Item) => (i.beat === undefined ? i.branch > 0 : i.undoneBy != null && (current == null || (i.undoneAt != null && current >= i.undoneAt)));
  return (
    <ol className="log-list" ref={list}>
      {shown.map((i) => (
        <ItemRow
          key={i.key}
          item={i}
          current={isCurrent(i)}
          future={current != null && first(i) != null && first(i)! > current}
          undone={isUndone(i)}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}


export function Gains({ gains }: { gains: Partial<Record<ValueKey, number>> }) {
  const keys = STAT_ORDER.filter((k) => gains[k]);
  if (!keys.length) return <span className="muted">No stat gains yet</span>;
  return (
    <span className="chip-list">
      {keys.map((k) => (
        <span key={k} className={`gain-chip ${(gains[k] ?? 0) < 0 ? "down" : ""}`}>
          {STAT_LABEL[k]} {(gains[k] ?? 0) > 0 ? "+" : ""}
          {gains[k]}
        </span>
      ))}
    </span>
  );
}

/** What a unit spent (weapon uses, spells, items) and has left (magic, its most worn weapon, consumables). */
export function Supplies({ unit }: { unit: BattleUnit }) {
  const spent = [
    unit.weapon_uses ? plural(unit.weapon_uses, "weapon attack") : "",
    unit.spells_cast ? plural(unit.spells_cast, "spell") : "",
    unit.item_uses ? plural(unit.item_uses, "item") : "",
  ].filter(Boolean);
  const left: [string, string, boolean][] = [];
  if (unit.spell_uses_full) left.push([`${unit.spell_uses_left}/${unit.spell_uses_full} magic`, `${unit.spell_uses_left} of ${unit.spell_uses_full} spell uses left`, unit.spell_uses_left === 0]);
  if (unit.weakest_weapon !== null) left.push([`weapon ${unit.weakest_weapon}`, `Its most worn weapon has ${plural(unit.weakest_weapon, "use")} left`, unit.weakest_weapon <= 3]);
  if (unit.broken_weapons > 0) left.push([`${unit.broken_weapons} broken`, plural(unit.broken_weapons, "broken weapon"), true]);
  if (unit.consumables_left) left.push([`${unit.consumables_left} items`, `${unit.consumables_left} uses of Vulneraries and other consumables left`, false]);
  return (
    <div className="supplies">
      <div title={TEXT.actions}>
        <span className="field-label">Spent</span>{" "}
        {spent.length ? (
          <span className="chip-list">
            {spent.map((s) => (
              <span key={s} className="supply-chip">
                {s}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">nothing yet</span>
        )}
      </div>
      <div>
        <span className="field-label">Left</span>{" "}
        {left.length ? (
          <span className="chip-list">
            {left.map(([text, title, low]) => (
              <span key={text} className={`supply-chip ${low ? "low" : ""}`} title={title}>
                {text}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">not read yet</span>
        )}
      </div>
    </div>
  );
}

/** "—" with the reason on hover, for a value that isn't tracked. */
export function Num({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined)
    return (
      <span className="untracked" title={TEXT.notTracked}>
        —
      </span>
    );
  return (
    <>
      {value}
    </>
  );
}

export function OutlookCard({ outlook, trend, seconds, events, at }: { outlook: Outlook; trend: TrendPoint[]; seconds: number; events: BattleEvent[]; at?: number | null }) {
  const pct = Math.round(outlook.chance * 100);
  const tone = pct >= 70 ? "good" : pct >= 40 ? "even" : "bad";
  return (
    <div className={`outlook ${tone}`}>
      <div className="outlook-head">
        <span className="outlook-label">Outlook</span>
        <span className="outlook-pct">{pct}%</span>
        <span className="muted">chance of winning · {outlook.confidence} confidence</span>
      </div>
      <div className="outlook-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Estimated chance of winning">
        <span style={{ width: `${pct}%` }} />
      </div>
      <TrendChart trend={trend} seconds={seconds} events={events} at={at} />
      {outlook.factors.length > 0 && (
        <div className="outlook-why">
          <span className="outlook-why-label" tabIndex={0}>
            <Icon name={CONCEPT_ICON.info} /> Why {pct}%?
          </span>
          <ul className="outlook-factors">
            {outlook.factors.map((f) => (
              <li key={f.label}>
                <span className={f.points >= 0 ? "ok-text" : "form-error"}>
                  {f.points >= 0 ? "+" : ""}
                  {f.points.toFixed(1)}
                </span>{" "}
                <strong>{f.label}</strong> <span className="muted">{f.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The outlook over the battle as a small step chart (0-100%, with the even line), with the army's and the other
 * units' HP once tracked, and a tick at each new turn. */
export function TrendChart({ trend, seconds, events = [], at }: { trend: TrendPoint[]; seconds: number; events?: BattleEvent[]; at?: number | null }) {
  if (trend.length < 2) return null;
  const W = 600;
  const H = 60;
  const end = Math.max(seconds, trend[trend.length - 1].t, 1);
  const x = (t: number) => (W * t) / end;
  const y = (c: number) => H - H * c;
  const line = (pick: (p: TrendPoint) => number | null): string => {
    let path = "";
    let last: number | null = null;
    for (const p of trend) {
      const v = pick(p);
      if (v === null) continue;
      path += last === null ? `M ${x(p.t)} ${y(v)}` : ` H ${x(p.t)} V ${y(v)}`;
      last = v;
    }
    return last === null ? "" : `${path} H ${W}`;
  };
  const army = line((p) => p.army_hp);
  const others = line((p) => p.enemy_hp);
  const turns = events.filter((e) => e.kind === "turn");
  const last = trend[trend.length - 1];
  return (
    <figure className="trend" aria-label={`Outlook over the battle, from ${Math.round(trend[0].chance * 100)}% to ${Math.round(last.chance * 100)}%`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <line className="trend-even" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        {turns.map((e, i) => (
          <line key={i} className="trend-turn" x1={x(e.t)} x2={x(e.t)} y1={H - 8} y2={H} />
        ))}
        {others && <path className="trend-enemy" d={others} />}
        {army && <path className="trend-army" d={army} />}
        <path className="trend-line" d={line((p) => p.chance)} />
        {at != null && <line className="trend-now" x1={x(at)} x2={x(at)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption className="muted">
        <span className="trend-key line">Outlook</span>
        {army && <span className="trend-key army">Your HP</span>}
        {others && <span className="trend-key enemy">Their HP</span>}
        {turns.length > 0 && <span className="trend-key turn">New turn</span>}
        <span>
          {clock(0)} to {clock(end)}
        </span>
      </figcaption>
    </figure>
  );
}

export function CopySummary({ battle, seconds }: { battle: Battle; seconds: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(battleSummary(battle, seconds));
      setState("copied");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" className="btn small" onClick={copy} title="Copy the battle as text, to paste into notes or a message">
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy Summary"}
    </button>
  );
}

/** Seconds since `start`, ticking every second while `live`. */
export function useElapsed(start: string, live: boolean, fallback: number, away = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  return live ? Math.max(0, (now - Date.parse(start)) / 1000 - away) : fallback;
}

export interface KeyNumber {
  label: string;
  value: string;
  suffix?: string;
  title?: string;
  tone?: "bad";
  /** Counts by army, each after its army's coloured dot (`value` holds the same as text). */
  teams?: TeamCount[];
}

/** The "On the map" key number: units on the map by army, only the armies in the battle. */
export function teamNumber(teams: TeamCount[]): KeyNumber | null {
  if (!teams.length) return null;
  return {
    label: "On the map",
    value: teams.map((c) => `${c.now}/${c.of}`).join(" · "),
    title: teams.map((c) => `${TEAM_LABEL[c.team]}: ${c.now} of ${c.of} on the map`).join(", "),
    teams,
  };
}

/** The numbers worth a glance in game: time, turn, units, HP, enemies, Divine Pulse. */
export function keyNumbers(battle: Battle, seconds: number): KeyNumber[] {
  const lost = battle.units.filter(isLost).length;
  const onMap = battle.units.length - lost;
  const army = hpShare(battle.army_hp, battle.army_max_hp ?? 0);
  const out: KeyNumber[] = [
    { label: "Time", value: clock(seconds), title: "Time in Battle" },
    { label: "Turn", value: String(battle.turn ?? "—"), title: battle.turn === null ? TEXT.notLocated : undefined },
    { label: "Units", value: `${onMap}/${battle.units.length}`, title: lost ? `${lost} left the battle` : "Your units on the map", tone: lost ? "bad" : undefined },
  ];
  if (army !== null) out.push({ label: "HP", value: `${Math.round(army * 100)}%`, title: `${battle.army_hp} / ${battle.army_max_hp} HP` });
  const teams = teamNumber(teamCounts(battle));
  if (teams) out.push(teams);
  out.push({
    label: "Divine Pulse",
    value: String(battle.divine_pulse_charges ?? battle.divine_pulses),
    suffix: battle.divine_pulse_charges !== null ? "left" : "used",
    title: battle.divine_pulse_charges !== null ? `${battle.divine_pulses} used` : "Times used",
  });
  const outlook = battle.outlook?.chance;
  if (outlook !== null && outlook !== undefined) out.push({ label: "Outlook", value: `${Math.round(outlook * 100)}%`, title: "Estimated chance of winning" });
  return out;
}

/** A unit's face in lists: its portrait or map sprite, ringed in its army's
 * colour (an object, such as a breakable wall: its map icon, no ring). */
export function UnitFace({ id, name, size = "md", look }: { id: string; name: string; size?: "sm" | "md" | "lg"; look?: FaceLook }) {
  const nav = useBattleNav();
  const who = nav.people.get(id);
  const mine = who?.army || id.startsWith("a:") || who?.enemy?.side === "player";
  const want = look ?? (mine ? nav.mapLook?.myFaces : nav.mapLook?.otherFaces) ?? "portraits";
  const sprites = useSprites();
  const portrait = nav.portrait?.(id);
  // Yours blue, enemies red, allies green, a third army yellow, as on the map.
  const side = who?.army || id.startsWith("a:") ? "player" : who?.enemy && isObject(who.enemy) ? "object" : who?.enemy?.side === "player" || who?.enemy?.side === "ally" || who?.enemy?.side === "third" ? who.enemy.side : "enemy";
  const army = `team-${side}`;
  const sprite = want !== "sprites" || !sprites ? null : who?.unit ? armySprite(who.unit) : who?.enemy ? spriteOf(who.enemy) : null;
  const layers = sprite && sprites ? spriteLayers(sprites, sprite, sprite.character !== null) : null;
  if (layers && sprites && sprite) {
    return (
      <span className={`unit-face ${army} ${size} sprite`} aria-hidden>
        <svg viewBox="0 0 1 1">
          <UnitSprite index={sprites} layers={layers} side={sprite.side} />
        </svg>
      </span>
    );
  }
  if (want === "sprites") return <MissingGameAsset label={`${name}'s map sprite`} className={`unit-face ${army} ${size}`} />;
  const imported = nav.importedFace?.(id);
  if (imported) return <GameImage imported={imported} className={`unit-face ${army} ${size}`} alt={`${name}'s portrait`} draggable={false} />;
  return <PortraitImage className={`unit-face ${army} ${size}`} bundled={portrait ?? null} alt={`${name}'s portrait`} draggable={false} />;
}

/** The key numbers as a row of small cards on the Overview.
 * `except` leaves some out (the Overview has an Outlook card of its own). */
export function KeyStats({ battle, seconds, except = [], numbers }: { battle: Battle; seconds: number; except?: string[]; numbers?: KeyNumber[] }) {
  return (
    <ul className="stat-cards">
      {(numbers ?? keyNumbers(battle, seconds))
        .filter((n) => !except.includes(n.label))
        .map((n) => (
          <li key={n.label} className={`stat-card${n.tone ? ` ${n.tone}` : ""}${n.teams && n.teams.length > 1 ? " wide" : ""}`} title={n.title}>
            <span className="stat-card-label">{n.label}</span>
            <span className="stat-card-value">
              {n.teams ? (
                <span className="stat-card-teams">
                  {n.teams.map((c) => (
                    <span key={c.team} className="stat-card-team">
                      <TeamTag team={c.team} />
                      {c.now}/{c.of}
                    </span>
                  ))}
                </span>
              ) : (
                n.value
              )}
              {n.suffix && <span className="stat-card-suffix"> {n.suffix}</span>}
            </span>
          </li>
        ))}
    </ul>
  );
}

/** Each weapon, spell, combat art, item and Rally a unit used: how often, and the damage dealt with it. */
export function UsageList({ usage }: { usage: Usage[] }) {
  return (
    <ul className="inventory usage">
      {usage.map((u) => {
        const spent = u.kind === "weapon" || (u.kind === "art" && u.spent) ? `${plural(u.spent, "use")} of durability` : "";
        const title = [plural(u.times, "time"), spent, u.damage ? `${u.damage} damage` : ""].filter(Boolean).join(" · ");
        return (
          <li key={`${u.kind}-${u.id}-${u.name}`} className={`inventory-item ${u.kind}`} title={title}>
            <span className="inventory-icon">
              <GearIcon kind={u.kind} weapon={u.weapon} name={u.name} />
            </span>
            <span className="inventory-name">{u.kind === "art" ? <ArtLink name={u.name} /> : u.name}</span>
            {u.damage > 0 && <span className="muted small">{u.damage} dmg</span>}
            <span className="inventory-uses">×{u.times}</span>
          </li>
        );
      })}
    </ul>
  );
}
