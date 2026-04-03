import { describe, expect, test } from "bun:test";
import {
  OUTRO_EFFECT_SPECS,
  buildOutroImageSignature,
  evaluateOutroEffectState,
  selectOutroEffect,
} from "./outro-effects";
import type { AudioFrameFeature, EdgeMap, RenderTheme, VisualState } from "../types";
import { FRACTAL_MOTIFS, OUTRO_EFFECT_IDS } from "../types";

// Bucket: catalog/inventory

function makeTheme(styleMode: RenderTheme["styleMode"], imagePath: string, overrides: Partial<RenderTheme["styleProfile"]> = {}): RenderTheme {
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
      imagePath,
      firstPixelR: 12,
      firstPixelG: 24,
      firstPixelB: 36,
      averageR: 80,
      averageG: 90,
      averageB: 100,
      medianR: 82,
      medianG: 92,
      medianB: 102,
      modeR: 84,
      modeG: 94,
      modeB: 104,
      rangeR: 90,
      rangeG: 80,
      rangeB: 70,
      averageHue: 160,
      effectSeed: 33,
      effectBucket: 8,
      effectCycle: 1,
      effectMode: 5,
      transitionMode: 4,
      dominantHue: 180,
      hueVariance: 0.22,
      saturationMean: 0.42,
      lightnessMean: 0.48,
      warmCoolBias: 0.14,
      contrast: 0.18,
      edgeDensity: 0.28,
      symmetry: 0.56,
      clusterCount: 3,
      palette: ["hsla(180,50%,50%,0.9)", "hsla(220,50%,50%,0.9)"],
      shapeBias: styleMode,
      particleBias: "mixed",
      ...overrides,
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0.14,
    imageContrast: overrides.contrast ?? 0.18,
    rawEffectMode: 5,
    effectiveEffectMode: 5,
    transitionMode: 4,
  };
}

function makeEdgeMap(fractalMotif: EdgeMap["fractalMotif"], imagePath: string): EdgeMap {
  return {
    imagePath,
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
    focalCenterX: 0.5,
    focalCenterY: 0.5,
    focalSpread: 0.2,
    leftWeight: 0.5,
    rightWeight: 0.5,
    topWeight: 0.5,
    bottomWeight: 0.5,
    subjectBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    fractalMotif,
    width: 1920,
    height: 1080,
    complexity: 0.5,
  };
}

function makeVisualState(overrides: Partial<VisualState> = {}): VisualState {
  return {
    frameIndex: 0,
    phraseIndex: 0,
    phraseStartFrame: 0,
    phraseEndFrame: 32,
    phraseStartSec: 0,
    phraseEndSec: 8,
    regime: "outro",
    brightnessFloor: 0.07,
    densityCap: 0.6,
    motionMode: "glide",
    overlayMode: "stable-feedback",
    transitionFamily: "carry",
    shotMode: "establish",
    effectPolicy: "safe",
    rescuePolicy: "recover",
    imageHoldMultiplier: 1.18,
    effectiveImageHoldMultiplier: 1.18,
    transientCutBias: 0.2,
    rapidPeakDensity: 0.1,
    transitionOpportunityBias: 0.8,
    imageSwapAllowed: true,
    transitionTriggerPreference: "hold",
    preferredCutFrame: 0,
    transitionDurationMultiplier: 1.45,
    transitionCarryBias: 0.82,
    ...overrides,
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
    normalizedSubLow: 0.24,
    normalizedLow: 0.42,
    normalizedLowMid: 0.36,
    normalizedMid: 0.38,
    normalizedHighMid: 0.34,
    normalizedHigh: 0.3,
    motionEnergy: 0.3,
    isPeak: false,
    peakStrength: 0.28,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.08,
    subBeatPhase: 0.16,
    barPhase: 0.12,
    beatPulse: 0.7,
    subBeatPulse: 0.4,
    onsetStrength: 0.3,
    motionEnvelope: 0.4,
    dbLow: -22,
    dbLowMid: -18,
    dbMid: -16,
    dbHighMid: -13,
    dbHigh: -10,
    dbOverall: -14,
    dbNormalized: 0.52,
    pulseRaw: 1.2,
    pulseEnvelope: 1.2,
    pulseAccent: 1.08,
    narrativeIntensity: 0.42,
    pulseScale: 1.4,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: true,
    isBarDownbeat: true,
    isFourBarDownbeat: false,
    barPulse: 0.62,
    phrasePulse: 0.54,
    ...overrides,
  };
}

