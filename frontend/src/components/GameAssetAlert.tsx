import { useEffect, useState } from "react";
import { assetIssues, onAssetIssuesChange } from "../requiredAssets";
import { gameAssetsStatus, loadGameAssetsStatus, onGameAssetsChange } from "../gameAssets";
import { CONCEPT_ICON } from "../icons/concepts";
import { Icon } from "./Icon";
import "./required-assets.css";

export function GameAssetAlert({ onGameFiles }: { onGameFiles: () => void }) {
  const [issues, setIssues] = useState(assetIssues);
  const [retrying, setRetrying] = useState(false);
  const [outdated, setOutdated] = useState(() => !!gameAssetsStatus().outdated);
  useEffect(() => {
    setOutdated(!!gameAssetsStatus().outdated);
    return onGameAssetsChange((status) => setOutdated(!!status.outdated));
  }, []);
  useEffect(() => {
    const off = onAssetIssuesChange(() => setIssues(assetIssues()));
    setIssues(assetIssues());
    return off;
  }, []);
  if (!issues.length) {
    if (!outdated) return null;
    return <div className="game-files-alert" role="alert">
      <p className="game-files-alert-text"><Icon name={CONCEPT_ICON.warning} className="game-files-alert-icon" /><strong>Reprocess your game files.</strong> They were processed by an older version of Divine Pulse.</p>
      <button type="button" className="btn" onClick={onGameFiles}>Game files</button>
    </div>;
  }
  const retry = async () => {
    setRetrying(true);
    try { await loadGameAssetsStatus(true); } finally { setRetrying(false); }
  };
  return <div className="game-files-alert" role="alert">
    <details><summary>{issues.length === 1 ? "A required game file is unavailable" : `${issues.length} required game files are unavailable`}</summary>
      <p>Reprocess your game files to restore them.</p><ul>{issues.map((issue) => <li key={issue.path}>{issue.message}</li>)}</ul>
    </details>
    <button type="button" className="btn" onClick={onGameFiles}>Game files</button>
    <button type="button" className="btn" disabled={retrying} onClick={() => void retry()}>{retrying ? "Checking…" : "Check again"}</button>
  </div>;
}
