/**
 * The battle themes a replay video can play (extracted at import: backend gamefiles/extract/music.py writes
 * data/music.json and audio/bgm/<id>.ogg: each theme's calm Rain version and its intense Thunder one, which imports
 * from before Thunder was added lack), the theme each battle plays in the game
 * (by scenario id), and the soundtrack of a video: the theme looped seamlessly for as long as the video runs, faded out
 * at the end.
 */
import { gameAssetUrl, loadGameJson } from "../gameAssets";
import { addTrack, customPlan, mixPiece, soundPlan, type SoundPlan } from "./soundtrack";

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
      if (!response.ok) throw new Error(`The music file ${theme.file} couldn't be read (${response.status}). Reprocess your game files.`);
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

/** Mixes `plan` over `audio` a piece of a second at a time, so a long video needs no more memory than a short one. */
function* pieces(audio: AudioBuffer, plan: SoundPlan): Generator<AudioBuffer> {
  const input = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const step = Math.round(PIECE * audio.sampleRate);
  for (let from = 0; from < plan.total; from += step) {
    const piece = new AudioBuffer({ length: Math.min(step, plan.total - from), numberOfChannels: input.length, sampleRate: audio.sampleRate });
    mixPiece(input, Array.from({ length: input.length }, (_, c) => piece.getChannelData(c)), from, plan);
    yield piece;
  }
}

/**
 * The soundtrack of a video `seconds` long, in pieces of a second: the theme from its start, looping as the game loops
 * it, at `volume` (0-1), faded out over the last seconds. Only one piece is made at a time (and the theme's decoded
 * audio is dropped when the last one is).
 */
export async function* soundtrack(theme: Track, seconds: number, volume: number): AsyncGenerator<AudioBuffer> {
  try {
    const audio = await themeAudio(theme);
    yield* pieces(audio, soundPlan(theme, audio, seconds, volume));
  } finally {
    decoded.delete(theme.id);
  }
}

/** Audio the player chose from their own files: decoded once when chosen, and kept for the previews and the export. */
export interface CustomAudio {
  name: string;
  /** The file's own length (s). */
  duration: number;
  /** Its decoded audio (at most `CUSTOM_KEEP` seconds of it; a video never needs more). */
  buffer: AudioBuffer;
  /** The file, for listening to it. */
  url: string;
}

/** The longest stretch of a chosen file that is kept once decoded (s), so a very long recording can't fill the memory. */
export const CUSTOM_KEEP = 20 * 60;
/** The biggest file read (bytes). */
export const CUSTOM_MAX_BYTES = 150 * 1024 * 1024;

/** Decodes a chosen audio file (whatever this window can decode: MP3, M4A/AAC, OGG, WAV, FLAC...). Throws a message fit to show. */
export async function loadCustomAudio(file: File): Promise<CustomAudio> {
  if (file.size > CUSTOM_MAX_BYTES) throw new Error(`${file.name} is bigger than ${Math.round(CUSTOM_MAX_BYTES / 1024 / 1024)} MB. Choose a shorter recording.`);
  let decodedAudio: AudioBuffer;
  try {
    decodedAudio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name} couldn't be read as audio. Try an MP3, M4A, OGG, WAV or FLAC file.`);
  }
  if (!(decodedAudio.length > 0)) throw new Error(`${file.name} has no sound in it.`);
  let buffer = decodedAudio;
  const keep = Math.round(CUSTOM_KEEP * decodedAudio.sampleRate);
  if (decodedAudio.length > keep) {
    buffer = new AudioBuffer({ length: keep, numberOfChannels: decodedAudio.numberOfChannels, sampleRate: decodedAudio.sampleRate });
    for (let c = 0; c < buffer.numberOfChannels; c++) buffer.copyToChannel(decodedAudio.getChannelData(c).subarray(0, keep), c);
  }
  return { name: file.name, duration: decodedAudio.duration, buffer, url: URL.createObjectURL(file) };
}

/** Lets go of a chosen file's listening copy. */
export function releaseCustomAudio(audio: CustomAudio | null): void {
  if (!audio) return;
  if (previewing?.id === CUSTOM_ID) previewTheme(null);
  URL.revokeObjectURL(audio.url);
}

/** The id the player's own audio goes by in the picker and the preview. */
export const CUSTOM_ID = "custom";

/** The soundtrack of a video `seconds` long from the player's audio: looped if shorter, cut if longer, faded out over the last second. */
export async function* customSoundtrack(audio: CustomAudio, seconds: number, volume: number): AsyncGenerator<AudioBuffer> {
  yield* pieces(audio.buffer, customPlan(audio.buffer, seconds, volume));
}

/** Mix both sources at a common rate, keeping the export bounded to one second at a time. */
export async function* mixedSoundtrack(theme: Track, custom: CustomAudio, seconds: number, musicVolume: number, customVolume: number): AsyncGenerator<AudioBuffer> {
  try {
    const source = await themeAudio(theme);
    const rate = 48000;
    const resample = async (audio: AudioBuffer) => {
      if (audio.sampleRate === rate) return audio;
      const context = new OfflineAudioContext(audio.numberOfChannels, Math.ceil(audio.duration * rate), rate);
      const node = context.createBufferSource();
      node.buffer = audio;
      node.connect(context.destination);
      node.start();
      return context.startRendering();
    };
    const [music, own] = await Promise.all([resample(source), resample(custom.buffer)]);
    const channels = Math.max(music.numberOfChannels, own.numberOfChannels);
    const inputs = (audio: AudioBuffer) => Array.from({ length: channels }, (_, c) => audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)));
    const musicInput = inputs(music), ownInput = inputs(own);
    const musicPlan = soundPlan(theme, music, seconds, musicVolume);
    const ownPlan = customPlan(own, seconds, customVolume);
    for (let from = 0; from < musicPlan.total; from += rate) {
      const piece = new AudioBuffer({ length: Math.min(rate, musicPlan.total - from), numberOfChannels: channels, sampleRate: rate });
      const out = Array.from({ length: channels }, (_, c) => piece.getChannelData(c));
      const extra = Array.from({ length: channels }, () => new Float32Array(piece.length));
      mixPiece(musicInput, out, from, musicPlan);
      mixPiece(ownInput, extra, from, ownPlan);
      addTrack(out, extra);
      yield piece;
    }
  } finally {
    decoded.delete(theme.id);
  }
}

let previewing: { audio: HTMLAudioElement; id: string } | null = null;

/** Sets the volume (0 to 1) of the theme being listened to, so the listener hears what the video will have. */
export function setPreviewVolume(volume: number): void {
  if (previewing) previewing.audio.volume = Math.min(1, Math.max(0, volume));
}

/** Plays a theme (or the player's own audio) from its start (or stops it, if it's the one playing). Returns whether it's playing now. */
export function previewTheme(theme: Pick<Track, "id" | "file"> | { id: string; url: string } | null, volume = 0.8): boolean {
  const same = previewing?.id === theme?.id;
  previewing?.audio.pause();
  previewing = null;
  if (!theme || same) return false;
  const audio = new Audio("url" in theme ? theme.url : gameAssetUrl(theme.file));
  audio.volume = volume;
  audio.addEventListener("ended", () => {
    if (previewing?.audio === audio) previewing = null;
  });
  void audio.play().catch(() => undefined);
  previewing = { audio, id: theme.id };
  return true;
}
