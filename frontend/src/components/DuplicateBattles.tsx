import { CONCEPT_ICON } from "../icons/concepts";
import { useEffect, useState } from "react";
import type { DuplicateGroup } from "../api";
import { resolveDuplicates, useDuplicateGroups } from "../duplicateBattles";
import { defaultKeep, discardFor } from "../duplicateChoice";
import { clock } from "../format";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

/** Amber button beside Back on every page header when the run has repeated one-time battles; opens the list. */
export function DuplicateWarning() {
  const groups = useDuplicateGroups();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!groups.length) setOpen(false); }, [groups.length]);
  if (!groups.length) return null;
  return (
    <>
      <button type="button" className="btn small duplicate-warning" title="Duplicate battles" aria-label="Duplicate battles" onClick={() => setOpen(true)}>
        <Icon name={CONCEPT_ICON.warning} />
        {groups.length}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Duplicate battles" className="duplicate-modal">
        {groups.map((g) => <GroupCard key={`${g.scenario}-${g.quest}`} group={g} />)}
      </Modal>
    </>
  );
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const [keep, setKeep] = useState(defaultKeep(group));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const selected = group.battles.some((b) => b.id === keep) ? keep : defaultKeep(group);
  const name = `dup-${group.scenario}-${group.quest ?? "x"}`;
  const resolve = async () => {
    setWorking(true);
    setError("");
    try { await resolveDuplicates(selected, discardFor(group, selected)); }
    catch (e) { setError((e as Error).message); setWorking(false); }
  };
  return (
    <section className="duplicate-group">
      <h3>{group.name}</h3>
      <div role="radiogroup" aria-label={group.name}>
        {group.battles.map((b) => (
          <label key={b.id} className={`duplicate-copy${b.id === selected ? " selected" : ""}`}>
            <input type="radio" name={name} checked={b.id === selected} onChange={() => setKeep(b.id)} />
            <span className="duplicate-when">{new Date(b.started_at).toLocaleString()}</span>
            <span>Turn {b.turn}</span>
            <span>{b.enemies_start >= b.enemies_defeated && b.enemies_start > 0 ? `${b.enemies_defeated}/${b.enemies_start}` : b.enemies_defeated} defeated</span>
            <span>{clock(b.seconds)}</span>
          </label>
        ))}
      </div>
      <div className="duplicate-actions">
        {error && <span className="field-error" role="alert">{error}</span>}
        <button type="button" className="btn small" disabled={working} onClick={resolve}>Keep selected</button>
      </div>
    </section>
  );
}
