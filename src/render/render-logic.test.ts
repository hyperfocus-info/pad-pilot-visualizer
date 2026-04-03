import { describe, expect, test } from "bun:test";
import { buildCompositionPlan } from "./composition-plan";
import { placementMode } from "./composition-plan";
import { resolveHeroLayout } from "./hero-layout";
import {
  chooseTransitionFamily,
  hashTransitionPairSeed,
  resolveRequestedImageIndex,
  themeCacheKey,
  transitionModeForFamilyChoice,
} from "./frame-renderer";
import { sanitizeEffectMode } from "./palette";
import { buildSceneGraph } from "./scene-graph";
import { classifyRegime } from "./visual-plan";
import {
  PERSISTENT_MOTIF_SPECS,
  selectInitialPersistentMotif,
  selectNextPersistentMotif,
  shouldRotatePersistentMotif,
  transientPeakScore,
} from "./persistent-motifs";
import { EVENT_SPECS, evaluateEventState, selectEventSpec } from "./event-specs";
import {
  createRollingDbWindowState,
  evaluateMotifEffectState,
  MOTIF_EFFECT_SPECS,
  selectMotifEffect,
  updateRollingDbWindowState,
} from "./motif-effects";
import { EVENT_SPEC_IDS, FRACTAL_MOTIFS, FRAME_POST_EFFECT_IDS, MOTIF_EFFECT_IDS, PERSISTENT_MOTIF_IDS, TRANSITION_FAMILIES } from "../types";
import type { ActiveSubjectSnapshot, EdgeMap, RenderTheme, VisualSafetyMetrics, VisualState } from "../types";

// Bucket: contract/invariant plus catalog/inventory checks

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
      averageR: 0,
      averageG: 0,
      averageB: 0,
      medianR: 0,
      medianG: 0,
      medianB: 0,
      modeR: 0,
      modeG: 0,
      modeB: 0,
      rangeR: 0,
      rangeG: 0,
      rangeB: 0,
      averageHue: 0,
      effectSeed: 0,
      effectBucket: 0,
      effectCycle: 0,
      effectMode: 0,
      transitionMode: 0,
      dominantHue: 0,
      hueVariance: 0,
      saturationMean: 0,
      lightnessMean: 0,
      warmCoolBias: 0,
      contrast: 0,
      edgeDensity: 0,
      symmetry: 0,
      clusterCount: 1,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
      ...overrides,
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0,
    imageContrast: 0,
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
    focalCenterX: 0,
    focalCenterY: 0,
    focalSpread: 0.2,
    leftWeight: 0.5,
    rightWeight: 0.5,
    topWeight: 0.5,
    bottomWeight: 0.5,
    subjectBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    fractalMotif,
    width: 1,
    height: 1,
    complexity: 0.5,
  };
}

function makeVisualState(overrides: Partial<VisualState> = {}): VisualState {
  return {
    frameIndex: 0,
    phraseIndex: 0,
    phraseStartFrame: 0,
    phraseEndFrame: 24,
    phraseStartSec: 0,
    phraseEndSec: 2,
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
    preferredCutFrame: 0,
    transitionDurationMultiplier: 1,
    transitionCarryBias: 0.7,
    ...overrides,
  };
}

function makeSafetyMetrics(overrides: Partial<VisualSafetyMetrics> = {}): VisualSafetyMetrics {
  return {
    luminance: 0.2,
    trailingLuminance: 0.2,
    framesBelowFloor: 0,
    brightnessFloor: 0.08,
    recoveryActive: false,
    safetyOverrideCount: 0,
    recoveryOverrideFrameCount: 0,
    recoveryOverrideFrameRatio: 0,
    recoverySeverityScore: 0,
    overlayModeUsed: "stable-feedback",
    transitionFamilyUsed: "carry",
    ...overrides,
  };
}

function makeActiveSubject(overrides: Partial<ActiveSubjectSnapshot> = {}): ActiveSubjectSnapshot {
  return {
    mode: "hover",
    motionPx: 2,
    emphasis: 0.2,
    trailLength: 0,
    x: 0,
    y: 0,
    ...overrides,
  };
}

