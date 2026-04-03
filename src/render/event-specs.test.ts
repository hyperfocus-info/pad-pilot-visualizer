import { describe, expect, test } from "bun:test";
import type { AudioFrameFeature } from "../types";
import { EVENT_SPECS, evaluateEventState } from "./event-specs";

function makeFrame(overrides: Partial<AudioFrameFeature> = {}): AudioFrameFeature {
  return {
    frameIndex: 0,
    timeSec: 0,
    subLowEnergy: 0,
    lowEnergy: 0,
    lowMidEnergy: 0,
    midEnergy: 0,
    highMidEnergy: 0,
    highEnergy: 0,
    normalizedSubLow: 0.2,
    normalizedLow: 0.4,
    normalizedLowMid: 0.3,
    normalizedMid: 0.5,
    normalizedHighMid: 0.6,
    normalizedHigh: 0.5,
    motionEnergy: 0.4,
    isPeak: false,
    peakStrength: 0.4,
    segmentIndex: 0,
    dominantHz: 720,
    dominantBand: "high",
    rainbowHueOffset: 0,
    beatPhase: 0.04,
    subBeatPhase: 0.1,
    barPhase: 0.05,
    beatPulse: 0.8,
    subBeatPulse: 0.2,
    onsetStrength: 0.7,
    motionEnvelope: 0.3,
    dbLow: -6,
    dbLowMid: -6,
    dbMid: -6,
    dbHighMid: -6,
    dbHigh: -6,
    dbOverall: -6,
    dbNormalized: 0.8,
    pulseRaw: 0.4,
    pulseEnvelope: 0.4,
    pulseAccent: 0.2,
    narrativeIntensity: 0.4,
    pulseScale: 1,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: true,
    isBarDownbeat: true,
    isFourBarDownbeat: false,
    barPulse: 0.7,
    phrasePulse: 0.5,
    ...overrides,
  };
}

describe("event spec cadence retune", () => {
  test("retuned event cooldowns stay compressed with a sane floor", () => {
    const cooldowns = EVENT_SPECS.map((spec) => spec.cooldownFrames);
    expect(cooldowns.every((value) => value >= 3 && value <= 5)).toBe(true);
    expect(cooldowns.some((value) => value === 3)).toBe(true);
    expect(cooldowns.some((value) => value === 5)).toBe(true);
  });

  test("event intensity remains responsive under the higher-cadence tuning", () => {
    const state = evaluateEventState({
      spec: EVENT_SPECS[0]!,
      frame: makeFrame(),
    });

    expect(state.intensity).toBeGreaterThan(0.5);
    expect(state.emitterBias).toBeGreaterThan(0.45);
  });
});
