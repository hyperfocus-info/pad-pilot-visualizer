import { describe, expect, test } from "bun:test";
import type { EdgeMap, FractalMotif, VisualPhrasePlan } from "../types";
import { buildHeroMotifSchedule, resolveHeroMotifScheduleSlot } from "./hero-motif-schedule";

function makeEdgeMap(imagePath: string, fractalMotif: FractalMotif): EdgeMap {
  return {
    imagePath,
    fractalMotif,
    points: [],
    contours: [],
    flowField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, vectors: new Float32Array(2), weights: new Float32Array(1) },
    densityField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, values: new Float32Array(1) },
    toneField: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, luminance: new Float32Array(1), contrast: new Float32Array(1) },
    subjectMask: { gridWidth: 1, gridHeight: 1, cellWidth: 1, cellHeight: 1, values: new Float32Array([1]) },
    silhouetteContours: [],
    spawners: [],
    regionAnchors: [],
    spatialBins: {
      gridWidth: 1,
      gridHeight: 1,
      cellWidth: 1,
      cellHeight: 1,
      pointBins: [[]],
      spawnerBins: [[]],
    },
    focalCenterX: 0.5,
    focalCenterY: 0.5,
    focalSpread: 0.5,
    leftWeight: 0.5,
    rightWeight: 0.5,
    topWeight: 0.5,
    bottomWeight: 0.5,
    subjectBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    negativeSpaceQuadrant: "center",
    maskConfidence: "high",
    width: 1,
    height: 1,
    complexity: 0.5,
  };
}

function makePlan(durationSec: number): VisualPhrasePlan[] {
  return [{
    startFrame: 0,
    endFrame: Math.round(durationSec * 30),
    startSec: 0,
    endSec: durationSec,
    regime: "breakdown",
    averageEnergy: 0.5,
    peakiness: 0.5,
    brightnessFloor: 0.1,
    densityCap: 1,
    motionMode: "glide",
    overlayMode: "kinetic-scan",
    transitionFamily: "echo-fold",
    shotMode: "portrait",
    effectPolicy: "balanced",
    rescuePolicy: "reinforce",
    imageHoldMultiplier: 1,
    effectiveImageHoldMultiplier: 1,
    transientCutBias: 0.5,
    rapidPeakDensity: 0.5,
    transitionOpportunityBias: 0.5,
    imageSwapAllowed: true,
    transitionTriggerPreference: "mixed",
    preferredCutFrame: 0,
    transitionDurationMultiplier: 1,
    transitionCarryBias: 0.5,
    songVisualFamily: "glass-surge",
    phraseMotifFamily: "orbit-thread",
    phraseTransitionCluster: "echo",
    phraseCompositionBias: "hero-split",
    phraseHeroMotionBias: "glide",
    phraseBackgroundResponseBias: "pulsed",
  }];
}

describe("hero motif schedule", () => {
  test("keeps a short song to one body motif with bounded intro/outro slots", () => {
    const edgeMaps = [
      ...Array.from({ length: 6 }, (_, index) => makeEdgeMap(`a-${index}.png`, "glass-orbital")),
      ...Array.from({ length: 2 }, (_, index) => makeEdgeMap(`b-${index}.png`, "smoke-ribbon")),
    ];
    const schedule = buildHeroMotifSchedule({
      edgeMaps,
      visualPlan: makePlan(80),
      secondsPerImage: 10,
      renderDurationSec: 80,
    });

    expect(schedule.slots.length).toBeLessThanOrEqual(3);
    const uniqueMotifs = new Set(schedule.slots.map((slot) => slot.motif));
    expect(uniqueMotifs.size).toBeLessThanOrEqual(2);
  });

  test("does not promote a new body motif without clearing the replacement threshold", () => {
    const edgeMaps = [
      ...Array.from({ length: 11 }, (_, index) => makeEdgeMap(`hold-${index}.png`, "glass-orbital")),
      ...Array.from({ length: 4 }, (_, index) => makeEdgeMap(`late-${index}.png`, "smoke-ribbon")),
    ];
    const schedule = buildHeroMotifSchedule({
      edgeMaps,
      visualPlan: makePlan(180),
      secondsPerImage: 10,
      renderDurationSec: 180,
    });

    const bodySlots = schedule.slots.filter((slot) => slot.reason === "body-hold" || slot.reason === "body-promoted");
    expect(new Set(bodySlots.map((slot) => slot.motif)).size).toBe(1);
    expect(bodySlots[0]?.motif).toBe("glass-orbital");
  });

  test("promotes a dominant later-slot challenger only at a slot boundary", () => {
    const edgeMaps = [
      ...Array.from({ length: 14 }, (_, index) => makeEdgeMap(`early-${index}.png`, "glass-orbital")),
      ...Array.from({ length: 10 }, (_, index) => makeEdgeMap(`late-${index}.png`, "smoke-ribbon")),
    ];
    const schedule = buildHeroMotifSchedule({
      edgeMaps,
      visualPlan: makePlan(240),
      secondsPerImage: 10,
      renderDurationSec: 240,
    });

    const promotedSlots = schedule.slots.filter((slot) => slot.reason === "body-promoted");
    expect(promotedSlots).toHaveLength(1);
    expect(promotedSlots[0]?.motif).toBe("smoke-ribbon");
    expect(resolveHeroMotifScheduleSlot(schedule, promotedSlots[0]!.startSec + 1).motif).toBe("smoke-ribbon");
    expect(resolveHeroMotifScheduleSlot(schedule, promotedSlots[0]!.startSec - 1).motif).not.toBe("smoke-ribbon");
  });
});
