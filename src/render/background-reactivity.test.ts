import { describe, expect, test } from "bun:test";
import type { AudioFrameFeature, BackgroundPlan, EdgeMap, RenderTheme } from "../types";
import { buildCompositionPlan } from "./composition-plan";
import {
  computeBackgroundAccentStyle,
  computeBackgroundReactiveDrives,
  computeHeroEmissionRecovery,
} from "./frame-renderer";
import { buildSceneGraph, isPeakColorEligibleBackgroundElement } from "./scene-graph";

function makeTheme(styleMode: RenderTheme["styleMode"], overrides: Partial<RenderTheme["styleProfile"]> = {}): RenderTheme {
  return {
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    paletteStops: [],
    hueStops: [],
    motionScale: 1,
    densityScale: 1,
    nebula: {
      voidColor: "",
      coreCyan: "",
      tealGlow: "",
      purpleBody: "",
      magentaBody: "",
      orangeEdge: "",
      sparkWhite: "",
      sparkYellow: "",
    },
    vortexBias: 1,
    lightningHueOffset: 0,
    shadowTint: "",
    lowBandColor: "",
    lowMidBandColor: "",
    midBandColor: "",
    highBandColor: "",
    styleProfile: {
      imagePath: `${styleMode}.png`,
      firstPixelR: 0,
      firstPixelG: 0,
      firstPixelB: 0,
      averageR: 64,
      averageG: 72,
      averageB: 98,
      medianR: 64,
      medianG: 72,
      medianB: 98,
      modeR: 92,
      modeG: 108,
      modeB: 140,
      rangeR: 0,
      rangeG: 0,
      rangeB: 0,
      averageHue: 200,
      effectSeed: 0,
      effectBucket: 0,
      effectCycle: 0,
      effectMode: 0,
      transitionMode: 0,
      dominantHue: 210,
      hueVariance: 0.25,
      saturationMean: 0.42,
      lightnessMean: 0.34,
      warmCoolBias: 0,
      contrast: 0.3,
      edgeDensity: 0.45,
      symmetry: 0.68,
      clusterCount: 1,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
      ...overrides,
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [
      { hue: 190, saturation: 58, lightness: 34, alpha: 1 },
      { hue: 224, saturation: 66, lightness: 42, alpha: 1 },
    ],
    imageWarmCoolBias: 0,
    imageContrast: 0.2,
    rawEffectMode: 0,
    effectiveEffectMode: 0,
    transitionMode: 0,
  };
}

function makeEdgeMap(fractalMotif: EdgeMap["fractalMotif"]): EdgeMap {
  return {
    imagePath: `${fractalMotif}.png`,
    points: [],
    contours: [],
    flowField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, vectors: new Float32Array(2), weights: new Float32Array(1) },
    densityField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, values: new Float32Array(1) },
    toneField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, luminance: new Float32Array(1), contrast: new Float32Array(1) },
    subjectMask: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, values: new Float32Array(1) },
    silhouetteContours: [],
    spawners: [],
    regionAnchors: [],
    spatialBins: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, pointBins: [[]], spawnerBins: [[]] },
    width: 1280,
    height: 720,
    focalCenterX: 0.5,
    focalCenterY: 0.5,
    focalSpread: 0.3,
    leftWeight: 0.25,
    rightWeight: 0.25,
    topWeight: 0.25,
    bottomWeight: 0.25,
    subjectBounds: { minX: 0.2, minY: 0.2, maxX: 0.8, maxY: 0.8 },
    negativeSpaceQuadrant: "tr",
    fractalMotif,
    maskConfidence: "high",
    complexity: 0.4,
  };
}

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
    normalizedLow: 0.25,
    normalizedLowMid: 0.2,
    normalizedMid: 0.35,
    normalizedHighMid: 0.4,
    normalizedHigh: 0.3,
    motionEnergy: 0.3,
    isPeak: false,
    peakStrength: 0.2,
    segmentIndex: 0,
    dominantHz: 320,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.04,
    subBeatPhase: 0.1,
    barPhase: 0.08,
    beatPulse: 0.6,
    subBeatPulse: 0.3,
    onsetStrength: 0.25,
    motionEnvelope: 0.2,
    dbLow: -8,
    dbLowMid: -8,
    dbMid: -8,
    dbHighMid: -8,
    dbHigh: -8,
    dbOverall: -8,
    dbNormalized: 0.5,
    pulseRaw: 0.4,
    pulseEnvelope: 0.4,
    pulseAccent: 0.2,
    narrativeIntensity: 0.3,
    pulseScale: 1,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: false,
    isBarDownbeat: false,
    isFourBarDownbeat: false,
    barPulse: 0.35,
    phrasePulse: 0.2,
    ...overrides,
  };
}

function makePlan(overrides: Partial<BackgroundPlan> = {}): BackgroundPlan {
  return {
    startX: 0,
    startY: 0,
    endX: 1,
    endY: 1,
    colorStops: [],
    driftScale: 1,
    backgroundElementId: "phasing-concentric-rings-orbiting-hero",
    backgroundElementFamily: "ring-field",
    pulseProfile: {
      beatPulseStrength: 1,
      barPulseStrength: 1,
      betweenBeatBreathing: 0.5,
      flickerAmount: 0.2,
    },
    hzColorRouting: {
      subLow: 0.2,
      low: 0.3,
      mid: 0.4,
      highMid: 0.5,
      high: 0.6,
    },
    geometryParams: {
      count: 12,
      spacing: 0.2,
      thickness: 0.015,
      depth: 0.6,
      scaleVariance: 0.2,
      symmetry: 0.8,
      density: 0.7,
    },
    motionParams: {
      driftScale: 0.1,
      jitterScale: 0.08,
      rotationScale: 0.12,
      expansionScale: 0.16,
      phaseRate: 0.72,
    },
    colorTuning: {
      baselineColorfulnessScale: 1.1,
      peakColorfulnessScale: 1.4,
      peakColorEligible: true,
      lowAlphaLuminosityLift: 0.39,
      highAlphaLuminosityLift: 0.126,
    },
    motionTuning: {
      bpmMotionFloor: 1,
      minorImpactMotionFloor: 1,
      minorImpactDriveMix: {
        onset: 0.45,
        peak: 0.35,
        highMid: 0.2,
      },
    },
    ...overrides,
  };
}

