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
import { RunStatsPopup } from "./battle/RunStatsPopup";
import { runBattles } from "./battle/stats";

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
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [stats, setStats] = useState<"battles" | "characters" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (!runId) {
      setHistory([]);
      return () => { cancelled = true; };
    }
    setHistory(null);
    api.battles(runId).then(
      (battles) => { if (!cancelled) setHistory(battles); },
      () => { if (!cancelled) { setHistory([]); setError(true); } },
    );
    return () => { cancelled = true; };
  }, [runId, version, retry]);
  const battles = useMemo(() => history === null ? null : runBattles(history, live?.run_id === runId ? live : null), [history, live, runId]);
  const roster = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const { tab, id } = nav.route;

  return (
    <section className="history-page">
      <PageHeader title="History" />
      <StatsTab
        history={battles}
        onStats={() => setStats("characters")}
        roster={units}
        part2={part2}
        selected={tab === "stats" ? (id ?? null) : null}
        onSelect={(key, replace) => nav.go({ page: "history", tab: "stats", id: key }, { replace })}
        onOpen={(battleId, key) => {
          const battle = history?.find((b) => b.id === battleId);
          if (battle) onOpenRecording(battle, key);
        }}
        battlesSection={<>{error && <p className="notice" role="alert">Battle history could not be loaded. <button type="button" className="btn small" onClick={() => setRetry((n) => n + 1)}>Try again</button></p>}<BattleCards history={battles?.filter((b) => !b.active) ?? null} live={live?.run_id === runId ? live : null} roster={roster} part2={part2} onOpenRecording={onOpenRecording} onStats={() => setStats("battles")} /></>}
      />
      <RunStatsPopup kind={stats} onClose={() => setStats(null)} battles={battles} error={error} onRetry={() => setRetry((n) => n + 1)} />
    </section>
  );
}
