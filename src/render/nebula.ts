import { clamp } from "../config";
import type {
  ActiveSubjectSnapshot,
  AtmosphereGraph,
  AudioFrameFeature,
  CompositionPlan,
  ContourPoint,
  DiagnosticOverrides,
  EdgeContour,
  EdgeMap,
  NebulaGlowAnchor,
  NebulaRenderParams,
  ParticleSystemState,
  SceneGraph,
  RenderQualityBudget,
  RenderTheme,
  ShapeBias,
  VisualState,
} from "../types";
import type { ShapeStampAtlas } from "./stamp-atlas";
import { fractalNoise2D, hashFloat, sampleBodyNoise2D, sampleNoise2D } from "./noise";
import { renderEdgeParticles, renderOccupancyShapes } from "./particle-engine";
import { stableImageSeed } from "./image-seed";
import { dustColor, lightningColor, paletteColor, plasmaBodyColor, plasmaCoreColor, sparkColor } from "./palette";

interface Point {
  x: number;
  y: number;
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function safeRadius(radius: number, fallback = 1): number {
  if (!Number.isFinite(radius)) {
    return fallback;
  }
  return Math.max(0.001, radius);
}

interface WeightedContour {
  contour: EdgeContour;
  score: number;
}

const contourSelectionCache = new WeakMap<EdgeMap, Map<ShapeBias, WeightedContour[]>>();

interface NebulaContext {
  edgeMap: EdgeMap;
  frame: AudioFrameFeature;
  theme: RenderTheme;
  width: number;
  height: number;
  fps: number;
  render: NebulaRenderParams;
  quality: "balanced" | "fast";
  compositionPlan: CompositionPlan;
  diagnosticOverrides?: DiagnosticOverrides;
}

const TAU = Math.PI * 2;
const NEBULA_PULSE_MAX_SCALE = 0.9;

function cappedPulseScale(pulseScale: number, maxScale: number): number {
  const softened = 1 + (pulseScale - 1) * NEBULA_PULSE_MAX_SCALE;
  return clamp(softened, 1, maxScale);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function shapeContourCount(shape: ShapeBias, quality: NebulaContext["quality"]): number {
  const base = quality === "fast" ? 4 : 5;
  switch (shape) {
    case "cloud":
      return base;
    case "filament":
      return base + 1;
    case "shard":
      return base;
    case "ring":
      return base;
    case "cellular":
      return base;
  }
}

function makeContext(params: {
  compositionPlan: CompositionPlan;
  edgeMap: EdgeMap;
  frame: AudioFrameFeature;
  theme: RenderTheme;
  width: number;
  height: number;
  fps: number;
  imageProgress: number;
  diagnosticOverrides?: DiagnosticOverrides;
}): NebulaContext {
  const quality = params.fps >= 50 ? "fast" : "balanced";
  const style = params.theme.styleMode;
  const particle = params.theme.particleMode;
  const starBias = particle === "dust" ? 0.95 : particle === "shards" ? 0.72 : 0.84;
  const sparkBias = particle === "dust" ? 0.2 : particle === "orbs" ? 0.45 : particle === "streaks" ? 0.9 : particle === "shards" ? 0.85 : 0.65;
  return {
    ...params,
    quality,
    render: {
      vortexCenterX: params.width * 0.5,
      vortexCenterY: params.height * 0.52,
      vortexStrength: 8 + params.frame.normalizedLow * 8 + params.frame.peakStrength * 4,
      swirlStrength: 0.18 + params.frame.normalizedLowMid * 0.16 + params.theme.vortexBias * 0.08 + (style === "ring" ? 0.04 : 0),
      noiseScale: 0.0011 + params.frame.normalizedMid * 0.00045,
      noiseOctaves: 3,
      plasmaDensity: clamp(0.78 + params.theme.densityScale * 0.2 + params.frame.normalizedMid * 0.12, 0.75, 1.18),
      sparkDensity: clamp((0.22 + params.frame.normalizedHigh * 0.4 + params.frame.peakStrength * 0.16) * sparkBias, 0.1, 1),
      starDensity: clamp(0.72 + params.theme.densityScale * 0.1 + starBias * 0.08, 0.7, 1.05),
      edgeFieldStrength: clamp(0.68 + params.frame.normalizedMid * 0.18 + params.edgeMap.complexity * 0.16, 0.66, 1.24),
      contourSampleLimit: quality === "fast" ? 14 : 20,
      trailStepLimit: quality === "fast" ? 3 : 4,
      lightningSampleLimit: quality === "fast" ? 10 : 16,
      dustBudget: quality === "fast" ? 260 : 420,
      sparkBudget: Math.round((quality === "fast" ? 32 : 54) * sparkBias),
      starBudget: Math.round((quality === "fast" ? 150 : 210) * starBias),
    },
  };
}

function contourScore(contour: EdgeContour): number {
  const averageCurvature =
    contour.points.reduce((sum, point) => sum + Math.abs(point.curvature), 0) / Math.max(1, contour.points.length);
  return contour.strength * 0.7 + contour.length * 0.06 + averageCurvature * 240;
}

function selectContours(ctx: NebulaContext): WeightedContour[] {
  let styleCache = contourSelectionCache.get(ctx.edgeMap);
  if (!styleCache) {
    styleCache = new Map<ShapeBias, WeightedContour[]>();
    contourSelectionCache.set(ctx.edgeMap, styleCache);
  }
  const cached = styleCache.get(ctx.theme.styleMode);
  if (cached) {
    return cached;
  }
  const selected = ctx.edgeMap.contours
    .map((contour) => ({ contour, score: contourScore(contour) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, shapeContourCount(ctx.theme.styleMode, ctx.quality));
  styleCache.set(ctx.theme.styleMode, selected);
  return selected;
}

function tangentFor(contour: EdgeContour, index: number): Point {
  const prev = contour.points[(index - 1 + contour.points.length) % contour.points.length]!;
  const next = contour.points[(index + 1) % contour.points.length]!;
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty) || 1;
  return { x: tx / length, y: ty / length };
}

function addAnchor(
  anchors: NebulaGlowAnchor[],
  point: Point,
  radius: number,
  intensity: number,
  color: string,
  kind: NebulaGlowAnchor["kind"],
  weight: number,
): void {
  if (anchors.length >= 40) {
    return;
  }
  anchors.push({ x: point.x, y: point.y, radius, intensity, color, kind, weight });
}

function fillBlob(ctx2d: CanvasRenderingContext2D, center: Point, radius: number, inner: string, outer: string): void {
  if (!isFinitePoint(center)) {
    return;
  }
  const safe = safeRadius(radius, 1);
  if (safe <= 6) {
    ctx2d.fillStyle = inner;
    ctx2d.beginPath();
    ctx2d.arc(center.x, center.y, safe, 0, TAU);
    ctx2d.fill();
    return;
  }
  const gradient = ctx2d.createRadialGradient(center.x, center.y, 0, center.x, center.y, safe);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.58, outer);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx2d.fillStyle = gradient;
  ctx2d.beginPath();
  ctx2d.arc(center.x, center.y, safe, 0, TAU);
  ctx2d.fill();
}

function fillShard(ctx2d: CanvasRenderingContext2D, center: Point, radius: number, rotation: number, fillStyle: string): void {
  if (!isFinitePoint(center) || !Number.isFinite(rotation)) {
    return;
  }
  const safe = safeRadius(radius, 1);
  ctx2d.fillStyle = fillStyle;
  ctx2d.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const angle = rotation + (i * Math.PI) / 2;
    const distanceFactor = i % 2 === 0 ? safe : safe * 0.38;
    const x = center.x + Math.cos(angle) * distanceFactor;
    const y = center.y + Math.sin(angle) * distanceFactor;
    if (i === 0) {
      ctx2d.moveTo(x, y);
    } else {
      ctx2d.lineTo(x, y);
    }
  }
  ctx2d.closePath();
  ctx2d.fill();
}

function pointWeight(contourScoreValue: number, point: ContourPoint, sampleIndex: number, ctx: NebulaContext): number {
  const edgePoint = ctx.edgeMap.points[(sampleIndex * 13) % ctx.edgeMap.points.length];
  const edgeBoost = edgePoint ? clamp(edgePoint.strength / 220, 0.2, 1.35) : 0.6;
  return clamp(
    contourScoreValue / 260 + Math.abs(point.curvature) * 1.35 + edgeBoost * 0.4 + ctx.frame.normalizedMid * 0.22,
    0.4,
    2.2,
  );
}

function deformPoint(
  point: ContourPoint,
  tangent: Point,
  ctx: NebulaContext,
  seed: number,
  tangentOffset: number,
  normalOffset: number,
  ridge = false,
): Point {
  const sourceX = point.x + tangent.x * tangentOffset + point.nx * normalOffset;
  const sourceY = point.y + tangent.y * tangentOffset + point.ny * normalOffset;
  let x = sourceX;
  let y = sourceY;
  const dx = x - ctx.render.vortexCenterX;
  const dy = y - ctx.render.vortexCenterY;
  const radius = Math.max(60, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const tangentAngle = Math.atan2(tangent.y, tangent.x);
  const edgeBias = tangentAngle * 0.18 * ctx.render.edgeFieldStrength;
  const swirl = angle + edgeBias + ctx.render.swirlStrength * clamp(1 - radius / Math.max(ctx.width, ctx.height), 0.08, 0.52);
  const pull = ctx.render.vortexStrength * clamp(1 - radius / Math.max(ctx.width, ctx.height), 0.08, 0.4);
  x = ctx.render.vortexCenterX + Math.cos(swirl) * Math.max(24, radius - pull);
  y = ctx.render.vortexCenterY + Math.sin(swirl) * Math.max(24, radius - pull * 0.88);
  const noiseSource = ridge ? fractalNoise2D : sampleBodyNoise2D;
  const noiseX = noiseSource(x * ctx.render.noiseScale, y * ctx.render.noiseScale, seed);
  const noiseY = noiseSource(y * ctx.render.noiseScale, x * ctx.render.noiseScale, seed + 17);
  x += noiseX * (ridge ? 14 + ctx.frame.normalizedHigh * 10 : 10 + ctx.frame.motionEnergy * 8);
  y += noiseY * (ridge ? 14 + ctx.frame.normalizedHigh * 10 : 10 + ctx.frame.motionEnergy * 8);
  const shapeLock = clamp(
    ridge ? 0.72 + ctx.edgeMap.complexity * 0.1 : 0.82 + ctx.edgeMap.complexity * 0.12,
    ridge ? 0.72 : 0.82,
    ridge ? 0.9 : 0.96,
  );
  x = sourceX * shapeLock + x * (1 - shapeLock);
  y = sourceY * shapeLock + y * (1 - shapeLock);
  return { x, y };
}

function drawContourSkeleton(ctx2d: CanvasRenderingContext2D, contours: WeightedContour[], ctx: NebulaContext): void {
  const count = Math.min(contours.length, 3);
  for (let contourIndex = 0; contourIndex < count; contourIndex += 1) {
    const contour = contours[contourIndex]!.contour;
    ctx2d.save();
    ctx2d.strokeStyle = paletteColor(ctx.theme, contourIndex / Math.max(1, count), 0.045 + contourIndex * 0.01, 4);
    ctx2d.lineWidth = 1 + contourIndex * 0.28 + ctx.frame.normalizedMid * 0.28;
    ctx2d.beginPath();
    for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex += 1) {
      const point = contour.points[pointIndex]!;
      const pulse = sampleNoise2D(pointIndex * 0.07, ctx.frame.timeSec * 0.18, contourIndex * 29);
      const x = point.x + point.nx * pulse * 3;
      const y = point.y + point.ny * pulse * 3;
      if (pointIndex === 0) {
        ctx2d.moveTo(x, y);
      } else {
        ctx2d.lineTo(x, y);
      }
    }
    if (contour.closed) {
      ctx2d.closePath();
    }
    ctx2d.stroke();
    ctx2d.restore();
  }
}

function drawFilamentCore(
  ctx2d: CanvasRenderingContext2D,
  point: ContourPoint,
  tangent: Point,
  seed: number,
  ctx: NebulaContext,
  anchors: NebulaGlowAnchor[],
): void {
  const path: Point[] = [];
  const steps = Math.min(3, ctx.render.trailStepLimit);
  const pulseScale = cappedPulseScale(ctx.frame.pulseScale, 3.7);
  for (let step = 0; step < steps; step += 1) {
    path.push(deformPoint(point, tangent, ctx, seed + step * 19, step * 7 * pulseScale, Math.sin(step + seed) * 5 * pulseScale));
  }
  if (path.length < 2) {
    return;
  }
  ctx2d.strokeStyle = ctx.theme.midBandColor;
  ctx2d.lineWidth = 1.1 + ctx.frame.normalizedMid * 1.4;
  ctx2d.lineCap = "round";
  ctx2d.beginPath();
  ctx2d.moveTo(path[0]!.x, path[0]!.y);
  for (let i = 1; i < path.length; i += 1) {
    ctx2d.lineTo(path[i]!.x, path[i]!.y);
  }
  ctx2d.stroke();
  addAnchor(anchors, path[1] ?? path[0]!, (10 + ctx.frame.normalizedMid * 7) * cappedPulseScale(ctx.frame.pulseScale * 0.5, 1.9), 0.24, ctx.theme.midBandColor, "edge", 0.7);
}

function drawRingArc(ctx2d: CanvasRenderingContext2D, center: Point, radius: number, seed: number, ctx: NebulaContext): void {
  const start = hashFloat(seed) * TAU;
  const sweep = Math.PI * (0.35 + hashFloat(seed + 3) * 0.35);
  ctx2d.strokeStyle = paletteColor(ctx.theme, hashFloat(seed + 7), 0.08, 6);
  ctx2d.lineWidth = 1.2 + ctx.frame.normalizedLowMid;
  ctx2d.beginPath();
  const safe = safeRadius(radius * cappedPulseScale(ctx.frame.pulseScale, 3.7), 1);
  if (!isFinitePoint(center) || !Number.isFinite(start) || !Number.isFinite(sweep)) {
    return;
  }
  ctx2d.arc(center.x, center.y, safe, start, start + sweep);
  ctx2d.stroke();
}

function drawStyleCluster(
  ctx2d: CanvasRenderingContext2D,
  contour: EdgeContour,
  contourScoreValue: number,
  point: ContourPoint,
  index: number,
  ctx: NebulaContext,
  anchors: NebulaGlowAnchor[],
  dustState: { used: number },
): void {
  const weight = pointWeight(contourScoreValue, point, index, ctx);
  const clusterSize =
    ctx.theme.styleMode === "cloud" ? 4 :
    ctx.theme.styleMode === "cellular" ? 5 :
    ctx.theme.styleMode === "shard" ? 3 :
    ctx.theme.styleMode === "ring" ? 3 :
    weight > 1.2 ? 4 : 3;
  const baseRadius =
    ctx.theme.styleMode === "cloud" ? 24 + weight * 14 :
    ctx.theme.styleMode === "cellular" ? 18 + weight * 12 :
    ctx.theme.styleMode === "shard" ? 12 + weight * 8 :
    14 + weight * 14;

  const contourTangent = tangentFor(contour, index);
  for (let clusterIndex = 0; clusterIndex < clusterSize; clusterIndex += 1) {
    const tangentOffset = (clusterIndex - (clusterSize - 1) * 0.5) * (ctx.theme.styleMode === "ring" ? 15 : 9 + weight * 4);
    const normalOffset = sampleNoise2D(index * 0.11, clusterIndex * 0.23, ctx.frame.frameIndex + 7) * (ctx.theme.styleMode === "cloud" ? 20 : 10 + weight * 8);
    const center = deformPoint(point, contourTangent, ctx, index * 41 + clusterIndex * 17, tangentOffset, normalOffset);
    const localPulseScale = cappedPulseScale(ctx.frame.pulseScale * (0.9 + Math.abs(point.curvature) * 0.25), 3.7);
    const radius = baseRadius * (clusterIndex === 0 ? 1 : ctx.theme.styleMode === "cloud" ? 0.82 : 0.62) * localPulseScale;

    switch (ctx.theme.styleMode) {
      case "cloud":
        fillBlob(ctx2d, center, radius, ctx.theme.midBandColor, plasmaBodyColor(ctx.theme, 0.085, weight * 0.2));
        break;
      case "shard":
        fillShard(ctx2d, center, radius, hashFloat(index * 97 + clusterIndex * 31) * TAU, paletteColor(ctx.theme, clusterIndex / clusterSize, 0.12, 8));
        break;
      case "ring":
        fillBlob(ctx2d, center, radius * 0.75, ctx.theme.lowMidBandColor, "rgba(0, 0, 0, 0)");
        drawRingArc(ctx2d, center, radius * 0.9, index * 71 + clusterIndex * 13, ctx);
        break;
      case "cellular":
        fillBlob(ctx2d, center, radius, paletteColor(ctx.theme, clusterIndex / clusterSize, 0.12, 4), plasmaBodyColor(ctx.theme, 0.07, 0.15));
        if (clusterIndex > 0) {
          fillBlob(ctx2d, center, radius * 0.45, ctx.theme.nebula.coreCyan, "rgba(0, 0, 0, 0)");
        }
        break;
      case "filament":
      default:
        fillBlob(ctx2d, center, radius, clusterIndex === 0 ? ctx.theme.midBandColor : ctx.theme.lowMidBandColor, clusterIndex === 0 ? ctx.theme.lowBandColor : plasmaBodyColor(ctx.theme, 0.08, weight * 0.2));
        break;
    }

    if (clusterIndex === 0) {
      addAnchor(
        anchors,
        center,
        radius * 0.7,
        0.28 + weight * 0.15,
        ctx.theme.styleMode === "shard" ? ctx.theme.highBandColor : ctx.theme.midBandColor,
        "core",
        weight,
      );
    }

    if (dustState.used < ctx.render.dustBudget && ctx.theme.particleMode !== "shards" && clusterIndex > 0) {
      const dust = {
        x: center.x + point.nx * (5 + clusterIndex * 4),
        y: center.y + point.ny * (5 + clusterIndex * 4),
      };
      fillBlob(ctx2d, dust, 2.2, dustColor(ctx.theme, 0.045, clusterIndex / clusterSize), "rgba(0, 0, 0, 0)");
      dustState.used += 1;
    }
  }

  if (ctx.theme.styleMode === "filament" || ctx.theme.styleMode === "cellular") {
    drawFilamentCore(ctx2d, point, contourTangent, index * 53, ctx, anchors);
  }
}

function shouldDrawRidge(point: ContourPoint, weight: number, ctx: NebulaContext): boolean {
  if (ctx.theme.styleMode === "cloud" && ctx.frame.peakStrength < 0.45) {
    return false;
  }
  return weight > 1.05 && Math.abs(point.curvature) > 0.1 && (ctx.frame.normalizedHigh > 0.24 || ctx.frame.peakStrength > 0.28);
}

function drawRidge(
  ctx2d: CanvasRenderingContext2D,
  point: ContourPoint,
  index: number,
  contour: EdgeContour,
  ctx: NebulaContext,
  anchors: NebulaGlowAnchor[],
  emitters: Point[],
): void {
  const tangent = tangentFor(contour, index);
  const steps = clamp(ctx.theme.styleMode === "ring" ? 5 : 4 + Math.round(ctx.frame.normalizedHigh * 2), 4, 6);
  const ridge: Point[] = [];
  for (let step = 0; step < steps; step += 1) {
    ridge.push(deformPoint(point, tangent, ctx, index * 71 + step * 23, step * 8, (step - 2) * 5, true));
  }
  ctx2d.strokeStyle = lightningColor(ctx.theme, 0.1 + ctx.frame.normalizedHigh * 0.05, 0.2);
  ctx2d.lineWidth = ctx.theme.styleMode === "shard" ? 2.4 : 1.8 + ctx.frame.peakStrength * 1.2;
  ctx2d.lineCap = "round";
  ctx2d.lineJoin = "round";
  ctx2d.beginPath();
  ctx2d.moveTo(ridge[0]!.x, ridge[0]!.y);
  for (let i = 1; i < ridge.length; i += 1) {
    ctx2d.lineTo(ridge[i]!.x, ridge[i]!.y);
  }
  ctx2d.stroke();
  ctx2d.strokeStyle = ctx.theme.highBandColor;
  ctx2d.lineWidth = 0.9 + ctx.frame.normalizedHigh * 0.7;
  ctx2d.beginPath();
  ctx2d.moveTo(ridge[0]!.x, ridge[0]!.y);
  for (let i = 1; i < ridge.length; i += 1) {
    ctx2d.lineTo(ridge[i]!.x, ridge[i]!.y);
  }
  ctx2d.stroke();
  const mid = ridge[Math.floor(ridge.length / 2)]!;
  addAnchor(anchors, mid, 14 + ctx.frame.normalizedHigh * 10, 0.42, ctx.theme.highBandColor, "ridge", 1.15);
  emitters.push(mid);
}

function drawStars(ctx2d: CanvasRenderingContext2D, ctx: NebulaContext): void {
  const maskFactor = ctx.edgeMap.maskConfidence === "high" ? 0.35 : ctx.edgeMap.maskConfidence === "medium" ? 0.25 : 0.18;
  const particleSpawnScale = ctx.diagnosticOverrides?.particleSpawnScale ?? 1;
  const total = Math.min(ctx.compositionPlan.starSlots.length, Math.round(ctx.render.starBudget * 0.08 * ctx.render.starDensity * (1 + maskFactor) * particleSpawnScale));
  const imageSeed = stableImageSeed(ctx.edgeMap.imagePath, ctx.edgeMap.points.length * 17);
  for (let index = 0; index < total; index += 1) {
    const slot = ctx.compositionPlan.starSlots[index]!;
    const x = slot.x + sampleNoise2D(index * 0.11, ctx.frame.timeSec * 0.15, imageSeed + index) * 18;
    const y = slot.y + sampleNoise2D(index * 0.17, ctx.frame.timeSec * 0.13, imageSeed + index + 7) * 14;
    const tier = index % 9;
    const shimmer = sampleNoise2D(index * 0.09, ctx.frame.timeSec * 0.28, imageSeed + tier) * 0.6;
    if (ctx.theme.particleMode === "orbs" && tier === 0) {
      fillBlob(ctx2d, { x, y }, 9 + (index % 3) * 4, paletteColor(ctx.theme, 0.2 + index / total, 0.06), "rgba(0, 0, 0, 0)");
      continue;
    }
    if (tier === 0) {
      fillBlob(ctx2d, { x: x + shimmer, y: y + shimmer * 0.6 }, 8 + (index % 3) * 4, "rgba(128, 184, 255, 0.07)", "rgba(0, 0, 0, 0)");
      continue;
    }
    ctx2d.fillStyle = tier < 3 ? "rgba(212, 232, 255, 0.82)" : "rgba(173, 205, 255, 0.48)";
    ctx2d.beginPath();
    ctx2d.arc(x + shimmer, y, tier < 3 ? 1.1 : 0.6, 0, TAU);
    ctx2d.fill();
  }
}

function drawSecondaryHaze(ctx2d: CanvasRenderingContext2D, ctx: NebulaContext): void {
  const source = [
    ...ctx.compositionPlan.supportSlots.map((slot) => ({ x: slot.x, y: slot.y, radius: slot.radius, weight: slot.weight })),
    ...ctx.edgeMap.spawners,
  ];
  const count = Math.min(source.length, ctx.edgeMap.maskConfidence === "low" ? 5 : ctx.quality === "fast" ? 6 : 8);
  for (let index = 0; index < count; index += 1) {
    const spawner = source[index]!;
    const radius = (ctx.theme.styleMode === "cloud" ? 1.2 : ctx.theme.styleMode === "cellular" ? 1 : 0.82) * spawner.radius * cappedPulseScale(ctx.frame.pulseScale * 0.6, 2.26);
    if (!Number.isFinite(radius)) {
      continue;
    }
    fillBlob(
      ctx2d,
      { x: spawner.x, y: spawner.y },
      radius,
      paletteColor(ctx.theme, index / Math.max(1, count), 0.045 + spawner.weight * 0.015, 4),
      "rgba(0, 0, 0, 0)",
    );
  }
}

function drawParticleDressings(ctx2d: CanvasRenderingContext2D, anchors: NebulaGlowAnchor[], ctx: NebulaContext): void {
  switch (ctx.theme.particleMode) {
    case "orbs":
      for (let i = 0; i < Math.min(anchors.length, 12); i += 1) {
        fillBlob(ctx2d, anchors[i]!, 8 + (i % 3) * 5, paletteColor(ctx.theme, i / 12, 0.08, 10), "rgba(0, 0, 0, 0)");
      }
      break;
    case "shards":
      for (let i = 0; i < Math.min(anchors.length, 14); i += 1) {
        fillShard(ctx2d, anchors[i]!, 5 + (i % 3) * 3, hashFloat(i * 17) * TAU, paletteColor(ctx.theme, i / 14, 0.12, 14));
      }
      break;
    case "dust":
      for (let i = 0; i < Math.min(anchors.length, 20); i += 1) {
        fillBlob(ctx2d, anchors[i]!, 3.5, dustColor(ctx.theme, 0.035, i / 20), "rgba(0, 0, 0, 0)");
      }
      break;
    case "streaks":
      ctx2d.strokeStyle = paletteColor(ctx.theme, 0.65, 0.09, 12);
      ctx2d.lineWidth = 1;
      for (let i = 0; i < Math.min(anchors.length, 12); i += 1) {
        const start = anchors[i]!;
        ctx2d.beginPath();
        ctx2d.moveTo(start.x, start.y);
        ctx2d.lineTo(start.x + 10 + (i % 4) * 6, start.y - 6 + (i % 3) * 5);
        ctx2d.stroke();
      }
      break;
    case "mixed":
    default:
      break;
  }
}

function drawSparks(ctx2d: CanvasRenderingContext2D, emitters: Point[], ctx: NebulaContext): void {
  if (emitters.length === 0 || ctx.frame.normalizedHigh < 0.18 || ctx.theme.particleMode === "dust") {
    return;
  }
  const total = Math.min(
    ctx.render.sparkBudget,
    ctx.frame.peakStrength >= 0.35 ? Math.round(30 + ctx.frame.normalizedHigh * 18) : Math.round(10 + ctx.frame.normalizedHigh * 10),
  );
  ctx2d.lineCap = "round";
  for (let index = 0; index < total; index += 1) {
    const emitter = emitters[index % emitters.length]!;
    const angle = hashFloat(ctx.frame.frameIndex * 131 + index * 17) * TAU;
    const speed =
      ctx.theme.particleMode === "streaks" || ctx.theme.particleMode === "shards"
        ? 10 + hashFloat(ctx.frame.frameIndex * 151 + index * 43) * 16
        : 6 + hashFloat(ctx.frame.frameIndex * 151 + index * 43) * 10;
    const end = {
      x: emitter.x + Math.cos(angle) * speed,
      y: emitter.y + Math.sin(angle + ctx.render.swirlStrength * 0.05) * speed,
    };
    ctx2d.strokeStyle = sparkColor(ctx.theme, 0.42 + (index % 3) * 0.1, index % 4 === 0);
    ctx2d.lineWidth = ctx.theme.particleMode === "shards" ? 1.6 : index % 3 === 0 ? 1.4 : 1;
    ctx2d.beginPath();
    ctx2d.moveTo(emitter.x, emitter.y);
    ctx2d.lineTo(end.x, end.y);
    ctx2d.stroke();
  }
}

function drawShadowHaze(ctx2d: CanvasRenderingContext2D, anchors: NebulaGlowAnchor[], ctx: NebulaContext): void {
  ctx2d.save();
  for (const anchor of anchors.slice(0, 10)) {
    const radius = anchor.kind === "ridge" ? anchor.radius * 2 : anchor.radius * 2.6;
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.radius) || !Number.isFinite(radius)) {
      continue;
    }
    const gradient = ctx2d.createRadialGradient(anchor.x, anchor.y, Math.max(0.001, anchor.radius * 0.2), anchor.x, anchor.y, safeRadius(radius, 1));
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.58, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, ctx.theme.shadowTint);
    ctx2d.fillStyle = gradient;
    ctx2d.beginPath();
    ctx2d.arc(anchor.x, anchor.y, safeRadius(radius, 1), 0, TAU);
    ctx2d.fill();
  }
  ctx2d.restore();
}

