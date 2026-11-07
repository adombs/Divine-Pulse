import { useEffect, useRef, useState } from "react";
import { api, ApiError, Battle, RunSummary } from "../api";
import { ToastState } from "./Toasts";
import { Modal } from "./Modal";
import "./run-transfer.css";

type Mode = "import" | "export";
type WebviewApi = { save_export?: (filename: string, jsonContent: string) => Promise<boolean> };

export function RunTransfer({ mode, runs, toasts, onClose }: { mode: Mode; runs: RunSummary[]; toasts: ToastState; onClose: () => void }) {
  const [kind, setKind] = useState<"run" | "battles" | null>(null);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
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
      } else {
        const result = await api.importBattles(runId, payload);
        toasts.push({ kind: "ok", title: "Imported " + result.added + " battle" + (result.added === 1 ? "" : "s") });
        onClose();
      }
    } catch (error) { toasts.push({ kind: "error", title: "Couldn't import " + kind, body: (error as Error).message }); }
    finally { setWorking(false); if (file.current) file.current.value = ""; }
  };
  const exportData = async () => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !kind || (kind === "battles" && selected.size === 0)) return;
    setWorking(true);
    const filename = `${run.name.replace(/[^\w -]+/g, "").trim() || run.id} ${kind}.json`;
    const nativeApi = (window as Window & { pywebview?: { api?: WebviewApi } }).pywebview?.api;
    try {
      let data: Record<string, unknown>;
      if (kind === "run") data = await api.exportRun(run.id);
      else {
        const envelope = await api.exportBattles(run.id);
        data = { ...envelope, battles: (envelope.battles as Battle[]).filter((battle) => selected.has(battle.id)) };
      }
      const json = JSON.stringify(data, null, 2);
      if (!nativeApi?.save_export) throw new Error("The desktop save dialog is unavailable.");
      if (await nativeApi.save_export(filename, json)) onClose();
    } catch (error) { toasts.push({ kind: "error", title: `Couldn't export ${kind}`, body: (error as Error).message }); }
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
  return <Modal open onClose={() => { if (!working) onClose(); }} title={`${mode === "import" ? "Import" : "Export"} ${kind === "run" ? "run" : kind === "battles" ? "battles" : "data"}`} className="run-transfer-modal">
    {!kind ? <div className="run-transfer-options"><button className="btn" onClick={() => setKind("run")}>Runs</button><button className="btn" onClick={() => setKind("battles")}>Battles</button></div> : <>
      {mode === "import" && kind === "run" ? <p>Choose a run JSON file to import.</p> : <label>Run<select disabled={working} value={runId} onChange={(e) => setRunId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      {mode === "export" && kind === "battles" && <fieldset className="run-transfer-battles"><legend>Battles to export</legend>{battles.map((battle) => <label key={battle.id}><input type="checkbox" disabled={working || loadingBattles} checked={selected.has(battle.id)} onChange={() => toggleBattle(battle.id)} />{new Date(battle.started_at).toLocaleString()} — {battle.map_name || "Unnamed battle"}</label>)}{loadingBattles && <p>Loading battles…</p>}{!loadingBattles && battles.length === 0 && <p>No battles recorded in this run.</p>}</fieldset>}
      {mode === "import" ? <><input tabIndex={-1} ref={file} className="run-transfer-file" type="file" accept="application/json,.json" onChange={(e) => void readFile(e.currentTarget.files?.[0])} /><button className="btn primary" disabled={working || (!runId && kind === "battles")} onClick={() => file.current?.click()}>{working ? "Importing…" : "Choose file"}</button></> : <button className="btn primary" disabled={working || loadingBattles || !runId || (kind === "battles" && selected.size === 0)} onClick={() => void exportData()}>{working ? "Exporting…" : "Save file…"}</button>}
    </>}
    {kind && <button className="btn" onClick={() => setKind(null)} disabled={working}>Back</button>}
    <button className="btn" onClick={() => { if (!working) onClose(); }} disabled={working}>Cancel</button>
  </Modal>;
}
