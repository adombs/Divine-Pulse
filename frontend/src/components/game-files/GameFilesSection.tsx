import { useEffect, useState } from "react";
import { api, type GameFilesCandidate, type GameFilesScan, type GameFilesStatus, type GameFilesVerify } from "../../api";
import { loadGameAssetsStatus } from "../../gameAssets";
import { useEvents } from "../../useEvents";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { LanguageSelect } from "../LanguageSelect";
import { SectionHead } from "../ui";
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
  const [scan, setScan] = useState<GameFilesScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<GameFilesCandidate[]>([]);
  const [verification, setVerification] = useState<GameFilesVerify | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reimport, setReimport] = useState(false);
  useEffect(() => {
    void api.gameFilesStatus().then((result) => { setStatus(result); setDump(result.last_dump ?? ""); }).catch((err: Error) => setError(err.message));
    void api.gameFilesCandidates().then((result) => setFound(result.candidates)).catch(() => {});
  }, []);
  useEvents({ game_assets: (data) => {
    const next = data as GameFilesStatus;
    if (next && typeof next.available === "boolean") setStatus(next);
  } });
  const running = status?.job?.state === "running";
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
    if (!dump.trim() || running) { setScanning(false); return; }
    let live = true;
    setScanning(true);
    const timer = window.setTimeout(() => {
      void api.scanGameFiles(dump).then((result) => { if (live) { setScan(result); setError(""); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setScanning(false); });
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [dump, running]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const parts = scan?.parts;
  const importable = !!scan?.importable;
  const reason = !dump.trim() ? "Choose a dump folder." : scanning ? "Checking the folder..." : !scan ? "Choose a readable dump folder." : !importable ? "Resolve the problems above before importing." : "";
  const showFlow = !status?.available || reimport || running || status?.job?.state === "failed";
  return <>
    <SectionHead>Game files</SectionHead>
    <div className="game-files-layout">
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
        <h2>Where is your dump?</h2>
        <p className="hint">Only have NSP files? <a href="https://github.com/adombs/nsp-unpacker" target="_blank" rel="noreferrer">NSP Unpacker</a> extracts them into a folder you can import. It runs <a href="https://github.com/jakcron/nstool" target="_blank" rel="noreferrer">NSTool</a> by Jack (jakcron), which you download separately, and needs your own prod.keys.</p>
        {found.length > 0 && <div className="game-files-choices" role="radiogroup" aria-label="Detected dumps">{found.map((candidate) => <label key={candidate.path} className="game-files-choice">
          <input type="radio" name="dump" checked={candidate.path === dump} onChange={() => setDump(candidate.path)} />
          <span><strong>{candidate.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}</strong><span className="hint game-files-path">{candidate.path}</span><span className="hint">{[candidate.version, `${candidate.dlc.length} DLC`].filter(Boolean).join(" \u00b7 ")}</span></span>
        </label>)}</div>}
        <div className="game-files-folder"><label><span className="field-label">Dump folder</span><input value={dump} onChange={(e) => setDump(e.target.value)} /></label>
          {desktop && <button type="button" className="btn" disabled={busy} onClick={() => action(async () => { const result = await api.pickGameFilesFolder(); if (result.path) setDump(result.path); })}>Browse</button>}
        </div>
        {scanning && <p role="status">Checking folder...</p>}
        {scan && <section className="game-files-results"><h2>What was found</h2>
          {scan.version && <p>Version {scan.version}</p>}
          <ul className="game-files-parts">{parts?.map((part) => <li key={part.id}><Icon name={part.found ? CONCEPT_ICON.done : CONCEPT_ICON.warning} className={part.found ? "found" : part.required ? "missing-required" : "missing-optional"} /><div><strong>{part.name}</strong>{part.detail && <span className="game-files-detail">{part.detail}</span>}<span className="hint">{part.found ? "Found" : part.required ? "Missing (required)" : "Not found"}</span></div></li>)}</ul>
          {scan.problems.length ? <div className="game-files-warning" role="alert"><Icon name={CONCEPT_ICON.warning} /><ul>{scan.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div> : !importable && <p role="alert">This game build cannot be imported.</p>}
        </section>}
        <div><button type="button" className="btn primary" disabled={busy || scanning || !importable} onClick={() => action(async () => { const result = await api.importGameFiles(dump); setStatus((old) => old ? { ...old, job: result.job } : old); })}>{status.available ? "Re-import game files" : "Import game files"}</button>{reason && <p className="hint">{reason}</p>}</div>
      </div>}
      {status?.job && status.job.state !== "idle" && <div className="game-files-card game-files-progress" aria-live="polite">
        <strong>{running ? (phases[status.job.phase] || "Importing game files") : status.job.state === "done" ? "Import complete" : "Import failed"}</strong>
        {running && <><progress aria-label={phases[status.job.phase] || "Importing game files"} max={status.job.total || 1} value={status.job.total ? Math.min(status.job.done, Math.max(0, status.job.total - 1)) : undefined} />{status.job.total > 0 && status.job.phase !== "verify" && <span>{Math.min(status.job.done, Math.max(0, status.job.total - 1))} / {status.job.total}</span>}</>}
        {status.job.state === "failed" && <><span>{status.job.error || "The game files could not be imported."}</span><span>Check the dump folder and try again.</span></>}
        {status.job.state === "done" && <span>{[status.version, `${status.files ?? 0} files`, status.created && new Date(status.created).toLocaleString()].filter(Boolean).join(" \u00b7 ")}</span>}
        {status.job.log?.length > 0 && <details><summary>Import details</summary><ul>{status.job.log.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
      </div>}
      {error && <p className="field-hint error" role="alert">{error} Check the folder and try again.</p>}
      {status?.available && <div className="game-files-card"><LanguageSelect /></div>}
    </div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove imported files">
      <p>Remove the imported game files? The app will show the import screen afterwards.</p>
      <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>{" "}
      <button type="button" className="btn primary" disabled={busy} onClick={() => action(async () => { await api.removeGameFiles(); setConfirm(false); await loadGameAssetsStatus(true); })}>Remove</button>
    </Modal>
  </>;
}
