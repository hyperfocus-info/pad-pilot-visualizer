import { clamp } from "../config";
import type {
  ActiveSubjectMode,
  ActiveSubjectSnapshot,
  ActiveSubjectState,
  AudioFrameFeature,
  EdgeMap,
  HeroTravelStyle,
  SceneGraph,
  VisualState,
  VisualSafetyMetrics,
} from "../types";
import type { RollingDbWindowState } from "./motif-effects";
import { sampleSceneGraphPath } from "./scene-graph";

const BAND_HZ_WINDOWS = {
  low: { min: 38, max: 180 },
  lowMid: { min: 120, max: 480 },
  mid: { min: 300, max: 1800 },
  high: { min: 1200, max: 5200 },
} as const;

const SCREEN_EDGE_LABELS = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

type ScreenEdgeLabel = typeof SCREEN_EDGE_LABELS[number];

function resolveMode(
  frame: AudioFrameFeature,
  edgeMap: EdgeMap,
  visualState: VisualState,
): ActiveSubjectMode {
  switch (visualState.regime) {
    case "intro":
      return "hover";
    case "build":
      return "windup";
    case "drop":
      return edgeMap.maskConfidence === "low" || frame.peakStrength < 0.58 ? "orbit" : "strike";
    case "breakdown":
      return "ghost";
    case "outro":
      return "dissolve";
    case "groove":
    default:
      return "sway";
  }
}

function subjectRadius(edgeMap: EdgeMap): number {
  const width = edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX;
  const height = edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY;
  return clamp(Math.max(width, height) * 0.18, 44, Math.min(edgeMap.width, edgeMap.height) * 0.18);
}

function clampToSubject(edgeMap: EdgeMap, x: number, y: number, overshoot: number): { x: number; y: number } {
  return {
    x: clamp(x, edgeMap.subjectBounds.minX - overshoot, edgeMap.subjectBounds.maxX + overshoot),
    y: clamp(y, edgeMap.subjectBounds.minY - overshoot, edgeMap.subjectBounds.maxY + overshoot),
  };
}

function dominantBandEnergy(frame: AudioFrameFeature): number {
  switch (frame.dominantBand) {
    case "low":
      return frame.normalizedLow;
    case "lowMid":
      return frame.normalizedLowMid;
    case "mid":
      return frame.normalizedMid;
    case "high":
    default:
      return frame.normalizedHigh;
  }
}

function bandHzResponse(frame: AudioFrameFeature): {
  normalized: number;
  curved: number;
  centered: number;
  potency: number;
} {
  const window = BAND_HZ_WINDOWS[frame.dominantBand];
  const normalized = clamp((frame.dominantHz - window.min) / Math.max(1, window.max - window.min), 0, 1);
  const curved = Math.pow(normalized, 0.35);
  const centered = Math.sign(curved - 0.5) * Math.pow(Math.abs(curved - 0.5) * 2, 0.6);
  const potency = 1 + Math.pow(clamp(dominantBandEnergy(frame) + frame.onsetStrength * 0.35, 0, 1.25), 0.55) * 1.2;
  return { normalized, curved, centered, potency };
}

function motionTierForGrace(gracefulBias: number): "jump" | "glide" | "flourish" {
  if (gracefulBias < 0.25) {
    return "jump";
  }
  if (gracefulBias > 0.75) {
    return "flourish";
  }
  return "glide";
}

function flourishStrengthForGrace(gracefulBias: number): number {
  return clamp((gracefulBias - 0.75) / 0.25, 0, 1);
}

