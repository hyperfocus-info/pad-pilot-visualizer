import { afterAll, describe, expect, test } from "bun:test";
import type { DominantBand } from "../types";
import { createGeneratedSong, cleanupGeneratedAudio } from "../../test/helpers/audio-fixtures";
import { analyzeAudio } from "./audio";
import { resolveFfmpegPath, resolveFfprobePath } from "./ffmpeg";

// Bucket: behavioral

const ffmpegPath = resolveFfmpegPath();
const ffprobePath = resolveFfprobePath();

afterAll(async () => {
  await cleanupGeneratedAudio();
});

async function analyzeScenario(name: Parameters<typeof createGeneratedSong>[0]) {
  const song = await createGeneratedSong(name);
  const result = await analyzeAudio({
    ffmpegPath,
    ffprobePath,
    inputPath: song.path,
    fps: 30,
    beatsPerSegment: 4,
  });
  return { song, result };
}

function expectFiniteFrames(values: object[]): void {
  for (const entry of values) {
    for (const value of Object.values(entry)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  }
}

describe("audio integration behavioral tests", () => {
  test("analyzes low-complexity kick track with accurate bpm and anchor", async () => {
    const { song, result } = await analyzeScenario("clean-kick-120");
    expect(result.metadata.bpm).toBe(120);
    expect(result.metadata.beatOriginSource).toBe("transient-anchor");
    expect(result.metadata.beatOriginSec).toBeCloseTo(song.expectedBeatOriginSec!, 1);
    expect(result.frames.length).toBe(Math.ceil(result.metadata.durationSec * 30));
    expect(result.frames[12]!.dominantBand).toBe("low");
    expectFiniteFrames(result.frames.slice(0, 12));
    expectFiniteFrames(result.segments);
  });

  test("ignores startup clicks and anchors to the true 128 bpm groove", async () => {
    const { song, result } = await analyzeScenario("startup-misdirection-128");
    expect(result.metadata.bpm).toBeGreaterThanOrEqual(127);
    expect(result.metadata.bpm).toBeLessThanOrEqual(129);
    expect(result.metadata.beatOriginSource).toBe("transient-anchor");
    expect(result.metadata.beatOriginSec).toBeCloseTo(song.expectedBeatOriginSec!, 1);
    expect(result.metadata.anchorSupportHitCount).toBeGreaterThanOrEqual(2);
  });

  test("holds tempo under dense high-complexity transients", async () => {
    const { song, result } = await analyzeScenario("dense-transients-174");
    expect(result.metadata.bpm).toBeGreaterThanOrEqual(172);
    expect(result.metadata.bpm).toBeLessThanOrEqual(176);
    expect(result.metadata.beatOriginSource).toBe("transient-anchor");
    expect(Math.abs((result.metadata.beatOriginSec ?? 0) - song.expectedBeatOriginSec!)).toBeLessThanOrEqual(2 / 30);
  });

  test("falls back to default bpm on ambient weak-tempo audio", async () => {
    const { result } = await analyzeScenario("ambient-fallback");
    expect(result.metadata.estimatedBpm).toBeUndefined();
    expect(result.metadata.bpmSource).toBe("default");
    expect(result.metadata.bpm).toBe(120);
    expect(result.metadata.beatOriginSource).toBe("fallback-zero");
  });

  test("tracks dominant bands across a band sweep", async () => {
    const { song, result } = await analyzeScenario("band-sweep");
    const bands = result.segments.slice(0, 4).map((segment) => segment.dominantBand) as DominantBand[];
    expect(bands).toEqual(song.expectedDominantBands!);
    for (const segment of result.segments.slice(0, 4)) {
      expect(segment.dominantHz).toBeGreaterThan(0);
      expect(Number.isFinite(segment.motionScale)).toBe(true);
      expect(Number.isFinite(segment.densityScale)).toBe(true);
    }
  });
});
