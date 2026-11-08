/**
 * The battle themes a replay video can play (extracted at import: backend gamefiles/extract/music.py writes
 * data/music.json and audio/bgm/<id>.ogg, each the theme's calm Rain version), the theme each battle plays in the game
 * (by scenario id), and the soundtrack of a video: the theme looped seamlessly for as long as the video runs, faded out
 * at the end.
 */
import { gameAssetUrl, loadGameJson } from "../gameAssets";

export interface Theme {
  id: string;
  title: string;
  /** Where it plays, for grouping the picker ("Part I", "Final battles", ...). */
  group: string;
  file: string;
  rate: number;
  channels: number;
  samples: number;
  /** The loop the game plays (in samples): after the intro, from loop_start for loop_length, over and over. */
  loop_start: number;
  loop_length: number;
}

export interface Music {
  themes: Theme[];
  /** The theme each battle plays, by scenario id. */
  scenarios: Record<string, string>;
}

/** The themes, or null when the game files were imported before music was (re-importing adds it). */
export async function loadMusic(): Promise<Music | null> {
  const data = await loadGameJson<{ tracks?: Theme[]; scenarios?: Record<string, string> }>("data/music.json");
  if (!data || !Array.isArray(data.tracks) || !data.tracks.length) return null;
  return { themes: data.tracks, scenarios: data.scenarios ?? {} };
}

/** The picker's groups, in the order they come up in the game. */
export const THEME_GROUPS = ["Part I", "Part II", "Final battles", "Boss battles", "Paralogues and side battles", "Cindered Shadows"];

/** The theme a battle plays in the game; the first theme when the battle isn't known. */
export function defaultTheme(music: Music, scenario: number | null | undefined): Theme {
  const id = scenario === null || scenario === undefined ? undefined : music.scenarios[String(scenario)];
  return music.themes.find((t) => t.id === id) ?? music.themes[0];
}

/** A theme's audio, fetched and decoded once. */
const decoded = new Map<string, Promise<AudioBuffer>>();
function themeAudio(theme: Theme): Promise<AudioBuffer> {
  let found = decoded.get(theme.id);
  if (!found) {
    found = (async () => {
      const response = await fetch(gameAssetUrl(theme.file));
      if (!response.ok) throw new Error(`The music file ${theme.file} couldn't be read (${response.status}). Re-import your game files.`);
      const bytes = await response.arrayBuffer();
      const context = new OfflineAudioContext(theme.channels || 2, 1, theme.rate || 48000);
      return context.decodeAudioData(bytes);
    })();
    found.catch(() => decoded.delete(theme.id));
    decoded.set(theme.id, found);
  }
  return found;
}

/** How long the music fades out at the end of a video (s). */
const FADE_OUT = 2.5;

/**
 * The soundtrack of a video `seconds` long: the theme from its start, looping as the game loops it, at `volume`
 * (0-1), faded out over the last seconds.
 */
export async function soundtrack(theme: Theme, seconds: number, volume: number): Promise<AudioBuffer> {
  const audio = await themeAudio(theme);
  const rate = audio.sampleRate;
  const context = new OfflineAudioContext(audio.numberOfChannels, Math.max(1, Math.ceil(seconds * rate)), rate);
  const source = context.createBufferSource();
  source.buffer = audio;
  const start = theme.loop_start / theme.rate;
  const end = (theme.loop_start + theme.loop_length) / theme.rate;
  if (theme.loop_length > 0 && end <= audio.duration + 0.01) {
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = Math.min(end, audio.duration);
  }
  const gain = context.createGain();
  const fade = Math.min(FADE_OUT, seconds / 3);
  gain.gain.setValueAtTime(volume, 0);
  gain.gain.setValueAtTime(volume, Math.max(0, seconds - fade));
  gain.gain.linearRampToValueAtTime(0, seconds);
  source.connect(gain).connect(context.destination);
  source.start(0);
  return context.startRendering();
}

let previewing: { audio: HTMLAudioElement; id: string } | null = null;

/** Plays a theme from its start (or stops it, if it's the one playing). Returns whether it's playing now. */
export function previewTheme(theme: Theme | null, volume = 0.8): boolean {
  const same = previewing?.id === theme?.id;
  previewing?.audio.pause();
  previewing = null;
  if (!theme || same) return false;
  const audio = new Audio(gameAssetUrl(theme.file));
  audio.volume = volume;
  audio.addEventListener("ended", () => {
    if (previewing?.audio === audio) previewing = null;
  });
  void audio.play().catch(() => undefined);
  previewing = { audio, id: theme.id };
  return true;
}
