import { z } from "zod";
import type { OutputFormatPreset, RenderSettings } from "./types";

export const DEFAULT_VIDEO_FPS = 30;
export const DEFAULT_OUTPUT_FORMAT: OutputFormatPreset = "1080";
export const OUTPUT_FORMAT_DIMENSIONS: Record<OutputFormatPreset, { width: number; height: number }> = {
  "1080": { width: 1920, height: 1080 },
  "720": { width: 1280, height: 720 },
  "480": { width: 854, height: 480 },
};
export const SUPPORTED_OUTPUT_FPS = [24, 25, 30, 50, 60] as const;
export const AUDIO_SAMPLE_RATE = 44100;
export const DEFAULT_BPM = 120;
export const DEFAULT_BEATS_PER_IMAGE = 8;
export const HALFTIME_BEATS_PER_IMAGE = 16;
export const FFT_SIZE = 2048;
export const EDGE_POINT_TARGET = 1800;
export const EDGE_ANALYSIS_WIDTH = 480;
export const EDGE_ANALYSIS_HEIGHT = 270;
export const MAX_CONTOURS = 24;
export const FRAME_STATUS_THROTTLE_MS = 125;

export const durationSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}$/, "Duration must use hh:mm:ss");

export function secondsPerImage(bpm: number, beatsPerImage = DEFAULT_BEATS_PER_IMAGE): number {
  return beatsPerImage * (60 / bpm);
}

export function normalizeOutputFps(requested: number): number {
  return SUPPORTED_OUTPUT_FPS.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest,
  );
}

export function isOutputFormatPreset(value: string): value is OutputFormatPreset {
  return value in OUTPUT_FORMAT_DIMENSIONS;
}

export function resolveOutputFormat(format: OutputFormatPreset = DEFAULT_OUTPUT_FORMAT): { width: number; height: number } {
  return OUTPUT_FORMAT_DIMENSIONS[format];
}

export function createRenderSettings(format: OutputFormatPreset, fps: number): RenderSettings {
  const dimensions = resolveOutputFormat(format);
  return {
    width: dimensions.width,
    height: dimensions.height,
    fps,
    format,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
