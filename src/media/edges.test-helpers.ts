import { createCanvas, loadImage } from "@napi-rs/canvas";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { computeEdgeMaps } from "./edges";
import type { EdgeMap, ImageAsset } from "../types";

export const TEST_IMAGE_WIDTH = 512;
export const TEST_IMAGE_HEIGHT = 512;
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface EdgeMetrics {
  pointCount: number;
  contourCount: number;
  closedContourCount: number;
  avgContourLength: number;
  maxContourLength: number;
  meanDensity: number;
  peakDensity: number;
  subjectCoverage: number;
  flowCoverage: number;
  leftRightBalance: number;
  topBottomBalance: number;
  pointBoundingBox: BoundingBox | null;
  dominantOrientation: number | null;
  curvatureMagnitude: number;
  fallbackLike: boolean;
}

export type DrawFixture = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

function average(values: ArrayLike<number>): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
  }
  return sum / values.length;
}

function maxOf(values: ArrayLike<number>): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    max = Math.max(max, values[index] ?? 0);
  }
  return Number.isFinite(max) ? max : 0;
}

function coverage(values: ArrayLike<number>, predicate: (value: number) => boolean): number {
  if (values.length === 0) {
    return 0;
  }
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (predicate(values[index] ?? 0)) {
      count += 1;
    }
  }
  return count / values.length;
}

function orientationDistanceRadians(angle: number, target: number): number {
  let delta = Math.abs(angle - target) % Math.PI;
  if (delta > Math.PI / 2) {
    delta = Math.PI - delta;
  }
  return delta;
}

export function computeMetrics(edgeMap: EdgeMap): EdgeMetrics {
  const pointCount = edgeMap.points.length;
  const contourCount = edgeMap.contours.length;
  const closedContourCount = edgeMap.contours.filter((contour) => contour.closed).length;
  const contourLengths = edgeMap.contours.map((contour) => contour.length);
  const avgContourLength = contourLengths.length > 0 ? average(contourLengths) : 0;
  const maxContourLength = contourLengths.length > 0 ? maxOf(contourLengths) : 0;
  const meanDensity = average(edgeMap.densityField.values);
  const peakDensity = maxOf(edgeMap.densityField.values);
  const subjectCoverage = coverage(edgeMap.subjectMask.values, (value) => value >= 0.44);
  const flowCoverage = coverage(edgeMap.flowField.weights, (value) => value > 0);
  const totalHorizontal = Math.max(edgeMap.leftWeight + edgeMap.rightWeight, 1e-6);
  const totalVertical = Math.max(edgeMap.topWeight + edgeMap.bottomWeight, 1e-6);
  const leftRightBalance = Math.abs(edgeMap.leftWeight - edgeMap.rightWeight) / totalHorizontal;
  const topBottomBalance = Math.abs(edgeMap.topWeight - edgeMap.bottomWeight) / totalVertical;

  let pointBoundingBox: BoundingBox | null = null;
  if (pointCount > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of edgeMap.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    pointBoundingBox = {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  const strongPoints = [...edgeMap.points]
    .sort((left, right) => right.strength - left.strength)
    .slice(0, Math.max(8, Math.floor(edgeMap.points.length * 0.2)));
  let orientationX = 0;
  let orientationY = 0;
  for (const point of strongPoints) {
    const angle = Math.atan2(point.ty, point.tx);
    const weight = Math.max(point.strength, 1);
    orientationX += Math.cos(angle * 2) * weight;
    orientationY += Math.sin(angle * 2) * weight;
  }
  const dominantOrientation =
    strongPoints.length > 0 ? (Math.atan2(orientationY, orientationX) / 2 + Math.PI) % Math.PI : null;

  let curvatureSum = 0;
  let curvaturePoints = 0;
  for (const contour of edgeMap.contours) {
    for (const point of contour.points) {
      curvatureSum += Math.abs(point.curvature);
      curvaturePoints += 1;
    }
  }

  const fallbackLike =
    edgeMap.points.length <= 4 &&
    edgeMap.contours.length <= 1 &&
    Math.abs(edgeMap.complexity - 0.25) < 1e-6;

  return {
    pointCount,
    contourCount,
    closedContourCount,
    avgContourLength,
    maxContourLength,
    meanDensity,
    peakDensity,
    subjectCoverage,
    flowCoverage,
    leftRightBalance,
    topBottomBalance,
    pointBoundingBox,
    dominantOrientation,
    curvatureMagnitude: curvaturePoints > 0 ? curvatureSum / curvaturePoints : 0,
    fallbackLike,
  };
}

export function isMostlyHorizontal(angle: number): boolean {
  return orientationDistanceRadians(angle, 0) <= Math.PI / 6;
}

export function isMostlyVertical(angle: number): boolean {
  return orientationDistanceRadians(angle, Math.PI / 2) <= Math.PI / 6;
}

export async function withTempFixtureDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "edge-quality-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeCanvasFixture(params: {
  dir: string;
  name: string;
  draw: DrawFixture;
  width?: number;
  height?: number;
}): Promise<ImageAsset> {
  const width = params.width ?? TEST_IMAGE_WIDTH;
  const height = params.height ?? TEST_IMAGE_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);
  params.draw(ctx as unknown as CanvasRenderingContext2D, width, height);
  const buffer = await canvas.encode("png");
  const localPath = path.join(params.dir, `${params.name}.png`);
  await writeFile(localPath, buffer);
  return {
    id: params.name,
    sourceUrl: localPath,
    localPath,
    width,
    height,
  };
}

