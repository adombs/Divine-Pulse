import { CONCEPT_ICON } from "./icons/concepts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, AutoStatus, Battle, type GameAssetsJob } from "./api";
import { useEvents } from "./useEvents";
import { useBootstrap } from "./useBootstrap";
import { useBattleSync } from "./useBattleSync";
import { Home } from "./components/Home";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import "./components/sidebar-motion.css";
import { Toasts, useToasts } from "./components/Toasts";
import { RunIcon, runIconUrl } from "./components/ui";
import { PortraitPhaseContext, useAppearance } from "./appearance";
import { showPart2 } from "./portraits";
import { NavProvider, Page, useNavState } from "./nav";
import { PeopleFiltersContext, usePeopleFiltersState } from "./filters";
import { gameAssetsAvailable, gameAssetUrl, loadGameAssetsStatus, onGameAssetsChange } from "./gameAssets";
import { GameAssetAlert } from "./components/GameAssetAlert";
import { reportAssetIssue } from "./requiredAssets";
import { GameFilesGate } from "./components/GameFilesGate";
import { loadPortraitIndex } from "./portraits";
import { loadReferenceIcons } from "./reference/icons";
import { loadBattleIndexes } from "./components/battle/factions";
import { loadScenarioText } from "./components/battle/scenarios";

