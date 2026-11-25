/**
 * Encodes frames drawn on a canvas as an H.264 MP4 video (VP9 where the browser has no H.264 encoder), with the browser's own encoder (WebCodecs) and Mediabunny
 * to write the file. Frames are drawn one at a time by the caller, as fast as they can be drawn, so a video takes as
 * long to make as its frames take to draw, not as long as it plays.
 *
 * Memory stays the same however long the video is: the encoder takes a frame only when it has room (back-pressure),
 * the soundtrack comes in a second at a time, and the file is written to a temporary file in the page's private
 * storage as it is made (with its metadata space reserved at the start, so it still plays at once from the web)
 * instead of being kept whole in memory. Only where the browser has no such storage is the file built in memory.
 */
import { isSafariEngine } from "./engine.ts";
import { AudioBufferSource, BufferTarget, canEncode as canEncodeCodec, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH, StreamTarget, type Target } from "mediabunny";

/** The H.264 High profile level a video needs: 4.0 up to 1080p at 30 frames a second, 4.2 at 60, 5.1 and 5.2 beyond. */
export function videoCodec(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  const level = width * height <= 2_228_224 ? (rate <= 62_914_560 ? "28" : "2a") : rate <= 251_658_240 ? "33" : "34";
  return `avc1.6400${level}`;
}

/**
 * Safari's engine (the macOS app's window) never returns a frame from its H.264 High profile encoder in the default
 * "quality" mode: it takes frames and waits forever, so an export stalls at 0%. Its "realtime" mode encodes every frame,
 * in order. Other engines (the Windows app's WebView2) keep "quality", which lets the encoder plan ahead.
 */
export function encoderLatency(userAgent?: string): "quality" | "realtime" {
  return isSafariEngine(userAgent) ? "realtime" : "quality";
}

/** The VP9 (profile 0, 8 bit) level a video needs, by its pixels per second and frame size. */
export function vp9Codec(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  const frame = width * height;
  const level = frame <= 2_228_224 && rate <= 83_558_400 ? "40" : frame <= 2_228_224 && rate <= 160_432_128 ? "41" : frame <= 8_912_896 && rate <= 311_951_360 ? "50" : frame <= 8_912_896 && rate <= 588_251_136 ? "51" : "52";
  return `vp09.00.${level}.08`;
}

/** The codec this browser can encode the video with, or null: H.264, which plays everywhere (WebView2, WebKit), else
 * VP9 (the Linux app's QtWebEngine has no H.264 encoder). */
export async function encodableCodec(width: number, height: number, fps: number): Promise<"avc" | "vp9" | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const [name, codec] of [["avc", videoCodec(width, height, fps)], ["vp9", vp9Codec(width, height, fps)]] as const) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 8_000_000, latencyMode: encoderLatency() });
      if (supported) return name;
    } catch {
      // not a codec this browser knows: try the next
    }
  }
  return null;
}

/** Whether this browser can encode the video. */
export async function canEncode(width: number, height: number, fps: number): Promise<boolean> {
  return (await encodableCodec(width, height, fps)) !== null;
}

/** How much detail the video keeps (its bitrate): smaller files, or sharper ones. */
export type VideoQuality = "standard" | "high" | "best";
const QUALITY = { standard: QUALITY_MEDIUM, high: QUALITY_HIGH, best: QUALITY_VERY_HIGH } as const;

/** Where a video is written while it is made: a file in the page's private storage (on disk, not in memory). */
interface Spool {
  target: Target;
  /** The finished file, once the output is finalized. */
  result: () => Promise<Blob>;
  /** Removes the file. */
  remove: () => Promise<void>;
}

const SPOOL_PREFIX = "divine-pulse-video-";
const SPOOL_CHUNK = 8 * 1024 * 1024;

/** A temporary file for the video, or null where the browser has no private file storage. Files a crashed export
 * left behind are removed. */
async function openSpool(): Promise<Spool | null> {
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) if (name.startsWith(SPOOL_PREFIX)) await root.removeEntry(name).catch(() => undefined);
    const name = `${SPOOL_PREFIX}${Date.now()}.mp4`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    return {
      target: new StreamTarget(writable as unknown as WritableStream<{ type: "write"; data: Uint8Array<ArrayBuffer>; position: number }>, { chunked: true, chunkSize: SPOOL_CHUNK }),
      result: () => handle.getFile(),
      remove: () => root.removeEntry(name).catch(() => undefined),
    };
  } catch {
    return null;
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
  quality?: VideoQuality;
  /** The soundtrack, from the start, in pieces as long as the video (AAC where the browser can encode it, otherwise Opus). */
  audio?: AsyncIterable<AudioBuffer> | null;
}

/** A finished video. It may be a file on disk: `release` removes it once it has been saved. */
export interface EncodedVideo {
  blob: Blob;
  release: () => Promise<void>;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

export async function encodeVideo({ width, height, fps, frames, draw, onProgress, signal, quality = "high", audio }: VideoJob): Promise<EncodedVideo> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false })!;
  const spool = await openSpool();
  const target = spool?.target ?? new BufferTarget();
  // On disk the metadata can't be kept until the end, so its room is reserved at the start (it needs the most packets
  // each track can have: a frame each, and for sound an Opus or AAC packet for every 20 ms at most, with some to spare).
  const seconds = frames / fps;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: spool ? "reserve" : "in-memory" }), target });
  const source = new CanvasSource(canvas, { codec: (await encodableCodec(width, height, fps)) ?? "avc", bitrate: QUALITY[quality], keyFrameInterval: 2, latencyMode: encoderLatency() });
  output.addVideoTrack(source, { frameRate: fps, maximumPacketCount: frames + 16 });
  let sound: AudioBufferSource | null = null;
  if (audio) {
    const codec = (await canEncodeCodec("aac")) ? "aac" : "opus";
    sound = new AudioBufferSource({ codec, bitrate: 192_000 });
    output.addAudioTrack(sound, { maximumPacketCount: Math.ceil(seconds * 75) + 64 });
  }
  await output.start();
  // The soundtrack goes in alongside the frames, a second or so ahead of them, so the file interleaves sound and picture.
  const pieces = audio?.[Symbol.asyncIterator]();
  let heard = 0;
  const feed = async (until: number) => {
    while (sound && pieces && heard < until) {
      const next = await pieces.next();
      if (next.done) {
        heard = Infinity;
        return;
      }
      await sound.add(next.value);
      heard += next.value.duration;
    }
  };
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Cancelled();
      await feed(i / fps + 1);
      await draw(i, g);
      await source.add(i / fps, 1 / fps);
      onProgress?.(i + 1, frames);
    }
    await feed(Infinity);
    await output.finalize();
  } catch (error) {
    await pieces?.return?.(undefined).catch(() => undefined);
    await output.cancel().catch(() => undefined);
    await spool?.remove();
    throw error;
  }
  if (spool) return { blob: await spool.result(), release: spool.remove };
  return { blob: new Blob([(target as BufferTarget).buffer!], { type: "video/mp4" }), release: async () => undefined };
}
