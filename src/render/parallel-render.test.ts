import { describe, expect, test } from "bun:test";
import { partitionChunkJobsForWorkers, recommendedWorkerCount, resolveWorkerCount, targetChunkSeconds } from "./parallel-render";
import type { RenderChunkJob } from "../types";

describe("parallel render heuristics", () => {
  test("worker count stays conservative under one minute", () => {
    expect(recommendedWorkerCount(12, 12 * 30, 30, 4)).toBe(1);
    expect(recommendedWorkerCount(30, 30 * 30, 30, 6)).toBe(2);
    expect(recommendedWorkerCount(59, 59 * 30, 30, 8)).toBe(3);
  });

  test("worker override takes precedence and stays bounded by job count", () => {
    expect(resolveWorkerCount(75, 75 * 30, 30, 13, 1)).toBe(1);
    expect(resolveWorkerCount(75, 75 * 30, 30, 13, 4)).toBe(4);
    expect(resolveWorkerCount(75, 75 * 30, 30, 3, 7)).toBe(3);
  });

  test("chunk target shrinks as duration grows", () => {
    expect(targetChunkSeconds(10 * 30, 30)).toBe(10);
    expect(targetChunkSeconds(20 * 30, 30)).toBe(12);
    expect(targetChunkSeconds(45 * 30, 30)).toBe(10);
    expect(targetChunkSeconds(75 * 30, 30)).toBe(7);
    expect(targetChunkSeconds(120 * 30, 30)).toBe(5);
  });

  test("worker lanes preserve chunk contiguity while covering all jobs", () => {
    const jobs: RenderChunkJob[] = [
      { chunkIndex: 0, outputPath: "chunk-0.mp4", frames: [], estimatedCost: 10 },
      { chunkIndex: 1, outputPath: "chunk-1.mp4", frames: [], estimatedCost: 30 },
      { chunkIndex: 2, outputPath: "chunk-2.mp4", frames: [], estimatedCost: 30 },
      { chunkIndex: 3, outputPath: "chunk-3.mp4", frames: [], estimatedCost: 20 },
      { chunkIndex: 4, outputPath: "chunk-4.mp4", frames: [], estimatedCost: 15 },
    ];

    const lanes = partitionChunkJobsForWorkers(jobs, 3);
    expect(lanes.flat().map((job) => job.chunkIndex)).toEqual([0, 1, 2, 3, 4]);
    for (const lane of lanes) {
      for (let index = 1; index < lane.length; index += 1) {
        expect(lane[index]!.chunkIndex).toBe(lane[index - 1]!.chunkIndex + 1);
      }
    }
  });
});
