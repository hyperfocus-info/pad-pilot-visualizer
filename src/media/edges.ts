import os from "node:os";
import sharp from "sharp";
import {
  EDGE_ANALYSIS_HEIGHT,
  EDGE_ANALYSIS_WIDTH,
  EDGE_POINT_TARGET,
  MAX_CONTOURS,
  clamp,
} from "../config";
import { buildFlowField } from "../render/edge-field";
import type {
  ContourPoint,
  EdgeContour,
  EdgeDensityField,
  EdgeMap,
  EdgeMaskField,
  EdgePoint,
  EdgeSpawner,
  EdgeSpatialBins,
  EdgeToneField,
  ImageAsset,
} from "../types";

interface GradientSample {
  gx: number;
  gy: number;
  magnitude: number;
}

interface RawPoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  strength: number;
}

interface DensityCell {
  x: number;
  y: number;
  value: number;
}

interface SubjectComposition {
  focalCenterX: number;
  focalCenterY: number;
  focalSpread: number;
  leftWeight: number;
  rightWeight: number;
  topWeight: number;
  bottomWeight: number;
  subjectBounds: { minX: number; minY: number; maxX: number; maxY: number };
  negativeSpaceQuadrant: "tl" | "tr" | "bl" | "br" | "center";
  maskConfidence: "low" | "medium" | "high";
}

const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

function indexFor(width: number, x: number, y: number): number {
  return y * width + x;
}

function computeGradients(gray: Uint8Array, width: number, height: number): GradientSample[] {
  const gradients = Array.from({ length: width * height }, () => ({ gx: 0, gy: 0, magnitude: 0 }));
  const at = (x: number, y: number) => gray[indexFor(width, x, y)] ?? 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) +
        -2 * at(x - 1, y) + 2 * at(x + 1, y) +
        -at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1);
      gradients[indexFor(width, x, y)] = { gx, gy, magnitude: Math.hypot(gx, gy) };
    }
  }
  return gradients;
}

function percentileMagnitude(gradients: GradientSample[], percentile: number): number {
  const sorted = gradients
    .map((gradient) => gradient.magnitude)
    .filter((magnitude) => magnitude > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = clamp(Math.floor(sorted.length * percentile), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function countMaskNeighbors(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) {
      continue;
    }
    count += mask[indexFor(width, nx, ny)] ? 1 : 0;
  }
  return count;
}

function collectCandidates(
  gradients: GradientSample[],
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
): { mask: Uint8Array; points: EdgePoint[] } {
  const threshold = Math.max(64, percentileMagnitude(gradients, 0.82) * 0.8);
  const mask = new Uint8Array(width * height);
  const candidates: RawPoint[] = [];
  const occupiedCells = new Set<string>();
  const cellSize = 4;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gradient = gradients[indexFor(width, x, y)]!;
      if (gradient.magnitude < threshold) {
        continue;
      }
      mask[indexFor(width, x, y)] = 1;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = indexFor(width, x, y);
      if (!mask[index]) {
        continue;
      }
      if (countMaskNeighbors(mask, width, height, x, y) < 2) {
        mask[index] = 0;
        continue;
      }
      const gradient = gradients[index]!;
      const length = gradient.magnitude || 1;
      const nx = gradient.gx / length;
      const ny = gradient.gy / length;
      const tx = -ny;
      const ty = nx;
      candidates.push({
        x,
        y,
        tx,
        ty,
        nx,
        ny,
        strength: gradient.magnitude,
      });
    }
  }

  candidates.sort((a, b) => b.strength - a.strength);
  const points: EdgePoint[] = [];
  for (const point of candidates) {
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    if (occupiedCells.has(key)) {
      continue;
    }
    occupiedCells.add(key);
    points.push({
      x: point.x * scaleX,
      y: point.y * scaleY,
      tx: point.tx,
      ty: point.ty,
      nx: point.nx,
      ny: point.ny,
      strength: point.strength,
    });
    if (points.length >= EDGE_POINT_TARGET) {
      break;
    }
  }

  return { mask, points };
}

function simplifyOrderedPoints(points: RawPoint[]): RawPoint[] {
  const stride = Math.max(1, Math.floor(points.length / 80));
  const ordered: RawPoint[] = [];
  for (let index = 0; index < points.length; index += stride) {
    ordered.push(points[index]!);
  }
  if (ordered.length >= 2 && points.length > 1 && ordered[ordered.length - 1] !== points[points.length - 1]) {
    ordered.push(points[points.length - 1]!);
  }
  return ordered;
}

