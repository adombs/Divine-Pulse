/**
 * One of your characters over the run's finished battles: the card History's characters and the records carousels
 * open in the character popup ("stats" context). The hero (face and key facts) stays put; the sections along the
 * popup's bottom bar switch below it: Combat (totals beside per-battle averages), Form (battle by battle), Growth,
 * Arsenal (what they used) and Battles (each one, to open).
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { CSSProperties, ReactNode } from "react";
import type { ValueKey } from "../../api";
import { STAT_LABEL, STAT_ORDER } from "./model";
import { clock, plural } from "../../format";
import { DetailCard, Section } from "../layout";
import { ClassLink } from "../Links";
import { CharacterHero } from "../character/CharacterHero";
import { useReference } from "../../reference/types";
import { IconButton } from "../Icon";
import { BattleKindChip } from "./BattleList";
import { battleName } from "./scenarios";
import { Num, UsageList } from "./parts";
import type { CharacterStats } from "./stats";
import "./run-card.css";
import "../character/panels.css";

interface Props {
  stats: CharacterStats;
  /** The face beside the facts (a roster portrait, or the battle's face for the unit). */
  face: ReactNode;
  /** Class shown by the face, when the current unit is available. */
  className?: string;
  icon?: ReactNode;
  /** Open one of their battles (at this character). */
  onOpen: (battleId: string, key?: string) => void;
  /** Open the run's unit on the Roster. */
  onRoster?: () => void;
  /** Opened from a battle: show the character as they were in it instead. */
  onThisBattle?: () => void;
}

const avg = (total: number | null, n: number) => (total === null ? null : n ? Math.round((10 * total) / n) / 10 : 0);

export function RunCharacterCard({ stats: c, face, className, icon, onOpen, onRoster, onThisBattle }: Props) {
  const ref = useReference();
  const character = ref?.characters.find((person) => person.name === c.name || person.full_name === c.name);
  const level = c.first_level !== c.level ? `${c.first_level} → ${c.level}` : String(c.level);
  const actions = (onRoster || onThisBattle) && (
    <>
      {onThisBattle && <IconButton icon={CONCEPT_ICON.battle} label="This battle" onClick={onThisBattle} />}
      {onRoster && <IconButton icon={CONCEPT_ICON.roster} label="Open in the Roster" onClick={onRoster} />}
    </>
  );
  return (
    <DetailCard title={c.name} scope="stats" icon={icon} label={`${c.name} over this run's battles`} actions={actions}>
      <CharacterHero key={c.key} name={c.name} layout="flip" scope="stats" face={face} facts={[
        ["Class", (className || c.class_name) ? <ClassLink name={className || c.class_name} /> : "—"],
        ["Level", level],
        ["Battles", c.battles],
        ["In battle", clock(c.seconds)],
        [<span title="Battles in which they killed the most">Top unit</span>, c.mvp, "top"],
        [<span title="Battles they ended off the map (fell or retreated)">Fell</span>, c.left || "never", "fell"],
      ]} backFacts={[
        ["Gender", character?.gender || "—"],
        ["Affiliation", character?.house || "—"],
        ["Birthday", character?.birthday || "—"],
        ["Height", character?.height || "—"],
      ]} />
      <Section title="Combat" icon={CONCEPT_ICON.attack}>
        <CombatLedger c={c} />
      </Section>
      <Section title="Form" icon={CONCEPT_ICON.turn}>
        <FormChart c={c} onOpen={onOpen} />
      </Section>
      <Section title="Growth" icon={CONCEPT_ICON.growth}>
        <GrowthBars c={c} />
      </Section>
      <Section title="Arsenal" icon={CONCEPT_ICON.equipment}>
        <Arsenal c={c} />
      </Section>
      <Section title="Battles" icon={CONCEPT_ICON.log}>
        <BattleRows c={c} onOpen={onOpen} />
      </Section>
    </DetailCard>
  );
}

/** Totals and the average per battle side by side, one row per measure. */
function CombatLedger({ c }: { c: CharacterStats }) {
  const rows: [string, number | null, string][] = [
    ["Fights", c.fights, "fights they were in"],
    ["Kills", c.defeats, "units they killed"],
    ["Damage dealt", c.damage_dealt, "damage to other units"],
    ["Damage taken", c.damage_taken, "damage from other units"],
    ["Healing given", c.healing_given, "HP restored to others"],
    ["Healing received", c.healed, "HP restored to them"],
    ["Tiles moved", c.tiles_moved, "tiles walked or flown"],
  ];
  const perFight = c.fights && c.damage_dealt !== null ? Math.round((10 * c.damage_dealt) / c.fights) / 10 : null;
  return (
    <div className="rc-combat">
      <table className="rc-ledger">
        <thead>
          <tr>
            <th scope="col" className="left"><span className="sr-only">Measure</span></th>
            <th scope="col">Run total</th>
            <th scope="col">Per battle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value, title]) => (
            <tr key={label} title={title}>
              <th scope="row" className="left">{label}</th>
              <td><Num value={value} /></td>
              <td className="soft"><Num value={avg(value, c.battles)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {perFight !== null && (
        <p className="rc-note">
          <b>{perFight}</b> damage per fight on average{c.defeats && c.fights !== null ? <> · a kill every <b>{Math.round((10 * c.fights) / c.defeats) / 10}</b> fights</> : null}
        </p>
      )}
    </div>
  );
}

/** The most battles the Form chart shows (the latest ones). */
const FORM_MAX = 40;

