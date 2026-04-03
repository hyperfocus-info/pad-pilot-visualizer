import { describe, expect, test } from "bun:test";
import type { EdgeMap, RenderTheme } from "../types";
import { buildCompositionPlan } from "./composition-plan";
import { buildSceneGraph, HERO_CONDUCTOR_SPECS } from "./scene-graph";

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
      averageR: 90, averageG: 100, averageB: 110,
      medianR: 90, medianG: 100, medianB: 110,
      modeR: 90, modeG: 100, modeB: 110,
      rangeR: 60, rangeG: 60, rangeB: 60,
      averageHue: 180,
      effectSeed: 21,
      effectBucket: 6,
      effectCycle: 1,
      effectMode: 4,
      transitionMode: 3,
      dominantHue: 180,
      hueVariance: 0.22,
      saturationMean: 0.46,
      lightnessMean: 0.44,
      warmCoolBias: 0.04,
      contrast: 0.3,
      edgeDensity: 0.42,
      symmetry: 0.58,
      clusterCount: 2,
      palette: [],
      shapeBias: styleMode,
      particleBias: "mixed",
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0.04,
    imageContrast: 0.3,
    rawEffectMode: 4,
    effectiveEffectMode: 4,
    transitionMode: 3,
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
    focalSpread: 0.24,
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
    complexity: 0.62,
  };
}

function primarySelectionsForMotif(motif: EdgeMap["fractalMotif"], styles: RenderTheme["styleMode"][]): string[] {
  const ids: string[] = [];
  for (let index = 0; index < styles.length; index += 1) {
    const imagePath = `${motif}-${styles[index]}-${index}.png`;
    const theme = makeTheme(styles[index]!, imagePath);
    const edgeMap = makeEdgeMap(motif, imagePath);
    const compositionPlan = buildCompositionPlan(edgeMap, theme);
    ids.push(buildSceneGraph(edgeMap, theme, compositionPlan).heroConductorSelection.primary);
  }
  return ids;
}

