import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import type { AudioFrameFeature, EdgeMap, ParticleBehaviorParams, ParticleMotionMode, RenderTheme } from "../types";
import { buildCompositionPlan } from "./composition-plan";
import { getParticleSystemState, renderEdgeParticles } from "./particle-engine";
import { buildSceneGraph } from "./scene-graph";
import { ShapeStampAtlas } from "./stamp-atlas";

const MOTION_MODE_INDEX: Record<ParticleMotionMode, number> = {
  "edge-drift": 0,
  "spiral-in": 1,
  "spiral-out": 2,
  "orbit-hero": 3,
  "dual-attractor": 4,
  "edge-escape": 5,
  "absorb-well": 6,
  "emit-chain": 7,
  "release-bloom": 8,
  "flock-curl": 9,
  "flow-advect": 10,
  "plexus-link": 11,
  "gravity-orrery": 12,
  "ribbon-trace": 13,
  "lifecycle-morph": 14,
  "shell-bounce": 15,
  "voxel-depth": 16,
  "paint-residue": 17,
  "lightning-latch": 18,
  "mirror-orbit": 19,
  "axis-reflect": 20,
  "kaleido-shear": 21,
  "paired-braid": 22,
  "prism-well": 23,
};

function makeTheme(styleMode: RenderTheme["styleMode"], imagePath: string): RenderTheme {
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
      averageR: 80, averageG: 90, averageB: 100,
      medianR: 80, medianG: 90, medianB: 100,
      modeR: 80, modeG: 90, modeB: 100,
      rangeR: 40, rangeG: 40, rangeB: 40,
      averageHue: 180,
      effectSeed: 13,
      effectBucket: 4,
      effectCycle: 1,
      effectMode: 5,
      transitionMode: 3,
      dominantHue: 180,
      hueVariance: 0.22,
      saturationMean: 0.44,
      lightnessMean: 0.46,
      warmCoolBias: 0.02,
      contrast: 0.26,
      edgeDensity: 0.38,
      symmetry: 0.54,
      clusterCount: 2,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0.02,
    imageContrast: 0.26,
    rawEffectMode: 5,
    effectiveEffectMode: 5,
    transitionMode: 3,
  };
}

function makeEdgeMap(fractalMotif: EdgeMap["fractalMotif"], imagePath: string): EdgeMap {
  return {
    imagePath,
    points: [],
    contours: [],
    flowField: { gridWidth: 4, gridHeight: 4, cellWidth: 480, cellHeight: 270, vectors: new Float32Array(4 * 4 * 2).fill(0.2), weights: new Float32Array(16).fill(1) },
    densityField: { gridWidth: 4, gridHeight: 4, cellWidth: 480, cellHeight: 270, values: new Float32Array(16).fill(0.5) },
    toneField: { gridWidth: 4, gridHeight: 4, cellWidth: 480, cellHeight: 270, luminance: new Float32Array(16).fill(0.4), contrast: new Float32Array(16).fill(0.5) },
    subjectMask: { gridWidth: 4, gridHeight: 4, cellWidth: 480, cellHeight: 270, values: new Float32Array(16).fill(0.5) },
    silhouetteContours: [],
    spawners: [],
    regionAnchors: [],
    spatialBins: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, pointBins: [[]], spawnerBins: [[]] },
    focalCenterX: 960,
    focalCenterY: 540,
    focalSpread: 0.25,
    leftWeight: 0.5,
    rightWeight: 0.5,
    topWeight: 0.5,
    bottomWeight: 0.5,
    subjectBounds: { minX: 760, minY: 340, maxX: 1160, maxY: 740 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    fractalMotif,
    width: 1920,
    height: 1080,
    complexity: 0.6,
  };
}

