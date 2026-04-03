import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  analyzeAsset,
  copyFixtureAsset,
  drawCenteredCircle,
  drawCenteredLine,
  drawCenteredRectangle,
  drawClutterLevel,
  drawCompositeScene,
  isMostlyHorizontal,
  isMostlyVertical,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  writeCanvasFixture,
  withTempFixtureDir,
} from "./edges.test-helpers";

const tilesetFixturePath = path.resolve("test", "fixtures", "tileset", "forest-scene.png");

describe("computeEdgeMaps quality ladder", () => {
  test("returns minimal structure for a blank canvas", async () => {
    await withTempFixtureDir(async (dir) => {
      const asset = await writeCanvasFixture({
        dir,
        name: "blank",
        draw: () => {},
      });
      const { edgeMap, metrics } = await analyzeAsset(asset);

      expect(edgeMap.complexity).toBeLessThanOrEqual(0.26);
      expect(metrics.pointCount).toBeLessThanOrEqual(4);
      expect(metrics.contourCount).toBeLessThanOrEqual(1);
      expect(metrics.meanDensity).toBeLessThan(0.9);
      expect(metrics.fallbackLike).toBeTrue();
    });
  });

  test("detects a dominant horizontal orientation for a horizontal line", async () => {
    await withTempFixtureDir(async (dir) => {
      const blank = await writeCanvasFixture({ dir, name: "blank", draw: () => {} });
      const horizontal = await writeCanvasFixture({
        dir,
        name: "horizontal-line",
        draw: (ctx, width, height) => drawCenteredLine(ctx, width, height, "horizontal"),
      });

      const blankResult = await analyzeAsset(blank);
      const lineResult = await analyzeAsset(horizontal);
      const angle = lineResult.metrics.dominantOrientation;

      expect(angle).not.toBeNull();
      expect(isMostlyHorizontal(angle!)).toBeTrue();
      expect(lineResult.metrics.pointBoundingBox).not.toBeNull();
      expect(lineResult.metrics.pointBoundingBox!.width).toBeGreaterThan(lineResult.metrics.pointBoundingBox!.height * 1.5);
      expect(lineResult.metrics.pointCount).toBeGreaterThan(blankResult.metrics.pointCount);
      expect(lineResult.metrics.flowCoverage).toBeGreaterThan(blankResult.metrics.flowCoverage);
    });
  });

  test("detects a dominant vertical orientation for a vertical line", async () => {
    await withTempFixtureDir(async (dir) => {
      const horizontal = await writeCanvasFixture({
        dir,
        name: "horizontal-line",
        draw: (ctx, width, height) => drawCenteredLine(ctx, width, height, "horizontal"),
      });
      const vertical = await writeCanvasFixture({
        dir,
        name: "vertical-line",
        draw: (ctx, width, height) => drawCenteredLine(ctx, width, height, "vertical"),
      });

      const horizontalResult = await analyzeAsset(horizontal);
      const verticalResult = await analyzeAsset(vertical);
      const angle = verticalResult.metrics.dominantOrientation;

      expect(angle).not.toBeNull();
      expect(isMostlyVertical(angle!)).toBeTrue();
      expect(verticalResult.metrics.pointBoundingBox).not.toBeNull();
      expect(verticalResult.metrics.pointBoundingBox!.height).toBeGreaterThan(verticalResult.metrics.pointBoundingBox!.width * 1.5);
      expect(verticalResult.metrics.pointCount).toBeGreaterThan(0);
      expect(verticalResult.metrics.pointCount).toBeGreaterThan(horizontalResult.metrics.pointCount * 0.8);
      expect(verticalResult.metrics.pointCount).toBeLessThan(horizontalResult.metrics.pointCount * 1.35);
    });
  });

  test("extracts more structured contours from a centered rectangle than from a single line", async () => {
    await withTempFixtureDir(async (dir) => {
      const line = await writeCanvasFixture({
        dir,
        name: "line",
        draw: (ctx, width, height) => drawCenteredLine(ctx, width, height, "horizontal"),
      });
      const rectangle = await writeCanvasFixture({
        dir,
        name: "rectangle",
        draw: (ctx, width, height) => drawCenteredRectangle(ctx, width, height),
      });

      const lineResult = await analyzeAsset(line);
      const rectangleResult = await analyzeAsset(rectangle);
      const centerX = (rectangleResult.edgeMap.subjectBounds.minX + rectangleResult.edgeMap.subjectBounds.maxX) / 2;
      const centerY = (rectangleResult.edgeMap.subjectBounds.minY + rectangleResult.edgeMap.subjectBounds.maxY) / 2;

      expect(rectangleResult.metrics.contourCount).toBeGreaterThanOrEqual(lineResult.metrics.contourCount);
      expect(
        rectangleResult.metrics.closedContourCount >= 1 ||
          rectangleResult.metrics.maxContourLength > lineResult.metrics.maxContourLength * 1.2,
      ).toBeTrue();
      expect(rectangleResult.metrics.leftRightBalance).toBeLessThan(0.2);
      expect(rectangleResult.metrics.topBottomBalance).toBeLessThan(0.2);
      expect(Math.abs(centerX - OUTPUT_WIDTH * 0.5)).toBeLessThan(OUTPUT_WIDTH * 0.15);
      expect(Math.abs(centerY - OUTPUT_HEIGHT * 0.5)).toBeLessThan(OUTPUT_HEIGHT * 0.2);
    });
  });

  test("extracts curved closed structure from a centered circle", async () => {
    await withTempFixtureDir(async (dir) => {
      const rectangle = await writeCanvasFixture({
        dir,
        name: "rectangle",
        draw: (ctx, width, height) => drawCenteredRectangle(ctx, width, height),
      });
      const circle = await writeCanvasFixture({
        dir,
        name: "circle",
        draw: (ctx, width, height) => drawCenteredCircle(ctx, width, height),
      });

      const rectangleResult = await analyzeAsset(rectangle);
      const circleResult = await analyzeAsset(circle);

      expect(circleResult.metrics.contourCount).toBeGreaterThan(0);
      expect(circleResult.metrics.closedContourCount).toBeGreaterThanOrEqual(1);
      expect(circleResult.metrics.curvatureMagnitude).toBeGreaterThan(rectangleResult.metrics.curvatureMagnitude * 0.95);
      expect(circleResult.metrics.subjectCoverage).toBeGreaterThan(0.04);
      expect(circleResult.metrics.fallbackLike).toBeFalse();
    });
  });

  test("increases edge richness across the synthetic difficulty ladder", async () => {
    await withTempFixtureDir(async (dir) => {
      const levels = await Promise.all(
        Array.from({ length: 5 }, async (_, index) =>
          writeCanvasFixture({
            dir,
            name: `clutter-${index}`,
            draw: (ctx, width, height) => drawClutterLevel(ctx, width, height, index),
          }),
        ),
      );
      const results = await Promise.all(levels.map((asset) => analyzeAsset(asset)));
      const tolerance = 0.05;

      for (let index = 0; index < results.length - 1; index += 1) {
        const current = results[index]!.metrics;
        const next = results[index + 1]!.metrics;
        expect(next.pointCount).toBeGreaterThanOrEqual(Math.floor(current.pointCount * (1 - tolerance)));
        expect(next.meanDensity).toBeGreaterThanOrEqual(current.meanDensity * (1 - tolerance));
        expect(next.peakDensity).toBeGreaterThanOrEqual(current.peakDensity * (1 - tolerance));
        expect(results[index + 1]!.edgeMap.complexity).toBeGreaterThanOrEqual(results[index]!.edgeMap.complexity - tolerance);
      }

      expect(results[4]!.metrics.pointCount).toBeGreaterThan(results[0]!.metrics.pointCount * 1.2);
      expect(results[4]!.metrics.meanDensity).toBeGreaterThan(results[0]!.metrics.meanDensity * 1.1);
      expect(results[4]!.edgeMap.complexity).toBeGreaterThan(results[0]!.edgeMap.complexity + 0.08);
    });
  });

  test("detects dense, non-fallback structure from the tileset-derived scene", async () => {
    await withTempFixtureDir(async (dir) => {
      const composite = await writeCanvasFixture({
        dir,
        name: "composite",
        draw: (ctx, width, height) => drawCompositeScene(ctx, width, height),
      });
      const tileset = await copyFixtureAsset({
        dir,
        name: "tileset-scene",
        sourcePath: tilesetFixturePath,
      });

      const compositeResult = await analyzeAsset(composite);
      const tilesetResult = await analyzeAsset(tileset);

      expect(tilesetResult.metrics.fallbackLike).toBeFalse();
      expect(tilesetResult.metrics.pointCount).toBeGreaterThan(compositeResult.metrics.pointCount * 1.1);
      expect(tilesetResult.metrics.contourCount).toBeGreaterThanOrEqual(compositeResult.metrics.contourCount);
      expect(tilesetResult.metrics.peakDensity).toBeGreaterThanOrEqual(compositeResult.metrics.peakDensity * 0.95);
      expect(tilesetResult.edgeMap.complexity).toBeGreaterThanOrEqual(compositeResult.edgeMap.complexity);
      expect(tilesetResult.metrics.subjectCoverage).toBeGreaterThan(0.05);
      expect(tilesetResult.metrics.flowCoverage).toBeGreaterThan(0.02);
    });
  });
});
