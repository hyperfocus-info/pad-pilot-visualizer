import { clamp } from "../config";
import type { AudioFrameFeature, BackgroundPlan, RenderTheme } from "../types";
import { paletteColor } from "./palette";

export interface BackgroundReactiveDrives {
  bpmDrive: number;
  minorImpactDrive: number;
  midTransitionDrive: number;
  peakColorDrive: number;
}

export interface BackgroundAccentStyle {
  color: string;
  colorfulnessScale: number;
  luminosityLift: number;
}

export function computeBackgroundReactiveDrives(frame: AudioFrameFeature, plan: BackgroundPlan): BackgroundReactiveDrives {
  const motionTuning = plan.motionTuning;
  const minorImpactMix = motionTuning?.minorImpactDriveMix ?? { onset: 0.45, peak: 0.35, highMid: 0.2 };
  const bpmDrive = clamp(frame.beatPulse * 0.7 + (frame.barPulse ?? 0) * 0.3, 0, Math.max(1, motionTuning?.bpmMotionFloor ?? 1));
  const minorImpactDrive = clamp(
    frame.onsetStrength * minorImpactMix.onset +
      frame.peakStrength * minorImpactMix.peak +
      frame.normalizedHighMid * minorImpactMix.highMid,
    0,
    Math.max(1, motionTuning?.minorImpactMotionFloor ?? 1),
  );
  const midTransitionDrive = clamp(bpmDrive * 0.45 + minorImpactDrive * 0.55, 0, 1);
  const peakColorDrive = clamp(
    frame.onsetStrength * 0.45 +
        frame.peakStrength * 0.35 +
        frame.normalizedHighMid * 0.2 +
        Math.max(0, (frame.bandWeightedScore ?? frame.dbNormalized) - 0.4) * 0.15,
      0,
      1,
  );
  return { bpmDrive, minorImpactDrive, midTransitionDrive, peakColorDrive };
}

export function computeBackgroundAccentStyle(
  theme: RenderTheme,
  frame: AudioFrameFeature,
  plan: BackgroundPlan,
  alpha: number,
  luminanceShift: number,
): BackgroundAccentStyle {
  const routing = plan.hzColorRouting;
  const offset =
    frame.normalizedSubLow * (routing?.subLow ?? 0.2) * 0.04 +
    frame.normalizedLow * (routing?.low ?? 0.3) * 0.08 +
    frame.normalizedMid * (routing?.mid ?? 0.4) * 0.14 +
    frame.normalizedHighMid * (routing?.highMid ?? 0.25) * 0.18 +
    frame.normalizedHigh * (routing?.high ?? 0.2) * 0.24;
  const colorTuning = plan.colorTuning;
  const baselineColorfulnessScale = colorTuning?.baselineColorfulnessScale ?? 1.1;
  const peakColorfulnessScale = colorTuning?.peakColorfulnessScale ?? 1.4;
  const peakColorEligible = colorTuning?.peakColorEligible ?? false;
  const alphaNorm = clamp((alpha - 0.04) / (0.24 - 0.04), 0, 1);
  const baseLuminosityLift =
    (colorTuning?.lowAlphaLuminosityLift ?? 0.39) +
    ((colorTuning?.highAlphaLuminosityLift ?? 0.126) - (colorTuning?.lowAlphaLuminosityLift ?? 0.39)) * alphaNorm;
  const { peakColorDrive } = computeBackgroundReactiveDrives(frame, plan);
  const lowBandLift = 1 + frame.normalizedLow * 0.4;
  const colorfulnessScale = peakColorEligible
    ? baselineColorfulnessScale + (peakColorfulnessScale - baselineColorfulnessScale) * peakColorDrive
    : baselineColorfulnessScale;
  return {
    color: paletteColor(
      theme,
      offset + frame.rainbowHueOffset * 0.0008,
      clamp(alpha * lowBandLift, 0, 1),
      luminanceShift + baseLuminosityLift * 10 * lowBandLift,
      colorfulnessScale,
    ),
    colorfulnessScale,
    luminosityLift: baseLuminosityLift * lowBandLift,
  };
}
