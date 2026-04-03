#!/usr/bin/env bun
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createRenderSettings,
  DEFAULT_BPM,
  DEFAULT_BEATS_PER_IMAGE,
  DEFAULT_OUTPUT_FORMAT,
  HALFTIME_BEATS_PER_IMAGE,
  DEFAULT_VIDEO_FPS,
  durationSchema,
  isOutputFormatPreset,
  normalizeOutputFps,
  secondsPerImage,
} from "./config";
import { analyzeAudio } from "./media/audio";
import { computeEdgeMaps } from "./media/edges";
import {
  DEFAULT_ENCODER_PRESET,
  concatVideoSegments,
  extractVideoFrame,
  muxAudio,
  probeAudio,
  resolveFfmpegPath,
  resolveFfprobePath,
  trimAudio,
} from "./media/ffmpeg";
import { analyzeImageStyles } from "./media/image-style";
import { downloadThemeImages } from "./media/images";
import { RENDER_CHUNK_SECONDS, renderVideoChunks } from "./render/parallel-render";
import { sanitizeEffectMode } from "./render/palette";
import { createRenderWindowKey } from "./render/window-stats";
import { buildVisualPlan } from "./render/visual-plan";
import {
  buildDiagnosticBreakdown,
  buildDiagnosticReportFromChunks,
  targetGradeFloor,
} from "./diagnostics/report-summary";
import type {
  BpmSource,
  CliStage,
  CliStatusLogEntry,
  CliOptions,
  DiagnosticOverrides,
  DiagnosticReport,
  DiagnosticSelector,
  DiagnosticScoreBreakdown,
  DiagnosticStateFile,
  DebugReport,
  GradeLabel,
  OverlayMode,
  ProbedAudioMetadata,
  RenderChunkStat,
  RenderDiagnosticFailureReason,
  RenderImageWindowStat,
  ResolvedPaths,
  TransitionFamily,
  VisualRegime,
} from "./types";
import { DebugCollector, writeDebugReport } from "./utils/debug";
import { cleanupTemp, createTempWorkspace, ensureDir, pathExists } from "./utils/fs";
import { ProgressLine } from "./utils/progress";

function fallbackSeverityRank(value: RenderImageWindowStat["fallbackSeverity"] | undefined): number {
  switch (value) {
    case "full":
      return 2;
    case "light":
      return 1;
    default:
      return 0;
  }
}

export function parseWorkersOption(rawWorkers?: string): "auto" | number {
  if (!rawWorkers || rawWorkers === "auto") {
    return "auto";
  }
  const parsedWorkers = Number.parseInt(rawWorkers, 10);
  if (!Number.isInteger(parsedWorkers) || parsedWorkers <= 0) {
    throw new Error("Workers must be 'auto' or a positive integer.");
  }
  return parsedWorkers;
}

export function parseParticleIntensityOption(rawValue?: string): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Particle intensity must be a positive number.");
  }
  return parsed;
}

export function parseCliOptionsFromArgv(argv: string[]): CliOptions {
  const program = new Command();
  program
    .requiredOption("--input <path>", "Path to the input MP3/WAV/audio file")
    .option("--theme <string>", "Theme to search on Pexels")
    .option("--duration <hh:mm:ss>", "Optional trim length")
    .option("--fps <number>", "Output FPS (normalized to common YouTube frame rates)", String(DEFAULT_VIDEO_FPS))
    .option("--format <preset>", "Output format preset: 1080, 720, 480", DEFAULT_OUTPUT_FORMAT)
    .option("--transition <number>", "Image transition cadence unit, default 8 beats per image", String(DEFAULT_BEATS_PER_IMAGE))
    .option("--round-4bar", "If duration is provided, round to the nearest 16-beat phrase end", false)
    .option("--disable-nebula", "Disable atmosphere-scale nebula rendering while keeping hero particles active", false)
    .option("--output <path>", "Output filename", "video/output.mp4")
    .option("--workers <auto|number>", "Render worker count override", "auto")
    .option("--halftime", "Double image hold length from 8 beats to 16 beats", false)
    .option("--fast", "Favor throughput by enabling adaptive quality degradation and aggressive transition budgeting", false)
    .option("--debug", "Write output.txt with timings and effect selection details", false)
    .option("--state-in <path>", "Load a diagnostic state file")
    .option("--state-out <path>", "Write a diagnostic state file")
    .option("--probe <type>", "Diagnostic probe target: node, transition, all-transitions, all-nodes, phrase-window")
    .option("--probe-index <number>", "Diagnostic node/image index")
    .option("--probe-from <number>", "Transition probe from image index")
    .option("--probe-to <number>", "Transition probe to image index")
    .option("--probe-start <number>", "Phrase-window probe start in seconds")
    .option("--probe-end <number>", "Phrase-window probe end in seconds")
    .option("--iterate-smoke", "Iteratively tune the selected diagnostic target", false)
    .option("--target-grade <grade>", "Target grade for iterative tuning", "B+")
    .option("--max-iterations <number>", "Maximum tuning iterations", "10")
    .option("--particleIntensity <percent>", "Particle spawn/count multiplier as a percent", "100")
    .option("--partcleIntensity <percent>", "Compatibility alias for --particleIntensity");

  program.parse(argv);
  const rawOptions = program.opts<Omit<CliOptions, "fps" | "workers" | "transition" | "probeIndex" | "probeFrom" | "probeTo" | "probeStart" | "probeEnd" | "maxIterations"> & {
    fps: string;
    workers: string;
    transition: string;
    probeIndex?: string;
    probeFrom?: string;
    probeTo?: string;
    probeStart?: string;
    probeEnd?: string;
    maxIterations?: string;
    particleIntensity?: string;
    partcleIntensity?: string;
    debug?: boolean;
  }>();
  const parsedFps = Number.parseInt(rawOptions.fps, 10);
  const parsedTransition = Number.parseFloat(rawOptions.transition);
  if (!Number.isInteger(parsedFps) || parsedFps <= 0) {
    throw new Error("FPS must be a positive integer.");
  }
  if (!Number.isFinite(parsedTransition) || parsedTransition <= 0) {
    throw new Error("Transition must be a positive number.");
  }
  const format = rawOptions.format ?? DEFAULT_OUTPUT_FORMAT;
  if (!isOutputFormatPreset(format)) {
    throw new Error(`Format must be one of: 1080, 720, 480.`);
  }
  const targetGrade = (rawOptions.targetGrade ?? "B+") as GradeLabel;
  const particleIntensity = parseParticleIntensityOption(rawOptions.partcleIntensity ?? rawOptions.particleIntensity);
  const options: CliOptions = {
    ...rawOptions,
    format,
    fps: parsedFps,
    workers: parseWorkersOption(rawOptions.workers),
    transition: parsedTransition,
    probeIndex: rawOptions.probeIndex ? Number.parseInt(rawOptions.probeIndex, 10) : undefined,
    probeFrom: rawOptions.probeFrom ? Number.parseInt(rawOptions.probeFrom, 10) : undefined,
    probeTo: rawOptions.probeTo ? Number.parseInt(rawOptions.probeTo, 10) : undefined,
    probeStart: rawOptions.probeStart ? Number.parseFloat(rawOptions.probeStart) : undefined,
    probeEnd: rawOptions.probeEnd ? Number.parseFloat(rawOptions.probeEnd) : undefined,
    maxIterations: rawOptions.maxIterations ? Number.parseInt(rawOptions.maxIterations, 10) : undefined,
    targetGrade,
    particleIntensity,
  };
  if (options.duration) {
    durationSchema.parse(options.duration);
  }
  if (!options.theme && !options.stateIn) {
    throw new Error("Theme is required unless --state-in is provided.");
  }
  return options;
}

function parseArgs(): CliOptions {
  return parseCliOptionsFromArgv(process.argv);
}

export function resolveDefaultedOutputPath(outputPath: string): string {
  if (path.isAbsolute(outputPath)) {
    return outputPath;
  }
  const hasDirectory = path.dirname(outputPath) !== ".";
  return path.resolve(hasDirectory ? outputPath : path.join("video", outputPath));
}

export function resolveDebugDirForOutput(outputPath: string): string {
  const outputBaseName = path.basename(outputPath, path.extname(outputPath));
  return path.resolve(path.join("debug", outputBaseName));
}

export async function resolveAvailableOutputPath(outputPath: string): Promise<string> {
  const requestedPath = resolveDefaultedOutputPath(outputPath);
  const parsed = path.parse(requestedPath);
  let attempt = 0;

  while (true) {
    const candidatePath = attempt === 0
      ? requestedPath
      : path.join(parsed.dir, `${parsed.name}(${attempt})${parsed.ext}`);
    const candidateDebugDir = resolveDebugDirForOutput(candidatePath);
    if (!(await pathExists(candidatePath)) && !(await pathExists(candidateDebugDir))) {
      return candidatePath;
    }
    attempt += 1;
  }
}

export async function loadDiagnosticState(statePath: string): Promise<DiagnosticStateFile> {
  return JSON.parse(await readFile(path.resolve(statePath), "utf8")) as DiagnosticStateFile;
}

export function selectorFromOptions(options: CliOptions): DiagnosticSelector | undefined {
  switch (options.probe) {
    case "node":
      return { type: "node", imageIndex: options.probeIndex, phraseIndex: options.probeIndex };
    case "transition":
      return { type: "transition", fromImageIndex: options.probeFrom, toImageIndex: options.probeTo };
    case "phrase-window":
      return { type: "phrase-window", startSec: options.probeStart, endSec: options.probeEnd };
    case "all-transitions":
      return { type: "all-transitions" };
    case "all-nodes":
      return { type: "all-nodes" };
    default:
      return undefined;
  }
}


