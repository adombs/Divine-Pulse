import { CONCEPT_ICON } from "../icons/concepts";
import { useState } from "react";
import { RunSummary, ScanEntry } from "../api";
import { useNav } from "../nav";
import { Icon } from "./Icon";
import { FilterLabel } from "./FilterLabel";
import { NoMatches, RefLink, Segmented } from "./common";
import { EmptyState } from "./layout";

const STATUS_LABEL: Record<ScanEntry["status"], string> = {
  ok: "Saved",
  warning: "Saved · check",
  rejected: "Rejected",
  error: "Error",
};

/** The outcome filter: saved, saved but worth a look, or not saved at all. */
type Show = "all" | "ok" | "warning" | "failed";
const SHOWS: Record<Show, (e: ScanEntry) => boolean> = {
  all: () => true,
  ok: (e) => e.status === "ok",
  warning: (e) => e.status === "warning",
  failed: (e) => e.status === "rejected" || e.status === "error",
};

interface Props {
  entries: ScanEntry[];
  runs: RunSummary[];
  onUndo: () => void;
}

/** The updates read from the game this session: a tab of the Runs page. */
export function ScanLog({ entries, runs, onUndo }: Props) {
  const nav = useNav();
  const runName = (id: string | null) => runs.find((r) => r.id === id)?.name ?? id;
  const [show, setShow] = useState<Show>("all");
  const count = (k: Show) => entries.filter(SHOWS[k]).length;
  const shown = entries.filter(SHOWS[show]);

  return (
    <section className="scan-page">
      {entries.length === 0 ? (
        <EmptyState title="No updates yet this session">
          Reads from the game that change a unit show here, with a way to undo.
        </EmptyState>
      ) : (
        <>
          <div className="toolbar">

            <Segmented<Show>
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                ["all", `All ${count("all")}`],
                ["ok", <FilterLabel key="saved" icon={CONCEPT_ICON.done}>Saved {count("ok")}</FilterLabel>],
                ["warning", <FilterLabel key="warning" icon={CONCEPT_ICON.warning}>To check {count("warning")}</FilterLabel>, "Saved, but some values need a look"],
                ["failed", `Not saved ${count("failed")}`, "Rejected or failed"],
              ]}
            />
          </div>
          {shown.length === 0 && <NoMatches what="updates" onReset={() => setShow("all")} />}
          <ul className="scan-list">
            {shown.map((e) => (
              <li key={e.id} className={`scan item ${e.status}`}>
                <div className="scan-body">
                  <div className="scan-top">
                    <span className={`chip ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                    {e.screen && <span className="chip">{e.screen}</span>}
                    <time className="muted">{new Date(e.time).toLocaleTimeString()}</time>
                    {e.run_id && <span className="muted">· {runName(e.run_id)}</span>}
                  </div>
                  <p className="scan-msg">{e.message}</p>
                  {e.unit_key && (e.status === "ok" || e.status === "warning") && (
                    <RefLink onClick={() => nav.go({ page: "roster", id: e.unit_key! })} title="Show this unit on the Roster">
                      Open {e.unit_name ?? "unit"} on the Roster <Icon name={CONCEPT_ICON.go} />
                    </RefLink>
                  )}
                  {e.warnings.length > 0 && (
                    <ul className="warnings">
                      {e.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <div className="scan-actions">
                    {e.can_undo && (
                      <button className="btn small" onClick={onUndo}>
                        Undo
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
