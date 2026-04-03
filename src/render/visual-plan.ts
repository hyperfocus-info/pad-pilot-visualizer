import { clamp } from "../config";
import type {
  AudioFrameFeature,
  OverlayMode,
  PhraseBackgroundResponseBias,
  PhraseCompositionBias,
  PhraseHeroMotionBias,
  PhraseMotifFamily,
  PhraseTransitionCluster,
  RescuePolicy,
  SongVisualFamily,
  TransitionFamily,
  VisualPhrasePlan,
  VisualRegime,
  VisualState,
} from "../types";

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function maxValue(values: number[]): number {
  return values.reduce((best, value) => Math.max(best, value), 0);
}

function vectorAverage(vectors: Array<[number, number, number, number, number]>): [number, number, number, number, number] {
  if (vectors.length === 0) {
    return [0, 0, 0, 0, 0];
  }
  const total = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  for (const vector of vectors) {
    for (let index = 0; index < 5; index += 1) {
      total[index] += vector[index] ?? 0;
    }
  }
  return total.map((value) => value / vectors.length) as [number, number, number, number, number];
}

function resolveMinimumOutroStartFrame(frames: AudioFrameFeature[]): number | undefined {
  const finalBarIndex = frames[frames.length - 1]?.barIndex;
  if (finalBarIndex === undefined) {
    return undefined;
  }
  const outroStartBar = Math.max(0, finalBarIndex - 7);
  return frames.find((frame) => (frame.barIndex ?? finalBarIndex) >= outroStartBar)?.frameIndex;
}

const MIN_TERMINAL_OUTRO_WINDOW_SEC = 1.25;

function phraseBandDominance(frame: AudioFrameFeature): [number, number, number, number, number] {
  const total =
    (frame.normalizedLow ?? 0) +
    (frame.normalizedLowMid ?? 0) +
    (frame.normalizedMid ?? 0) +
    (frame.normalizedHighMid ?? 0) +
    (frame.normalizedHigh ?? 0);
  if (total <= 1e-6) {
    return [0, 0, 0, 0, 0];
  }
  return [
    (frame.normalizedLow ?? 0) / total,
    (frame.normalizedLowMid ?? 0) / total,
    (frame.normalizedMid ?? 0) / total,
    (frame.normalizedHighMid ?? 0) / total,
    (frame.normalizedHigh ?? 0) / total,
  ];
}

function frameBandWeighted(frame: AudioFrameFeature): number {
  return frame.bandWeightedScore ?? clamp(
    (frame.normalizedLow ?? 0) * 0.28 +
    (frame.normalizedLowMid ?? 0) * 0.20 +
    (frame.normalizedMid ?? 0) * 0.20 +
    (frame.normalizedHighMid ?? 0) * 0.18 +
    (frame.normalizedHigh ?? 0) * 0.14,
    0,
    1.6,
  );
}

function frameImpact(frame: AudioFrameFeature): number {
  return frame.impactBandScore ?? clamp(
    (frame.normalizedLow ?? 0) * 0.58 + (frame.normalizedHighMid ?? 0) * 0.42,
    0,
    1.6,
  );
}

function frameTexture(frame: AudioFrameFeature): number {
  return frame.textureBandScore ?? clamp(
    (frame.normalizedMid ?? 0) * 0.56 + (frame.normalizedHigh ?? 0) * 0.44,
    0,
    1.6,
  );
}

function frameVolatility(frame: AudioFrameFeature): number {
  return frame.bandVolatility ?? clamp(
    ((frame.onsetStrength ?? 0) * 0.55) + ((frame.peakStrength ?? 0) * 0.45),
    0,
    1.6,
  );
}

function dominantIndex(vector: [number, number, number, number, number]): number {
  let bestIndex = 0;
  let bestValue = vector[0] ?? 0;
  for (let index = 1; index < vector.length; index += 1) {
    if ((vector[index] ?? 0) > bestValue) {
      bestIndex = index;
      bestValue = vector[index] ?? 0;
    }
  }
  return bestIndex;
}

