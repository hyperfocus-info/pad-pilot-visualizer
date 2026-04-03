import { describe, expect, test } from "bun:test";
import type { AudioFrameFeature, EdgeMap, SceneGraph, VisualState } from "../types";
import { createActiveSubjectState, updateActiveSubject } from "./active-subject";

function makeEdgeMap(): EdgeMap {
  return {
    imagePath: "test.png",
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
    focalCenterX: 640,
    focalCenterY: 360,
    focalSpread: 0.3,
    leftWeight: 0.25,
    rightWeight: 0.25,
    topWeight: 0.25,
    bottomWeight: 0.25,
    subjectBounds: { minX: 240, minY: 160, maxX: 1040, maxY: 560 },
    negativeSpaceQuadrant: "tr",
    fractalMotif: "glass-orbital",
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
    normalizedSubLow: 0.1,
    normalizedLow: 0.2,
    normalizedLowMid: 0.15,
    normalizedMid: 0.2,
    normalizedHighMid: 0.18,
    normalizedHigh: 0.15,
    motionEnergy: 0.2,
    isPeak: false,
    peakStrength: 0.12,
    segmentIndex: 0,
    dominantHz: 320,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.2,
    subBeatPhase: 0.2,
    barPhase: 0.2,
    beatPulse: 0.15,
    subBeatPulse: 0.1,
    onsetStrength: 0.1,
    motionEnvelope: 0.15,
    dbLow: -8,
    dbLowMid: -8,
    dbMid: -8,
    dbHighMid: -8,
    dbHigh: -8,
    dbOverall: -8,
    dbNormalized: 0.35,
    pulseRaw: 0.2,
    pulseEnvelope: 0.2,
    pulseAccent: 0.1,
    narrativeIntensity: 0.3,
    pulseScale: 1,
    beatIndex: 0,
    barIndex: 0,
    phrase4Index: 0,
    isBeatAccent: false,
    isBarDownbeat: false,
    isFourBarDownbeat: false,
    barPulse: 0.15,
    phrasePulse: 0.1,
    ...overrides,
  };
}

function makeSceneGraph(overrides: Partial<SceneGraph["heroInstanceSeed"]["travelStyle"]> = {}, motionBias: SceneGraph["heroMotifProfile"]["motionBias"] = "glitch-hop"): SceneGraph {
  return {
    heroInstanceSeed: {
      travelStyle: {
        gracefulBias: 0.2,
        glitchBias: 0.8,
        pathSmoothing: 0.2,
        targetSmoothing: 0.18,
        warpProbability: 0.6,
        deformJitter: 0.3,
        landingIntent: 0.4,
        warpXBand: "low",
        warpYBand: "high",
        warpXBaseMultiplier: 1.3,
        warpYBaseMultiplier: 1.35,
        warpXExtremeMultiplier: 2.6,
        warpYExtremeMultiplier: 2.8,
        lowDbMoveScale: 0.4,
        lowDbEmissionScale: 0.4,
        lowDbFreezeOnDrop: true,
        lowDbDropThreshold: 0.35,
        ...overrides,
      },
    },
    heroMotifProfile: {
      motionBias,
    },
    heroPath: [
      { x: 640, y: 360, tangentX: 1, tangentY: 0, radius: 120 },
      { x: 700, y: 360, tangentX: 1, tangentY: 0, radius: 120 },
    ],
  } as unknown as SceneGraph;
}

const visualState: VisualState = {
  frameIndex: 0,
  phraseIndex: 0,
  phraseStartFrame: 0,
  phraseEndFrame: 24,
  phraseStartSec: 0,
  phraseEndSec: 2,
  regime: "groove",
  densityCap: 1,
  motionMode: "pulse",
  overlayMode: "stable-feedback",
  shotMode: "detail",
  effectPolicy: "balanced",
  rescuePolicy: "lift",
  imageHoldMultiplier: 1,
  imageSwapAllowed: true,
  transitionFamily: "carry",
  preferredCutFrame: 0,
  transitionDurationMultiplier: 1,
  transitionOpportunityBias: 1,
  transientCutBias: 0,
  rapidPeakDensity: 0,
  transitionTriggerPreference: "swap",
  spawnArc: "swap",
  spawnEnergyTier: "mid",
  transitionCarryBias: 0.4,
  effectiveImageHoldMultiplier: 1,
  brightnessFloor: 0.12,
};

