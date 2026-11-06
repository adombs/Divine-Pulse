import { CONCEPT_ICON } from "../icons/concepts";
import { FormEvent, useEffect, useState } from "react";
import { api, Battle, RunSummary, ScanEntry } from "../api";
import { ToastState } from "./Toasts";
import { Icon, IconButton } from "./Icon";
import { ScanLog } from "./ScanLog";
import { useNav } from "../nav";
import { RunIcon } from "./ui";
import { plural } from "../format";
import { MAX_LEN, cleanText, runNameError } from "../validation";
import { DetailCard, EmptyState, Facts, ListRow, MasterDetail, PageHeader, RowList, StatusChip } from "./layout";
import { BattleFacts, BattleKindChip, RunTotals } from "./battle/BattleList";
import { RunTransfer } from "./RunTransfer";
import "./runs.css";

interface Props {
  runs: RunSummary[];
  activeRunId: string | null;
  onActivate: (id: string) => void;
  toasts: ToastState;
  /** This session's updates read from the game (the Updates tab). */
  entries: ScanEntry[];
  onUndo: () => void;
}

type Tab = "runs" | "log";

export function Runs({ runs, activeRunId, onActivate, toasts, entries, onUndo }: Props) {
  const nav = useNav();
  const [name, setName] = useState("");
  const newError = name.trim() ? runNameError(name, runs) : null;
  const current = runs.find((r) => r.id === nav.route.id) ?? runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;
  const active = runs.find((r) => r.id === activeRunId);
  const tab: Tab = nav.route.tab === "log" ? "log" : "runs";
  const toCheck = entries.filter((e) => e.status === "warning").length;
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || newError) return;
    try {
      const run = await api.createRun(cleanText(name));
      setName("");
      toasts.push({ kind: "ok", title: `Created "${run.name}"` });
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't create the run", body: (err as Error).message });
    }
  };

  return (
    <section className="runs-page">
      <PageHeader
        title="Runs"
        status={
          <>
            {active && <span>Active: {active.name}</span>}
            {toCheck > 0 && <StatusChip tone="warn">{toCheck} update{toCheck === 1 ? "" : "s"} to check</StatusChip>}
          </>
        }
        tabs={[
          { id: "runs" as Tab, label: "Runs", count: runs.length },
          { id: "log" as Tab, label: "Updates", count: entries.length },
        ]}
        tab={tab}
        onTab={(t) => nav.go({ page: "runs", tab: t === "log" ? "log" : undefined })}
      />
      {tab === "log" ? (
        <div className="runs-updates">
          <ScanLog entries={entries} runs={runs} onUndo={onUndo} />
        </div>
      ) : (
      <MasterDetail
        detail={current && <RunCard key={current.id} run={current} runs={runs} active={current.id === activeRunId} onActivate={onActivate} toasts={toasts} />}
      >
        <form className="new-run" onSubmit={create}>
          <label htmlFor="new-run-name">New run name</label>
          <div className="runs-create-row">
            <input
              id="new-run-name"
              placeholder="New run name, e.g. Azure Moon – Maddening"
              value={name}
              maxLength={MAX_LEN.runName + 10}
              onChange={(e) => setName(e.target.value)}
              className={newError ? "invalid" : ""}
              aria-invalid={!!newError}
              aria-describedby={newError ? "new-run-error" : undefined}
            />
            <button className="btn primary" type="submit" disabled={!name.trim() || !!newError}>
              Create Run
            </button>
          </div>
          {newError && <p id="new-run-error" className="field-hint error" role="status">{newError}</p>}
          <div className="runs-transfer-actions">
            <button className="btn" type="button" onClick={() => setTransfer("import")}>Import</button>
            <button className="btn" type="button" onClick={() => setTransfer("export")}>Export</button>
          </div>
        </form>
        {transfer && <RunTransfer mode={transfer} runs={runs} toasts={toasts} onClose={() => setTransfer(null)} />}
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">Name your playthrough above and create it. Scans go into the active run.</EmptyState>
        ) : (
          <RowList>
            {runs.map((r) => (
              <ListRow
                key={r.id}
                selected={r.id === current?.id}
                onClick={() => nav.go({ page: "runs", id: r.id })}
                lead={<span className="runs-list-lead"><RunIcon route={r.route} />{r.id === activeRunId && <StatusChip tone="good">Active</StatusChip>}</span>}
                title={r.name}
                facts={
                  <>
                    <span>{plural(r.unit_count, "unit")}</span>
                    <span>updated {new Date(r.updated_at).toLocaleDateString()}</span>
                  </>
                }
              />
            ))}
          </RowList>
        )}
      </MasterDetail>
      )}
    </section>
  );
}

