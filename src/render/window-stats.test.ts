import { describe, expect, test } from "bun:test";
import {
  accumulateRenderWindowSample,
  createRenderWindowKey,
  createRenderWindowAccumulator,
  finalizeRenderWindowAccumulator,
} from "./window-stats";
import {
  accumulateRenderWindowSample as accumulateFromWorker,
  createRenderWindowAccumulator as createFromWorker,
  finalizeRenderWindowAccumulator as finalizeFromWorker,
} from "./render-worker";

describe("window stats", () => {
  test("accumulates hero and particle metrics into a finalized window summary", () => {
    const accumulator = createRenderWindowAccumulator(4, { heroQuadrant: "bl", heroLayoutFamily: "independent-lanes" });
    accumulateRenderWindowSample(accumulator, {
      frameCount: 4,
      darkestQuartileLuminance: 0.08,
      heroCoverage: 0.6,
      heroTrailOccupancy: 0.7,
      mainHeroLowDbThrottleRatio: 1,
      mainHeroFreezeFrameRatio: 0.5,
      outroCoverageEstimate: 0.5,
      outroHeroWarp: 0.2,
      terminalBurstProgress: 0.3,
      particleRenderedCount: 10,
      particleVisibleCount: 8,
      heroSeparationReadable: true,
      heroQuadrant: "tl",
    });
    accumulateRenderWindowSample(accumulator, {
      frameCount: 6,
      darkestQuartileLuminance: 0.12,
      heroCoverage: 0.5,
      heroTrailOccupancy: 0.8,
      mainHeroLowDbThrottleRatio: 0.5,
      mainHeroFreezeFrameRatio: 0,
      outroCoverageEstimate: 0.8,
      outroHeroWarp: 0.5,
      terminalBurstProgress: 0.9,
      particleRenderedCount: 8,
      particleVisibleCount: 4,
      heroSeparationReadable: false,
      heroQuadrant: "tr",
    });
    const finalized = finalizeRenderWindowAccumulator(accumulator);
    expect(finalized.heroCoverage).toBeCloseTo(0.54, 2);
    expect(finalized.darkestQuartileLuminance).toBeCloseTo(0.104, 3);
    expect(finalized.heroTrailOccupancy).toBeCloseTo(0.76, 2);
    expect(finalized.mainHeroLowDbThrottleRatio).toBeCloseTo(0.7, 4);
    expect(finalized.mainHeroFreezeFrameRatio).toBeCloseTo(0.2, 4);
    expect(finalized.outroCoverageEstimate).toBeCloseTo(0.68, 2);
    expect(finalized.outroHeroWarp).toBeCloseTo(0.38, 2);
    expect(finalized.terminalBurstProgress).toBeCloseTo(0.9, 4);
    expect(finalized.particleVisibleRatio).toBeCloseTo(56 / 88, 4);
    expect(finalized.heroSeparationReadable).toBe(false);
    expect(finalized.heroQuadrant).toBe("tr");
    expect(finalized.heroLayoutFamily).toBe("independent-lanes");
  });

  test("render-worker re-exports the reducer surface", () => {
    const accumulator = createFromWorker(1);
    accumulateFromWorker(accumulator, { frameCount: 5, darkestQuartileLuminance: 0.1, mainHeroLowDbThrottleRatio: 0.8, mainHeroFreezeFrameRatio: 0.2, heroCoverage: 0.75, particleRenderedCount: 10, particleVisibleCount: 7, heroSeparationReadable: true });
    const finalized = finalizeFromWorker(accumulator);
    expect(finalized.heroCoverage).toBeCloseTo(0.75, 4);
    expect(finalized.darkestQuartileLuminance).toBeCloseTo(0.1, 4);
    expect(finalized.mainHeroLowDbThrottleRatio).toBeCloseTo(0.8, 4);
    expect(finalized.mainHeroFreezeFrameRatio).toBeCloseTo(0.2, 4);
    expect(finalized.particleVisibleRatio).toBeCloseTo(0.7, 4);
    expect(finalized.heroSeparationReadable).toBe(true);
  });

  test("creates canonical window keys only when temporal identity is complete", () => {
    expect(createRenderWindowKey({
      chunkIndex: 2,
      firstFrameIndex: 48,
      requestedImageIndex: 3,
      resolvedImageIndex: 4,
    })).toBe("2:48:3:4");
    expect(createRenderWindowKey({
      chunkIndex: 2,
      requestedImageIndex: 3,
      resolvedImageIndex: 4,
    })).toBeUndefined();
  });
});
