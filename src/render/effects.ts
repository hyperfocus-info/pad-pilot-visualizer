import { clamp } from "../config";
import { hashFloat, sampleNoise2D } from "./noise";
import { paletteColor } from "./palette";
import type {
  ActiveSubjectSnapshot,
  AudioFrameFeature,
  CompositionPlan,
  DiagnosticOverrides,
  OverlayMode,
  RenderQualityBudget,
  RenderTheme,
  VisualSafetyMetrics,
  VisualState,
} from "../types";

export interface FrameEffectState {
  backgroundOpacity: number;
  renderCompositeOperation: GlobalCompositeOperation;
  renderFilter: string;
  overlayModeUsed: OverlayMode;
  overlayOpacityEstimate: number;
  overlayCompositeMode: string;
  effectVisiblePixelRatioEstimate: number;
  effectVisible: boolean;
  qualityBudget: RenderQualityBudget;
}

export interface FinalizedFrameEffectState {
  overlayOpacityEstimate: number;
  overlayCompositeMode: string;
  effectVisiblePixelRatioEstimate: number;
  effectVisible: boolean;
}

export function buildEffectBudget(
  visualState: VisualState,
  width: number,
  height: number,
  frame: AudioFrameFeature,
  fastMode: boolean,
  diagnosticOverrides?: DiagnosticOverrides,
): RenderQualityBudget {
  const pixelCount = width * height;
  const highLoad = pixelCount >= 1920 * 1080 || frame.motionEnergy > 1.05;
  const momentumScore = frame.bandWeightedScore ?? frame.dbNormalized;
  const calmFrame = momentumScore < 0.28 && frame.peakStrength < 0.28 && visualState.regime !== "drop" && visualState.regime !== "build";
  switch (visualState.effectPolicy) {
    case "aggressive":
      return applyOverrideBudget({
        fastMode,
        effectPasses: highLoad ? 2 : 3,
        feedbackSlices: highLoad ? 3 : 4,
        scanSliceHeight: highLoad ? 34 : 30,
        fullFrameFeedbackAlpha: 0.12,
        particleLimitScale: highLoad ? 0.92 : 1,
        occupancyLimitScale: highLoad ? 0.9 : 1,
        transitionDetailScale: highLoad ? 0.9 : 1,
        budgetDowngradeCount: highLoad ? 3 : 0,
        adaptiveDegradeLevel: 0,
        transitionBudgetTier: "full",
        skipFullFrameFeedback: false,
        skipFeedbackTintPasses: false,
        skipOverlayExtras: false,
        skipFadeWash: false,
      }, diagnosticOverrides);
    case "safe":
      return applyOverrideBudget({
        fastMode,
        effectPasses: 1,
        feedbackSlices: 2,
        scanSliceHeight: 34,
        fullFrameFeedbackAlpha: 0.07,
        particleLimitScale: 0.88,
        occupancyLimitScale: 0.86,
        transitionDetailScale: 0.82,
        budgetDowngradeCount: 2,
        adaptiveDegradeLevel: 0,
        transitionBudgetTier: "trimmed",
        skipFullFrameFeedback: false,
        skipFeedbackTintPasses: false,
        skipOverlayExtras: false,
        skipFadeWash: false,
      }, diagnosticOverrides);
    case "balanced":
    default:
      return applyOverrideBudget({
        fastMode,
        effectPasses: highLoad ? 1 : 2,
        feedbackSlices: calmFrame ? 0 : highLoad ? 1 : 2,
        scanSliceHeight: highLoad ? 34 : 32,
        fullFrameFeedbackAlpha: calmFrame ? 0.04 : highLoad ? 0.07 : 0.085,
        particleLimitScale: highLoad ? 0.95 : 1,
        occupancyLimitScale: highLoad ? 0.92 : 1,
        transitionDetailScale: highLoad ? 0.9 : 1,
        budgetDowngradeCount: calmFrame ? 1 : highLoad ? 3 : 0,
        adaptiveDegradeLevel: 0,
        transitionBudgetTier: highLoad ? "trimmed" : "full",
        skipFullFrameFeedback: false,
        skipFeedbackTintPasses: false,
        skipOverlayExtras: false,
        skipFadeWash: false,
      }, diagnosticOverrides);
  }
}

