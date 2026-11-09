/**
 * The battle themes a replay video can play (extracted at import: backend gamefiles/extract/music.py writes
 * data/music.json and audio/bgm/<id>.ogg: each theme's calm Rain version and its intense Thunder one, which imports
 * from before Thunder was added lack), the theme each battle plays in the game
 * (by scenario id), and the soundtrack of a video: the theme looped seamlessly for as long as the video runs, faded out
 * at the end.
 */
import { gameAssetUrl, loadGameJson } from "../gameAssets";
import { mixPiece, soundPlan } from "./soundtrack";

/** One recording of a theme: its audio file and the loop the game plays. */
export interface Track {
  id: string;
  file: string;
  rate: number;
  channels: number;
  samples: number;
  /** The loop the game plays (in samples): after the intro, from loop_start for loop_length, over and over. */
  loop_start: number;
  loop_length: number;
}

/** A theme is its Rain version (the Track itself) and, once imported, its Thunder one. */
export interface Theme extends Track {
  title: string;
  /** Where it plays, for grouping the picker ("Part I", "Final battles", ...). */
  group: string;
  thunder?: Track;
}

/** The two versions of a theme: the calm one, and the intense one. */
export type Version = "rain" | "thunder";

/** The recording of a theme in a version; its Rain one when it has no Thunder one. */
export function recording(theme: Theme, version: Version): Track {
  return version === "thunder" && theme.thunder ? theme.thunder : theme;
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

/** A recording's audio, fetched and decoded once. */
const decoded = new Map<string, Promise<AudioBuffer>>();
function themeAudio(theme: Track): Promise<AudioBuffer> {
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

/** The soundtrack is made this long a piece at a time (s). */
const PIECE = 1;

/**
 * The soundtrack of a video `seconds` long, in pieces of a second: the theme from its start, looping as the game loops
 * it, at `volume` (0-1), faded out over the last seconds. Only one piece is made at a time (and the theme's decoded
 * audio is dropped when the last one is), so a long video needs no more memory than a short one.
 */
export async function* soundtrack(theme: Track, seconds: number, volume: number): AsyncGenerator<AudioBuffer> {
  try {
    const audio = await themeAudio(theme);
    const plan = soundPlan(theme, audio, seconds, volume);
    const input = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const step = Math.round(PIECE * audio.sampleRate);
    for (let from = 0; from < plan.total; from += step) {
      const piece = new AudioBuffer({ length: Math.min(step, plan.total - from), numberOfChannels: input.length, sampleRate: audio.sampleRate });
      mixPiece(input, Array.from({ length: input.length }, (_, c) => piece.getChannelData(c)), from, plan);
      yield piece;
    }
  } finally {
    decoded.delete(theme.id);
  }
}

let previewing: { audio: HTMLAudioElement; id: string } | null = null;

/** Plays a theme from its start (or stops it, if it's the one playing). Returns whether it's playing now. */
export function previewTheme(theme: Track | null, volume = 0.8): boolean {
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
