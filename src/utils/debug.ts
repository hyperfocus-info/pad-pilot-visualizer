import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { DebugReport, StageTiming } from "../types";

function formatMs(elapsedMs: number): string {
  return `${elapsedMs.toFixed(1)} ms`;
}

function formatMaybeNumber(value: number | undefined, digits = 3): string {
  return value === undefined ? "(n/a)" : value.toFixed(digits);
}

function formatMaybeBpm(value: number | undefined): string {
  return value === undefined ? "(none)" : Number(value.toFixed(3)).toString();
}

function formatMaybeInt(value: number | undefined): string {
  return value === undefined ? "(n/a)" : String(value);
}

function yesNo(value: boolean | undefined): string {
  return value === undefined ? "(n/a)" : value ? "yes" : "no";
}

function buildWarningFlags(effect: DebugReport["effects"][number]): string[] {
  const warnings: string[] = [];
  if ((effect.centerBiasScore ?? 0) >= 0.62 && (effect.supportNearHeroScore ?? 1) <= 0.28) {
    warnings.push("center-bias-high-and-support-low");
  }
  if ((effect.edgeHighlightPenalty ?? 0) >= 0.48 && (effect.focalReinforcementScore ?? 1) <= 0.3) {
    warnings.push("edge-highlight-dominates-focal");
  }
  if ((effect.heldTransitionRatio ?? 0) >= 0.88 && (effect.eventDensity ?? 1) <= 0.42) {
    warnings.push("held-too-long-with-low-event-density");
  }
  if ((effect.audioTransitionScore ?? 0) >= 1.4 && effect.transitionTriggerMode === "hold") {
    warnings.push("high-audio-score-but-swap-not-triggered");
  }
  const recoveryMode = effect.recoveryMode ?? effect.fallbackRenderMode;
  if (effect.visibleFallbackRisk && recoveryMode === "fallback-composed") {
    warnings.push("fallback-frame-visible-risk");
  }
  if (effect.backgroundElementId && !effect.backgroundElementFamily) {
    warnings.push("background-plan-present-but-not-reported");
  }
  if ((effect.particleRenderedCount ?? 0) >= 8 && (effect.particleVisibleRatio ?? 1) <= 0.35) {
    warnings.push("particle-count-high-but-visible-ratio-low");
  }
  if (effect.heroShellSceneEnabled === false && (effect.heroShellUnderlayActiveRatio ?? 0) > 0.01) {
    warnings.push("shell-rendered-while-disabled");
  }
  if (effect.heroShellSceneEnabled && (effect.heroShellTriggerRateLow ?? 0) <= 0 && (effect.heroShellUnderlayActiveRatio ?? 0) > 0.01) {
    warnings.push("shell-not-low-band-driven");
  }
  if ((effect.heroCoverage ?? 1) <= 0.06 && effect.averageLuminance !== undefined && effect.averageLuminance >= 0.2) {
    warnings.push("hero-too-dim-for-frame-luminance");
  }
  if ((effect.heroInstanceCountResolved ?? 1) > 1 && effect.heroSeparationReadable === false) {
    warnings.push("multi-hero-overlap");
  }
  if ((effect.heroRelationshipResolved === "mirror-x" || effect.heroRelationshipResolved === "mirror-y" || effect.heroRelationshipResolved === "mirror-xy") && effect.heroSeparationFailureReason === "center-collapse") {
    warnings.push("mirror-collapsed-to-center");
  }
  if (effect.heroRelationshipResolved === "independent" && ((effect.heroLaneDiversityScore ?? 1) < 0.55 || effect.heroSeparationFailureReason === "lane-collapse")) {
    warnings.push("independent-lanes-not-distinct");
  }
  if (effect.heroRelationshipResolved !== "cojoined" && effect.heroSeparationFailureReason === "cojoined-intent") {
    warnings.push("cojoined-look-without-cojoined-mode");
  }
  if (effect.suspiciousNearBlack) {
    warnings.push("near-black");
  }
  if (effect.heroMotifChangedOutsideSlot) {
    warnings.push("hero-motif-changed-outside-slot");
  }
  if (effect.heroMotifScheduleMismatch) {
    warnings.push("hero-motif-schedule-mismatch");
  }
  if (effect.motionTierReadable === false || ((effect.motionTier === "glide" || effect.motionTier === "flourish") && (effect.jitterSuppressed ?? false) === false && (effect.heroMotorJitter ?? 0) > 0.075)) {
    warnings.push("motion-tier-collapsed-to-jitter");
  }
  if ((effect.edgePressureActiveFrameRatio ?? 0) > 0.2 && (effect.centerwardEmissionRatio ?? 1) < 0.58) {
    warnings.push("edge-pressure-not-centerward");
  }
  if (effect.recoveryMode && effect.fallbackRenderMode && effect.recoveryMode !== "none" && effect.fallbackRenderMode !== effect.recoveryMode) {
    warnings.push("recovery-mode-mislabeled");
  }
  return warnings;
}