function drawVeils(
  ctx2d: CanvasRenderingContext2D,
  atmosphereGraph: AtmosphereGraph,
  ctx: NebulaContext,
): { draws: number; gradients: number } {
  const strips = atmosphereGraph.veilStrips.slice(0, ctx.quality === "fast" ? 5 : 8);
  let gradients = 0;
  let draws = 0;
  for (const [index, strip] of strips.entries()) {
    if (strip.points.length < 3) {
      continue;
    }
    const first = strip.points[0]!;
    const last = strip.points[strip.points.length - 1]!;
    const gradient = ctx2d.createLinearGradient(first.x, first.y, last.x, last.y);
    gradients += 1;
    gradient.addColorStop(0, paletteColor(ctx.theme, strip.colorWeight, strip.alpha * 0.95, 2));
    gradient.addColorStop(0.5, paletteColor(ctx.theme, strip.colorWeight + 0.12 + ctx.frame.normalizedMid * 0.1, strip.alpha * 0.7, -4));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";
    ctx2d.strokeStyle = gradient;
    ctx2d.lineWidth = strip.width;
    ctx2d.beginPath();
    ctx2d.moveTo(first.x, first.y);
    for (let i = 1; i < strip.points.length; i += 1) {
      const point = strip.points[i]!;
      const prev = strip.points[i - 1]!;
      const cx = (prev.x + point.x) * 0.5;
      const cy = (prev.y + point.y) * 0.5;
      ctx2d.quadraticCurveTo(prev.x, prev.y, cx, cy);
    }
    ctx2d.stroke();
    if ((ctx.frame.normalizedHigh * 0.58 + ctx.frame.normalizedMid * 0.42) > 0.28 || index % 2 === 0) {
      ctx2d.globalAlpha = strip.alpha * 0.55;
      ctx2d.fillStyle = gradient;
      ctx2d.beginPath();
      ctx2d.moveTo(first.x, first.y);
      for (const point of strip.points.slice(1)) {
        ctx2d.lineTo(point.x, point.y);
      }
      ctx2d.closePath();
      ctx2d.fill();
    }
    ctx2d.restore();
    draws += 1;
  }
  return { draws, gradients };
}

