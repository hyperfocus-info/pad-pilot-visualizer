import { describe, expect, test } from "bun:test";
import type { AudioFrameFeature } from "../types";
import {
  buildAnchorEnvelope,
  computeBeatGridState,
  detectBeatOriginCandidates,
  estimateTempoFromOnsets,
  estimateTempoFromPeaks,
  selectBeatOrigin,
} from "./audio-core";

// Bucket: behavioral

function makePeak(timeSec: number): AudioFrameFeature {
  return {
    frameIndex: Math.round(timeSec * 30),
    timeSec,
    subLowEnergy: 0,
    lowEnergy: 0,
    lowMidEnergy: 0,
    midEnergy: 0,
    highMidEnergy: 0,
    highEnergy: 0,
    normalizedSubLow: 0,
    normalizedLow: 0,
    normalizedLowMid: 0,
    normalizedMid: 0,
    normalizedHighMid: 0,
    normalizedHigh: 0,
    motionEnergy: 1,
    isPeak: true,
    peakStrength: 1,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0,
    subBeatPhase: 0,
    barPhase: 0,
    beatPulse: 0,
    subBeatPulse: 0,
    onsetStrength: 0,
    motionEnvelope: 0,
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
    pulseScale: 1,
  };
}

function clickTrackSamples(bpm: number, durationSec: number, sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.floor(durationSec * sampleRate));
  const interval = 60 / bpm;
  for (let beatTime = 0; beatTime < durationSec; beatTime += interval) {
    const start = Math.floor(beatTime * sampleRate);
    const end = Math.min(samples.length, start + Math.floor(0.03 * sampleRate));
    for (let index = start; index < end; index += 1) {
      const t = (index - start) / sampleRate;
      samples[index] += Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 14) * 0.8;
    }
  }
  return samples;
}

describe("audio-core behavioral tests", () => {
  test("estimates tempo from onset click track", () => {
    expect(estimateTempoFromOnsets(clickTrackSamples(120, 10, 44100), 44100)).toBe(120);
  });

  test("normalizes half-time peaks back into the target range", () => {
    const peaks = [0, 1, 2, 3, 4].map((timeSec) => makePeak(timeSec));
    expect(estimateTempoFromPeaks(peaks)).toBe(120);
  });

  test("uses inclusive onset frame counting at the valid-window boundary", () => {
    const windowSize = 1024;
    const hopSize = 512;
    const sampleCount = windowSize + hopSize * 40;
    const samples = new Float32Array(sampleCount);
    for (let frameIndex = 0; frameIndex <= 40; frameIndex += 4) {
      const start = frameIndex * hopSize;
      if (start >= samples.length) {
        break;
      }
      samples[start] = 1;
    }
    expect(estimateTempoFromOnsets(samples, 44100)).toBeDefined();
  });

  test("extracts beat-origin candidates from low-band rises", () => {
    const envelope = [0, 0.1, 0.2, 0.95, 0.18, 0.15, 0.85, 0.16, 0.12, 0.82, 0.14];
    const lowSeries = [0, 0.1, 0.2, 1.6, 0.7, 0.65, 1.55, 0.6, 0.58, 1.5, 0.56];
    const lowMidSeries = lowSeries.map((value) => value * 0.3);
    const midSeries = lowSeries.map((value) => value * 0.15);
    const highSeries = lowSeries.map((value) => value * 0.05);
    const result = detectBeatOriginCandidates({
      envelope,
      lowSeries,
      lowMidSeries,
      midSeries,
      highSeries,
      fps: 10,
      bpm: 120,
      durationSec: 4,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]!.lowBandShare).toBeGreaterThan(0.5);
  });

  test("selects a delayed groove origin over misleading early transient clutter", () => {
    const result = selectBeatOrigin({
      bpm: 128,
      durationSec: 10,
      searchStartSec: 0,
      searchEndSec: 4,
      candidates: [
        { timeSec: 0.16, peakStrength: 0.4, lowBandShare: 0.05, postPeakSilenceDrop: 0.1, localRegularityScore: 0.1 },
        { timeSec: 0.5, peakStrength: 0.95, lowBandShare: 0.92, postPeakSilenceDrop: 0.84, localRegularityScore: 0.88 },
        { timeSec: 0.97, peakStrength: 0.92, lowBandShare: 0.9, postPeakSilenceDrop: 0.81, localRegularityScore: 0.86 },
        { timeSec: 1.44, peakStrength: 0.89, lowBandShare: 0.88, postPeakSilenceDrop: 0.8, localRegularityScore: 0.84 },
        { timeSec: 1.91, peakStrength: 0.9, lowBandShare: 0.87, postPeakSilenceDrop: 0.8, localRegularityScore: 0.85 },
        { timeSec: 2.38, peakStrength: 0.88, lowBandShare: 0.86, postPeakSilenceDrop: 0.79, localRegularityScore: 0.84 },
      ],
    });

    expect(result.source).toBe("transient-anchor");
    expect(result.beatOriginSec).toBe(0.5);
  });

  test("falls back when candidate support stays weak", () => {
    const result = selectBeatOrigin({
      bpm: 120,
      durationSec: 8,
      searchStartSec: 0,
      searchEndSec: 3,
      candidates: [
        { timeSec: 0.22, peakStrength: 0.3, lowBandShare: 0.12, postPeakSilenceDrop: 0.16, localRegularityScore: 0.12 },
        { timeSec: 1.34, peakStrength: 0.28, lowBandShare: 0.09, postPeakSilenceDrop: 0.1, localRegularityScore: 0.08 },
      ],
    });

    expect(result.source).toBe("fallback-zero");
    expect(result.beatOriginSec).toBe(0);
  });

  test("computes wrapped beat grid phases for pre-anchor time", () => {
    const state = computeBeatGridState(0.75, 0.5, 1.0);
    expect(state.isPreAnchor).toBe(true);
    expect(state.beatPhase).toBeCloseTo(0.5, 6);
    expect(state.barPhase).toBeGreaterThan(0);
  });

  test("smooths anchor envelopes without dropping major peaks", () => {
    const envelope = buildAnchorEnvelope({
      lowSeries: [0, 0.2, 1.4, 0.4, 1.2],
      lowMidSeries: [0, 0.1, 0.8, 0.2, 0.7],
      midSeries: [0, 0.05, 0.3, 0.1, 0.28],
      highSeries: [0, 0.02, 0.12, 0.04, 0.1],
    });

    expect(envelope[2]).toBeGreaterThan(envelope[1]!);
    expect(envelope[2]).toBeGreaterThan(envelope[3]!);
  });
});
