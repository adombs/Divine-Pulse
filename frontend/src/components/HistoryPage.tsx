/**
 * History (#/history): the run's numbers and record, its battles as cards, standout records and each character over
 * the run (a character's at #/history/stats/<unit key>, so other pages can link to them). Past battles open on the
 * Battle page (#/battle/<id>), where the selected recording stays available while navigating.
 */
import { useEffect, useMemo, useState } from "react";
import { api, Battle, Unit } from "../api";
import { useNav } from "../nav";
import { PageHeader } from "./layout";
import { BattleCards } from "./battle/BattleCards";
import { StatsTab } from "./battle/StatsTab";

interface Props {
  runId: string | null;
  live: Battle | null;
  /** Bumped whenever battles change, to reload. */
  version: number;
  units: Unit[];
  part2: boolean;
  onOpenRecording: (battle: Battle, at?: string) => void;
}

export function HistoryPage({ runId, live, version, units, part2, onOpenRecording }: Props) {
  const nav = useNav();
  const [history, setHistory] = useState<Battle[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setHistory([]);
      return () => { cancelled = true; };
    }
    setHistory(null);
    api.battles(runId).then(
      (battles) => { if (!cancelled) setHistory(battles); },
      () => { if (!cancelled) setHistory([]); },
    );
    return () => { cancelled = true; };
  }, [runId, version]);
  const roster = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const { tab, id } = nav.route;

  return (
    <section className="history-page">
      <PageHeader title="History" />
      <StatsTab
        history={history}
        roster={units}
        part2={part2}
        selected={tab === "stats" ? (id ?? null) : null}
        onSelect={(key, replace) => nav.go({ page: "history", tab: "stats", id: key }, { replace })}
        onOpen={(battleId, key) => {
          const battle = history?.find((b) => b.id === battleId);
          if (battle) onOpenRecording(battle, key);
        }}
        battlesSection={<BattleCards history={history} live={live} roster={roster} part2={part2} onOpenRecording={onOpenRecording} />}
      />
    </section>
  );
}
