import { describe, expect, test } from "bun:test";
import { buildCompositionPlan } from "./composition-plan";
import { buildSceneGraph } from "./scene-graph";
import { buildTransitionGraph, transitionGraphKey } from "./transition-graph";
import { TRANSITION_FAMILIES, type EdgeMap, type RenderTheme, type TransitionBridgeState } from "../types";

function makeTheme(styleMode: RenderTheme["styleMode"]): RenderTheme {
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
      imagePath: `${styleMode}.png`,
      firstPixelR: 0, firstPixelG: 0, firstPixelB: 0,
      averageR: 80, averageG: 72, averageB: 112,
      medianR: 80, medianG: 72, medianB: 112,
      modeR: 82, modeG: 74, modeB: 116,
      rangeR: 22, rangeG: 32, rangeB: 40,
      averageHue: 205,
      effectSeed: 21,
      effectBucket: 2,
      effectCycle: 1,
      effectMode: 3,
      transitionMode: 8,
      dominantHue: 205,
      hueVariance: 0.32,
      saturationMean: 0.46,
      lightnessMean: 0.34,
      warmCoolBias: 0,
      contrast: 0.3,
      edgeDensity: 0.52,
      symmetry: 0.62,
      clusterCount: 1,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0,
    imageContrast: 0.3,
    rawEffectMode: 3,
    effectiveEffectMode: 3,
    transitionMode: 8,
  };
}

function makeEdgeMap(imagePath: string, fractalMotif: EdgeMap["fractalMotif"]): EdgeMap {
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
    fractalMotif,
    width: 640,
    height: 360,
    complexity: 0.62,
  };
}

describe("transition graph", () => {
  test("builds deterministic graph metadata for a seeded bridge", () => {
    const from = buildSceneGraph(makeEdgeMap("from.png", "glass-orbital"), makeTheme("ring"), buildCompositionPlan(makeEdgeMap("from.png", "glass-orbital"), makeTheme("ring")));
    const to = buildSceneGraph(makeEdgeMap("to.png", "harmonic-lattice"), makeTheme("ring"), buildCompositionPlan(makeEdgeMap("to.png", "harmonic-lattice"), makeTheme("ring")));
    const bridge: TransitionBridgeState = {
      fromImagePath: "from.png",
      toImagePath: "to.png",
      heroFrom: { x: 280, y: 180, radius: 80 },
      heroTo: { x: 360, y: 190, radius: 90 },
      supportFrom: [],
      supportTo: [],
      carryStrength: 0.78,
      protectedZones: [],
    };
    const graph = buildTransitionGraph(from, to, bridge, "halo-drift");
    expect(transitionGraphKey("from.png", "to.png")).toBe("from.png::to.png");
    expect(graph.key).toBe("from.png::to.png");
    expect(graph.heroBridge.length).toBeGreaterThanOrEqual(4);
    expect(graph.carryAttenuation).toBeGreaterThan(0);
    expect(graph.motionGrammar).toBe("halo-drift");
    expect(graph.deterministicParams?.sliceCount).toBeGreaterThanOrEqual(3);
  });

  test("new reflective transition families map to reflective grammars deterministically", () => {
    const from = buildSceneGraph(makeEdgeMap("from.png", "glass-orbital"), makeTheme("ring"), buildCompositionPlan(makeEdgeMap("from.png", "glass-orbital"), makeTheme("ring")));
    const to = buildSceneGraph(makeEdgeMap("to.png", "harmonic-lattice"), makeTheme("ring"), buildCompositionPlan(makeEdgeMap("to.png", "harmonic-lattice"), makeTheme("ring")));
    const bridge: TransitionBridgeState = {
      fromImagePath: "from.png",
      toImagePath: "to.png",
      heroFrom: { x: 280, y: 180, radius: 80 },
      heroTo: { x: 360, y: 190, radius: 90 },
      supportFrom: [],
      supportTo: [],
      carryStrength: 0.78,
      protectedZones: [],
    };
    const newReflectiveFamilies = [
      "quadrant-mirror-sweep",
      "micro-quadrant-reflect",
      "centrifugal-hex-mirror",
      "octant-mirror-zoom",
      "mirror-grid-dissolve",
      "kaleido-iris-zoom",
      "kaleido-tunnel-zoom",
      "snowflake-kaleido-bloom",
      "infinite-reflection-zoom",
      "facet-zoom-reveal",
      "tri-prism-fold",
      "hex-prism-cascade",
      "refractive-prism-spin",
      "prismatic-radial-wipe",
      "refractive-shard-tumble",
      "mirror-interlock-weave",
      "corridor-reflection-transit",
      "bilateral-flip-drift",
      "synchronized-mirror-slice",
      "glass-shatter-reflect",
      "diamond-concentric-fold",
      "vortex-mirror-spiral",
      "geometric-fractal-flip",
      "symmetry-spin-reveal",
      "crystal-facet-reveal",
    ] as const satisfies readonly (typeof TRANSITION_FAMILIES[number])[];
    for (const family of newReflectiveFamilies) {
      const graph = buildTransitionGraph(from, to, bridge, family);
      expect(graph.motionGrammar).toBeDefined();
      expect(["mirror-kaleido", "split-mirror", "prism-fold", "shear-kaleido", "mirror-tunnel"].includes(graph.motionGrammar!)).toBe(true);
      expect(graph.deterministicParams?.mirrorCount).toBeGreaterThanOrEqual(2);
    }
  });
});
