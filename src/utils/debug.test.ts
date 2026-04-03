import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DebugCollector, writeDebugReport } from "./debug";
import type { DebugReport } from "../types";

describe("debug utilities", () => {
  test("collector records timings and report writer emits a readable report", async () => {
    const collector = new DebugCollector();
    await collector.measure("stage-a", async () => "ok");
    expect(collector.snapshot()).toHaveLength(1);
    expect(collector.totalElapsedMs()).toBeGreaterThanOrEqual(0);

    const outputPath = path.resolve("video/debug-test.mp4");
    const debugDir = path.resolve("debug/debug-test");
    await mkdir(debugDir, { recursive: true });
    const report: DebugReport = {
      outputPath,
      runStatus: "success",
      stageTimings: collector.snapshot(),
      totalElapsedMs: collector.totalElapsedMs(),
      encoderPreset: "test",
      sourceAudioPath: "song.wav",
      chosenBpm: 120,
      bpmSource: "default",
      bpmTrustState: "estimated-preferred",
      anchorTrustState: "fallback-zero",
      renderChunks: [],
      effects: [{
        imageIndex: 0,
        imagePath: "ref.png",
        referenceImagePath: "ref.png",
        quarterFramePath: "quarter.png",
        middleFramePath: "middle.png",
        threeQuarterFramePath: "three-quarter.png",
        startSec: 0,
        endSec: 1,
        chunkIndex: 0,
        firstPixelR: 0,
        firstPixelG: 0,
        firstPixelB: 0,
        effectSeed: 1,
        effectBucket: 1,
        effectCycle: 1,
        transitionMode: 1,
        rawEffectMode: 1,
        effectiveEffectMode: 1,
        diagnosticCompleteness: "complete",
        averageLuminance: 0.3,
        heroCoverage: 0.6,
        backgroundClutterRatio: 0.2,
        heroTrailOccupancy: 0.7,
        effectVisibilityScore: 0.8,
        motif: "glass-orbital",
        sourceMotif: "glass-orbital",
        heroMotifResolved: "glass-orbital",
        heroMotifScheduled: "glass-orbital",
        heroMotifSlotIndex: 0,
        heroMotifSlotStartSec: 0,
        heroMotifSlotEndSec: 1,
        heroMotifScheduleReason: "intro-setup",
        heroMotifChangedOnSlotBoundary: false,
        heroMotifChangedOutsideSlot: false,
        heroMotifScheduleMismatch: false,
        particleSpawnRequests: 0,
        particleRenderedCount: 12,
        particleVisibleCount: 0,
        particleVisibleRatio: 0.7,
        particleTelemetryAvailable: true,
        recoveryMode: "none",
        fallbackRenderMode: "none",
        fallbackReason: "none",
        fallbackTriggerCount: 0,
        fallbackSeverity: "none",
        compositionModeReason: "normal",
        bpmTrustState: "estimated-preferred",
        anchorTrustState: "fallback-zero",
      }, {
        imageIndex: 1,
        imagePath: "ref-2.png",
        referenceImagePath: "ref-2.png",
        quarterFramePath: "quarter-2.png",
        middleFramePath: "middle-2.png",
        threeQuarterFramePath: "three-quarter-2.png",
        startSec: 1,
        endSec: 2,
        chunkIndex: 0,
        firstPixelR: 0,
        firstPixelG: 0,
        firstPixelB: 0,
        effectSeed: 2,
        effectBucket: 2,
        effectCycle: 2,
        transitionMode: 2,
        rawEffectMode: 2,
        effectiveEffectMode: 2,
        diagnosticCompleteness: "complete",
        averageLuminance: 0.1,
        heroCoverage: 0.04,
        backgroundClutterRatio: 0.5,
        heroTrailOccupancy: 0.1,
        effectVisibilityScore: 0.22,
        motif: "glass-orbital",
        sourceMotif: "glass-orbital",
        heroMotifResolved: "glass-orbital",
        heroMotifScheduled: "glass-orbital",
        heroMotifSlotIndex: 1,
        heroMotifSlotStartSec: 1,
        heroMotifSlotEndSec: 2,
        heroMotifScheduleReason: "body-hold",
        heroMotifChangedOnSlotBoundary: false,
        heroMotifChangedOutsideSlot: false,
        heroMotifScheduleMismatch: false,
        particleSpawnRequests: 10,
        particleRenderedCount: 10,
        particleVisibleCount: 3,
        particleVisibleRatio: 0.3,
        particleTelemetryAvailable: true,
        recoveryMode: "fallback-composed",
        fallbackRenderMode: "fallback-composed",
        fallbackReason: "edge-dominance",
        fallbackTriggerCount: 3,
        fallbackSeverity: "full",
        compositionModeReason: "edge-dominance-recovery",
        visibleFallbackRisk: false,
        edgeDominanceMargin: 0.36,
        bpmTrustState: "estimated-preferred",
        anchorTrustState: "fallback-zero",
      }, {
        imageIndex: 2,
        imagePath: "ref-3.png",
        referenceImagePath: "ref-3.png",
        quarterFramePath: "quarter-3.png",
        middleFramePath: "middle-3.png",
        threeQuarterFramePath: "three-quarter-3.png",
        startSec: 2,
        endSec: 3,
        chunkIndex: 0,
        firstPixelR: 0,
        firstPixelG: 0,
        firstPixelB: 0,
        effectSeed: 3,
        effectBucket: 3,
        effectCycle: 3,
        transitionMode: 3,
        rawEffectMode: 3,
        effectiveEffectMode: 3,
        diagnosticCompleteness: "complete",
        averageLuminance: 0.08,
        heroCoverage: 0.04,
        backgroundClutterRatio: 0.5,
        heroTrailOccupancy: 0.1,
        effectVisibilityScore: 0.18,
        motif: "smoke-ribbon",
        sourceMotif: "smoke-ribbon",
        heroMotifResolved: "cathedral-filament",
        heroMotifScheduled: "smoke-ribbon",
        heroMotifSlotIndex: 2,
        heroMotifSlotStartSec: 2,
        heroMotifSlotEndSec: 3,
        heroMotifScheduleReason: "body-promoted",
        heroMotifChangedOnSlotBoundary: true,
        heroMotifChangedOutsideSlot: true,
        heroMotifScheduleMismatch: true,
        particleSpawnRequests: 10,
        particleRenderedCount: 10,
        particleVisibleCount: 3,
        particleVisibleRatio: 0.3,
        particleTelemetryAvailable: true,
        recoveryMode: "safety-recovery",
        fallbackRenderMode: "fallback-composed",
        fallbackReason: "dead-center-void",
        fallbackTriggerCount: 4,
        fallbackSeverity: "full",
        compositionModeReason: "edge-dominance-recovery",
        visibleFallbackRisk: true,
        edgeDominanceMargin: 0.44,
        heroShellSceneEnabled: false,
        heroShellUnderlayActiveRatio: 0.2,
        edgePressureActiveFrameRatio: 0.4,
        centerwardEmissionRatio: 0.3,
        motionTier: "glide",
        motionTierReadable: false,
        jitterSuppressed: false,
        heroMotorJitter: 0.12,
        bpmTrustState: "estimated-preferred",
        anchorTrustState: "fallback-zero",
      }],
    };
    await writeDebugReport(report);
    const contents = await readFile(path.join(debugDir, "output.txt"), "utf8");
    expect(contents).toContain("AI Video Debug Report");
    expect(contents).toContain("quarter=quarter.png");
    expect(contents).toContain("threeQuarter=three-quarter.png");
    expect(contents).toContain("Render Health");
    expect(contents).toContain("particleTelemetryAvailableWindows=3");
    expect(contents).toContain("requested=0.0");
    expect(contents).toContain("fallbackComposedWindows=1");
    expect(contents).toContain("safetyRecoveryWindows=1");
    expect(contents).toContain("shellRenderedWhileDisabledCount=1");
    expect(contents).toContain("centerwardAimReadableWindowCount=0");
    expect(contents).toContain("fallbackReasonCounts=none:1,edge-dominance:1,dead-center-void:1");
    expect(contents).toContain("sourceMotifCounts=glass-orbital:2,smoke-ribbon:1");
    expect(contents).toContain("heroMotifCounts=glass-orbital:2,cathedral-filament:1");
    expect(contents).toContain("heroMotifChangeCount=1");
    expect(contents).toContain("heroMotifChangesPerMinute=20.000");
    expect(contents).toContain("sourceHeroMismatchRate=33.3%");
    expect(contents).toContain("visibleFallbackRiskWindows=1");
    expect(contents).toContain("severity=full");
    expect(contents).toContain("triggers=4");
    expect(contents).toContain("edgeMargin=0.440");
    expect(contents).toContain("shell-rendered-while-disabled");
    expect(contents).toContain("edge-pressure-not-centerward");
    expect(contents).toContain("motion-tier-collapsed-to-jitter");
    expect(contents).toContain("recovery-mode-mislabeled");
    expect(contents).toContain("hero-motif-changed-outside-slot");
    expect(contents).toContain("hero-motif-schedule-mismatch");
    expect(contents).toContain("cadence: scheduled=smoke-ribbon resolved=cathedral-filament");
    await rm(debugDir, { recursive: true, force: true });
  });
});
