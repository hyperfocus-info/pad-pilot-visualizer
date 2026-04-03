import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type {
  AudioFrameFeature,
  AudioSegmentFeature,
  DiagnosticOverrides,
  EdgeMap,
  RenderChunkJob,
  RenderChunkStat,
  RenderSettings,
  RenderWorkerControlMessage,
  RenderWorkerDoneMessage,
  RenderWorkerMessage,
  RenderWorkerPayload,
  RenderWorkerProgressMessage,
  VisualPhrasePlan,
} from "../types";
import { buildVisualPhraseLookup } from "./visual-plan";

export const RENDER_CHUNK_SECONDS = 12;

export function targetChunkSeconds(totalFrames: number, fps: number): number {
  const durationSec = totalFrames / Math.max(1, fps);
  if (durationSec <= 12) {
    return durationSec;
  }
  if (durationSec <= 24) {
    return 12;
  }
  if (durationSec <= 60) {
    return 10;
  }
  if (durationSec <= 90) {
    return 7;
  }
  return 5;
}

export function recommendedWorkerCount(durationSec: number, totalFrames: number, fps: number, jobCount: number): number {
  const maxParallel = Math.max(1, Math.min(os.availableParallelism() - 1, 7));
  if (durationSec <= 15) {
    return 1;
  }
  if (durationSec <= 35) {
    return Math.min(2, jobCount);
  }
  if (durationSec <= 60) {
    return Math.min(3, jobCount);
  }
  const base = Math.max(1, Math.min(maxParallel, Math.ceil(totalFrames / (fps * 9.5))));
  return Math.min(jobCount, durationSec > 90 ? Math.min(maxParallel, base + 1) : base);
}

export function resolveWorkerCount(durationSec: number, totalFrames: number, fps: number, jobCount: number, workerCountOverride?: number): number {
  if (workerCountOverride !== undefined) {
    return Math.max(1, Math.min(jobCount, workerCountOverride));
  }
  return recommendedWorkerCount(durationSec, totalFrames, fps, jobCount);
}

function transitionRiskMultiplier(transitionFamily: VisualPhrasePlan["transitionFamily"]): number {
  switch (transitionFamily) {
    case "fragment":
    case "phase-lattice":
    case "orbital-shear":
    case "ribbon-fold":
    case "crash-zoom":
    case "roll-sway":
    case "acid-fold":
    case "liquid-lens":
    case "chroma-smear":
      return 1.3;
    case "melt-safe":
    case "spiral-carry":
    case "axis-swap":
    case "dolly-in":
    case "dolly-out":
    case "whip-pan-x":
    case "whip-pan-y":
    case "handheld-lurch":
    case "snap-zoom-out":
    case "parallax-slide":
    case "tilt-reframe":
    case "solarize-drift":
    case "afterimage-wheel":
    case "mandala-pulse":
    case "ink-melt":
      return 1.2;
    case "compress":
    case "flash":
    case "wipe":
    case "chorus-drift":
      return 1.1;
    case "strobe-bloom":
    case "trip-kaleido":
    case "fractal-tunnel":
      return 1.4;
    case "carry":
    default:
      return 1;
  }
}

function regimeRiskMultiplier(regime: VisualPhrasePlan["regime"]): number {
  switch (regime) {
    case "drop":
      return 1.35;
    case "build":
      return 1.25;
    case "breakdown":
      return 1.15;
    case "outro":
      return 1.08;
    case "intro":
      return 1.02;
    case "groove":
    default:
      return 1;
  }
}

function effectRiskMultiplier(effectPolicy: VisualPhrasePlan["effectPolicy"]): number {
  switch (effectPolicy) {
    case "aggressive":
      return 1.25;
    case "balanced":
      return 1.1;
    case "safe":
    default:
      return 0.95;
  }
}

export function partitionChunkJobsForWorkers(jobs: RenderChunkJob[], workerCount: number): RenderChunkJob[][] {
  const laneCount = Math.max(1, Math.min(workerCount, jobs.length));
  const lanes = Array.from({ length: laneCount }, () => [] as RenderChunkJob[]);
  const totalCost = jobs.reduce((sum, job) => sum + job.estimatedCost, 0);
  const targetCostPerLane = totalCost / laneCount;
  let laneIndex = 0;
  let laneCost = 0;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    const remainingJobs = jobs.length - index;
    const remainingLanes = laneCount - laneIndex;
    if (
      laneIndex < laneCount - 1 &&
      lanes[laneIndex]!.length > 0 &&
      laneCost + job.estimatedCost > targetCostPerLane &&
      remainingJobs > remainingLanes
    ) {
      laneIndex += 1;
      laneCost = 0;
    }
    lanes[laneIndex]!.push(job);
    laneCost += job.estimatedCost;
  }
  return lanes;
}