function drawBridgeLattices(
  ctx2d: CanvasRenderingContext2D,
  atmosphereGraph: AtmosphereGraph,
  ctx: NebulaContext,
): { draws: number } {
  const bridges = atmosphereGraph.bridgeLattices.slice(0, ctx.quality === "fast" ? 7 : 10);
  let draws = 0;
  for (const [index, bridge] of bridges.entries()) {
    const mx = (bridge.fromX + bridge.toX) * 0.5;
    const my = (bridge.fromY + bridge.toY) * 0.5;
    const dx = bridge.toX - bridge.fromX;
    const dy = bridge.toY - bridge.fromY;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const bend = (bridge.mode === "burst-spokes" ? 0.08 : bridge.mode === "petal-chain" ? 0.18 : 0.12) * length;
    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";
    const bridgeFlow = clamp(0.88 + ctx.frame.normalizedMid * 0.26 + ctx.frame.normalizedHigh * 0.16, 0.88, 1.36);
    ctx2d.strokeStyle = paletteColor(ctx.theme, bridge.colorWeight + ctx.frame.rainbowHueOffset * 0.001, bridge.alpha * bridgeFlow, 4);
    ctx2d.lineWidth = bridge.width * clamp(0.92 + ctx.frame.normalizedLow * 0.22, 0.92, 1.18);
    ctx2d.beginPath();
    ctx2d.moveTo(bridge.fromX, bridge.fromY);
    ctx2d.quadraticCurveTo(mx + nx * bend, my + ny * bend, bridge.toX, bridge.toY);
    ctx2d.stroke();
    if (index % 2 === 0) {
      ctx2d.globalAlpha = bridge.alpha * 0.75;
      ctx2d.beginPath();
      ctx2d.arc(mx, my, Math.max(1.5, bridge.width * 1.8), 0, TAU);
      ctx2d.fillStyle = paletteColor(ctx.theme, bridge.colorWeight + 0.08 + ctx.frame.normalizedHigh * 0.04, bridge.alpha * (0.66 + ctx.frame.normalizedHigh * 0.26), 8);
      ctx2d.fill();
    }
    ctx2d.restore();
    draws += 1;
  }
  return { draws };
}

