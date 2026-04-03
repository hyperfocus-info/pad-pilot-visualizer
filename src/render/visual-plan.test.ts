import { describe, expect, test } from "bun:test";
import { buildVisualPhraseLookup, buildVisualPlan, summarizeVisualPlanVariety } from "./visual-plan";
import type { AudioFrameFeature } from "../types";

function makeFrame(
  frameIndex: number,
  timeSec: number,
  narrativeIntensity: number,
  peakStrength: number,
  onsetStrength: number,
): AudioFrameFeature {
  return {
    frameIndex,
    timeSec,
    subLowEnergy: narrativeIntensity * 0.8,
    lowEnergy: narrativeIntensity,
    lowMidEnergy: narrativeIntensity,
    midEnergy: narrativeIntensity,
    highMidEnergy: peakStrength * 0.75,
    highEnergy: narrativeIntensity,
    normalizedSubLow: narrativeIntensity * 0.8,
    normalizedLow: narrativeIntensity,
    normalizedLowMid: narrativeIntensity,
    normalizedMid: narrativeIntensity,
    normalizedHighMid: peakStrength * 0.75,
    normalizedHigh: peakStrength,
    motionEnergy: onsetStrength,
    isPeak: peakStrength > 0.58,
    peakStrength,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0,
    subBeatPhase: 0,
    barPhase: 0,
    beatPulse: 0,
    subBeatPulse: 0,
    onsetStrength,
    motionEnvelope: onsetStrength,
    dbLow: -10,
    dbLowMid: -10,
    dbMid: -10,
    dbHighMid: -10,
    dbHigh: -10,
    dbOverall: -10,
    dbNormalized: 0.5,
    pulseRaw: 0.5,
    pulseEnvelope: 0.5,
    pulseAccent: 0.5,
    narrativeIntensity,
    pulseScale: 1 + peakStrength,
    beatIndex: frameIndex,
    barIndex: Math.floor(frameIndex / 4),
    phrase4Index: Math.floor(frameIndex / 16),
    isBeatAccent: frameIndex % 2 === 0,
    isBarDownbeat: frameIndex % 4 === 0,
    isFourBarDownbeat: frameIndex % 16 === 0,
    barPulse: frameIndex % 4 === 0 ? 1 : 0.4,
    phrasePulse: frameIndex % 16 === 0 ? 1 : 0.5,
  };
}