function chooseSongVisualFamily(frames: AudioFrameFeature[]): SongVisualFamily {
  const lowBias = average(frames.map((frame) => (frame.normalizedLow ?? 0) + (frame.normalizedLowMid ?? 0)));
  const highBias = average(frames.map((frame) => (frame.normalizedHighMid ?? 0) + (frame.normalizedHigh ?? 0)));
  const onsetDensity = average(frames.map((frame) => frame.onsetStrength));
  const volatility = average(frames.map((frame) => frame.bandVolatility ?? 0));
  const phraseContrast = maxValue(frames.map((frame) => frame.bandWeightedScore ?? 0)) - average(frames.map((frame) => frame.bandWeightedScore ?? 0));

  if (lowBias > 1.2 && onsetDensity > 0.3) return "ritual-drive";
  if (highBias > 1.15 && volatility > 0.18) return "glass-surge";
  if (highBias > lowBias && onsetDensity > 0.28) return "neon-drama";
  if (volatility < 0.12 && onsetDensity < 0.2) return "dust-glide";
  if (phraseContrast > 0.3 && lowBias > 0.9) return "shard-pressure";
  return "cathedral-bloom";
}

function choosePhraseMotifFamily(songFamily: SongVisualFamily, vector: [number, number, number, number, number], contrast: number, regime: VisualRegime): PhraseMotifFamily {
  const dominant = dominantIndex(vector);
  if (regime === "drop") return dominant >= 2 ? "shard-lattice" : "ribbon-surge";
  if (regime === "build") return contrast > 0.16 ? "glow-grid" : "cathedral-beam";
  if (regime === "breakdown") return songFamily === "dust-glide" ? "dust-choir" : "orbit-thread";
  if (songFamily === "ritual-drive") return dominant <= 1 ? "ribbon-surge" : "orbit-thread";
  if (songFamily === "glass-surge") return contrast > 0.24 ? "shard-lattice" : "glow-grid";
  if (songFamily === "neon-drama") return dominant >= 3 ? "glow-grid" : "ribbon-surge";
  if (songFamily === "dust-glide") return "dust-choir";
  if (songFamily === "shard-pressure") return "shard-lattice";
  return contrast > 0.08 ? "cathedral-beam" : dominant === 2 ? "orbit-thread" : "glow-grid";
}

function choosePhraseTransitionCluster(songFamily: SongVisualFamily, regime: VisualRegime, riseDensity: number, contrast: number): PhraseTransitionCluster {
  if (regime === "drop") return "impact";
  if (regime === "build") return contrast > 0.2 ? "prism" : "echo";
  if (regime === "breakdown") return songFamily === "dust-glide" ? "glide" : "carry";
  if (riseDensity > 0.28) return "shatter";
  if (songFamily === "cathedral-bloom") return "echo";
  return "carry";
}

function choosePhraseCompositionBias(regime: VisualRegime, vector: [number, number, number, number, number], overlayMode: OverlayMode): PhraseCompositionBias {
  if (regime === "breakdown") return "portrait-lock";
  if (regime === "intro" || regime === "outro") return "establish-breath";
  if (overlayMode === "stable-feedback") return "negative-space-push";
  if (dominantIndex(vector) <= 1) return "hero-split";
  if (dominantIndex(vector) >= 3) return "center-release";
  return "detail-lane";
}

function choosePhraseHeroMotionBias(regime: VisualRegime, impact: number, volatility: number): PhraseHeroMotionBias {
  if (regime === "drop") return "lunge";
  if (regime === "build") return volatility > 0.2 ? "surge" : "orbit";
  if (regime === "breakdown") return "drift";
  if (impact > 0.42) return "stutter";
  return "glide";
}

function choosePhraseBackgroundResponseBias(songFamily: SongVisualFamily, overlayMode: OverlayMode): PhraseBackgroundResponseBias {
  if (overlayMode === "sparse-contour") return "restrained";
  if (overlayMode === "pulse-wave") return "pulsed";
  if (songFamily === "glass-surge") return "sparked";
  if (songFamily === "cathedral-bloom") return "veiled";
  if (songFamily === "ritual-drive") return "banded";
  return "echoed";
}

