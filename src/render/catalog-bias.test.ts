import { describe, expect, test } from "bun:test";
import { FRAME_POST_EFFECT_IDS, FRACTAL_MOTIFS, type EdgeMap, type ParticleMotionMode, type RenderTheme } from "../types";
import { BACKGROUND_ELEMENT_SPECS } from "./background-elements";
import { buildCompositionPlan } from "./composition-plan";
import { FRAME_POST_EFFECT_SPECS } from "./frame-post-effects";
import { MOTIF_EFFECT_SPECS } from "./motif-effects";
import { OUTRO_EFFECT_SPECS } from "./outro-effects";
import { buildSceneGraph, HERO_CONDUCTOR_SPECS } from "./scene-graph";
import { PERSISTENT_MOTIF_SPECS } from "./persistent-motifs";

type CatalogCoverageReport = {
  id: string;
  surfaces: number;
};

const NEW_BACKGROUND_IDS = new Set([
  "eddy-advect-plume",
  "plexus-neighbor-web",
  "bass-well-orrery",
  "voxel-depth-drift",
  "pressure-grid-plane",
  "boolean-aperture-cuts",
  "metaball-merge-mass",
  "voronoi-drop-shatter",
  "lissajous-sigil-loop",
  "hard-pixel-lock",
  "crt-phosphor-mask",
]);

const NEW_TRANSITION_IDS = [
  "voronoi-drop-shatter",
  "wire-solid-phase-cut",
  "mobius-wrap-tunnel",
  "datamosh-vector-drag",
  "resolution-crash-snapback",
  "snare-negative-flip",
  "quadrant-mirror-sweep",
  "kaleido-iris-zoom",
  "tri-prism-fold",
  "kaleido-tunnel-zoom",
] as const;

const NEW_PARTICLE_MODES: ParticleMotionMode[] = [
  "flock-curl",
  "flow-advect",
  "plexus-link",
  "gravity-orrery",
  "ribbon-trace",
  "lifecycle-morph",
  "shell-bounce",
  "voxel-depth",
  "paint-residue",
  "lightning-latch",
];

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
      averageR: 70, averageG: 80, averageB: 90,
      medianR: 70, medianG: 80, medianB: 90,
      modeR: 70, modeG: 80, modeB: 90,
      rangeR: 40, rangeG: 40, rangeB: 40,
      averageHue: 180,
      effectSeed: 9,
      effectBucket: 4,
      effectCycle: 1,
      effectMode: 5,
      transitionMode: 3,
      dominantHue: 180,
      hueVariance: 0.22,
      saturationMean: 0.44,
      lightnessMean: 0.46,
      warmCoolBias: 0.04,
      contrast: 0.28,
      edgeDensity: 0.4,
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
    imageContrast: 0.28,
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