function isBoundary(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (!mask[indexFor(width, x, y)]) {
    return false;
  }
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) {
      return true;
    }
    if (!mask[indexFor(width, nx, ny)]) {
      return true;
    }
  }
  return false;
}

function walkBoundary(boundarySet: Set<number>, width: number, start: number): RawPoint[] {
  const ordered: RawPoint[] = [];
  const visited = new Set<number>();
  let current = start;
  let lastDx = 1;
  let lastDy = 0;

  while (!visited.has(current)) {
    visited.add(current);
    const x = current % width;
    const y = Math.floor(current / width);
    ordered.push({ x, y, tx: 0, ty: 0, nx: 0, ny: 0, strength: 0 });

    let bestNext = -1;
    let bestScore = -Infinity;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const next = indexFor(width, nx, ny);
      if (!boundarySet.has(next) || visited.has(next)) {
        continue;
      }
      const directional = dx * lastDx + dy * lastDy;
      const score = directional + (dx !== 0 && dy !== 0 ? -0.15 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestNext = next;
      }
    }

    if (bestNext < 0) {
      break;
    }
    const nextX = bestNext % width;
    const nextY = Math.floor(bestNext / width);
    lastDx = nextX - x;
    lastDy = nextY - y;
    current = bestNext;
  }

  return ordered;
}

function toContourPoint(prev: RawPoint, current: RawPoint, next: RawPoint, gradients: GradientSample[], width: number, scaleX: number, scaleY: number): ContourPoint {
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty) || 1;
  const tangentX = tx / length;
  const tangentY = ty / length;
  const gradient = gradients[indexFor(width, current.x, current.y)]!;
  const normalLength = gradient.magnitude || 1;
  const nx = gradient.gx / normalLength;
  const ny = gradient.gy / normalLength;

  const prevAngle = Math.atan2(current.y - prev.y, current.x - prev.x);
  const nextAngle = Math.atan2(next.y - current.y, next.x - current.x);
  let delta = nextAngle - prevAngle;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  const orientedNx = Math.abs(nx) + Math.abs(ny) > 0 ? nx : -tangentY;
  const orientedNy = Math.abs(nx) + Math.abs(ny) > 0 ? ny : tangentX;
  return {
    x: current.x * scaleX,
    y: current.y * scaleY,
    nx: orientedNx,
    ny: orientedNy,
    curvature: delta / Math.PI,
  };
}

function componentToContour(
  component: number[],
  componentMask: Uint8Array,
  gradients: GradientSample[],
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
): EdgeContour | null {
  if (component.length < 12) {
    return null;
  }

  const boundarySet = new Set<number>();
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (isBoundary(componentMask, width, height, x, y)) {
      boundarySet.add(index);
    }
  }
  if (boundarySet.size < 8) {
    return null;
  }

  const start = [...boundarySet][0]!;
  const orderedBoundary = simplifyOrderedPoints(walkBoundary(boundarySet, width, start));
  if (orderedBoundary.length < 6) {
    return null;
  }

  const points = orderedBoundary.map((point, index) => {
    const prev = orderedBoundary[(index - 1 + orderedBoundary.length) % orderedBoundary.length]!;
    const next = orderedBoundary[(index + 1) % orderedBoundary.length]!;
    return toContourPoint(prev, point, next, gradients, width, scaleX, scaleY);
  });

  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }

  const averageStrength =
    component.reduce((sum, index) => sum + gradients[index]!.magnitude, 0) / Math.max(1, component.length);

  return {
    points,
    strength: averageStrength,
    length,
    closed: true,
  };
}

function buildContours(
  mask: Uint8Array,
  gradients: GradientSample[],
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
): EdgeContour[] {
  const visited = new Uint8Array(mask.length);
  const contours: EdgeContour[] = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const startIndex = indexFor(width, x, y);
      if (!mask[startIndex] || visited[startIndex]) {
        continue;
      }

      const stack = [startIndex];
      visited[startIndex] = 1;
      const component: number[] = [];
      const componentMask = new Uint8Array(mask.length);

      while (stack.length > 0) {
        const current = stack.pop()!;
        component.push(current);
        componentMask[current] = 1;
        const px = current % width;
        const py = Math.floor(current / width);

        for (const [dx, dy] of NEIGHBORS) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) {
            continue;
          }
          const next = indexFor(width, nx, ny);
          if (!mask[next] || visited[next]) {
            continue;
          }
          visited[next] = 1;
          stack.push(next);
        }
      }

      const contour = componentToContour(component, componentMask, gradients, width, height, scaleX, scaleY);
      if (contour) {
        contours.push(contour);
      }
    }
  }

  contours.sort((a, b) => (b.strength * b.length) - (a.strength * a.length));
  return contours.slice(0, MAX_CONTOURS);
}