function deltaAngle(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

function jumpCooldownFramesForHz(normalizedHz: number): number {
  return Math.max(2, Math.round(10 + (2 - 10) * clamp(1 - normalizedHz, 0, 1)));
}

function chooseScreenEdgeLabel(
  frame: AudioFrameFeature,
  previous?: ScreenEdgeLabel,
): ScreenEdgeLabel {
  const seed =
    frame.frameIndex * 37 +
    Math.round(frame.dominantHz) * 3 +
    (frame.beatIndex ?? 0) * 17 +
    (frame.barIndex ?? 0) * 29 +
    Math.round(frame.onsetStrength * 100);
  const offset = ((seed % SCREEN_EDGE_LABELS.length) + SCREEN_EDGE_LABELS.length) % SCREEN_EDGE_LABELS.length;
  let candidate = SCREEN_EDGE_LABELS[offset]!;
  if (candidate === previous) {
    candidate = SCREEN_EDGE_LABELS[(offset + 3) % SCREEN_EDGE_LABELS.length]!;
  }
  return candidate;
}

function screenEdgeTarget(
  edgeMap: EdgeMap,
  radius: number,
  label: ScreenEdgeLabel,
  frame: AudioFrameFeature,
): { x: number; y: number } {
  const margin = clamp(radius * 0.6, 18, Math.min(edgeMap.width, edgeMap.height) * 0.08);
  const swingA = Math.sin(frame.timeSec * 0.8 + frame.dominantHz * 0.0021);
  const swingB = Math.cos(frame.timeSec * 1.1 + frame.dominantHz * 0.0017);
  const laneX = clamp(edgeMap.width * (0.5 + swingA * 0.34), margin, edgeMap.width - margin);
  const laneY = clamp(edgeMap.height * (0.5 + swingB * 0.3), margin, edgeMap.height - margin);
  switch (label) {
    case "left":
      return { x: margin, y: laneY };
    case "right":
      return { x: edgeMap.width - margin, y: laneY };
    case "top":
      return { x: laneX, y: margin };
    case "bottom":
      return { x: laneX, y: edgeMap.height - margin };
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: edgeMap.width - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: edgeMap.height - margin };
    case "bottom-right":
    default:
      return { x: edgeMap.width - margin, y: edgeMap.height - margin };
  }
}

function normalizedDbWeight(values: number[], current: number): number {
  if (values.length === 0) {
    return 0;
  }
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return clamp((current - min) / Math.max(1, max - min), 0, 1);
}

function bandDriveFromRolling(
  frame: AudioFrameFeature,
  rolling: RollingDbWindowState | undefined,
  band: HeroTravelStyle["warpXBand"],
): number {
  if (!rolling) {
    return 0;
  }
  switch (band) {
    case "subLow":
      return clamp(normalizedDbWeight(rolling.dbLow, frame.dbLow) * 1.08, 0, 1);
    case "low":
      return normalizedDbWeight(rolling.dbLow, frame.dbLow);
    case "mid":
      return normalizedDbWeight(rolling.dbMid, frame.dbMid);
    case "highMid":
      return normalizedDbWeight(rolling.dbHighMid, frame.dbHighMid);
    case "high":
    default:
      return normalizedDbWeight(rolling.dbHigh, frame.dbHigh);
  }
}

