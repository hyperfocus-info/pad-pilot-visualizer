import { clamp } from "../config";
import { classifyHeroMotifIntensity } from "../types";
import type {
  ActiveSubjectSnapshot,
  AudioFrameFeature,
  CompositionPlan,
  DiagnosticOverrides,
  EdgeContour,
  EdgeMap,
  HeroGlyphKind,
  NebulaGlowAnchor,
  MotionScript,
  OccupancyPurpose,
  ParticleAnchorType,
  ParticleMotionMode,
  ParticleShapeMode,
  ParticleSystemState,
  SceneGraph,
  RenderQualityBudget,
  RenderTheme,
  VisualState,
} from "../types";
import { sampleDensityValue, sampleFlowVector } from "./edge-field";
import { hashFloat, sampleNoise2D } from "./noise";
import { stableImageSeed } from "./image-seed";
import { paletteColor, plasmaCoreColor } from "./palette";
import type { ShapeStampAtlas } from "./stamp-atlas";
import { applyParticleBatchWasm } from "../perf/wasm-kernels";

interface Point {
  x: number;
  y: number;
}

interface OccupancyPoint {
  x: number;
  y: number;
  weight: number;
  radius: number;
  layer: "hero" | "support" | "background";
  purpose: OccupancyPurpose;
  motionPx: number;
}

export interface ParticleRenderResult {
  anchors: NebulaGlowAnchor[];
  occupancy: OccupancyPoint[];
  heroCoverage: number;
  backgroundClutterRatio: number;
  supportCoverage: number;
  negativeSpaceOccupancy: number;
  shapePlacementScore: number;
  eventDensity: number;
  emitterUsage: number;
  absorberUsage: number;
  explosionCount: number;
  sourceAffinityAvg: number;
  sourceAffinityHeroAvg: number;
  sourceAffinitySupportAvg: number;
  particleConvergenceScore: number;
  subEmitterChildren: number;
  particleLifecycle: import("../types").ParticleLifecycleStats;
  supportElementDensity: number;
  backgroundElementDensity: number;
  heroIsolationScore: number;
  nearHeroEventDensity: number;
  heroToSupportDistanceScore: number;
  budgetDowngradeCount: number;
  stageMetrics: {
    particlesMs: number;
    occupancyMs: number;
    stampDrawCount: number;
    supportStampDrawCount: number;
    backgroundStampDrawCount: number;
    vectorDrawCount: number;
    occupancyDrawCount: number;
    heroGlyphDrawCount: number;
    gradientCreateCount: number;
    heroMs: number;
    avgSupportMotionPx: number;
    avgBackgroundMotionPx: number;
  };
}

const ANCHOR_TYPES: ParticleAnchorType[] = ["edge", "silhouette", "region"];
const MOTION_MODES: ParticleMotionMode[] = [
  "edge-drift",
  "spiral-in",
  "spiral-out",
  "orbit-hero",
  "dual-attractor",
  "edge-escape",
  "absorb-well",
  "emit-chain",
  "release-bloom",
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
  "mirror-orbit",
  "axis-reflect",
  "kaleido-shear",
  "paired-braid",
  "prism-well",
];
const SHAPE_MODES: ParticleShapeMode[] = ["dot", "ring", "shard", "chevron", "diamond", "arc", "voxel"];
const EDGE_ATTRACTION_FORCE_SCALE = 2.25;
const EDGE_DESTRUCTION_BASES = [
  "circular-burst",
  "poof-cloud",
  "ring-burst",
  "fold-collapse",
  "ash-dissolve",
  "shard-crumble",
  "splatter-spray",
  "pixel-disintegrate",
  "confetti-fountain",
  "ribbon-ascent",
] as const;
const EDGE_DESTRUCTION_FINISHES = ["clean", "neon", "smoky", "glitch", "prismatic"] as const;
type EdgeDestructionBase = typeof EDGE_DESTRUCTION_BASES[number];
type EdgeDestructionFinish = typeof EDGE_DESTRUCTION_FINISHES[number];

function edgeDestructionBaseForMotif(edgeMap: EdgeMap, seed: number): EdgeDestructionBase {
  const motif = edgeMap.fractalMotif;
  const orbitalBases: EdgeDestructionBase[] = ["circular-burst", "ring-burst", "confetti-fountain", "ribbon-ascent"];
  const structuralBases: EdgeDestructionBase[] = ["fold-collapse", "ash-dissolve", "shard-crumble", "pixel-disintegrate"];
  const glitchBases: EdgeDestructionBase[] = ["shard-crumble", "splatter-spray", "pixel-disintegrate", "fold-collapse"];
  const organicBases: EdgeDestructionBase[] = ["poof-cloud", "ash-dissolve", "ribbon-ascent", "splatter-spray"];
  const pool =
    motif === "glass-orbital" || motif === "harmonic-lattice"
      ? orbitalBases
      : motif === "data-cathedral" || motif === "cathedral-filament"
        ? structuralBases
        : motif === "film-bloom-shard" || motif === "neon-tube"
          ? glitchBases
          : organicBases;
  return pool[Math.abs(seed) % pool.length]!;
}

function edgeDestructionFinishForSeed(seed: number): EdgeDestructionFinish {
  return EDGE_DESTRUCTION_FINISHES[Math.abs(seed) % EDGE_DESTRUCTION_FINISHES.length]!;
}

function edgeDestructionCostTier(
  base: EdgeDestructionBase,
  finish: EdgeDestructionFinish,
): "low" | "medium" | "high" {
  if (finish === "prismatic" || base === "splatter-spray" || base === "confetti-fountain") {
    return "high";
  }
  if (base === "poof-cloud" || base === "fold-collapse" || base === "ash-dissolve" || base === "pixel-disintegrate") {
    return "low";
  }
  return "medium";
}

function edgeDestructionDivisor(tier: "low" | "medium" | "high"): number {
  if (tier === "low") {
    return 1;
  }
  if (tier === "medium") {
    return 2;
  }
  return 4;
}

function behaviorFor(sceneGraph: SceneGraph, index: number) {
  return sceneGraph.particleBehaviors[index % Math.max(1, sceneGraph.particleBehaviors.length)];
}

function motionScriptFor(sceneGraph: SceneGraph, index: number): MotionScript {
  return behaviorFor(sceneGraph, index)?.script ?? "follow-hero";
}

function occupancyPurposeFor(sceneGraph: SceneGraph, index: number): OccupancyPurpose {
  return behaviorFor(sceneGraph, index)?.purpose ?? "hero-wake";
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function safeRadius(radius: number, fallback = 1): number {
  if (!Number.isFinite(radius)) {
    return fallback;
  }
  return Math.max(0.001, radius);
}

function anchorTypeName(state: ParticleSystemState, index: number): ParticleAnchorType {
  return ANCHOR_TYPES[state.anchorType[index] ?? 0] ?? "edge";
}

function motionModeName(state: ParticleSystemState, index: number): ParticleMotionMode {
  return MOTION_MODES[state.motionMode[index] ?? 0] ?? "edge-drift";
}

function shapeModeName(state: ParticleSystemState, index: number): ParticleShapeMode {
  return SHAPE_MODES[state.shapeMode[index] ?? 0] ?? "dot";
}

function anchorTypeIndex(value: ParticleAnchorType): number {
  return Math.max(0, ANCHOR_TYPES.indexOf(value));
}

function motionModeIndex(value: ParticleMotionMode): number {
  return Math.max(0, MOTION_MODES.indexOf(value));
}

function shapeModeIndex(value: ParticleShapeMode): number {
  return Math.max(0, SHAPE_MODES.indexOf(value));
}

function tangentFor(contour: EdgeContour, index: number): Point {
  const prev = contour.points[(index - 1 + contour.points.length) % contour.points.length]!;
  const next = contour.points[(index + 1) % contour.points.length]!;
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty) || 1;
  return { x: tx / length, y: ty / length };
}

function createParticleState(capacity = 512): ParticleSystemState {
  return {
    count: 0,
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    age: new Uint16Array(capacity),
    ttl: new Uint16Array(capacity),
    baseSize: new Float32Array(capacity),
    currentSize: new Float32Array(capacity),
    anchorType: new Uint8Array(capacity),
    targetX: new Float32Array(capacity),
    targetY: new Float32Array(capacity),
    tangentX: new Float32Array(capacity),
    tangentY: new Float32Array(capacity),
    edgeWeight: new Float32Array(capacity),
    toneWeight: new Float32Array(capacity),
    curvatureWeight: new Float32Array(capacity),
    brightness: new Float32Array(capacity),
    hueOffset: new Float32Array(capacity),
    motionMode: new Uint8Array(capacity),
    shapeMode: new Uint8Array(capacity),
    phaseOffset: new Float32Array(capacity),
    behaviorTargetA: new Uint16Array(capacity),
    behaviorTargetB: new Uint16Array(capacity),
    orbitScale: new Float32Array(capacity),
    driftScale: new Float32Array(capacity),
    neighborRadius: new Float32Array(capacity),
    cohesion: new Float32Array(capacity),
    alignment: new Float32Array(capacity),
    separation: new Float32Array(capacity),
    linkRadius: new Float32Array(capacity),
    gravityStrength: new Float32Array(capacity),
    bounceDamping: new Float32Array(capacity),
    depthScale: new Float32Array(capacity),
    residueAlpha: new Float32Array(capacity),
    scratchAx: new Float32Array(capacity),
    scratchAy: new Float32Array(capacity),
    scratchDamping: new Float32Array(capacity),
    scratchPulseScale: new Float32Array(capacity),
    scratchRetarget: new Uint8Array(capacity),
    edgeExitFramesRemaining: new Uint8Array(capacity),
    edgeExitTargetX: new Float32Array(capacity),
    edgeExitTargetY: new Float32Array(capacity),
    edgeExitEffectIndex: new Uint8Array(capacity),
    edgeExitPlayed: new Uint8Array(capacity),
    edgeExitDistance: new Float32Array(capacity),
    seed: 0,
    lastFrameIndex: -1,
    lastBeatIndex: -1000,
    cachedOccupancy: [],
    cachedAnchors: [],
    lastBudgetDowngradeCount: 0,
  };
}

function chooseAnchorType(index: number, total: number): ParticleAnchorType {
  const ratio = index / Math.max(1, total);
  if (ratio < 0.45) {
    return "silhouette";
  }
  if (ratio < 0.8) {
    return "edge";
  }
  return "region";
}

function chooseMotionMode(anchorType: ParticleAnchorType, seed: number): ParticleMotionMode {
  if (anchorType === "silhouette") {
    return hashFloat(seed + 3) > 0.45 ? "orbit-hero" : "spiral-in";
  }
  return MOTION_MODES[Math.floor(hashFloat(seed + 5) * MOTION_MODES.length) % MOTION_MODES.length]!;
}

function chooseShapeMode(anchorType: ParticleAnchorType, seed: number): ParticleShapeMode {
  if (anchorType === "silhouette") {
    return hashFloat(seed + 7) > 0.5 ? "shard" : "ring";
  }
  return SHAPE_MODES[Math.floor(hashFloat(seed + 11) * SHAPE_MODES.length) % SHAPE_MODES.length]!;
}

function isInsideNegativeSpace(edgeMap: EdgeMap, x: number, y: number): boolean {
  switch (edgeMap.negativeSpaceQuadrant) {
    case "tl":
      return x < edgeMap.width * 0.45 && y < edgeMap.height * 0.45;
    case "tr":
      return x > edgeMap.width * 0.55 && y < edgeMap.height * 0.45;
    case "bl":
      return x < edgeMap.width * 0.45 && y > edgeMap.height * 0.55;
    case "br":
      return x > edgeMap.width * 0.55 && y > edgeMap.height * 0.55;
    case "center":
    default:
      return Math.abs(x - edgeMap.width * 0.5) < edgeMap.width * 0.16 && Math.abs(y - edgeMap.height * 0.5) < edgeMap.height * 0.16;
  }
}