function buildDensityField(
  gray: Uint8Array,
  gradients: GradientSample[],
  mask: Uint8Array,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): EdgeDensityField {
  const gridWidth = Math.max(40, Math.round(outputWidth / 36));
  const gridHeight = Math.max(24, Math.round(outputHeight / 36));
  const values = new Float32Array(gridWidth * gridHeight);
  const weights = new Float32Array(gridWidth * gridHeight);
  const meanGray = gray.reduce((sum, value) => sum + value, 0) / Math.max(1, gray.length);
  const cellWidth = outputWidth / gridWidth;
  const cellHeight = outputHeight / gridHeight;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexFor(width, x, y);
      const gx = clamp(Math.floor((x / width) * gridWidth), 0, gridWidth - 1);
      const gy = clamp(Math.floor((y / height) * gridHeight), 0, gridHeight - 1);
      const gridIndex = gy * gridWidth + gx;
      const luminanceBias = Math.abs((gray[index] ?? 0) - meanGray) / 255;
      const edgeBias = clamp((gradients[index]?.magnitude ?? 0) / 220, 0, 1.6);
      const occupancy = mask[index] ? 1 : 0;
      const contribution = edgeBias * 0.55 + luminanceBias * 0.3 + occupancy * 0.6;
      values[gridIndex] += contribution;
      weights[gridIndex] += 1;
    }
  }

  let maxValue = 0;
  for (let index = 0; index < values.length; index += 1) {
    const weight = weights[index] ?? 1;
    values[index] = weight > 0 ? values[index]! / weight : 0;
    maxValue = Math.max(maxValue, values[index] ?? 0);
  }
  if (maxValue > 0) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = clamp((values[index] ?? 0) / maxValue, 0, 1);
    }
  }

  return {
    gridWidth,
    gridHeight,
    cellWidth,
    cellHeight,
    values,
  };
}

function buildToneField(gray: Uint8Array, gradients: GradientSample[], width: number, height: number, outputWidth: number, outputHeight: number): EdgeToneField {
  const gridWidth = Math.max(40, Math.round(outputWidth / 36));
  const gridHeight = Math.max(24, Math.round(outputHeight / 36));
  const luminance = new Float32Array(gridWidth * gridHeight);
  const contrast = new Float32Array(gridWidth * gridHeight);
  const weights = new Float32Array(gridWidth * gridHeight);
  const cellWidth = outputWidth / gridWidth;
  const cellHeight = outputHeight / gridHeight;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexFor(width, x, y);
      const gx = clamp(Math.floor((x / width) * gridWidth), 0, gridWidth - 1);
      const gy = clamp(Math.floor((y / height) * gridHeight), 0, gridHeight - 1);
      const gridIndex = gy * gridWidth + gx;
      luminance[gridIndex] += (gray[index] ?? 0) / 255;
      contrast[gridIndex] += clamp((gradients[index]?.magnitude ?? 0) / 255, 0, 1);
      weights[gridIndex] += 1;
    }
  }

  let maxContrast = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const weight = weights[index] ?? 1;
    luminance[index] = weight > 0 ? luminance[index]! / weight : 0;
    contrast[index] = weight > 0 ? contrast[index]! / weight : 0;
    maxContrast = Math.max(maxContrast, contrast[index] ?? 0);
  }
  if (maxContrast > 0) {
    for (let index = 0; index < contrast.length; index += 1) {
      contrast[index] = clamp((contrast[index] ?? 0) / maxContrast, 0, 1);
    }
  }

  return { gridWidth, gridHeight, cellWidth, cellHeight, luminance, contrast };
}

