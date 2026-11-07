import { useEffect, useState } from "react";
import { assetIssues, onAssetIssuesChange } from "../requiredAssets";
import { loadGameAssetsStatus } from "../gameAssets";
import "./required-assets.css";

export function GameAssetAlert({ onGameFiles }: { onGameFiles: () => void }) {
  const [issues, setIssues] = useState(assetIssues);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const off = onAssetIssuesChange(() => setIssues(assetIssues()));
    setIssues(assetIssues());
    return off;
  }, []);
  if (!issues.length) return null;
  const retry = async () => {
    setRetrying(true);
    try { await loadGameAssetsStatus(true); } finally { setRetrying(false); }
  };
  return <div className="game-files-alert" role="alert">
    <details><summary>{issues.length === 1 ? "A required game file is unavailable" : `${issues.length} required game files are unavailable`}</summary>
      <p>Reimport your dump to restore the original files.</p><ul>{issues.map((issue) => <li key={issue.path}>{issue.message}</li>)}</ul>
    </details>
    <button type="button" className="btn" onClick={onGameFiles}>Game files</button>
    <button type="button" className="btn" disabled={retrying} onClick={() => void retry()}>{retrying ? "Checking…" : "Check again"}</button>
  </div>;
}