function createChunkJobs(params: {
  frames: AudioFrameFeature[];
  fps: number;
  edgeMaps: EdgeMap[];
  visualPlan: VisualPhrasePlan[];
  phraseLookup: Uint16Array;
  secondsPerImage: number;
  videoDir: string;
}): RenderChunkJob[] {
  const targetFramesPerChunk = Math.max(params.fps * 4, Math.round(params.fps * targetChunkSeconds(params.frames.length, params.fps)));
  const jobs: RenderChunkJob[] = [];
  let chunkComplexity = 0;
  let start = 0;
  for (let index = 0; index < params.frames.length; index += 1) {
    const frame = params.frames[index]!;
    const imageIndex = Math.min(Math.floor(frame.timeSec / params.secondsPerImage), Math.max(0, params.edgeMaps.length - 1));
    const edgeComplexity = params.edgeMaps[imageIndex]?.complexity ?? 0.4;
    const visualState = params.visualPlan[params.phraseLookup[frame.frameIndex] ?? 0];
    const phraseBoost = visualState ? 0.85 + visualState.peakiness * 0.35 + visualState.densityCap * 0.2 : 1;
    const transitionBoost = visualState ? transitionRiskMultiplier(visualState.transitionFamily) : 1;
    const effectBoost = visualState ? effectRiskMultiplier(visualState.effectPolicy) : 1;
    const regimeBoost = visualState ? regimeRiskMultiplier(visualState.regime) : 1;
    chunkComplexity += edgeComplexity * phraseBoost * transitionBoost * effectBoost * regimeBoost;
    const frameCount = index - start + 1;
    const complexityTarget = targetFramesPerChunk * 0.7;
    const shouldSplit =
      frameCount >= targetFramesPerChunk ||
      (frameCount >= params.fps * 4 && chunkComplexity >= complexityTarget) ||
      index + 1 === params.frames.length;
    if (!shouldSplit) {
      continue;
    }
    const chunkIndex = jobs.length;
    const outputPath = path.join(params.videoDir, `chunk-${String(chunkIndex).padStart(4, "0")}.mp4`);
    jobs.push({
      chunkIndex,
      outputPath,
      frames: params.frames.slice(start, index + 1),
      estimatedCost: chunkComplexity,
    });
    start = index + 1;
    chunkComplexity = 0;
  }
  return jobs;
}

function createWorkerPayload(params: {
  ffmpegPath: string;
  settings: RenderSettings;
  bpm: number;
  beatOriginSec?: number;
  disableNebula?: boolean;
  fast?: boolean;
  themeQuery?: string;
  edgeMaps: EdgeMap[];
  segments: AudioSegmentFeature[];
  secondsPerImage: number;
  visualPlan: VisualPhrasePlan[];
  trackAverageDbOverall?: number;
  diagnosticOverrides?: DiagnosticOverrides;
}): RenderWorkerPayload {
  return {
    ffmpegPath: params.ffmpegPath,
    settings: params.settings,
    bpm: params.bpm,
    beatOriginSec: params.beatOriginSec,
    disableNebula: params.disableNebula,
    fast: params.fast,
    themeQuery: params.themeQuery,
    edgeMaps: params.edgeMaps,
    segments: params.segments,
    secondsPerImage: params.secondsPerImage,
    visualPlan: params.visualPlan,
    trackAverageDbOverall: params.trackAverageDbOverall,
    diagnosticOverrides: params.diagnosticOverrides,
    telemetryMode: params.diagnosticOverrides?.telemetryMode,
  };
}

function runChunkOnWorker(params: {
  worker: Worker;
  configuredWorkerCount: number;
  job: RenderChunkJob;
  progressByChunk: Map<number, number>;
  onProgress?: (current: number, total: number) => void;
  totalFrames: number;
  getCompletedFrames: () => number;
  setCompletedFrames: (value: number) => void;
}): Promise<RenderChunkStat> {
  return new Promise<RenderChunkStat>((resolve, reject) => {
    const handleMessage = (message: RenderWorkerMessage) => {
      if (message.type === "progress") {
        const progress = message as RenderWorkerProgressMessage;
        if (progress.chunkIndex !== params.job.chunkIndex) {
          return;
        }
        const previous = params.progressByChunk.get(progress.chunkIndex) ?? 0;
        if (progress.renderedFrames > previous) {
          params.progressByChunk.set(progress.chunkIndex, progress.renderedFrames);
          params.setCompletedFrames(params.getCompletedFrames() + progress.renderedFrames - previous);
          params.onProgress?.(params.getCompletedFrames(), params.totalFrames);
        }
        return;
      }

      const done = message as RenderWorkerDoneMessage;
      if (done.chunkIndex !== params.job.chunkIndex) {
        return;
      }
      cleanup();
      resolve({
        chunkIndex: done.chunkIndex,
        frameCount: done.frameCount,
        elapsedMs: done.elapsedMs,
        averageMsPerFrame: done.elapsedMs / Math.max(1, done.frameCount),
        outputPath: done.outputPath,
        workerInitMs: done.workerInitMs,
        rendererConstructionMs: done.rendererConstructionMs,
        firstFrameLatencyMs: done.firstFrameLatencyMs,
        jobQueueWaitMs: done.jobQueueWaitMs,
        renderCpuMs: done.renderCpuMs,
        encodeWaitMs: done.encodeWaitMs,
        stdinBackpressureMs: done.stdinBackpressureMs,
        encoderDrainWaitMs: done.encoderDrainWaitMs,
        budgetDowngradeCount: done.budgetDowngradeCount,
        configuredWorkerCount: params.configuredWorkerCount,
        averageStageMetrics: done.averageStageMetrics,
        averageLuminance: done.averageLuminance,
        minLuminance: done.minLuminance,
        blackFrameCount: done.blackFrameCount,
        imageWindows: done.imageWindows,
      });
    };

    const handleError = (error: unknown) => {
      cleanup();
      reject(error);
    };

    const handleExit = (code: number) => {
      cleanup();
      reject(new Error(`Render worker exited with code ${code}`));
    };

    const cleanup = () => {
      params.worker.off("message", handleMessage);
      params.worker.off("error", handleError);
      params.worker.off("exit", handleExit);
    };

    params.worker.on("message", handleMessage);
    params.worker.once("error", handleError);
    params.worker.once("exit", handleExit);
    const message: RenderWorkerControlMessage = {
      type: "render",
      chunk: params.job,
      dispatchedAtMs: performance.timeOrigin + performance.now(),
    };
    params.worker.postMessage(message);
  });
}