function buildSubjectMask(toneField: EdgeToneField, densityField: EdgeDensityField): EdgeMaskField {
  const values = new Float32Array(toneField.gridWidth * toneField.gridHeight);
  let maxValue = 0;
  let meanLum = 0;
  for (let index = 0; index < toneField.luminance.length; index += 1) {
    meanLum += toneField.luminance[index] ?? 0;
  }
  meanLum /= Math.max(1, toneField.luminance.length);

  for (let gy = 0; gy < toneField.gridHeight; gy += 1) {
    for (let gx = 0; gx < toneField.gridWidth; gx += 1) {
      const index = gy * toneField.gridWidth + gx;
      const luminanceBias = Math.abs((toneField.luminance[index] ?? 0) - meanLum);
      const contrastBias = toneField.contrast[index] ?? 0;
      const densityBias = densityField.values[index] ?? 0;
      const value = clamp(luminanceBias * 0.7 + contrastBias * 0.9 + densityBias * 0.8, 0, 1.8);
      values[index] = value;
      maxValue = Math.max(maxValue, value);
    }
  }

  if (maxValue > 0) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = clamp((values[index] ?? 0) / maxValue, 0, 1);
    }
  }

  return {
    gridWidth: toneField.gridWidth,
    gridHeight: toneField.gridHeight,
    cellWidth: toneField.cellWidth,
    cellHeight: toneField.cellHeight,
    values,
  };
}

function buildSilhouetteContours(
  subjectMask: EdgeMaskField,
  gradients: GradientSample[],
  analysisWidth: number,
  analysisHeight: number,
  outputWidth: number,
  outputHeight: number,
): EdgeContour[] {
  const mask = new Uint8Array(analysisWidth * analysisHeight);
  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      const gx = clamp(Math.floor((x / analysisWidth) * subjectMask.gridWidth), 0, subjectMask.gridWidth - 1);
      const gy = clamp(Math.floor((y / analysisHeight) * subjectMask.gridHeight), 0, subjectMask.gridHeight - 1);
      const subjectValue = subjectMask.values[gy * subjectMask.gridWidth + gx] ?? 0;
      if (subjectValue >= 0.44) {
        mask[indexFor(analysisWidth, x, y)] = 1;
      }
    }
  }
  return buildContours(mask, gradients, analysisWidth, analysisHeight, outputWidth / analysisWidth, outputHeight / analysisHeight).slice(0, 12);
}

function buildRegionAnchors(subjectMask: EdgeMaskField, toneField: EdgeToneField): EdgeSpawner[] {
  const anchors: EdgeSpawner[] = [];
  for (let gy = 0; gy < subjectMask.gridHeight; gy += 1) {
    for (let gx = 0; gx < subjectMask.gridWidth; gx += 1) {
      const index = gy * subjectMask.gridWidth + gx;
      const occupancy = subjectMask.values[index] ?? 0;
      if (occupancy < 0.52) {
        continue;
      }
      const tone = toneField.luminance[index] ?? 0;
      anchors.push({
        x: (gx + 0.5) * subjectMask.cellWidth,
        y: (gy + 0.5) * subjectMask.cellHeight,
        radius: 20 + occupancy * 38 + tone * 22,
        weight: clamp(occupancy * 1.1 + tone * 0.35, 0.4, 1.8),
        tx: 1,
        ty: 0,
      });
    }
  }
  anchors.sort((a, b) => b.weight - a.weight);
  return anchors.slice(0, 28);
}

function buildSpatialBins(points: EdgePoint[], spawners: EdgeSpawner[], width: number, height: number): EdgeSpatialBins {
  const gridWidth = Math.max(24, Math.round(width / 80));
  const gridHeight = Math.max(14, Math.round(height / 80));
  const pointBins = Array.from({ length: gridWidth * gridHeight }, () => [] as number[]);
  const spawnerBins = Array.from({ length: gridWidth * gridHeight }, () => [] as number[]);
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const gx = clamp(Math.floor(point.x / cellWidth), 0, gridWidth - 1);
    const gy = clamp(Math.floor(point.y / cellHeight), 0, gridHeight - 1);
    pointBins[gy * gridWidth + gx]!.push(index);
  }
  for (let index = 0; index < spawners.length; index += 1) {
    const spawner = spawners[index]!;
    const gx = clamp(Math.floor(spawner.x / cellWidth), 0, gridWidth - 1);
    const gy = clamp(Math.floor(spawner.y / cellHeight), 0, gridHeight - 1);
    spawnerBins[gy * gridWidth + gx]!.push(index);
  }

  return { gridWidth, gridHeight, cellWidth, cellHeight, pointBins, spawnerBins };
}

