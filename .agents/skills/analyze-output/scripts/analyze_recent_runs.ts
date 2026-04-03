import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { Command } from "commander";

export const SUMMARY_PATTERNS = [
  "Output:",
  "Total runtime:",
  "Chunk paths:",
  "Visible windows:",
  "Median visibility score:",
  "High-cost chunks:",
  "Perceptible read:",
  "missingStatsWindows=",
  "fallbackComposedWindows=",
  "safetyRecoveryWindows=",
  "shellEligibleWindowCount=",
  "shellRenderedWindowCount=",
  "shellRenderedWhileDisabledCount=",
  "lowBandShellActivationRatio=",
  "motionTierReadableWindowCount=",
  "centerwardAimReadableWindowCount=",
  "particleTelemetryAvailableWindows=",
  "visibleFallbackRiskWindows=",
  "highHeldRatioWindows=",
  "minimalTransitionWindows=",
  "edgeDominanceWarnings=",
  "deadCenterVoidWarnings=",
  "lowSupportNearHeroWarnings=",
  "highAudioMissedSwapWarnings=",
  "multiHeroWindows=",
  "readableSeparatedMultiHeroWindows=",
  "mirrorBilateralRate=",
  "independentLaneSuccessRate=",
  "fallbackReasonCounts=",
  "compositionReasonCounts=",
  "sourceMotifCounts=",
  "heroMotifCounts=",
  "motionTierCounts=",
  "reflectiveTransitionCounts=",
  "edgeDeathEffectCounts=",
  "shellUnderlayActiveWindows=",
  "burstGateActiveWindows=",
  "heroMotifChangeCount=",
  "heroMotifChangesPerMinute=",
  "heroMotifLongestStreak=",
  "sourceHeroMismatchRate=",
  "heroMotifChangedOutsideSlotWarnings=",
  "heroMotifScheduleMismatchWarnings=",
  "Longest transitions:",
  "Largest hero particles:",
  "Weak BPM event windows:",
  "Weak visibility windows:",
  "Edge dominance margins:",
  "Invisible particle windows:",
  "High cost chunks:",
  "Strongest visible windows:",
] as const;

interface RunMetrics {
  runtimeMs?: number;
  medianVisibility?: number;
  highCostRatio?: number;
}

export interface CliOptions {
  repoRoot: string;
  count: number;
}

export async function latestDebugDirs(repoRoot: string, count: number): Promise<string[]> {
  const debugRoot = path.join(repoRoot, "debug");
  try {
    const entries = await readdir(debugRoot, { withFileTypes: true });
    const directories = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => ({
          dirPath: path.join(debugRoot, entry.name),
          mtimeMs: (await stat(path.join(debugRoot, entry.name))).mtimeMs,
        })),
    );
    return directories
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(1, count))
      .map((entry) => entry.dirPath);
  } catch {
    return [];
  }
}

export function extractLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => SUMMARY_PATTERNS.some((pattern) => line.startsWith(pattern)));
}

function extractWarningCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("#") || !line.includes(" warnings=")) {
      continue;
    }
    const warnings = line.split(" warnings=", 2)[1]?.trim();
    if (!warnings || warnings === "(none)") {
      continue;
    }
    for (const warning of warnings.split("|")) {
      if (!warning) {
        continue;
      }
      counts.set(warning, (counts.get(warning) ?? 0) + 1);
    }
  }
  return counts;
}

function parseRuntimeMs(line: string): number | undefined {
  const match = line.match(/([0-9.]+) ms/);
  return match ? Number(match[1]) : undefined;
}