function pushEffectBlock(lines: string[], effect: DebugReport["effects"][number]): void {
  const warnings = buildWarningFlags(effect);
  if (effect.diagnosticCompleteness === "missing-stats") {
    lines.push(
      `#${effect.imageIndex} ${effect.startSec.toFixed(2)}-${effect.endSec.toFixed(2)}s diag=missing-stats reason=${effect.diagnosticFailureReason ?? "unknown"}`,
    );
    lines.push(
      `  fallback: recoveryMode=${effect.recoveryMode ?? effect.fallbackRenderMode ?? "none"} mode=${effect.fallbackRenderMode ?? "none"} reason=${effect.fallbackReason ?? "stat-missing"} compositionReason=${effect.compositionModeReason ?? "normal"} visibleRisk=${yesNo(effect.visibleFallbackRisk)} recovery=${yesNo(effect.recoveryTriggered)} confidence=${effect.maskConfidence ?? "(n/a)"} motif=${effect.sourceMotif ?? effect.motif ?? "(n/a)"} heroMotif=${effect.heroMotifResolved ?? "(n/a)"} particleTelemetry=${yesNo(effect.particleTelemetryAvailable)}`,
    );
    lines.push(
      `  assets: input=${effect.referenceImagePath ?? "(none)"} quarter=${effect.quarterFramePath ?? "(none)"} middle=${effect.middleFramePath ?? "(none)"} threeQuarter=${effect.threeQuarterFramePath ?? "(none)"} requested=${effect.requestedImageIndex ?? "(n/a)"} resolved=${effect.resolvedImageIndex ?? "(n/a)"}`,
    );
    lines.push(
      `  missing: ${effect.diagnosticMissingFields?.join("|") ?? "(unspecified)"} warnings=${warnings.join("|") || "(none)"}`,
    );
    return;
  }

  lines.push(
    `#${effect.imageIndex} ${effect.startSec.toFixed(2)}-${effect.endSec.toFixed(2)}s chunk=${effect.chunkIndex} key=${effect.windowKey ?? "(n/a)"} motif=${effect.sourceMotif ?? effect.motif ?? "(n/a)"} heroMotif=${effect.heroMotifResolved ?? "(n/a)"} warnings=${warnings.join("|") || "(none)"}`,
  );
  lines.push(
    `  window: input=${effect.referenceImagePath ?? "(none)"} quarter=${effect.quarterFramePath ?? "(none)"} middle=${effect.middleFramePath ?? "(none)"} threeQuarter=${effect.threeQuarterFramePath ?? "(none)"} requested=${effect.requestedImageIndex ?? "(n/a)"} resolved=${effect.resolvedImageIndex ?? "(n/a)"} confidence=${effect.maskConfidence ?? "(n/a)"} regime=${effect.visualRegime ?? "(n/a)"} overlay=${effect.overlayMode ?? "(n/a)"}`,
  );
  lines.push(
    `  persistent: id=${effect.persistentMotifId ?? "(n/a)"} label=${effect.persistentMotifLabel ?? "(n/a)"} carry=${formatMaybeNumber(effect.persistentMotifCarryFrames, 1)} changed=${yesNo(effect.persistentMotifChanged)}`,
  );
  lines.push(
    `  cadence: scheduled=${effect.heroMotifScheduled ?? "(n/a)"} resolved=${effect.heroMotifResolved ?? "(n/a)"} slot=${formatMaybeInt(effect.heroMotifSlotIndex)} span=${formatMaybeNumber(effect.heroMotifSlotStartSec, 2)}-${formatMaybeNumber(effect.heroMotifSlotEndSec, 2)} reason=${effect.heroMotifScheduleReason ?? "(n/a)"} boundary=${yesNo(effect.heroMotifChangedOnSlotBoundary)} outside=${yesNo(effect.heroMotifChangedOutsideSlot)} mismatch=${yesNo(effect.heroMotifScheduleMismatch)}`,
  );
  lines.push(
    `  composition: hero=${formatMaybeNumber(effect.heroCoverage)} support=${formatMaybeNumber(effect.supportCoverage)} focal=${formatMaybeNumber(effect.focalOccupancyScore)} centerBias=${formatMaybeNumber(effect.centerBiasScore)} placement=${formatMaybeNumber(effect.shapePlacementScore)} clutter=${formatMaybeNumber(effect.backgroundClutterRatio)} visibility=${formatMaybeNumber(effect.effectVisibilityScore)} quadrants=${effect.focalQuadrant ?? "(n/a)"}/${effect.heroQuadrant ?? "(n/a)"}/${effect.brightestBlobQuadrant ?? "(n/a)"} supportClusters=${formatMaybeInt(effect.supportClusterCount)} supportNearHero=${formatMaybeNumber(effect.supportNearHeroScore)} edgePenalty=${formatMaybeNumber(effect.edgeHighlightPenalty)} deadCenterVoid=${formatMaybeNumber(effect.deadCenterVoidScore)} focalReinforcement=${formatMaybeNumber(effect.focalReinforcementScore)}`,
  );
  lines.push(
    `  fallback: recoveryMode=${effect.recoveryMode ?? effect.fallbackRenderMode ?? "none"} mode=${effect.fallbackRenderMode ?? "none"} reason=${effect.fallbackReason ?? "none"} severity=${effect.fallbackSeverity ?? "none"} triggers=${formatMaybeInt(effect.fallbackTriggerCount)} compositionReason=${effect.compositionModeReason ?? "normal"} visibleRisk=${yesNo(effect.visibleFallbackRisk)} edgeMargin=${formatMaybeNumber(effect.edgeDominanceMargin)}`,
  );
  lines.push(
    `  multi-hero: layout=${effect.heroLayoutFamily ?? "(n/a)"} mode=${effect.heroRelationshipResolved ?? effect.heroRelationshipMode ?? "(n/a)"} class=${effect.heroRelationshipClass ?? "(n/a)"} count=${formatMaybeNumber(effect.heroInstanceCountResolved, 1)} minPx=${formatMaybeNumber(effect.heroPairMinDistancePx, 1)} avgPx=${formatMaybeNumber(effect.heroPairAvgDistancePx, 1)} overlap=${formatMaybeNumber(effect.heroOverlapRatio, 2)} coreOverlap=${formatMaybeNumber(effect.heroCoreOverlapRatio, 2)} glowMerge=${formatMaybeNumber(effect.heroGlowMergeRatio, 2)} laneDiversity=${formatMaybeNumber(effect.heroLaneDiversityScore, 2)} quadrants=${formatMaybeInt(effect.heroDistinctQuadrantCount)} readable=${yesNo(effect.heroSeparationReadable)} failure=${effect.heroSeparationFailureReason ?? "(n/a)"}`,
  );
  lines.push(
    `  background: element=${effect.backgroundElementId ?? "(n/a)"} family=${effect.backgroundElementFamily ?? "(n/a)"} trigger=${effect.backgroundTriggerMode ?? "(n/a)"} interaction=${effect.backgroundInteractionMode ?? "(n/a)"} coupling=${formatMaybeNumber(effect.backgroundHeroCouplingStrength, 2)}/${formatMaybeNumber(effect.backgroundParticleCouplingStrength, 2)} active=${yesNo(effect.backgroundHeroInteractionActive)} fired=${yesNo(effect.backgroundTriggeredThisFrame)} peakColor=${yesNo(effect.backgroundPeakColorEligible)} peakDrive=${formatMaybeNumber(effect.backgroundPeakColorDrive, 2)} colorScale=${formatMaybeNumber(effect.backgroundColorfulnessScale, 2)} lift=${formatMaybeNumber(effect.backgroundLuminosityLiftAvg, 2)} minor=${formatMaybeNumber(effect.backgroundMinorImpactDrive, 2)}`,
  );
  lines.push(
    `  particle-flow: requested=${formatMaybeNumber(effect.particleSpawnRequests, 1)} rendered=${formatMaybeNumber(effect.particleRenderedCount, 1)} visible=${formatMaybeNumber(effect.particleVisibleCount, 1)} visibleRatio=${formatMaybeNumber(effect.particleVisibleRatio, 2)} layerCap=${formatMaybeNumber(effect.particleCulledByLayerCap, 1)} heroProtect=${formatMaybeNumber(effect.particleCulledByHeroProtection, 1)} negSpace=${formatMaybeNumber(effect.particleCulledByNegativeSpace, 1)} imageProgress=${formatMaybeNumber(effect.particleCulledByImageProgress, 1)} skipNonHero=${formatMaybeNumber(effect.particleCulledBySkipNonHero, 1)} offscreen=${formatMaybeNumber(effect.particleOffscreenCount, 1)} tiny=${formatMaybeNumber(effect.particleTooSmallToReadCount, 1)} lowAlpha=${formatMaybeNumber(effect.particleLowAlphaCount, 1)} lowContrast=${formatMaybeNumber(effect.particleLowContrastCount, 1)}`,
  );
  lines.push(
    `  hero: primitive=${effect.heroPrimitive ?? "(n/a)"} variant=${effect.heroInstanceVariant ?? "(n/a)"} motif=${effect.heroMotifProfile ?? "(n/a)"} shell=${effect.heroShellMode ?? "(n/a)"} baseShell=${effect.heroBaseShellMode ?? "(n/a)"} resolvedShell=${effect.heroResolvedShellMode ?? "(n/a)"} circleEligible=${yesNo(effect.heroCircleShellEligible)} circlePromoted=${yesNo(effect.heroCircleShellPromoted)} shellScene=${yesNo(effect.heroShellSceneEnabled)} shellCount=${formatMaybeNumber(effect.heroShellConfiguredCount, 1)} shellColor=${effect.heroShellColorMode ?? "(n/a)"} shellBand=${effect.heroShellActivationDriverBand ?? "(n/a)"} shellActive=${formatMaybeNumber(effect.heroShellActiveCountAvg, 2)} shellRates=${formatMaybeNumber(effect.heroShellTriggerRateLow, 2)}/${formatMaybeNumber(effect.heroShellTriggerRateLowMid, 2)}/${formatMaybeNumber(effect.heroShellTriggerRateLowComposite, 2)} shellThresh=${formatMaybeNumber(effect.heroShellThresholdLowAvg, 2)}/${formatMaybeNumber(effect.heroShellThresholdLowMidAvg, 2)}/${formatMaybeNumber(effect.heroShellThresholdLowCompositeAvg, 2)} legacyRates=${formatMaybeNumber(effect.heroShellTriggerRateHighMid, 2)}/${formatMaybeNumber(effect.heroShellTriggerRateHigh, 2)}/${formatMaybeNumber(effect.heroShellTriggerRateUpper, 2)} subFamily=${effect.heroSubEmitterFamily ?? "(n/a)"} subVariant=${effect.heroSubEmitterVariant ?? "(n/a)"} subAlign=${formatMaybeNumber(effect.heroSubEmitterMotifAlignmentScore, 2)} size=${formatMaybeNumber(effect.heroCoreSize, 1)} speed=${formatMaybeNumber(effect.heroSpeedAvg, 2)}/${formatMaybeNumber(effect.heroSpeedPeak, 2)} childRate=${formatMaybeNumber(effect.heroChildEmissionRate, 2)} burst=${formatMaybeNumber(effect.heroBurstCount, 1)}/${formatMaybeNumber(effect.heroBurstChildren, 1)} emissionBase=${formatMaybeNumber(effect.heroBaselineEmissionScale, 2)} recovery=${formatMaybeNumber(effect.heroZeroDbRecovery, 2)} travel=${formatMaybeNumber(effect.heroTravelGracefulBias, 2)}/${formatMaybeNumber(effect.heroTravelGlitchBias, 2)}`,
  );
  lines.push(
    `  motion: tier=${effect.motionTier ?? "(n/a)"} readable=${yesNo(effect.motionTierReadable)} jump=${yesNo(effect.jumpTriggered)} jitterSuppressed=${yesNo(effect.jitterSuppressed)} flourish=${formatMaybeNumber(effect.flourishStrength, 2)} edgeAim=${formatMaybeNumber(effect.screenEdgeAimBias, 2)} centerBiasDeg=${formatMaybeNumber(effect.streamCenterBiasDegrees, 1)} centerward=${formatMaybeNumber(effect.centerwardEmissionRatio, 2)} edgePressure=${formatMaybeNumber(effect.edgePressureActiveFrameRatio, 2)} burstGate=${formatMaybeNumber(effect.heroBurstGateActiveRatio, 2)} cadenceHits=${formatMaybeNumber(effect.heroBurstCadenceSlotHits, 0)} topQuartile=${formatMaybeNumber(effect.heroBurstTopQuartileRatio, 2)}`,
  );
  lines.push(
    `  shell: hueTravel=${formatMaybeNumber(effect.heroShellHueTravelAvg, 2)} underlayRatio=${formatMaybeNumber(effect.heroShellUnderlayActiveRatio, 2)} reflective=${formatMaybeNumber(effect.reflectiveTransitionCount, 0)}/${formatMaybeNumber(effect.reflectiveTransitionUniqueCount, 0)}`,
  );
  lines.push(
    `  edge-death: eligible=${formatMaybeNumber(effect.edgeDeathEligibleCount, 0)} triggered=${formatMaybeNumber(effect.edgeDeathTriggeredCount, 0)} played=${formatMaybeNumber(effect.edgeDeathPlayedCount, 0)} skipped=${formatMaybeNumber(effect.edgeDeathSkippedByCostCount, 0)} effect=${effect.edgeDeathEffectId ?? "(n/a)"} tier=${effect.edgeDeathCostTier ?? "(n/a)"} exitFrames=${formatMaybeNumber(effect.edgeExitFramesAvg, 2)} exitDistance=${formatMaybeNumber(effect.edgeExitDistanceAvg, 2)}`,
  );
  lines.push(
    `  events: id=${effect.eventSpecId ?? "(n/a)"} label=${effect.eventSpecLabel ?? "(n/a)"} density=${formatMaybeNumber(effect.eventDensity)} emitters=${formatMaybeNumber(effect.emitterUsage, 2)} absorbers=${formatMaybeNumber(effect.absorberUsage, 2)} explosions=${effect.explosionCount ?? 0} trigger=${effect.transitionTriggerMode ?? "(n/a)"} held=${effect.heldTransitionCount ?? 0} swap=${effect.swapTransitionCount ?? 0} heldRatio=${formatMaybeNumber(effect.heldTransitionRatio, 2)} fallback=${effect.fallbackRenderMode ?? "none"} fallbackReason=${effect.fallbackReason ?? "none"} compositionReason=${effect.compositionModeReason ?? "normal"} particleTelemetry=${yesNo(effect.particleTelemetryAvailable)} bpmTrust=${effect.bpmTrustState ?? "(n/a)"} anchorTrust=${effect.anchorTrustState ?? "(n/a)"} visibleFallbackRisk=${yesNo(effect.visibleFallbackRisk)}`,
  );
  lines.push(
    `  transition: family=${effect.transitionFamily ?? "(n/a)"} grammar=${effect.transitionMotionGrammar ?? "(n/a)"} frames=${formatMaybeNumber(effect.transitionAvgDurationFrames, 1)} base=${formatMaybeNumber(effect.transitionBaseDurationFrames, 1)} capped=${formatMaybeNumber(effect.transitionCappedDurationFrames, 1)} lost=${formatMaybeNumber(effect.transitionCapLossFrames, 1)} risk=${formatMaybeNumber(effect.transitionRiskScore, 2)} tier=${effect.transitionBudgetTier ?? "(n/a)"} cap=${effect.transitionCapCategory ?? "(n/a)"} reason=${effect.transitionBudgetReason ?? "(n/a)"} carry=${formatMaybeNumber(effect.transitionCarryStrength, 2)} carryMode=${effect.transitionCarryMode ?? "(n/a)"} carryAvail=${formatMaybeNumber(effect.transitionCarryAvailabilityScore, 2)} carryFallback=${effect.transitionCarryFallbackReason ?? "(n/a)"} db=${formatMaybeNumber(effect.dbTransitionDrive, 2)} band=${formatMaybeNumber(effect.bandWeightedTransitionDrive, 2)} hz=${formatMaybeNumber(effect.hzTransitionDrive, 2)} audio=${formatMaybeNumber(effect.audioTransitionScore, 2)} holdPenalty=${formatMaybeNumber(effect.holdPenalty, 2)} swapPromotedByAudio=${yesNo(effect.swapPromotedByAudio)} audioSwapChance=${formatMaybeNumber(effect.audioSwapPromotionChance, 2)} extraSwapChance=${formatMaybeNumber(effect.audioSwapPromotionExtraChance, 2)} audioSwapNodeCount=${formatMaybeNumber(effect.audioSwapNodeTriggerCount, 0)} heroSwapEligible=${yesNo(effect.heroSwapEligible)} heroSwapSuppressedByGrace=${yesNo(effect.heroSwapSuppressedByGrace)} heroSwapAudioDrive=${formatMaybeNumber(effect.heroSwapAudioDrive, 2)}`,
  );
  lines.push(
    `  recovery: active=${yesNo(effect.recoveryTriggered)} severity=${formatMaybeNumber(effect.recoverySeverityScore)} ratio=${formatMaybeNumber(effect.recoveryOverrideFrameRatio)} raw=${effect.recoveryOverrideFrameCount ?? effect.safetyOverrideCount ?? 0}`,
  );
}

