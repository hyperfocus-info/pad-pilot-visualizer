import { AUDIO_SAMPLE_RATE, DEFAULT_BPM, FFT_SIZE, clamp } from "../config";
import type {
  AudioAnalysisResult,
  AudioFrameFeature,
  AudioMetadata,
  AudioSegmentFeature,
  BpmSource,
  DominantBand,
  ProbedAudioMetadata,
} from "../types";
import {
  buildAnchorEnvelope,
  classifyAnchorTrustState,
  computeBeatGridState,
  detectBeatOriginCandidates,
  estimateTempoFromOnsets,
  estimateTempoFromPeaks,
  percentile,
  selectTrustedBpm,
  selectBeatOrigin,
} from "./audio-core";
import { probeAudio as probeAudioWithFfprobe } from "./ffmpeg";

interface BandRange {
  name: DominantBand;
  minHz: number;
  maxHz: number;
  hueOffset: number;
}

const BAND_RANGES: BandRange[] = [
  { name: "low", minHz: 20, maxHz: 150, hueOffset: 12 },
  { name: "lowMid", minHz: 150, maxHz: 400, hueOffset: 84 },
  { name: "mid", minHz: 400, maxHz: 2000, hueOffset: 168 },
  { name: "high", minHz: 2000, maxHz: 8000, hueOffset: 252 },
];

function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return window;
}

function createBitReversal(size: number): Uint32Array {
  const bits = Math.round(Math.log2(size));
  const reversed = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let value = index;
    let out = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      out = (out << 1) | (value & 1);
      value >>= 1;
    }
    reversed[index] = out;
  }
  return reversed;
}

function fftInPlace(real: Float64Array, imaginary: Float64Array, bitReversal: Uint32Array): void {
  for (let index = 0; index < real.length; index += 1) {
    const reversed = bitReversal[index]!;
    if (reversed <= index) {
      continue;
    }
    const tmpRe = real[index]!;
    const tmpIm = imaginary[index]!;
    real[index] = real[reversed]!;
    imaginary[index] = imaginary[reversed]!;
    real[reversed] = tmpRe;
    imaginary[reversed] = tmpIm;
  }

  for (let size = 2; size <= real.length; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < real.length; start += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const angle = step * offset;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const oddRe = real[oddIndex]!;
        const oddIm = imaginary[oddIndex]!;
        const twiddleRe = cos * oddRe - sin * oddIm;
        const twiddleIm = sin * oddRe + cos * oddIm;
        const evenRe = real[evenIndex]!;
        const evenIm = imaginary[evenIndex]!;
        real[oddIndex] = evenRe - twiddleRe;
        imaginary[oddIndex] = evenIm - twiddleIm;
        real[evenIndex] = evenRe + twiddleRe;
        imaginary[evenIndex] = evenIm + twiddleIm;
      }
    }
  }
}

function dominantBandFromEnergies(low: number, lowMid: number, mid: number, high: number): BandRange {
  const ranked = [
    { range: BAND_RANGES[0]!, energy: low },
    { range: BAND_RANGES[1]!, energy: lowMid },
    { range: BAND_RANGES[2]!, energy: mid },
    { range: BAND_RANGES[3]!, energy: high },
  ].sort((a, b) => b.energy - a.energy);
  return ranked[0]!.range;
}

function dbFromEnergy(energy: number, reference: number): number {
  return clamp(20 * Math.log10(Math.max(energy / Math.max(reference, 1e-6), 1e-6)), -120, 0);
}

function emaAttackRelease(previous: number, target: number, attack: number, release: number): number {
  const alpha = target > previous ? attack : release;
  return previous + (target - previous) * alpha;
}

function rollingAverage(values: number[], index: number, windowSize: number): number {
  const start = Math.max(0, index - windowSize + 1);
  let sum = 0;
  for (let cursor = start; cursor <= index; cursor += 1) {
    sum += values[cursor] ?? 0;
  }
  return sum / Math.max(1, index - start + 1);
}