export async function renderVideoChunks(params: {
  ffmpegPath: string;
  settings: RenderSettings;
  bpm: number;
  beatOriginSec?: number;
  disableNebula?: boolean;
  fast?: boolean;
  themeQuery?: string;
  frames: AudioFrameFeature[];
  edgeMaps: EdgeMap[];
  segments: AudioSegmentFeature[];
  secondsPerImage: number;
  visualPlan: VisualPhrasePlan[];
  videoDir: string;
  workerCountOverride?: number;
  diagnosticOverrides?: DiagnosticOverrides;
  onProgress?: (current: number, total: number) => void;
  onChunkComplete?: (chunk: RenderChunkStat) => void;
}): Promise<string[]> {
  const jobs = createChunkJobs({
    frames: params.frames,
    fps: params.settings.fps,
    edgeMaps: params.edgeMaps,
    visualPlan: params.visualPlan,
    phraseLookup: buildVisualPhraseLookup(params.frames.length, params.visualPlan),
    secondsPerImage: params.secondsPerImage,
    videoDir: params.videoDir,
  });
  if (jobs.length === 0) {
    return [];
  }

  const durationSec = params.frames.length / Math.max(1, params.settings.fps);
  const workerCount = resolveWorkerCount(durationSec, params.frames.length, params.settings.fps, jobs.length, params.workerCountOverride);
  const workers = Array.from({ length: workerCount }, () =>
    new Worker(new URL("./render-worker.ts", import.meta.url), {
      workerData: createWorkerPayload({
        ffmpegPath: params.ffmpegPath,
        settings: params.settings,
        bpm: params.bpm,
        beatOriginSec: params.beatOriginSec,
        disableNebula: params.disableNebula,
        fast: params.fast,
        themeQuery: params.themeQuery,
        edgeMaps: params.edgeMaps,
        segments: params.segments,
        secondsPerImage: params.secondsPerImage,
        visualPlan: params.visualPlan,
        trackAverageDbOverall: params.frames.reduce((sum, frame) => sum + frame.dbOverall, 0) / Math.max(1, params.frames.length),
        diagnosticOverrides: params.diagnosticOverrides,
      }),
    }),
  );
  const outputs = new Array<string>(jobs.length);
  const progressByChunk = new Map<number, number>();
  const totalFrames = params.frames.length;
  let completedFrames = 0;
  const jobLanes = partitionChunkJobsForWorkers(jobs, workerCount);

  let chunkFailure: unknown;
  try {
    await Promise.all(
      workers.map(async (worker, workerIndex) => {
        const lane = jobLanes[workerIndex] ?? [];
        for (const job of lane) {
          const stat = await runChunkOnWorker({
            worker,
            configuredWorkerCount: workerCount,
            job,
            progressByChunk,
            onProgress: params.onProgress,
            totalFrames,
            getCompletedFrames: () => completedFrames,
            setCompletedFrames: (value) => {
              completedFrames = value;
            },
          });
          outputs[stat.chunkIndex] = stat.outputPath;
          params.onChunkComplete?.(stat);
        }
      }),
    );
  } catch (error) {
    chunkFailure = error;
  }

  if (chunkFailure) {
    throw chunkFailure;
  }

  if (outputs.some((outputPath) => !outputPath)) {
    throw new Error("One or more render chunks did not produce an output path.");
  }
  for (const worker of workers) {
    worker.unref();
  }
  return outputs;
}
