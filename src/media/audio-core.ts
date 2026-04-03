import { clamp } from "../config";
import type { AnchorTrustState, AudioFrameFeature, BeatOriginSource, BpmTrustState } from "../types";

export interface BeatOriginCandidate {
  timeSec: number;
  peakStrength: number;
  lowBandShare: number;
  postPeakSilenceDrop: number;
  localRegularityScore: number;
}

export interface BeatOriginSelection {
  beatOriginSec: number;
  confidence: number;
  source: BeatOriginSource;
  anchorSearchStartSec: number;
  anchorSearchEndSec: number;
  candidateCount: number;
  supportHitCount: number;
  topCandidates: Array<{
    timeSec: number;
    score: number;
    confidence: number;
    supportHits: number;
  }>;
}

export interface TrustedBpmSelection {
  bpm: number;
  bpmSource: "source-metadata" | "trimmed-metadata" | "estimated" | "default";
  bpmTrustState: BpmTrustState;
}

const CANDIDATE_MIN_STRENGTH = 0.18;
const ANCHOR_CONFIDENCE_THRESHOLD = 0.6;
const NEAR_BEST_TOLERANCE = 0.08;
const MINIMUM_SUPPORTING_HITS = 4;
const IDEAL_BEAT_ERROR_SEC = 0.07;
const SOFT_BEAT_ERROR_SEC = 0.14;

export function percentile(values: number[], pct: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((sorted.length - 1) * pct);
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function frac(value: number): number {
  return value - Math.floor(value);
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedBeatAlignment(errorSec: number): number {
  if (errorSec <= IDEAL_BEAT_ERROR_SEC) {
    return 1;
  }
  if (errorSec >= SOFT_BEAT_ERROR_SEC) {
    return 0;
  }
  return 1 - (errorSec - IDEAL_BEAT_ERROR_SEC) / (SOFT_BEAT_ERROR_SEC - IDEAL_BEAT_ERROR_SEC);
}

function alignedPhase(value: number, intervalSec: number): number {
  return frac(value / Math.max(intervalSec, 1e-6));
}

export function estimateTempoFromPeaks(peaks: AudioFrameFeature[]): number | undefined {
  if (peaks.length < 4) {
    return undefined;
  }

  const histogram = new Map<number, number>();
  for (let i = 1; i < peaks.length; i += 1) {
    const delta = peaks[i]!.timeSec - peaks[i - 1]!.timeSec;
    if (delta <= 0.2 || delta >= 2.0) {
      continue;
    }
    const bpm = Math.round(60 / delta);
    const normalized = bpm < 70 ? bpm * 2 : bpm > 180 ? Math.round(bpm / 2) : bpm;
    if (normalized >= 70 && normalized <= 180) {
      histogram.set(normalized, (histogram.get(normalized) ?? 0) + 1);
    }
  }

  let bestBpm: number | undefined;
  let bestCount = 0;
  for (const [bpm, count] of histogram) {
    if (count > bestCount) {
      bestBpm = bpm;
      bestCount = count;
    }
  }
  return bestCount >= 3 ? bestBpm : undefined;
}

export function estimateTempoFromOnsets(samples: Float32Array, sampleRate: number): number | undefined {
  const windowSize = 1024;
  const hopSize = 512;
  const frameCount = Math.max(0, Math.floor((samples.length - windowSize) / hopSize) + 1);
  if (frameCount < 32) {
    return undefined;
  }

  const envelope = new Float64Array(frameCount);
  let previousEnergy = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * hopSize;
    let energy = 0;
    for (let sampleIndex = 0; sampleIndex < windowSize; sampleIndex += 1) {
      energy += Math.abs(samples[start + sampleIndex] ?? 0);
    }
    const delta = Math.max(0, energy - previousEnergy);
    envelope[frameIndex] = delta;
    previousEnergy = energy;
  }

  let envelopeMean = 0;
  for (let index = 0; index < envelope.length; index += 1) {
    envelopeMean += envelope[index]!;
  }
  envelopeMean /= Math.max(1, envelope.length);
  for (let index = 0; index < envelope.length; index += 1) {
    envelope[index] = Math.max(0, envelope[index]! - envelopeMean * 0.5);
  }

  const minLag = Math.floor((60 / 180) * (sampleRate / hopSize));
  const maxLag = Math.ceil((60 / 70) * (sampleRate / hopSize));
  let bestLag = 0;
  let bestScore = 0;
  const scores = new Map<number, number>();
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = lag; index < envelope.length; index += 1) {
      score += envelope[index]! * envelope[index - lag]!;
    }
    scores.set(lag, score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!bestLag || bestScore <= 0) {
    return undefined;
  }

  let selectedLag = bestLag;
  const doubleLag = bestLag * 2;
  const halfLag = Math.max(1, Math.floor(bestLag / 2));
  const doubleScore = scores.get(doubleLag) ?? 0;
  const halfScore = scores.get(halfLag) ?? 0;
  const bestBpm = 60 / ((bestLag * hopSize) / sampleRate);

  if (bestBpm > 140 && doubleLag <= maxLag && doubleScore >= bestScore * 0.82) {
    selectedLag = doubleLag;
  } else if (bestBpm < 90 && halfLag >= minLag && halfScore >= bestScore * 0.9) {
    selectedLag = halfLag;
  }

  const bpm = 60 / ((selectedLag * hopSize) / sampleRate);
  const normalized = bpm < 70 ? bpm * 2 : bpm > 180 ? bpm / 2 : bpm;
  return normalized >= 70 && normalized <= 180 ? Math.round(normalized) : undefined;
}

