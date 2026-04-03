import { describe, expect, test } from "bun:test";
import {
  buildDiagnosticBreakdown,
  buildDiagnosticReportFromChunks,
  scoreToGrade,
  targetGradeFloor,
} from "./report-summary";
import type { RenderChunkStat, RenderImageWindowStat } from "../types";

function makeWindow(overrides: Partial<RenderImageWindowStat> = {}): RenderImageWindowStat {
  return {
    imageIndex: 0,
    frameCount: 10,
    averageLuminance: 0.2,
    minLuminance: 0.12,
    blackFrameCount: 0,
    heroCoverage: 0.62,
    backgroundClutterRatio: 0.18,
    heroTrailOccupancy: 0.74,
    heroBurstCount: 4,
    heroBurstChildren: 8,
    heroMotorThrust: 1.2,
    heroMotorJitter: 0.06,
    transitionAvgDurationFrames: 14,
    transitionCarryStrength: 0.72,
    safetyOverrideCount: 4,
    particleRenderedCount: 12,
    particleVisibleCount: 9,
    heroInstanceCountResolved: 1,
    heroSeparationReadable: true,
    heroQuadrant: "tr",
    heroLayoutFamily: "bilateral-stage",
    ...overrides,
  };
}

function makeChunk(imageWindows: RenderImageWindowStat[]): RenderChunkStat {
  return {
    chunkIndex: 0,
    frameCount: imageWindows.reduce((sum, window) => sum + window.frameCount, 0),
    elapsedMs: 10,
    averageMsPerFrame: 1,
    outputPath: "chunk.mp4",
    imageWindows,
  };
}

describe("report summary", () => {
  test("scores healthy windows without failing checks", () => {
    const breakdown = buildDiagnosticBreakdown([makeWindow(), makeWindow({ imageIndex: 1, heroQuadrant: "tl" })], undefined);
    expect(breakdown.smokeGrade).toBe("B");
    expect(breakdown.failingChecks).toEqual([]);
  });

  test("flags weak hero coverage, continuity, luminance, and transition issues", () => {
    const breakdown = buildDiagnosticBreakdown([
      makeWindow({
        heroCoverage: 0.22,
        heroTrailOccupancy: 0.31,
        minLuminance: 0.02,
        transitionAvgDurationFrames: 35,
        transitionCarryStrength: 0.4,
      }),
    ], { type: "transition", fromImageIndex: 0, toImageIndex: 1 });
    expect(breakdown.failingChecks).toContain("heroCoverage");
    expect(breakdown.failingChecks).toContain("trailContinuity");
    expect(breakdown.failingChecks).toContain("luminanceFloor");
    expect(breakdown.failingChecks).toContain("transitionMs");
    expect(breakdown.failingChecks).toContain("carrySmoothness");
  });

  test("downgrades multi-hero windows when readable separation falls below threshold", () => {
    const windows = [
      makeWindow({ imageIndex: 0, heroInstanceCountResolved: 2, heroSeparationReadable: true }),
      makeWindow({ imageIndex: 1, heroInstanceCountResolved: 2, heroSeparationReadable: false }),
      makeWindow({ imageIndex: 2, heroInstanceCountResolved: 2, heroSeparationReadable: false }),
    ];
    const breakdown = buildDiagnosticBreakdown(windows, undefined);
    expect(breakdown.failingChecks).toContain("multiHeroSeparation");
  });

  test("builds node and transition reports from chunk windows", () => {
    const report = buildDiagnosticReportFromChunks([
      makeChunk([makeWindow({ imageIndex: 0 }), makeWindow({ imageIndex: 1, transitionAvgDurationFrames: 18 })]),
    ], { type: "all-transitions" });
    expect(report.nodeResults).toHaveLength(2);
    expect(report.transitionResults).toHaveLength(1);
    expect(report.transitionResults?.[0]?.performance.carrySmoothness).toBeCloseTo(0.72, 4);
  });

  test("exposes deterministic grade helpers", () => {
    expect(scoreToGrade(95)).toBe("A");
    expect(scoreToGrade(88)).toBe("B+");
    expect(targetGradeFloor("A-")).toBe(90);
    expect(targetGradeFloor("B")).toBe(80);
  });
});
