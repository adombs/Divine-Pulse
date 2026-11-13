/**
 * The arithmetic of a video's soundtrack (music.ts makes it a piece at a time): which sample of the theme plays at each
 * moment of the video, looping as the game loops it, and how loud it is, faded out at the end.
 */
import type { Track } from "./music";

/** How long the music fades out at the end of a video (s). */
export const FADE_OUT = 2.5;

/** Where a soundtrack's samples come from and how loud they are, in samples at the audio's rate. */
export interface SoundPlan {
  /** The video's length (samples). */
  total: number;
  /** The audio's length (samples). */
  size: number;
  /** The loop the game plays (samples), or none. */
  loop: { start: number; length: number } | null;
  /** Where the fade-out starts and how long it is (samples). */
  fadeStart: number;
  fadeLength: number;
  volume: number;
}

export function soundPlan(theme: Track, audio: { sampleRate: number; length: number; duration: number }, seconds: number, volume: number): SoundPlan {
  const rate = audio.sampleRate;
  const start = Math.round((theme.loop_start / theme.rate) * rate);
  const end = Math.round(((theme.loop_start + theme.loop_length) / theme.rate) * rate);
  const looping = theme.loop_length > 0 && end / rate <= audio.duration + 0.01;
  const fadeStart = (seconds - Math.min(FADE_OUT, seconds / 3)) * rate;
  return {
    total: Math.max(1, Math.ceil(seconds * rate)),
    size: audio.length,
    loop: looping ? { start, length: Math.max(1, Math.min(end, audio.length) - start) } : null,
    fadeStart,
    fadeLength: Math.max(1, seconds * rate - fadeStart),
    volume,
  };
}

/** How long a soundtrack of the player's own audio fades out at the end of a video (s). */
export const CUSTOM_FADE_OUT = 1;

/**
 * The soundtrack plan for the player's own audio: from its start, round and round when it is shorter than the video,
 * cut off at the video's end when it is longer, faded out over the last second either way.
 */
export function customPlan(audio: { sampleRate: number; length: number }, seconds: number, volume: number): SoundPlan {
  const rate = audio.sampleRate;
  const fadeStart = (seconds - Math.min(CUSTOM_FADE_OUT, seconds / 3)) * rate;
  return {
    total: Math.max(1, Math.ceil(seconds * rate)),
    size: audio.length,
    loop: audio.length > 0 ? { start: 0, length: audio.length } : null,
    fadeStart,
    fadeLength: Math.max(1, seconds * rate - fadeStart),
    volume,
  };
}

/** The samples `from` to `from + out[0].length` of the soundtrack: the audio from its start, then round its loop, at
 * the plan's volume and faded out at the end. */
export function mixPiece(input: ArrayLike<number>[], out: Float32Array[], from: number, plan: SoundPlan): void {
  const { loop, size, fadeStart, fadeLength, volume } = plan;
  for (let c = 0; c < out.length; c++) {
    const target = out[c];
    for (let n = 0; n < target.length; n++) {
      const at = from + n;
      const source = loop && at >= loop.start + loop.length ? loop.start + ((at - loop.start) % loop.length) : at;
      const gain = at <= fadeStart ? volume : volume * Math.max(0, 1 - (at - fadeStart) / fadeLength);
      target[n] = source < size ? input[c][source] * gain : 0;
    }
  }
}