export function rankRegimes(
  averageEnergy: number,
  averagePeak: number,
  averageOnset: number,
  progress: number,
  isLast: boolean,
  averageBandWeightedScore = averageEnergy,
  averageImpactBandScore = averagePeak,
  averageTextureBandScore = averageEnergy,
  bandVolatility = averageOnset,
  lowRiseDensity = averageOnset,
  midHighRiseDensity = averagePeak,
  phraseContrastVsPrevious = 0,
): Array<{ regime: VisualRegime; score: number }> {
  const introGate = progress < 0.14 ? 1 : 0;
  const outroGate = isLast || progress > 0.84 ? 1 : 0;
  const breakdownMomentum = clamp(0.26 - averageBandWeightedScore, 0, 0.3) + clamp(0.18 - lowRiseDensity, 0, 0.25);
  const grooveStability = clamp(1 - Math.abs(averageBandWeightedScore - 0.34) * 2.1 - Math.abs(bandVolatility - 0.16) * 2.4, 0, 1.1);

  const scores: Record<VisualRegime, number> = {
    intro: introGate * (0.82 + clamp(0.22 - averageBandWeightedScore, 0, 0.4) + clamp(0.16 - bandVolatility, 0, 0.25)),
    groove: 0.38 + grooveStability + clamp(averageTextureBandScore * 0.16 + averageOnset * 0.12, 0, 0.35),
    build: averageBandWeightedScore * 0.7 + midHighRiseDensity * 0.8 + phraseContrastVsPrevious * 0.9 + bandVolatility * 0.3,
    drop: averageImpactBandScore * 0.9 + lowRiseDensity * 0.4 + midHighRiseDensity * 0.65 + phraseContrastVsPrevious * 1.2,
    breakdown: 0.36 + breakdownMomentum + clamp(0.16 - phraseContrastVsPrevious, 0, 0.18),
    outro: outroGate * (0.78 + clamp(0.42 - averageBandWeightedScore, 0, 0.35) + clamp(progress - 0.84, 0, 0.3)),
  };

  if (averageImpactBandScore > 0.48 && phraseContrastVsPrevious > 0.14 && (lowRiseDensity + midHighRiseDensity) > 0.38) {
    scores.drop += 0.32;
  }
  if (midHighRiseDensity > 0.24 && phraseContrastVsPrevious > 0.08) {
    scores.build += 0.22;
  }
  if (lowRiseDensity < 0.08 && midHighRiseDensity < 0.08) {
    scores.breakdown += 0.18;
  }

  return (Object.entries(scores) as Array<[VisualRegime, number]>)
    .map(([regime, score]) => ({ regime, score }))
    .sort((a, b) => b.score - a.score);
}

export function classifyRegime(
  averageEnergy: number,
  averagePeak: number,
  averageOnset: number,
  progress: number,
  isLast: boolean,
): VisualRegime {
  if (progress < 0.08 && averageEnergy < 0.34) {
    return "intro";
  }
  if (isLast && averageEnergy < 0.5) {
    return "outro";
  }
  if ((averagePeak > 0.56 && averageEnergy > 0.48) || (averagePeak > 0.66 && averageOnset > 0.18)) {
    return "drop";
  }
  if ((averageOnset > 0.34 && averageEnergy > 0.38) || (averagePeak > 0.5 && averageOnset > 0.18)) {
    return "build";
  }
  if (averageEnergy < 0.24) {
    return "breakdown";
  }
  return rankRegimes(averageEnergy, averagePeak, averageOnset, progress, isLast)[0]!.regime;
}

function regimeBrightnessFloor(regime: VisualRegime, impact: number): number {
  switch (regime) {
    case "intro":
      return 0.07;
    case "groove":
      return 0.075 + Math.min(0.02, impact * 0.03);
    case "build":
      return 0.09;
    case "drop":
      return 0.11;
    case "breakdown":
      return 0.078;
    case "outro":
      return 0.072;
  }
}

