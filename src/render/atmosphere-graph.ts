import { clamp } from "../config";
import type {
  AtmosphereEmitter,
  AtmosphereGraph,
  BridgeLattice,
  CompositionPlan,
  EdgeMap,
  RenderTheme,
  SceneGraph,
  VeilStrip,
} from "../types";

function pointInProtectedZone(plan: CompositionPlan, x: number, y: number): boolean {
  return plan.protectedZones.some((zone) => x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height);
}

function emitterFromSlot(
  x: number,
  y: number,
  radius: number,
  weight: number,
  role: AtmosphereEmitter["role"],
  colorWeight: number,
): AtmosphereEmitter {
  return {
    x,
    y,
    radius,
    alpha: clamp(0.04 + weight * 0.08, 0.035, 0.14),
    colorWeight,
    role,
  };
}

function buildEmitters(plan: CompositionPlan, sceneGraph: SceneGraph): AtmosphereEmitter[] {
  const emitters: AtmosphereEmitter[] = [
    emitterFromSlot(plan.heroCenterX, plan.heroCenterY, plan.heroRadius * 1.15, sceneGraph.heroVisibilityBias, "hero", 0.2),
  ];
  for (const [index, slot] of sceneGraph.supportAttractors.slice(0, 5).entries()) {
    if (pointInProtectedZone(plan, slot.x, slot.y)) {
      continue;
    }
    emitters.push(emitterFromSlot(slot.x, slot.y, slot.radius * 1.1, slot.weight, "support", 0.35 + index * 0.12));
  }
  for (const [index, slot] of sceneGraph.backgroundAttractors.slice(0, 4).entries()) {
    if (pointInProtectedZone(plan, slot.x, slot.y)) {
      continue;
    }
    emitters.push(emitterFromSlot(slot.x, slot.y, slot.radius * 0.78, slot.weight * 0.72, "background", 0.55 + index * 0.08));
  }
  return emitters;
}

function buildVeils(edgeMap: EdgeMap, plan: CompositionPlan, sceneGraph: SceneGraph): VeilStrip[] {
  const strips: VeilStrip[] = [];
  const contourPool = [...plan.supportContours, ...plan.heroContours].slice(0, 6);
  for (const [index, contour] of contourPool.entries()) {
    const stride = Math.max(1, Math.floor(contour.points.length / Math.max(3, Math.min(7, contour.points.length))));
    const points = contour.points
      .filter((_, pointIndex) => pointIndex % stride === 0)
      .slice(0, 6)
      .map((point) => ({ x: point.x, y: point.y }))
      .filter((point) => !pointInProtectedZone(plan, point.x, point.y));
    if (points.length < 3) {
      continue;
    }
    strips.push({
      points,
      alpha: clamp(0.04 + sceneGraph.intentSeed.pathBias * 0.06, 0.03, 0.11),
      width: clamp(1.4 + index * 0.35 + sceneGraph.intentSeed.energyBias * 0.8, 1.2, 3.4),
      colorWeight: 0.18 + index * 0.1,
    });
  }
  return strips;
}

function buildBridges(plan: CompositionPlan, sceneGraph: SceneGraph): BridgeLattice[] {
  const bridges: BridgeLattice[] = [];
  const support = sceneGraph.supportAttractors.slice(0, 5);
  const background = sceneGraph.backgroundAttractors.slice(0, 5);
  for (const [index, slot] of support.entries()) {
    if (pointInProtectedZone(plan, slot.x, slot.y)) {
      continue;
    }
    bridges.push({
      fromX: plan.heroCenterX,
      fromY: plan.heroCenterY,
      toX: slot.x,
      toY: slot.y,
      alpha: clamp(0.05 + slot.weight * 0.05, 0.04, 0.1),
      width: clamp(1.1 + sceneGraph.intentSeed.energyBias * 1.2, 1, 2.5),
      colorWeight: 0.22 + index * 0.11,
      mode: sceneGraph.intentSeed.bridgePattern,
    });
  }
  for (const [index, slot] of background.slice(0, 5).entries()) {
    if (pointInProtectedZone(plan, slot.x, slot.y)) {
      continue;
    }
    const from = support[index % Math.max(1, support.length)] ?? { x: plan.heroCenterX, y: plan.heroCenterY, radius: plan.heroRadius, weight: 1, layer: "support", angle: 0 };
    bridges.push({
      fromX: from.x,
      fromY: from.y,
      toX: slot.x,
      toY: slot.y,
      alpha: clamp(0.03 + slot.weight * 0.04, 0.025, 0.08),
      width: clamp(0.9 + sceneGraph.intentSeed.scatterBias * 1.1, 0.9, 2),
      colorWeight: 0.48 + index * 0.08,
      mode: sceneGraph.intentSeed.bridgePattern,
    });
  }
  return bridges;
}

function buildSymmetryZones(plan: CompositionPlan, sceneGraph: SceneGraph, edgeMap: EdgeMap): AtmosphereGraph["symmetryZones"] {
  const zones: AtmosphereGraph["symmetryZones"] = [];
  if (sceneGraph.intentSeed.symmetryMode === "none") {
    return zones;
  }
  zones.push({
    x: plan.heroCenterX,
    y: plan.heroCenterY,
    radius: clamp(plan.heroRadius * 1.15, 40, edgeMap.width * 0.18),
    mode: sceneGraph.intentSeed.symmetryMode,
    alpha: 0.05 + sceneGraph.intentSeed.radialBias * 0.06,
  });
  const support = sceneGraph.supportAttractors[0];
  if (support && !pointInProtectedZone(plan, support.x, support.y)) {
    zones.push({
      x: support.x,
      y: support.y,
      radius: clamp(support.radius * 1.4, 28, edgeMap.width * 0.12),
      mode: sceneGraph.intentSeed.symmetryMode,
      alpha: 0.035 + sceneGraph.intentSeed.pathBias * 0.04,
    });
  }
  return zones.slice(0, 2);
}

export function buildAtmosphereGraph(
  edgeMap: EdgeMap,
  compositionPlan: CompositionPlan,
  sceneGraph: SceneGraph,
  _theme: RenderTheme,
): AtmosphereGraph {
  const emitters = buildEmitters(compositionPlan, sceneGraph);
  const veilStrips = buildVeils(edgeMap, compositionPlan, sceneGraph);
  const bridgeLattices = buildBridges(compositionPlan, sceneGraph);
  const symmetryZones = buildSymmetryZones(compositionPlan, sceneGraph, edgeMap);
  return {
    imagePath: edgeMap.imagePath,
    emitters,
    veilStrips,
    bridgeLattices,
    symmetryZones,
    localGlowBudget: clamp(4 + emitters.length * 0.8 + sceneGraph.intentSeed.energyBias * 3, 4, 12),
    paletteWeights: [0.14, 0.36, 0.58, 0.78],
    atmosphereDensity: clamp((veilStrips.length * 0.035) + (bridgeLattices.length * 0.018) + (emitters.length * 0.012), 0.08, 0.85),
    midScaleCoverage: clamp((veilStrips.length * 0.05) + (bridgeLattices.length * 0.028), 0.06, 0.82),
  };
}