function analyzeComposition(subjectMask: EdgeMaskField): SubjectComposition {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let leftWeight = 0;
  let rightWeight = 0;
  let topWeight = 0;
  let bottomWeight = 0;
  const quadrantWeights = { tl: 0, tr: 0, bl: 0, br: 0, center: 0 };

  for (let gy = 0; gy < subjectMask.gridHeight; gy += 1) {
    for (let gx = 0; gx < subjectMask.gridWidth; gx += 1) {
      const index = gy * subjectMask.gridWidth + gx;
      const value = subjectMask.values[index] ?? 0;
      if (value <= 0.08) {
        continue;
      }
      const x = (gx + 0.5) * subjectMask.cellWidth;
      const y = (gy + 0.5) * subjectMask.cellHeight;
      totalWeight += value;
      weightedX += x * value;
      weightedY += y * value;
      minX = Math.min(minX, x - subjectMask.cellWidth * 0.5);
      minY = Math.min(minY, y - subjectMask.cellHeight * 0.5);
      maxX = Math.max(maxX, x + subjectMask.cellWidth * 0.5);
      maxY = Math.max(maxY, y + subjectMask.cellHeight * 0.5);
      if (gx < subjectMask.gridWidth * 0.5) {
        leftWeight += value;
      } else {
        rightWeight += value;
      }
      if (gy < subjectMask.gridHeight * 0.5) {
        topWeight += value;
      } else {
        bottomWeight += value;
      }
      const centeredX = Math.abs((gx + 0.5) / subjectMask.gridWidth - 0.5);
      const centeredY = Math.abs((gy + 0.5) / subjectMask.gridHeight - 0.5);
      if (centeredX < 0.18 && centeredY < 0.18) {
        quadrantWeights.center += value;
      } else if (gx < subjectMask.gridWidth * 0.5 && gy < subjectMask.gridHeight * 0.5) {
        quadrantWeights.tl += value;
      } else if (gx >= subjectMask.gridWidth * 0.5 && gy < subjectMask.gridHeight * 0.5) {
        quadrantWeights.tr += value;
      } else if (gx < subjectMask.gridWidth * 0.5) {
        quadrantWeights.bl += value;
      } else {
        quadrantWeights.br += value;
      }
    }
  }

  const focalCenterX = totalWeight > 0 ? weightedX / totalWeight : subjectMask.gridWidth * subjectMask.cellWidth * 0.5;
  const focalCenterY = totalWeight > 0 ? weightedY / totalWeight : subjectMask.gridHeight * subjectMask.cellHeight * 0.5;
  const subjectBounds = totalWeight > 0
    ? { minX, minY, maxX, maxY }
    : {
        minX: subjectMask.cellWidth,
        minY: subjectMask.cellHeight,
        maxX: subjectMask.gridWidth * subjectMask.cellWidth - subjectMask.cellWidth,
        maxY: subjectMask.gridHeight * subjectMask.cellHeight - subjectMask.cellHeight,
      };
  const spreadX = Math.max(1, subjectBounds.maxX - subjectBounds.minX);
  const spreadY = Math.max(1, subjectBounds.maxY - subjectBounds.minY);
  const focalSpread = clamp(Math.max(spreadX / (subjectMask.gridWidth * subjectMask.cellWidth), spreadY / (subjectMask.gridHeight * subjectMask.cellHeight)), 0.05, 1);
  const meanCoverage = totalWeight / Math.max(1, subjectMask.values.length);
  const negativeSpaceQuadrant = (Object.entries(quadrantWeights).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "center") as SubjectComposition["negativeSpaceQuadrant"];
  const maskConfidence = meanCoverage >= 0.22 ? "high" : meanCoverage >= 0.10 ? "medium" : "low";

  return {
    focalCenterX,
    focalCenterY,
    focalSpread,
    leftWeight,
    rightWeight,
    topWeight,
    bottomWeight,
    subjectBounds,
    negativeSpaceQuadrant,
    maskConfidence,
  };
}

