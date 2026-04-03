import { parentPort, workerData } from "node:worker_threads";
import { spawnVideoEncoder } from "../media/ffmpeg";
import { FrameRenderer } from "./frame-renderer";
import type { RenderImageWindowStat, RenderWorkerControlMessage, RenderWorkerMessage, RenderWorkerPayload } from "../types";
import { createRenderWindowKey } from "./window-stats";
export {
  accumulateRenderWindowSample,
  createRenderWindowAccumulator,
  finalizeRenderWindowAccumulator,
} from "./window-stats";

const REFLECTIVE_TRANSITION_FAMILIES = new Set<string>([
  "mirror-kaleido",
  "split-mirror",
  "bilateral-iris-fold",
  "mirror-gate-inversion",
  "quad-kaleido-choir",
  "reflection-slit-shatter",
  "prism-fold",
  "prism-axis-lag",
  "shear-kaleido",
  "trip-kaleido",
  "fractal-mirror-shatter",
  "chromatic-mandala-spin",
  "trippy-symmetry-ripple",
  "color-shift-kaleidoscope-burst",
  "mandala-pulse",
  "quadrant-mirror-sweep",
  "micro-quadrant-reflect",
  "centrifugal-hex-mirror",
  "octant-mirror-zoom",
  "mirror-grid-dissolve",
  "kaleido-iris-zoom",
  "kaleido-tunnel-zoom",
  "snowflake-kaleido-bloom",
  "infinite-reflection-zoom",
  "facet-zoom-reveal",
  "tri-prism-fold",
  "hex-prism-cascade",
  "refractive-prism-spin",
  "prismatic-radial-wipe",
  "refractive-shard-tumble",
  "mirror-interlock-weave",
  "corridor-reflection-transit",
  "bilateral-flip-drift",
  "synchronized-mirror-slice",
  "glass-shatter-reflect",
  "diamond-concentric-fold",
  "vortex-mirror-spiral",
  "geometric-fractal-flip",
  "symmetry-spin-reveal",
  "crystal-facet-reveal",
]);

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

