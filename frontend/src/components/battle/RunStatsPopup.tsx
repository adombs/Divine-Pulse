/** Run scope, independent of a selected recording or character. */
import { useCallback, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Battle } from "../../api";
import { clock } from "../../format";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { SpriteFigure } from "../character/CharacterFace";
import { KIND_LABEL } from "./scenarios";
import { buildRunLedger, selectLedgerRows, type LedgerKind, type LedgerPart, type LedgerSort } from "./runStatsLedger";
import "./run-stats.css";
import "./battle-kinds.css";

interface Props { kind: LedgerKind | null; onClose: () => void; battles: Battle[] | null; error: boolean; onRetry: () => void }
const TOPICS: { key: LedgerPart; label: string; icon: "attack" | "growth" | "history" }[] = [
  { key: "combat", label: "Combat", icon: "attack" }, { key: "growth", label: "Growth & Supplies", icon: "growth" }, { key: "records", label: "Records", icon: "history" },
];
const numberFormat = new Intl.NumberFormat();
const unknown = (reason = "Not fully recorded") => <span className="run-stats-unknown" title={reason} aria-label={reason}>—</span>;

export function RunStatsPopup({ kind, onClose, battles, error, onRetry }: Props) {
  const focus = useCallback((node: HTMLDivElement | null) => { node?.closest<HTMLElement>("[role=dialog]")?.focus(); }, []);
  return <Modal open={kind !== null} onClose={onClose} title={kind === "characters" ? "Character Stats" : "Battle Stats"}
    icon={<Icon name={kind === "characters" ? CONCEPT_ICON.characters : CONCEPT_ICON.battle} />} wide className="run-stats-popup">
    <div className="run-stats-content" ref={focus}>{error ? <div className="run-stats-state" role="alert">
      <Icon name={CONCEPT_ICON.warning} /><h3>Battle history could not be loaded</h3><p>Try loading this run again to see its statistics.</p>
      <button type="button" className="btn" onClick={onRetry}>Try again</button></div>
      : battles === null ? <div className="run-stats-loading" role="status" aria-busy="true"><span>Loading run statistics…</span><div aria-hidden="true"><i /><i /><i /></div></div>
      : kind && <RunLedger key={kind} kind={kind} battles={battles} />}</div>
  </Modal>;
}

