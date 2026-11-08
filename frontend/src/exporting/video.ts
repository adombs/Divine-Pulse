/**
 * Encodes frames drawn on a canvas as an H.264 MP4 video, with the browser's own encoder (WebCodecs) and Mediabunny
 * to write the file. Frames are drawn one at a time by the caller, as fast as they can be drawn, so a video takes as
 * long to make as its frames take to draw, not as long as it plays.
 */
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from "mediabunny";

export const VIDEO_CODEC = "avc1.640028"; // H.264 High, level 4: 1080p at 30 frames a second

/** Whether this browser can encode the video (the desktop app's WebView2 can). */
export async function canEncode(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: VIDEO_CODEC, width, height, framerate: fps, bitrate: 8_000_000 });
    return !!supported;
  } catch {
    return false;
  }
}

export interface VideoJob {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Draws frame `i` on the canvas (left as it was when nothing changed). */
  draw: (i: number, g: CanvasRenderingContext2D) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

export async function encodeVideo({ width, height, fps, frames, draw, onProgress, signal }: VideoJob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false })!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
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