function makeFrame(overrides: Partial<AudioFrameFeature> = {}): AudioFrameFeature {
  return {
    frameIndex: 2,
    timeSec: 0.25,
    subLowEnergy: 0,
    lowEnergy: 0,
    lowMidEnergy: 0,
    midEnergy: 0,
    highMidEnergy: 0,
    highEnergy: 0,
    normalizedSubLow: 0.22,
    normalizedLow: 0.48,
    normalizedLowMid: 0.42,
    normalizedMid: 0.52,
    normalizedHighMid: 0.46,
    normalizedHigh: 0.4,
    motionEnergy: 0.64,
    isPeak: false,
    peakStrength: 0.54,
    segmentIndex: 0,
    dominantHz: 220,
    dominantBand: "mid",
    rainbowHueOffset: 0,
    beatPhase: 0.02,
    subBeatPhase: 0.06,
    barPhase: 0.08,
    beatPulse: 0.82,
    subBeatPulse: 0.5,
    onsetStrength: 0.48,
    motionEnvelope: 0.64,
    dbLow: -20,
    dbLowMid: -16,
    dbMid: -13,
    dbHighMid: -11,
    dbHigh: -9,
    dbOverall: -14,
    dbNormalized: 0.68,
    pulseRaw: 1.1,
    pulseEnvelope: 0.9,
    pulseAccent: 0.82,
    narrativeIntensity: 0.64,
    pulseScale: 1.35,
    beatIndex: 2,
    barIndex: 1,
    phrase4Index: 0,
    isBeatAccent: true,
    isBarDownbeat: false,
    isFourBarDownbeat: false,
    barPulse: 0.54,
    phrasePulse: 0.48,
    ...overrides,
  };
}

function behaviorForMode(mode: ParticleMotionMode): ParticleBehaviorParams {
  return {
    mode,
    shape: mode === "voxel-depth" ? "voxel" : mode === "gravity-orrery" || mode === "shell-bounce" ? "ring" : mode === "plexus-link" || mode === "lightning-latch" ? "chevron" : mode === "lifecycle-morph" ? "diamond" : mode === "ribbon-trace" || mode === "flow-advect" ? "arc" : "dot",
    targetA: 0,
    targetB: 1,
    orbitScale: 0.72,
    driftScale: 0.58,
    script: mode === "gravity-orrery" ? "dual-well" : mode === "flow-advect" ? "signal-drift" : mode === "shell-bounce" ? "burst-falloff" : mode === "plexus-link" ? "braid-lane" : mode === "lightning-latch" ? "emit-chain" : mode === "ribbon-trace" ? "emit-chain" : mode === "paint-residue" ? "edge-fog" : "follow-hero",
    purpose: "hero-wake",
    layer: "hero",
    behaviorTuning: {
      neighborRadius: 64,
      cohesion: 0.08,
      alignment: 0.1,
      separation: 0.12,
      linkRadius: 80,
      gravityStrength: 0.2,
      bounceDamping: 0.78,
      depthScale: 0.72,
      residueAlpha: 0.12,
      morphProfile: mode === "lifecycle-morph" ? "shard-to-teardrop" : undefined,
    },
  };
}

function buildHarness(mode: ParticleMotionMode) {
  const imagePath = `${mode}.png`;
  const theme = makeTheme("cellular", imagePath);
  const edgeMap = makeEdgeMap("halo-cell", imagePath);
  const compositionPlan = buildCompositionPlan(edgeMap, theme);
  const sceneGraph = buildSceneGraph(edgeMap, theme, compositionPlan);
  sceneGraph.particleBehaviors = [behaviorForMode(mode), behaviorForMode(mode), behaviorForMode(mode), behaviorForMode(mode)];
  const state = getParticleSystemState();
  state.seed = 1234;
  state.count = 4;
  for (let index = 0; index < state.count; index += 1) {
    state.x[index] = 220 + index * 28;
    state.y[index] = 220 + (index % 2) * 24;
    state.vx[index] = 0.4 + index * 0.1;
    state.vy[index] = 0.2 - index * 0.05;
    state.age[index] = index * 6;
    state.ttl[index] = 120;
    state.baseSize[index] = 8;
    state.currentSize[index] = 8;
    state.anchorType[index] = 1;
    state.targetX[index] = 240 + index * 20;
    state.targetY[index] = 240 + index * 14;
    state.tangentX[index] = 1;
    state.tangentY[index] = 0;
    state.edgeWeight[index] = 0.4;
    state.toneWeight[index] = 0.9;
    state.curvatureWeight[index] = 0.22;
    state.brightness[index] = 0.66;
    state.hueOffset[index] = 0.2;
    state.motionMode[index] = MOTION_MODE_INDEX[mode];
    state.shapeMode[index] = mode === "voxel-depth" ? 6 : 0;
    state.phaseOffset[index] = index * 0.2;
    state.behaviorTargetA[index] = 0;
    state.behaviorTargetB[index] = 1;
    state.orbitScale[index] = 0.72;
    state.driftScale[index] = 0.58;
    state.neighborRadius[index] = 64;
    state.cohesion[index] = 0.08;
    state.alignment[index] = 0.1;
    state.separation[index] = 0.12;
    state.linkRadius[index] = 80;
    state.gravityStrength[index] = 0.2;
    state.bounceDamping[index] = 0.78;
    state.depthScale[index] = 0.72;
    state.residueAlpha[index] = 0.12;
  }
  return { theme, edgeMap, compositionPlan, sceneGraph, state };
}

