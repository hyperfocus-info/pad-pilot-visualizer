import { clamp } from "../config";
import type {
  CompositionPlan,
  EdgeMap,
  HeroLayoutFamily,
  HeroLayoutResolution,
  HeroRelationshipMode,
  HeroRelationshipRole,
  SceneGraph,
} from "../types";

function quadrantForPoint(x: number, y: number, width: number, height: number): "tl" | "tr" | "bl" | "br" | "center" {
  const nx = x / Math.max(1, width);
  const ny = y / Math.max(1, height);
  if (Math.abs(nx - 0.5) < 0.12 && Math.abs(ny - 0.5) < 0.12) {
    return "center";
  }
  if (nx < 0.5 && ny < 0.5) {
    return "tl";
  }
  if (nx >= 0.5 && ny < 0.5) {
    return "tr";
  }
  if (nx < 0.5 && ny >= 0.5) {
    return "bl";
  }
  return "br";
}

function clampHeroPoint(
  edgeMap: EdgeMap,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number } {
  const pad = radius * 0.7;
  return {
    x: clamp(x, pad, edgeMap.width - pad),
    y: clamp(y, pad, edgeMap.height - pad),
  };
}

function anchorRoleForIndex(
  relationshipMode: HeroRelationshipMode,
  index: number,
): HeroRelationshipRole {
  if (index === 0) {
    return "primary";
  }
  switch (relationshipMode) {
    case "mirror-x":
      return index % 2 === 1 ? "mirror-left" : "mirror-right";
    case "mirror-y":
      return index % 2 === 1 ? "mirror-top" : "mirror-bottom";
    case "mirror-xy":
      return index % 2 === 1 ? "diagonal-a" : "diagonal-b";
    default:
      return "satellite";
  }
}

function dedupeQuadrants(quadrants: Array<"tl" | "tr" | "bl" | "br" | "center">): number {
  return new Set(quadrants).size;
}

function pairDistanceStats(instances: HeroLayoutResolution["instances"]): { min: number; avg: number } {
  let min = Number.POSITIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (let a = 0; a < instances.length; a += 1) {
    for (let b = a + 1; b < instances.length; b += 1) {
      const distance = Math.hypot(instances[a]!.anchorX - instances[b]!.anchorX, instances[a]!.anchorY - instances[b]!.anchorY);
      min = Math.min(min, distance);
      sum += distance;
      count += 1;
    }
  }
  return {
    min: count > 0 ? min : 0,
    avg: count > 0 ? sum / count : 0,
  };
}

