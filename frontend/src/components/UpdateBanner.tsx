import { CONCEPT_ICON } from "../icons/concepts";
import { dismissUpdate, useUpdateBanner } from "../updateStatus";
import { Icon } from "./Icon";
import "./required-assets.css";

const RELEASES = "https://github.com/adombs/Divine-Pulse/releases/latest";

export function UpdateBanner() {
  const update = useUpdateBanner();
  if (!update?.latest) return null;
  const latest = update.latest;
  return <div className="game-files-alert" role="status">
    <p className="game-files-alert-text"><Icon name={CONCEPT_ICON.info} className="update-banner-icon" /><strong>Divine Pulse {latest} is available.</strong></p>
    <a className="btn" href={update.url ?? RELEASES} target="_blank" rel="noreferrer">Download</a>
    <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => void dismissUpdate(latest).catch(() => {})}><Icon name={CONCEPT_ICON.close} /></button>
  </div>;
}