export function computeBeatGridState(timeSec: number, beatIntervalSec: number, beatOriginSec: number): {
  beatAlignedTimeSec: number;
  beatPhase: number;
  subBeatPhase: number;
  barPhase: number;
  isPreAnchor: boolean;
} {
  const beatAlignedTimeSec = timeSec - beatOriginSec;
  return {
    beatAlignedTimeSec,
    beatPhase: alignedPhase(beatAlignedTimeSec, beatIntervalSec),
    subBeatPhase: alignedPhase(beatAlignedTimeSec, Math.max(beatIntervalSec / 2, 1e-6)),
    barPhase: alignedPhase(beatAlignedTimeSec, Math.max(beatIntervalSec * 4, 1e-6)),
    isPreAnchor: beatAlignedTimeSec < 0,
  };
}

export function buildAnchorEnvelope(params: {
  lowSeries: number[];
  lowMidSeries: number[];
  midSeries: number[];
  highSeries: number[];
}): number[] {
  const raw = new Array<number>(params.lowSeries.length).fill(0);
  for (let index = 1; index < raw.length; index += 1) {
    const lowDelta = Math.max(0, params.lowSeries[index]! - params.lowSeries[index - 1]!);
    const lowMidDelta = Math.max(0, params.lowMidSeries[index]! - params.lowMidSeries[index - 1]!);
    const midDelta = Math.max(0, params.midSeries[index]! - params.midSeries[index - 1]!);
    const highDelta = Math.max(0, params.highSeries[index]! - params.highSeries[index - 1]!);
    raw[index] = lowDelta * 0.45 + lowMidDelta * 0.3 + midDelta * 0.2 + highDelta * 0.05;
  }

  const smoothed = new Array<number>(raw.length).fill(0);
  for (let index = 0; index < raw.length; index += 1) {
    const previous = raw[Math.max(0, index - 1)] ?? 0;
    const current = raw[index] ?? 0;
    const next = raw[Math.min(raw.length - 1, index + 1)] ?? 0;
    smoothed[index] = previous * 0.25 + current * 0.5 + next * 0.25;
  }
  return smoothed;
}

