import type {
  DiagnosticReport,
  DiagnosticScoreBreakdown,
  DiagnosticSelector,
  GradeLabel,
  RenderChunkStat,
  RenderImageWindowStat,
} from "../types";

export function scoreToGrade(score: number): GradeLabel {
  if (score >= 94) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 80) return "B";
  return "C";
}

export function targetGradeFloor(grade: GradeLabel): number {
  switch (grade) {
    case "A": return 94;
    case "A-": return 90;
    case "B+": return 87;
    case "B": return 80;
    case "C":
    default: return 0;
  }
}

export function flattenWindows(renderChunks: RenderChunkStat[]): RenderImageWindowStat[] {
  return renderChunks.flatMap((chunk) => chunk.imageWindows ?? []).sort((a, b) => a.imageIndex - b.imageIndex);
}

export function buildDiagnosticBreakdown(
  windows: RenderImageWindowStat[],
  selector: DiagnosticSelector | undefined,
): DiagnosticScoreBreakdown {
  if (windows.length === 0) {
    return { visualScore: 0, responsivenessScore: 0, smokeGrade: "C", failingChecks: ["no-windows"] };
  }
  const heroCoverage = windows.reduce((sum, window) => sum + (window.heroCoverage ?? 0), 0) / windows.length;
  const clutter = windows.reduce((sum, window) => sum + (window.backgroundClutterRatio ?? 1), 0) / windows.length;
  const trailContinuity = windows.reduce((sum, window) => sum + (window.heroTrailOccupancy ?? 0), 0) / windows.length;
  const burstRichness = windows.reduce((sum, window) => sum + Math.min(1, ((window.heroBurstCount ?? 0) + (window.heroBurstChildren ?? 0) * 0.05)), 0) / windows.length;
  const motionEnergy = windows.reduce((sum, window) => sum + Math.min(1, ((window.heroMotorThrust ?? 0) * 0.35 + (window.heroMotorJitter ?? 0) * 8)), 0) / windows.length;
  const luminanceSafety = windows.reduce((sum, window) => {
    const minLum = window.minLuminance ?? 0;
    const blackRatio = (window.blackFrameCount ?? 0) / Math.max(1, window.frameCount);
    return sum + Math.max(0, Math.min(1, minLum * 8)) * Math.max(0, 1 - blackRatio * 3);
  }, 0) / windows.length;
  const visualScore =
    heroCoverage * 20 +
    Math.max(0, 1 - clutter) * 20 +
    motionEnergy * 20 +
    trailContinuity * 15 +
    luminanceSafety * 15 +
    burstRichness * 10;

  const responsivenessScore = windows.reduce((sum, window) => {
    const transitionCost = Math.max(0, 1 - (window.transitionAvgDurationFrames ?? 0) / 40);
    const carry = Math.min(1, window.transitionCarryStrength ?? 0);
    const pressure = Math.max(0, 1 - (window.safetyOverrideCount ?? 0) / 100);
    return sum + (transitionCost * 40 + carry * 30 + pressure * 30) / 100;
  }, 0) / windows.length * 100;

  const failingChecks: string[] = [];
  if (heroCoverage < 0.48) failingChecks.push("heroCoverage");
  if (clutter > 0.34) failingChecks.push("clutter");
  if (trailContinuity < 0.62) failingChecks.push("trailContinuity");
  if (windows.some((window) => (window.minLuminance ?? 0) < 0.07)) failingChecks.push("luminanceFloor");
  const multiHeroWindows = windows.filter((window) => (window.heroInstanceCountResolved ?? 1) > 1);
  if (multiHeroWindows.length > 0) {
    const readableRatio = multiHeroWindows.filter((window) => window.heroSeparationReadable).length / Math.max(1, multiHeroWindows.length);
    if (readableRatio < 0.45) failingChecks.push("multiHeroSeparation");
  }
  if (selector?.type === "transition" || selector?.type === "all-transitions") {
    if (windows.some((window) => (window.transitionAvgDurationFrames ?? 0) > 28)) failingChecks.push("transitionMs");
    if (windows.some((window) => (window.transitionCarryStrength ?? 0) < 0.55)) failingChecks.push("carrySmoothness");
  }

  const smokeGrade = scoreToGrade((visualScore * 0.65) + (responsivenessScore * 0.35));
  return { visualScore, responsivenessScore, smokeGrade, failingChecks };
}

export function buildDiagnosticReportFromChunks(
  renderChunks: RenderChunkStat[],
  selector: DiagnosticSelector | undefined,
): DiagnosticReport {
  const windows = flattenWindows(renderChunks);
  const breakdown = buildDiagnosticBreakdown(windows, selector);
  return {
    targetType: selector?.type ?? "node",
    targetId:
      selector?.type === "transition" ? `${selector.fromImageIndex ?? "?"}->${selector.toImageIndex ?? "?"}` :
      selector?.type === "phrase-window" ? `${selector.startSec ?? 0}-${selector.endSec ?? 0}` :
      selector?.type === "node" ? String(selector.imageIndex ?? selector.phraseIndex ?? 0) :
      selector?.type ?? "default",
    visualScore: breakdown.visualScore,
    responsivenessScore: breakdown.responsivenessScore,
    failingChecks: breakdown.failingChecks,
    nodeResults: windows.map((window) => ({
      selector: { type: "node", imageIndex: window.imageIndex, phraseIndex: window.imageIndex },
      visual: {
        imageIndex: window.imageIndex,
        heroCoverage: window.heroCoverage ?? 0,
        clutter: window.backgroundClutterRatio ?? 0,
        trailContinuity: window.heroTrailOccupancy ?? 0,
        motionEnergy: (window.heroMotorThrust ?? 0) * 0.4 + (window.heroMotorJitter ?? 0) * 4,
        burstRichness: Math.min(1, ((window.heroBurstCount ?? 0) + (window.heroBurstChildren ?? 0) * 0.05)),
        luminanceSafety: Math.min(1, (window.minLuminance ?? 0) * 8),
        score: breakdown.visualScore,
      },
      acceptancePassed: breakdown.failingChecks.length === 0,
    })),
    transitionResults: windows.slice(1).map((window, index) => ({
      selector: { type: "transition", fromImageIndex: windows[index]!.imageIndex, toImageIndex: window.imageIndex },
      performance: {
        fromImageIndex: windows[index]!.imageIndex,
        toImageIndex: window.imageIndex,
        transitionMs: (window.transitionAvgDurationFrames ?? 0),
        carrySmoothness: window.transitionCarryStrength ?? 0,
        nearBlackFrames: window.blackFrameCount ?? 0,
        budgetPressure: window.safetyOverrideCount ?? 0,
        score: breakdown.responsivenessScore,
      },
      acceptancePassed: breakdown.failingChecks.length === 0,
    })),
  };
}