describe("particle engine new motion modes", () => {
  test("all new motion modes remain deterministic and bounded", () => {
    const modes: ParticleMotionMode[] = ["flock-curl", "flow-advect", "plexus-link", "gravity-orrery", "ribbon-trace", "lifecycle-morph", "shell-bounce", "voxel-depth", "paint-residue", "lightning-latch"];
    for (const mode of modes) {
      const run = () => {
        const { theme, edgeMap, compositionPlan, sceneGraph, state } = buildHarness(mode);
        const canvas = createCanvas(edgeMap.width, edgeMap.height);
        const ctx = canvas.getContext("2d")!;
        const result = renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
          compositionPlan,
          edgeMap,
          frame: makeFrame(),
          theme,
          sceneGraph,
          stampAtlas: new ShapeStampAtlas(),
          width: edgeMap.width,
          height: edgeMap.height,
          state,
        });
        return { result, state };
      };
      const a = run();
      const b = run();
      for (let index = 0; index < a.state.count; index += 1) {
        expect(Number.isFinite(a.state.x[index]!)).toBe(true);
        expect(Number.isFinite(a.state.y[index]!)).toBe(true);
        expect(Number.isFinite(a.state.vx[index]!)).toBe(true);
        expect(Number.isFinite(a.state.vy[index]!)).toBe(true);
        expect(a.state.x[index]).toBeCloseTo(b.state.x[index]!, 5);
        expect(a.state.y[index]).toBeCloseTo(b.state.y[index]!, 5);
        expect(a.state.currentSize[index]).toBeGreaterThan(0.5);
      }
      expect(a.result.particleLifecycle.particleRenderedCount).toBeGreaterThan(0);
    }
  });

  test("shell bounce reflects velocity near bounds", () => {
    const harness = buildHarness("shell-bounce");
    harness.state.x[0] = 1;
    harness.state.vx[0] = -2;
    const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
    const ctx = canvas.getContext("2d")!;
    renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
      compositionPlan: harness.compositionPlan,
      edgeMap: harness.edgeMap,
      frame: makeFrame(),
      theme: harness.theme,
      sceneGraph: harness.sceneGraph,
      stampAtlas: new ShapeStampAtlas(),
      width: harness.edgeMap.width,
      height: harness.edgeMap.height,
      state: harness.state,
    });
    expect(harness.state.vx[0]).toBeGreaterThanOrEqual(0);
  });

  test("canvas-edge contact enters deterministic destruction exit without using source contours", () => {
    const harness = buildHarness("paint-residue");
    harness.state.count = 1;
    harness.state.x[0] = -4;
    harness.state.y[0] = harness.edgeMap.height * 0.5;
    harness.state.vx[0] = -2.4;
    harness.state.vy[0] = 0.1;
    harness.edgeMap.contours = [{
      points: [{ x: 900, y: 500, nx: 0, ny: -1, curvature: 0.2 }, { x: 980, y: 580, nx: 0, ny: -1, curvature: 0.2 }],
      closed: false,
      strength: 0.9,
      length: 120,
    }];
    const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
    const ctx = canvas.getContext("2d")!;
    const result = renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
      compositionPlan: harness.compositionPlan,
      edgeMap: harness.edgeMap,
      frame: makeFrame(),
      theme: harness.theme,
      sceneGraph: harness.sceneGraph,
      stampAtlas: new ShapeStampAtlas(),
      width: harness.edgeMap.width,
      height: harness.edgeMap.height,
      state: harness.state,
    });
    expect(result.particleLifecycle.edgeDeathEligibleCount).toBeGreaterThanOrEqual(1);
    expect(result.particleLifecycle.edgeDeathTriggeredCount).toBeGreaterThanOrEqual(1);
    expect(harness.state.edgeExitFramesRemaining[0]).toBeGreaterThan(0);
    expect(harness.state.edgeExitTargetX[0]).toBeLessThan(0);
    expect(result.particleLifecycle.edgeDeathEffectId).toContain("-");
  });

  test("voxel depth increases pulse scale and retains visible particles", () => {
    const harness = buildHarness("voxel-depth");
    const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
    const ctx = canvas.getContext("2d")!;
    const result = renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
      compositionPlan: harness.compositionPlan,
      edgeMap: harness.edgeMap,
      frame: makeFrame(),
      theme: harness.theme,
      sceneGraph: harness.sceneGraph,
      stampAtlas: new ShapeStampAtlas(),
      width: harness.edgeMap.width,
      height: harness.edgeMap.height,
      state: harness.state,
    });
    expect(harness.state.scratchPulseScale[0]).toBeGreaterThan(1);
    expect(result.particleLifecycle.particleVisibleCount).toBeGreaterThan(0);
  });

  test("plexus and latch modes stay within bounded link-friendly render counts", () => {
    for (const mode of ["plexus-link", "lightning-latch"] as const) {
      const harness = buildHarness(mode);
      const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
      const ctx = canvas.getContext("2d")!;
      const result = renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
        compositionPlan: harness.compositionPlan,
        edgeMap: harness.edgeMap,
        frame: makeFrame(),
        theme: harness.theme,
        sceneGraph: harness.sceneGraph,
        stampAtlas: new ShapeStampAtlas(),
        width: harness.edgeMap.width,
        height: harness.edgeMap.height,
        state: harness.state,
      });
      expect(result.particleLifecycle.particleRenderedCount).toBeLessThanOrEqual(harness.state.count);
      expect(result.stageMetrics.vectorDrawCount + result.stageMetrics.stampDrawCount).toBeGreaterThan(0);
    }
  });

  test("lifecycle morph advances visible stage over age", () => {
    const harness = buildHarness("lifecycle-morph");
    harness.state.age[0] = 4;
    harness.state.age[1] = 40;
    harness.state.age[2] = 90;
    const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
    const ctx = canvas.getContext("2d")!;
    renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
      compositionPlan: harness.compositionPlan,
      edgeMap: harness.edgeMap,
      frame: makeFrame(),
      theme: harness.theme,
      sceneGraph: harness.sceneGraph,
      stampAtlas: new ShapeStampAtlas(),
      width: harness.edgeMap.width,
      height: harness.edgeMap.height,
      state: harness.state,
    });
    expect(harness.state.currentSize[0]).not.toBe(harness.state.currentSize[2]);
  });

  test("single-hero scenes double sub-emitter trigger and child counts", () => {
    const single = buildHarness("lightning-latch");
    const multi = buildHarness("lightning-latch");
    single.sceneGraph.heroClusterConfig.count = 1;
    multi.sceneGraph.heroClusterConfig.count = 2;
    for (const scene of [single, multi]) {
      scene.state.toneWeight.fill(1);
      scene.state.edgeWeight.fill(1);
      scene.state.brightness.fill(0.8);
    }
    const render = (harness: ReturnType<typeof buildHarness>) => {
      const canvas = createCanvas(harness.edgeMap.width, harness.edgeMap.height);
      const ctx = canvas.getContext("2d")!;
      return renderEdgeParticles(ctx as unknown as CanvasRenderingContext2D, {
        compositionPlan: harness.compositionPlan,
        edgeMap: harness.edgeMap,
        frame: makeFrame({ isBeatAccent: true, barPulse: 0.7, phrasePulse: 0.8 }),
        theme: harness.theme,
        sceneGraph: harness.sceneGraph,
        stampAtlas: new ShapeStampAtlas(),
        width: harness.edgeMap.width,
        height: harness.edgeMap.height,
        state: harness.state,
      });
    };

    const singleResult = render(single);
    const multiResult = render(multi);

    expect(singleResult.particleLifecycle.subEmitterTriggerCount).toBeGreaterThanOrEqual(multiResult.particleLifecycle.subEmitterTriggerCount * 2);
    expect(singleResult.subEmitterChildren).toBeGreaterThanOrEqual(multiResult.subEmitterChildren * 2);
  });
});