function resolveTravelStyle(
  frame: AudioFrameFeature,
  edgeMap: EdgeMap,
  sceneGraph: SceneGraph | undefined,
  visualState: VisualState,
): HeroTravelStyle {
  const base = sceneGraph?.heroInstanceSeed.travelStyle ?? {
    gracefulBias: 0.7,
    glitchBias: 0.3,
    pathSmoothing: 0.24,
    targetSmoothing: 0.22,
    warpProbability: 0.18,
    deformJitter: 0.28,
    landingIntent: 0.68,
    warpXBand: "mid",
    warpYBand: "highMid",
    warpXBaseMultiplier: 1.25,
    warpYBaseMultiplier: 1.25,
    warpXExtremeMultiplier: 2,
    warpYExtremeMultiplier: 2,
    lowDbMoveScale: 0.4,
    lowDbEmissionScale: 0.4,
    lowDbFreezeOnDrop: true,
    lowDbDropThreshold: 0.35,
  };
  let gracefulBias = base.gracefulBias;
  if (visualState.regime === "drop" && edgeMap.fractalMotif === "shattered-arc") {
    gracefulBias *= 0.45;
  } else if (visualState.regime === "build") {
    gracefulBias *= 0.9;
  } else if (visualState.regime === "breakdown" && sceneGraph?.heroMotifProfile.motionBias === "tightrope") {
    gracefulBias = clamp(gracefulBias + 0.08, 0, 1);
  }
  if (edgeMap.maskConfidence === "low") {
    gracefulBias = clamp(gracefulBias - 0.18, 0, 1);
  }
  if (frame.isPeak && sceneGraph?.heroMotifProfile.motionBias === "glitch-hop") {
    gracefulBias = clamp(gracefulBias - 0.24, 0, 1);
  }
  const glitchBias = clamp(1 - gracefulBias, 0, 1);
  return {
    gracefulBias,
    glitchBias,
    pathSmoothing: clamp(base.pathSmoothing + gracefulBias * 0.04 - glitchBias * 0.03, 0.16, 0.32),
    targetSmoothing: clamp(base.targetSmoothing + gracefulBias * 0.05 - glitchBias * 0.03, 0.14, 0.28),
    warpProbability: clamp(base.warpProbability + glitchBias * 0.14, 0.08, 0.74),
    deformJitter: clamp(base.deformJitter + glitchBias * 0.14, 0.12, 0.82),
    landingIntent: clamp(base.landingIntent + gracefulBias * 0.08, 0.28, 0.92),
    warpXBand: base.warpXBand,
    warpYBand: base.warpYBand,
    warpXBaseMultiplier: base.warpXBaseMultiplier,
    warpYBaseMultiplier: base.warpYBaseMultiplier,
    warpXExtremeMultiplier: base.warpXExtremeMultiplier,
    warpYExtremeMultiplier: base.warpYExtremeMultiplier,
    lowDbMoveScale: base.lowDbMoveScale,
    lowDbEmissionScale: base.lowDbEmissionScale,
    lowDbFreezeOnDrop: base.lowDbFreezeOnDrop,
    lowDbDropThreshold: base.lowDbDropThreshold,
  };
}

export function createActiveSubjectState(edgeMap: EdgeMap): ActiveSubjectState {
  return {
    x: edgeMap.focalCenterX,
    y: edgeMap.focalCenterY,
    targetX: edgeMap.focalCenterX,
    targetY: edgeMap.focalCenterY,
    filteredTargetX: edgeMap.focalCenterX,
    filteredTargetY: edgeMap.focalCenterY,
    vx: 0,
    vy: 0,
    radius: subjectRadius(edgeMap),
    emphasis: 0.22,
    gesturePhase: 0,
    mode: "hover",
    gracefulBias: 0.7,
    glitchBias: 0.3,
    targetSmoothing: 0.22,
    moveScale: 1,
    emissionScale: 1,
    lowDbFreezeActive: false,
    recentDbOverall: [],
    motionTier: "glide",
    flourishStrength: 0,
    jumpTriggered: false,
    jitterSuppressed: false,
    motionTierReadable: true,
    jumpCooldownFrames: 6,
    lastJumpFrame: -1000,
    lastJumpTargetEdge: "left",
    flourishSpinPhase: 0,
    flourishTwirlPhase: 0,
    flourishBouncePhase: 0,
    trail: [],
    lastPeakFrame: -1000,
    lastBeatFrame: -1000,
  };
}

