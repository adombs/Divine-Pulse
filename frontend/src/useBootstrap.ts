import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AutoStatus, RunSummary, ScanEntry, Settings, Unit } from "./api";
import { createUnitsLoader, requestGate } from "./requestGate";
import { createStartupController } from "./startup";
import type { StartupState } from "./startup";

export function useBootstrap() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [auto, setAuto] = useState<AutoStatus | null>(null);
  const [startup, setStartup] = useState<StartupState>({ loading: true, error: null });
  const loaded = loadedRunId !== null && loadedRunId === activeRunId;
  const runsGate = useRef(requestGate());
  const unitsLoader = useRef<ReturnType<typeof createUnitsLoader> | null>(null);
  if (!unitsLoader.current) unitsLoader.current = createUnitsLoader(api.units, setUnits);

  const loadRuns = useCallback(async () => {
    const isCurrent = runsGate.current.start();
    const result = await api.runs();
    if (!isCurrent()) return;
    setRuns(result.runs);
    setActiveRunId(result.active_run_id);
  }, []);
  const loadScans = useCallback(async () => setScans(await api.scans()), []);
  const loadAuto = useCallback(async () => setAuto(await api.auto()), []);

  const loadUnits = useCallback(() => unitsLoader.current!.load(), []);

  const startupLoader = useRef<ReturnType<typeof createStartupController> | null>(null);
  if (!startupLoader.current) {
    startupLoader.current = createStartupController(async () => {
      const [runData, scanData, settingsData, autoData] = await Promise.all([
        api.runs(), api.scans(), api.settings(), api.auto(),
      ]);
      return () => {
        setRuns(runData.runs);
        setActiveRunId(runData.active_run_id);
        setScans(scanData);
        setSettings(settingsData);
        setAuto(autoData);
      };
    }, setStartup);
  }
  const retryStartup = useCallback(() => startupLoader.current!.retry(), []);
  useEffect(() => { void retryStartup(); }, [retryStartup]);
  useEffect(() => {
    unitsLoader.current!.setRun(activeRunId, loaded);
    void loadUnits();
  }, [activeRunId, loaded, loadUnits]);

  const switchRun = useCallback(async (id: string) => {
    await api.activateRun(id);
    startupLoader.current!.invalidate();
    runsGate.current.invalidate();
    setActiveRunId(id);
    setLoadedRunId(id);
    unitsLoader.current!.setRun(id, true);
    void startupLoader.current!.retry();
  }, []);
  const acceptAuto = useCallback((value: AutoStatus) => setAuto(value), []);

  return {
    runs, activeRunId, loaded, units, scans, settings, auto, startup,
    retryStartup, switchRun, loadRuns, loadUnits, loadScans, loadAuto,
    acceptAuto, setSettings,
  };
}