function drawLocalSymmetryAccents(
  ctx2d: CanvasRenderingContext2D,
  atmosphereGraph: AtmosphereGraph,
  ctx: NebulaContext,
): number {
  let draws = 0;
  for (const [zoneIndex, zone] of atmosphereGraph.symmetryZones.entries()) {
    ctx2d.save();
    ctx2d.translate(zone.x, zone.y);
    ctx2d.globalCompositeOperation = "screen";
    ctx2d.globalAlpha = zone.alpha * clamp(0.88 + ctx.frame.normalizedMid * 0.22 + ctx.frame.normalizedHigh * 0.18, 0.88, 1.28);
    ctx2d.strokeStyle = paletteColor(ctx.theme, 0.2 + zoneIndex * 0.2 + ctx.frame.normalizedHigh * 0.12, zone.alpha, 6);
    ctx2d.lineWidth = 1.1 + zoneIndex * 0.45;
    const repeats =
      zone.mode === "shard-kaleidoscope" ? 6 :
      zone.mode === "support-petals" ? 5 :
      zone.mode === "contour-bilateral" ? 2 :
      4;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const angle = (repeat / repeats) * TAU + ctx.frame.timeSec * 0.08;
      ctx2d.beginPath();
      ctx2d.ellipse(
        Math.cos(angle) * zone.radius * 0.14,
        Math.sin(angle) * zone.radius * 0.14,
        zone.radius * (zone.mode === "support-petals" ? 0.44 : 0.34),
        zone.radius * (zone.mode === "shard-kaleidoscope" ? 0.12 : 0.2),
        angle,
        0,
        TAU,
      );
      ctx2d.stroke();
    }
    ctx2d.restore();
    draws += 1;
  }
  return draws;
}

