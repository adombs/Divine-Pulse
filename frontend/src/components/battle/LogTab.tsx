/**
 * The battle's log, on the Overview: in action order, as a list or the timelines as a tree. The Timeline picker goes
 * through the Divine Pulse uses, from Divine Pulse 0 (the battle as it first went) to the one that stands now. In the
 * list, the timeline that stands follows the replay, and picking a row sends the replay there.
 */
import { useMemo, useState } from "react";
import type { Battle } from "../../api";
import { Section } from "../layout";
import { Segmented } from "../ui";
import { Item, timelineColumns } from "./model";
import { ItemList } from "./parts";
import { Timelines } from "./Timelines";

interface Props {
  battle: Battle;
  /** Everything in the timeline that stands (model.timeline). */
  items: Item[];
  /** Its rows as the replay shows them (replay.replayLog), the row the replay is at, and what picking a row does. */
  pick: number | null;
  onPick: (pick: number | null) => void;
  available: boolean;
  shown: Item[];
  current: number | null;
  onSelect: (item: Item) => void;
}

export function LogView({ battle, items: standing, pick, onPick, available, shown, current, onSelect }: Props) {
  // Which timeline: Divine Pulse 0 is the original one, each Divine Pulse use starts the next; the last one stands.
  const pulses = battle.branches?.length ?? 0;
  // Each pick is numbered, so picking a Divine Pulse in the tree replays it even when it was picked before.
  const [jumps, setJumps] = useState(0);
  const chosen = pick === null || pick > pulses ? pulses : pick;
  // The timelines as a tree (needs the game's history positions).
  const columns = useMemo(() => timelineColumns(battle, standing), [battle, standing]);
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
      {pulses > 0 && (
        <PulsePicker
          pulses={pulses}
          value={chosen}
          onChange={(n) => {
            onPick(n === pulses ? null : n);
            setJumps((j) => j + 1);
          }}
        />
      )}
    </span>
  );

  return (
    <Section title="Log" right={tools}>
      {!available && <p className="muted">Map replay is unavailable for this timeline in an older recording.</p>}
      {asTree ? (
        <Timelines columns={columns} current={current} jump={jumps ? { pulse: chosen, n: jumps } : null} />
      ) : (
        <ItemList items={shown} current={current} empty="Nothing logged yet." onSelect={onSelect} />
      )}
    </Section>
  );
}

/** Divine Pulse 0 (the battle as it first went) to the latest use (the timeline that stands). */
function PulsePicker({ pulses, value, onChange }: { pulses: number; value: number; onChange: (n: number) => void }) {
  return (
    <select className="log-pulse" aria-label="Timeline" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: pulses + 1 }, (_, n) => (
        <option key={n} value={n}>
          Divine Pulse {n}
          {n === pulses ? " (now)" : n === 0 ? " (original)" : ""}
        </option>
      ))}
    </select>
  );
}
