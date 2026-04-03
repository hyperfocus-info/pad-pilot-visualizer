import type { HeroLayoutFamily, RenderImageWindowStat } from "../types";

export interface RenderWindowIdentity {
  chunkIndex?: number;
  firstFrameIndex?: number;
  requestedImageIndex?: number;
  resolvedImageIndex?: number;
}

export function createRenderWindowKey(identity: RenderWindowIdentity): string | undefined {
  if (
    identity.chunkIndex === undefined ||
    identity.firstFrameIndex === undefined ||
    identity.requestedImageIndex === undefined ||
    identity.resolvedImageIndex === undefined
  ) {
    return undefined;
  }
  return `${identity.chunkIndex}:${identity.firstFrameIndex}:${identity.requestedImageIndex}:${identity.resolvedImageIndex}`;
}

export interface RenderWindowAccumulator {
  imageIndex: number;
  frameCount: number;
  darkestQuartileLuminanceSum: number;
  heroCoverageSum: number;
  heroTrailOccupancySum: number;
  mainHeroLowDbThrottleFrames: number;
  mainHeroFreezeFrames: number;
  outroCoverageEstimateSum: number;
  outroHeroWarpSum: number;
  terminalBurstProgressMax: number;
  particleRenderedCountSum: number;
  particleVisibleCountSum: number;
  heroSeparationReadableFrames: number;
  heroQuadrant: RenderImageWindowStat["heroQuadrant"];
  heroLayoutFamily?: HeroLayoutFamily;
}

export function createRenderWindowAccumulator(
  imageIndex: number,
  seed?: Partial<RenderImageWindowStat>,
): RenderWindowAccumulator {
  return {
    imageIndex,
    frameCount: 0,
    darkestQuartileLuminanceSum: 0,
    heroCoverageSum: 0,
    heroTrailOccupancySum: 0,
    mainHeroLowDbThrottleFrames: 0,
    mainHeroFreezeFrames: 0,
    outroCoverageEstimateSum: 0,
    outroHeroWarpSum: 0,
    terminalBurstProgressMax: 0,
    particleRenderedCountSum: 0,
    particleVisibleCountSum: 0,
    heroSeparationReadableFrames: 0,
    heroQuadrant: seed?.heroQuadrant ?? "center",
    heroLayoutFamily: seed?.heroLayoutFamily,
  };
}

export function accumulateRenderWindowSample(
  accumulator: RenderWindowAccumulator,
  sample: Partial<RenderImageWindowStat> & { frameCount?: number },
): RenderWindowAccumulator {
  const frameCount = sample.frameCount ?? 1;
  accumulator.frameCount += frameCount;
  accumulator.darkestQuartileLuminanceSum += (sample.darkestQuartileLuminance ?? 0) * frameCount;
  accumulator.heroCoverageSum += (sample.heroCoverage ?? 0) * frameCount;
  accumulator.heroTrailOccupancySum += (sample.heroTrailOccupancy ?? 0) * frameCount;
  accumulator.mainHeroLowDbThrottleFrames += (sample.mainHeroLowDbThrottleRatio ?? 0) * frameCount;
  accumulator.mainHeroFreezeFrames += (sample.mainHeroFreezeFrameRatio ?? 0) * frameCount;
  accumulator.outroCoverageEstimateSum += (sample.outroCoverageEstimate ?? 0) * frameCount;
  accumulator.outroHeroWarpSum += (sample.outroHeroWarp ?? 0) * frameCount;
  accumulator.terminalBurstProgressMax = Math.max(accumulator.terminalBurstProgressMax, sample.terminalBurstProgress ?? 0);
  accumulator.particleRenderedCountSum += (sample.particleRenderedCount ?? 0) * frameCount;
  accumulator.particleVisibleCountSum += (sample.particleVisibleCount ?? 0) * frameCount;
  accumulator.heroSeparationReadableFrames += sample.heroSeparationReadable ? frameCount : 0;
  accumulator.heroQuadrant = sample.heroQuadrant ?? accumulator.heroQuadrant;
  accumulator.heroLayoutFamily = sample.heroLayoutFamily ?? accumulator.heroLayoutFamily;
  return accumulator;
}

export function finalizeRenderWindowAccumulator(accumulator: RenderWindowAccumulator): RenderImageWindowStat {
  return {
    imageIndex: accumulator.imageIndex,
    frameCount: accumulator.frameCount,
    averageLuminance: 0,
    darkestQuartileLuminance: accumulator.darkestQuartileLuminanceSum / Math.max(1, accumulator.frameCount),
    minLuminance: 0,
    blackFrameCount: 0,
    heroCoverage: accumulator.heroCoverageSum / Math.max(1, accumulator.frameCount),
    heroTrailOccupancy: accumulator.heroTrailOccupancySum / Math.max(1, accumulator.frameCount),
    mainHeroLowDbThrottleRatio: accumulator.mainHeroLowDbThrottleFrames / Math.max(1, accumulator.frameCount),
    mainHeroFreezeFrameRatio: accumulator.mainHeroFreezeFrames / Math.max(1, accumulator.frameCount),
    outroCoverageEstimate: accumulator.outroCoverageEstimateSum / Math.max(1, accumulator.frameCount),
    outroHeroWarp: accumulator.outroHeroWarpSum / Math.max(1, accumulator.frameCount),
    terminalBurstProgress: accumulator.terminalBurstProgressMax,
    particleRenderedCount: accumulator.particleRenderedCountSum / Math.max(1, accumulator.frameCount),
    particleVisibleCount: accumulator.particleVisibleCountSum / Math.max(1, accumulator.frameCount),
    particleVisibleRatio: accumulator.particleVisibleCountSum / Math.max(1, accumulator.particleRenderedCountSum || 1),
    heroSeparationReadable: accumulator.heroSeparationReadableFrames > accumulator.frameCount * 0.55,
    heroQuadrant: accumulator.heroQuadrant,
    heroLayoutFamily: accumulator.heroLayoutFamily,
  };
}