function parseFraction(line: string): [number, number] | undefined {
  const match = line.match(/(\d+)\/(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function sortWarningsByCount(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function summarizeRun(runDir: string, text: string): { lines: string[]; metrics: RunMetrics } {
  const summaryLines = extractLines(text);
  const warningCounts = extractWarningCounts(text);
  const metrics: RunMetrics = {};
  const lines = [`## ${path.basename(runDir)}`, `- debug: ${runDir}`];

  for (const line of summaryLines) {
    lines.push(`- ${line}`);
    if (line.startsWith("Total runtime:")) {
      metrics.runtimeMs = parseRuntimeMs(line);
    } else if (line.startsWith("Median visibility score:")) {
      metrics.medianVisibility = Number(line.split(": ", 2)[1]);
    } else if (line.startsWith("High-cost chunks:")) {
      const fraction = parseFraction(line);
      if (fraction) {
        metrics.highCostRatio = fraction[0] / Math.max(1, fraction[1]);
      }
    }
  }

  if (warningCounts.size > 0) {
    const top = sortWarningsByCount(warningCounts)
      .slice(0, 5)
      .map(([warning, count]) => `${warning}:${count}`)
      .join(", ");
    lines.push(`- topWarnings: ${top}`);
  }

  lines.push("");
  return { lines, metrics };
}

function buildCrossRunSummaryLines(runMetrics: Array<[string, RunMetrics]>): string[] {
  const lines = ["# Cross-run summary"];
  if (runMetrics.length === 0) {
    lines.push("- No runs found.");
    return lines;
  }

  const runtimeSorted = runMetrics
    .filter(([, data]) => data.runtimeMs !== undefined)
    .map(([name, data]) => [name, data.runtimeMs!] as const)
    .sort((a, b) => b[1] - a[1]);

  const visibilitySorted = runMetrics
    .filter(([, data]) => data.medianVisibility !== undefined)
    .map(([name, data]) => [name, data.medianVisibility!] as const)
    .sort((a, b) => a[1] - b[1]);

  const highCostSorted = runMetrics
    .filter(([, data]) => data.highCostRatio !== undefined)
    .map(([name, data]) => [name, data.highCostRatio!] as const)
    .sort((a, b) => b[1] - a[1]);

  if (runtimeSorted.length > 0) {
    lines.push(
      `- slowestRuns: ${runtimeSorted
        .slice(0, 3)
        .map(([name, value]) => `${name}=${value.toFixed(1)}ms`)
        .join(", ")}`,
    );
  }

  if (visibilitySorted.length > 0) {
    lines.push(
      `- weakestMedianVisibility: ${visibilitySorted
        .slice(0, 3)
        .map(([name, value]) => `${name}=${value.toFixed(3)}`)
        .join(", ")}`,
    );
  }

  if (highCostSorted.length > 0) {
    lines.push(
      `- highestHighCostChunkRate: ${highCostSorted
        .slice(0, 3)
        .map(([name, value]) => `${name}=${(value * 100).toFixed(2)}%`)
        .join(", ")}`,
    );
  }

  return lines;
}

export async function analyzeRecentRuns(options: CliOptions): Promise<string> {
  const runs = await latestDebugDirs(options.repoRoot, options.count);
  if (runs.length === 0) {
    return [
      "# Cross-run summary",
      `- No debug runs found under ${path.join(options.repoRoot, "debug")}`,
    ].join("\n");
  }

  const collected: Array<[string, RunMetrics]> = [];
  const lines: string[] = [];
  for (const runDir of runs) {
    const outputPath = path.join(runDir, "output.txt");
    try {
      const text = await readFile(outputPath, "utf8");
      const summary = summarizeRun(runDir, text);
      lines.push(...summary.lines);
      collected.push([path.basename(runDir), summary.metrics]);
    } catch {
      lines.push(`## ${path.basename(runDir)}`);
      lines.push(`- missing: ${outputPath}`);
      lines.push("");
    }
  }

  lines.push(...buildCrossRunSummaryLines(collected));
  return lines.join("\n");
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--repo-root <path>", "Repo root containing debug/", ".")
    .option("--count <number>", "Number of recent runs to inspect", "5");
  program.parse(process.argv);

  const rawOptions = program.opts<{ repoRoot: string; count: string }>();
  const output = await analyzeRecentRuns({
    repoRoot: path.resolve(rawOptions.repoRoot),
    count: Number(rawOptions.count),
  });
  console.log(output);
}

if (import.meta.main) {
  await main();
}