function heroRadius(edgeMap: EdgeMap): number {
  const spreadX = edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX;
  const spreadY = edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY;
  return clamp(Math.max(spreadX, spreadY) * 0.34, 120, Math.min(edgeMap.width, edgeMap.height) * 0.28);
}

function layerForParticle(state: ParticleSystemState, edgeMap: EdgeMap, index: number): "hero" | "support" | "background" {
  const dx = state.targetX[index]! - edgeMap.focalCenterX;
  const dy = state.targetY[index]! - edgeMap.focalCenterY;
  const distance = Math.hypot(dx, dy);
  const anchorType = anchorTypeName(state, index);
  if (distance <= heroRadius(edgeMap) || anchorType === "silhouette") {
    return "hero";
  }
  if (anchorType === "region" || state.toneWeight[index]! > 0.65) {
    return "support";
  }
  return "background";
}

function sampleContrastValue(edgeMap: EdgeMap, x: number, y: number): number {
  const field = edgeMap.toneField;
  const gx = clamp(Math.floor(x / Math.max(1, field.cellWidth)), 0, field.gridWidth - 1);
  const gy = clamp(Math.floor(y / Math.max(1, field.cellHeight)), 0, field.gridHeight - 1);
  const index = gy * field.gridWidth + gx;
  return clamp(field.contrast[index] ?? 0, 0, 1);
}

function sampleLuminanceGradient(edgeMap: EdgeMap, x: number, y: number): number {
  const field = edgeMap.toneField;
  const gx = clamp(Math.floor(x / Math.max(1, field.cellWidth)), 1, field.gridWidth - 2);
  const gy = clamp(Math.floor(y / Math.max(1, field.cellHeight)), 1, field.gridHeight - 2);
  const index = gy * field.gridWidth + gx;
  const left = field.luminance[index - 1] ?? 0;
  const right = field.luminance[index + 1] ?? 0;
  const up = field.luminance[index - field.gridWidth] ?? 0;
  const down = field.luminance[index + field.gridWidth] ?? 0;
  return clamp(Math.hypot(right - left, down - up) * 2.5, 0, 1);
}

function sourceAffinityForPoint(
  edgeMap: EdgeMap,
  sceneGraph: SceneGraph,
  compositionPlan: CompositionPlan,
  x: number,
  y: number,
  layer: "hero" | "support" | "background",
): number {
  const profile = sceneGraph.sourceAttractorProfile;
  const mask = sampleDensityValue(edgeMap.subjectMask, x, y);
  const density = sampleDensityValue(edgeMap.densityField, x, y);
  const contrast = sampleContrastValue(edgeMap, x, y);
  const luminanceGradient = sampleLuminanceGradient(edgeMap, x, y);
  const focalDistance = Math.hypot(x - edgeMap.focalCenterX, y - edgeMap.focalCenterY) / Math.max(1, edgeMap.focalSpread * 1.8);
  const supportDistance = compositionPlan.supportSlots.length === 0
    ? 1
    : Math.min(...compositionPlan.supportSlots.map((slot) => Math.hypot(slot.x - x, slot.y - y) / Math.max(1, slot.radius * 1.8)));
  const silhouetteBoost = edgeMap.silhouetteContours.length > 0 ? clamp(density * 0.6 + mask * 0.4, 0, 1) : 0;
  const layerScale = layer === "background" ? 0.58 : layer === "support" ? 0.88 : 1;
  return clamp(
    (
      mask * profile.mask +
      density * profile.edgeDensity +
      contrast * profile.contrast +
      luminanceGradient * profile.luminanceGradient +
      (1 - clamp(focalDistance, 0, 1)) * profile.focalDistance +
      (1 - clamp(supportDistance, 0, 1)) * profile.supportLaneBoost +
      silhouetteBoost * profile.silhouetteBoost
    ) * layerScale,
    0,
    1,
  );
}

function contourSource(edgeMap: EdgeMap, anchorType: ParticleAnchorType): EdgeContour[] {
  if (anchorType === "silhouette" && edgeMap.silhouetteContours.length > 0) {
    return edgeMap.silhouetteContours;
  }
  return edgeMap.contours.length > 0 ? edgeMap.contours : edgeMap.silhouetteContours;
}

