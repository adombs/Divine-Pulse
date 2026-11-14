import { useEffect, useRef, useState } from "react";
import { themeAudio, type CustomAudio, type Track } from "./music";
import { customPlan, soundPlan, type SoundPlan } from "./soundtrack";

interface Voice { source: AudioBufferSourceNode; gain: GainNode; buffer: AudioBuffer; at: number; clock: number; }
/** Two independent voices, both following the export preview's clock, including seeks and loops. */
export function useReplayAudio(track: Track | null, custom: CustomAudio | null, ms: number, playing: boolean, total: number, musicVolume: number, ownVolume: number) {
  const context = useRef<AudioContext | null>(null);
  const resumePending = useRef<Promise<void> | null>(null);
  const enableAudio = () => {
    const ctx = context.current ?? (context.current = new AudioContext());
    if (ctx.state === "suspended" && !resumePending.current) {
      resumePending.current = ctx.resume().then(() => setError(null), () => setError("Press Play under the video to enable audio.")).finally(() => { resumePending.current = null; });
    }
  };
  const voices = useRef(new Map<string, Voice>());
  const [loaded, setLoaded] = useState<{ track: Track; buffer: AudioBuffer } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    if (track) void themeAudio(track).then((buffer) => { if (live) setLoaded({ track, buffer }); }, (e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [track]);
  useEffect(() => () => {
    for (const voice of voices.current.values()) voice.source.stop();
    voices.current.clear();
    void context.current?.close();
    context.current = null;
  }, []);
  useEffect(() => {
    const stop = (id: string) => {
      const voice = voices.current.get(id);
      if (voice) { voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); voices.current.delete(id); }
    };
    const seconds = ms / 1000;
    const sync = (id: string, buffer: AudioBuffer | null, plan: SoundPlan | null) => {
      if (!buffer || !plan || !playing || seconds >= total / 1000 || plan.volume <= 0) { stop(id); return; }
      const ctx = context.current ?? (context.current = new AudioContext());
      if (ctx.state === "suspended") { enableAudio(); setError("Press Play under the video to enable audio."); }
      let voice = voices.current.get(id);
      if (voice && (voice.buffer !== buffer || Math.abs(voice.at + ctx.currentTime - voice.clock - seconds) > 0.12)) { stop(id); voice = undefined; }
      if (!voice) {
        const at = seconds * buffer.sampleRate;
        const offset = plan.loop && at >= plan.loop.start + plan.loop.length ? plan.loop.start + (at - plan.loop.start) % plan.loop.length : at;
        if (offset >= buffer.length) { stop(id); return; }
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer;
        if (plan.loop) { source.loop = true; source.loopStart = plan.loop.start / buffer.sampleRate; source.loopEnd = (plan.loop.start + plan.loop.length) / buffer.sampleRate; }
        source.connect(gain); gain.connect(ctx.destination);
        source.start(0, offset / buffer.sampleRate);
        voice = { source, gain, buffer, at: seconds, clock: ctx.currentTime };
        voices.current.set(id, voice);
      }
      const sample = seconds * buffer.sampleRate;
      voice.gain.gain.value = plan.volume * (sample <= plan.fadeStart ? 1 : Math.max(0, 1 - (sample - plan.fadeStart) / plan.fadeLength));
    };
    const music = loaded?.track === track ? loaded.buffer : null;
    sync("theme", music, music && track ? soundPlan(track, music, total / 1000, musicVolume) : null);
    sync("custom", custom?.buffer ?? null, custom ? customPlan(custom.buffer, total / 1000, ownVolume) : null);
  }, [track, custom, loaded, ms, playing, total, musicVolume, ownVolume]);
  return { error, enableAudio };
}
