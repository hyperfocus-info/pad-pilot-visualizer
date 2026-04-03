import { clamp } from "../config";
import type { EdgeDensityField, EdgeFlowField, EdgeMap, EdgePoint } from "../types";

interface Vector2 {
  x: number;
  y: number;
}

export function sampleFlowVector(flowField: EdgeFlowField, x: number, y: number): Vector2 {
  const gx = clamp(Math.floor(x / flowField.cellWidth), 0, flowField.gridWidth - 1);
  const gy = clamp(Math.floor(y / flowField.cellHeight), 0, flowField.gridHeight - 1);
  const index = (gy * flowField.gridWidth + gx) * 2;
  return {
    x: flowField.vectors[index] ?? 0,
    y: flowField.vectors[index + 1] ?? 0,
  };
}

export function buildFlowField(points: EdgePoint[], width: number, height: number): EdgeFlowField {
  const gridWidth = Math.max(48, Math.round(width / 20));
  const gridHeight = Math.max(27, Math.round(height / 20));
  const vectors = new Float32Array(gridWidth * gridHeight * 2);
  const weights = new Float32Array(gridWidth * gridHeight);
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;

  for (const point of points) {
    const gx = clamp(Math.floor(point.x / cellWidth), 0, gridWidth - 1);
    const gy = clamp(Math.floor(point.y / cellHeight), 0, gridHeight - 1);
    const index = gy * gridWidth + gx;
    const vectorIndex = index * 2;
    const weight = clamp(point.strength / 255, 0.18, 1);
    vectors[vectorIndex] += point.tx * weight;
    vectors[vectorIndex + 1] += point.ty * weight;
    weights[index] += weight;
  }

  for (let index = 0; index < weights.length; index += 1) {
    const vectorIndex = index * 2;
    const weight = weights[index] ?? 0;
    if (weight <= 0) {
      continue;
    }
    const x = (vectors[vectorIndex] ?? 0) / weight;
    const y = (vectors[vectorIndex + 1] ?? 0) / weight;
    const length = Math.hypot(x, y) || 1;
    vectors[vectorIndex] = x / length;
    vectors[vectorIndex + 1] = y / length;
  }

  return {
    gridWidth,
    gridHeight,
    cellWidth,
    cellHeight,
    vectors,
    weights,
  };
}

export function sampleDensityValue(densityField: EdgeDensityField, x: number, y: number): number {
  const gx = clamp(Math.floor(x / densityField.cellWidth), 0, densityField.gridWidth - 1);
  const gy = clamp(Math.floor(y / densityField.cellHeight), 0, densityField.gridHeight - 1);
  const index = gy * densityField.gridWidth + gx;
  return densityField.values[index] ?? 0;
}

export function nearestEdgePoint(edgeMap: EdgeMap, x: number, y: number, hintIndex = 0): EdgePoint {
  const points = edgeMap.points;
  if (points.length === 0) {
    return { x, y, tx: 1, ty: 0, nx: 0, ny: 1, strength: 1 };
  }
  let best = points[clamp(hintIndex, 0, points.length - 1)]!;
  let bestDistance = (best.x - x) * (best.x - x) + (best.y - y) * (best.y - y);
  const stride = Math.max(1, Math.floor(points.length / 96));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index]!;
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}
