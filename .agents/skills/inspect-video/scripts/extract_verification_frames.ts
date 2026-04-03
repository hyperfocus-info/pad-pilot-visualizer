import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Command } from "commander";
import { extractVideoFrame, resolveFfmpegPath } from "../../../../src/media/ffmpeg";

interface CliOptions {
  repoRoot: string;
  runDir: string;
  videoPath?: string;
  timeSec: string[];
  label: string[];
  outputDir?: string;
}

function sanitizeRunName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "run";
}

async function readOutputPath(runDir: string): Promise<string> {
  const outputReport = await Bun.file(path.join(runDir, "output.txt")).text();
  const match = outputReport.match(/^Output:\s+(.+)$/m);
  if (!match) {
    throw new Error(`Could not find final MP4 path in ${path.join(runDir, "output.txt")}`);
  }
  return match[1].trim();
}

function buildLabels(times: number[], provided: string[]): string[] {
  if (provided.length > 0 && provided.length !== times.length) {
    throw new Error("--label count must match --time-sec count when labels are provided.");
  }
  return times.map((_, index) => provided[index] ?? `frame-${String(index).padStart(3, "0")}`);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .requiredOption("--repo-root <path>")
    .requiredOption("--run-dir <path>")
    .option("--video-path <path>")
    .requiredOption("--time-sec <seconds>", "Repeat for each frame to extract", (value, previous: string[]) => {
      previous.push(value);
      return previous;
    }, [])
    .option("--label <name>", "Repeat to name extracted frames", (value, previous: string[]) => {
      previous.push(value);
      return previous;
    }, [])
    .option("--output-dir <path>");

  program.parse(process.argv);
  const options = program.opts<CliOptions>();

  const repoRoot = path.resolve(options.repoRoot);
  const runDir = path.resolve(repoRoot, options.runDir);
  const runName = sanitizeRunName(path.basename(runDir));
  const outputDir = path.resolve(
    repoRoot,
    options.outputDir ?? path.join("cache", "inspect-video", runName),
  );

  const times = options.timeSec.map((value, index) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --time-sec at position ${index + 1}: ${value}`);
    }
    return parsed;
  });
  const labels = buildLabels(times, options.label);
  const ffmpegPath = resolveFfmpegPath();
  const videoPath = options.videoPath ? path.resolve(repoRoot, options.videoPath) : await readOutputPath(runDir);

  await mkdir(outputDir, { recursive: true });

  for (let index = 0; index < times.length; index += 1) {
    const label = labels[index].replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
    const outputPath = path.join(outputDir, `${label}.png`);
    await extractVideoFrame(ffmpegPath, videoPath, times[index], outputPath);
    process.stdout.write(`${outputPath}\n`);
  }
}

await main();
