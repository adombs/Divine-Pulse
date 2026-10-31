/** The battle at a glance, on one screen: the map with its replay, your units, the log down the right, and the outlook
 * and key numbers under them. All of it follows the replay; picking a log row sends the replay there. */
import type { Battle } from "../../api";
import { OverviewMap } from "./Minimap";
import { Item } from "./model";
import { LogView } from "./LogTab";
import { KeyStats, OutlookCard, TrendChart } from "./parts";
import { replayLog, replayStats, stepOf, useReplay } from "./replay";
import { UnitStatus } from "./UnitStatus";

export function OverviewTab({ battle, items, seconds }: { battle: Battle; items: Item[]; seconds: number }) {
  const replay = useReplay(battle);
  const log = replayLog(items, replay);
  const stats = replayStats(battle, replay, items, seconds);
  const chance = stats.chance;
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
          shown={log.shown}
          current={log.current}
          onSelect={(item) => {
            const i = stepOf(item, replay.steps);
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