function regimeOverlayMode(
  regime: VisualRegime,
  averageOnset: number,
  averagePeak: number,
  phraseContrastVsPrevious: number,
  lowVisibilityTrend: boolean,
  songFamily: SongVisualFamily,
): OverlayMode {
  if (regime === "drop") return averagePeak > 0.62 || phraseContrastVsPrevious > 0.2 ? "climax-burst" : "pulse-wave";
  if (regime === "build") return averageOnset > 0.3 ? "kinetic-scan" : "pulse-wave";
  if (regime === "breakdown") return lowVisibilityTrend ? "sparse-contour" : averageOnset < 0.12 ? "sparse-contour" : "stable-feedback";
  if (regime === "intro") return songFamily === "cathedral-bloom" && phraseContrastVsPrevious < 0.06 ? "stable-feedback" : "sparse-contour";
  if (regime === "outro") return phraseContrastVsPrevious > 0.1 ? "stable-feedback" : "sparse-contour";
  if (averagePeak > 0.52 && phraseContrastVsPrevious > 0.14) return "pulse-wave";
  if (averageOnset > 0.28 || phraseContrastVsPrevious > 0.08) return "kinetic-scan";
  return songFamily === "cathedral-bloom" ? "stable-feedback" : "sparse-contour";
}

function clusterToTransitionFamily(cluster: PhraseTransitionCluster, regime: VisualRegime, averagePeak: number): TransitionFamily {
  switch (cluster) {
    case "impact":
      return regime === "drop" ? "flash" : "compress";
    case "prism":
      return averagePeak > 0.55 ? "prism-fold" : "fragment";
    case "echo":
      return "halo-drift";
    case "shatter":
      return "mirror-kaleido";
    case "glide":
      return "wipe";
    case "carry":
    default:
      return regime === "breakdown" ? "melt-safe" : "carry";
  }
}

function regimeDensityCap(regime: VisualRegime, texture: number): number {
  switch (regime) {
    case "intro":
      return 0.6;
    case "groove":
      return clamp(0.76 + texture * 0.16, 0.76, 0.9);
    case "build":
      return 1;
    case "drop":
      return 1.14;
    case "breakdown":
      return 0.68;
    case "outro":
      return 0.58;
  }
}

function regimeMotionMode(regime: VisualRegime): VisualState["motionMode"] {
  switch (regime) {
    case "intro":
    case "outro":
      return "glide";
    case "breakdown":
      return "drift";
    case "build":
      return "surge";
    case "drop":
      return "burst";
    case "groove":
    default:
      return "pulse";
  }
}

function shotModeFromBias(regime: VisualRegime, compositionBias: PhraseCompositionBias): VisualState["shotMode"] {
  if (regime === "drop") return "climax";
  if (compositionBias === "portrait-lock") return "portrait";
  if (compositionBias === "establish-breath") return "establish";
  return "detail";
}

function effectPolicyFromRegime(regime: VisualRegime, contrast: number): VisualState["effectPolicy"] {
  if (regime === "drop") return "aggressive";
  if (regime === "build" || contrast > 0.18) return "balanced";
  return "safe";
}

function rescuePolicyFromRegime(regime: VisualRegime): RescuePolicy {
  switch (regime) {
    case "drop":
    case "groove":
      return "lift";
    case "build":
    case "breakdown":
      return "reinforce";
    case "intro":
    case "outro":
    default:
      return "recover";
  }
}

function regimeImageHoldMultiplier(regime: VisualRegime, contrast: number): number {
  switch (regime) {
    case "build":
      return clamp(0.82 - contrast * 0.12, 0.62, 0.82);
    case "drop":
      return 0.56;
    case "breakdown":
      return 1.28;
    case "intro":
    case "outro":
      return 1.16;
    case "groove":
    default:
      return 1;
  }
}

function chooseTransitionTriggerPreference(
  regime: VisualRegime,
  transientCutBias: number,
  rapidPeakDensity: number,
  phraseContrastVsPrevious: number,
): "swap" | "hold" | "mixed" {
  if (regime === "breakdown" && transientCutBias < 0.26 && phraseContrastVsPrevious < 0.1) {
    return "hold";
  }
  if (rapidPeakDensity > 0.22 || phraseContrastVsPrevious > 0.18) {
    return regime === "drop" || regime === "build" ? "mixed" : "swap";
  }
  return "swap";
}

function regimeTransitionDurationMultiplier(regime: VisualRegime, impact: number): number {
  switch (regime) {
    case "intro":
    case "outro":
      return 1.34;
    case "breakdown":
      return 1.18;
    case "groove":
      return 1.08;
    case "build":
      return 0.98;
    case "drop":
      return clamp(0.82 - impact * 0.08, 0.72, 0.84);
  }
}

