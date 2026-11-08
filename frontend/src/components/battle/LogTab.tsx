/**
 * The battle's log, on the Overview: one chronology of everything that happened, undone actions included, with a row
 * where each Divine Pulse was used, as a list or the timelines as a tree. The picker in the corner jumps to where a
 * Divine Pulse was used; it never changes what the log shows. Picking a row sends the replay there.
 */
import { useMemo, useState } from "react";
import type { Battle } from "../../api";
import { Section } from "../layout";
import { Segmented } from "../ui";
import type { Pulse } from "./chronicle";
import { Item, timelineColumns } from "./model";
import { ItemList } from "./parts";
import { Timelines } from "./Timelines";

interface Props {
  battle: Battle;
  /** The timeline that stands (model.timeline), for the tree. */
  items: Item[];
  /** The log's rows (chronicle.log), the beat the replay is at (null: now), and what picking a row does. */
  shown: Item[];
  current: number | null;
  onSelect: (item: Item) => void;
  /** Every use of Divine Pulse, and what picking one does. */
  pulses: Pulse[];
  onJump: (pulse: Pulse) => void;
  /** Whether every use of Divine Pulse can be replayed on the map. */
  complete: boolean;
  /** Where the replay is on the timeline that stands (a history position), for the tree; null elsewhere. */
  standing: number | null;
}

export function LogView({ battle, items: timeline, shown, current, onSelect, pulses, onJump, complete, standing }: Props) {
  // Each pick is numbered, so picking a Divine Pulse in the tree replays it even when it was picked before.
  const [jumps, setJumps] = useState<{ pulse: number; n: number } | null>(null);
  // The timelines as a tree (needs the game's history positions).
  const columns = useMemo(() => timelineColumns(battle, timeline), [battle, timeline]);
  const [layout, setLayout] = useState<"list" | "tree">("list");
  const asTree = layout === "tree" && columns !== null;

  const tools = (
    <span className="log-tools">
      {columns && (
        <Segmented<"list" | "tree">
          label="View"
          size="mini"
          value={layout}
          onChange={setLayout}
          options={[
            ["list", "List"],
            ["tree", "Tree"],
          ]}
        />
      )}
      <PulsePicker
        pulses={pulses}
        onChange={(pulse) => {
          onJump(pulse);
          setJumps((j) => ({ pulse: pulse.index + 1, n: (j?.n ?? 0) + 1 }));
        }}
      />
    </span>
  );

  return (
    <Section title="Log" right={tools}>
      {!complete && <p className="muted">Map replay of the undone actions is unavailable in an older recording.</p>}
      {asTree ? (
        <Timelines columns={columns} current={standing} jump={jumps} />
      ) : (
        <ItemList items={shown} current={current} empty="Nothing logged yet." onSelect={onSelect} />
      )}
    </Section>
  );
}

/** Always there: jumps to where a Divine Pulse was used. It keeps no value of its own, so the same one can be picked again. */
function PulsePicker({ pulses, onChange }: { pulses: Pulse[]; onChange: (pulse: Pulse) => void }) {
  return (
    <select
      className="log-pulse"
      aria-label="Jump to a Divine Pulse"
      value=""
      disabled={!pulses.length}
      onChange={(e) => {
        const pulse = pulses[Number(e.target.value)];
        if (pulse) onChange(pulse);
      }}
    >
      <option value="">{pulses.length ? "Jump to Divine Pulse…" : "No Divine Pulse used"}</option>
      {pulses.map((p) => (
        <option key={p.index} value={p.index}>
          Divine Pulse {p.index + 1}
          {p.turn !== null ? ` · Turn ${p.turn}` : ""}
        </option>
      ))}
    </select>
  );
}