export class DebugCollector {
  private readonly startedAt = performance.now();
  private readonly timings: StageTiming[] = [];

  async measure<T>(name: string, task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      this.timings.push({
        name,
        elapsedMs: performance.now() - startedAt,
      });
    }
  }

  snapshot(): StageTiming[] {
    return [...this.timings];
  }

  totalElapsedMs(): number {
    return performance.now() - this.startedAt;
  }
}

export async function writeDebugReport(report: DebugReport): Promise<void> {
  const lines: string[] = [];
  const debugDir = path.resolve(
    path.join("debug", path.basename(report.outputPath, path.extname(report.outputPath))),
  );
  lines.push("AI Video Debug Report");
  lines.push("");
  lines.push("Summary");
  lines.push(`Run status: ${report.runStatus}`);
  lines.push(`Failure stage: ${report.failureStage ?? "(none)"}`);
  lines.push(`Failure message: ${report.failureMessage ?? "(none)"}`);
  lines.push(`Last completed stage: ${report.lastCompletedStage ?? "(none)"}`);
  lines.push(`Output: ${report.outputPath}`);
  lines.push(`Image debug assets: ${report.imageDebugDir ?? "(none)"}`);
  lines.push(`Total runtime: ${formatMs(report.totalElapsedMs)}`);
  lines.push(`Encoder preset: ${report.encoderPreset}`);
  lines.push(`Fast mode: ${report.fastMode ? "yes" : "no"}`);
  lines.push(`Theme image cache: hits=${report.themeImageCacheHits ?? 0} misses=${report.themeImageCacheMisses ?? 0} remote=${report.themeImageRemoteDownloads ?? 0}`);
  if (report.artifacts) {
    lines.push(`Chunk paths: ${report.artifacts.chunkPaths?.length ?? 0}`);
    lines.push(`Video-only path: ${report.artifacts.videoOnlyPath ?? "(none)"}`);
    lines.push(`Final output exists: ${report.artifacts.finalOutputExists ? "yes" : "no"}`);
    lines.push(`Debug report path: ${report.artifacts.debugReportPath ?? "(none)"}`);
  }
  lines.push("");
  if (report.statusLog?.length) {
    lines.push("Status Log");
    for (const entry of report.statusLog) {
      lines.push(`${entry.stage}: ${entry.status}${entry.message ? ` ${entry.message}` : ""}${entry.elapsedMs !== undefined ? ` (${formatMs(entry.elapsedMs)})` : ""}`);
    }
    lines.push("");
  }
  lines.push("Audio");
  lines.push(`Source audio: ${report.sourceAudioPath}`);
  lines.push(`Trimmed audio: ${report.trimmedAudioPath ?? "(none)"}`);
  lines.push(`Source metadata BPM: ${formatMaybeBpm(report.sourceMetadataBpm)}`);
  lines.push(`Trimmed metadata BPM: ${formatMaybeBpm(report.trimmedMetadataBpm)}`);
  lines.push(`Estimated BPM: ${formatMaybeBpm(report.estimatedBpm)}`);
  lines.push(`Chosen BPM: ${formatMaybeBpm(report.chosenBpm)}`);
  lines.push(`BPM source: ${report.bpmSource}`);
  lines.push(`BPM trust: ${report.bpmTrustState ?? "(n/a)"}`);
  lines.push(`Beat origin sec: ${report.beatOriginSec ?? "(none)"}`);
  lines.push(`Beat origin confidence: ${report.beatOriginConfidence ?? "(none)"}`);
  lines.push(`Beat origin source: ${report.beatOriginSource ?? "(none)"}`);
  lines.push(`Anchor trust: ${report.anchorTrustState ?? "(n/a)"}`);
  lines.push(
    `Anchor search window: ${report.anchorSearchStartSec ?? "(none)"}-${report.anchorSearchEndSec ?? "(none)"}`,
  );
  lines.push(`Anchor candidate count: ${report.anchorCandidateCount ?? 0}`);
  lines.push(`Selected anchor support hits: ${report.anchorSupportHitCount ?? 0}`);
  if (report.anchorTopCandidates?.length) {
    lines.push(
      `Top anchor candidates: ${report.anchorTopCandidates.map((candidate) =>
        `${candidate.timeSec.toFixed(3)}s score=${candidate.score.toFixed(3)} confidence=${candidate.confidence.toFixed(3)} support=${candidate.supportHits}`
      ).join("; ")}`,
    );
  }
  if (report.cleanup) {
    lines.push("");
    lines.push("Cleanup");
    lines.push(`OK: ${report.cleanup.ok ? "yes" : "no"}`);
    lines.push(`Skipped: ${report.cleanup.skipped ? "yes" : "no"}`);
    lines.push(`Attempts: ${report.cleanup.attempts}`);
    lines.push(`Renamed: ${report.cleanup.renamed ? "yes" : "no"}`);
    lines.push(`Temp dir: ${report.cleanup.tempDir}`);
    lines.push(`Final path: ${report.cleanup.finalPath ?? "(none)"}`);
    lines.push(`Error: ${report.cleanup.errorCode ?? "(none)"} ${report.cleanup.errorMessage ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push("Stage Timings");
  for (const timing of report.stageTimings) {
    lines.push(`${timing.name}: ${formatMs(timing.elapsedMs)}`);
  }
  lines.push("");
  lines.push("Render Chunks");
  for (const chunk of report.renderChunks) {
    lines.push(
      `Chunk ${chunk.chunkIndex}: ${chunk.frameCount} frames, ${formatMs(chunk.elapsedMs)}, ${chunk.averageMsPerFrame.toFixed(2)} ms/frame, workerInit=${formatMs(chunk.workerInitMs ?? 0)}, queueWait=${formatMs(chunk.jobQueueWaitMs ?? 0)}, workers=${chunk.configuredWorkerCount ?? 0}, renderCpu=${formatMs(chunk.renderCpuMs ?? 0)}, encodeWait=${formatMs(chunk.encodeWaitMs ?? 0)}, stdinBackpressure=${formatMs(chunk.stdinBackpressureMs ?? 0)}, encoderDrain=${formatMs(chunk.encoderDrainWaitMs ?? 0)}, bg=${formatMs(chunk.averageStageMetrics?.backgroundMs ?? 0)}, particles=${formatMs(chunk.averageStageMetrics?.particlesMs ?? 0)}, occupancy=${formatMs(chunk.averageStageMetrics?.occupancyMs ?? 0)}, atmosphere=${formatMs(chunk.averageStageMetrics?.atmosphereMs ?? 0)}, effects=${formatMs(chunk.averageStageMetrics?.effectsMs ?? 0)}, transition=${formatMs(chunk.averageStageMetrics?.transitionMs ?? 0)}, hero=${formatMs(chunk.averageStageMetrics?.heroMs ?? 0)}, lumReadback=${formatMs(chunk.averageStageMetrics?.luminanceReadbackMs ?? 0)}, lumMode=${chunk.averageStageMetrics?.luminanceReadbackMode ?? "full"}, lumInterval=${chunk.averageStageMetrics?.luminanceReadbackSampleInterval ?? 1}, lumSampled=${chunk.averageStageMetrics?.luminanceReadbackFramesSampled ?? 0}, lumSkipped=${chunk.averageStageMetrics?.luminanceReadbackFramesSkipped ?? 0}, lumSaved=${formatMs(chunk.averageStageMetrics?.luminanceReadbackMsSavedEstimate ?? 0)}, encReadback=${formatMs(chunk.averageStageMetrics?.encoderReadbackMs ?? 0)}, stamps=${chunk.averageStageMetrics?.stampDrawCount?.toFixed(1) ?? 0}, supportStamps=${chunk.averageStageMetrics?.supportStampDrawCount?.toFixed(1) ?? 0}, bgStamps=${chunk.averageStageMetrics?.backgroundStampDrawCount?.toFixed(1) ?? 0}, vectors=${chunk.averageStageMetrics?.vectorDrawCount?.toFixed(1) ?? 0}, occupancyDraws=${chunk.averageStageMetrics?.occupancyDrawCount?.toFixed(1) ?? 0}, heroGlyphs=${chunk.averageStageMetrics?.heroGlyphDrawCount?.toFixed(1) ?? 0}, veils=${chunk.averageStageMetrics?.veilDrawCount?.toFixed(1) ?? 0}, bridges=${chunk.averageStageMetrics?.bridgeDrawCount?.toFixed(1) ?? 0}, localGlow=${chunk.averageStageMetrics?.localGlowDrawCount?.toFixed(1) ?? 0}, gradients=${chunk.averageStageMetrics?.gradientCreateCount?.toFixed(1) ?? 0}, supportMotion=${chunk.averageStageMetrics?.avgSupportMotionPx?.toFixed(2) ?? 0}, bgMotion=${chunk.averageStageMetrics?.avgBackgroundMotionPx?.toFixed(2) ?? 0}, budgetDowngrades=${chunk.budgetDowngradeCount ?? 0}, avgLum=${chunk.averageLuminance?.toFixed(4) ?? "(n/a)"}, minLum=${chunk.minLuminance?.toFixed(4) ?? "(n/a)"}, blackFrames=${chunk.blackFrameCount ?? 0}, ${chunk.outputPath}`,
    );
  }
  lines.push("");
  if (report.effects.length > 0) {
    const incomplete = report.effects.filter((effect) => effect.diagnosticCompleteness === "missing-stats");
    const byTransition = [...report.effects]
      .filter((effect) => effect.transitionAvgDurationFrames !== undefined)
      .sort((a, b) => (b.transitionAvgDurationFrames ?? 0) - (a.transitionAvgDurationFrames ?? 0))
      .slice(0, 5);
    const byHeroParticle = [...report.effects]
      .filter((effect) => effect.heroParticleSizeAvg !== undefined || effect.heroParticleTtlAvg !== undefined)
      .sort((a, b) =>
        (((b.heroParticleSizeAvg ?? 0) * 0.7) + ((b.heroParticleTtlAvg ?? 0) * 0.3)) -
        (((a.heroParticleSizeAvg ?? 0) * 0.7) + ((a.heroParticleTtlAvg ?? 0) * 0.3)))
      .slice(0, 5);
    const bySafety = [...report.effects]
      .filter((effect) => (effect.recoverySeverityScore ?? 0) > 0 || effect.recoveryTriggered)
      .sort((a, b) => ((b.recoverySeverityScore ?? 0) - (a.recoverySeverityScore ?? 0)) || ((b.transitionAvgDurationFrames ?? 0) - (a.transitionAvgDurationFrames ?? 0)))
      .slice(0, 5);
    const byBpmEventMiss = [...report.effects]
      .filter((effect) => effect.eventDensity !== undefined)
      .sort((a, b) => ((a.eventDensity ?? 0) - (b.eventDensity ?? 0)) || ((a.explosionCount ?? 0) - (b.explosionCount ?? 0)))
      .slice(0, 5);
    const byWeakVisibility = [...report.effects]
      .filter((effect) => effect.effectVisibilityScore !== undefined)
      .sort((a, b) => (a.effectVisibilityScore ?? 0) - (b.effectVisibilityScore ?? 0))
      .slice(0, 5);
    const byInvisibleParticles = [...report.effects]
      .filter((effect) => effect.particleRenderedCount !== undefined)
      .sort((a, b) => ((a.particleVisibleRatio ?? 1) - (b.particleVisibleRatio ?? 1)) || ((b.particleRenderedCount ?? 0) - (a.particleRenderedCount ?? 0)))
      .slice(0, 5);
    const byCapLoss = [...report.effects]
      .filter((effect) => effect.transitionCapLossFrames !== undefined)
      .sort((a, b) => (b.transitionCapLossFrames ?? 0) - (a.transitionCapLossFrames ?? 0))
      .slice(0, 5);
    const byHighCostLowVisibility = [...report.renderChunks]
      .filter((chunk) => (chunk.averageStageMetrics?.effectsMs ?? 0) >= 50)
      .sort((a, b) => (b.averageStageMetrics?.effectsMs ?? 0) - (a.averageStageMetrics?.effectsMs ?? 0))
      .slice(0, 5);
    const byStrongVisibility = [...report.effects]
      .filter((effect) => effect.effectVisibilityScore !== undefined)
      .sort((a, b) => (b.effectVisibilityScore ?? 0) - (a.effectVisibilityScore ?? 0))
      .slice(0, 5);
    const multiHeroWindows = report.effects.filter((effect) => (effect.heroInstanceCountResolved ?? 1) > 1);
    const readableMultiHeroWindows = multiHeroWindows.filter((effect) => effect.heroSeparationReadable);
    const mirrorWindows = multiHeroWindows.filter((effect) => ["mirror-x", "mirror-y", "mirror-xy"].includes(effect.heroRelationshipResolved ?? effect.heroRelationshipMode ?? ""));
    const independentWindows = multiHeroWindows.filter((effect) => (effect.heroRelationshipResolved ?? effect.heroRelationshipMode) === "independent");
    if (incomplete.length > 0) {
      lines.push("Incomplete diagnostic windows");
      lines.push(`Count: ${incomplete.length}`);
      lines.push(
        incomplete
          .map((effect) => `#${effect.imageIndex} reason=${effect.diagnosticFailureReason ?? "unknown"} missing=${effect.diagnosticMissingFields?.join("|") ?? "(unspecified)"}`)
          .join("; "),
      );
      lines.push("");
    }
    lines.push("Outliers");
    if (byTransition.length > 0) {
      lines.push(`Longest transitions: ${byTransition.map((effect) => `#${effect.imageIndex} tx=${effect.transitionAvgDurationFrames?.toFixed?.(1) ?? "n/a"} family=${effect.transitionFamily ?? "n/a"} conf=${effect.maskConfidence ?? "n/a"} overlay=${effect.overlayMode ?? "n/a"}`).join("; ")}`);
    }
    if (byHeroParticle.length > 0) {
      lines.push(`Largest hero particles: ${byHeroParticle.map((effect) => `#${effect.imageIndex} size=${effect.heroParticleSizeAvg?.toFixed?.(1) ?? "n/a"} ttl=${effect.heroParticleTtlAvg?.toFixed?.(1) ?? "n/a"} variance=${effect.heroParticleSizeVariance ?? "n/a"} motif=${effect.heroMotifProfile ?? "n/a"}`).join("; ")}`);
    }
    if (bySafety.length > 0) {
      lines.push(`Recovery pressure: ${bySafety.map((effect) => `#${effect.imageIndex} severity=${effect.recoverySeverityScore?.toFixed?.(3) ?? "n/a"} overrideRatio=${effect.recoveryOverrideFrameRatio?.toFixed?.(3) ?? "n/a"} raw=${effect.recoveryOverrideFrameCount ?? effect.safetyOverrideCount ?? 0} recovery=${effect.recoveryTriggered ? "yes" : "no"} minLum=${effect.minLuminance?.toFixed?.(3) ?? "n/a"} conf=${effect.maskConfidence ?? "n/a"}`).join("; ")}`);
    }
    if (byBpmEventMiss.length > 0) {
      lines.push(`Weak BPM event windows: ${byBpmEventMiss.map((effect) => `#${effect.imageIndex} event=${effect.eventDensity?.toFixed?.(3) ?? "n/a"} explosions=${effect.explosionCount ?? 0} emitters=${effect.emitterUsage?.toFixed?.(2) ?? "n/a"} absorbers=${effect.absorberUsage?.toFixed?.(2) ?? "n/a"}`).join("; ")}`);
    }
    if (byWeakVisibility.length > 0) {
      lines.push(`Weak visibility windows: ${byWeakVisibility.map((effect) => `#${effect.imageIndex} score=${effect.effectVisibilityScore?.toFixed?.(3) ?? "n/a"} visibleRatio=${effect.effectVisibleFrameRatio?.toFixed?.(3) ?? "n/a"} overlay=${effect.overlayMode ?? "n/a"} opacity=${effect.overlayOpacityAvg?.toFixed?.(3) ?? "n/a"}`).join("; ")}`);
    }
    const byEdgeDominanceMargin = [...report.effects]
      .filter((effect) => effect.edgeDominanceMargin !== undefined)
      .sort((left, right) => (right.edgeDominanceMargin ?? 0) - (left.edgeDominanceMargin ?? 0))
      .slice(0, 5);
    if (byEdgeDominanceMargin.length > 0) {
      lines.push(`Edge dominance margins: ${byEdgeDominanceMargin.map((effect) => `#${effect.imageIndex} margin=${effect.edgeDominanceMargin?.toFixed?.(3) ?? "n/a"} penalty=${effect.edgeHighlightPenalty?.toFixed?.(3) ?? "n/a"} support=${effect.supportNearHeroScore?.toFixed?.(3) ?? "n/a"}`).join("; ")}`);
    }
    if (byInvisibleParticles.length > 0) {
      lines.push(`Invisible particle windows: ${byInvisibleParticles.map((effect) => `#${effect.imageIndex} rendered=${effect.particleRenderedCount?.toFixed?.(1) ?? "n/a"} visible=${effect.particleVisibleCount?.toFixed?.(1) ?? "n/a"} ratio=${effect.particleVisibleRatio?.toFixed?.(2) ?? "n/a"} layerCap=${effect.particleCulledByLayerCap?.toFixed?.(1) ?? "n/a"} offscreen=${effect.particleOffscreenCount?.toFixed?.(1) ?? "n/a"}`).join("; ")}`);
    }
    if (byCapLoss.length > 0) {
      lines.push(`Most-trimmed transitions: ${byCapLoss.map((effect) => `#${effect.imageIndex} lost=${effect.transitionCapLossFrames?.toFixed?.(1) ?? "n/a"} base=${effect.transitionBaseDurationFrames?.toFixed?.(1) ?? "n/a"} capped=${effect.transitionCappedDurationFrames?.toFixed?.(1) ?? "n/a"} risk=${effect.transitionRiskScore?.toFixed?.(2) ?? "n/a"}`).join("; ")}`);
    }
    if (byHighCostLowVisibility.length > 0) {
      lines.push(`High cost chunks: ${byHighCostLowVisibility.map((chunk) => `#${chunk.chunkIndex} effects=${chunk.averageStageMetrics?.effectsMs?.toFixed?.(1) ?? "n/a"} transition=${chunk.averageStageMetrics?.transitionMs?.toFixed?.(1) ?? "n/a"} avgLum=${chunk.averageLuminance?.toFixed?.(3) ?? "n/a"}`).join("; ")}`);
    }
    if (byStrongVisibility.length > 0) {
      lines.push(`Strongest visible windows: ${byStrongVisibility.map((effect) => `#${effect.imageIndex} score=${effect.effectVisibilityScore?.toFixed?.(3) ?? "n/a"} visibleRatio=${effect.effectVisibleFrameRatio?.toFixed?.(3) ?? "n/a"} overlay=${effect.overlayMode ?? "n/a"} tx=${effect.transitionFamily ?? "n/a"}`).join("; ")}`);
    }
    const visibilityScores = report.effects
      .map((effect) => effect.effectVisibilityScore)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    if (visibilityScores.length > 0) {
      const visibleThreshold = 0.35;
      const median = visibilityScores[Math.floor(visibilityScores.length / 2)] ?? 0;
      const visibleCount = visibilityScores.filter((value) => value >= visibleThreshold).length;
      const highCostChunks = report.renderChunks.filter((chunk) => (chunk.averageStageMetrics?.effectsMs ?? 0) >= 50).length;
      lines.push("");
      lines.push("Effect legibility");
      lines.push(`Visible windows: ${visibleCount}/${visibilityScores.length} (${((visibleCount / Math.max(1, visibilityScores.length)) * 100).toFixed(1)}%) threshold=${visibleThreshold.toFixed(2)}`);
      lines.push(`Median visibility score: ${median.toFixed(3)}`);
      lines.push(`High-cost chunks: ${highCostChunks}/${report.renderChunks.length}`);
      lines.push(`Perceptible read: ${visibleCount > 0 ? "yes" : "no"}`);
    }
    const renderHealth = {
      missingStatsWindows: report.effects.filter((effect) => effect.diagnosticCompleteness === "missing-stats").length,
      fallbackComposedWindows: report.effects.filter((effect) => (effect.recoveryMode ?? effect.fallbackRenderMode) === "fallback-composed").length,
      safetyRecoveryWindows: report.effects.filter((effect) => (effect.recoveryMode ?? effect.fallbackRenderMode) === "safety-recovery").length,
      fallbackReasonCounts: new Map<string, number>(),
      compositionReasonCounts: new Map<string, number>(),
      particleTelemetryAvailableWindows: report.effects.filter((effect) => effect.particleTelemetryAvailable).length,
      visibleFallbackRiskWindows: report.effects.filter((effect) => effect.visibleFallbackRisk).length,
      shellEligibleWindowCount: report.effects.filter((effect) => effect.heroShellSceneEnabled).length,
      shellRenderedWindowCount: report.effects.filter((effect) => (effect.heroShellUnderlayActiveRatio ?? 0) > 0.01).length,
      shellRenderedWhileDisabledCount: report.effects.filter((effect) => effect.heroShellSceneEnabled === false && (effect.heroShellUnderlayActiveRatio ?? 0) > 0.01).length,
      lowBandShellActivationRatio:
        report.effects.reduce((sum, effect) => sum + (effect.heroShellTriggerRateLow ?? 0), 0) / Math.max(1, report.effects.length),
      motionTierReadableWindowCount: report.effects.filter((effect) => effect.motionTierReadable).length,
      centerwardAimReadableWindowCount: report.effects.filter((effect) => (effect.edgePressureActiveFrameRatio ?? 0) > 0.2 && (effect.centerwardEmissionRatio ?? 0) >= 0.58).length,
      highHeldRatioWindows: report.effects.filter((effect) => (effect.heldTransitionRatio ?? 0) >= 0.88).length,
      minimalTransitionWindows: report.effects.filter((effect) => effect.transitionBudgetTier === "minimal").length,
      edgeDominanceWarnings: 0,
      deadCenterVoidWarnings: report.effects.filter((effect) => (effect.deadCenterVoidScore ?? 0) >= 0.55).length,
      lowSupportNearHeroWarnings: report.effects.filter((effect) => (effect.supportNearHeroScore ?? 1) <= 0.28).length,
      highAudioMissedSwapWarnings: report.effects.filter((effect) => (effect.audioTransitionScore ?? 0) >= 1.4 && effect.transitionTriggerMode === "hold").length,
      heroMotifChangedOutsideSlotWarnings: report.effects.filter((effect) => effect.heroMotifChangedOutsideSlot).length,
      heroMotifScheduleMismatchWarnings: report.effects.filter((effect) => effect.heroMotifScheduleMismatch).length,
    };
    const heroMotifCounts = new Map<string, number>();
    const sourceMotifCounts = new Map<string, number>();
    const motionTierCounts = new Map<string, number>();
    const reflectiveTransitionCounts = new Map<string, number>();
    const edgeDeathEffectCounts = new Map<string, number>();
    let shellUnderlayActiveWindows = 0;
    let burstGateActiveWindows = 0;
    let heroMotifChangeCount = 0;
    let heroMotifLongestStreak = 0;
    let heroMotifCurrentStreak = 0;
    let heroMotifPrevious: string | undefined;
    let sourceHeroMismatchCount = 0;
    for (const effect of report.effects) {
      const sourceMotif = effect.sourceMotif ?? effect.motif;
      const heroMotif = effect.heroMotifResolved;
      if (sourceMotif) {
        sourceMotifCounts.set(sourceMotif, (sourceMotifCounts.get(sourceMotif) ?? 0) + 1);
      }
      if (heroMotif) {
        heroMotifCounts.set(heroMotif, (heroMotifCounts.get(heroMotif) ?? 0) + 1);
        if (heroMotifPrevious !== undefined && heroMotifPrevious !== heroMotif) {
          heroMotifChangeCount += 1;
        }
        heroMotifCurrentStreak = heroMotifPrevious === heroMotif ? heroMotifCurrentStreak + 1 : 1;
        heroMotifLongestStreak = Math.max(heroMotifLongestStreak, heroMotifCurrentStreak);
        heroMotifPrevious = heroMotif;
      }
      if (sourceMotif && heroMotif && sourceMotif !== heroMotif) {
        sourceHeroMismatchCount += 1;
      }
      if (effect.motionTier) {
        motionTierCounts.set(effect.motionTier, (motionTierCounts.get(effect.motionTier) ?? 0) + 1);
      }
      if ((effect.reflectiveTransitionCount ?? 0) > 0 && effect.transitionFamily) {
        reflectiveTransitionCounts.set(effect.transitionFamily, (reflectiveTransitionCounts.get(effect.transitionFamily) ?? 0) + 1);
      }
      if (effect.edgeDeathEffectId) {
        edgeDeathEffectCounts.set(effect.edgeDeathEffectId, (edgeDeathEffectCounts.get(effect.edgeDeathEffectId) ?? 0) + 1);
      }
      if ((effect.heroShellUnderlayActiveRatio ?? 0) > 0) {
        shellUnderlayActiveWindows += 1;
      }
      if ((effect.heroBurstGateActiveRatio ?? 0) > 0) {
        burstGateActiveWindows += 1;
      }
    }
    const effectDurationSec = Math.max(1e-6, Math.max(...report.effects.map((effect) => effect.endSec), 0));
    for (const effect of report.effects) {
      const warnings = buildWarningFlags(effect);
      if (warnings.includes("edge-highlight-dominates-focal")) {
        renderHealth.edgeDominanceWarnings += 1;
      }
      const fallbackReason = effect.fallbackReason ?? "none";
      renderHealth.fallbackReasonCounts.set(fallbackReason, (renderHealth.fallbackReasonCounts.get(fallbackReason) ?? 0) + 1);
      const compositionReason = effect.compositionModeReason ?? "normal";
      renderHealth.compositionReasonCounts.set(compositionReason, (renderHealth.compositionReasonCounts.get(compositionReason) ?? 0) + 1);
    }
    lines.push("");
    lines.push("Render Health");
    lines.push(`missingStatsWindows=${renderHealth.missingStatsWindows}`);
    lines.push(`fallbackComposedWindows=${renderHealth.fallbackComposedWindows}`);
    lines.push(`safetyRecoveryWindows=${renderHealth.safetyRecoveryWindows}`);
    lines.push(`shellEligibleWindowCount=${renderHealth.shellEligibleWindowCount}`);
    lines.push(`shellRenderedWindowCount=${renderHealth.shellRenderedWindowCount}`);
    lines.push(`shellRenderedWhileDisabledCount=${renderHealth.shellRenderedWhileDisabledCount}`);
    lines.push(`lowBandShellActivationRatio=${renderHealth.lowBandShellActivationRatio.toFixed(3)}`);
    lines.push(`motionTierReadableWindowCount=${renderHealth.motionTierReadableWindowCount}`);
    lines.push(`centerwardAimReadableWindowCount=${renderHealth.centerwardAimReadableWindowCount}`);
    lines.push(`particleTelemetryAvailableWindows=${renderHealth.particleTelemetryAvailableWindows}`);
    lines.push(`visibleFallbackRiskWindows=${renderHealth.visibleFallbackRiskWindows}`);
    lines.push(`highHeldRatioWindows=${renderHealth.highHeldRatioWindows}`);
    lines.push(`minimalTransitionWindows=${renderHealth.minimalTransitionWindows}`);
    lines.push(`edgeDominanceWarnings=${renderHealth.edgeDominanceWarnings}`);
    lines.push(`deadCenterVoidWarnings=${renderHealth.deadCenterVoidWarnings}`);
    lines.push(`lowSupportNearHeroWarnings=${renderHealth.lowSupportNearHeroWarnings}`);
    lines.push(`highAudioMissedSwapWarnings=${renderHealth.highAudioMissedSwapWarnings}`);
    lines.push(`heroMotifChangedOutsideSlotWarnings=${renderHealth.heroMotifChangedOutsideSlotWarnings}`);
    lines.push(`heroMotifScheduleMismatchWarnings=${renderHealth.heroMotifScheduleMismatchWarnings}`);
    lines.push(`multiHeroWindows=${multiHeroWindows.length}`);
    lines.push(`readableSeparatedMultiHeroWindows=${readableMultiHeroWindows.length}`);
    lines.push(`mirrorBilateralRate=${mirrorWindows.length > 0 ? ((mirrorWindows.filter((effect) => effect.heroSeparationReadable).length / mirrorWindows.length) * 100).toFixed(1) : "0.0"}%`);
    lines.push(`independentLaneSuccessRate=${independentWindows.length > 0 ? ((independentWindows.filter((effect) => (effect.heroLaneDiversityScore ?? 0) >= 0.55 && effect.heroSeparationReadable).length / independentWindows.length) * 100).toFixed(1) : "0.0"}%`);
    lines.push(`fallbackReasonCounts=${[...renderHealth.fallbackReasonCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`compositionReasonCounts=${[...renderHealth.compositionReasonCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`sourceMotifCounts=${[...sourceMotifCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`heroMotifCounts=${[...heroMotifCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`motionTierCounts=${[...motionTierCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`reflectiveTransitionCounts=${[...reflectiveTransitionCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`edgeDeathEffectCounts=${[...edgeDeathEffectCounts.entries()].map(([key, count]) => `${key}:${count}`).join(",")}`);
    lines.push(`shellUnderlayActiveWindows=${shellUnderlayActiveWindows}`);
    lines.push(`burstGateActiveWindows=${burstGateActiveWindows}`);
    lines.push(`heroMotifChangeCount=${heroMotifChangeCount}`);
    lines.push(`heroMotifChangesPerMinute=${((heroMotifChangeCount / effectDurationSec) * 60).toFixed(3)}`);
    lines.push(`heroMotifLongestStreak=${heroMotifLongestStreak}`);
    lines.push(`sourceHeroMismatchRate=${((sourceHeroMismatchCount / Math.max(1, report.effects.length)) * 100).toFixed(1)}%`);
    lines.push("");
  }
  lines.push("Effects");
  for (const effect of report.effects) {
    pushEffectBlock(lines, effect);
  }

  const outputPath = path.join(debugDir, "output.txt");
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}
