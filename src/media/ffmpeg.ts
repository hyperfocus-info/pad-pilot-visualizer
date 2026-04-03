import path from "node:path";
import { writeFile } from "node:fs/promises";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { runCommand } from "../utils/process";

export const DEFAULT_ENCODER_PRESET = "veryfast";

export function resolveFfmpegPath(): string {
  const resolved = process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!resolved) {
    throw new Error("Unable to resolve ffmpeg binary. Set FFMPEG_PATH.");
  }
  return resolved;
}

export function resolveFfprobePath(): string {
  const resolved = process.env.FFPROBE_PATH ?? ffprobeStatic.path;
  if (!resolved) {
    throw new Error("Unable to resolve ffprobe binary. Set FFPROBE_PATH.");
  }
  return resolved;
}

export async function probeAudio(
  ffprobePath: string,
  inputPath: string,
): Promise<{ durationSec: number; sampleRate: number; channels: number; metadataBpm?: number }> {
  const { stdout } = await runCommand([
    ffprobePath,
    "-v",
    "error",
    "-show_entries",
    "stream=sample_rate,channels:stream_tags=TBPM,BPM:format=duration:format_tags=TBPM,BPM",
    "-of",
    "json",
    inputPath,
  ]);

  const parsed = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<{
      sample_rate?: string;
      channels?: number;
      tags?: Record<string, string | undefined>;
    }>;
    format?: {
      duration?: string;
      tags?: Record<string, string | undefined>;
    };
  };

  const stream = parsed.streams?.[0];
  const durationSec = Number(parsed.format?.duration ?? "0");
  const sampleRate = Number(stream?.sample_rate ?? "44100");
  const channels = Number(stream?.channels ?? 2);
  const metadataBpmRaw =
    parsed.format?.tags?.TBPM ??
    parsed.format?.tags?.BPM ??
    stream?.tags?.TBPM ??
    stream?.tags?.BPM;
  const metadataBpm = metadataBpmRaw ? Number(metadataBpmRaw) : undefined;

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Unable to determine audio duration with ffprobe.");
  }

  return {
    durationSec,
    sampleRate,
    channels,
    metadataBpm: metadataBpm && Number.isFinite(metadataBpm) && metadataBpm > 0 ? metadataBpm : undefined,
  };
}

export async function trimAudio(
  ffmpegPath: string,
  inputPath: string,
  duration: string,
  outputDir: string,
): Promise<string> {
  const outputPath = path.join(outputDir, "trimmed.m4a");
  await runCommand([
    ffmpegPath,
    "-y",
    "-i",
    inputPath,
    "-t",
    duration,
    "-vn",
    "-c:a",
    "aac",
    outputPath,
  ]);
  return outputPath;
}

export function spawnVideoEncoder(params: {
  ffmpegPath: string;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  preset?: string;
}) {
  return Bun.spawn(
    [
      params.ffmpegPath,
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${params.width}x${params.height}`,
      "-r",
      String(params.fps),
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      params.preset ?? DEFAULT_ENCODER_PRESET,
      "-crf",
      "20",
      "-profile:v",
      "high",
      "-level",
      "4.2",
      "-pix_fmt",
      "yuv420p",
      "-an",
      params.outputPath,
    ],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    },
  );
}

export async function concatVideoSegments(
  ffmpegPath: string,
  segmentPaths: string[],
  workDir: string,
): Promise<string> {
  const listPath = path.join(workDir, "concat.txt");
  const outputPath = path.join(workDir, "video-only.mp4");
  const contents = segmentPaths
    .map((segmentPath) => `file '${path.resolve(segmentPath).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, `${contents}\n`, "utf8");
  await runCommand([
    ffmpegPath,
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);
  return outputPath;
}

export async function muxAudio(
  ffmpegPath: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  await runCommand([
    ffmpegPath,
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-shortest",
    outputPath,
  ]);
}

export async function extractVideoFrame(
  ffmpegPath: string,
  videoPath: string,
  timeSec: number,
  outputPath: string,
): Promise<void> {
  await runCommand([
    ffmpegPath,
    "-y",
    "-ss",
    timeSec.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    outputPath,
  ]);
}