function RunLedger({ kind, battles: source }: { kind: LedgerKind; battles: Battle[] }) {
  const [query, setQuery] = useState("");
  const [part, setPart] = useState<LedgerPart>("combat");
  const [sort, setSort] = useState<LedgerSort | null>(null);
  const [recordGroup, setRecordGroup] = useState("");
  const id = useId();
  const data = useMemo(() => buildRunLedger(source, kind), [source, kind]);
  const { battles, run, rows, sums } = data;
  const topics = kind === "characters" ? TOPICS : TOPICS.slice(0, 2);
  const groups = [...new Set(data.columns.records.map((column) => column.group!))];
  const columns = data.columns[part].map((column, index) => ({ ...column, index })).filter((column) => part !== "records" || !recordGroup || column.group === recordGroup);
  const shown = selectLedgerRows(rows, part, query, sort);
  const topic = TOPICS.find((t) => t.key === part)!;
  const figures = [{ label: "Damage dealt", sum: sums.dealt, icon: CONCEPT_ICON.attack },
    { label: "Damage taken", sum: sums.taken, icon: CONCEPT_ICON.danger }, { label: "Healing given", sum: sums.healing, icon: CONCEPT_ICON.heal }, { label: "Divine Pulses", sum: { value: data.pulses }, icon: CONCEPT_ICON.pulse }];
  const selectTopic = (next: LedgerPart) => { setPart(next); setSort(null); };
  const navigateTopics = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? topics.length - 1 : event.key === "ArrowRight" ? (index + 1) % topics.length
      : event.key === "ArrowLeft" ? (index + topics.length - 1) % topics.length : null;
    if (next === null) return;
    event.preventDefault(); selectTopic(topics[next].key);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  const toggleSort = (column: number) => setSort((old) => ({ column,
    direction: old?.column === column ? old.direction === "descending" ? "ascending" : "descending" : column < 0 ? "ascending" : "descending" }));
  const sortIcon = (column: number) => <Icon name={sort?.column === column && sort.direction === "ascending" ? CONCEPT_ICON.up : CONCEPT_ICON.down} />;
  const formatValue = (value: number | null, key: string) => value === null ? unknown(key === "score" ? "Scores are averages, so they aren't added up" : undefined) : key === "seconds" ? clock(value) : numberFormat.format(value);
  // Each column scales to its own maximum; time columns and all-zero columns get no bars.
  const maxes = useMemo(() => data.columns[part].map((column, index) => column.key === "seconds" ? 0 : rows.reduce((max, row) => Math.max(max, row.values[part][index] ?? 0), 0)), [data.columns, rows, part]);
  return <div className="run-stats-ledger">
    <header className="run-stats-overview"><div className="run-stats-scope"><h3>Entire run</h3>
      <span className="run-stats-duration"><b>{clock(run.seconds)}</b> in battle</span></div>
      <dl className="run-stats-totals">{figures.map(({ label, sum, icon }) => <div key={label}><dt><Icon name={icon} />{label}</dt><dd>{sum.value === null ? unknown() : numberFormat.format(sum.value)}</dd></div>)}</dl>
    </header>
    {!battles.length ? <div className="run-stats-state"><Icon name={CONCEPT_ICON.history} /><h3>No recorded battles yet</h3><p>Record a battle in this run to see totals and comparisons here.</p></div> : <>
      <div className="run-stats-toolbar"><div className="run-stats-topics" role="tablist" aria-label="Statistics topic">{topics.map((t, index) => <button
        type="button" key={t.key} id={`${id}-${t.key}`} role="tab" aria-selected={part === t.key} aria-controls={`${id}-panel`} tabIndex={part === t.key ? 0 : -1}
        onClick={() => selectTopic(t.key)} onKeyDown={(event) => navigateTopics(event, index)}><Icon name={t.icon} />{t.label}</button>)}</div>
        <label className="run-stats-search"><span className="sr-only">Search {kind}</span><Icon name={CONCEPT_ICON.search} /><input type="search" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder={kind === "battles" ? "Search battle or date" : "Search name or class"} /></label></div>
      <section className="run-stats-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${part}`}>
        {part === "records" && <label className="run-stats-record-filter">Record group<select value={recordGroup} onChange={(event) => { setRecordGroup(event.target.value); setSort(null); }}>
          <option value="">All records</option>{groups.map((group) => <option key={group}>{group}</option>)}</select></label>}
        <div className={`run-stats-table-scroll${part === "records" ? " run-records-scroll" : ""}`} tabIndex={0} role="region" aria-label={`${kind === "battles" ? "Battle" : "Character"} breakdown, scroll for more rows and columns`}>
          <table className="run-stats-table"><caption className="sr-only">Entire run {kind} · {topic.label}. Totals include every record, including search results hidden from view.</caption>
            <thead><tr><th scope="col" aria-sort={sort?.column === -1 ? sort.direction : "none"} className={sort?.column === -1 ? "is-sorted" : undefined}><button type="button" onClick={() => toggleSort(-1)}>{kind === "battles" ? "Battle" : "Character"}{sortIcon(-1)}</button></th>
              {columns.map((column) => <th scope="col" key={column.key} title={column.hint} aria-sort={sort?.column === column.index ? sort.direction : "none"} className={sort?.column === column.index ? "is-sorted" : undefined}>
                <button type="button" onClick={() => toggleSort(column.index)}>{column.label}{sortIcon(column.index)}</button></th>)}</tr></thead>
            <tbody>{shown.map((row) => <tr key={row.id} className={kind === "battles" ? `run-stats-battle battle-kind-${row.kind ?? "unknown"}` : undefined}><th scope="row" title={row.kind ? KIND_LABEL[row.kind] : undefined}>
              <span className="run-stats-identity">{kind === "characters" && <span className="run-stats-sprite"><SpriteFigure sprite={row.sprite ?? null} size={36} /></span>}
                <span className="run-stats-name">{row.name}{row.live && <em>Live</em>}<small className="run-stats-row-meta"><span>{row.note}</span>
                  {kind === "battles" && row.kind && <span className="run-stats-kind">{KIND_LABEL[row.kind]}</span>}</small></span></span></th>
              {columns.map((column) => { const value = row.values[part][column.index]; const active = sort?.column === column.index;
                return <td key={column.key} className={active ? "is-sorted" : undefined}>{value !== null && value > 0 && maxes[column.index] > 0 && <span className="run-stats-cell-bar" style={{ width: `${value / maxes[column.index] * 100}%` }} aria-hidden="true" />}
                  <span className="run-stats-cell-value">{formatValue(value, column.key)}</span></td>;
              })}</tr>)}</tbody>
            <tfoot><tr><th scope="row">Run total</th>{columns.map((column) => <td key={column.key} className={sort?.column === column.index ? "is-sorted" : undefined}>{formatValue(data.totals[part][column.index], column.key)}</td>)}</tr></tfoot>
          </table>{!shown.length && <div className="run-stats-no-matches" role="status"><Icon name={CONCEPT_ICON.search} /><strong>No {kind} match this search</strong><button type="button" className="btn small" onClick={() => setQuery("")}>Clear search</button></div>}
        </div>
      </section>
    </>}
  </div>;
}