function regimeTransitionCarryBias(regime: VisualRegime, contrast: number): number {
  switch (regime) {
    case "intro":
    case "outro":
      return 0.82;
    case "breakdown":
      return 0.84;
    case "groove":
      return 0.72;
    case "build":
      return clamp(0.58 - contrast * 0.08, 0.48, 0.58);
    case "drop":
      return 0.42;
  }
}

export function buildVisualPlan(params: {
  frames: AudioFrameFeature[];
  fps: number;
  secondsPerImage: number;
}): VisualPhrasePlan[] {
  if (params.frames.length === 0) {
    return [];
  }

  const songVisualFamily = chooseSongVisualFamily(params.frames);
  const phraseFrames = Math.max(
    Math.round(params.fps * Math.max(1.5, Math.min(params.secondsPerImage, 3))),
    Math.round(params.fps * 1.5),
  );
  const minimumOutroStartFrame = resolveMinimumOutroStartFrame(params.frames);
  const plan: VisualPhrasePlan[] = [];
  let previousRegime: VisualRegime | undefined;
  let previousRunLength = 0;
  let previousBandScore = 0;
  let previousOverlay: OverlayMode | undefined;
  let previousTransitionFamily: TransitionFamily | undefined;

  for (let startFrame = 0; startFrame < params.frames.length; startFrame += phraseFrames) {
    const endFrame = Math.min(params.frames.length, startFrame + phraseFrames);
    const slice = params.frames.slice(startFrame, endFrame);
    const progress = startFrame / Math.max(1, params.frames.length - 1);
    const isLast = endFrame >= params.frames.length;
    const averageEnergy = average(slice.map((frame) => frame.narrativeIntensity));
    const averagePeak = average(slice.map((frame) => frame.peakStrength));
    const averageOnset = average(slice.map((frame) => frame.onsetStrength));
    const averageBandWeightedScore = average(slice.map(frameBandWeighted));
    const averageImpactBandScore = average(slice.map(frameImpact));
    const averageTextureBandScore = average(slice.map(frameTexture));
    const bandVolatility = average(slice.map(frameVolatility));
    const bandDominanceVector = vectorAverage(slice.map(phraseBandDominance));
    const lowRiseDensity = slice.filter((frame) => (frame.bandRiseLow ?? 0) > 0.05 || (frame.bandRiseLowMid ?? 0) > 0.05).length / Math.max(1, slice.length);
    const midHighRiseDensity = slice.filter((frame) => (frame.bandRiseMid ?? 0) > 0.05 || (frame.bandRiseHighMid ?? 0) > 0.05 || (frame.bandRiseHigh ?? 0) > 0.05).length / Math.max(1, slice.length);
    const rapidPeakDensity = slice.filter((frame) => frame.peakStrength > 0.55 || frame.onsetStrength > 0.5 || (frame.impactBandScore ?? 0) > 0.45).length / Math.max(1, slice.length);
    const phraseContrastVsPrevious = clamp(Math.max(0, averageBandWeightedScore - previousBandScore), 0, 1);
    const transientCutBias = clamp(averageOnset * 0.35 + averagePeak * 0.2 + averageImpactBandScore * 0.3 + bandVolatility * 0.25, 0, 1.4);
    const rankedRegimes = rankRegimes(
      averageEnergy,
      averagePeak,
      averageOnset,
      progress,
      isLast,
      averageBandWeightedScore,
      averageImpactBandScore,
      averageTextureBandScore,
      bandVolatility,
      lowRiseDensity,
      midHighRiseDensity,
      phraseContrastVsPrevious,
    );
    const overlapsMinimumOutroSpan = minimumOutroStartFrame !== undefined && endFrame > minimumOutroStartFrame;
    let regime = overlapsMinimumOutroSpan ? "outro" : rankedRegimes[0]!.regime;
    const alternate = rankedRegimes[1];
    if (
      !overlapsMinimumOutroSpan &&
      previousRegime &&
      regime === previousRegime &&
      previousRunLength >= 2 &&
      alternate &&
      alternate.regime !== regime &&
      rankedRegimes[0]!.score - alternate.score <= 0.22
    ) {
      regime = alternate.regime;
    } else if (
      !overlapsMinimumOutroSpan &&
      alternate &&
      rankedRegimes[0]!.score - alternate.score <= 0.16 &&
      alternate.regime !== regime &&
      phraseContrastVsPrevious > 0.12
    ) {
      regime = alternate.regime;
    }

    const lowVisibilityTrend = previousOverlay === "stable-feedback" && averageBandWeightedScore < 0.24;
    let overlayMode = regimeOverlayMode(regime, averageOnset, averagePeak, phraseContrastVsPrevious, lowVisibilityTrend, songVisualFamily);
    if (previousOverlay === "stable-feedback" && overlayMode === "stable-feedback" && previousRunLength >= 1 && regime !== "breakdown") {
      overlayMode = averagePeak > 0.42 ? "pulse-wave" : "kinetic-scan";
    } else if (previousOverlay === overlayMode && previousRunLength >= 1) {
      overlayMode =
        overlayMode === "kinetic-scan" ? "pulse-wave" :
        overlayMode === "pulse-wave" ? "sparse-contour" :
        "kinetic-scan";
    }
    const phraseTransitionCluster = choosePhraseTransitionCluster(songVisualFamily, regime, lowRiseDensity + midHighRiseDensity, phraseContrastVsPrevious);
    let transitionFamily = clusterToTransitionFamily(phraseTransitionCluster, regime, averagePeak);
    if (previousTransitionFamily === transitionFamily) {
      transitionFamily =
        regime === "drop" ? "compress" :
        regime === "build" ? "fragment" :
        regime === "outro" ? "wipe" :
        regime === "breakdown" ? "halo-drift" :
        "compress";
    }
    const phraseMotifFamily = choosePhraseMotifFamily(songVisualFamily, bandDominanceVector, phraseContrastVsPrevious, regime);
    const phraseCompositionBias = choosePhraseCompositionBias(regime, bandDominanceVector, overlayMode);
    const phraseHeroMotionBias = choosePhraseHeroMotionBias(regime, averageImpactBandScore, bandVolatility);
    const phraseBackgroundResponseBias = choosePhraseBackgroundResponseBias(songVisualFamily, overlayMode);
    const imageHoldMultiplier = regimeImageHoldMultiplier(regime, phraseContrastVsPrevious);
    const transientCompression =
      averageImpactBandScore > 0.44 && phraseContrastVsPrevious > 0.16 ? 0.68 :
      averageImpactBandScore > 0.36 || averageOnset > 0.34 ? 0.82 :
      1;
    const effectiveImageHoldMultiplier = clamp(imageHoldMultiplier * transientCompression, 0.5, 1.5);
    const transitionOpportunityBias = clamp((1 / effectiveImageHoldMultiplier) * (0.8 + transientCutBias * 0.4 + phraseContrastVsPrevious * 0.3), 0.65, 2.2);
    const transitionTriggerPreference = chooseTransitionTriggerPreference(regime, transientCutBias, rapidPeakDensity, phraseContrastVsPrevious);
    const spawnArc =
      transitionTriggerPreference === "swap"
        ? "swap"
        : transitionTriggerPreference === "hold"
          ? "hold"
          : averageImpactBandScore > 0.44 || overlayMode === "climax-burst"
            ? "punctuate"
            : "mixed";
    const spawnEnergyTier =
      regime === "drop" || regime === "build" || averageImpactBandScore > 0.44
        ? "high"
        : regime === "groove" || regime === "breakdown" || averageBandWeightedScore > 0.28
          ? "mid"
          : "low";
    const transientOpportunityFrames = slice
      .filter((frame) => frame.peakStrength > 0.5 || (frame.impactBandScore ?? 0) > 0.42 || Boolean(frame.isFourBarDownbeat))
      .map((frame) => frame.frameIndex)
      .slice(0, 8);

    plan.push({
      startFrame,
      endFrame,
      startSec: slice[0]!.timeSec,
      endSec: slice[slice.length - 1]!.timeSec,
      regime,
      averageEnergy,
      peakiness: averagePeak,
      brightnessFloor: regimeBrightnessFloor(regime, averageImpactBandScore),
      densityCap: regimeDensityCap(regime, averageTextureBandScore),
      motionMode: regimeMotionMode(regime),
      overlayMode,
      transitionFamily,
      shotMode: shotModeFromBias(regime, phraseCompositionBias),
      effectPolicy: effectPolicyFromRegime(regime, phraseContrastVsPrevious),
      rescuePolicy: rescuePolicyFromRegime(regime),
      imageHoldMultiplier,
      effectiveImageHoldMultiplier,
      transientCutBias,
      rapidPeakDensity,
      transitionOpportunityBias,
      imageSwapAllowed: !(regime === "breakdown" && lowRiseDensity < 0.1 && phraseContrastVsPrevious < 0.12),
      transitionTriggerPreference,
      spawnArc,
      spawnEnergyTier,
      preferredCutFrame: Math.round(startFrame + (endFrame - startFrame) * clamp(effectiveImageHoldMultiplier < 1 ? 0.34 : 0.52, 0.2, 0.8)),
      transitionDurationMultiplier: regimeTransitionDurationMultiplier(regime, averageImpactBandScore),
      transitionCarryBias: regimeTransitionCarryBias(regime, phraseContrastVsPrevious),
      songVisualFamily,
      phraseMotifFamily,
      phraseTransitionCluster,
      phraseCompositionBias,
      phraseHeroMotionBias,
      phraseBackgroundResponseBias,
      averageBandWeightedScore,
      averageImpactBandScore,
      averageTextureBandScore,
      bandVolatility,
      bandDominanceVector,
      lowRiseDensity,
      midHighRiseDensity,
      phraseContrastVsPrevious,
      transientOpportunityFrames,
    });

    previousRunLength = regime === previousRegime ? previousRunLength + 1 : 0;
    previousRegime = regime;
    previousBandScore = averageBandWeightedScore;
    previousOverlay = overlayMode;
    previousTransitionFamily = transitionFamily;
  }

  if (plan.length >= 2) {
    const last = plan[plan.length - 1]!;
    const previous = plan[plan.length - 2]!;
    if (
      last.regime === "outro" &&
      previous.regime === "outro" &&
      last.endSec - last.startSec < MIN_TERMINAL_OUTRO_WINDOW_SEC
    ) {
      previous.endFrame = last.endFrame;
      previous.endSec = last.endSec;
      plan.pop();
    }
  }

  return plan;
}