function makeFrame(overrides: Partial<import("../types").AudioFrameFeature> = {}): import("../types").AudioFrameFeature {
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
    normalizedLow: 0.3,
    normalizedLowMid: 0.25,
    normalizedMid: 0.4,
    normalizedHighMid: 0.35,
    normalizedHigh: 0.28,
    motionEnergy: 0.3,
    isPeak: false,
    peakStrength: 0.2,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.04,
    subBeatPhase: 0.08,
    barPhase: 0.1,
    beatPulse: 0.7,
    subBeatPulse: 0.5,
    onsetStrength: 0.25,
    motionEnvelope: 0.3,
    dbLow: -22,
    dbLowMid: -18,
    dbMid: -15,
    dbHighMid: -12,
    dbHigh: -10,
    dbOverall: -14,
    dbNormalized: 0.55,
    pulseRaw: 0.4,
    pulseEnvelope: 0.5,
    pulseAccent: 0.4,
    narrativeIntensity: 0.45,
    pulseScale: 1,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: true,
    isBarDownbeat: true,
    isFourBarDownbeat: false,
    barPulse: 0.6,
    phrasePulse: 0.5,
    ...overrides,
  };
}

describe("render selection helpers", () => {
  test("held image wins over advancing base image", () => {
    expect(resolveRequestedImageIndex(4, false, 2)).toBe(2);
  });

  test("theme cache key varies by image in same segment", () => {
    expect(themeCacheKey("a.png", 3)).not.toBe(themeCacheKey("b.png", 3));
  });
});