function selectFractalMotif(
  composition: SubjectComposition,
  toneField: EdgeToneField,
  contours: EdgeContour[],
  silhouettes: EdgeContour[],
): EdgeMap["fractalMotif"] {
  const averageContrast = toneField.contrast.reduce((sum, value) => sum + value, 0) / Math.max(1, toneField.contrast.length);
  const averageLuminance = toneField.luminance.reduce((sum, value) => sum + value, 0) / Math.max(1, toneField.luminance.length);
  const longestContour = contours[0]?.length ?? 0;
  const contourCount = contours.length;
  const strongestCurvature =
    contours.slice(0, 4).reduce((sum, contour) => sum + contour.points.reduce((inner, point) => inner + Math.abs(point.curvature), 0), 0) /
    Math.max(1, contours.slice(0, 4).reduce((sum, contour) => sum + contour.points.length, 0));
  const symmetryBalance =
    Math.abs(composition.leftWeight - composition.rightWeight) /
    Math.max(composition.leftWeight + composition.rightWeight, 1e-6);

  if (longestContour > 2200 && averageContrast > 0.42) {
    return "neon-tube";
  }
  if (longestContour > 2400 && strongestCurvature < 0.08 && averageContrast > 0.28) {
    return "data-cathedral";
  }
  if (composition.maskConfidence === "high" && composition.focalSpread < 0.38) {
    return "halo-cell";
  }
  if (composition.maskConfidence === "high" && contourCount > 24 && strongestCurvature > 0.11 && averageContrast > 0.2) {
    return "chromatic-xylem";
  }
  if (averageContrast < 0.18 && averageLuminance < 0.45) {
    return "smoke-ribbon";
  }
  if (averageLuminance > 0.66 && contourCount > 16 && strongestCurvature > 0.13) {
    return "film-bloom-shard";
  }
  if (silhouettes.length > 0 && composition.leftWeight > 0 && composition.rightWeight > 0 && symmetryBalance < 0.08 && strongestCurvature < 0.08) {
    return "harmonic-lattice";
  }
  if (strongestCurvature > 0.08 && strongestCurvature < 0.15 && averageContrast < 0.24 && contourCount > 12) {
    return "mandelbloom";
  }
  if (averageLuminance > 0.58 && contourCount <= 18 && strongestCurvature < 0.12) {
    return "glass-orbital";
  }
  if (
    silhouettes.length > 0 &&
    composition.leftWeight > 0 &&
    composition.rightWeight > 0 &&
    symmetryBalance < 0.12 &&
    strongestCurvature < 0.07 &&
    contourCount >= 12
  ) {
    return "cathedral-filament";
  }
  if (strongestCurvature > 0.16 && averageContrast > 0.2 && averageLuminance > 0.5) {
    return "vector-incantation";
  }
  if (strongestCurvature > 0.2) {
    return "shattered-arc";
  }
  return averageLuminance > 0.58 ? "glass-orbital" : "smoke-ribbon";
}

function contourTangent(contour: EdgeContour, index: number): { x: number; y: number } {
  const prev = contour.points[(index - 1 + contour.points.length) % contour.points.length]!;
  const next = contour.points[(index + 1) % contour.points.length]!;
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty) || 1;
  return { x: tx / length, y: ty / length };
}

function buildSpawners(contours: EdgeContour[], densityField: EdgeDensityField): EdgeSpawner[] {
  const spawners: EdgeSpawner[] = [];
  for (const contour of contours.slice(0, 10)) {
    const step = Math.max(1, Math.floor(contour.points.length / 5));
    for (let index = 0; index < contour.points.length; index += step) {
      const point = contour.points[index]!;
      const tangent = contourTangent(contour, index);
      const gx = clamp(Math.floor(point.x / densityField.cellWidth), 0, densityField.gridWidth - 1);
      const gy = clamp(Math.floor(point.y / densityField.cellHeight), 0, densityField.gridHeight - 1);
      const density = densityField.values[gy * densityField.gridWidth + gx] ?? 0;
      spawners.push({
        x: point.x,
        y: point.y,
        radius: 18 + density * 42 + Math.abs(point.curvature) * 14,
        weight: clamp((contour.strength / 255) * 0.6 + density * 0.9 + Math.abs(point.curvature) * 0.35, 0.25, 1.8),
        tx: tangent.x,
        ty: tangent.y,
      });
    }
  }

  const densityCells: DensityCell[] = [];
  for (let gy = 0; gy < densityField.gridHeight; gy += 1) {
    for (let gx = 0; gx < densityField.gridWidth; gx += 1) {
      const value = densityField.values[gy * densityField.gridWidth + gx] ?? 0;
      if (value < 0.38) {
        continue;
      }
      densityCells.push({
        x: (gx + 0.5) * densityField.cellWidth,
        y: (gy + 0.5) * densityField.cellHeight,
        value,
      });
    }
  }
  densityCells.sort((a, b) => b.value - a.value);

  const minDistance = Math.min(densityField.cellWidth, densityField.cellHeight) * 2.2;
  for (const cell of densityCells) {
    if (spawners.some((spawner) => Math.hypot(spawner.x - cell.x, spawner.y - cell.y) < minDistance)) {
      continue;
    }
    spawners.push({
      x: cell.x,
      y: cell.y,
      radius: 22 + cell.value * 48,
      weight: clamp(cell.value * 1.2, 0.3, 1.4),
      tx: 1,
      ty: 0,
    });
    if (spawners.length >= 24) {
      break;
    }
  }

  return spawners.slice(0, 24);
}

