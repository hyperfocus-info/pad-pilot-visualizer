import { describe, expect, test } from "bun:test";
import type { AudioFrameFeature } from "../types";
import { enrichFrameWithMusicGrid } from "./music-grid";

// Bucket: behavioral

function makeFrame(overrides: Partial<AudioFrameFeature> = {}): AudioFrameFeature {
  return {
    frameIndex: 0,
    timeSec: 0,
    beatAlignedTimeSec: 0,
    isPreAnchor: false,
    subLowEnergy: 0,
    lowEnergy: 0,
    lowMidEnergy: 0,
    midEnergy: 0,
    highMidEnergy: 0,
    highEnergy: 0,
    normalizedSubLow: 0.2,
    normalizedLow: 0.2,
    normalizedLowMid: 0.2,
    normalizedMid: 0.2,
    normalizedHighMid: 0.2,
    normalizedHigh: 0.2,
    motionEnergy: 0.2,
    isPeak: false,
    peakStrength: 0.1,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0,
    subBeatPhase: 0,
    barPhase: 0,
    beatPulse: 1,
    subBeatPulse: 0.5,
    onsetStrength: 0.2,
    motionEnvelope: 0.2,
    dbLow: -10,
    dbLowMid: -10,
    dbMid: -10,
    dbHighMid: -10,
    dbHigh: -10,
    dbOverall: -10,
    dbNormalized: 0.5,
    pulseRaw: 1,
    pulseEnvelope: 1,
    pulseAccent: 1,
    narrativeIntensity: 0.5,
    pulseScale: 1.2,
    ...overrides,
  };
}

describe("music grid behavioral enrichment", () => {
  test("increments beat and bar indices across aligned frames", () => {
    const beat0 = enrichFrameWithMusicGrid(makeFrame({ timeSec: 0, beatAlignedTimeSec: 0 }), 120, 0);
    const beat4 = enrichFrameWithMusicGrid(makeFrame({ timeSec: 2, beatAlignedTimeSec: 2 }), 120, 0);

    expect(beat0.beatIndex).toBe(0);
    expect(beat0.barIndex).toBe(0);
    expect(beat4.beatIndex).toBe(4);
    expect(beat4.barIndex).toBe(1);
  });

  test("derives phrase boundaries and downbeat tags", () => {
    const frame = enrichFrameWithMusicGrid(makeFrame({ timeSec: 8, beatAlignedTimeSec: 8, beatPhase: 0.01 }), 120, 0);
    expect(frame.phrase4Index).toBe(1);
    expect(frame.isBarDownbeat).toBe(true);
    expect(frame.isFourBarDownbeat).toBe(true);
  });

  test("suppresses accents and pulses before the anchor", () => {
    const frame = enrichFrameWithMusicGrid(makeFrame({ timeSec: 0.2, beatAlignedTimeSec: -0.3, isPreAnchor: true, beatPhase: 0.02 }), 120, 0.5);
    expect(frame.isBeatAccent).toBe(false);
    expect(frame.isBarDownbeat).toBe(false);
    expect(frame.barPulse).toBe(0);
    expect(frame.phrasePulse).toBe(0);
  });

  test("keeps bar and phrase pulses bounded near boundaries", () => {
    const frame = enrichFrameWithMusicGrid(makeFrame({ timeSec: 0, beatAlignedTimeSec: 0, beatPhase: 0.01 }), 120, 0);
    expect(frame.barPulse).toBeGreaterThan(0.9);
    expect(frame.phrasePulse).toBeGreaterThan(0.9);
    expect(frame.barPulse).toBeLessThanOrEqual(1);
    expect(frame.phrasePulse).toBeLessThanOrEqual(1);
  });
});
