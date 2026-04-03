import { describe, expect, test } from "bun:test";
import { FRAME_POST_EFFECT_IDS, type AudioFrameFeature, type EdgeMap, type PersistentMotifState, type RenderTheme, type VisualState } from "../types";
import { evaluateFramePostEffectState, FRAME_POST_EFFECT_SPECS, selectFramePostEffect } from "./frame-post-effects";

function makeTheme(styleMode: RenderTheme["styleMode"], imagePath: string, overrides: Partial<RenderTheme["styleProfile"]> = {}): RenderTheme {
  return {
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    paletteStops: [],
    hueStops: [],
    motionScale: 1,
    densityScale: 1,
    nebula: { voidColor: "", coreCyan: "", tealGlow: "", purpleBody: "", magentaBody: "", orangeEdge: "", sparkWhite: "", sparkYellow: "" },
    vortexBias: 1,
    lightningHueOffset: 0,
    shadowTint: "",
    lowBandColor: "",
    lowMidBandColor: "",
    midBandColor: "",
    highBandColor: "",
    styleProfile: {
      imagePath,
      firstPixelR: 0, firstPixelG: 0, firstPixelB: 0,
      averageR: 64, averageG: 80, averageB: 96,
      medianR: 64, medianG: 80, medianB: 96,
      modeR: 64, modeG: 80, modeB: 96,
      rangeR: 64, rangeG: 64, rangeB: 64,
      averageHue: 180,
      effectSeed: 11,
      effectBucket: 5,
      effectCycle: 2,
      effectMode: 5,
      transitionMode: 4,
      dominantHue: 180,
      hueVariance: 0.24,
      saturationMean: 0.48,
      lightnessMean: 0.42,
      warmCoolBias: 0.08,
      contrast: 0.32,
      edgeDensity: 0.44,
      symmetry: 0.62,
      clusterCount: 2,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
      ...overrides,
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0.08,
    imageContrast: overrides.contrast ?? 0.32,
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
    focalCenterX: 960,
    focalCenterY: 540,
    focalSpread: 0.3,
    leftWeight: 0.5,
    rightWeight: 0.5,
    topWeight: 0.5,
    bottomWeight: 0.5,
    subjectBounds: { minX: 700, minY: 320, maxX: 1220, maxY: 760 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    fractalMotif,
    width: 1920,
    height: 1080,
    complexity: 0.66,
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
    regime: "drop",
    brightnessFloor: 0.07,
    densityCap: 1,
    motionMode: "pulse",
    overlayMode: "kinetic-scan",
    transitionFamily: "carry",
    shotMode: "detail",
    effectPolicy: "balanced",
    rescuePolicy: "lift",
    imageHoldMultiplier: 1,
    effectiveImageHoldMultiplier: 1,
    transientCutBias: 0.2,
    rapidPeakDensity: 0.24,
    transitionOpportunityBias: 1,
    imageSwapAllowed: true,
    transitionTriggerPreference: "swap",
    preferredCutFrame: 0,
    transitionDurationMultiplier: 1,
    transitionCarryBias: 0.72,
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
    normalizedLow: 0.52,
    normalizedLowMid: 0.4,
    normalizedMid: 0.54,
    normalizedHighMid: 0.48,
    normalizedHigh: 0.44,
    motionEnergy: 0.68,
    isPeak: false,
    peakStrength: 0.62,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.05,
    subBeatPhase: 0.1,
    barPhase: 0.08,
    beatPulse: 0.84,
    subBeatPulse: 0.52,
    onsetStrength: 0.58,
    motionEnvelope: 0.64,
    dbLow: -18,
    dbLowMid: -16,
    dbMid: -12,
    dbHighMid: -10,
    dbHigh: -8,
    dbOverall: -12,
    dbNormalized: 0.72,
    pulseRaw: 1.2,
    pulseEnvelope: 0.92,
    pulseAccent: 0.84,
    narrativeIntensity: 0.72,
    pulseScale: 1.4,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: true,
    isBarDownbeat: true,
    isFourBarDownbeat: false,
    barPulse: 0.7,
    phrasePulse: 0.76,
    ...overrides,
  };
}

describe("frame post effects", () => {
  test("catalog has unique ids with positive weights", () => {
    expect(FRAME_POST_EFFECT_IDS).toHaveLength(17);
    expect(new Set(FRAME_POST_EFFECT_IDS).size).toBe(17);
    expect(FRAME_POST_EFFECT_SPECS).toHaveLength(17);
    expect(FRAME_POST_EFFECT_SPECS.every((entry) => entry.selectionWeight > 0)).toBe(true);
  });

  test("selection is deterministic for identical inputs", () => {
    const edgeMap = makeEdgeMap("film-bloom-shard", "film.png");
    const visualState = makeVisualState();
    const theme = makeTheme("shard", "film.png");
    const persistentMotif: PersistentMotifState = {
      id: "audio-synced-whip-pan-hallucinations",
      label: "Audio",
      influenceKey: "audio",
      ageFrames: 12,
      carryFrames: 12,
      changedThisFrame: false,
      changeGate: "transient-peak",
      transientScore: 0.8,
      cooldownUntilBeat: 12,
    };
    const a = selectFramePostEffect({ edgeMap, visualState, theme, persistentMotif });
    const b = selectFramePostEffect({ edgeMap, visualState, theme, persistentMotif });
    expect(a.id).toBe(b.id);
  });

  test("impact-heavy drop can select impact chromatic aberration", () => {
    const selected = selectFramePostEffect({
      edgeMap: makeEdgeMap("shattered-arc", "impact.png"),
      visualState: makeVisualState({ regime: "drop", overlayMode: "climax-burst" }),
      theme: makeTheme("shard", "impact.png"),
      persistentMotif: {
        id: "audio-synced-whip-pan-hallucinations",
        label: "Audio",
        influenceKey: "audio",
        ageFrames: 0,
        carryFrames: 0,
        changedThisFrame: true,
        changeGate: "startup",
        transientScore: 1,
        cooldownUntilBeat: 8,
      },
    });
    expect(["impact-chromatic-aberration", "palette-inversion-snare", "resolution-crash-snapback"]).toContain(selected.id);
  });

  test("psychedelic tunnel motifs can select mobius tunnel wrap", () => {
    const ids = new Set(
      ["mobius-4.png", "mobius-8.png", "mobius-9.png", "mobius-10.png"].map((imagePath) =>
        selectFramePostEffect({
          edgeMap: makeEdgeMap("mandelbloom", imagePath),
          visualState: makeVisualState({ regime: "drop", overlayMode: "pulse-wave" }),
          theme: makeTheme("ring", imagePath),
          persistentMotif: {
            id: "cosmic-neon-descent",
            label: "Cosmic",
            influenceKey: "cosmic",
            ageFrames: 24,
            carryFrames: 18,
            changedThisFrame: false,
            changeGate: "transient-peak",
            transientScore: 0.7,
            cooldownUntilBeat: 20,
          },
        }).id,
      ),
    );
    expect(ids.has("mobius-tunnel-wrap")).toBe(true);
  });

  test("clean structural contexts allow crt mask and hard pixel lock", () => {
    const ids = new Set(
      ["harmonic-lattice", "neon-tube"].map((motif, index) =>
        selectFramePostEffect({
          edgeMap: makeEdgeMap(motif as EdgeMap["fractalMotif"], `structural-${index}.png`),
          visualState: makeVisualState({ regime: "build", overlayMode: index === 0 ? "sparse-contour" : "kinetic-scan" }),
          theme: makeTheme(index === 0 ? "filament" : "shard", `structural-${index}.png`),
        }).id,
      ),
    );
    expect([...ids].some((id) => ["crt-phosphor-mask", "hard-pixel-lock", "pressure-grid-plane", "sobel-ink-outline"].includes(id))).toBe(true);
  });

  test("selection falls back to motif coverage when regime and overlay filters empty out", () => {
    const selected = selectFramePostEffect({
      edgeMap: makeEdgeMap("glass-orbital", "intro-sparse.png"),
      visualState: makeVisualState({ regime: "intro", overlayMode: "sparse-contour" }),
      theme: makeTheme("ring", "intro-sparse.png"),
    });
    expect(selected).toBeDefined();
    expect(selected.motifs.includes("glass-orbital") || selected.motifs.includes("wildcard")).toBe(true);
  });

  test("reflective intro sparse-contour contexts can reach mirror and prism post effects", () => {
    const ids = new Set(
      ["glass-a.png", "halo-b.png", "mandel-c.png", "smoke-d.png", "cathedral-e.png"].map((imagePath, index) =>
        selectFramePostEffect({
          edgeMap: makeEdgeMap((["glass-orbital", "halo-cell", "mandelbloom", "smoke-ribbon", "cathedral-filament"] as const)[index]!, imagePath),
          visualState: makeVisualState({ regime: "intro", overlayMode: "sparse-contour" }),
          theme: makeTheme("ring", imagePath),
        }).id,
      ),
    );
    expect(ids.has("mirror-kaleido-lattice") || ids.has("prism-axis-echo")).toBe(true);
  });

  test("state evaluation stays bounded and pulse gated effects intensify on accents", () => {
    const spec = FRAME_POST_EFFECT_SPECS.find((entry) => entry.id === "palette-inversion-snare")!;
    const soft = evaluateFramePostEffectState({ frame: makeFrame({ isBeatAccent: false, beatPulse: 0.1, phrasePulse: 0.1, dbNormalized: 0.2 }), spec });
    const strong = evaluateFramePostEffectState({ frame: makeFrame(), spec });
    expect(soft.intensity).toBeGreaterThanOrEqual(spec.intensityFloor);
    expect(strong.intensity).toBeLessThanOrEqual(spec.intensityCeiling);
    expect(strong.intensity).toBeGreaterThan(soft.intensity);
    expect(strong.overlayOpacityEstimate).toBeGreaterThan(0);
    expect(strong.effectVisiblePixelRatioEstimate).toBeGreaterThan(0);
  });
});
