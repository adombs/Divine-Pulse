/**
 * The foot of an export window's options (Export Video, Export Team): what will be made, how far along it is, where it
 * went or why it failed, and the button that makes it.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import "./export.css";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type ExportStatus =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number; label: string }
  | { kind: "saved"; where: string[] }
  | { kind: "error"; message: string };

export function ExportActions({ facts, status, action, disabled, onExport, onCancel }: {
  /** A few facts about the export (its size, its length). */
  facts: ReactNode[];
  status: ExportStatus;
  /** The button's label ("Export MP4…"). */
  action: string;
  disabled?: boolean;
  onExport: () => void;
  /** Stops an export in progress (none: it can't be stopped). */
  onCancel?: () => void;
}) {
  return (
    <div className="export-go">
      <p className="export-facts">
        {facts.map((f, i) => <span key={i}>{f}</span>)}
      </p>
      {status.kind === "working" ? (
        <>
          <div className="export-progress" role="progressbar" aria-label={status.label} aria-valuemin={0} aria-valuemax={status.total} aria-valuenow={status.done}>
            <span style={{ width: `${(status.done / Math.max(1, status.total)) * 100}%` }} />
          </div>
          <p className="export-status working">
            {status.label}… {Math.floor((status.done / Math.max(1, status.total)) * 100)}%
          </p>
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <>
          {status.kind === "saved" && (
            <p className="export-status good" role="status">
              <Icon name={CONCEPT_ICON.done} />
              <span>
                Saved to{" "}
                {status.where.map((w, i) => (
                  <span key={w} className="export-path">{i ? <><br />{w}</> : w}</span>
                ))}
              </span>
            </p>
          )}
          {status.kind === "error" && (
            <p className="export-status bad" role="alert">
              <Icon name={CONCEPT_ICON.warning} />
              <span>{status.message}</span>
            </p>
          )}
          <button type="button" className="btn primary" onClick={onExport} disabled={disabled}>
            <Icon name={CONCEPT_ICON.share} /> {action}
          </button>
        </>
      )}
    </div>
  );
}
