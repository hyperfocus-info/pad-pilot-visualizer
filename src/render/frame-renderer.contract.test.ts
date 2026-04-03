import { describe, expect, test } from "bun:test";
import { createRenderSettings } from "../config";
import { FrameRenderer, configuredHeroShellCountFromScore } from "./frame-renderer";
import { buildVisualPlan } from "./visual-plan";
import type { AudioFrameFeature, AudioSegmentFeature, CompositionPlan, EdgeMap } from "../types";

function makeFrame(frameIndex: number, narrativeIntensity: number, peakStrength: number, onsetStrength: number): AudioFrameFeature {
  return {
    frameIndex,
    timeSec: frameIndex / 12,
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
    beatPulse: 0.6,
    subBeatPulse: 0.3,
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

function makeEdgeMap(imagePath: string, motif: EdgeMap["fractalMotif"]): EdgeMap {
  const contourPoint = (x: number, y: number) => ({ x, y, nx: 0, ny: -1, curvature: 0.2 });
  return {
    imagePath,
    points: [{ x: 320, y: 180, strength: 1, tx: 1, ty: 0, nx: 0, ny: -1 }],
    contours: [{ points: [contourPoint(220, 140), contourPoint(420, 140), contourPoint(420, 320), contourPoint(220, 320)], closed: true, strength: 0.9, length: 600 }],
    flowField: { gridWidth: 2, gridHeight: 2, cellWidth: 320, cellHeight: 180, vectors: new Float32Array(8), weights: new Float32Array([1, 1, 1, 1]) },
    densityField: { gridWidth: 2, gridHeight: 2, cellWidth: 320, cellHeight: 180, values: new Float32Array([0.2, 0.8, 0.6, 0.4]) },
    toneField: { gridWidth: 4, gridHeight: 4, cellWidth: 160, cellHeight: 90, luminance: new Float32Array(16).fill(0.4), contrast: new Float32Array(16).fill(0.6) },
    subjectMask: { gridWidth: 4, gridHeight: 4, cellWidth: 160, cellHeight: 90, values: new Float32Array([0.1, 0.1, 0.2, 0.2, 0.2, 0.8, 0.9, 0.2, 0.2, 0.9, 1, 0.2, 0.1, 0.2, 0.2, 0.1]) },
    silhouetteContours: [{ points: [contourPoint(260, 120), contourPoint(380, 120), contourPoint(380, 300), contourPoint(260, 300)], closed: true, strength: 1, length: 540 }],
    spawners: [{ x: 320, y: 180, radius: 80, weight: 1, tx: 1, ty: 0 }],
    regionAnchors: [{ x: 420, y: 200, radius: 90, weight: 0.8, tx: -1, ty: 0 }],
    spatialBins: { gridWidth: 1, gridHeight: 1, cellWidth: 640, cellHeight: 360, pointBins: [[0]], spawnerBins: [[0]] },
    focalCenterX: 320,
    focalCenterY: 180,
    focalSpread: 160,
    leftWeight: 0.3,
    rightWeight: 0.7,
    topWeight: 0.45,
    bottomWeight: 0.55,
    subjectBounds: { minX: 220, minY: 120, maxX: 420, maxY: 320 },
    negativeSpaceQuadrant: "tl",
    maskConfidence: "high",
    fractalMotif: motif,
    width: 640,
    height: 360,
    complexity: 0.62,
  };
}

function makeCompositionPlan(overrides: Partial<CompositionPlan> = {}): CompositionPlan {
  return {
    imagePath: "plan.png",
    heroCenterX: 320,
    heroCenterY: 180,
    heroRadius: 96,
    focalOccupancyScore: 0.24,
    centerBiasScore: 0.48,
    shotGrammarKey: "off-axis-processional",
    supportSlots: [{ x: 250, y: 170, radius: 48, weight: 0.9, layer: "support", angle: 0 }],
    backgroundSlots: [{ x: 160, y: 120, radius: 52, weight: 0.7, layer: "background", angle: 0 }],
    protectedZones: [],
    heroContours: [],
    supportContours: [],
    bridgeAnchors: [{ x: 250, y: 170, weight: 0.9 }],
    stylePlacementMode: "filament",
    dustSlots: [{ x: 160, y: 120, radius: 32, weight: 0.6 }],
    starSlots: [{ x: 460, y: 80, weight: 0.4 }],
    ...overrides,
  };
}

function makePhrase(
  startFrame: number,
  endFrame: number,
  regime: "intro" | "groove" | "build" | "drop" | "breakdown" | "outro",
): any {
  return {
    startFrame,
    endFrame,
    startSec: startFrame / 12,
    endSec: endFrame / 12,
    regime,
    averageEnergy: regime === "drop" ? 0.82 : 0.42,
    peakiness: regime === "drop" ? 0.9 : 0.34,
    brightnessFloor: 0.08,
    densityCap: 1,
    motionMode: "pulse",
    overlayMode: regime === "outro" ? "sparse-contour" : "stable-feedback",
    transitionFamily: regime === "drop" ? "flash" : "carry",
    shotMode: "detail",
    effectPolicy: "balanced",
    rescuePolicy: "lift",
    imageHoldMultiplier: 1,
    effectiveImageHoldMultiplier: 1,
    transientCutBias: 0.2,
    rapidPeakDensity: 0.2,
    transitionOpportunityBias: 1.1,
    imageSwapAllowed: regime !== "outro",
    transitionTriggerPreference: regime === "outro" ? "hold" : "swap",
    preferredCutFrame: startFrame,
    transitionDurationMultiplier: 1,
    transitionCarryBias: 0.7,
    songVisualFamily: "cathedral-bloom",
    phraseMotifFamily: "glow-grid",
    phraseTransitionCluster: "carry",
    phraseCompositionBias: "hero-forward",
    phraseHeroMotionBias: "establish-breath",
    phraseBackgroundResponseBias: "stable-support",
    transientOpportunityFrames: [],
  };
}

describe("frame renderer seeded contracts", () => {
  test("seeded runs preserve hero-first diagnostics across calm, rise, and peak phases", () => {
    const frames = [
      makeFrame(0, 0.18, 0.2, 0.12),
      makeFrame(1, 0.24, 0.24, 0.16),
      makeFrame(2, 0.36, 0.4, 0.24),
      makeFrame(3, 0.5, 0.58, 0.34),
      makeFrame(4, 0.7, 0.82, 0.48),
      makeFrame(5, 0.9, 0.96, 0.62),
    ];
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 8,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 30),
      120,
      0,
      false,
      [makeEdgeMap("renderer.png", "glass-orbital")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    for (const frame of frames) {
      renderer.renderFrame(frame);
    }

    expect(renderer.getLastHeroCoverage()).toBeGreaterThanOrEqual(0);
    expect(renderer.getLastParticleVisibleRatio()).toBeGreaterThanOrEqual(0);
    expect(renderer.getLastParticleVisibleRatio()).toBeLessThanOrEqual(1);
    expect(renderer.getLastHeroTrailOccupancy()).toBeGreaterThanOrEqual(0);
    expect(renderer.getLastHeroQuadrant()).toBeDefined();
    expect(renderer.getLastHeroChangedOnTransition()).toBe(false);
    expect(typeof renderer.getLastHeroSeparationReadable()).toBe("boolean");
    expect(renderer.getLastHeroConductorCount()).toBeGreaterThanOrEqual(0);
    expect(renderer.getLastHeroExpandedBandCount()).toBeGreaterThanOrEqual(4);
    expect(renderer.getLastHeroCircleEmitterNodeCoverage()).toBeGreaterThanOrEqual(0);
  });

  test("signed db and hz transition drives stay normalized and switch to the higher factor on first drop", () => {
    const frames = [
      { ...makeFrame(0, 0.2, 0.18, 0.12), dbOverall: -12, dominantHz: 220, isPeak: false },
      { ...makeFrame(12, 0.32, 0.28, 0.18), dbOverall: -6, dominantHz: 110, isPeak: false },
      { ...makeFrame(24, 0.9, 0.92, 0.62), dbOverall: 0, dominantHz: 440, isPeak: true },
    ];
    const visualPlan = [makePhrase(0, 23, "groove"), makePhrase(24, 47, "drop")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 4,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 30),
      120,
      0,
      false,
      [makeEdgeMap("signed-0.png", "glass-orbital"), makeEdgeMap("signed-1.png", "glass-orbital"), makeEdgeMap("signed-2.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame(frames[0]!);
    renderer.renderFrame(frames[1]!);
    expect(renderer.getLastVisualState().regime).toBe("groove");
    expect(renderer.getLastDbTransitionDrive()).toBeCloseTo(0.3, 3);
    expect(renderer.getLastHzTransitionDrive()).toBeCloseTo(-0.6, 3);
    expect(renderer.getLastDbTransitionDrive()).toBeGreaterThanOrEqual(-1);
    expect(renderer.getLastDbTransitionDrive()).toBeLessThanOrEqual(1);
    expect(renderer.getLastHzTransitionDrive()).toBeGreaterThanOrEqual(-1);
    expect(renderer.getLastHzTransitionDrive()).toBeLessThanOrEqual(1);

    renderer.renderFrame(frames[2]!);
    expect(renderer.getLastVisualState().regime).toBe("drop");
    expect(renderer.getLastDbTransitionDrive()).toBeCloseTo(0.6, 3);
    expect(renderer.getLastHzTransitionDrive()).toBeCloseTo(1, 3);
    expect(renderer.getLastDbTransitionDrive()).toBeGreaterThanOrEqual(-1);
    expect(renderer.getLastDbTransitionDrive()).toBeLessThanOrEqual(1);
    expect(renderer.getLastHzTransitionDrive()).toBeGreaterThanOrEqual(-1);
    expect(renderer.getLastHzTransitionDrive()).toBeLessThanOrEqual(1);
  });

  test("quieting transition drives lengthen transition duration", () => {
    const visualPlan = [makePhrase(0, 23, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 30),
      120,
      0,
      false,
      [makeEdgeMap("duration.png", "glass-orbital")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    const baseDuration = (renderer as any).transitionDurationFrames(
      renderer.getLastVisualState(),
      makeEdgeMap("duration.png", "glass-orbital"),
      { motionPx: 3 },
      0,
      0,
    );
    const quietingDuration = (renderer as any).transitionDurationFrames(
      renderer.getLastVisualState(),
      makeEdgeMap("duration.png", "glass-orbital"),
      { motionPx: 3 },
      -0.8,
      -0.6,
    );

    expect(quietingDuration).toBeGreaterThan(baseDuration);
  });

  test("mild edge dominance alone stays in composition adjustment without escalating fallback mode", () => {
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("mild-edge.png", "glass-orbital")],
      [],
      { secondsPerImage: 2 },
      [makePhrase(0, 23, "groove")] as any,
      -10,
      false,
      "test",
    );
    const edgeMap = {
      ...makeEdgeMap("mild-edge.png", "glass-orbital"),
      leftWeight: 0.94,
      rightWeight: 0.28,
      topWeight: 0.24,
      bottomWeight: 0.18,
    };
    const plan = makeCompositionPlan({
      heroCenterX: 500,
      heroCenterY: 180,
      focalOccupancyScore: 0.26,
      centerBiasScore: 0.42,
      supportSlots: [{ x: 120, y: 70, radius: 28, weight: 0.7, layer: "support", angle: 0 }],
      bridgeAnchors: [{ x: 120, y: 70, weight: 0.7 }],
    });

    const rebalanced = (renderer as any).rebalanceCompositionPlan(plan, edgeMap, 0.12, 0.24);

    expect(rebalanced.fallbackRenderMode).toBe("none");
    expect(rebalanced.fallbackSeverity).toBe("none");
    expect(rebalanced.fallbackTriggerCount).toBe(0);
    expect(rebalanced.compositionModeReason).toBe("edge-dominance-recovery");
  });

  test("moderate multi-risk windows use safety recovery and add hero-adjacent support", () => {
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("moderate-risk.png", "halo-cell")],
      [],
      { secondsPerImage: 2 },
      [makePhrase(0, 23, "breakdown")] as any,
      -10,
      false,
      "test",
    );
    const edgeMap = {
      ...makeEdgeMap("moderate-risk.png", "halo-cell"),
      leftWeight: 0.9,
      rightWeight: 0.5,
      topWeight: 0.56,
      bottomWeight: 0.44,
      negativeSpaceQuadrant: "center" as const,
      maskConfidence: "medium" as const,
    };
    const plan = makeCompositionPlan({
      heroCenterX: 360,
      heroCenterY: 180,
      heroRadius: 58,
      focalOccupancyScore: 0.14,
      centerBiasScore: 0.7,
      supportSlots: [{ x: 300, y: 170, radius: 42, weight: 0.75, layer: "support", angle: 0 }],
      backgroundSlots: [{ x: 96, y: 96, radius: 42, weight: 0.36, layer: "background", angle: 0 }],
      bridgeAnchors: [{ x: 300, y: 170, weight: 0.75 }],
      dustSlots: [{ x: 96, y: 96, radius: 18, weight: 0.3 }],
    });

    const rebalanced = (renderer as any).rebalanceCompositionPlan(plan, edgeMap, 0.24, 0.5);

    expect(rebalanced.fallbackRenderMode).toBe("safety-recovery");
    expect(rebalanced.fallbackSeverity).toBe("light");
    expect(rebalanced.fallbackReason).not.toBe("safety-recovery");
    expect(rebalanced.plan.supportSlots.length).toBeGreaterThan(plan.supportSlots.length);
    expect(rebalanced.plan.centerBiasScore).toBeLessThan(plan.centerBiasScore);
  });

  test("severe centered sparse inputs still use full fallback compose", () => {
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("severe-center.png", "halo-cell")],
      [],
      { secondsPerImage: 2 },
      [makePhrase(0, 23, "breakdown")] as any,
      -10,
      false,
      "test",
    );
    const edgeMap = {
      ...makeEdgeMap("severe-center.png", "halo-cell"),
      leftWeight: 0.55,
      rightWeight: 0.56,
      topWeight: 0.55,
      bottomWeight: 0.54,
      negativeSpaceQuadrant: "center" as const,
    };
    const plan = makeCompositionPlan({
      heroCenterX: 320,
      heroCenterY: 180,
      heroRadius: 52,
      focalOccupancyScore: 0.12,
      centerBiasScore: 0.95,
      supportSlots: [],
      backgroundSlots: [{ x: 96, y: 90, radius: 36, weight: 0.4, layer: "background", angle: 0 }],
      bridgeAnchors: [],
      dustSlots: [{ x: 96, y: 90, radius: 20, weight: 0.3 }],
    });

    const rebalanced = (renderer as any).rebalanceCompositionPlan(plan, edgeMap, 0.08, 0.92);

    expect(rebalanced.fallbackRenderMode).toBe("fallback-composed");
    expect(rebalanced.fallbackSeverity).toBe("full");
    expect(rebalanced.fallbackTriggerCount).toBeGreaterThanOrEqual(3);
  });

  test("audio-cooled source image promotion reports deterministic 20-40 percent thresholds", () => {
    const frames = [
      { ...makeFrame(0, 0.24, 0.22, 0.16), dbOverall: -12, dominantHz: 220 },
      { ...makeFrame(13, 0.82, 0.88, 0.58), dbOverall: 0, dominantHz: 440, bandWeightedScore: 0.72, impactBandScore: 0.54 },
    ];
    const visualPlan = [makePhrase(0, 30, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 3,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("promo-0.png", "glass-orbital"), makeEdgeMap("promo-1.png", "glass-orbital"), makeEdgeMap("promo-2.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame(frames[0]!);
    (renderer as any).heldTransitionStreak = 1;
    (renderer as any).lastTransitionEventFrameIndex = 10;
    (renderer as any).nextAllowableTransitionFrame = 18;
    (renderer as any).audioTriggeredTransitionCountByWindowIndex.set(1, 2);

    const promotedFrame = renderer.renderFrame(frames[1]!);

    expect(promotedFrame.audioSwapPromotionChance).toBeGreaterThan(0.2);
    expect(promotedFrame.audioSwapPromotionChance).toBeLessThanOrEqual(0.4);
    expect(promotedFrame.audioSwapPromotionExtraChance).toBeGreaterThan(0);
    expect(promotedFrame.audioSwapPromotionExtraChance).toBeLessThanOrEqual(0.2);
    expect(promotedFrame.audioSwapNodeTriggerCount).toBeGreaterThanOrEqual(2);
  });

  test("outro lockout prevents new transitions and pins the current source image", () => {
    const frames = [
      { ...makeFrame(0, 0.28, 0.24, 0.18), dbOverall: -10 },
      { ...makeFrame(13, 0.74, 0.8, 0.44), dbOverall: -2 },
      { ...makeFrame(25, 0.68, 0.72, 0.34), dbOverall: -4 },
    ];
    const visualPlan = [makePhrase(0, 23, "groove"), makePhrase(24, 47, "outro")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 4,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("outro-0.png", "glass-orbital"), makeEdgeMap("outro-1.png", "harmonic-lattice"), makeEdgeMap("outro-2.png", "data-cathedral")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame(frames[0]!);
    renderer.renderFrame(frames[1]!);
    const transitionFrameBeforeOutro = (renderer as any).lastTransitionEventFrameIndex;
    expect(renderer.getLastRenderSelection().resolvedImageIndex).toBe(1);

    renderer.renderFrame(frames[2]!);

    expect(renderer.getLastVisualState().regime).toBe("outro");
    expect(renderer.getLastRenderSelection().requestedImageIndex).toBe(1);
    expect(renderer.getLastRenderSelection().resolvedImageIndex).toBe(1);
    expect((renderer as any).lastTransitionEventFrameIndex).toBe(transitionFrameBeforeOutro);
  });

  test("low-confidence breakdown windows do not promote to pulse-wave overlays", () => {
    const frames = [
      { ...makeFrame(0, 0.28, 0.3, 0.2), dbOverall: -12 },
      { ...makeFrame(1, 0.3, 0.66, 0.46), dbOverall: -10, normalizedHigh: 0.66, normalizedHighMid: 0.52 },
    ];
    const visualPlan = [makePhrase(0, 23, "breakdown")] as any;
    const edgeMap = {
      ...makeEdgeMap("low-confidence.png", "smoke-ribbon"),
      maskConfidence: "low" as const,
    };
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [edgeMap],
      [{
        index: 0,
        startSec: 0,
        endSec: 2,
        dominantHz: 220,
        dominantBand: "mid",
        rainbowHueOffset: 0,
        paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
        motionScale: 1,
        densityScale: 1,
      }],
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame(frames[0]!);
    renderer.renderFrame(frames[1]!);

    expect((renderer as any).lastSafetyMetrics.overlayModeUsed).not.toBe("pulse-wave");
  });

  test("captures pre-effect luminance only in full telemetry mode", () => {
    const frames = [makeFrame(0, 0.5, 0.6, 0.3)];
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMaps = [makeEdgeMap("renderer.png", "glass-orbital")];
    const baseArgs = [
      createRenderSettings("480", 12),
      120,
      0,
      false,
      edgeMaps,
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    ] as const;
    const summaryRenderer = new FrameRenderer(...baseArgs, { telemetryMode: "summary" });
    const fullRenderer = new FrameRenderer(...baseArgs, { telemetryMode: "full" });

    const summaryFrame = summaryRenderer.renderFrame(frames[0]!);
    const fullFrame = fullRenderer.renderFrame(frames[0]!);

    expect(summaryFrame.preEffectLuminanceSample).toBeUndefined();
    expect(fullFrame.preEffectLuminanceSample).toBeGreaterThanOrEqual(0);
  });

  test("exposes darkest-quartile luminance and low-db hero restraint telemetry", () => {
    const frames = [
      makeFrame(0, 0.45, 0.48, 0.2),
      makeFrame(1, 0.44, 0.5, 0.22),
      makeFrame(2, 0.42, 0.56, 0.26),
      { ...makeFrame(3, 0.4, 0.64, 0.28), dbOverall: -16, dbLow: -14, dbHighMid: -9, dbHigh: -7, isBarDownbeat: true, isPeak: true },
    ];
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 4,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("telemetry.png", "film-bloom-shard")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    let lastFrame = renderer.renderFrame(frames[0]!);
    for (const frame of frames.slice(1)) {
      lastFrame = renderer.renderFrame(frame);
    }

    expect(lastFrame.darkestQuartileLuminance).toBeGreaterThanOrEqual(0);
    expect(lastFrame.mainHeroLowDbThrottle).toBe(true);
    expect(typeof lastFrame.mainHeroFreezeActive).toBe("boolean");
  });

  test("safety governor ignores invalid rescue geometry instead of crashing native gradients", () => {
    const frames = [makeFrame(0, 0.4, 0.5, 0.2)];
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMap = makeEdgeMap("unsafe-safety.png", "glass-orbital");
    edgeMap.focalCenterX = Number.NaN;
    edgeMap.focalCenterY = Number.POSITIVE_INFINITY;
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [edgeMap],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const anyRenderer = renderer as any;
    const theme = anyRenderer.getTheme(0, segments[0], edgeMap);
    anyRenderer.lastLowResFrameStats = {
      luminanceSample: 0.08,
      darkestQuartileLuminance: 0.02,
      darkSampleCount: 12,
      sampleCount: 16,
    };

    expect(() => anyRenderer.applySafetyGovernor(
      frames[0],
      theme,
      edgeMap,
      [
        { x: Number.NaN, y: 140, radius: 30, weight: 0.8, tx: 1, ty: 0 },
        { x: 320, y: Number.NEGATIVE_INFINITY, radius: 24, weight: 0.6, tx: 1, ty: 0 },
        { x: 320, y: 180, radius: Number.NaN, weight: 0.7, tx: 1, ty: 0 },
        { x: 320, y: 180, radius: 40, weight: Number.NaN, tx: 1, ty: 0 },
      ],
      visualPlan[0]!,
      {
        ...anyRenderer.lastSafetyMetrics,
        brightnessFloor: 0.08,
        trailingLuminance: 0.03,
        recoveryActive: true,
        overlayModeUsed: "sparse-contour",
        transitionFamilyUsed: "carry",
      },
    )).not.toThrow();
  });

  test("outro frames expose terminal escalation telemetry", () => {
    const frames = Array.from({ length: 40 }, (_, index) => makeFrame(index, 0.72, 0.82, 0.4));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 10,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("outro.png", "glass-orbital")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    let lastFrame = renderer.renderFrame(frames[0]!);
    for (const frame of frames.slice(1)) {
      lastFrame = renderer.renderFrame(frame);
    }

    expect(lastFrame.outroEffectId).toBeDefined();
    expect(lastFrame.outroCoverageEstimate).toBeGreaterThan(0);
    expect(lastFrame.outroHeroWarp).toBeGreaterThanOrEqual(0);
    expect(lastFrame.terminalBurstProgress).toBeGreaterThanOrEqual(0);
  });

  test("normal mode keeps full luminance readback cadence", () => {
    const frames = Array.from({ length: 5 }, (_, index) => makeFrame(index, 0.55, 0.6, 0.25));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 3,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("full-lum.png", "glass-orbital")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    let lastFrame = renderer.renderFrame(frames[0]!);
    for (const frame of frames.slice(1)) {
      lastFrame = renderer.renderFrame(frame);
    }

    expect(lastFrame.luminanceReadbackMode).toBe("full");
    expect(lastFrame.luminanceReadbackSampleInterval).toBe(1);
    expect(lastFrame.luminanceReadbackSkipped).toBe(false);
    expect(lastFrame.stageMetrics?.luminanceReadbackFramesSampled).toBe(1);
    expect(lastFrame.stageMetrics?.luminanceReadbackFramesSkipped).toBe(0);
  });

  test("budget mode gates luminance readback and reports skipped samples", () => {
    const frames = Array.from({ length: 6 }, (_, index) => makeFrame(index, 0.55, 0.6, 0.25));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 3,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("budget-lum.png", "glass-orbital")],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      true,
      "test",
    );

    const rendered = frames.map((frame) => renderer.renderFrame(frame));
    const skippedFrame = rendered.find((frame) => frame.luminanceReadbackSkipped);
    const sampledFrames = rendered.filter((frame) => !frame.luminanceReadbackSkipped);
    const sampledFrame = sampledFrames[sampledFrames.length - 1];

    expect(skippedFrame).toBeDefined();
    expect(sampledFrame).toBeDefined();
    expect(skippedFrame?.luminanceReadbackMode).toBe("budget-gated");
    expect(skippedFrame?.luminanceReadbackSampleInterval).toBe(4);
    expect(skippedFrame?.luminanceReadbackSkipped).toBe(true);
    expect(skippedFrame?.stageMetrics?.luminanceReadbackFramesSkipped).toBe(1);
    expect(skippedFrame?.stageMetrics?.luminanceReadbackMsSavedEstimate).toBeGreaterThanOrEqual(0);
    expect(sampledFrame?.luminanceReadbackSkipped).toBe(false);
    expect(sampledFrame?.stageMetrics?.luminanceReadbackFramesSampled).toBe(1);
  });

  test("hero shell scenes stay capped at a deterministic 30 percent window budget", () => {
    const frames = Array.from({ length: 61 }, (_, index) => makeFrame(index, 0.58, 0.72, 0.32));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 1 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 5,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMaps = [
      makeEdgeMap("shell-0.png", "glass-orbital"),
      makeEdgeMap("shell-1.png", "glass-orbital"),
      makeEdgeMap("shell-2.png", "glass-orbital"),
      makeEdgeMap("shell-3.png", "glass-orbital"),
      makeEdgeMap("shell-4.png", "glass-orbital"),
    ];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      edgeMaps,
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );

    expect((renderer as any).nodeWindowCount).toBe(5);
    expect((renderer as any).shellEnabledWindowIndices.size).toBe(1);
    expect([...((renderer as any).heroShellWindowStates.values())].filter((entry: any) => entry.enabled)).toHaveLength(1);
  });

  test("hero shell count distribution yields an exact 1.3 average across deterministic scores", () => {
    const counts = Array.from({ length: 100 }, (_, score) => configuredHeroShellCountFromScore(score));
    expect(counts.filter((count) => count === 1)).toHaveLength(75);
    expect(counts.filter((count) => count === 2)).toHaveLength(20);
    expect(counts.filter((count) => count === 3)).toHaveLength(5);
    expect(counts.reduce((sum, count) => sum + count, 0) / counts.length).toBeCloseTo(1.3, 6);
  });

  test("non-enabled shell scenes resolve to no legacy or stack shells", () => {
    const frames = Array.from({ length: 61 }, (_, index) => makeFrame(index, 0.52, 0.64, 0.24));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 1 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 5,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMaps = [
      makeEdgeMap("shell-off-0.png", "glass-orbital"),
      makeEdgeMap("shell-off-1.png", "glass-orbital"),
      makeEdgeMap("shell-off-2.png", "glass-orbital"),
      makeEdgeMap("shell-off-3.png", "glass-orbital"),
      makeEdgeMap("shell-off-4.png", "glass-orbital"),
    ];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      edgeMaps,
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const disabledWindowIndex = [0, 1, 2, 3, 4].find((index) => !(renderer as any).shellEnabledWindowIndices.has(index))!;
    const edgeMap = edgeMaps[disabledWindowIndex]!;
    const segment = (renderer as any).segmentForIndex(disabledWindowIndex);
    const theme = (renderer as any).getTheme(disabledWindowIndex, segment, edgeMap);
    const compositionPlan = (renderer as any).getCompositionPlan(edgeMap, theme);
    const resolvedSceneGraph = (renderer as any).resolveHeroShellSceneForWindow(
      (renderer as any).getSceneGraph(edgeMap, theme, compositionPlan, disabledWindowIndex),
      disabledWindowIndex,
    );

    expect(resolvedSceneGraph.heroShellSceneEnabled).toBe(false);
    expect(resolvedSceneGraph.heroShellConfiguredCount).toBe(0);
    expect(resolvedSceneGraph.heroShellLayers).toEqual([]);
    expect(resolvedSceneGraph.heroShellMode).toBe("none");
    expect(resolvedSceneGraph.heroResolvedShellMode).toBe("none");
  });

  test("disabled shell windows never report rendered shell underlay after a frame render", () => {
    const frames = Array.from({ length: 24 }, (_, index) => makeFrame(index, 0.84, 0.22, 0.12));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 1 });
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 180,
      dominantBand: "low",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.3, lowMid: 0.2, mid: 0.2, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMaps = [
      makeEdgeMap("shell-off-render-0.png", "glass-orbital"),
      makeEdgeMap("shell-off-render-1.png", "glass-orbital"),
      makeEdgeMap("shell-off-render-2.png", "glass-orbital"),
      makeEdgeMap("shell-off-render-3.png", "glass-orbital"),
      makeEdgeMap("shell-off-render-4.png", "glass-orbital"),
    ];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      edgeMaps,
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const disabledWindowIndex = [0, 1, 2, 3, 4].find((index) => !(renderer as any).shellEnabledWindowIndices.has(index))!;
    renderer.renderFrame({ ...makeFrame(disabledWindowIndex * 12, 0.88, 0.24, 0.1), dominantBand: "low", dominantHz: 180 });

    expect(renderer.getLastHeroShellSceneEnabled()).toBe(false);
    expect(renderer.getLastHeroShellActiveCount()).toBe(0);
    expect(renderer.getLastHeroShellUnderlayActive()).toBe(false);
  });

  test("adaptive hero shell thresholds lower when low-band triggers are absent and rise when they are frequent", () => {
    const visualPlan = [makePhrase(0, 23, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("adaptive-shell.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame({ ...makeFrame(0, 0.18, 0.1, 0.05), dominantBand: "high", dominantHz: 480 });
    expect(renderer.getLastHeroShellThresholdLow()).toBeCloseTo(0.56 * 0.8, 3);
    expect(renderer.getLastHeroShellActiveCount()).toBe(0);

    for (let index = 1; index <= 14; index += 1) {
      renderer.renderFrame({ ...makeFrame(index, 0.82, 1, 0.92), dominantBand: "low", dominantHz: 180 });
    }

    expect(renderer.getLastHeroShellThresholdLow()).toBeGreaterThan(0.56);
    expect(renderer.getLastHeroShellActiveCount()).toBeGreaterThanOrEqual(1);
  });

  test("high-only energy does not trigger low-band shell lanes without low-band support", () => {
    const visualPlan = [makePhrase(0, 23, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 2,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("upper-shell.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const windowState = (renderer as any).heroShellWindowStates.get(0);
    windowState.enabled = true;
    windowState.configuredCount = 3;
    windowState.colorMode = "multi";
    windowState.layers = [
      { spec: { index: 0, band: "low", style: "halo-fill", radiusScale: 1.16, alphaWeight: 1, lineWidthScale: 1, baseThreshold: 0.56, targetTriggerRatio: 0.34 }, recentTriggers: [], recentTriggerCount: 0 },
      { spec: { index: 1, band: "lowMid", style: "shock-ring", radiusScale: 1.78, alphaWeight: 0.78, lineWidthScale: 0.96, baseThreshold: 0.63, targetTriggerRatio: 0.2 }, recentTriggers: [], recentTriggerCount: 0 },
      { spec: { index: 2, band: "lowComposite", style: "rim-halo", radiusScale: 2.18, alphaWeight: 0.56, lineWidthScale: 0.88, baseThreshold: 0.71, targetTriggerRatio: 0.1 }, recentTriggers: [], recentTriggerCount: 0 },
    ];
    const edgeMap = makeEdgeMap("upper-shell.png", "glass-orbital");
    const segment = (renderer as any).segmentForIndex(0);
    const theme = (renderer as any).getTheme(0, segment, edgeMap);
    const compositionPlan = (renderer as any).getCompositionPlan(edgeMap, theme);
    const sceneGraph = (renderer as any).resolveHeroShellSceneForWindow((renderer as any).getSceneGraph(edgeMap, theme, compositionPlan, 0), 0);

    const highOnly = (renderer as any).resolveHeroShellFrameState({ ...makeFrame(0, 0.18, 0.96, 0.92), dominantBand: "high", dominantHz: 4200 }, sceneGraph, 0);
    const lowDriven = (renderer as any).resolveHeroShellFrameState({ ...makeFrame(1, 0.92, 0.16, 0.08), dominantBand: "low", dominantHz: 180 }, sceneGraph, 0);

    expect(highOnly.layers.some((layer: any) => layer.active)).toBe(false);
    expect(lowDriven.layers.find((layer: any) => layer.spec.band === "low")?.active).toBe(true);
  });

  test("hero particle percentile squeeze leaves aoe rings untouched", () => {
    const visualPlan = [makePhrase(0, 12, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 1,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("particles.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const particles = [
      { size: 10, mode: "wake" },
      { size: 12, mode: "wake" },
      { size: 14, mode: "wake" },
      { size: 16, mode: "wake" },
      { size: 18, mode: "wake" },
      { size: 20, mode: "wake" },
      { size: 22, mode: "wake" },
      { size: 24, mode: "wake" },
      { size: 26, mode: "wake" },
      { size: 28, mode: "wake" },
      { size: 30, mode: "aoe-ring" },
    ] as any;

    (renderer as any).squeezeHeroParticleSizeExtremes(particles);

    expect(particles[0].size).toBeCloseTo(10.5, 5);
    expect(particles[9].size).toBeCloseTo(26.6, 5);
    expect(particles[10].size).toBe(30);
  });

  test("satellite offset helper stays smoother for non-glitch seeds than glitchy seeds", () => {
    const visualPlan = [makePhrase(0, 12, "groove")] as any;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 1,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("satellites.png", "glass-orbital")],
      segments,
      { secondsPerImage: 1 },
      visualPlan,
      -10,
      false,
      "test",
    );
    const primary = {
      x: 320,
      y: 180,
      rotation: 0.4,
      size: 120,
    } as any;
    const activeSubject = { vx: 8, vy: 5 } as any;
    const cluster = {
      satellitePathOffsetRadius: 0.38,
      satellitePhaseLock: 0.24,
    } as any;
    const smoothSceneGraph = {
      imagePath: "smooth.png",
      continuitySeed: 17,
      heroInstanceSeed: { travelStyle: { glitchBias: 0.22 } },
      heroMotifProfile: { motionBias: "glide" },
    } as any;
    const glitchSceneGraph = {
      imagePath: "glitch.png",
      continuitySeed: 17,
      heroInstanceSeed: { travelStyle: { glitchBias: 0.74 } },
      heroMotifProfile: { motionBias: "glitch-hop" },
    } as any;

    const smoothA = (renderer as any).resolveSatelliteAnchorOffset(makeFrame(10, 0.5, 0.4, 0.3), activeSubject, primary, smoothSceneGraph, cluster, 420, 220, 1, 0.2);
    const smoothB = (renderer as any).resolveSatelliteAnchorOffset(makeFrame(16, 0.5, 0.4, 0.3), activeSubject, primary, smoothSceneGraph, cluster, 420, 220, 1, 0.2);
    const glitchA = (renderer as any).resolveSatelliteAnchorOffset(makeFrame(10, 0.5, 0.4, 0.3), activeSubject, primary, glitchSceneGraph, cluster, 420, 220, 1, 0.2);
    const glitchB = (renderer as any).resolveSatelliteAnchorOffset(makeFrame(16, 0.5, 0.4, 0.3), activeSubject, primary, glitchSceneGraph, cluster, 420, 220, 1, 0.2);

    const smoothStep = Math.hypot(smoothB.x - smoothA.x, smoothB.y - smoothA.y);
    const glitchStep = Math.hypot(glitchB.x - glitchA.x, glitchB.y - glitchA.y);

    expect(smoothStep).toBeLessThan(glitchStep);
  });

  test("tiny terminal windows reuse the previous node scene as carry", () => {
    const frames = Array.from({ length: 50 }, (_, index) => makeFrame(index, 0.48, 0.62, 0.24));
    const visualPlan = buildVisualPlan({ frames, fps: 12, secondsPerImage: 2 });
    visualPlan[visualPlan.length - 1]!.endSec = 4.1;
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 4.1,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [
        makeEdgeMap("carry-0.png", "glass-orbital"),
        makeEdgeMap("carry-1.png", "harmonic-lattice"),
        makeEdgeMap("carry-2.png", "data-cathedral"),
      ],
      segments,
      { secondsPerImage: 2 },
      visualPlan,
      -10,
      false,
      "test",
    );

    renderer.renderFrame({ ...makeFrame(46, 0.5, 0.6, 0.24), timeSec: 3.85 });
    renderer.renderFrame({ ...makeFrame(49, 0.5, 0.6, 0.24), timeSec: 4.05 });

    expect((renderer as any).tailCarryWindowIndex).toBe(2);
    expect(renderer.getLastRenderSelection().requestedImageIndex).toBe(1);
    expect(renderer.getLastRenderSelection().resolvedImageIndex).toBe(1);
  });

  test("risky carry grammars fall back to snapshot-only and disable morph when outgoing carry is depleted", () => {
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 3,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      [makeEdgeMap("carry-risk-0.png", "glass-orbital"), makeEdgeMap("carry-risk-1.png", "harmonic-lattice")],
      segments,
      { secondsPerImage: 1 },
      [makePhrase(0, 23, "groove")] as any,
      -10,
      false,
      "test",
    );
    const anyRenderer = renderer as any;
    anyRenderer.chooseTransition = () => "ethereal-particle-drift";

    renderer.renderFrame(makeFrame(0, 0.48, 0.62, 0.24));
    anyRenderer.lastParticleVisibleCount = 0;
    anyRenderer.lastHeroParticleRenderedCount = 0;

    expect(() => renderer.renderFrame(makeFrame(13, 0.52, 0.66, 0.3))).not.toThrow();
    expect(anyRenderer.transitionState?.carryProfile.mode).toBe("snapshot-only");
    expect(anyRenderer.transitionState?.carryProfile.allowParticleDrivenFamily).toBe(false);
    expect(anyRenderer.transitionState?.useMorph).toBe(false);
    expect(renderer.getLastTransitionCarryMode()).toBe("snapshot-only");
    expect(renderer.getLastTransitionCarryFallbackReason()).toBe("outgoing-particles-depleted");
  });

  test("non-risky depleted carry keeps the family path active and image switches preserve cached particle states", () => {
    const segments: AudioSegmentFeature[] = [{
      index: 0,
      startSec: 0,
      endSec: 3,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 0,
      paletteWeights: { subLow: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, highMid: 0.1, high: 0.1 },
      motionScale: 1,
      densityScale: 1,
    }];
    const edgeMaps = [makeEdgeMap("carry-safe-0.png", "glass-orbital"), makeEdgeMap("carry-safe-1.png", "harmonic-lattice")];
    const renderer = new FrameRenderer(
      createRenderSettings("480", 12),
      120,
      0,
      false,
      edgeMaps,
      segments,
      { secondsPerImage: 1 },
      [makePhrase(0, 23, "groove")] as any,
      -10,
      false,
      "test",
    );
    const anyRenderer = renderer as any;
    anyRenderer.chooseTransition = () => "halo-drift";

    const firstState = anyRenderer.getParticleState(edgeMaps[0]!.imagePath);
    renderer.renderFrame(makeFrame(0, 0.48, 0.62, 0.24));
    anyRenderer.lastParticleVisibleCount = 0;
    anyRenderer.lastHeroParticleRenderedCount = 0;
    const secondState = anyRenderer.getParticleState(edgeMaps[1]!.imagePath);

    expect(() => renderer.renderFrame(makeFrame(13, 0.52, 0.66, 0.3))).not.toThrow();
    expect(anyRenderer.transitionState?.carryProfile.mode).toBe("snapshot-only");
    expect(anyRenderer.transitionState?.carryProfile.allowParticleDrivenFamily).toBe(true);
    expect(anyRenderer.transitionState?.useMorph).toBe(false);
    expect(anyRenderer.particleStatesByImage.get(edgeMaps[0]!.imagePath)).toBe(firstState);
    expect(anyRenderer.particleStatesByImage.get(edgeMaps[1]!.imagePath)).toBe(secondState);
    expect(anyRenderer.particleStatesByImage.size).toBe(2);
  });
});