describe("outro effects", () => {
  test("catalog keeps unique ids and motif coverage valid", () => {
    expect(OUTRO_EFFECT_IDS.length).toBeGreaterThan(0);
    expect(new Set(OUTRO_EFFECT_IDS).size).toBe(OUTRO_EFFECT_IDS.length);
    expect(OUTRO_EFFECT_SPECS).toHaveLength(OUTRO_EFFECT_IDS.length);
    for (const motif of FRACTAL_MOTIFS) {
      expect(OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === motif).length).toBeGreaterThanOrEqual(4);
    }
    expect(OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === "wildcard").length).toBeGreaterThanOrEqual(2);
    expect(OUTRO_EFFECT_SPECS.every((entry) => entry.selectionWeight === undefined || entry.selectionWeight > 0)).toBe(true);
  });

  test("selection is unreachable outside outro regime", () => {
    const selected = selectOutroEffect({
      edgeMap: makeEdgeMap("halo-cell", "halo.png"),
      visualState: makeVisualState({ regime: "groove" }),
      theme: makeTheme("cellular", "halo.png"),
      frame: makeFrame(),
      recentEffectBars: new Map(),
    });
    expect(selected).toBeUndefined();
  });

  test("selection is deterministic for identical inputs", () => {
    const edgeMap = makeEdgeMap("film-bloom-shard", "film.png");
    const visualState = makeVisualState({ phraseIndex: 4 });
    const theme = makeTheme("shard", "film.png");
    const frame = makeFrame({ barIndex: 6, phrase4Index: 2 });
    const a = selectOutroEffect({ edgeMap, visualState, theme, frame, recentEffectBars: new Map() });
    const b = selectOutroEffect({ edgeMap, visualState, theme, frame, recentEffectBars: new Map() });
    expect(a?.id).toBe(b?.id);
  });

  test("category rotation avoids immediate repetition when alternatives exist", () => {
    const edgeMap = makeEdgeMap("smoke-ribbon", "smoke.png");
    const theme = makeTheme("cloud", "smoke.png");
    const visualState = makeVisualState({ phraseIndex: 5 });
    const frame = makeFrame({ barIndex: 10 });
    const selected = selectOutroEffect({
      edgeMap,
      visualState,
      theme,
      frame,
      recentEffectBars: new Map(),
      previousCategory: "fade",
    });
    expect(selected?.category).not.toBe("fade");
  });

  test("wildcards require rare gates", () => {
    const edgeMap = makeEdgeMap("glass-orbital", "glass.png");
    const theme = makeTheme("ring", "glass.png");
    const plain = selectOutroEffect({
      edgeMap,
      visualState: makeVisualState(),
      theme,
      frame: makeFrame({ barIndex: 3, isFourBarDownbeat: false, phrasePulse: 0.3 }),
      recentEffectBars: new Map(),
    });
    const gated = selectOutroEffect({
      edgeMap,
      visualState: makeVisualState(),
      theme,
      frame: makeFrame({ barIndex: 4, isFourBarDownbeat: true, phrasePulse: 0.95 }),
      recentEffectBars: new Map([
        ["kubrick-iris-decay", 0],
        ["prism-halo-retreat", 1],
        ["orbit-collapse-well", 2],
      ]),
    });
    expect(plain?.motif).toBe("glass-orbital");
    expect(gated).toBeDefined();
  });

  test("bpm phase changes cadence even when db stays flat", () => {
    const spec = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "signal-fade-ladder")!;
    const edgeMap = makeEdgeMap("neon-tube", "neon.png");
    const theme = makeTheme("filament", "neon.png");
    const visualState = makeVisualState();
    const early = evaluateOutroEffectState({
      frame: makeFrame({ timeSec: 0.0, beatPhase: 0.02, dbNormalized: 0.4 }),
      bpm: 120,
      spec,
      edgeMap,
      theme,
      visualState,
    });
    const late = evaluateOutroEffectState({
      frame: makeFrame({ timeSec: 0.31, beatPhase: 0.48, dbNormalized: 0.4 }),
      bpm: 120,
      spec,
      edgeMap,
      theme,
      visualState,
    });
    expect(early.phase).not.toBe(late.phase);
    expect(early.mix).not.toBe(late.mix);
  });

  test("db-reactive effects pulse amplitude without owning cadence", () => {
    const spec = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "phase-gate-jitter")!;
    const edgeMap = makeEdgeMap("harmonic-lattice", "lattice.png");
    const theme = makeTheme("ring", "lattice.png");
    const visualState = makeVisualState();
    const lowDb = evaluateOutroEffectState({
      frame: makeFrame({ timeSec: 0.25, dbNormalized: 0.18, normalizedHigh: 0.12, beatPhase: 0.1 }),
      bpm: 128,
      spec,
      edgeMap,
      theme,
      visualState,
    });
    const highDb = evaluateOutroEffectState({
      frame: makeFrame({ timeSec: 0.25, dbNormalized: 0.88, normalizedHigh: 0.9, beatPhase: 0.1 }),
      bpm: 128,
      spec,
      edgeMap,
      theme,
      visualState,
    });
    expect(lowDb.phase).toBe(highDb.phase);
    expect(highDb.dbDrive).toBeGreaterThan(lowDb.dbDrive);
    expect(highDb.mix).toBeGreaterThan(lowDb.mix);
  });

  test("reflective and temporal outro tags are explicit and combined deterministically", () => {
    const reflective = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "prism-halo-retreat")!;
    const temporal = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "memory-vapor-smear")!;
    const combined = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "mirror-lag-orbit")!;
    expect(reflective.selectionTags).toContain("reflective");
    expect(reflective.selectionTags).not.toContain("temporal-freeze");
    expect(temporal.selectionTags).toContain("temporal-freeze");
    expect(temporal.selectionTags).toContain("hero-impacting");
    expect(combined.selectionTags).toContain("reflective");
    expect(combined.selectionTags).toContain("temporal-freeze");
    expect(combined.selectionTags).toContain("hero-impacting");
  });

  test("image signature and color control vary deterministically with source image", () => {
    const spec = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "celluloid-rainbow-burn")!;
    const visualState = makeVisualState();
    const edgeA = makeEdgeMap("film-bloom-shard", "a.png");
    const edgeB = makeEdgeMap("film-bloom-shard", "b.png");
    const themeA = makeTheme("shard", "a.png", { effectSeed: 9, dominantHue: 120 });
    const themeB = makeTheme("shard", "b.png", { effectSeed: 61, dominantHue: 300 });
    const stateA = evaluateOutroEffectState({ frame: makeFrame(), bpm: 120, spec, edgeMap: edgeA, theme: themeA, visualState });
    const stateB = evaluateOutroEffectState({ frame: makeFrame(), bpm: 120, spec, edgeMap: edgeB, theme: themeB, visualState });
    expect(buildOutroImageSignature(edgeA, themeA)).not.toBe(buildOutroImageSignature(edgeB, themeB));
    expect(stateA.imageSignature).not.toBe(stateB.imageSignature);
    expect(stateA.colorSet).not.toEqual(stateB.colorSet);
  });

  test("late outro escalation raises intensity, coverage, and hero warp", () => {
    const spec = OUTRO_EFFECT_SPECS.find((entry) => entry.id === "orbit-collapse-well")!;
    const edgeMap = makeEdgeMap("glass-orbital", "glass.png");
    const theme = makeTheme("ring", "glass.png");
    const early = evaluateOutroEffectState({
      frame: makeFrame({ frameIndex: 1, timeSec: 0.5, barIndex: 4, phrase4Index: 0, phrasePulse: 0.3, barPulse: 0.22 }),
      bpm: 120,
      spec,
      edgeMap,
      theme,
      visualState: makeVisualState({ phraseStartFrame: 0, phraseEndFrame: 32, phraseStartSec: 0, phraseEndSec: 8 }),
    });
    const late = evaluateOutroEffectState({
      frame: makeFrame({ frameIndex: 30, timeSec: 7.6, barIndex: 7, phrase4Index: 0, phrasePulse: 1, barPulse: 1, isBarDownbeat: true }),
      bpm: 120,
      spec,
      edgeMap,
      theme,
      visualState: makeVisualState({ phraseStartFrame: 0, phraseEndFrame: 32, phraseStartSec: 0, phraseEndSec: 8 }),
    });
    expect(late.intensity).toBeGreaterThan(early.intensity);
    expect(late.frameCoverageTarget).toBeGreaterThan(early.frameCoverageTarget);
    expect(late.heroWarp).toBeGreaterThanOrEqual(early.heroWarp);
    expect(late.terminalBurstProgress).toBeGreaterThan(0.5);
  });

  test("subtle variants inherit terminal burst amplification", () => {
    const spec = OUTRO_EFFECT_SPECS.find((entry) => entry.category === "fade")!;
    const state = evaluateOutroEffectState({
      frame: makeFrame({ frameIndex: 31, timeSec: 7.8, barIndex: 7, phrase4Index: 0, phrasePulse: 1, barPulse: 1 }),
      bpm: 100,
      spec,
      edgeMap: makeEdgeMap(spec.motif === "wildcard" ? "glass-orbital" : spec.motif, "fade.png"),
      theme: makeTheme("cloud", "fade.png"),
      visualState: makeVisualState({ phraseStartFrame: 0, phraseEndFrame: 32, phraseStartSec: 0, phraseEndSec: 8 }),
    });
    expect(state.terminalBurstProgress).toBeGreaterThan(0.5);
    expect(state.frameCoverageTarget).toBeGreaterThan(0.45);
    expect(state.collapseDrive).toBeGreaterThan(0.45);
  });
});