export function parseDurationToSeconds(duration: string): number {
  const [hours, minutes, seconds] = duration.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDurationFromSeconds(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function roundDurationToFourBarEnd(duration: string, bpm: number): string {
  const seconds = parseDurationToSeconds(duration);
  const phraseSeconds = (60 / Math.max(1, bpm)) * 16;
  const rounded = Math.max(phraseSeconds, Math.round(seconds / phraseSeconds) * phraseSeconds);
  return formatDurationFromSeconds(rounded);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolvePreferredBpm(sourceMetadata: ProbedAudioMetadata, trimmedMetadata?: ProbedAudioMetadata): { bpm?: number; source: BpmSource } {
  if (sourceMetadata.metadataBpm) {
    return { bpm: sourceMetadata.metadataBpm, source: "source-metadata" };
  }
  if (trimmedMetadata?.metadataBpm) {
    return { bpm: trimmedMetadata.metadataBpm, source: "trimmed-metadata" };
  }
  return { source: "default" };
}

function formatStageDetails(details?: string, elapsedMs?: number, debugEnabled = false): string {
  const parts: string[] = [];
  if (details) {
    parts.push(details);
  }
  if (debugEnabled && elapsedMs !== undefined) {
    parts.push(`elapsed=${elapsedMs.toFixed(1)}ms`);
  }
  return parts.join(" ");
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0]!.trim();
}

function formatFailureOutput(outputPath: string): string {
  return outputPath || "(none)";
}

/* c8 ignore start */
async function main(): Promise<void> {
  const options = parseArgs();
  const diagnosticState = options.stateIn ? await loadDiagnosticState(options.stateIn) : undefined;
  const explicitSelector = selectorFromOptions(options);
  const activeSelector = explicitSelector ?? diagnosticState?.selectors[0];
  const transitionCadence = options.transition ?? DEFAULT_BEATS_PER_IMAGE;
  const beatsPerImage = options.halftime ? Math.max(HALFTIME_BEATS_PER_IMAGE, transitionCadence * 2) : transitionCadence;
  const progress = new ProgressLine();
  const debug = new DebugCollector();
  const renderChunks: RenderChunkStat[] = [];
  const apiKey = diagnosticState?.imagePaths?.length ? "" : requireEnv("PEXELS_API_KEY");
  const sourceAudioPath = path.resolve(options.input);
  const effectiveFps = normalizeOutputFps(options.fps);
  const renderSettings = createRenderSettings(options.format ?? DEFAULT_OUTPUT_FORMAT, effectiveFps);
  const workspace = await createTempWorkspace();
  const requestedOutputPath = resolveDefaultedOutputPath(options.output);
  const resolvedPaths: ResolvedPaths = {
    ffmpegPath: resolveFfmpegPath(),
    ffprobePath: resolveFfprobePath(),
    tempDir: workspace.tempDir,
    audioDir: workspace.audioDir,
    imageDir: workspace.imageDir,
    videoDir: workspace.videoDir,
    outputPath: await resolveAvailableOutputPath(options.output),
  };
  const debugDir = resolveDebugDirForOutput(resolvedPaths.outputPath);
  const imageDebugDir = path.join(debugDir, "images");
  let completedSuccessfully = false;
  let cleanupWarning: import("./types").CleanupTempResult | undefined;
  let primaryError: unknown;
  let currentStage: CliStage = "run";
  let lastCompletedStage: CliStage | undefined;
  const statusLog: CliStatusLogEntry[] = [];
  let sourceMetadata: ProbedAudioMetadata | undefined;
  let trimmedMetadata: ProbedAudioMetadata | undefined;
  let analysis: Awaited<ReturnType<typeof analyzeAudio>> | undefined;
  let assets: import("./types").ImageAsset[] | undefined;
  let themeImageCacheHits = 0;
  let themeImageCacheMisses = 0;
  let themeImageRemoteDownloads = 0;
  let styleProfiles: Awaited<ReturnType<typeof analyzeImageStyles>> | undefined;
  let edgeMaps: Awaited<ReturnType<typeof computeEdgeMaps>> | undefined;
  let bpm = DEFAULT_BPM;
  let imageSeconds = secondsPerImage(bpm, beatsPerImage);
  let chunkPaths: string[] = [];
  let videoOnlyPath: string | undefined;
  let debugReportError: unknown;
  let reportToWrite: DebugReport | undefined;

  const emitStageStatus = (
    stage: CliStage | string,
    status: CliStatusLogEntry["status"],
    details?: string,
    elapsedMs?: number,
  ): void => {
    const formatted = formatStageDetails(details, elapsedMs, Boolean(options.debug));
    statusLog.push({ stage, status, message: details ?? "", elapsedMs });
    const line = `STATUS ${stage} ${status}${formatted ? ` ${formatted}` : ""}`;
    if (status === "failed" || status === "warning") {
      progress.warn(line);
    } else {
      progress.status(line);
    }
  };

  const runStage = async <T>(
    stage: CliStage,
    label: string,
    task: () => Promise<T>,
    describeSuccess?: (value: T) => string | undefined,
  ): Promise<T> => {
    currentStage = stage;
    progress.setPhase(label);
    const startedAt = performance.now();
    try {
      const result = await task();
      lastCompletedStage = stage;
      emitStageStatus(stage, "ok", describeSuccess?.(result), performance.now() - startedAt);
      return result;
    } catch (error) {
      emitStageStatus(stage, "failed", `error=\"${summarizeError(error)}\"`, performance.now() - startedAt);
      throw error;
    }
  };

  try {
    if (options.debug) {
      await ensureDir(imageDebugDir);
      emitStageStatus("debug-report", "ok", `dir=${debugDir}`);
    }

    if (effectiveFps !== options.fps) {
      progress.status(`STATUS run ok normalizedFps=${options.fps}->${effectiveFps}`);
    }
    if (resolvedPaths.outputPath !== requestedOutputPath) {
      progress.status(`STATUS run ok outputCollision=${requestedOutputPath}->${resolvedPaths.outputPath}`);
    }

    await runStage("input-validation", "Input Validation", () =>
      debug.measure("Input Validation", async () => {
        if (!(await pathExists(sourceAudioPath))) {
          throw new Error(`Input audio not found: ${sourceAudioPath}`);
        }
      }),
    );

    sourceMetadata = await runStage(
      "probe-source-audio",
      "Probing Source Audio",
      () => debug.measure("Probe Source Audio", () => probeAudio(resolvedPaths.ffprobePath, sourceAudioPath)),
      (metadata) => `duration=${metadata.durationSec.toFixed(2)}s`,
    );
    const preferredBpm = resolvePreferredBpm(sourceMetadata);
    const roundingBpm = preferredBpm.bpm ?? DEFAULT_BPM;
    const requestedDuration = options.duration && options.round4bar
      ? roundDurationToFourBarEnd(options.duration, roundingBpm)
      : options.duration;
    const audioPath = options.duration
      ? await runStage(
          "trim-audio",
          "Trimming Audio",
          () => debug.measure("Trimming Audio", async () => {
          const trimmed = await trimAudio(resolvedPaths.ffmpegPath, sourceAudioPath, requestedDuration!, resolvedPaths.audioDir);
          resolvedPaths.trimmedAudioPath = trimmed;
          trimmedMetadata = await probeAudio(resolvedPaths.ffprobePath, trimmed);
          return trimmed;
          }),
          (trimmed) => `path=${trimmed} duration=${requestedDuration}`,
        )
      : sourceAudioPath;

    const preferredBpmResolved = resolvePreferredBpm(sourceMetadata, trimmedMetadata);
    const activeMetadata = trimmedMetadata ?? sourceMetadata;

    analysis = await runStage(
      "audio-analysis",
      "Analyzing Audio",
      () => debug.measure("Audio Analysis", () => analyzeAudio({
        ffmpegPath: resolvedPaths.ffmpegPath,
        ffprobePath: resolvedPaths.ffprobePath,
        inputPath: audioPath,
        fps: effectiveFps,
        beatsPerSegment: beatsPerImage,
        probedMetadata: activeMetadata,
        preferredBpm: preferredBpmResolved.bpm,
        preferredBpmSource: preferredBpmResolved.bpm ? preferredBpmResolved.source : undefined,
        onProgress: (current, total) => progress.tick(current, total),
      })),
      (result) => `bpm=${result.metadata.bpm ?? DEFAULT_BPM} frames=${result.frames.length}`,
    );

    bpm = analysis.metadata.bpm ?? DEFAULT_BPM;
    imageSeconds = secondsPerImage(bpm, beatsPerImage);
    const neededImages = Math.max(1, Math.ceil(analysis.metadata.durationSec / imageSeconds));
    const visualPlan = buildVisualPlan({
      frames: analysis.frames,
      fps: effectiveFps,
      secondsPerImage: imageSeconds,
    });

    assets = diagnosticState?.imagePaths?.length
      ? diagnosticState.imagePaths.map((imagePath, index) => ({
          id: String(index),
          sourceUrl: imagePath,
          localPath: path.resolve(imagePath),
          width: renderSettings.width,
          height: renderSettings.height,
        }))
      : await runStage(
          "image-download",
          "Downloading Images",
          async () => {
            const downloaded = await debug.measure("Image Download", () => downloadThemeImages({
              theme: options.theme!,
              apiKey,
              imageDir: resolvedPaths.imageDir,
              neededImages,
              onProgress: (current, total) => progress.tick(current, total),
            }));
            themeImageCacheHits = downloaded.cacheHits;
            themeImageCacheMisses = downloaded.cacheMisses;
            themeImageRemoteDownloads = downloaded.remoteDownloads;
            return downloaded.assets;
          },
          (downloaded) => `count=${downloaded.length} cacheHits=${themeImageCacheHits} cacheMisses=${themeImageCacheMisses} remote=${themeImageRemoteDownloads}`,
        );

    styleProfiles = await runStage(
      "image-style-analysis",
      "Analyzing Image Styles",
      () => debug.measure("Image Style Analysis", () => analyzeImageStyles({
        assets: assets!,
        onProgress: (current, total) => progress.tick(current, total),
      })),
      (profiles) => `count=${profiles.length}`,
    );
    styleProfiles.forEach((profile, index) => {
      assets![index]!.styleProfile = profile;
    });

    edgeMaps = await runStage(
      "edge-precompute",
      "Precomputing Edges",
      () => debug.measure("Edge Precompute", () => computeEdgeMaps({
        assets: assets!,
        width: renderSettings.width,
        height: renderSettings.height,
        onProgress: (current, total) => progress.tick(current, total),
      })),
      (maps) => `count=${maps.length}`,
    );

    let renderFrames = analysis!.frames;
    if (activeSelector?.type === "node" && activeSelector.imageIndex !== undefined) {
      const startSec = activeSelector.imageIndex * imageSeconds;
      renderFrames = renderFrames.filter((frame) => frame.timeSec >= startSec && frame.timeSec < startSec + imageSeconds);
    } else if (activeSelector?.type === "transition" && activeSelector.fromImageIndex !== undefined && activeSelector.toImageIndex !== undefined) {
      const startSec = Math.min(activeSelector.fromImageIndex, activeSelector.toImageIndex) * imageSeconds;
      const endSec = (Math.max(activeSelector.fromImageIndex, activeSelector.toImageIndex) + 1) * imageSeconds;
      renderFrames = renderFrames.filter((frame) => frame.timeSec >= startSec && frame.timeSec < endSec);
    } else if (activeSelector?.type === "phrase-window" && activeSelector.startSec !== undefined && activeSelector.endSec !== undefined) {
      renderFrames = renderFrames.filter((frame) => frame.timeSec >= activeSelector.startSec! && frame.timeSec <= activeSelector.endSec!);
    }

    const renderChunkPass = async (videoDir: string, diagnosticOverrides?: DiagnosticOverrides): Promise<{ paths: string[]; chunks: RenderChunkStat[]; report: DiagnosticReport }> => {
      const localChunks: RenderChunkStat[] = [];
      const paths = await renderVideoChunks({
        ffmpegPath: resolvedPaths.ffmpegPath,
        settings: renderSettings,
        bpm,
        beatOriginSec: analysis?.metadata.beatOriginSec,
        disableNebula: options.disableNebula,
        fast: options.fast,
        themeQuery: options.theme,
        frames: renderFrames,
        edgeMaps: edgeMaps!,
        segments: analysis!.segments,
        secondsPerImage: imageSeconds,
        visualPlan,
        videoDir,
        workerCountOverride: options.workers === "auto" ? undefined : options.workers,
        diagnosticOverrides,
        onProgress: (current, total) => progress.tick(current, total, "frames"),
        onChunkComplete: (chunk) => localChunks.push(chunk),
      });
      return { paths, chunks: localChunks, report: buildDiagnosticReportFromChunks(localChunks, activeSelector) };
    };

    let selectedOverrides: DiagnosticOverrides | undefined = {
      ...(diagnosticState?.diagnosticOverrides as DiagnosticOverrides | undefined),
      disableBudgetDowngrades: true,
      disableParticleCaps: true,
      telemetryMode: options.debug || options.probe ? "full" : "summary",
      ...(options.particleIntensity !== undefined ? { particleSpawnScale: options.particleIntensity / 100 } : {}),
    };
    if (options.iterateSmoke && activeSelector) {
      const tuningLadder: DiagnosticOverrides[] = [
        selectedOverrides ?? {},
        { ...selectedOverrides, thrustGain: 1.08, trailEmissionGain: 1.1 },
        { ...selectedOverrides, jitterGain: 1.15, trailCoolingGain: 0.92 },
        { ...selectedOverrides, burstFanoutGain: 1.18, residueSpreadGain: 1.08 },
        { ...selectedOverrides, thrustGain: 1.12, jitterGain: 1.1, trailEmissionGain: 1.16 },
        { ...selectedOverrides, trailEmissionGain: 1.22, trailCoolingGain: 0.88, burstFanoutGain: 1.14 },
      ].slice(0, Math.max(1, options.maxIterations ?? 6));
      let bestScore = -1;
      for (let index = 0; index < tuningLadder.length; index += 1) {
        const iterDir = path.join(resolvedPaths.videoDir, `iter-${index}`);
        await ensureDir(iterDir);
        const result = await renderChunkPass(iterDir, tuningLadder[index]);
        const combinedScore = result.report.visualScore * 0.65 + result.report.responsivenessScore * 0.35;
        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          selectedOverrides = tuningLadder[index];
        }
        if (combinedScore >= targetGradeFloor(options.targetGrade ?? "B+")) {
          break;
        }
      }
    }

    chunkPaths = await runStage(
      "chunk-rendering",
      "Rendering Chunks",
      async () => {
        const result = await debug.measure("Chunk Rendering", () => renderChunkPass(resolvedPaths.videoDir, selectedOverrides));
        renderChunks.push(...result.chunks);
        return result.paths;
      },
      (paths) => `chunks=${paths.length} frames=${renderFrames.length}`,
    );

    if (options.stateOut) {
      const stateToWrite: DiagnosticStateFile = {
        audioPath: sourceAudioPath,
        imageSet: options.theme,
        imagePaths: assets.map((asset) => asset.localPath),
        selectors: activeSelector ? [activeSelector] : diagnosticState?.selectors ?? [],
        sweepModes: diagnosticState?.sweepModes ?? ["all"],
        renderSettings: {
          width: renderSettings.width,
          height: renderSettings.height,
          fps: renderSettings.fps,
        },
        diagnosticOverrides: selectedOverrides,
        acceptanceProfile: diagnosticState?.acceptanceProfile ?? {
          grade: options.targetGrade ?? "B+",
          minHeroCoverage: 0.48,
          maxClutter: 0.34,
          minTrailContinuity: 0.62,
        },
      };
      await writeFile(path.resolve(options.stateOut), `${JSON.stringify(stateToWrite, null, 2)}\n`, "utf8");
    }

    videoOnlyPath = await runStage(
      "concat-video",
      "Concatenating Video",
      () => debug.measure("Concat Video", () => concatVideoSegments(resolvedPaths.ffmpegPath, chunkPaths, resolvedPaths.videoDir)),
      (output) => `path=${output}`,
    );

    await runStage(
      "mux-audio",
      "Muxing Audio",
      () => debug.measure("Mux Audio", () => muxAudio(resolvedPaths.ffmpegPath, videoOnlyPath!, audioPath, resolvedPaths.outputPath)),
      () => `path=${resolvedPaths.outputPath}`,
    );

    completedSuccessfully = true;
  } catch (error) {
    primaryError = error;
    emitStageStatus("run", "failed", `stage=${currentStage} output=${formatFailureOutput(resolvedPaths.outputPath)}`);
    (primaryError as { cliHandled?: boolean }).cliHandled = true;
  } finally {
    if (options.debug) {
      const imageWindowStats = new Map<string, {
        windowKey?: string;
        chunkIndex?: number;
        firstFrameIndex?: number;
        startSec?: number;
        endSec?: number;
        fastMode?: boolean;
        requestedImageIndex?: number;
        resolvedImageIndex?: number;
        themeImagePath?: string;
        frameCount: number;
        luminanceSum: number;
        minLuminance: number;
        blackFrameCount: number;
        dbOverallSum: number;
        pulseScaleSum: number;
        subjectMaskCoverageSum: number;
        motifEffectId?: import("./types").MotifEffectId;
        motifEffectPhenomenon?: import("./types").PhysicalPhenomenonFamily;
        motifEffectAudioMode?: import("./types").MotifEffectAudioMode;
        motifEffectIntensitySum: number;
        heroWarpActive: boolean;
        heroCoverageSum: number;
        backgroundClutterRatioSum: number;
        activeMotionSum: number;
        activeEmphasisSum: number;
        supportMotionSum: number;
        backgroundMotionSum: number;
        atmosphereDensitySum: number;
        midScaleCoverageSum: number;
        symmetryUsageSum: number;
        eventDensitySum: number;
        emitterUsageSum: number;
        absorberUsageSum: number;
        explosionCountSum: number;
        sourceAffinitySum: number;
        sourceAffinityHeroSum: number;
        sourceAffinitySupportSum: number;
        particleConvergenceScoreSum: number;
        subEmitterChildrenSum: number;
        heroEchoCountSum: number;
        heroGlyphComplexitySum: number;
        heroSubEmitterCountSum: number;
        heroCoreSizeSum: number;
        heroOutlineRatioSum: number;
        heroPrimitiveComplexitySum: number;
        heroChildEmissionRateSum: number;
        heroChildFieldDensitySum: number;
        heroChildFieldRadiusSum: number;
        heroTrailOccupancySum: number;
        heroWakeLengthPxSum: number;
        heroBurstCountSum: number;
        heroBurstChildrenSum: number;
        heroMotorJitterSum: number;
        heroMotorThrustSum: number;
        heroBurnPhaseSum: number;
        heroWakeTailAgeAvgSum: number;
        heroWakeResetCountMax: number;
        heroSpeedAvgSum: number;
        heroSpeedPeakMax: number;
        heroScalePulseAvgSum: number;
        heroScalePulsePeakMax: number;
        motifPotencyScoreSum: number;
        transitionTriggerMode?: import("./types").TransitionTriggerMode;
        heldTransitionCount: number;
        swapTransitionCount: number;
        heroShellInnerAlphaSum: number;
        heroShellOuterAlphaSum: number;
        heroShellSceneEnabledCount: number;
        heroShellConfiguredCountSum: number;
        heroShellActiveCountSum: number;
        heroShellActivationDriverBand?: import("./types").HeroShellBand;
        heroShellTriggerRateLowSum: number;
        heroShellTriggerRateLowMidSum: number;
        heroShellTriggerRateLowCompositeSum: number;
        heroShellThresholdLowSum: number;
        heroShellThresholdLowMidSum: number;
        heroShellThresholdLowCompositeSum: number;
        heroShellTriggerRateHighMidSum: number;
        heroShellTriggerRateHighSum: number;
        heroShellTriggerRateUpperSum: number;
        heroShellThresholdHighMidSum: number;
        heroShellThresholdHighSum: number;
        heroShellThresholdUpperSum: number;
        heroShellColorMode?: import("./types").HeroShellColorMode;
        heroBandLowUsageSum: number;
        heroBandMidUsageSum: number;
        heroBandHighUsageSum: number;
        heroEmitterTopology?: string;
        heroInstanceVariant?: string;
        heroContrastBowlUsed: boolean;
        heroTravelGracefulBiasSum: number;
        heroTravelGlitchBiasSum: number;
        heroTargetSmoothingSum: number;
        heroSpinVelocitySum: number;
        motionTierCounts: Map<string, number>;
        jumpTriggeredCount: number;
        jitterSuppressedCount: number;
        motionTierReadableCount: number;
        flourishStrengthSum: number;
        screenEdgeAimBiasSum: number;
        streamCenterBiasDegreesSum: number;
        centerwardEmissionRatioSum: number;
        edgePressureActiveFrameRatioSum: number;
        reflectiveTransitionCount: number;
        reflectiveTransitionFamilies: Set<string>;
        heroBurstGateActiveRatioSum: number;
        heroBurstCadenceSlotHitsSum: number;
        heroBurstTopQuartileRatioSum: number;
        heroShellHueTravelSum: number;
        heroShellUnderlayActiveCount: number;
        heroParticleExitWhiteBiasSum: number;
        heroVariantWarpSum: number;
        heroVariantGravitySum: number;
        heroVariantInconsistencySum: number;
        heroParticleSizeAvgSum: number;
        heroParticleTtlAvgSum: number;
        heroLayoutFamily?: import("./types").HeroLayoutFamily;
        heroInstanceCountResolvedSum: number;
        heroPairMinDistancePxMin: number;
        heroPairAvgDistancePxSum: number;
        heroOverlapRatioSum: number;
        heroCoreOverlapRatioSum: number;
        heroGlowMergeRatioSum: number;
        heroLaneDiversityScoreSum: number;
        heroDistinctQuadrantCountMax: number;
        heroRelationshipResolved?: import("./types").HeroRelationshipMode;
        heroSeparationReadableCount: number;
        heroSeparationFailureReason?: import("./types").HeroSeparationFailureReason;
        supportClusterCountMax: number;
        supportNearHeroScoreSum: number;
        edgeHighlightPenaltySum: number;
        edgeDominanceMarginSum: number;
        deadCenterVoidScoreSum: number;
        focalReinforcementScoreSum: number;
        dbTransitionDriveSum: number;
        bandWeightedTransitionDriveSum: number;
        hzTransitionDriveSum: number;
        audioTransitionScoreSum: number;
        holdPenaltySum: number;
        swapPromotedByAudioCount: number;
        recoveryMode?: import("./types").RecoveryMode;
        fallbackRenderMode?: import("./types").RenderImageWindowStat["fallbackRenderMode"];
        fallbackReason?: import("./types").FallbackReason;
        fallbackTriggerCountMax: number;
        fallbackSeverity?: import("./types").RenderImageWindowStat["fallbackSeverity"];
        compositionModeReason?: import("./types").CompositionModeReason;
        particleTelemetryAvailable?: boolean;
        visibleFallbackRiskCount: number;
        particleSpawnRequestsSum: number;
        particleRenderedCountSum: number;
        particleCulledByLayerCapSum: number;
        particleCulledByHeroProtectionSum: number;
        particleCulledByNegativeSpaceSum: number;
        particleCulledByImageProgressSum: number;
        particleCulledBySkipNonHeroSum: number;
        particleOffscreenCountSum: number;
        particleTooSmallToReadCountSum: number;
        particleLowAlphaCountSum: number;
        particleLowContrastCountSum: number;
        particleVisibleCountSum: number;
        heroParticleRenderedCountSum: number;
        supportParticleRenderedCountSum: number;
        backgroundParticleRenderedCountSum: number;
        subEmitterTriggerCountSum: number;
        subEmitterChildSpawnedCountSum: number;
        edgeDeathEligibleCountSum: number;
        edgeDeathTriggeredCountSum: number;
        edgeDeathPlayedCountSum: number;
        edgeDeathSkippedByCostCountSum: number;
        edgeExitFramesAvgSum: number;
        edgeExitDistanceAvgSum: number;
        edgeDeathEffectCounts: Map<string, number>;
        edgeDeathCostTierCounts: Map<string, number>;
        focalQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
        heroQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
        brightestBlobQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
        focalOccupancyScoreSum: number;
        centerBiasScoreSum: number;
        adaptiveDegradeLevelMax: number;
        heroMotionBias?: string;
        heroSpawnRegion?: string;
        heroMotifProfile?: string;
        sourceMotif?: import("./types").FractalMotif;
        heroMotifResolved?: string;
        heroMotifScheduled?: import("./types").FractalMotif;
        heroMotifSlotIndex?: number;
        heroMotifSlotStartSec?: number;
        heroMotifSlotEndSec?: number;
        heroMotifScheduleReason?: import("./types").HeroMotifScheduleReason;
        heroMotifChangedOnSlotBoundary?: boolean;
        heroMotifChangedOutsideSlot?: boolean;
        heroMotifScheduleMismatch?: boolean;
        heroMotifVariantKey?: string;
        heroParticleSizeVariance?: string;
        heroColorProminence?: string;
        heroRelationshipMode?: import("./types").HeroRelationshipMode;
        heroRelationshipClass?: import("./types").HeroRelationshipClass;
        shotGrammarKey?: string;
        transitionBudgetTier?: import("./types").RenderQualityBudget["transitionBudgetTier"];
        transitionBudgetReason?: string;
        motifInfluenceKey?: string;
        edgeAttractionScaleSum: number;
        transitionMotionGrammar?: string;
        negativeSpaceOccupancySum: number;
        supportCoverageSum: number;
        transitionDurationFrameSum: number;
        transitionCarryStrengthSum: number;
        transitionCarryAvailabilityScoreSum: number;
        transitionCarryMode?: import("./types").TransitionCarryMode;
        transitionCarryFallbackReason?: import("./types").TransitionCarryReason;
        brightnessFloorSum: number;
        safetyOverrideCount: number;
        recoveryTriggered: boolean;
        recoveryOverrideFrameCount: number;
        recoveryOverrideFrameRatioSum: number;
        recoverySeverityScoreMax: number;
        recoveryActiveAny: boolean;
        shapePlacementScoreSum: number;
        effectVisibleFrameRatioSum: number;
        effectVisiblePixelRatioAvgSum: number;
        effectLuminanceDeltaAvgSum: number;
        effectMotionDeltaAvgSum: number;
        overlayOpacityAvgSum: number;
        overlayCompositeMode?: string;
        effectVisibilityScoreSum: number;
        diagnosticCompleteness?: "complete" | "missing-stats";
        diagnosticMissingFields?: string[];
        diagnosticFailureReason?: RenderDiagnosticFailureReason;
        visualRegime?: VisualRegime;
        overlayMode?: OverlayMode;
        transitionFamily?: TransitionFamily;
        activeMode?: import("./types").ActiveSubjectMode;
        compositionMode?: import("./types").StylePlacementMode;
        nodeIntent?: import("./types").NodeIntent;
        episodeIntent?: import("./types").EpisodeIntent;
        heroArchetype?: import("./types").HeroArchetype;
        heroStoryBeat?: import("./types").GlyphStoryBeat;
        heroEmissionMode?: import("./types").HeroEmissionMode;
        subEmitterMode?: import("./types").SubEmitterMode;
        heroPrimitive?: import("./types").HeroPrimitiveKind;
        heroShellMode?: import("./types").HeroPostShellMode;
        heroBaseShellMode?: import("./types").HeroPostShellMode;
        heroResolvedShellMode?: import("./types").HeroPostShellMode;
        heroCircleShellEligible?: boolean;
        heroCircleShellPromoted?: boolean;
        heroCoreFillMode?: import("./types").HeroCoreFillMode;
      }>();
      for (const chunk of renderChunks) {
        for (const window of chunk.imageWindows ?? []) {
          const statKey = window.windowKey ?? createRenderWindowKey({
            chunkIndex: window.chunkIndex ?? chunk.chunkIndex,
            firstFrameIndex: window.firstFrameIndex,
            requestedImageIndex: window.requestedImageIndex ?? window.imageIndex,
            resolvedImageIndex: window.resolvedImageIndex ?? window.imageIndex,
          }) ?? `${chunk.chunkIndex}:${window.requestedImageIndex ?? window.imageIndex}:${window.resolvedImageIndex ?? window.imageIndex}`;
          const current = imageWindowStats.get(statKey) ?? {
            chunkIndex: window.chunkIndex ?? chunk.chunkIndex,
            firstFrameIndex: window.firstFrameIndex,
            startSec: window.startSec,
            endSec: window.endSec,
            frameCount: 0,
            luminanceSum: 0,
            minLuminance: Number.POSITIVE_INFINITY,
            blackFrameCount: 0,
            dbOverallSum: 0,
            pulseScaleSum: 0,
            subjectMaskCoverageSum: 0,
            motifEffectIntensitySum: 0,
            heroWarpActive: false,
            heroCoverageSum: 0,
            backgroundClutterRatioSum: 0,
            activeMotionSum: 0,
            activeEmphasisSum: 0,
            supportMotionSum: 0,
            backgroundMotionSum: 0,
            atmosphereDensitySum: 0,
            midScaleCoverageSum: 0,
            symmetryUsageSum: 0,
            eventDensitySum: 0,
            emitterUsageSum: 0,
            absorberUsageSum: 0,
            explosionCountSum: 0,
            sourceAffinitySum: 0,
            sourceAffinityHeroSum: 0,
            sourceAffinitySupportSum: 0,
            particleConvergenceScoreSum: 0,
            subEmitterChildrenSum: 0,
            heroEchoCountSum: 0,
            heroGlyphComplexitySum: 0,
            heroSubEmitterCountSum: 0,
            heroCoreSizeSum: 0,
            heroOutlineRatioSum: 0,
            heroPrimitiveComplexitySum: 0,
            heroChildEmissionRateSum: 0,
            heroChildFieldDensitySum: 0,
            heroChildFieldRadiusSum: 0,
            heroTrailOccupancySum: 0,
            heroWakeLengthPxSum: 0,
            heroBurstCountSum: 0,
            heroBurstChildrenSum: 0,
            heroMotorJitterSum: 0,
            heroMotorThrustSum: 0,
            heroBurnPhaseSum: 0,
            heroWakeTailAgeAvgSum: 0,
            heroWakeResetCountMax: 0,
            heroSpeedAvgSum: 0,
            heroSpeedPeakMax: 0,
            heroScalePulseAvgSum: 0,
            heroScalePulsePeakMax: 0,
            motifPotencyScoreSum: 0,
            heldTransitionCount: 0,
            swapTransitionCount: 0,
            heroShellInnerAlphaSum: 0,
            heroShellOuterAlphaSum: 0,
            heroShellSceneEnabledCount: 0,
            heroShellConfiguredCountSum: 0,
            heroShellActiveCountSum: 0,
            heroShellTriggerRateLowSum: 0,
            heroShellTriggerRateLowMidSum: 0,
            heroShellTriggerRateLowCompositeSum: 0,
            heroShellThresholdLowSum: 0,
            heroShellThresholdLowMidSum: 0,
            heroShellThresholdLowCompositeSum: 0,
            heroShellTriggerRateHighMidSum: 0,
            heroShellTriggerRateHighSum: 0,
            heroShellTriggerRateUpperSum: 0,
            heroShellThresholdHighMidSum: 0,
            heroShellThresholdHighSum: 0,
            heroShellThresholdUpperSum: 0,
            heroBandLowUsageSum: 0,
            heroBandMidUsageSum: 0,
            heroBandHighUsageSum: 0,
            heroContrastBowlUsed: false,
            heroTravelGracefulBiasSum: 0,
            heroTravelGlitchBiasSum: 0,
            heroTargetSmoothingSum: 0,
            heroSpinVelocitySum: 0,
            motionTierCounts: new Map<string, number>(),
            jumpTriggeredCount: 0,
            jitterSuppressedCount: 0,
            motionTierReadableCount: 0,
            flourishStrengthSum: 0,
            screenEdgeAimBiasSum: 0,
            streamCenterBiasDegreesSum: 0,
            centerwardEmissionRatioSum: 0,
            edgePressureActiveFrameRatioSum: 0,
            reflectiveTransitionCount: 0,
            reflectiveTransitionFamilies: new Set<string>(),
            heroBurstGateActiveRatioSum: 0,
            heroBurstCadenceSlotHitsSum: 0,
            heroBurstTopQuartileRatioSum: 0,
            heroShellHueTravelSum: 0,
            heroShellUnderlayActiveCount: 0,
            heroParticleExitWhiteBiasSum: 0,
            heroVariantWarpSum: 0,
            heroVariantGravitySum: 0,
            heroVariantInconsistencySum: 0,
            heroParticleSizeAvgSum: 0,
            heroParticleTtlAvgSum: 0,
            heroInstanceCountResolvedSum: 0,
            heroPairMinDistancePxMin: Number.POSITIVE_INFINITY,
            heroPairAvgDistancePxSum: 0,
            heroOverlapRatioSum: 0,
            heroCoreOverlapRatioSum: 0,
            heroGlowMergeRatioSum: 0,
            heroLaneDiversityScoreSum: 0,
            heroDistinctQuadrantCountMax: 1,
            heroSeparationReadableCount: 0,
            supportClusterCountMax: 0,
            supportNearHeroScoreSum: 0,
            edgeHighlightPenaltySum: 0,
            edgeDominanceMarginSum: 0,
            deadCenterVoidScoreSum: 0,
            focalReinforcementScoreSum: 0,
            dbTransitionDriveSum: 0,
            bandWeightedTransitionDriveSum: 0,
            hzTransitionDriveSum: 0,
            audioTransitionScoreSum: 0,
            holdPenaltySum: 0,
            swapPromotedByAudioCount: 0,
            recoveryMode: "none",
            fallbackRenderMode: "none",
            fallbackReason: "none",
            fallbackTriggerCountMax: 0,
            fallbackSeverity: "none",
            compositionModeReason: "normal",
            particleTelemetryAvailable: false,
            visibleFallbackRiskCount: 0,
            particleSpawnRequestsSum: 0,
            particleRenderedCountSum: 0,
            particleCulledByLayerCapSum: 0,
            particleCulledByHeroProtectionSum: 0,
            particleCulledByNegativeSpaceSum: 0,
            particleCulledByImageProgressSum: 0,
            particleCulledBySkipNonHeroSum: 0,
            particleOffscreenCountSum: 0,
            particleTooSmallToReadCountSum: 0,
            particleLowAlphaCountSum: 0,
            particleLowContrastCountSum: 0,
            particleVisibleCountSum: 0,
            heroParticleRenderedCountSum: 0,
            supportParticleRenderedCountSum: 0,
            backgroundParticleRenderedCountSum: 0,
            subEmitterTriggerCountSum: 0,
            subEmitterChildSpawnedCountSum: 0,
            edgeDeathEligibleCountSum: 0,
            edgeDeathTriggeredCountSum: 0,
            edgeDeathPlayedCountSum: 0,
            edgeDeathSkippedByCostCountSum: 0,
            edgeExitFramesAvgSum: 0,
            edgeExitDistanceAvgSum: 0,
            edgeDeathEffectCounts: new Map<string, number>(),
            edgeDeathCostTierCounts: new Map<string, number>(),
            focalQuadrant: "center",
            heroQuadrant: "center",
            brightestBlobQuadrant: "center",
            focalOccupancyScoreSum: 0,
            centerBiasScoreSum: 0,
            adaptiveDegradeLevelMax: 0,
            edgeAttractionScaleSum: 0,
            negativeSpaceOccupancySum: 0,
            supportCoverageSum: 0,
            transitionDurationFrameSum: 0,
            transitionCarryStrengthSum: 0,
            transitionCarryAvailabilityScoreSum: 0,
            brightnessFloorSum: 0,
            safetyOverrideCount: 0,
            recoveryTriggered: false,
            recoveryOverrideFrameCount: 0,
            recoveryOverrideFrameRatioSum: 0,
            recoverySeverityScoreMax: 0,
            recoveryActiveAny: false,
            shapePlacementScoreSum: 0,
            effectVisibleFrameRatioSum: 0,
            effectVisiblePixelRatioAvgSum: 0,
            effectLuminanceDeltaAvgSum: 0,
            effectMotionDeltaAvgSum: 0,
            overlayOpacityAvgSum: 0,
            effectVisibilityScoreSum: 0,
          };
          current.frameCount += window.frameCount;
          current.windowKey = window.windowKey ?? current.windowKey;
          current.chunkIndex = window.chunkIndex ?? current.chunkIndex ?? chunk.chunkIndex;
          current.firstFrameIndex = current.firstFrameIndex ?? window.firstFrameIndex;
          current.startSec = current.startSec === undefined ? window.startSec : Math.min(current.startSec, window.startSec ?? current.startSec);
          current.endSec = current.endSec === undefined ? window.endSec : Math.max(current.endSec, window.endSec ?? current.endSec);
          current.fastMode = window.fastMode ?? current.fastMode;
          current.requestedImageIndex = window.requestedImageIndex ?? current.requestedImageIndex;
          current.resolvedImageIndex = window.resolvedImageIndex ?? current.resolvedImageIndex;
          current.themeImagePath = window.themeImagePath ?? current.themeImagePath;
          current.luminanceSum += window.averageLuminance * window.frameCount;
          current.minLuminance = Math.min(current.minLuminance, window.minLuminance);
          current.blackFrameCount += window.blackFrameCount;
          current.dbOverallSum += (window.averageDbOverall ?? 0) * window.frameCount;
          current.pulseScaleSum += (window.averagePulseScale ?? 0) * window.frameCount;
          current.subjectMaskCoverageSum += (window.subjectMaskCoverage ?? 0) * window.frameCount;
          current.motifEffectId = window.motifEffectId ?? current.motifEffectId;
          current.motifEffectPhenomenon = window.motifEffectPhenomenon ?? current.motifEffectPhenomenon;
          current.motifEffectAudioMode = window.motifEffectAudioMode ?? current.motifEffectAudioMode;
          current.motifEffectIntensitySum += (window.motifEffectIntensity ?? 0) * window.frameCount;
          current.heroWarpActive = current.heroWarpActive || Boolean(window.heroWarpActive);
          current.heroCoverageSum += (window.heroCoverage ?? 0) * window.frameCount;
          current.backgroundClutterRatioSum += (window.backgroundClutterRatio ?? 0) * window.frameCount;
          current.activeMotionSum += (window.averageActiveMotionPx ?? 0) * window.frameCount;
          current.activeEmphasisSum += (window.averageActiveEmphasis ?? 0) * window.frameCount;
          current.supportMotionSum += (window.averageSupportMotionPx ?? 0) * window.frameCount;
          current.backgroundMotionSum += (window.averageBackgroundMotionPx ?? 0) * window.frameCount;
          current.atmosphereDensitySum += (window.atmosphereDensity ?? 0) * window.frameCount;
          current.midScaleCoverageSum += (window.midScaleCoverage ?? 0) * window.frameCount;
          current.symmetryUsageSum += (window.symmetryUsage ?? 0) * window.frameCount;
          current.eventDensitySum += (window.eventDensity ?? 0) * window.frameCount;
          current.emitterUsageSum += (window.emitterUsage ?? 0) * window.frameCount;
          current.absorberUsageSum += (window.absorberUsage ?? 0) * window.frameCount;
          current.explosionCountSum += window.explosionCount ?? 0;
          current.sourceAffinitySum += (window.sourceAffinityAvg ?? 0) * window.frameCount;
          current.sourceAffinityHeroSum += (window.sourceAffinityHeroAvg ?? 0) * window.frameCount;
          current.sourceAffinitySupportSum += (window.sourceAffinitySupportAvg ?? 0) * window.frameCount;
          current.particleConvergenceScoreSum += (window.particleConvergenceScore ?? 0) * window.frameCount;
          current.subEmitterChildrenSum += (window.subEmitterChildren ?? 0) * window.frameCount;
          current.heroEchoCountSum += (window.heroEchoCount ?? 0) * window.frameCount;
          current.heroGlyphComplexitySum += (window.heroGlyphComplexity ?? 0) * window.frameCount;
          current.heroSubEmitterCountSum += (window.heroSubEmitterCount ?? 0) * window.frameCount;
          current.heroCoreSizeSum += (window.heroCoreSize ?? 0) * window.frameCount;
          current.heroOutlineRatioSum += (window.heroOutlineRatio ?? 0) * window.frameCount;
          current.heroPrimitiveComplexitySum += (window.heroPrimitiveComplexity ?? 0) * window.frameCount;
          current.heroChildEmissionRateSum += (window.heroChildEmissionRate ?? 0) * window.frameCount;
          current.heroChildFieldDensitySum += (window.heroChildFieldDensity ?? 0) * window.frameCount;
          current.heroChildFieldRadiusSum += (window.heroChildFieldRadius ?? 0) * window.frameCount;
          current.heroTrailOccupancySum += (window.heroTrailOccupancy ?? 0) * window.frameCount;
          current.heroWakeLengthPxSum += (window.heroWakeLengthPx ?? 0) * window.frameCount;
          current.heroBurstCountSum += (window.heroBurstCount ?? 0) * window.frameCount;
          current.heroBurstChildrenSum += (window.heroBurstChildren ?? 0) * window.frameCount;
          current.heroMotorJitterSum += (window.heroMotorJitter ?? 0) * window.frameCount;
          current.heroMotorThrustSum += (window.heroMotorThrust ?? 0) * window.frameCount;
          current.heroBurnPhaseSum += (window.heroBurnPhase ?? 0) * window.frameCount;
          current.heroWakeTailAgeAvgSum += (window.heroWakeTailAgeAvg ?? 0) * window.frameCount;
          current.heroWakeResetCountMax = Math.max(current.heroWakeResetCountMax, window.heroWakeResetCount ?? 0);
          current.heroSpeedAvgSum += (window.heroSpeedAvg ?? 0) * window.frameCount;
          current.heroSpeedPeakMax = Math.max(current.heroSpeedPeakMax, window.heroSpeedPeak ?? 0);
          current.heroScalePulseAvgSum += (window.heroScalePulseAvg ?? 0) * window.frameCount;
          current.heroScalePulsePeakMax = Math.max(current.heroScalePulsePeakMax, window.heroScalePulsePeak ?? 0);
          current.motifPotencyScoreSum += (window.motifPotencyScore ?? 0) * window.frameCount;
          current.transitionTriggerMode = window.transitionTriggerMode ?? current.transitionTriggerMode;
          current.heldTransitionCount += window.heldTransitionCount ?? 0;
          current.swapTransitionCount += window.swapTransitionCount ?? 0;
          current.heroShellInnerAlphaSum += (window.heroShellInnerAlpha ?? 0) * window.frameCount;
          current.heroShellOuterAlphaSum += (window.heroShellOuterAlpha ?? 0) * window.frameCount;
          current.heroShellSceneEnabledCount += window.heroShellSceneEnabled ? window.frameCount : 0;
          current.heroShellConfiguredCountSum += (window.heroShellConfiguredCount ?? 0) * window.frameCount;
          current.heroShellActiveCountSum += (window.heroShellActiveCountAvg ?? 0) * window.frameCount;
          current.heroShellActivationDriverBand = window.heroShellActivationDriverBand ?? current.heroShellActivationDriverBand;
          current.heroShellTriggerRateLowSum += (window.heroShellTriggerRateLow ?? 0) * window.frameCount;
          current.heroShellTriggerRateLowMidSum += (window.heroShellTriggerRateLowMid ?? 0) * window.frameCount;
          current.heroShellTriggerRateLowCompositeSum += (window.heroShellTriggerRateLowComposite ?? 0) * window.frameCount;
          current.heroShellThresholdLowSum += (window.heroShellThresholdLowAvg ?? 0) * window.frameCount;
          current.heroShellThresholdLowMidSum += (window.heroShellThresholdLowMidAvg ?? 0) * window.frameCount;
          current.heroShellThresholdLowCompositeSum += (window.heroShellThresholdLowCompositeAvg ?? 0) * window.frameCount;
          current.heroShellTriggerRateHighMidSum += (window.heroShellTriggerRateHighMid ?? 0) * window.frameCount;
          current.heroShellTriggerRateHighSum += (window.heroShellTriggerRateHigh ?? 0) * window.frameCount;
          current.heroShellTriggerRateUpperSum += (window.heroShellTriggerRateUpper ?? 0) * window.frameCount;
          current.heroShellThresholdHighMidSum += (window.heroShellThresholdHighMidAvg ?? 0) * window.frameCount;
          current.heroShellThresholdHighSum += (window.heroShellThresholdHighAvg ?? 0) * window.frameCount;
          current.heroShellThresholdUpperSum += (window.heroShellThresholdUpperAvg ?? 0) * window.frameCount;
          current.heroShellColorMode = window.heroShellColorMode ?? current.heroShellColorMode;
          current.heroBandLowUsageSum += (window.heroBandLowUsage ?? 0) * window.frameCount;
          current.heroBandMidUsageSum += (window.heroBandMidUsage ?? 0) * window.frameCount;
          current.heroBandHighUsageSum += (window.heroBandHighUsage ?? 0) * window.frameCount;
          current.heroEmitterTopology = window.heroEmitterTopology ?? current.heroEmitterTopology;
          current.heroInstanceVariant = window.heroInstanceVariant ?? current.heroInstanceVariant;
          current.heroContrastBowlUsed = current.heroContrastBowlUsed || Boolean(window.heroContrastBowlUsed);
          current.heroTravelGracefulBiasSum += (window.heroTravelGracefulBias ?? 0) * window.frameCount;
          current.heroTravelGlitchBiasSum += (window.heroTravelGlitchBias ?? 0) * window.frameCount;
          current.heroTargetSmoothingSum += (window.heroTargetSmoothing ?? 0) * window.frameCount;
          current.heroSpinVelocitySum += (window.heroSpinVelocity ?? 0) * window.frameCount;
          current.motionTierCounts.set(window.motionTier ?? "glide", (current.motionTierCounts.get(window.motionTier ?? "glide") ?? 0) + window.frameCount);
          current.jumpTriggeredCount += window.jumpTriggered ? window.frameCount : 0;
          current.jitterSuppressedCount += window.jitterSuppressed ? window.frameCount : 0;
          current.motionTierReadableCount += window.motionTierReadable ? window.frameCount : 0;
          current.flourishStrengthSum += (window.flourishStrength ?? 0) * window.frameCount;
          current.screenEdgeAimBiasSum += (window.screenEdgeAimBias ?? 0) * window.frameCount;
          current.streamCenterBiasDegreesSum += (window.streamCenterBiasDegrees ?? 0) * window.frameCount;
          current.centerwardEmissionRatioSum += (window.centerwardEmissionRatio ?? 0) * window.frameCount;
          current.edgePressureActiveFrameRatioSum += (window.edgePressureActiveFrameRatio ?? 0) * window.frameCount;
          current.reflectiveTransitionCount += window.reflectiveTransitionCount ?? 0;
          if ((window.reflectiveTransitionCount ?? 0) > 0 && window.transitionFamily) {
            current.reflectiveTransitionFamilies.add(window.transitionFamily);
          }
          current.heroBurstGateActiveRatioSum += (window.heroBurstGateActiveRatio ?? 0) * window.frameCount;
          current.heroBurstCadenceSlotHitsSum += window.heroBurstCadenceSlotHits ?? 0;
          current.heroBurstTopQuartileRatioSum += (window.heroBurstTopQuartileRatio ?? 0) * window.frameCount;
          current.heroShellHueTravelSum += (window.heroShellHueTravelAvg ?? 0) * window.frameCount;
          current.heroShellUnderlayActiveCount += (window.heroShellUnderlayActiveRatio ?? 0) * window.frameCount;
          current.heroParticleExitWhiteBiasSum += (window.heroParticleExitWhiteBias ?? 0) * window.frameCount;
          current.heroVariantWarpSum += (window.heroVariantWarp ?? 0) * window.frameCount;
          current.heroVariantGravitySum += (window.heroVariantGravity ?? 0) * window.frameCount;
          current.heroVariantInconsistencySum += (window.heroVariantInconsistency ?? 0) * window.frameCount;
          current.heroParticleSizeAvgSum += (window.heroParticleSizeAvg ?? 0) * window.frameCount;
          current.heroParticleTtlAvgSum += (window.heroParticleTtlAvg ?? 0) * window.frameCount;
          current.heroLayoutFamily = window.heroLayoutFamily ?? current.heroLayoutFamily;
          current.heroInstanceCountResolvedSum += (window.heroInstanceCountResolved ?? 0) * window.frameCount;
          current.heroPairMinDistancePxMin = Math.min(current.heroPairMinDistancePxMin, window.heroPairMinDistancePx ?? Number.POSITIVE_INFINITY);
          current.heroPairAvgDistancePxSum += (window.heroPairAvgDistancePx ?? 0) * window.frameCount;
          current.heroOverlapRatioSum += (window.heroOverlapRatio ?? 0) * window.frameCount;
          current.heroCoreOverlapRatioSum += (window.heroCoreOverlapRatio ?? 0) * window.frameCount;
          current.heroGlowMergeRatioSum += (window.heroGlowMergeRatio ?? 0) * window.frameCount;
          current.heroLaneDiversityScoreSum += (window.heroLaneDiversityScore ?? 0) * window.frameCount;
          current.heroDistinctQuadrantCountMax = Math.max(current.heroDistinctQuadrantCountMax, window.heroDistinctQuadrantCount ?? 1);
          current.heroRelationshipResolved = window.heroRelationshipResolved ?? current.heroRelationshipResolved;
          current.heroSeparationReadableCount += window.heroSeparationReadable ? window.frameCount : 0;
          current.heroSeparationFailureReason = window.heroSeparationFailureReason ?? current.heroSeparationFailureReason;
          current.supportClusterCountMax = Math.max(current.supportClusterCountMax, window.supportClusterCount ?? 0);
          current.supportNearHeroScoreSum += (window.supportNearHeroScore ?? 0) * window.frameCount;
          current.edgeHighlightPenaltySum += (window.edgeHighlightPenalty ?? 0) * window.frameCount;
          current.edgeDominanceMarginSum += (window.edgeDominanceMargin ?? 0) * window.frameCount;
          current.deadCenterVoidScoreSum += (window.deadCenterVoidScore ?? 0) * window.frameCount;
          current.focalReinforcementScoreSum += (window.focalReinforcementScore ?? 0) * window.frameCount;
          current.dbTransitionDriveSum += (window.dbTransitionDrive ?? 0) * window.frameCount;
          current.bandWeightedTransitionDriveSum += (window.bandWeightedTransitionDrive ?? 0) * window.frameCount;
          current.hzTransitionDriveSum += (window.hzTransitionDrive ?? 0) * window.frameCount;
          current.audioTransitionScoreSum += (window.audioTransitionScore ?? 0) * window.frameCount;
          current.holdPenaltySum += (window.holdPenalty ?? 0) * window.frameCount;
          current.swapPromotedByAudioCount += window.swapPromotedByAudio ? window.frameCount : 0;
          current.visibleFallbackRiskCount += window.visibleFallbackRisk ? window.frameCount : 0;
          if (window.recoveryMode && window.recoveryMode !== "none") {
            current.recoveryMode = window.recoveryMode;
          }
          if (window.fallbackRenderMode && window.fallbackRenderMode !== "none") {
            if (fallbackSeverityRank(window.fallbackSeverity) >= fallbackSeverityRank(current.fallbackSeverity)) {
              current.fallbackRenderMode = window.fallbackRenderMode;
              current.fallbackSeverity = window.fallbackSeverity;
            }
          }
          if (window.fallbackReason && window.fallbackReason !== "none") {
            current.fallbackReason = window.fallbackReason;
          }
          current.fallbackTriggerCountMax = Math.max(current.fallbackTriggerCountMax, window.fallbackTriggerCount ?? 0);
          if (window.compositionModeReason && window.compositionModeReason !== "normal") {
            current.compositionModeReason = window.compositionModeReason;
          }
          current.particleTelemetryAvailable = current.particleTelemetryAvailable || Boolean(window.particleTelemetryAvailable);
          current.particleSpawnRequestsSum += (window.particleSpawnRequests ?? 0) * window.frameCount;
          current.particleRenderedCountSum += (window.particleRenderedCount ?? 0) * window.frameCount;
          current.particleCulledByLayerCapSum += (window.particleCulledByLayerCap ?? 0) * window.frameCount;
          current.particleCulledByHeroProtectionSum += (window.particleCulledByHeroProtection ?? 0) * window.frameCount;
          current.particleCulledByNegativeSpaceSum += (window.particleCulledByNegativeSpace ?? 0) * window.frameCount;
          current.particleCulledByImageProgressSum += (window.particleCulledByImageProgress ?? 0) * window.frameCount;
          current.particleCulledBySkipNonHeroSum += (window.particleCulledBySkipNonHero ?? 0) * window.frameCount;
          current.particleOffscreenCountSum += (window.particleOffscreenCount ?? 0) * window.frameCount;
          current.particleTooSmallToReadCountSum += (window.particleTooSmallToReadCount ?? 0) * window.frameCount;
          current.particleLowAlphaCountSum += (window.particleLowAlphaCount ?? 0) * window.frameCount;
          current.particleLowContrastCountSum += (window.particleLowContrastCount ?? 0) * window.frameCount;
          current.particleVisibleCountSum += (window.particleVisibleCount ?? 0) * window.frameCount;
          current.heroParticleRenderedCountSum += (window.heroParticleRenderedCount ?? 0) * window.frameCount;
          current.supportParticleRenderedCountSum += (window.supportParticleRenderedCount ?? 0) * window.frameCount;
          current.backgroundParticleRenderedCountSum += (window.backgroundParticleRenderedCount ?? 0) * window.frameCount;
          current.subEmitterTriggerCountSum += (window.subEmitterTriggerCount ?? 0) * window.frameCount;
          current.subEmitterChildSpawnedCountSum += (window.subEmitterChildSpawnedCount ?? 0) * window.frameCount;
          current.edgeDeathEligibleCountSum += (window.edgeDeathEligibleCount ?? 0) * window.frameCount;
          current.edgeDeathTriggeredCountSum += (window.edgeDeathTriggeredCount ?? 0) * window.frameCount;
          current.edgeDeathPlayedCountSum += (window.edgeDeathPlayedCount ?? 0) * window.frameCount;
          current.edgeDeathSkippedByCostCountSum += (window.edgeDeathSkippedByCostCount ?? 0) * window.frameCount;
          current.edgeExitFramesAvgSum += (window.edgeExitFramesAvg ?? 0) * window.frameCount;
          current.edgeExitDistanceAvgSum += (window.edgeExitDistanceAvg ?? 0) * window.frameCount;
          if (window.edgeDeathEffectId) {
            current.edgeDeathEffectCounts.set(window.edgeDeathEffectId, (current.edgeDeathEffectCounts.get(window.edgeDeathEffectId) ?? 0) + window.frameCount);
          }
          if (window.edgeDeathCostTier) {
            current.edgeDeathCostTierCounts.set(window.edgeDeathCostTier, (current.edgeDeathCostTierCounts.get(window.edgeDeathCostTier) ?? 0) + window.frameCount);
          }
          current.focalQuadrant = window.focalQuadrant ?? current.focalQuadrant;
          current.heroQuadrant = window.heroQuadrant ?? current.heroQuadrant;
          current.brightestBlobQuadrant = window.brightestBlobQuadrant ?? current.brightestBlobQuadrant;
          current.focalOccupancyScoreSum += (window.focalOccupancyScore ?? 0) * window.frameCount;
          current.centerBiasScoreSum += (window.centerBiasScore ?? 0) * window.frameCount;
          current.adaptiveDegradeLevelMax = Math.max(current.adaptiveDegradeLevelMax, window.adaptiveDegradeLevel ?? 0);
          current.heroMotionBias = window.heroMotionBias ?? current.heroMotionBias;
          current.heroSpawnRegion = window.heroSpawnRegion ?? current.heroSpawnRegion;
          current.heroMotifProfile = window.heroMotifProfile ?? current.heroMotifProfile;
          current.heroMotifVariantKey = window.heroMotifVariantKey ?? current.heroMotifVariantKey;
          current.heroParticleSizeVariance = window.heroParticleSizeVariance ?? current.heroParticleSizeVariance;
          current.heroColorProminence = window.heroColorProminence ?? current.heroColorProminence;
          current.heroRelationshipClass = window.heroRelationshipClass ?? current.heroRelationshipClass;
          current.shotGrammarKey = window.shotGrammarKey ?? current.shotGrammarKey;
          current.transitionBudgetTier = window.transitionBudgetTier ?? current.transitionBudgetTier;
          current.transitionBudgetReason = window.transitionBudgetReason ?? current.transitionBudgetReason;
          current.motifInfluenceKey = window.motifInfluenceKey ?? current.motifInfluenceKey;
          current.edgeAttractionScaleSum += (window.edgeAttractionScale ?? 0) * window.frameCount;
          current.transitionMotionGrammar = window.transitionMotionGrammar ?? current.transitionMotionGrammar;
          current.negativeSpaceOccupancySum += (window.negativeSpaceOccupancy ?? 0) * window.frameCount;
          current.supportCoverageSum += (window.supportCoverage ?? 0) * window.frameCount;
          current.transitionDurationFrameSum += (window.transitionAvgDurationFrames ?? 0) * window.frameCount;
          current.transitionCarryStrengthSum += (window.transitionCarryStrength ?? 0) * window.frameCount;
          current.transitionCarryAvailabilityScoreSum += (window.transitionCarryAvailabilityScore ?? 0) * window.frameCount;
          current.transitionCarryMode = window.transitionCarryMode ?? current.transitionCarryMode;
          current.transitionCarryFallbackReason = window.transitionCarryFallbackReason ?? current.transitionCarryFallbackReason;
          current.brightnessFloorSum += (window.brightnessFloor ?? 0) * window.frameCount;
          current.shapePlacementScoreSum += (window.shapePlacementScore ?? 0) * window.frameCount;
          current.safetyOverrideCount += window.safetyOverrideCount ?? 0;
          current.recoveryTriggered = current.recoveryTriggered || Boolean(window.recoveryTriggered);
          current.recoveryOverrideFrameCount += window.recoveryOverrideFrameCount ?? 0;
          current.recoveryOverrideFrameRatioSum += (window.recoveryOverrideFrameRatio ?? 0) * window.frameCount;
          current.recoverySeverityScoreMax = Math.max(current.recoverySeverityScoreMax, window.recoverySeverityScore ?? 0);
          current.recoveryActiveAny = current.recoveryActiveAny || Boolean(window.recoveryActiveAny);
          current.effectVisibleFrameRatioSum += (window.effectVisibleFrameRatio ?? 0) * window.frameCount;
          current.effectVisiblePixelRatioAvgSum += (window.effectVisiblePixelRatioAvg ?? 0) * window.frameCount;
          current.effectLuminanceDeltaAvgSum += (window.effectLuminanceDeltaAvg ?? 0) * window.frameCount;
          current.effectMotionDeltaAvgSum += (window.effectMotionDeltaAvg ?? 0) * window.frameCount;
          current.overlayOpacityAvgSum += (window.overlayOpacityAvg ?? 0) * window.frameCount;
          current.overlayCompositeMode = window.overlayCompositeMode ?? current.overlayCompositeMode;
          current.effectVisibilityScoreSum += (window.effectVisibilityScore ?? 0) * window.frameCount;
          current.diagnosticCompleteness = window.diagnosticCompleteness ?? current.diagnosticCompleteness;
          current.diagnosticMissingFields = window.diagnosticMissingFields ?? current.diagnosticMissingFields;
          current.diagnosticFailureReason = window.diagnosticFailureReason ?? current.diagnosticFailureReason;
          current.visualRegime = window.visualRegime ?? current.visualRegime;
          current.overlayMode = window.overlayMode ?? current.overlayMode;
          current.transitionFamily = window.transitionFamily ?? current.transitionFamily;
          current.activeMode = window.activeMode ?? current.activeMode;
          current.compositionMode = window.compositionMode ?? current.compositionMode;
          current.nodeIntent = window.nodeIntent ?? current.nodeIntent;
          current.episodeIntent = window.episodeIntent ?? current.episodeIntent;
          current.heroArchetype = window.heroArchetype ?? current.heroArchetype;
          current.heroStoryBeat = window.heroStoryBeat ?? current.heroStoryBeat;
          current.heroEmissionMode = window.heroEmissionMode ?? current.heroEmissionMode;
          current.subEmitterMode = window.subEmitterMode ?? current.subEmitterMode;
          current.heroPrimitive = window.heroPrimitive ?? current.heroPrimitive;
          current.heroShellMode = window.heroShellMode ?? current.heroShellMode;
          current.heroBaseShellMode = window.heroBaseShellMode ?? current.heroBaseShellMode;
          current.heroResolvedShellMode = window.heroResolvedShellMode ?? current.heroResolvedShellMode;
          current.heroCircleShellEligible = window.heroCircleShellEligible ?? current.heroCircleShellEligible;
          current.heroCircleShellPromoted = window.heroCircleShellPromoted ?? current.heroCircleShellPromoted;
          current.heroCoreFillMode = window.heroCoreFillMode ?? current.heroCoreFillMode;
          imageWindowStats.set(statKey, current);
        }
      }
      const finalOutputExists = await pathExists(resolvedPaths.outputPath);
      const bpmSource = analysis?.metadata.bpmSource
        ?? (sourceMetadata ? resolvePreferredBpm(sourceMetadata, trimmedMetadata).source : "default");
      const report: DebugReport = {
        outputPath: resolvedPaths.outputPath,
        imageDebugDir,
        fastMode: options.fast ?? false,
        themeImageCacheHits,
        themeImageCacheMisses,
        themeImageRemoteDownloads,
        runStatus: primaryError ? "failure" : "success",
        failureStage: primaryError ? currentStage : undefined,
        failureMessage: primaryError ? (primaryError instanceof Error ? primaryError.message : String(primaryError)) : undefined,
        failureStack: primaryError instanceof Error ? primaryError.stack : undefined,
        lastCompletedStage,
        statusLog,
        artifacts: {
          chunkPaths,
          videoOnlyPath,
          finalOutputExists,
          debugReportPath: path.join(debugDir, "output.txt"),
        },
        stageTimings: debug.snapshot(),
        totalElapsedMs: debug.totalElapsedMs(),
        encoderPreset: DEFAULT_ENCODER_PRESET,
        sourceAudioPath,
        trimmedAudioPath: resolvedPaths.trimmedAudioPath,
        sourceMetadataBpm: sourceMetadata?.metadataBpm,
        trimmedMetadataBpm: trimmedMetadata?.metadataBpm,
        estimatedBpm: analysis?.metadata.estimatedBpm,
        chosenBpm: bpm,
        bpmSource,
        bpmTrustState: analysis?.metadata.bpmTrustState,
        beatOriginSec: analysis?.metadata.beatOriginSec,
        beatOriginConfidence: analysis?.metadata.beatOriginConfidence,
        beatOriginSource: analysis?.metadata.beatOriginSource,
        anchorTrustState: analysis?.metadata.anchorTrustState,
        anchorSearchStartSec: analysis?.metadata.anchorSearchStartSec,
        anchorSearchEndSec: analysis?.metadata.anchorSearchEndSec,
        anchorCandidateCount: analysis?.metadata.anchorCandidateCount,
        anchorSupportHitCount: analysis?.metadata.anchorSupportHitCount,
        anchorTopCandidates: analysis?.metadata.anchorTopCandidates,
        cleanup: cleanupWarning,
        renderChunks: renderChunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
        effects: [],
      };
      const imageWindowStatsList = [...imageWindowStats.values()];

      const overlapDuration = (aStart: number, aEnd: number, bStart?: number, bEnd?: number): number => {
        if (bStart === undefined || bEnd === undefined) {
          return -1;
        }
        return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
      };

      const pickWindowStatForNode = (
        imageIndex: number,
        startSec: number,
        endSec: number,
      ): { stat?: typeof imageWindowStatsList[number]; failureReason?: RenderDiagnosticFailureReason } => {
        const chunkIndex = Math.floor(startSec / RENDER_CHUNK_SECONDS);
        const candidates = imageWindowStatsList
          .map((stat) => ({
            stat,
            chunkMatch: stat.chunkIndex === chunkIndex ? 1 : 0,
            overlap: overlapDuration(startSec, endSec, stat.startSec, stat.endSec),
            resolvedMatch: stat.resolvedImageIndex === imageIndex ? 1 : 0,
            completeness: stat.diagnosticCompleteness === "complete" || stat.diagnosticCompleteness === undefined ? 1 : 0,
            firstFrameIndex: stat.firstFrameIndex ?? Number.MAX_SAFE_INTEGER,
          }))
          .filter((entry) => entry.overlap > 0 || entry.resolvedMatch === 1);
        const stat = candidates
          .sort((a, b) =>
            b.chunkMatch - a.chunkMatch ||
            b.overlap - a.overlap ||
            b.completeness - a.completeness ||
            b.resolvedMatch - a.resolvedMatch ||
            a.firstFrameIndex - b.firstFrameIndex)[0]?.stat;
        if (stat) {
          return { stat };
        }
        const sameImageCandidates = imageWindowStatsList.filter((candidate) => candidate.resolvedImageIndex === imageIndex);
        if (sameImageCandidates.length > 1) {
          return { failureReason: "window-key-fragmented" };
        }
        if (sameImageCandidates.length === 1) {
          return { failureReason: "window-rendered-no-stats" };
        }
        return { failureReason: "window-not-found" };
      };

      const extractDebugFrameSafe = async (timeSec: number, outputPath: string): Promise<string | undefined> => {
        try {
          await extractVideoFrame(
            resolvedPaths.ffmpegPath,
            resolvedPaths.outputPath,
            timeSec,
            outputPath,
          );
          return outputPath;
        } catch {
          return undefined;
        }
      };

      if (completedSuccessfully && finalOutputExists && styleProfiles && edgeMaps && analysis) {
        try {
          report.effects = await Promise.all(styleProfiles.map(async (profile, imageIndex) => {
            const startSec = imageIndex * imageSeconds;
            const endSec = Math.min(analysis!.metadata.durationSec, startSec + imageSeconds);
            const nodeQuarterSec = startSec + Math.max(0, endSec - startSec) * 0.25;
            const nodeMiddleSec = startSec + Math.max(0, endSec - startSec) * 0.5;
            const nodeThreeQuarterSec = startSec + Math.max(0, endSec - startSec) * 0.75;
            const nodePrefix = `image-${String(imageIndex).padStart(3, "0")}`;
            const referenceImagePath = path.join(imageDebugDir, `${nodePrefix}-input${path.extname(profile.imagePath) || ".jpg"}`);
            const nodeQuarterFramePath = path.join(imageDebugDir, `${nodePrefix}-quarter.png`);
            const nodeMiddleFramePath = path.join(imageDebugDir, `${nodePrefix}-middle.png`);
            const nodeThreeQuarterFramePath = path.join(imageDebugDir, `${nodePrefix}-three-quarter.png`);
            await copyFile(profile.imagePath, referenceImagePath);
            const quarterFramePath = await extractDebugFrameSafe(nodeQuarterSec, nodeQuarterFramePath);
            const middleFramePath = await extractDebugFrameSafe(nodeMiddleSec, nodeMiddleFramePath);
            const threeQuarterFramePath = await extractDebugFrameSafe(nodeThreeQuarterSec, nodeThreeQuarterFramePath);
            const statSelection = pickWindowStatForNode(imageIndex, startSec, endSec);
            const stat = statSelection.stat;
            const averageLuminance = stat ? stat.luminanceSum / Math.max(1, stat.frameCount) : undefined;
            const blackFrameRatio = stat ? stat.blackFrameCount / Math.max(1, stat.frameCount) : undefined;
            return {
              imageIndex,
              windowKey: stat?.windowKey ?? `missing:${imageIndex}`,
              fastMode: stat?.fastMode ?? options.fast ?? false,
              requestedImageIndex: stat?.requestedImageIndex,
              resolvedImageIndex: stat?.resolvedImageIndex,
              imagePath: profile.imagePath,
              themeImagePath: stat?.themeImagePath,
              referenceImagePath,
              quarterFramePath,
              middleFramePath,
              threeQuarterFramePath,
              startSec,
              endSec,
              chunkIndex: Math.floor(startSec / RENDER_CHUNK_SECONDS),
              firstPixelR: profile.firstPixelR,
              firstPixelG: profile.firstPixelG,
              firstPixelB: profile.firstPixelB,
              averageR: profile.averageR,
              averageG: profile.averageG,
              averageB: profile.averageB,
              effectSeed: profile.effectSeed,
              effectBucket: profile.effectBucket,
              effectCycle: profile.effectCycle,
              transitionMode: profile.transitionMode,
              rawEffectMode: profile.effectMode % 16,
              effectiveEffectMode: sanitizeEffectMode(profile.effectMode),
              averageLuminance,
              minLuminance: stat && Number.isFinite(stat.minLuminance) ? stat.minLuminance : undefined,
              blackFrameCount: stat?.blackFrameCount,
              blackFrameRatio,
              averageDbOverall: stat ? stat.dbOverallSum / Math.max(1, stat.frameCount) : undefined,
              averagePulseScale: stat ? stat.pulseScaleSum / Math.max(1, stat.frameCount) : undefined,
              subjectMaskCoverage: stat ? stat.subjectMaskCoverageSum / Math.max(1, stat.frameCount) : undefined,
              heroCoverage: stat ? stat.heroCoverageSum / Math.max(1, stat.frameCount) : undefined,
              backgroundClutterRatio: stat ? stat.backgroundClutterRatioSum / Math.max(1, stat.frameCount) : undefined,
              motif: stat?.sourceMotif ?? edgeMaps![imageIndex]?.fractalMotif,
              sourceMotif: stat?.sourceMotif ?? edgeMaps![imageIndex]?.fractalMotif,
              heroMotifResolved: stat?.heroMotifResolved,
              heroMotifScheduled: stat?.heroMotifScheduled,
              heroMotifSlotIndex: stat?.heroMotifSlotIndex,
              heroMotifSlotStartSec: stat?.heroMotifSlotStartSec,
              heroMotifSlotEndSec: stat?.heroMotifSlotEndSec,
              heroMotifScheduleReason: stat?.heroMotifScheduleReason,
              heroMotifChangedOnSlotBoundary: stat?.heroMotifChangedOnSlotBoundary,
              heroMotifChangedOutsideSlot: stat?.heroMotifChangedOutsideSlot,
              heroMotifScheduleMismatch: stat?.heroMotifScheduleMismatch,
              motifEffectId: stat?.motifEffectId,
              motifEffectPhenomenon: stat?.motifEffectPhenomenon,
              motifEffectAudioMode: stat?.motifEffectAudioMode,
              motifEffectIntensity: stat ? stat.motifEffectIntensitySum / Math.max(1, stat.frameCount) : undefined,
              heroWarpActive: stat?.heroWarpActive,
              maskConfidence: edgeMaps![imageIndex]?.maskConfidence,
              visualRegime: stat?.visualRegime,
              overlayMode: stat?.overlayMode,
              transitionFamily: stat?.transitionFamily,
              brightnessFloor: stat ? stat.brightnessFloorSum / Math.max(1, stat.frameCount) : undefined,
              safetyOverrideCount: stat?.safetyOverrideCount,
              recoveryTriggered: stat?.recoveryTriggered,
              recoveryOverrideFrameCount: stat?.recoveryOverrideFrameCount,
              recoveryOverrideFrameRatio: stat ? stat.recoveryOverrideFrameRatioSum / Math.max(1, stat.frameCount) : undefined,
              recoverySeverityScore: stat?.recoverySeverityScoreMax,
              recoveryActiveAny: stat?.recoveryActiveAny,
              activeMode: stat?.activeMode,
              averageActiveMotionPx: stat ? stat.activeMotionSum / Math.max(1, stat.frameCount) : undefined,
              averageActiveEmphasis: stat ? stat.activeEmphasisSum / Math.max(1, stat.frameCount) : undefined,
              averageSupportMotionPx: stat ? stat.supportMotionSum / Math.max(1, stat.frameCount) : undefined,
              averageBackgroundMotionPx: stat ? stat.backgroundMotionSum / Math.max(1, stat.frameCount) : undefined,
              atmosphereDensity: stat ? stat.atmosphereDensitySum / Math.max(1, stat.frameCount) : undefined,
              midScaleCoverage: stat ? stat.midScaleCoverageSum / Math.max(1, stat.frameCount) : undefined,
              symmetryUsage: stat ? stat.symmetryUsageSum / Math.max(1, stat.frameCount) : undefined,
              eventDensity: stat ? stat.eventDensitySum / Math.max(1, stat.frameCount) : undefined,
              emitterUsage: stat ? stat.emitterUsageSum / Math.max(1, stat.frameCount) : undefined,
              absorberUsage: stat ? stat.absorberUsageSum / Math.max(1, stat.frameCount) : undefined,
              explosionCount: stat?.explosionCountSum,
              sourceAffinityAvg: stat ? stat.sourceAffinitySum / Math.max(1, stat.frameCount) : undefined,
              sourceAffinityHeroAvg: stat ? stat.sourceAffinityHeroSum / Math.max(1, stat.frameCount) : undefined,
              sourceAffinitySupportAvg: stat ? stat.sourceAffinitySupportSum / Math.max(1, stat.frameCount) : undefined,
              particleConvergenceScore: stat ? stat.particleConvergenceScoreSum / Math.max(1, stat.frameCount) : undefined,
              subEmitterChildren: stat ? stat.subEmitterChildrenSum / Math.max(1, stat.frameCount) : undefined,
              heroEchoCount: stat ? stat.heroEchoCountSum / Math.max(1, stat.frameCount) : undefined,
              heroGlyphComplexity: stat ? stat.heroGlyphComplexitySum / Math.max(1, stat.frameCount) : undefined,
              heroSubEmitterCount: stat ? stat.heroSubEmitterCountSum / Math.max(1, stat.frameCount) : undefined,
              heroCoreSize: stat ? stat.heroCoreSizeSum / Math.max(1, stat.frameCount) : undefined,
              heroCoreFillMode: stat?.heroCoreFillMode,
              heroOutlineRatio: stat ? stat.heroOutlineRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroPrimitiveComplexity: stat ? stat.heroPrimitiveComplexitySum / Math.max(1, stat.frameCount) : undefined,
              heroChildEmissionRate: stat ? stat.heroChildEmissionRateSum / Math.max(1, stat.frameCount) : undefined,
              heroChildFieldDensity: stat ? stat.heroChildFieldDensitySum / Math.max(1, stat.frameCount) : undefined,
              heroChildFieldRadius: stat ? stat.heroChildFieldRadiusSum / Math.max(1, stat.frameCount) : undefined,
              heroTrailOccupancy: stat ? stat.heroTrailOccupancySum / Math.max(1, stat.frameCount) : undefined,
              heroWakeLengthPx: stat ? stat.heroWakeLengthPxSum / Math.max(1, stat.frameCount) : undefined,
              heroBurstCount: stat ? stat.heroBurstCountSum / Math.max(1, stat.frameCount) : undefined,
              heroBurstChildren: stat ? stat.heroBurstChildrenSum / Math.max(1, stat.frameCount) : undefined,
              heroMotorJitter: stat ? stat.heroMotorJitterSum / Math.max(1, stat.frameCount) : undefined,
              heroMotorThrust: stat ? stat.heroMotorThrustSum / Math.max(1, stat.frameCount) : undefined,
              heroBurnPhase: stat ? stat.heroBurnPhaseSum / Math.max(1, stat.frameCount) : undefined,
              heroWakeTailAgeAvg: stat ? stat.heroWakeTailAgeAvgSum / Math.max(1, stat.frameCount) : undefined,
              heroWakeResetCount: stat?.heroWakeResetCountMax,
              heroSpeedAvg: stat ? stat.heroSpeedAvgSum / Math.max(1, stat.frameCount) : undefined,
              heroSpeedPeak: stat?.heroSpeedPeakMax,
              heroScalePulseAvg: stat ? stat.heroScalePulseAvgSum / Math.max(1, stat.frameCount) : undefined,
              heroScalePulsePeak: stat?.heroScalePulsePeakMax,
              motifPotencyScore: stat ? stat.motifPotencyScoreSum / Math.max(1, stat.frameCount) : undefined,
              transitionTriggerMode: stat?.transitionTriggerMode,
              heldTransitionCount: stat?.heldTransitionCount,
              swapTransitionCount: stat?.swapTransitionCount,
              heldTransitionRatio: stat ? stat.heldTransitionCount / Math.max(1, stat.heldTransitionCount + stat.swapTransitionCount) : undefined,
              heroShellInnerAlpha: stat ? stat.heroShellInnerAlphaSum / Math.max(1, stat.frameCount) : undefined,
              heroShellOuterAlpha: stat ? stat.heroShellOuterAlphaSum / Math.max(1, stat.frameCount) : undefined,
              heroShellSceneEnabled: stat ? stat.heroShellSceneEnabledCount > stat.frameCount * 0.5 : undefined,
              heroShellConfiguredCount: stat ? Math.round(stat.heroShellConfiguredCountSum / Math.max(1, stat.frameCount)) as 0 | 1 | 2 | 3 : undefined,
              heroShellColorMode: stat?.heroShellColorMode,
              heroShellActiveCountAvg: stat ? stat.heroShellActiveCountSum / Math.max(1, stat.frameCount) : undefined,
              heroShellActivationDriverBand: stat?.heroShellActivationDriverBand,
              heroShellTriggerRateLow: stat ? stat.heroShellTriggerRateLowSum / Math.max(1, stat.frameCount) : undefined,
              heroShellTriggerRateLowMid: stat ? stat.heroShellTriggerRateLowMidSum / Math.max(1, stat.frameCount) : undefined,
              heroShellTriggerRateLowComposite: stat ? stat.heroShellTriggerRateLowCompositeSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdLowAvg: stat ? stat.heroShellThresholdLowSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdLowMidAvg: stat ? stat.heroShellThresholdLowMidSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdLowCompositeAvg: stat ? stat.heroShellThresholdLowCompositeSum / Math.max(1, stat.frameCount) : undefined,
              heroShellTriggerRateHighMid: stat ? stat.heroShellTriggerRateHighMidSum / Math.max(1, stat.frameCount) : undefined,
              heroShellTriggerRateHigh: stat ? stat.heroShellTriggerRateHighSum / Math.max(1, stat.frameCount) : undefined,
              heroShellTriggerRateUpper: stat ? stat.heroShellTriggerRateUpperSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdHighMidAvg: stat ? stat.heroShellThresholdHighMidSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdHighAvg: stat ? stat.heroShellThresholdHighSum / Math.max(1, stat.frameCount) : undefined,
              heroShellThresholdUpperAvg: stat ? stat.heroShellThresholdUpperSum / Math.max(1, stat.frameCount) : undefined,
              heroBandLowUsage: stat ? stat.heroBandLowUsageSum / Math.max(1, stat.frameCount) : undefined,
              heroBandMidUsage: stat ? stat.heroBandMidUsageSum / Math.max(1, stat.frameCount) : undefined,
              heroBandHighUsage: stat ? stat.heroBandHighUsageSum / Math.max(1, stat.frameCount) : undefined,
              heroEmitterTopology: stat?.heroEmitterTopology,
              heroInstanceVariant: stat?.heroInstanceVariant,
              heroContrastBowlUsed: stat?.heroContrastBowlUsed,
              heroTravelGracefulBias: stat ? stat.heroTravelGracefulBiasSum / Math.max(1, stat.frameCount) : undefined,
              heroTravelGlitchBias: stat ? stat.heroTravelGlitchBiasSum / Math.max(1, stat.frameCount) : undefined,
              heroTargetSmoothing: stat ? stat.heroTargetSmoothingSum / Math.max(1, stat.frameCount) : undefined,
              heroSpinVelocity: stat ? stat.heroSpinVelocitySum / Math.max(1, stat.frameCount) : undefined,
              motionTier: stat ? [...stat.motionTierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as import("./types").RenderImageWindowStat["motionTier"] : undefined,
              jumpTriggered: stat ? stat.jumpTriggeredCount > 0 : undefined,
              jitterSuppressed: stat ? stat.jitterSuppressedCount > stat.frameCount * 0.25 : undefined,
              motionTierReadable: stat ? stat.motionTierReadableCount > stat.frameCount * 0.55 : undefined,
              flourishStrength: stat ? stat.flourishStrengthSum / Math.max(1, stat.frameCount) : undefined,
              screenEdgeAimBias: stat ? stat.screenEdgeAimBiasSum / Math.max(1, stat.frameCount) : undefined,
              streamCenterBiasDegrees: stat ? stat.streamCenterBiasDegreesSum / Math.max(1, stat.frameCount) : undefined,
              centerwardEmissionRatio: stat ? stat.centerwardEmissionRatioSum / Math.max(1, stat.frameCount) : undefined,
              edgePressureActiveFrameRatio: stat ? stat.edgePressureActiveFrameRatioSum / Math.max(1, stat.frameCount) : undefined,
              reflectiveTransitionCount: stat?.reflectiveTransitionCount,
              reflectiveTransitionUniqueCount: stat?.reflectiveTransitionFamilies.size,
              heroBurstGateActiveRatio: stat ? stat.heroBurstGateActiveRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroBurstCadenceSlotHits: stat?.heroBurstCadenceSlotHitsSum,
              heroBurstTopQuartileRatio: stat ? stat.heroBurstTopQuartileRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroShellHueTravelAvg: stat ? stat.heroShellHueTravelSum / Math.max(1, stat.frameCount) : undefined,
              heroShellUnderlayActiveRatio: stat ? stat.heroShellUnderlayActiveCount / Math.max(1, stat.frameCount) : undefined,
              heroParticleExitWhiteBias: stat ? stat.heroParticleExitWhiteBiasSum / Math.max(1, stat.frameCount) : undefined,
              heroMotifVariantKey: stat?.heroMotifVariantKey,
              heroVariantWarp: stat ? stat.heroVariantWarpSum / Math.max(1, stat.frameCount) : undefined,
              heroVariantGravity: stat ? stat.heroVariantGravitySum / Math.max(1, stat.frameCount) : undefined,
              heroVariantInconsistency: stat ? stat.heroVariantInconsistencySum / Math.max(1, stat.frameCount) : undefined,
              heroParticleSizeAvg: stat ? stat.heroParticleSizeAvgSum / Math.max(1, stat.frameCount) : undefined,
              heroParticleTtlAvg: stat ? stat.heroParticleTtlAvgSum / Math.max(1, stat.frameCount) : undefined,
              heroLayoutFamily: stat?.heroLayoutFamily,
              heroInstanceCountResolved: stat ? stat.heroInstanceCountResolvedSum / Math.max(1, stat.frameCount) : undefined,
              heroPairMinDistancePx: stat && Number.isFinite(stat.heroPairMinDistancePxMin) ? stat.heroPairMinDistancePxMin : undefined,
              heroPairAvgDistancePx: stat ? stat.heroPairAvgDistancePxSum / Math.max(1, stat.frameCount) : undefined,
              heroOverlapRatio: stat ? stat.heroOverlapRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroCoreOverlapRatio: stat ? stat.heroCoreOverlapRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroGlowMergeRatio: stat ? stat.heroGlowMergeRatioSum / Math.max(1, stat.frameCount) : undefined,
              heroLaneDiversityScore: stat ? stat.heroLaneDiversityScoreSum / Math.max(1, stat.frameCount) : undefined,
              heroDistinctQuadrantCount: stat?.heroDistinctQuadrantCountMax,
              focalQuadrant: stat?.focalQuadrant,
              heroQuadrant: stat?.heroQuadrant,
              brightestBlobQuadrant: stat?.brightestBlobQuadrant,
              supportClusterCount: stat?.supportClusterCountMax,
              supportNearHeroScore: stat ? stat.supportNearHeroScoreSum / Math.max(1, stat.frameCount) : undefined,
              edgeHighlightPenalty: stat ? stat.edgeHighlightPenaltySum / Math.max(1, stat.frameCount) : undefined,
              edgeDominanceMargin: stat ? stat.edgeDominanceMarginSum / Math.max(1, stat.frameCount) : undefined,
              deadCenterVoidScore: stat ? stat.deadCenterVoidScoreSum / Math.max(1, stat.frameCount) : undefined,
              focalReinforcementScore: stat ? stat.focalReinforcementScoreSum / Math.max(1, stat.frameCount) : undefined,
              dbTransitionDrive: stat ? stat.dbTransitionDriveSum / Math.max(1, stat.frameCount) : undefined,
              bandWeightedTransitionDrive: stat ? stat.bandWeightedTransitionDriveSum / Math.max(1, stat.frameCount) : undefined,
              hzTransitionDrive: stat ? stat.hzTransitionDriveSum / Math.max(1, stat.frameCount) : undefined,
              audioTransitionScore: stat ? stat.audioTransitionScoreSum / Math.max(1, stat.frameCount) : undefined,
              holdPenalty: stat ? stat.holdPenaltySum / Math.max(1, stat.frameCount) : undefined,
              swapPromotedByAudio: stat ? stat.swapPromotedByAudioCount > 0 : undefined,
              recoveryMode: stat?.recoveryMode ?? "none",
              fallbackRenderMode: stat?.fallbackRenderMode ?? "none",
              fallbackReason: stat?.fallbackReason ?? (!stat ? "stat-missing" : "none"),
              fallbackTriggerCount: stat?.fallbackTriggerCountMax,
              fallbackSeverity: stat?.fallbackSeverity ?? "none",
              compositionModeReason: stat?.compositionModeReason ?? (stat ? "normal" : "low-confidence-mask-recovery"),
              particleTelemetryAvailable: stat?.particleTelemetryAvailable ?? false,
              visibleFallbackRisk: stat ? stat.visibleFallbackRiskCount > 0 : false,
              bpmTrustState: analysis?.metadata.bpmTrustState,
              anchorTrustState: analysis?.metadata.anchorTrustState,
              focalOccupancyScore: stat ? stat.focalOccupancyScoreSum / Math.max(1, stat.frameCount) : undefined,
              centerBiasScore: stat ? stat.centerBiasScoreSum / Math.max(1, stat.frameCount) : undefined,
              adaptiveDegradeLevel: stat?.adaptiveDegradeLevelMax,
              heroParticleSizeVariance: stat?.heroParticleSizeVariance,
              heroColorProminence: stat?.heroColorProminence,
              heroRelationshipMode: stat?.heroRelationshipResolved ?? stat?.heroRelationshipMode,
              heroRelationshipClass: stat?.heroRelationshipClass,
              heroRelationshipResolved: stat?.heroRelationshipResolved,
              heroSeparationReadable: stat ? stat.heroSeparationReadableCount > stat.frameCount * 0.55 : undefined,
              heroSeparationFailureReason: stat?.heroSeparationFailureReason,
              shotGrammarKey: stat?.shotGrammarKey,
              transitionBudgetTier: stat?.transitionBudgetTier,
              transitionBudgetReason: stat?.transitionBudgetReason,
              heroMotionBias: stat?.heroMotionBias,
              heroSpawnRegion: stat?.heroSpawnRegion,
              heroMotifProfile: stat?.heroMotifProfile,
              motifInfluenceKey: stat?.motifInfluenceKey,
              edgeAttractionScale: stat ? stat.edgeAttractionScaleSum / Math.max(1, stat.frameCount) : undefined,
              transitionMotionGrammar: stat?.transitionMotionGrammar,
              negativeSpaceOccupancy: stat ? stat.negativeSpaceOccupancySum / Math.max(1, stat.frameCount) : undefined,
              supportCoverage: stat ? stat.supportCoverageSum / Math.max(1, stat.frameCount) : undefined,
              transitionAvgDurationFrames: stat ? stat.transitionDurationFrameSum / Math.max(1, stat.frameCount) : undefined,
              transitionCarryStrength: stat ? stat.transitionCarryStrengthSum / Math.max(1, stat.frameCount) : undefined,
              transitionCarryMode: stat?.transitionCarryMode,
              transitionCarryAvailabilityScore: stat ? stat.transitionCarryAvailabilityScoreSum / Math.max(1, stat.frameCount) : undefined,
              transitionCarryFallbackReason: stat?.transitionCarryFallbackReason,
              diagnosticCompleteness: stat ? (stat.diagnosticCompleteness ?? "complete") : "missing-stats",
              diagnosticMissingFields: stat?.diagnosticMissingFields ?? (!stat ? ["windowStat"] : undefined),
              diagnosticFailureReason: stat?.diagnosticFailureReason ?? (!stat ? statSelection.failureReason : undefined),
              effectVisibleFrameRatio: stat ? stat.effectVisibleFrameRatioSum / Math.max(1, stat.frameCount) : undefined,
              effectVisiblePixelRatioAvg: stat ? stat.effectVisiblePixelRatioAvgSum / Math.max(1, stat.frameCount) : undefined,
              effectLuminanceDeltaAvg: stat ? stat.effectLuminanceDeltaAvgSum / Math.max(1, stat.frameCount) : undefined,
              effectMotionDeltaAvg: stat ? stat.effectMotionDeltaAvgSum / Math.max(1, stat.frameCount) : undefined,
              overlayOpacityAvg: stat ? stat.overlayOpacityAvgSum / Math.max(1, stat.frameCount) : undefined,
              overlayCompositeMode: stat?.overlayCompositeMode,
              effectVisibilityScore: stat ? stat.effectVisibilityScoreSum / Math.max(1, stat.frameCount) : undefined,
              particleSpawnRequests: stat ? stat.particleSpawnRequestsSum / Math.max(1, stat.frameCount) : undefined,
              particleRenderedCount: stat ? stat.particleRenderedCountSum / Math.max(1, stat.frameCount) : undefined,
              particleCulledByLayerCap: stat ? stat.particleCulledByLayerCapSum / Math.max(1, stat.frameCount) : undefined,
              particleCulledByHeroProtection: stat ? stat.particleCulledByHeroProtectionSum / Math.max(1, stat.frameCount) : undefined,
              particleCulledByNegativeSpace: stat ? stat.particleCulledByNegativeSpaceSum / Math.max(1, stat.frameCount) : undefined,
              particleCulledByImageProgress: stat ? stat.particleCulledByImageProgressSum / Math.max(1, stat.frameCount) : undefined,
              particleCulledBySkipNonHero: stat ? stat.particleCulledBySkipNonHeroSum / Math.max(1, stat.frameCount) : undefined,
              particleOffscreenCount: stat ? stat.particleOffscreenCountSum / Math.max(1, stat.frameCount) : undefined,
              particleTooSmallToReadCount: stat ? stat.particleTooSmallToReadCountSum / Math.max(1, stat.frameCount) : undefined,
              particleLowAlphaCount: stat ? stat.particleLowAlphaCountSum / Math.max(1, stat.frameCount) : undefined,
              particleLowContrastCount: stat ? stat.particleLowContrastCountSum / Math.max(1, stat.frameCount) : undefined,
              particleVisibleCount: stat ? stat.particleVisibleCountSum / Math.max(1, stat.frameCount) : undefined,
              particleVisibleRatio: stat
                ? stat.particleVisibleCountSum / Math.max(1, stat.particleRenderedCountSum)
                : undefined,
              heroParticleRenderedCount: stat ? stat.heroParticleRenderedCountSum / Math.max(1, stat.frameCount) : undefined,
              supportParticleRenderedCount: stat ? stat.supportParticleRenderedCountSum / Math.max(1, stat.frameCount) : undefined,
              backgroundParticleRenderedCount: stat ? stat.backgroundParticleRenderedCountSum / Math.max(1, stat.frameCount) : undefined,
              subEmitterTriggerCount: stat ? stat.subEmitterTriggerCountSum / Math.max(1, stat.frameCount) : undefined,
              subEmitterChildSpawnedCount: stat ? stat.subEmitterChildSpawnedCountSum / Math.max(1, stat.frameCount) : undefined,
              edgeDeathEligibleCount: stat ? stat.edgeDeathEligibleCountSum / Math.max(1, stat.frameCount) : undefined,
              edgeDeathTriggeredCount: stat ? stat.edgeDeathTriggeredCountSum / Math.max(1, stat.frameCount) : undefined,
              edgeDeathPlayedCount: stat ? stat.edgeDeathPlayedCountSum / Math.max(1, stat.frameCount) : undefined,
              edgeDeathSkippedByCostCount: stat ? stat.edgeDeathSkippedByCostCountSum / Math.max(1, stat.frameCount) : undefined,
              edgeDeathEffectId: stat ? [...stat.edgeDeathEffectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined,
              edgeDeathCostTier: stat ? [...stat.edgeDeathCostTierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as import("./types").RenderImageWindowStat["edgeDeathCostTier"] : undefined,
              edgeExitFramesAvg: stat ? stat.edgeExitFramesAvgSum / Math.max(1, stat.frameCount) : undefined,
              edgeExitDistanceAvg: stat ? stat.edgeExitDistanceAvgSum / Math.max(1, stat.frameCount) : undefined,
              compositionMode: stat?.compositionMode,
              nodeIntent: stat?.nodeIntent,
              episodeIntent: stat?.episodeIntent,
              heroArchetype: stat?.heroArchetype,
              heroStoryBeat: stat?.heroStoryBeat,
              heroEmissionMode: stat?.heroEmissionMode,
              subEmitterMode: stat?.subEmitterMode,
              heroPrimitive: stat?.heroPrimitive,
              heroShellMode: stat?.heroShellMode,
              heroBaseShellMode: stat?.heroBaseShellMode,
              heroResolvedShellMode: stat?.heroResolvedShellMode,
              heroCircleShellEligible: stat?.heroCircleShellEligible,
              heroCircleShellPromoted: stat?.heroCircleShellPromoted,
              shapePlacementScore: stat ? stat.shapePlacementScoreSum / Math.max(1, stat.frameCount) : undefined,
              suspiciousNearBlack: blackFrameRatio !== undefined ? blackFrameRatio > 0.2 || (stat?.minLuminance ?? 1) < 0.02 : false,
            };
          }));
        } catch (error) {
          debugReportError = error;
          emitStageStatus("debug-report", "warning", `effects skipped error=\"${summarizeError(error)}\"`);
        }
        const incompleteDiagnosticWindows = report.effects.filter((effect) => effect.diagnosticCompleteness === "missing-stats").length;
        if (incompleteDiagnosticWindows > 0) {
          emitStageStatus("debug-report", "warning", `incompleteWindows=${incompleteDiagnosticWindows}`);
        }
      }
      reportToWrite = report;
    }

    const cleanupResult = await cleanupTemp(resolvedPaths.tempDir);
    cleanupWarning = cleanupResult;
    if (!cleanupResult.ok) {
      const lockedPath = cleanupResult.finalPath ?? cleanupResult.tempDir;
      const message = `path=${lockedPath} code=${cleanupResult.errorCode ?? "unknown"}`;
      if (completedSuccessfully) {
        emitStageStatus("cleanup", "warning", message);
      } else if (primaryError instanceof Error) {
        primaryError.message = `${primaryError.message}\nWarning: temp cleanup deferred for locked workspace: ${lockedPath} (${cleanupResult.errorCode ?? "unknown"})`;
      }
    } else {
      emitStageStatus(
        "cleanup",
        "ok",
        `attempts=${cleanupResult.attempts}${cleanupResult.renamed ? " renamed=yes" : ""}${cleanupResult.skipped ? " skipped=yes" : ""}`,
      );
    }

    if (options.debug && reportToWrite) {
      reportToWrite.cleanup = cleanupWarning;
      try {
        await writeDebugReport(reportToWrite);
        emitStageStatus("debug-report", "ok", `path=${path.join(debugDir, "output.txt")}`);
      } catch (error) {
        debugReportError = debugReportError ?? error;
        const fallback = [
          "AI Video Debug Report",
          "",
          `Run status: ${reportToWrite.runStatus}`,
          `Output: ${reportToWrite.outputPath}`,
          `Failure stage: ${reportToWrite.failureStage ?? "(none)"}`,
          `Failure message: ${reportToWrite.failureMessage ?? "(none)"}`,
          `Last completed stage: ${reportToWrite.lastCompletedStage ?? "(none)"}`,
          `Cleanup: ${reportToWrite.cleanup?.ok ? "ok" : "failed"}`,
          `Cleanup path: ${reportToWrite.cleanup?.finalPath ?? reportToWrite.cleanup?.tempDir ?? "(none)"}`,
          `Stage timings recorded: ${reportToWrite.stageTimings.length}`,
          `Render chunks recorded: ${reportToWrite.renderChunks.length}`,
        ].join("\n");
        await writeFile(path.join(debugDir, "output.txt"), `${fallback}\n`, "utf8");
        emitStageStatus("debug-report", "warning", `fallback path=${path.join(debugDir, "output.txt")} error=\"${summarizeError(error)}\"`);
      }
    }
  }

  if (completedSuccessfully) {
    progress.complete(`STATUS run ok output=${resolvedPaths.outputPath}`);
  }
  if (primaryError) {
    throw primaryError;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const handled = Boolean(error && typeof error === "object" && "cliHandled" in error && (error as { cliHandled?: boolean }).cliHandled);
    if (!handled) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    }
    process.exit(1);
  });
}
/* c8 ignore stop */
