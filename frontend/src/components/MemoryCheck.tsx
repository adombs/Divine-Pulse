/** Whether the tracker can read the game right now, with a button to try again (Settings). */
import { CONCEPT_ICON } from "../icons/concepts";
import { useEffect, useState } from "react";
import { api } from "../api";
import { StatusChip } from "./layout";
import { IconButton } from "./Icon";

export function MemoryCheck() {
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const run = async () => {
    setChecking(true);
    try {
      setCheck(await api.checkMemory());
    } catch (err) {
      setCheck({ ok: false, message: (err as Error).message });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    run();
  }, []);
  return (
    <span className="memory-check">
      {checking ? (
        <span className="muted">Checking…</span>
      ) : (
        check && (
          <>
            <StatusChip tone={check.ok ? "good" : "warn"}>{check.ok ? "Connected" : "Not connected"}</StatusChip>
            <span>{check.message}</span>
          </>
        )
      )}
      <IconButton icon={CONCEPT_ICON.turn} label="Check again" onClick={run} disabled={checking} />
    </span>
  );
}