const BattlePage = lazy(() => import("./components/battle/BattlePage").then((module) => ({ default: module.BattlePage })));
const Dashboard = lazy(() => import("./components/Dashboard").then((module) => ({ default: module.Dashboard })));
const Runs = lazy(() => import("./components/Runs").then((module) => ({ default: module.Runs })));
const SettingsPage = lazy(() => import("./components/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const HistoryPage = lazy(() => import("./components/HistoryPage").then((module) => ({ default: module.HistoryPage })));
const ArchivePage = lazy(() => import("./components/reference/ArchivePage").then((module) => ({ default: module.ArchivePage })));
const SupportsPage = lazy(() => import("./components/reference/SupportsPage").then((module) => ({ default: module.SupportsPage })));

/** Units whose loss ends the battle in defeat (as CRITICAL in backend/app/domain/battle.py). */
const CRITICAL_UNITS = new Set(["byleth", "edelgard", "dimitri", "claude"]);

const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "roster", label: "Roster" },
  { id: "battle", label: "Battle" },
  { id: "history", label: "History" },
  { id: "archive", label: "Archive" },
  { id: "supports", label: "Supports" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

/** Pages showing a run's data: hidden until a run is loaded in this session. */
const RUN_PAGES = new Set<Page>(["roster", "battle", "history", "runs"]);

function statusText(a: AutoStatus | null): string {
  if (!a) return "Starting…";
  switch (a.state) {
    case "no_run": return "No active run";
    case "error": return "Tracking unavailable";
    case "off": return "Tracking off";
    case "watching": return a.seeing ? `Tracking · ${a.seeing}` : "Tracking game";
  }
}

export default function App() {
  const [assetsVersion, setAssetsVersion] = useState(0);
  const [assetsAvailable, setAssetsAvailable] = useState<boolean | null>(null);
  const [indexesReady, setIndexesReady] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const unsubscribe = onGameAssetsChange((status) => { setAssetsVersion((v) => v + 1); setAssetsAvailable(status.available); });
    void loadGameAssetsStatus().then((status) => { if (live) setAssetsAvailable(status.available); });
    const events = new EventSource("/api/events");
    const refresh = () => { void loadGameAssetsStatus(true); };
    events.addEventListener("game_assets", refresh);
    return () => { live = false; events.close(); unsubscribe(); };
  }, []);
  useEffect(() => {
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setIndexesReady(false);
      setIndexError(null);
      if (!gameAssetsAvailable()) return;
      void Promise.all([loadPortraitIndex(), loadReferenceIcons(), loadBattleIndexes(), loadScenarioText()])
        .then(() => { if (current === generation) setIndexesReady(true); })
        .catch((error: unknown) => { if (current === generation) setIndexError(error instanceof Error ? error.message : String(error)); });
    };
    const offAssets = onGameAssetsChange(load);
    void loadGameAssetsStatus().then((status) => {
      if (status.available) load();
    }).catch((error: unknown) => setIndexError(error instanceof Error ? error.message : String(error)));
    return () => { generation++; offAssets(); };
  }, []);
  useEffect(() => {
    let live = true;
    for (const name of ["wall", "grid", ...["floor", "forest", "thicket", "cover", "sand", "water", "shoal", "heal", "hazard", "siege", "fliers", "impassable"].map((n) => `tile-${n}`)]) {
      const property = `--map-${name}`;
      document.documentElement.style.removeProperty(property);
      if (!gameAssetsAvailable()) continue;
      const url = gameAssetUrl(`images/map/minimap-pieces/${name}.png`);
      const image = new Image();
      image.onload = () => { if (live) document.documentElement.style.setProperty(property, `url("${url}")`); };
      image.onerror = () => { if (live) reportAssetIssue(`images/map/minimap-pieces/${name}.png`, "unreadable"); };
      image.src = url;
    }
    return () => { live = false; };
  }, [assetsVersion]);
  const nav = useNavState();
  const { go: goNav } = nav;
  const wasGated = useRef(false);
  useEffect(() => {
    if (assetsAvailable === false) wasGated.current = true;
    if (assetsAvailable && wasGated.current) {
      wasGated.current = false;
      goNav({ page: "home" }, { replace: true });
    }
  }, [assetsAvailable, goNav]);
  const routeId = nav.route.id;
  const page = nav.route.page;
  const setPage = (p: Page) => nav.go({ page: p });
  const bootstrap = useBootstrap();
  const { runs, activeRunId, loaded, units, auto } = bootstrap;
  const { loadRuns, loadUnits, loadAuto, retryStartup } = bootstrap;
  const peopleFilters = usePeopleFiltersState(loaded);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const appearance = useAppearance();
  const toasts = useToasts();
  const { push: pushToast } = toasts;
  const [importJob, setImportJob] = useState<GameAssetsJob | null>(null);
  const previousImport = useRef<GameAssetsJob["state"] | null>(null);
  const updateImport = useCallback((job: GameAssetsJob | null) => {
    if (previousImport.current === "running" && job?.state === "done") {
      pushToast({ kind: "ok", title: "Game files imported" });
    } else if (previousImport.current === "running" && job?.state === "failed") {
      pushToast({ kind: "error", title: "Game file import failed", body: `${job.error || "The import could not be completed."} Check the dump folder and try again.` });
    }
    previousImport.current = job?.state ?? null;
    setImportJob(job);
  }, [pushToast]);
  useEffect(() => {
    let live = true;
    void api.gameFilesStatus().then((status) => { if (live && previousImport.current === null) updateImport(status.job ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [updateImport]);
  useEffect(() => {
    if (importJob?.state !== "running") return;
    let live = true;
    const timer = window.setInterval(() => {
      void api.gameFilesStatus().then((status) => { if (live && previousImport.current === "running") updateImport(status.job ?? null); }).catch(() => {});
    }, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [importJob?.state, updateImport]);
  const refreshAuto = useCallback(async () => {
    try {
      await loadAuto();
    } catch (error) {
      pushToast({
        kind: "error",
        title: "Couldn't refresh tracker status",
        body: error instanceof Error ? error.message : String(error),
        action: { label: "Retry", run: () => { void refreshAuto(); } },
      });
    }
  }, [loadAuto, pushToast]);

  const battleSync = useBattleSync(activeRunId, {
    missingRecording: () => {
      pushToast({ kind: "warning", title: "This battle is no longer in the history" });
      goNav({ page: "history" }, { replace: true });
    },
    failedRecording: () => {
      pushToast({ kind: "error", title: "Couldn't load this battle recording" });
      goNav({ page: "history" }, { replace: true });
    },
  });
  const { battle, recording, loadBattle, loadRecording } = battleSync;
  const [battleVersion, setBattleVersion] = useState(0);
  const redirectedBattles = useRef(new Set<string>());
  useEffect(() => { void loadBattle(); }, [activeRunId, loadBattle]);

  const connected = useEvents({
    game_assets: (data) => updateImport((data as { job?: GameAssetsJob }).job ?? null),
    hello: (data) => {
      const notices = (data as { notices?: unknown } | null)?.notices;
      if (Array.isArray(notices)) notices.forEach((notice) => toasts.push({ kind: "warning", title: String(notice) }));
      return Promise.all([loadRuns(), loadUnits(), loadAuto(), loadBattle()]).then(() => undefined);
    },
    battle: (data) => {
      const refresh = Promise.all([loadBattle(), loadRuns()]).then(() => undefined);
      // The history only changes when a battle ends or one is deleted, not on every update of the live battle.
      const d = data as { active?: boolean; history?: boolean } | null;
      if (!d?.active || d.history) setBattleVersion((v) => v + 1);
      return refresh;
    },
    runs_changed: () => loadRuns(),
    units_changed: (data) => {
      const d = data as { run_id: string; unit_key?: string } | null;
      const refresh = Promise.all([
        ...(d?.run_id === activeRunId ? [loadUnits()] : []),
        loadRuns(),
      ]).then(() => undefined);
      if (d?.unit_key) {
        setFlashKey(d.unit_key);
        window.setTimeout(() => setFlashKey(null), 1600);
      }
      return refresh;
    },
    auto: (data) => bootstrap.acceptAuto(data as AutoStatus),
    roster_warning: (data) => {
      const { message } = data as { message: string };
      pushToast({ kind: "warning", title: "Roster update", body: message });
    },
  });

  // In-battle filter: which units are in the battle in progress, and whether the Roster shows
  // only them. It switches on when a battle starts and off when it ends.
  const [battleOnly, setBattleOnly] = useState(false);
  const battleKeys = auto?.battle ?? [];
  const inBattle = loaded && battleKeys.length > 0;
  const wasInBattle = useRef(false);
  useEffect(() => {
    if (inBattle && !wasInBattle.current) {
      setBattleOnly(true);
      toasts.push({ kind: "info", title: `Battle started · showing the ${battleKeys.length} unit${battleKeys.length === 1 ? "" : "s"} in it`, ttl: 3000 });
    } else if (!inBattle && wasInBattle.current) {
      setBattleOnly(false);
    }
    wasInBattle.current = inBattle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBattle, toasts]);

  // Open the Battle page once per live battle in this session.
  const battleActive = battle?.active === true;
  useEffect(() => {
    if (!loaded || !battleActive || !battle) return;
    const key = `divine-pulse:battle-page-redirected:${battle.run_id}:${battle.id}`;
    if (redirectedBattles.current.has(key)) return;
    redirectedBattles.current.add(key);
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private/locked-down storage should not stop the page from following a new battle.
    }
    goNav({ page: "battle" });
  }, [battle, battleActive, goNav, loaded]);

  // Battle alerts: a unit leaving the battle (it may have fallen) or a Divine Pulse. Only for events that
  // arrive while the app is open, not those already in the battle when it loads.
  const seenEvents = useRef<{ id: string; count: number } | null>(null);
  useEffect(() => {
    if (!battle) {
      seenEvents.current = null;
      return;
    }
    const seen = seenEvents.current;
    if (loaded && seen?.id === battle.id) {
      for (const e of battle.events.slice(seen.count)) {
        if (e.kind === "left") {
          const critical = e.unit !== undefined && e.unit !== null && CRITICAL_UNITS.has(e.unit);
          toasts.push(
            critical
              ? { kind: "error", title: e.text, body: "Losing them loses the battle, unless you turn back time with Divine Pulse." }
              : { kind: "warning", title: e.text, body: "It may have fallen: check the map." },
          );
        }
        else if (e.kind === "divine_pulse") toasts.push({ kind: "info", title: "Divine Pulse used", body: e.text, ttl: 4000 });
      }
    }
    seenEvents.current = { id: battle.id, count: battle.events.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle]);

  const activeRun = loaded ? runs.find((r) => r.id === activeRunId) ?? null : null;
  const iconRoute = runs.find((r) => r.id === activeRunId)?.route;
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    const bundled = runIconUrl(iconRoute);
    if (!bundled || !gameAssetsAvailable()) return;
    icon.onerror = () => { icon.onerror = null; icon.removeAttribute("href"); reportAssetIssue(bundled, "unreadable"); };
    icon.href = gameAssetUrl(bundled);
  }, [iconRoute, assetsVersion]);

  // The app opens on Home, asking for a run to load. Preserve an explicitly addressed
  // recording so loading a run can honour a #/battle/<id> bookmark.
  useEffect(() => {
    if (nav.route.page === "home") nav.go({ page: "home" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Without a loaded run only the reference pages are open; anything else goes back to Home.
  const pages = loaded ? PAGES : PAGES.filter((p) => !RUN_PAGES.has(p.id));
  useEffect(() => {
    if (!loaded && RUN_PAGES.has(page) && !(page === "battle" && nav.route.id)) nav.go({ page: "home" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, page]);

  // Resolve a direct canonical recording link after its run has loaded. The request token in
  // loadRecording ignores stale replies after a run switch or a live battle begins.
  useEffect(() => {
    const id = routeId;
    if (!loaded || page !== "battle" || !id || !activeRunId) return;
    if (battleActive) {
      goNav({ page: "battle" }, { replace: true });
      return;
    }
    if (recording?.id !== id) void loadRecording(id, activeRunId);
  }, [activeRunId, battleActive, goNav, loadRecording, loaded, page, recording?.id, routeId]);

  const switchRun = async (id: string) => {
    await bootstrap.switchRun(id);
    battleSync.setRun(id);
    await loadBattle();
  };

  const openRecording = useCallback((selected: Battle, at?: string) => {
    if (!battleSync.openRecording(selected)) return;
    nav.go({ page: "battle", id: selected.id, q: at });
  }, [battleSync.openRecording, nav]);

  const deleteRecording = useCallback(async () => {
    if (!recording || !activeRunId || !confirm(`Delete this battle (${new Date(recording.started_at).toLocaleString()}) from the history?`)) return;
    try {
      await api.deleteBattle(activeRunId, recording.id);
      battleSync.clearRecording();
      setBattleVersion((v) => v + 1);
      nav.go({ page: "history" }, { replace: true });
    } catch (e) {
      toasts.push({ kind: "error", title: "Couldn't delete the battle", body: (e as Error).message });
    }
  }, [activeRunId, battleSync.clearRecording, nav, recording, toasts]);

  const battleAvailable = battleActive || recording !== null;
  const status = connected ? statusText(auto && !loaded ? { ...auto, seeing: null } : auto) : "Tracker disconnected";
  const tracking = connected && auto?.state === "watching";
  const portraitPhase = appearance.appearance.portraits;
  const part2 = showPart2(portraitPhase, units);

  if (assetsAvailable === null) return null;
  if (!assetsAvailable) return <GameFilesGate toasts={toasts} />;
  if (!indexesReady) return indexError ? <><div className="startup-error" role="alert">Game files could not be loaded: {indexError}</div><GameFilesGate toasts={toasts} /></> : <main className="game-files-gate"><p role="status">Loading game files…</p></main>;
  if (wasGated.current) return null;

  return (
    <NavProvider nav={nav}>
    <PeopleFiltersContext.Provider value={peopleFilters}>
    <PortraitPhaseContext.Provider value={portraitPhase}>
    <div className="app nav-collapsed">
      <Sidebar>
        <div className="side-banner" title={activeRun?.name ?? "Divine Pulse"}>
          <RunIcon route={activeRun?.route} />
          <span className="banner-title">{activeRun?.name ?? "Divine Pulse"}</span>
        </div>
        <nav id="sidebar-pages" className="side-tabs" aria-label="Pages">
          {pages.map((p) => (
            <button
              key={p.id}
              className={`${page === p.id ? "side-tab active" : "side-tab"}${p.id === "battle" && !battleAvailable ? " disabled" : ""}`}
              onClick={() => setPage(p.id)}
              disabled={p.id === "battle" && !battleAvailable}
              aria-disabled={p.id === "battle" && !battleAvailable ? true : undefined}
              aria-current={page === p.id ? "page" : undefined}
              title={p.id === "battle" && !battleAvailable ? "Start a battle or open one from History" : undefined}
              aria-label={p.id === "battle" && !battleAvailable ? "Battle unavailable: start a battle or open one from History" : p.label}
            >
              <span className="side-diamond">
                <Icon name={CONCEPT_ICON[p.id]} />
              </span>
              <span className="side-label">{p.label}</span>
              {p.id === "battle" && battle && <span className="live-dot" title="Battle in progress" />}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {importJob?.state === "running" && <button type="button" className="link-btn auto-status" title={`Importing game files ${importJob.done}/${importJob.total}`} aria-label={`Importing game files${importJob.total > 0 ? ` ${importJob.done}/${importJob.total}` : ""}; open Game files`} onClick={() => nav.go({ page: "settings", tab: "game-files" })}>
            <Icon name={CONCEPT_ICON.settings} /><span className="status-text">Importing game files{importJob.total > 0 ? ` ${importJob.done}/${importJob.total}` : "\u2026"}</span>
          </button>}
          <div className={`auto-status ${auto?.state === "watching" ? "on" : ""} ${auto?.seeing ? "seeing" : ""}`} role="status" title={auto?.state === "error" && connected ? auto.message : status}>
            <span className={tracking ? "dot online" : "dot offline"} />
            <span className="status-text">{status}</span>
          </div>
        </div>
      </Sidebar>

      <main className="sheet">
        <GameAssetAlert onGameFiles={() => nav.go({ page: "settings", tab: "game-files" })} />
        <ErrorBoundary resetKey={`${page}/${routeId ?? ""}/${assetsVersion}`}>
        {bootstrap.startup.error && (
          <div className="startup-error" role="alert">
            <span>Couldn't start the tracker: {bootstrap.startup.error}</span>
            <button type="button" className="btn" onClick={() => void retryStartup()} disabled={bootstrap.startup.loading}>
              {bootstrap.startup.loading ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
          <Suspense fallback={null}>
            {(page === "home" || (!loaded && page === "battle" && !!nav.route.id)) && (
              <Home runs={runs} activeRunId={activeRunId} loaded={loaded} toasts={toasts} onSwitchRun={switchRun} onRunsChanged={loadRuns} />
            )}
            {loaded && page === "roster" && (
              <Dashboard
                run={activeRun}
                units={units}
                flashKey={flashKey}
                part2={part2}
                onGoToRuns={() => setPage("runs")}
                toasts={toasts}
                battleKeys={battleKeys}
                battleOnly={battleOnly && inBattle}
                onBattleOnly={setBattleOnly}
              />
            )}
            {loaded && page === "battle" && (
              <BattlePage
                battle={battle}
                recording={recording}
                runId={activeRunId}
                version={battleVersion}
                units={units}
                part2={part2}
                mapLook={{ mine: appearance.appearance.mapMine, others: appearance.appearance.mapOthers, myFaces: appearance.appearance.myUnitFaces, otherFaces: appearance.appearance.otherUnitFaces }}
                replaySpeed={appearance.appearance.replaySpeed}
                onReplaySpeed={(replaySpeed) => appearance.update({ replaySpeed })}
                at={recording?.id === nav.route.id ? nav.route.q : null}
                fell={recording?.id === nav.route.id ? nav.route.fell : null}
                onDeleteRecording={deleteRecording}
                route={iconRoute}
              />
            )}
            {loaded && page === "history" && (
              <HistoryPage
                runId={activeRunId}
                live={battle}
                version={battleVersion}
                units={units}
                part2={part2}
                onOpenRecording={openRecording}
              />
            )}
            {page === "archive" && <ArchivePage units={units} part2={part2} />}
            {page === "supports" && <SupportsPage units={units} part2={part2} />}
            {loaded && page === "runs" && <Runs runs={runs} activeRunId={activeRunId} onActivate={switchRun} toasts={toasts} />}
            {page === "settings" && (
              <SettingsPage
                appearance={appearance}
                toasts={toasts}
                onSaved={(s) => {
                  bootstrap.setSettings(s);
                  void refreshAuto();
                }}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      <Toasts state={toasts} />
    </div>
    </PortraitPhaseContext.Provider>
    </PeopleFiltersContext.Provider>
    </NavProvider>
  );
}