function fallbackEdgeMap(imagePath: string, width: number, height: number): EdgeMap {
  const points: EdgePoint[] = [
    { x: width * 0.35, y: height * 0.35, tx: 1, ty: 0, nx: 0, ny: -1, strength: 1 },
    { x: width * 0.65, y: height * 0.35, tx: 0, ty: 1, nx: 1, ny: 0, strength: 1 },
    { x: width * 0.65, y: height * 0.65, tx: -1, ty: 0, nx: 0, ny: 1, strength: 1 },
    { x: width * 0.35, y: height * 0.65, tx: 0, ty: -1, nx: -1, ny: 0, strength: 1 },
  ];
  const densityField: EdgeDensityField = {
    gridWidth: 4,
    gridHeight: 3,
    cellWidth: width / 4,
    cellHeight: height / 3,
    values: Float32Array.from([0.2, 0.45, 0.45, 0.2, 0.28, 0.82, 0.82, 0.28, 0.16, 0.38, 0.38, 0.16]),
  };
  const spawners: EdgeSpawner[] = [
    { x: width * 0.35, y: height * 0.35, radius: 34, weight: 0.8, tx: 1, ty: 0 },
    { x: width * 0.65, y: height * 0.35, radius: 34, weight: 0.8, tx: 0, ty: 1 },
    { x: width * 0.65, y: height * 0.65, radius: 34, weight: 0.8, tx: -1, ty: 0 },
    { x: width * 0.35, y: height * 0.65, radius: 34, weight: 0.8, tx: 0, ty: -1 },
  ];
  const toneField: EdgeToneField = {
    gridWidth: 4,
    gridHeight: 3,
    cellWidth: width / 4,
    cellHeight: height / 3,
    luminance: Float32Array.from([0.2, 0.42, 0.42, 0.2, 0.28, 0.72, 0.72, 0.28, 0.16, 0.34, 0.34, 0.16]),
    contrast: Float32Array.from([0.18, 0.3, 0.3, 0.18, 0.24, 0.68, 0.68, 0.24, 0.16, 0.26, 0.26, 0.16]),
  };
  const subjectMask: EdgeMaskField = {
    gridWidth: 4,
    gridHeight: 3,
    cellWidth: width / 4,
    cellHeight: height / 3,
    values: Float32Array.from([0.12, 0.34, 0.34, 0.12, 0.24, 0.88, 0.88, 0.24, 0.14, 0.38, 0.38, 0.14]),
  };
  const silhouetteContours: EdgeContour[] = [
    {
      points: [
        { x: width * 0.3, y: height * 0.3, nx: -0.7, ny: -0.7, curvature: 0.12 },
        { x: width * 0.7, y: height * 0.3, nx: 0.7, ny: -0.7, curvature: 0.12 },
        { x: width * 0.7, y: height * 0.7, nx: 0.7, ny: 0.7, curvature: 0.12 },
        { x: width * 0.3, y: height * 0.7, nx: -0.7, ny: 0.7, curvature: 0.12 },
      ],
      strength: 1.2,
      length: (width + height) * 0.8,
      closed: true,
    },
  ];
  const regionAnchors = [
    { x: width * 0.5, y: height * 0.5, radius: 56, weight: 1.2, tx: 1, ty: 0 },
    { x: width * 0.5, y: height * 0.35, radius: 38, weight: 0.8, tx: 1, ty: 0 },
  ];
  const spatialBins = buildSpatialBins(points, [...spawners, ...regionAnchors], width, height);
  const composition = analyzeComposition(subjectMask);
  return {
    imagePath,
    points,
    contours: [
      {
        points: [
          { x: width * 0.35, y: height * 0.35, nx: 0, ny: -1, curvature: 0.2 },
          { x: width * 0.65, y: height * 0.35, nx: 1, ny: 0, curvature: 0.2 },
          { x: width * 0.65, y: height * 0.65, nx: 0, ny: 1, curvature: 0.2 },
          { x: width * 0.35, y: height * 0.65, nx: -1, ny: 0, curvature: 0.2 },
        ],
        strength: 1,
        length: (width + height) * 0.6,
        closed: true,
      },
    ],
    flowField: buildFlowField(points, width, height),
    densityField,
    toneField,
    subjectMask,
    silhouetteContours,
    spawners,
    regionAnchors,
    spatialBins,
    focalCenterX: composition.focalCenterX,
    focalCenterY: composition.focalCenterY,
    focalSpread: composition.focalSpread,
    leftWeight: composition.leftWeight,
    rightWeight: composition.rightWeight,
    topWeight: composition.topWeight,
    bottomWeight: composition.bottomWeight,
    subjectBounds: composition.subjectBounds,
    negativeSpaceQuadrant: composition.negativeSpaceQuadrant,
    maskConfidence: composition.maskConfidence,
    fractalMotif: "halo-cell",
    width,
    height,
    complexity: 0.25,
  };
}

