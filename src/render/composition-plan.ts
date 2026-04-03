import { clamp } from "../config";
import type {
  CompositionPlan,
  CompositionZone,
  EdgeContour,
  EdgeMap,
  PlacementLayer,
  PlacementSlot,
  RenderTheme,
  StylePlacementMode,
  TransitionBridgeState,
} from "../types";

const SHOT_GRAMMAR_BUCKETS = [
  "off-axis-processional",
  "split-lane-duel",
  "corridor-recede",
  "top-heavy-cascade",
  "low-stage-push",
  "arc-sweep-cluster",
  "halo-orbital",
  "shard-fan",
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseShotGrammarKey(theme: RenderTheme, edgeMap: EdgeMap, themeQuery?: string): string {
  const query = themeQuery?.toLowerCase() ?? "";
  if (query.includes("halo")) {
    return "halo-orbital";
  }
  if (query.includes("ghost")) {
    return "corridor-recede";
  }
  if (query.includes("blessed")) {
    return "top-heavy-cascade";
  }
  const candidates =
    theme.styleMode === "ring"
      ? ["halo-orbital", "arc-sweep-cluster", "off-axis-processional"]
      : theme.styleMode === "shard"
        ? ["shard-fan", "split-lane-duel", "corridor-recede"]
        : theme.styleMode === "filament"
          ? ["off-axis-processional", "corridor-recede", "top-heavy-cascade"]
          : theme.styleMode === "cellular"
            ? ["split-lane-duel", "low-stage-push", "arc-sweep-cluster"]
            : ["off-axis-processional", "arc-sweep-cluster", "corridor-recede"];
  const motifBias =
    edgeMap.fractalMotif === "glass-orbital" || edgeMap.fractalMotif === "halo-cell"
      ? ["halo-orbital", "arc-sweep-cluster"]
      : edgeMap.fractalMotif === "shattered-arc" || edgeMap.fractalMotif === "film-bloom-shard"
        ? ["shard-fan", "split-lane-duel"]
        : edgeMap.fractalMotif === "smoke-ribbon"
          ? ["corridor-recede", "off-axis-processional"]
          : ["top-heavy-cascade", "low-stage-push"];
  const pool = [...new Set([...candidates, ...motifBias, ...SHOT_GRAMMAR_BUCKETS])];
  return pool[stableHash(`${edgeMap.imagePath}:${theme.styleMode}:${theme.styleProfile.shapeBias}`) % pool.length]!;
}

function shouldAvoidCenteredHero(edgeMap: EdgeMap, shotGrammarKey: string): boolean {
  if (shotGrammarKey === "halo-orbital" || shotGrammarKey === "top-heavy-cascade") {
    return false;
  }
  return (
    edgeMap.negativeSpaceQuadrant === "center" &&
    Math.abs(edgeMap.leftWeight - edgeMap.rightWeight) < 0.14 &&
    Math.abs(edgeMap.topWeight - edgeMap.bottomWeight) < 0.14
  );
}

function contourWeight(contour: EdgeContour): number {
  const curvature =
    contour.points.reduce((sum, point) => sum + Math.abs(point.curvature), 0) / Math.max(1, contour.points.length);
  return contour.strength * 0.7 + contour.length * 0.04 + curvature * 120;
}

export function placementMode(theme: RenderTheme, edgeMap: EdgeMap): StylePlacementMode {
  switch (edgeMap.fractalMotif) {
    case "data-cathedral":
      return "filament";
    case "mandelbloom":
      return "orbital";
    case "chromatic-xylem":
      return "cell";
    case "vector-incantation":
      return "shard-lane";
    case "harmonic-lattice":
      return "orbital";
    case "film-bloom-shard":
      return "shard-lane";
    case "glass-orbital":
      return "orbital";
    case "neon-tube":
      return theme.styleMode === "shard" ? "shard-lane" : "filament";
    case "cathedral-filament":
      switch (theme.styleMode) {
        case "ring":
          return "orbital";
        case "shard":
          return "shard-lane";
        case "filament":
        case "cellular":
          return "filament";
        case "cloud":
          return theme.styleProfile.symmetry > 0.58 ? "filament" : "ribbon";
        default:
          return "ribbon";
      }
    case "smoke-ribbon":
      switch (theme.styleMode) {
        case "ring":
          return "orbital";
        case "shard":
          return "shard-lane";
        case "filament":
          return "filament";
        default:
          return "ribbon";
      }
    case "halo-cell":
      return "cell";
    case "shattered-arc":
      return "shard-lane";
    default:
      switch (theme.styleMode) {
        case "ring":
          return "orbital";
        case "filament":
          return "filament";
        case "cloud":
        case "cellular":
          return "cell";
        case "shard":
          return "shard-lane";
        default:
          return "ribbon";
      }
  }
}

function buildProtectedZones(edgeMap: EdgeMap): CompositionZone[] {
  const width = edgeMap.width;
  const height = edgeMap.height;
  switch (edgeMap.negativeSpaceQuadrant) {
    case "tl":
      return [{ x: 0, y: 0, width: width * 0.42, height: height * 0.42, weight: 1, kind: "negative-space" }];
    case "tr":
      return [{ x: width * 0.58, y: 0, width: width * 0.42, height: height * 0.42, weight: 1, kind: "negative-space" }];
    case "bl":
      return [{ x: 0, y: height * 0.58, width: width * 0.42, height: height * 0.42, weight: 1, kind: "negative-space" }];
    case "br":
      return [{ x: width * 0.58, y: height * 0.58, width: width * 0.42, height: height * 0.42, weight: 1, kind: "negative-space" }];
    case "center":
    default:
      return [{
        x: width * 0.4,
        y: height * 0.36,
        width: width * 0.2,
        height: height * 0.28,
        weight: 1,
        kind: "negative-space",
      }];
  }
}

function zoneContains(zone: CompositionZone, x: number, y: number): boolean {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

function inProtectedZone(zones: CompositionZone[], x: number, y: number): boolean {
  return zones.some((zone) => zoneContains(zone, x, y));
}

function safeDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function slotFromPoint(
  x: number,
  y: number,
  radius: number,
  weight: number,
  layer: PlacementLayer,
  heroCenterX: number,
  heroCenterY: number,
): PlacementSlot {
  return {
    x,
    y,
    radius,
    weight,
    layer,
    angle: Math.atan2(y - heroCenterY, x - heroCenterX),
  };
}

function chooseContours(edgeMap: EdgeMap): { heroContours: EdgeContour[]; supportContours: EdgeContour[] } {
  const all = [...edgeMap.silhouetteContours, ...edgeMap.contours].sort((a, b) => contourWeight(b) - contourWeight(a));
  return {
    heroContours: all.slice(0, Math.min(2, all.length)),
    supportContours: all.slice(1, Math.min(5, all.length)),
  };
}

function buildSupportSlots(
  edgeMap: EdgeMap,
  protectedZones: CompositionZone[],
  heroCenterX: number,
  heroCenterY: number,
  heroRadius: number,
): PlacementSlot[] {
  const slots: PlacementSlot[] = [];
  for (const anchor of edgeMap.regionAnchors.slice(0, 8)) {
    if (inProtectedZone(protectedZones, anchor.x, anchor.y)) {
      continue;
    }
    const distance = safeDistance(anchor, { x: heroCenterX, y: heroCenterY });
    if (distance < heroRadius * 0.9) {
      continue;
    }
    slots.push(slotFromPoint(anchor.x, anchor.y, clamp(anchor.radius * 0.44, 26, 120), anchor.weight, "support", heroCenterX, heroCenterY));
    if (slots.length >= 5) {
      break;
    }
  }
  if (slots.length >= 2) {
    return slots;
  }
  for (const contour of edgeMap.contours.slice(0, 4)) {
    const point = contour.points[Math.floor(contour.points.length * 0.33)] ?? contour.points[0];
    if (!point || inProtectedZone(protectedZones, point.x, point.y)) {
      continue;
    }
    const distance = safeDistance(point, { x: heroCenterX, y: heroCenterY });
    if (distance < heroRadius * 0.9) {
      continue;
    }
    slots.push(slotFromPoint(point.x, point.y, clamp(22 + contour.length * 0.015, 24, 96), contour.strength, "support", heroCenterX, heroCenterY));
    if (slots.length >= 4) {
      break;
    }
  }
  return slots;
}

function buildFallbackRadialSlots(
  edgeMap: EdgeMap,
  protectedZones: CompositionZone[],
  heroCenterX: number,
  heroCenterY: number,
  heroRadius: number,
  layer: PlacementLayer,
  targetCount: number,
): PlacementSlot[] {
  const slots: PlacementSlot[] = [];
  const distanceScale = layer === "support" ? 1.45 : 2.15;
  const radiusScale = layer === "support" ? 0.36 : 0.28;
  for (let index = 0; index < 8 && slots.length < targetCount; index += 1) {
    const angle = -Math.PI * 0.7 + index * ((Math.PI * 2) / 8);
    const distance = Math.max(
      heroRadius * distanceScale,
      Math.min(edgeMap.width, edgeMap.height) * (layer === "support" ? 0.24 : 0.34),
    );
    const x = clamp(heroCenterX + Math.cos(angle) * distance, edgeMap.width * 0.08, edgeMap.width * 0.92);
    const y = clamp(heroCenterY + Math.sin(angle) * distance, edgeMap.height * 0.08, edgeMap.height * 0.92);
    if (inProtectedZone(protectedZones, x, y)) {
      continue;
    }
    if (safeDistance({ x, y }, { x: heroCenterX, y: heroCenterY }) < heroRadius * (layer === "support" ? 0.95 : 1.4)) {
      continue;
    }
    slots.push(
      slotFromPoint(
        x,
        y,
        clamp(heroRadius * radiusScale, layer === "support" ? 26 : 20, layer === "support" ? 96 : 72),
        layer === "support" ? 0.58 : 0.44,
        layer,
        heroCenterX,
        heroCenterY,
      ),
    );
  }
  return slots;
}

function buildBackgroundSlots(
  edgeMap: EdgeMap,
  protectedZones: CompositionZone[],
  heroCenterX: number,
  heroCenterY: number,
  heroRadius: number,
): PlacementSlot[] {
  const slots: PlacementSlot[] = [];
  const candidates = [
    { x: edgeMap.width * 0.12, y: edgeMap.height * 0.18 },
    { x: edgeMap.width * 0.84, y: edgeMap.height * 0.2 },
    { x: edgeMap.width * 0.16, y: edgeMap.height * 0.82 },
    { x: edgeMap.width * 0.86, y: edgeMap.height * 0.8 },
    { x: edgeMap.width * 0.5, y: edgeMap.height * 0.12 },
    { x: edgeMap.width * 0.5, y: edgeMap.height * 0.88 },
  ];
  for (const candidate of candidates) {
    if (inProtectedZone(protectedZones, candidate.x, candidate.y)) {
      continue;
    }
    if (safeDistance(candidate, { x: heroCenterX, y: heroCenterY }) < heroRadius * 1.4) {
      continue;
    }
    slots.push(slotFromPoint(candidate.x, candidate.y, clamp(heroRadius * 0.32, 20, 72), 0.5, "background", heroCenterX, heroCenterY));
    if (slots.length >= 4) {
      break;
    }
  }
  if (slots.length < 2) {
    slots.push(...buildFallbackRadialSlots(edgeMap, protectedZones, heroCenterX, heroCenterY, heroRadius, "background", 2 - slots.length));
  }
  return slots;
}

function computeSupportNearHeroScore(plan: Pick<CompositionPlan, "supportSlots" | "heroCenterX" | "heroCenterY" | "heroRadius">): number {
  if (plan.supportSlots.length === 0) {
    return 0;
  }
  return clamp(
    [...plan.supportSlots]
      .sort((left, right) =>
        Math.hypot(left.x - plan.heroCenterX, left.y - plan.heroCenterY) -
        Math.hypot(right.x - plan.heroCenterX, right.y - plan.heroCenterY))
      .slice(0, 3)
      .reduce((sum, slot) => {
        const distance = Math.hypot(slot.x - plan.heroCenterX, slot.y - plan.heroCenterY);
        const distanceScore = 1 - clamp(distance / Math.max(1, plan.heroRadius * 3.2), 0, 1);
        return sum + distanceScore * clamp(slot.weight, 0.2, 1);
      }, 0) / Math.max(1, Math.min(3, plan.supportSlots.length)),
    0,
    1,
  );
}

function addHeroAdjacentSupportSlots(
  edgeMap: EdgeMap,
  protectedZones: CompositionZone[],
  heroCenterX: number,
  heroCenterY: number,
  heroRadius: number,
  supportSlots: PlacementSlot[],
): PlacementSlot[] {
  const augmented = [...supportSlots];
  const heroAdjacentAngles = [-0.7, 0.7, Math.PI - 0.55, -Math.PI + 0.55];
  for (const angle of heroAdjacentAngles) {
    if (augmented.length >= 5 && computeSupportNearHeroScore({ supportSlots: augmented, heroCenterX, heroCenterY, heroRadius }) >= 0.52) {
      break;
    }
    const distance = heroRadius * 1.55;
    const x = clamp(heroCenterX + Math.cos(angle) * distance, edgeMap.width * 0.1, edgeMap.width * 0.9);
    const y = clamp(heroCenterY + Math.sin(angle) * distance, edgeMap.height * 0.1, edgeMap.height * 0.9);
    if (inProtectedZone(protectedZones, x, y)) {
      continue;
    }
    augmented.push(slotFromPoint(x, y, clamp(heroRadius * 0.34, 28, 92), 0.72, "support", heroCenterX, heroCenterY));
  }
  return augmented;
}

function buildDustSlots(backgroundSlots: PlacementSlot[]): CompositionPlan["dustSlots"] {
  return backgroundSlots.map((slot, index) => ({
    x: slot.x,
    y: slot.y,
    radius: slot.radius * (0.5 + (index % 3) * 0.18),
    weight: slot.weight,
  }));
}

function buildStarSlots(edgeMap: EdgeMap, protectedZones: CompositionZone[], heroCenterX: number, heroCenterY: number): CompositionPlan["starSlots"] {
  const slots: CompositionPlan["starSlots"] = [];
  const columns = 6;
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = ((col + 0.5) / columns) * edgeMap.width;
      const y = ((row + 0.5) / rows) * edgeMap.height;
      if (inProtectedZone(protectedZones, x, y)) {
        continue;
      }
      const distance = Math.hypot(x - heroCenterX, y - heroCenterY);
      if (distance < Math.min(edgeMap.width, edgeMap.height) * 0.18) {
        continue;
      }
      slots.push({ x, y, weight: clamp(distance / Math.max(edgeMap.width, edgeMap.height), 0.2, 1) });
    }
  }
  return slots;
}