export function detectBeatOriginCandidates(params: {
  envelope: number[];
  lowSeries: number[];
  lowMidSeries: number[];
  midSeries: number[];
  highSeries: number[];
  fps: number;
  bpm: number;
  durationSec: number;
}): {
  candidates: BeatOriginCandidate[];
  searchStartSec: number;
  searchEndSec: number;
} {
  const searchStartSec = 0;
  const searchEndSec = Math.min(12, Math.max((60 / Math.max(params.bpm, 1)) * 6, params.durationSec * 0.2));
  const searchStartFrame = Math.max(1, Math.ceil(Math.max(0.08, searchStartSec) * params.fps));
  const searchEndFrame = Math.min(params.envelope.length - 2, Math.floor(searchEndSec * params.fps));
  const candidates: BeatOriginCandidate[] = [];
  const beatIntervalSec = 60 / Math.max(params.bpm, 1);

  for (let index = searchStartFrame; index <= searchEndFrame; index += 1) {
    const current = params.envelope[index] ?? 0;
    if (current <= (params.envelope[index - 1] ?? 0) || current < (params.envelope[index + 1] ?? 0)) {
      continue;
    }

    const baselineWindow = params.envelope.slice(Math.max(0, index - 8), Math.min(params.envelope.length, index + 9));
    const localMean = mean(baselineWindow);
    const localMedian = median(baselineWindow);
    const adaptiveThreshold = Math.max(localMean * 1.15, localMedian * 1.35, 1e-6);
    const normalizedStrength = current / adaptiveThreshold;
    if (normalizedStrength < CANDIDATE_MIN_STRENGTH) {
      continue;
    }

    const lowDelta = Math.max(0, (params.lowSeries[index] ?? 0) - (params.lowSeries[index - 1] ?? 0));
    const lowMidDelta = Math.max(0, (params.lowMidSeries[index] ?? 0) - (params.lowMidSeries[index - 1] ?? 0));
    const midDelta = Math.max(0, (params.midSeries[index] ?? 0) - (params.midSeries[index - 1] ?? 0));
    const highDelta = Math.max(0, (params.highSeries[index] ?? 0) - (params.highSeries[index - 1] ?? 0));
    const totalDelta = Math.max(1e-6, lowDelta + lowMidDelta + midDelta + highDelta);
    const lowBandShare = clamp((lowDelta + lowMidDelta * 0.8) / totalDelta, 0, 1);
    const postWindow = params.envelope.slice(index + 1, Math.min(params.envelope.length, index + 5));
    const postMean = mean(postWindow);
    const postPeakSilenceDrop = clamp(1 - postMean / Math.max(current, 1e-6), 0, 1);

    const localTimes = params.envelope
      .slice(Math.max(0, index - 18), Math.min(params.envelope.length, index + 19))
      .map((value, localIndex) => ({ value, frameIndex: Math.max(0, index - 18) + localIndex }))
      .filter((value) => value.value > current * 0.42 && value.frameIndex !== index);
    const localRegularityScore = clamp(mean(localTimes.map((entry) => {
      const deltaSec = Math.abs(entry.frameIndex - index) / Math.max(1, params.fps);
      const beatUnits = deltaSec / Math.max(beatIntervalSec, 1e-6);
      const nearestHalfBeat = Math.round(beatUnits * 2) / 2;
      const errorSec = Math.abs(beatUnits - nearestHalfBeat) * beatIntervalSec;
      return weightedBeatAlignment(errorSec);
    })), 0, 1);

    candidates.push({
      timeSec: index / params.fps,
      peakStrength: clamp(normalizedStrength / 3, 0, 1.25),
      lowBandShare,
      postPeakSilenceDrop,
      localRegularityScore,
    });
  }

  return { candidates, searchStartSec, searchEndSec };
}

