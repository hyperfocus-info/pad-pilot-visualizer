import { describe, expect, test } from "bun:test";
import { buildCompositionPlan, buildCompositionPlanForTheme, compositionNegativeSpaceOccupancy, summarizeCompositionPlan } from "./composition-plan";
import type { EdgeMap, RenderTheme } from "../types";

function makeTheme(styleMode: RenderTheme["styleMode"]): RenderTheme {
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
    },
    styleMode,
    particleMode: "mixed",
    basePalette: [],
    basePaletteHsl: [],
    imageWarmCoolBias: 0,
    imageContrast: 0.2,
    rawEffectMode: 0,
    effectiveEffectMode: 0,
    transitionMode: 0,
  };
}

function makeEdgeMap(): EdgeMap {
  return {
    imagePath: "fixture.png",
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
    fractalMotif: "halo-cell",
    width: 1920,
    height: 1080,
    complexity: 0.42,
  };
}

describe("composition plan fallbacks", () => {
  test("sparse inputs still get support and background structure outside protected zones", () => {
    const plan = buildCompositionPlan(makeEdgeMap(), makeTheme("cellular"));
    const summary = summarizeCompositionPlan(plan);

    expect(summary.supportSlotCount).toBeGreaterThanOrEqual(2);
    expect(summary.backgroundSlotCount).toBeGreaterThanOrEqual(2);
    expect(
      compositionNegativeSpaceOccupancy(
        plan,
        [
          ...plan.supportSlots.map((slot) => ({ x: slot.x, y: slot.y, layer: slot.layer })),
          ...plan.backgroundSlots.map((slot) => ({ x: slot.x, y: slot.y, layer: slot.layer })),
        ],
      ),
    ).toBe(0);
  });

  test("prefers stronger focal occupancy and reduced center bias for sparse center-negative-space inputs", () => {
    const plan = buildCompositionPlan(makeEdgeMap(), makeTheme("cellular"));

    expect(plan.focalOccupancyScore).toBeGreaterThan(0.02);
    expect(plan.centerBiasScore).toBeLessThan(0.9);
    expect(plan.shotGrammarKey.length).toBeGreaterThan(0);
  });

  test("uses the newer spatial grammar buckets and keeps the hero off dead center", () => {
    const plan = buildCompositionPlan(makeEdgeMap(), makeTheme("ring"));
    const normalizedX = plan.heroCenterX / 1920;
    const normalizedY = plan.heroCenterY / 1080;

    expect([
      "off-axis-processional",
      "split-lane-duel",
      "corridor-recede",
      "top-heavy-cascade",
      "low-stage-push",
      "arc-sweep-cluster",
      "halo-orbital",
      "shard-fan",
    ]).toContain(plan.shotGrammarKey);
    expect(normalizedX >= 0.41 && normalizedX <= 0.59 && normalizedY >= 0.41 && normalizedY <= 0.59).toBe(false);
  });

  test("symmetric center-negative-space inputs prefer off-axis anchors unless a halo grammar is requested", () => {
    const defaultPlan = buildCompositionPlan(makeEdgeMap(), makeTheme("cellular"));
    const haloPlan = buildCompositionPlanForTheme(makeEdgeMap(), makeTheme("ring"), "halo");
    const defaultCentered =
      defaultPlan.heroCenterX / 1920 >= 0.41 &&
      defaultPlan.heroCenterX / 1920 <= 0.59 &&
      defaultPlan.heroCenterY / 1080 >= 0.41 &&
      defaultPlan.heroCenterY / 1080 <= 0.59;

    expect(defaultCentered).toBe(false);
    expect(haloPlan.shotGrammarKey).toBe("halo-orbital");
    expect(haloPlan.centerBiasScore).toBeGreaterThan(0.2);
  });
});
