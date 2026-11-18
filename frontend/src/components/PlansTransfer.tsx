/**
 * Runs → Import/Export → Plans: the Planner's plans moved from one run to another as a file, all of them or the
 * characters picked. A plan follows its character (planTransfer.ts): onto that character's unit, or kept for them
 * until they join.
 */
import { useEffect, useRef, useState } from "react";
import { api, type RunSummary, type UnitPlan } from "../api";
import { planTargets, plansFile, readPlansFile, runPlanEntries, type PlanEntry, type PlanTarget, type RunPlanEntry } from "../planTransfer";
import { characterKeyOfUnit } from "../portraits";
import type { Unit } from "../api";
import { forgetSavedPlans } from "./planner/Planner";
import { Modal } from "./Modal";
import type { ToastState } from "./Toasts";

type WebviewApi = { save_export?: (filename: string, jsonContent: string) => Promise<boolean> };
const keyOf = (u: { key: string; name: string }) => characterKeyOfUnit(u as Unit);
const plansWord = (n: number) => `${n} plan${n === 1 ? "" : "s"}`;

/** A run's units and the plans it keeps for characters not on its roster. */
const loadRun = (runId: string) => Promise.all([api.units(runId), api.plans(runId).then((r) => r.plans)]);

export function PlansTransfer({ mode, runs, toasts, onClose, onBack, runId: initialRunId }: {
  mode: "import" | "export";
  runs: RunSummary[];
  toasts: ToastState;
  onClose: () => void;
  /** Back to choosing what to move (absent: the dialog was opened on plans). */
  onBack?: () => void;
  runId?: string;
}) {
  const [runId, setRunId] = useState(initialRunId ?? runs[0]?.id ?? "");
  /** Export: the run's plans. Import: where the file's plans would go in the chosen run. */
  const [rows, setRows] = useState<(RunPlanEntry | PlanTarget)[] | null>(null);
  const [fromFile, setFromFile] = useState<{ name: string; entries: PlanEntry[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = runs.find((r) => r.id === runId);

  useEffect(() => {
    if (!runId || (mode === "import" && !fromFile)) { setRows(null); return; }
    let live = true;
    setLoading(true);
    loadRun(runId).then(([units, offRoster]) => {
      if (!live) return;
      const next = mode === "export" ? runPlanEntries(units, offRoster, keyOf) : planTargets(fromFile!.entries, units, offRoster, keyOf);
      setRows(next);
      setSelected(new Set(next.map((e) => e.key)));
    }, (error: Error) => { if (live) { setRows(null); toasts.push({ kind: "error", title: "Couldn't load the run's plans", body: error.message }); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, runId, fromFile]);

  const readFile = async (chosen?: File) => {
    if (!chosen) return;
    try {
      setFromFile({ name: chosen.name, entries: readPlansFile(JSON.parse(await chosen.text())) });
    } catch (error) {
      toasts.push({ kind: "error", title: "Couldn't import plans", body: error instanceof SyntaxError ? "The file isn't JSON." : (error as Error).message });
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const chosen = (rows ?? []).filter((r) => selected.has(r.key));

  const exportPlans = async () => {
    if (!run || !chosen.length) return;
    setWorking(true);
    const nativeApi = (window as Window & { pywebview?: { api?: WebviewApi } }).pywebview?.api;
    try {
      if (!nativeApi?.save_export) throw new Error("The desktop save dialog is unavailable.");
      const filename = `${run.name.replace(/[^\w -]+/g, "").trim() || run.id} plans.json`;
      if (await nativeApi.save_export(filename, JSON.stringify(plansFile(run.name, chosen), null, 2))) onClose();
    } catch (error) {
      toasts.push({ kind: "error", title: "Couldn't export plans", body: (error as Error).message });
    } finally {
      setWorking(false);
    }
  };

  const importPlans = async () => {
    if (!run || !chosen.length) return;
    setWorking(true);
    let done = 0;
    try {
      for (const target of chosen as PlanTarget[]) {
        const plan: UnitPlan = target.plan;
        if (target.unitKey) await api.setUnitPlan(runId, target.unitKey, plan);
        else await api.setPlan(runId, target.key, plan);
        done++;
      }
      toasts.push({ kind: "ok", title: `Imported ${plansWord(done)} into "${run.name}"` });
      onClose();
    } catch (error) {
      toasts.push({ kind: "error", title: done ? `Imported ${plansWord(done)} of ${chosen.length}` : "Couldn't import plans", body: (error as Error).message });
    } finally {
      forgetSavedPlans(runId);
      setWorking(false);
    }
  };

  const toggle = (key: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const all = !!rows?.length && selected.size === rows.length;
  const note = (row: RunPlanEntry | PlanTarget) => {
    if (mode === "export") return row.unitKey ? null : "not on the roster yet";
    const target = row as PlanTarget;
    return [target.replaces && "replaces its plan", !target.unitKey && "kept until they join"].filter(Boolean).join(", ") || null;
  };

  return (
    <Modal open onClose={() => { if (!working) onClose(); }} title={`${mode === "import" ? "Import" : "Export"} plans`} className="run-transfer-modal">
      <label>{mode === "import" ? "Import into run" : "Run"}
        <select disabled={working} value={runId} onChange={(e) => setRunId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      </label>
      {mode === "import" && (
        <div className="run-transfer-file-row">
          <input tabIndex={-1} ref={file} className="run-transfer-file" type="file" accept="application/json,.json" aria-label="Choose a plans file" onChange={(e) => void readFile(e.currentTarget.files?.[0])} />
          <button type="button" className={`btn${fromFile ? "" : " primary"}`} disabled={working} onClick={() => file.current?.click()}>{fromFile ? "Choose another file" : "Choose file"}</button>
          {fromFile && <span className="muted small" title={fromFile.name}>{fromFile.name}</span>}
        </div>
      )}
      {(mode === "export" || fromFile) && (
        <fieldset className="run-transfer-battles run-transfer-plans" disabled={working || loading}>
          <legend>{mode === "import" ? "Plans to import" : "Plans to export"}</legend>
          {loading && <p>Loading plans…</p>}
          {!loading && rows?.length === 0 && <p>No plans in this run yet. Make them in the Roster's Planner.</p>}
          {!loading && !!rows?.length && (
            <>
              <label className="run-transfer-all">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !all; }} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.key)))} />
                All ({rows.length})
              </label>
              {rows.map((row) => (
                <label key={row.key}>
                  <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} />
                  <span>{row.name}</span>
                  {note(row) && <span className="muted small">{note(row)}</span>}
                </label>
              ))}
            </>
          )}
        </fieldset>
      )}
      {mode === "export"
        ? <button type="button" className="btn primary" disabled={working || loading || !chosen.length} onClick={() => void exportPlans()}>{working ? "Exporting…" : chosen.length ? `Save ${plansWord(chosen.length)}…` : "Save file…"}</button>
        : fromFile && <button type="button" className="btn primary" disabled={working || loading || !chosen.length} onClick={() => void importPlans()}>{working ? "Importing…" : `Import ${plansWord(chosen.length)}`}</button>}
      {onBack && <button type="button" className="btn" onClick={onBack} disabled={working}>Back</button>}
      <button type="button" className="btn" onClick={() => { if (!working) onClose(); }} disabled={working}>Cancel</button>
    </Modal>
  );
}
