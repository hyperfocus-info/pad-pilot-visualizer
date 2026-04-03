import { describe, expect, test } from "bun:test";
import { resolveHeroLayout } from "./hero-layout";
import type { CompositionPlan, EdgeMap, HeroClusterConfig } from "../types";

function makePlan(): CompositionPlan {
  return {
    imagePath: "layout.png",
    heroCenterX: 960,
    heroCenterY: 540,
    heroRadius: 180,
    supportSlots: [
      { x: 540, y: 520, radius: 110, weight: 0.9 },
      { x: 1380, y: 600, radius: 110, weight: 0.8 },
    ],
    backgroundSlots: [],
    protectedZones: [],
    shotComposition: { mode: "portrait", focalCenterX: 960, focalCenterY: 540, focalSpread: 220, negativeSpaceQuadrant: "center" },
    stylePlacementMode: "orbital",
    focalOccupancyScore: 0.7,
    centerBiasScore: 0.2,
    heroContours: [],
    supportContours: [],
    backgroundContours: [],
    shotGrammarKey: "portrait",
    revealSchedule: { revealPhase: 0.4, heroResolved: true, detailResolved: true },
  } as unknown as CompositionPlan;
}

function makeEdgeMap(height = 1080): EdgeMap {
  return {
    imagePath: "layout.png",
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
    focalSpread: 220,
    leftWeight: 0.4,
    rightWeight: 0.6,
    topWeight: 0.45,
    bottomWeight: 0.55,
    subjectBounds: { minX: 700, minY: 220, maxX: 1220, maxY: height - 220 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    fractalMotif: "harmonic-lattice",
    width: 1920,
    height,
    complexity: 0.5,
  };
}

function makeClusterConfig(overrides: Partial<HeroClusterConfig> = {}): HeroClusterConfig {
  return {
    enabled: true,
    count: 2,
    layout: "bilateral",
    relationshipMode: "mirror-x",
    satelliteScale: 0.72,
    satelliteEmissionScale: 0.78,
    satelliteAlphaScale: 0.84,
    satellitePathOffsetRadius: 0.38,
    sharedCoreBias: 0.18,
    mirrorAxisBias: 0.22,
    satellitePhaseLock: 0.24,
    ...overrides,
  };
}

function makeSceneGraph(overrides: Partial<Parameters<typeof resolveHeroLayout>[0]> = {}): Parameters<typeof resolveHeroLayout>[0] {
  return {
    continuitySeed: 33,
    heroOrbitRadius: 180,
    heroRelationshipMode: "mirror-x",
    heroClusterConfig: makeClusterConfig(),
    ...overrides,
  };
}

describe("hero layout", () => {
  test("single-hero fallback stays centered and clamped", () => {
    const layout = resolveHeroLayout(makeSceneGraph({ heroClusterConfig: makeClusterConfig({ enabled: false, count: 1 }) }), makePlan(), makeEdgeMap());
    expect(layout.instances).toHaveLength(1);
    expect(layout.instances[0]?.quadrant).toBe("center");
  });

  test("mirror, cojoined, independent, and tall-stage layouts resolve correctly", () => {
    expect(resolveHeroLayout(makeSceneGraph({ heroRelationshipMode: "mirror-x" }), makePlan(), makeEdgeMap()).layoutFamily).toBe("bilateral-stage");
    expect(resolveHeroLayout(makeSceneGraph({ heroRelationshipMode: "cojoined", heroClusterConfig: makeClusterConfig({ relationshipMode: "cojoined", count: 3, layout: "orbit-ring" }) }), makePlan(), makeEdgeMap()).layoutFamily).toBe("cojoined-cluster");
    expect(resolveHeroLayout(makeSceneGraph({ heroRelationshipMode: "independent", heroClusterConfig: makeClusterConfig({ relationshipMode: "independent" }) }), makePlan(), makeEdgeMap()).layoutFamily).toBe("independent-lanes");
    expect(resolveHeroLayout(makeSceneGraph({ heroRelationshipMode: "mirror-y", heroClusterConfig: makeClusterConfig({ relationshipMode: "mirror-y" }) }), makePlan(), makeEdgeMap(1600)).layoutFamily).toBe("vertical-stage");
  });

  test("multi-hero layouts stay bounded, lane-diverse, and deterministic", () => {
    const sceneGraph = makeSceneGraph({ heroRelationshipMode: "independent", heroClusterConfig: makeClusterConfig({ relationshipMode: "independent", count: 3, layout: "triad" }) });
    const layoutA = resolveHeroLayout(sceneGraph, makePlan(), makeEdgeMap());
    const layoutB = resolveHeroLayout(sceneGraph, makePlan(), makeEdgeMap());
    expect(layoutA.instances).toEqual(layoutB.instances);
    expect(layoutA.laneDiversityScore).toBeGreaterThanOrEqual(0.55);
    expect(new Set(layoutA.instances.map((instance) => instance.laneId)).size).toBe(layoutA.instances.length);
    for (const instance of layoutA.instances) {
      expect(instance.anchorX).toBeGreaterThanOrEqual(0);
      expect(instance.anchorX).toBeLessThanOrEqual(1920);
      expect(instance.anchorY).toBeGreaterThanOrEqual(0);
      expect(instance.anchorY).toBeLessThanOrEqual(1080);
    }
  });
});
