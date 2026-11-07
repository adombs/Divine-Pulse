import { useEffect, useState } from "react";
import { api, type GameFilesScan, type GameFilesStatus, type GameFilesVerify } from "../../api";
import { loadGameAssetsStatus } from "../../gameAssets";
import { useEvents } from "../../useEvents";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { SectionHead } from "../ui";
import { mergeNspPaths } from "./selection";
import "../settings-game-files.css";

const DLC_NAMES: Record<string, string> = {
  cindered_shadows: "Cindered Shadows", new_attire: "New Attire", auxiliary_battle_maps: "Auxiliary Battle Maps",
  additional_quests: "Additional Quests", additional_support_items: "Additional Support Items",
  officers_academy_uniform: "Officers Academy Uniform",
};
const dlcName = (id: string) => DLC_NAMES[id] ?? id;
const phases: Record<string, string> = { exe_tables: "Reading game data", text: "Importing text", data: "Importing data", portraits: "Importing portraits", icons: "Importing icons", map: "Importing maps", verify: "Checking imported files" };

export function GameFilesSection({ desktop }: { desktop: boolean }) {
  const [status, setStatus] = useState<GameFilesStatus | null>(null);
  const [dump, setDump] = useState("");
  const [source, setSource] = useState<"dump" | "nsp">("dump");
  const [nsps, setNsps] = useState<string[]>([]);
  const [pathDraft, setPathDraft] = useState("");
  const [keys, setKeys] = useState("");
  const [scan, setScan] = useState<GameFilesScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [keepDumps, setKeepDumps] = useState(false);
  const [destination, setDestination] = useState("");
  const [verification, setVerification] = useState<GameFilesVerify | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reimport, setReimport] = useState(() => new URLSearchParams(window.location.search).has("replace_import"));
  useEffect(() => {
    void api.gameFilesStatus().then(setStatus).catch((err: Error) => setError(err.message));
  }, []);
  useEvents({ game_assets: (data) => {
    const next = data as GameFilesStatus;
    if (next && typeof next.available === "boolean") setStatus(next);
  } });
  const running = status?.job?.state === "running";
  const phaseLabel = phases[status?.job?.phase ?? ""] ?? "Importing game files";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void api.gameFilesStatus().then((result) => {
        setStatus(result);
        if (result.available && result.job?.state !== "running") void loadGameAssetsStatus(true);
      }).catch((err: Error) => setError(err.message));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    setScan(null);
    if (source !== "dump" || !dump.trim() || running) { setScanning(false); return; }
    let live = true;
    setScanning(true);
    const timer = window.setTimeout(() => {
      void api.scanGameFiles(dump).then((result) => { if (live) { setScan(result); setError(""); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setScanning(false); });
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [dump, running, source]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const parts = scan?.parts;
  const importable = !!scan?.importable;
  const reason = !dump.trim() ? "Choose a dump folder." : scanning ? "Checking the folder..." : !scan ? "Choose a readable dump folder." : !importable ? "Resolve the problems above before importing." : "";
  const showFlow = !status?.available || reimport || running || status?.job?.state === "failed";
  const nspReason = !nsps.length ? "Add your base game, update and any DLC NSP files." : !keys.trim() ? "Choose your prod.keys file to continue." : keepDumps && !destination.trim() ? "Enter a new folder for the extracted files." : "";
  return <>
    <SectionHead>Game files</SectionHead>
    <div className="game-files-layout">
      {status?.error && <p className="field-hint error" role="alert">{status.error}</p>}
      {status?.available && <div className="game-files-card game-files-status">
        <strong>Game files are available</strong>
        <span className="hint">{[status.version, `${status.files ?? 0} files`, status.created && new Date(status.created).toLocaleString()].filter(Boolean).join(" \u00b7 ")}</span>
        <span className="hint">{status.dlc?.length ? status.dlc.map(dlcName).join(", ") : "No DLC"}</span>
        {status.outdated && <div className="game-files-warning" role="alert"><Icon name={CONCEPT_ICON.warning} />Import again to update the game data.</div>}
        <div className="settings-actions">
          <button type="button" className="btn" disabled={busy || running} onClick={() => setReimport(true)}>Re-import</button>
          <button type="button" className="btn" disabled={busy || running} onClick={() => action(async () => setVerification(await api.verifyGameFiles()))}>Check files</button>
          <button type="button" className="btn" disabled={busy || running} onClick={() => setConfirm(true)}>Remove</button>
        </div>
        {verification && <div><p>{verification.ok ? "Check complete" : "Check failed"}: {verification.checked} files checked</p>{(verification.errors.length > 0 || verification.warnings.length > 0) && <details><summary>Details</summary><ul>{[...verification.errors, ...verification.warnings].map((item, i) => <li key={i}>{item}</li>)}</ul></details>}</div>}
      </div>}
      {showFlow && !running && status && <div className="game-files-flow">
        <h2>Choose your game files</h2>
        <p className="hint">Import an extracted dump or select your base game, update and optional DLC NSP files.</p>
        <div className="game-files-choices game-files-source" role="radiogroup" aria-label="Game file source">
          <label className="game-files-choice"><input type="radio" name="source" checked={source === "dump"} onChange={() => setSource("dump")} /><span><strong>Dump folder</strong><span className="hint">A folder containing the game's RomFS and ExeFS.</span></span></label>
          <label className="game-files-choice"><input type="radio" name="source" checked={source === "nsp"} onChange={() => setSource("nsp")} /><span><strong>NSP files</strong><span className="hint">Select your base game, update and any DLC. Your prod.keys file is also required.</span></span></label>
        </div>
        {source === "dump" && <>
        <div className="game-files-folder"><label><span className="field-label">Dump folder</span><input value={dump} onChange={(e) => setDump(e.target.value)} /></label>
          {desktop && <button type="button" className="btn" disabled={busy} onClick={() => action(async () => { const result = await api.pickGameFilesFolder(); if (result.path) setDump(result.path); })}>Browse</button>}
        </div>
        {scanning && <p role="status">Checking folder...</p>}
        {scan && <section className="game-files-results"><h2>What was found</h2>
          {scan.version && <p>Version {scan.version}</p>}
          <ul className="game-files-parts">{parts?.map((part) => <li key={part.id}><Icon name={part.found ? CONCEPT_ICON.done : CONCEPT_ICON.warning} className={part.found ? "found" : part.required ? "missing-required" : "missing-optional"} /><div><strong>{part.name}</strong>{part.detail && <span className="game-files-detail">{part.detail}</span>}<span className="hint">{part.found ? "Found" : part.required ? "Missing (required)" : "Not found"}</span></div></li>)}</ul>
          {scan.problems.length ? <div className="game-files-warning" role="alert"><Icon name={CONCEPT_ICON.warning} /><ul>{scan.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div> : !importable && <p role="alert">This game build cannot be imported.</p>}
        </section>}
        </>}
        {source === "nsp" && <div className="game-files-nsp">
          <section className="game-files-selection" aria-labelledby="nsp-selection-title">
            <div className="game-files-selection-head">
              <div><h3 id="nsp-selection-title">Selected NSP files</h3><p className="hint" id="nsp-selection-help">Add files from as many folders as you need. Earlier selections stay in the list.</p></div>
              {desktop && <button type="button" className="btn" disabled={busy} aria-describedby="nsp-selection-help" onClick={() => action(async () => { const result = await api.pickGameFilesNsps(); setNsps((current) => mergeNspPaths(current, result.paths)); })}><Icon name={CONCEPT_ICON.add} />Add NSP files</button>}
            </div>
            {nsps.length > 0 ? <>
              <div className="game-files-selection-summary"><span role="status">{nsps.length} {nsps.length === 1 ? "file" : "files"} selected</span><button type="button" className="link-btn" disabled={busy} onClick={() => setNsps([])}>Clear selection</button></div>
              <ul className="game-files-selected">{nsps.map((path) => {
                const name = path.split(/[\\/]/).pop() || path;
                return <li key={path}><div><strong>{name}</strong><span className="hint game-files-path">{path}</span></div><button type="button" className="btn small" disabled={busy} aria-label={`Remove ${name}`} title={`Remove ${path}`} onClick={() => setNsps((current) => current.filter((item) => item !== path))}>Remove</button></li>;
              })}</ul>
            </> : <p className="game-files-selection-empty">No NSP files selected. Add the base game, update and optional DLC to get started.</p>}
            <details className="game-files-manual" open={desktop ? undefined : true}>
              <summary>Add file paths manually</summary>
              <div className="game-files-folder"><label><span className="field-label">NSP file paths</span><textarea rows={3} value={pathDraft} disabled={busy} onChange={(e) => setPathDraft(e.target.value)} placeholder="One full file path per line" /><span className="hint">Paths refer to files on the computer running Divine Pulse. Duplicates are added only once.</span></label><button type="button" className="btn" disabled={busy || !pathDraft.trim()} onClick={() => { setNsps((current) => mergeNspPaths(current, pathDraft.split(/\r?\n/))); setPathDraft(""); }}>Add paths</button></div>
            </details>
          </section>
          <div className="game-files-keys"><div className="game-files-folder"><label><span className="field-label">prod.keys</span><input value={keys} disabled={busy} placeholder="Path to your prod.keys file" onChange={(e) => setKeys(e.target.value)} /></label>{desktop && <button type="button" className="btn" disabled={busy} onClick={() => action(async () => { const result = await api.pickGameFilesKeys(); if (result.path) setKeys(result.path); })}>Choose keys</button>}</div><p className="hint">Required to read your NSP files.</p></div>
          <label><input type="checkbox" checked={keepDumps} disabled={busy} onChange={(e) => setKeepDumps(e.target.checked)} /> Keep extracted files after a successful import</label>
          {keepDumps && <label><span className="field-label">New extraction folder</span><input value={destination} disabled={busy} onChange={(e) => setDestination(e.target.value)} placeholder="Full path to a new folder" /></label>}
        </div>}
        <div className="game-files-import"><div>{source === "dump" ? <><button type="button" className="btn primary" disabled={busy || scanning || !importable} onClick={() => action(async () => { const result = await api.importGameFiles(dump); setStatus((old) => old ? { ...old, job: result.job } : old); })}>{status.available ? "Re-import game files" : "Import game files"}</button>{reason && <p className="hint">{reason}</p>}</> : <><button type="button" className="btn primary" disabled={busy || !!nspReason} onClick={() => action(async () => { const result = await api.importGameFilesNsps(nsps, keys, keepDumps ? destination.trim() : undefined); setStatus((old) => old ? { ...old, job: result.job } : old); })}>{status.available ? "Re-import game files" : "Import game files"}</button>{nspReason && <p className="hint">{nspReason}</p>}</>}</div>{status.available && reimport && <button type="button" className="link-btn" disabled={busy} onClick={() => setReimport(false)}>Cancel re-import</button>}</div>
      </div>}
      {status?.job && status.job.state !== "idle" && <div className="game-files-card game-files-progress" aria-live="polite">
        <strong>{running ? phaseLabel : status.job.state === "done" ? "Import complete" : "Import failed"}</strong>
        {running && <><progress aria-label={phaseLabel} max={status.job.total || 1} value={status.job.total ? Math.min(status.job.done, Math.max(0, status.job.total - 1)) : undefined} />{status.job.total > 0 && status.job.phase !== "verify" && <span>{Math.min(status.job.done, Math.max(0, status.job.total - 1))} / {status.job.total}</span>}</>}
        {status.job.state === "failed" && <><span>{status.job.error || "The game files could not be imported."}</span><span>{status.available ? "Your previous import is still available." : "Check your selected files and try again."}</span></>}
        {status.job.state === "done" && <span>{[status.version, `${status.files ?? 0} files`, status.created && new Date(status.created).toLocaleString()].filter(Boolean).join(" \u00b7 ")}</span>}
      </div>}
      {error && <p className="field-hint error" role="alert">{error}</p>}
    </div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove imported files">
      <p>Remove the imported game files? The app will show the import screen afterwards.</p>
      <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>{" "}
      <button type="button" className="btn primary" disabled={busy} onClick={() => action(async () => { await api.removeGameFiles(); setConfirm(false); await loadGameAssetsStatus(true); })}>Remove</button>
    </Modal>
  </>;
}