describe("background reactivity retune", () => {
  test("scene graphs expose background tuning defaults", () => {
    const edgeMap = makeEdgeMap("glass-orbital");
    const theme = makeTheme("ring");
    const graph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));

    expect(graph.backgroundPlan.colorTuning?.baselineColorfulnessScale).toBe(1.1);
    expect(graph.backgroundPlan.colorTuning?.peakColorfulnessScale).toBe(1.4);
    expect(graph.backgroundPlan.colorTuning?.lowAlphaLuminosityLift).toBe(0.39);
    expect(graph.backgroundPlan.colorTuning?.highAlphaLuminosityLift).toBe(0.126);
    expect(graph.backgroundPlan.motionTuning?.minorImpactDriveMix).toEqual({ onset: 0.45, peak: 0.35, highMid: 0.2 });
  });

  test("peak color eligibility stays restricted to expressive or strongly coupled systems", () => {
    expect(isPeakColorEligibleBackgroundElement({ continuityCategory: "orbital", heroCouplingStrength: 0.1, particleCouplingStrength: 0.1 })).toBe(true);
    expect(isPeakColorEligibleBackgroundElement({ continuityCategory: "architectural", heroCouplingStrength: 0.71, particleCouplingStrength: 0.47 })).toBe(false);
    expect(isPeakColorEligibleBackgroundElement({ continuityCategory: "architectural", heroCouplingStrength: 0.72, particleCouplingStrength: 0.1 })).toBe(true);
  });

  test("background color scaling respects eligibility and peak drive", () => {
    const theme = makeTheme("ring");
    const peakFrame = makeFrame({ onsetStrength: 1, peakStrength: 1, normalizedHighMid: 1, dbNormalized: 1.5 });
    const midFrame = makeFrame({ onsetStrength: 0.5, peakStrength: 0.5, normalizedHighMid: 0.5, dbNormalized: 0.75 });
    const ineligiblePlan = makePlan({ colorTuning: { ...makePlan().colorTuning!, peakColorEligible: false } });

    expect(computeBackgroundAccentStyle(theme, peakFrame, makePlan(), 0.04, 0).colorfulnessScale).toBeCloseTo(1.4, 4);
    expect(computeBackgroundAccentStyle(theme, peakFrame, ineligiblePlan, 0.04, 0).colorfulnessScale).toBeCloseTo(1.1, 4);
    expect(computeBackgroundAccentStyle(theme, midFrame, makePlan(), 0.04, 0).colorfulnessScale).toBeGreaterThan(1.1);
  });

  test("alpha-weighted luminosity lift interpolates from low alpha to high alpha", () => {
    const theme = makeTheme("ring");
    const plan = makePlan();
    const frame = makeFrame();

    expect(computeBackgroundAccentStyle(theme, frame, plan, 0.04, 0).luminosityLift).toBeCloseTo(0.429, 4);
    expect(computeBackgroundAccentStyle(theme, frame, plan, 0.24, 0).luminosityLift).toBeCloseTo(0.1386, 4);
    expect(computeBackgroundAccentStyle(theme, frame, plan, 0.14, 0).luminosityLift).toBeCloseTo(0.2838, 4);
  });

  test("low-band drive can lift background brightness by up to 40 percent", () => {
    const theme = makeTheme("ring");
    const plan = makePlan();
    const floor = computeBackgroundAccentStyle(theme, makeFrame({ normalizedLow: 0 }), plan, 0.1, 0);
    const peak = computeBackgroundAccentStyle(theme, makeFrame({ normalizedLow: 1 }), plan, 0.1, 0);

    expect(peak.luminosityLift / floor.luminosityLift).toBeCloseTo(1.4, 4);
  });

  test("minor-impact drive responds to onset and transients while bpm drive survives flatter frames", () => {
    const plan = makePlan();
    const flatFrame = makeFrame({ onsetStrength: 0.05, peakStrength: 0.05, normalizedHighMid: 0.05, beatPulse: 0.6, barPulse: 0.3 });
    const activeFrame = makeFrame({ onsetStrength: 0.8, peakStrength: 0.7, normalizedHighMid: 0.75, beatPulse: 0.6, barPulse: 0.3 });

    const flat = computeBackgroundReactiveDrives(flatFrame, plan);
    const active = computeBackgroundReactiveDrives(activeFrame, plan);

    expect(flat.bpmDrive).toBeGreaterThan(0);
    expect(active.minorImpactDrive).toBeGreaterThan(flat.minorImpactDrive);
  });

  test("hero emission recovery preserves low baseline and full zero-db recovery", () => {
    expect(computeHeroEmissionRecovery(0)).toEqual({
      heroBaselineEmissionScale: 0.1,
      heroZeroDbRecovery: 1,
      zeroDbEmissionRecovery: 0.1,
    });
    expect(computeHeroEmissionRecovery(1)).toEqual({
      heroBaselineEmissionScale: 0.1,
      heroZeroDbRecovery: 1.25,
      zeroDbEmissionRecovery: 1,
    });
  });
});