function drawLocalFieldGlow(
  ctx2d: CanvasRenderingContext2D,
  atmosphereGraph: AtmosphereGraph,
  ctx: NebulaContext,
): { draws: number; gradients: number } {
  const emitters = atmosphereGraph.emitters.slice(0, atmosphereGraph.localGlowBudget);
  let draws = 0;
  let gradients = 0;
  for (const emitter of emitters) {
    const radius = emitter.radius * clamp(0.92 + ctx.frame.normalizedLow * 0.34 + ctx.frame.normalizedMid * 0.18 + ctx.frame.normalizedHigh * 0.08, 0.92, 1.8);
    const gradient = ctx2d.createRadialGradient(emitter.x, emitter.y, 0, emitter.x, emitter.y, radius);
    gradients += 1;
    const alpha = emitter.alpha * (emitter.role === "hero" ? 1.32 : emitter.role === "support" ? 1 : 0.72);
    gradient.addColorStop(0, paletteColor(ctx.theme, emitter.colorWeight, alpha, 12));
    gradient.addColorStop(0.55, paletteColor(ctx.theme, emitter.colorWeight + 0.1 + ctx.frame.normalizedMid * 0.08, alpha * 0.42, -2));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";
    ctx2d.fillStyle = gradient;
    ctx2d.beginPath();
    ctx2d.arc(emitter.x, emitter.y, radius, 0, TAU);
    ctx2d.fill();
    ctx2d.restore();
    draws += 1;
  }
  return { draws, gradients };
}