export function selectBeatOrigin(params: {
  bpm: number;
  durationSec: number;
  searchStartSec: number;
  searchEndSec: number;
  candidates: BeatOriginCandidate[];
}): BeatOriginSelection {
  if (params.candidates.length === 0) {
    return {
      beatOriginSec: 0,
      confidence: 0,
      source: "fallback-zero",
      anchorSearchStartSec: params.searchStartSec,
      anchorSearchEndSec: params.searchEndSec,
      candidateCount: 0,
      supportHitCount: 0,
      topCandidates: [],
    };
  }

  const beatIntervalSec = 60 / Math.max(params.bpm, 1);
  const horizonEndSec = Math.min(params.durationSec, params.searchEndSec + 16, params.searchStartSec + beatIntervalSec * 32);
  const minimumSupportingHits = Math.min(MINIMUM_SUPPORTING_HITS, Math.max(2, Math.floor(horizonEndSec / Math.max(beatIntervalSec, 1e-6)) - 1));
  const scored = params.candidates.map((candidate) => {
    const following = params.candidates.filter((other) => other.timeSec > candidate.timeSec && other.timeSec <= horizonEndSec);
    const relevant = following.map((other) => {
      const deltaSec = other.timeSec - candidate.timeSec;
      const deltaBeats = deltaSec / beatIntervalSec;
      const nearestBeat = Math.round(deltaBeats);
      const nearestHalfBeat = Math.round(deltaBeats * 2) / 2;
      const beatErrorSec = Math.abs(deltaBeats - nearestBeat) * beatIntervalSec;
      const halfBeatErrorSec = Math.abs(deltaBeats - nearestHalfBeat) * beatIntervalSec;
      const weight = other.peakStrength * (0.75 + other.lowBandShare * 0.25);
      return {
        nearestBeat,
        beatErrorSec,
        halfBeatScore: weightedBeatAlignment(halfBeatErrorSec),
        alignment: weightedBeatAlignment(beatErrorSec),
        weight,
      };
    });

    const totalWeight = Math.max(1e-6, relevant.reduce((sum, hit) => sum + hit.weight, 0));
    const alignedWeight = relevant.reduce((sum, hit) => sum + hit.weight * hit.alignment, 0);
    const gridFitScore = clamp(alignedWeight / totalWeight, 0, 1);
    const supportHits = relevant.filter((hit) => hit.nearestBeat >= 1 && hit.beatErrorSec <= IDEAL_BEAT_ERROR_SEC).length;
    const regularityScore = clamp(mean(relevant.slice(0, 8).map((hit) => hit.halfBeatScore)), 0, 1);

    let downbeatWeight = 0;
    let downbeatStrongWeight = 0;
    for (const hit of relevant) {
      if (hit.nearestBeat >= 4 && hit.nearestBeat % 4 === 0) {
        downbeatWeight += hit.weight;
        downbeatStrongWeight += hit.weight * hit.alignment;
      }
    }
    const downbeatBias = clamp(downbeatStrongWeight / Math.max(1e-6, downbeatWeight), 0, 1);
    const earlinessBias = clamp(1 - (candidate.timeSec - params.searchStartSec) / Math.max(1e-6, params.searchEndSec - params.searchStartSec), 0, 1);
    const spuriousPenalty =
      clamp(0.45 - candidate.postPeakSilenceDrop, 0, 0.45) * 0.25 +
      (supportHits < minimumSupportingHits ? (minimumSupportingHits - supportHits) * 0.08 : 0);
    const score = clamp(
      gridFitScore * 0.62 +
      regularityScore * 0.14 +
      candidate.localRegularityScore * 0.08 +
      downbeatBias * 0.08 +
      earlinessBias * 0.06 +
      candidate.lowBandShare * 0.06 -
      spuriousPenalty,
      0,
      1,
    );
    const supportFactor = clamp(supportHits / minimumSupportingHits, 0, 1);
    const confidence = clamp(score * 0.75 + gridFitScore * 0.15 + supportFactor * 0.1, 0, 1);
    return {
      candidate,
      score,
      confidence,
      supportHits,
    };
  }).sort((a, b) => b.score - a.score || a.candidate.timeSec - b.candidate.timeSec);

  const best = scored[0]!;
  const nearBest = scored
    .filter((entry) => best.score - entry.score <= NEAR_BEST_TOLERANCE)
    .sort((a, b) => a.candidate.timeSec - b.candidate.timeSec || b.score - a.score);
  const selected = nearBest[0]!;
  const passes = selected.confidence >= ANCHOR_CONFIDENCE_THRESHOLD && selected.supportHits >= minimumSupportingHits;
  return {
    beatOriginSec: passes ? selected.candidate.timeSec : 0,
    confidence: passes ? selected.confidence : best.confidence,
    source: passes ? "transient-anchor" : "fallback-zero",
    anchorSearchStartSec: params.searchStartSec,
    anchorSearchEndSec: params.searchEndSec,
    candidateCount: params.candidates.length,
    supportHitCount: passes ? selected.supportHits : 0,
    topCandidates: scored.slice(0, 3).map((entry) => ({
      timeSec: entry.candidate.timeSec,
      score: entry.score,
      confidence: entry.confidence,
      supportHits: entry.supportHits,
    })),
  };
}

function relativeBpmDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-6);
}

export function classifyAnchorTrustState(source: BeatOriginSource, confidence: number | undefined): AnchorTrustState {
  if (source === "fallback-zero") {
    return "fallback-zero";
  }
  return (confidence ?? 0) < 0.72 ? "weak-anchor" : "transient-anchor";
}

export function selectTrustedBpm(params: {
  metadataBpm?: number;
  metadataSource?: "source-metadata" | "trimmed-metadata";
  estimatedBpm?: number;
  beatOriginSource: BeatOriginSource;
  beatOriginConfidence?: number;
  defaultBpm: number;
}): TrustedBpmSelection {
  const metadataBpm = params.metadataBpm;
  const estimatedBpm = params.estimatedBpm;
  if (metadataBpm === undefined && estimatedBpm !== undefined) {
    return {
      bpm: estimatedBpm,
      bpmSource: "estimated",
      bpmTrustState: "estimated-preferred",
    };
  }
  if (metadataBpm !== undefined && estimatedBpm === undefined) {
    return {
      bpm: metadataBpm,
      bpmSource: params.metadataSource ?? "source-metadata",
      bpmTrustState: "trusted-metadata",
    };
  }
  if (metadataBpm === undefined && estimatedBpm === undefined) {
    return {
      bpm: params.defaultBpm,
      bpmSource: "default",
      bpmTrustState: "estimated-preferred",
    };
  }

  const estimate = estimatedBpm!;
  const directDelta = relativeBpmDelta(metadataBpm!, estimate);
  const halfDoubleCandidates = [
    { bpm: estimate * 2, delta: relativeBpmDelta(metadataBpm!, estimate * 2) },
    { bpm: estimate / 2, delta: relativeBpmDelta(metadataBpm!, estimate / 2) },
  ].sort((a, b) => a.delta - b.delta);
  const halfDouble = halfDoubleCandidates[0]!;
  if (halfDouble.delta <= 0.04) {
    return {
      bpm: metadataBpm!,
      bpmSource: params.metadataSource ?? "source-metadata",
      bpmTrustState: "trusted-metadata-half-double-resolved",
    };
  }
  if (directDelta <= 0.06) {
    return {
      bpm: metadataBpm!,
      bpmSource: params.metadataSource ?? "source-metadata",
      bpmTrustState: "trusted-metadata",
    };
  }
  if (params.beatOriginSource === "fallback-zero") {
    return {
      bpm: estimate,
      bpmSource: "estimated",
      bpmTrustState: "metadata-rejected",
    };
  }
  if ((params.beatOriginConfidence ?? 0) < 0.62) {
    return {
      bpm: estimate,
      bpmSource: "estimated",
      bpmTrustState: "metadata-overridden",
    };
  }
  return {
    bpm: metadataBpm!,
    bpmSource: params.metadataSource ?? "source-metadata",
    bpmTrustState: "trusted-metadata",
  };
}