export function resolveHeroLayout(
  sceneGraph: Pick<SceneGraph, "continuitySeed" | "heroClusterConfig" | "heroOrbitRadius"> & { heroRelationshipMode?: HeroRelationshipMode },
  compositionPlan: CompositionPlan,
  edgeMap: EdgeMap,
): HeroLayoutResolution {
  const cluster = sceneGraph.heroClusterConfig;
  const count = cluster.enabled ? Math.max(1, Math.min(4, cluster.count)) : 1;
  const relationshipMode = sceneGraph.heroRelationshipMode ?? cluster.relationshipMode;
  const subjectWidth = edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX;
  const subjectHeight = edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY;
  const supportSpread =
    compositionPlan.supportSlots.length > 0
      ? compositionPlan.supportSlots
          .slice(0, 3)
          .reduce((sum, slot) => sum + Math.hypot(slot.x - compositionPlan.heroCenterX, slot.y - compositionPlan.heroCenterY), 0) /
        Math.max(1, Math.min(3, compositionPlan.supportSlots.length))
      : Math.max(subjectWidth, subjectHeight) * 0.9;
  const baseSpreadPx = clamp(
    Math.max(
      compositionPlan.heroRadius * 1.55,
      Math.max(subjectWidth, subjectHeight) * 0.34,
      supportSpread * 0.34,
      Math.min(edgeMap.width, edgeMap.height) * 0.14,
    ),
    compositionPlan.heroRadius * 1.25,
    Math.min(edgeMap.width, edgeMap.height) * 0.32,
  );
  const seedPhase = ((sceneGraph.continuitySeed % 360) * Math.PI) / 180;
  const primary = clampHeroPoint(edgeMap, compositionPlan.heroCenterX, compositionPlan.heroCenterY, compositionPlan.heroRadius);
  const fallbackFamily: HeroLayoutFamily = relationshipMode === "cojoined" ? "cojoined-cluster" : "independent-lanes";
  const instances: HeroLayoutResolution["instances"] = [];

  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      instances.push({
        index,
        anchorX: primary.x,
        anchorY: primary.y,
        radius: compositionPlan.heroRadius * (index === 0 ? 1 : cluster.satelliteScale),
        laneId: "primary",
        quadrant: quadrantForPoint(primary.x, primary.y, edgeMap.width, edgeMap.height),
        relationshipRole: "primary" as const,
        pathOffsetPhase: 0,
      });
      continue;
    }

    let x = primary.x;
    let y = primary.y;
    let family: HeroLayoutFamily = fallbackFamily;
    if (relationshipMode === "cojoined") {
      const ringAngle = seedPhase + index * ((Math.PI * 2) / count);
      x += Math.cos(ringAngle) * baseSpreadPx * 0.34;
      y += Math.sin(ringAngle) * baseSpreadPx * 0.24;
      family = "cojoined-cluster";
    } else if (relationshipMode === "mirror-x") {
      const lateral = index % 2 === 1 ? -1 : 1;
      x += lateral * baseSpreadPx;
      y += Math.sin(seedPhase + index * 0.8) * baseSpreadPx * 0.18;
      family = "bilateral-stage";
    } else if (relationshipMode === "mirror-y") {
      const vertical = index % 2 === 1 ? -1 : 1;
      const useVertical = subjectHeight >= subjectWidth * 0.66;
      if (useVertical) {
        y += vertical * baseSpreadPx * 0.92;
        x += Math.cos(seedPhase + index * 0.7) * baseSpreadPx * 0.14;
        family = "vertical-stage";
      } else {
        x += vertical * baseSpreadPx * 0.96;
        y += Math.sin(seedPhase + index * 0.6) * baseSpreadPx * 0.22;
        family = "bilateral-stage";
      }
    } else if (relationshipMode === "mirror-xy") {
      const diagonalSignX = index % 2 === 1 ? -1 : 1;
      const diagonalSignY = index % 3 === 0 ? -1 : 1;
      x += diagonalSignX * baseSpreadPx * 0.86;
      y += diagonalSignY * baseSpreadPx * 0.62;
      family = count >= 4 ? "quad-stage" : "bilateral-stage";
    } else {
      const support = compositionPlan.supportSlots[(index - 1) % Math.max(1, compositionPlan.supportSlots.length)];
      if (support) {
        const dx = support.x - primary.x;
        const dy = support.y - primary.y;
        const norm = Math.hypot(dx, dy) || 1;
        x += (dx / norm) * baseSpreadPx;
        y += (dy / norm) * baseSpreadPx * 0.72;
      } else {
        const angle = seedPhase + index * ((Math.PI * 2) / count);
        x += Math.cos(angle) * baseSpreadPx;
        y += Math.sin(angle) * baseSpreadPx * 0.68;
      }
      family = "independent-lanes";
    }

    const clamped = clampHeroPoint(edgeMap, x, y, compositionPlan.heroRadius * cluster.satelliteScale);
    instances.push({
      index,
      anchorX: clamped.x,
      anchorY: clamped.y,
      radius: compositionPlan.heroRadius * cluster.satelliteScale,
      laneId: `${family}-${index}`,
      quadrant: quadrantForPoint(clamped.x, clamped.y, edgeMap.width, edgeMap.height),
      relationshipRole: anchorRoleForIndex(relationshipMode, index),
      pathOffsetPhase: index * 0.19 + (sceneGraph.continuitySeed % 17) * 0.01,
    });
  }

  const distinctQuadrants = dedupeQuadrants(instances.map((instance) => instance.quadrant));
  let laneDiversityScore = clamp(
    ((new Set(instances.map((instance) => instance.laneId)).size / Math.max(1, instances.length)) * 0.65) +
      (distinctQuadrants / Math.max(1, Math.min(instances.length, 4))) * 0.35,
    0,
    1,
  );
  const distanceStats = pairDistanceStats(instances);
  const requiresFallback =
    count > 1 &&
    relationshipMode !== "cojoined" &&
    (
      distanceStats.min < compositionPlan.heroRadius * 1.05 ||
      (relationshipMode === "mirror-xy" && distinctQuadrants < Math.min(4, count)) ||
      (relationshipMode === "independent" && laneDiversityScore < 0.55) ||
      (relationshipMode !== "independent" && distinctQuadrants < 2)
    );
  if (requiresFallback) {
    const fallbackSpread = Math.max(baseSpreadPx, compositionPlan.heroRadius * 1.6);
    const fallbackFamily: HeroLayoutFamily =
      relationshipMode === "mirror-y"
        ? "vertical-stage"
        : relationshipMode === "mirror-xy" || count >= 4
          ? "quad-stage"
          : "bilateral-stage";
    const fallbackInstances = Array.from({ length: count }, (_, index) => {
      if (index === 0) {
        return instances[0]!;
      }
      let x = primary.x;
      let y = primary.y;
      if (fallbackFamily === "quad-stage") {
        const anchors = [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: -1, y: 1 },
          { x: 1, y: 1 },
        ] as const;
        const anchor = anchors[index % anchors.length]!;
        x += anchor.x * fallbackSpread * 0.78;
        y += anchor.y * fallbackSpread * 0.64;
      } else if (fallbackFamily === "vertical-stage") {
        const vertical = index % 2 === 1 ? -1 : 1;
        y += vertical * fallbackSpread * 0.96;
        x += (index - 1) * fallbackSpread * 0.12;
      } else {
        const lateral = index % 2 === 1 ? -1 : 1;
        x += lateral * fallbackSpread;
        y += (Math.floor(index / 2) - 0.5) * fallbackSpread * 0.34;
      }
      const clamped = clampHeroPoint(edgeMap, x, y, compositionPlan.heroRadius * cluster.satelliteScale);
      return {
        index,
        anchorX: clamped.x,
        anchorY: clamped.y,
        radius: compositionPlan.heroRadius * cluster.satelliteScale,
        laneId: `${fallbackFamily}-${index}`,
        quadrant: quadrantForPoint(clamped.x, clamped.y, edgeMap.width, edgeMap.height),
        relationshipRole: anchorRoleForIndex(
          fallbackFamily === "quad-stage" ? "mirror-xy" : fallbackFamily === "vertical-stage" ? "mirror-y" : "mirror-x",
          index,
        ),
        pathOffsetPhase: index * 0.19 + (sceneGraph.continuitySeed % 17) * 0.01,
      };
    });
    instances.splice(0, instances.length, ...fallbackInstances);
    laneDiversityScore = clamp(
      ((new Set(instances.map((instance) => instance.laneId)).size / Math.max(1, instances.length)) * 0.65) +
        (dedupeQuadrants(instances.map((instance) => instance.quadrant)) / Math.max(1, Math.min(instances.length, 4))) * 0.35,
      0,
      1,
    );
  }

  return {
    instances,
    layoutFamily:
      relationshipMode === "cojoined"
        ? "cojoined-cluster"
        : relationshipMode === "mirror-x"
          ? "bilateral-stage"
          : relationshipMode === "mirror-y"
            ? (subjectHeight >= subjectWidth * 0.66 ? "vertical-stage" : "bilateral-stage")
            : relationshipMode === "mirror-xy"
              ? (count >= 4 ? "quad-stage" : "bilateral-stage")
              : "independent-lanes",
    baseSpreadPx,
    laneDiversityScore,
    expectedRelationshipMode: relationshipMode,
  };
}