export function summarizeVisualPlanVariety(visualPlan: VisualPhrasePlan[]): {
  regimeCount: number;
  overlayCount: number;
  transitionFamilyCount: number;
  imageHoldRange: number;
  motifFamilyCount: number;
  compositionBiasCount: number;
  dominantOverlayShare: number;
  dominantRegimeShare: number;
  phraseContrastRange: number;
  varietyScore: number;
} {
  if (visualPlan.length === 0) {
    return {
      regimeCount: 0,
      overlayCount: 0,
      transitionFamilyCount: 0,
      imageHoldRange: 0,
      motifFamilyCount: 0,
      compositionBiasCount: 0,
      dominantOverlayShare: 0,
      dominantRegimeShare: 0,
      phraseContrastRange: 0,
      varietyScore: 0,
    };
  }
  const holds = visualPlan.map((phrase) => phrase.imageHoldMultiplier);
  const contrasts = visualPlan.map((phrase) => phrase.phraseContrastVsPrevious ?? 0);
  const overlayCounts = new Map<string, number>();
  const regimeCounts = new Map<string, number>();
  for (const phrase of visualPlan) {
    overlayCounts.set(phrase.overlayMode, (overlayCounts.get(phrase.overlayMode) ?? 0) + 1);
    regimeCounts.set(phrase.regime, (regimeCounts.get(phrase.regime) ?? 0) + 1);
  }
  const dominantOverlayShare = Math.max(...overlayCounts.values()) / visualPlan.length;
  const dominantRegimeShare = Math.max(...regimeCounts.values()) / visualPlan.length;
  const phraseContrastRange = Math.max(...contrasts) - Math.min(...contrasts);
  const regimeCount = new Set(visualPlan.map((phrase) => phrase.regime)).size;
  const overlayCount = new Set(visualPlan.map((phrase) => phrase.overlayMode)).size;
  const transitionFamilyCount = new Set(visualPlan.map((phrase) => phrase.transitionFamily)).size;
  const motifFamilyCount = new Set(visualPlan.map((phrase) => phrase.phraseMotifFamily)).size;
  const compositionBiasCount = new Set(visualPlan.map((phrase) => phrase.phraseCompositionBias)).size;
  const imageHoldRange = Math.max(...holds) - Math.min(...holds);
  const varietyScore =
    regimeCount * 1.5 +
    overlayCount * 1.6 +
    transitionFamilyCount * 1.4 +
    motifFamilyCount * 1.2 +
    compositionBiasCount * 1.1 +
    imageHoldRange * 4 +
    phraseContrastRange * 5 +
    (1 - dominantOverlayShare) * 3 +
    (1 - dominantRegimeShare) * 3;

  return {
    regimeCount,
    overlayCount,
    transitionFamilyCount,
    imageHoldRange,
    motifFamilyCount,
    compositionBiasCount,
    dominantOverlayShare,
    dominantRegimeShare,
    phraseContrastRange,
    varietyScore,
  };
}