describe("variety preservation", () => {
  test("motif and frame-post catalogs stay broad while transition families stay broad", () => {
    expect(FRACTAL_MOTIFS).toHaveLength(12);
    expect(MOTIF_EFFECT_IDS).toHaveLength(25);
    expect(new Set(MOTIF_EFFECT_IDS).size).toBe(25);
    expect(MOTIF_EFFECT_SPECS).toHaveLength(25);
    expect(PERSISTENT_MOTIF_IDS).toHaveLength(10);
    expect(EVENT_SPEC_IDS).toHaveLength(15);
    expect(TRANSITION_FAMILIES.length).toBeGreaterThanOrEqual(82);
    expect(FRAME_POST_EFFECT_IDS).toHaveLength(17);
    expect(new Set(FRAME_POST_EFFECT_IDS).size).toBe(17);
    expect(FRACTAL_MOTIFS).toContain("mandelbloom");
    expect(FRACTAL_MOTIFS).toContain("film-bloom-shard");
    expect(TRANSITION_FAMILIES).toContain("mirror-kaleido");
    expect(TRANSITION_FAMILIES).toContain("shear-kaleido");
    expect(TRANSITION_FAMILIES).toContain("halo-drift");
    expect(TRANSITION_FAMILIES).toContain("phase-ghost");
    expect(TRANSITION_FAMILIES).toContain("dolly-in");
    expect(TRANSITION_FAMILIES).toContain("trip-kaleido");
    expect(TRANSITION_FAMILIES).toContain("fractal-mirror-shatter");
    expect(TRANSITION_FAMILIES).toContain("kubrick-slit-scan-star-gate");
    expect(TRANSITION_FAMILIES).toContain("voronoi-drop-shatter");
    expect(TRANSITION_FAMILIES).toContain("wire-solid-phase-cut");
    expect(TRANSITION_FAMILIES).toContain("mobius-wrap-tunnel");
    expect(TRANSITION_FAMILIES).toContain("datamosh-vector-drag");
    expect(TRANSITION_FAMILIES).toContain("resolution-crash-snapback");
    expect(TRANSITION_FAMILIES).toContain("snare-negative-flip");
    for (const effect of MOTIF_EFFECT_SPECS) {
      expect(FRACTAL_MOTIFS).toContain(effect.primaryMotif);
    }
  });

  test("effect modes 4, 6, and 7 survive sanitization", () => {
    expect(sanitizeEffectMode(4)).toBe(4);
    expect(sanitizeEffectMode(6)).toBe(6);
    expect(sanitizeEffectMode(7)).toBe(7);
    expect(sanitizeEffectMode(15)).toBe(14);
  });

  test("cathedral-filament does not always force filament", () => {
    expect(placementMode(makeTheme("ring"), makeEdgeMap("cathedral-filament"))).toBe("orbital");
    expect(placementMode(makeTheme("shard"), makeEdgeMap("cathedral-filament"))).toBe("shard-lane");
    expect(placementMode(makeTheme("cloud"), makeEdgeMap("cathedral-filament"))).toBe("ribbon");
  });

  test("drop and build thresholds are easier to reach than before", () => {
    expect(classifyRegime(0.5, 0.58, 0.2, 0.4, false)).toBe("drop");
    expect(classifyRegime(0.39, 0.45, 0.35, 0.4, false)).toBe("build");
  });

  test("transition family selection respects motif, regime, and active-subject intent", () => {
    expect(
      chooseTransitionFamily({
        visualState: makeVisualState(),
        edgeMap: makeEdgeMap("halo-cell"),
        theme: makeTheme("cellular"),
        safety: makeSafetyMetrics({ recoveryActive: true }),
        activeSubject: makeActiveSubject(),
      }),
    ).toBe("wipe");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState(),
        edgeMap: makeEdgeMap("shattered-arc"),
        theme: makeTheme("cellular"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject(),
      }),
    ).toBe("chroma-smear");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState({ regime: "drop", transitionFamily: "flash" }),
        edgeMap: makeEdgeMap("halo-cell"),
        theme: makeTheme("cellular"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject({ mode: "strike", motionPx: 10 }),
      }),
    ).toBe("flash");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState(),
        edgeMap: makeEdgeMap("mandelbloom"),
        theme: makeTheme("ring"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject(),
      }),
    ).toBe("mobius-wrap-tunnel");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState(),
        edgeMap: makeEdgeMap("data-cathedral"),
        theme: makeTheme("filament"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject(),
      }),
    ).toBe("parallax-slide");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState({ regime: "groove" }),
        edgeMap: makeEdgeMap("cathedral-filament"),
        theme: makeTheme("filament"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject({ motionPx: 2 }),
      }),
    ).toBe("halo-drift");

    expect(
      chooseTransitionFamily({
        visualState: makeVisualState({ regime: "drop" }),
        edgeMap: { ...makeEdgeMap("halo-cell"), complexity: 0.74, leftWeight: 0.7, rightWeight: 0.3 },
        theme: makeTheme("cellular"),
        safety: makeSafetyMetrics(),
        activeSubject: makeActiveSubject({ mode: "strike", motionPx: 9.2 }),
      }),
    ).toBe("whip-pan-x");
  });

  test("transition mode choice varies across image pairs for the same family", () => {
    const edgeMap = makeEdgeMap("halo-cell");
    const theme = makeTheme("cellular");
    const modes = new Set(
      [
        ["a.png", "b.png"],
        ["a.png", "c.png"],
        ["a.png", "d.png"],
        ["e.png", "f.png"],
        ["g.png", "h.png"],
        ["i.png", "j.png"],
      ].map(([from, to]) => transitionModeForFamilyChoice("carry", edgeMap, theme, hashTransitionPairSeed(from, to))),
    );

    expect(modes.size).toBeGreaterThanOrEqual(3);
  });

  test("scene graph myth grammar stays stable across nearby themes", () => {
    const edgeMap = makeEdgeMap("cathedral-filament");
    edgeMap.subjectBounds = { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 };
    edgeMap.focalCenterX = 0.5;
    edgeMap.focalCenterY = 0.48;
    edgeMap.focalSpread = 0.28;
    edgeMap.width = 1;
    edgeMap.height = 1;
    const themeA = makeTheme("filament", { symmetry: 0.74, contrast: 0.18, effectBucket: 2, effectCycle: 1 });
    const themeB = makeTheme("filament", { symmetry: 0.76, contrast: 0.19, effectBucket: 3, effectCycle: 1 });
    const planA = buildCompositionPlan(edgeMap, themeA);
    const planB = buildCompositionPlan(edgeMap, themeB);
    const graphA = buildSceneGraph(edgeMap, themeA, planA);
    const graphB = buildSceneGraph(edgeMap, themeB, planB);

    expect(graphA.heroArchetype).toBe(graphB.heroArchetype);
    expect(graphA.heroGlyphGrammar.primary).toBeDefined();
    expect(graphA.heroGlyphGrammar.secondary.length).toBeGreaterThan(0);
    expect(graphA.heroEmissionMode).toBeDefined();
    expect(graphA.subEmitterMode).toBeDefined();
    expect(graphA.heroPath.length).toBeGreaterThanOrEqual(4);
  });

  test("scene graph exposes motif-driven physics with five-band channels", () => {
    const edgeMap = makeEdgeMap("smoke-ribbon");
    edgeMap.subjectBounds = { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 };
    edgeMap.focalCenterX = 0.5;
    edgeMap.focalCenterY = 0.5;
    edgeMap.focalSpread = 0.25;
    const theme = makeTheme("cloud", { symmetry: 0.42, contrast: 0.2, saturationMean: 0.4 });
    const plan = buildCompositionPlan(edgeMap, theme);
    const graph = buildSceneGraph(edgeMap, theme, plan);

    expect(graph.motifPhysicsProfile.motif).toBe("smoke-ribbon");
    expect(graph.motifPhysicsProfile.matrix.subLow.thrust).toBeGreaterThan(0);
    expect(graph.motifPhysicsProfile.matrix.highMid.jitterAmplitude).toBeGreaterThan(0);
    expect(graph.heroPhysicsEnvelope.trailEmission).toBeGreaterThan(0);
    expect(graph.diagnosticPhysicsFamily).toContain("smoke-ribbon");
  });

  test("hero motif pools remove arrow from core selection while preserving emission shapes", () => {
    const edgeMap = makeEdgeMap("cathedral-filament");
    edgeMap.subjectBounds = { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 };
    edgeMap.focalCenterX = 0.5;
    edgeMap.focalCenterY = 0.5;
    edgeMap.focalSpread = 0.25;
    const theme = makeTheme("filament", { symmetry: 0.7, contrast: 0.22, edgeDensity: 0.34 });
    const plan = buildCompositionPlan(edgeMap, theme);
    const graph = buildSceneGraph(edgeMap, theme, plan);

    expect(graph.heroMotifProfile.heroPrimitivePool.includes("arrow")).toBe(false);
    expect(graph.heroMotifProfile.fallbackHeroPrimitivePool.includes("arrow")).toBe(false);
    expect(graph.heroMotifProfile.emissionPrimitivePool?.includes("arrow")).toBe(true);
    expect(graph.heroPrimitive).not.toBe("arrow");
    expect(graph.heroPrimitiveFallback).not.toBe("arrow");
    expect(graph.heroGlyphs.includes("arrow")).toBe(false);
  });

  test("hero motif variant is deterministic and normalized", () => {
    const edgeMap = makeEdgeMap("glass-orbital");
    edgeMap.subjectBounds = { minX: 0.14, minY: 0.12, maxX: 0.86, maxY: 0.88 };
    edgeMap.focalCenterX = 0.51;
    edgeMap.focalCenterY = 0.47;
    edgeMap.focalSpread = 0.29;
    const theme = makeTheme("ring", { symmetry: 0.62, contrast: 0.2, edgeDensity: 0.28, hueVariance: 0.18 });
    const planA = buildCompositionPlan(edgeMap, theme);
    const planB = buildCompositionPlan(edgeMap, theme);
    const graphA = buildSceneGraph(edgeMap, theme, planA);
    const graphB = buildSceneGraph(edgeMap, theme, planB);

    expect(graphA.heroMotifVariant.key).toBe(graphB.heroMotifVariant.key);
    expect(graphA.heroMotifVariant.warpWeight).toBe(graphB.heroMotifVariant.warpWeight);
    expect(graphA.heroMotifVariant.gravityWeight).toBe(graphB.heroMotifVariant.gravityWeight);
    expect(graphA.heroMotifVariant.inconsistencyWeight).toBe(graphB.heroMotifVariant.inconsistencyWeight);
    expect(graphA.heroMotifVariant.sizeWeight).toBeGreaterThanOrEqual(0);
    expect(graphA.heroMotifVariant.sizeWeight).toBeLessThanOrEqual(1);
    expect(graphA.heroMotifVariant.fadeWeight).toBeGreaterThanOrEqual(0);
    expect(graphA.heroMotifVariant.fadeWeight).toBeLessThanOrEqual(1);
    expect(graphA.heroMotifVariant.dragWeight).toBe(graphB.heroMotifVariant.dragWeight);
    expect(graphA.heroMotifVariant.dragWeight).toBeGreaterThanOrEqual(0);
    expect(graphA.heroMotifVariant.dragWeight).toBeLessThanOrEqual(1);
    expect(graphA.heroMotifProfile.variantAxes.dragBias.min).toBeGreaterThanOrEqual(0);
    expect(graphA.heroMotifProfile.variantAxes.dragBias.max).toBeLessThanOrEqual(1);
  });

  test("hero cluster defaults and emission tuning are motif-aware", () => {
    const glass = buildSceneGraph(makeEdgeMap("glass-orbital"), makeTheme("ring", { symmetry: 0.7 }), buildCompositionPlan(makeEdgeMap("glass-orbital"), makeTheme("ring", { symmetry: 0.7 })));
    const arc = buildSceneGraph(makeEdgeMap("shattered-arc"), makeTheme("shard", { hueVariance: 0.4 }), buildCompositionPlan(makeEdgeMap("shattered-arc"), makeTheme("shard", { hueVariance: 0.4 })));
    const calm = buildSceneGraph(makeEdgeMap("cathedral-filament"), makeTheme("filament", { symmetry: 0.75 }), buildCompositionPlan(makeEdgeMap("cathedral-filament"), makeTheme("filament", { symmetry: 0.75 })));

    expect(glass.heroClusterConfig.enabled).toBe(true);
    expect(glass.heroClusterConfig.count).toBe(3);
    expect(["cojoined", "mirror-x", "mirror-y", "mirror-xy"]).toContain(glass.heroClusterConfig.relationshipMode);
    expect(glass.heroEmissionTuning.warpFactorScale).toBeCloseTo(1.08, 2);
    expect(arc.heroClusterConfig.layout).toBe("staggered-arc");
    expect(arc.heroEmissionTuning.warpFactorScale).toBeGreaterThanOrEqual(1.9);
    expect(calm.heroClusterConfig.count).toBe(1);
  });

  test("resolved mirror layouts produce readable bilateral separation", () => {
    const edgeMap = makeEdgeMap("harmonic-lattice");
    edgeMap.width = 1920;
    edgeMap.height = 1080;
    edgeMap.subjectBounds = { minX: 620, minY: 240, maxX: 1300, maxY: 860 };
    edgeMap.focalCenterX = 960;
    edgeMap.focalCenterY = 520;
    const theme = makeTheme("ring", { symmetry: 0.86, contrast: 0.24 });
    const plan = buildCompositionPlan(edgeMap, theme);
    const graph = buildSceneGraph(edgeMap, theme, plan);
    const layout = resolveHeroLayout(
      {
        continuitySeed: graph.continuitySeed,
        heroClusterConfig: graph.heroClusterConfig,
        heroRelationshipMode: graph.heroClusterConfig.relationshipMode,
        heroOrbitRadius: graph.heroOrbitRadius,
      },
      plan,
      edgeMap,
    );

    expect(layout.instances.length).toBeGreaterThanOrEqual(2);
    expect(["bilateral-stage", "vertical-stage"]).toContain(layout.layoutFamily);
    expect(
      Math.max(
        Math.abs(layout.instances[0]!.anchorX - layout.instances[1]!.anchorX),
        Math.abs(layout.instances[0]!.anchorY - layout.instances[1]!.anchorY),
      ),
    ).toBeGreaterThan(plan.heroRadius * 0.9);
    expect(layout.laneDiversityScore).toBeGreaterThanOrEqual(0.55);
  });

  test("resolved independent layouts stay deterministic and lane-diverse", () => {
    const edgeMap = makeEdgeMap("shattered-arc");
    edgeMap.width = 1920;
    edgeMap.height = 1080;
    edgeMap.subjectBounds = { minX: 540, minY: 200, maxX: 1380, maxY: 900 };
    edgeMap.focalCenterX = 980;
    edgeMap.focalCenterY = 500;
    edgeMap.regionAnchors = [
      { x: 420, y: 420, radius: 120, weight: 0.9, tx: 1, ty: 0 },
      { x: 1480, y: 610, radius: 110, weight: 0.82, tx: -1, ty: 0 },
      { x: 960, y: 240, radius: 90, weight: 0.68, tx: 0, ty: 1 },
    ];
    const theme = makeTheme("shard", { symmetry: 0.32, hueVariance: 0.44 });
    const plan = buildCompositionPlan(edgeMap, theme);
    const graph = buildSceneGraph(edgeMap, theme, plan);
    const layoutA = resolveHeroLayout(
      {
        continuitySeed: graph.continuitySeed,
        heroClusterConfig: graph.heroClusterConfig,
        heroRelationshipMode: "independent",
        heroOrbitRadius: graph.heroOrbitRadius,
      },
      plan,
      edgeMap,
    );
    const layoutB = resolveHeroLayout(
      {
        continuitySeed: graph.continuitySeed,
        heroClusterConfig: graph.heroClusterConfig,
        heroRelationshipMode: "independent",
        heroOrbitRadius: graph.heroOrbitRadius,
      },
      plan,
      edgeMap,
    );

    expect(layoutA.instances).toEqual(layoutB.instances);
    expect(layoutA.layoutFamily).toBe("independent-lanes");
    expect(layoutA.laneDiversityScore).toBeGreaterThanOrEqual(0.55);
    expect(new Set(layoutA.instances.map((instance) => instance.laneId)).size).toBe(layoutA.instances.length);
  });

  test("phasic motifs use quarter-note spawn timing and transition identity signatures", () => {
    const graph = buildSceneGraph(
      makeEdgeMap("harmonic-lattice"),
      makeTheme("ring", { symmetry: 0.82 }),
      buildCompositionPlan(makeEdgeMap("harmonic-lattice"), makeTheme("ring", { symmetry: 0.82 })),
    );

    expect(graph.heroMotifProfile.spawnTimingMode).toBe("phasic-quarter");
    expect(graph.transitionIdentitySignature).toContain(graph.heroMotifProfile.key);
    expect(graph.transitionIdentitySignature).toContain(graph.heroClusterConfig.relationshipMode);
  });

  test("hero emission tuning average warp stays near target", () => {
    const averageWarp =
      FRACTAL_MOTIFS
        .map((motif) => {
          const edgeMap = makeEdgeMap(motif);
          const theme = makeTheme("ring");
          return buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme)).heroEmissionTuning.warpFactorScale;
        })
        .reduce((sum, value) => sum + value, 0) / FRACTAL_MOTIFS.length;

    expect(averageWarp).toBeGreaterThanOrEqual(1.18);
    expect(averageWarp).toBeLessThanOrEqual(1.22);
  });

  test("new motif profiles expose size variance, exit tint, and influence lineage", () => {
    const edgeMap = makeEdgeMap("film-bloom-shard");
    edgeMap.subjectBounds = { minX: 0.08, minY: 0.1, maxX: 0.92, maxY: 0.86 };
    edgeMap.focalCenterX = 0.48;
    edgeMap.focalCenterY = 0.52;
    edgeMap.focalSpread = 0.32;
    const theme = makeTheme("shard", { contrast: 0.38, hueVariance: 0.42, edgeDensity: 0.44 });
    const graph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));

    expect(graph.heroMotifProfile.influenceKey.length).toBeGreaterThan(0);
    expect(graph.heroMotifProfile.particleSizeBaseRange.min).toBeGreaterThanOrEqual(1.5);
    expect(graph.heroMotifProfile.particleSizeBaseRange.max).toBeGreaterThan(graph.heroMotifProfile.particleSizeBaseRange.min);
    expect(["medium", "wide", "extreme"]).toContain(graph.heroMotifProfile.particleSizeVarianceMode);
    expect(["white-bleach", "warm-white", "cool-white"]).toContain(graph.heroMotifProfile.particleExitTint);
    expect(graph.heroMotifProfile.colorProminence.particles).toBeGreaterThan(0.8);
  });

  test("all motif profiles expose explicit warp routing", () => {
    for (const motif of FRACTAL_MOTIFS) {
      const edgeMap = makeEdgeMap(motif);
      const theme = makeTheme("ring");
      const graph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));

      expect(["subLow", "low", "mid", "highMid", "high"]).toContain(graph.heroMotifProfile.warpProfile.xBand);
      expect(["subLow", "low", "mid", "highMid", "high"]).toContain(graph.heroMotifProfile.warpProfile.yBand);
      expect(graph.heroMotifProfile.warpProfile.xBaseMultiplier).toBeGreaterThanOrEqual(1.05);
      expect(graph.heroMotifProfile.warpProfile.yBaseMultiplier).toBeGreaterThanOrEqual(1.1);
      expect(graph.heroMotifProfile.warpProfile.xExtremeMultiplier).toBeGreaterThanOrEqual(graph.heroMotifProfile.warpProfile.xBaseMultiplier);
      expect(graph.heroMotifProfile.warpProfile.yExtremeMultiplier).toBeGreaterThanOrEqual(graph.heroMotifProfile.warpProfile.yBaseMultiplier);
    }
  });

  test("tight motifs stay tighter than wide motifs", () => {
    const tightEdgeMap = makeEdgeMap("data-cathedral");
    const wideEdgeMap = makeEdgeMap("chromatic-xylem");
    const tightTheme = makeTheme("filament", { contrast: 0.28, edgeDensity: 0.4 });
    const wideTheme = makeTheme("cellular", { contrast: 0.24, saturationMean: 0.52 });
    const tightGraph = buildSceneGraph(tightEdgeMap, tightTheme, buildCompositionPlan(tightEdgeMap, tightTheme));
    const wideGraph = buildSceneGraph(wideEdgeMap, wideTheme, buildCompositionPlan(wideEdgeMap, wideTheme));
    const tightSpan = tightGraph.heroMotifProfile.particleSizeBaseRange.max - tightGraph.heroMotifProfile.particleSizeBaseRange.min;
    const wideSpan = wideGraph.heroMotifProfile.particleSizeBaseRange.max - wideGraph.heroMotifProfile.particleSizeBaseRange.min;

    expect(tightGraph.heroMotifProfile.particleSizeVarianceMode).toBe("tight");
    expect(wideGraph.heroMotifProfile.particleSizeVarianceMode).toBe("wide");
    expect(tightSpan).toBeLessThan(wideSpan);
  });

  test("background plans resolve trigger and coupling metadata for new systems", () => {
    const edgeMap = makeEdgeMap("glass-orbital");
    const theme = makeTheme("ring", { symmetry: 0.74, edgeDensity: 0.5, contrast: 0.22 });
    const graph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));

    expect(graph.backgroundPlan.backgroundElementId).toBeDefined();
    expect(graph.backgroundPlan.backgroundElementFamily).toBeDefined();
    expect(graph.backgroundPlan.triggerMode).toBeDefined();
    expect(graph.backgroundPlan.imageResponseMode).toBeDefined();
    expect(graph.backgroundPlan.familyVariant).toBeDefined();
    expect(graph.backgroundPlan.triggerWindowFrames).toBeGreaterThan(0);
  });

  test("low-confidence images degrade silhouette interactions without dropping identity", () => {
    const edgeMap = makeEdgeMap("film-bloom-shard");
    edgeMap.maskConfidence = "low";
    const theme = makeTheme("shard", { contrast: 0.3, edgeDensity: 0.44 });
    const graph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));

    expect(graph.backgroundPlan.backgroundElementId).toBeDefined();
    if (graph.backgroundPlan.imageResponseMode === "silhouette") {
      expect(graph.backgroundPlan.interactionMode).toBe("none");
      expect(graph.backgroundPlan.familyVariant).toBe("default");
    }
  });

  test("motif effect selection is stable and avoids immediate repeats when alternatives exist", () => {
    const edgeMap = makeEdgeMap("film-bloom-shard");
    const theme = makeTheme("ring", { symmetry: 0.64, contrast: 0.2 });
    const visualState = makeVisualState({ regime: "build", phraseIndex: 3 });
    const first = selectMotifEffect(edgeMap, visualState, theme, 77);
    const second = selectMotifEffect(edgeMap, visualState, theme, 77);
    const alternate = selectMotifEffect(edgeMap, visualState, theme, 77, first.id);

    expect(first.id).toBe(second.id);
    expect(alternate.primaryMotif).toBe("film-bloom-shard");
    expect(alternate.id).not.toBe(first.id);
  });

  test("bpm reactive motif effects produce valid db weights and phase", () => {
    const rolling = createRollingDbWindowState(32);
    for (let index = 0; index < 16; index += 1) {
      updateRollingDbWindowState(rolling, makeFrame({
        frameIndex: index,
        timeSec: index / 30,
        beatIndex: index,
        dbLow: -26 + index * 0.3,
        dbLowMid: -21 + index * 0.28,
        dbMid: -18 + index * 0.26,
        dbHighMid: -15 + index * 0.22,
        dbHigh: -12 + index * 0.2,
      }));
    }
    const spec = MOTIF_EFFECT_SPECS.find((entry) => entry.id === "interference-grid")!;
    const state = evaluateMotifEffectState(makeFrame({
      frameIndex: 18,
      timeSec: 0.6,
      beatIndex: 18,
      peakStrength: 0.62,
      phrasePulse: 0.86,
      isBeatAccent: true,
      isBarDownbeat: false,
      isFourBarDownbeat: true,
      dbLow: -18,
      dbLowMid: -14,
      dbMid: -11,
      dbHighMid: -9,
      dbHigh: -7,
    }), 128, spec, rolling);

    expect(state.phase).toBeGreaterThanOrEqual(0);
    expect(state.phase).toBeLessThan(1);
    expect(state.lowDbWeight).toBeGreaterThanOrEqual(0);
    expect(state.midDbWeight).toBeGreaterThanOrEqual(0);
    expect(state.highDbWeight).toBeGreaterThanOrEqual(0);
    expect(state.intensity).toBeGreaterThan(0);
    expect(state.heroWarpActive).toBe(false);
  });

  test("rare hero warp effects only activate on gated musical moments", () => {
    const rolling = createRollingDbWindowState(16);
    for (let index = 0; index < 8; index += 1) {
      updateRollingDbWindowState(rolling, makeFrame({ frameIndex: index, timeSec: index / 30 }));
    }
    const spec = MOTIF_EFFECT_SPECS.find((entry) => entry.id === "shock-ring")!;
    const inactive = evaluateMotifEffectState(makeFrame({
      frameIndex: 20,
      timeSec: 0.8,
      phrasePulse: 0.4,
      peakStrength: 0.3,
      isFourBarDownbeat: false,
    }), 120, spec, rolling);
    const active = evaluateMotifEffectState(makeFrame({
      frameIndex: 21,
      timeSec: 0.84,
      phrasePulse: 0.9,
      peakStrength: 0.7,
      isFourBarDownbeat: false,
    }), 120, spec, rolling);

    expect(inactive.heroWarpActive).toBe(false);
    expect(active.heroWarpActive).toBe(true);
  });

  test("persistent motif registry stays unique and selection is deterministic", () => {
    expect(PERSISTENT_MOTIF_SPECS).toHaveLength(10);
    expect(new Set(PERSISTENT_MOTIF_SPECS.map((entry) => entry.id)).size).toBe(10);
    const edgeMap = makeEdgeMap("data-cathedral");
    const theme = makeTheme("filament", { symmetry: 0.72, contrast: 0.3 });
    const first = selectInitialPersistentMotif(edgeMap, "groove", theme, 33);
    const second = selectInitialPersistentMotif(edgeMap, "groove", theme, 33);
    expect(first.id).toBe(second.id);
    expect(first.label.length).toBeGreaterThan(10);
  });

  test("persistent motifs only rotate on sufficiently strong transient peaks", () => {
    const edgeMap = makeEdgeMap("mandelbloom");
    const theme = makeTheme("ring", { symmetry: 0.8, contrast: 0.24 });
    const spec = selectInitialPersistentMotif(edgeMap, "build", theme, 11);
    const calmFrame = makeFrame({ frameIndex: 10, peakStrength: 0.24, onsetStrength: 0.2, dbNormalized: 0.28 });
    const peakFrame = makeFrame({ frameIndex: 80, peakStrength: 0.92, onsetStrength: 0.84, dbNormalized: 0.78, isFourBarDownbeat: true });
    expect(shouldRotatePersistentMotif({
      frame: calmFrame,
      phrasePlan: undefined,
      current: {
        id: spec.id,
        label: spec.label,
        influenceKey: spec.influenceKey,
        ageFrames: spec.minCarryFrames + 10,
        carryFrames: spec.minCarryFrames + 10,
        changedThisFrame: false,
        changeGate: "startup",
        transientScore: transientPeakScore(calmFrame),
        cooldownUntilBeat: 0,
      },
      spec,
      frameIndex: calmFrame.frameIndex,
    })).toBe(false);
    expect(shouldRotatePersistentMotif({
      frame: peakFrame,
      phrasePlan: undefined,
      current: {
        id: spec.id,
        label: spec.label,
        influenceKey: spec.influenceKey,
        ageFrames: spec.minCarryFrames + 10,
        carryFrames: spec.minCarryFrames + 10,
        changedThisFrame: false,
        changeGate: "startup",
        transientScore: transientPeakScore(peakFrame),
        cooldownUntilBeat: 0,
      },
      spec,
      frameIndex: peakFrame.frameIndex,
    })).toBe(true);
    const next = selectNextPersistentMotif({ currentId: spec.id, edgeMap, visualRegime: "build", theme, frame: peakFrame });
    expect(next.id).not.toBe(spec.id);
  });

  test("event registry stays unique and produces deterministic event state", () => {
    expect(EVENT_SPECS).toHaveLength(15);
    expect(new Set(EVENT_SPECS.map((entry) => entry.id)).size).toBe(15);
    const edgeMap = makeEdgeMap("glass-orbital");
    const frame = makeFrame({ frameIndex: 32, peakStrength: 0.72, onsetStrength: 0.66, phrasePulse: 0.88, dominantBand: "high" });
    const spec = selectEventSpec({ edgeMap, frame, visualRegime: "drop" });
    const stateA = evaluateEventState({ spec, frame });
    const stateB = evaluateEventState({ spec, frame });
    expect(stateA.id).toBe(stateB.id);
    expect(stateA.intensity).toBeCloseTo(stateB.intensity, 5);
    expect(stateA.accentModes.length).toBeGreaterThan(0);
  });
});
