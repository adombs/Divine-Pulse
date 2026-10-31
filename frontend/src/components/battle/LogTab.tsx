/**
 * The battle's log, on the Overview: newest first, as a list or the timelines as a tree. The Timeline picker goes
 * through the Divine Pulse uses, from Divine Pulse 0 (the battle as it first went) to the one that stands now. In the
 * list, the timeline that stands follows the replay, and picking a row sends the replay there.
 */
import { useMemo, useState } from "react";
import type { Battle } from "../../api";
import { Section } from "../layout";
import { Segmented } from "../ui";
import { Item, pulseTimeline, timelineColumns } from "./model";
import { ItemList } from "./parts";
import { Timelines } from "./Timelines";

interface Props {
  battle: Battle;
  /** Everything in the timeline that stands (model.timeline). */
  items: Item[];
  /** Its rows as the replay shows them (replay.replayLog), the row the replay is at, and what picking a row does. */
  shown: Item[];
  current: number | null;
  onSelect: (item: Item) => void;
}

export function LogView({ battle, items: standing, shown, current, onSelect }: Props) {
  // Which timeline: Divine Pulse 0 is the original one, each Divine Pulse use starts the next; the last one stands.
  const pulses = battle.branches?.length ?? 0;
  const [pick, setPick] = useState<number | null>(null); // null: the one that stands
  // Each pick is numbered, so picking a Divine Pulse in the tree replays it even when it was picked before.
  const [jumps, setJumps] = useState(0);
  const chosen = pick === null || pick > pulses ? pulses : pick;
  const undone = useMemo(() => (chosen === pulses ? null : pulseTimeline(battle, chosen).filter((i) => !i.heading)), [battle, chosen, pulses]);
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
            setPick(n);
            setJumps((j) => j + 1);
          }}
        />
      )}
    </span>
  );

  return (
    <Section title="Log" right={tools}>
      {asTree ? (
        <Timelines columns={columns} current={current} jump={jumps ? { pulse: chosen, n: jumps } : null} />
      ) : undone ? (
        <ItemList items={undone} empty="Nothing logged in this timeline." />
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
