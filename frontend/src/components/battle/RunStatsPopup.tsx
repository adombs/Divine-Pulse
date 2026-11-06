/** Run scope, with no dependency on a selected recording or character. */
import { useCallback, useMemo, useState } from "react";
import type { Battle } from "../../api";
import { clock, plural } from "../../format";
import { Modal } from "../Modal";
import { armyTotals, recordedSum, statGains } from "./model";
import { battleName } from "./scenarios";
import { characterStats, runBattles, runStats, timelines } from "./stats";
import "./run-stats.css";

type Kind = "battles" | "characters";
interface Props {
  kind: Kind | null;
  onClose: () => void;
  battles: Battle[] | null;
  error: boolean;
  onRetry: () => void;
}

export function RunStatsPopup({ kind, onClose, battles, error, onRetry }: Props) {
  // Modal mounts its animated panel after open changes. Focus when the content actually mounts.
  const focus = useCallback((node: HTMLDivElement | null) => {
    node?.closest<HTMLElement>("[role=dialog]")?.focus();
  }, []);
  return <Modal open={kind !== null} onClose={onClose} title={kind === "characters" ? "Run Character Statistics" : "Run Battle Statistics"} wide className="run-stats-popup">
    <div className="run-stats-content" ref={focus}>{error ? <div className="run-stats-state" role="alert"><h3>Battle history could not be loaded</h3><p>Try loading this run again to see its statistics.</p><button type="button" className="btn" onClick={onRetry}>Try again</button></div>
      : battles === null ? <p className="run-stats-state" role="status">Loading run statistics…</p>
      : kind && <RunLedger key={kind} kind={kind} battles={battles} />}</div>
  </Modal>;
}

function RunLedger({ kind, battles: source }: { kind: Kind; battles: Battle[] }) {
  const [query, setQuery] = useState("");
  const [part, setPart] = useState<"combat" | "growth">("combat");
  const { battles, characters, run } = useMemo(() => {
    const battles = runBattles(source);
    const items = timelines(battles);
    const characters = characterStats(battles, items);
    return { battles, characters, run: runStats(battles, characters, items) };
  }, [source]);
  const live = battles.filter((b) => b.active).length;
  const figures: [string, number | string | null][] = [
    ["Battles", run.battles], ["Characters", run.characters], ["Time in battle", clock(run.seconds)],
    ["Damage dealt", run.damage_dealt], ["Damage taken", run.damage_taken], ["Healing given", run.healing],
  ];
  const rows = kind === "battles" ? battles.map((b) => {
    const t = armyTotals(b);
    return { id: b.id, name: battleName(b).title, note: `${new Date(b.started_at).toLocaleDateString()}${b.active ? " · Live" : ""}`,
      combat: [clock(b.seconds), b.turn, t.fights, t.defeats, t.dealt, t.taken, t.healing, t.tiles],
      growth: [b.units.reduce((n, u) => n + u.level_ups, 0), b.units.reduce((n, u) => n + statGains(u), 0), b.weapon_uses, b.spells_cast, b.item_uses, b.divine_pulses],
    };
  }) : characters.map((c) => ({ id: c.key, name: c.name, note: `${c.class_name} · Lv ${c.level}`,
    combat: [c.battles, c.fights, c.defeats, c.damage_dealt, c.damage_taken, c.healing_given, c.healed, c.tiles_moved],
    growth: [c.level_ups, c.stat_points, c.weapon_uses, c.spells_cast, c.item_uses, c.mvp],
  }));
  const columns = part === "combat" ? kind === "battles"
    ? ["Time", "Turns", "Fights", "Kills", "Dealt", "Taken", "Healing", "Tiles"]
    : ["Battles", "Fights", "Kills", "Dealt", "Taken", "Healing", "Received", "Tiles"]
    : ["Level-ups", "Stat increases", "Weapon attacks", "Spells", "Items", kind === "battles" ? "Divine Pulse" : "MVP battles"];
  const totals = part === "growth" ? [run.level_ups, run.stat_points, run.weapon_uses, run.spells_cast, run.item_uses, kind === "battles" ? run.divine_pulses : characters.reduce((n, c) => n + c.mvp, 0)]
    : kind === "battles" ? [clock(run.seconds), run.turns, run.fights, run.defeats, run.damage_dealt, run.damage_taken, run.healing, run.tiles_moved]
    : [characters.reduce((n, c) => n + c.battles, 0), run.fights, run.defeats, run.damage_dealt, run.damage_taken, run.healing, recordedSum(characters.map((c) => c.healed)), run.tiles_moved];
  const words = query.toLocaleLowerCase().trim().split(/\s+/);
  const shown = rows.filter((r) => words.every((w) => `${r.name} ${r.note}`.toLocaleLowerCase().includes(w)));
  return <div className="run-stats-ledger">
    <p className="run-stats-scope"><strong>Entire run</strong><span>{plural(battles.length - live, "finished battle")}{live ? ` + ${plural(live, "live battle")}` : ""}</span></p>
    {!battles.length ? <div className="run-stats-state"><h3>No recorded battles yet</h3><p>Record a battle in this run to see totals and comparisons here.</p></div> : <>
      <dl className="run-stats-totals">{figures.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? <span title="Not fully recorded">—</span>}</dd></div>)}</dl>
      <div className="run-stats-toolbar">
        <div className="segmented" role="group" aria-label="Statistics topic"><button type="button" aria-pressed={part === "combat"} className={part === "combat" ? "on" : ""} onClick={() => setPart("combat")}>Combat & movement</button><button type="button" aria-pressed={part === "growth"} className={part === "growth" ? "on" : ""} onClick={() => setPart("growth")}>Growth & supplies</button></div>
        <label className="run-stats-search">Search {kind}<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "battles" ? "Battle or date" : "Name or class"} /></label>
      </div>
      <div className="run-stats-table-scroll" tabIndex={0} role="region" aria-label={`${kind === "battles" ? "Battle" : "Character"} breakdown, scroll for more rows`}>
        <table className="run-stats-table">
          <caption className="sr-only">Entire run {kind} · {part === "combat" ? "Combat and movement" : "Growth and supplies"}. Totals include every record, including search results hidden from view.</caption>
          <thead><tr><th scope="col">{kind === "battles" ? "Battle" : "Character"}</th>{columns.map((c) => <th key={c} scope="col" title={c === "Fights" ? "Each character’s participation, from battle counters when read, otherwise recorded actions" : c === "MVP battles" ? "Finished battles with the most kills; ties count for each character" : c === "Battles" ? "Battles this character appeared in; the total counts all character appearances" : undefined}>{c}</th>)}</tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id}><th scope="row"><span>{r.name}</span><small>{r.note}</small></th>{r[part].map((v, i) => <td key={columns[i]}>{v ?? <span title="Not fully recorded">—</span>}</td>)}</tr>)}</tbody>
          <tfoot><tr><th scope="row">Run total</th>{totals.map((v, i) => <td key={columns[i]}>{v ?? <span title="Not fully recorded">—</span>}</td>)}</tr></tfoot>
        </table>
        {!shown.length && <p className="run-stats-state">No {kind} match this search. <button type="button" className="btn small" onClick={() => setQuery("")}>Clear search</button></p>}
      </div>
    </>}
  </div>;
}
