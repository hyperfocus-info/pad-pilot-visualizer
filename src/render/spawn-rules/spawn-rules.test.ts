import { describe, expect, test } from "bun:test";
import type { EdgeMap, RenderTheme, VisualState } from "../../types";
import { BACKGROUND_ELEMENT_SPECS } from "../background-elements";
import { buildCompositionPlan } from "../composition-plan";
import { EVENT_SPECS } from "../event-specs";
import { MOTIF_EFFECT_SPECS } from "../motif-effects";
import { buildSceneGraph } from "../scene-graph";
import { PARTICLE_CONCEPT_SPECS } from "./catalog";
import { buildSpawnContext } from "./context";
import { buildBackgroundPlanFromSelection, createBackgroundAdjustment } from "./adapters";
import { selectBackgroundConcept, selectEventConcept, selectMotifEffectConcept, selectParticleConcepts } from "./selectors";

function makeTheme(styleMode: RenderTheme["styleMode"], imagePath: string, symmetry = 0.58): RenderTheme {
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
      symmetry,
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

function makeEdgeMap(fractalMotif: EdgeMap["fractalMotif"], imagePath: string, maskConfidence: EdgeMap["maskConfidence"] = "high"): EdgeMap {
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
    maskConfidence,
    fractalMotif,
    width: 1920,
    height: 1080,
    complexity: 0.62,
  };
}

function makeVisualState(regime: VisualState["regime"] = "groove"): VisualState {
  return {
    frameIndex: 30,
    phraseIndex: 0,
    phraseStartFrame: 0,
    phraseEndFrame: 120,
    phraseStartSec: 0,
    phraseEndSec: 4,
    regime,
    brightnessFloor: 0.075,
    densityCap: 1,
    motionMode: "pulse",
    overlayMode: regime === "drop" ? "climax-burst" : "stable-feedback",
    transitionFamily: "carry",
    shotMode: "detail",
    effectPolicy: "balanced",
    rescuePolicy: "lift",
    imageHoldMultiplier: 1,
    effectiveImageHoldMultiplier: 1,
    transientCutBias: 0.2,
    rapidPeakDensity: 0.1,
    transitionOpportunityBias: 1,
    imageSwapAllowed: true,
    transitionTriggerPreference: regime === "drop" ? "mixed" : "swap",
    spawnArc: regime === "drop" ? "punctuate" : "swap",
    spawnEnergyTier: regime === "drop" ? "high" : "mid",
    preferredCutFrame: 30,
    transitionDurationMultiplier: 1,
    transitionCarryBias: 0.7,
  };
}

function isSingleSentence(value: string): boolean {
  return value.trim().length > 0 && (value.match(/[.!?]/g)?.length ?? 0) <= 1;
}

describe("spawn rules", () => {
  test("selectors are deterministic for the same spawn context", () => {
    const edgeMap = makeEdgeMap("glass-orbital", "scene-a.png");
    const theme = makeTheme("ring", edgeMap.imagePath);
    const compositionPlan = buildCompositionPlan(edgeMap, theme);
    const sceneGraph = buildSceneGraph(edgeMap, theme, compositionPlan, { scheduledHeroMotif: "glass-orbital" });
    const context = buildSpawnContext({
      edgeMap,
      theme,
      visualState: makeVisualState("groove"),
      compositionPlan,
      sceneGraph,
      resolvedImageIndex: 0,
      sceneChanged: false,
      dominantBand: "mid",
      fallbackRenderMode: "none",
    });
    expect(selectBackgroundConcept(context).selection.id).toBe(selectBackgroundConcept(context).selection.id);
    expect(selectEventConcept(context).selection.id).toBe(selectEventConcept(context).selection.id);
    expect(selectMotifEffectConcept(context).selection.id).toBe(selectMotifEffectConcept(context).selection.id);
    expect(selectParticleConcepts(context, sceneGraph).ids).toEqual(selectParticleConcepts(context, sceneGraph).ids);
  });

  test("background safety adjustment does not replace the selected concept", () => {
    const edgeMap = makeEdgeMap("glass-orbital", "scene-b.png", "low");
    const theme = makeTheme("ring", edgeMap.imagePath);
    const compositionPlan = buildCompositionPlan(edgeMap, theme);
    const sceneGraph = buildSceneGraph(edgeMap, theme, compositionPlan, { scheduledHeroMotif: "glass-orbital" });
    const context = buildSpawnContext({
      edgeMap,
      theme,
      visualState: makeVisualState("breakdown"),
      compositionPlan,
      sceneGraph,
      resolvedImageIndex: 0,
      sceneChanged: false,
      dominantBand: "mid",
      fallbackRenderMode: "fallback-composed",
      supportNearHeroScore: 0.1,
      focalOccupancyScore: 0.1,
    });
    const choice = selectBackgroundConcept(context);
    const adjustment = createBackgroundAdjustment(context, choice.spec);
    const plan = buildBackgroundPlanFromSelection({
      context,
      selectionId: choice.selection.id,
      spec: choice.spec,
      adjustment,
      edgeMap,
      theme,
      compositionPlan,
      sceneGraph,
    });
    expect(choice.selection.id).toBe(plan.backgroundElementId);
  });

  test("scene identity is keyed to the resolved source image", () => {
    const edgeMapA = makeEdgeMap("glass-orbital", "scene-c-a.png");
    const themeA = makeTheme("ring", edgeMapA.imagePath);
    const planA = buildCompositionPlan(edgeMapA, themeA);
    const graphA = buildSceneGraph(edgeMapA, themeA, planA, { scheduledHeroMotif: "glass-orbital" });
    const contextA = buildSpawnContext({
      edgeMap: edgeMapA,
      theme: themeA,
      visualState: makeVisualState("groove"),
      compositionPlan: planA,
      sceneGraph: graphA,
      resolvedImageIndex: 0,
      sceneChanged: false,
      dominantBand: "mid",
      fallbackRenderMode: "none",
    });
    const edgeMapB = makeEdgeMap("glass-orbital", "scene-c-b.png");
    const themeB = makeTheme("ring", edgeMapB.imagePath);
    const planB = buildCompositionPlan(edgeMapB, themeB);
    const graphB = buildSceneGraph(edgeMapB, themeB, planB, { scheduledHeroMotif: "glass-orbital" });
    const contextB = buildSpawnContext({
      edgeMap: edgeMapB,
      theme: themeB,
      visualState: makeVisualState("groove"),
      compositionPlan: planB,
      sceneGraph: graphB,
      resolvedImageIndex: 1,
      sceneChanged: true,
      dominantBand: "mid",
      fallbackRenderMode: "none",
    });
    expect(contextA.sceneKey).toBe(edgeMapA.imagePath);
    expect(contextB.sceneKey).toBe(edgeMapB.imagePath);
    expect(contextA.sceneKey).not.toBe(contextB.sceneKey);
  });

  test("active concepts expose one-sentence pitch and distinction metadata", () => {
    for (const entry of [...BACKGROUND_ELEMENT_SPECS, ...EVENT_SPECS, ...MOTIF_EFFECT_SPECS, ...PARTICLE_CONCEPT_SPECS]) {
      expect(entry.pitch.length).toBeGreaterThan(0);
      expect(entry.distinction.length).toBeGreaterThan(0);
      expect(isSingleSentence(entry.pitch)).toBe(true);
      expect(isSingleSentence(entry.distinction)).toBe(true);
    }
  });
});