export function updateActiveSubject(params: {
  state: ActiveSubjectState;
  frame: AudioFrameFeature;
  edgeMap: EdgeMap;
  sceneGraph?: SceneGraph;
  visualState: VisualState;
  imageProgress: number;
  safetyMetrics?: VisualSafetyMetrics;
  rollingDbWindow?: RollingDbWindowState;
  trackAverageDbOverall?: number;
}): ActiveSubjectSnapshot {
  const { state, frame, edgeMap, sceneGraph, visualState, imageProgress, safetyMetrics, rollingDbWindow, trackAverageDbOverall } = params;
  const previousX = state.x;
  const previousY = state.y;
  const travelStyle = resolveTravelStyle(frame, edgeMap, sceneGraph, visualState);
  const recentDbOverall = state.recentDbOverall ?? [];
  const recentDbMean = recentDbOverall.length > 0
    ? recentDbOverall.reduce((sum, value) => sum + value, 0) / recentDbOverall.length
    : frame.dbOverall;
  const belowAverageTrackDb =
    trackAverageDbOverall !== undefined &&
    Number.isFinite(trackAverageDbOverall) &&
    frame.dbOverall < trackAverageDbOverall;
  const fallingDb = frame.dbOverall <= recentDbMean - travelStyle.lowDbDropThreshold;
  const moveScale = belowAverageTrackDb ? travelStyle.lowDbMoveScale : 1;
  const emissionScale = belowAverageTrackDb ? travelStyle.lowDbEmissionScale : 1;
  const freezeTranslation = belowAverageTrackDb && fallingDb && travelStyle.lowDbFreezeOnDrop;
  let mode = resolveMode(frame, edgeMap, visualState);
  if (safetyMetrics?.recoveryActive && mode === "strike") {
    mode = "sway";
  }
  state.mode = mode;

  const baseRadius = subjectRadius(edgeMap);
  const confidenceScale = edgeMap.maskConfidence === "low" ? 0.58 : edgeMap.maskConfidence === "medium" ? 0.8 : 1;
  const overshoot = baseRadius * (edgeMap.maskConfidence === "low" ? 0.16 : 0.32);
  const beatHit = frame.beatPhase < 0.08 || frame.beatPulse > 0.84;
  const justPeaked = frame.isPeak || frame.peakStrength > 0.82;
  if (beatHit && frame.frameIndex - state.lastBeatFrame > 2) {
    state.lastBeatFrame = frame.frameIndex;
  }
  if (justPeaked) {
    state.lastPeakFrame = frame.frameIndex;
  }

  const phase = frame.timeSec * (0.8 + frame.motionEnvelope * 1.8) + imageProgress * Math.PI * 2;
  const anticipation = frame.beatPhase < 0.16 ? 1 - frame.beatPhase / 0.16 : 0;
  const pulse = clamp(frame.beatPulse * 0.7 + frame.peakStrength * 0.9 + frame.onsetStrength * 0.45, 0, 2.2);
  const hzResponse = bandHzResponse(frame);
  const motionTier = motionTierForGrace(travelStyle.gracefulBias);
  const flourishStrength = flourishStrengthForGrace(travelStyle.gracefulBias);
  const jumpCooldownFrames = jumpCooldownFramesForHz(hzResponse.normalized);
  state.motionTier = motionTier;
  state.flourishStrength = flourishStrength;
  state.jumpCooldownFrames = jumpCooldownFrames;
  state.jumpTriggered = false;
  state.jitterSuppressed = false;
  state.motionTierReadable = true;
  const hzSwing = hzResponse.centered;
  const hzPhase =
    frame.dominantBand === "low" ? hzResponse.curved * Math.PI * 1.3 :
    frame.dominantBand === "lowMid" ? hzResponse.curved * Math.PI * 2 :
    frame.dominantBand === "mid" ? hzResponse.curved * Math.PI * 2.8 :
    hzResponse.curved * Math.PI * 3.6;
  const bandSlideX =
    frame.dominantBand === "low" ? (Math.sin(phase * 0.9 + hzPhase) + hzSwing * 0.85) * baseRadius * 0.13 * hzResponse.potency :
    frame.dominantBand === "lowMid" ? (Math.cos(phase * 1.05 + hzPhase) + hzSwing * 0.75) * baseRadius * 0.115 * hzResponse.potency :
    frame.dominantBand === "mid" ? (Math.cos(phase * 1.2 + hzPhase) + hzSwing * 0.65) * baseRadius * 0.1 * hzResponse.potency :
    (Math.sin(phase * 2 + hzPhase) + hzSwing * 0.55) * baseRadius * 0.085 * hzResponse.potency;
  const bandSlideY =
    frame.dominantBand === "low" ? (Math.cos(phase * 1.1 + hzPhase * 1.4) + hzSwing) * baseRadius * 0.19 * hzResponse.potency :
    frame.dominantBand === "lowMid" ? (Math.sin(phase * 1.3 + hzPhase * 1.6) + hzSwing * 0.82) * baseRadius * 0.16 * hzResponse.potency :
    frame.dominantBand === "mid" ? (Math.sin(phase * 1.5 + hzPhase * 1.8) + hzSwing * 0.7) * baseRadius * 0.128 * hzResponse.potency :
    (Math.cos(phase * 2.2 + hzPhase * 2.2) + hzSwing * 0.58) * baseRadius * 0.1 * hzResponse.potency;
  const amplitudeBase = baseRadius * confidenceScale * (
    mode === "hover" ? 0.18 :
    mode === "sway" ? 0.48 :
    mode === "windup" ? 0.34 :
    mode === "strike" ? 0.72 :
    mode === "orbit" ? 0.62 :
    mode === "ghost" ? 0.26 :
    0.14
  );
  const amplitude = amplitudeBase * clamp(0.85 + pulse * 0.35, 0.7, 1.8) * moveScale;
  const pathProgressTarget = clamp(imageProgress + hzResponse.curved * 0.18 + frame.beatPulse * 0.06, 0, 0.999);
  const smoothedPathProgress = clamp(
    imageProgress + (pathProgressTarget - imageProgress) * travelStyle.pathSmoothing,
    0,
    0.999,
  );
  const pathPoint = sceneGraph ? sampleSceneGraphPath(sceneGraph, smoothedPathProgress) : undefined;
  let targetX = pathPoint?.x ?? edgeMap.focalCenterX;
  let targetY = pathPoint?.y ?? edgeMap.focalCenterY;

  switch (mode) {
    case "hover":
      targetX += Math.cos(phase * 0.7) * amplitude * 0.5;
      targetY += Math.sin(phase * 0.5) * amplitude * 0.4;
      break;
    case "sway":
      targetX += Math.sin(phase * 1.4) * amplitude;
      targetY += Math.cos(phase * 0.85) * amplitude * 0.46 - anticipation * amplitude * 0.12;
      break;
    case "windup":
      targetX += Math.cos(phase * 1.8) * amplitude * (0.25 + imageProgress * 0.45);
      targetY += Math.sin(phase * 1.8) * amplitude * 0.25 - anticipation * amplitude * 0.3;
      break;
    case "strike": {
      const direction = Math.sin(phase * 0.9) >= 0 ? 1 : -1;
      targetX += direction * amplitude * (0.45 + frame.peakStrength * 0.75);
      targetY += Math.sin(phase * 2.8) * amplitude * 0.22 - anticipation * amplitude * 0.24;
      break;
    }
    case "orbit":
      targetX += Math.cos(phase * 2.2) * amplitude;
      targetY += Math.sin(phase * 2.2) * amplitude * 0.68;
      break;
    case "ghost":
      targetX += Math.sin(phase * 0.62) * amplitude * 0.38;
      targetY += Math.cos(phase * 0.52) * amplitude * 0.64;
      break;
    case "dissolve":
      targetX += Math.cos(phase * 0.4) * amplitude * 0.3;
      targetY += Math.sin(phase * 0.35) * amplitude * 0.22;
      break;
  }

  if (motionTier === "jump" && !freezeTranslation) {
    const readyForJump = frame.frameIndex - (state.lastJumpFrame ?? -1000) >= jumpCooldownFrames;
    if (readyForJump) {
      const nextEdge = chooseScreenEdgeLabel(frame, state.lastJumpTargetEdge as ScreenEdgeLabel | undefined);
      const jumpTarget = screenEdgeTarget(edgeMap, baseRadius, nextEdge, frame);
      targetX = jumpTarget.x;
      targetY = jumpTarget.y;
      state.x = jumpTarget.x;
      state.y = jumpTarget.y;
      state.filteredTargetX = jumpTarget.x;
      state.filteredTargetY = jumpTarget.y;
      state.targetX = jumpTarget.x;
      state.targetY = jumpTarget.y;
      state.vx = 0;
      state.vy = 0;
      state.lastJumpFrame = frame.frameIndex;
      state.lastJumpTargetEdge = nextEdge;
      state.jumpTriggered = true;
    } else {
      targetX = state.targetX;
      targetY = state.targetY;
    }
  }

  const clampedTarget = clampToSubject(edgeMap, targetX, targetY, overshoot);
  const tangentSlideX = (pathPoint?.tangentX ?? 0) * baseRadius * 0.18 * hzResponse.centered * moveScale;
  const tangentSlideY = (pathPoint?.tangentY ?? 0) * baseRadius * 0.18 * hzResponse.centered * moveScale;
  const gracefulBandScale =
    motionTier === "jump" ? 0 :
    motionTier === "glide" ? 0.28 + travelStyle.gracefulBias * 0.16 :
    0.22 + travelStyle.gracefulBias * 0.2;
  const retargetBias =
    motionTier === "jump" ? 1 :
    motionTier === "glide" ? (frame.isBeatAccent || frame.isBarDownbeat || frame.isFourBarDownbeat ? 1 : 0.34) :
    0.82;
  let rawTargetX = clampedTarget.x + bandSlideX * gracefulBandScale * moveScale + tangentSlideX * (0.68 + travelStyle.glitchBias * 0.32);
  let rawTargetY = clampedTarget.y + bandSlideY * gracefulBandScale * moveScale + tangentSlideY * (0.68 + travelStyle.glitchBias * 0.32);
  if (motionTier === "flourish") {
    const spinPhase = phase * (1 + flourishStrength * 0.9) + hzPhase;
    const twirlPhase = phase * (1.3 + flourishStrength * 1.2) + hzPhase * 0.8;
    const bouncePhase = phase * (0.8 + flourishStrength * 0.6) + hzPhase * 0.3;
    state.flourishSpinPhase = spinPhase;
    state.flourishTwirlPhase = twirlPhase;
    state.flourishBouncePhase = bouncePhase;
    const twirlRadius = baseRadius * (0.06 + flourishStrength * 0.18) * (0.8 + frame.beatPulse * 0.4);
    rawTargetX += Math.cos(twirlPhase) * twirlRadius;
    rawTargetY += Math.sin(twirlPhase * 1.1) * twirlRadius * 0.7;
  }
  const filteredTargetDrift = Math.hypot(rawTargetX - state.filteredTargetX, rawTargetY - state.filteredTargetY);
  const currentVelocity = Math.hypot(state.vx, state.vy);
  const decorativeJitterOnly =
    motionTier !== "jump" &&
    !freezeTranslation &&
    !beatHit &&
    !justPeaked &&
    pulse < 0.38 &&
    filteredTargetDrift <= baseRadius * 0.12 &&
    currentVelocity <= baseRadius * 0.04;
  if (decorativeJitterOnly) {
    rawTargetX = clampedTarget.x + (rawTargetX - clampedTarget.x) * 0.24;
    rawTargetY = clampedTarget.y + (rawTargetY - clampedTarget.y) * 0.24;
    state.filteredTargetX += (clampedTarget.x - state.filteredTargetX) * 0.28;
    state.filteredTargetY += (clampedTarget.y - state.filteredTargetY) * 0.28;
    state.vx *= 0.42;
    state.vy *= 0.42;
    state.jitterSuppressed = true;
  }
  state.filteredTargetX += (rawTargetX - state.filteredTargetX) * travelStyle.targetSmoothing * retargetBias;
  state.filteredTargetY += (rawTargetY - state.filteredTargetY) * travelStyle.targetSmoothing * retargetBias;
  const warpEvent =
    (frame.isPeak || frame.isBarDownbeat) &&
    sceneGraph?.heroMotifProfile.motionBias === "glitch-hop" &&
    travelStyle.glitchBias > 0.5 &&
    Math.sin(frame.timeSec * 9.7 + hzPhase) > 1 - travelStyle.warpProbability * 0.5;
  const warpXDrive = bandDriveFromRolling(frame, rollingDbWindow, travelStyle.warpXBand);
  const warpYDrive = bandDriveFromRolling(frame, rollingDbWindow, travelStyle.warpYBand);
  const warpXMultiplier =
    travelStyle.warpXBaseMultiplier +
    (travelStyle.warpXExtremeMultiplier - travelStyle.warpXBaseMultiplier) * warpXDrive;
  const warpYMultiplier =
    travelStyle.warpYBaseMultiplier +
    (travelStyle.warpYExtremeMultiplier - travelStyle.warpYBaseMultiplier) * warpYDrive;
  const warpOffsetX = warpEvent ? Math.sin(phase * 2.6 + hzPhase) * baseRadius * 0.18 * travelStyle.glitchBias * warpXMultiplier : 0;
  const warpOffsetY = warpEvent ? Math.cos(phase * 2.2 + hzPhase) * baseRadius * 0.14 * travelStyle.glitchBias * warpYMultiplier : 0;
  state.targetX = state.filteredTargetX + warpOffsetX;
  state.targetY = state.filteredTargetY + warpOffsetY;

  const spring = (
    mode === "strike" ? 0.16 :
    mode === "windup" ? 0.13 :
    mode === "orbit" ? 0.12 :
    mode === "ghost" ? 0.065 :
    0.1
  ) * confidenceScale * clamp(0.9 + travelStyle.gracefulBias * 0.18, 0.84, 1.12);
  const damping = safetyMetrics?.recoveryActive
    ? 0.74
    : mode === "strike"
      ? 0.82
      : mode === "ghost"
        ? 0.88
        : 0.84;
  const directionalDx = state.targetX - state.x;
  const directionalDy = state.targetY - state.y;
  const directionalDistance = Math.hypot(directionalDx, directionalDy) || 1;
  const landingBlend = clamp(1 - directionalDistance / Math.max(1, baseRadius * 1.2), 0, 1) * travelStyle.landingIntent;
  const tightenedDamping = damping + landingBlend * 0.06 - travelStyle.glitchBias * 0.03;
  if (motionTier === "jump") {
    state.vx = 0;
    state.vy = 0;
  } else if (freezeTranslation) {
    state.vx = 0;
    state.vy = 0;
  } else {
    state.vx = (state.vx + directionalDx * spring * moveScale) * clamp(tightenedDamping, 0.72, 0.92);
    state.vy = (state.vy + directionalDy * spring * moveScale) * clamp(tightenedDamping, 0.72, 0.92);
    if (state.jitterSuppressed && Math.hypot(state.vx, state.vy) < 0.9) {
      state.vx = 0;
      state.vy = 0;
    }
    state.x += state.vx;
    state.y += state.vy;
  }

  const clampedPosition = clampToSubject(edgeMap, state.x, state.y, overshoot);
  state.x = clampedPosition.x;
  state.y = clampedPosition.y;
  state.gesturePhase = phase;
  state.gracefulBias = travelStyle.gracefulBias;
  state.glitchBias = travelStyle.glitchBias;
  state.targetSmoothing = travelStyle.targetSmoothing;
  state.moveScale = moveScale;
  state.emissionScale = emissionScale;
  state.lowDbFreezeActive = freezeTranslation;
  recentDbOverall.push(frame.dbOverall);
  if (recentDbOverall.length > 6) {
    recentDbOverall.shift();
  }
  state.recentDbOverall = recentDbOverall;
  state.radius = (pathPoint?.radius ?? baseRadius) * clamp(
    0.86 +
      frame.beatPulse * 0.22 +
      frame.peakStrength * (mode === "strike" ? 0.48 : 0.26) +
      (
        frame.dominantBand === "low" ? hzResponse.curved * 0.22 * hzResponse.potency :
        frame.dominantBand === "lowMid" ? hzResponse.curved * 0.18 * hzResponse.potency :
        frame.dominantBand === "mid" ? hzResponse.curved * 0.14 * hzResponse.potency :
        hzResponse.curved * 0.1 * hzResponse.potency
      ) +
      Math.abs(hzSwing) * 0.14 +
      (mode === "ghost" ? 0.24 : 0),
    0.78,
    1.72,
  );
  if (motionTier === "flourish") {
    const bounceScale = 1 + Math.abs(Math.sin(state.flourishBouncePhase ?? phase)) * (0.04 + flourishStrength * 0.16);
    state.radius *= bounceScale;
  }
    state.emphasis = clamp(
      0.18 +
      (frame.bandWeightedScore ?? frame.dbNormalized) * 0.18 +
      frame.motionEnvelope * 0.14 +
      frame.onsetStrength * 0.18 +
      frame.peakStrength * 0.28 +
      (mode === "windup" ? imageProgress * 0.15 : 0) +
      (mode === "orbit" ? 0.08 : 0) +
      (mode === "strike" ? 0.18 : 0),
    0.12,
    safetyMetrics?.recoveryActive ? 0.8 : 1.2,
  );

  const motionPx = Math.hypot(state.x - previousX, state.y - previousY);
  const centerHeading = Math.atan2(edgeMap.height * 0.5 - state.y, (edgeMap.width * 0.5 - state.x) || 0.001);
  const centerHeadingDelta = Math.abs(deltaAngle(Math.atan2(state.vy, state.vx || 0.001), centerHeading));
  const idleMicroJitter =
    motionPx > 0.2 &&
    motionPx < Math.max(2.4, baseRadius * 0.022) &&
    !beatHit &&
    !justPeaked &&
    pulse < 0.36;
  state.motionTierReadable =
    motionTier === "jump"
      ? state.jumpTriggered || motionPx >= baseRadius * 0.2
      : motionTier === "glide"
        ? (motionPx >= Math.max(1.2, baseRadius * 0.016) && !idleMicroJitter) || state.jitterSuppressed === true
        : flourishStrength >= 0.12 && !idleMicroJitter;
  const trailMotionThresholdPx = 5;
  const trailLength =
    safetyMetrics?.recoveryActive
      ? 10
      : mode === "strike"
        ? 24
        : mode === "orbit"
          ? 20
          : mode === "ghost"
            ? 22
            : mode === "windup"
              ? 16
              : mode === "dissolve"
                ? 18
                : 12;
  const sizeScale = mode === "strike" ? 1.08 : mode === "ghost" ? 0.92 : 1;
  if (motionPx > trailMotionThresholdPx) {
    state.trail.unshift({
      x: state.x,
      y: state.y,
      alpha: clamp(0.22 + state.emphasis * 0.2, 0.16, 0.5),
      size: state.radius * sizeScale,
    });
  }
  if (state.trail.length > trailLength) {
    state.trail.length = trailLength;
  }
  for (let index = 0; index < state.trail.length; index += 1) {
    const item = state.trail[index]!;
    const fade = 1 - index / Math.max(1, state.trail.length);
    item.alpha *= mode === "ghost" ? 0.94 : 0.9;
    item.size = clamp(item.size * (mode === "dissolve" ? 1.01 : 0.992), 12, state.radius * 1.8);
    item.alpha = clamp(item.alpha * fade, 0.03, 0.5);
  }

  return {
    mode: state.mode,
    motionPx,
    emphasis: state.emphasis,
    trailLength: state.trail.length,
    x: state.x,
    y: state.y,
    motionTier,
    flourishStrength,
    jumpTriggered: state.jumpTriggered,
    jitterSuppressed: state.jitterSuppressed,
    motionTierReadable: state.motionTierReadable,
    gracefulBias: travelStyle.gracefulBias,
    glitchBias: travelStyle.glitchBias,
    targetSmoothing: travelStyle.targetSmoothing,
    moveScale,
    emissionScale,
    lowDbFreezeActive: freezeTranslation,
  };
}