describe("scene graph conductors", () => {
  test("content-derived continuity seeds stay stable and diversify across image identities", () => {
    const scenarios = [
      { motif: "glass-orbital" as const, style: "ring" as const, imagePath: "alpha-001.png" },
      { motif: "glass-orbital" as const, style: "ring" as const, imagePath: "alpha-002.png" },
      { motif: "harmonic-lattice" as const, style: "filament" as const, imagePath: "beta-001.png" },
      { motif: "data-cathedral" as const, style: "shard" as const, imagePath: "gamma-001.png" },
      { motif: "smoke-ribbon" as const, style: "cloud" as const, imagePath: "delta-001.png" },
      { motif: "mandelbloom" as const, style: "cellular" as const, imagePath: "epsilon-001.png" },
    ];
    const continuitySeeds = scenarios.map(({ motif, style, imagePath }) => {
      const theme = makeTheme(style, imagePath);
      const edgeMap = makeEdgeMap(motif, imagePath);
      const compositionPlan = buildCompositionPlan(edgeMap, theme);
      return buildSceneGraph(edgeMap, theme, compositionPlan).continuitySeed;
    });
    const repeatedTheme = makeTheme("ring", "alpha-001.png");
    const repeatedEdgeMap = makeEdgeMap("glass-orbital", "alpha-001.png");
    const repeatedPlan = buildCompositionPlan(repeatedEdgeMap, repeatedTheme);
    const repeatedSeed = buildSceneGraph(repeatedEdgeMap, repeatedTheme, repeatedPlan).continuitySeed;
    expect(new Set(continuitySeeds).size).toBe(continuitySeeds.length);
    expect(repeatedSeed).toBe(continuitySeeds[0]);
  });

  test("new conductor specs expose four preferred motifs and positive weighting", () => {
    const swarm = HERO_CONDUCTOR_SPECS.find((entry) => entry.id === "swarm-choirmaster")!;
    const latch = HERO_CONDUCTOR_SPECS.find((entry) => entry.id === "latch-archivist")!;
    expect(swarm.preferredMotifs).toHaveLength(4);
    expect(latch.preferredMotifs).toHaveLength(4);
    expect(swarm.selectionWeight).toBeGreaterThan(1);
    expect(latch.selectionWeight).toBeGreaterThan(1);
  });

  test("preferred motifs can reach swarm choirmaster across deterministic seeds", () => {
    const seen = new Set([
      ...primarySelectionsForMotif("halo-cell", ["cellular", "cloud", "ring", "filament"]),
      ...primarySelectionsForMotif("mandelbloom", ["ring", "cellular", "shard", "cloud"]),
      ...primarySelectionsForMotif("smoke-ribbon", ["cloud", "filament", "ring", "cellular"]),
      ...primarySelectionsForMotif("glass-orbital", ["ring", "filament", "cloud", "cellular"]),
    ]);
    expect(seen.has("swarm-choirmaster")).toBe(true);
  });

  test("preferred motifs can reach latch archivist across deterministic seeds", () => {
    const seen = new Set([
      ...primarySelectionsForMotif("data-cathedral", ["filament", "ring", "shard", "cellular"]),
      ...primarySelectionsForMotif("harmonic-lattice", ["filament", "shard", "ring", "cellular"]),
      ...primarySelectionsForMotif("vector-incantation", ["shard", "filament", "ring", "cellular"]),
      ...primarySelectionsForMotif("shattered-arc", ["shard", "filament", "ring", "cellular"]),
    ]);
    expect(seen.has("latch-archivist")).toBe(true);
  });

  test("multi-hero relationship modes are not collapsed into a single deterministic bucket", () => {
    const scenarios = [
      { motif: "glass-orbital" as const, style: "ring" as const, imagePath: "rel-a-001.png" },
      { motif: "glass-orbital" as const, style: "filament" as const, imagePath: "rel-a-002.png" },
      { motif: "harmonic-lattice" as const, style: "ring" as const, imagePath: "rel-b-001.png" },
      { motif: "harmonic-lattice" as const, style: "shard" as const, imagePath: "rel-b-002.png" },
      { motif: "data-cathedral" as const, style: "filament" as const, imagePath: "rel-c-001.png" },
      { motif: "data-cathedral" as const, style: "cellular" as const, imagePath: "rel-c-002.png" },
    ];
    const relationshipModes = new Set<string>();
    for (const scenario of scenarios) {
      const theme = makeTheme(scenario.style, scenario.imagePath);
      const edgeMap = makeEdgeMap(scenario.motif, scenario.imagePath);
      const compositionPlan = buildCompositionPlan(edgeMap, theme);
      const graph = buildSceneGraph(edgeMap, theme, compositionPlan);
      if (graph.heroClusterConfig.count > 1) {
        relationshipModes.add(graph.heroClusterConfig.relationshipMode);
      }
    }
    expect(relationshipModes.size).toBeGreaterThan(1);
  });

  test("hero-revolve conductors are nearest-hero anchored and explicitly tagged", () => {
    const revolveSpecs = ["vigil-ring", "transit-orrery", "braid-procession"].map((id) =>
      HERO_CONDUCTOR_SPECS.find((entry) => entry.id === id)!,
    );
    expect(revolveSpecs.map((entry) => entry.motionFamily)).toEqual([
      "perfect-circle",
      "orbit-through",
      "spiral-braid",
    ]);
    for (const spec of revolveSpecs) {
      expect(spec.anchorMode).toBe("nearest-hero");
      expect(spec.selectionTags).toContain("reflective");
      expect(spec.selectionTags).toContain("hero-revolve");
      expect(spec.radiusVariance).toBeGreaterThan(0);
      expect(spec.strengthVariance).toBeGreaterThan(0);
      expect(spec.swirlVariance).toBeGreaterThan(0);
      expect(spec.pulseVariance).toBeGreaterThan(0);
      expect(spec.lifespanModRange?.min).toBeLessThan(spec.lifespanModRange?.max ?? 0);
    }
  });
});