describe("visual plan variety", () => {
  test("mixed-energy timelines create varied regimes, overlays, transitions, and image holds", () => {
    const fps = 10;
    const sections: Array<[number, number, number]> = [
      [0.18, 0.14, 0.08],
      [0.42, 0.48, 0.36],
      [0.64, 0.74, 0.52],
      [0.28, 0.2, 0.12],
      [0.54, 0.62, 0.26],
      [0.22, 0.18, 0.1],
    ];
    const frames: AudioFrameFeature[] = [];
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const [energy, peak, onset] = sections[sectionIndex]!;
      for (let localIndex = 0; localIndex < 20; localIndex += 1) {
        const frameIndex = sectionIndex * 20 + localIndex;
        frames.push(makeFrame(frameIndex, frameIndex / fps, energy, peak, onset));
      }
    }

    const plan = buildVisualPlan({ frames, fps, secondsPerImage: 2 });
    const summary = summarizeVisualPlanVariety(plan);

    expect(plan.length).toBeGreaterThanOrEqual(6);
    expect(summary.regimeCount).toBeGreaterThanOrEqual(4);
    expect(summary.overlayCount).toBeGreaterThanOrEqual(4);
    expect(summary.transitionFamilyCount).toBeGreaterThanOrEqual(4);
    expect(summary.motifFamilyCount).toBeGreaterThanOrEqual(3);
    expect(summary.compositionBiasCount).toBeGreaterThanOrEqual(3);
    expect(summary.varietyScore).toBeGreaterThan(18);
    expect(summary.imageHoldRange).toBeGreaterThan(0.4);
  });

  test("phrase lookup maps frames to the correct phrase windows", () => {
    const plan = [
      {
        startFrame: 0,
        endFrame: 10,
        startSec: 0,
        endSec: 1,
        regime: "intro",
        averageEnergy: 0.2,
        peakiness: 0.1,
        brightnessFloor: 0.07,
        densityCap: 0.62,
        motionMode: "glide",
        overlayMode: "sparse-contour",
        transitionFamily: "wipe",
        shotMode: "establish",
        effectPolicy: "safe",
        rescuePolicy: "recover",
        imageHoldMultiplier: 1.15,
        effectiveImageHoldMultiplier: 1.15,
        transientCutBias: 0.1,
        rapidPeakDensity: 0.05,
        transitionOpportunityBias: 0.9,
        imageSwapAllowed: true,
        transitionTriggerPreference: "swap",
        preferredCutFrame: 5,
        transitionDurationMultiplier: 1.45,
        transitionCarryBias: 0.82,
        songVisualFamily: "dust-glide",
        phraseMotifFamily: "dust-choir",
        phraseTransitionCluster: "glide",
        phraseCompositionBias: "establish-breath",
        phraseHeroMotionBias: "glide",
        phraseBackgroundResponseBias: "restrained",
      },
      {
        startFrame: 10,
        endFrame: 20,
        startSec: 1,
        endSec: 2,
        regime: "build",
        averageEnergy: 0.5,
        peakiness: 0.55,
        brightnessFloor: 0.09,
        densityCap: 1,
        motionMode: "surge",
        overlayMode: "kinetic-scan",
        transitionFamily: "fragment",
        shotMode: "detail",
        effectPolicy: "balanced",
        rescuePolicy: "reinforce",
        imageHoldMultiplier: 0.85,
        effectiveImageHoldMultiplier: 0.7,
        transientCutBias: 0.7,
        rapidPeakDensity: 0.3,
        transitionOpportunityBias: 1.5,
        imageSwapAllowed: true,
        transitionTriggerPreference: "mixed",
        preferredCutFrame: 14,
        transitionDurationMultiplier: 1.05,
        transitionCarryBias: 0.62,
        songVisualFamily: "glass-surge",
        phraseMotifFamily: "shard-lattice",
        phraseTransitionCluster: "prism",
        phraseCompositionBias: "detail-lane",
        phraseHeroMotionBias: "surge",
        phraseBackgroundResponseBias: "sparked",
      },
    ] as const;

    const lookup = buildVisualPhraseLookup(20, [...plan]);

    expect(lookup[0]).toBe(0);
    expect(lookup[9]).toBe(0);
    expect(lookup[10]).toBe(1);
    expect(lookup[19]).toBe(1);
  });

  test("weak low-energy windows avoid pulse-wave overlays across the planned phrase set", () => {
    const fps = 10;
    const frames: AudioFrameFeature[] = [];
    for (let index = 0; index < 20; index += 1) {
      frames.push(makeFrame(index, index / fps, 0.16, 0.18, 0.08));
    }
    for (let index = 20; index < 40; index += 1) {
      frames.push(makeFrame(index, index / fps, 0.22, 0.44, 0.12));
    }

    const plan = buildVisualPlan({ frames, fps, secondsPerImage: 2 });

    expect(plan.every((phrase) => phrase.overlayMode !== "pulse-wave")).toBe(true);
    expect(plan[0]?.overlayMode === "stable-feedback" || plan[0]?.overlayMode === "kinetic-scan" || plan[0]?.overlayMode === "sparse-contour").toBe(true);
  });

  test("final outro spans at least the last eight bars when bar data is present", () => {
    const fps = 4;
    const frames: AudioFrameFeature[] = [];
    for (let index = 0; index < 64; index += 1) {
      const frame = makeFrame(index, index / fps, 0.58, 0.62, 0.38);
      frames.push({
        ...frame,
        barIndex: Math.floor(index / 4),
        isBarDownbeat: index % 4 === 0,
      });
    }

    const plan = buildVisualPlan({ frames, fps, secondsPerImage: 2 });
    const outroPhrases = plan.filter((phrase) => phrase.regime === "outro");

    expect(outroPhrases.length).toBeGreaterThan(0);
    expect(outroPhrases[0]?.startFrame).toBeLessThanOrEqual(32);
    expect(plan.filter((phrase) => phrase.endFrame > 32).every((phrase) => phrase.regime === "outro")).toBe(true);
  });

  test("terminal outro windows under the minimum duration merge into the previous outro phrase", () => {
    const fps = 4;
    const frames: AudioFrameFeature[] = [];
    for (let index = 0; index < 68; index += 1) {
      const frame = makeFrame(index, index / fps, 0.56, 0.6, 0.34);
      frames.push({
        ...frame,
        barIndex: Math.floor(index / 4),
        isBarDownbeat: index % 4 === 0,
      });
    }

    const plan = buildVisualPlan({ frames, fps, secondsPerImage: 2 });
    const outroPhrases = plan.filter((phrase) => phrase.regime === "outro");

    expect(outroPhrases.length).toBeGreaterThan(0);
    expect(outroPhrases[outroPhrases.length - 1]!.endFrame).toBe(68);
    expect(outroPhrases.every((phrase) => phrase.endSec - phrase.startSec >= 1.25)).toBe(true);
  });
});