export async function computeEdgeMaps(params: {
  assets: ImageAsset[];
  width: number;
  height: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<EdgeMap[]> {
  const edgeMaps = new Array<EdgeMap>(params.assets.length);
  const scaleX = params.width / EDGE_ANALYSIS_WIDTH;
  const scaleY = params.height / EDGE_ANALYSIS_HEIGHT;
  const concurrency = Math.max(1, Math.min(params.assets.length, Math.max(1, Math.min(os.availableParallelism() - 1, 4))));
  let nextIndex = 0;
  let completed = 0;
  const processAsset = async (assetIndex: number): Promise<void> => {
    const asset = params.assets[assetIndex]!;
    const { data, info } = await sharp(asset.localPath)
      .resize(EDGE_ANALYSIS_WIDTH, EDGE_ANALYSIS_HEIGHT, { fit: "cover", position: "attention" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const gray = data instanceof Uint8Array ? data : new Uint8Array(data);
    const gradients = computeGradients(gray, info.width, info.height);
    const { mask, points } = collectCandidates(gradients, info.width, info.height, scaleX, scaleY);
    const contours = buildContours(mask, gradients, info.width, info.height, scaleX, scaleY);
    const densityField = buildDensityField(gray, gradients, mask, info.width, info.height, params.width, params.height);
    const toneField = buildToneField(gray, gradients, info.width, info.height, params.width, params.height);
    const subjectMask = buildSubjectMask(toneField, densityField);
    const silhouetteContours = buildSilhouetteContours(subjectMask, gradients, info.width, info.height, params.width, params.height);
    const regionAnchors = buildRegionAnchors(subjectMask, toneField);
    const composition = analyzeComposition(subjectMask);

    if (points.length === 0 || contours.length === 0) {
      const fallback = fallbackEdgeMap(asset.localPath, params.width, params.height);
      fallback.styleProfile = asset.styleProfile;
      edgeMaps[assetIndex] = fallback;
    } else {
      const spawners = buildSpawners([...silhouetteContours, ...contours], densityField);
      edgeMaps[assetIndex] = {
        imagePath: asset.localPath,
        points,
        contours,
        flowField: buildFlowField(points, params.width, params.height),
        densityField,
        toneField,
        subjectMask,
        silhouetteContours,
        spawners,
        regionAnchors,
        spatialBins: buildSpatialBins(points, [...spawners, ...regionAnchors], params.width, params.height),
        focalCenterX: composition.focalCenterX,
        focalCenterY: composition.focalCenterY,
        focalSpread: composition.focalSpread,
        leftWeight: composition.leftWeight,
        rightWeight: composition.rightWeight,
        topWeight: composition.topWeight,
        bottomWeight: composition.bottomWeight,
        subjectBounds: composition.subjectBounds,
        negativeSpaceQuadrant: composition.negativeSpaceQuadrant,
        maskConfidence: composition.maskConfidence,
        fractalMotif: selectFractalMotif(composition, toneField, contours, silhouetteContours),
        width: params.width,
        height: params.height,
        complexity: clamp((points.length + contours.length * 48) / (EDGE_POINT_TARGET + MAX_CONTOURS * 48), 0.22, 1),
        styleProfile: asset.styleProfile,
      };
    }
    completed += 1;
    params.onProgress?.(completed, params.assets.length);
  };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const assetIndex = nextIndex;
        nextIndex += 1;
        if (assetIndex >= params.assets.length) {
          return;
        }
        await processAsset(assetIndex);
      }
    }),
  );
  return edgeMaps;
}
