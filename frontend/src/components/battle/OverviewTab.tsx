/** The battle at a glance, on one screen: the map with its replay, your units, the log down the right, and the outlook
 * and key numbers under them. All of it follows the replay; picking a log row sends the replay there. The log and the
 * replay are one chronology of the battle (chronicle.ts), Divine Pulse uses and the actions they undid included. */
import { useMemo } from "react";
import type { Battle } from "../../api";
import { chronicle } from "./chronicle";
import { OverviewMap } from "./Minimap";
import type { Item } from "./model";
import { LogView } from "./LogTab";
import { KeyStats, OutlookCard, TrendChart } from "./parts";
import { beatOf, replayStats, useReplay } from "./replay";
import { UnitStatus } from "./UnitStatus";

export function OverviewTab({ battle, items, seconds }: { battle: Battle; items: Item[]; seconds: number }) {
  const chron = useMemo(() => chronicle(battle), [battle]);
  const replay = useReplay(battle, chron);
  const stats = replayStats(battle, replay, seconds);
  const chance = stats.chance;
  // The history position the replay is at, when that is on the timeline that stands (the last segment).
  const beat = replay.at === null ? null : replay.beats[replay.at];
  const standing = beat && beat.pos !== null && beat.segment === chron.pulses.length ? beat.pos : null;
  return (
    <div className="overview">
      <div className="overview-map">
        <OverviewMap battle={battle} replay={replay} />
      </div>
      <div className="overview-units">
        <UnitStatus battle={battle} replay={replay} />
      </div>
      <div className="overview-log log-scroll">
        <LogView
          battle={battle}
          items={items}
          shown={chron.log}
          current={replay.at}
          complete={chron.complete}
          pulses={chron.pulses}
          standing={standing}
          onJump={(pulse) => {
            if (pulse.beat !== null) replay.seek(pulse.beat);
          }}
          onSelect={(item) => {
            const i = beatOf(item);
            if (i !== null) replay.seek(i);
          }}
        />
      </div>
      <div className="overview-cards">
        {battle.outlook && chance !== null ? (
          <OutlookCard
            outlook={stats.at === null ? battle.outlook : { ...battle.outlook, chance, factors: [] }}
            trend={battle.trend}
            seconds={seconds}
            events={battle.events}
            at={stats.at}
          />
        ) : (
          chance !== null && (
            <div className={`outlook ${toneOf(chance)}`}>
              <div className="outlook-head">
                <span className="outlook-label">Outlook</span>
                <span className="outlook-pct">{Math.round(chance * 100)}%</span>
                <span className="muted">{stats.at === null ? "at the end" : "at this step"}</span>
              </div>
              <TrendChart trend={battle.trend} seconds={battle.seconds} events={battle.events} at={stats.at} />
            </div>
          )
        )}
        {/* The outlook has a card of its own beside these. */}
        <KeyStats battle={battle} seconds={seconds} except={["Outlook"]} numbers={stats.numbers} />
      </div>
    </div>
  );
}

export const toneOf = (chance: number) => (chance >= 0.7 ? "good" : chance >= 0.4 ? "even" : "bad");