/** Battle by battle, oldest first: damage dealt as columns (kills marked), and the battles they fell in. */
function FormChart({ c, onOpen }: { c: CharacterStats; onOpen: (battleId: string, key?: string) => void }) {
  const runs = c.appearances.slice(0, FORM_MAX).reverse();
  // Kill counts as numbers while there's room for them; a dot each when the columns get narrow.
  const dense = runs.length > 18;
  const value = (a: CharacterStats["appearances"][number]) => a.unit.damage_dealt ?? 0;
  const max = Math.max(1, ...runs.map(value));
  const tracked = runs.some((a) => a.unit.damage_dealt !== null);
  if (!runs.length) return <p className="muted">No finished battles yet.</p>;
  return (
    <figure className="rc-form">
      <figcaption className="rc-form-key">
        <span className="rc-key dealt">Damage dealt</span>
        <span className="rc-key kill">Kills</span>
        <span className="rc-key fell">Fell</span>
        <span className="rc-form-max">{c.appearances.length > runs.length ? `latest ${runs.length} of ${c.appearances.length} · ` : ""}peak {max}</span>
      </figcaption>
      <div className={`rc-form-plot${dense ? " dense" : ""}`} style={{ ["--n" as string]: runs.length } as CSSProperties}>
        {runs.map((a, i) => {
          const name = battleName(a.battle).title;
          const kills = a.defeats ?? 0;
          const fell = !a.unit.on_map;
          const label = `${name}: ${tracked ? `${value(a)} damage, ` : ""}${plural(kills, "kill")}${fell ? ", fell" : ""}. Open the battle`;
          return (
            <button key={a.battle.id} type="button" className={`rc-col${fell ? " fell" : ""}${a.mvp ? " top" : ""}`} title={label} aria-label={label}
              onClick={() => onOpen(a.battle.id, c.key)} style={{ ["--i" as string]: i } as CSSProperties}>
              <span className="rc-col-bar" style={{ height: `${(100 * value(a)) / max}%` }} />
              {kills > 0 && <span className="rc-col-kills" aria-hidden="true">{dense ? "" : kills}</span>}
            </button>
          );
        })}
      </div>
      <p className="rc-note">Oldest battle on the left. Select a column to open that battle.</p>
    </figure>
  );
}

/** What the battles added to each stat, as bars on one scale, and the levels gained. */
function GrowthBars({ c }: { c: CharacterStats }) {
  const keys = STAT_ORDER.filter((k) => c.gains[k as ValueKey]);
  const max = Math.max(1, ...keys.map((k) => Math.abs(c.gains[k as ValueKey] ?? 0)));
  return (
    <div className="rc-growth">
      <dl className="panel-ledger">
        <div><dt>Level</dt><dd>{c.first_level !== c.level ? `${c.first_level} → ${c.level}` : c.level}</dd></div>
        <div><dt>Level-ups in battle</dt><dd>{c.level_ups}</dd></div>
        <div><dt>Stat points</dt><dd>+{c.stat_points}</dd></div>
      </dl>
      {keys.length ? (
        <ul className="rc-gains" aria-label="Stat gains in battle">
          {keys.map((k, i) => {
            const v = c.gains[k as ValueKey] ?? 0;
            return (
              <li key={k} className={v < 0 ? "down" : ""} style={{ ["--i" as string]: i } as CSSProperties}>
                <span className="rc-gain-label">{STAT_LABEL[k]}</span>
                <span className="rc-gain-track"><span style={{ width: `${(100 * Math.abs(v)) / max}%` }} /></span>
                <span className="rc-gain-value">{v > 0 ? "+" : ""}{v}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No stat gains in battle yet.</p>
      )}
    </div>
  );
}

function Arsenal({ c }: { c: CharacterStats }) {
  const spent: [string, number][] = [
    ["Weapon attacks", c.weapon_uses],
    ["Spells cast", c.spells_cast],
    ["Items used", c.item_uses],
  ];
  return (
    <div className="rc-arsenal">
      <dl className="panel-ledger">
        {spent.map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}
      </dl>
      {c.usage.length > 0 ? <div className="rc-usage-ledger">
        <div className="rc-usage-head" aria-hidden="true"><span>Recorded use</span><span>Damage</span><span>Uses</span></div>
        <UsageList usage={c.usage} />
      </div> : <p className="muted">No weapons or arts recorded from the game's history yet.</p>}
    </div>
  );
}

function BattleRows({ c, onOpen }: { c: CharacterStats; onOpen: (battleId: string, key?: string) => void }) {
  return (
    <ul className="rc-battles">
      {c.appearances.map((a) => (
        <li key={a.battle.id}>
          <button type="button" className="rc-battle" onClick={() => onOpen(a.battle.id, c.key)}>
            <span className="rc-battle-kind"><BattleKindChip battle={a.battle} /></span>
            <span className="rc-battle-main">
              <span className="rc-battle-name">{battleName(a.battle).title}</span>
              <span className="rc-battle-facts">
                <span>{new Date(a.battle.started_at).toLocaleDateString()}</span>
                <span>Lv {a.unit.level_ups ? `${a.unit.start_level}→${a.unit.level}` : a.unit.level}</span>
                <span>{a.fights === null ? "Fights —" : plural(a.fights, "fight")}</span>
                {a.defeats !== null && <span>{plural(a.defeats, "kill")}</span>}
                {a.unit.damage_dealt !== null && <span>{a.unit.damage_dealt} dealt</span>}
              </span>
            </span>
            <span className="rc-battle-flags">
              {a.mvp && <span className="rc-flag top" title="Most kills in the battle">Top</span>}
              {!a.unit.on_map && <span className="rc-flag fell">Fell</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
