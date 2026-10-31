/** A battle's type mark and facts, and a run's battle totals. */
import type { Battle } from "../../api";
import { Tile, Tiles } from "../layout";
import { clock, plural } from "../../format";
import { battleName, KIND_LABEL } from "./scenarios";
import "./battle.css";

/** The scenario type, coloured consistently wherever a battle is named. */
export function BattleKindChip({ battle }: { battle: Battle }) {
  const kind = battleName(battle).kind;
  return <span className={`battle-kind-chip ${kind ?? "unknown"}`}>{kind ? KIND_LABEL[kind] : "Battle"}</span>;
}

/** A finished battle in one line: time, turns, units, defeats, growth. */
export function BattleFacts({ battle: b }: { battle: Battle }) {
  return (
    <>
      <span>{clock(b.seconds)}</span>
      {b.turn !== null && <span>{plural(b.turn, "turn")}</span>}
      <span>{plural(b.units.length, "unit")}</span>
      {b.enemies_defeated !== null && <span>{b.enemies_defeated} killed</span>}
      <span>{plural(b.level_ups, "level-up")}</span>
      {b.divine_pulses > 0 && <span>{plural(b.divine_pulses, "Divine Pulse")}</span>}
    </>
  );
}

/** Totals over a run's finished battles. */
export function RunTotals({ battles }: { battles: Battle[] }) {
  const time = battles.reduce((n, b) => n + b.seconds, 0);
  return (
    <Tiles>
      <Tile label="Battles" value={battles.length} note="recorded in this run" />
      <Tile label="Time" value={clock(time)} note={`${clock(time / battles.length)} on average`} />
      <Tile label="Level-ups" value={battles.reduce((n, b) => n + b.level_ups, 0)} note={`+${battles.reduce((n, b) => n + b.stat_points, 0)} stat points`} />
      <Tile label="Divine Pulse" value={battles.reduce((n, b) => n + b.divine_pulses, 0)} note="times used" />
    </Tiles>
  );
}