/** The selected run: its facts, its battles, and what can be done with it. */
function RunCard({ run, runs, active, onActivate, toasts }: { run: RunSummary; runs: RunSummary[]; active: boolean; onActivate: (id: string) => void; toasts: ToastState }) {
  const nav = useNav();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [battleError, setBattleError] = useState(false);
  const [battleRetry, setBattleRetry] = useState(0);
  const renameError = renaming !== null ? runNameError(renaming, runs, run) : null;

  useEffect(() => {
    let cancelled = false;
    setBattleError(false);
    api.battles(run.id).then(
      (loaded) => { if (!cancelled) setBattles(loaded); },
      () => { if (!cancelled) setBattleError(true); },
    );
    return () => { cancelled = true; };
  }, [run.id, run.updated_at, battleRetry]);

  const fail = (title: string) => (e: unknown) => toasts.push({ kind: "error", title, body: (e as Error).message });

  const saveRename = async (e: FormEvent) => {
    e.preventDefault();
    if (renaming === null || renameError) return;
    try {
      await api.renameRun(run.id, cleanText(renaming));
      setRenaming(null);
    } catch (err) {
      fail("Couldn't rename the run")(err);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete run "${run.name}" and its ${run.unit_count} units?\n\nThe file is moved to data/runs/deleted/, not erased.`)) return;
    try {
      await api.deleteRun(run.id);
      toasts.push({ kind: "info", title: `Deleted "${run.name}"` });
    } catch (err) {
      fail("Couldn't delete the run")(err);
    }
  };

  const latest = battles?.slice(0, 3) ?? [];
  return (
    <DetailCard
      title={run.name}
      icon={<RunIcon route={run.route} />}
      label={`${run.name} run`}
      actions={
        <>
          {!active && <IconButton icon={CONCEPT_ICON.done} label="Make active" onClick={() => onActivate(run.id)} primary />}
          <IconButton icon={CONCEPT_ICON.edit} label="Rename" onClick={() => setRenaming(run.name)} />
          <IconButton icon={CONCEPT_ICON.delete} label="Delete" onClick={remove} className="danger" />
        </>
      }
    >
      <Facts
        rows={[
          ["Status", active ? <StatusChip tone="good">Active</StatusChip> : "Not active"],
          ["Units", run.unit_count],
          ["Updated", <span key="u" title={`Created ${new Date(run.created_at).toLocaleString()}`}>{new Date(run.updated_at).toLocaleString()}</span>],
          ["File", <code key="file">{run.id}.json</code>],
        ]}
      />
      {renaming !== null ? (
        <form className="rename" onSubmit={saveRename}>
          <input
            autoFocus
            value={renaming}
            maxLength={MAX_LEN.runName + 10}
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
            className={renameError ? "invalid" : ""}
            aria-invalid={!!renameError}
            aria-label="Run name"
          />
          <button className="btn small primary" type="submit" disabled={!!renameError}>
            Save
          </button>
          <button className="btn small" type="button" onClick={() => setRenaming(null)}>
            Cancel
          </button>
          {renameError && <span className="field-hint error">{renameError}</span>}
        </form>
      ) : null}
      <section className="block runs-battle-overview">
        <div className="sec-head"><h2>Battles</h2></div>
        {battleError ? (
          <div className="runs-battle-error" role="status">
            <p>Couldn't load this run's battles.</p>
            <button type="button" className="btn small" onClick={() => setBattleRetry((n) => n + 1)}>Try again</button>
          </div>
        ) : battles === null ? (
          <p className="muted">Loading…</p>
        ) : battles.length === 0 ? (
          <p className="muted">No battles recorded in this run. They're recorded while reading game memory with auto mode on.</p>
        ) : (
          <>
            <RunTotals battles={battles} />
            <ul className="run-battles">
              {latest.map((b) => (
                <li key={b.id}>
                  <div className="runs-battle-heading">
                    <BattleKindChip battle={b} />
                    <time dateTime={b.started_at}>{new Date(b.started_at).toLocaleDateString()}</time>
                  </div>
                  <span className="list-row-facts">
                    <BattleFacts battle={b} />
                  </span>
                </li>
              ))}
            </ul>
            {active ? (
              <div className="link-row">
                <button type="button" className="link-btn more-btn" onClick={() => nav.go({ page: "history" })}>
                  {battles.length > latest.length ? `View all ${battles.length} battles in History` : "View battles in History"} <Icon name={CONCEPT_ICON.go} />
                </button>
              </div>
            ) : (
              <p className="muted small">Make this run active to open its battles and stats in History.</p>
            )}
          </>
        )}
      </section>
    </DetailCard>
  );
}