function fractionSeed(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

export async function analyzeAudio(params: {
  ffmpegPath: string;
  ffprobePath: string;
  inputPath: string;
  fps: number;
  beatsPerSegment: number;
  probedMetadata?: ProbedAudioMetadata;
  preferredBpm?: number;
  preferredBpmSource?: BpmSource;
  onProgress?: (current: number, total: number) => void;
}): Promise<AudioAnalysisResult> {
  const baseMetadata = params.probedMetadata ?? (await probeAudioWithFfprobe(params.ffprobePath, params.inputPath));
  const totalFrames = Math.ceil(baseMetadata.durationSec * params.fps);
  const hopSize = Math.max(256, Math.round(AUDIO_SAMPLE_RATE / params.fps));
  const window = createHannWindow(FFT_SIZE);
  const bitReversal = createBitReversal(FFT_SIZE);
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);

  const proc = Bun.spawn(
    [
      params.ffmpegPath,
      "-i",
      params.inputPath,
      "-ac",
      "1",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-f",
      "f32le",
      "-",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );

  const decoded = Buffer.from(await new Response(proc.stdout).arrayBuffer());
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg audio decode failed with code ${exitCode}`);
  }

  const samples = new Float32Array(
    decoded.buffer,
    decoded.byteOffset,
    Math.floor(decoded.byteLength / Float32Array.BYTES_PER_ELEMENT),
  );

  const lowSeries = new Array<number>(totalFrames).fill(0);
  const lowMidSeries = new Array<number>(totalFrames).fill(0);
  const midSeries = new Array<number>(totalFrames).fill(0);
  const highSeries = new Array<number>(totalFrames).fill(0);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const start = frameIndex * hopSize;
    if (start + FFT_SIZE > samples.length) {
      break;
    }

    real.fill(0);
    imaginary.fill(0);
    for (let index = 0; index < FFT_SIZE; index += 1) {
      real[index] = samples[start + index]! * window[index]!;
    }

    fftInPlace(real, imaginary, bitReversal);

    let low = 0;
    let lowMid = 0;
    let mid = 0;
    let high = 0;

    for (let bin = 0; bin < FFT_SIZE / 2; bin += 1) {
      const freq = (bin * AUDIO_SAMPLE_RATE) / FFT_SIZE;
      if (freq < BAND_RANGES[0]!.minHz || freq > BAND_RANGES[3]!.maxHz) {
        continue;
      }

      const magnitude = Math.hypot(real[bin]!, imaginary[bin]!);
      if (freq < BAND_RANGES[0]!.maxHz) {
        low += magnitude;
      } else if (freq < BAND_RANGES[1]!.maxHz) {
        lowMid += magnitude;
      } else if (freq < BAND_RANGES[2]!.maxHz) {
        mid += magnitude;
      } else {
        high += magnitude;
      }
    }

    lowSeries[frameIndex] = low;
    lowMidSeries[frameIndex] = lowMid;
    midSeries[frameIndex] = mid;
    highSeries[frameIndex] = high;
    params.onProgress?.(frameIndex + 1, totalFrames);
  }

  const smoothedLow = new Array<number>(totalFrames).fill(0);
  const smoothedLowMid = new Array<number>(totalFrames).fill(0);
  const smoothedMid = new Array<number>(totalFrames).fill(0);
  const smoothedHigh = new Array<number>(totalFrames).fill(0);

  let lowEma = 0;
  let lowMidEma = 0;
  let midEma = 0;
  let highEma = 0;
  for (let index = 0; index < totalFrames; index += 1) {
    lowEma = lowEma * 0.85 + lowSeries[index]! * 0.15;
    lowMidEma = lowMidEma * 0.85 + lowMidSeries[index]! * 0.15;
    midEma = midEma * 0.85 + midSeries[index]! * 0.15;
    highEma = highEma * 0.85 + highSeries[index]! * 0.15;
    smoothedLow[index] = lowEma;
    smoothedLowMid[index] = lowMidEma;
    smoothedMid[index] = midEma;
    smoothedHigh[index] = highEma;
  }

  const lowP95 = percentile(smoothedLow, 0.95) || 1;
  const lowMidP95 = percentile(smoothedLowMid, 0.95) || 1;
  const midP95 = percentile(smoothedMid, 0.95) || 1;
  const highP95 = percentile(smoothedHigh, 0.95) || 1;
  const subLowP95 = lowP95 * 0.58 || 1;
  const highMidP95 = (midP95 * 0.38 + highP95 * 0.22) || 1;

  const frames: AudioFrameFeature[] = new Array(totalFrames);
  const motionSeries = new Array<number>(totalFrames).fill(0);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const timeSec = frameIndex / params.fps;
    const subLowEnergy = smoothedLow[frameIndex]! * 0.58;
    const highMidEnergy = smoothedMid[frameIndex]! * 0.38 + smoothedHigh[frameIndex]! * 0.22;
    const normalizedSubLow = clamp(subLowEnergy / subLowP95, 0, 1.6);
    const normalizedLow = clamp(smoothedLow[frameIndex]! / lowP95, 0, 1.6);
    const normalizedLowMid = clamp(smoothedLowMid[frameIndex]! / lowMidP95, 0, 1.6);
    const normalizedMid = clamp(smoothedMid[frameIndex]! / midP95, 0, 1.6);
    const normalizedHighMid = clamp(highMidEnergy / highMidP95, 0, 1.6);
    const normalizedHigh = clamp(smoothedHigh[frameIndex]! / highP95, 0, 1.6);
    const motionEnergy = normalizedSubLow * 0.34 + normalizedLow * 0.38 + normalizedMid * 0.2 + normalizedHighMid * 0.08;
    motionSeries[frameIndex] = motionEnergy;
    frames[frameIndex] = {
      frameIndex,
      timeSec,
      beatAlignedTimeSec: timeSec,
      isPreAnchor: false,
      subLowEnergy,
      lowEnergy: smoothedLow[frameIndex]!,
      lowMidEnergy: smoothedLowMid[frameIndex]!,
      midEnergy: smoothedMid[frameIndex]!,
      highMidEnergy,
      highEnergy: smoothedHigh[frameIndex]!,
      normalizedSubLow,
      normalizedLow,
      normalizedLowMid,
      normalizedMid,
      normalizedHighMid,
      normalizedHigh,
      motionEnergy,
      isPeak: false,
      peakStrength: 0,
      segmentIndex: 0,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 180,
      beatPhase: 0,
      subBeatPhase: 0,
      barPhase: 0,
      beatPulse: 0,
      subBeatPulse: 0,
      onsetStrength: 0,
      motionEnvelope: 0,
      dbLow: -120,
      dbLowMid: -120,
      dbMid: -120,
      dbHighMid: -120,
      dbHigh: -120,
      dbOverall: -120,
      dbNormalized: 0,
      bandDeltaLow: 0,
      bandDeltaLowMid: 0,
      bandDeltaMid: 0,
      bandDeltaHighMid: 0,
      bandDeltaHigh: 0,
      bandAvgLow: 0,
      bandAvgLowMid: 0,
      bandAvgMid: 0,
      bandAvgHighMid: 0,
      bandAvgHigh: 0,
      bandRiseLow: 0,
      bandRiseLowMid: 0,
      bandRiseMid: 0,
      bandRiseHighMid: 0,
      bandRiseHigh: 0,
      bandRelativeScore: 0,
      bandWeightedScore: 0,
      impactBandScore: 0,
      textureBandScore: 0,
      bandVolatility: 0,
      songSignaturePhase: clamp(totalFrames <= 1 ? 0 : frameIndex / (totalFrames - 1), 0, 1),
      phraseSignaturePhase: 0,
      pulseRaw: 1,
      pulseEnvelope: 1,
      pulseAccent: 1,
      narrativeIntensity: 0,
      pulseScale: 1,
    };
  }

  const onsetSeries = new Array<number>(totalFrames).fill(0);
  let maxOnset = 1e-6;
  for (let index = 1; index < totalFrames; index += 1) {
    const onset = Math.max(0, motionSeries[index]! - motionSeries[index - 1]!);
    onsetSeries[index] = onset;
    maxOnset = Math.max(maxOnset, onset);
  }

  for (let index = 2; index < frames.length - 2; index += 1) {
    const local = motionSeries.slice(Math.max(0, index - 15), index + 1);
    const localMean = local.reduce((sum, value) => sum + value, 0) / Math.max(1, local.length);
    const threshold = localMean * 1.18;
    const current = frames[index]!;
    const isPeak =
      current.motionEnergy > motionSeries[index - 1]! &&
      current.motionEnergy >= motionSeries[index + 1]! &&
      current.motionEnergy > threshold;
    current.isPeak = isPeak;
    current.peakStrength = isPeak ? clamp((current.motionEnergy - threshold) / Math.max(threshold, 1e-6), 0, 2) : 0;
  }

  const estimatedBpm =
    estimateTempoFromOnsets(samples, AUDIO_SAMPLE_RATE) ??
    estimateTempoFromPeaks(frames.filter((frame) => frame.isPeak));
  const anchorEnvelope = buildAnchorEnvelope({
    lowSeries: smoothedLow,
    lowMidSeries: smoothedLowMid,
    midSeries: smoothedMid,
    highSeries: smoothedHigh,
  });
  const provisionalBpm = params.preferredBpm ?? estimatedBpm ?? DEFAULT_BPM;
  const provisionalBeatOrigin = selectBeatOrigin({
    bpm: provisionalBpm,
    durationSec: baseMetadata.durationSec,
    ...detectBeatOriginCandidates({
      envelope: anchorEnvelope,
      lowSeries: smoothedLow,
      lowMidSeries: smoothedLowMid,
      midSeries: smoothedMid,
      highSeries: smoothedHigh,
      fps: params.fps,
      bpm: provisionalBpm,
      durationSec: baseMetadata.durationSec,
    }),
  });
  const trustedBpm = selectTrustedBpm({
    metadataBpm: params.preferredBpm,
    metadataSource:
      params.preferredBpmSource === "source-metadata" || params.preferredBpmSource === "trimmed-metadata"
        ? params.preferredBpmSource
        : undefined,
    estimatedBpm,
    beatOriginSource: provisionalBeatOrigin.source,
    beatOriginConfidence: provisionalBeatOrigin.confidence,
    defaultBpm: DEFAULT_BPM,
  });
  const bpm = trustedBpm.bpm;
  const bpmSource = trustedBpm.bpmSource;
  const beatOrigin = bpm === provisionalBpm
    ? provisionalBeatOrigin
    : selectBeatOrigin({
        bpm,
        durationSec: baseMetadata.durationSec,
        ...detectBeatOriginCandidates({
          envelope: anchorEnvelope,
          lowSeries: smoothedLow,
          lowMidSeries: smoothedLowMid,
          midSeries: smoothedMid,
          highSeries: smoothedHigh,
          fps: params.fps,
          bpm,
          durationSec: baseMetadata.durationSec,
        }),
      });
  const beatIntervalSec = 60 / bpm;
  const anchorTrustState = classifyAnchorTrustState(beatOrigin.source, beatOrigin.confidence);
  const dbOverallSeries = frames.map((frame) => {
    const overallEnergy = frame.lowEnergy * 0.4 + frame.lowMidEnergy * 0.3 + frame.midEnergy * 0.2 + frame.highEnergy * 0.1;
    const overallReference = lowP95 * 0.4 + lowMidP95 * 0.3 + midP95 * 0.2 + highP95 * 0.1;
    return dbFromEnergy(overallEnergy, overallReference);
  });
  const dbSongP10 = percentile(dbOverallSeries, 0.1);
  const dbSongP50 = percentile(dbOverallSeries, 0.5);
  const dbSongP90 = percentile(dbOverallSeries, 0.9);
  const normalizedLowSeries = frames.map((frame) => frame.normalizedLow);
  const normalizedLowMidSeries = frames.map((frame) => frame.normalizedLowMid);
  const normalizedMidSeries = frames.map((frame) => frame.normalizedMid);
  const normalizedHighMidSeries = frames.map((frame) => frame.normalizedHighMid);
  const normalizedHighSeries = frames.map((frame) => frame.normalizedHigh);
  const segmentDurationSec = params.beatsPerSegment * (60 / bpm);
  const segmentCount = Math.max(1, Math.ceil(baseMetadata.durationSec / segmentDurationSec));
  const segments: AudioSegmentFeature[] = [];
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const startSec = segmentIndex * segmentDurationSec;
    const endSec = Math.min(baseMetadata.durationSec, startSec + segmentDurationSec);
    const startFrame = Math.floor(startSec * params.fps);
    const endFrame = Math.min(totalFrames, Math.ceil(endSec * params.fps));

    let subLow = 0;
    let low = 0;
    let lowMid = 0;
    let mid = 0;
    let highMid = 0;
    let high = 0;
    const frameCount = Math.max(1, endFrame - startFrame);
    for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
      subLow += frames[frameIndex]?.subLowEnergy ?? 0;
      low += smoothedLow[frameIndex] ?? 0;
      lowMid += smoothedLowMid[frameIndex] ?? 0;
      mid += smoothedMid[frameIndex] ?? 0;
      highMid += frames[frameIndex]?.highMidEnergy ?? 0;
      high += smoothedHigh[frameIndex] ?? 0;
    }

    subLow /= frameCount;
    low /= frameCount;
    lowMid /= frameCount;
    mid /= frameCount;
    highMid /= frameCount;
    high /= frameCount;

    const dominantBand = dominantBandFromEnergies(low, lowMid, mid, high);
    const totalEnergy = Math.max(1e-6, low + lowMid + mid + high);
    const lowWeight = low / totalEnergy;
    const lowMidWeight = lowMid / totalEnergy;
    const midWeight = mid / totalEnergy;
    const highMidWeight = highMid / totalEnergy;
    const highWeight = high / totalEnergy;
    const sliceFrames = frames.slice(startFrame, endFrame);
    const energyTilt = clamp((lowWeight + lowMidWeight) - (midWeight + highWeight), -1, 1);
    const brightnessTilt = clamp((highMidWeight + highWeight) - (lowWeight + lowMidWeight), -1, 1);
    const impactDensity = clamp(
      sliceFrames.reduce((sum, frame) => sum + (frame.impactBandScore ?? 0), 0) / Math.max(1, sliceFrames.length),
      0,
      1.6,
    );
    const movementSkew = clamp(
      sliceFrames.reduce((sum, frame) => sum + ((frame.bandWeightedScore ?? 0) - (frame.textureBandScore ?? 0)), 0) / Math.max(1, sliceFrames.length),
      -1,
      1,
    );
    const motifSeed = Math.floor(fractionSeed(startSec * 0.71 + dominantBand.hueOffset * 0.013 + energyTilt * 2.7) * 1_000_000);
    const transitionSeed = Math.floor(fractionSeed(endSec * 0.49 + brightnessTilt * 3.1 + impactDensity * 2.3) * 1_000_000);
    segments.push({
      index: segmentIndex,
      startSec,
      endSec,
      dominantHz: (dominantBand.minHz + dominantBand.maxHz) / 2,
      dominantBand: dominantBand.name,
      rainbowHueOffset: dominantBand.hueOffset,
      paletteWeights: {
        subLow: subLow / totalEnergy,
        low: lowWeight,
        lowMid: lowMidWeight,
        mid: midWeight,
        highMid: highMidWeight,
        high: highWeight,
      },
      motionScale: clamp((low + lowMid * 0.6) / Math.max(lowP95, 1), 0.75, 1.8),
      densityScale: clamp((mid + high * 0.5) / Math.max(midP95, 1), 0.75, 1.6),
      energyTilt,
      brightnessTilt,
      impactDensity,
      movementSkew,
      bandDominanceVector: [lowWeight, lowMidWeight, midWeight, highMidWeight, highWeight],
      motifSeed,
      transitionSeed,
    });
  }

  let pulseEnvelope = 1;
  for (const frame of frames) {
    const segmentIndex = Math.min(segments.length - 1, Math.floor(frame.timeSec / segmentDurationSec));
    const segment = segments[segmentIndex]!;
    frame.segmentIndex = segmentIndex;
    frame.dominantHz = segment.dominantHz;
    frame.dominantBand = segment.dominantBand;
    frame.rainbowHueOffset = segment.rainbowHueOffset;
    frame.dbLow = dbFromEnergy(frame.lowEnergy, lowP95);
    frame.dbLowMid = dbFromEnergy(frame.lowMidEnergy, lowMidP95);
    frame.dbMid = dbFromEnergy(frame.midEnergy, midP95);
    frame.dbHighMid = dbFromEnergy(frame.highMidEnergy, highMidP95);
    frame.dbHigh = dbFromEnergy(frame.highEnergy, highP95);
    frame.dbOverall = dbOverallSeries[frame.frameIndex] ?? -120;
    frame.dbNormalized = clamp((frame.dbOverall - dbSongP10) / Math.max(1e-6, dbSongP90 - dbSongP10), 0, 1);
    const previousFrame = frames[Math.max(0, frame.frameIndex - 1)]!;
    const bandAvgLow = rollingAverage(normalizedLowSeries, frame.frameIndex, 24);
    const bandAvgLowMid = rollingAverage(normalizedLowMidSeries, frame.frameIndex, 24);
    const bandAvgMid = rollingAverage(normalizedMidSeries, frame.frameIndex, 24);
    const bandAvgHighMid = rollingAverage(normalizedHighMidSeries, frame.frameIndex, 24);
    const bandAvgHigh = rollingAverage(normalizedHighSeries, frame.frameIndex, 24);
    const bandDeltaLow = frame.normalizedLow - (previousFrame.normalizedLow ?? frame.normalizedLow);
    const bandDeltaLowMid = frame.normalizedLowMid - (previousFrame.normalizedLowMid ?? frame.normalizedLowMid);
    const bandDeltaMid = frame.normalizedMid - (previousFrame.normalizedMid ?? frame.normalizedMid);
    const bandDeltaHighMid = frame.normalizedHighMid - (previousFrame.normalizedHighMid ?? frame.normalizedHighMid);
    const bandDeltaHigh = frame.normalizedHigh - (previousFrame.normalizedHigh ?? frame.normalizedHigh);
    const bandRiseLow = Math.max(0, bandDeltaLow);
    const bandRiseLowMid = Math.max(0, bandDeltaLowMid);
    const bandRiseMid = Math.max(0, bandDeltaMid);
    const bandRiseHighMid = Math.max(0, bandDeltaHighMid);
    const bandRiseHigh = Math.max(0, bandDeltaHigh);
    const lowScore = bandRiseLow * 0.8 + Math.max(0, frame.normalizedLow - bandAvgLow) * 0.2;
    const lowMidScore = bandRiseLowMid * 0.8 + Math.max(0, frame.normalizedLowMid - bandAvgLowMid) * 0.2;
    const midScore = bandRiseMid * 0.8 + Math.max(0, frame.normalizedMid - bandAvgMid) * 0.2;
    const highMidScore = bandRiseHighMid * 0.8 + Math.max(0, frame.normalizedHighMid - bandAvgHighMid) * 0.2;
    const highScore = bandRiseHigh * 0.8 + Math.max(0, frame.normalizedHigh - bandAvgHigh) * 0.2;
    frame.bandAvgLow = bandAvgLow;
    frame.bandAvgLowMid = bandAvgLowMid;
    frame.bandAvgMid = bandAvgMid;
    frame.bandAvgHighMid = bandAvgHighMid;
    frame.bandAvgHigh = bandAvgHigh;
    frame.bandDeltaLow = bandDeltaLow;
    frame.bandDeltaLowMid = bandDeltaLowMid;
    frame.bandDeltaMid = bandDeltaMid;
    frame.bandDeltaHighMid = bandDeltaHighMid;
    frame.bandDeltaHigh = bandDeltaHigh;
    frame.bandRiseLow = bandRiseLow;
    frame.bandRiseLowMid = bandRiseLowMid;
    frame.bandRiseMid = bandRiseMid;
    frame.bandRiseHighMid = bandRiseHighMid;
    frame.bandRiseHigh = bandRiseHigh;
    frame.bandRelativeScore = clamp((lowScore + lowMidScore + midScore + highMidScore + highScore) / 5, 0, 1.6);
    frame.bandWeightedScore = clamp(lowScore * 0.28 + lowMidScore * 0.2 + midScore * 0.2 + highMidScore * 0.18 + highScore * 0.14, 0, 1.6);
    frame.impactBandScore = clamp(lowScore * 0.58 + highMidScore * 0.42, 0, 1.6);
    frame.textureBandScore = clamp(midScore * 0.56 + highScore * 0.44, 0, 1.6);
    frame.bandVolatility = clamp((Math.abs(bandDeltaLow) + Math.abs(bandDeltaLowMid) + Math.abs(bandDeltaMid) + Math.abs(bandDeltaHighMid) + Math.abs(bandDeltaHigh)) / 5, 0, 1.6);
    frame.phraseSignaturePhase = clamp((frame.timeSec % segmentDurationSec) / Math.max(segmentDurationSec, 1e-6), 0, 1);
    const gridState = computeBeatGridState(frame.timeSec, beatIntervalSec, beatOrigin.beatOriginSec);
    frame.beatAlignedTimeSec = gridState.beatAlignedTimeSec;
    frame.isPreAnchor = gridState.isPreAnchor;
    frame.beatPhase = gridState.beatPhase;
    frame.subBeatPhase = gridState.subBeatPhase;
    frame.barPhase = gridState.barPhase;
    const beatPulse = frame.beatPhase < 0.35 ? Math.exp(-frame.beatPhase * 7.5) : 0;
    const subBeatPulse = frame.subBeatPhase < 0.22 ? Math.exp(-frame.subBeatPhase * 9.0) : 0;
    frame.onsetStrength = clamp(onsetSeries[frame.frameIndex]! / maxOnset, 0, 1);
    frame.beatPulse = frame.isPreAnchor
      ? Math.min(0.18 + frame.onsetStrength * 0.22 + beatPulse * 0.15, 0.34)
      : beatPulse;
    frame.subBeatPulse = frame.isPreAnchor
      ? Math.min(0.1 + frame.onsetStrength * 0.14 + subBeatPulse * 0.1, 0.24)
      : subBeatPulse;
    frame.pulseRaw = 1 + 2.2 * Math.pow(clamp((frame.bandWeightedScore ?? 0) / 1.2, 0, 1.4), 1.8);
    pulseEnvelope = emaAttackRelease(pulseEnvelope, frame.pulseRaw, 0.45, 0.12);
    frame.pulseEnvelope = pulseEnvelope;
    frame.pulseAccent = 1 + frame.beatPulse * 0.35 + frame.onsetStrength * 0.45;
    const climaxBoost = (frame.bandWeightedScore ?? 0) >= 0.48 && frame.onsetStrength > 0.7 && frame.barPhase > 0.55 ? 0.25 : 0;
    frame.pulseScale = clamp(frame.pulseEnvelope * frame.pulseAccent + climaxBoost, 1, climaxBoost > 0 ? 4 : 3.2);
    frame.narrativeIntensity = clamp((frame.bandWeightedScore ?? 0) * 0.5 + frame.onsetStrength * 0.3 + frame.beatPulse * 0.2, 0, 1);
    frame.motionEnvelope = clamp(frame.narrativeIntensity, 0, 1);
  }

  const metadata: AudioMetadata = {
    durationSec: baseMetadata.durationSec,
    sampleRate: baseMetadata.sampleRate,
    channels: baseMetadata.channels,
    bpm,
    beatIntervalSec,
    estimatedBpm,
    bpmSource,
    bpmTrustState: trustedBpm.bpmTrustState,
    beatOriginSec: beatOrigin.beatOriginSec,
    beatOriginConfidence: beatOrigin.confidence,
    beatOriginSource: beatOrigin.source,
    anchorTrustState,
    anchorSearchStartSec: beatOrigin.anchorSearchStartSec,
    anchorSearchEndSec: beatOrigin.anchorSearchEndSec,
    anchorCandidateCount: beatOrigin.candidateCount,
    anchorSupportHitCount: beatOrigin.supportHitCount,
    anchorTopCandidates: beatOrigin.topCandidates,
  };

  return { metadata, frames, segments };
}