function retargetParticle(
  state: ParticleSystemState,
  index: number,
  edgeMap: EdgeMap,
  compositionPlan: CompositionPlan,
  sceneGraph: SceneGraph,
  seed: number,
  anchorType = anchorTypeName(state, index),
): void {
  state.anchorType[index] = anchorTypeIndex(anchorType);
  if (anchorType === "edge" && compositionPlan.backgroundSlots.length > 0) {
    const slots = compositionPlan.backgroundSlots
      .map((slot) => ({
        slot,
        score: slot.weight * 0.45 + sourceAffinityForPoint(edgeMap, sceneGraph, compositionPlan, slot.x, slot.y, "background") * 0.55,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(3, compositionPlan.backgroundSlots.length));
    const slot = slots[Math.floor(hashFloat(seed + 29) * slots.length) % slots.length]!.slot;
    state.targetX[index] = slot.x;
    state.targetY[index] = slot.y;
    state.tangentX[index] = Math.cos(slot.angle + Math.PI * 0.5);
    state.tangentY[index] = Math.sin(slot.angle + Math.PI * 0.5);
    state.edgeWeight[index] = slot.weight * 0.5;
    state.toneWeight[index] = slot.weight * 0.7;
    state.curvatureWeight[index] = 0.18;
    return;
  }
  if (anchorType === "region" && compositionPlan.supportSlots.length > 0) {
    const slots = compositionPlan.supportSlots
      .map((slot) => ({
        slot,
        score: slot.weight * 0.4 + sourceAffinityForPoint(edgeMap, sceneGraph, compositionPlan, slot.x, slot.y, "support") * 0.6,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(4, compositionPlan.supportSlots.length));
    const slot = slots[Math.floor(hashFloat(seed) * slots.length) % slots.length]!.slot;
    state.targetX[index] = slot.x;
    state.targetY[index] = slot.y;
    state.tangentX[index] = Math.cos(slot.angle + Math.PI * 0.5);
    state.tangentY[index] = Math.sin(slot.angle + Math.PI * 0.5);
    state.edgeWeight[index] = slot.weight * 0.45;
    state.toneWeight[index] = slot.weight;
    state.curvatureWeight[index] = 0.24;
    return;
  }
  if (anchorType === "region" && edgeMap.regionAnchors.length > 0) {
    const anchors = edgeMap.regionAnchors
      .map((anchor) => ({
        anchor,
        score: anchor.weight * 0.4 + sourceAffinityForPoint(edgeMap, sceneGraph, compositionPlan, anchor.x, anchor.y, "support") * 0.6,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(6, edgeMap.regionAnchors.length));
    const anchor = anchors[Math.floor(hashFloat(seed) * anchors.length) % anchors.length]!.anchor;
    state.targetX[index] = anchor.x;
    state.targetY[index] = anchor.y;
    state.tangentX[index] = anchor.tx;
    state.tangentY[index] = anchor.ty;
    state.edgeWeight[index] = anchor.weight * 0.5;
    state.toneWeight[index] = anchor.weight;
    state.curvatureWeight[index] = 0.2;
    return;
  }

  const contours = contourSource(edgeMap, anchorType);
  if (contours.length > 0) {
    const scoredContours = contours
      .map((contour, contourIndex) => {
        const pointIndex = Math.floor(hashFloat(seed + 17 + contourIndex) * contour.points.length) % contour.points.length;
        const point = contour.points[pointIndex]!;
        return {
          contour,
          pointIndex,
          score:
            clamp(contour.strength / 255, 0.2, 1.4) * 0.45 +
            sourceAffinityForPoint(edgeMap, sceneGraph, compositionPlan, point.x, point.y, anchorType === "silhouette" ? "hero" : "support") * 0.55,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(4, contours.length));
    const selected = scoredContours[Math.floor(hashFloat(seed + 11) * scoredContours.length) % scoredContours.length]!;
    const contour = selected.contour;
    const pointIndex = selected.pointIndex;
    const point = contour.points[pointIndex]!;
    const tangent = tangentFor(contour, pointIndex);
    state.targetX[index] = point.x;
    state.targetY[index] = point.y;
    state.tangentX[index] = tangent.x;
    state.tangentY[index] = tangent.y;
    state.edgeWeight[index] = clamp(contour.strength / 255, 0.2, 1.4);
    state.toneWeight[index] = sampleDensityValue(edgeMap.densityField, point.x, point.y);
    state.curvatureWeight[index] = Math.abs(point.curvature);
    return;
  }

  const fallback = edgeMap.spawners[Math.floor(hashFloat(seed + 23) * edgeMap.spawners.length) % Math.max(1, edgeMap.spawners.length)] ?? {
    x: edgeMap.width * 0.5,
    y: edgeMap.height * 0.5,
    tx: 1,
    ty: 0,
    weight: 1,
  };
  state.targetX[index] = fallback.x;
  state.targetY[index] = fallback.y;
  state.tangentX[index] = fallback.tx;
  state.tangentY[index] = fallback.ty;
  state.edgeWeight[index] = fallback.weight;
  state.toneWeight[index] = fallback.weight;
  state.curvatureWeight[index] = 0.1;
}

function retargetHeroToActiveSubject(
  state: ParticleSystemState,
  index: number,
  edgeMap: EdgeMap,
  sceneGraph: SceneGraph,
  activeSubject: ActiveSubjectSnapshot,
  seed: number,
): void {
  const orbitAngle = hashFloat(seed + 13) * Math.PI * 2 + activeSubject.motionPx * 0.02;
  const orbitRadius = activeSubject.mode === "orbit" ? activeSubject.emphasis * 38 + 26 : activeSubject.emphasis * 24 + 12;
  const leadScale = activeSubject.mode === "strike" ? 18 : 10;
  const socketMode = sceneGraph.heroEmissionMode;
  const socketAngle =
    socketMode === "crown-spray" ? -Math.PI / 2 :
    socketMode === "hand-cascade" ? (index % 2 === 0 ? Math.PI * 0.88 : Math.PI * 0.12) :
    socketMode === "spine-fountain" ? Math.PI / 2 :
    socketMode === "mouth-flare" ? 0 :
    socketMode === "orbit-shed" ? orbitAngle :
    -Math.PI / 2;
  const socketRadius =
    socketMode === "spine-fountain" ? orbitRadius * 0.48 :
    socketMode === "hand-cascade" ? orbitRadius * 0.82 :
    socketMode === "mouth-flare" ? orbitRadius * 0.34 :
    socketMode === "orbit-shed" ? orbitRadius :
    orbitRadius * 0.58;
  const socketOffsetX = Math.cos(socketAngle) * socketRadius;
  const socketOffsetY = Math.sin(socketAngle) * socketRadius * (socketMode === "orbit-shed" ? 0.85 : 0.6);
  const leadX = socketOffsetX + Math.cos(orbitAngle) * orbitRadius * 0.22 + Math.min(leadScale, activeSubject.motionPx) * (activeSubject.mode === "strike" ? 1 : 0.45);
  const leadY = socketOffsetY + Math.sin(orbitAngle) * orbitRadius * (activeSubject.mode === "orbit" ? 0.85 : 0.32);
  state.anchorType[index] = anchorTypeIndex(activeSubject.mode === "orbit" ? "region" : "silhouette");
  state.targetX[index] = clamp(activeSubject.x + leadX, 0, edgeMap.width);
  state.targetY[index] = clamp(activeSubject.y + leadY, 0, edgeMap.height);
  const dx = state.targetX[index]! - state.x[index]!;
  const dy = state.targetY[index]! - state.y[index]!;
  const length = Math.hypot(dx, dy) || 1;
  state.tangentX[index] = dx / length;
  state.tangentY[index] = dy / length;
  state.edgeWeight[index] = clamp(0.7 + activeSubject.emphasis * 0.9, 0.5, 1.6);
  state.toneWeight[index] = clamp(0.65 + activeSubject.emphasis * 0.6, 0.5, 1.4);
  state.curvatureWeight[index] = clamp(0.18 + activeSubject.emphasis * 0.3, 0.18, 0.75);
}

function initializeSystem(
  state: ParticleSystemState,
  edgeMap: EdgeMap,
  compositionPlan: CompositionPlan,
  sceneGraph: SceneGraph,
  diagnosticOverrides?: DiagnosticOverrides,
): void {
  const particleSpawnScale = diagnosticOverrides?.particleSpawnScale ?? 1;
  const rawCount = edgeMap.regionAnchors.length * 4 + edgeMap.silhouetteContours.length * 8 + 54;
  const count = Math.max(76, Math.min(state.capacity, Math.round(rawCount * 0.8 * particleSpawnScale)));
  state.count = count;
  for (let index = 0; index < count; index += 1) {
    const anchorType = chooseAnchorType(index, count);
    const seed = state.seed + index * 37;
    state.vx[index] = 0;
    state.vy[index] = 0;
    state.age[index] = Math.floor(hashFloat(seed + 13) * 40);
    state.ttl[index] = Math.max(48, Math.round((90 + Math.floor(hashFloat(seed + 19) * 150)) * 0.9));
    state.baseSize[index] = 3 + hashFloat(seed + 29) * 8;
    state.currentSize[index] = 4;
    state.anchorType[index] = anchorTypeIndex(anchorType);
    state.targetX[index] = edgeMap.width * 0.5;
    state.targetY[index] = edgeMap.height * 0.5;
    state.tangentX[index] = 1;
    state.tangentY[index] = 0;
    state.edgeWeight[index] = 0.4;
    state.toneWeight[index] = 0.4;
    state.curvatureWeight[index] = 0.1;
    state.brightness[index] = 0.4 + hashFloat(seed + 31) * 0.6;
    state.hueOffset[index] = hashFloat(seed + 41);
    state.motionMode[index] = motionModeIndex(chooseMotionMode(anchorType, seed));
    state.shapeMode[index] = shapeModeIndex(chooseShapeMode(anchorType, seed));
    state.phaseOffset[index] = hashFloat(seed + 59) * Math.PI * 2;
    const behavior = sceneGraph.particleBehaviors[index % sceneGraph.particleBehaviors.length]!;
    state.motionMode[index] = motionModeIndex(behavior.mode);
    state.shapeMode[index] = shapeModeIndex(behavior.shape);
    state.behaviorTargetA[index] = behavior.targetA;
    state.behaviorTargetB[index] = behavior.targetB;
    state.orbitScale[index] = behavior.orbitScale;
    state.driftScale[index] = behavior.driftScale;
    state.neighborRadius[index] = behavior.behaviorTuning?.neighborRadius ?? 48;
    state.cohesion[index] = behavior.behaviorTuning?.cohesion ?? 0.26;
    state.alignment[index] = behavior.behaviorTuning?.alignment ?? 0.22;
    state.separation[index] = behavior.behaviorTuning?.separation ?? 0.3;
    state.linkRadius[index] = behavior.behaviorTuning?.linkRadius ?? 56;
    state.gravityStrength[index] = behavior.behaviorTuning?.gravityStrength ?? 0.6;
    state.bounceDamping[index] = behavior.behaviorTuning?.bounceDamping ?? 0.82;
    state.depthScale[index] = behavior.behaviorTuning?.depthScale ?? 0.5;
    state.residueAlpha[index] = behavior.behaviorTuning?.residueAlpha ?? 0.08;
    retargetParticle(state, index, edgeMap, compositionPlan, sceneGraph, seed, anchorType);
    state.x[index] = state.targetX[index]! + (hashFloat(seed + 47) - 0.5) * 40;
    state.y[index] = state.targetY[index]! + (hashFloat(seed + 53) - 0.5) * 40;
  }
}

function maybeRetarget(state: ParticleSystemState, edgeMap: EdgeMap, compositionPlan: CompositionPlan, sceneGraph: SceneGraph, frame: AudioFrameFeature): void {
  if (frame.beatPhase >= 0.08 || frame.frameIndex - state.lastBeatIndex <= 2) {
    return;
  }
  state.lastBeatIndex = frame.frameIndex;
  const ratio = 0.18 + frame.beatPulse * 0.08;
  const retargetCount = Math.max(1, Math.floor(state.count * ratio));
  for (let index = 0; index < retargetCount; index += 1) {
    const particleIndex = Math.floor(hashFloat(state.seed + frame.frameIndex * 17 + index * 13) * state.count) % state.count;
    retargetParticle(state, particleIndex, edgeMap, compositionPlan, sceneGraph, state.seed + frame.frameIndex * 97 + index * 11);
  }
}

function maybeRetargetTowardActiveSubject(
  state: ParticleSystemState,
  edgeMap: EdgeMap,
  sceneGraph: SceneGraph,
  frame: AudioFrameFeature,
  activeSubject?: ActiveSubjectSnapshot,
): void {
  if (!activeSubject || !["sway", "windup", "strike", "orbit"].includes(activeSubject.mode)) {
    return;
  }
  const ratioBase =
    activeSubject.mode === "strike" ? 0.2 :
    activeSubject.mode === "orbit" ? 0.16 :
    activeSubject.mode === "windup" ? 0.13 :
    0.1;
  const ratio = clamp(ratioBase + frame.beatPulse * 0.12 + frame.peakStrength * 0.18, 0.08, 0.42);
  const retargetCount = Math.max(1, Math.floor(state.count * ratio));
  for (let index = 0; index < retargetCount; index += 1) {
    const particleIndex = Math.floor(hashFloat(state.seed + frame.frameIndex * 29 + index * 19) * state.count) % state.count;
    const anchorType = anchorTypeName(state, particleIndex);
    if (anchorType === "silhouette" || (anchorType === "region" && index % 5 === 0)) {
      retargetHeroToActiveSubject(state, particleIndex, edgeMap, sceneGraph, activeSubject, state.seed + sceneGraph.continuitySeed + frame.frameIndex * 131 + index * 17);
    }
  }
}

function shouldIntegrateParticle(frame: AudioFrameFeature, anchorType: ParticleAnchorType): boolean {
  switch (anchorType) {
    case "silhouette":
      return true;
    case "region":
      return frame.frameIndex % (frame.peakStrength > 0.42 ? 1 : 2) === 0;
    case "edge":
    default:
      return frame.frameIndex % (frame.narrativeIntensity < 0.3 ? 3 : 2) === 0;
  }
}

function slotDistanceScore(x: number, y: number, plan: CompositionPlan, layer: "hero" | "support" | "background"): number {
  const slots = layer === "hero"
    ? [{ x: plan.heroCenterX, y: plan.heroCenterY, radius: plan.heroRadius, weight: 1, layer: "hero", angle: 0 }]
    : layer === "support"
      ? plan.supportSlots
      : plan.backgroundSlots;
  if (slots.length === 0) {
    return 0.35;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    best = Math.min(best, Math.hypot(slot.x - x, slot.y - y) / Math.max(1, slot.radius));
  }
  return clamp(1 - best * 0.35, 0, 1);
}

function prepareParticleIntegration(
  state: ParticleSystemState,
  index: number,
  edgeMap: EdgeMap,
  compositionPlan: CompositionPlan,
  sceneGraph: SceneGraph,
  frame: AudioFrameFeature,
  seed: number,
): void {
  const x = state.x[index]!;
  const y = state.y[index]!;
  const targetX = state.targetX[index]!;
  const targetY = state.targetY[index]!;
  const tangentX = state.tangentX[index]!;
  const tangentY = state.tangentY[index]!;
  const edgeWeight = state.edgeWeight[index]!;
  const curvatureWeight = state.curvatureWeight[index]!;
  const flow = sampleFlowVector(edgeMap.flowField, x, y);
  const toTargetX = targetX - x;
  const toTargetY = targetY - y;
  const distance = Math.hypot(toTargetX, toTargetY) || 1;
  const fromHeroX = x - compositionPlan.heroCenterX;
  const fromHeroY = y - compositionPlan.heroCenterY;
  const heroDistance = Math.hypot(fromHeroX, fromHeroY) || 1;
  const anchorType = anchorTypeName(state, index);
  const layer = layerForParticle(state, edgeMap, index);
  const sourceAffinity = sourceAffinityForPoint(edgeMap, sceneGraph, compositionPlan, x, y, layer);
  const edgeAttachmentScale =
    anchorType === "silhouette"
      ? EDGE_ATTRACTION_FORCE_SCALE
      : anchorType === "edge"
        ? 1 + (EDGE_ATTRACTION_FORCE_SCALE - 1) * 0.85
        : layer === "support"
          ? 1 + (EDGE_ATTRACTION_FORCE_SCALE - 1) * 0.5
          : 1;
  const targetPullScale = (0.85 + frame.beatPulse * 0.45) * (1 + sourceAffinity * 0.45) * edgeAttachmentScale;
  const noiseSuppression = 1 - sourceAffinity * 0.72;
  const noiseX = sampleNoise2D(seed * 0.01, frame.timeSec * 0.16, seed + 19) * 0.06 * noiseSuppression;
  const noiseY = sampleNoise2D(seed * 0.015, frame.timeSec * 0.13, seed + 31) * 0.06 * noiseSuppression;
  const motionMode = motionModeName(state, index);
  const outwardScale = anchorType === "silhouette" ? 0 : clamp(1 - heroDistance / Math.max(1, compositionPlan.heroRadius * 2.3), 0, 1) * (1 - sourceAffinity * 0.45);
  const outwardX = (fromHeroX / heroDistance) * (0.42 + edgeWeight * 0.12) * outwardScale;
  const outwardY = (fromHeroY / heroDistance) * (0.42 + edgeWeight * 0.12) * outwardScale;
  const orbitX = (-fromHeroY / heroDistance) * 0.22 * outwardScale;
  const orbitY = (fromHeroX / heroDistance) * 0.22 * outwardScale;
  const supportA = sceneGraph.supportAttractors[state.behaviorTargetA[index]! % Math.max(1, sceneGraph.supportAttractors.length)] ?? compositionPlan.supportSlots[0];
  const supportB = (
    sceneGraph.backgroundAttractors[state.behaviorTargetB[index]! % Math.max(1, sceneGraph.backgroundAttractors.length)] ??
    sceneGraph.supportAttractors[state.behaviorTargetB[index]! % Math.max(1, sceneGraph.supportAttractors.length)]
  ) ?? compositionPlan.supportSlots[1] ?? compositionPlan.supportSlots[0];
  const toSupportAX = supportA ? supportA.x - x : 0;
  const toSupportAY = supportA ? supportA.y - y : 0;
  const supportALen = Math.hypot(toSupportAX, toSupportAY) || 1;
  const toSupportBX = supportB ? supportB.x - x : 0;
  const toSupportBY = supportB ? supportB.y - y : 0;
  const supportBLen = Math.hypot(toSupportBX, toSupportBY) || 1;
  const orbitScale = state.orbitScale[index] || 1;
  const driftScale = state.driftScale[index] || 1;
  const motionScript = motionScriptFor(sceneGraph, index);
  const episodeSeed = sceneGraph.episodeSeed;
  const barPulse = frame.barPulse ?? 0;
  const phrasePulse = frame.phrasePulse ?? 0;
  const emitterEvent = episodeSeed.accentModes.includes("emitters") && ((frame.isBeatAccent && frame.beatPulse > 0.54) || barPulse > 0.32);
  const absorberEvent = episodeSeed.accentModes.includes("absorbers") && ((frame.isBeatAccent && frame.beatPulse > 0.48) || barPulse > 0.28 || phrasePulse > 0.22);
  const releaseEvent = episodeSeed.accentModes.includes("burst-gate") && (frame.isFourBarDownbeat || frame.isBeatAccent || phrasePulse > 0.4);
  let motionAx = 0;
  let motionAy = 0;
  const neighborRadius = state.neighborRadius[index] ?? 48;
  const cohesion = state.cohesion[index] ?? 0.26;
  const alignment = state.alignment[index] ?? 0.22;
  const separation = state.separation[index] ?? 0.3;
  const linkRadius = state.linkRadius[index] ?? 56;
  const gravityStrength = state.gravityStrength[index] ?? 0.6;
  const bounceDamping = state.bounceDamping[index] ?? 0.82;
  const depthScale = state.depthScale[index] ?? 0.5;
  switch (motionMode) {
    case "edge-drift":
      motionAx += tangentX * (0.52 * driftScale) + outwardX * (1.75 * driftScale);
      motionAy += tangentY * (0.52 * driftScale) + outwardY * (1.75 * driftScale);
      break;
    case "spiral-in":
      motionAx += (toTargetX / distance) * 0.45 + orbitX * (0.95 * orbitScale);
      motionAy += (toTargetY / distance) * 0.45 + orbitY * (0.95 * orbitScale);
      break;
    case "spiral-out":
      motionAx += outwardX * (1.8 * driftScale) + orbitX * (0.8 * orbitScale);
      motionAy += outwardY * (1.8 * driftScale) + orbitY * (0.8 * orbitScale);
      break;
    case "orbit-hero":
      motionAx += orbitX * (1.5 * orbitScale) + outwardX * 0.2;
      motionAy += orbitY * (1.5 * orbitScale) + outwardY * 0.2;
      break;
    case "mirror-orbit": {
      const mirrorX = edgeMap.width - state.targetX[index]!;
      const mirrorY = state.targetY[index]!;
      const toMirrorX = mirrorX - x;
      const toMirrorY = mirrorY - y;
      const mirrorDistance = Math.hypot(toMirrorX, toMirrorY) || 1;
      motionAx += orbitX * (1.1 * orbitScale) + (toMirrorX / mirrorDistance) * 0.42;
      motionAy += orbitY * (1.1 * orbitScale) + (toMirrorY / mirrorDistance) * 0.42;
      break;
    }
    case "dual-attractor":
      motionAx += (toSupportAX / supportALen) * 0.34 - (toSupportBX / supportBLen) * 0.28 + tangentX * (0.22 * driftScale);
      motionAy += (toSupportAY / supportALen) * 0.34 - (toSupportBY / supportBLen) * 0.28 + tangentY * (0.22 * driftScale);
      break;
    case "axis-reflect": {
      const axisCenterX = edgeMap.width * 0.5;
      const axisCenterY = edgeMap.height * 0.5;
      const reflectX = axisCenterX + (axisCenterX - x);
      const reflectY = axisCenterY + (axisCenterY - y) * 0.35;
      const reflectDx = reflectX - x;
      const reflectDy = reflectY - y;
      const reflectDistance = Math.hypot(reflectDx, reflectDy) || 1;
      motionAx += (reflectDx / reflectDistance) * 0.62 + tangentX * 0.2;
      motionAy += (reflectDy / reflectDistance) * 0.62 + tangentY * 0.2;
      break;
    }
    case "edge-escape":
      motionAx += outwardX * (2.1 * driftScale) + tangentX * (0.34 * driftScale);
      motionAy += outwardY * (2.1 * driftScale) + tangentY * (0.34 * driftScale);
      break;
    case "absorb-well":
      motionAx += (toSupportAX / supportALen) * (0.7 + episodeSeed.absorberBias * 0.4) - outwardX * 0.22;
      motionAy += (toSupportAY / supportALen) * (0.7 + episodeSeed.absorberBias * 0.4) - outwardY * 0.22;
      break;
    case "emit-chain":
      motionAx += outwardX * (2 + episodeSeed.emitterBias * 0.6) + tangentX * 0.45;
      motionAy += outwardY * (2 + episodeSeed.emitterBias * 0.6) + tangentY * 0.45;
      break;
    case "release-bloom":
      motionAx += outwardX * (2.2 + episodeSeed.explosionBias * 0.5) + orbitX * 0.45;
      motionAy += outwardY * (2.2 + episodeSeed.explosionBias * 0.5) + orbitY * 0.45;
      break;
    case "flock-curl": {
      let neighborCount = 0;
      let centerX = 0;
      let centerY = 0;
      let alignX = 0;
      let alignY = 0;
      let separateX = 0;
      let separateY = 0;
      let closestDistance = neighborRadius;
      for (let other = 0; other < state.count && neighborCount < 8; other += 1) {
        if (other === index) {
          continue;
        }
        const dx = state.x[other]! - x;
        const dy = state.y[other]! - y;
        const distanceOther = Math.hypot(dx, dy);
        if (distanceOther <= 0.001 || distanceOther > neighborRadius) {
          continue;
        }
        neighborCount += 1;
        closestDistance = Math.min(closestDistance, distanceOther);
        centerX += state.x[other]!;
        centerY += state.y[other]!;
        alignX += state.vx[other]!;
        alignY += state.vy[other]!;
        const separationWeight = 1 - clamp(distanceOther / Math.max(1, neighborRadius), 0, 1);
        separateX -= (dx / distanceOther) * separationWeight;
        separateY -= (dy / distanceOther) * separationWeight;
      }
      if (neighborCount > 0) {
        centerX = centerX / neighborCount - x;
        centerY = centerY / neighborCount - y;
        alignX /= neighborCount;
        alignY /= neighborCount;
        const clusterTightness = 1 - clamp(closestDistance / Math.max(1, neighborRadius), 0, 1);
        const heroLeadWeight = frame.motionEnergy > 0.34 ? 0.18 + frame.motionEnergy * 0.08 : 0;
        motionAx += centerX * 0.012 * cohesion + alignX * 0.024 * alignment + separateX * 0.072 * separation + tangentX * (0.12 + clusterTightness * 0.08) + (toTargetX / distance) * heroLeadWeight;
        motionAy += centerY * 0.012 * cohesion + alignY * 0.024 * alignment + separateY * 0.072 * separation + tangentY * (0.12 + clusterTightness * 0.08) + (toTargetY / distance) * heroLeadWeight;
      }
      break;
    }
    case "flow-advect": {
      const curlAngle = sampleNoise2D(x * 0.003 + frame.timeSec * 0.35, y * 0.003 - frame.timeSec * 0.28, seed + 71) * Math.PI * 2;
      const curlX = Math.cos(curlAngle);
      const curlY = Math.sin(curlAngle);
      const supportEddyX = (-toSupportAY / supportALen) * 0.22 + (toSupportBY / supportBLen) * 0.12;
      const supportEddyY = (toSupportAX / supportALen) * 0.22 - (toSupportBX / supportBLen) * 0.12;
      const flowStrength = 1.18 + driftScale * 0.42 + frame.normalizedMid * 0.18 + frame.normalizedHighMid * 0.12;
      motionAx += flow.x * flowStrength + curlX * 0.24 + supportEddyX + tangentX * 0.1;
      motionAy += flow.y * flowStrength + curlY * 0.24 + supportEddyY + tangentY * 0.1;
      break;
    }
    case "plexus-link":
      motionAx += (toSupportAX / supportALen) * 0.16 + (toSupportBX / supportBLen) * 0.08 + tangentX * 0.24;
      motionAy += (toSupportAY / supportALen) * 0.16 + (toSupportBY / supportBLen) * 0.08 + tangentY * 0.24;
      break;
    case "gravity-orrery": {
      const gravA = 1 / Math.max(0.2, supportALen * 0.04);
      const gravB = 1 / Math.max(0.2, supportBLen * 0.04);
      const orbitMix = 0.18 + orbitScale * 0.12;
      motionAx += (toSupportAX / supportALen) * gravA * gravityStrength - (toSupportBX / supportBLen) * gravB * gravityStrength * 0.6 + (-toSupportAY / supportALen) * orbitMix;
      motionAy += (toSupportAY / supportALen) * gravA * gravityStrength - (toSupportBY / supportBLen) * gravB * gravityStrength * 0.6 + (toSupportAX / supportALen) * orbitMix;
      break;
    }
    case "ribbon-trace":
      motionAx += tangentX * (0.8 + orbitScale * 0.22) + (toTargetX / distance) * 0.22 + flow.x * 0.08;
      motionAy += tangentY * (0.8 + orbitScale * 0.22) + (toTargetY / distance) * 0.22 + flow.y * 0.08;
      break;
    case "kaleido-shear": {
      const shear = Math.sin(frame.timeSec * 3.2 + seed * 0.001) * 0.7;
      motionAx += tangentX * (0.52 + orbitScale * 0.18) + flow.y * 0.24 * shear;
      motionAy += tangentY * (0.52 + orbitScale * 0.18) + flow.x * 0.24 * -shear;
      break;
    }
    case "lifecycle-morph": {
      const lifeRatio = clamp(state.age[index]! / Math.max(1, state.ttl[index]!), 0, 1);
      const morphBoost = lifeRatio < 0.33 ? 1.16 : lifeRatio < 0.72 ? 0.94 : 0.72;
      motionAx += tangentX * 0.34 * morphBoost + flow.x * 0.28 + outwardX * (0.24 - lifeRatio * 0.08);
      motionAy += tangentY * 0.34 * morphBoost + flow.y * 0.28 + outwardY * (0.24 - lifeRatio * 0.08);
      break;
    }
    case "paired-braid":
      motionAx += tangentX * (0.7 + driftScale * 0.16) + (toSupportAX / supportALen) * 0.18 - (toSupportBX / supportBLen) * 0.1;
      motionAy += tangentY * (0.7 + driftScale * 0.16) + (toSupportAY / supportALen) * 0.18 - (toSupportBY / supportBLen) * 0.1;
      break;
    case "shell-bounce":
      motionAx += outwardX * 0.18 + tangentX * 0.18;
      motionAy += outwardY * 0.18 + tangentY * 0.18;
      if (heroDistance < compositionPlan.heroRadius * 0.9) {
        const normalX = fromHeroX / heroDistance;
        const normalY = fromHeroY / heroDistance;
        const tangentBounceX = -normalY;
        const tangentBounceY = normalX;
        motionAx += normalX * bounceDamping * 1.1 + tangentBounceX * 0.16;
        motionAy += normalY * bounceDamping * 1.1 + tangentBounceY * 0.16;
      }
      break;
    case "voxel-depth":
      motionAx += tangentX * 0.2 + flow.x * 0.18 + outwardX * 0.1;
      motionAy += tangentY * 0.2 + flow.y * 0.18 + outwardY * 0.1;
      state.scratchPulseScale[index] = clamp((state.scratchPulseScale[index] || 1) * (1 + depthScale * 0.18 + ((index % 3) - 1) * 0.05), 0.9, 4.2);
      break;
    case "paint-residue":
      motionAx += flow.x * 0.16 + tangentX * 0.14 + noiseX * 0.4;
      motionAy += flow.y * 0.16 + tangentY * 0.14 + noiseY * 0.4;
      break;
    case "lightning-latch": {
      let bestDx = toTargetX;
      let bestDy = toTargetY;
      let bestDistance = distance;
      for (const anchor of sceneGraph.supportAttractors.slice(0, 4)) {
        const dx = anchor.x - x;
        const dy = anchor.y - y;
        const d = Math.hypot(dx, dy);
        if (d < bestDistance) {
          bestDx = dx;
          bestDy = dy;
          bestDistance = d;
        }
      }
      motionAx += (bestDx / Math.max(1, bestDistance)) * 1.4 + noiseX * 0.8;
      motionAy += (bestDy / Math.max(1, bestDistance)) * 1.4 + noiseY * 0.8;
      break;
    }
    case "prism-well": {
      const prismMix = 0.58 + orbitScale * 0.18;
      motionAx += (toSupportAX / supportALen) * prismMix + (toSupportBX / supportBLen) * 0.18 + orbitX * 0.24;
      motionAy += (toSupportAY / supportALen) * prismMix + (toSupportBY / supportBLen) * 0.18 + orbitY * 0.24;
      break;
    }
  }
  switch (motionScript) {
    case "follow-hero":
      motionAx += (toTargetX / distance) * 0.42 + tangentX * 0.24;
      motionAy += (toTargetY / distance) * 0.42 + tangentY * 0.24;
      break;
    case "escort":
      motionAx += (toSupportAX / supportALen) * 0.34 + tangentX * 0.18;
      motionAy += (toSupportAY / supportALen) * 0.34 + tangentY * 0.18;
      break;
    case "emit-to-edge":
      motionAx += outwardX * (2.05 * driftScale) + (toSupportBX / supportBLen) * 0.28;
      motionAy += outwardY * (2.05 * driftScale) + (toSupportBY / supportBLen) * 0.28;
      break;
    case "orbit-anchor":
      motionAx += orbitX * (1.25 * orbitScale) + (toSupportAX / supportALen) * 0.14;
      motionAy += orbitY * (1.25 * orbitScale) + (toSupportAY / supportALen) * 0.14;
      break;
    case "dual-well":
      motionAx += (toSupportAX / supportALen) * 0.24 - (toSupportBX / supportBLen) * 0.2;
      motionAy += (toSupportAY / supportALen) * 0.24 - (toSupportBY / supportBLen) * 0.2;
      break;
    case "braid-lane":
    case "signal-drift":
      motionAx += tangentX * (0.34 * driftScale) + flow.x * 0.22;
      motionAy += tangentY * (0.34 * driftScale) + flow.y * 0.22;
      break;
    case "play-scatter":
      motionAx += noiseX * 5.4 + outwardX * 0.32;
      motionAy += noiseY * 5.4 + outwardY * 0.32;
      break;
    case "burst-falloff":
      motionAx += outwardX * (1.85 * driftScale);
      motionAy += outwardY * (1.85 * driftScale);
      break;
    case "edge-fog":
      motionAx += flow.x * 0.34 + noiseX * 3.8;
      motionAy += flow.y * 0.34 + noiseY * 3.8;
      break;
    case "absorb-well":
      motionAx += (toSupportAX / supportALen) * (0.55 + (absorberEvent ? 0.35 : 0)) - tangentX * 0.08;
      motionAy += (toSupportAY / supportALen) * (0.55 + (absorberEvent ? 0.35 : 0)) - tangentY * 0.08;
      break;
    case "emit-chain":
      motionAx += outwardX * (1.4 + (emitterEvent ? 0.55 : 0.12)) + tangentX * 0.32;
      motionAy += outwardY * (1.4 + (emitterEvent ? 0.55 : 0.12)) + tangentY * 0.32;
      break;
    case "release-bloom":
      motionAx += outwardX * (1.2 + (releaseEvent ? 0.9 : 0.25)) + orbitX * 0.22;
      motionAy += outwardY * (1.2 + (releaseEvent ? 0.9 : 0.25)) + orbitY * 0.22;
      break;
    case "spiral-in":
    case "spiral-out":
    default:
      break;
  }
  const ax =
    (toTargetX / distance) * (anchorType === "silhouette" ? targetPullScale : targetPullScale * 0.42) +
    tangentX * 0.55 +
    motionAx +
    flow.x * 0.25 +
    noiseX;
  const ay =
    (toTargetY / distance) * (anchorType === "silhouette" ? targetPullScale : targetPullScale * 0.42) +
    tangentY * 0.55 +
    motionAy +
    flow.y * 0.25 +
    noiseY;
  state.scratchAx[index] = ax;
  state.scratchAy[index] = ay;
  state.scratchDamping[index] = clamp(0.85 + frame.motionEnvelope * 0.08 - sourceAffinity * 0.09 - (edgeAttachmentScale - 1) * 0.03, 0.72, 0.92);
  state.scratchPulseScale[index] = clamp(frame.pulseScale * (0.9 + curvatureWeight * 0.25), 1, 4);
  if (motionMode === "lifecycle-morph") {
    const lifeRatio = clamp(state.age[index]! / Math.max(1, state.ttl[index]!), 0, 1);
    const morphProfile = behaviorFor(sceneGraph, index)?.behaviorTuning?.morphProfile ?? "shard-to-teardrop";
    const morphScale =
      morphProfile === "diamond-to-shard"
        ? lifeRatio < 0.5 ? 1.2 - lifeRatio * 0.25 : 1.02 - (lifeRatio - 0.5) * 0.48
        : morphProfile === "voxel-to-dust"
          ? 1.1 - lifeRatio * 0.38
          : 0.96 + Math.sin(lifeRatio * Math.PI) * 0.22;
    state.scratchPulseScale[index] = clamp(state.scratchPulseScale[index]! * morphScale, 0.8, 4.2);
  }
  state.scratchRetarget[index] = state.age[index]! + 1 >= state.ttl[index]! || distance < 8 ? 1 : 0;
  if (motionMode === "shell-bounce") {
    const margin = Math.max(2, state.currentSize[index] ?? 4);
    if (x < margin || x > edgeMap.width - margin) {
      state.vx[index] = -state.vx[index]! * bounceDamping;
    }
    if (y < margin || y > edgeMap.height - margin) {
      state.vy[index] = -state.vy[index]! * bounceDamping;
    }
  }
}

function drawParticle(
  ctx2d: CanvasRenderingContext2D,
  edgeMap: EdgeMap,
  state: ParticleSystemState,
  index: number,
  layer: "hero" | "support" | "background",
  frame: AudioFrameFeature,
  theme: RenderTheme,
  sceneGraph: SceneGraph,
  total: number,
  stampAtlas: ShapeStampAtlas,
): void {
  const hueScale =
    classifyHeroMotifIntensity(edgeMap.fractalMotif) === "colorful-psychedelic" ? 1.4 :
    classifyHeroMotifIntensity(edgeMap.fractalMotif) === "restrained" ? 1 :
    1.1;
  const x = state.x[index]!;
  const y = state.y[index]!;
  const tangentX = state.tangentX[index]!;
  const tangentY = state.tangentY[index]!;
  const currentSize = state.currentSize[index]!;
  const brightness = state.brightness[index]!;
  const hueOffset = state.hueOffset[index]!;
  const toneWeight = state.toneWeight[index]!;
  const edgeWeight = state.edgeWeight[index]!;
  const radiusBase = layer === "hero" ? currentSize * 0.34 : layer === "support" ? currentSize * 0.46 : currentSize * 0.24;
  const radius = safeRadius(clamp(radiusBase, 1.4, 54), 1.4);
  const alphaBase = layer === "hero" ? 0.065 : layer === "support" ? 0.075 : 0.05;
  if (!isFinitePoint(x, y) || !isFinitePoint(tangentX, tangentY)) {
    return;
  }
  const ex = x + tangentX * radius * (edgeMap.fractalMotif === "neon-tube" ? 1.8 : 0.8);
  const ey = y + tangentY * radius * (edgeMap.fractalMotif === "neon-tube" ? 1.8 : 0.8);
  const gx1 = Number.isFinite(ex) ? ex : x + 0.001;
  const gy1 = Number.isFinite(ey) ? ey : y + 0.001;
  const scaledHueOffset = hueOffset * hueScale;
  const startColor = plasmaCoreColor(theme, alphaBase + brightness * 0.08 + frame.beatPulse * 0.04, scaledHueOffset);
  const endColor = paletteColor(theme, (index / Math.max(1, total)) + scaledHueOffset * 0.15, alphaBase * 0.9 + toneWeight * 0.04, layer === "hero" ? 10 : 4);
  const gradient = radius <= 5
    ? undefined
    : ctx2d.createLinearGradient(x, y, Math.abs(gx1 - x) < 1e-6 ? x + 0.001 : gx1, Math.abs(gy1 - y) < 1e-6 ? y + 0.001 : gy1);
  gradient?.addColorStop(0, startColor);
  gradient?.addColorStop(1, endColor);
  const angle = Math.atan2(tangentY, tangentX) + state.phaseOffset[index]! + frame.timeSec * 0.35;
  if (layer !== "hero") {
    const sizeBucket = Math.max(2, Math.min(10, Math.round(radius)));
    const colorBucket = Math.max(0, Math.min(7, Math.floor(((index / Math.max(1, total)) + scaledHueOffset * 0.15) * 8) % 8));
    const stamp = stampAtlas.getStamp({
      shape: shapeModeName(state, index),
      sizeBucket,
      colorBucket,
      layer,
      purpose: occupancyPurposeFor(sceneGraph, index),
      variant: motionScriptFor(sceneGraph, index),
      intent: sceneGraph.intentSeed.intent,
    }, gradient ? endColor : startColor);
    ctx2d.save();
    ctx2d.globalAlpha = alphaBase + toneWeight * 0.05;
    ctx2d.translate(x, y);
    ctx2d.rotate(angle);
    ctx2d.drawImage(stamp as any, -stamp.width * 0.5, -stamp.height * 0.5, stamp.width, stamp.height);
    ctx2d.restore();
  } else {
    const sizeBucket = Math.max(2, Math.min(7, Math.round(radius)));
    const colorBucket = Math.max(0, Math.min(7, Math.floor(((index / Math.max(1, total)) + scaledHueOffset * 0.15) * 8) % 8));
    const stamp = stampAtlas.getStamp({
      shape: sceneGraph.heroSubEmitterFamily as ParticleShapeMode | HeroGlyphKind,
      sizeBucket,
      colorBucket,
      layer,
      purpose: "hero-echo",
      variant: "hero-core",
      intent: sceneGraph.intentSeed.intent,
    }, endColor);
    ctx2d.save();
    ctx2d.globalAlpha = clamp(alphaBase + toneWeight * 0.025, 0.05, 0.12);
    ctx2d.translate(x, y);
    ctx2d.rotate(angle);
    ctx2d.drawImage(stamp as any, -stamp.width * 0.5, -stamp.height * 0.5, stamp.width, stamp.height);
    ctx2d.restore();
  }
  if (layer !== "background" && layer !== "hero" && anchorTypeName(state, index) !== "region") {
    ctx2d.strokeStyle = paletteColor(theme, scaledHueOffset, alphaBase * 0.7 + edgeWeight * 0.02, 6);
    ctx2d.lineWidth = 0.7 + edgeWeight * 0.3;
    ctx2d.beginPath();
    ctx2d.moveTo(x, y);
    ctx2d.lineTo(x - tangentX * radius * (0.9 + frame.motionEnvelope * 0.4), y - tangentY * radius * (0.9 + frame.motionEnvelope * 0.4));
      ctx2d.stroke();
  }
  if (motionModeName(state, index) === "ribbon-trace") {
    const trailLength = radius * (2.6 + frame.beatPulse * 0.8);
    const backX = x - tangentX * trailLength;
    const backY = y - tangentY * trailLength;
    const controlX = x - tangentX * trailLength * 0.45 + Math.sin(frame.timeSec * 3 + index) * radius * 0.6;
    const controlY = y - tangentY * trailLength * 0.45 + Math.cos(frame.timeSec * 2.6 + index) * radius * 0.6;
    ctx2d.save();
    ctx2d.globalAlpha = clamp(alphaBase + toneWeight * 0.07, 0.08, 0.2);
    ctx2d.strokeStyle = gradient ?? endColor;
    ctx2d.lineWidth = clamp(radius * 0.44, 1.2, 4.8);
    ctx2d.beginPath();
    ctx2d.moveTo(x, y);
    ctx2d.quadraticCurveTo(controlX, controlY, backX, backY);
    ctx2d.stroke();
    ctx2d.restore();
  }
  if (motionModeName(state, index) === "plexus-link" || motionModeName(state, index) === "lightning-latch") {
    const linkTargetX = state.targetX[index]!;
    const linkTargetY = state.targetY[index]!;
    const linkRadius = state.linkRadius[index] ?? 56;
    const linkDistance = Math.hypot(linkTargetX - x, linkTargetY - y);
    if (linkDistance <= linkRadius * 1.6) {
      ctx2d.save();
      ctx2d.globalAlpha = clamp((0.08 + toneWeight * 0.06) * (1 - linkDistance / Math.max(linkRadius * 1.6, 1)), 0.05, 0.18);
      ctx2d.strokeStyle =
        motionModeName(state, index) === "lightning-latch"
          ? plasmaCoreColor(theme, 0.18, scaledHueOffset)
          : paletteColor(theme, scaledHueOffset, 0.14, 10);
      ctx2d.lineWidth = motionModeName(state, index) === "lightning-latch" ? 1.4 : 0.8;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y);
      if (motionModeName(state, index) === "lightning-latch") {
        const segments = 3;
        for (let segment = 1; segment < segments; segment += 1) {
          const t = segment / segments;
          const jagX = x + (linkTargetX - x) * t + Math.sin(frame.timeSec * 14 + index + segment) * 6 * (1 - t);
          const jagY = y + (linkTargetY - y) * t + Math.cos(frame.timeSec * 11 + index + segment) * 6 * (1 - t);
          ctx2d.lineTo(jagX, jagY);
        }
      }
      ctx2d.lineTo(linkTargetX, linkTargetY);
      ctx2d.stroke();
      ctx2d.restore();
    }
  }
  if (shapeModeName(state, index) === "voxel") {
    const depthBucket = ((index % 3) - 1) * (state.depthScale[index] ?? 0.5);
    const voxelSize = radius * (1 + depthBucket * 0.18);
    ctx2d.save();
    ctx2d.globalAlpha = clamp(0.12 + toneWeight * 0.08 - depthBucket * 0.02, 0.12, 0.24);
    ctx2d.fillStyle = endColor;
    ctx2d.fillRect(x - voxelSize * 0.6, y - voxelSize * 0.6, voxelSize * 1.2, voxelSize * 1.2);
    ctx2d.strokeStyle = startColor;
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(x - voxelSize * 0.6, y - voxelSize * 0.6, voxelSize * 1.2, voxelSize * 1.2);
    ctx2d.beginPath();
    ctx2d.moveTo(x - voxelSize * 0.6, y - voxelSize * 0.6);
    ctx2d.lineTo(x - voxelSize * 0.3, y - voxelSize * 0.84);
    ctx2d.lineTo(x + voxelSize * 0.9, y - voxelSize * 0.84);
    ctx2d.lineTo(x + voxelSize * 0.6, y - voxelSize * 0.6);
    ctx2d.stroke();
    ctx2d.restore();
  }
  if (motionModeName(state, index) === "paint-residue") {
    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";
    ctx2d.globalAlpha = clamp(state.residueAlpha[index] ?? 0.08, 0.04, 0.14);
    ctx2d.fillStyle = paletteColor(theme, scaledHueOffset, 0.12, -6);
    if (edgeMap.fractalMotif === "film-bloom-shard" || edgeMap.fractalMotif === "smoke-ribbon") {
      ctx2d.fillRect(x - radius * 0.5, y - radius * 0.18, radius, radius * 0.36);
    } else {
      ctx2d.fillRect(x - radius * 0.35, y - radius * 0.35, radius * 0.7, radius * 0.7);
    }
    ctx2d.restore();
  }
}

function drawOccupancyShapeVariant(
  ctx2d: CanvasRenderingContext2D,
  mode: CompositionPlan["stylePlacementMode"],
  radius: number,
  point: { x: number; y: number; layer: "hero" | "support" | "background" },
  angle: number,
  fillStyle: CanvasGradient,
): void {
  ctx2d.save();
  ctx2d.translate(point.x, point.y);
  ctx2d.rotate(angle);
  ctx2d.fillStyle = fillStyle;
  switch (mode) {
    case "orbital":
      ctx2d.beginPath();
      ctx2d.ellipse(0, 0, radius * 1.1, radius * 0.6, 0, 0, Math.PI * 1.75);
      ctx2d.fill();
      break;
    case "filament":
      ctx2d.beginPath();
      ctx2d.ellipse(0, 0, radius * 1.35, radius * 0.46, 0, 0, Math.PI * 2);
      ctx2d.fill();
      break;
    case "ribbon":
      ctx2d.beginPath();
      ctx2d.moveTo(-radius * 1.1, 0);
      ctx2d.bezierCurveTo(-radius * 0.4, -radius * 0.8, radius * 0.4, radius * 0.8, radius * 1.1, 0);
      ctx2d.bezierCurveTo(radius * 0.42, radius * 0.32, -radius * 0.42, -radius * 0.32, -radius * 1.1, 0);
      ctx2d.closePath();
      ctx2d.fill();
      break;
    case "cell":
      for (let index = 0; index < (point.layer === "hero" ? 3 : 2); index += 1) {
        const localX = (index - 1) * radius * 0.44;
        const localY = (index % 2 === 0 ? -1 : 1) * radius * 0.18;
        ctx2d.beginPath();
        ctx2d.arc(localX, localY, radius * (index === 1 ? 0.7 : 0.45), 0, Math.PI * 2);
        ctx2d.fill();
      }
      break;
    case "shard-lane":
      ctx2d.beginPath();
      ctx2d.moveTo(0, -radius * 1.08);
      ctx2d.lineTo(radius * 0.92, 0);
      ctx2d.lineTo(0, radius * 0.78);
      ctx2d.lineTo(-radius * 0.72, 0);
      ctx2d.closePath();
      ctx2d.fill();
      break;
  }
  ctx2d.restore();
}

function resolvedPlacementMode(
  compositionPlan: CompositionPlan,
  edgeMap: EdgeMap,
  frame: AudioFrameFeature,
  sceneGraph: SceneGraph | undefined,
  visualState?: VisualState,
): CompositionPlan["stylePlacementMode"] {
  if (sceneGraph && visualState) {
    switch (visualState.regime) {
      case "drop":
        return sceneGraph.motifFamilySet[1];
      case "breakdown":
        return sceneGraph.motifFamilySet[2];
      case "intro":
      case "outro":
        return sceneGraph.motifFamilySet[2];
      case "build":
      case "groove":
      default:
        return sceneGraph.motifFamilySet[0];
    }
  }
  if (visualState) {
    switch (visualState.regime) {
      case "drop":
        if (edgeMap.fractalMotif === "glass-orbital") {
          return "orbital";
        }
        return frame.dominantBand === "high" ? "shard-lane" : "ribbon";
      case "build":
        return frame.dominantBand === "mid" ? "filament" : "shard-lane";
      case "breakdown":
        return edgeMap.fractalMotif === "smoke-ribbon" ? "ribbon" : "cell";
      case "groove":
        if (edgeMap.fractalMotif === "cathedral-filament") {
          return frame.dominantBand === "mid" ? "filament" : "ribbon";
        }
        return frame.dominantBand === "low" ? "orbital" : frame.dominantBand === "high" ? "shard-lane" : "ribbon";
      case "intro":
      case "outro":
        return edgeMap.fractalMotif === "glass-orbital" ? "orbital" : "cell";
    }
  }
  if (frame.peakStrength > 0.66) {
    return edgeMap.fractalMotif === "glass-orbital" ? "orbital" : "shard-lane";
  }
  if (frame.narrativeIntensity < 0.28) {
    return compositionPlan.stylePlacementMode === "filament" ? "cell" : compositionPlan.stylePlacementMode;
  }
  if (edgeMap.fractalMotif === "smoke-ribbon") {
    return frame.normalizedMid > 0.34 ? "ribbon" : "cell";
  }
  if (edgeMap.fractalMotif === "neon-tube") {
    return frame.normalizedHigh > 0.32 ? "shard-lane" : "filament";
  }
  if (edgeMap.fractalMotif === "glass-orbital") {
    return frame.normalizedLow > 0.28 ? "orbital" : "cell";
  }
  return compositionPlan.stylePlacementMode;
}

export function renderOccupancyShapes(
  ctx2d: CanvasRenderingContext2D,
  params: {
    compositionPlan: CompositionPlan;
    edgeMap: EdgeMap;
    frame: AudioFrameFeature;
    theme: RenderTheme;
    sceneGraph?: SceneGraph;
    occupancy: OccupancyPoint[];
    imageProgress: number;
    visualState?: VisualState;
    qualityBudget?: RenderQualityBudget;
  },
): void {
  const sorted = [...params.occupancy].sort((a, b) => {
    const layerRank = { background: 0, support: 1, hero: 2 };
    return layerRank[a.layer] - layerRank[b.layer] || b.weight - a.weight;
  });
  const occupancyScale = params.qualityBudget?.occupancyLimitScale ?? 1;
  const limit = Math.min(sorted.length, Math.max(8, Math.round((params.edgeMap.maskConfidence === "low" ? 18 : 32) * occupancyScale)));
  const hero = { x: params.compositionPlan.heroCenterX, y: params.compositionPlan.heroCenterY };
  const placementMode = resolvedPlacementMode(params.compositionPlan, params.edgeMap, params.frame, params.sceneGraph, params.visualState);
  for (let index = 0; index < limit; index += 1) {
    const point = sorted[index]!;
    const lowMotionSuppressed =
      point.layer !== "hero" &&
      point.motionPx < (params.sceneGraph?.occupancyPolicy.suppressLowMotionBelow ?? 0.75) &&
      point.purpose !== "ritual-ring";
    if (lowMotionSuppressed) {
      continue;
    }
    const inProtectedZone = params.compositionPlan.protectedZones.some((zone) =>
      point.x >= zone.x &&
      point.x <= zone.x + zone.width &&
      point.y >= zone.y &&
      point.y <= zone.y + zone.height,
    );
    if (inProtectedZone && point.layer !== "background") {
      continue;
    }
    const stageScale =
      params.imageProgress < 0.2 ? (point.layer === "background" ? 0.5 : 0.16) :
      params.imageProgress < 0.45 ? (point.layer === "hero" ? 0.65 : point.layer === "support" ? 0.28 : 0.18) :
      params.imageProgress < 0.75 ? (point.layer === "hero" ? 1 : point.layer === "support" ? 0.58 : 0.18) :
      (point.layer === "hero" ? 1 : point.layer === "support" ? 0.74 : 0.26);
    if (stageScale <= 0.18 && point.layer !== "background") {
      continue;
    }
    if (point.layer === "background" && inProtectedZone) {
      continue;
    }
    const purposeScale =
      point.purpose === "hero-wake" ? 1 :
      point.purpose === "ritual-ring" ? 0.92 :
      point.purpose === "path-node" ? 0.7 :
      point.purpose === "burst-remnant" ? 0.62 :
      point.purpose === "ambient-fog" ? 0.42 :
      0.55;
    const radiusMultiplier = (point.layer === "hero" ? 0.72 : point.layer === "support" ? 0.46 : 0.22) * purposeScale;
    const radius = safeRadius(point.radius * radiusMultiplier * clamp(params.frame.pulseScale * 0.4, 1, 1.9), 1);
    if (!isFinitePoint(point.x, point.y)) {
      continue;
    }
    const dx = point.x - hero.x;
    const dy = point.y - hero.y;
    const angle = Math.atan2(dy, dx);
    const ellipseX = point.layer === "hero" ? radius * 1.2 : point.layer === "support" ? radius * 0.92 : radius;
    const ellipseY = point.layer === "hero" ? radius * 0.84 : point.layer === "support" ? radius * 0.64 : radius * 0.72;
    const gradient = ctx2d.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    const alpha =
      (point.layer === "hero" ? 0.07 : point.layer === "support" ? 0.038 : 0.016) *
      clamp(0.75 + point.motionPx * 0.08, 0.3, 1.2);
    gradient.addColorStop(0, paletteColor(params.theme, index / Math.max(1, limit), (alpha + point.weight * 0.02) * stageScale, point.layer === "hero" ? 6 : 0));
    gradient.addColorStop(0.65, paletteColor(params.theme, index / Math.max(1, limit), (alpha * 0.7 + point.weight * 0.012) * stageScale, -4));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    drawOccupancyShapeVariant(
      ctx2d,
      placementMode,
      point.layer === "hero" ? ellipseX : (ellipseX + ellipseY) * 0.5,
      point,
      angle,
      gradient,
    );
  }
}

export function renderEdgeParticles(
  ctx2d: CanvasRenderingContext2D,
  params: {
    compositionPlan: CompositionPlan;
    edgeMap: EdgeMap;
    frame: AudioFrameFeature;
    theme: RenderTheme;
    sceneGraph: SceneGraph;
    stampAtlas: ShapeStampAtlas;
    width: number;
    height: number;
    state?: ParticleSystemState;
    imageProgress?: number;
    activeSubject?: ActiveSubjectSnapshot;
    qualityBudget?: RenderQualityBudget;
    diagnosticOverrides?: DiagnosticOverrides;
  },
): ParticleRenderResult {
  const state = params.state ?? createParticleState();
  if (state.seed === 0) {
    state.seed = stableImageSeed(params.edgeMap.imagePath, params.edgeMap.points.length * 17);
  }
  if (state.count === 0) {
    initializeSystem(state, params.edgeMap, params.compositionPlan, params.sceneGraph, params.diagnosticOverrides);
  }
  maybeRetarget(state, params.edgeMap, params.compositionPlan, params.sceneGraph, params.frame);
  maybeRetargetTowardActiveSubject(state, params.edgeMap, params.sceneGraph, params.frame, params.activeSubject);
  const particleStartedAt = performance.now();

  for (let index = 0; index < state.count; index += 1) {
    if (state.edgeExitFramesRemaining[index]! > 0) {
      const dx = state.edgeExitTargetX[index]! - state.x[index]!;
      const dy = state.edgeExitTargetY[index]! - state.y[index]!;
      const distance = Math.hypot(dx, dy) || 1;
      state.scratchAx[index] = (dx / distance) * 0.16;
      state.scratchAy[index] = (dy / distance) * 0.16;
      state.scratchDamping[index] = 0.92;
      state.scratchPulseScale[index] = 1 + (state.edgeExitPlayed[index] ? 0.14 : 0.06);
      state.scratchRetarget[index] = 0;
      continue;
    }
    const anchorType = anchorTypeName(state, index);
    if (shouldIntegrateParticle(params.frame, anchorType)) {
      prepareParticleIntegration(state, index, params.edgeMap, params.compositionPlan, params.sceneGraph, params.frame, state.seed + params.frame.frameIndex * 53 + index * 7);
    } else {
      state.scratchAx[index] = 0;
      state.scratchAy[index] = 0;
      state.scratchDamping[index] = 1;
      state.scratchPulseScale[index] = state.baseSize[index]! > 0 ? state.currentSize[index]! / state.baseSize[index]! : 1;
      state.scratchRetarget[index] = 0;
    }
  }
  applyParticleBatchWasm({
    count: state.count,
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    age: state.age,
    baseSize: state.baseSize,
    currentSize: state.currentSize,
    ax: state.scratchAx,
    ay: state.scratchAy,
    damping: state.scratchDamping,
    pulseScale: state.scratchPulseScale,
    width: params.edgeMap.width,
    height: params.edgeMap.height,
  });
  let edgeDeathEligibleCount = 0;
  let edgeDeathTriggeredCount = 0;
  let edgeDeathPlayedCount = 0;
  let edgeDeathSkippedByCostCount = 0;
  let edgeExitFramesTotal = 0;
  let edgeExitDistanceTotal = 0;
  let lastEdgeDeathEffectId: string | undefined;
  let lastEdgeDeathCostTier: "low" | "medium" | "high" | undefined;
  for (let index = 0; index < state.count; index += 1) {
    if (state.edgeExitFramesRemaining[index]! > 0) {
      state.edgeExitFramesRemaining[index] = Math.max(0, state.edgeExitFramesRemaining[index]! - 1);
      edgeExitFramesTotal += 1;
      edgeExitDistanceTotal += state.edgeExitDistance[index] ?? 0;
      if (
        state.edgeExitFramesRemaining[index] === 0 ||
        Math.hypot(state.edgeExitTargetX[index]! - state.x[index]!, state.edgeExitTargetY[index]! - state.y[index]!) < 6
      ) {
        retargetParticle(state, index, params.edgeMap, params.compositionPlan, params.sceneGraph, state.seed + params.frame.frameIndex * 53 + index * 7 + state.age[index]! * 17);
        state.age[index] = 0;
        state.edgeExitPlayed[index] = 0;
        state.edgeExitEffectIndex[index] = 0;
        state.edgeExitDistance[index] = 0;
        state.edgeExitTargetX[index] = state.targetX[index]!;
        state.edgeExitTargetY[index] = state.targetY[index]!;
      }
      continue;
    }
    if (state.scratchRetarget[index]) {
      retargetParticle(state, index, params.edgeMap, params.compositionPlan, params.sceneGraph, state.seed + params.frame.frameIndex * 53 + index * 7 + state.age[index]! * 17);
      state.age[index] = 0;
      continue;
    }
    const x = state.x[index]!;
    const y = state.y[index]!;
    const touchedCanvasEdge =
      x <= 0 ||
      x >= params.edgeMap.width ||
      y <= 0 ||
      y >= params.edgeMap.height;
    if (!touchedCanvasEdge) {
      continue;
    }
    edgeDeathEligibleCount += 1;
    edgeDeathTriggeredCount += 1;
    const effectSeed = stableImageSeed(params.edgeMap.imagePath, state.seed + params.frame.frameIndex * 61 + index * 17);
    const base = edgeDestructionBaseForMotif(params.edgeMap, effectSeed);
    const finish = edgeDestructionFinishForSeed(effectSeed + index * 3);
    const effectId = `${base}-${finish}`;
    const costTier = edgeDestructionCostTier(base, finish);
    const divisor = edgeDestructionDivisor(costTier);
    const played = Math.abs(effectSeed) % divisor === 0;
    if (played) {
      edgeDeathPlayedCount += 1;
    } else {
      edgeDeathSkippedByCostCount += 1;
    }
    lastEdgeDeathEffectId = effectId;
    lastEdgeDeathCostTier = costTier;
    const exitDistance =
      (x <= 0 || x >= params.edgeMap.width ? params.edgeMap.width : params.edgeMap.height) *
      (0.06 + (Math.abs(effectSeed % 7) / 100));
    const exitFrames = 2 + Math.abs(effectSeed % 5);
    state.edgeExitFramesRemaining[index] = exitFrames;
    state.edgeExitDistance[index] = exitDistance;
    state.edgeExitPlayed[index] = played ? 1 : 0;
    state.edgeExitEffectIndex[index] = (EDGE_DESTRUCTION_BASES.indexOf(base) * EDGE_DESTRUCTION_FINISHES.length + EDGE_DESTRUCTION_FINISHES.indexOf(finish)) & 0xff;
    state.edgeExitTargetX[index] =
      x <= 0 ? -exitDistance :
      x >= params.edgeMap.width ? params.edgeMap.width + exitDistance :
      x;
    state.edgeExitTargetY[index] =
      y <= 0 ? -exitDistance :
      y >= params.edgeMap.height ? params.edgeMap.height + exitDistance :
      y;
    state.currentSize[index] *= played ? 1.18 : 1.06;
  }

  const anchors: NebulaGlowAnchor[] = [];
  const occupancy: OccupancyPoint[] = [];
  let heroCount = 0;
  let backgroundCount = 0;
  let supportCount = 0;
  let negativeSpaceHits = 0;
  let placementScoreSum = 0;
  let budgetDowngradeCount = 0;
  let supportMotionSum = 0;
  let supportMotionCount = 0;
  let backgroundMotionSum = 0;
  let backgroundMotionCount = 0;
  let emitterUsage = 0;
  let absorberUsage = 0;
  let explosionCount = 0;
  let sourceAffinitySum = 0;
  let sourceAffinityHeroSum = 0;
  let sourceAffinityHeroCount = 0;
  let sourceAffinitySupportSum = 0;
  let sourceAffinitySupportCount = 0;
  let convergenceScoreSum = 0;
  let subEmitterChildren = 0;
  let particleSpawnRequests = 0;
  let particleRenderedCount = 0;
  let particleCulledByLayerCap = 0;
  let particleCulledByHeroProtection = 0;
  let particleCulledByNegativeSpace = 0;
  let particleCulledByImageProgress = 0;
  let particleCulledBySkipNonHero = 0;
  let particleOffscreenCount = 0;
  let particleTooSmallToReadCount = 0;
  let particleLowAlphaCount = 0;
  let particleLowContrastCount = 0;
  let particleVisibleCount = 0;
  let heroParticleRenderedCount = 0;
  let supportParticleRenderedCount = 0;
  let backgroundParticleRenderedCount = 0;
  let subEmitterTriggerCount = 0;
  const imageProgress = params.imageProgress ?? 0.5;
  const particleSpawnScale = params.diagnosticOverrides?.particleSpawnScale ?? 1;
  const particleLimitScale = params.diagnosticOverrides?.disableParticleCaps ? 1 : (params.qualityBudget?.particleLimitScale ?? 1);
  const episodeVolume = params.sceneGraph.episodeSeed.particleVolumeScale;
  const beatScale = params.frame.isBeatAccent ? 1 + (params.sceneGraph.episodeSeed.pulseProfile.bpmPulseStrength - 1) * 0.28 : 1;
  const barScale = 1 + (params.frame.barPulse ?? 0) * (params.sceneGraph.episodeSeed.pulseProfile.barPulseStrength - 0.85) * 0.34;
  const phraseScale = 1 + (params.frame.phrasePulse ?? 0) * (params.sceneGraph.episodeSeed.pulseProfile.fourBarAccentStrength - 1) * 0.42;
  const eventScale = clamp(episodeVolume * beatScale * barScale * phraseScale, 1, 2.2);
  const heroMax = Math.max(3, Math.min(16, Math.round((params.edgeMap.maskConfidence === "high" ? 8 : 6) * particleLimitScale * particleSpawnScale)));
  const supportMax = Math.max(20, Math.round((params.edgeMap.maskConfidence === "low" ? 16 : 22) * 1.25 * particleLimitScale * clamp(1 + (eventScale - 1) * 0.42, 1, 1.28) * particleSpawnScale));
  const backgroundMax = Math.max(25, Math.round((params.edgeMap.maskConfidence === "low" ? 20 : 28) * 1.25 * particleLimitScale * clamp(1 + (eventScale - 1) * 0.38, 1, 1.24) * particleSpawnScale));
  const skipNonHero = !params.diagnosticOverrides?.disableParticleCaps && params.frame.narrativeIntensity < 0.26 && particleLimitScale >= 0.95;
  let stampDrawCount = 0;
  let supportStampDrawCount = 0;
  let backgroundStampDrawCount = 0;
  let vectorDrawCount = 0;
  let gradientCreateCount = 0;
  let occupancyDrawCount = 0;
  const heroPriorityRadius = params.sceneGraph.heroPriorityRadius;

  ctx2d.save();
  ctx2d.globalCompositeOperation = "lighter";
  ctx2d.lineCap = "round";
  ctx2d.lineJoin = "round";
  for (let index = 0; index < state.count; index += 1) {
    particleSpawnRequests += 1;
    const x = state.x[index]!;
    const y = state.y[index]!;
    const layer = layerForParticle(state, params.edgeMap, index);
    if (skipNonHero && layer !== "hero") {
      particleCulledBySkipNonHero += 1;
      continue;
    }
    if (layer === "background" && isInsideNegativeSpace(params.edgeMap, x, y) && params.edgeMap.maskConfidence !== "low") {
      particleCulledByNegativeSpace += 1;
      continue;
    }
    const inProtectedZone = params.compositionPlan.protectedZones.some((zone) =>
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height,
    );
    const heroCenterX = params.activeSubject?.x ?? params.compositionPlan.heroCenterX;
    const heroCenterY = params.activeSubject?.y ?? params.compositionPlan.heroCenterY;
    const distanceFromHero = Math.hypot(x - heroCenterX, y - heroCenterY);
    const heroProtected = layer !== "hero" && distanceFromHero < heroPriorityRadius * (params.sceneGraph.intentSeed.intent === "orbit-ritual" ? 0.72 : 0.92);
    if (inProtectedZone && layer !== "background") {
      continue;
    }
    if (heroProtected) {
      if (!params.diagnosticOverrides?.disableBudgetDowngrades) {
        budgetDowngradeCount += 1;
      }
      particleCulledByHeroProtection += 1;
      continue;
    }
    const shouldRender =
      imageProgress < 0.2 ? layer === "background" :
      imageProgress < 0.45 ? layer !== "support" || params.edgeMap.maskConfidence !== "low" :
      true;
    if (!shouldRender) {
      particleCulledByImageProgress += 1;
      continue;
    }
    if (layer === "hero" && heroCount >= heroMax) {
      if (!params.diagnosticOverrides?.disableBudgetDowngrades) {
        budgetDowngradeCount += 1;
      }
      particleCulledByLayerCap += 1;
      continue;
    }
    if (layer === "support" && supportCount >= supportMax) {
      if (!params.diagnosticOverrides?.disableBudgetDowngrades) {
        budgetDowngradeCount += 1;
      }
      particleCulledByLayerCap += 1;
      continue;
    }
    if (layer === "background" && backgroundCount >= backgroundMax) {
      if (!params.diagnosticOverrides?.disableBudgetDowngrades) {
        budgetDowngradeCount += 1;
      }
      particleCulledByLayerCap += 1;
      continue;
    }
    particleRenderedCount += 1;
    if (layer === "hero") {
      vectorDrawCount += 1;
      heroParticleRenderedCount += 1;
    } else {
      stampDrawCount += 1;
      if (layer === "support") {
        supportStampDrawCount += 1;
        supportParticleRenderedCount += 1;
      } else {
        backgroundStampDrawCount += 1;
        backgroundParticleRenderedCount += 1;
      }
    }
    const size = state.currentSize[index] ?? 0;
    const alpha = clamp((state.brightness[index] ?? 0) * 0.9 + (state.toneWeight[index] ?? 0) * 0.25, 0, 1);
    const contrast = Math.abs((state.toneWeight[index] ?? 0) - (state.edgeWeight[index] ?? 0));
    const offscreen =
      x < -size ||
      x > params.edgeMap.width + size ||
      y < -size ||
      y > params.edgeMap.height + size;
    const tooSmallToRead = size < (layer === "hero" ? 1.6 : 1.2);
    const lowAlpha = alpha < 0.16;
    const lowContrast = contrast < 0.08;
    if (offscreen) {
      particleOffscreenCount += 1;
    }
    if (tooSmallToRead) {
      particleTooSmallToReadCount += 1;
    }
    if (lowAlpha) {
      particleLowAlphaCount += 1;
    }
    if (lowContrast) {
      particleLowContrastCount += 1;
    }
    if (!offscreen && !tooSmallToRead && !lowAlpha && !lowContrast) {
      particleVisibleCount += 1;
    }
    if (state.currentSize[index]! > 5) {
      gradientCreateCount += 1;
    }
    drawParticle(ctx2d, params.edgeMap, state, index, layer, params.frame, params.theme, params.sceneGraph, state.count, params.stampAtlas);
    const sourceAffinity = sourceAffinityForPoint(params.edgeMap, params.sceneGraph, params.compositionPlan, x, y, layer);
    sourceAffinitySum += sourceAffinity;
    if (layer === "hero") {
      sourceAffinityHeroSum += sourceAffinity;
      sourceAffinityHeroCount += 1;
    } else if (layer === "support") {
      sourceAffinitySupportSum += sourceAffinity;
      sourceAffinitySupportCount += 1;
    }
    if (inProtectedZone) {
      negativeSpaceHits += layer === "background" ? 0.35 : 1;
    }
    placementScoreSum += slotDistanceScore(x, y, params.compositionPlan, layer);
    const motionPx = Math.hypot(state.vx[index] ?? 0, state.vy[index] ?? 0);
    convergenceScoreSum += sourceAffinity * clamp(1 - motionPx / 8, 0, 1);
    const motionScript = motionScriptFor(params.sceneGraph, index);
    if (layer === "hero") {
      heroCount += 1;
    } else if (layer === "support") {
      supportCount += 1;
      supportMotionSum += motionPx;
      supportMotionCount += 1;
    } else {
      backgroundCount += 1;
      backgroundMotionSum += motionPx;
      backgroundMotionCount += 1;
    }
    if (motionScript === "emit-chain" || motionScript === "emit-to-edge") {
      emitterUsage += 1;
    }
    if (motionScript === "absorb-well") {
      absorberUsage += 1;
    }
    if ((motionScript === "release-bloom" || motionScript === "burst-falloff") && (params.frame.isFourBarDownbeat || (params.frame.phrasePulse ?? 0) > 0.45)) {
      explosionCount += 1;
    }
    const subEmitterCap = params.diagnosticOverrides?.disableParticleCaps
      ? Number.POSITIVE_INFINITY
      : params.edgeMap.maskConfidence === "low" || (params.qualityBudget?.particleLimitScale ?? 1) < 0.9 ? 4 : (params.qualityBudget?.particleLimitScale ?? 1) < 1 ? 10 : 18;
    const singleHeroScene = params.sceneGraph.heroClusterConfig.count <= 1;
    const subEmitterTrigger =
      sourceAffinity > (singleHeroScene ? 0.42 : 0.54) &&
      subEmitterChildren < subEmitterCap &&
      (
        params.frame.isBeatAccent ||
        (params.frame.barPulse ?? 0) > (singleHeroScene ? 0.15 : 0.3) ||
        (params.frame.phrasePulse ?? 0) > (singleHeroScene ? 0.18 : 0.35)
      );
    if (subEmitterTrigger) {
      subEmitterTriggerCount += singleHeroScene ? 2 : 1;
      const childCount =
        params.sceneGraph.subEmitterMode === "spark-fork" ? 3 :
        params.sceneGraph.subEmitterMode === "mask-fracture" ? 2 :
        params.sceneGraph.subEmitterMode === "petal-shed" ? 2 :
        1;
      const effectiveChildCount = childCount * (singleHeroScene ? 2 : 1);
      subEmitterChildren += Math.min(Math.round(effectiveChildCount * particleSpawnScale), subEmitterCap - subEmitterChildren);
    }
    if (index % 2 === 0 && layer !== "background") {
      const purpose = occupancyPurposeFor(params.sceneGraph, index);
      const lowMotionThreshold = params.sceneGraph.occupancyPolicy.suppressLowMotionBelow;
      const supportsLowMotion =
        (layer === "hero" && params.sceneGraph.occupancyPolicy.heroAllowed.includes(purpose)) ||
        (layer === "support" && params.sceneGraph.occupancyPolicy.supportAllowed.includes(purpose) && params.sceneGraph.intentSeed.intent === "orbit-ritual") ||
        false;
      if (motionPx >= lowMotionThreshold || supportsLowMotion) {
        occupancy.push({
          x,
          y,
          weight: clamp(state.toneWeight[index]! * (layer === "hero" ? 0.9 : 0.6) + state.edgeWeight[index]! * 0.45, 0.2, 1.6),
          radius: layer === "hero" ? 8 + state.currentSize[index]! : 5 + state.currentSize[index]! * 0.6,
          layer,
          purpose,
          motionPx,
        });
        occupancyDrawCount += 1;
      }
    }
    if (anchors.length < 28 && index % 4 === 0 && layer !== "background") {
      const particleAnchorType = anchorTypeName(state, index);
      anchors.push({
        x,
        y,
        radius: (layer === "hero" ? 10 : 6) + state.currentSize[index]! * (layer === "hero" ? 0.8 : 0.5),
        intensity: (layer === "hero" ? 0.34 : 0.2) + state.brightness[index]! * 0.12,
        color: plasmaCoreColor(params.theme, 0.1, state.hueOffset[index]!),
        kind: particleAnchorType === "region" ? "core" : "edge",
        weight: (layer === "hero" ? 1 : 0.65) + state.edgeWeight[index]! + state.toneWeight[index]! * 0.2,
      });
    }
  }
  ctx2d.restore();
  const particlesMs = performance.now() - particleStartedAt;
  state.lastFrameIndex = params.frame.frameIndex;
  state.cachedOccupancy = occupancy;
  state.cachedAnchors = anchors;
  state.lastBudgetDowngradeCount = budgetDowngradeCount;
  const renderedCount = Math.max(1, heroCount + supportCount + backgroundCount);
  const supportElementDensity = supportCount / Math.max(1, renderedCount);
  const backgroundElementDensity = backgroundCount / Math.max(1, renderedCount);
  const heroIsolationScore = clamp(1 - supportElementDensity * 1.45 - backgroundElementDensity * 0.55, 0, 1);
  const nearHeroEventDensity = clamp((emitterUsage + absorberUsage + explosionCount * 0.08) / Math.max(1, renderedCount), 0, 1.5);
  const heroToSupportDistanceScore = clamp(1 - Math.min(1, Math.abs(supportElementDensity - 0.28) * 2.4), 0, 1);
  return {
    anchors,
    occupancy,
    heroCoverage: heroCount / renderedCount,
    backgroundClutterRatio: backgroundCount / renderedCount,
    supportCoverage: supportCount / renderedCount,
    negativeSpaceOccupancy: clamp(negativeSpaceHits / Math.max(1, renderedCount), 0, 1),
    shapePlacementScore: placementScoreSum / Math.max(1, renderedCount),
    eventDensity: clamp((emitterUsage + absorberUsage + explosionCount) / Math.max(1, renderedCount), 0, 1.4),
    emitterUsage,
    absorberUsage,
    explosionCount,
    sourceAffinityAvg: sourceAffinitySum / Math.max(1, renderedCount),
    sourceAffinityHeroAvg: sourceAffinityHeroSum / Math.max(1, sourceAffinityHeroCount),
    sourceAffinitySupportAvg: sourceAffinitySupportSum / Math.max(1, sourceAffinitySupportCount),
    particleConvergenceScore: convergenceScoreSum / Math.max(1, renderedCount),
    subEmitterChildren,
    particleLifecycle: {
      particleSpawnRequests,
      particleRenderedCount,
      particleCulledByLayerCap,
      particleCulledByHeroProtection,
      particleCulledByNegativeSpace,
      particleCulledByImageProgress,
      particleCulledBySkipNonHero,
      particleOffscreenCount,
      particleTooSmallToReadCount,
      particleLowAlphaCount,
      particleLowContrastCount,
      particleVisibleCount,
      heroParticleRenderedCount,
      supportParticleRenderedCount,
      backgroundParticleRenderedCount,
      subEmitterTriggerCount,
      subEmitterChildSpawnedCount: subEmitterChildren,
      edgeDeathEligibleCount,
      edgeDeathTriggeredCount,
      edgeDeathPlayedCount,
      edgeDeathSkippedByCostCount,
      edgeDeathEffectId: lastEdgeDeathEffectId,
      edgeDeathCostTier: lastEdgeDeathCostTier,
      edgeExitFramesAvg: edgeDeathTriggeredCount > 0 ? edgeExitFramesTotal / edgeDeathTriggeredCount : 0,
      edgeExitDistanceAvg: edgeDeathTriggeredCount > 0 ? edgeExitDistanceTotal / edgeDeathTriggeredCount : 0,
    },
    supportElementDensity,
    backgroundElementDensity,
    heroIsolationScore,
    nearHeroEventDensity,
    heroToSupportDistanceScore,
    budgetDowngradeCount,
    stageMetrics: {
      particlesMs,
      occupancyMs: 0,
      stampDrawCount,
      supportStampDrawCount,
      backgroundStampDrawCount,
      vectorDrawCount,
      occupancyDrawCount,
      heroGlyphDrawCount: 0,
      gradientCreateCount,
      heroMs: 0,
      avgSupportMotionPx: supportMotionSum / Math.max(1, supportMotionCount),
      avgBackgroundMotionPx: backgroundMotionSum / Math.max(1, backgroundMotionCount),
    },
  };
}

export function getParticleSystemState(existing?: ParticleSystemState): ParticleSystemState {
  return existing ?? createParticleState();
}