export async function copyFixtureAsset(params: { dir: string; name: string; sourcePath: string }): Promise<ImageAsset> {
  const localPath = path.join(params.dir, `${params.name}${path.extname(params.sourcePath) || ".png"}`);
  await mkdir(params.dir, { recursive: true });
  await writeFile(localPath, await readFile(params.sourcePath));
  const image = await loadImage(localPath);
  return {
    id: params.name,
    sourceUrl: params.sourcePath,
    localPath,
    width: image.width,
    height: image.height,
  };
}

export async function analyzeAsset(asset: ImageAsset): Promise<{ edgeMap: EdgeMap; metrics: EdgeMetrics }> {
  const [edgeMap] = await computeEdgeMaps({
    assets: [asset],
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
  });
  return {
    edgeMap,
    metrics: computeMetrics(edgeMap),
  };
}

export function drawCenteredLine(ctx: CanvasRenderingContext2D, width: number, height: number, orientation: "horizontal" | "vertical"): void {
  ctx.strokeStyle = "#f5f5f5";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (orientation === "horizontal") {
    ctx.moveTo(width * 0.15, height * 0.5);
    ctx.lineTo(width * 0.85, height * 0.5);
  } else {
    ctx.moveTo(width * 0.5, height * 0.15);
    ctx.lineTo(width * 0.5, height * 0.85);
  }
  ctx.stroke();
}

export function drawCenteredRectangle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = "#f0f0f0";
  ctx.lineWidth = 14;
  ctx.strokeRect(width * 0.22, height * 0.22, width * 0.56, height * 0.56);
}

export function drawCenteredCircle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = "#f0f0f0";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.5, width * 0.26, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawCompositeScene(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  drawCenteredRectangle(ctx, width, height);
  ctx.strokeStyle = "#d8e7ff";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(width * 0.56, height * 0.42, width * 0.17, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#fefefe";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.82);
  ctx.lineTo(width * 0.84, height * 0.18);
  ctx.stroke();

  ctx.fillStyle = "#d0d0d0";
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      ctx.beginPath();
      ctx.arc(width * (0.28 + column * 0.08), height * (0.7 + row * 0.06), 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawClutterLevel(ctx: CanvasRenderingContext2D, width: number, height: number, level: number): void {
  drawCenteredLine(ctx, width, height, "horizontal");
  if (level >= 1) {
    drawCenteredLine(ctx, width, height, "vertical");
  }
  if (level >= 2) {
    drawCenteredRectangle(ctx, width, height);
    drawCenteredCircle(ctx, width, height);
  }
  if (level >= 3) {
    ctx.strokeStyle = "#e5e5e5";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(width * 0.18, height * 0.2);
    ctx.lineTo(width * 0.82, height * 0.8);
    ctx.moveTo(width * 0.2, height * 0.82);
    ctx.lineTo(width * 0.8, height * 0.18);
    ctx.stroke();

    for (let index = 0; index < 12; index += 1) {
      const x = width * (0.15 + (index % 4) * 0.18);
      const y = height * (0.18 + Math.floor(index / 4) * 0.18);
      ctx.fillStyle = index % 2 === 0 ? "#bfbfbf" : "#ffffff";
      ctx.fillRect(x, y, 18, 18);
    }
  }
  if (level >= 4) {
    for (let y = 0; y < height; y += 24) {
      for (let x = 0; x < width; x += 24) {
        const seed = ((x / 24) * 17 + (y / 24) * 31) % 11;
        if (seed < 4) {
          continue;
        }
        const shade = 48 + seed * 18;
        ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        ctx.fillRect(x, y, 12 + (seed % 3) * 6, 8 + (seed % 4) * 4);
      }
    }
  }
}
