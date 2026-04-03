import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRecentRuns } from "../.agents/skills/analyze-output/scripts/analyze_recent_runs";

describe("analyze recent runs script", () => {
  test("includes safety recovery counts and fallback cause counts in recent summaries", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "pad-pilot-visualizer-analyze-"));
    try {
      const debugRoot = path.join(repoRoot, "debug");
      const newerRun = path.join(debugRoot, "run-b");
      const olderRun = path.join(debugRoot, "run-a");
      await mkdir(newerRun, { recursive: true });
      await mkdir(olderRun, { recursive: true });
      await writeFile(
        path.join(olderRun, "output.txt"),
        [
          "Output: C:\\video\\run-a.mp4",
          "Total runtime: 120000.0 ms",
          "Chunk paths: 12",
          "Median visibility score: 0.640",
          "High-cost chunks: 4/12",
          "fallbackComposedWindows=1",
          "safetyRecoveryWindows=5",
          "shellEligibleWindowCount=2",
          "shellRenderedWindowCount=1",
          "shellRenderedWhileDisabledCount=0",
          "lowBandShellActivationRatio=0.420",
          "motionTierReadableWindowCount=4",
          "centerwardAimReadableWindowCount=3",
          "fallbackReasonCounts=edge-dominance:3,dead-center-void:2",
          "motionTierCounts=jump:1,glide:3,flourish:1",
          "reflectiveTransitionCounts=mirror-kaleido:2,quadrant-mirror-sweep:1",
          "edgeDeathEffectCounts=circular-burst-clean:3,ash-dissolve-glitch:1",
          "shellUnderlayActiveWindows=2",
          "burstGateActiveWindows=4",
          "#0 warnings=edge-highlight-dominates-focal",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(newerRun, "output.txt"),
        [
          "Output: C:\\video\\run-b.mp4",
          "Total runtime: 98000.0 ms",
          "Chunk paths: 10",
          "Median visibility score: 0.610",
          "High-cost chunks: 2/10",
          "fallbackComposedWindows=0",
          "safetyRecoveryWindows=4",
          "shellEligibleWindowCount=3",
          "shellRenderedWindowCount=2",
          "shellRenderedWhileDisabledCount=1",
          "lowBandShellActivationRatio=0.510",
          "motionTierReadableWindowCount=3",
          "centerwardAimReadableWindowCount=2",
          "fallbackReasonCounts=low-support-near-hero:2,held-sparse:2",
          "motionTierCounts=glide:2,flourish:2",
          "reflectiveTransitionCounts=mirror-grid-dissolve:2",
          "edgeDeathEffectCounts=poof-cloud-clean:2",
          "shellUnderlayActiveWindows=3",
          "burstGateActiveWindows=5",
          "#0 warnings=fallback-frame-visible-risk|edge-highlight-dominates-focal",
        ].join("\n"),
        "utf8",
      );

      const output = await analyzeRecentRuns({ repoRoot, count: 2 });

      expect(output).toContain("- safetyRecoveryWindows=4");
      expect(output).toContain("- shellRenderedWhileDisabledCount=1");
      expect(output).toContain("- lowBandShellActivationRatio=0.510");
      expect(output).toContain("- centerwardAimReadableWindowCount=2");
      expect(output).toContain("- fallbackReasonCounts=low-support-near-hero:2,held-sparse:2");
      expect(output).toContain("- motionTierCounts=glide:2,flourish:2");
      expect(output).toContain("- reflectiveTransitionCounts=mirror-grid-dissolve:2");
      expect(output).toContain("- edgeDeathEffectCounts=poof-cloud-clean:2");
      expect(output).toContain("- safetyRecoveryWindows=5");
      expect(output).toContain("- shellRenderedWindowCount=1");
      expect(output).toContain("- motionTierReadableWindowCount=4");
      expect(output).toContain("- fallbackReasonCounts=edge-dominance:3,dead-center-void:2");
      expect(output).toContain("- motionTierCounts=jump:1,glide:3,flourish:1");
      expect(output).toContain("- reflectiveTransitionCounts=mirror-kaleido:2,quadrant-mirror-sweep:1");
      expect(output).toContain("- edgeDeathEffectCounts=circular-burst-clean:3,ash-dissolve-glitch:1");
      expect(output).toContain("- topWarnings: edge-highlight-dominates-focal:1");
      expect(output).toContain("- topWarnings: edge-highlight-dominates-focal:1, fallback-frame-visible-risk:1");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