export function renderNebula(
  ctx2d: CanvasRenderingContext2D,
  params: {
    edgeMap: EdgeMap;
    frame: AudioFrameFeature;
    theme: RenderTheme;
    compositionPlan: CompositionPlan;
    sceneGraph: SceneGraph;
    atmosphereGraph: AtmosphereGraph;
    visualState: VisualState;
    width: number;
    height: number;
    fps: number;
    particleState?: ParticleSystemState;
    imageProgress: number;
    activeSubject?: ActiveSubjectSnapshot;
    qualityBudget?: RenderQualityBudget;
    diagnosticOverrides?: DiagnosticOverrides;
    stampAtlas: ShapeStampAtlas;
    disableAtmosphere?: boolean;
  },
): {
  anchors: NebulaGlowAnchor[];
  occupancy: Array<{ x: number; y: number; weight: number; radius: number; layer: "hero" | "support" | "background" }>;
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
    atmosphereMs: number;
    stampDrawCount: number;
    supportStampDrawCount: number;
    backgroundStampDrawCount: number;
    vectorDrawCount: number;
    occupancyDrawCount: number;
    heroGlyphDrawCount: number;
    veilDrawCount: number;
    bridgeDrawCount: number;
    localGlowDrawCount: number;
    gradientCreateCount: number;
    heroMs: number;
    avgSupportMotionPx: number;
    avgBackgroundMotionPx: number;
  };
} {
  const ctx = makeContext(params);
  const contours = selectContours(ctx);
  const anchors: NebulaGlowAnchor[] = [];
  const emitters: Point[] = [];
  const dustState = { used: 0 };
  const calmFrame = ((params.frame.normalizedLow + params.frame.normalizedMid + params.frame.normalizedHigh) / 3) < 0.3 && params.frame.peakStrength < 0.25;
  const lowDetail = !params.diagnosticOverrides?.disableParticleCaps && ((params.qualityBudget?.particleLimitScale ?? 1) < 0.96 || calmFrame);
  const disableAtmosphere = params.disableAtmosphere ?? false;
  let atmosphereMs = 0;
  let veilDrawCount = 0;
  let bridgeDrawCount = 0;
  let localGlowDrawCount = 0;
  let atmosphereGradientCount = 0;
  let rosetteDrawCount = 0;

  if (!disableAtmosphere && (!lowDetail || params.frame.normalizedHigh > 0.2)) {
    drawStars(ctx2d, ctx);
  }

  ctx2d.save();
  ctx2d.globalCompositeOperation = "lighter";
  if (!disableAtmosphere && !lowDetail) {
    drawSecondaryHaze(ctx2d, ctx);
  }
  if (!disableAtmosphere) {
    drawContourSkeleton(ctx2d, contours, ctx);
  }
  const particleRender = renderEdgeParticles(ctx2d, {
    edgeMap: ctx.edgeMap,
    frame: ctx.frame,
    theme: ctx.theme,
    compositionPlan: ctx.compositionPlan,
    sceneGraph: params.sceneGraph,
    stampAtlas: params.stampAtlas,
    width: ctx.width,
    height: ctx.height,
    state: params.particleState,
    imageProgress: params.imageProgress,
    activeSubject: params.activeSubject,
    qualityBudget: params.qualityBudget,
    diagnosticOverrides: params.diagnosticOverrides,
  });
  const occupancyStartedAt = performance.now();
  renderOccupancyShapes(ctx2d, {
    edgeMap: ctx.edgeMap,
    frame: ctx.frame,
    theme: ctx.theme,
    compositionPlan: ctx.compositionPlan,
    sceneGraph: params.sceneGraph,
    visualState: params.visualState,
    occupancy: particleRender.occupancy,
    imageProgress: params.imageProgress,
    qualityBudget: params.qualityBudget,
  });
  const occupancyMs = performance.now() - occupancyStartedAt;
  anchors.push(...particleRender.anchors);

  if (!disableAtmosphere) {
    const contourLimit = ctx.edgeMap.maskConfidence === "low" ? 1 : ctx.edgeMap.maskConfidence === "medium" ? 2 : 3;
    for (const weightedContour of contours.slice(0, contourLimit)) {
      const contour = weightedContour.contour;
      const sampleCount = Math.min(ctx.render.contourSampleLimit, Math.max(12, Math.round(contour.points.length / 4)));
      const stride = Math.max(1, Math.floor(contour.points.length / sampleCount));
      let ridgeBudget = 0;
      for (let index = 0; index < contour.points.length; index += stride) {
        const point = contour.points[index]!;
        const weight = pointWeight(weightedContour.score, point, index, ctx);
        drawStyleCluster(ctx2d, contour, weightedContour.score, point, index, ctx, anchors, dustState);
        if (shouldDrawRidge(point, weight, ctx) && ridgeBudget < (ctx.theme.styleMode === "shard" ? 3 : ctx.theme.styleMode === "cloud" ? 1 : 2)) {
          drawRidge(ctx2d, point, index, contour, ctx, anchors, emitters);
          ridgeBudget += 1;
        }
      }
    }
  }

  if (!disableAtmosphere && (!lowDetail || anchors.length < 10)) {
    drawParticleDressings(ctx2d, anchors, ctx);
  }
  if (!disableAtmosphere && !calmFrame) {
    drawSparks(ctx2d, emitters.slice(0, ctx.render.lightningSampleLimit), ctx);
  }
  const atmosphereStartedAt = performance.now();
  const accentEmitters = params.atmosphereGraph.emitters.filter((emitter) => emitter.role !== "background").slice(0, 3);
  if (!disableAtmosphere && ((params.frame.barPulse ?? 0) > 0.22 || params.frame.isFourBarDownbeat)) {
    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";
    for (const [index, emitter] of accentEmitters.entries()) {
      const petals = params.sceneGraph.episodeSeed.episodeIntent === "procession-of-masks" ? 4 : 6;
      const radius = emitter.radius * (params.frame.isFourBarDownbeat ? 0.42 : 0.28);
      ctx2d.strokeStyle = paletteColor(ctx.theme, 0.14 + index * 0.18 + (params.frame.phrasePulse ?? 0) * 0.12, 0.06 + (params.frame.barPulse ?? 0) * 0.08, 6);
      ctx2d.lineWidth = 1.1 + (params.frame.phrasePulse ?? 0) * 1.2;
      for (let petal = 0; petal < petals; petal += 1) {
        const angle = (petal / petals) * TAU + params.frame.timeSec * 0.1;
        ctx2d.beginPath();
        ctx2d.ellipse(emitter.x, emitter.y, radius, radius * 0.28, angle, 0, TAU);
        ctx2d.stroke();
      }
      rosetteDrawCount += 1;
    }
    ctx2d.restore();
  }
  const veilMetrics = disableAtmosphere ? { draws: 0, gradients: 0 } : drawVeils(ctx2d, params.atmosphereGraph, ctx);
  const bridgeMetrics = disableAtmosphere ? { draws: 0 } : drawBridgeLattices(ctx2d, params.atmosphereGraph, ctx);
  const symmetryDrawCount = disableAtmosphere ? 0 : drawLocalSymmetryAccents(ctx2d, params.atmosphereGraph, ctx);
  const localGlowMetrics = disableAtmosphere ? { draws: 0, gradients: 0 } : drawLocalFieldGlow(ctx2d, params.atmosphereGraph, ctx);
  atmosphereMs += performance.now() - atmosphereStartedAt;
  veilDrawCount += veilMetrics.draws + symmetryDrawCount;
  bridgeDrawCount += bridgeMetrics.draws;
  localGlowDrawCount += localGlowMetrics.draws;
  atmosphereGradientCount += veilMetrics.gradients + localGlowMetrics.gradients;
  ctx2d.restore();

  anchors.sort(
    (a, b) =>
      distance(a, { x: ctx.render.vortexCenterX, y: ctx.render.vortexCenterY }) -
      distance(b, { x: ctx.render.vortexCenterX, y: ctx.render.vortexCenterY }),
  );
  if (!disableAtmosphere && (!lowDetail || params.frame.normalizedLow > 0.2)) {
    drawShadowHaze(ctx2d, anchors, ctx);
  }
  return {
    anchors: anchors.slice(0, 24),
    occupancy: particleRender.occupancy,
    heroCoverage: particleRender.heroCoverage,
    backgroundClutterRatio: particleRender.backgroundClutterRatio,
    supportCoverage: particleRender.supportCoverage,
    negativeSpaceOccupancy: particleRender.negativeSpaceOccupancy,
    shapePlacementScore: particleRender.shapePlacementScore,
    eventDensity: particleRender.eventDensity,
    emitterUsage: particleRender.emitterUsage,
    absorberUsage: particleRender.absorberUsage,
    explosionCount: particleRender.explosionCount,
    sourceAffinityAvg: particleRender.sourceAffinityAvg,
    sourceAffinityHeroAvg: particleRender.sourceAffinityHeroAvg,
    sourceAffinitySupportAvg: particleRender.sourceAffinitySupportAvg,
    particleConvergenceScore: particleRender.particleConvergenceScore,
    subEmitterChildren: particleRender.subEmitterChildren,
    particleLifecycle: particleRender.particleLifecycle,
    supportElementDensity: particleRender.supportElementDensity,
    backgroundElementDensity: particleRender.backgroundElementDensity,
    heroIsolationScore: particleRender.heroIsolationScore,
    nearHeroEventDensity: particleRender.nearHeroEventDensity,
    heroToSupportDistanceScore: particleRender.heroToSupportDistanceScore,
    budgetDowngradeCount: params.diagnosticOverrides?.disableBudgetDowngrades ? 0 : particleRender.budgetDowngradeCount + (params.qualityBudget?.budgetDowngradeCount ?? 0),
    stageMetrics: {
      ...particleRender.stageMetrics,
      occupancyMs,
      atmosphereMs,
      veilDrawCount: veilDrawCount + rosetteDrawCount,
      bridgeDrawCount,
      localGlowDrawCount,
      gradientCreateCount: particleRender.stageMetrics.gradientCreateCount + atmosphereGradientCount,
    },
  };
}
