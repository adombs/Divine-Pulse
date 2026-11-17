import { useEffect, useRef, useState } from "react";
import { api, ApiError, Battle, RunSummary } from "../api";
import { ToastState } from "./Toasts";
import { Modal } from "./Modal";
import { PlansTransfer } from "./PlansTransfer";
import { mergeRules, readRulesetFile, rulesetFile, type Rule } from "../ruleset";
import "./run-transfer.css";

type Mode = "import" | "export";
export type TransferKind = "run" | "battles" | "ruleset" | "plans";
const KIND_LABEL: Record<TransferKind, string> = { run: "run", battles: "battles", ruleset: "ruleset", plans: "plans" };
type WebviewApi = { save_export?: (filename: string, jsonContent: string) => Promise<boolean> };

/** Runs → Import/Export: a whole run, some of its battles, its ruleset or its plans (PlansTransfer.tsx), as a JSON file. `kind` and `runId` open it on
 * one of them (the Ruleset section's own Import and Export). */
export function RunTransfer({ mode, runs, toasts, onClose, kind: initialKind = null, runId: initialRunId }: { mode: Mode; runs: RunSummary[]; toasts: ToastState; onClose: () => void; kind?: TransferKind | null; runId?: string }) {
  const [kind, setKind] = useState<TransferKind | null>(initialKind);
  const [runId, setRunId] = useState(initialRunId ?? runs[0]?.id ?? "");
  /** A ruleset read from a file, waiting to be added to or to replace the run's rules. */
  const [pendingRules, setPendingRules] = useState<{ incoming: Rule[]; current: Rule[] } | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<{ payload: unknown; message: string; name?: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [working, setWorking] = useState(false);
  const [loadingBattles, setLoadingBattles] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (kind !== "battles" || mode !== "export" || !runId) return;
    let current = true;
    setBattles([]);
    setSelected(new Set());
    setLoadingBattles(true);
    api.battles(runId).then((value) => { if (current) { setBattles(value); setSelected(new Set(value.map((battle) => battle.id))); } }, (error: Error) => { if (current) toasts.push({ kind: "error", title: "Couldn't load battles", body: error.message }); }).finally(() => { if (current) setLoadingBattles(false); });
    return () => { current = false; };
  }, [kind, mode, runId]);
  const importRun = async (payload: unknown, options?: { name?: string; overwrite?: boolean }) => {
    try {
      const imported = await api.importRun(payload, options);
      toasts.push({ kind: "ok", title: 'Imported "' + imported.name + '"' });
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      setConflict({ payload, message: error.message, name: options?.name });
      setNewName("");
    }
  };
  const resolveConflict = async (options: { name?: string; overwrite?: boolean }) => {
    if (!conflict) return;
    setWorking(true);
    try { await importRun(conflict.payload, options); }
    catch (error) { toasts.push({ kind: "error", title: "Couldn't import run", body: (error as Error).message }); }
    finally { setWorking(false); }
  };
  const readFile = async (selectedFile?: File) => {
    if (!selectedFile || !kind) return;
    setWorking(true);
    try {
      const payload: unknown = JSON.parse(await selectedFile.text());
      if (kind === "run") {
        await importRun(payload);
      } else if (kind === "ruleset") {
        const incoming = readRulesetFile(payload);
        const current = (await api.ruleset(runId)).rules;
        if (current.length) setPendingRules({ incoming, current });
        else await saveRules(incoming);
      } else {
        const result = await api.importBattles(runId, payload);
        toasts.push({ kind: "ok", title: "Imported " + result.added + " battle" + (result.added === 1 ? "" : "s") });
        onClose();
      }
    } catch (error) { toasts.push({ kind: "error", title: "Couldn't import " + KIND_LABEL[kind], body: (error as Error).message }); }
    finally { setWorking(false); if (file.current) file.current.value = ""; }
  };
  const saveRules = async (rules: Rule[]) => {
    const saved = await api.setRuleset(runId, rules);
    const run = runs.find((r) => r.id === runId);
    toasts.push({ kind: "ok", title: `${run ? `"${run.name}" has` : "The run has"} ${saved.rules.length} rule${saved.rules.length === 1 ? "" : "s"}` });
    onClose();
  };
  const resolveRules = async (replace: boolean) => {
    if (!pendingRules) return;
    setWorking(true);
    try { await saveRules(replace ? pendingRules.incoming : mergeRules(pendingRules.current, pendingRules.incoming)); }
    catch (error) { toasts.push({ kind: "error", title: "Couldn't import ruleset", body: (error as Error).message }); }
    finally { setWorking(false); }
  };
  const exportData = async () => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !kind || (kind === "battles" && selected.size === 0)) return;
    setWorking(true);
    const filename = `${run.name.replace(/[^\w -]+/g, "").trim() || run.id} ${KIND_LABEL[kind]}.json`;
    const nativeApi = (window as Window & { pywebview?: { api?: WebviewApi } }).pywebview?.api;
    try {
      let data: Record<string, unknown>;
      if (kind === "run") data = await api.exportRun(run.id);
      else if (kind === "ruleset") {
        const { rules } = await api.ruleset(run.id);
        if (!rules.length) throw new Error(`"${run.name}" has no rules yet.`);
        data = rulesetFile(run.name, rules);
      } else {
        const envelope = await api.exportBattles(run.id);
        data = { ...envelope, battles: (envelope.battles as Battle[]).filter((battle) => selected.has(battle.id)) };
      }
      const json = JSON.stringify(data, null, 2);
      if (!nativeApi?.save_export) throw new Error("The desktop save dialog is unavailable.");
      if (await nativeApi.save_export(filename, json)) onClose();
    } catch (error) { toasts.push({ kind: "error", title: `Couldn't export ${KIND_LABEL[kind]}`, body: (error as Error).message }); }
    finally { setWorking(false); }
  };
  const toggleBattle = (id: string) => setSelected((previous) => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  if (conflict) return <Modal open onClose={() => { if (!working) setConflict(null); }} title="Run name already exists" className="run-transfer-modal">
    <p>{conflict.message}</p>
    <p>Overwriting replaces the existing roster and battle history. Enter a different name to keep both runs.</p>
    <label>New run name<input value={newName} maxLength={60} disabled={working} onChange={(event) => setNewName(event.target.value)} /></label>
    <button type="button" className="btn primary" disabled={working || !newName.trim()} onClick={() => void resolveConflict({ name: newName.trim() })}>Import with new name</button>
    <button type="button" className="btn danger" disabled={working} onClick={() => void resolveConflict({ name: conflict.name, overwrite: true })}>Overwrite existing run</button>
    <button type="button" className="btn" disabled={working} onClick={() => setConflict(null)}>Back</button>
  </Modal>;
  if (kind === "plans") return <PlansTransfer mode={mode} runs={runs} toasts={toasts} onClose={onClose} runId={runId} onBack={initialKind ? undefined : () => setKind(null)} />;
  if (pendingRules) {
    const target = runs.find((r) => r.id === runId);
    const added = mergeRules(pendingRules.current, pendingRules.incoming).length - pendingRules.current.length;
    return <Modal open onClose={() => { if (!working) setPendingRules(null); }} title="Import ruleset" className="run-transfer-modal">
      <p>{target ? `"${target.name}"` : "This run"} already has {pendingRules.current.length} rule{pendingRules.current.length === 1 ? "" : "s"}. The file has {pendingRules.incoming.length}.</p>
      <button type="button" className="btn primary" disabled={working || added === 0} onClick={() => void resolveRules(false)}>{added === 0 ? "Already has every rule" : `Add ${added} new rule${added === 1 ? "" : "s"}`}</button>
      <button type="button" className="btn danger" disabled={working} onClick={() => void resolveRules(true)}>Replace its rules</button>
      <button type="button" className="btn" disabled={working} onClick={() => setPendingRules(null)}>Back</button>
    </Modal>;
  }
  return <Modal open onClose={() => { if (!working) onClose(); }} title={`${mode === "import" ? "Import" : "Export"} ${kind ? KIND_LABEL[kind] : "data"}`} className="run-transfer-modal">
    {!kind ? <div className="run-transfer-options"><button className="btn" onClick={() => setKind("run")}>Runs</button><button className="btn" onClick={() => setKind("battles")}>Battles</button><button className="btn" onClick={() => setKind("ruleset")}>Rulesets</button><button className="btn" onClick={() => setKind("plans")}>Plans</button></div> : <>
      {mode === "import" && kind === "run" ? <p>Choose a run JSON file to import.</p> : <label>{mode === "import" ? (kind === "ruleset" ? "Import into run" : "Run") : "Run"}<select disabled={working} value={runId} onChange={(e) => setRunId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      {mode === "export" && kind === "battles" && <fieldset className="run-transfer-battles"><legend>Battles to export</legend>{battles.map((battle) => <label key={battle.id}><input type="checkbox" disabled={working || loadingBattles} checked={selected.has(battle.id)} onChange={() => toggleBattle(battle.id)} />{new Date(battle.started_at).toLocaleString()} — {battle.map_name || "Unnamed battle"}</label>)}{loadingBattles && <p>Loading battles…</p>}{!loadingBattles && battles.length === 0 && <p>No battles recorded in this run.</p>}</fieldset>}
      {mode === "import" ? <><input tabIndex={-1} ref={file} className="run-transfer-file" type="file" accept="application/json,.json" onChange={(e) => void readFile(e.currentTarget.files?.[0])} />{kind === "ruleset" && <p>Choose a ruleset file, or a run's export, to take its rules.</p>}<button className="btn primary" disabled={working || (!runId && kind !== "run")} onClick={() => file.current?.click()}>{working ? "Importing…" : "Choose file"}</button></> : <button className="btn primary" disabled={working || loadingBattles || !runId || (kind === "battles" && selected.size === 0)} onClick={() => void exportData()}>{working ? "Exporting…" : "Save file…"}</button>}
    </>}
    {kind && !initialKind && <button className="btn" onClick={() => setKind(null)} disabled={working}>Back</button>}
    <button className="btn" onClick={() => { if (!working) onClose(); }} disabled={working}>Cancel</button>
  </Modal>;
}
