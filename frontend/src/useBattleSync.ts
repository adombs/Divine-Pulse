import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Battle } from "./api";
import { createBattleSync } from "./battleSync";

export function useBattleSync(
  activeRunId: string | null,
  effects: { missingRecording(): void; failedRecording(): void },
) {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [recording, setRecording] = useState<Battle | null>(null);
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const controller = useRef<ReturnType<typeof createBattleSync> | null>(null);
  if (!controller.current) {
    controller.current = createBattleSync(api, { battle: setBattle, recording: setRecording }, {
      missing: () => effectsRef.current.missingRecording(),
      failed: () => effectsRef.current.failedRecording(),
    });
  }
  useEffect(() => { controller.current!.setRun(activeRunId); }, [activeRunId]);
  const loadBattle = useCallback(() => controller.current!.loadBattle(), []);
  const loadRecording = useCallback((id: string, runId: string) => controller.current!.loadRecording(id, runId), []);
  const openRecording = useCallback((selected: Battle) => controller.current!.openRecording(selected), []);
  const clearRecording = useCallback(() => controller.current!.clearRecording(), []);
  const setRun = useCallback((runId: string | null) => controller.current!.setRun(runId), []);
  return { battle, recording, loadBattle, loadRecording, openRecording, clearRecording, setRun };
}
