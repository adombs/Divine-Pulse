import { useEffect, useRef, useState } from "react";
import { api, Battle, RunSummary } from "../api";
import { ToastState } from "./Toasts";
import { Modal } from "./Modal";
import "./run-transfer.css";

type Mode = "import" | "export";
type WebviewApi = { save_export?: (filename: string, jsonContent: string) => Promise<boolean> };
type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> };

export function RunTransfer({ mode, runs, toasts, onClose }: { mode: Mode; runs: RunSummary[]; toasts: ToastState; onClose: () => void }) {
  const [kind, setKind] = useState<"run" | "battles" | null>(null);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [battles, setBattles] = useState<Battle[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  const readFile = async (selectedFile?: File) => {
    if (!selectedFile || !kind) return;
    setWorking(true);
    try {
      const payload = JSON.parse(await selectedFile.text());
      if (kind === "run") {
        const imported = await api.importRun(payload);
        toasts.push({ kind: "ok", title: `Imported "${imported.name}"` });
      } else {
        const result = await api.importBattles(runId, payload);
        toasts.push({ kind: "ok", title: `Imported ${result.added} battle${result.added === 1 ? "" : "s"}` });
      }
      onClose();
    } catch (error) { toasts.push({ kind: "error", title: `Couldn't import ${kind}`, body: (error as Error).message }); }
    finally { setWorking(false); if (file.current) file.current.value = ""; }
  };
  const exportData = async () => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !kind || (kind === "battles" && selected.size === 0)) return;
    setWorking(true);
    const filename = `${run.name.replace(/[^\w -]+/g, "").trim() || run.id} ${kind}.json`;
    const nativeApi = (window as Window & { pywebview?: { api?: WebviewApi } }).pywebview?.api;
    const nativeSave = nativeApi?.save_export;
    const picker = (window as SavePickerWindow).showSaveFilePicker;
    let handle: FileSystemFileHandle | null = null;
    // Invoke the picker in the click gesture, before any await can expire activation.
    try {
      if (nativeSave) { /* Native save dialog is opened after the export payload is ready. */ }
      else if (picker) handle = await picker.call(window, { suggestedName: filename, types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toasts.push({ kind: "error", title: `Couldn't export ${kind}`, body: (error as Error).message });
      setWorking(false);
      return;
    }
    try {
      let data: Record<string, unknown>;
      if (kind === "run") data = await api.exportRun(run.id);
      else {
        const envelope = await api.exportBattles(run.id);
        data = { ...envelope, battles: (envelope.battles as Battle[]).filter((battle) => selected.has(battle.id)) };
      }
      const json = JSON.stringify(data, null, 2);
      if (nativeSave) {
        if (await nativeSave.call(nativeApi, filename, json)) onClose();
      } else if (handle) {
        const writable = await handle.createWritable(); await writable.write(new Blob([json], { type: "application/json" })); await writable.close(); onClose();
      } else { download(new Blob([json], { type: "application/json" }), filename); onClose(); }
    } catch (error) { toasts.push({ kind: "error", title: `Couldn't export ${kind}`, body: (error as Error).message }); }
    finally { setWorking(false); }
  };
  const toggleBattle = (id: string) => setSelected((previous) => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
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
function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