describe("catalog bias", () => {
  test("new backgrounds have at least four motif surfaces", () => {
    const reports: CatalogCoverageReport[] = BACKGROUND_ELEMENT_SPECS
      .filter((entry) => NEW_BACKGROUND_IDS.has(entry.id))
      .map((entry) => ({ id: entry.id, surfaces: entry.supportedMotifs.length + entry.fallbackMotifs.length }));
    expect(reports).toHaveLength(11);
    for (const report of reports) {
      expect(report.surfaces).toBeGreaterThanOrEqual(8);
    }
  });

  test("new conductors and frame post effects have broad eligibility surfaces", () => {
    const conductorReports = HERO_CONDUCTOR_SPECS
      .filter((entry) => entry.id === "swarm-choirmaster" || entry.id === "latch-archivist")
      .map((entry) => ({ id: entry.id, surfaces: entry.preferredMotifs.length + entry.preferredRegimes.length }));
    const postReports = FRAME_POST_EFFECT_SPECS.map((entry) => ({
      id: entry.id,
      surfaces: entry.motifs.length + entry.preferredRegimes.length + entry.preferredOverlayModes.length + entry.preferredPersistentMotifs.length,
    }));
    for (const report of conductorReports) {
      expect(report.surfaces).toBeGreaterThanOrEqual(10);
    }
    for (const report of postReports) {
      expect(FRAME_POST_EFFECT_IDS).toContain(report.id as any);
      expect(report.surfaces).toBeGreaterThanOrEqual(9);
    }
  });

  test("catalog selectors keep minimum motif and combination coverage", () => {
    for (const motif of FRACTAL_MOTIFS) {
      const motifEffectCount = MOTIF_EFFECT_SPECS.filter(
        (entry) => entry.primaryMotif === motif || entry.fallbackMotifs.includes(motif),
      ).length;
      const outroCount = OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === motif || entry.motif === "wildcard").length;
      expect(motifEffectCount).toBeGreaterThanOrEqual(2);
      expect(outroCount).toBeGreaterThanOrEqual(4);
    }

    const regimes = ["intro", "groove", "build", "drop", "breakdown", "outro"] as const;
    const overlays = ["stable-feedback", "pulse-wave", "kinetic-scan", "climax-burst", "sparse-contour"] as const;
    for (const motif of FRACTAL_MOTIFS) {
      const motifPool = FRAME_POST_EFFECT_SPECS.filter((entry) => entry.motifs.includes(motif) || entry.motifs.includes("wildcard"));
      for (const regime of regimes) {
        for (const overlay of overlays) {
          const eligibleCount = motifPool.filter(
            (entry) => entry.preferredRegimes.includes(regime) || entry.preferredOverlayModes.includes(overlay),
          ).length;
          expect(eligibleCount).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  test("new transitions appear in persistent motif routing at least four times overall", () => {
    const counts = new Map<string, number>();
    for (const id of NEW_TRANSITION_IDS) {
      counts.set(id, 0);
    }
    for (const spec of PERSISTENT_MOTIF_SPECS) {
      for (const family of spec.preferredTransitionFamilies) {
        if (counts.has(family)) {
          counts.set(family, counts.get(family)! + 1);
        }
      }
    }
    expect(counts.get("mobius-wrap-tunnel")).toBeGreaterThanOrEqual(4);
    expect(counts.get("datamosh-vector-drag")).toBeGreaterThanOrEqual(2);
    expect(counts.get("voronoi-drop-shatter")).toBeGreaterThanOrEqual(1);
    expect(counts.get("quadrant-mirror-sweep")).toBeGreaterThanOrEqual(1);
    expect(counts.get("kaleido-iris-zoom")).toBeGreaterThanOrEqual(1);
    expect(counts.get("tri-prism-fold")).toBeGreaterThanOrEqual(1);
    expect(counts.get("kaleido-tunnel-zoom")).toBeGreaterThanOrEqual(1);
  });

  test("new background and post concepts are broader than legacy median", () => {
    const legacyBackgroundMedian = median(
      BACKGROUND_ELEMENT_SPECS
        .filter((entry) => !NEW_BACKGROUND_IDS.has(entry.id))
        .map((entry) => entry.supportedMotifs.length + entry.fallbackMotifs.length),
    );
    const newBackgroundMedian = median(
      BACKGROUND_ELEMENT_SPECS
        .filter((entry) => NEW_BACKGROUND_IDS.has(entry.id))
        .map((entry) => entry.supportedMotifs.length + entry.fallbackMotifs.length),
    );
    const postMedian = median(
      FRAME_POST_EFFECT_SPECS.map((entry) => entry.motifs.length + entry.preferredRegimes.length + entry.preferredOverlayModes.length + entry.preferredPersistentMotifs.length),
    );
    expect(newBackgroundMedian).toBeGreaterThan(legacyBackgroundMedian);
    expect(postMedian).toBeGreaterThanOrEqual(10);
  });

  test("new particle motion modes are reachable from multiple routing surfaces", () => {
    const styles: RenderTheme["styleMode"][] = ["cellular", "ring", "shard", "filament", "cloud"];
    for (const mode of NEW_PARTICLE_MODES) {
      const motifs = new Set<string>();
      const emissions = new Set<string>();
      const subEmitters = new Set<string>();
      for (const motif of FRACTAL_MOTIFS) {
        for (const style of styles) {
          const imagePath = `${motif}-${style}.png`;
          const theme = makeTheme(style, imagePath);
          const edgeMap = makeEdgeMap(motif as EdgeMap["fractalMotif"], imagePath);
          const sceneGraph = buildSceneGraph(edgeMap, theme, buildCompositionPlan(edgeMap, theme));
          if (sceneGraph.particleBehaviors.some((entry) => entry.mode === mode)) {
            motifs.add(motif);
            emissions.add(sceneGraph.heroEmissionMode);
            subEmitters.add(sceneGraph.subEmitterMode);
          }
        }
      }
      expect(motifs.size + emissions.size + subEmitters.size).toBeGreaterThanOrEqual(4);
    }
  });
});