/* c8 ignore start */
async function main(): Promise<void> {
  const port = parentPort;
  if (!port) {
    throw new Error("Render worker started without a parent port.");
  }

  const payload = workerData as RenderWorkerPayload;
  const workerStartedAt = performance.now();
  const telemetryMode = payload.telemetryMode ?? payload.diagnosticOverrides?.telemetryMode ?? "summary";
  const fullTelemetry = telemetryMode === "full";
  const collectWindowStats = telemetryMode !== "off";
  const createRenderer = () => new FrameRenderer(
    payload.settings,
    payload.bpm,
    payload.beatOriginSec ?? 0,
    payload.disableNebula ?? false,
    payload.edgeMaps,
    payload.segments,
    { secondsPerImage: payload.secondsPerImage },
    payload.visualPlan,
    payload.trackAverageDbOverall,
    payload.fast ?? false,
    payload.themeQuery,
    payload.diagnosticOverrides,
  );
  const rendererConstructionStartedAt = performance.now();
  let renderer = createRenderer();
  let rendererConstructionMs = performance.now() - rendererConstructionStartedAt;
  const workerInitMs = performance.now() - workerStartedAt;
  let lastRenderedFrameIndex = -1;

  const handleMessage = async (message: RenderWorkerControlMessage): Promise<void> => {
    if (message.type === "shutdown") {
      return;
    }

    const startedAt = performance.now();
    const jobQueueWaitMs = Math.max(0, (performance.timeOrigin + startedAt) - message.dispatchedAtMs);
    const firstChunkFrameIndex = message.chunk.frames[0]?.frameIndex ?? -1;
    if (lastRenderedFrameIndex >= 0 && firstChunkFrameIndex !== lastRenderedFrameIndex + 1) {
      const rendererRebuildStartedAt = performance.now();
      renderer = createRenderer();
      rendererConstructionMs += performance.now() - rendererRebuildStartedAt;
      lastRenderedFrameIndex = -1;
    }
    let renderCpuMs = 0;
    let stdinBackpressureMs = 0;
    let encoderDrainWaitMs = 0;
    let backgroundMs = 0;
    let particlesMs = 0;
    let occupancyMs = 0;
    let atmosphereMs = 0;
    let effectsMs = 0;
    let transitionMs = 0;
    let heroMs = 0;
    let luminanceReadbackMs = 0;
    let luminanceReadbackFramesSampled = 0;
    let luminanceReadbackFramesSkipped = 0;
    let luminanceReadbackMsSavedEstimate = 0;
    let luminanceReadbackMode: "full" | "budget-gated" = payload.fast ? "budget-gated" : "full";
    let luminanceReadbackSampleInterval = payload.fast ? 4 : 1;
    let encoderReadbackMs = 0;
    let stampDrawCount = 0;
    let supportStampDrawCount = 0;
    let backgroundStampDrawCount = 0;
    let vectorDrawCount = 0;
    let occupancyDrawCount = 0;
    let heroGlyphDrawCount = 0;
    let veilDrawCount = 0;
    let bridgeDrawCount = 0;
    let localGlowDrawCount = 0;
    let gradientCreateCount = 0;
    let firstFrameLatencyMs: number | undefined;
    const encoder = spawnVideoEncoder({
      ffmpegPath: payload.ffmpegPath,
      width: payload.settings.width,
      height: payload.settings.height,
      fps: payload.settings.fps,
      outputPath: message.chunk.outputPath,
    });

    const stdin = encoder.stdin;
    if (!stdin) {
      throw new Error("Unable to open ffmpeg stdin in render worker.");
    }

    const stderrPromise = new Response(encoder.stderr).text();
    const subjectMaskCoverageByImage = new Map<number, number>();
    const imageWindowStats = new Map<string, any>();
    let activeWindowFirstFrameIndex = -1;
    let activeWindowRequestedImageIndex = -1;
    let activeWindowResolvedImageIndex = -1;
    let chunkLuminanceSum = 0;
    let chunkMinLuminance = Number.POSITIVE_INFINITY;
    let chunkBlackFrameCount = 0;
    let budgetDowngradeCount = 0;
    for (let index = 0; index < message.chunk.frames.length; index += 1) {
      const currentFrame = message.chunk.frames[index]!;
      const renderStartedAt = performance.now();
      const frame = renderer.renderFrame(currentFrame);
      lastRenderedFrameIndex = currentFrame.frameIndex;
      renderCpuMs += performance.now() - renderStartedAt;
      firstFrameLatencyMs ??= performance.now() - startedAt;
      budgetDowngradeCount += frame.budgetDowngradeCount;
      backgroundMs += frame.stageMetrics?.backgroundMs ?? 0;
      particlesMs += frame.stageMetrics?.particlesMs ?? 0;
      occupancyMs += frame.stageMetrics?.occupancyMs ?? 0;
      atmosphereMs += frame.stageMetrics?.atmosphereMs ?? 0;
      effectsMs += frame.stageMetrics?.effectsMs ?? 0;
      transitionMs += frame.stageMetrics?.transitionMs ?? 0;
      heroMs += frame.stageMetrics?.heroMs ?? 0;
      luminanceReadbackMs += frame.stageMetrics?.luminanceReadbackMs ?? 0;
      luminanceReadbackFramesSampled += frame.stageMetrics?.luminanceReadbackFramesSampled ?? 0;
      luminanceReadbackFramesSkipped += frame.stageMetrics?.luminanceReadbackFramesSkipped ?? 0;
      luminanceReadbackMsSavedEstimate += frame.stageMetrics?.luminanceReadbackMsSavedEstimate ?? 0;
      luminanceReadbackMode = frame.stageMetrics?.luminanceReadbackMode ?? luminanceReadbackMode;
      luminanceReadbackSampleInterval = frame.stageMetrics?.luminanceReadbackSampleInterval ?? luminanceReadbackSampleInterval;
      encoderReadbackMs += frame.stageMetrics?.encoderReadbackMs ?? 0;
      stampDrawCount += frame.stageMetrics?.stampDrawCount ?? 0;
      supportStampDrawCount += frame.stageMetrics?.supportStampDrawCount ?? 0;
      backgroundStampDrawCount += frame.stageMetrics?.backgroundStampDrawCount ?? 0;
      vectorDrawCount += frame.stageMetrics?.vectorDrawCount ?? 0;
      occupancyDrawCount += frame.stageMetrics?.occupancyDrawCount ?? 0;
      heroGlyphDrawCount += frame.stageMetrics?.heroGlyphDrawCount ?? 0;
      veilDrawCount += frame.stageMetrics?.veilDrawCount ?? 0;
      bridgeDrawCount += frame.stageMetrics?.bridgeDrawCount ?? 0;
      localGlowDrawCount += frame.stageMetrics?.localGlowDrawCount ?? 0;
      gradientCreateCount += frame.stageMetrics?.gradientCreateCount ?? 0;
      const visualState = renderer.getLastVisualState();
      const activeSubject = renderer.getLastActiveSubjectSnapshot();
      const safetyMetrics = renderer.getLastSafetyMetrics();
      const luminance = frame.luminanceSample;
      const renderSelection = renderer.getLastRenderSelection();
      const imageIndex = renderSelection.resolvedImageIndex;
      if (collectWindowStats) {
        const windowIdentityChanged =
          renderSelection.requestedImageIndex !== activeWindowRequestedImageIndex ||
          renderSelection.resolvedImageIndex !== activeWindowResolvedImageIndex;
        if (windowIdentityChanged) {
          activeWindowFirstFrameIndex = currentFrame.frameIndex;
          activeWindowRequestedImageIndex = renderSelection.requestedImageIndex;
          activeWindowResolvedImageIndex = renderSelection.resolvedImageIndex;
        }
        const windowKey = createRenderWindowKey({
          chunkIndex: message.chunk.chunkIndex,
          firstFrameIndex: activeWindowFirstFrameIndex,
          requestedImageIndex: renderSelection.requestedImageIndex,
          resolvedImageIndex: renderSelection.resolvedImageIndex,
        }) ?? `${message.chunk.chunkIndex}:${currentFrame.frameIndex}:${renderSelection.requestedImageIndex}:${renderSelection.resolvedImageIndex}`;
        const windowStat: any = imageWindowStats.get(windowKey) ?? {
        imageIndex,
        windowKey,
        chunkIndex: message.chunk.chunkIndex,
        firstFrameIndex: currentFrame.frameIndex,
        startSec: currentFrame.timeSec,
        endSec: currentFrame.timeSec,
        requestedImageIndex: renderSelection.requestedImageIndex,
        resolvedImageIndex: renderSelection.resolvedImageIndex,
        sourceMotif: payload.edgeMaps[imageIndex]?.fractalMotif,
        heroMotifResolved: "",
        heroMotifScheduled: "",
        heroMotifSlotIndex: -1,
        heroMotifSlotStartSec: 0,
        heroMotifSlotEndSec: 0,
        heroMotifScheduleReason: "body-hold",
        heroMotifChangedOnSlotBoundaryCount: 0,
        heroMotifChangedOutsideSlotCount: 0,
        heroMotifScheduleMismatchCount: 0,
        themeImagePath: renderSelection.themeImagePath,
        frameCount: 0,
        luminanceSum: 0,
        darkestQuartileLuminanceSum: 0,
        minLuminance: Number.POSITIVE_INFINITY,
        blackFrameCount: 0,
        dbOverallSum: 0,
        pulseScaleSum: 0,
        subjectMaskCoverage: 0,
        persistentMotifCarryFramesSum: 0,
        persistentMotifChangedCount: 0,
        motifEffectIntensitySum: 0,
        outroEffectIntensitySum: 0,
        outroCoverageEstimateSum: 0,
        outroHeroWarpSum: 0,
        terminalBurstProgressMax: 0,
        heroWarpActiveCount: 0,
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
        heroBaselineEmissionScaleSum: 0,
        heroZeroDbRecoverySum: 0,
        mainHeroLowDbThrottleCount: 0,
        mainHeroFreezeCount: 0,
        heroScalePulseAvgSum: 0,
        heroScalePulsePeakMax: 0,
        motifPotencyScoreSum: 0,
        heldTransitionCount: 0,
        swapTransitionCount: 0,
        transitionTriggerModeCounts: new Map<string, number>(),
        heroShellInnerAlphaSum: 0,
        heroShellOuterAlphaSum: 0,
        heroShellSceneEnabledCount: 0,
        heroShellConfiguredCountSum: 0,
        heroShellActiveCountSum: 0,
        heroShellActivationDriverBand: "low",
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
        heroContrastBowlUsedCount: 0,
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
        heroConductorCountSum: 0,
        heroConductorInfluenceRadiusAvgSum: 0,
        heroCircleEmitterNodeCoverageSum: 0,
        heroExpandedBandCountSum: 0,
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
        audioSwapPromotionChanceSum: 0,
        audioSwapPromotionExtraChanceSum: 0,
        audioSwapNodeTriggerCountMax: 0,
        backgroundHeroCouplingStrengthSum: 0,
        backgroundParticleCouplingStrengthSum: 0,
        backgroundTriggeredFrameCount: 0,
        backgroundHeroInteractionActiveCount: 0,
        backgroundPeakColorEligibleCount: 0,
        backgroundPeakColorDriveSum: 0,
        backgroundColorfulnessScaleSum: 0,
        backgroundLuminosityLiftAvgSum: 0,
        backgroundMinorImpactDriveSum: 0,
        recoveryMode: "none",
        fallbackRenderMode: "none",
        fallbackReason: "none",
        fallbackReasonCounts: new Map<string, number>(),
        fallbackTriggerCountMax: 0,
        fallbackSeverity: "none",
        compositionModeReason: "normal",
        particleTelemetryAvailable: false,
        visibleFallbackRiskCount: 0,
        focalQuadrant: "center",
        heroQuadrant: "center",
        brightestBlobQuadrant: "center",
        quarterSpawnGuaranteeHitCount: 0,
        quarterSpawnGuaranteeMissCount: 0,
      transitionIdentityChangedCount: 0,
      motifChangedOnTransitionCount: 0,
      heroChangedOnTransitionCount: 0,
      heroRelationshipModeCounts: new Map<string, number>(),
      heroRelationshipClassCounts: new Map<string, number>(),
      transitionIdentitySignature: "",
      shotGrammarCounts: new Map<string, number>(),
      focalOccupancyScoreSum: 0,
      centerBiasScoreSum: 0,
      adaptiveDegradeLevelMax: 0,
      transitionBudgetTierCounts: new Map<string, number>(),
      transitionBudgetReason: "",
      edgeAttractionScaleSum: 0,
        negativeSpaceOccupancySum: 0,
        supportCoverageSum: 0,
        transitionDurationFrameSum: 0,
        transitionCarryStrengthSum: 0,
        transitionCarryAvailabilityScoreSum: 0,
        transitionCarryModeCounts: new Map<string, number>(),
        transitionCarryFallbackReasonCounts: new Map<string, number>(),
        safetyOverrideCount: 0,
        recoveryOverrideFrameCount: 0,
        recoveryTriggered: false,
        brightnessFloorSum: 0,
        shapePlacementScoreSum: 0,
        effectVisibleFrameCount: 0,
        effectVisiblePixelRatioSum: 0,
        effectLuminanceDeltaSum: 0,
        effectMotionDeltaSum: 0,
        overlayOpacitySum: 0,
        supportElementDensitySum: 0,
        backgroundElementDensitySum: 0,
        heroIsolationScoreSum: 0,
        nearHeroEventDensitySum: 0,
        heroToSupportDistanceScoreSum: 0,
        transitionBaseDurationFrameSum: 0,
        transitionCappedDurationFrameSum: 0,
        transitionCapLossFrameSum: 0,
        transitionRiskScoreSum: 0,
        transitionCapCategoryCounts: new Map<string, number>(),
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
        overlayCompositeModeCounts: new Map<string, number>(),
        regimeCounts: new Map<string, number>(),
        overlayCounts: new Map<string, number>(),
        transitionCounts: new Map<string, number>(),
        activeModeCounts: new Map<string, number>(),
        compositionModeCounts: new Map<string, number>(),
        };
        windowStat.frameCount += 1;
        windowStat.imageIndex = imageIndex;
        windowStat.windowKey = windowKey;
        windowStat.startSec = Math.min(windowStat.startSec, currentFrame.timeSec);
        windowStat.endSec = Math.max(windowStat.endSec, currentFrame.timeSec);
        windowStat.requestedImageIndex = renderSelection.requestedImageIndex;
        windowStat.resolvedImageIndex = renderSelection.resolvedImageIndex;
        windowStat.sourceMotif = payload.edgeMaps[imageIndex]?.fractalMotif ?? windowStat.sourceMotif;
        windowStat.themeImagePath = renderSelection.themeImagePath;
        windowStat.luminanceSum += luminance;
        windowStat.darkestQuartileLuminanceSum += frame.darkestQuartileLuminance ?? luminance;
        windowStat.minLuminance = Math.min(windowStat.minLuminance, luminance);
        windowStat.dbOverallSum += currentFrame.dbOverall;
        windowStat.pulseScaleSum += currentFrame.pulseScale;
        windowStat.mainHeroLowDbThrottleCount += frame.mainHeroLowDbThrottle ? 1 : 0;
        windowStat.mainHeroFreezeCount += frame.mainHeroFreezeActive ? 1 : 0;
      if (fullTelemetry) {
      let subjectMaskCoverage = subjectMaskCoverageByImage.get(imageIndex);
      if (subjectMaskCoverage === undefined) {
        const subjectMask = payload.edgeMaps[imageIndex]?.subjectMask;
        if (subjectMask) {
          let coverage = 0;
          for (let i = 0; i < subjectMask.values.length; i += 1) {
            coverage += subjectMask.values[i] ?? 0;
          }
          subjectMaskCoverage = coverage / Math.max(1, subjectMask.values.length);
        } else {
          subjectMaskCoverage = 0;
        }
        subjectMaskCoverageByImage.set(imageIndex, subjectMaskCoverage);
      }
      windowStat.subjectMaskCoverage += subjectMaskCoverage;
      windowStat.persistentMotifId = frame.persistentMotifId ?? windowStat.persistentMotifId;
      windowStat.persistentMotifLabel = frame.persistentMotifLabel ?? windowStat.persistentMotifLabel;
      windowStat.persistentMotifCarryFramesSum += frame.persistentMotifCarryFrames ?? 0;
      windowStat.persistentMotifChangedCount += frame.persistentMotifChanged ? 1 : 0;
      windowStat.sceneKey = frame.sceneKey ?? windowStat.sceneKey;
      windowStat.eventSpecId = frame.eventSpecId ?? windowStat.eventSpecId;
      windowStat.eventSpecLabel = frame.eventSpecLabel ?? windowStat.eventSpecLabel;
      windowStat.eventSelectionReason = frame.eventSelectionReason ?? windowStat.eventSelectionReason;
      windowStat.motifEffectId = frame.motifEffectId ?? windowStat.motifEffectId;
      windowStat.motifEffectSelectionReason = frame.motifEffectSelectionReason ?? windowStat.motifEffectSelectionReason;
      windowStat.motifEffectPhenomenon = frame.motifEffectPhenomenon ?? windowStat.motifEffectPhenomenon;
      windowStat.motifEffectAudioMode = frame.motifEffectAudioMode ?? windowStat.motifEffectAudioMode;
      windowStat.motifEffectIntensitySum += frame.motifEffectIntensity ?? 0;
      windowStat.outroEffectId = frame.outroEffectId ?? windowStat.outroEffectId;
      windowStat.outroEffectCategory = frame.outroEffectCategory ?? windowStat.outroEffectCategory;
      windowStat.outroEffectAudioMode = frame.outroEffectAudioMode ?? windowStat.outroEffectAudioMode;
      windowStat.outroEffectIntensitySum += frame.outroEffectIntensity ?? 0;
      windowStat.outroEffectImageSignature = frame.outroEffectImageSignature ?? windowStat.outroEffectImageSignature;
      windowStat.outroCoverageEstimateSum += frame.outroCoverageEstimate ?? 0;
      windowStat.outroHeroWarpSum += frame.outroHeroWarp ?? 0;
      windowStat.terminalBurstProgressMax = Math.max(windowStat.terminalBurstProgressMax, frame.terminalBurstProgress ?? 0);
      windowStat.heroWarpActiveCount += frame.heroWarpActive ? 1 : 0;
      windowStat.brightnessFloorSum += safetyMetrics.brightnessFloor;
      windowStat.activeMotionSum += activeSubject.motionPx;
      windowStat.activeEmphasisSum += activeSubject.emphasis;
      windowStat.supportMotionSum += frame.stageMetrics?.avgSupportMotionPx ?? 0;
      windowStat.backgroundMotionSum += frame.stageMetrics?.avgBackgroundMotionPx ?? 0;
      windowStat.atmosphereDensitySum += renderer.getLastAtmosphereDensity();
      windowStat.midScaleCoverageSum += renderer.getLastMidScaleCoverage();
      windowStat.symmetryUsageSum += renderer.getLastSymmetryUsage();
      windowStat.eventDensitySum += renderer.getLastEventDensity();
      windowStat.emitterUsageSum += renderer.getLastEmitterUsage();
      windowStat.absorberUsageSum += renderer.getLastAbsorberUsage();
      windowStat.explosionCountSum += renderer.getLastExplosionCount();
      windowStat.sourceAffinitySum += renderer.getLastSourceAffinityAvg();
      windowStat.sourceAffinityHeroSum += renderer.getLastSourceAffinityHeroAvg();
      windowStat.sourceAffinitySupportSum += renderer.getLastSourceAffinitySupportAvg();
      windowStat.particleConvergenceScoreSum += renderer.getLastParticleConvergenceScore();
      windowStat.subEmitterChildrenSum += renderer.getLastSubEmitterChildren();
      windowStat.heroEchoCountSum += renderer.getLastHeroEchoCount();
      windowStat.heroGlyphComplexitySum += renderer.getLastHeroGlyphComplexity();
      windowStat.heroSubEmitterCountSum += renderer.getLastHeroSubEmitterCount();
      windowStat.heroCoreSizeSum += renderer.getLastHeroCoreSize();
      windowStat.heroOutlineRatioSum += renderer.getLastHeroOutlineRatio();
      windowStat.heroPrimitiveComplexitySum += renderer.getLastHeroPrimitiveComplexity();
      windowStat.heroChildEmissionRateSum += renderer.getLastHeroChildEmissionRate();
      windowStat.heroChildFieldDensitySum += renderer.getLastHeroChildFieldDensity();
      windowStat.heroChildFieldRadiusSum += renderer.getLastHeroChildFieldRadius();
      windowStat.heroTrailOccupancySum += renderer.getLastHeroTrailOccupancy();
      windowStat.heroWakeLengthPxSum += renderer.getLastHeroWakeLengthPx();
      windowStat.heroBurstCountSum += renderer.getLastHeroBurstCount();
      windowStat.heroBurstChildrenSum += renderer.getLastHeroBurstChildren();
      windowStat.heroMotorJitterSum += renderer.getLastHeroMotorJitter();
      windowStat.heroMotorThrustSum += renderer.getLastHeroMotorThrust();
      windowStat.heroBurnPhaseSum += renderer.getLastHeroBurnPhase();
      windowStat.heroWakeTailAgeAvgSum += renderer.getLastHeroWakeTailAgeAvg();
      windowStat.heroWakeResetCountMax = Math.max(windowStat.heroWakeResetCountMax, renderer.getLastHeroWakeResetCount());
      windowStat.heroSpeedAvgSum += renderer.getLastHeroSpeedAvg();
      windowStat.heroSpeedPeakMax = Math.max(windowStat.heroSpeedPeakMax, renderer.getLastHeroSpeedPeak());
      windowStat.heroBaselineEmissionScaleSum += frame.heroBaselineEmissionScale ?? 0;
      windowStat.heroZeroDbRecoverySum += frame.heroZeroDbRecovery ?? 0;
      windowStat.heroScalePulseAvgSum += renderer.getLastHeroScalePulseAvg();
      windowStat.heroScalePulsePeakMax = Math.max(windowStat.heroScalePulsePeakMax, renderer.getLastHeroScalePulsePeak());
      windowStat.motifPotencyScoreSum += renderer.getLastMotifPotencyScore();
      const transitionTriggerMode = renderer.getLastTransitionTriggerMode();
      windowStat.transitionTriggerModeCounts.set(transitionTriggerMode, (windowStat.transitionTriggerModeCounts.get(transitionTriggerMode) ?? 0) + 1);
      if (transitionTriggerMode === "hold") {
        windowStat.heldTransitionCount += 1;
      } else {
        windowStat.swapTransitionCount += 1;
      }
      windowStat.heroShellInnerAlphaSum += renderer.getLastHeroShellInnerAlpha();
      windowStat.heroShellOuterAlphaSum += renderer.getLastHeroShellOuterAlpha();
      windowStat.heroShellSceneEnabledCount += renderer.getLastHeroShellSceneEnabled() ? 1 : 0;
      windowStat.heroShellConfiguredCountSum += renderer.getLastHeroShellConfiguredCount();
      windowStat.heroShellActiveCountSum += renderer.getLastHeroShellActiveCount();
      windowStat.heroShellActivationDriverBand = renderer.getLastHeroShellActivationDriverBand();
      windowStat.heroShellTriggerRateLowSum += renderer.getLastHeroShellTriggerRateLow();
      windowStat.heroShellTriggerRateLowMidSum += renderer.getLastHeroShellTriggerRateLowMid();
      windowStat.heroShellTriggerRateLowCompositeSum += renderer.getLastHeroShellTriggerRateLowComposite();
      windowStat.heroShellThresholdLowSum += renderer.getLastHeroShellThresholdLow();
      windowStat.heroShellThresholdLowMidSum += renderer.getLastHeroShellThresholdLowMid();
      windowStat.heroShellThresholdLowCompositeSum += renderer.getLastHeroShellThresholdLowComposite();
      windowStat.heroShellTriggerRateHighMidSum += renderer.getLastHeroShellTriggerRateHighMid();
      windowStat.heroShellTriggerRateHighSum += renderer.getLastHeroShellTriggerRateHigh();
      windowStat.heroShellTriggerRateUpperSum += renderer.getLastHeroShellTriggerRateUpper();
      windowStat.heroShellThresholdHighMidSum += renderer.getLastHeroShellThresholdHighMid();
      windowStat.heroShellThresholdHighSum += renderer.getLastHeroShellThresholdHigh();
      windowStat.heroShellThresholdUpperSum += renderer.getLastHeroShellThresholdUpper();
      windowStat.heroBandLowUsageSum += renderer.getLastHeroBandLowUsage();
      windowStat.heroBandMidUsageSum += renderer.getLastHeroBandMidUsage();
      windowStat.heroBandHighUsageSum += renderer.getLastHeroBandHighUsage();
      windowStat.heroContrastBowlUsedCount += renderer.getLastHeroContrastBowlUsed() ? 1 : 0;
      windowStat.heroTravelGracefulBiasSum += renderer.getLastHeroTravelGracefulBias();
      windowStat.heroTravelGlitchBiasSum += renderer.getLastHeroTravelGlitchBias();
      windowStat.heroTargetSmoothingSum += renderer.getLastHeroTargetSmoothing();
      windowStat.heroSpinVelocitySum += renderer.getLastHeroSpinVelocity();
      const motionTier = renderer.getLastMotionTier();
      windowStat.motionTierCounts.set(motionTier, (windowStat.motionTierCounts.get(motionTier) ?? 0) + 1);
      windowStat.jumpTriggeredCount += renderer.getLastJumpTriggered() ? 1 : 0;
      windowStat.jitterSuppressedCount += renderer.getLastJitterSuppressed() ? 1 : 0;
      windowStat.motionTierReadableCount += renderer.getLastMotionTierReadable() ? 1 : 0;
      windowStat.flourishStrengthSum += renderer.getLastFlourishStrength();
      windowStat.screenEdgeAimBiasSum += renderer.getLastScreenEdgeAimBias();
      windowStat.streamCenterBiasDegreesSum += renderer.getLastStreamCenterBiasDegrees();
      windowStat.centerwardEmissionRatioSum += renderer.getLastCenterwardEmissionRatio();
      windowStat.edgePressureActiveFrameRatioSum += renderer.getLastEdgePressureActiveFrameRatio();
      const reflectiveFamily = safetyMetrics.transitionFamilyUsed;
      if (reflectiveFamily && REFLECTIVE_TRANSITION_FAMILIES.has(reflectiveFamily)) {
        windowStat.reflectiveTransitionCount += 1;
        windowStat.reflectiveTransitionFamilies.add(reflectiveFamily);
      }
      windowStat.heroBurstGateActiveRatioSum += renderer.getLastHeroBurstGateActiveRatio();
      windowStat.heroBurstCadenceSlotHitsSum += renderer.getLastHeroBurstCadenceSlotHits();
      windowStat.heroBurstTopQuartileRatioSum += renderer.getLastHeroBurstTopQuartileRatio();
      windowStat.heroShellHueTravelSum += renderer.getLastHeroShellHueTravel();
      windowStat.heroShellUnderlayActiveCount += renderer.getLastHeroShellUnderlayActive() ? 1 : 0;
      windowStat.heroParticleExitWhiteBiasSum += renderer.getLastHeroParticleExitWhiteBias();
      windowStat.heroVariantWarpSum += renderer.getLastHeroVariantWarp();
      windowStat.heroVariantGravitySum += renderer.getLastHeroVariantGravity();
      windowStat.heroVariantInconsistencySum += renderer.getLastHeroVariantInconsistency();
      windowStat.heroParticleSizeAvgSum += renderer.getLastHeroParticleSizeAvg();
      windowStat.heroParticleTtlAvgSum += renderer.getLastHeroParticleTtlAvg();
      windowStat.heroConductorCountSum += renderer.getLastHeroConductorCount();
      windowStat.heroConductorInfluenceRadiusAvgSum += renderer.getLastHeroConductorInfluenceRadiusAvg();
      windowStat.heroCircleEmitterNodeCoverageSum += renderer.getLastHeroCircleEmitterNodeCoverage();
      windowStat.heroExpandedBandCountSum += renderer.getLastHeroExpandedBandCount();
      windowStat.heroInstanceCountResolvedSum += renderer.getLastHeroInstanceCountResolved();
      windowStat.heroPairMinDistancePxMin = Math.min(windowStat.heroPairMinDistancePxMin, renderer.getLastHeroPairMinDistancePx());
      windowStat.heroPairAvgDistancePxSum += renderer.getLastHeroPairAvgDistancePx();
      windowStat.heroOverlapRatioSum += renderer.getLastHeroOverlapRatio();
      windowStat.heroCoreOverlapRatioSum += renderer.getLastHeroCoreOverlapRatio();
      windowStat.heroGlowMergeRatioSum += renderer.getLastHeroGlowMergeRatio();
      windowStat.heroLaneDiversityScoreSum += renderer.getLastHeroLaneDiversityScore();
      windowStat.heroDistinctQuadrantCountMax = Math.max(windowStat.heroDistinctQuadrantCountMax, renderer.getLastHeroDistinctQuadrantCount());
      windowStat.heroSeparationReadableCount += renderer.getLastHeroSeparationReadable() ? 1 : 0;
      windowStat.supportClusterCountMax = Math.max(windowStat.supportClusterCountMax, renderer.getLastSupportClusterCount());
      windowStat.supportNearHeroScoreSum += renderer.getLastSupportNearHeroScore();
      windowStat.edgeHighlightPenaltySum += renderer.getLastEdgeHighlightPenalty();
      windowStat.edgeDominanceMarginSum += renderer.getLastEdgeDominanceMargin();
      windowStat.deadCenterVoidScoreSum += renderer.getLastDeadCenterVoidScore();
      windowStat.focalReinforcementScoreSum += renderer.getLastFocalReinforcementScore();
      windowStat.dbTransitionDriveSum += renderer.getLastDbTransitionDrive();
      windowStat.bandWeightedTransitionDriveSum += renderer.getLastBandWeightedTransitionDrive();
      windowStat.hzTransitionDriveSum += renderer.getLastHzTransitionDrive();
      windowStat.audioTransitionScoreSum += renderer.getLastAudioTransitionScore();
      windowStat.holdPenaltySum += renderer.getLastHoldPenalty();
      windowStat.swapPromotedByAudioCount += renderer.getLastSwapPromotedByAudio() ? 1 : 0;
      windowStat.audioSwapPromotionChanceSum += renderer.getLastAudioSwapPromotionChance();
      windowStat.audioSwapPromotionExtraChanceSum += renderer.getLastAudioSwapPromotionExtraChance();
      windowStat.audioSwapNodeTriggerCountMax = Math.max(windowStat.audioSwapNodeTriggerCountMax, renderer.getLastAudioSwapNodeTriggerCount());
      windowStat.backgroundElementId = frame.backgroundElementId ?? windowStat.backgroundElementId;
      windowStat.backgroundSelectionReason = frame.backgroundSelectionReason ?? windowStat.backgroundSelectionReason;
      windowStat.particleConceptIds = frame.particleConceptIds ?? windowStat.particleConceptIds;
      windowStat.particleSelectionReason = frame.particleSelectionReason ?? windowStat.particleSelectionReason;
      windowStat.backgroundElementFamily = frame.backgroundElementFamily ?? windowStat.backgroundElementFamily;
      windowStat.backgroundTriggerMode = frame.backgroundTriggerMode ?? windowStat.backgroundTriggerMode;
      windowStat.backgroundInteractionMode = frame.backgroundInteractionMode ?? windowStat.backgroundInteractionMode;
      windowStat.backgroundHeroCouplingStrengthSum += frame.backgroundHeroCouplingStrength ?? 0;
      windowStat.backgroundParticleCouplingStrengthSum += frame.backgroundParticleCouplingStrength ?? 0;
      windowStat.backgroundTriggeredFrameCount += frame.backgroundTriggeredThisFrame ? 1 : 0;
      windowStat.backgroundHeroInteractionActiveCount += frame.backgroundHeroInteractionActive ? 1 : 0;
      windowStat.backgroundPeakColorEligibleCount += frame.backgroundPeakColorEligible ? 1 : 0;
      windowStat.backgroundPeakColorDriveSum += frame.backgroundPeakColorDrive ?? 0;
      windowStat.backgroundColorfulnessScaleSum += frame.backgroundColorfulnessScale ?? 0;
      windowStat.backgroundLuminosityLiftAvgSum += frame.backgroundLuminosityLiftAvg ?? 0;
      windowStat.backgroundMinorImpactDriveSum += frame.backgroundMinorImpactDrive ?? 0;
      windowStat.visibleFallbackRiskCount += renderer.getLastVisibleFallbackRisk() ? 1 : 0;
      if (renderer.getLastRecoveryMode() !== "none") {
        windowStat.recoveryMode = renderer.getLastRecoveryMode();
      }
      if (renderer.getLastFallbackRenderMode() !== "none") {
        const nextSeverity = renderer.getLastFallbackSeverity();
        if (fallbackSeverityRank(nextSeverity) >= fallbackSeverityRank(windowStat.fallbackSeverity)) {
          windowStat.fallbackRenderMode = renderer.getLastFallbackRenderMode();
          windowStat.fallbackSeverity = nextSeverity;
        }
      }
      if (renderer.getLastFallbackReason() !== "none") {
        windowStat.fallbackReasonCounts.set(
          renderer.getLastFallbackReason(),
          (windowStat.fallbackReasonCounts.get(renderer.getLastFallbackReason()) ?? 0) + 1,
        );
      }
      windowStat.fallbackTriggerCountMax = Math.max(windowStat.fallbackTriggerCountMax, renderer.getLastFallbackTriggerCount());
      if (renderer.getLastCompositionModeReason() !== "normal") {
        windowStat.compositionModeReason = renderer.getLastCompositionModeReason();
      }
      windowStat.particleTelemetryAvailable = windowStat.particleTelemetryAvailable || renderer.getLastParticleTelemetryAvailable();
      windowStat.focalQuadrant = renderer.getLastFocalQuadrant();
      windowStat.heroQuadrant = renderer.getLastHeroQuadrant();
      windowStat.brightestBlobQuadrant = renderer.getLastBrightestBlobQuadrant();
      windowStat.quarterSpawnGuaranteeHitCount += renderer.getLastQuarterSpawnGuaranteeHitCount();
      windowStat.quarterSpawnGuaranteeMissCount += renderer.getLastQuarterSpawnGuaranteeMissCount();
      windowStat.transitionIdentityChangedCount += renderer.getLastTransitionIdentityChanged() ? 1 : 0;
      windowStat.motifChangedOnTransitionCount += renderer.getLastMotifChangedOnTransition() ? 1 : 0;
      windowStat.heroChangedOnTransitionCount += renderer.getLastHeroChangedOnTransition() ? 1 : 0;
      windowStat.transitionIdentitySignature = renderer.getLastTransitionIdentitySignature() || windowStat.transitionIdentitySignature;
      windowStat.heroRelationshipModeCounts.set(
        renderer.getLastHeroRelationshipMode(),
        (windowStat.heroRelationshipModeCounts.get(renderer.getLastHeroRelationshipMode()) ?? 0) + 1,
      );
      windowStat.heroRelationshipClassCounts.set(
        renderer.getLastHeroRelationshipClass(),
        (windowStat.heroRelationshipClassCounts.get(renderer.getLastHeroRelationshipClass()) ?? 0) + 1,
      );
      windowStat.heroLayoutFamily = renderer.getLastHeroLayoutFamily() ?? windowStat.heroLayoutFamily;
      windowStat.heroRelationshipResolved = renderer.getLastHeroRelationshipResolved() ?? windowStat.heroRelationshipResolved;
      windowStat.heroSeparationFailureReason = renderer.getLastHeroSeparationFailureReason() ?? windowStat.heroSeparationFailureReason;
      windowStat.shotGrammarCounts.set(
        renderer.getLastShotGrammarKey(),
        (windowStat.shotGrammarCounts.get(renderer.getLastShotGrammarKey()) ?? 0) + 1,
      );
      windowStat.focalOccupancyScoreSum += frame.focalOccupancyScore ?? 0;
      windowStat.centerBiasScoreSum += frame.centerBiasScore ?? 0;
      windowStat.adaptiveDegradeLevelMax = Math.max(windowStat.adaptiveDegradeLevelMax, frame.adaptiveDegradeLevel ?? 0);
      windowStat.transitionBudgetTierCounts.set(
        frame.transitionBudgetTier ?? "full",
        (windowStat.transitionBudgetTierCounts.get(frame.transitionBudgetTier ?? "full") ?? 0) + 1,
      );
      windowStat.transitionBudgetReason = frame.transitionBudgetReason || windowStat.transitionBudgetReason;
      windowStat.edgeAttractionScaleSum += renderer.getLastEdgeAttractionScale();
      windowStat.heroSpawnRegion = renderer.getLastHeroSpawnRegion() || windowStat.heroSpawnRegion;
      windowStat.heroParticleSizeVariance = renderer.getLastHeroParticleSizeVariance() || windowStat.heroParticleSizeVariance;
      windowStat.heroColorProminence = renderer.getLastHeroColorProminence() || windowStat.heroColorProminence;
      windowStat.heroSubEmitterFamily = renderer.getLastHeroSubEmitterFamily() || windowStat.heroSubEmitterFamily;
      windowStat.heroSubEmitterVariant = renderer.getLastHeroSubEmitterVariant() || windowStat.heroSubEmitterVariant;
      windowStat.heroSubEmitterMotifAlignmentScore = Math.max(
        windowStat.heroSubEmitterMotifAlignmentScore ?? 0,
        renderer.getLastHeroSubEmitterMotifAlignmentScore(),
      );
      windowStat.heroMotifResolved = renderer.getLastHeroMotifProfile() || windowStat.heroMotifResolved;
      windowStat.heroMotifScheduled = renderer.getLastHeroMotifScheduled() || windowStat.heroMotifScheduled;
      windowStat.heroMotifSlotIndex = renderer.getLastHeroMotifSlotIndex();
      windowStat.heroMotifSlotStartSec = renderer.getLastHeroMotifSlotStartSec();
      windowStat.heroMotifSlotEndSec = renderer.getLastHeroMotifSlotEndSec();
      windowStat.heroMotifScheduleReason = renderer.getLastHeroMotifScheduleReason();
      windowStat.heroMotifChangedOnSlotBoundaryCount += renderer.getLastHeroMotifChangedOnSlotBoundary() ? 1 : 0;
      windowStat.heroMotifChangedOutsideSlotCount += renderer.getLastHeroMotifChangedOutsideSlot() ? 1 : 0;
      windowStat.heroMotifScheduleMismatchCount += renderer.getLastHeroMotifScheduleMismatch() ? 1 : 0;
      windowStat.motifInfluenceKey = renderer.getLastHeroMotifInfluenceKey() || windowStat.motifInfluenceKey;
      windowStat.transitionMotionGrammar = renderer.getLastTransitionMotionGrammar() || windowStat.transitionMotionGrammar;
      windowStat.negativeSpaceOccupancySum += renderer.getLastNegativeSpaceOccupancy();
      windowStat.supportCoverageSum += renderer.getLastSupportCoverage();
      windowStat.transitionDurationFrameSum += renderer.getLastTransitionDurationFrames();
      windowStat.transitionCarryStrengthSum += renderer.getLastTransitionCarryStrength();
      windowStat.transitionCarryAvailabilityScoreSum += renderer.getLastTransitionCarryAvailabilityScore();
      windowStat.transitionCarryModeCounts.set(
        renderer.getLastTransitionCarryMode(),
        (windowStat.transitionCarryModeCounts.get(renderer.getLastTransitionCarryMode()) ?? 0) + 1,
      );
      windowStat.transitionCarryFallbackReasonCounts.set(
        renderer.getLastTransitionCarryFallbackReason(),
        (windowStat.transitionCarryFallbackReasonCounts.get(renderer.getLastTransitionCarryFallbackReason()) ?? 0) + 1,
      );
      windowStat.shapePlacementScoreSum += renderer.getLastShapePlacementScore();
      windowStat.supportElementDensitySum += frame.supportElementDensity ?? 0;
      windowStat.backgroundElementDensitySum += frame.backgroundElementDensity ?? 0;
      windowStat.heroIsolationScoreSum += frame.heroIsolationScore ?? 0;
      windowStat.nearHeroEventDensitySum += frame.nearHeroEventDensity ?? 0;
      windowStat.heroToSupportDistanceScoreSum += frame.heroToSupportDistanceScore ?? 0;
      windowStat.transitionBaseDurationFrameSum += frame.transitionBaseDurationFrames ?? 0;
      windowStat.transitionCappedDurationFrameSum += frame.transitionCappedDurationFrames ?? 0;
      windowStat.transitionCapLossFrameSum += frame.transitionCapLossFrames ?? 0;
      windowStat.transitionRiskScoreSum += frame.transitionRiskScore ?? 0;
      windowStat.transitionCapCategoryCounts.set(
        frame.transitionCapCategory ?? "full",
        (windowStat.transitionCapCategoryCounts.get(frame.transitionCapCategory ?? "full") ?? 0) + 1,
      );
      windowStat.particleSpawnRequestsSum += frame.particleSpawnRequests ?? 0;
      windowStat.particleRenderedCountSum += frame.particleRenderedCount ?? 0;
      windowStat.particleCulledByLayerCapSum += frame.particleCulledByLayerCap ?? 0;
      windowStat.particleCulledByHeroProtectionSum += frame.particleCulledByHeroProtection ?? 0;
      windowStat.particleCulledByNegativeSpaceSum += frame.particleCulledByNegativeSpace ?? 0;
      windowStat.particleCulledByImageProgressSum += frame.particleCulledByImageProgress ?? 0;
      windowStat.particleCulledBySkipNonHeroSum += frame.particleCulledBySkipNonHero ?? 0;
      windowStat.particleOffscreenCountSum += frame.particleOffscreenCount ?? 0;
      windowStat.particleTooSmallToReadCountSum += frame.particleTooSmallToReadCount ?? 0;
      windowStat.particleLowAlphaCountSum += frame.particleLowAlphaCount ?? 0;
      windowStat.particleLowContrastCountSum += frame.particleLowContrastCount ?? 0;
      windowStat.particleVisibleCountSum += frame.particleVisibleCount ?? 0;
      windowStat.heroParticleRenderedCountSum += frame.heroParticleRenderedCount ?? 0;
      windowStat.supportParticleRenderedCountSum += frame.supportParticleRenderedCount ?? 0;
      windowStat.backgroundParticleRenderedCountSum += frame.backgroundParticleRenderedCount ?? 0;
      windowStat.subEmitterTriggerCountSum += frame.subEmitterTriggerCount ?? 0;
      windowStat.subEmitterChildSpawnedCountSum += frame.subEmitterChildSpawnedCount ?? 0;
      windowStat.edgeDeathEligibleCountSum += frame.edgeDeathEligibleCount ?? 0;
      windowStat.edgeDeathTriggeredCountSum += frame.edgeDeathTriggeredCount ?? 0;
      windowStat.edgeDeathPlayedCountSum += frame.edgeDeathPlayedCount ?? 0;
      windowStat.edgeDeathSkippedByCostCountSum += frame.edgeDeathSkippedByCostCount ?? 0;
      windowStat.edgeExitFramesAvgSum += frame.edgeExitFramesAvg ?? 0;
      windowStat.edgeExitDistanceAvgSum += frame.edgeExitDistanceAvg ?? 0;
      if (frame.edgeDeathEffectId) {
        windowStat.edgeDeathEffectCounts.set(frame.edgeDeathEffectId, (windowStat.edgeDeathEffectCounts.get(frame.edgeDeathEffectId) ?? 0) + 1);
      }
      if (frame.edgeDeathCostTier) {
        windowStat.edgeDeathCostTierCounts.set(frame.edgeDeathCostTier, (windowStat.edgeDeathCostTierCounts.get(frame.edgeDeathCostTier) ?? 0) + 1);
      }
      if (safetyMetrics.recoveryActive) {
        windowStat.safetyOverrideCount += 1;
        windowStat.recoveryOverrideFrameCount += 1;
      }
      windowStat.recoveryTriggered = windowStat.recoveryTriggered || safetyMetrics.recoveryActive;
      windowStat.effectVisibleFrameCount += frame.effectVisible ? 1 : 0;
      windowStat.effectVisiblePixelRatioSum += frame.effectVisiblePixelRatio ?? 0;
      windowStat.effectLuminanceDeltaSum += Math.abs((frame.luminanceSample ?? 0) - (frame.preEffectLuminanceSample ?? frame.luminanceSample ?? 0));
      windowStat.effectMotionDeltaSum += frame.effectMotionDelta ?? 0;
      windowStat.overlayOpacitySum += frame.overlayOpacityAvg ?? 0;
      windowStat.overlayCompositeModeCounts.set(
        frame.overlayCompositeMode ?? "source-over",
        (windowStat.overlayCompositeModeCounts.get(frame.overlayCompositeMode ?? "source-over") ?? 0) + 1,
      );
      windowStat.regimeCounts.set(visualState.regime, (windowStat.regimeCounts.get(visualState.regime) ?? 0) + 1);
      windowStat.overlayCounts.set(safetyMetrics.overlayModeUsed, (windowStat.overlayCounts.get(safetyMetrics.overlayModeUsed) ?? 0) + 1);
      windowStat.activeModeCounts.set(activeSubject.mode, (windowStat.activeModeCounts.get(activeSubject.mode) ?? 0) + 1);
      windowStat.compositionModeCounts.set(renderer.getLastCompositionMode(), (windowStat.compositionModeCounts.get(renderer.getLastCompositionMode()) ?? 0) + 1);
      windowStat.transitionCounts.set(
        safetyMetrics.transitionFamilyUsed,
        (windowStat.transitionCounts.get(safetyMetrics.transitionFamilyUsed) ?? 0) + 1,
      );
      windowStat.heroCoverageSum += renderer.getLastHeroCoverage();
      windowStat.backgroundClutterRatioSum += renderer.getLastBackgroundClutterRatio();
      } else {
        windowStat.eventDensitySum += renderer.getLastEventDensity();
        const summaryTransitionTriggerMode = renderer.getLastTransitionTriggerMode();
        windowStat.transitionTriggerModeCounts.set(
          summaryTransitionTriggerMode,
          (windowStat.transitionTriggerModeCounts.get(summaryTransitionTriggerMode) ?? 0) + 1,
        );
        if (summaryTransitionTriggerMode === "hold") {
          windowStat.heldTransitionCount += 1;
        } else {
          windowStat.swapTransitionCount += 1;
        }
        windowStat.heroCoverageSum += renderer.getLastHeroCoverage();
        windowStat.heroTrailOccupancySum += renderer.getLastHeroTrailOccupancy();
        windowStat.supportNearHeroScoreSum += renderer.getLastSupportNearHeroScore();
        windowStat.edgeHighlightPenaltySum += renderer.getLastEdgeHighlightPenalty();
        windowStat.edgeDominanceMarginSum += renderer.getLastEdgeDominanceMargin();
        windowStat.deadCenterVoidScoreSum += renderer.getLastDeadCenterVoidScore();
        windowStat.focalReinforcementScoreSum += renderer.getLastFocalReinforcementScore();
        windowStat.supportCoverageSum += renderer.getLastSupportCoverage();
        windowStat.visibleFallbackRiskCount += renderer.getLastVisibleFallbackRisk() ? 1 : 0;
        if (renderer.getLastRecoveryMode() !== "none") {
          windowStat.recoveryMode = renderer.getLastRecoveryMode();
        }
        if (renderer.getLastFallbackRenderMode() !== "none") {
          const nextSeverity = renderer.getLastFallbackSeverity();
          if (fallbackSeverityRank(nextSeverity) >= fallbackSeverityRank(windowStat.fallbackSeverity)) {
            windowStat.fallbackRenderMode = renderer.getLastFallbackRenderMode();
            windowStat.fallbackSeverity = nextSeverity;
          }
        }
        if (renderer.getLastFallbackReason() !== "none") {
          windowStat.fallbackReasonCounts.set(
            renderer.getLastFallbackReason(),
            (windowStat.fallbackReasonCounts.get(renderer.getLastFallbackReason()) ?? 0) + 1,
          );
        }
        windowStat.fallbackTriggerCountMax = Math.max(windowStat.fallbackTriggerCountMax, renderer.getLastFallbackTriggerCount());
        if (renderer.getLastCompositionModeReason() !== "normal") {
          windowStat.compositionModeReason = renderer.getLastCompositionModeReason();
        }
        windowStat.particleTelemetryAvailable = windowStat.particleTelemetryAvailable || renderer.getLastParticleTelemetryAvailable();
        windowStat.focalQuadrant = renderer.getLastFocalQuadrant();
        windowStat.heroQuadrant = renderer.getLastHeroQuadrant();
        windowStat.brightestBlobQuadrant = renderer.getLastBrightestBlobQuadrant();
        if (safetyMetrics.recoveryActive) {
          windowStat.safetyOverrideCount += 1;
          windowStat.recoveryOverrideFrameCount += 1;
        }
        windowStat.recoveryTriggered = windowStat.recoveryTriggered || safetyMetrics.recoveryActive;
        windowStat.effectVisibleFrameCount += frame.effectVisible ? 1 : 0;
        windowStat.effectVisiblePixelRatioSum += frame.effectVisiblePixelRatio ?? 0;
        windowStat.effectLuminanceDeltaSum += Math.abs((frame.luminanceSample ?? 0) - (frame.preEffectLuminanceSample ?? frame.luminanceSample ?? 0));
        windowStat.effectMotionDeltaSum += frame.effectMotionDelta ?? 0;
        windowStat.regimeCounts.set(visualState.regime, (windowStat.regimeCounts.get(visualState.regime) ?? 0) + 1);
        const summaryCompositionMode = renderer.getLastCompositionMode();
        windowStat.compositionModeCounts.set(
          summaryCompositionMode,
          (windowStat.compositionModeCounts.get(summaryCompositionMode) ?? 0) + 1,
        );
        windowStat.transitionCounts.set(
          safetyMetrics.transitionFamilyUsed,
          (windowStat.transitionCounts.get(safetyMetrics.transitionFamilyUsed) ?? 0) + 1,
        );
      }
      if (frame.blackFrame) {
        windowStat.blackFrameCount += 1;
        chunkBlackFrameCount += 1;
      }
        imageWindowStats.set(windowKey, windowStat);
      }
      chunkLuminanceSum += luminance;
      chunkMinLuminance = Math.min(chunkMinLuminance, luminance);
      const writeStartedAt = performance.now();
      await stdin.write(frame.rgba);
      const writeElapsedMs = performance.now() - writeStartedAt;
      stdinBackpressureMs += writeElapsedMs;
      if (writeElapsedMs > 2) {
        encoderDrainWaitMs += writeElapsedMs;
      }
      renderer.setRuntimePressureMetrics(writeElapsedMs);
      if ((index + 1) % 15 === 0 || index + 1 === message.chunk.frames.length) {
        const progress: RenderWorkerMessage = {
          type: "progress",
          chunkIndex: message.chunk.chunkIndex,
          renderedFrames: index + 1,
        };
        port.postMessage(progress);
      }
    }

    await stdin.end();
    const exitCode = await encoder.exited;
    const stderr = await stderrPromise;
    if (exitCode !== 0) {
      throw new Error(`ffmpeg chunk encoding failed (${exitCode})\n${stderr}`.trim());
    }

    const done: RenderWorkerMessage = {
      type: "done",
      chunkIndex: message.chunk.chunkIndex,
      outputPath: message.chunk.outputPath,
      frameCount: message.chunk.frames.length,
      elapsedMs: performance.now() - startedAt,
      workerInitMs,
      rendererConstructionMs,
      firstFrameLatencyMs,
      jobQueueWaitMs,
      renderCpuMs,
      encodeWaitMs: Math.max(0, performance.now() - startedAt - renderCpuMs),
      stdinBackpressureMs,
      encoderDrainWaitMs,
      budgetDowngradeCount,
      averageStageMetrics: {
        backgroundMs: backgroundMs / Math.max(1, message.chunk.frames.length),
        particlesMs: particlesMs / Math.max(1, message.chunk.frames.length),
        occupancyMs: occupancyMs / Math.max(1, message.chunk.frames.length),
        atmosphereMs: atmosphereMs / Math.max(1, message.chunk.frames.length),
        effectsMs: effectsMs / Math.max(1, message.chunk.frames.length),
        transitionMs: transitionMs / Math.max(1, message.chunk.frames.length),
        heroMs: heroMs / Math.max(1, message.chunk.frames.length),
        luminanceReadbackMs: luminanceReadbackMs / Math.max(1, message.chunk.frames.length),
        luminanceReadbackMode,
        luminanceReadbackSampleInterval,
        luminanceReadbackFramesSampled,
        luminanceReadbackFramesSkipped,
        luminanceReadbackMsSavedEstimate,
        encoderReadbackMs: encoderReadbackMs / Math.max(1, message.chunk.frames.length),
        stampDrawCount: stampDrawCount / Math.max(1, message.chunk.frames.length),
        supportStampDrawCount: supportStampDrawCount / Math.max(1, message.chunk.frames.length),
        backgroundStampDrawCount: backgroundStampDrawCount / Math.max(1, message.chunk.frames.length),
        vectorDrawCount: vectorDrawCount / Math.max(1, message.chunk.frames.length),
        occupancyDrawCount: occupancyDrawCount / Math.max(1, message.chunk.frames.length),
        heroGlyphDrawCount: heroGlyphDrawCount / Math.max(1, message.chunk.frames.length),
        veilDrawCount: veilDrawCount / Math.max(1, message.chunk.frames.length),
        bridgeDrawCount: bridgeDrawCount / Math.max(1, message.chunk.frames.length),
        localGlowDrawCount: localGlowDrawCount / Math.max(1, message.chunk.frames.length),
        gradientCreateCount: gradientCreateCount / Math.max(1, message.chunk.frames.length),
        avgSupportMotionPx: [...imageWindowStats.values()].reduce((sum, stat) => sum + stat.supportMotionSum / Math.max(1, stat.frameCount), 0) / Math.max(1, imageWindowStats.size),
        avgBackgroundMotionPx: [...imageWindowStats.values()].reduce((sum, stat) => sum + stat.backgroundMotionSum / Math.max(1, stat.frameCount), 0) / Math.max(1, imageWindowStats.size),
      },
      averageLuminance: chunkLuminanceSum / Math.max(1, message.chunk.frames.length),
      minLuminance: Number.isFinite(chunkMinLuminance) ? chunkMinLuminance : 0,
      blackFrameCount: chunkBlackFrameCount,
      imageWindows: telemetryMode === "off" ? undefined : [...imageWindowStats.entries()]
        .sort((a, b) => (a[1].firstFrameIndex ?? 0) - (b[1].firstFrameIndex ?? 0))
        .map(
          ([, stat]): RenderImageWindowStat => {
            const windowStat: any = stat;
            const imageIndex = windowStat.imageIndex;
            const finalizedWindow: RenderImageWindowStat = ({
            imageIndex,
            windowKey: windowStat.windowKey,
            chunkIndex: windowStat.chunkIndex,
            firstFrameIndex: windowStat.firstFrameIndex,
            startSec: windowStat.startSec,
            endSec: windowStat.endSec,
            fastMode: payload.fast ?? false,
            requestedImageIndex: windowStat.requestedImageIndex,
            resolvedImageIndex: windowStat.resolvedImageIndex,
            themeImagePath: windowStat.themeImagePath,
            frameCount: windowStat.frameCount,
            averageLuminance: windowStat.luminanceSum / Math.max(1, windowStat.frameCount),
            darkestQuartileLuminance: windowStat.darkestQuartileLuminanceSum / Math.max(1, windowStat.frameCount),
            minLuminance: Number.isFinite(windowStat.minLuminance) ? windowStat.minLuminance : 0,
            blackFrameCount: windowStat.blackFrameCount,
            averageDbOverall: windowStat.dbOverallSum / Math.max(1, windowStat.frameCount),
            averagePulseScale: windowStat.pulseScaleSum / Math.max(1, windowStat.frameCount),
            subjectMaskCoverage: windowStat.subjectMaskCoverage / Math.max(1, windowStat.frameCount),
            heroCoverage: windowStat.heroCoverageSum / Math.max(1, windowStat.frameCount),
            backgroundClutterRatio: windowStat.backgroundClutterRatioSum / Math.max(1, windowStat.frameCount),
            motif: payload.edgeMaps[imageIndex]?.fractalMotif,
            sceneKey: windowStat.sceneKey,
            sourceMotif: windowStat.sourceMotif,
            heroMotifResolved: windowStat.heroMotifResolved,
            heroMotifScheduled: windowStat.heroMotifScheduled,
            heroMotifSlotIndex: windowStat.heroMotifSlotIndex,
            heroMotifSlotStartSec: windowStat.heroMotifSlotStartSec,
            heroMotifSlotEndSec: windowStat.heroMotifSlotEndSec,
            heroMotifScheduleReason: windowStat.heroMotifScheduleReason,
            heroMotifChangedOnSlotBoundary: windowStat.heroMotifChangedOnSlotBoundaryCount > 0,
            heroMotifChangedOutsideSlot: windowStat.heroMotifChangedOutsideSlotCount > 0,
            heroMotifScheduleMismatch: windowStat.heroMotifScheduleMismatchCount > 0,
            persistentMotifId: windowStat.persistentMotifId,
            persistentMotifLabel: windowStat.persistentMotifLabel,
            persistentMotifCarryFrames: windowStat.persistentMotifCarryFramesSum / Math.max(1, windowStat.frameCount),
            persistentMotifChanged: windowStat.persistentMotifChangedCount > 0,
            motifEffectId: windowStat.motifEffectId,
            motifEffectSelectionReason: windowStat.motifEffectSelectionReason,
            motifEffectPhenomenon: windowStat.motifEffectPhenomenon,
            motifEffectAudioMode: windowStat.motifEffectAudioMode,
            motifEffectIntensity: windowStat.motifEffectIntensitySum / Math.max(1, windowStat.frameCount),
            outroEffectId: windowStat.outroEffectId,
            outroEffectCategory: windowStat.outroEffectCategory,
            outroEffectAudioMode: windowStat.outroEffectAudioMode,
            outroEffectIntensity: windowStat.outroEffectIntensitySum / Math.max(1, windowStat.frameCount),
            outroEffectImageSignature: windowStat.outroEffectImageSignature,
            outroCoverageEstimate: windowStat.outroCoverageEstimateSum / Math.max(1, windowStat.frameCount),
            outroHeroWarp: windowStat.outroHeroWarpSum / Math.max(1, windowStat.frameCount),
            terminalBurstProgress: windowStat.terminalBurstProgressMax,
            heroWarpActive: windowStat.heroWarpActiveCount > 0,
            maskConfidence: payload.edgeMaps[imageIndex]?.maskConfidence,
            visualRegime: [...windowStat.regimeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["visualRegime"],
            overlayMode: [...windowStat.overlayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["overlayMode"],
            transitionFamily: [...windowStat.transitionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionFamily"],
            brightnessFloor: windowStat.brightnessFloorSum / Math.max(1, windowStat.frameCount),
            safetyOverrideCount: windowStat.safetyOverrideCount,
            recoveryTriggered: windowStat.recoveryTriggered,
            recoveryOverrideFrameCount: windowStat.recoveryOverrideFrameCount,
            recoveryOverrideFrameRatio: windowStat.recoveryOverrideFrameCount / Math.max(1, windowStat.frameCount),
            recoverySeverityScore: Math.min(1, (windowStat.recoveryOverrideFrameCount / Math.max(1, windowStat.frameCount)) * 2),
            recoveryActiveAny: windowStat.recoveryTriggered,
            activeMode: [...windowStat.activeModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["activeMode"],
            averageActiveMotionPx: windowStat.activeMotionSum / Math.max(1, windowStat.frameCount),
            averageActiveEmphasis: windowStat.activeEmphasisSum / Math.max(1, windowStat.frameCount),
            averageSupportMotionPx: windowStat.supportMotionSum / Math.max(1, windowStat.frameCount),
            averageBackgroundMotionPx: windowStat.backgroundMotionSum / Math.max(1, windowStat.frameCount),
            atmosphereDensity: windowStat.atmosphereDensitySum / Math.max(1, windowStat.frameCount),
            midScaleCoverage: windowStat.midScaleCoverageSum / Math.max(1, windowStat.frameCount),
            symmetryUsage: windowStat.symmetryUsageSum / Math.max(1, windowStat.frameCount),
            eventDensity: windowStat.eventDensitySum / Math.max(1, windowStat.frameCount),
            eventSpecId: windowStat.eventSpecId,
            eventSpecLabel: windowStat.eventSpecLabel,
            eventSelectionReason: windowStat.eventSelectionReason,
            emitterUsage: windowStat.emitterUsageSum / Math.max(1, windowStat.frameCount),
            absorberUsage: windowStat.absorberUsageSum / Math.max(1, windowStat.frameCount),
            explosionCount: windowStat.explosionCountSum,
            sourceAffinityAvg: windowStat.sourceAffinitySum / Math.max(1, windowStat.frameCount),
            sourceAffinityHeroAvg: windowStat.sourceAffinityHeroSum / Math.max(1, windowStat.frameCount),
            sourceAffinitySupportAvg: windowStat.sourceAffinitySupportSum / Math.max(1, windowStat.frameCount),
            particleConvergenceScore: windowStat.particleConvergenceScoreSum / Math.max(1, windowStat.frameCount),
            subEmitterChildren: windowStat.subEmitterChildrenSum / Math.max(1, windowStat.frameCount),
            heroEchoCount: windowStat.heroEchoCountSum / Math.max(1, windowStat.frameCount),
            heroGlyphComplexity: windowStat.heroGlyphComplexitySum / Math.max(1, windowStat.frameCount),
            heroSubEmitterCount: windowStat.heroSubEmitterCountSum / Math.max(1, windowStat.frameCount),
            heroCoreSize: windowStat.heroCoreSizeSum / Math.max(1, windowStat.frameCount),
            heroCoreFillMode: renderer.getLastHeroCoreFillMode(),
            heroOutlineRatio: windowStat.heroOutlineRatioSum / Math.max(1, windowStat.frameCount),
            heroPrimitiveComplexity: windowStat.heroPrimitiveComplexitySum / Math.max(1, windowStat.frameCount),
            heroChildEmissionRate: windowStat.heroChildEmissionRateSum / Math.max(1, windowStat.frameCount),
            heroChildFieldDensity: windowStat.heroChildFieldDensitySum / Math.max(1, windowStat.frameCount),
            heroChildFieldRadius: windowStat.heroChildFieldRadiusSum / Math.max(1, windowStat.frameCount),
            heroTrailOccupancy: windowStat.heroTrailOccupancySum / Math.max(1, windowStat.frameCount),
            heroWakeLengthPx: windowStat.heroWakeLengthPxSum / Math.max(1, windowStat.frameCount),
            heroBurstCount: windowStat.heroBurstCountSum / Math.max(1, windowStat.frameCount),
            heroBurstChildren: windowStat.heroBurstChildrenSum / Math.max(1, windowStat.frameCount),
            heroMotorJitter: windowStat.heroMotorJitterSum / Math.max(1, windowStat.frameCount),
            heroMotorThrust: windowStat.heroMotorThrustSum / Math.max(1, windowStat.frameCount),
            heroBurnPhase: windowStat.heroBurnPhaseSum / Math.max(1, windowStat.frameCount),
            heroWakeTailAgeAvg: windowStat.heroWakeTailAgeAvgSum / Math.max(1, windowStat.frameCount),
            heroWakeResetCount: windowStat.heroWakeResetCountMax,
            heroSpeedAvg: windowStat.heroSpeedAvgSum / Math.max(1, windowStat.frameCount),
            heroSpeedPeak: windowStat.heroSpeedPeakMax,
            heroBaselineEmissionScale: windowStat.heroBaselineEmissionScaleSum / Math.max(1, windowStat.frameCount),
            heroZeroDbRecovery: windowStat.heroZeroDbRecoverySum / Math.max(1, windowStat.frameCount),
            mainHeroLowDbThrottleRatio: windowStat.mainHeroLowDbThrottleCount / Math.max(1, windowStat.frameCount),
            mainHeroFreezeFrameRatio: windowStat.mainHeroFreezeCount / Math.max(1, windowStat.frameCount),
            heroScalePulseAvg: windowStat.heroScalePulseAvgSum / Math.max(1, windowStat.frameCount),
            heroScalePulsePeak: windowStat.heroScalePulsePeakMax,
            motifPotencyScore: windowStat.motifPotencyScoreSum / Math.max(1, windowStat.frameCount),
            transitionTriggerMode: [...windowStat.transitionTriggerModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionTriggerMode"],
            heldTransitionCount: windowStat.heldTransitionCount,
            swapTransitionCount: windowStat.swapTransitionCount,
            heldTransitionRatio: windowStat.heldTransitionCount / Math.max(1, windowStat.heldTransitionCount + windowStat.swapTransitionCount),
            heroShellInnerAlpha: windowStat.heroShellInnerAlphaSum / Math.max(1, windowStat.frameCount),
            heroShellOuterAlpha: windowStat.heroShellOuterAlphaSum / Math.max(1, windowStat.frameCount),
            heroShellSceneEnabled: windowStat.heroShellSceneEnabledCount > windowStat.frameCount * 0.5,
            heroShellConfiguredCount: Math.round(windowStat.heroShellConfiguredCountSum / Math.max(1, windowStat.frameCount)) as 0 | 1 | 2 | 3,
            heroShellColorMode: renderer.getLastHeroShellColorMode(),
            heroShellActiveCountAvg: windowStat.heroShellActiveCountSum / Math.max(1, windowStat.frameCount),
            heroShellActivationDriverBand: windowStat.heroShellActivationDriverBand,
            heroShellTriggerRateLow: windowStat.heroShellTriggerRateLowSum / Math.max(1, windowStat.frameCount),
            heroShellTriggerRateLowMid: windowStat.heroShellTriggerRateLowMidSum / Math.max(1, windowStat.frameCount),
            heroShellTriggerRateLowComposite: windowStat.heroShellTriggerRateLowCompositeSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdLowAvg: windowStat.heroShellThresholdLowSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdLowMidAvg: windowStat.heroShellThresholdLowMidSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdLowCompositeAvg: windowStat.heroShellThresholdLowCompositeSum / Math.max(1, windowStat.frameCount),
            heroShellTriggerRateHighMid: windowStat.heroShellTriggerRateHighMidSum / Math.max(1, windowStat.frameCount),
            heroShellTriggerRateHigh: windowStat.heroShellTriggerRateHighSum / Math.max(1, windowStat.frameCount),
            heroShellTriggerRateUpper: windowStat.heroShellTriggerRateUpperSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdHighMidAvg: windowStat.heroShellThresholdHighMidSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdHighAvg: windowStat.heroShellThresholdHighSum / Math.max(1, windowStat.frameCount),
            heroShellThresholdUpperAvg: windowStat.heroShellThresholdUpperSum / Math.max(1, windowStat.frameCount),
            heroBandLowUsage: windowStat.heroBandLowUsageSum / Math.max(1, windowStat.frameCount),
            heroBandMidUsage: windowStat.heroBandMidUsageSum / Math.max(1, windowStat.frameCount),
            heroBandHighUsage: windowStat.heroBandHighUsageSum / Math.max(1, windowStat.frameCount),
            heroEmitterTopology: renderer.getLastHeroEmitterTopology(),
            heroInstanceVariant: renderer.getLastHeroInstanceVariant(),
            heroContrastBowlUsed: windowStat.heroContrastBowlUsedCount > windowStat.frameCount * 0.25,
            heroTravelGracefulBias: windowStat.heroTravelGracefulBiasSum / Math.max(1, windowStat.frameCount),
            heroTravelGlitchBias: windowStat.heroTravelGlitchBiasSum / Math.max(1, windowStat.frameCount),
            heroTargetSmoothing: windowStat.heroTargetSmoothingSum / Math.max(1, windowStat.frameCount),
            heroSpinVelocity: windowStat.heroSpinVelocitySum / Math.max(1, windowStat.frameCount),
            motionTier: [...windowStat.motionTierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["motionTier"],
            jumpTriggered: windowStat.jumpTriggeredCount > 0,
            jitterSuppressed: windowStat.jitterSuppressedCount > windowStat.frameCount * 0.25,
            motionTierReadable: windowStat.motionTierReadableCount > windowStat.frameCount * 0.55,
            flourishStrength: windowStat.flourishStrengthSum / Math.max(1, windowStat.frameCount),
            screenEdgeAimBias: windowStat.screenEdgeAimBiasSum / Math.max(1, windowStat.frameCount),
            streamCenterBiasDegrees: windowStat.streamCenterBiasDegreesSum / Math.max(1, windowStat.frameCount),
            centerwardEmissionRatio: windowStat.centerwardEmissionRatioSum / Math.max(1, windowStat.frameCount),
            edgePressureActiveFrameRatio: windowStat.edgePressureActiveFrameRatioSum / Math.max(1, windowStat.frameCount),
            reflectiveTransitionCount: windowStat.reflectiveTransitionCount,
            reflectiveTransitionUniqueCount: windowStat.reflectiveTransitionFamilies.size,
            heroBurstGateActiveRatio: windowStat.heroBurstGateActiveRatioSum / Math.max(1, windowStat.frameCount),
            heroBurstCadenceSlotHits: windowStat.heroBurstCadenceSlotHitsSum,
            heroBurstTopQuartileRatio: windowStat.heroBurstTopQuartileRatioSum / Math.max(1, windowStat.frameCount),
            heroShellHueTravelAvg: windowStat.heroShellHueTravelSum / Math.max(1, windowStat.frameCount),
            heroShellUnderlayActiveRatio: windowStat.heroShellUnderlayActiveCount / Math.max(1, windowStat.frameCount),
            heroParticleExitWhiteBias: windowStat.heroParticleExitWhiteBiasSum / Math.max(1, windowStat.frameCount),
            heroMotifVariantKey: renderer.getLastHeroMotifVariantKey(),
            heroVariantWarp: windowStat.heroVariantWarpSum / Math.max(1, windowStat.frameCount),
            heroVariantGravity: windowStat.heroVariantGravitySum / Math.max(1, windowStat.frameCount),
            heroVariantInconsistency: windowStat.heroVariantInconsistencySum / Math.max(1, windowStat.frameCount),
            heroParticleSizeAvg: windowStat.heroParticleSizeAvgSum / Math.max(1, windowStat.frameCount),
            heroParticleTtlAvg: windowStat.heroParticleTtlAvgSum / Math.max(1, windowStat.frameCount),
            heroConductorCount: windowStat.heroConductorCountSum / Math.max(1, windowStat.frameCount),
            heroConductorType: renderer.getLastHeroConductorType(),
            heroConductorInfluenceRadiusAvg: windowStat.heroConductorInfluenceRadiusAvgSum / Math.max(1, windowStat.frameCount),
            heroCircleEmitterNodeCoverage: windowStat.heroCircleEmitterNodeCoverageSum / Math.max(1, windowStat.frameCount),
            heroExpandedBandCount: windowStat.heroExpandedBandCountSum / Math.max(1, windowStat.frameCount),
            heroLayoutFamily: windowStat.heroLayoutFamily,
            heroInstanceCountResolved: windowStat.heroInstanceCountResolvedSum / Math.max(1, windowStat.frameCount),
            heroPairMinDistancePx: Number.isFinite(windowStat.heroPairMinDistancePxMin) ? windowStat.heroPairMinDistancePxMin : 0,
            heroPairAvgDistancePx: windowStat.heroPairAvgDistancePxSum / Math.max(1, windowStat.frameCount),
            heroOverlapRatio: windowStat.heroOverlapRatioSum / Math.max(1, windowStat.frameCount),
            heroCoreOverlapRatio: windowStat.heroCoreOverlapRatioSum / Math.max(1, windowStat.frameCount),
            heroGlowMergeRatio: windowStat.heroGlowMergeRatioSum / Math.max(1, windowStat.frameCount),
            heroLaneDiversityScore: windowStat.heroLaneDiversityScoreSum / Math.max(1, windowStat.frameCount),
            heroDistinctQuadrantCount: windowStat.heroDistinctQuadrantCountMax,
            focalQuadrant: windowStat.focalQuadrant,
            heroQuadrant: windowStat.heroQuadrant,
            brightestBlobQuadrant: windowStat.brightestBlobQuadrant,
            supportClusterCount: windowStat.supportClusterCountMax,
            supportNearHeroScore: windowStat.supportNearHeroScoreSum / Math.max(1, windowStat.frameCount),
            edgeHighlightPenalty: windowStat.edgeHighlightPenaltySum / Math.max(1, windowStat.frameCount),
            edgeDominanceMargin: windowStat.edgeDominanceMarginSum / Math.max(1, windowStat.frameCount),
            deadCenterVoidScore: windowStat.deadCenterVoidScoreSum / Math.max(1, windowStat.frameCount),
            focalReinforcementScore: windowStat.focalReinforcementScoreSum / Math.max(1, windowStat.frameCount),
            dbTransitionDrive: windowStat.dbTransitionDriveSum / Math.max(1, windowStat.frameCount),
            bandWeightedTransitionDrive: windowStat.bandWeightedTransitionDriveSum / Math.max(1, windowStat.frameCount),
            hzTransitionDrive: windowStat.hzTransitionDriveSum / Math.max(1, windowStat.frameCount),
            audioTransitionScore: windowStat.audioTransitionScoreSum / Math.max(1, windowStat.frameCount),
            holdPenalty: windowStat.holdPenaltySum / Math.max(1, windowStat.frameCount),
            swapPromotedByAudio: windowStat.swapPromotedByAudioCount > 0,
            audioSwapPromotionChance: windowStat.audioSwapPromotionChanceSum / Math.max(1, windowStat.frameCount),
            audioSwapPromotionExtraChance: windowStat.audioSwapPromotionExtraChanceSum / Math.max(1, windowStat.frameCount),
            audioSwapNodeTriggerCount: windowStat.audioSwapNodeTriggerCountMax,
            recoveryMode: windowStat.recoveryMode ?? "none",
            fallbackRenderMode: windowStat.fallbackRenderMode ?? "none",
            fallbackReason: [...windowStat.fallbackReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["fallbackReason"] ?? windowStat.fallbackReason ?? "none",
            fallbackTriggerCount: windowStat.fallbackTriggerCountMax,
            fallbackSeverity: windowStat.fallbackSeverity ?? "none",
            compositionModeReason: windowStat.compositionModeReason ?? "normal",
            particleTelemetryAvailable: windowStat.particleTelemetryAvailable,
            visibleFallbackRisk: windowStat.visibleFallbackRiskCount > 0,
            heroRelationshipMode: [...windowStat.heroRelationshipModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["heroRelationshipMode"],
            heroRelationshipClass: [...windowStat.heroRelationshipClassCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["heroRelationshipClass"],
            heroRelationshipResolved: windowStat.heroRelationshipResolved,
            heroSeparationReadable: windowStat.heroSeparationReadableCount > windowStat.frameCount * 0.55,
            heroSeparationFailureReason: windowStat.heroSeparationFailureReason,
            shotGrammarKey: [...windowStat.shotGrammarCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
            focalOccupancyScore: windowStat.focalOccupancyScoreSum / Math.max(1, windowStat.frameCount),
            centerBiasScore: windowStat.centerBiasScoreSum / Math.max(1, windowStat.frameCount),
            adaptiveDegradeLevel: windowStat.adaptiveDegradeLevelMax,
            transitionBudgetTier: [...windowStat.transitionBudgetTierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionBudgetTier"],
            transitionBudgetReason: windowStat.transitionBudgetReason,
            transitionIdentitySignature: windowStat.transitionIdentitySignature,
            transitionIdentityChanged: windowStat.transitionIdentityChangedCount > 0,
            motifChangedOnTransition: windowStat.motifChangedOnTransitionCount > 0,
            heroChangedOnTransition: windowStat.heroChangedOnTransitionCount > 0,
            quarterSpawnGuaranteeHitCount: windowStat.quarterSpawnGuaranteeHitCount,
            quarterSpawnGuaranteeMissCount: windowStat.quarterSpawnGuaranteeMissCount,
            heroParticleSizeVariance: windowStat.heroParticleSizeVariance,
            heroColorProminence: windowStat.heroColorProminence,
            heroSubEmitterFamily: windowStat.heroSubEmitterFamily,
            heroSubEmitterVariant: windowStat.heroSubEmitterVariant,
            heroSubEmitterMotifAlignmentScore: windowStat.heroSubEmitterMotifAlignmentScore,
            heroMotionBias: renderer.getLastHeroMotionBias(),
            heroSpawnRegion: windowStat.heroSpawnRegion,
            heroMotifProfile: renderer.getLastHeroMotifProfile(),
            motifInfluenceKey: windowStat.motifInfluenceKey,
            edgeAttractionScale: windowStat.edgeAttractionScaleSum / Math.max(1, windowStat.frameCount),
            transitionMotionGrammar: windowStat.transitionMotionGrammar,
            negativeSpaceOccupancy: windowStat.negativeSpaceOccupancySum / Math.max(1, windowStat.frameCount),
            supportCoverage: windowStat.supportCoverageSum / Math.max(1, windowStat.frameCount),
            transitionAvgDurationFrames: windowStat.transitionDurationFrameSum / Math.max(1, windowStat.frameCount),
            transitionCarryStrength: windowStat.transitionCarryStrengthSum / Math.max(1, windowStat.frameCount),
            transitionCarryMode: [...windowStat.transitionCarryModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionCarryMode"],
            transitionCarryAvailabilityScore: windowStat.transitionCarryAvailabilityScoreSum / Math.max(1, windowStat.frameCount),
            transitionCarryFallbackReason: [...windowStat.transitionCarryFallbackReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionCarryFallbackReason"],
            transitionBaseDurationFrames: windowStat.transitionBaseDurationFrameSum / Math.max(1, windowStat.frameCount),
            transitionCappedDurationFrames: windowStat.transitionCappedDurationFrameSum / Math.max(1, windowStat.frameCount),
            transitionCapLossFrames: windowStat.transitionCapLossFrameSum / Math.max(1, windowStat.frameCount),
            transitionRiskScore: windowStat.transitionRiskScoreSum / Math.max(1, windowStat.frameCount),
            transitionCapCategory: [...windowStat.transitionCapCategoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["transitionCapCategory"],
            compositionMode: [...windowStat.compositionModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["compositionMode"],
            shapePlacementScore: windowStat.shapePlacementScoreSum / Math.max(1, windowStat.frameCount),
            supportElementDensity: windowStat.supportElementDensitySum / Math.max(1, windowStat.frameCount),
            backgroundElementDensity: windowStat.backgroundElementDensitySum / Math.max(1, windowStat.frameCount),
            heroIsolationScore: windowStat.heroIsolationScoreSum / Math.max(1, windowStat.frameCount),
            nearHeroEventDensity: windowStat.nearHeroEventDensitySum / Math.max(1, windowStat.frameCount),
            heroToSupportDistanceScore: windowStat.heroToSupportDistanceScoreSum / Math.max(1, windowStat.frameCount),
            diagnosticCompleteness: "complete",
            effectVisibleFrameRatio: windowStat.effectVisibleFrameCount / Math.max(1, windowStat.frameCount),
            effectVisiblePixelRatioAvg: windowStat.effectVisiblePixelRatioSum / Math.max(1, windowStat.frameCount),
            effectLuminanceDeltaAvg: windowStat.effectLuminanceDeltaSum / Math.max(1, windowStat.frameCount),
            effectMotionDeltaAvg: windowStat.effectMotionDeltaSum / Math.max(1, windowStat.frameCount),
            overlayOpacityAvg: windowStat.overlayOpacitySum / Math.max(1, windowStat.frameCount),
            overlayCompositeMode: [...windowStat.overlayCompositeModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
            effectVisibilityScore: Math.min(
              1,
              (
                (windowStat.effectVisibleFrameCount / Math.max(1, windowStat.frameCount)) * 0.45 +
                (windowStat.effectVisiblePixelRatioSum / Math.max(1, windowStat.frameCount)) * 0.25 +
                Math.min(1, (windowStat.effectLuminanceDeltaSum / Math.max(1, windowStat.frameCount)) * 6) * 0.15 +
                Math.min(1, windowStat.effectMotionDeltaSum / Math.max(1, windowStat.frameCount)) * 0.15
              ),
            ),
            backgroundElementId: windowStat.backgroundElementId,
            backgroundSelectionReason: windowStat.backgroundSelectionReason,
            particleConceptIds: windowStat.particleConceptIds,
            particleSelectionReason: windowStat.particleSelectionReason,
            backgroundElementFamily: windowStat.backgroundElementFamily,
            backgroundTriggerMode: windowStat.backgroundTriggerMode,
            backgroundInteractionMode: windowStat.backgroundInteractionMode,
            backgroundHeroCouplingStrength: windowStat.backgroundHeroCouplingStrengthSum / Math.max(1, windowStat.frameCount),
            backgroundParticleCouplingStrength: windowStat.backgroundParticleCouplingStrengthSum / Math.max(1, windowStat.frameCount),
            backgroundTriggeredThisFrame: windowStat.backgroundTriggeredFrameCount > 0,
            backgroundHeroInteractionActive: windowStat.backgroundHeroInteractionActiveCount > 0,
            backgroundTriggeredFrameRatio: windowStat.backgroundTriggeredFrameCount / Math.max(1, windowStat.frameCount),
            backgroundPeakColorEligible: windowStat.backgroundPeakColorEligibleCount > windowStat.frameCount * 0.5,
            backgroundPeakColorDrive: windowStat.backgroundPeakColorDriveSum / Math.max(1, windowStat.frameCount),
            backgroundColorfulnessScale: windowStat.backgroundColorfulnessScaleSum / Math.max(1, windowStat.frameCount),
            backgroundLuminosityLiftAvg: windowStat.backgroundLuminosityLiftAvgSum / Math.max(1, windowStat.frameCount),
            backgroundMinorImpactDrive: windowStat.backgroundMinorImpactDriveSum / Math.max(1, windowStat.frameCount),
            particleSpawnRequests: windowStat.particleSpawnRequestsSum / Math.max(1, windowStat.frameCount),
            particleRenderedCount: windowStat.particleRenderedCountSum / Math.max(1, windowStat.frameCount),
            particleCulledByLayerCap: windowStat.particleCulledByLayerCapSum / Math.max(1, windowStat.frameCount),
            particleCulledByHeroProtection: windowStat.particleCulledByHeroProtectionSum / Math.max(1, windowStat.frameCount),
            particleCulledByNegativeSpace: windowStat.particleCulledByNegativeSpaceSum / Math.max(1, windowStat.frameCount),
            particleCulledByImageProgress: windowStat.particleCulledByImageProgressSum / Math.max(1, windowStat.frameCount),
            particleCulledBySkipNonHero: windowStat.particleCulledBySkipNonHeroSum / Math.max(1, windowStat.frameCount),
            particleOffscreenCount: windowStat.particleOffscreenCountSum / Math.max(1, windowStat.frameCount),
            particleTooSmallToReadCount: windowStat.particleTooSmallToReadCountSum / Math.max(1, windowStat.frameCount),
            particleLowAlphaCount: windowStat.particleLowAlphaCountSum / Math.max(1, windowStat.frameCount),
            particleLowContrastCount: windowStat.particleLowContrastCountSum / Math.max(1, windowStat.frameCount),
            particleVisibleCount: windowStat.particleVisibleCountSum / Math.max(1, windowStat.frameCount),
            particleVisibleRatio: windowStat.particleVisibleCountSum / Math.max(1, windowStat.particleRenderedCountSum || 1),
            heroParticleRenderedCount: windowStat.heroParticleRenderedCountSum / Math.max(1, windowStat.frameCount),
            supportParticleRenderedCount: windowStat.supportParticleRenderedCountSum / Math.max(1, windowStat.frameCount),
            backgroundParticleRenderedCount: windowStat.backgroundParticleRenderedCountSum / Math.max(1, windowStat.frameCount),
            subEmitterTriggerCount: windowStat.subEmitterTriggerCountSum / Math.max(1, windowStat.frameCount),
            subEmitterChildSpawnedCount: windowStat.subEmitterChildSpawnedCountSum / Math.max(1, windowStat.frameCount),
            edgeDeathEligibleCount: windowStat.edgeDeathEligibleCountSum / Math.max(1, windowStat.frameCount),
            edgeDeathTriggeredCount: windowStat.edgeDeathTriggeredCountSum / Math.max(1, windowStat.frameCount),
            edgeDeathPlayedCount: windowStat.edgeDeathPlayedCountSum / Math.max(1, windowStat.frameCount),
            edgeDeathSkippedByCostCount: windowStat.edgeDeathSkippedByCostCountSum / Math.max(1, windowStat.frameCount),
            edgeDeathEffectId: [...windowStat.edgeDeathEffectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
            edgeDeathCostTier: [...windowStat.edgeDeathCostTierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as RenderImageWindowStat["edgeDeathCostTier"],
            edgeExitFramesAvg: windowStat.edgeExitFramesAvgSum / Math.max(1, windowStat.frameCount),
            edgeExitDistanceAvg: windowStat.edgeExitDistanceAvgSum / Math.max(1, windowStat.frameCount),
            nodeIntent: renderer.getLastNodeIntent(),
            episodeIntent: renderer.getLastEpisodeIntent(),
            heroArchetype: renderer.getLastHeroArchetype(),
            heroStoryBeat: renderer.getLastHeroStoryBeat(),
            heroEmissionMode: renderer.getLastHeroEmissionMode(),
            subEmitterMode: renderer.getLastSubEmitterMode(),
            heroPrimitive: renderer.getLastHeroPrimitive(),
            heroShellMode: renderer.getLastHeroShellMode(),
            heroBaseShellMode: renderer.getLastHeroBaseShellMode(),
            heroResolvedShellMode: renderer.getLastHeroResolvedShellMode(),
            heroCircleShellEligible: renderer.getLastHeroCircleShellEligible(),
            heroCircleShellPromoted: renderer.getLastHeroCircleShellPromoted(),
          });
            if (telemetryMode === "summary") {
              return {
                imageIndex: finalizedWindow.imageIndex,
                windowKey: finalizedWindow.windowKey,
                chunkIndex: finalizedWindow.chunkIndex,
                firstFrameIndex: finalizedWindow.firstFrameIndex,
                startSec: finalizedWindow.startSec,
                endSec: finalizedWindow.endSec,
                fastMode: finalizedWindow.fastMode,
                requestedImageIndex: finalizedWindow.requestedImageIndex,
                resolvedImageIndex: finalizedWindow.resolvedImageIndex,
                themeImagePath: finalizedWindow.themeImagePath,
                frameCount: finalizedWindow.frameCount,
                averageLuminance: finalizedWindow.averageLuminance,
                minLuminance: finalizedWindow.minLuminance,
                blackFrameCount: finalizedWindow.blackFrameCount,
                averageDbOverall: finalizedWindow.averageDbOverall,
                averagePulseScale: finalizedWindow.averagePulseScale,
                heroCoverage: finalizedWindow.heroCoverage,
                heroTrailOccupancy: finalizedWindow.heroTrailOccupancy,
                eventDensity: finalizedWindow.eventDensity,
                transitionTriggerMode: finalizedWindow.transitionTriggerMode,
                heldTransitionCount: finalizedWindow.heldTransitionCount,
                swapTransitionCount: finalizedWindow.swapTransitionCount,
                supportCoverage: finalizedWindow.supportCoverage,
                supportNearHeroScore: finalizedWindow.supportNearHeroScore,
                edgeHighlightPenalty: finalizedWindow.edgeHighlightPenalty,
                edgeDominanceMargin: finalizedWindow.edgeDominanceMargin,
                deadCenterVoidScore: finalizedWindow.deadCenterVoidScore,
                focalReinforcementScore: finalizedWindow.focalReinforcementScore,
                fallbackRenderMode: finalizedWindow.fallbackRenderMode,
                fallbackReason: finalizedWindow.fallbackReason,
                fallbackTriggerCount: finalizedWindow.fallbackTriggerCount,
                fallbackSeverity: finalizedWindow.fallbackSeverity,
                compositionModeReason: finalizedWindow.compositionModeReason,
                particleTelemetryAvailable: finalizedWindow.particleTelemetryAvailable,
                visibleFallbackRisk: finalizedWindow.visibleFallbackRisk,
                diagnosticCompleteness: finalizedWindow.diagnosticCompleteness,
                diagnosticMissingFields: finalizedWindow.diagnosticMissingFields,
                diagnosticFailureReason: finalizedWindow.diagnosticFailureReason,
                effectVisibleFrameRatio: finalizedWindow.effectVisibleFrameRatio,
                effectVisiblePixelRatioAvg: finalizedWindow.effectVisiblePixelRatioAvg,
                effectLuminanceDeltaAvg: finalizedWindow.effectLuminanceDeltaAvg,
                effectMotionDeltaAvg: finalizedWindow.effectMotionDeltaAvg,
                effectVisibilityScore: finalizedWindow.effectVisibilityScore,
                focalQuadrant: finalizedWindow.focalQuadrant,
                heroQuadrant: finalizedWindow.heroQuadrant,
                brightestBlobQuadrant: finalizedWindow.brightestBlobQuadrant,
                visualRegime: finalizedWindow.visualRegime,
                transitionFamily: finalizedWindow.transitionFamily,
                compositionMode: finalizedWindow.compositionMode,
              };
            }
            return finalizedWindow;
          },
        ),
    };
    port.postMessage(done);
  };

  port.on("message", (message: RenderWorkerControlMessage) => {
    void handleMessage(message).catch((error) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    });
  });
}

if (parentPort) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
/* c8 ignore stop */