export function buildVisualPhraseLookup(totalFrames: number, visualPlan: VisualPhrasePlan[]): Uint16Array {
  const lookup = new Uint16Array(Math.max(0, totalFrames));
  let phraseIndex = 0;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    while (
      phraseIndex < visualPlan.length - 1 &&
      frameIndex >= (visualPlan[phraseIndex]?.endFrame ?? Number.POSITIVE_INFINITY)
    ) {
      phraseIndex += 1;
    }
    lookup[frameIndex] = phraseIndex;
  }
  return lookup;
}

export function getVisualStateAtFrame(
  frameIndex: number,
  visualPlan: VisualPhrasePlan[],
): VisualState {
  const phraseIndex = Math.max(
    0,
    visualPlan.findIndex((phrase) => frameIndex >= phrase.startFrame && frameIndex < phrase.endFrame),
  );
  const phrase = visualPlan[phraseIndex] ?? visualPlan[visualPlan.length - 1];
  if (!phrase) {
    return {
      frameIndex,
      phraseIndex: 0,
      phraseStartFrame: 0,
      phraseEndFrame: frameIndex + 1,
      phraseStartSec: 0,
      phraseEndSec: 0,
      regime: "groove",
      brightnessFloor: 0.075,
      densityCap: 1,
      motionMode: "pulse",
      overlayMode: "stable-feedback",
      transitionFamily: "carry",
      shotMode: "detail",
      effectPolicy: "balanced",
      rescuePolicy: "lift",
      imageHoldMultiplier: 1,
      effectiveImageHoldMultiplier: 1,
      transientCutBias: 0,
      rapidPeakDensity: 0,
      transitionOpportunityBias: 1,
      imageSwapAllowed: true,
      transitionTriggerPreference: "swap",
      spawnArc: "swap",
      spawnEnergyTier: "mid",
      preferredCutFrame: frameIndex,
      transitionDurationMultiplier: 1,
      transitionCarryBias: 0.7,
    };
  }

  return {
    frameIndex,
    phraseIndex,
    phraseStartFrame: phrase.startFrame,
    phraseEndFrame: phrase.endFrame,
    phraseStartSec: phrase.startSec,
    phraseEndSec: phrase.endSec,
    regime: phrase.regime,
    brightnessFloor: phrase.brightnessFloor,
    densityCap: phrase.densityCap,
    motionMode: phrase.motionMode,
    overlayMode: phrase.overlayMode,
    transitionFamily: phrase.transitionFamily,
    shotMode: phrase.shotMode,
    effectPolicy: phrase.effectPolicy,
    rescuePolicy: phrase.rescuePolicy,
    imageHoldMultiplier: phrase.imageHoldMultiplier,
    effectiveImageHoldMultiplier: phrase.effectiveImageHoldMultiplier,
    transientCutBias: phrase.transientCutBias,
    rapidPeakDensity: phrase.rapidPeakDensity,
    transitionOpportunityBias: phrase.transitionOpportunityBias,
    imageSwapAllowed: phrase.imageSwapAllowed,
    transitionTriggerPreference: phrase.transitionTriggerPreference,
    spawnArc: phrase.spawnArc,
    spawnEnergyTier: phrase.spawnEnergyTier,
    preferredCutFrame: phrase.preferredCutFrame,
    transitionDurationMultiplier: phrase.transitionDurationMultiplier,
    transitionCarryBias: phrase.transitionCarryBias,
  };
}