export function buildCompositionPlan(edgeMap: EdgeMap, theme: RenderTheme): CompositionPlan {
  return buildCompositionPlanForTheme(edgeMap, theme);
}

export function buildCompositionPlanForTheme(edgeMap: EdgeMap, theme: RenderTheme, themeQuery?: string): CompositionPlan {
  const protectedZones = buildProtectedZones(edgeMap);
  const shotGrammarKey = chooseShotGrammarKey(theme, edgeMap, themeQuery);
  const thirdLeftX = edgeMap.width / 3;
  const thirdRightX = edgeMap.width * (2 / 3);
  const thirdUpperY = edgeMap.height / 3;
  const thirdLowerY = edgeMap.height * (2 / 3);
  const avoidCenteredHero = shouldAvoidCenteredHero(edgeMap, shotGrammarKey);
  const centerPenalty = avoidCenteredHero ? 0.38 : edgeMap.negativeSpaceQuadrant === "center" ? 0.22 : 0.28;
  const asymmetryBias = Math.abs(edgeMap.leftWeight - edgeMap.rightWeight);
  const anchorCandidates = [
    { x: clamp(edgeMap.focalCenterX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(edgeMap.focalCenterY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 1 },
    { x: clamp(thirdLeftX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(edgeMap.focalCenterY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.25 },
    { x: clamp(thirdRightX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(edgeMap.focalCenterY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.25 },
    { x: clamp(edgeMap.focalCenterX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdUpperY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.45 },
    { x: clamp(edgeMap.focalCenterX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdLowerY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.45 },
    { x: clamp(thirdLeftX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdUpperY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.12 },
    { x: clamp(thirdRightX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdUpperY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.12 },
    { x: clamp(thirdLeftX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdLowerY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.12 },
    { x: clamp(thirdRightX, edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxX), y: clamp(thirdLowerY, edgeMap.subjectBounds.minY, edgeMap.subjectBounds.maxY), centerBias: 0.12 },
  ].map((candidate) => {
    const sourceAffinity = 1 - Math.min(1, Math.hypot(candidate.x - edgeMap.focalCenterX, candidate.y - edgeMap.focalCenterY) / Math.max(edgeMap.width, edgeMap.height));
    const asymmetryBonus = candidate.centerBias < 1 ? 0.12 + asymmetryBias * 0.2 : -centerPenalty;
    const grammarBonus =
      shotGrammarKey === "halo-orbital" ? (candidate.y <= edgeMap.height * 0.45 ? 0.05 : -0.1) :
      shotGrammarKey === "corridor-recede" ? (candidate.centerBias < 0.5 ? 0.16 : -0.12) :
      shotGrammarKey === "top-heavy-cascade" ? (candidate.y <= edgeMap.height * 0.44 ? 0.08 : -0.04) :
      shotGrammarKey === "low-stage-push" ? (candidate.y >= edgeMap.height * 0.56 ? 0.1 : -0.05) :
      shotGrammarKey === "split-lane-duel" ? (candidate.centerBias < 0.5 ? 0.16 : -0.14) :
      shotGrammarKey === "shard-fan" ? (candidate.centerBias <= 0.2 ? 0.18 : -0.08) :
      shotGrammarKey === "off-axis-processional" ? (candidate.centerBias <= 0.25 ? 0.16 : -0.06) :
      shotGrammarKey === "arc-sweep-cluster" ? (candidate.centerBias <= 0.25 ? 0.14 : -0.04) :
      0;
    const offAxisPenalty =
      candidate.centerBias >= 1 &&
      shotGrammarKey !== "halo-orbital" &&
      shotGrammarKey !== "top-heavy-cascade"
        ? 0.24
        : 0;
    const avoidCenteredPenalty = avoidCenteredHero && candidate.centerBias >= 1 ? 0.18 : 0;
    const avoidCenteredBonus = avoidCenteredHero && candidate.centerBias <= 0.25 ? 0.06 : 0;
    return {
      ...candidate,
      score: sourceAffinity * 0.48 + asymmetryBonus + grammarBonus + avoidCenteredBonus - offAxisPenalty - avoidCenteredPenalty,
    };
  });
  anchorCandidates.sort((left, right) => right.score - left.score);
  const centeredWinner = anchorCandidates[0]?.centerBias === 1;
  const heroAnchor =
    avoidCenteredHero && centeredWinner
      ? anchorCandidates.find((candidate) => candidate.centerBias < 1) ?? anchorCandidates[0] ?? anchorCandidates[1]!
      : anchorCandidates[0] ?? anchorCandidates[1]!;
  const heroCenterX = heroAnchor.x;
  const heroCenterY = heroAnchor.y;
  const lowEventBoost = edgeMap.complexity < 0.45 ? 1.14 : 1;
  const heroRadius = clamp(
    Math.max(edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX, edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY) * 0.26 * lowEventBoost,
    86,
    Math.min(edgeMap.width, edgeMap.height) * 0.28,
  );
  const contours = chooseContours(edgeMap);
  let supportSlots = buildSupportSlots(edgeMap, protectedZones, heroCenterX, heroCenterY, heroRadius);
  if (supportSlots.length < 2) {
    supportSlots.push(...buildFallbackRadialSlots(edgeMap, protectedZones, heroCenterX, heroCenterY, heroRadius, "support", 2 - supportSlots.length));
  }
  supportSlots = addHeroAdjacentSupportSlots(edgeMap, protectedZones, heroCenterX, heroCenterY, heroRadius, supportSlots);
  supportSlots.sort((left, right) => {
    const leftThirdDistance = Math.min(Math.abs(left.x - thirdLeftX), Math.abs(left.x - thirdRightX));
    const rightThirdDistance = Math.min(Math.abs(right.x - thirdLeftX), Math.abs(right.x - thirdRightX));
    return leftThirdDistance - rightThirdDistance;
  });
  const backgroundSlots = buildBackgroundSlots(edgeMap, protectedZones, heroCenterX, heroCenterY, heroRadius);
  const heroCoverage = Math.PI * heroRadius * heroRadius / Math.max(1, edgeMap.width * edgeMap.height);
  const supportCoverage = supportSlots
    .slice(0, 2)
    .reduce((sum, slot) => sum + (Math.PI * slot.radius * slot.radius / Math.max(1, edgeMap.width * edgeMap.height)), 0);
  const focalOccupancyScore = clamp(heroCoverage + supportCoverage, 0, 1);
  const centerBiasScore = clamp(
    1 - Math.hypot(heroCenterX - edgeMap.width * 0.5, heroCenterY - edgeMap.height * 0.5) / Math.max(edgeMap.width, edgeMap.height),
    0,
    1,
  );
  return {
    imagePath: edgeMap.imagePath,
    heroCenterX,
    heroCenterY,
    heroRadius,
    focalOccupancyScore,
    centerBiasScore,
    shotGrammarKey,
    supportSlots,
    backgroundSlots,
    protectedZones,
    heroContours: contours.heroContours,
    supportContours: contours.supportContours,
    bridgeAnchors: supportSlots.slice(0, 3).map((slot) => ({ x: slot.x, y: slot.y, weight: slot.weight })),
    stylePlacementMode: placementMode(theme, edgeMap),
    dustSlots: buildDustSlots(backgroundSlots),
    starSlots: buildStarSlots(edgeMap, protectedZones, heroCenterX, heroCenterY),
  };
}

export function summarizeCompositionPlan(plan: CompositionPlan): {
  supportSlotCount: number;
  backgroundSlotCount: number;
  protectedArea: number;
} {
  const protectedArea = plan.protectedZones.reduce((sum, zone) => sum + zone.width * zone.height, 0);
  return {
    supportSlotCount: plan.supportSlots.length,
    backgroundSlotCount: plan.backgroundSlots.length,
    protectedArea,
  };
}

export function buildTransitionBridgeState(fromPlan: CompositionPlan, toPlan: CompositionPlan): TransitionBridgeState {
  const protectedZones = [...fromPlan.protectedZones, ...toPlan.protectedZones].slice(0, 4);
  return {
    fromImagePath: fromPlan.imagePath,
    toImagePath: toPlan.imagePath,
    heroFrom: { x: fromPlan.heroCenterX, y: fromPlan.heroCenterY, radius: fromPlan.heroRadius },
    heroTo: { x: toPlan.heroCenterX, y: toPlan.heroCenterY, radius: toPlan.heroRadius },
    supportFrom: fromPlan.supportSlots.slice(0, 3),
    supportTo: toPlan.supportSlots.slice(0, 3),
    protectedZones,
    carryStrength: clamp((fromPlan.supportSlots.length + toPlan.supportSlots.length) / 8, 0.35, 0.88),
  };
}

export function compositionNegativeSpaceOccupancy(
  plan: CompositionPlan,
  points: Array<{ x: number; y: number; layer: PlacementLayer }>,
): number {
  if (points.length === 0) {
    return 0;
  }
  let occupied = 0;
  for (const point of points) {
    if (point.layer === "hero" || point.layer === "support") {
      occupied += inProtectedZone(plan.protectedZones, point.x, point.y) ? 1 : 0;
    } else {
      occupied += inProtectedZone(plan.protectedZones, point.x, point.y) ? 0.35 : 0;
    }
  }
  return clamp(occupied / points.length, 0, 1);
}