function applyOverrideBudget(baseBudget: RenderQualityBudget, diagnosticOverrides?: DiagnosticOverrides): RenderQualityBudget {
  if (!diagnosticOverrides?.disableBudgetDowngrades) {
    return baseBudget;
  }
  return {
    ...baseBudget,
    particleLimitScale: 1,
    occupancyLimitScale: 1,
    transitionDetailScale: 1,
    budgetDowngradeCount: 0,
  };
}

function tintCanvas(
  target: CanvasRenderingContext2D,
  source: any,
  scratch: CanvasRenderingContext2D,
  width: number,
  height: number,
  tint: string,
  dx: number,
  dy: number,
  alpha: number,
): void {
  scratch.clearRect(0, 0, width, height);
  scratch.globalCompositeOperation = "source-over";
  scratch.drawImage(source, 0, 0, width, height);
  scratch.globalCompositeOperation = "source-atop";
  scratch.fillStyle = tint;
  scratch.fillRect(0, 0, width, height);
  target.save();
  target.globalAlpha = alpha;
  target.drawImage((scratch.canvas as unknown) as CanvasImageSource, dx, dy, width, height);
  target.restore();
}

function drawLissajousOverlay(
  ctx: CanvasRenderingContext2D,
  frame: AudioFrameFeature,
  width: number,
  height: number,
  activeSubject?: ActiveSubjectSnapshot,
): void {
  ctx.save();
  ctx.translate(activeSubject?.x ?? width * 0.5, activeSubject?.y ?? height * 0.5);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const radius = Math.min(width, height) * (activeSubject ? 0.11 + activeSubject.emphasis * 0.08 : 0.18);
  for (let step = 0; step <= 80; step += 1) {
    const t = frame.timeSec * 1.6 + step * 0.08;
    const x = Math.sin(t * 2.1) * radius;
    const y = Math.cos(t * 3.2) * radius;
    if (step === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawMoireOverlay(ctx: CanvasRenderingContext2D, frame: AudioFrameFeature, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 0.7;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const offset = Math.sin(frame.timeSec * 0.8) * 32;
  for (let radius = 20; radius < Math.min(width, height) * 0.36; radius += 18) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + offset, cy - offset * 0.4, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWarpStars(
  ctx: CanvasRenderingContext2D,
  frame: AudioFrameFeature,
  width: number,
  height: number,
  activeSubject?: ActiveSubjectSnapshot,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(230,240,255,0.14)";
  ctx.lineWidth = 1;
  const cx = activeSubject?.x ?? width * 0.5;
  const cy = activeSubject?.y ?? height * 0.5;
  for (let index = 0; index < 70; index += 1) {
    const seed = Math.floor(frame.timeSec * 60) * 101 + index * 17;
    const angle = hashFloat(seed) * Math.PI * 2;
    const depth = 0.15 + hashFloat(seed + 7) * 0.85;
    const radius = depth * Math.min(width, height) * 0.42;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    const streak = 8 + depth * 26;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(angle) * streak, py + Math.sin(angle) * streak);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlowFieldOverlay(
  ctx: CanvasRenderingContext2D,
  frame: AudioFrameFeature,
  width: number,
  height: number,
  activeSubject?: ActiveSubjectSnapshot,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 0.8;
  const focalY = activeSubject?.y ?? height * 0.5;
  for (let index = 0; index < 120; index += 1) {
    const x = hashFloat(index * 31) * width;
    const baseY = hashFloat(index * 73) * height;
    const y = clamp(baseY * 0.3 + focalY * 0.7 + Math.sin(index * 0.3 + frame.timeSec) * 24, 0, height);
    const angle = sampleNoise2D(x * 0.004 + frame.timeSec * 0.2, y * 0.004, index) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10);
    ctx.stroke();
  }
  ctx.restore();
}

export function prepareFrameEffect(params: {
  ctx: CanvasRenderingContext2D;
  feedbackCtx: CanvasRenderingContext2D;
  scratchCtx: CanvasRenderingContext2D;
  feedbackSource: any;
  width: number;
  height: number;
  frame: AudioFrameFeature;
  theme: RenderTheme;
  compositionPlan: CompositionPlan;
  visualState: VisualState;
  reset: boolean;
  lowConfidenceMask: boolean;
  legibilityRecoveryWindow: boolean;
  qualityBudget: RenderQualityBudget;
}): FrameEffectState {
  const { ctx, feedbackCtx, scratchCtx, feedbackSource, width, height, frame, theme, visualState, reset, lowConfidenceMask, legibilityRecoveryWindow, qualityBudget } = params;
  const momentumScore = frame.bandWeightedScore ?? frame.dbNormalized;
  if (reset) {
    ctx.clearRect(0, 0, width, height);
    feedbackCtx.clearRect(0, 0, width, height);
  }

  let overlayModeUsed = visualState.overlayMode;
  if (lowConfidenceMask || legibilityRecoveryWindow) {
    if (legibilityRecoveryWindow) {
      overlayModeUsed =
        overlayModeUsed === "pulse-wave" || overlayModeUsed === "climax-burst"
          ? "kinetic-scan"
          : overlayModeUsed === "sparse-contour"
            ? (momentumScore > 0.24 || frame.normalizedHigh > 0.34 ? "kinetic-scan" : "stable-feedback")
            : overlayModeUsed;
      if (overlayModeUsed === "kinetic-scan" && momentumScore < 0.2 && frame.normalizedHigh < 0.22) {
        overlayModeUsed = "stable-feedback";
      }
    } else if (overlayModeUsed === "climax-burst") {
      overlayModeUsed =
        momentumScore > 0.58
            ? "pulse-wave"
          : momentumScore < 0.28
              ? "sparse-contour"
              : "kinetic-scan";
    } else if (overlayModeUsed === "kinetic-scan") {
      overlayModeUsed = frame.normalizedHigh > 0.55 ? "pulse-wave" : "kinetic-scan";
    }
  }
  let backgroundOpacity = 1;
  let renderCompositeOperation: GlobalCompositeOperation = "source-over";
  let renderFilter = "none";
  let overlayOpacityEstimate = 0.08;
  let effectVisiblePixelRatioEstimate = 0.08;
  let effectVisible = false;

  switch (overlayModeUsed) {
    case "stable-feedback": {
      if (
        !qualityBudget.skipFeedbackTintPasses &&
        (frame.normalizedHigh > 0.28 || frame.normalizedLow > 0.38) &&
        qualityBudget.effectPasses > 0
      ) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        tintCanvas(ctx, feedbackSource, scratchCtx, width, height, "rgba(80,210,255,0.10)", Math.sin(frame.timeSec * 1.9) * 2, 0, 0.08);
        if (qualityBudget.effectPasses > 2) {
          tintCanvas(ctx, feedbackSource, scratchCtx, width, height, "rgba(255,90,120,0.10)", -Math.cos(frame.timeSec * 1.4) * 3, Math.sin(frame.timeSec * 1.1) * 2, 0.1);
        }
        ctx.restore();
      }
      backgroundOpacity = qualityBudget.feedbackSlices === 0 ? 1 : 0.94;
      overlayOpacityEstimate = qualityBudget.fullFrameFeedbackAlpha + frame.normalizedLow * 0.03;
      effectVisiblePixelRatioEstimate = qualityBudget.feedbackSlices === 0 ? 0.1 : 0.18 + frame.normalizedLow * 0.12;
      effectVisible = qualityBudget.feedbackSlices > 0 && overlayOpacityEstimate >= 0.08;
      break;
    }
    case "pulse-wave":
      if (!qualityBudget.skipFadeWash) {
        ctx.fillStyle = "rgba(0,0,0,0.035)";
        ctx.fillRect(0, 0, width, height);
      }
      backgroundOpacity = 0.24;
      overlayOpacityEstimate = 0.08 + frame.peakStrength * 0.12;
      effectVisiblePixelRatioEstimate = 0.14 + frame.peakStrength * 0.18;
      effectVisible = overlayOpacityEstimate >= 0.1 || frame.peakStrength >= 0.34;
      break;
    case "kinetic-scan":
      if (!qualityBudget.skipFeedbackTintPasses) {
        ctx.globalCompositeOperation = "lighter";
        tintCanvas(ctx, feedbackSource, scratchCtx, width, height, "rgba(255,60,60,0.22)", -3, 0, 0.5);
        tintCanvas(ctx, feedbackSource, scratchCtx, width, height, "rgba(80,120,255,0.22)", 0, 2, 0.46);
        ctx.globalCompositeOperation = "source-over";
      }
      backgroundOpacity = 0.52;
      overlayOpacityEstimate = 0.14 + frame.normalizedHigh * 0.1;
      effectVisiblePixelRatioEstimate = 0.18 + frame.normalizedHighMid * 0.16;
      effectVisible = overlayOpacityEstimate >= 0.14;
      break;
    case "climax-burst":
      if (qualityBudget.effectPasses > 0) {
        ctx.save();
        ctx.filter = "blur(3px) contrast(180%)";
        ctx.drawImage(feedbackSource, 0, 0, width, height);
        ctx.restore();
      }
      renderCompositeOperation = "screen";
      backgroundOpacity = 0.88;
      overlayOpacityEstimate = 0.18 + frame.normalizedLow * 0.08;
      effectVisiblePixelRatioEstimate = 0.22 + frame.normalizedLow * 0.18;
      effectVisible = true;
      break;
    case "sparse-contour":
      ctx.fillStyle = "rgba(0,0,0,0.028)";
      ctx.fillRect(0, 0, width, height);
      backgroundOpacity = 0.34;
      overlayOpacityEstimate = Math.max(
        visualState.regime === "intro" ? 0.09 : momentumScore < 0.22 ? 0.11 : 0.06,
        0.06 + frame.normalizedHigh * 0.05,
      );
      effectVisiblePixelRatioEstimate = 0.1 + frame.normalizedHigh * 0.08;
      effectVisible = overlayOpacityEstimate >= 0.09 || frame.normalizedHigh >= 0.28;
      break;
  }

  return {
    backgroundOpacity,
    renderCompositeOperation,
    renderFilter,
    overlayModeUsed,
    overlayOpacityEstimate: clamp(overlayOpacityEstimate, 0, 1),
    overlayCompositeMode: renderCompositeOperation,
    effectVisiblePixelRatioEstimate: clamp(effectVisiblePixelRatioEstimate, 0, 1),
    effectVisible,
    qualityBudget,
  };
}

export function finalizeFrameEffect(params: {
  ctx: CanvasRenderingContext2D;
  feedbackSource: any;
  scratchCtx: CanvasRenderingContext2D;
  width: number;
  height: number;
  frame: AudioFrameFeature;
  theme: RenderTheme;
  compositionPlan: CompositionPlan;
  visualState: VisualState;
  safetyMetrics: VisualSafetyMetrics;
  activeSubject?: ActiveSubjectSnapshot;
  qualityBudget: RenderQualityBudget;
}): FinalizedFrameEffectState {
  const { ctx, feedbackSource, scratchCtx, width, height, frame, theme, compositionPlan, visualState, safetyMetrics, activeSubject, qualityBudget } = params;
  const momentumScore = frame.bandWeightedScore ?? frame.dbNormalized;
  const overlayMode = safetyMetrics.overlayModeUsed ?? visualState.overlayMode;

  switch (overlayMode) {
    case "pulse-wave": {
      if (qualityBudget.skipOverlayExtras && frame.peakStrength < 0.3 && momentumScore < 0.34) {
        break;
      }
      const ringCount = frame.peakStrength > 0.5 ? 4 : 3;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(255,255,255,${0.03 + frame.peakStrength * 0.08})`;
      const pulse = 40 + frame.peakStrength * 80;
      for (let index = 0; index < ringCount; index += 1) {
        ctx.beginPath();
        ctx.arc(
          activeSubject?.x ?? width * (0.2 + 0.12 * index),
          activeSubject ? activeSubject.y + Math.sin(frame.timeSec + index) * (14 + activeSubject.emphasis * 10) : height * (0.25 + 0.1 * Math.sin(frame.timeSec + index)),
          pulse * (0.6 + index * 0.08),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "stable-feedback": {
      if (qualityBudget.feedbackSlices === 0 || qualityBudget.skipFullFrameFeedback) {
        break;
      }
      ctx.save();
      scratchCtx.drawImage(feedbackSource, 0, 0, width, height);
      ctx.globalCompositeOperation = "screen";
      const fullTransitionAlphaScale = visualState.transitionFamily === "flash" || visualState.overlayMode === "pulse-wave" ? 0.8 : 1;
      ctx.globalAlpha = (qualityBudget.fullFrameFeedbackAlpha + frame.normalizedLow * 0.03) * fullTransitionAlphaScale;
      ctx.translate(width * 0.5, height * 0.5);
      const slices = qualityBudget.feedbackSlices;
      const spin = 0.06 + frame.normalizedLow * 0.04;
      for (let slice = 0; slice < slices; slice += 1) {
        ctx.save();
        ctx.rotate(spin * (slice % 2 === 0 ? 1 : -1) + (slice / slices) * Math.PI * 0.35);
        const scale = 1 + (slice + 1) * (0.015 + frame.normalizedLow * 0.006 + frame.normalizedHigh * 0.004);
        ctx.scale(scale, scale);
        ctx.drawImage((scratchCtx.canvas as unknown) as CanvasImageSource, -width * 0.5, -height * 0.5, width, height);
        ctx.restore();
      }
      ctx.restore();
      if (
        activeSubject &&
        !qualityBudget.skipOverlayExtras &&
        qualityBudget.effectPasses > 1 &&
        (frame.normalizedLow > 0.4 || frame.normalizedHigh > 0.34)
      ) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const wash = ctx.createRadialGradient(
          compositionPlan.heroCenterX,
          compositionPlan.heroCenterY,
          0,
          compositionPlan.heroCenterX,
          compositionPlan.heroCenterY,
          Math.min(width, height) * 0.34,
        );
        wash.addColorStop(0, paletteColor(theme, frame.timeSec * 0.18, 0.08 + frame.normalizedHigh * 0.05, 16));
        wash.addColorStop(0.5, paletteColor(theme, 0.5 + frame.timeSec * 0.12, 0.05 + frame.normalizedLow * 0.05, 6));
        wash.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
      break;
    }
    case "kinetic-scan": {
      if (qualityBudget.feedbackSlices === 0 || qualityBudget.skipFullFrameFeedback) {
        break;
      }
      scratchCtx.drawImage(feedbackSource, 0, 0, width, height);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.144 + frame.normalizedHigh * 0.096;
      const sliceHeight = qualityBudget.scanSliceHeight;
      const amplitude = 18 + frame.normalizedLowMid * 22;
      const focalY = activeSubject?.y ?? compositionPlan.heroCenterY;
      const focalRangeScale = qualityBudget.skipOverlayExtras ? 0.18 : 0.26;
      const focalMinY = Math.max(0, focalY - height * focalRangeScale);
      const focalMaxY = Math.min(height, focalY + height * focalRangeScale);
      for (let y = focalMinY; y < focalMaxY; y += sliceHeight) {
        const bandEmphasis = 1 - Math.min(1, Math.abs(y - focalY) / Math.max(1, height * 0.28));
        const offset = Math.sin(y * 0.04 + frame.timeSec * 3.2) * amplitude * (0.6 + bandEmphasis * 0.9);
        ctx.drawImage((scratchCtx.canvas as unknown) as CanvasImageSource, 0, y, width, sliceHeight, offset, y, width, sliceHeight);
      }
      ctx.restore();
      if (!qualityBudget.skipOverlayExtras && qualityBudget.effectPasses > 1) {
        drawFlowFieldOverlay(ctx, frame, width, height, activeSubject);
      }
      if (activeSubject && !qualityBudget.skipOverlayExtras && qualityBudget.effectPasses > 1) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.08 + frame.normalizedHigh * 0.1;
        for (let i = 0; i < 3; i += 1) {
          ctx.strokeStyle = paletteColor(theme, frame.timeSec * 0.2 + i * 0.16, 0.09, 14);
          ctx.lineWidth = 1 + i * 0.6;
          ctx.beginPath();
          ctx.ellipse(
            activeSubject.x,
            activeSubject.y,
            (26 + i * 20) * (1 + frame.normalizedLow * 0.5),
            (14 + i * 10) * (1 + frame.normalizedHigh * 0.5),
            frame.timeSec * 0.8 + i * 0.3,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case "climax-burst": {
      if (!qualityBudget.skipFullFrameFeedback) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (let i = 0; i < qualityBudget.effectPasses; i += 1) {
          const scale = 1 + (i + 1) * (0.012 + frame.normalizedLow * 0.008);
          const alpha = 0.05 + frame.normalizedLow * 0.04 - i * 0.01;
          ctx.globalAlpha = clamp(alpha, 0.02, 0.14);
          ctx.drawImage(
            feedbackSource,
            width * (1 - scale) * 0.5,
            height * (1 - scale) * 0.5,
            width * scale,
            height * scale,
          );
        }
        ctx.restore();
      }
      drawWarpStars(ctx, frame, width, height, activeSubject);
      if (!qualityBudget.skipOverlayExtras && qualityBudget.effectPasses > 1) {
        drawLissajousOverlay(ctx, frame, width, height, activeSubject);
      }
      if (activeSubject && !qualityBudget.skipFullFrameFeedback && !qualityBudget.skipOverlayExtras && qualityBudget.effectPasses > 1) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.07 + frame.normalizedLow * 0.09;
        for (let i = 0; i < Math.min(qualityBudget.effectPasses + 1, 2); i += 1) {
          const scale = 0.75 + i * 0.14 + frame.peakStrength * 0.18;
          ctx.translate(activeSubject.x, activeSubject.y);
          ctx.rotate(frame.timeSec * (0.3 + i * 0.08));
          ctx.scale(scale, scale);
          ctx.drawImage(feedbackSource, -activeSubject.x, -activeSubject.y, width, height);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        ctx.restore();
      }
      break;
    }
    case "sparse-contour": {
      if (!qualityBudget.skipFullFrameFeedback) {
        scratchCtx.drawImage(feedbackSource, 0, 0, width, height);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = clamp(0.1 - frame.normalizedLow * 0.02, 0.05, 0.12);
        const meltSpeed = 4 + frame.normalizedLowMid * 10;
        ctx.drawImage((scratchCtx.canvas as unknown) as CanvasImageSource, 0, meltSpeed, width, height, 0, 0, width, height);
        ctx.restore();
      }
      if (!qualityBudget.skipOverlayExtras) {
        drawMoireOverlay(ctx, frame, width, height);
      }
      break;
    }
    default:
      break;
  }

  const overlayOpacityEstimate =
    overlayMode === "pulse-wave" ? clamp(0.08 + frame.peakStrength * 0.12, 0, 1) :
    overlayMode === "kinetic-scan" ? clamp(0.14 + frame.normalizedHigh * 0.1, 0, 1) :
    overlayMode === "stable-feedback" ? clamp(qualityBudget.fullFrameFeedbackAlpha + frame.normalizedLow * 0.03, 0, 1) :
    overlayMode === "climax-burst" ? clamp(0.18 + frame.normalizedLow * 0.08, 0, 1) :
    clamp(0.06 + frame.normalizedHigh * 0.05, 0, 1);
  const effectVisiblePixelRatioEstimate =
    overlayMode === "pulse-wave" ? clamp(0.14 + frame.peakStrength * 0.18, 0, 1) :
    overlayMode === "kinetic-scan" ? clamp(0.18 + frame.normalizedHighMid * 0.16, 0, 1) :
    overlayMode === "stable-feedback" ? clamp((qualityBudget.feedbackSlices === 0 ? 0.1 : 0.18) + frame.normalizedLow * 0.12, 0, 1) :
    overlayMode === "climax-burst" ? clamp(0.22 + frame.normalizedLow * 0.18, 0, 1) :
    clamp(0.1 + frame.normalizedHigh * 0.08, 0, 1);
  const effectVisible =
    overlayMode === "climax-burst" ||
    overlayOpacityEstimate >= 0.12 ||
    effectVisiblePixelRatioEstimate >= 0.2;
  return {
    overlayOpacityEstimate,
    overlayCompositeMode: overlayMode === "stable-feedback" || overlayMode === "kinetic-scan" || overlayMode === "climax-burst" ? "screen" : "source-over",
    effectVisiblePixelRatioEstimate,
    effectVisible,
  };
}

export function effectOverlayTint(theme: RenderTheme, frame: AudioFrameFeature): string {
  return paletteColor(theme, (frame.timeSec * 0.1 + theme.effectiveEffectMode / 16) % 1, 0.08, 12);
}
