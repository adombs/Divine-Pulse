/**
 * Encodes frames drawn on a canvas as an H.264 MP4 video, with the browser's own encoder (WebCodecs) and Mediabunny
 * to write the file. Frames are drawn one at a time by the caller, as fast as they can be drawn, so a video takes as
 * long to make as its frames take to draw, not as long as it plays.
 */
import { AudioBufferSource, BufferTarget, canEncode as canEncodeCodec, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH } from "mediabunny";

/** The H.264 High profile level a video needs: 4.0 up to 1080p at 30 frames a second, 4.2 at 60, 5.1 and 5.2 beyond. */
export function videoCodec(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  const level = width * height <= 2_228_224 ? (rate <= 62_914_560 ? "28" : "2a") : rate <= 251_658_240 ? "33" : "34";
  return `avc1.6400${level}`;
}

/** Whether this browser can encode the video (the desktop app's WebView2 can). */
export async function canEncode(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: videoCodec(width, height, fps), width, height, framerate: fps, bitrate: 8_000_000 });
    return !!supported;
  } catch {
    return false;
  }
}

/** How much detail the video keeps (its bitrate): smaller files, or sharper ones. */
export type VideoQuality = "standard" | "high" | "best";
const QUALITY = { standard: QUALITY_MEDIUM, high: QUALITY_HIGH, best: QUALITY_VERY_HIGH } as const;

export interface VideoJob {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Draws frame `i` on the canvas (left as it was when nothing changed). */
  draw: (i: number, g: CanvasRenderingContext2D) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  quality?: VideoQuality;
  /** The soundtrack, from the start (AAC where the browser can encode it, otherwise Opus). */
  audio?: AudioBuffer | null;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

export async function encodeVideo({ width, height, fps, frames, draw, onProgress, signal, quality = "high", audio }: VideoJob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false })!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY[quality], keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  let sound: AudioBufferSource | null = null;
  if (audio) {
    const codec = (await canEncodeCodec("aac")) ? "aac" : "opus";
    sound = new AudioBufferSource({ codec, bitrate: 192_000 });
    output.addAudioTrack(sound);
  }
  await output.start();
  try {
    if (sound && audio) await sound.add(audio);
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Cancelled();
      await draw(i, g);
      await source.add(i / fps, 1 / fps);
      onProgress?.(i + 1, frames);
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  return new Blob([target.buffer!], { type: "video/mp4" });
}