describe("active subject trail gating", () => {
  test("does not append a trail point when motion stays at or below 5px", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    const frame = makeFrame();

    updateActiveSubject({
      state,
      frame,
      edgeMap,
      visualState,
      imageProgress: 0.2,
    });

    expect(state.trail).toHaveLength(0);
  });

  test("appends trail points and doubles persistence when motion exceeds threshold", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    state.x = 0;
    state.y = 0;
    const frame = makeFrame({ frameIndex: 1, peakStrength: 0.85, beatPulse: 0.8, dominantBand: "high", normalizedHigh: 0.8 });

    updateActiveSubject({
      state,
      frame,
      edgeMap,
      visualState: { ...visualState, regime: "drop" },
      imageProgress: 0.4,
    });

    expect(state.trail.length).toBe(1);
    expect(state.trail[0]?.x).toBeCloseTo(state.x, 5);
  });

  test("uses motif-authored warp bands and throttles motion below track average", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    const sceneGraph = makeSceneGraph({
      warpXBand: "subLow",
      warpYBand: "highMid",
      warpXBaseMultiplier: 1.35,
      warpYBaseMultiplier: 1.2,
      warpXExtremeMultiplier: 2.4,
      warpYExtremeMultiplier: 2,
    });

    const snapshot = updateActiveSubject({
      state,
      frame: makeFrame({
        frameIndex: 3,
        timeSec: 0.25,
        isPeak: true,
        isBarDownbeat: true,
        dbLow: -6,
        dbHighMid: -4,
        dbOverall: -14,
      }),
      edgeMap,
      sceneGraph,
      visualState: { ...visualState, regime: "drop" },
      imageProgress: 0.35,
      trackAverageDbOverall: -10,
      rollingDbWindow: {
        dbLow: [-18, -14, -10, -6],
        dbLowMid: [-16, -13, -10, -9],
        dbMid: [-15, -12, -10, -8],
        dbHighMid: [-15, -11, -8, -4],
        dbHigh: [-14, -10, -8, -6],
        maxFrames: 6,
      },
    });

    expect(snapshot.moveScale).toBeCloseTo(0.4, 4);
    expect(snapshot.emissionScale).toBeCloseTo(0.4, 4);
    expect(state.targetX).not.toBeCloseTo(state.targetY, 2);
  });

  test("freezes translation when below average and dB is falling", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    state.recentDbOverall = [-8, -8.2, -8.1, -8.3, -8.2, -8.1];
    const sceneGraph = makeSceneGraph();

    const beforeX = state.x;
    const beforeY = state.y;
    const snapshot = updateActiveSubject({
      state,
      frame: makeFrame({
        frameIndex: 4,
        timeSec: 0.33,
        isPeak: true,
        isBarDownbeat: true,
        dbOverall: -9,
      }),
      edgeMap,
      sceneGraph,
      visualState: { ...visualState, regime: "drop" },
      imageProgress: 0.4,
      trackAverageDbOverall: -8,
      rollingDbWindow: {
        dbLow: [-12, -11, -10, -9],
        dbLowMid: [-11, -10, -9, -8],
        dbMid: [-10, -9, -8, -7],
        dbHighMid: [-9, -8, -7, -6],
        dbHigh: [-8, -7, -6, -5],
        maxFrames: 6,
      },
    });

    expect(snapshot.lowDbFreezeActive).toBe(true);
    expect(state.x).toBe(beforeX);
    expect(state.y).toBe(beforeY);
    expect(state.vx).toBe(0);
    expect(state.vy).toBe(0);
  });

  test("suppresses decorative micro-jitter for readable glide tiers", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    const sceneGraph = makeSceneGraph({
      gracefulBias: 0.62,
      glitchBias: 0.38,
      targetSmoothing: 0.22,
    }, "tightrope");

    const snapshot = updateActiveSubject({
      state,
      frame: makeFrame({
        frameIndex: 6,
        timeSec: 0.5,
        beatPulse: 0.08,
        onsetStrength: 0.04,
        peakStrength: 0.05,
        motionEnvelope: 0.08,
      }),
      edgeMap,
      sceneGraph,
      visualState,
      imageProgress: 0.32,
    });

    expect(snapshot.motionTier).toBe("glide");
    expect(snapshot.jitterSuppressed).toBe(true);
    expect(snapshot.motionTierReadable).toBe(true);
  });

  test("high-grace travel keeps flourish readable without collapsing into jitter", () => {
    const edgeMap = makeEdgeMap();
    const state = createActiveSubjectState(edgeMap);
    const sceneGraph = makeSceneGraph({
      gracefulBias: 0.9,
      glitchBias: 0.1,
      pathSmoothing: 0.28,
      targetSmoothing: 0.26,
    }, "tightrope");

    const snapshot = updateActiveSubject({
      state,
      frame: makeFrame({
        frameIndex: 10,
        timeSec: 0.82,
        beatPulse: 0.62,
        phrasePulse: 0.48,
        onsetStrength: 0.22,
        peakStrength: 0.24,
      }),
      edgeMap,
      sceneGraph,
      visualState,
      imageProgress: 0.56,
    });

    expect(snapshot.motionTier).toBe("flourish");
    expect(snapshot.flourishStrength).toBeGreaterThan(0.5);
    expect(snapshot.motionTierReadable).toBe(true);
    expect(snapshot.jitterSuppressed).toBe(false);
  });
});
