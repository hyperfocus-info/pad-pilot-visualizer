import { createCanvas } from "@napi-rs/canvas";
import { clamp } from "../config";
import { TRANSITION_FAMILIES, classifyHeroMotifIntensity } from "../types";
import { enrichFrameWithMusicGrid } from "./music-grid";
import type {
  ActiveRenderSelection,
  ActiveSubjectSnapshot,
  ActiveSubjectState,
  AtmosphereGraph,
  BackgroundElementId,
  BackgroundElementFamily,
  BackgroundInteractionMode,
  BackgroundPlan,
  BackgroundTriggerMode,
  BandEnergyProfile,
  AudioFrameFeature,
  AudioSegmentFeature,
  CompositionPlan,
  EdgeMap,
  EventSpec,
  EventState,
  FramePostEffectId,
  FramePostEffectSpec,
  FramePostEffectState,
  HeroBandAffinity,
  HeroConductorRuntimeState,
  HeroChildFieldState,
  HeroCoreFillMode,
  HeroChildMode,
  HeroDeformationMode,
  HeroEmitterDirective,
  HeroExpandedBand,
  HeroMotifProfile,
  HeroParticleBuffers,
  HeroPhysicsEnvelope,
  HeroGlyphKind,
  HeroMotifSchedule,
  HeroMotifScheduleSlot,
  HeroPhysicsState,
  HeroPhysicsParticle,
  HeroShellBand,
  HeroShellColorMode,
  HeroShellLayerSpec,
  HeroPostShellMode,
  HeroPrimitiveKind,
  HeroSeparationFailureReason,
  HeroRelationshipClass,
  HeroRelationshipMode,
  HeroSubEmitterDirective,
  MotifEffectAudioMode,
  MotifEffectId,
  MotifEffectSpec,
  MotifEffectState,
  MotifPhysicsProfile,
  NebulaGlowAnchor,
  OverlayMode,
  OutroEffectAudioMode,
  OutroEffectCategory,
  OutroEffectId,
  OutroEffectSpec,
  OutroEffectState,
  PersistentMotifState,
  ParticleConceptId,
  PhysicalPhenomenonFamily,
  PlacementSlot,
  ParticleSystemState,
  DiagnosticOverrides,
  RenderStageMetrics,
  RenderedFrame,
  RecoveryMode,
  RenderQualityBudget,
  RenderSettings,
  RenderTheme,
  SceneGraph,
  SceneKey,
  TransitionCarryProfile,
  TransitionCarryReason,
  TransitionFamily,
  TransitionBridgeState,
  TransitionCooldownContext,
  TransitionGraph,
  VisualPhrasePlan,
  VisualSafetyMetrics,
  VisualState,
} from "../types";
import { buildEffectBudget, finalizeFrameEffect, prepareFrameEffect } from "./effects";
import { getParticleSystemState } from "./particle-engine";
import { createActiveSubjectState, updateActiveSubject } from "./active-subject";
import { buildCompositionPlanForTheme, buildTransitionBridgeState } from "./composition-plan";
import { buildSceneGraph, buildTransitionIdentitySignature, heroConductorSpecById, mutateSceneGraphContinuity, mutateSceneGraphForTransition } from "./scene-graph";
import { buildAtmosphereGraph } from "./atmosphere-graph";
import { renderNebula } from "./nebula";
import { ShapeStampAtlas } from "./stamp-atlas";
import { buildTransitionGraph, transitionGraphKey } from "./transition-graph";
import { resolveTransitionCarryProfile } from "./transition-carry";
import { resolveHeroLayout } from "./hero-layout";
import { sampleNoise2D } from "./noise";
import {
  backgroundGradient,
  createFallbackStyleProfile,
  createRenderTheme,
  lightningColor,
  paletteColor,
  plasmaCoreColor,
  sanitizeTransitionMode,
} from "./palette";
import { getVisualStateAtFrame } from "./visual-plan";
import { buildHeroMotifSchedule, resolveHeroMotifScheduleSlot } from "./hero-motif-schedule";
import { applyHeroParticleBatchWasm, sampleStridedFrameStatsWasm } from "../perf/wasm-kernels";
import { stableImageSeed } from "./image-seed";
import { stableHash32 } from "./seed-utils";
import {
  applyMotifEffectToHeroParticles,
  applyRareHeroWarp,
  createRollingDbWindowState,
  evaluateMotifEffectState,
  type MotifEffectRuntimeModifiers,
  renderMotifEffect,
  updateRollingDbWindowState,
} from "./motif-effects";
import {
  evaluateEventState,
} from "./event-specs";
import {
  buildPersistentMotifState,
  selectInitialPersistentMotif,
  selectNextPersistentMotif,
  shouldRotatePersistentMotif,
  transientPeakScore,
  PERSISTENT_MOTIF_SPECS,
} from "./persistent-motifs";
import {
  applyOutroEffectToActiveSubject,
  evaluateOutroEffectState,
  renderOutroEffect,
  selectOutroEffect,
} from "./outro-effects";
import {
  evaluateFramePostEffectState,
  renderFramePostEffect,
  selectFramePostEffect,
} from "./frame-post-effects";
import {
  computeBackgroundAccentStyle as computeBackgroundAccentStyleCore,
  computeBackgroundReactiveDrives as computeBackgroundReactiveDrivesCore,
  type BackgroundAccentStyle,
  type BackgroundReactiveDrives,
} from "./background-reactivity";
import { buildSpawnContext } from "./spawn-rules/context";
import { buildBackgroundPlanFromSelection, buildParticleBehaviorsFromSelection, createBackgroundAdjustment } from "./spawn-rules/adapters";
import { selectBackgroundConcept, selectEventConcept, selectMotifEffectConcept, selectParticleConcepts } from "./spawn-rules/selectors";

const stableHash = stableHash32;

const HERO_SWAP_GRACEFUL_THRESHOLD = 0.72;
const HERO_PROJECTILE_SPREAD_MIN_MULTIPLIER = 1.4;
const HERO_PROJECTILE_SPREAD_MAX_MULTIPLIER = 1.1;
const HERO_EMITTED_PARTICLE_TOP_SPEED = 44;
const AUDIO_SWAP_PROMOTION_BASE_CHANCE = 0.2;
const AUDIO_SWAP_PROMOTION_EXTRA_CHANCE = 0.2;
const PRE_DROP_AUDIO_FACTOR_SCALE = 0.6;
const POST_DROP_AUDIO_FACTOR_SCALE = 1.2;

const LUMINANCE_SAMPLE_WIDTH = 48;
const LUMINANCE_SAMPLE_HEIGHT = 27;
const DARK_LUMINANCE_THRESHOLD = 0.02;
const BUDGET_LUMINANCE_SAMPLE_INTERVAL = 4;

interface LowResFrameStats {
  luminanceSample: number;
  darkestQuartileLuminance: number;
  darkSampleCount: number;
  sampleCount: number;
}

interface ImageSchedule {
  secondsPerImage: number;
}

interface TransitionState {
  fromImagePath: string;
  toImagePath: string;
  mode: number;
  family: TransitionFamily;
  triggerMode: "swap" | "hold";
  startFrameIndex: number;
  durationFrames: number;
  carryStrength: number;
  useMorph: boolean;
  carryProfile: TransitionCarryProfile;
}

interface HeroShellRuntimeLayerState {
  spec: HeroShellLayerSpec;
  recentTriggers: number[];
  recentTriggerCount: number;
}

interface HeroShellWindowRuntimeState {
  windowIndex: number;
  enabled: boolean;
  configuredCount: 0 | 1 | 2 | 3;
  colorMode: HeroShellColorMode;
  paletteSpanScale: number;
  hueTravelScale: number;
  layers: HeroShellRuntimeLayerState[];
  captureFrames: number;
  colorOffsets: [number, number, number];
}

interface HeroShellLayerFrameState {
  spec: HeroShellLayerSpec;
  drive: number;
  dynamicThreshold: number;
  active: boolean;
}

interface HeroShellFrameState {
  windowState: HeroShellWindowRuntimeState;
  layers: HeroShellLayerFrameState[];
}

const HERO_SHELL_LAYER_LIBRARY: readonly HeroShellLayerSpec[] = [
  {
    index: 0,
    band: "low",
    style: "halo-fill",
    radiusScale: 1.16,
    alphaWeight: 1,
    lineWidthScale: 1,
    baseThreshold: 0.56,
    targetTriggerRatio: 0.34,
  },
  {
    index: 1,
    band: "lowMid",
    style: "shock-ring",
    radiusScale: 1.78,
    alphaWeight: 0.78,
    lineWidthScale: 0.96,
    baseThreshold: 0.63,
    targetTriggerRatio: 0.2,
  },
  {
    index: 2,
    band: "lowComposite",
    style: "rim-halo",
    radiusScale: 2.18,
    alphaWeight: 0.56,
    lineWidthScale: 0.88,
    baseThreshold: 0.71,
    targetTriggerRatio: 0.1,
  },
];

export function computeBackgroundReactiveDrives(frame: AudioFrameFeature, plan: BackgroundPlan): BackgroundReactiveDrives {
  return computeBackgroundReactiveDrivesCore(frame, plan);
}

export function computeBackgroundAccentStyle(
  theme: RenderTheme,
  frame: AudioFrameFeature,
  plan: BackgroundPlan,
  alpha: number,
  luminanceShift: number,
): BackgroundAccentStyle {
  return computeBackgroundAccentStyleCore(theme, frame, plan, alpha, luminanceShift);
}

function backgroundInstanceCount(plan: BackgroundPlan, fps: number, family: BackgroundElementFamily): number {
  const count = plan.geometryParams?.count ?? 10;
  const qualityScale = fps >= 50 ? 0.7 : 1;
  const familyScale = family === "primitive-swarm" || family === "sigil-field" ? 0.82 : 1;
  return Math.max(4, Math.round(count * qualityScale * familyScale));
}

interface BackgroundInteractionState {
  heroX: number;
  heroY: number;
  heroSpeed: number;
  heroHeading: number;
  heroRadius: number;
  heroParticleDensity: number;
  beatTrigger: boolean;
  barTrigger: boolean;
  fourBarTrigger: boolean;
  countdownTrigger: boolean;
  silhouetteActive: boolean;
  collisionEnergy: number;
}

const PHYSICAL_CAMERA_TRANSITION_FAMILIES: TransitionFamily[] = [
  "dolly-in",
  "dolly-out",
  "whip-pan-x",
  "whip-pan-y",
  "handheld-lurch",
  "crash-zoom",
  "snap-zoom-out",
  "parallax-slide",
  "tilt-reframe",
  "roll-sway",
  "wright-whip-pan-particle-smear",
  "barlog-continuous-camera-particle-sweep",
  "resolution-crash-snapback",
];

const PSYCHEDELIC_TRANSITION_FAMILIES: TransitionFamily[] = [
  "bilateral-iris-fold",
  "mirror-gate-inversion",
  "prism-axis-lag",
  "quad-kaleido-choir",
  "reflection-slit-shatter",
  "fractal-tunnel",
  "acid-fold",
  "strobe-bloom",
  "liquid-lens",
  "solarize-drift",
  "chroma-smear",
  "afterimage-wheel",
  "mandala-pulse",
  "ink-melt",
  "trip-kaleido",
  "fractal-mirror-shatter",
  "chromatic-mandala-spin",
  "neon-radial-implosion",
  "prismatic-vortex-swirl",
  "hallucinogenic-hex-grid",
  "trippy-symmetry-ripple",
  "acid-wash-tunnel",
  "geometric-stardust-rotation",
  "psychedelic-pinwheel-dissolve",
  "color-shift-kaleidoscope-burst",
  "cosmic-dust-dispersion",
  "nebula-cloud-crossfade",
  "quantum-realm-warp",
  "soft-starlight-blur",
  "celestial-aurora-wipe",
  "supernova-glare-reveal",
  "ethereal-particle-drift",
  "galactic-smoke-sweep",
  "interstellar-light-bleed",
  "deep-space-flare-transition",
  "kon-reality-shatter-match-cut",
  "moore-nine-panel-particle-grid",
  "kojima-tactical-glitch-noise",
  "gilligan-time-lapse-particle-sand",
  "floyd-dark-side-prism-dispersal",
  "joyce-fluid-text-morph",
  "kubrick-slit-scan-star-gate",
  "danielewski-house-typographic-distortion",
  "mobius-wrap-tunnel",
  "datamosh-vector-drag",
  "snare-negative-flip",
  "voronoi-drop-shatter",
  "wire-solid-phase-cut",
  "quadrant-mirror-sweep",
  "centrifugal-hex-mirror",
  "octant-mirror-zoom",
  "mirror-grid-dissolve",
  "kaleido-iris-zoom",
  "kaleido-tunnel-zoom",
  "snowflake-kaleido-bloom",
  "infinite-reflection-zoom",
  "tri-prism-fold",
  "hex-prism-cascade",
  "refractive-prism-spin",
  "prismatic-radial-wipe",
  "refractive-shard-tumble",
  "mirror-interlock-weave",
  "glass-shatter-reflect",
  "vortex-mirror-spiral",
  "symmetry-spin-reveal",
  "crystal-facet-reveal",
];

const REFLECTIVE_TRANSITION_FAMILY_SET = new Set<TransitionFamily>([
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

function isExtremeHeroVariant(
  motifVariant: Pick<SceneGraph["heroMotifVariant"], "warpWeight" | "inconsistencyWeight" | "densityWeight">,
  emissionTuning: Pick<SceneGraph["heroEmissionTuning"], "colorRangeMode">,
): boolean {
  return (
    emissionTuning.colorRangeMode === "extreme" ||
    motifVariant.warpWeight >= 0.72 ||
    motifVariant.inconsistencyWeight >= 0.72 ||
    motifVariant.densityWeight >= 0.72
  );
}

function computeHeroAudioDrive(frame: AudioFrameFeature, transientDrive: number): { dbDrive: number; hzDrive: number; audioSpeedDrive: number } {
  const dbDrive = clamp(frame.dbNormalized, 0, 1.5);
  const hzDrive = clamp((frame.dominantHz - 120) / 2200, 0, 1.25);
  const audioSpeedDrive = clamp(transientDrive * 0.6 + dbDrive * 0.7 + hzDrive * 0.6, 0, 2.2);
  return { dbDrive, hzDrive, audioSpeedDrive };
}

function computeHeroSpawnAudioDrive(dbDrive: number, hzDrive: number, transientDrive: number): number {
  return clamp(transientDrive * 0.55 + dbDrive * 0.75 + hzDrive * 0.9, 0, 2.6);
}

function expandedBandValue(frame: AudioFrameFeature, band: HeroExpandedBand): number {
  switch (band) {
    case "subLow":
      return frame.normalizedSubLow;
    case "low":
      return frame.normalizedLow;
    case "mid":
      return frame.normalizedMid;
    case "highMid":
      return frame.normalizedHighMid;
    case "high":
    default:
      return frame.normalizedHigh;
  }
}

function bandValueForAffinity(frame: AudioFrameFeature, bandAffinity: HeroBandAffinity): number {
  return bandAffinity === "low" ? frame.normalizedLow : bandAffinity === "mid" ? frame.normalizedMid : frame.normalizedHigh;
}

function conductorPhaseOffset(frame: AudioFrameFeature, conductor: HeroConductorRuntimeState): number {
  if (conductor.motionFamily === "delay-wave") {
    return frame.phrasePulse ?? frame.barPulse ?? frame.beatPulse;
  }
  return frame.beatPulse * (conductor.motionFamily === "pendulum" ? 0.75 : 1);
}

function nearestHeroAnchorIndex(x: number, y: number, heroAnchors: Array<Pick<HeroEmitterDirective, "x" | "y">>): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < heroAnchors.length; index += 1) {
    const anchor = heroAnchors[index]!;
    const distance = Math.hypot(x - anchor.x, y - anchor.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function configuredHeroShellCountFromScore(score: number): 1 | 2 | 3 {
  const percentile = Math.abs(score) % 100;
  if (percentile < 75) {
    return 1;
  }
  if (percentile < 95) {
    return 2;
  }
  return 3;
}

function buildHeroShellLayerSpecs(count: 0 | 1 | 2 | 3): HeroShellLayerSpec[] {
  return HERO_SHELL_LAYER_LIBRARY.slice(0, count).map((spec) => ({ ...spec }));
}

function legacyHeroShellModeForLayer(style: HeroShellLayerSpec["style"] | undefined): HeroPostShellMode {
  if (style === "shock-ring") {
    return "shock-ring";
  }
  if (style === "halo-fill" || style === "rim-halo") {
    return "soft-halo";
  }
  return "none";
}

function heroShellDriveForBand(frame: AudioFrameFeature, band: HeroShellBand): number {
  switch (band) {
    case "low":
      return clamp(frame.normalizedLow * 0.78 + frame.beatPulse * 0.14 + frame.onsetStrength * 0.08, 0, 1.25);
    case "lowComposite":
      return clamp(Math.max(frame.normalizedLow, frame.normalizedSubLow) * 0.72 + frame.normalizedLowMid * 0.18 + frame.beatPulse * 0.1, 0, 1.25);
    case "lowMid":
    default:
      return clamp(frame.normalizedLowMid * 0.56 + frame.normalizedLow * 0.32 + frame.peakStrength * 0.12, 0, 1.25);
  }
}

function legacyHeroShellStatsBand(band: HeroShellBand): "highMid" | "high" | "upperHighComposite" {
  switch (band) {
    case "low":
      return "highMid";
    case "lowMid":
      return "high";
    case "lowComposite":
    default:
      return "upperHighComposite";
  }
}

function motionTierReadableForFrame(snapshot: ActiveSubjectSnapshot): boolean {
  if (snapshot.motionTier === "jump") {
    return Boolean(snapshot.jumpTriggered) || snapshot.motionPx >= 8;
  }
  if (snapshot.motionTier === "flourish") {
    return (snapshot.flourishStrength ?? 0) >= 0.12 && snapshot.jitterSuppressed !== true;
  }
  return (snapshot.motionPx >= 1.2 || snapshot.jitterSuppressed === true) && (snapshot.motionTierReadable ?? true);
}

function heroSpawnShellColorizationScale(
  frame: AudioFrameFeature,
  sceneGraph: Pick<SceneGraph, "heroMotifVariant" | "heroEmissionTuning">,
  bandEnergy: Pick<BandEnergyProfile, "low" | "mid" | "high">,
): number {
  const hzDrive = clamp((frame.dominantHz - 120) / 2200, 0, 1);
  const dominantBandDrive =
    frame.dominantBand === "low" ? bandEnergy.low :
    frame.dominantBand === "mid" ? bandEnergy.mid :
    bandEnergy.high;
  const hzBandDrive = clamp(hzDrive * 0.55 + dominantBandDrive * 0.45, 0, 1);
  const extremeHeadroom = isExtremeHeroVariant(sceneGraph.heroMotifVariant, sceneGraph.heroEmissionTuning) ? 0.8 : 0;
  return clamp(1.2 + hzBandDrive * extremeHeadroom, 1.2, 2);
}

function weightedPickByHash<T extends string>(
  entries: readonly T[],
  hashSeed: string,
  weightFor: (entry: T) => number,
): T {
  const sorted = [...entries].sort();
  const totalWeight = sorted.reduce((sum, entry) => sum + Math.max(0, weightFor(entry)), 0);
  if (totalWeight <= 0) {
    return sorted[stableHash32(hashSeed) % Math.max(1, sorted.length)]!;
  }
  let cursor = stableHash32(hashSeed) % Math.max(1, Math.ceil(totalWeight * 1000));
  for (const entry of sorted) {
    cursor -= Math.max(1, Math.round(Math.max(0, weightFor(entry)) * 1000));
    if (cursor < 0) {
      return entry;
    }
  }
  return sorted[sorted.length - 1]!;
}

function chooseWeightedTransitionFamily(
  families: readonly TransitionFamily[],
  hashSeed: string,
  baseWeights?: Partial<Record<TransitionFamily, number>>,
): TransitionFamily {
  return weightedPickByHash(families, hashSeed, (family) => {
    const reflectiveBias = REFLECTIVE_TRANSITION_FAMILY_SET.has(family) ? 1.5 : 1;
    return (baseWeights?.[family] ?? 1) * reflectiveBias;
  });
}

export function computeHeroEmissionRecovery(dbDrive: number): {
  heroBaselineEmissionScale: number;
  heroZeroDbRecovery: number;
  zeroDbEmissionRecovery: number;
} {
  const normalizedRecovery = clamp(dbDrive / 1.0, 0, 1);
  const heroBaselineEmissionScale = 0.1;
  return {
    heroBaselineEmissionScale,
    heroZeroDbRecovery: 1 + (1.25 - 1) * normalizedRecovery,
    zeroDbEmissionRecovery: heroBaselineEmissionScale + (1 - heroBaselineEmissionScale) * normalizedRecovery,
  };
}

function chooseHeroParticlePrimitive(params: {
  frameIndex: number;
  spawnIndex: number;
  basePrimitive: HeroPrimitiveKind;
  emissionPrimitivePool?: HeroPrimitiveKind[];
  childPrimitiveMix: HeroPrimitiveKind[];
  bandAffinity: HeroBandAffinity;
  glitchParticleShift: number;
}): HeroPrimitiveKind {
  const {
    frameIndex,
    spawnIndex,
    basePrimitive,
    emissionPrimitivePool,
    childPrimitiveMix,
    bandAffinity,
    glitchParticleShift,
  } = params;
  if (glitchParticleShift < 0.45) {
    return basePrimitive;
  }
  const pool = Array.from(new Set([basePrimitive, ...(emissionPrimitivePool ?? []), ...childPrimitiveMix]));
  if (pool.length <= 1) {
    return basePrimitive;
  }
  const angularBias = ["lightning", "chevron", "diamond", "arc", "shard", "triangle", "arrow"];
  const stableBias = ["ring", "circle", "ellipse", "orb"];
  const temporalBucket = Math.floor(frameIndex / (glitchParticleShift > 0.82 ? 3 : 6));
  const affinityOffset = bandAffinity === "high" ? 2 : bandAffinity === "mid" ? 1 : 0;
  const rotatedIndex = Math.abs((temporalBucket * 5 + spawnIndex * 3 + affinityOffset) % pool.length);
  let candidatePool = pool;
  if (glitchParticleShift > 0.82) {
    const angularPool = pool.filter((primitive) => angularBias.includes(primitive));
    if (angularPool.length > 0) {
      candidatePool = angularPool;
    }
  } else if (glitchParticleShift < 0.7) {
    candidatePool = pool.filter((primitive) => primitive === basePrimitive || !stableBias.includes(primitive));
    if (candidatePool.length === 0) {
      candidatePool = pool;
    }
    if ((spawnIndex + temporalBucket) % 3 !== 0) {
      return basePrimitive;
    }
  }
  return candidatePool[rotatedIndex % candidatePool.length] ?? basePrimitive;
}

function quadrantForPoint(x: number, y: number, width: number, height: number): "tl" | "tr" | "bl" | "br" | "center" {
  const nx = x / Math.max(1, width);
  const ny = y / Math.max(1, height);
  if (Math.abs(nx - 0.5) < 0.12 && Math.abs(ny - 0.5) < 0.12) {
    return "center";
  }
  if (nx < 0.5 && ny < 0.5) {
    return "tl";
  }
  if (nx >= 0.5 && ny < 0.5) {
    return "tr";
  }
  if (nx < 0.5 && ny >= 0.5) {
    return "bl";
  }
  return "br";
}

function computeSupportNearHeroScore(plan: CompositionPlan): number {
  if (plan.supportSlots.length === 0) {
    return 0;
  }
  return clamp(
    [...plan.supportSlots]
      .sort((left, right) =>
        Math.hypot(left.x - plan.heroCenterX, left.y - plan.heroCenterY) -
        Math.hypot(right.x - plan.heroCenterX, right.y - plan.heroCenterY))
      .slice(0, 3)
      .reduce((sum, slot) => {
        const distance = Math.hypot(slot.x - plan.heroCenterX, slot.y - plan.heroCenterY);
        const distanceScore = 1 - clamp(distance / Math.max(1, plan.heroRadius * 3.2), 0, 1);
        return sum + distanceScore * clamp(slot.weight, 0.2, 1);
      }, 0) / Math.max(1, Math.min(3, plan.supportSlots.length)),
    0,
    1,
  );
}

function computeEdgeDominanceMetrics(edgeMap: EdgeMap): {
  brightestQuadrant: "left" | "right" | "top" | "bottom";
  dominant: number;
  second: number;
  margin: number;
} {
  const weights = [
    ["left", edgeMap.leftWeight],
    ["right", edgeMap.rightWeight],
    ["top", edgeMap.topWeight],
    ["bottom", edgeMap.bottomWeight],
  ] as const;
  const sorted = [...weights].sort((left, right) => right[1] - left[1]);
  return {
    brightestQuadrant: sorted[0]?.[0] ?? "left",
    dominant: sorted[0]?.[1] ?? 0,
    second: sorted[1]?.[1] ?? 0,
    margin: Math.max(0, (sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0)),
  };
}

function computeEdgeHighlightPenalty(edgeMap: EdgeMap, plan: CompositionPlan): number {
  const { brightestQuadrant, dominant, margin } = computeEdgeDominanceMetrics(edgeMap);
  const heroQuadrant = quadrantForPoint(plan.heroCenterX, plan.heroCenterY, edgeMap.width, edgeMap.height);
  const mismatch =
    (brightestQuadrant === "left" && (heroQuadrant === "tr" || heroQuadrant === "br")) ||
    (brightestQuadrant === "right" && (heroQuadrant === "tl" || heroQuadrant === "bl")) ||
    (brightestQuadrant === "top" && (heroQuadrant === "bl" || heroQuadrant === "br")) ||
    (brightestQuadrant === "bottom" && (heroQuadrant === "tl" || heroQuadrant === "tr"));
  const base = mismatch ? 0.22 : 0.06;
  const marginTerm = clamp((margin - 0.08) / 0.32, 0, 1) * 0.46;
  const massTerm = clamp((dominant - 0.58) / 0.24, 0, 1) * 0.16;
  return clamp(base + marginTerm + massTerm - computeSupportNearHeroScore(plan) * 0.28, 0, 1);
}

function computeDeadCenterVoidScore(plan: CompositionPlan, edgeMap: EdgeMap): number {
  const heroCentered = 1 - Math.hypot(plan.heroCenterX - edgeMap.width * 0.5, plan.heroCenterY - edgeMap.height * 0.5) / Math.max(edgeMap.width, edgeMap.height);
  const heroQuadrant = quadrantForPoint(plan.heroCenterX, plan.heroCenterY, edgeMap.width, edgeMap.height);
  return clamp(
    heroCentered * 0.32 +
      (1 - plan.focalOccupancyScore) * 0.43 +
      (1 - computeSupportNearHeroScore(plan)) * 0.25 +
      (edgeMap.negativeSpaceQuadrant === "center" && heroQuadrant === "center" ? 0.10 : 0),
    0,
    1,
  );
}

function computeFocalReinforcementScore(plan: CompositionPlan, edgeMap: EdgeMap): number {
  return clamp(plan.focalOccupancyScore * 0.35 + computeSupportNearHeroScore(plan) * 0.35 + (1 - computeEdgeHighlightPenalty(edgeMap, plan)) * 0.15 + (1 - computeDeadCenterVoidScore(plan, edgeMap)) * 0.15, 0, 1);
}

function inProtectedZone(zones: CompositionPlan["protectedZones"], x: number, y: number): boolean {
  return zones.some((zone) =>
    x >= zone.x &&
    x <= zone.x + zone.width &&
    y >= zone.y &&
    y <= zone.y + zone.height,
  );
}

function supportSlotTooClose(
  slot: PlacementSlot,
  existing: PlacementSlot[],
  minimumDistance: number,
): boolean {
  return existing.some((other) => Math.hypot(other.x - slot.x, other.y - slot.y) < minimumDistance);
}

interface CompositionRiskProfile {
  supportNearHeroScore: number;
  edgePenalty: number;
  deadCenterVoidScore: number;
  lowSupportScore: number;
  lowFocalScore: number;
  edgeDominanceScore: number;
  deadCenterScore: number;
  heldSparseScore: number;
  maskConfidenceScore: number;
  lowSupport: boolean;
  lowFocal: boolean;
  centeredLowSupport: boolean;
  heldSparse: boolean;
  deadCenterRisk: boolean;
  edgeDominanceRisk: boolean;
  severeSupport: boolean;
  severeFocal: boolean;
  severeDeadCenter: boolean;
  severeEdge: boolean;
  riskScore: number;
}

function buildCompositionRiskProfile(
  plan: CompositionPlan,
  edgeMap: EdgeMap,
  heldRatio: number,
): CompositionRiskProfile {
  const supportNearHeroScore = computeSupportNearHeroScore(plan);
  const edgePenalty = computeEdgeHighlightPenalty(edgeMap, plan);
  const deadCenterVoidScore = computeDeadCenterVoidScore(plan, edgeMap);
  const lowSupportScore = clamp((0.4 - supportNearHeroScore) / 0.18, 0, 1);
  const lowFocalScore = clamp((0.2 - plan.focalOccupancyScore) / 0.12, 0, 1);
  const edgeDominanceScore = clamp((edgePenalty - 0.68) / 0.24, 0, 1);
  const deadCenterScore = clamp((deadCenterVoidScore - 0.7) / 0.22, 0, 1);
  const heldSparseScore =
    heldRatio >= 0.82
      ? clamp((heldRatio - 0.82) / 0.16, 0, 1) * clamp((0.42 - supportNearHeroScore) / 0.18, 0, 1)
      : 0;
  const maskConfidenceScore =
    edgeMap.maskConfidence === "low"
      ? 0.82
      : edgeMap.maskConfidence === "medium"
        ? 0.28
        : 0;
  return {
    supportNearHeroScore,
    edgePenalty,
    deadCenterVoidScore,
    lowSupportScore,
    lowFocalScore,
    edgeDominanceScore,
    deadCenterScore,
    heldSparseScore,
    maskConfidenceScore,
    lowSupport: supportNearHeroScore < 0.38 || plan.supportSlots.length < 2,
    lowFocal: plan.focalOccupancyScore < 0.18,
    centeredLowSupport: plan.centerBiasScore > 0.82 && supportNearHeroScore < 0.42,
    heldSparse: heldRatio >= 0.84 && supportNearHeroScore < 0.38,
    deadCenterRisk: deadCenterVoidScore > 0.74,
    edgeDominanceRisk: edgePenalty > 0.76,
    severeSupport: supportNearHeroScore < 0.16,
    severeFocal: plan.focalOccupancyScore < 0.12,
    severeDeadCenter: deadCenterVoidScore > 0.9,
    severeEdge: edgePenalty > 0.9,
    riskScore:
      lowSupportScore * 1.2 +
      lowFocalScore * 1.15 +
      edgeDominanceScore +
      deadCenterScore +
      heldSparseScore * 0.9 +
      maskConfidenceScore * 0.45,
  };
}

function circleOverlapRatio(aRadius: number, bRadius: number, distance: number): number {
  const combined = Math.max(1, aRadius + bRadius);
  return clamp((combined - distance) / combined, 0, 1);
}

export function resolveRequestedImageIndex(
  baseImageIndex: number,
  imageSwapAllowed: boolean,
  lastImageIndex: number,
): number {
  return !imageSwapAllowed && baseImageIndex > lastImageIndex ? lastImageIndex : baseImageIndex;
}

export function themeCacheKey(imagePath: string, segmentIndex: number): string {
  return `${imagePath}::${segmentIndex}`;
}

function sceneGraphCacheKey(imagePath: string, segmentIndex: number, slot: HeroMotifScheduleSlot): string {
  return `${imagePath}::${segmentIndex}::${slot.slotIndex}::${slot.motif}`;
}

export function hashTransitionPairSeed(fromImagePath: string, toImagePath: string): number {
  return stableHash32(`${fromImagePath}|${toImagePath}`);
}

function frameDependentSnareFlip(emphasis: number, contrast: number): boolean {
  return emphasis > 0.5 && contrast > 0.28;
}

export function chooseTransitionFamily(params: {
  visualState: VisualState;
  edgeMap: EdgeMap;
  theme: RenderTheme;
  safety: VisualSafetyMetrics;
  activeSubject: ActiveSubjectSnapshot;
  persistentMotif?: PersistentMotifState;
  eventState?: EventState;
}): TransitionFamily {
  const { visualState, edgeMap, theme, safety, activeSubject, persistentMotif, eventState } = params;
  const motif = edgeMap.fractalMotif as EdgeMap["fractalMotif"];
  const transitionSeedBase = [
    edgeMap.imagePath,
    motif,
    visualState.regime,
    visualState.overlayMode,
    visualState.transitionFamily,
    theme.styleProfile.imagePath,
    theme.styleProfile.transitionMode,
    Math.round(theme.styleProfile.symmetry * 1000),
    Math.round(activeSubject.motionPx * 100),
    persistentMotif?.id ?? "none",
    eventState?.id ?? "none",
  ].join("|");
  if (edgeMap.maskConfidence === "low" || safety.recoveryActive) {
    return "wipe";
  }
  if (persistentMotif && eventState && eventState.intensity >= 0.48) {
    const preferredFamilies = PERSISTENT_MOTIF_SPECS.find((entry) => entry.id === persistentMotif.id)?.preferredTransitionFamilies.filter(
      (family) => TRANSITION_FAMILIES.includes(family),
    );
    if (preferredFamilies && preferredFamilies.length > 0) {
      return chooseWeightedTransitionFamily(preferredFamilies, `persistent:${transitionSeedBase}`, {
        [preferredFamilies[0]!]: 1.15,
      });
    }
  }
  const directionalBalance = Math.max(
    Math.abs(edgeMap.leftWeight - edgeMap.rightWeight),
    Math.abs(edgeMap.topWeight - edgeMap.bottomWeight),
  );
  const physicalCameraFavored =
    (visualState.regime === "drop" || visualState.regime === "build") &&
    activeSubject.motionPx > 7.4 &&
    edgeMap.complexity > 0.58 &&
    directionalBalance > 0.08;
  const psychedelicFavored =
    ["mandelbloom", "shattered-arc", "film-bloom-shard", "smoke-ribbon", "vector-incantation"].includes(motif) ||
    (visualState.regime !== "breakdown" && edgeMap.complexity > 0.68 && activeSubject.emphasis > 0.4);
  if (physicalCameraFavored) {
    if (directionalBalance > 0.18) {
      return edgeMap.leftWeight > edgeMap.rightWeight ? "whip-pan-x" : "parallax-slide";
    }
    return visualState.regime === "drop" ? "resolution-crash-snapback" : "dolly-in";
  }
  if (psychedelicFavored) {
    if (theme.styleProfile.symmetry > 0.74 && (motif === "glass-orbital" || motif === "harmonic-lattice")) {
      return chooseWeightedTransitionFamily(
        visualState.regime === "drop"
          ? ["quad-kaleido-choir", motif === "glass-orbital" ? "mirror-gate-inversion" : "bilateral-iris-fold"]
          : [motif === "glass-orbital" ? "mirror-gate-inversion" : "bilateral-iris-fold", "mirror-kaleido"],
        `psychedelic-symmetry:${transitionSeedBase}`,
        visualState.regime === "drop"
          ? { "quad-kaleido-choir": 1.1 }
          : motif === "glass-orbital"
            ? { "mirror-gate-inversion": 1.1 }
            : { "bilateral-iris-fold": 1.1 },
      );
    }
    if (theme.styleProfile.symmetry > 0.7 && motif === "data-cathedral") {
      return chooseWeightedTransitionFamily(
        visualState.regime === "build" ? ["prism-axis-lag", "reflection-slit-shatter"] : ["reflection-slit-shatter", "prism-axis-lag"],
        `data-cathedral-symmetry:${transitionSeedBase}`,
        visualState.regime === "build" ? { "prism-axis-lag": 1.1 } : { "reflection-slit-shatter": 1.1 },
      );
    }
    if (motif === "mandelbloom") {
      return chooseWeightedTransitionFamily(
        visualState.regime === "drop" ? ["mobius-wrap-tunnel", "mandala-pulse"] : ["mandala-pulse", "mobius-wrap-tunnel"],
        `mandelbloom:${transitionSeedBase}`,
        visualState.regime === "drop" ? { "mobius-wrap-tunnel": 1.1 } : { "mandala-pulse": 1.1 },
      );
    }
    if (motif === "smoke-ribbon") {
      return chooseWeightedTransitionFamily(
        visualState.regime === "build" ? ["mobius-wrap-tunnel", "liquid-lens"] : ["liquid-lens", "mobius-wrap-tunnel"],
        `smoke-ribbon:${transitionSeedBase}`,
        visualState.regime === "build" ? { "mobius-wrap-tunnel": 1.1 } : { "liquid-lens": 1.1 },
      );
    }
    if (motif === "shattered-arc" || motif === "film-bloom-shard") {
      return chooseWeightedTransitionFamily(
        visualState.regime === "drop" ? ["voronoi-drop-shatter", "chroma-smear"] : ["chroma-smear", "shear-kaleido"],
        `shardish:${transitionSeedBase}`,
        visualState.regime === "drop" ? { "voronoi-drop-shatter": 1.1 } : { "chroma-smear": 1.1 },
      );
    }
    if (motif === "vector-incantation") {
      return chooseWeightedTransitionFamily(
        visualState.regime === "build" ? ["wire-solid-phase-cut", "trip-kaleido"] : ["trip-kaleido", "split-mirror"],
        `vector-incantation:${transitionSeedBase}`,
        visualState.regime === "build" ? { "wire-solid-phase-cut": 1.1 } : { "trip-kaleido": 1.1 },
      );
    }
    if (motif === "data-cathedral" || motif === "harmonic-lattice") {
      return "datamosh-vector-drag";
    }
  }
  if (motif === "film-bloom-shard") {
    return chooseWeightedTransitionFamily(["fragment", "shear-kaleido"], `film-default:${transitionSeedBase}`, { fragment: 1.12 });
  }
  if (motif === "mandelbloom") {
    return chooseWeightedTransitionFamily(["mandala-pulse", "trip-kaleido"], `mandelbloom-default:${transitionSeedBase}`, { "mandala-pulse": 1.12 });
  }
  if (motif === "data-cathedral") {
    return visualState.regime === "drop" ? "datamosh-vector-drag" : "parallax-slide";
  }
  if (motif === "chromatic-xylem") {
    return "chorus-drift";
  }
  if (motif === "vector-incantation") {
    return chooseWeightedTransitionFamily(["trip-kaleido", "split-mirror"], `vector-default:${transitionSeedBase}`, { "trip-kaleido": 1.12 });
  }
  if (motif === "harmonic-lattice") {
    return chooseWeightedTransitionFamily(
      visualState.regime === "build" ? ["wire-solid-phase-cut", "phase-lattice"] : ["prism-fold", "bilateral-iris-fold"],
      `harmonic-default:${transitionSeedBase}`,
      visualState.regime === "build" ? { "wire-solid-phase-cut": 1.12 } : { "prism-fold": 1.12 },
    );
  }
  if (motif === "shattered-arc") {
    return chooseWeightedTransitionFamily(
      visualState.regime === "drop" ? ["voronoi-drop-shatter", "fragment"] : ["fragment", "shear-kaleido"],
      `shattered-default:${transitionSeedBase}`,
      visualState.regime === "drop" ? { "voronoi-drop-shatter": 1.12 } : { fragment: 1.12 },
    );
  }
  if (motif === "smoke-ribbon") {
    return chooseWeightedTransitionFamily(["shear-kaleido", "liquid-lens"], `smoke-default:${transitionSeedBase}`, { "shear-kaleido": 1.12 });
  }
  if (motif === "glass-orbital") {
    return chooseWeightedTransitionFamily(["mirror-kaleido", "phase-ghost"], `glass-default:${transitionSeedBase}`, { "mirror-kaleido": 1.12 });
  }
  if (motif === "cathedral-filament" && activeSubject.motionPx <= 5.5) {
    return visualState.regime === "breakdown" ? "echo-fold" : "halo-drift";
  }
  if (visualState.regime === "drop" && activeSubject.mode === "strike") {
    return frameDependentSnareFlip(activeSubject.emphasis, theme.imageContrast) ? "snare-negative-flip" : "flash";
  }
  if (visualState.regime === "drop" && (activeSubject.mode === "orbit" || activeSubject.motionPx > 8.5)) {
    return "fragment";
  }
  if (visualState.transitionFamily === "flash" && visualState.regime === "drop") {
    return "flash";
  }
  if (visualState.transitionFamily === "fragment" && visualState.regime === "build") {
    return "fragment";
  }
  if (visualState.regime === "breakdown") {
    return edgeMap.fractalMotif === "cathedral-filament" ? "echo-fold" : "melt-safe";
  }
  if (visualState.regime === "groove") {
    if (activeSubject.motionPx > 7.5 || edgeMap.complexity > 0.72) {
      return "fragment";
    }
    return chooseWeightedTransitionFamily(
      theme.styleProfile.symmetry > 0.6
        ? ["lattice-breath", "prism-fold", "chorus-drift"]
        : theme.imageContrast > 0.36
          ? ["veil-shift", "chorus-drift"]
          : edgeMap.fractalMotif === "cathedral-filament"
            ? ["halo-drift", "echo-fold"]
            : ["chorus-drift", "veil-shift"],
      `groove:${transitionSeedBase}`,
      theme.styleProfile.symmetry > 0.6
        ? { "lattice-breath": 1.1 }
        : theme.imageContrast > 0.36
          ? { "veil-shift": 1.1 }
          : edgeMap.fractalMotif === "cathedral-filament"
            ? { "halo-drift": 1.1 }
            : { "chorus-drift": 1.1 },
    );
  }
  if ((motif as string) === "harmonic-lattice") {
    return "lattice-breath";
  }
  if ((motif as string) === "glass-orbital") {
    return chooseWeightedTransitionFamily(["phase-ghost", "mirror-kaleido"], `glass-fallback:${transitionSeedBase}`, { "phase-ghost": 1.08 });
  }
  if ((motif as string) === "data-cathedral") {
    return "veil-shift";
  }
  if (
    visualState.transitionFamily === "compress" ||
    theme.imageContrast > 0.34 ||
    (motif as string) === "glass-orbital"
  ) {
    return (motif as string) === "glass-orbital"
      ? chooseWeightedTransitionFamily(["phase-ghost", "mirror-kaleido"], `glass-compress:${transitionSeedBase}`, { "phase-ghost": 1.08 })
      : chooseWeightedTransitionFamily(["compress", "veil-shift"], `compress:${transitionSeedBase}`, { compress: 1.08 });
  }
  if (visualState.transitionFamily === "melt-safe") {
    return "melt-safe";
  }
  return visualState.transitionFamily;
}

export function transitionModeForFamilyChoice(
  family: TransitionFamily,
  edgeMap: EdgeMap,
  theme: RenderTheme,
  pairSeed = 0,
): number {
  const pools: Record<TransitionFamily, number[]> = {
    compress: [8, 9, 13, 2, 6, 7],
    flash: edgeMap.maskConfidence === "high" ? [14, 15, 3, 11, 12, 10] : [4, 3, 14, 10, 1, 9],
    fragment: [12, 11, 10, 15, 3, 14],
    wipe: [10, 1, 4, 9, 5, 7],
    "melt-safe": [5, 13, 2, 7, 1, 9],
    carry: [1, 7, 2, 9, 5, 8],
    "spiral-carry": [7, 8, 13, 2, 9, 5],
    "orbital-shear": [9, 8, 6, 13, 2, 7],
    "phase-lattice": [13, 8, 9, 6, 2, 1],
    "ribbon-fold": [5, 7, 1, 9, 2, 13],
    "axis-swap": [10, 12, 1, 4, 9, 11],
    "chorus-drift": [1, 5, 7, 8, 2, 9],
    "mirror-kaleido": [6, 7, 8, 10],
    "split-mirror": [10, 1, 8, 7],
    "bilateral-iris-fold": [8, 10, 7, 13],
    "mirror-gate-inversion": [10, 6, 8, 12],
    "prism-axis-lag": [8, 13, 10, 7],
    "quad-kaleido-choir": [6, 8, 9, 15],
    "reflection-slit-shatter": [12, 10, 11, 15],
    "prism-fold": [8, 7, 13, 2],
    "shear-kaleido": [6, 9, 12, 15],
    "quadrant-mirror-sweep": [10, 8, 7, 1],
    "micro-quadrant-reflect": [10, 8, 7, 13],
    "centrifugal-hex-mirror": [6, 8, 10, 15],
    "octant-mirror-zoom": [12, 10, 9, 15],
    "mirror-grid-dissolve": [10, 1, 8, 6],
    "kaleido-iris-zoom": [6, 8, 9, 15],
    "kaleido-tunnel-zoom": [8, 6, 13, 15],
    "snowflake-kaleido-bloom": [6, 8, 15, 9],
    "infinite-reflection-zoom": [8, 10, 6, 13],
    "facet-zoom-reveal": [12, 10, 15, 8],
    "tri-prism-fold": [8, 13, 7, 2],
    "hex-prism-cascade": [8, 13, 10, 7],
    "refractive-prism-spin": [8, 13, 6, 15],
    "prismatic-radial-wipe": [10, 8, 13, 15],
    "refractive-shard-tumble": [12, 13, 10, 15],
    "mirror-interlock-weave": [10, 8, 6, 7],
    "corridor-reflection-transit": [10, 8, 1, 7],
    "bilateral-flip-drift": [10, 8, 7, 13],
    "synchronized-mirror-slice": [10, 8, 12, 7],
    "glass-shatter-reflect": [12, 10, 11, 15],
    "diamond-concentric-fold": [10, 8, 7, 13],
    "vortex-mirror-spiral": [6, 8, 9, 15],
    "geometric-fractal-flip": [6, 8, 12, 15],
    "symmetry-spin-reveal": [6, 8, 9, 15],
    "crystal-facet-reveal": [8, 13, 10, 15],
    "halo-drift": [1, 5, 7, 8],
    "veil-shift": [1, 10, 7, 9],
    "echo-fold": [1, 7, 13, 8],
    "lattice-breath": [8, 13, 7, 6],
    "phase-ghost": [1, 5, 8, 10],
    "dolly-in": [8, 13, 7, 2],
    "dolly-out": [7, 8, 1, 5],
    "whip-pan-x": [10, 12, 14, 3],
    "whip-pan-y": [10, 11, 14, 4],
    "handheld-lurch": [1, 5, 9, 13],
    "crash-zoom": [14, 12, 8, 3],
    "snap-zoom-out": [10, 7, 1, 8],
    "parallax-slide": [1, 7, 8, 9],
    "tilt-reframe": [5, 10, 1, 7],
    "roll-sway": [6, 8, 13, 1],
    "fractal-tunnel": [6, 8, 9, 13],
    "acid-fold": [5, 7, 13, 9],
    "strobe-bloom": [14, 15, 3, 12],
    "liquid-lens": [1, 5, 7, 13],
    "solarize-drift": [1, 8, 10, 13],
    "chroma-smear": [10, 12, 14, 15],
    "afterimage-wheel": [6, 7, 8, 10],
    "mandala-pulse": [6, 8, 13, 9],
    "ink-melt": [5, 13, 2, 7],
    "trip-kaleido": [6, 9, 12, 15],
    "fractal-mirror-shatter": [12, 11, 6, 10],
    "chromatic-mandala-spin": [6, 8, 15, 13],
    "neon-radial-implosion": [14, 4, 15, 8],
    "prismatic-vortex-swirl": [6, 8, 13, 7],
    "hallucinogenic-hex-grid": [10, 1, 8, 9],
    "trippy-symmetry-ripple": [6, 9, 8, 15],
    "acid-wash-tunnel": [5, 6, 13, 9],
    "geometric-stardust-rotation": [7, 8, 13, 6],
    "psychedelic-pinwheel-dissolve": [6, 7, 8, 9],
    "color-shift-kaleidoscope-burst": [15, 14, 6, 12],
    "cosmic-dust-dispersion": [7, 8, 1, 13],
    "nebula-cloud-crossfade": [1, 5, 7, 9],
    "quantum-realm-warp": [6, 8, 13, 2],
    "soft-starlight-blur": [1, 5, 7, 8],
    "celestial-aurora-wipe": [10, 1, 4, 7],
    "supernova-glare-reveal": [14, 15, 4, 3],
    "ethereal-particle-drift": [1, 7, 8, 13],
    "galactic-smoke-sweep": [5, 13, 7, 1],
    "interstellar-light-bleed": [1, 8, 10, 15],
    "deep-space-flare-transition": [14, 15, 3, 8],
    "wright-whip-pan-particle-smear": [10, 12, 14, 15],
    "kon-reality-shatter-match-cut": [12, 11, 14, 6],
    "moore-nine-panel-particle-grid": [10, 1, 9, 8],
    "kojima-tactical-glitch-noise": [3, 12, 15, 14],
    "gilligan-time-lapse-particle-sand": [1, 5, 8, 13],
    "floyd-dark-side-prism-dispersal": [8, 7, 13, 15],
    "barlog-continuous-camera-particle-sweep": [8, 13, 7, 1],
    "joyce-fluid-text-morph": [5, 13, 7, 9],
    "kubrick-slit-scan-star-gate": [6, 8, 13, 14],
    "danielewski-house-typographic-distortion": [10, 12, 5, 13],
    "voronoi-drop-shatter": [11, 12, 14, 15],
    "wire-solid-phase-cut": [8, 10, 12, 13],
    "mobius-wrap-tunnel": [6, 8, 9, 13],
    "datamosh-vector-drag": [3, 10, 12, 15],
    "resolution-crash-snapback": [14, 10, 12, 8],
    "snare-negative-flip": [3, 14, 15, 10],
  };
  const pool = pools[family];
  const variantSeed = pairSeed + theme.transitionMode * 17 + theme.effectiveEffectMode * 13 + Math.round(theme.imageContrast * 100);
  const variant = ((variantSeed % pool.length) + pool.length) % pool.length;
  return sanitizeTransitionMode(pool[variant]!);
}

function transitionMotionGrammar(family: TransitionFamily): string {
  switch (family) {
    case "spiral-carry":
      return "spiral";
    case "orbital-shear":
      return "orbital-shear";
    case "phase-lattice":
      return "phase-lattice";
    case "ribbon-fold":
      return "ribbon-fold";
    case "axis-swap":
      return "axis-swap";
    case "chorus-drift":
      return "chorus-drift";
    case "mirror-kaleido":
    case "fractal-mirror-shatter":
    case "kon-reality-shatter-match-cut":
    case "mirror-gate-inversion":
    case "quad-kaleido-choir":
    case "centrifugal-hex-mirror":
    case "kaleido-iris-zoom":
    case "snowflake-kaleido-bloom":
    case "vortex-mirror-spiral":
    case "geometric-fractal-flip":
    case "symmetry-spin-reveal":
      return "mirror-kaleido";
    case "split-mirror":
    case "hallucinogenic-hex-grid":
    case "moore-nine-panel-particle-grid":
    case "bilateral-iris-fold":
    case "quadrant-mirror-sweep":
    case "micro-quadrant-reflect":
    case "mirror-grid-dissolve":
    case "mirror-interlock-weave":
    case "corridor-reflection-transit":
    case "bilateral-flip-drift":
    case "synchronized-mirror-slice":
    case "glass-shatter-reflect":
    case "diamond-concentric-fold":
      return "split-mirror";
    case "prism-fold":
    case "floyd-dark-side-prism-dispersal":
    case "prism-axis-lag":
    case "tri-prism-fold":
    case "hex-prism-cascade":
    case "refractive-prism-spin":
    case "prismatic-radial-wipe":
    case "refractive-shard-tumble":
    case "crystal-facet-reveal":
      return "prism-fold";
    case "shear-kaleido":
    case "trippy-symmetry-ripple":
    case "color-shift-kaleidoscope-burst":
    case "wire-solid-phase-cut":
    case "reflection-slit-shatter":
    case "octant-mirror-zoom":
    case "facet-zoom-reveal":
      return "shear-kaleido";
    case "kaleido-tunnel-zoom":
    case "infinite-reflection-zoom":
      return "mirror-tunnel";
    case "halo-drift":
    case "supernova-glare-reveal":
    case "deep-space-flare-transition":
      return "halo-drift";
    case "veil-shift":
    case "nebula-cloud-crossfade":
    case "soft-starlight-blur":
    case "celestial-aurora-wipe":
      return "veil-shift";
    case "echo-fold":
    case "ethereal-particle-drift":
      return "echo-fold";
    case "lattice-breath":
    case "gilligan-time-lapse-particle-sand":
      return "lattice-breath";
    case "phase-ghost":
    case "interstellar-light-bleed":
      return "phase-ghost";
    case "dolly-in":
    case "dolly-out":
    case "crash-zoom":
    case "snap-zoom-out":
    case "barlog-continuous-camera-particle-sweep":
    case "resolution-crash-snapback":
      return "camera-axial-push";
    case "whip-pan-x":
    case "whip-pan-y":
    case "wright-whip-pan-particle-smear":
      return "camera-whip";
    case "handheld-lurch":
    case "tilt-reframe":
      return "camera-handheld";
    case "roll-sway":
      return "camera-roll";
    case "parallax-slide":
      return "camera-parallax";
    case "fractal-tunnel":
    case "mandala-pulse":
    case "acid-wash-tunnel":
    case "prismatic-vortex-swirl":
    case "quantum-realm-warp":
    case "kubrick-slit-scan-star-gate":
    case "mobius-wrap-tunnel":
      return "psychedelic-tunnel";
    case "solarize-drift":
    case "chroma-smear":
    case "kojima-tactical-glitch-noise":
    case "snare-negative-flip":
      return "psychedelic-solarize";
    case "datamosh-vector-drag":
      return "glitch-noise";
    case "acid-fold":
    case "ink-melt":
    case "liquid-lens":
    case "galactic-smoke-sweep":
    case "joyce-fluid-text-morph":
    case "danielewski-house-typographic-distortion":
      return "psychedelic-melt";
    case "strobe-bloom":
    case "neon-radial-implosion":
      return "psychedelic-strobe";
    case "afterimage-wheel":
    case "trip-kaleido":
    case "chromatic-mandala-spin":
    case "geometric-stardust-rotation":
    case "psychedelic-pinwheel-dissolve":
    case "cosmic-dust-dispersion":
      return "psychedelic-kaleido";
    case "compress":
      return "compressive";
    case "fragment":
    case "voronoi-drop-shatter":
      return "fragment";
    case "flash":
      return "flash";
    case "wipe":
      return "wipe";
    case "melt-safe":
      return "melt";
    case "carry":
    default:
      return "carry";
  }
}

function safeRadius(radius: number, fallback = 1): number {
  if (!Number.isFinite(radius)) {
    return fallback;
  }
  return Math.max(0.001, radius);
}

function colorStats(theme: RenderTheme): Array<{ r: number; g: number; b: number }> {
  const profile = theme.styleProfile;
  return [
    { r: profile.averageR, g: profile.averageG, b: profile.averageB },
    { r: profile.medianR, g: profile.medianG, b: profile.medianB },
    { r: profile.modeR, g: profile.modeG, b: profile.modeB },
    { r: profile.rangeR, g: profile.rangeG, b: profile.rangeB },
  ];
}

function heroGlyphKinds(theme: RenderTheme, frame: AudioFrameFeature): HeroGlyphKind[] {
  const profile = theme.styleProfile;
  const kinds: HeroGlyphKind[] = [];
  if (profile.rangeR + profile.rangeG + profile.rangeB > 210) {
    kinds.push("star", "rose");
  }
  if (profile.symmetry > 0.6) {
    kinds.push("hexagon", "glint");
  }
  if (profile.contrast < 0.16) {
    kinds.push("blob", "crescent");
  }
  if (frame.dominantBand === "low") {
    kinds.push("spiral", "teardrop");
  } else if (frame.dominantBand === "mid") {
    kinds.push("infinity", "rose");
  } else {
    kinds.push("glint", "kite");
  }
  if (theme.styleProfile.shapeBias === "ring" || theme.styleProfile.shapeBias === "cloud") {
    kinds.push("crescent");
  }
  return [...new Set(kinds)].slice(0, 3);
}

function rgbaColor(stat: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${Math.round(clamp(stat.r, 0, 255))}, ${Math.round(clamp(stat.g, 0, 255))}, ${Math.round(clamp(stat.b, 0, 255))}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function isCircleHeroShellMode(mode: HeroPostShellMode | undefined): mode is "soft-halo" | "shock-ring" {
  return mode === "soft-halo" || mode === "shock-ring";
}

function buildBandEnergyProfile(frame: AudioFrameFeature): BandEnergyProfile {
  const low = clamp(frame.normalizedLow * 0.75 + frame.normalizedLowMid * 0.25, 0, 1);
  const mid = clamp(frame.normalizedMid * 0.72 + frame.normalizedLowMid * 0.18 + frame.beatPulse * 0.1, 0, 1);
  const high = clamp(frame.normalizedHigh * 0.76 + frame.peakStrength * 0.18 + frame.beatPulse * 0.06, 0, 1);
  return {
    low,
    mid,
    high,
    lowDominant: low >= mid && low >= high,
    midDominant: mid > low && mid >= high,
    highDominant: high > low && high > mid,
  };
}

function evaluateMotifPhysicsEnvelope(frame: AudioFrameFeature, profile: MotifPhysicsProfile): HeroPhysicsEnvelope {
  const weights = {
    subLow: frame.normalizedSubLow,
    low: frame.normalizedLow,
    mid: frame.normalizedMid,
    highMid: frame.normalizedHighMid,
    high: frame.normalizedHigh,
  };
  const rows = [
    { weight: weights.subLow, values: profile.matrix.subLow },
    { weight: weights.low, values: profile.matrix.low },
    { weight: weights.mid, values: profile.matrix.mid },
    { weight: weights.highMid, values: profile.matrix.highMid },
    { weight: weights.high, values: profile.matrix.high },
  ];
  return profile.channels.reduce((envelope, channel) => {
    const rowSum = rows.reduce((sum, row) => sum + row.weight * row.values[channel], 0);
    envelope[channel] = clamp(profile.base[channel] + rowSum, 0, channel === "burstFanout" ? 8 : 4);
    return envelope;
  }, {} as HeroPhysicsEnvelope);
}

function primitiveComplexity(kind: HeroPrimitiveKind): number {
  switch (kind) {
    case "line":
    case "rectangle":
    case "square":
    case "circle":
    case "ellipse":
    case "diamond":
    case "stadium":
      return 1;
    case "ring":
    case "arc":
    case "sector":
    case "cross":
    case "arrow":
    case "chevron":
    case "lens":
    case "parallelogram":
    case "kite":
    case "teardrop":
    case "moon":
      return 2;
    default:
      return 3;
  }
}

/* c8 ignore start */
export class FrameRenderer {
  private readonly canvas;
  private readonly ctx;
  private readonly feedbackCanvas;
  private readonly feedbackCtx;
  private readonly scratchCanvas;
  private readonly scratchCtx;
  private readonly bridgeCanvas;
  private readonly bridgeCtx;
  private readonly transitionCanvas;
  private readonly transitionCtx;
  private readonly vignetteCanvas;
  private readonly vignetteCtx;
  private readonly luminanceCanvas;
  private readonly luminanceCtx;
  private readonly themeCache = new Map<string, RenderTheme>();
  private readonly compositionPlanCache = new Map<string, CompositionPlan>();
  private readonly sceneGraphCache = new Map<string, SceneGraph>();
  private readonly transitionSceneGraphCache = new Map<string, SceneGraph>();
  private readonly activeTransitionSceneGraphCache = new Map<string, SceneGraph>();
  private readonly atmosphereGraphCache = new Map<string, AtmosphereGraph>();
  private readonly transitionGraphCache = new Map<string, TransitionGraph>();
  private readonly dustPositionsByImage = new Map<string, Array<{ x: number; y: number; radius: number }>>();
  private readonly particleStatesByImage = new Map<string, ParticleSystemState>();
  private readonly activeSubjectStatesByImage = new Map<string, ActiveSubjectState>();
  private readonly heroChildFieldStatesByImage = new Map<string, HeroChildFieldState[]>();
  private readonly shellEnabledWindowIndices = new Set<number>();
  private readonly heroShellWindowStates = new Map<number, HeroShellWindowRuntimeState>();
  private heroParticleScratchAx = new Float32Array(0);
  private heroParticleScratchAy = new Float32Array(0);
  private readonly stampAtlas = new ShapeStampAtlas();
  private transitionBridgeState?: TransitionBridgeState;
  private transitionState?: TransitionState;
  private lastTheme?: RenderTheme;
  private transitionFromTheme?: RenderTheme;
  private lastImagePath = "";
  private lastImageIndex = 0;
  private trailingLuminance = 0.09;
  private framesBelowFloor = 0;
  private recoveryStableFrames = 0;
  private safetyOverrideCount = 0;
  private recoveryOverrideFrameCount = 0;
  private lastSafetyMetrics: VisualSafetyMetrics = {
    luminance: 0.09,
    trailingLuminance: 0.09,
    framesBelowFloor: 0,
    brightnessFloor: 0.07,
    recoveryActive: false,
    safetyOverrideCount: 0,
    recoveryOverrideFrameCount: 0,
    recoveryOverrideFrameRatio: 0,
    recoverySeverityScore: 0,
    overlayModeUsed: "stable-feedback",
    transitionFamilyUsed: "carry",
  };
  private lastVisualState: VisualState = {
    frameIndex: 0,
    phraseIndex: 0,
    phraseStartFrame: 0,
    phraseEndFrame: 1,
    phraseStartSec: 0,
    phraseEndSec: 0,
    regime: "groove",
    brightnessFloor: 0.075,
    densityCap: 1,
    motionMode: "pulse",
    overlayMode: "stable-feedback",
    transitionFamily: "carry",
    shotMode: "detail",
      effectPolicy: "balanced",
      rescuePolicy: "lift",
      imageHoldMultiplier: 1,
      effectiveImageHoldMultiplier: 1,
      transientCutBias: 0,
      rapidPeakDensity: 0,
      transitionOpportunityBias: 1,
      imageSwapAllowed: true,
      transitionTriggerPreference: "swap",
      spawnArc: "swap",
      spawnEnergyTier: "mid",
      preferredCutFrame: 0,
      transitionDurationMultiplier: 1,
      transitionCarryBias: 0.7,
  };
  private lastActiveSubjectSnapshot: ActiveSubjectSnapshot = {
    mode: "hover",
    motionPx: 0,
    emphasis: 0.2,
    trailLength: 0,
    x: 0,
    y: 0,
  };
  private lastHeroCoverage = 0;
  private lastBackgroundClutterRatio = 0;
  private lastSupportCoverage = 0;
  private lastNegativeSpaceOccupancy = 0;
  private lastTransitionDurationFrames = 0;
  private lastTransitionBaseDurationFrames = 0;
  private lastTransitionCappedDurationFrames = 0;
  private lastTransitionCapLossFrames = 0;
  private lastTransitionRiskScore = 0;
  private lastTransitionCapCategory: RenderQualityBudget["transitionBudgetTier"] = "full";
  private lastTransitionCarryStrength = 0;
  private lastTransitionCarryMode: TransitionCarryProfile["mode"] = "full";
  private lastTransitionCarryAvailabilityScore = 0;
  private lastTransitionCarryFallbackReason: TransitionCarryReason = "ok";
  private lastTransitionMotionGrammar = "";
  private lastShapePlacementScore = 0;
  private lastCompositionMode: CompositionPlan["stylePlacementMode"] = "filament";
  private lastAtmosphereDensity = 0;
  private lastMidScaleCoverage = 0;
  private lastSymmetryUsage = 0;
  private lastEventDensity = 0;
  private lastEmitterUsage = 0;
  private lastAbsorberUsage = 0;
  private lastExplosionCount = 0;
  private lastSourceAffinityAvg = 0;
  private lastSourceAffinityHeroAvg = 0;
  private lastSourceAffinitySupportAvg = 0;
  private lastParticleConvergenceScore = 0;
  private lastSubEmitterChildren = 0;
  private lastHeroEchoCount = 0;
  private lastHeroGlyphComplexity = 0;
  private lastHeroPrimitive?: HeroPrimitiveKind;
  private lastHeroShellMode?: HeroPostShellMode;
  private lastHeroBaseShellMode?: HeroPostShellMode;
  private lastHeroResolvedShellMode?: HeroPostShellMode;
  private lastHeroCircleShellEligible = false;
  private lastHeroCircleShellPromoted = false;
  private lastHeroShellSceneEnabled = false;
  private lastHeroShellConfiguredCount: 0 | 1 | 2 | 3 = 0;
  private lastHeroShellColorMode: HeroShellColorMode = "single";
  private lastHeroShellActiveCount = 0;
  private lastHeroShellActivationDriverBand: HeroShellBand = "low";
  private lastHeroShellTriggerRateLow = 0;
  private lastHeroShellTriggerRateLowMid = 0;
  private lastHeroShellTriggerRateLowComposite = 0;
  private lastHeroShellThresholdLow = 0;
  private lastHeroShellThresholdLowMid = 0;
  private lastHeroShellThresholdLowComposite = 0;
  private lastHeroShellTriggerRateHighMid = 0;
  private lastHeroShellTriggerRateHigh = 0;
  private lastHeroShellTriggerRateUpper = 0;
  private lastHeroShellThresholdHighMid = 0;
  private lastHeroShellThresholdHigh = 0;
  private lastHeroShellThresholdUpper = 0;
  private lastHeroSubEmitterCount = 0;
  private lastHeroCoreSize = 0;
  private lastHeroCoreFillMode: HeroCoreFillMode = "solid";
  private lastHeroOutlineRatio = 0;
  private lastHeroPrimitiveComplexity = 0;
  private lastHeroChildEmissionRate = 0;
  private lastHeroChildFieldDensity = 0;
  private lastHeroChildFieldRadius = 0;
  private lastHeroTrailOccupancy = 0;
  private lastHeroWakeLengthPx = 0;
  private lastHeroBurstCount = 0;
  private lastHeroBurstChildren = 0;
  private lastHeroMotorJitter = 0;
  private lastHeroMotorThrust = 0;
  private lastHeroBurnPhase = 0;
  private lastHeroWakeTailAgeAvg = 0;
  private lastHeroWakeResetCount = 0;
  private lastHeroSpeedAvg = 0;
  private lastHeroSpeedPeak = 0;
  private lastHeroBaselineEmissionScale = 1;
  private lastHeroZeroDbRecovery = 1;
  private lastHeroScalePulseAvg = 1;
  private lastHeroScalePulsePeak = 1;
  private lastMotifPotencyScore = 0;
  private lastTransitionTriggerMode: "swap" | "hold" = "swap";
  private heldTransitionCount = 0;
  private swapTransitionCount = 0;
  private heldTransitionStreak = 0;
  private lastSwapFrameIndex = -10_000;
  private lastTransitionEventFrameIndex = -10_000;
  private nextAllowableTransitionFrame = -10_000;
  private lastTransitionCooldownContext: TransitionCooldownContext = {
    nominalNextAllowableFrame: -10_000,
    reducedNextAllowableFrame: -10_000,
    cooldownReduction: 0,
    dbReduction: 0,
    hzReduction: 0,
    audioCooldownTriggeredTransition: false,
    acceleratedByDb: false,
    acceleratedByHz: false,
  };
  private lastDbOverall = 0;
  private lastDominantHz = 220;
  private lastHeroShellInnerAlpha = 0;
  private lastHeroShellOuterAlpha = 0;
  private lastHeroBandLowUsage = 0;
  private lastHeroBandMidUsage = 0;
  private lastHeroBandHighUsage = 0;
  private lastHeroEmitterTopology = "";
  private lastHeroInstanceVariant = "";
  private lastHeroContrastBowlUsed = false;
  private lastHeroTravelGracefulBias = 0;
  private lastHeroTravelGlitchBias = 0;
  private lastHeroTargetSmoothing = 0;
  private lastHeroSpinVelocity = 0;
  private lastMotionTier: "jump" | "glide" | "flourish" = "glide";
  private lastJumpTriggered = false;
  private lastJitterSuppressed = false;
  private lastMotionTierReadable = true;
  private lastFlourishStrength = 0;
  private lastScreenEdgeAimBias = 0;
  private lastStreamCenterBiasDegrees = 0;
  private lastCenterwardEmissionRatio = 0;
  private lastEdgePressureActiveFrameRatio = 0;
  private centerwardEmissionAlignmentSum = 0;
  private centerwardEmissionSampleCount = 0;
  private edgePressureActiveSampleCount = 0;
  private edgePressureSampleCount = 0;
  private lastHeroBurstGateActiveRatio = 0;
  private lastHeroBurstCadenceSlotHits = 0;
  private lastHeroBurstTopQuartileRatio = 0;
  private lastHeroShellHueTravel = 0;
  private lastHeroShellUnderlayActive = false;
  private lastHeroSpawnRegion = "";
  private lastHeroParticleExitWhiteBias = 0;
  private lastHeroParticleSizeVariance = "";
  private lastHeroColorProminence = "";
  private lastHeroMotifInfluenceKey = "";
  private lastHeroMotionBias = "";
  private lastHeroMotifProfile = "";
  private lastHeroMotifScheduled = "";
  private lastHeroMotifSlotIndex = 0;
  private lastHeroMotifSlotStartSec = 0;
  private lastHeroMotifSlotEndSec = 0;
  private lastHeroMotifScheduleReason: HeroMotifScheduleSlot["reason"] = "body-hold";
  private lastHeroMotifChangedOnSlotBoundary = false;
  private lastHeroMotifChangedOutsideSlot = false;
  private lastHeroMotifScheduleMismatch = false;
  private lastHeroMotifVariantKey = "";
  private lastHeroVariantWarp = 0;
  private lastHeroVariantGravity = 0;
  private lastHeroVariantInconsistency = 0;
  private lastHeroParticleSizeAvg = 0;
  private lastHeroParticleTtlAvg = 0;
  private lastHeroConductorCount = 0;
  private lastHeroConductorType = "";
  private lastHeroConductorInfluenceRadiusAvg = 0;
  private lastHeroCircleEmitterNodeCoverage = 0;
  private lastHeroExpandedBandCount = 3;
  private lastHeroRelationshipMode: HeroRelationshipMode = "independent";
  private lastHeroRelationshipClass: HeroRelationshipClass = "independent";
  private lastHeroLayoutFamily?: SceneGraph["heroLayoutFamily"];
  private lastHeroInstanceCountResolved = 1;
  private lastHeroPairMinDistancePx = 0;
  private lastHeroPairAvgDistancePx = 0;
  private lastHeroOverlapRatio = 0;
  private lastHeroCoreOverlapRatio = 0;
  private lastHeroGlowMergeRatio = 0;
  private lastHeroLaneDiversityScore = 0;
  private lastHeroDistinctQuadrantCount = 1;
  private lastHeroRelationshipResolved: HeroRelationshipMode = "independent";
  private lastHeroSeparationReadable = true;
  private lastHeroSeparationFailureReason: HeroSeparationFailureReason = "none";
  private lastShotGrammarKey = "";
  private lastFocalOccupancyScore = 0;
  private lastCenterBiasScore = 1;
  private lastFocalQuadrant: "tl" | "tr" | "bl" | "br" | "center" = "center";
  private lastHeroQuadrant: "tl" | "tr" | "bl" | "br" | "center" = "center";
  private lastBrightestBlobQuadrant: "tl" | "tr" | "bl" | "br" | "center" = "center";
  private lastSupportClusterCount = 0;
  private lastSupportNearHeroScore = 0;
  private lastEdgeHighlightPenalty = 0;
  private lastEdgeDominanceMargin = 0;
  private lastDeadCenterVoidScore = 0;
  private lastFocalReinforcementScore = 0;
  private lastDbTransitionDrive = 0;
  private lastBandWeightedTransitionDrive = 0;
  private lastHzTransitionDrive = 0;
  private lastAudioTransitionScore = 0;
  private lastHoldPenalty = 0;
  private lastSwapPromotedByAudio = false;
  private lastAudioSwapPromotionChance = 0;
  private lastAudioSwapPromotionExtraChance = 0;
  private lastAudioSwapNodeTriggerCount = 0;
  private lastHeroSwapEligible = false;
  private lastHeroSwapSuppressedByGrace = false;
  private lastHeroSwapAudioDrive = 0;
  private lastSceneKey: SceneKey = "";
  private lastBackgroundElementId?: BackgroundElementId;
  private lastBackgroundSelectionReason = "";
  private lastBackgroundElementFamily?: BackgroundElementFamily;
  private lastBackgroundTriggerMode?: BackgroundTriggerMode;
  private lastBackgroundInteractionMode?: BackgroundInteractionMode;
  private lastBackgroundHeroCouplingStrength = 0;
  private lastBackgroundParticleCouplingStrength = 0;
  private lastBackgroundTriggeredThisFrame = false;
  private lastBackgroundHeroInteractionActive = false;
  private lastBackgroundTriggeredFrameRatio = 0;
  private lastBackgroundPeakColorEligible = false;
  private lastBackgroundPeakColorDrive = 0;
  private lastBackgroundColorfulnessScale = 1;
  private lastBackgroundLuminosityLiftAvg = 0;
  private lastBackgroundMinorImpactDrive = 0;
  private lastSupportElementDensity = 0;
  private lastBackgroundElementDensity = 0;
  private lastHeroIsolationScore = 0;
  private lastNearHeroEventDensity = 0;
  private lastHeroToSupportDistanceScore = 0;
  private lastParticleSpawnRequests = 0;
  private lastParticleRenderedCount = 0;
  private lastParticleCulledByLayerCap = 0;
  private lastParticleCulledByHeroProtection = 0;
  private lastParticleCulledByNegativeSpace = 0;
  private lastParticleCulledByImageProgress = 0;
  private lastParticleCulledBySkipNonHero = 0;
  private lastParticleOffscreenCount = 0;
  private lastParticleTooSmallToReadCount = 0;
  private lastParticleLowAlphaCount = 0;
  private lastParticleLowContrastCount = 0;
  private lastParticleVisibleCount = 0;
  private lastParticleVisibleRatio = 0;
  private lastHeroParticleRenderedCount = 0;
  private lastSupportParticleRenderedCount = 0;
  private lastBackgroundParticleRenderedCount = 0;
  private lastSubEmitterTriggerCount = 0;
  private lastSubEmitterChildSpawnedCount = 0;
  private lastEdgeDeathEligibleCount = 0;
  private lastEdgeDeathTriggeredCount = 0;
  private lastEdgeDeathPlayedCount = 0;
  private lastEdgeDeathSkippedByCostCount = 0;
  private lastEdgeDeathEffectId?: string;
  private lastEdgeDeathCostTier?: "low" | "medium" | "high";
  private lastEdgeExitFramesAvg = 0;
  private lastEdgeExitDistanceAvg = 0;
  private lastHeroSubEmitterFamily?: SceneGraph["heroSubEmitterFamily"];
  private lastHeroSubEmitterVariant = "";
  private lastHeroSubEmitterMotifAlignmentScore = 0;
  private lastRecoveryMode: RecoveryMode = "none";
  private lastFallbackRenderMode: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery" = "none";
  private lastFallbackReason: import("../types").FallbackReason = "none";
  private lastFallbackTriggerCount = 0;
  private lastFallbackSeverity: "none" | "light" | "full" = "none";
  private lastCompositionModeReason: import("../types").CompositionModeReason = "normal";
  private lastParticleTelemetryAvailable = false;
  private lastVisibleFallbackRisk = false;
  private lastTransitionIdentitySignature = "";
  private lastTransitionIdentityChanged = false;
  private lastMotifChangedOnTransition = false;
  private lastHeroChangedOnTransition = false;
  private lastMotifEffectId?: MotifEffectId;
  private lastMotifEffectSpec?: MotifEffectSpec;
  private lastMotifEffectState?: MotifEffectState;
  private lastMotifEffectPhenomenon?: PhysicalPhenomenonFamily;
  private lastMotifEffectAudioMode?: MotifEffectAudioMode;
  private lastMotifEffectIntensity = 0;
  private lastHeroWarpActive = false;
  private lastMotifEffectSelectionKey = "";
  private lastMotifEffectSelectionReason = "";
  private lastSelectedMotifEffectByMotif = new Map<EdgeMap["fractalMotif"], MotifEffectId>();
  private lastParticleConceptIds: ParticleConceptId[] = [];
  private lastParticleSelectionReason = "";
  private persistentMotifState?: PersistentMotifState;
  private lastPersistentMotifChanged = false;
  private lastEventSpec?: EventSpec;
  private lastEventState?: EventState;
  private lastEventSpecSelectionKey = "";
  private lastEventSelectionReason = "";
  private lastEventChangeFrameIndex = -10_000;
  private lastOutroEffectId?: OutroEffectId;
  private lastOutroEffectSpec?: OutroEffectSpec;
  private lastOutroEffectState?: OutroEffectState;
  private lastOutroEffectCategory?: OutroEffectCategory;
  private lastOutroEffectAudioMode?: OutroEffectAudioMode;
  private lastOutroEffectIntensity = 0;
  private lastOutroEffectImageSignature?: string;
  private lastOutroCoverageEstimate = 0;
  private lastOutroHeroWarp = 0;
  private lastOutroTerminalBurstProgress = 0;
  private lastOutroEffectSelectionKey = "";
  private lastOutroEffectCategoryByPhrase = new Map<number, OutroEffectCategory>();
  private readonly recentOutroEffectBars = new Map<OutroEffectId, number>();
  private lastFramePostEffectId?: FramePostEffectId;
  private lastFramePostEffectSpec?: FramePostEffectSpec;
  private lastFramePostEffectState?: FramePostEffectState;
  private lastFramePostEffectIntensity = 0;
  private lastFramePostEffectSelectionKey = "";
  private lastHeroWarpBeatIndex = -10_000;
  private readonly rollingDbWindow = createRollingDbWindowState(120);
  private lastQuarterSpawnGuaranteeHitCount = 0;
  private lastQuarterSpawnGuaranteeMissCount = 0;
  private lastQuarterSpawnBeatIndex = -1;
  private lastEdgeAttractionScale = 1.5;
  private lastBudgetDowngradeCount = 0;
  private lastOverlayOpacityAvg = 0;
  private lastOverlayCompositeMode = "source-over";
  private lastEffectVisible = false;
  private lastEffectVisiblePixelRatio = 0;
  private lastEffectMotionDelta = 0;
  private lastPreEffectLuminanceSample: number | undefined;
  private lastDarkestQuartileLuminance = 0;
  private lastMainHeroLowDbThrottle = false;
  private lastMainHeroFreezeActive = false;
  private lastLowResFrameStats: LowResFrameStats = {
    luminanceSample: 0.2,
    darkestQuartileLuminance: 0.2,
    darkSampleCount: 0,
    sampleCount: 0,
  };
  private renderedFrameCount = 0;
  private lastAdaptiveDegradeLevel = 0;
  private lastTransitionBudgetTier: RenderQualityBudget["transitionBudgetTier"] = "full";
  private lastTransitionBudgetReason = "";
  private lastEncoderPressureMs = 0;
  private readonly renderDurationSec: number;
  private readonly nodeWindowCount: number;
  private readonly tailCarryWindowIndex?: number;
  private readonly heroMotifSchedule: HeroMotifSchedule;
  private hasSeenDropRegime = false;
  private readonly audioTriggeredTransitionCountByWindowIndex = new Map<number, number>();
  private lastRenderSelection: ActiveRenderSelection = {
    requestedImageIndex: 0,
    resolvedImageIndex: 0,
    segmentIndex: 0,
    imagePath: "",
    themeImagePath: "",
  };
  private lastStageMetrics: RenderStageMetrics = {
    backgroundMs: 0,
    particlesMs: 0,
    occupancyMs: 0,
    atmosphereMs: 0,
    effectsMs: 0,
    transitionMs: 0,
    heroMs: 0,
    luminanceReadbackMs: 0,
    luminanceReadbackMode: "full",
    luminanceReadbackSampleInterval: 1,
    luminanceReadbackFramesSampled: 0,
    luminanceReadbackFramesSkipped: 0,
    luminanceReadbackMsSavedEstimate: 0,
    encoderReadbackMs: 0,
    stampDrawCount: 0,
    supportStampDrawCount: 0,
    backgroundStampDrawCount: 0,
    vectorDrawCount: 0,
    occupancyDrawCount: 0,
    heroGlyphDrawCount: 0,
    veilDrawCount: 0,
    bridgeDrawCount: 0,
    localGlowDrawCount: 0,
    gradientCreateCount: 0,
    avgSupportMotionPx: 0,
    avgBackgroundMotionPx: 0,
  };

  constructor(
    private readonly settings: RenderSettings,
    private readonly bpm: number,
    private readonly beatOriginSec: number,
    private readonly disableNebula: boolean,
    private readonly edgeMaps: EdgeMap[],
    private readonly segments: AudioSegmentFeature[],
    private readonly schedule: ImageSchedule,
    private readonly visualPlan: VisualPhrasePlan[],
    private readonly trackAverageDbOverall?: number,
    private readonly fastMode = false,
    private readonly themeQuery?: string,
    private readonly diagnosticOverrides: DiagnosticOverrides = {},
  ) {
    this.renderDurationSec = Math.max(
      1e-6,
      this.visualPlan[this.visualPlan.length - 1]?.endSec ?? this.edgeMaps.length * this.schedule.secondsPerImage,
    );
    const scheduledWindowCount = Math.max(
      1,
      Math.min(this.edgeMaps.length, Math.ceil(this.renderDurationSec / Math.max(1e-6, this.schedule.secondsPerImage))),
    );
    const finalWindowStartSec = Math.max(0, (scheduledWindowCount - 1) * this.schedule.secondsPerImage);
    const finalWindowDurationSec = this.renderDurationSec - finalWindowStartSec;
    const hasTinyTailCarry =
      scheduledWindowCount > 1 &&
      finalWindowDurationSec > 0 &&
      finalWindowDurationSec < Math.min(this.schedule.secondsPerImage * 0.2, 0.35);
    this.tailCarryWindowIndex = hasTinyTailCarry ? scheduledWindowCount - 1 : undefined;
    this.nodeWindowCount = Math.max(1, scheduledWindowCount - (hasTinyTailCarry ? 1 : 0));
    this.heroMotifSchedule = buildHeroMotifSchedule({
      edgeMaps: this.edgeMaps,
      visualPlan: this.visualPlan,
      secondsPerImage: this.schedule.secondsPerImage,
      renderDurationSec: this.renderDurationSec,
    });
    this.canvas = createCanvas(settings.width, settings.height);
    this.feedbackCanvas = createCanvas(settings.width, settings.height);
    this.scratchCanvas = createCanvas(settings.width, settings.height);
    this.bridgeCanvas = createCanvas(settings.width, settings.height);
    this.transitionCanvas = createCanvas(settings.width, settings.height);
    this.vignetteCanvas = createCanvas(settings.width, settings.height);
    this.luminanceCanvas = createCanvas(LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT);

    const context = this.canvas.getContext("2d");
    const feedbackContext = this.feedbackCanvas.getContext("2d");
    const scratchContext = this.scratchCanvas.getContext("2d");
    const bridgeContext = this.bridgeCanvas.getContext("2d");
    const transitionContext = this.transitionCanvas.getContext("2d");
    const vignetteContext = this.vignetteCanvas.getContext("2d");
    const luminanceContext = this.luminanceCanvas.getContext("2d");
    if (!context || !feedbackContext || !scratchContext || !bridgeContext || !transitionContext || !vignetteContext || !luminanceContext) {
      throw new Error("Unable to create 2D canvas context.");
    }
    this.ctx = context;
    this.feedbackCtx = feedbackContext;
    this.scratchCtx = scratchContext;
    this.bridgeCtx = bridgeContext;
    this.transitionCtx = transitionContext;
    this.vignetteCtx = vignetteContext;
    this.luminanceCtx = luminanceContext;
    this.rollingDbWindow.maxFrames = Math.max(8, Math.round(((60 / Math.max(1, this.bpm)) * 8) * this.settings.fps));
    this.buildVignette();
    for (const windowIndex of this.buildHeroShellEnabledWindowSet()) {
      this.shellEnabledWindowIndices.add(windowIndex);
    }
    this.initializeHeroShellWindowStates();
  }

  renderFrame(frame: AudioFrameFeature): RenderedFrame {
    const previousStageMetrics = this.lastStageMetrics;
    this.lastStageMetrics = {
      backgroundMs: 0,
      particlesMs: 0,
      occupancyMs: 0,
      atmosphereMs: 0,
      effectsMs: 0,
      transitionMs: 0,
      heroMs: 0,
      luminanceReadbackMs: 0,
      luminanceReadbackMode: this.fastMode ? "budget-gated" : "full",
      luminanceReadbackSampleInterval: this.fastMode ? BUDGET_LUMINANCE_SAMPLE_INTERVAL : 1,
      luminanceReadbackFramesSampled: 0,
      luminanceReadbackFramesSkipped: 0,
      luminanceReadbackMsSavedEstimate: 0,
      encoderReadbackMs: 0,
      stampDrawCount: 0,
      supportStampDrawCount: 0,
      backgroundStampDrawCount: 0,
      vectorDrawCount: 0,
      occupancyDrawCount: 0,
      heroGlyphDrawCount: 0,
      veilDrawCount: 0,
      bridgeDrawCount: 0,
      localGlowDrawCount: 0,
      gradientCreateCount: 0,
      avgSupportMotionPx: 0,
      avgBackgroundMotionPx: 0,
    };
    this.lastOverlayOpacityAvg = 0;
    this.lastOverlayCompositeMode = "source-over";
    this.lastEffectVisible = false;
    this.lastEffectVisiblePixelRatio = 0;
    this.lastEffectMotionDelta = 0;
    this.lastPreEffectLuminanceSample = undefined;
    this.lastOutroEffectId = undefined;
    this.lastOutroEffectSpec = undefined;
    this.lastOutroEffectState = undefined;
    this.lastOutroEffectCategory = undefined;
    this.lastOutroEffectAudioMode = undefined;
    this.lastOutroEffectIntensity = 0;
    this.lastOutroEffectImageSignature = undefined;
    this.lastOutroCoverageEstimate = 0;
    this.lastOutroHeroWarp = 0;
    this.lastOutroTerminalBurstProgress = 0;
    this.lastFramePostEffectId = undefined;
    this.lastFramePostEffectSpec = undefined;
    this.lastFramePostEffectState = undefined;
    this.lastFramePostEffectIntensity = 0;
    const phraseFrame = this.withPhrasePulse(frame);
    updateRollingDbWindowState(this.rollingDbWindow, phraseFrame);
    const baseVisualState = getVisualStateAtFrame(frame.frameIndex, this.visualPlan);
    const phrasePlan = this.visualPlan[baseVisualState.phraseIndex];
    const scheduleWindowIndex = this.effectiveWindowIndexAtTime(frame.timeSec);
    const scheduleEdgeMap = this.edgeMaps[scheduleWindowIndex]!;
    const scheduleSegmentIndex = Math.min(phraseFrame.segmentIndex, this.segments.length - 1, this.edgeMaps.length - 1);
    const scheduleTheme = this.getTheme(scheduleSegmentIndex, this.segmentForIndex(scheduleSegmentIndex), scheduleEdgeMap);
    let persistentMotifSpec =
      this.persistentMotifState
        ? PERSISTENT_MOTIF_SPECS.find((entry) => entry.id === this.persistentMotifState?.id)
        : undefined;
    if (!persistentMotifSpec) {
      persistentMotifSpec = selectInitialPersistentMotif(
        scheduleEdgeMap,
        baseVisualState.regime,
        scheduleTheme,
        phraseFrame.frameIndex,
      );
      const beatIndex = phraseFrame.beatIndex ?? phraseFrame.frameIndex;
      this.persistentMotifState = buildPersistentMotifState(persistentMotifSpec, 0, 0, "startup", transientPeakScore(phraseFrame, phrasePlan), beatIndex);
      this.lastPersistentMotifChanged = true;
    } else {
      this.lastPersistentMotifChanged = false;
      if (shouldRotatePersistentMotif({
        frame: phraseFrame,
        phrasePlan,
        current: this.persistentMotifState,
        spec: persistentMotifSpec,
        frameIndex: phraseFrame.frameIndex,
      })) {
        const nextSpec = selectNextPersistentMotif({
          currentId: persistentMotifSpec.id,
          edgeMap: scheduleEdgeMap,
          visualRegime: baseVisualState.regime,
          theme: scheduleTheme,
          frame: phraseFrame,
          phrasePlan,
        });
        persistentMotifSpec = nextSpec;
        this.persistentMotifState = buildPersistentMotifState(nextSpec, 0, 0, "transient-peak", transientPeakScore(phraseFrame, phrasePlan), phraseFrame.beatIndex ?? phraseFrame.frameIndex);
        this.lastPersistentMotifChanged = true;
      } else if (this.persistentMotifState) {
        this.persistentMotifState = {
          ...this.persistentMotifState,
          ageFrames: this.persistentMotifState.ageFrames + 1,
          carryFrames: this.persistentMotifState.carryFrames + 1,
          transientScore: transientPeakScore(phraseFrame, phrasePlan),
          changedThisFrame: false,
        };
      }
    }
    const visualState: VisualState = {
      ...baseVisualState,
      persistentMotifId: this.persistentMotifState?.id,
      persistentMotifLabel: this.persistentMotifState?.label,
      persistentMotifChangeGate: this.persistentMotifState?.changeGate,
      persistentMotifAgeFrames: this.persistentMotifState?.ageFrames,
    };
    const adaptiveEffectBudget = this.resolveAdaptiveEffectBudget(visualState, phraseFrame, previousStageMetrics, this.lastBudgetDowngradeCount);
    this.lastAdaptiveDegradeLevel = adaptiveEffectBudget.adaptiveDegradeLevel;
    this.lastVisualState = visualState;
    const baseImageIndex = scheduleWindowIndex;
    const transitionTransientDrive = clamp(
      phraseFrame.peakStrength * 0.45 +
      phraseFrame.onsetStrength * 0.25 +
      phraseFrame.normalizedHighMid * 0.2 +
      phraseFrame.normalizedHigh * 0.1,
      0,
      1.4,
    );
    const currentHz = Math.max(1, phraseFrame.dominantHz || 220);
    const previousHz = Math.max(1, this.lastDominantHz || currentHz);
    const factorScale = this.hasSeenDropRegime || visualState.regime === "drop" ? POST_DROP_AUDIO_FACTOR_SCALE : PRE_DROP_AUDIO_FACTOR_SCALE;
    const dbTransitionDrive = clamp(((phraseFrame.dbOverall - this.lastDbOverall) / 12) * factorScale, -1, 1);
    const bandWeightedTransitionDrive = clamp((phraseFrame.bandWeightedScore ?? 0) * 1.35 + (phraseFrame.impactBandScore ?? 0) * 0.45, 0, 1.6);
    const hzTransitionDrive = clamp(Math.log2(currentHz / previousHz) * factorScale, -1, 1);
    const phraseContrastDrive = clamp((visualState as typeof visualState & { phraseContrastVsPrevious?: number }).phraseContrastVsPrevious ?? 0, 0, 1);
    const positiveDbTransitionDrive = Math.max(0, dbTransitionDrive);
    const positiveHzTransitionDrive = Math.max(0, hzTransitionDrive);
    const audioTransitionScore = clamp(
      transitionTransientDrive * 0.9 +
      bandWeightedTransitionDrive * 0.95 +
      positiveDbTransitionDrive * 0.55 +
      positiveHzTransitionDrive * 0.5 +
      phraseContrastDrive * 0.65,
      0,
      3,
    );
    const heldRatio = this.heldTransitionCount / Math.max(1, this.heldTransitionCount + this.swapTransitionCount);
    const holdPenalty =
      heldRatio >= 0.9 && (audioTransitionScore >= 1.45 || phraseContrastDrive >= 0.18) ? 0.35 :
      heldRatio >= 0.82 && (audioTransitionScore >= 1.15 || (phraseFrame.impactBandScore ?? 0) >= 0.34) ? 0.2 :
      0;
    this.lastDbTransitionDrive = dbTransitionDrive;
    this.lastBandWeightedTransitionDrive = bandWeightedTransitionDrive;
    this.lastHzTransitionDrive = hzTransitionDrive;
    this.lastAudioTransitionScore = audioTransitionScore;
    this.lastHoldPenalty = holdPenalty;
    this.lastSwapPromotedByAudio = false;
    this.lastAudioSwapPromotionChance = 0;
    this.lastAudioSwapPromotionExtraChance = 0;
    this.lastAudioSwapNodeTriggerCount = 0;
    this.lastHeroSwapEligible = false;
    this.lastHeroSwapSuppressedByGrace = false;
    this.lastHeroSwapAudioDrive = 0;
    const nominalNextAllowableTransitionFrame = this.nextAllowableTransitionFrame;
    const dbReduction = Math.round(positiveDbTransitionDrive * this.settings.fps * 0.9);
    const hzReduction = Math.round(positiveHzTransitionDrive * this.settings.fps * 0.45);
    const cooldownReduction = Math.round((dbReduction + hzReduction) * 0.95);
    const reducedNextAllowableTransitionFrame = Math.max(phraseFrame.frameIndex, this.nextAllowableTransitionFrame - cooldownReduction);
    const audioCooldownPromotionWindow =
      phraseFrame.frameIndex >= reducedNextAllowableTransitionFrame &&
      phraseFrame.frameIndex < nominalNextAllowableTransitionFrame;
    const scheduledAdvanceAvailable = this.lastImageIndex >= 0 && baseImageIndex > this.lastImageIndex;
    const outroTransitionLocked = visualState.regime === "outro" && this.lastImagePath !== "";
    const framesSinceLastTransition = phraseFrame.frameIndex - this.lastTransitionEventFrameIndex;
    const stackPressure = clamp(
      this.heldTransitionStreak * 0.35 +
      Math.max(0, 1 - framesSinceLastTransition / Math.max(1, Math.round(this.settings.fps * 0.9))) * 0.65,
      0,
      1,
    );
    const existingNodeTriggerCount = this.audioTriggeredTransitionCountByWindowIndex.get(baseImageIndex) ?? 0;
    const nodeTriggerPressure = clamp(existingNodeTriggerCount / 3, 0, 1);
    const promotionExtraChance = AUDIO_SWAP_PROMOTION_EXTRA_CHANCE * clamp(stackPressure * 0.6 + nodeTriggerPressure * 0.4, 0, 1);
    const promotionChance = AUDIO_SWAP_PROMOTION_BASE_CHANCE + promotionExtraChance;
    const promoteHeldImageByAudio =
      !outroTransitionLocked &&
      audioCooldownPromotionWindow &&
      scheduledAdvanceAvailable &&
      (stableHash(`audio-cooldown-image:${phraseFrame.frameIndex}:${baseImageIndex}:${this.lastImageIndex}:${this.lastImagePath}`) % 100) < Math.round(promotionChance * 100);
    this.lastAudioSwapPromotionChance =
      !outroTransitionLocked && audioCooldownPromotionWindow && scheduledAdvanceAvailable ? promotionChance : 0;
    this.lastAudioSwapPromotionExtraChance =
      !outroTransitionLocked && audioCooldownPromotionWindow && scheduledAdvanceAvailable ? promotionExtraChance : 0;
    this.lastAudioSwapNodeTriggerCount = existingNodeTriggerCount;
    const effectiveImageSwapAllowed =
      !outroTransitionLocked &&
      (this.lastImagePath === "" ? true : (visualState.imageSwapAllowed || promoteHeldImageByAudio));
    this.nextAllowableTransitionFrame = reducedNextAllowableTransitionFrame;
    this.lastDbOverall = phraseFrame.dbOverall;
    this.lastDominantHz = currentHz;
    if (visualState.regime === "drop") {
      this.hasSeenDropRegime = true;
    }
    let requestedImageIndex = resolveRequestedImageIndex(baseImageIndex, effectiveImageSwapAllowed, this.lastImageIndex);
    let resolvedImageIndex = clamp(requestedImageIndex, 0, this.edgeMaps.length - 1);
    const imageStartSec = requestedImageIndex * this.schedule.secondsPerImage;
    const imageSpan = Math.max(1e-6, this.schedule.secondsPerImage * visualState.effectiveImageHoldMultiplier);
    const imageProgress = clamp((phraseFrame.timeSec - imageStartSec) / imageSpan, 0, 1);
    const segmentIndex = Math.min(phraseFrame.segmentIndex, this.segments.length - 1, this.edgeMaps.length - 1);
    const edgeMap = this.edgeMaps[resolvedImageIndex]!;
    const segment =
      this.segments[Math.max(0, segmentIndex)] ?? {
        index: 0,
        startSec: 0,
        endSec: 0,
        dominantHz: 220,
        dominantBand: "mid" as const,
        rainbowHueOffset: 180,
        paletteWeights: { low: 0.25, lowMid: 0.25, mid: 0.25, high: 0.25 },
        motionScale: 1,
        densityScale: 1,
    };
    const isInitialFrame = this.lastImagePath === "";
    const theme = this.getTheme(segmentIndex, segment, edgeMap);
    if (persistentMotifSpec && this.persistentMotifState?.id !== persistentMotifSpec.id) {
      this.persistentMotifState = buildPersistentMotifState(
        persistentMotifSpec,
        this.persistentMotifState?.ageFrames ?? 0,
        this.persistentMotifState?.carryFrames ?? 0,
        this.persistentMotifState?.changeGate ?? "startup",
        transientPeakScore(phraseFrame, phrasePlan),
        phraseFrame.beatIndex ?? phraseFrame.frameIndex,
      );
    }
    this.lastRenderSelection = {
      requestedImageIndex,
      resolvedImageIndex,
      segmentIndex,
      imagePath: edgeMap.imagePath,
      themeImagePath: theme.styleProfile.imagePath,
    };
    const baseCompositionPlan = this.getCompositionPlan(edgeMap, theme);
    const compositionRebalance = this.rebalanceCompositionPlan(baseCompositionPlan, edgeMap, audioTransitionScore, heldRatio);
    const compositionPlan = compositionRebalance.plan;
    const imageChanged = this.lastImagePath !== edgeMap.imagePath;
    const heroMotifSlot = resolveHeroMotifScheduleSlot(this.heroMotifSchedule, phraseFrame.timeSec);
    let sceneGraph = this.getEffectiveSceneGraph(edgeMap, theme, compositionPlan, segmentIndex, imageChanged, heroMotifSlot);
    sceneGraph = this.resolveHeroShellSceneForWindow(sceneGraph, baseImageIndex);
    sceneGraph = {
      ...sceneGraph,
      persistentMotifId: this.persistentMotifState?.id,
      persistentMotifInfluenceKey: this.persistentMotifState?.influenceKey,
    };
    this.lastHeroSubEmitterFamily = sceneGraph.heroSubEmitterFamily;
    this.lastHeroSubEmitterVariant = sceneGraph.heroSubEmitterVariant;
    this.lastHeroSubEmitterMotifAlignmentScore = sceneGraph.heroSubEmitterMotifAlignmentScore;
    const previousHeroMotifProfile = this.lastHeroMotifProfile;
    const previousHeroMotifSlotIndex = this.lastHeroMotifSlotIndex;
    const heroMotifChanged = previousHeroMotifProfile !== "" && previousHeroMotifProfile !== sceneGraph.heroMotifProfile.key;
    const slotBoundaryChanged = previousHeroMotifProfile !== "" && previousHeroMotifSlotIndex !== sceneGraph.heroMotifSlotIndex;
    this.lastHeroMotifScheduled = sceneGraph.heroMotifScheduled ?? sceneGraph.heroMotifProfile.key;
    this.lastHeroMotifSlotIndex = sceneGraph.heroMotifSlotIndex ?? 0;
    this.lastHeroMotifSlotStartSec = sceneGraph.heroMotifSlotStartSec ?? phraseFrame.timeSec;
    this.lastHeroMotifSlotEndSec = sceneGraph.heroMotifSlotEndSec ?? phraseFrame.timeSec;
    this.lastHeroMotifScheduleReason = sceneGraph.heroMotifScheduleReason ?? "body-hold";
    this.lastHeroMotifChangedOnSlotBoundary = heroMotifChanged && slotBoundaryChanged;
    this.lastHeroMotifChangedOutsideSlot = heroMotifChanged && !slotBoundaryChanged;
    this.lastHeroMotifScheduleMismatch = sceneGraph.heroMotifScheduled !== undefined && sceneGraph.heroMotifProfile.key !== sceneGraph.heroMotifScheduled;
    this.lastShotGrammarKey = compositionPlan.shotGrammarKey;
    this.lastFocalOccupancyScore = compositionPlan.focalOccupancyScore;
    this.lastCenterBiasScore = compositionPlan.centerBiasScore;
    this.lastFocalQuadrant = quadrantForPoint(edgeMap.focalCenterX, edgeMap.focalCenterY, edgeMap.width, edgeMap.height);
    this.lastHeroQuadrant = quadrantForPoint(compositionPlan.heroCenterX, compositionPlan.heroCenterY, edgeMap.width, edgeMap.height);
    this.lastBrightestBlobQuadrant =
      edgeMap.leftWeight >= edgeMap.rightWeight && edgeMap.leftWeight >= edgeMap.topWeight && edgeMap.leftWeight >= edgeMap.bottomWeight ? "tl" :
      edgeMap.rightWeight >= edgeMap.topWeight && edgeMap.rightWeight >= edgeMap.bottomWeight ? "tr" :
      edgeMap.topWeight >= edgeMap.bottomWeight ? "tl" :
      "br";
    this.lastSupportClusterCount = compositionPlan.supportSlots.length;
    this.lastSupportNearHeroScore = computeSupportNearHeroScore(compositionPlan);
    this.lastEdgeHighlightPenalty = computeEdgeHighlightPenalty(edgeMap, compositionPlan);
    this.lastEdgeDominanceMargin = computeEdgeDominanceMetrics(edgeMap).margin;
    this.lastDeadCenterVoidScore = computeDeadCenterVoidScore(compositionPlan, edgeMap);
    this.lastFocalReinforcementScore = computeFocalReinforcementScore(compositionPlan, edgeMap);
    this.lastRecoveryMode = compositionRebalance.recoveryMode;
    this.lastFallbackRenderMode = compositionRebalance.fallbackRenderMode;
    this.lastFallbackReason = compositionRebalance.fallbackReason;
    this.lastFallbackTriggerCount = compositionRebalance.fallbackTriggerCount;
    this.lastFallbackSeverity = compositionRebalance.fallbackSeverity;
    this.lastCompositionModeReason = compositionRebalance.compositionModeReason;
    this.lastVisibleFallbackRisk =
      compositionRebalance.fallbackRenderMode === "fallback-composed" &&
      this.lastFocalReinforcementScore < 0.38 &&
      this.lastSupportNearHeroScore < 0.30;
    const weakCompositionWindow =
      compositionRebalance.fallbackRenderMode !== "none" ||
      this.lastDeadCenterVoidScore > 0.72 ||
      this.lastSupportNearHeroScore < 0.34 ||
      compositionPlan.focalOccupancyScore < 0.18;
    const effectiveEffectBudget = this.applyWeakWindowBudget(
      adaptiveEffectBudget,
      compositionPlan,
      edgeMap,
      compositionRebalance.fallbackRenderMode,
      weakCompositionWindow,
    );
    this.lastAdaptiveDegradeLevel = effectiveEffectBudget.adaptiveDegradeLevel;
    this.lastHeroRelationshipClass = sceneGraph.heroRelationshipClass ?? "independent";
    this.lastHeroLayoutFamily = sceneGraph.heroLayoutFamily;
    const spawnContext = buildSpawnContext({
      edgeMap,
      theme,
      visualState,
      compositionPlan,
      sceneGraph,
      resolvedImageIndex,
      sceneChanged: imageChanged,
      dominantBand: phraseFrame.dominantBand,
      previousBackgroundId: this.lastBackgroundElementId,
      previousEventId: this.lastEventSpec?.id,
      previousMotifEffectId: this.lastMotifEffectId,
      previousParticleConceptIds: this.lastParticleConceptIds,
      persistentMotifId: this.persistentMotifState?.id,
      fallbackRenderMode: compositionRebalance.fallbackRenderMode,
      supportNearHeroScore: this.lastSupportNearHeroScore,
      focalOccupancyScore: compositionPlan.focalOccupancyScore,
    });
    this.lastSceneKey = spawnContext.sceneKey;
    const backgroundChoice = selectBackgroundConcept(spawnContext);
    const backgroundAdjustment = createBackgroundAdjustment(spawnContext, backgroundChoice.spec);
    const particleChoice = selectParticleConcepts(spawnContext, sceneGraph);
    sceneGraph = {
      ...sceneGraph,
      sceneKey: spawnContext.sceneKey,
      backgroundPlan: buildBackgroundPlanFromSelection({
        context: spawnContext,
        selectionId: backgroundChoice.selection.id,
        spec: backgroundChoice.spec,
        adjustment: backgroundAdjustment,
        edgeMap,
        theme,
        compositionPlan,
        sceneGraph,
      }),
      particleBehaviors: buildParticleBehaviorsFromSelection({
        conceptIds: particleChoice.ids,
        compositionPlan,
        sceneGraph,
      }),
    };
    this.sceneGraphCache.set(edgeMap.imagePath, sceneGraph);
    this.lastParticleConceptIds = particleChoice.ids;
    this.lastParticleSelectionReason = particleChoice.selections.map((selection) => selection.id).join(", ");
    this.lastBackgroundElementId = sceneGraph.backgroundPlan.backgroundElementId;
    this.lastBackgroundSelectionReason = backgroundChoice.selection.reasonCodes.join(", ");
    this.lastBackgroundElementFamily = sceneGraph.backgroundPlan.backgroundElementFamily;
    this.lastBackgroundTriggerMode = sceneGraph.backgroundPlan.triggerMode;
    this.lastBackgroundInteractionMode = sceneGraph.backgroundPlan.interactionMode;
    this.lastBackgroundHeroCouplingStrength = sceneGraph.backgroundPlan.heroCouplingStrength ?? 0;
    this.lastBackgroundParticleCouplingStrength = sceneGraph.backgroundPlan.particleCouplingStrength ?? 0;
    this.lastBackgroundTriggeredThisFrame = false;
    this.lastBackgroundHeroInteractionActive = false;
    this.lastBackgroundPeakColorEligible = sceneGraph.backgroundPlan.colorTuning?.peakColorEligible ?? false;
    this.lastBackgroundPeakColorDrive = 0;
    this.lastBackgroundColorfulnessScale = sceneGraph.backgroundPlan.colorTuning?.baselineColorfulnessScale ?? 1;
    this.lastBackgroundLuminosityLiftAvg = 0;
    this.lastBackgroundMinorImpactDrive = 0;
    const eventReselectionGateReached = !this.lastEventSpec || phraseFrame.frameIndex >= this.lastEventChangeFrameIndex;
    const eventMomentumBucket =
      phraseFrame.isFourBarDownbeat ? "four-bar" :
      phraseFrame.isBarDownbeat ? "bar" :
      phraseFrame.isBeatAccent || phraseFrame.peakStrength > 0.72 || phraseFrame.onsetStrength > 0.68 ? "accent" :
      "carry";
    const eventSpecSelectionKey = `${visualState.phraseIndex}:${spawnContext.sceneKey}:${this.persistentMotifState?.id ?? "none"}:${phraseFrame.beatIndex ?? phraseFrame.frameIndex}:${eventMomentumBucket}`;
    const eventChoice =
      !eventReselectionGateReached && this.lastEventSpec
        ? {
            spec: this.lastEventSpec,
            selection: {
              id: this.lastEventSpec.id,
              reasonCodes: ["cached-selection"],
              continuityReason: "kept the previous event concept until its explicit cooldown expired.",
              rankingSignals: [],
            },
          }
        : selectEventConcept(spawnContext);
    const eventSpec = eventChoice.spec;
    this.lastEventSpecSelectionKey = eventSpecSelectionKey;
    this.lastEventSelectionReason = eventChoice.selection.reasonCodes.join(", ");
    this.lastEventSpec = eventSpec;
    if (eventReselectionGateReached) {
      this.lastEventChangeFrameIndex = phraseFrame.frameIndex + eventSpec.cooldownFrames;
    }
    this.lastEventState = evaluateEventState({
      spec: eventSpec,
      frame: phraseFrame,
      persistentMotif: this.persistentMotifState,
      previous: this.lastEventState,
    });
    const shouldSwap = imageChanged && this.lastImagePath !== "";
    const heroSwapDecision = this.heroSwapDecision(phraseFrame, sceneGraph, audioTransitionScore, bandWeightedTransitionDrive, hzTransitionDrive);
    this.lastHeroSwapEligible = heroSwapDecision.eligible;
    this.lastHeroSwapSuppressedByGrace = heroSwapDecision.suppressedByGrace;
    this.lastHeroSwapAudioDrive = heroSwapDecision.audioDrive;
    const shouldHoldTransition =
      !outroTransitionLocked &&
      !shouldSwap &&
      this.shouldTriggerHeldTransition(phraseFrame, visualState, edgeMap, this.lastActiveSubjectSnapshot, audioTransitionScore, holdPenalty);
    const shouldTriggerTransitionEvent = shouldSwap || shouldHoldTransition;
    const audioCooldownTriggeredTransition = shouldTriggerTransitionEvent && audioCooldownPromotionWindow;
    this.lastTransitionCooldownContext = {
      nominalNextAllowableFrame: nominalNextAllowableTransitionFrame,
      reducedNextAllowableFrame: reducedNextAllowableTransitionFrame,
      cooldownReduction,
      dbReduction,
      hzReduction,
      audioCooldownTriggeredTransition,
      acceleratedByDb: dbReduction > 0 && reducedNextAllowableTransitionFrame < nominalNextAllowableTransitionFrame,
      acceleratedByHz: hzReduction > 0 && reducedNextAllowableTransitionFrame < nominalNextAllowableTransitionFrame,
    };
    if (promoteHeldImageByAudio && shouldSwap) {
      this.lastSwapPromotedByAudio = true;
    }
    if (shouldTriggerTransitionEvent && this.lastImagePath) {
      this.transitionCtx.clearRect(0, 0, this.settings.width, this.settings.height);
      this.transitionCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);
      const previousPlan = this.compositionPlanCache.get(this.lastImagePath);
      const previousSceneGraph = this.sceneGraphCache.get(this.lastImagePath);
      this.transitionFromTheme = this.lastTheme;
      this.transitionBridgeState = previousPlan ? buildTransitionBridgeState(previousPlan, compositionPlan) : undefined;
      let transitionFamily = this.chooseTransition(visualState, edgeMap, theme, this.lastSafetyMetrics, this.lastActiveSubjectSnapshot, this.persistentMotifState, this.lastEventState);
      if (shouldHoldTransition && (transitionFamily === "wipe" || transitionFamily === "melt-safe")) {
        transitionFamily =
          phraseFrame.isPeak ? "flash" :
          phraseFrame.normalizedHighMid > 0.58 ? "fragment" :
          audioTransitionScore > 1.45 ? "crash-zoom" :
          visualState.regime === "groove" ? "echo-fold" :
          "halo-drift";
      }
      if (previousSceneGraph) {
        const promoteHeroMutationByAudio =
          audioCooldownTriggeredTransition &&
          !heroSwapDecision.eligible &&
          (stableHash(`audio-cooldown-hero:${phraseFrame.frameIndex}:${sceneGraph.transitionIdentitySignature}:${this.lastTransitionIdentitySignature}`) % 2 === 0);
        sceneGraph = heroSwapDecision.eligible || promoteHeroMutationByAudio
          ? mutateSceneGraphForTransition(
              previousSceneGraph,
              sceneGraph,
              edgeMap,
              theme,
              shouldSwap ? "swap" : "hold",
              this.lastTransitionIdentitySignature,
            )
          : this.preserveHeroType(previousSceneGraph, sceneGraph);
        sceneGraph = this.resolveHeroShellSceneForWindow(sceneGraph, baseImageIndex);
      }
      const transitionBudget = this.applyTransitionBudget(
        transitionFamily,
        this.transitionDurationFrames(
          visualState,
          edgeMap,
          this.lastActiveSubjectSnapshot,
          dbTransitionDrive,
          hzTransitionDrive,
        ),
        visualState,
        edgeMap,
        this.lastActiveSubjectSnapshot,
        audioTransitionScore,
      );
      transitionFamily = transitionBudget.family;
      this.lastTransitionBudgetTier = transitionBudget.tier;
      this.lastTransitionBudgetReason = transitionBudget.reason;
      this.lastTransitionBaseDurationFrames = transitionBudget.proposedDurationFrames;
      this.lastTransitionCappedDurationFrames = transitionBudget.durationFrames;
      this.lastTransitionCapLossFrames = Math.max(0, transitionBudget.proposedDurationFrames - transitionBudget.durationFrames);
      this.lastTransitionRiskScore = transitionBudget.risk;
      this.lastTransitionCapCategory = transitionBudget.tier;
      const durationFrames = transitionBudget.durationFrames;
      if (previousSceneGraph && this.transitionBridgeState && shouldSwap) {
        this.setTransitionGraph(buildTransitionGraph(previousSceneGraph, sceneGraph, this.transitionBridgeState, transitionFamily));
      }
      const transitionGraph = shouldSwap ? this.getTransitionGraph(this.lastImagePath, edgeMap.imagePath) : undefined;
      const carryProfile = resolveTransitionCarryProfile({
        family: transitionFamily,
        grammar: transitionGraph?.motionGrammar ?? transitionMotionGrammar(transitionFamily),
        outgoingParticleVisibleCount: this.lastParticleVisibleCount,
        outgoingHeroParticleRenderedCount: this.lastHeroParticleRenderedCount,
        supportFromCount: this.transitionBridgeState?.supportFrom.length ?? 0,
        supportToCount: this.transitionBridgeState?.supportTo.length ?? 0,
        hasTransitionGraph: Boolean(transitionGraph),
      });
      this.transitionState = {
        fromImagePath: this.lastImagePath,
        toImagePath: shouldSwap ? edgeMap.imagePath : this.lastImagePath,
        mode: this.transitionModeForFamily(transitionFamily, edgeMap, theme),
        family: transitionFamily,
        triggerMode: shouldSwap ? "swap" : "hold",
        startFrameIndex: phraseFrame.frameIndex,
        durationFrames,
        carryStrength: clamp((this.transitionBridgeState?.carryStrength ?? visualState.transitionCarryBias) * (transitionGraph?.carryAttenuation ?? 0.78), 0.22, 0.68),
        useMorph: shouldSwap && carryProfile.allowMorph && this.shouldUseMorphTransition(this.transitionBridgeState, edgeMap, theme),
        carryProfile,
      };
      this.lastTransitionDurationFrames = durationFrames;
      this.lastTransitionCarryStrength = this.transitionState.carryStrength;
      this.lastTransitionCarryMode = carryProfile.mode;
      this.lastTransitionCarryAvailabilityScore = carryProfile.availabilityScore;
      this.lastTransitionCarryFallbackReason = carryProfile.reason;
      this.lastTransitionMotionGrammar = transitionGraph?.motionGrammar ?? transitionMotionGrammar(transitionFamily);
      this.lastTransitionTriggerMode = this.transitionState.triggerMode;
      this.lastTransitionIdentityChanged = this.lastTransitionIdentitySignature !== sceneGraph.transitionIdentitySignature;
      this.lastMotifChangedOnTransition = previousSceneGraph ? previousSceneGraph.heroMotifProfile.key !== sceneGraph.heroMotifProfile.key : false;
      this.lastHeroChangedOnTransition = previousSceneGraph
        ? previousSceneGraph.heroPrimitive !== sceneGraph.heroPrimitive ||
          previousSceneGraph.heroInstanceSeed.emitterTopology !== sceneGraph.heroInstanceSeed.emitterTopology ||
          previousSceneGraph.heroClusterConfig.relationshipMode !== sceneGraph.heroClusterConfig.relationshipMode
        : false;
      this.lastTransitionIdentitySignature = sceneGraph.transitionIdentitySignature;
      this.lastTransitionEventFrameIndex = phraseFrame.frameIndex;
      const transitionCooldownFrames = Math.round((
        Math.round(this.settings.fps * 0.567) +
        (!shouldSwap ? Math.round(this.settings.fps * 0.126 * this.heldTransitionStreak) : 0)
      ) * 1.32);
      this.nextAllowableTransitionFrame = phraseFrame.frameIndex + transitionCooldownFrames;
      if (audioCooldownTriggeredTransition) {
        const nextNodeTriggerCount = existingNodeTriggerCount + 1;
        this.audioTriggeredTransitionCountByWindowIndex.set(baseImageIndex, nextNodeTriggerCount);
        this.lastAudioSwapNodeTriggerCount = nextNodeTriggerCount;
      }
      if (shouldSwap) {
        this.swapTransitionCount += 1;
        this.heldTransitionStreak = 0;
        this.lastSwapFrameIndex = phraseFrame.frameIndex;
      } else {
        this.heldTransitionCount += 1;
        this.heldTransitionStreak += 1;
      }
    }
    const atmosphereGraph = this.getAtmosphereGraph(edgeMap, theme, compositionPlan, sceneGraph);
    this.lastCompositionMode = compositionPlan.stylePlacementMode;
    this.lastAtmosphereDensity = atmosphereGraph.atmosphereDensity;
    this.lastMidScaleCoverage = atmosphereGraph.midScaleCoverage;
    this.lastSymmetryUsage = atmosphereGraph.symmetryZones.length;
    this.lastImagePath = edgeMap.imagePath;
    this.lastImageIndex = resolvedImageIndex;
    this.lastTheme = theme;
    const particleState = this.getParticleState(edgeMap.imagePath);
    const motifEffectSelectionKey = `${spawnContext.sceneKey}:${visualState.regime}:${sceneGraph.continuitySeed}:${edgeMap.imagePath}:${visualState.phraseIndex}`;
    const motifEffectChoice =
      this.lastMotifEffectSelectionKey === motifEffectSelectionKey && this.lastMotifEffectSpec
        ? {
            spec: this.lastMotifEffectSpec,
            selection: {
              id: this.lastMotifEffectSpec.id,
              reasonCodes: ["cached-selection"],
              continuityReason: "kept the previous motif effect until the explicit scene-level selector key changed.",
              rankingSignals: [],
            },
          }
        : selectMotifEffectConcept(spawnContext);
    const motifEffectSpec = motifEffectChoice.spec;
    this.lastMotifEffectSelectionKey = motifEffectSelectionKey;
    this.lastMotifEffectSpec = motifEffectSpec;
    this.lastMotifEffectSelectionReason = motifEffectChoice.selection.reasonCodes.join(", ");
    this.lastSelectedMotifEffectByMotif.set(edgeMap.fractalMotif, motifEffectSpec.id);
    const motifEffectState = evaluateMotifEffectState(phraseFrame, this.bpm, motifEffectSpec, this.rollingDbWindow);
    const effectBeatIndex = phraseFrame.beatIndex ?? phraseFrame.frameIndex;
    if (motifEffectState.heroWarpActive && effectBeatIndex - this.lastHeroWarpBeatIndex < motifEffectSpec.cooldownBeats) {
      motifEffectState.heroWarpActive = false;
    }
    this.lastMotifEffectState = motifEffectState;
    this.lastMotifEffectId = motifEffectSpec.id;
    this.lastMotifEffectPhenomenon = motifEffectSpec.phenomenon;
    this.lastMotifEffectAudioMode = motifEffectSpec.audioMode;
    this.lastMotifEffectIntensity = motifEffectState.intensity;
    this.lastHeroWarpActive = motifEffectState.heroWarpActive;
    const outroEffectSelectionKey = `${edgeMap.fractalMotif}:${visualState.regime}:${visualState.phraseIndex}:${edgeMap.imagePath}:${phraseFrame.barIndex ?? 0}`;
    const outroEffectSpec =
      this.lastOutroEffectSelectionKey === outroEffectSelectionKey && this.lastOutroEffectSpec
        ? this.lastOutroEffectSpec
        : selectOutroEffect({
            edgeMap,
            visualState,
            theme,
            frame: phraseFrame,
            recentEffectBars: this.recentOutroEffectBars,
            previousCategory: this.lastOutroEffectCategoryByPhrase.get(Math.max(0, visualState.phraseIndex - 1)),
          });
    this.lastOutroEffectSelectionKey = outroEffectSelectionKey;
    this.lastOutroEffectSpec = outroEffectSpec;
    const outroEffectState =
      outroEffectSpec
        ? evaluateOutroEffectState({
            frame: phraseFrame,
            bpm: this.bpm,
            spec: outroEffectSpec,
            edgeMap,
            theme,
            visualState,
          })
        : undefined;
    this.lastOutroEffectState = outroEffectState;
    this.lastOutroEffectId = outroEffectSpec?.id;
    this.lastOutroEffectCategory = outroEffectSpec?.category;
    this.lastOutroEffectAudioMode = outroEffectSpec?.audioMode;
    this.lastOutroEffectIntensity = outroEffectState?.intensity ?? 0;
    this.lastOutroEffectImageSignature = outroEffectState?.imageSignature;
    this.lastOutroCoverageEstimate = outroEffectState?.frameCoverageTarget ?? 0;
    this.lastOutroHeroWarp = outroEffectState?.heroWarp ?? 0;
    this.lastOutroTerminalBurstProgress = outroEffectState?.terminalBurstProgress ?? 0;
    const framePostEffectSelectionKey = `${edgeMap.fractalMotif}:${visualState.regime}:${visualState.overlayMode}:${visualState.phraseIndex}:${edgeMap.imagePath}`;
    const framePostEffectSpec =
      this.lastFramePostEffectSelectionKey === framePostEffectSelectionKey && this.lastFramePostEffectSpec
        ? this.lastFramePostEffectSpec
        : selectFramePostEffect({
            edgeMap,
            visualState,
            theme,
            persistentMotif: this.persistentMotifState,
            previousEffectId: this.lastFramePostEffectId,
          });
    this.lastFramePostEffectSelectionKey = framePostEffectSelectionKey;
    this.lastFramePostEffectSpec = framePostEffectSpec;
    const framePostEffectState =
      framePostEffectSpec
        ? evaluateFramePostEffectState({
            frame: phraseFrame,
            spec: framePostEffectSpec,
          })
        : undefined;
    this.lastFramePostEffectState = framePostEffectState;
    this.lastFramePostEffectId = framePostEffectSpec?.id;
    this.lastFramePostEffectIntensity = framePostEffectState?.intensity ?? 0;
    this.lastVisualState = {
      ...visualState,
      outroEffectId: outroEffectSpec?.id,
      outroEffectCategory: outroEffectSpec?.category,
      outroEffectIntensity: outroEffectState?.intensity,
      outroEffectImageSignature: outroEffectState?.imageSignature,
      outroTerminalBurstProgress: outroEffectState?.terminalBurstProgress,
    };
    if (outroEffectSpec && phraseFrame.barIndex !== undefined) {
      this.recentOutroEffectBars.set(outroEffectSpec.id, phraseFrame.barIndex);
      this.lastOutroEffectCategoryByPhrase.set(visualState.phraseIndex, outroEffectSpec.category);
    }
    const activeSubjectState = this.getActiveSubjectState(edgeMap.imagePath, edgeMap);
    if (motifEffectState.heroWarpActive) {
      applyRareHeroWarp(motifEffectState, motifEffectSpec, sceneGraph, activeSubjectState);
      this.lastHeroWarpBeatIndex = effectBeatIndex;
    }
    if (outroEffectSpec && outroEffectState) {
      applyOutroEffectToActiveSubject(outroEffectState, outroEffectSpec, sceneGraph, activeSubjectState);
    }
    const activeSubject = updateActiveSubject({
      state: activeSubjectState,
      frame: phraseFrame,
      edgeMap,
      sceneGraph,
      visualState,
      imageProgress,
      safetyMetrics: this.lastSafetyMetrics,
      rollingDbWindow: this.rollingDbWindow,
      trackAverageDbOverall: this.trackAverageDbOverall,
    });
    this.lastActiveSubjectSnapshot = activeSubject;
    this.lastMotionTier = activeSubject.motionTier ?? "glide";
    this.lastJumpTriggered = activeSubject.jumpTriggered ?? false;
    this.lastJitterSuppressed = activeSubject.jitterSuppressed ?? false;
    this.lastMotionTierReadable = motionTierReadableForFrame(activeSubject);
    this.lastFlourishStrength = activeSubject.flourishStrength ?? 0;
    this.lastMainHeroLowDbThrottle = (activeSubject.emissionScale ?? 1) < 0.999;
    this.lastMainHeroFreezeActive = !!activeSubject.lowDbFreezeActive;
    const effectiveVisualState: VisualState =
      !this.lastSafetyMetrics.recoveryActive &&
      visualState.overlayMode === "stable-feedback" &&
      !weakCompositionWindow &&
      (activeSubject.mode === "strike" || activeSubject.mode === "orbit" || activeSubject.motionPx > 8.5)
        ? {
            ...visualState,
            overlayMode: (
              activeSubject.mode === "strike"
                ? "climax-burst"
                : edgeMap.maskConfidence === "high" &&
                    compositionPlan.focalOccupancyScore >= 0.20 &&
                    this.lastSupportNearHeroScore >= 0.34 &&
                    activeSubject.motionPx <= 10
                  ? "pulse-wave"
                  : activeSubject.motionPx > 10
                  ? "kinetic-scan"
                  : "kinetic-scan"
            ) as OverlayMode,
          }
        : visualState;

    let stageStartedAt = performance.now();
    this.prepareFeedbackState(phraseFrame, imageChanged);

    const effectState = prepareFrameEffect({
      ctx: this.ctx as unknown as CanvasRenderingContext2D,
      feedbackCtx: this.feedbackCtx as unknown as CanvasRenderingContext2D,
      scratchCtx: this.scratchCtx as unknown as CanvasRenderingContext2D,
      feedbackSource: this.feedbackCanvas as any,
      width: this.settings.width,
      height: this.settings.height,
      frame: phraseFrame,
      theme,
      compositionPlan,
      visualState: effectiveVisualState,
      reset: isInitialFrame,
      lowConfidenceMask: edgeMap.maskConfidence === "low",
      legibilityRecoveryWindow: weakCompositionWindow,
      qualityBudget: effectiveEffectBudget,
    });
    this.lastOverlayOpacityAvg = effectState.overlayOpacityEstimate;
    this.lastOverlayCompositeMode = effectState.overlayCompositeMode;
    this.lastEffectVisible = effectState.effectVisible;
    this.lastEffectVisiblePixelRatio = effectState.effectVisiblePixelRatioEstimate;
    this.lastStageMetrics.effectsMs += performance.now() - stageStartedAt;

    stageStartedAt = performance.now();
    this.drawBackground(phraseFrame, theme, edgeMap, compositionPlan, sceneGraph, effectState.backgroundOpacity);
    this.lastStageMetrics.backgroundMs += performance.now() - stageStartedAt;

    stageStartedAt = performance.now();
    let nebula;
    this.ctx.save();
    this.ctx.globalCompositeOperation = effectState.renderCompositeOperation;
    this.ctx.filter = effectState.renderFilter;
    // `disableNebula` now disables only atmosphere-scale haze/veil work; particle motion and hero emissions remain active.
    nebula = renderNebula(this.ctx as unknown as CanvasRenderingContext2D, {
      edgeMap,
      frame: phraseFrame,
      theme,
      compositionPlan,
      sceneGraph,
      atmosphereGraph,
      visualState: effectiveVisualState,
      width: this.settings.width,
      height: this.settings.height,
      fps: this.settings.fps,
      particleState,
      imageProgress,
      activeSubject,
      qualityBudget: effectState.qualityBudget,
      diagnosticOverrides: this.diagnosticOverrides,
      stampAtlas: this.stampAtlas,
      disableAtmosphere: this.disableNebula || sceneGraph.backgroundPlan.fallbackNebulaEnabled === false,
    });
    this.ctx.restore();
    const nebulaElapsedMs = performance.now() - stageStartedAt;
    const measuredParticlesMs = nebula.stageMetrics?.particlesMs ?? 0;
    const measuredOccupancyMs = nebula.stageMetrics?.occupancyMs ?? 0;
    const untrackedNebulaMs = this.disableNebula ? 0 : Math.max(0, nebulaElapsedMs - measuredParticlesMs - measuredOccupancyMs);
    this.lastStageMetrics.particlesMs += measuredParticlesMs + untrackedNebulaMs;
    this.lastStageMetrics.occupancyMs += measuredOccupancyMs;
    this.lastStageMetrics.atmosphereMs += nebula.stageMetrics?.atmosphereMs ?? 0;
    this.lastStageMetrics.stampDrawCount += nebula.stageMetrics?.stampDrawCount ?? 0;
    this.lastStageMetrics.supportStampDrawCount += nebula.stageMetrics?.supportStampDrawCount ?? 0;
    this.lastStageMetrics.backgroundStampDrawCount += nebula.stageMetrics?.backgroundStampDrawCount ?? 0;
    this.lastStageMetrics.vectorDrawCount += nebula.stageMetrics?.vectorDrawCount ?? 0;
    this.lastStageMetrics.occupancyDrawCount += nebula.stageMetrics?.occupancyDrawCount ?? 0;
    this.lastStageMetrics.heroGlyphDrawCount += nebula.stageMetrics?.heroGlyphDrawCount ?? 0;
    this.lastStageMetrics.veilDrawCount += nebula.stageMetrics?.veilDrawCount ?? 0;
    this.lastStageMetrics.bridgeDrawCount += nebula.stageMetrics?.bridgeDrawCount ?? 0;
    this.lastStageMetrics.localGlowDrawCount += nebula.stageMetrics?.localGlowDrawCount ?? 0;
    this.lastStageMetrics.gradientCreateCount += nebula.stageMetrics?.gradientCreateCount ?? 0;
    this.lastStageMetrics.heroMs += nebula.stageMetrics?.heroMs ?? 0;
    this.lastStageMetrics.avgSupportMotionPx = nebula.stageMetrics?.avgSupportMotionPx ?? 0;
    this.lastStageMetrics.avgBackgroundMotionPx = nebula.stageMetrics?.avgBackgroundMotionPx ?? 0;
    this.lastEventDensity = Math.max(nebula.eventDensity, (this.lastEventState?.intensity ?? 0) * 0.72);
    this.lastEmitterUsage = nebula.emitterUsage * (1 + ((this.lastEventState?.emitterBias ?? 0) * 0.18));
    this.lastAbsorberUsage = nebula.absorberUsage * (1 + ((this.lastEventState?.absorberBias ?? 0) * 0.18));
    this.lastExplosionCount = Math.round(nebula.explosionCount * (1 + ((this.lastEventState?.explosionBias ?? 0) * 0.14)));
    this.lastSourceAffinityAvg = nebula.sourceAffinityAvg;
    this.lastSourceAffinityHeroAvg = nebula.sourceAffinityHeroAvg;
    this.lastSourceAffinitySupportAvg = nebula.sourceAffinitySupportAvg;
    this.lastParticleConvergenceScore = nebula.particleConvergenceScore;
    this.lastSubEmitterChildren = nebula.subEmitterChildren;
    this.lastHeroCoverage = nebula.heroCoverage;
    this.lastBackgroundClutterRatio = nebula.backgroundClutterRatio;
    this.lastSupportCoverage = nebula.supportCoverage;
    this.lastSupportElementDensity = nebula.supportElementDensity;
    this.lastBackgroundElementDensity = nebula.backgroundElementDensity;
    this.lastHeroIsolationScore = nebula.heroIsolationScore;
    this.lastNearHeroEventDensity = nebula.nearHeroEventDensity;
    this.lastHeroToSupportDistanceScore = nebula.heroToSupportDistanceScore;
    this.lastNegativeSpaceOccupancy = nebula.negativeSpaceOccupancy;
    this.lastParticleSpawnRequests = nebula.particleLifecycle.particleSpawnRequests;
    this.lastParticleRenderedCount = nebula.particleLifecycle.particleRenderedCount;
    this.lastParticleCulledByLayerCap = nebula.particleLifecycle.particleCulledByLayerCap;
    this.lastParticleCulledByHeroProtection = nebula.particleLifecycle.particleCulledByHeroProtection;
    this.lastParticleCulledByNegativeSpace = nebula.particleLifecycle.particleCulledByNegativeSpace;
    this.lastParticleCulledByImageProgress = nebula.particleLifecycle.particleCulledByImageProgress;
    this.lastParticleCulledBySkipNonHero = nebula.particleLifecycle.particleCulledBySkipNonHero;
    this.lastParticleOffscreenCount = nebula.particleLifecycle.particleOffscreenCount;
    this.lastParticleTooSmallToReadCount = nebula.particleLifecycle.particleTooSmallToReadCount;
    this.lastParticleLowAlphaCount = nebula.particleLifecycle.particleLowAlphaCount;
    this.lastParticleLowContrastCount = nebula.particleLifecycle.particleLowContrastCount;
    this.lastParticleVisibleCount = nebula.particleLifecycle.particleVisibleCount;
    this.lastParticleVisibleRatio =
      nebula.particleLifecycle.particleVisibleCount / Math.max(1, nebula.particleLifecycle.particleRenderedCount);
    this.lastParticleTelemetryAvailable = true;
    this.lastHeroParticleRenderedCount = nebula.particleLifecycle.heroParticleRenderedCount;
    this.lastSupportParticleRenderedCount = nebula.particleLifecycle.supportParticleRenderedCount;
    this.lastBackgroundParticleRenderedCount = nebula.particleLifecycle.backgroundParticleRenderedCount;
    this.lastSubEmitterTriggerCount = nebula.particleLifecycle.subEmitterTriggerCount;
    this.lastSubEmitterChildSpawnedCount = nebula.particleLifecycle.subEmitterChildSpawnedCount;
    this.lastEdgeDeathEligibleCount = nebula.particleLifecycle.edgeDeathEligibleCount;
    this.lastEdgeDeathTriggeredCount = nebula.particleLifecycle.edgeDeathTriggeredCount;
    this.lastEdgeDeathPlayedCount = nebula.particleLifecycle.edgeDeathPlayedCount;
    this.lastEdgeDeathSkippedByCostCount = nebula.particleLifecycle.edgeDeathSkippedByCostCount;
    this.lastEdgeDeathEffectId = nebula.particleLifecycle.edgeDeathEffectId;
    this.lastEdgeDeathCostTier = nebula.particleLifecycle.edgeDeathCostTier;
    this.lastEdgeExitFramesAvg = nebula.particleLifecycle.edgeExitFramesAvg;
    this.lastEdgeExitDistanceAvg = nebula.particleLifecycle.edgeExitDistanceAvg;
    this.lastShapePlacementScore = nebula.shapePlacementScore;

    stageStartedAt = performance.now();
    renderMotifEffect({
      ctx: this.ctx as unknown as CanvasRenderingContext2D,
      frame: phraseFrame,
      state: motifEffectState,
      spec: motifEffectSpec,
      sceneGraph,
      activeSubject,
      theme,
      width: this.settings.width,
      height: this.settings.height,
      qualityBudget: effectState.qualityBudget,
    });
    if (outroEffectSpec && outroEffectState) {
      const outroRenderState = renderOutroEffect({
        ctx: this.ctx as unknown as CanvasRenderingContext2D,
        frame: phraseFrame,
        state: outroEffectState,
        spec: outroEffectSpec,
        sceneGraph,
        activeSubject,
        theme,
        width: this.settings.width,
        height: this.settings.height,
        qualityBudget: effectState.qualityBudget,
      });
      this.lastOverlayOpacityAvg = Math.max(this.lastOverlayOpacityAvg, outroRenderState.overlayOpacityEstimate);
      this.lastEffectVisible = this.lastEffectVisible || outroRenderState.effectVisible;
      this.lastEffectVisiblePixelRatio = Math.max(this.lastEffectVisiblePixelRatio, outroRenderState.effectVisiblePixelRatioEstimate);
    }
    this.lastStageMetrics.effectsMs += performance.now() - stageStartedAt;

    const bandEnergy = buildBandEnergyProfile(phraseFrame);
    const motifEffectModifiers = applyMotifEffectToHeroParticles(motifEffectState, motifEffectSpec);
    const darkLowEventWindow =
      (this.lastSafetyMetrics.trailingLuminance < 0.1 || this.lastSafetyMetrics.luminance < 0.06) &&
      this.lastEventDensity < 0.12;
    this.drawDreamWarp(phraseFrame, theme, activeSubjectState, effectiveVisualState, edgeMap, effectState.qualityBudget);
    this.applyShotEnvelope(phraseFrame, visualState, edgeMap, effectState.qualityBudget);
    this.drawActiveSubjectTrails(theme, activeSubjectState, this.lastSafetyMetrics);
    this.drawActiveSubjectAura(phraseFrame, theme, activeSubjectState, sceneGraph, compositionPlan, edgeMap, this.lastSafetyMetrics);
    this.drawActiveSubjectAccents(phraseFrame, theme, activeSubjectState, this.lastSafetyMetrics);
    this.drawGlow(nebula.anchors, phraseFrame, theme);
    const heroDirectiveBase = this.buildHeroClusterDirectives(phraseFrame, theme, activeSubjectState, sceneGraph, compositionPlan, edgeMap);
    const heroScalePulse =
      phraseFrame.isFourBarDownbeat ? 1.14 + phraseFrame.dbNormalized * 0.08 :
      phraseFrame.isBeatAccent ? 1.06 + phraseFrame.dbNormalized * 0.06 :
      1 + (motifEffectState.heroWarpActive ? motifEffectState.intensity * (motifEffectSpec.selectionTags?.includes("hero-impacting") ? 0.12 : 0.06) : 0);
    const heroDirectives = heroDirectiveBase.map((directive, index) => ({
      ...directive,
      size: directive.size * clamp(heroScalePulse, 1, 1.24),
      alpha: index === 0 ? directive.alpha : directive.alpha * sceneGraph.heroClusterConfig.satelliteAlphaScale,
    }));
    this.lastHeroQuadrant = heroDirectives[0]?.quadrant ?? this.lastHeroQuadrant;
    this.lastHeroScalePulseAvg = this.lastHeroScalePulseAvg * 0.82 + clamp(heroScalePulse, 1, 1.24) * 0.18;
    this.lastHeroScalePulsePeak = Math.max(this.lastHeroScalePulsePeak * 0.98, heroScalePulse);
    const heroBandPulse = bandEnergy.low * 0.22 + bandEnergy.mid * 0.46 + bandEnergy.high * 0.32;
    const heroAlphaBoost = clamp(
      0.82 +
      heroBandPulse * 0.4 +
      this.lastSupportCoverage * 0.22 +
      (sceneGraph.heroVisibilityBias - 1) * 0.28,
      0.78,
      1.32,
    ) * motifEffectModifiers.shellGlowMultiplier * (darkLowEventWindow ? 1.08 : 1);
    const heroChildFieldStates = this.getHeroChildFieldStates(edgeMap.imagePath, heroDirectives.length);
    this.lastHeroCoreSize = heroDirectives[0]?.size ?? 0;
    const heroParticleSizeValues: number[] = [];
    const heroParticleTtlValues: number[] = [];
    let heroEmissionRateSum = 0;
    let heroTrailOccupancySum = 0;
    let heroBurstChildrenSum = 0;
    let heroBurstCountSum = 0;
    let heroWakeLengthSum = 0;
    let heroScreenEdgeAimBiasSum = 0;
    let heroStreamCenterBiasDegreesSum = 0;
    let heroBurstGateActiveSum = 0;
    let heroBurstCadenceSlotHitSum = 0;
    let heroBurstTopQuartileSum = 0;
    this.centerwardEmissionAlignmentSum = 0;
    this.centerwardEmissionSampleCount = 0;
    this.edgePressureActiveSampleCount = 0;
    this.edgePressureSampleCount = 0;
    this.lastCenterwardEmissionRatio = 0;
    this.lastEdgePressureActiveFrameRatio = 0;
    const heroShellFrameState = this.resolveHeroShellFrameState(phraseFrame, sceneGraph, baseImageIndex);
    for (let index = heroDirectives.length - 1; index >= 0; index -= 1) {
      const directive = heroDirectives[index]!;
      const heroChildFieldState = heroChildFieldStates[index]!;
      this.updateHeroChildField(heroChildFieldState, phraseFrame, directive, sceneGraph, bandEnergy, motifEffectModifiers, heroDirectives, index, heroDirectives.length);
      heroEmissionRateSum += this.lastHeroChildEmissionRate;
      heroTrailOccupancySum += this.lastHeroTrailOccupancy;
      heroBurstChildrenSum += this.lastHeroBurstChildren;
      heroBurstCountSum += this.lastHeroBurstCount;
      heroWakeLengthSum += this.lastHeroWakeLengthPx;
      heroScreenEdgeAimBiasSum += this.lastScreenEdgeAimBias;
      heroStreamCenterBiasDegreesSum += this.lastStreamCenterBiasDegrees;
      heroBurstGateActiveSum += this.lastHeroBurstGateActiveRatio;
      heroBurstCadenceSlotHitSum += this.lastHeroBurstCadenceSlotHits;
      heroBurstTopQuartileSum += this.lastHeroBurstTopQuartileRatio;
      heroParticleSizeValues.push(this.lastHeroParticleSizeAvg);
      heroParticleTtlValues.push(this.lastHeroParticleTtlAvg);
    }
    for (let index = heroDirectives.length - 1; index >= 0; index -= 1) {
      this.drawHeroShellStackLate(phraseFrame, theme, heroDirectives[index]!, activeSubjectState, sceneGraph, bandEnergy, heroAlphaBoost, heroShellFrameState);
    }
    for (let index = heroDirectives.length - 1; index >= 0; index -= 1) {
      this.drawHeroPrimitiveCore(phraseFrame, theme, heroDirectives[index]!, activeSubjectState, sceneGraph, heroAlphaBoost);
    }
    for (let index = heroDirectives.length - 1; index >= 0; index -= 1) {
      const directive = heroDirectives[index]!;
      const heroChildFieldState = heroChildFieldStates[index]!;
      this.drawHeroChildField(phraseFrame, theme, heroChildFieldState, directive);
    }
    this.lastHeroChildEmissionRate = heroEmissionRateSum;
    this.lastHeroTrailOccupancy = heroTrailOccupancySum;
    this.lastHeroBurstChildren = heroBurstChildrenSum;
    this.lastHeroBurstCount = heroBurstCountSum;
    this.lastHeroWakeLengthPx = heroWakeLengthSum;
    this.lastScreenEdgeAimBias = heroScreenEdgeAimBiasSum / Math.max(1, heroDirectives.length);
    this.lastStreamCenterBiasDegrees = heroStreamCenterBiasDegreesSum / Math.max(1, heroDirectives.length);
    this.lastHeroBurstGateActiveRatio = heroBurstGateActiveSum / Math.max(1, heroDirectives.length);
    this.lastHeroBurstCadenceSlotHits = heroBurstCadenceSlotHitSum;
    this.lastHeroBurstTopQuartileRatio = heroBurstTopQuartileSum / Math.max(1, heroDirectives.length);
    this.lastHeroParticleSizeAvg = heroParticleSizeValues.reduce((sum, value) => sum + value, 0) / Math.max(1, heroParticleSizeValues.length);
    this.lastHeroParticleTtlAvg = heroParticleTtlValues.reduce((sum, value) => sum + value, 0) / Math.max(1, heroParticleTtlValues.length);
    this.lastCenterwardEmissionRatio = this.centerwardEmissionAlignmentSum / Math.max(1, this.centerwardEmissionSampleCount);
    this.lastEdgePressureActiveFrameRatio = this.edgePressureActiveSampleCount / Math.max(1, this.edgePressureSampleCount);
    if (phraseFrame.isPeak) {
      this.drawPeakBloom(phraseFrame, theme);
    }

    const predictedRecoveryActive =
      this.lastSafetyMetrics.recoveryActive ||
      this.lastSafetyMetrics.trailingLuminance < effectiveVisualState.brightnessFloor - 0.008 ||
      this.lastNegativeSpaceOccupancy > 0.22 ||
      weakCompositionWindow;
    const fallbackOverlayMode =
      darkLowEventWindow
        ? (weakCompositionWindow || edgeMap.maskConfidence !== "high"
            ? "stable-feedback"
            : "kinetic-scan")
        : weakCompositionWindow
          ? (phraseFrame.normalizedHigh > 0.38 ? "kinetic-scan" : "stable-feedback")
        : effectState.overlayModeUsed;
    const safetyMetrics: VisualSafetyMetrics = {
      ...this.lastSafetyMetrics,
      brightnessFloor: effectiveVisualState.brightnessFloor,
      overlayModeUsed: fallbackOverlayMode,
      transitionFamilyUsed: this.transitionState?.family ?? effectiveVisualState.transitionFamily,
      recoveryActive: predictedRecoveryActive,
    };
    if (darkLowEventWindow) {
      this.lastOverlayOpacityAvg = clamp(this.lastOverlayOpacityAvg * 1.1, 0, 1);
      this.lastEffectVisiblePixelRatio = clamp(this.lastEffectVisiblePixelRatio * 1.08, 0, 1);
    }
    const supportLiftCandidate =
      this.lastLowResFrameStats.darkestQuartileLuminance < 0.16 &&
      this.lastLowResFrameStats.luminanceSample < 0.48;
    if (safetyMetrics.recoveryActive || edgeMap.maskConfidence === "low" || supportLiftCandidate) {
      this.applySafetyGovernor(phraseFrame, theme, edgeMap, nebula.anchors, visualState, safetyMetrics);
    }

    this.lastPreEffectLuminanceSample = this.shouldCapturePreEffectLuminanceSample()
      ? this.sampleLowResFrameStats().luminanceSample
      : undefined;

    stageStartedAt = performance.now();
    const finalizedEffectState = finalizeFrameEffect({
      ctx: this.ctx as unknown as CanvasRenderingContext2D,
      feedbackSource: this.canvas as any,
      scratchCtx: this.scratchCtx as unknown as CanvasRenderingContext2D,
      width: this.settings.width,
      height: this.settings.height,
      frame: phraseFrame,
      theme,
      compositionPlan,
      visualState: effectiveVisualState,
      safetyMetrics,
      activeSubject: this.lastActiveSubjectSnapshot,
      qualityBudget: effectState.qualityBudget,
    });
    this.lastOverlayOpacityAvg = Math.max(this.lastOverlayOpacityAvg, finalizedEffectState.overlayOpacityEstimate);
    this.lastOverlayCompositeMode = finalizedEffectState.overlayCompositeMode;
    this.lastEffectVisible = this.lastEffectVisible || finalizedEffectState.effectVisible;
    this.lastEffectVisiblePixelRatio = Math.max(this.lastEffectVisiblePixelRatio, finalizedEffectState.effectVisiblePixelRatioEstimate);
    this.lastEffectMotionDelta = clamp(
      (this.lastStageMetrics.avgSupportMotionPx + this.lastStageMetrics.avgBackgroundMotionPx + this.lastActiveSubjectSnapshot.motionPx) / 18,
      0,
      1,
    );
    this.lastStageMetrics.effectsMs += performance.now() - stageStartedAt;

    stageStartedAt = performance.now();
    if (this.lastFramePostEffectSpec && this.lastFramePostEffectState) {
      const framePostRenderState = renderFramePostEffect({
        ctx: this.ctx as unknown as CanvasRenderingContext2D,
        scratchCtx: this.scratchCtx as unknown as CanvasRenderingContext2D,
        sourceCanvas: this.canvas as any,
        width: this.settings.width,
        height: this.settings.height,
        frame: phraseFrame,
        spec: this.lastFramePostEffectSpec,
        state: this.lastFramePostEffectState,
        activeSubject: this.lastActiveSubjectSnapshot,
        sceneGraph,
        theme,
        qualityBudget: effectState.qualityBudget,
      });
      this.lastOverlayOpacityAvg = Math.max(this.lastOverlayOpacityAvg, framePostRenderState.overlayOpacityEstimate);
      this.lastEffectVisible = this.lastEffectVisible || framePostRenderState.intensity > 0.12;
      this.lastEffectVisiblePixelRatio = Math.max(this.lastEffectVisiblePixelRatio, framePostRenderState.effectVisiblePixelRatioEstimate);
    }
    this.lastStageMetrics.effectsMs += performance.now() - stageStartedAt;

    stageStartedAt = performance.now();
    this.applyTransition(phraseFrame, theme, safetyMetrics);
    this.lastStageMetrics.transitionMs += performance.now() - stageStartedAt;
    this.applyStructureRescue(phraseFrame, theme, edgeMap, nebula.occupancy, effectiveVisualState, safetyMetrics, safetyMetrics.luminance);
    const renderedFrame = this.captureRenderedFrame(nebula.budgetDowngradeCount);
    this.renderedFrameCount += 1;
    this.lastSafetyMetrics = this.updateSafetyMetrics(
      renderedFrame.luminanceSample,
      effectiveVisualState,
      safetyMetrics.overlayModeUsed,
      safetyMetrics.transitionFamilyUsed,
    );
    this.lastBudgetDowngradeCount = renderedFrame.budgetDowngradeCount;
    return renderedFrame;
  }

  getLastSafetyMetrics(): VisualSafetyMetrics {
    return this.lastSafetyMetrics;
  }

  getLastVisualState(): VisualState {
    return this.lastVisualState;
  }

  getLastActiveSubjectSnapshot(): ActiveSubjectSnapshot {
    return this.lastActiveSubjectSnapshot;
  }

  getLastHeroCoverage(): number {
    return this.lastHeroCoverage;
  }

  getLastBackgroundClutterRatio(): number {
    return this.lastBackgroundClutterRatio;
  }

  getLastSupportCoverage(): number {
    return this.lastSupportCoverage;
  }

  getLastNegativeSpaceOccupancy(): number {
    return this.lastNegativeSpaceOccupancy;
  }

  getLastTransitionDurationFrames(): number {
    return this.lastTransitionDurationFrames;
  }

  getLastTransitionBaseDurationFrames(): number {
    return this.lastTransitionBaseDurationFrames;
  }

  getLastTransitionCappedDurationFrames(): number {
    return this.lastTransitionCappedDurationFrames;
  }

  getLastTransitionCapLossFrames(): number {
    return this.lastTransitionCapLossFrames;
  }

  getLastTransitionRiskScore(): number {
    return this.lastTransitionRiskScore;
  }

  getLastTransitionCapCategory(): RenderQualityBudget["transitionBudgetTier"] {
    return this.lastTransitionCapCategory;
  }

  getLastTransitionCarryStrength(): number {
    return this.lastTransitionCarryStrength;
  }

  getLastTransitionCarryMode(): TransitionCarryProfile["mode"] {
    return this.lastTransitionCarryMode;
  }

  getLastTransitionCarryAvailabilityScore(): number {
    return this.lastTransitionCarryAvailabilityScore;
  }

  getLastTransitionCarryFallbackReason(): TransitionCarryReason {
    return this.lastTransitionCarryFallbackReason;
  }

  getLastCompositionMode(): CompositionPlan["stylePlacementMode"] {
    return this.lastCompositionMode;
  }

  getLastShapePlacementScore(): number {
    return this.lastShapePlacementScore;
  }

  getLastAtmosphereDensity(): number {
    return this.lastAtmosphereDensity;
  }

  getLastMidScaleCoverage(): number {
    return this.lastMidScaleCoverage;
  }

  getLastSymmetryUsage(): number {
    return this.lastSymmetryUsage;
  }

  getLastEventDensity(): number {
    return this.lastEventDensity;
  }

  getLastEmitterUsage(): number {
    return this.lastEmitterUsage;
  }

  getLastAbsorberUsage(): number {
    return this.lastAbsorberUsage;
  }

  getLastExplosionCount(): number {
    return this.lastExplosionCount;
  }

  getLastSourceAffinityAvg(): number {
    return this.lastSourceAffinityAvg;
  }

  getLastSourceAffinityHeroAvg(): number {
    return this.lastSourceAffinityHeroAvg;
  }

  getLastSourceAffinitySupportAvg(): number {
    return this.lastSourceAffinitySupportAvg;
  }

  getLastParticleConvergenceScore(): number {
    return this.lastParticleConvergenceScore;
  }

  getLastSupportElementDensity(): number {
    return this.lastSupportElementDensity;
  }

  getLastBackgroundElementDensity(): number {
    return this.lastBackgroundElementDensity;
  }

  getLastHeroIsolationScore(): number {
    return this.lastHeroIsolationScore;
  }

  getLastNearHeroEventDensity(): number {
    return this.lastNearHeroEventDensity;
  }

  getLastHeroToSupportDistanceScore(): number {
    return this.lastHeroToSupportDistanceScore;
  }

  getLastParticleSpawnRequests(): number {
    return this.lastParticleSpawnRequests;
  }

  getLastParticleRenderedCount(): number {
    return this.lastParticleRenderedCount;
  }

  getLastParticleCulledByLayerCap(): number {
    return this.lastParticleCulledByLayerCap;
  }

  getLastParticleCulledByHeroProtection(): number {
    return this.lastParticleCulledByHeroProtection;
  }

  getLastParticleCulledByNegativeSpace(): number {
    return this.lastParticleCulledByNegativeSpace;
  }

  getLastParticleCulledByImageProgress(): number {
    return this.lastParticleCulledByImageProgress;
  }

  getLastParticleCulledBySkipNonHero(): number {
    return this.lastParticleCulledBySkipNonHero;
  }

  getLastParticleOffscreenCount(): number {
    return this.lastParticleOffscreenCount;
  }

  getLastParticleTooSmallToReadCount(): number {
    return this.lastParticleTooSmallToReadCount;
  }

  getLastParticleLowAlphaCount(): number {
    return this.lastParticleLowAlphaCount;
  }

  getLastParticleLowContrastCount(): number {
    return this.lastParticleLowContrastCount;
  }

  getLastParticleVisibleCount(): number {
    return this.lastParticleVisibleCount;
  }

  getLastParticleVisibleRatio(): number {
    return this.lastParticleVisibleRatio;
  }

  getLastHeroParticleRenderedCount(): number {
    return this.lastHeroParticleRenderedCount;
  }

  getLastSupportParticleRenderedCount(): number {
    return this.lastSupportParticleRenderedCount;
  }

  getLastBackgroundParticleRenderedCount(): number {
    return this.lastBackgroundParticleRenderedCount;
  }

  getLastSubEmitterTriggerCount(): number {
    return this.lastSubEmitterTriggerCount;
  }

  getLastSubEmitterChildSpawnedCount(): number {
    return this.lastSubEmitterChildSpawnedCount;
  }

  getLastSubEmitterChildren(): number {
    return this.lastSubEmitterChildren;
  }

  getLastHeroEchoCount(): number {
    return this.lastHeroEchoCount;
  }

  getLastHeroGlyphComplexity(): number {
    return this.lastHeroGlyphComplexity;
  }

  getLastHeroPrimitive(): HeroPrimitiveKind | undefined {
    return this.lastHeroPrimitive;
  }

  getLastHeroShellMode(): HeroPostShellMode | undefined {
    return this.lastHeroShellMode;
  }

  getLastHeroBaseShellMode(): HeroPostShellMode | undefined {
    return this.lastHeroBaseShellMode;
  }

  getLastHeroResolvedShellMode(): HeroPostShellMode | undefined {
    return this.lastHeroResolvedShellMode;
  }

  getLastHeroCircleShellEligible(): boolean {
    return this.lastHeroCircleShellEligible;
  }

  getLastHeroCircleShellPromoted(): boolean {
    return this.lastHeroCircleShellPromoted;
  }

  getLastHeroSubEmitterCount(): number {
    return this.lastHeroSubEmitterCount;
  }

  getLastHeroSubEmitterFamily(): SceneGraph["heroSubEmitterFamily"] | undefined {
    return this.lastHeroSubEmitterFamily;
  }

  getLastHeroSubEmitterVariant(): string {
    return this.lastHeroSubEmitterVariant;
  }

  getLastHeroSubEmitterMotifAlignmentScore(): number {
    return this.lastHeroSubEmitterMotifAlignmentScore;
  }

  getLastHeroCoreSize(): number {
    return this.lastHeroCoreSize;
  }

  getLastHeroCoreFillMode(): HeroCoreFillMode {
    return this.lastHeroCoreFillMode;
  }

  getLastHeroOutlineRatio(): number {
    return this.lastHeroOutlineRatio;
  }

  getLastHeroPrimitiveComplexity(): number {
    return this.lastHeroPrimitiveComplexity;
  }

  getLastHeroChildEmissionRate(): number {
    return this.lastHeroChildEmissionRate;
  }

  getLastHeroChildFieldDensity(): number {
    return this.lastHeroChildFieldDensity;
  }

  getLastHeroChildFieldRadius(): number {
    return this.lastHeroChildFieldRadius;
  }

  getLastHeroTrailOccupancy(): number {
    return this.lastHeroTrailOccupancy;
  }

  getLastHeroWakeLengthPx(): number {
    return this.lastHeroWakeLengthPx;
  }

  getLastHeroBurstCount(): number {
    return this.lastHeroBurstCount;
  }

  getLastHeroBurstChildren(): number {
    return this.lastHeroBurstChildren;
  }

  getLastHeroMotorJitter(): number {
    return this.lastHeroMotorJitter;
  }

  getLastHeroMotorThrust(): number {
    return this.lastHeroMotorThrust;
  }

  getLastHeroBurnPhase(): number {
    return this.lastHeroBurnPhase;
  }

  getLastHeroWakeTailAgeAvg(): number {
    return this.lastHeroWakeTailAgeAvg;
  }

  getLastHeroWakeResetCount(): number {
    return this.lastHeroWakeResetCount;
  }

  getLastHeroSpeedAvg(): number {
    return this.lastHeroSpeedAvg;
  }

  getLastHeroSpeedPeak(): number {
    return this.lastHeroSpeedPeak;
  }

  getLastHeroScalePulseAvg(): number {
    return this.lastHeroScalePulseAvg;
  }

  getLastHeroScalePulsePeak(): number {
    return this.lastHeroScalePulsePeak;
  }

  getLastMotifPotencyScore(): number {
    return this.lastMotifPotencyScore;
  }

  getLastTransitionTriggerMode(): "swap" | "hold" {
    return this.lastTransitionTriggerMode;
  }

  getLastHeroShellInnerAlpha(): number {
    return this.lastHeroShellInnerAlpha;
  }

  getLastHeroShellOuterAlpha(): number {
    return this.lastHeroShellOuterAlpha;
  }

  getLastHeroShellSceneEnabled(): boolean {
    return this.lastHeroShellSceneEnabled;
  }

  getLastHeroShellConfiguredCount(): 0 | 1 | 2 | 3 {
    return this.lastHeroShellConfiguredCount;
  }

  getLastHeroShellColorMode(): HeroShellColorMode {
    return this.lastHeroShellColorMode;
  }

  getLastHeroShellActiveCount(): number {
    return this.lastHeroShellActiveCount;
  }

  getLastHeroShellActivationDriverBand(): HeroShellBand {
    return this.lastHeroShellActivationDriverBand;
  }

  getLastHeroShellTriggerRateLow(): number {
    return this.lastHeroShellTriggerRateLow;
  }

  getLastHeroShellTriggerRateLowMid(): number {
    return this.lastHeroShellTriggerRateLowMid;
  }

  getLastHeroShellTriggerRateLowComposite(): number {
    return this.lastHeroShellTriggerRateLowComposite;
  }

  getLastHeroShellThresholdLow(): number {
    return this.lastHeroShellThresholdLow;
  }

  getLastHeroShellThresholdLowMid(): number {
    return this.lastHeroShellThresholdLowMid;
  }

  getLastHeroShellThresholdLowComposite(): number {
    return this.lastHeroShellThresholdLowComposite;
  }

  getLastHeroShellTriggerRateHighMid(): number {
    return this.lastHeroShellTriggerRateHighMid;
  }

  getLastHeroShellTriggerRateHigh(): number {
    return this.lastHeroShellTriggerRateHigh;
  }

  getLastHeroShellTriggerRateUpper(): number {
    return this.lastHeroShellTriggerRateUpper;
  }

  getLastHeroShellThresholdHighMid(): number {
    return this.lastHeroShellThresholdHighMid;
  }

  getLastHeroShellThresholdHigh(): number {
    return this.lastHeroShellThresholdHigh;
  }

  getLastHeroShellThresholdUpper(): number {
    return this.lastHeroShellThresholdUpper;
  }

  getLastHeroBandLowUsage(): number {
    return this.lastHeroBandLowUsage;
  }

  getLastHeroBandMidUsage(): number {
    return this.lastHeroBandMidUsage;
  }

  getLastHeroBandHighUsage(): number {
    return this.lastHeroBandHighUsage;
  }

  getLastHeroEmitterTopology(): string {
    return this.lastHeroEmitterTopology;
  }

  getLastHeroInstanceVariant(): string {
    return this.lastHeroInstanceVariant;
  }

  getLastHeroContrastBowlUsed(): boolean {
    return this.lastHeroContrastBowlUsed;
  }

  getLastHeroTravelGracefulBias(): number {
    return this.lastHeroTravelGracefulBias;
  }

  getLastHeroTravelGlitchBias(): number {
    return this.lastHeroTravelGlitchBias;
  }

  getLastHeroTargetSmoothing(): number {
    return this.lastHeroTargetSmoothing;
  }

  getLastHeroSpinVelocity(): number {
    return this.lastHeroSpinVelocity;
  }

  getLastMotionTier(): "jump" | "glide" | "flourish" {
    return this.lastMotionTier;
  }

  getLastJumpTriggered(): boolean {
    return this.lastJumpTriggered;
  }

  getLastJitterSuppressed(): boolean {
    return this.lastJitterSuppressed;
  }

  getLastMotionTierReadable(): boolean {
    return this.lastMotionTierReadable;
  }

  getLastFlourishStrength(): number {
    return this.lastFlourishStrength;
  }

  getLastScreenEdgeAimBias(): number {
    return this.lastScreenEdgeAimBias;
  }

  getLastStreamCenterBiasDegrees(): number {
    return this.lastStreamCenterBiasDegrees;
  }

  getLastCenterwardEmissionRatio(): number {
    return this.lastCenterwardEmissionRatio;
  }

  getLastEdgePressureActiveFrameRatio(): number {
    return this.lastEdgePressureActiveFrameRatio;
  }

  getLastHeroBurstGateActiveRatio(): number {
    return this.lastHeroBurstGateActiveRatio;
  }

  getLastHeroBurstCadenceSlotHits(): number {
    return this.lastHeroBurstCadenceSlotHits;
  }

  getLastHeroBurstTopQuartileRatio(): number {
    return this.lastHeroBurstTopQuartileRatio;
  }

  getLastHeroShellHueTravel(): number {
    return this.lastHeroShellHueTravel;
  }

  getLastHeroShellUnderlayActive(): boolean {
    return this.lastHeroShellUnderlayActive;
  }

  getLastHeroSpawnRegion(): string {
    return this.lastHeroSpawnRegion;
  }

  getLastHeroParticleExitWhiteBias(): number {
    return this.lastHeroParticleExitWhiteBias;
  }

  getLastHeroParticleSizeVariance(): string {
    return this.lastHeroParticleSizeVariance;
  }

  getLastHeroColorProminence(): string {
    return this.lastHeroColorProminence;
  }

  getLastEdgeDeathEligibleCount(): number {
    return this.lastEdgeDeathEligibleCount;
  }

  getLastEdgeDeathTriggeredCount(): number {
    return this.lastEdgeDeathTriggeredCount;
  }

  getLastEdgeDeathPlayedCount(): number {
    return this.lastEdgeDeathPlayedCount;
  }

  getLastEdgeDeathSkippedByCostCount(): number {
    return this.lastEdgeDeathSkippedByCostCount;
  }

  getLastEdgeDeathEffectId(): string | undefined {
    return this.lastEdgeDeathEffectId;
  }

  getLastEdgeDeathCostTier(): "low" | "medium" | "high" | undefined {
    return this.lastEdgeDeathCostTier;
  }

  getLastEdgeExitFramesAvg(): number {
    return this.lastEdgeExitFramesAvg;
  }

  getLastEdgeExitDistanceAvg(): number {
    return this.lastEdgeExitDistanceAvg;
  }

  getLastHeroMotifInfluenceKey(): string {
    return this.lastHeroMotifInfluenceKey;
  }

  getLastHeroMotionBias(): string {
    return this.lastHeroMotionBias;
  }

  getLastHeroMotifProfile(): string {
    return this.lastHeroMotifProfile;
  }

  getLastHeroMotifScheduled(): string {
    return this.lastHeroMotifScheduled;
  }

  getLastHeroMotifSlotIndex(): number {
    return this.lastHeroMotifSlotIndex;
  }

  getLastHeroMotifSlotStartSec(): number {
    return this.lastHeroMotifSlotStartSec;
  }

  getLastHeroMotifSlotEndSec(): number {
    return this.lastHeroMotifSlotEndSec;
  }

  getLastHeroMotifScheduleReason(): HeroMotifScheduleSlot["reason"] {
    return this.lastHeroMotifScheduleReason;
  }

  getLastHeroMotifChangedOnSlotBoundary(): boolean {
    return this.lastHeroMotifChangedOnSlotBoundary;
  }

  getLastHeroMotifChangedOutsideSlot(): boolean {
    return this.lastHeroMotifChangedOutsideSlot;
  }

  getLastHeroMotifScheduleMismatch(): boolean {
    return this.lastHeroMotifScheduleMismatch;
  }

  getLastHeroMotifVariantKey(): string {
    return this.lastHeroMotifVariantKey;
  }

  getLastHeroVariantWarp(): number {
    return this.lastHeroVariantWarp;
  }

  getLastHeroVariantGravity(): number {
    return this.lastHeroVariantGravity;
  }

  getLastHeroVariantInconsistency(): number {
    return this.lastHeroVariantInconsistency;
  }

  getLastHeroParticleSizeAvg(): number {
    return this.lastHeroParticleSizeAvg;
  }

  getLastHeroParticleTtlAvg(): number {
    return this.lastHeroParticleTtlAvg;
  }

  getLastHeroConductorCount(): number {
    return this.lastHeroConductorCount;
  }

  getLastHeroConductorType(): string {
    return this.lastHeroConductorType;
  }

  getLastHeroConductorInfluenceRadiusAvg(): number {
    return this.lastHeroConductorInfluenceRadiusAvg;
  }

  getLastHeroCircleEmitterNodeCoverage(): number {
    return this.lastHeroCircleEmitterNodeCoverage;
  }

  getLastHeroExpandedBandCount(): number {
    return this.lastHeroExpandedBandCount;
  }

  getLastHeroRelationshipMode(): HeroRelationshipMode {
    return this.lastHeroRelationshipMode;
  }

  getLastHeroRelationshipClass(): HeroRelationshipClass {
    return this.lastHeroRelationshipClass;
  }

  getLastHeroLayoutFamily(): SceneGraph["heroLayoutFamily"] | undefined {
    return this.lastHeroLayoutFamily;
  }

  getLastHeroInstanceCountResolved(): number {
    return this.lastHeroInstanceCountResolved;
  }

  getLastHeroPairMinDistancePx(): number {
    return this.lastHeroPairMinDistancePx;
  }

  getLastHeroPairAvgDistancePx(): number {
    return this.lastHeroPairAvgDistancePx;
  }

  getLastHeroOverlapRatio(): number {
    return this.lastHeroOverlapRatio;
  }

  getLastHeroCoreOverlapRatio(): number {
    return this.lastHeroCoreOverlapRatio;
  }

  getLastHeroGlowMergeRatio(): number {
    return this.lastHeroGlowMergeRatio;
  }

  getLastHeroLaneDiversityScore(): number {
    return this.lastHeroLaneDiversityScore;
  }

  getLastHeroDistinctQuadrantCount(): number {
    return this.lastHeroDistinctQuadrantCount;
  }

  getLastHeroRelationshipResolved(): HeroRelationshipMode {
    return this.lastHeroRelationshipResolved;
  }

  getLastHeroSeparationReadable(): boolean {
    return this.lastHeroSeparationReadable;
  }

  getLastHeroSeparationFailureReason(): HeroSeparationFailureReason {
    return this.lastHeroSeparationFailureReason;
  }

  getLastShotGrammarKey(): string {
    return this.lastShotGrammarKey;
  }

  getLastFocalQuadrant(): "tl" | "tr" | "bl" | "br" | "center" {
    return this.lastFocalQuadrant;
  }

  getLastHeroQuadrant(): "tl" | "tr" | "bl" | "br" | "center" {
    return this.lastHeroQuadrant;
  }

  getLastBrightestBlobQuadrant(): "tl" | "tr" | "bl" | "br" | "center" {
    return this.lastBrightestBlobQuadrant;
  }

  getLastSupportClusterCount(): number {
    return this.lastSupportClusterCount;
  }

  getLastSupportNearHeroScore(): number {
    return this.lastSupportNearHeroScore;
  }

  getLastEdgeHighlightPenalty(): number {
    return this.lastEdgeHighlightPenalty;
  }

  getLastEdgeDominanceMargin(): number {
    return this.lastEdgeDominanceMargin;
  }

  getLastDeadCenterVoidScore(): number {
    return this.lastDeadCenterVoidScore;
  }

  getLastFocalReinforcementScore(): number {
    return this.lastFocalReinforcementScore;
  }

  getLastDbTransitionDrive(): number {
    return this.lastDbTransitionDrive;
  }

  getLastBandWeightedTransitionDrive(): number {
    return this.lastBandWeightedTransitionDrive;
  }

  getLastHzTransitionDrive(): number {
    return this.lastHzTransitionDrive;
  }

  getLastAudioTransitionScore(): number {
    return this.lastAudioTransitionScore;
  }

  getLastHoldPenalty(): number {
    return this.lastHoldPenalty;
  }

  getLastSwapPromotedByAudio(): boolean {
    return this.lastSwapPromotedByAudio;
  }

  getLastAudioSwapPromotionChance(): number {
    return this.lastAudioSwapPromotionChance;
  }

  getLastAudioSwapPromotionExtraChance(): number {
    return this.lastAudioSwapPromotionExtraChance;
  }

  getLastAudioSwapNodeTriggerCount(): number {
    return this.lastAudioSwapNodeTriggerCount;
  }

  getLastRecoveryMode(): RecoveryMode {
    return this.lastRecoveryMode;
  }

  getLastFallbackRenderMode(): "none" | "fallback-composed" | "safety-recovery" | "mask-recovery" {
    return this.lastFallbackRenderMode;
  }

  getLastFallbackReason(): import("../types").FallbackReason {
    return this.lastFallbackReason;
  }

  getLastFallbackTriggerCount(): number {
    return this.lastFallbackTriggerCount;
  }

  getLastFallbackSeverity(): "none" | "light" | "full" {
    return this.lastFallbackSeverity;
  }

  getLastCompositionModeReason(): import("../types").CompositionModeReason {
    return this.lastCompositionModeReason;
  }

  getLastParticleTelemetryAvailable(): boolean {
    return this.lastParticleTelemetryAvailable;
  }

  getLastVisibleFallbackRisk(): boolean {
    return this.lastVisibleFallbackRisk;
  }

  getLastTransitionIdentitySignature(): string {
    return this.lastTransitionIdentitySignature;
  }

  getLastTransitionIdentityChanged(): boolean {
    return this.lastTransitionIdentityChanged;
  }

  getLastMotifChangedOnTransition(): boolean {
    return this.lastMotifChangedOnTransition;
  }

  getLastHeroChangedOnTransition(): boolean {
    return this.lastHeroChangedOnTransition;
  }

  getLastMotifEffectId(): MotifEffectId | undefined {
    return this.lastMotifEffectId;
  }

  getLastPersistentMotifId(): PersistentMotifState["id"] | undefined {
    return this.persistentMotifState?.id;
  }

  getLastPersistentMotifLabel(): string | undefined {
    return this.persistentMotifState?.label;
  }

  getLastPersistentMotifCarryFrames(): number {
    return this.persistentMotifState?.carryFrames ?? 0;
  }

  getLastPersistentMotifChanged(): boolean {
    return this.lastPersistentMotifChanged;
  }

  getLastEventSpecId(): EventSpec["id"] | undefined {
    return this.lastEventSpec?.id;
  }

  getLastEventSpecLabel(): string | undefined {
    return this.lastEventSpec?.label;
  }

  getLastMotifEffectPhenomenon(): PhysicalPhenomenonFamily | undefined {
    return this.lastMotifEffectPhenomenon;
  }

  getLastMotifEffectAudioMode(): MotifEffectAudioMode | undefined {
    return this.lastMotifEffectAudioMode;
  }

  getLastMotifEffectIntensity(): number {
    return this.lastMotifEffectIntensity;
  }

  getLastHeroWarpActive(): boolean {
    return this.lastHeroWarpActive;
  }

  getLastQuarterSpawnGuaranteeHitCount(): number {
    return this.lastQuarterSpawnGuaranteeHitCount;
  }

  getLastQuarterSpawnGuaranteeMissCount(): number {
    return this.lastQuarterSpawnGuaranteeMissCount;
  }

  getLastEdgeAttractionScale(): number {
    return this.lastEdgeAttractionScale;
  }

  getLastTransitionMotionGrammar(): string {
    return this.lastTransitionMotionGrammar;
  }

  getLastHeroArchetype(): SceneGraph["heroArchetype"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.heroArchetype;
  }

  getLastHeroStoryBeat(): SceneGraph["heroStoryBeat"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.heroStoryBeat;
  }

  getLastHeroEmissionMode(): SceneGraph["heroEmissionMode"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.heroEmissionMode;
  }

  getLastSubEmitterMode(): SceneGraph["subEmitterMode"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.subEmitterMode;
  }

  getLastNodeIntent(): SceneGraph["intentSeed"]["intent"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.intentSeed.intent;
  }

  getLastEpisodeIntent(): SceneGraph["episodeSeed"]["episodeIntent"] | undefined {
    return this.sceneGraphCache.get(this.lastImagePath)?.episodeSeed.episodeIntent;
  }

  getLastBudgetDowngradeCount(): number {
    return this.lastBudgetDowngradeCount;
  }

  setRuntimePressureMetrics(encoderPressureMs: number): void {
    this.lastEncoderPressureMs = encoderPressureMs;
  }

  getLastStageMetrics(): RenderStageMetrics {
    return this.lastStageMetrics;
  }

  getLastRenderSelection(): ActiveRenderSelection {
    return this.lastRenderSelection;
  }

  private segmentForIndex(index: number): AudioSegmentFeature {
    return this.segments[Math.max(0, Math.min(index, this.segments.length - 1, this.edgeMaps.length - 1))] ?? {
      index: 0,
      startSec: 0,
      endSec: 0,
      dominantHz: 220,
      dominantBand: "mid",
      rainbowHueOffset: 180,
      paletteWeights: { low: 0.25, lowMid: 0.25, mid: 0.25, high: 0.25 },
      motionScale: 1,
      densityScale: 1,
    };
  }

  private scheduledWindowIndexAtTime(timeSec: number): number {
    return Math.min(Math.max(0, Math.floor(timeSec / Math.max(1e-6, this.schedule.secondsPerImage))), this.edgeMaps.length - 1);
  }

  private effectiveWindowIndexAtTime(timeSec: number): number {
    const scheduled = this.scheduledWindowIndexAtTime(timeSec);
    if (this.tailCarryWindowIndex !== undefined && scheduled >= this.tailCarryWindowIndex) {
      return Math.max(0, this.tailCarryWindowIndex - 1);
    }
    return Math.min(scheduled, this.nodeWindowCount - 1);
  }

  private buildHeroShellEnabledWindowSet(): number[] {
    const candidates: Array<{ windowIndex: number; score: number }> = [];
    for (let windowIndex = 0; windowIndex < this.nodeWindowCount; windowIndex += 1) {
      const edgeMap = this.edgeMaps[Math.min(windowIndex, this.edgeMaps.length - 1)]!;
      const segment = this.segmentForIndex(windowIndex);
      const theme = this.getTheme(windowIndex, segment, edgeMap);
      const compositionPlan = this.getCompositionPlan(edgeMap, theme);
      const heroMotifSlot = resolveHeroMotifScheduleSlot(this.heroMotifSchedule, windowIndex * this.schedule.secondsPerImage);
      const sceneGraph = this.getSceneGraph(edgeMap, theme, compositionPlan, windowIndex, heroMotifSlot);
      const score = stableHash(
        `hero-shell-window:${windowIndex}:${edgeMap.imagePath}:${sceneGraph.continuitySeed}:${sceneGraph.heroMotifProfile.key}:${sceneGraph.heroPrimitive}:${theme.styleProfile.imagePath}`,
      );
      candidates.push({ windowIndex, score });
    }
    const allowed = Math.max(1, Math.floor(this.nodeWindowCount * 0.3));
    return candidates
      .sort((a, b) => b.score - a.score || a.windowIndex - b.windowIndex)
      .slice(0, allowed)
      .map((entry) => entry.windowIndex);
  }

  private initializeHeroShellWindowStates(): void {
    for (let windowIndex = 0; windowIndex < this.nodeWindowCount; windowIndex += 1) {
      this.heroShellWindowStates.set(windowIndex, this.buildHeroShellWindowState(windowIndex));
    }
  }

  private buildHeroShellWindowState(windowIndex: number): HeroShellWindowRuntimeState {
    const edgeMap = this.edgeMaps[Math.min(windowIndex, this.edgeMaps.length - 1)]!;
    const segment = this.segmentForIndex(windowIndex);
    const theme = this.getTheme(windowIndex, segment, edgeMap);
    const compositionPlan = this.getCompositionPlan(edgeMap, theme);
    const heroMotifSlot = resolveHeroMotifScheduleSlot(this.heroMotifSchedule, windowIndex * this.schedule.secondsPerImage);
    const sceneGraph = this.getSceneGraph(edgeMap, theme, compositionPlan, windowIndex, heroMotifSlot);
    const enabled = this.shellEnabledWindowIndices.has(windowIndex);
    const configuredCount =
      enabled
        ? configuredHeroShellCountFromScore(
            stableHash(`hero-shell-count:${windowIndex}:${edgeMap.imagePath}:${sceneGraph.continuitySeed}:${sceneGraph.heroMotifProfile.key}`),
          )
        : 0;
    const colorMode: HeroShellColorMode =
      enabled &&
      theme.styleProfile.hueVariance >= 0.18 &&
      (
        sceneGraph.heroMotifProfile.intensityClass === "colorful-psychedelic" ||
        sceneGraph.heroEmissionTuning.colorfulnessScale >= 1.5
      )
        ? "multi"
        : "single";
    const baseOffset =
      (stableHash(`hero-shell-color:${windowIndex}:${edgeMap.imagePath}:${sceneGraph.heroMotifProfile.key}:${theme.styleProfile.imagePath}`) % 1000) / 1000;
    const shellColorRangeRamp = clamp(
      (sceneGraph.heroMotifProfile.intensityClass === "colorful-psychedelic" ? 0.44 : 0) +
      (sceneGraph.heroEmissionTuning.colorRangeMode === "extreme" ? 0.72 : 0) +
      sceneGraph.heroMotifVariant.warpWeight * 0.2 +
      sceneGraph.heroMotifVariant.densityWeight * 0.14,
      0,
      1,
    );
    const paletteSpanScale = 1.2 + shellColorRangeRamp * 0.3;
    const hueTravelScale = 1.2 + shellColorRangeRamp * 0.3;
    const colorOffsets: [number, number, number] =
      colorMode === "multi"
        ? [
            baseOffset,
            (baseOffset + (0.18 + theme.styleProfile.hueVariance * 0.16) * paletteSpanScale) % 1,
            (baseOffset + (0.43 + sceneGraph.heroMotifVariant.sizeWeight * 0.12) * paletteSpanScale) % 1,
          ]
        : [baseOffset, baseOffset, baseOffset];
    return {
      windowIndex,
      enabled,
      configuredCount,
      colorMode,
      paletteSpanScale,
      hueTravelScale,
      layers: buildHeroShellLayerSpecs(configuredCount).map((spec) => ({
        spec,
        recentTriggers: [],
        recentTriggerCount: 0,
      })),
      captureFrames: Math.max(6, Math.round(((60 / Math.max(1, this.bpm)) * 2) * this.settings.fps)),
      colorOffsets,
    };
  }

  private getHeroShellWindowState(windowIndex: number): HeroShellWindowRuntimeState {
    const existing = this.heroShellWindowStates.get(windowIndex);
    if (existing) {
      return existing;
    }
    const created = this.buildHeroShellWindowState(windowIndex);
    this.heroShellWindowStates.set(windowIndex, created);
    return created;
  }

  private resolveHeroShellSceneForWindow(sceneGraph: SceneGraph, windowIndex: number): SceneGraph {
    const windowState = this.getHeroShellWindowState(windowIndex);
    const primaryMode = windowState.enabled ? legacyHeroShellModeForLayer(windowState.layers[0]?.spec.style) : "none";
    return {
      ...sceneGraph,
      heroShellMode: primaryMode,
      heroBaseShellMode: primaryMode,
      heroResolvedShellMode: primaryMode,
      heroCircleShellEligible: windowState.enabled,
      heroCircleShellPromoted: windowState.enabled,
      heroShellSceneEnabled: windowState.enabled,
      heroShellConfiguredCount: windowState.configuredCount,
      heroShellColorMode: windowState.colorMode,
      heroShellLayers: windowState.layers.map((layer) => ({ ...layer.spec })),
    };
  }

  private resolveHeroShellFrameState(
    frame: AudioFrameFeature,
    sceneGraph: SceneGraph,
    windowIndex: number,
  ): HeroShellFrameState {
    const windowState = this.getHeroShellWindowState(windowIndex);
    const layers = windowState.layers.map((layer) => {
      const recentRatio = layer.recentTriggerCount / Math.max(1, windowState.captureFrames);
      const offset = clamp((recentRatio - layer.spec.targetTriggerRatio) / Math.max(0.0001, layer.spec.targetTriggerRatio), -1, 1) * 0.2;
      const dynamicThreshold = layer.spec.baseThreshold * (1 + offset);
      const drive = heroShellDriveForBand(frame, layer.spec.band);
      return {
        spec: layer.spec,
        drive,
        dynamicThreshold,
        active: drive >= dynamicThreshold,
      };
    });

    for (let index = 0; index < layers.length; index += 1) {
      const layerState = windowState.layers[index]!;
      const active = layers[index]!.active ? 1 : 0;
      layerState.recentTriggers.push(active);
      layerState.recentTriggerCount += active;
      if (layerState.recentTriggers.length > windowState.captureFrames) {
        layerState.recentTriggerCount -= layerState.recentTriggers.shift() ?? 0;
      }
    }

    const activeCount = layers.reduce((sum, layer) => sum + (layer.active ? 1 : 0), 0);
    const lowLayer = layers.find((layer) => layer.spec.band === "low");
    const lowMidLayer = layers.find((layer) => layer.spec.band === "lowMid");
    const lowCompositeLayer = layers.find((layer) => layer.spec.band === "lowComposite");
    const strongestActive = [...layers]
      .filter((layer) => layer.active)
      .sort((a, b) => b.spec.alphaWeight - a.spec.alphaWeight)[0];
    const shellColorizationScale =
      strongestActive
        ? clamp(
            (0.1 + strongestActive.drive * 0.12) *
              (0.86 + sceneGraph.heroMotifProfile.colorProminence.shell * 0.08) *
              this.resolveHeroColorResponseScale(sceneGraph),
            0.04,
            0.28,
          )
        : 0;

    this.lastHeroShellSceneEnabled = windowState.enabled;
    this.lastHeroShellConfiguredCount = windowState.configuredCount;
    this.lastHeroShellColorMode = windowState.colorMode;
    this.lastHeroShellActiveCount = activeCount;
    this.lastHeroShellActivationDriverBand = "low";
    this.lastHeroShellTriggerRateLow = lowLayer?.active ? 1 : 0;
    this.lastHeroShellTriggerRateLowMid = lowMidLayer?.active ? 1 : 0;
    this.lastHeroShellTriggerRateLowComposite = lowCompositeLayer?.active ? 1 : 0;
    this.lastHeroShellThresholdLow = lowLayer?.dynamicThreshold ?? 0;
    this.lastHeroShellThresholdLowMid = lowMidLayer?.dynamicThreshold ?? 0;
    this.lastHeroShellThresholdLowComposite = lowCompositeLayer?.dynamicThreshold ?? 0;
    this.lastHeroShellTriggerRateHighMid = this.lastHeroShellTriggerRateLow;
    this.lastHeroShellTriggerRateHigh = this.lastHeroShellTriggerRateLowMid;
    this.lastHeroShellTriggerRateUpper = this.lastHeroShellTriggerRateLowComposite;
    this.lastHeroShellThresholdHighMid = this.lastHeroShellThresholdLow;
    this.lastHeroShellThresholdHigh = this.lastHeroShellThresholdLowMid;
    this.lastHeroShellThresholdUpper = this.lastHeroShellThresholdLowComposite;
    this.lastHeroShellHueTravel = windowState.enabled ? windowState.hueTravelScale : 0;
    this.lastHeroShellUnderlayActive = activeCount > 0;
    this.lastHeroContrastBowlUsed = false;
    this.lastHeroShellInnerAlpha =
      strongestActive?.spec.style === "halo-fill"
        ? clamp(shellColorizationScale * strongestActive.spec.alphaWeight * 0.92, 0.04, 0.26)
        : 0;
    this.lastHeroShellOuterAlpha =
      strongestActive
        ? clamp(shellColorizationScale * strongestActive.spec.alphaWeight * 0.84, 0.04, 0.24)
        : 0;

    if (!windowState.enabled) {
      this.lastHeroShellActiveCount = 0;
      this.lastHeroShellInnerAlpha = 0;
      this.lastHeroShellOuterAlpha = 0;
      this.lastHeroShellTriggerRateLow = 0;
      this.lastHeroShellTriggerRateLowMid = 0;
      this.lastHeroShellTriggerRateLowComposite = 0;
      this.lastHeroShellThresholdLow = 0;
      this.lastHeroShellThresholdLowMid = 0;
      this.lastHeroShellThresholdLowComposite = 0;
      this.lastHeroShellTriggerRateHighMid = 0;
      this.lastHeroShellTriggerRateHigh = 0;
      this.lastHeroShellTriggerRateUpper = 0;
      this.lastHeroShellThresholdHighMid = 0;
      this.lastHeroShellThresholdHigh = 0;
      this.lastHeroShellThresholdUpper = 0;
      this.lastHeroShellHueTravel = 0;
      this.lastHeroShellUnderlayActive = false;
    }

    return {
      windowState,
      layers,
    };
  }

  private getParticleState(imagePath: string): ParticleSystemState {
    const existing = this.particleStatesByImage.get(imagePath);
    if (existing) {
      return existing;
    }
    const created = getParticleSystemState();
    this.particleStatesByImage.set(imagePath, created);
    return created;
  }

  private getActiveSubjectState(imagePath: string, edgeMap: EdgeMap): ActiveSubjectState {
    const existing = this.activeSubjectStatesByImage.get(imagePath);
    if (existing) {
      return existing;
    }
    const created = createActiveSubjectState(edgeMap);
    this.activeSubjectStatesByImage.set(imagePath, created);
    return created;
  }

  private getTheme(segmentIndex: number, segment: AudioSegmentFeature, edgeMap: EdgeMap): RenderTheme {
    const cacheKey = themeCacheKey(edgeMap.imagePath, segmentIndex);
    const cached = this.themeCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const theme = createRenderTheme(segment, edgeMap.styleProfile ?? createFallbackStyleProfile(edgeMap.imagePath));
    this.themeCache.set(cacheKey, theme);
    return theme;
  }

  private getCompositionPlan(edgeMap: EdgeMap, theme: RenderTheme): CompositionPlan {
    const cacheKey = this.themeQuery ? `${edgeMap.imagePath}::${this.themeQuery}` : edgeMap.imagePath;
    const cached = this.compositionPlanCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const plan = buildCompositionPlanForTheme(edgeMap, theme, this.themeQuery);
    this.compositionPlanCache.set(cacheKey, plan);
    this.compositionPlanCache.set(edgeMap.imagePath, plan);
    return plan;
  }

  private chooseFallbackReason(
    riskProfile: CompositionRiskProfile,
    edgeMap: EdgeMap,
  ): import("../types").FallbackReason {
    const ranked: Array<[import("../types").FallbackReason, number]> = [
      ["low-support-near-hero", riskProfile.lowSupportScore * 1.12],
      ["low-focal-occupancy", riskProfile.lowFocalScore * 1.08],
      ["dead-center-void", riskProfile.deadCenterScore],
      ["edge-dominance", riskProfile.edgeDominanceScore],
      ["held-sparse", riskProfile.heldSparseScore * 0.96],
      ["mask-confidence-low", riskProfile.maskConfidenceScore],
    ];
    const [reason, score] = ranked.sort((left, right) => right[1] - left[1])[0] ?? ["none", 0];
    if (reason === "mask-confidence-low" && edgeMap.maskConfidence !== "low") {
      return "none";
    }
    return score > 0.08 ? reason : "none";
  }

  private buildRecoverySupportClusters(
    plan: CompositionPlan,
    edgeMap: EdgeMap,
    desiredCount: number,
  ): PlacementSlot[] {
    const brightestSide = computeEdgeDominanceMetrics(edgeMap).brightestQuadrant;
    const heroCenterX = plan.heroCenterX;
    const heroCenterY = plan.heroCenterY;
    const horizontalPreference = heroCenterX < edgeMap.width * 0.5 ? "right" : "left";
    const verticalPreference = heroCenterY < edgeMap.height * 0.5 ? "bottom" : "top";
    const sideWeight = (side: "left" | "right" | "top" | "bottom"): number =>
      side === "left"
        ? edgeMap.leftWeight
        : side === "right"
          ? edgeMap.rightWeight
          : side === "top"
            ? edgeMap.topWeight
            : edgeMap.bottomWeight;
    const candidateSpecs = [
      { side: horizontalPreference, angle: horizontalPreference === "right" ? 0 : Math.PI, distanceScale: 1.48, offsetYScale: -0.18 },
      { side: horizontalPreference, angle: horizontalPreference === "right" ? 0.72 : Math.PI - 0.72, distanceScale: 1.62, offsetYScale: 0.38 },
      { side: horizontalPreference, angle: horizontalPreference === "right" ? -0.72 : -Math.PI + 0.72, distanceScale: 1.62, offsetYScale: -0.38 },
      { side: verticalPreference, angle: verticalPreference === "bottom" ? Math.PI / 2 : -Math.PI / 2, distanceScale: 1.42, offsetYScale: 0 },
      { side: brightestSide === "left" ? "right" : brightestSide === "right" ? "left" : horizontalPreference, angle: brightestSide === "left" ? 0 : brightestSide === "right" ? Math.PI : (horizontalPreference === "right" ? 0 : Math.PI), distanceScale: 1.8, offsetYScale: 0.12 },
    ] as const;
    const selected: PlacementSlot[] = [];
    for (const spec of candidateSpecs) {
      if (selected.length >= desiredCount) {
        break;
      }
      const targetX = clamp(
        heroCenterX + Math.cos(spec.angle) * plan.heroRadius * spec.distanceScale,
        edgeMap.width * 0.12,
        edgeMap.width * 0.88,
      );
      const targetY = clamp(
        heroCenterY + Math.sin(spec.angle) * plan.heroRadius * spec.distanceScale + plan.heroRadius * spec.offsetYScale,
        edgeMap.height * 0.12,
        edgeMap.height * 0.88,
      );
      if (inProtectedZone(plan.protectedZones, targetX, targetY)) {
        continue;
      }
      const slot: PlacementSlot = {
        x: targetX,
        y: targetY,
        radius: clamp(plan.heroRadius * (selected.length === 0 ? 0.42 : 0.34), 28, 108),
        weight: selected.length === 0 ? 0.86 : 0.74,
        layer: "support",
        angle: Math.atan2(targetY - heroCenterY, targetX - heroCenterX),
      };
      if (supportSlotTooClose(slot, [...plan.supportSlots, ...selected], plan.heroRadius * 0.92)) {
        continue;
      }
      const emptinessScore = 1 - sideWeight(spec.side);
      const oppositeBrightBoost =
        (brightestSide === "left" && spec.side === "right") ||
        (brightestSide === "right" && spec.side === "left") ||
        (brightestSide === "top" && spec.side === "bottom") ||
        (brightestSide === "bottom" && spec.side === "top")
          ? 0.12
          : 0;
      const centerEscapeBoost =
        Math.abs(targetX - edgeMap.width * 0.5) / Math.max(1, edgeMap.width * 0.5) * 0.08 +
        Math.abs(targetY - edgeMap.height * 0.5) / Math.max(1, edgeMap.height * 0.5) * 0.06;
      const score = emptinessScore + oppositeBrightBoost + centerEscapeBoost;
      selected.push({
        ...slot,
        weight: clamp(slot.weight + score * 0.08, 0.68, 0.92),
      });
    }
    return selected;
  }

  private rebalanceCompositionPlan(
    basePlan: CompositionPlan,
    edgeMap: EdgeMap,
    audioTransitionScore: number,
    heldRatio: number,
  ): {
    plan: CompositionPlan;
    recoveryMode: RecoveryMode;
    fallbackRenderMode: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery";
    fallbackReason: import("../types").FallbackReason;
    fallbackTriggerCount: number;
    fallbackSeverity: "none" | "light" | "full";
    compositionModeReason: import("../types").CompositionModeReason;
  } {
    const baseRisk = buildCompositionRiskProfile(basePlan, edgeMap, heldRatio);
    const compositionModeReason =
      baseRisk.edgeDominanceRisk
        ? "edge-dominance-recovery"
        : baseRisk.deadCenterRisk || baseRisk.centeredLowSupport
          ? "dead-center-avoidance"
          : edgeMap.maskConfidence === "low" || baseRisk.lowFocal
            ? "low-confidence-mask-recovery"
            : "normal";
    const needsRecovery =
      baseRisk.riskScore >= 0.55 ||
      baseRisk.lowSupport ||
      baseRisk.lowFocal ||
      baseRisk.centeredLowSupport ||
      baseRisk.heldSparse ||
      baseRisk.deadCenterRisk ||
      baseRisk.edgeDominanceRisk ||
      edgeMap.maskConfidence === "low";
    if (!needsRecovery) {
      return {
        plan: basePlan,
        recoveryMode: "none",
        fallbackRenderMode: "none",
        fallbackReason: "none",
        fallbackTriggerCount: 0,
        fallbackSeverity: "none",
        compositionModeReason,
      };
    }
    const supportSlots = [...basePlan.supportSlots];
    const recoveryCandidates = this.buildRecoverySupportClusters(basePlan, edgeMap, 3);
    const desiredRecoveryAdds =
      baseRisk.supportNearHeroScore < 0.2 || basePlan.supportSlots.length < 2
        ? 3
        : baseRisk.lowFocal || baseRisk.deadCenterRisk
          ? 2
          : 1;
    for (const candidate of recoveryCandidates) {
      if (supportSlots.length >= basePlan.supportSlots.length + desiredRecoveryAdds) {
        break;
      }
      supportSlots.unshift(candidate);
      const provisionalPlan = {
        ...basePlan,
        supportSlots,
      };
      if (
        computeSupportNearHeroScore(provisionalPlan) >= 0.48 &&
        supportSlots.length >= basePlan.supportSlots.length + 1
      ) {
        break;
      }
    }
    const trimmedBackground = basePlan.backgroundSlots
      .filter((slot) => Math.hypot(slot.x - basePlan.heroCenterX, slot.y - basePlan.heroCenterY) < basePlan.heroRadius * 3.7)
      .slice(0, 2);
    const fallbackBackground = supportSlots.slice(0, 2).map((slot) => ({
      x: clamp((slot.x + basePlan.heroCenterX) * 0.5, edgeMap.width * 0.14, edgeMap.width * 0.86),
      y: clamp((slot.y + basePlan.heroCenterY) * 0.5, edgeMap.height * 0.14, edgeMap.height * 0.86),
      radius: clamp(slot.radius * 0.68, 22, 68),
      weight: clamp(slot.weight * 0.72, 0.32, 0.66),
      layer: "background" as const,
      angle: slot.angle,
    }));
    const backgroundSlots =
      trimmedBackground.length > 0
        ? trimmedBackground
        : fallbackBackground.length > 0
          ? fallbackBackground
          : basePlan.backgroundSlots.slice(0, 2);
    const plan: CompositionPlan = {
      ...basePlan,
      supportSlots: supportSlots.slice(0, Math.max(3, Math.min(supportSlots.length, 5))),
      backgroundSlots,
      dustSlots: backgroundSlots.map((slot) => ({
        x: slot.x,
        y: slot.y,
        radius: slot.radius * 0.52,
        weight: slot.weight * 0.86,
      })),
      bridgeAnchors: supportSlots.slice(0, 4).map((slot) => ({ x: slot.x, y: slot.y, weight: slot.weight })),
      focalOccupancyScore: clamp(basePlan.focalOccupancyScore + 0.08 + Math.min(0.1, audioTransitionScore * 0.05) + Math.min(0.06, recoveryCandidates.length * 0.02), 0, 1),
      centerBiasScore: clamp(basePlan.centerBiasScore - 0.1 - Math.min(0.06, recoveryCandidates.length * 0.02), 0, 1),
    };
    const recoveredRisk = buildCompositionRiskProfile(plan, edgeMap, heldRatio);
    const recoveredRiskCount = [
      recoveredRisk.lowSupport,
      recoveredRisk.lowFocal,
      recoveredRisk.heldSparse,
      recoveredRisk.deadCenterRisk,
      recoveredRisk.edgeDominanceRisk,
    ].filter(Boolean).length;
    const baseTriggerCount = [
      baseRisk.lowSupport,
      baseRisk.lowFocal,
      baseRisk.centeredLowSupport,
      baseRisk.heldSparse,
      baseRisk.deadCenterRisk,
      baseRisk.edgeDominanceRisk,
      edgeMap.maskConfidence === "low",
    ].filter(Boolean).length;
    const baseSevereFallback =
      (baseRisk.severeFocal && baseRisk.severeSupport) ||
      (baseRisk.severeDeadCenter && baseRisk.lowSupport) ||
      (baseRisk.severeEdge && baseRisk.lowSupport && basePlan.focalOccupancyScore < 0.14) ||
      (basePlan.focalOccupancyScore < 0.14 && baseRisk.supportNearHeroScore < 0.28 && baseRisk.deadCenterRisk);
    const recoveredEdgeAdjustmentOnly =
      compositionModeReason === "edge-dominance-recovery" &&
      plan.focalOccupancyScore >= 0.34 &&
      plan.centerBiasScore <= 0.35 &&
      recoveredRisk.supportNearHeroScore >= 0.34 &&
      !recoveredRisk.lowFocal &&
      !recoveredRisk.heldSparse;
    const severeFallback =
      baseSevereFallback ||
      (recoveredRisk.severeSupport && (recoveredRisk.severeFocal || recoveredRisk.severeDeadCenter)) ||
      (recoveredRisk.severeDeadCenter && recoveredRisk.lowFocal && recoveredRisk.supportNearHeroScore < 0.26);
    const lightAdjustmentOnly =
      recoveredEdgeAdjustmentOnly ||
      recoveredRiskCount <= 1 &&
      recoveredRisk.riskScore < 1.2 &&
      !recoveredRisk.lowFocal &&
      !recoveredRisk.heldSparse &&
      recoveredRisk.supportNearHeroScore >= 0.42;
    const recoveryMode =
      severeFallback
        ? "fallback-composed"
        : lightAdjustmentOnly
          ? "none"
          : "safety-recovery";
    const fallbackRenderMode = recoveryMode;
    const fallbackReason =
      recoveryMode === "none"
        ? "none"
        : this.chooseFallbackReason(recoveredRisk, edgeMap);
    const recoveredTriggerCount = [
      recoveredRisk.lowSupport,
      recoveredRisk.lowFocal,
      recoveredRisk.centeredLowSupport,
      recoveredRisk.heldSparse,
      recoveredRisk.deadCenterRisk,
      recoveredRisk.edgeDominanceRisk,
      edgeMap.maskConfidence === "low",
    ].filter(Boolean).length;
    return {
      plan,
      recoveryMode,
      fallbackRenderMode,
      fallbackReason,
      fallbackTriggerCount: recoveryMode === "none" ? 0 : Math.max(baseTriggerCount, recoveredTriggerCount),
      fallbackSeverity:
        recoveryMode === "fallback-composed" ? "full" :
        recoveryMode === "safety-recovery" ? "light" :
        "none",
      compositionModeReason,
    };
  }

  private getSceneGraph(
    edgeMap: EdgeMap,
    theme: RenderTheme,
    compositionPlan: CompositionPlan,
    segmentIndex: number,
    heroMotifSlot: HeroMotifScheduleSlot = resolveHeroMotifScheduleSlot(this.heroMotifSchedule, segmentIndex * this.schedule.secondsPerImage),
  ): SceneGraph {
    const cacheKey = sceneGraphCacheKey(edgeMap.imagePath, segmentIndex, heroMotifSlot);
    const cached = this.sceneGraphCache.get(cacheKey);
    if (cached) {
      this.sceneGraphCache.set(edgeMap.imagePath, cached);
      return cached;
    }
    const sceneGraph = buildSceneGraph(edgeMap, theme, compositionPlan, {
      scheduledHeroMotif: heroMotifSlot.motif,
      heroMotifSlotIndex: heroMotifSlot.slotIndex,
      heroMotifSlotStartSec: heroMotifSlot.startSec,
      heroMotifSlotEndSec: heroMotifSlot.endSec,
      heroMotifScheduleReason: heroMotifSlot.reason,
      heroMotifLockEnabled: true,
    });
    this.sceneGraphCache.set(cacheKey, sceneGraph);
    this.sceneGraphCache.set(edgeMap.imagePath, sceneGraph);
    return sceneGraph;
  }

  private getEffectiveSceneGraph(
    edgeMap: EdgeMap,
    theme: RenderTheme,
    compositionPlan: CompositionPlan,
    segmentIndex: number,
    resetFeedback: boolean,
    heroMotifSlot: HeroMotifScheduleSlot,
  ): SceneGraph {
    if (resetFeedback && this.lastImagePath) {
      const mutated = this.getTransitionSceneGraph(this.lastImagePath, edgeMap, theme, compositionPlan, heroMotifSlot);
      this.activeTransitionSceneGraphCache.set(sceneGraphCacheKey(edgeMap.imagePath, segmentIndex, heroMotifSlot), mutated);
      this.activeTransitionSceneGraphCache.set(edgeMap.imagePath, mutated);
      return mutated;
    }
    return this.activeTransitionSceneGraphCache.get(sceneGraphCacheKey(edgeMap.imagePath, segmentIndex, heroMotifSlot))
      ?? this.activeTransitionSceneGraphCache.get(edgeMap.imagePath)
      ?? this.getSceneGraph(edgeMap, theme, compositionPlan, segmentIndex, heroMotifSlot);
  }

  private getTransitionSceneGraph(
    previousImagePath: string,
    edgeMap: EdgeMap,
    theme: RenderTheme,
    compositionPlan: CompositionPlan,
    heroMotifSlot: HeroMotifScheduleSlot,
  ): SceneGraph {
    const key = `${transitionGraphKey(previousImagePath, edgeMap.imagePath)}::${heroMotifSlot.slotIndex}::${heroMotifSlot.motif}`;
    const cached = this.transitionSceneGraphCache.get(key);
    if (cached) {
      return cached;
    }
    const current = this.getSceneGraph(edgeMap, theme, compositionPlan, Math.max(0, this.lastRenderSelection.segmentIndex), heroMotifSlot);
    const previous = this.sceneGraphCache.get(previousImagePath);
    if (!previous) {
      return current;
    }
    const mutated = mutateSceneGraphForTransition(previous, current, edgeMap, theme, "swap", this.lastTransitionIdentitySignature);
    this.transitionSceneGraphCache.set(key, mutated);
    return mutated;
  }

  private getAtmosphereGraph(
    edgeMap: EdgeMap,
    theme: RenderTheme,
    compositionPlan: CompositionPlan,
    sceneGraph: SceneGraph,
  ): AtmosphereGraph {
    const transitionKey = `${edgeMap.imagePath}::${sceneGraph.heroInstanceSeed.variantKey}`;
    const transitionCached = this.atmosphereGraphCache.get(transitionKey);
    if (transitionCached) {
      return transitionCached;
    }
    const cached = this.atmosphereGraphCache.get(edgeMap.imagePath);
    if (cached) {
      return cached;
    }
    const atmosphereGraph = buildAtmosphereGraph(edgeMap, compositionPlan, sceneGraph, theme);
    if (this.activeTransitionSceneGraphCache.get(edgeMap.imagePath)?.heroInstanceSeed.variantKey === sceneGraph.heroInstanceSeed.variantKey) {
      this.atmosphereGraphCache.set(transitionKey, atmosphereGraph);
    }
    this.atmosphereGraphCache.set(edgeMap.imagePath, atmosphereGraph);
    return atmosphereGraph;
  }

  private withPhrasePulse(frame: AudioFrameFeature): AudioFrameFeature {
    return enrichFrameWithMusicGrid(frame, this.bpm, this.beatOriginSec);
  }

  private getTransitionGraph(fromImagePath: string, toImagePath: string): TransitionGraph | undefined {
    const baseKey = transitionGraphKey(fromImagePath, toImagePath);
    const keyed = `${baseKey}::${this.lastTransitionBudgetTier}::${this.fastMode ? "fast" : "full"}`;
    return this.transitionGraphCache.get(keyed) ?? this.transitionGraphCache.get(baseKey);
  }

  private setTransitionGraph(graph: TransitionGraph): void {
    this.transitionGraphCache.set(graph.key, graph);
    this.transitionGraphCache.set(
      `${graph.key}::${this.lastTransitionBudgetTier}::${this.fastMode ? "fast" : "full"}`,
      graph,
    );
  }

  private chooseTransition(
    visualState: VisualState,
    edgeMap: EdgeMap,
    theme: RenderTheme,
    safety: VisualSafetyMetrics,
    activeSubject: ActiveSubjectSnapshot,
    persistentMotif?: PersistentMotifState,
    eventState?: EventState,
  ): TransitionFamily {
    return chooseTransitionFamily({ visualState, edgeMap, theme, safety, activeSubject, persistentMotif, eventState });
  }

  private applyTransitionBudget(
    family: TransitionFamily,
    proposedDurationFrames: number,
    visualState: VisualState,
    edgeMap: EdgeMap,
    activeSubject: ActiveSubjectSnapshot,
    audioTransitionScore = 0,
  ): {
    family: TransitionFamily;
    proposedDurationFrames: number;
    durationFrames: number;
    tier: RenderQualityBudget["transitionBudgetTier"];
    reason: string;
    risk: number;
  } {
    const baseRisk =
      family === "wipe" ? 1.15 :
      family === "melt-safe" ? 1.2 :
      family === "fragment" ? 1.1 :
      family === "shear-kaleido" ? 1.15 :
      PHYSICAL_CAMERA_TRANSITION_FAMILIES.includes(family) ? 1.18 :
      family === "strobe-bloom" || family === "trip-kaleido" || family === "fractal-tunnel" ? 1.36 :
      PSYCHEDELIC_TRANSITION_FAMILIES.includes(family) ? 1.26 :
      1;
    const risk =
      baseRisk +
      Math.max(0, (proposedDurationFrames - 12) / 20) * 0.35 +
      Math.max(0, edgeMap.complexity - 0.6) * 0.4 +
      (visualState.overlayMode === "sparse-contour" ? 0.24 : 0) +
      Math.max(0, activeSubject.motionPx - 7) * 0.03 +
      (this.fastMode ? 0.12 : 0);
    if (family === "wipe" && visualState.overlayMode === "sparse-contour") {
      const durationFrames = Math.min(proposedDurationFrames, this.fastMode ? 12 : 16);
      return {
        family: this.fastMode || edgeMap.complexity < 0.58 ? "carry" : family,
        proposedDurationFrames,
        durationFrames,
        tier: durationFrames <= 12 ? "fallback" : "minimal",
        reason: "wipe+sparse-contour cap",
        risk,
      };
    }
    if (this.fastMode && risk >= 1.4) {
      return { family: family === "melt-safe" ? "carry" : "fragment", proposedDurationFrames, durationFrames: Math.min(proposedDurationFrames, 8), tier: "fallback", reason: "fast hard cap", risk };
    }
    if ((!this.fastMode && risk >= 1.5) || (this.fastMode && risk >= 1.2)) {
      const cap =
        PHYSICAL_CAMERA_TRANSITION_FAMILIES.includes(family)
          ? Math.round(((this.fastMode ? 12 : 16) + (audioTransitionScore >= 1.6 ? 2 : 0)) * 1.2)
          : PSYCHEDELIC_TRANSITION_FAMILIES.includes(family)
            ? Math.round(((this.fastMode ? 9 : 11) + (audioTransitionScore >= 1.8 ? 2 : 0)) * 1.2)
            : Math.round((this.fastMode ? 10 : 12) * 1.2);
      const promotedTier = audioTransitionScore >= 1.65 && edgeMap.complexity < 0.72 ? "trimmed" : "minimal";
      return { family, proposedDurationFrames, durationFrames: Math.min(proposedDurationFrames, cap), tier: promotedTier, reason: audioTransitionScore >= 1.65 && edgeMap.complexity < 0.72 ? "audio-promoted risk cap" : "high risk duration cap", risk };
    }
    if ((!this.fastMode && risk >= 1.25) || (this.fastMode && risk >= 1.0)) {
      const cap =
        PHYSICAL_CAMERA_TRANSITION_FAMILIES.includes(family)
          ? Math.round((this.fastMode ? 18 : 22) * 1.2)
          : PSYCHEDELIC_TRANSITION_FAMILIES.includes(family)
            ? Math.round((this.fastMode ? 14 : 16) * 1.2)
            : Math.round((this.fastMode ? 16 : 18) * 1.2);
      return { family, proposedDurationFrames, durationFrames: Math.min(proposedDurationFrames, cap), tier: "trimmed", reason: "risk-trimmed transition", risk };
    }
    return { family, proposedDurationFrames, durationFrames: proposedDurationFrames, tier: "full", reason: "within budget", risk };
  }

  private transitionModeForFamily(family: TransitionFamily, edgeMap: EdgeMap, theme: RenderTheme): number {
    const pairSeed = this.lastImagePath ? hashTransitionPairSeed(this.lastImagePath, edgeMap.imagePath) : 0;
    return transitionModeForFamilyChoice(family, edgeMap, theme, pairSeed);
  }

  private shouldUseMorphTransition(
    bridge: TransitionBridgeState | undefined,
    edgeMap: EdgeMap,
    theme: RenderTheme,
  ): boolean {
    if (!bridge || edgeMap.maskConfidence === "low") {
      return false;
    }
    const pairSeed = hashTransitionPairSeed(bridge.fromImagePath, bridge.toImagePath);
    const hashedGate = pairSeed % 100;
    const heroDistance = Math.hypot(bridge.heroTo.x - bridge.heroFrom.x, bridge.heroTo.y - bridge.heroFrom.y) / Math.max(1, this.settings.width);
    const supportSimilarity = 1 - Math.min(1, Math.abs(bridge.supportFrom.length - bridge.supportTo.length) / 4);
    const compositionSimilarity = clamp((1 - heroDistance) * 0.55 + supportSimilarity * 0.45 + theme.imageContrast * 0.1, 0, 1);
    return compositionSimilarity >= 0.62 ? hashedGate < 70 : hashedGate < 42;
  }

  private transitionDurationFrames(
    visualState: VisualState,
    edgeMap: EdgeMap,
    activeSubject: ActiveSubjectSnapshot,
    dbTransitionDrive: number,
    hzTransitionDrive: number,
  ): number {
    const base =
      visualState.regime === "drop" ? 0.4 :
      visualState.regime === "build" ? 0.5 :
      visualState.regime === "groove" ? 0.6 :
      visualState.regime === "breakdown" ? 0.66 :
      0.72;
    const confidencePenalty = edgeMap.maskConfidence === "low" ? 0.06 : 0;
    const motionAdjustment = activeSubject.motionPx > 8 ? -0.06 : 0;
    const quietingExtensionFrames = Math.round(
      this.settings.fps * (Math.max(0, -dbTransitionDrive) * 0.12 + Math.max(0, -hzTransitionDrive) * 0.06),
    );
    return Math.max(
      12,
      Math.round(this.settings.fps * ((base + confidencePenalty + motionAdjustment) * visualState.transitionDurationMultiplier)) + quietingExtensionFrames,
    );
  }

  private buildVignette(): void {
    const vignette = this.vignetteCtx.createRadialGradient(
      this.settings.width * 0.52,
      this.settings.height * 0.48,
      this.settings.width * 0.18,
      this.settings.width * 0.52,
      this.settings.height * 0.48,
      this.settings.width * 0.82,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.65, "rgba(12, 8, 28, 0.10)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.48)");
    this.vignetteCtx.fillStyle = vignette;
    this.vignetteCtx.fillRect(0, 0, this.settings.width, this.settings.height);
  }

  private getDustPositions(imagePath: string): Array<{ x: number; y: number; radius: number }> {
    const cached = this.dustPositionsByImage.get(imagePath);
    if (cached) {
      return cached;
    }
    const imageSeed = stableImageSeed(imagePath, 19);
    const mottles = this.settings.fps >= 50 ? 18 : 24;
    const positions = Array.from({ length: mottles }, (_, index) => ({
      x: ((sampleNoise2D(index * 0.43, imageSeed * 0.00012, imageSeed + 19) + 1) * 0.5) * this.settings.width,
      y: ((sampleNoise2D(index * 0.31, imageSeed * 0.00008, imageSeed + 47) + 1) * 0.5) * this.settings.height,
      radius: 16 + (index % 4) * 14,
    }));
    this.dustPositionsByImage.set(imagePath, positions);
    return positions;
  }

  private drawBackground(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    edgeMap: EdgeMap,
    compositionPlan: CompositionPlan,
    sceneGraph: SceneGraph,
    opacity: number,
  ): void {
    const [inner, outer] = backgroundGradient(frame, theme);
    const bandMix =
      frame.dominantBand === "low" ? 0.15 + frame.normalizedLow * 0.45 :
      frame.dominantBand === "lowMid" ? 0.24 + frame.normalizedLowMid * 0.42 :
      frame.dominantBand === "mid" ? 0.3 + frame.normalizedMid * 0.44 :
      0.36 + frame.normalizedHigh * 0.5;
    const motionDrift = sceneGraph.backgroundPlan.motionParams?.driftScale ?? sceneGraph.backgroundPlan.driftScale;
    const drift = clamp(frame.normalizedLow * 0.7 + frame.normalizedMid * 0.2 + frame.beatPulse * 0.1, 0, 1) * motionDrift;
    const startX = sceneGraph.backgroundPlan.startX + Math.sin(frame.timeSec * 0.35) * this.settings.width * drift;
    const startY = sceneGraph.backgroundPlan.startY + Math.cos(frame.timeSec * 0.22) * this.settings.height * drift * 0.8;
    const endX = sceneGraph.backgroundPlan.endX + Math.cos(frame.timeSec * 0.28) * this.settings.width * drift * 0.7;
    const endY = sceneGraph.backgroundPlan.endY + Math.sin(frame.timeSec * 0.31) * this.settings.height * drift * 0.9;
    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = theme.nebula.voidColor;
    this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    const linear = this.ctx.createLinearGradient(startX, startY, endX, endY);
    this.lastStageMetrics.gradientCreateCount += 1;
    for (const stop of sceneGraph.backgroundPlan.colorStops) {
      const alpha = clamp(stop.alpha + (stop.offset > 0.2 && stop.offset < 0.9 ? bandMix * 0.06 : 0), 0, 1);
      linear.addColorStop(stop.offset, `rgba(${stop.r}, ${stop.g}, ${stop.b}, ${alpha.toFixed(3)})`);
    }
    this.ctx.fillStyle = linear;
    this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);

    const gradient = this.ctx.createRadialGradient(
      this.settings.width * 0.5,
      this.settings.height * 0.56,
      this.settings.width * 0.06,
      this.settings.width * 0.5,
      this.settings.height * 0.56,
      this.settings.width * 0.78,
    );
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    this.lastStageMetrics.gradientCreateCount += 1;
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    if (sceneGraph.backgroundPlan.secondaryWash) {
      const wash = sceneGraph.backgroundPlan.secondaryWash;
      const washGradient = this.ctx.createRadialGradient(wash.x, wash.y, 0, wash.x, wash.y, wash.radius);
      this.lastStageMetrics.gradientCreateCount += 1;
      washGradient.addColorStop(0, paletteColor(theme, frame.rainbowHueOffset * 0.002, wash.alpha + bandMix * 0.04, -10));
      washGradient.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.fillStyle = washGradient;
      this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    }
    this.renderBackgroundElements(frame, theme, sceneGraph.backgroundPlan, edgeMap, sceneGraph);
    this.ctx.restore();

    this.ctx.drawImage(this.vignetteCanvas as any, 0, 0, this.settings.width, this.settings.height);

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const dustPositions = compositionPlan.dustSlots.length > 0
      ? compositionPlan.dustSlots
      : this.getDustPositions(theme.styleProfile.imagePath);
    const dustEnergy = frame.normalizedMid * 0.6 + frame.normalizedHigh * 0.4;
    const dustStride = dustEnergy < 0.28 ? 3 : dustEnergy < 0.52 ? 2 : 1;
    for (let index = 0; index < dustPositions.length; index += dustStride) {
      const dustPosition = dustPositions[index]!;
      const suppressDust = compositionPlan.protectedZones.some((zone) =>
        dustPosition.x >= zone.x &&
        dustPosition.x <= zone.x + zone.width &&
        dustPosition.y >= zone.y &&
        dustPosition.y <= zone.y + zone.height,
      );
      if (suppressDust) {
        continue;
      }
      const x = dustPosition.x + sampleNoise2D(index * 0.13, frame.timeSec * 0.12, 71) * 10;
      const y = dustPosition.y + sampleNoise2D(index * 0.19, frame.timeSec * 0.08, 89) * 8;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(dustPosition.radius)) {
        continue;
      }
      const safeDustRadius = safeRadius(dustPosition.radius * (frame.normalizedLow < 0.25 ? 0.72 : 0.86), 1);
      const dustColor = paletteColor(theme, index / Math.max(1, dustPositions.length), 0.012 + ((dustPosition as any).weight ?? 0.2) * 0.008, -8);
      const stamp = this.stampAtlas.getStamp({
        shape: index % 4 === 0 ? "arc" : "dot",
        sizeBucket: Math.max(2, Math.min(8, Math.round(safeDustRadius / 6))),
        colorBucket: index % 8,
        layer: "background",
        purpose: "ambient-fog",
        variant: "dust",
        intent: sceneGraph.intentSeed.intent,
      }, dustColor);
      this.ctx.globalAlpha = 0.16 + frame.normalizedHigh * 0.05 + frame.normalizedMid * 0.03;
      this.ctx.drawImage(stamp as any, x - stamp.width * 0.5, y - stamp.height * 0.5, stamp.width, stamp.height);
    }
    this.ctx.restore();
  }

  private renderBackgroundElements(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    plan: BackgroundPlan,
    edgeMap: EdgeMap,
    sceneGraph: SceneGraph,
  ): void {
    if (!plan.backgroundElementFamily || !plan.geometryParams || !plan.motionParams || !plan.pulseProfile) {
      return;
    }
    const active = this.lastActiveSubjectSnapshot;
    const family = plan.backgroundElementFamily;
    const count = backgroundInstanceCount(plan, this.settings.fps, family);
    const drives = computeBackgroundReactiveDrives(frame, plan);
    const pulse =
      1 +
      drives.bpmDrive * plan.pulseProfile.beatPulseStrength * 0.18 +
      drives.midTransitionDrive * plan.pulseProfile.barPulseStrength * 0.08 +
      Math.sin(frame.timeSec * plan.motionParams.phaseRate) * plan.pulseProfile.betweenBeatBreathing * 0.08;
    const jitter = plan.motionParams.jitterScale * (0.34 + drives.minorImpactDrive * 0.8 + frame.normalizedHigh * 0.4 + frame.normalizedHighMid * 0.3);
    const accentAlpha = clamp(0.06 + (plan.layeringParams?.glowAlpha ?? 0.1), 0.06, 0.24);
    const heroX = active.x || this.settings.width * 0.5;
    const heroY = active.y || this.settings.height * 0.5;
    const heroSpeed = active.motionPx || 0;
    const heroHeading = frame.timeSec * 0.6 + this.lastHeroSpinVelocity * 0.02;
    let backgroundLuminosityLiftSum = 0;
    let backgroundColorfulnessScaleSum = 0;
    let backgroundAccentSampleCount = 0;
    const applyAccentStyle = (alpha: number, luminanceShift: number, mode: "stroke" | "fill" | "both" = "both"): BackgroundAccentStyle => {
      const style = computeBackgroundAccentStyle(theme, frame, plan, alpha, luminanceShift);
      if (mode === "stroke" || mode === "both") {
        this.ctx.strokeStyle = style.color;
      }
      if (mode === "fill" || mode === "both") {
        this.ctx.fillStyle = style.color;
      }
      backgroundLuminosityLiftSum += style.luminosityLift;
      backgroundColorfulnessScaleSum += style.colorfulnessScale;
      backgroundAccentSampleCount += 1;
      return style;
    };
    const interaction: BackgroundInteractionState = {
      heroX,
      heroY,
      heroSpeed,
      heroHeading,
      heroRadius: this.lastHeroCoreSize > 0 ? this.lastHeroCoreSize : Math.max(28, sceneGraph.heroOrbitRadius),
      heroParticleDensity: clamp(this.lastHeroTrailOccupancy * 0.8 + this.lastHeroBurstChildren / 160, 0, 1),
      beatTrigger: frame.beatPhase < 0.08 || frame.beatPulse > 0.84,
      barTrigger: Boolean(frame.isBarDownbeat || (frame.barPulse ?? 0) > 0.84),
      fourBarTrigger: Boolean(frame.isFourBarDownbeat),
      countdownTrigger: Boolean(frame.isFourBarDownbeat || ((frame.beatIndex ?? 0) % 8 === 7 && frame.beatPhase < 0.12)),
      silhouetteActive: plan.imageResponseMode !== "silhouette" || edgeMap.maskConfidence !== "low",
      collisionEnergy: clamp((heroSpeed / 18) * (plan.heroCouplingStrength ?? 0) + (plan.particleCouplingStrength ?? 0) * 0.4, 0, 1.4),
    };
    const heroInteractionActive =
      (plan.heroCouplingStrength ?? 0) > 0.1 &&
      (interaction.beatTrigger || interaction.barTrigger || heroSpeed > 2 || interaction.heroParticleDensity > 0.2);
    const backgroundTriggeredThisFrame =
      plan.triggerMode === "beat" ? interaction.beatTrigger :
      plan.triggerMode === "bar" ? interaction.barTrigger :
      plan.triggerMode === "four-bar" ? interaction.fourBarTrigger :
      plan.triggerMode === "countdown" ? interaction.countdownTrigger :
      plan.triggerMode === "interval" ? Math.floor(frame.timeSec * plan.motionParams.phaseRate) % 2 === 0 :
      plan.triggerMode === "crescendo" ? (frame.phrasePulse ?? 0) > 0.72 || frame.peakStrength > 0.64 :
      plan.triggerMode === "collision" ? interaction.collisionEnergy > 0.38 :
      interaction.silhouetteActive && frame.normalizedHighMid > 0.42;
    this.lastBackgroundTriggeredThisFrame = backgroundTriggeredThisFrame;
    this.lastBackgroundHeroInteractionActive = heroInteractionActive;
    this.lastBackgroundTriggeredFrameRatio = backgroundTriggeredThisFrame ? 1 : 0;
    this.lastBackgroundPeakColorEligible = plan.colorTuning?.peakColorEligible ?? false;
    this.lastBackgroundPeakColorDrive = drives.peakColorDrive;
    this.lastBackgroundMinorImpactDrive = drives.minorImpactDrive;
    this.ctx.save();
    this.ctx.globalCompositeOperation = plan.layeringParams?.blendMode ?? "screen";
    applyAccentStyle(accentAlpha, 8, "stroke");
    applyAccentStyle(accentAlpha * 0.88, -4, "fill");
    this.ctx.lineWidth = Math.max(1, plan.geometryParams.thickness * Math.min(this.settings.width, this.settings.height) * (1 + drives.midTransitionDrive * 0.18));

    switch (family) {
      case "line-field":
        for (let index = 0; index < count; index += 1) {
          const phase = frame.timeSec * plan.motionParams.phaseRate * (0.4 + drives.bpmDrive * 0.08) + index * 0.12;
          const beatLockedPhase = frame.barPhase * Math.PI * 2 + phase;
          const lineTrack =
            plan.familyVariant === "metronomic-pendulums"
              ? heroX + Math.cos(beatLockedPhase + heroHeading) * this.settings.width * (0.14 + drives.bpmDrive * 0.025)
              : (index + 0.5) / count * this.settings.width;
          const cx = lineTrack;
          const cy =
            plan.familyVariant === "emulsion-slashes"
              ? heroY + Math.sin(beatLockedPhase) * this.settings.height * (0.08 + drives.midTransitionDrive * 0.02)
              : this.settings.height * (0.22 + ((index % 5) / 6) * 0.56) + ((index % 2 === 0 ? -1 : 1) * drives.minorImpactDrive * this.settings.height * 0.012);
          const length = this.settings.width * (0.1 + plan.geometryParams.depth * 0.18);
          const baseAngle =
            plan.familyVariant === "emulsion-slashes"
              ? Math.PI * 0.22
              : plan.familyVariant === "metronomic-pendulums"
                ? Math.PI * 0.48
                : Math.PI * 0.08;
          const swayAngle =
            Math.sin(beatLockedPhase) *
            (0.08 + plan.motionParams.rotationScale * 0.12) *
            pulse *
            (plan.familyVariant === "metronomic-pendulums" ? 1.05 : 0.72) *
            (1 + drives.bpmDrive * 0.14);
          const lineAngle = baseAngle + swayAngle;
          const halfLengthX = Math.cos(lineAngle) * length * 0.5;
          const halfLengthY = Math.sin(lineAngle) * length * 0.5;
          const lineJitter = jitter * (4 + drives.midTransitionDrive * 4);
          const centerOffsetX =
            Math.sin(beatLockedPhase + index * 0.15) *
            this.settings.width *
            plan.motionParams.driftScale *
            0.012;
          const centerOffsetY =
            Math.cos(beatLockedPhase * 0.9 + index * 0.12) *
            this.settings.height *
            plan.motionParams.driftScale *
            0.018;
          const lineAlpha = clamp(accentAlpha + drives.midTransitionDrive * 0.04 + (index % 3 === 0 ? plan.pulseProfile.flickerAmount * 0.03 : 0), 0.05, 0.24);
          applyAccentStyle(lineAlpha, 8 + drives.minorImpactDrive * 2, "stroke");
          this.ctx.beginPath();
          this.ctx.moveTo(cx + centerOffsetX - halfLengthX, cy + centerOffsetY - halfLengthY - lineJitter);
          this.ctx.lineTo(cx + centerOffsetX + halfLengthX, cy + centerOffsetY + halfLengthY + lineJitter);
          this.ctx.stroke();
          if (index % 3 === 0) {
            this.lastStageMetrics.vectorDrawCount += 1;
          }
        }
        break;
      case "grid-field":
      case "stripe-field":
        for (let index = 0; index < count; index += 1) {
          const x = (index / count) * this.settings.width;
          const width = Math.max(4, this.settings.width * plan.geometryParams.spacing * (family === "stripe-field" ? 0.3 : 0.18) * (1 + drives.midTransitionDrive * 0.18));
          const height = family === "stripe-field"
            ? this.settings.height
            : this.settings.height * (0.12 + ((index % 4) + 1) * 0.08) * pulse * (1 + drives.bpmDrive * 0.22) * (plan.familyVariant === "floor-tiles" ? 1.2 : 1);
          const y = family === "stripe-field"
            ? 0
            : plan.familyVariant === "silhouette-rectangles" && interaction.silhouetteActive
              ? clamp(heroY - height * 0.5 + (index % 5 - 2) * 34, 0, Math.max(0, this.settings.height - height))
              : ((index * 31 + frame.frameIndex * (3 + Math.round(drives.bpmDrive * 2))) % Math.max(1, Math.round(this.settings.height - height)));
          const alpha = clamp(accentAlpha + drives.midTransitionDrive * 0.05 + (index % 5 === 0 ? plan.pulseProfile.flickerAmount * 0.08 : 0), 0.05, 0.22);
          applyAccentStyle(alpha, -4 + drives.minorImpactDrive * 3, "fill");
          this.ctx.globalAlpha = alpha;
          if (plan.familyVariant === "chevron-masks") {
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + height * 0.5);
            this.ctx.lineTo(x + width, y);
            this.ctx.lineTo(x + width, y + height);
            this.ctx.closePath();
            this.ctx.fill();
          } else {
            this.ctx.fillRect(x, y, width, height);
          }
          this.lastStageMetrics.backgroundStampDrawCount += 1;
        }
        break;
      case "plane-field":
      case "void-shape":
        for (let index = 0; index < count; index += 1) {
          const width = this.settings.width * (0.14 + plan.geometryParams.depth * 0.22) * (1 + drives.bpmDrive * 0.12 + drives.midTransitionDrive * 0.08);
          const height = this.settings.height * (0.08 + plan.geometryParams.scaleVariance * 0.12) * (1 + drives.bpmDrive * 0.08 + drives.midTransitionDrive * 0.06);
          const cx = plan.familyVariant === "prismatic-frames" || plan.familyVariant === "echo-boxes"
            ? heroX + ((index % 3) - 1) * (48 + drives.midTransitionDrive * 8)
            : this.settings.width * (0.18 + (index % 4) * 0.2);
          const cy = plan.familyVariant === "void-spheres"
            ? heroY + Math.sin(frame.timeSec + index) * (24 + drives.bpmDrive * 8)
            : this.settings.height * (0.24 + Math.floor(index / 4) * 0.22);
          const rotation = Math.sin(frame.timeSec * plan.motionParams.phaseRate * (1 + drives.bpmDrive * 0.16) + index) * plan.motionParams.rotationScale * (1 + drives.midTransitionDrive * 0.35);
          const alpha = clamp((family === "void-shape" ? 0.18 : 0.12 + (backgroundTriggeredThisFrame ? 0.04 : 0)) + drives.midTransitionDrive * 0.03, 0.06, 0.24);
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(rotation);
          if (family === "void-shape") {
            applyAccentStyle(alpha, -2 + drives.bpmDrive * 4, "fill");
          } else {
            applyAccentStyle(alpha, 8 + drives.minorImpactDrive * 2, "stroke");
          }
          this.ctx.globalAlpha = alpha;
          if (family === "void-shape") {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, Math.min(width, height) * 0.5 * pulse * (1 + drives.midTransitionDrive * 0.14), 0, Math.PI * 2);
            this.ctx.fill();
          } else {
            this.ctx.strokeRect(-width * 0.5 * pulse, -height * 0.5, width * pulse, height);
          }
          this.ctx.restore();
        }
        break;
      case "primitive-swarm":
        for (let index = 0; index < count; index += 1) {
          const orbit = frame.timeSec * plan.motionParams.phaseRate * (1 + drives.bpmDrive * 0.12) + index * 0.48;
          const orbitalScale = (plan.familyVariant === "orbiting-tetrahedrons" ? 0.12 : 0.24) * (1 + drives.bpmDrive * 0.2);
          let cx = this.settings.width * 0.5 + Math.cos(orbit) * this.settings.width * plan.geometryParams.depth * orbitalScale;
          let cy = this.settings.height * 0.5 + Math.sin(orbit * 1.2) * this.settings.height * plan.geometryParams.depth * 0.2 * (1 + drives.midTransitionDrive * 0.18);
          if ((plan.interactionMode === "hero-proximity" || plan.interactionMode === "hero-orbit" || plan.interactionMode === "hero-velocity") && heroInteractionActive) {
            cx = heroX + Math.cos(orbit + heroHeading) * (32 + index * 6 + drives.bpmDrive * 8);
            cy = heroY + Math.sin(orbit + heroHeading) * (28 + index * 5 + drives.midTransitionDrive * 6);
          }
          if (plan.familyVariant === "repelling-pyramids") {
            const dx = cx - heroX;
            const dy = cy - heroY;
            const push = Math.max(0.2, 1 + ((plan.heroCouplingStrength ?? 0) * 38) / Math.max(60, Math.hypot(dx, dy)) + drives.midTransitionDrive * 0.22);
            cx = heroX + dx * push;
            cy = heroY + dy * push;
          }
          const size = Math.max(6, this.settings.width * 0.012 * pulse * (1 + drives.bpmDrive * 0.18 + drives.midTransitionDrive * 0.12) * (1 + (index % 3) * plan.geometryParams.scaleVariance) * (plan.familyVariant === "trailing-prisms" ? 1 + heroSpeed * 0.05 : 1));
          const alpha = clamp(0.12 + drives.midTransitionDrive * 0.04, 0.06, 0.22);
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(orbit * plan.motionParams.rotationScale * (1 + drives.bpmDrive * 0.24) + drives.minorImpactDrive * 0.18);
          applyAccentStyle(alpha, 6 + drives.minorImpactDrive * 4, "stroke");
          this.ctx.globalAlpha = alpha;
          if (plan.familyVariant === "repelling-pyramids" || plan.familyVariant === "orbiting-tetrahedrons") {
            this.ctx.beginPath();
            this.ctx.moveTo(0, -size);
            this.ctx.lineTo(size, size);
            this.ctx.lineTo(-size, size);
            this.ctx.closePath();
            this.ctx.stroke();
          } else if (plan.familyVariant === "trailing-prisms" || (plan.backgroundElementId ?? "").includes("diamonds") || (plan.backgroundElementId ?? "").includes("polyhedrons")) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, -size);
            this.ctx.lineTo(size * 0.82, 0);
            this.ctx.lineTo(0, size);
            this.ctx.lineTo(-size * 0.82, 0);
            this.ctx.closePath();
            this.ctx.stroke();
          } else if (plan.familyVariant === "physics-cubes" || plan.familyVariant === "random-cube-clusters" || (plan.backgroundElementId ?? "").includes("cubes")) {
            this.ctx.strokeRect(-size, -size, size * 2, size * 2);
          } else {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, size, 0, Math.PI * 2);
            this.ctx.stroke();
          }
          this.ctx.restore();
        }
        break;
      case "ring-field":
        for (let index = 0; index < count; index += 1) {
          const radius = this.settings.width * (0.04 + (index / count) * 0.18) * pulse * (1 + drives.bpmDrive * 0.22) * (plan.familyVariant === "arc-halos" ? 0.72 : 1);
          const cx = (plan.interactionMode === "hero-orbit" ? heroX : this.settings.width * 0.5) + Math.cos(frame.timeSec * (0.4 + drives.bpmDrive * 0.08) + index) * this.settings.width * 0.1 * plan.motionParams.driftScale;
          const cy = (plan.interactionMode === "hero-orbit" ? heroY : this.settings.height * 0.5) + Math.sin(frame.timeSec * (0.32 + drives.bpmDrive * 0.06) + index * 0.6) * this.settings.height * 0.08 * plan.motionParams.driftScale;
          const alpha = clamp(0.08 + drives.midTransitionDrive * 0.04 + (index % 4 === 0 ? plan.pulseProfile.flickerAmount * 0.04 : 0), 0.05, 0.2);
          applyAccentStyle(alpha, 8 + drives.bpmDrive * 2, "stroke");
          this.ctx.globalAlpha = alpha;
          this.ctx.beginPath();
          if (plan.familyVariant === "breathing-triangles") {
            this.ctx.moveTo(cx, cy - radius);
            this.ctx.lineTo(cx + radius * 0.88, cy + radius * 0.66);
            this.ctx.lineTo(cx - radius * 0.88, cy + radius * 0.66);
            this.ctx.closePath();
          } else if (plan.familyVariant === "arc-halos") {
            this.ctx.arc(cx, cy, radius, 0, Math.PI * (1.35 + drives.midTransitionDrive * 0.18) + Math.sin(frame.timeSec + index) * (0.3 + drives.minorImpactDrive * 0.08));
          } else {
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          }
          this.ctx.stroke();
        }
        break;
      case "sigil-field":
        for (let index = 0; index < count; index += 1) {
          const predictiveOffset = plan.familyVariant === "predictive-polygons" ? 30 + heroSpeed * 3 + drives.midTransitionDrive * 8 : 0;
          const cx = plan.interactionMode === "hero-path-predictive"
            ? heroX + Math.cos(heroHeading + index * 0.5) * predictiveOffset
            : this.settings.width * (0.22 + (index % 4) * 0.18);
          const cy = plan.interactionMode === "hero-path-predictive"
            ? heroY + Math.sin(heroHeading + index * 0.5) * predictiveOffset
            : this.settings.height * (0.24 + Math.floor(index / 4) * 0.2);
          const size = this.settings.width * (0.018 + plan.geometryParams.scaleVariance * 0.03) * pulse * (1 + drives.bpmDrive * 0.16 + drives.midTransitionDrive * 0.08);
          const rotation = frame.timeSec * plan.motionParams.rotationScale * (1 + drives.bpmDrive * 0.2) + index * 0.4 + drives.minorImpactDrive * 0.16;
          const alpha = clamp(accentAlpha * 0.9 + drives.midTransitionDrive * 0.04, 0.05, 0.22);
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(rotation);
          applyAccentStyle(alpha, 8 + drives.minorImpactDrive * 3, "stroke");
          this.ctx.globalAlpha = alpha;
          if (plan.familyVariant === "collapsing-hexagons") {
            this.ctx.beginPath();
            for (let side = 0; side < 6; side += 1) {
              const angle = (Math.PI * 2 * side) / 6;
              const px = Math.cos(angle) * size;
              const py = Math.sin(angle) * size;
              if (side === 0) this.ctx.moveTo(px, py);
              else this.ctx.lineTo(px, py);
            }
            this.ctx.closePath();
            this.ctx.stroke();
          } else if (plan.familyVariant === "octagon-enclosures") {
            this.ctx.strokeRect(-size, -size, size * 2, size * 2);
            this.ctx.rotate(Math.PI / 4);
            this.ctx.strokeRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
          } else {
            this.ctx.beginPath();
            this.ctx.moveTo(0, -size);
            this.ctx.lineTo(size, size);
            this.ctx.lineTo(-size, size);
            this.ctx.closePath();
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(-size, 0);
            this.ctx.lineTo(size, 0);
            this.ctx.stroke();
          }
          this.ctx.restore();
        }
        break;
    }

    if ((plan.layeringParams?.hazeAlpha ?? 0) > 0) {
      const haze = this.ctx.createRadialGradient(
        this.settings.width * 0.5,
        this.settings.height * 0.5,
        0,
        this.settings.width * 0.5,
        this.settings.height * 0.5,
        this.settings.width * 0.46,
      );
      this.lastStageMetrics.gradientCreateCount += 1;
      haze.addColorStop(0, applyAccentStyle(plan.layeringParams?.hazeAlpha ?? 0.08, -12, "fill").color);
      haze.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.globalAlpha = 1;
      this.ctx.fillStyle = haze;
      this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    }
    this.lastBackgroundColorfulnessScale = backgroundColorfulnessScaleSum / Math.max(1, backgroundAccentSampleCount);
    this.lastBackgroundLuminosityLiftAvg = backgroundLuminosityLiftSum / Math.max(1, backgroundAccentSampleCount);
    this.ctx.restore();
  }

  private drawGlow(anchors: NebulaGlowAnchor[], frame: AudioFrameFeature, theme: RenderTheme): void {
    const calm = (frame.normalizedLow + frame.normalizedMid + frame.normalizedHigh) / 3 < 0.3 && frame.peakStrength < 0.25;
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const glowCount = Math.min(anchors.length, calm ? 10 : 24);
    for (let index = 0; index < glowCount; index += 1) {
      const anchor = anchors[index]!;
      const multiplier = anchor.kind === "ridge" ? 1.05 : anchor.kind === "edge" ? 1.12 : 1.26;
      const radius = safeRadius(
        anchor.radius * multiplier * clamp(1 + frame.normalizedLow * 0.24 + frame.normalizedMid * 0.12 + frame.peakStrength * 0.1, 1, 2.6),
        1,
      );
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
        continue;
      }
      const gradient = this.ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius);
      gradient.addColorStop(0, anchor.color);
      gradient.addColorStop(0.3, plasmaCoreColor(theme, 0.08 + anchor.intensity * 0.1, index / Math.max(1, glowCount)));
      gradient.addColorStop(0.72, paletteColor(theme, index / Math.max(1, glowCount), 0.03 + anchor.weight * 0.03, 10));
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private applyShotEnvelope(
    frame: AudioFrameFeature,
    visualState: VisualState,
    edgeMap: EdgeMap,
    qualityBudget: RenderQualityBudget,
  ): void {
    if (qualityBudget.skipFadeWash) {
      return;
    }
    if (
      (frame.normalizedLow * 0.45 + frame.normalizedMid * 0.35 + frame.normalizedHigh * 0.2) < 0.24 &&
      frame.peakStrength < 0.16 &&
      visualState.regime !== "drop" &&
      visualState.regime !== "build" &&
      visualState.regime !== "intro" &&
      visualState.regime !== "outro"
    ) {
      return;
    }
    const centerX = edgeMap.focalCenterX;
    const centerY = edgeMap.focalCenterY;
    const baseRadius =
      visualState.shotMode === "climax"
        ? this.settings.width * 0.32
        : visualState.shotMode === "portrait"
          ? this.settings.width * 0.24
          : this.settings.width * 0.4;
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const gradient = this.ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius);
    gradient.addColorStop(0, `rgba(255,255,255,${0.015 + frame.normalizedLow * 0.016 + frame.normalizedMid * 0.014 + frame.normalizedHigh * 0.01})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.ctx.restore();
  }

  private heroChildPrimitive(kind: HeroPrimitiveKind, fallback: HeroPrimitiveKind): HeroPrimitiveKind {
    switch (kind) {
      case "diamond":
      case "kite":
        return "diamond";
      case "chevron":
      case "arrow":
        return "chevron";
      case "ring":
      case "arc":
      case "sector":
      case "moon":
      case "lens":
        return "arc";
      case "star":
      case "hexagram":
      case "asterisk":
        return "star";
      case "heart":
      case "cloud":
      case "teardrop":
        return "teardrop";
      case "hexagon":
      case "pentagon":
      case "octagon":
        return "hexagon";
      case "spiral":
        return "spiral";
      case "lightning":
        return "lightning";
      default:
        return fallback;
    }
  }

  private resolveSatelliteAnchorOffset(
    frame: AudioFrameFeature,
    activeSubject: ActiveSubjectState,
    primary: HeroEmitterDirective,
    sceneGraph: SceneGraph,
    cluster: SceneGraph["heroClusterConfig"],
    anchorX: number,
    anchorY: number,
    satelliteIndex: number,
    pathOffsetPhase = 0,
  ): { x: number; y: number } {
    const glitchySeed =
      sceneGraph.heroInstanceSeed.travelStyle.glitchBias >= 0.6 ||
      sceneGraph.heroMotifProfile.motionBias === "glitch-hop";
    const orbitBaseRadius =
      primary.size *
      cluster.satellitePathOffsetRadius *
      (0.82 + satelliteIndex * 0.08);
    const phaseBase =
      frame.timeSec * (glitchySeed ? 1.28 : 0.92) +
      pathOffsetPhase * Math.PI * 2 +
      primary.rotation * 0.18 +
      satelliteIndex * 0.34;
    const motionCarry = Math.hypot(activeSubject.vx, activeSubject.vy) * 0.65;
    if (!glitchySeed) {
      const tangentPhase = phaseBase + Math.sin(frame.timeSec * 0.7 + satelliteIndex) * 0.08;
      const ellipseX = Math.cos(tangentPhase) * orbitBaseRadius * 0.24;
      const ellipseY = Math.sin(tangentPhase * 0.92) * orbitBaseRadius * 0.16;
      const tangentX = -Math.sin(tangentPhase);
      const tangentY = Math.cos(tangentPhase);
      return {
        x: anchorX + ellipseX + tangentX * motionCarry * 0.18,
        y: anchorY + ellipseY + tangentY * motionCarry * 0.12,
      };
    }

    const phaseStep = Math.PI / 6;
    const quantizedPhase = Math.round(phaseBase / phaseStep) * phaseStep;
    const jitterSeed = stableHash(`${sceneGraph.imagePath}:${frame.frameIndex}:${satelliteIndex}:${sceneGraph.continuitySeed}`);
    const radiusSpike = jitterSeed % 9 === 0 ? 1.26 : 1;
    const jitterX = (((jitterSeed % 17) / 16) - 0.5) * orbitBaseRadius * 0.1;
    const jitterY = ((((jitterSeed >> 3) % 17) / 16) - 0.5) * orbitBaseRadius * 0.08;
    const tangentX = -Math.sin(quantizedPhase);
    const tangentY = Math.cos(quantizedPhase);
    return {
      x: anchorX + Math.cos(quantizedPhase) * orbitBaseRadius * 0.28 * radiusSpike + tangentX * motionCarry * 0.22 + jitterX,
      y: anchorY + Math.sin(quantizedPhase * 0.88) * orbitBaseRadius * 0.2 * radiusSpike + tangentY * motionCarry * 0.16 + jitterY,
    };
  }

  private buildHeroClusterDirectives(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    sceneGraph: SceneGraph,
    compositionPlan: CompositionPlan,
    edgeMap: EdgeMap,
  ): HeroEmitterDirective[] {
    const layout = resolveHeroLayout(
      {
        continuitySeed: sceneGraph.continuitySeed,
        heroClusterConfig: sceneGraph.heroClusterConfig,
        heroRelationshipMode: sceneGraph.heroClusterConfig.relationshipMode,
        heroOrbitRadius: sceneGraph.heroOrbitRadius,
      },
      compositionPlan,
      edgeMap,
    );
    const primaryLayout = layout.instances[0];
    const primary = this.heroEmitterDirective(frame, theme, activeSubject, sceneGraph, compositionPlan, edgeMap, primaryLayout);
    const cluster = sceneGraph.heroClusterConfig;
    if (!cluster.enabled || cluster.count <= 1) {
      this.updateHeroSeparationDiagnostics([primary], sceneGraph, layout);
      return [primary];
    }
    const directives: HeroEmitterDirective[] = [];
    const count = Math.min(layout.instances.length, Math.min(4, Math.max(1, cluster.count)));
    for (let index = 0; index < count; index += 1) {
      if (index === 0) {
        directives.push(primary);
        continue;
      }
      const instanceLayout = layout.instances[index] ?? primaryLayout;
      const relationshipMode = cluster.relationshipMode;
      const cojoinedBias = relationshipMode === "cojoined" ? cluster.sharedCoreBias : 0;
      const satelliteAnchorX = instanceLayout.anchorX * (1 - cojoinedBias * 0.18) + primary.x * cojoinedBias * 0.18;
      const satelliteAnchorY = instanceLayout.anchorY * (1 - cojoinedBias * 0.18) + primary.y * cojoinedBias * 0.18;
      const satelliteOffset = this.resolveSatelliteAnchorOffset(
        frame,
        activeSubject,
        primary,
        sceneGraph,
        cluster,
        satelliteAnchorX,
        satelliteAnchorY,
        index,
        instanceLayout.pathOffsetPhase,
      );
      const offsetX = satelliteOffset.x - primary.x;
      const offsetY = satelliteOffset.y - primary.y;
      const directionAngle = Math.atan2(offsetY || 0.001, offsetX || 0.001);
      const primitive =
        index % 2 === 1
          ? sceneGraph.heroPrimitiveFallback
          : sceneGraph.heroInstanceSeed.childPrimitiveMix[(index - 1) % sceneGraph.heroInstanceSeed.childPrimitiveMix.length] ?? sceneGraph.heroPrimitiveFallback;
      directives.push({
        ...primary,
        x: satelliteOffset.x,
        y: satelliteOffset.y,
        laneId: instanceLayout.laneId,
        relationshipRole: instanceLayout.relationshipRole,
        quadrant: instanceLayout.quadrant,
        pathOffsetPhase: instanceLayout.pathOffsetPhase,
        rotation:
          relationshipMode === "mirror-x" || relationshipMode === "mirror-y" || relationshipMode === "mirror-xy"
            ? directionAngle + Math.PI
            : primary.rotation + (index % 2 === 0 ? 0.2 : -0.2) + instanceLayout.pathOffsetPhase * 0.4,
        spinVelocity:
          relationshipMode === "mirror-x" || relationshipMode === "mirror-y" || relationshipMode === "mirror-xy"
            ? -primary.spinVelocity * Math.max(0.42, cluster.satellitePhaseLock - index * 0.06)
            : primary.spinVelocity * (0.92 + index * 0.04 + instanceLayout.pathOffsetPhase * 0.08),
        size: primary.size * cluster.satelliteScale,
        primitive,
        alpha: primary.alpha * cluster.satelliteAlphaScale,
        brightness: primary.brightness * (0.94 + index * 0.02),
      });
    }
    this.updateHeroSeparationDiagnostics(directives, sceneGraph, layout);
    return directives;
  }

  private updateHeroSeparationDiagnostics(
    directives: HeroEmitterDirective[],
    sceneGraph: SceneGraph,
    layout: ReturnType<typeof resolveHeroLayout>,
  ): void {
    this.lastHeroLayoutFamily = layout.layoutFamily;
    this.lastHeroInstanceCountResolved = directives.length;
    this.lastHeroLaneDiversityScore = layout.laneDiversityScore;
    this.lastHeroRelationshipResolved = sceneGraph.heroClusterConfig.relationshipMode;
    this.lastHeroDistinctQuadrantCount = new Set(directives.map((directive) => directive.quadrant ?? "center")).size;
    if (directives.length <= 1) {
      this.lastHeroPairMinDistancePx = 0;
      this.lastHeroPairAvgDistancePx = 0;
      this.lastHeroOverlapRatio = 0;
      this.lastHeroCoreOverlapRatio = 0;
      this.lastHeroGlowMergeRatio = 0;
      this.lastHeroSeparationReadable = true;
      this.lastHeroSeparationFailureReason = "none";
      return;
    }
    const distances: number[] = [];
    const overlaps: number[] = [];
    const coreOverlaps: number[] = [];
    const glowMerges: number[] = [];
    for (let a = 0; a < directives.length; a += 1) {
      for (let b = a + 1; b < directives.length; b += 1) {
        const left = directives[a]!;
        const right = directives[b]!;
        const distance = Math.hypot(left.x - right.x, left.y - right.y);
        distances.push(distance);
        overlaps.push(circleOverlapRatio(left.size * 0.92, right.size * 0.92, distance));
        coreOverlaps.push(circleOverlapRatio(left.size * 0.42, right.size * 0.42, distance));
        glowMerges.push(circleOverlapRatio(left.size * 1.5, right.size * 1.5, distance));
      }
    }
    this.lastHeroPairMinDistancePx = Math.min(...distances);
    this.lastHeroPairAvgDistancePx = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
    this.lastHeroOverlapRatio = overlaps.reduce((sum, value) => sum + value, 0) / Math.max(1, overlaps.length);
    this.lastHeroCoreOverlapRatio = coreOverlaps.reduce((sum, value) => sum + value, 0) / Math.max(1, coreOverlaps.length);
    this.lastHeroGlowMergeRatio = glowMerges.reduce((sum, value) => sum + value, 0) / Math.max(1, glowMerges.length);
    const readable =
      sceneGraph.heroClusterConfig.relationshipMode === "cojoined" ||
      (
        this.lastHeroPairMinDistancePx >= Math.max(24, layout.baseSpreadPx * 0.38) &&
        this.lastHeroCoreOverlapRatio <= 0.18 &&
        this.lastHeroGlowMergeRatio <= 0.72 &&
        this.lastHeroDistinctQuadrantCount >= Math.min(2, directives.length) &&
        this.lastHeroLaneDiversityScore >= 0.55
      );
    this.lastHeroSeparationReadable = readable;
    this.lastHeroSeparationFailureReason =
      sceneGraph.heroClusterConfig.relationshipMode === "cojoined" ? "cojoined-intent" :
      this.lastHeroDistinctQuadrantCount <= 1 ? "quadrant-collapse" :
      this.lastHeroLaneDiversityScore < 0.55 ? "lane-collapse" :
      this.lastHeroPairMinDistancePx < Math.max(24, layout.baseSpreadPx * 0.38) ? "insufficient-spread" :
      this.lastHeroCoreOverlapRatio > 0.18 ? "center-collapse" :
      this.lastHeroGlowMergeRatio > 0.72 ? "glow-merge" :
      "none";
  }

  private heroEmitterDirective(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    sceneGraph: SceneGraph,
    compositionPlan: CompositionPlan,
    edgeMap: EdgeMap,
    layoutInstance?: ReturnType<typeof resolveHeroLayout>["instances"][number],
  ): HeroEmitterDirective {
    const moveScale = activeSubject.moveScale ?? 1;
    const emissionScale = activeSubject.emissionScale ?? 1;
    const freezeTranslation = !!activeSubject.lowDbFreezeActive;
    const heroX = layoutInstance?.anchorX ?? compositionPlan.heroCenterX;
    const heroY = layoutInstance?.anchorY ?? compositionPlan.heroCenterY;
    const support = compositionPlan.supportSlots;
    const background = compositionPlan.backgroundSlots;
    const anchor =
      activeSubject.mode === "orbit" && support.length > 0
        ? support[Math.floor((frame.timeSec * 0.6) % support.length)]
        : activeSubject.mode === "ghost" && background.length > 0
          ? background[Math.floor((frame.timeSec * 0.45) % background.length)]
          : support[0];
    const fallbackAnchor = { x: heroX, y: heroY, radius: compositionPlan.heroRadius, angle: 0, layer: "hero" as const, weight: 1 };
    const chosenAnchor = anchor ?? fallbackAnchor;
    const travelBias =
      activeSubject.mode === "strike" ? 0.34 :
      activeSubject.mode === "orbit" ? 0.58 :
      activeSubject.mode === "ghost" ? 0.72 :
      activeSubject.mode === "windup" ? 0.26 :
      0.18;
    const lerpX = activeSubject.x + (chosenAnchor.x - activeSubject.x) * travelBias * moveScale;
    const lerpY = activeSubject.y + (chosenAnchor.y - activeSubject.y) * travelBias * moveScale;
    const pathAngle = Math.atan2(chosenAnchor.y - heroY, (chosenAnchor.x - heroX) || 0.001) + (layoutInstance?.pathOffsetPhase ?? 0) * 0.35;
    const driftRadius =
      activeSubject.mode === "orbit" ? chosenAnchor.radius * 0.22 :
      activeSubject.mode === "ghost" ? chosenAnchor.radius * 0.16 :
      chosenAnchor.radius * 0.08;
    const minimumTravel = sceneGraph.heroPriorityRadius * 0.18;
    const orbitPhase = frame.timeSec * (
      activeSubject.mode === "orbit" ? 1.1 :
      activeSubject.mode === "ghost" ? 0.55 :
      activeSubject.mode === "windup" ? 0.8 :
      0.45
    ) + activeSubject.gesturePhase * 0.12 + (layoutInstance?.pathOffsetPhase ?? 0) * Math.PI * 2;
    const pathDrift =
      (freezeTranslation ? 0 : Math.max(driftRadius, minimumTravel) * moveScale) *
      clamp(0.96 + (sceneGraph.heroEmissionTuning.warpFactorScale - 1) * 0.22, 0.96, 1.22);
    const x = freezeTranslation ? activeSubject.x : lerpX + Math.cos(orbitPhase + pathAngle) * pathDrift;
    const y = freezeTranslation ? activeSubject.y : lerpY + Math.sin(orbitPhase + pathAngle) * pathDrift * (activeSubject.mode === "orbit" ? 0.86 : 0.58);
    const rotation =
      activeSubject.mode === "strike" ? Math.atan2(activeSubject.vy, activeSubject.vx || 0.001) :
      activeSubject.mode === "orbit" ? pathAngle + Math.sin(frame.timeSec * 0.9) * 0.28 :
      activeSubject.mode === "ghost" ? pathAngle - Math.cos(frame.timeSec * 0.4) * 0.18 :
      activeSubject.mode === "windup" ? pathAngle + frame.beatPulse * 0.22 :
      pathAngle + Math.sin(frame.timeSec * 0.3) * 0.12;
    const pulse = frame.dominantBand === "low" ? frame.normalizedLow : frame.dominantBand === "mid" ? frame.normalizedMid : frame.normalizedHigh;
    const primitive = sceneGraph.heroPrimitive;
    const fallback = sceneGraph.heroPrimitiveFallback;
    const heroSeed = sceneGraph.heroInstanceSeed;
    const motifProfile = sceneGraph.heroMotifProfile;
    const motifVariant = sceneGraph.heroMotifVariant;
    const colorResponseScale = this.resolveHeroColorResponseScale(sceneGraph);
    const gracefulBias = clamp((activeSubject.gracefulBias ?? heroSeed.travelStyle.gracefulBias) * 1.1, 0, 1);
    const glitchBias = clamp((activeSubject.glitchBias ?? heroSeed.travelStyle.glitchBias) * 0.92, 0, 1);
    const heroSizeTaper = 0.95 - motifVariant.sizeWeight * 0.05;
    const spinRate =
      motifProfile.spinProfile.gracefulSpin * (0.42 + gracefulBias * 0.96) +
      motifProfile.spinProfile.glitchSpin * glitchBias * 0.2;
    const spinJerk =
      Math.sin(frame.timeSec * (6.5 + motifProfile.spinProfile.glitchSpin * 0.9) + sceneGraph.continuitySeed * 0.011) *
      motifProfile.spinProfile.jerkStrength *
      glitchBias *
      clamp(0.12 + frame.peakStrength * 0.38 + frame.onsetStrength * 0.26, 0.08, 0.62);
    const spinAngle = frame.timeSec * spinRate + spinJerk;
    const childPrimitive = this.heroChildPrimitive(primitive, fallback);
    const baseEmitterCount = Math.max(1, Math.round(sceneGraph.heroEmitterOffsets.length * 1.2));
    const singleHeroScene = sceneGraph.heroClusterConfig.count <= 1;
    const emitterCount = singleHeroScene
      ? Math.max(2, Math.min(8, baseEmitterCount * 2))
      : Math.max(1, Math.min(4, baseEmitterCount));
    const motionModes = ["orbit-hero", "revolve-hero", "patrol", "atomic-gravity", "hover"] as const;
    const particleSpawnScale = this.diagnosticOverrides.particleSpawnScale ?? 1;
    const motionModeSeed =
      sceneGraph.continuitySeed +
      Math.round(motifVariant.speedWeight * 100) * 3 +
      Math.round(motifVariant.warpWeight * 100) * 5 +
      Math.round(motifVariant.gravityWeight * 100) * 7;
    const preferredMotionOffset =
      motifProfile.motionBias === "ritual-orbit" ? 0 :
      motifProfile.motionBias === "tightrope" ? 2 :
      motifProfile.motionBias === "swerve" ? 1 :
      motifProfile.motionBias === "glitch-hop" ? 3 :
      4;
    const directiveIndex = layoutInstance?.index ?? 0;
    const subEmitters: HeroSubEmitterDirective[] = Array.from({ length: emitterCount }, (_, index) => {
      const offset = sceneGraph.heroEmitterOffsets[index % Math.max(1, sceneGraph.heroEmitterOffsets.length)] ?? { x: 0, y: 0 };
      return ({
      offsetX: offset.x * (heroSeed.emitterTopology === "orbit" ? 1.06 : heroSeed.emitterTopology === "spine" ? 0.7 : 1),
      offsetY: offset.y * (heroSeed.emitterTopology === "fan" ? 1.18 : 1),
      spawnX: motifProfile.particleSpawnRegion.x + offset.x * 0.18,
      spawnY: motifProfile.particleSpawnRegion.y + offset.y * 0.18,
      spawnXRange: motifProfile.particleSpawnRegion.xRange * (1 + index * 0.08) * clamp(0.94 + (sceneGraph.heroEmissionTuning.warpFactorScale - 1) * 0.34, 0.94, 1.34),
      spawnYRange: motifProfile.particleSpawnRegion.yRange * (1 + index * 0.06) * clamp(0.94 + (sceneGraph.heroEmissionTuning.warpFactorScale - 1) * 0.28, 0.94, 1.28),
      primitive: heroSeed.childPrimitiveMix[index % heroSeed.childPrimitiveMix.length] ?? childPrimitive,
      spawnRate: clamp((0.45 + pulse * 0.55 + (frame.isFourBarDownbeat ? 0.28 : 0) - index * 0.06) * 1.5 * particleSpawnScale * emissionScale, 0.18, 2.4),
      childSpread: (0.16 + pulse * 0.28) * clamp(0.96 + (sceneGraph.heroEmissionTuning.warpFactorScale - 1) * 0.5, 0.96, 1.48),
      childSpeed: (0.65 + activeSubject.emphasis * 0.9 + index * 0.08) * 3,
      childLifetime: (0.48 + activeSubject.emphasis * 0.34) * 0.7,
      childScale: clamp(0.16 + index * 0.03 + pulse * 0.08, 0.14, 0.34),
      emissionMode:
        sceneGraph.heroResolvedShellMode === "heat-smear" ? "wake" :
        sceneGraph.heroResolvedShellMode === "petal-shell" ? "petal-shed" :
        activeSubject.mode === "orbit" ? "orbit-shed" :
        activeSubject.mode === "strike" ? "spine-fountain" :
        "spray",
      bandAffinity: heroSeed.bandRouting[index % heroSeed.bandRouting.length] ?? "mid",
      densityScale: clamp(0.9 + heroSeed.sizeBias * 0.18 + index * 0.05, 0.82, 1.28),
      shellCoupling: clamp(0.52 + heroSeed.shellMorph * 0.38 - index * 0.05, 0.34, 0.94),
      motionMode: motionModes[(preferredMotionOffset + motionModeSeed + index) % motionModes.length]!,
      rotationReactive: stableHash(`${sceneGraph.imagePath}${heroSeed.motifProfileKey}${directiveIndex}${index}`) % 10 === 0,
      rotationBand: "high",
      rotationBaseVelocity: 0.06 + (index % 3) * 0.02,
      rotationNegativeOnDrop: motifProfile.key === "shattered-arc" || motifProfile.key === "film-bloom-shard" || motifProfile.key === "vector-incantation",
      });
    });
    const fillMode: HeroCoreFillMode = motifProfile.fillBias;
    const deformationMode: HeroDeformationMode =
      heroSeed.deformationBias;
    this.lastHeroEchoCount = 0;
    this.lastHeroGlyphComplexity = primitiveComplexity(primitive);
    this.lastHeroPrimitive = primitive;
    this.lastHeroShellMode = sceneGraph.heroResolvedShellMode;
    this.lastHeroBaseShellMode = sceneGraph.heroBaseShellMode;
    this.lastHeroResolvedShellMode = sceneGraph.heroResolvedShellMode;
    this.lastHeroCircleShellEligible = sceneGraph.heroCircleShellEligible;
    this.lastHeroCircleShellPromoted = sceneGraph.heroCircleShellPromoted;
    this.lastHeroShellSceneEnabled = sceneGraph.heroShellSceneEnabled;
    this.lastHeroShellConfiguredCount = sceneGraph.heroShellConfiguredCount;
    this.lastHeroShellColorMode = sceneGraph.heroShellColorMode;
    this.lastHeroSubEmitterCount = subEmitters.length;
    this.lastHeroCoreFillMode = fillMode;
    this.lastHeroOutlineRatio = fillMode === "solid" ? 0.12 : fillMode === "stroke-fill" ? 0.34 : 0.46;
    this.lastHeroPrimitiveComplexity = primitiveComplexity(primitive);
    this.lastHeroChildEmissionRate = subEmitters.reduce((sum, emitter) => sum + emitter.spawnRate, 0) / Math.max(1, subEmitters.length);
    this.lastHeroEmitterTopology = heroSeed.emitterTopology;
    this.lastHeroInstanceVariant = heroSeed.variantKey;
    this.lastHeroTravelGracefulBias = gracefulBias;
    this.lastHeroTravelGlitchBias = glitchBias;
    this.lastHeroTargetSmoothing = clamp((activeSubject.targetSmoothing ?? heroSeed.travelStyle.targetSmoothing) * 1.08, 0, 1);
    this.lastHeroSpinVelocity = spinRate;
    this.lastHeroSpawnRegion = `${motifProfile.particleSpawnRegion.x.toFixed(2)},${motifProfile.particleSpawnRegion.y.toFixed(2)},${motifProfile.particleSpawnRegion.xRange.toFixed(2)},${motifProfile.particleSpawnRegion.yRange.toFixed(2)}`;
    this.lastHeroParticleSizeVariance = sceneGraph.heroEmissionTuning.colorRangeMode;
    this.lastHeroColorProminence = `${(motifProfile.colorProminence.core * colorResponseScale).toFixed(2)}/${(motifProfile.colorProminence.shell * colorResponseScale).toFixed(2)}/${(motifProfile.colorProminence.particles * colorResponseScale).toFixed(2)}`;
    this.lastHeroMotifInfluenceKey = motifProfile.influenceKey;
    this.lastHeroMotionBias = motifProfile.motionBias;
    this.lastHeroMotifProfile = motifProfile.key;
    this.lastHeroMotifVariantKey = motifVariant.key;
    this.lastHeroRelationshipMode = sceneGraph.heroClusterConfig.relationshipMode;
    this.lastTransitionIdentitySignature = sceneGraph.transitionIdentitySignature || buildTransitionIdentitySignature(sceneGraph);
    this.lastHeroVariantWarp = clamp(motifVariant.warpWeight * sceneGraph.heroEmissionTuning.warpVisualScale, 0, 2);
    this.lastHeroVariantGravity = motifVariant.gravityWeight;
    this.lastHeroVariantInconsistency = motifVariant.inconsistencyWeight;
    return {
      x,
      y,
      laneId: layoutInstance?.laneId,
      relationshipRole: layoutInstance?.relationshipRole,
      quadrant: layoutInstance?.quadrant ?? quadrantForPoint(x, y, edgeMap.width, edgeMap.height),
      pathOffsetPhase: layoutInstance?.pathOffsetPhase ?? 0,
      rotation: rotation + spinAngle,
      spinVelocity: spinRate,
      size: activeSubject.radius * (
        activeSubject.mode === "ghost" ? 0.3 :
        activeSubject.mode === "orbit" ? 0.324 :
        activeSubject.mode === "windup" ? 0.36 :
        0.348
      ) * (0.9 + pulse * 0.14 + activeSubject.emphasis * 0.06) * sceneGraph.heroInstanceSeed.sizeBias * motifProfile.prominenceBias.coreScale * (0.88 + motifVariant.sizeWeight * 0.34) * heroSizeTaper,
      primitive,
      fillMode,
      deformationMode,
      subEmitters,
      postShellMode: sceneGraph.heroResolvedShellMode,
      brightness: clamp(0.68 + pulse * 0.28 + activeSubject.emphasis * 0.18, 0.65, 1.15),
      alpha: clamp((0.74 + pulse * 0.16 + (sceneGraph.heroVisibilityBias - 1) * 0.2) * motifProfile.prominenceBias.coreAlpha, 0.72, 1.2),
    };
  }

  private getHeroChildFieldStates(imagePath: string, count: number): HeroChildFieldState[] {
    let states = this.heroChildFieldStatesByImage.get(imagePath);
    const imageSeed = stableImageSeed(imagePath, 131);
    if (!states) {
      states = [];
      this.heroChildFieldStatesByImage.set(imagePath, states);
    }
    while (states.length < count) {
      const clusterIndex = states.length;
      const seed = imageSeed + 17 + clusterIndex * 97;
      states.push({
        particles: [],
        seed,
        clusterIndex,
        role: clusterIndex === 0 ? "primary" : "satellite",
        lastFrameIndex: -1,
        physics: {
          motor: {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            ax: 0,
            ay: 0,
            heading: 0,
            fuel: 1,
            burnPhase: 0,
            jitter: 0,
            lastFrameIndex: -1,
          },
          wake: {
            samples: [],
            maxSamples: 28,
          },
          trail: {
            particles: this.createHeroParticleBuffers(1536),
            capacity: 1536,
          },
          burst: {
            particles: this.createHeroParticleBuffers(1024),
            subsystems: [],
            particleCapacity: 1024,
            subsystemCapacity: 32,
          },
          residue: {
            particles: this.createHeroParticleBuffers(1024),
            capacity: 1024,
          },
          seed,
          lastFrameIndex: -1,
        },
      });
    }
    return states.slice(0, count);
  }

  private createHeroParticleBuffers(capacity: number): HeroParticleBuffers {
    return {
      count: 0,
      capacity,
      x: new Float32Array(capacity),
      y: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      ax: new Float32Array(capacity),
      ay: new Float32Array(capacity),
      heat: new Float32Array(capacity),
      size: new Float32Array(capacity),
      drag: new Float32Array(capacity),
      alpha: new Float32Array(capacity),
      age: new Uint16Array(capacity),
      ttl: new Uint16Array(capacity),
      bandAffinity: new Uint8Array(capacity),
    };
  }

  private ensureHeroParticleBuffersCapacity(buffers: HeroParticleBuffers, minCapacity: number): HeroParticleBuffers {
    if (buffers.capacity >= minCapacity) {
      return buffers;
    }
    const nextCapacity = Math.max(minCapacity, Math.ceil(buffers.capacity * 1.5), 32);
    const next = this.createHeroParticleBuffers(nextCapacity);
    next.count = buffers.count;
    next.x.set(buffers.x.subarray(0, buffers.count));
    next.y.set(buffers.y.subarray(0, buffers.count));
    next.vx.set(buffers.vx.subarray(0, buffers.count));
    next.vy.set(buffers.vy.subarray(0, buffers.count));
    next.ax.set(buffers.ax.subarray(0, buffers.count));
    next.ay.set(buffers.ay.subarray(0, buffers.count));
    next.heat.set(buffers.heat.subarray(0, buffers.count));
    next.size.set(buffers.size.subarray(0, buffers.count));
    next.drag.set(buffers.drag.subarray(0, buffers.count));
    next.alpha.set(buffers.alpha.subarray(0, buffers.count));
    next.age.set(buffers.age.subarray(0, buffers.count));
    next.ttl.set(buffers.ttl.subarray(0, buffers.count));
    next.bandAffinity.set(buffers.bandAffinity.subarray(0, buffers.count));
    return next;
  }

  private ensureHeroParticleScratchCapacity(count: number): void {
    if (this.heroParticleScratchAx.length >= count) {
      return;
    }
    this.heroParticleScratchAx = new Float32Array(count);
    this.heroParticleScratchAy = new Float32Array(count);
  }

  private encodeHeroBandAffinity(bandAffinity: HeroBandAffinity): number {
    if (bandAffinity === "low") {
      return 0;
    }
    if (bandAffinity === "mid") {
      return 1;
    }
    return 2;
  }

  private decodeHeroBandAffinity(value: number): HeroBandAffinity {
    if (value === 0) {
      return "low";
    }
    if (value === 1) {
      return "mid";
    }
    return "high";
  }

  private appendHeroParticle(buffers: HeroParticleBuffers, particle: HeroPhysicsParticle): HeroParticleBuffers {
    const target = this.ensureHeroParticleBuffersCapacity(buffers, buffers.count + 1);
    const index = target.count;
    target.x[index] = particle.x;
    target.y[index] = particle.y;
    target.vx[index] = particle.vx;
    target.vy[index] = particle.vy;
    target.ax[index] = particle.ax;
    target.ay[index] = particle.ay;
    target.heat[index] = particle.heat;
    target.size[index] = particle.size;
    target.drag[index] = particle.drag;
    target.alpha[index] = particle.alpha;
    target.age[index] = particle.age;
    target.ttl[index] = particle.ttl;
    target.bandAffinity[index] = this.encodeHeroBandAffinity(particle.bandAffinity);
    target.count += 1;
    return target;
  }

  private integrateHeroParticleList(
    particles: HeroParticleBuffers,
    width: number,
    height: number,
    edgeForce?: {
      scale: number;
      bypassSpawnDrag: boolean;
    },
  ): HeroParticleBuffers {
    if (particles.count === 0) {
      return particles;
    }
    const count = particles.count;
    const { x, y, vx, vy, ax, ay, heat, size, drag, alpha, age, ttl, bandAffinity } = particles;
    this.ensureHeroParticleScratchCapacity(count);
    const appliedAx = this.heroParticleScratchAx;
    const appliedAy = this.heroParticleScratchAy;
    for (let index = 0; index < count; index += 1) {
      appliedAx[index] = ax[index]!;
      appliedAy[index] = ay[index]!;
      if (edgeForce && edgeForce.scale > 0) {
        const edgeDx = x[index]! < width * 0.5 ? -1 : 1;
        const edgeDy = y[index]! < height * 0.5 ? -1 : 1;
        const xDistance = Math.min(x[index]!, width - x[index]!);
        const yDistance = Math.min(y[index]!, height - y[index]!);
        const attractionX = edgeDx * edgeForce.scale / Math.max(24, xDistance + 12);
        const attractionY = edgeDy * edgeForce.scale / Math.max(24, yDistance + 12);
        appliedAx[index] += attractionX;
        appliedAy[index] += attractionY;
        if (edgeForce.bypassSpawnDrag) {
          vx[index] += attractionX;
          vy[index] += attractionY;
        }
      }
    }
    applyHeroParticleBatchWasm({ count, x, y, vx, vy, ax: appliedAx, ay: appliedAy, heat, size, drag, age, ttl, width, height });
    let survivorCount = 0;
    for (let index = 0; index < count; index += 1) {
      const speed = Math.hypot(vx[index]!, vy[index]!);
      if (speed > HERO_EMITTED_PARTICLE_TOP_SPEED) {
        const scale = HERO_EMITTED_PARTICLE_TOP_SPEED / Math.max(0.0001, speed);
        vx[index] *= scale;
        vy[index] *= scale;
      }
      const edgeDistance = Math.min(x[index]!, width - x[index]!, y[index]!, height - y[index]!);
      const edgeProximity = clamp(1 - edgeDistance / 72, 0, 1);
      if (edgeProximity > 0) {
        size[index] *= 1 - edgeProximity * 0.18;
        heat[index] *= 1 - edgeProximity * 0.22;
        age[index] = Math.min(ttl[index]!, age[index]! + Math.round(edgeProximity * 3));
      }
      if (age[index]! >= ttl[index]! || heat[index]! <= 0.015 || size[index]! <= 0.08) {
        continue;
      }
      if (survivorCount !== index) {
        x[survivorCount] = x[index]!;
        y[survivorCount] = y[index]!;
        vx[survivorCount] = vx[index]!;
        vy[survivorCount] = vy[index]!;
        ax[survivorCount] = ax[index]!;
        ay[survivorCount] = ay[index]!;
        heat[survivorCount] = heat[index]!;
        size[survivorCount] = size[index]!;
        drag[survivorCount] = drag[index]!;
        alpha[survivorCount] = alpha[index]!;
        age[survivorCount] = age[index]!;
        ttl[survivorCount] = ttl[index]!;
        bandAffinity[survivorCount] = bandAffinity[index]!;
      }
      survivorCount += 1;
    }
    particles.count = survivorCount;
    return particles;
  }

  private shouldTriggerHeldTransition(
    frame: AudioFrameFeature,
    visualState: VisualState,
    edgeMap: EdgeMap,
    activeSubject: ActiveSubjectSnapshot,
    audioTransitionScore: number,
    holdPenalty: number,
  ): boolean {
    if (!this.lastImagePath || this.lastImageIndex <= 0) {
      return false;
    }
    if (frame.frameIndex < this.nextAllowableTransitionFrame) {
      return false;
    }
    if (this.heldTransitionStreak >= 2) {
      return false;
    }
    if (frame.frameIndex - this.lastTransitionEventFrameIndex < Math.max(6, Math.round(this.settings.fps * 0.18))) {
      return false;
    }
    if (this.transitionState && this.transitionProgress(frame) !== undefined) {
      return false;
    }
    if (frame.frameIndex - this.lastSwapFrameIndex > Math.round(this.settings.fps * this.schedule.secondsPerImage * (0.75 + holdPenalty * 0.3))) {
      return false;
    }
    const framesSinceSwap = frame.frameIndex - this.lastSwapFrameIndex;
    if (framesSinceSwap < Math.max(8, Math.round(this.settings.fps * 0.2))) {
      return false;
    }
    if (
      activeSubject.emphasis < 0.22 &&
      frame.peakStrength < 0.42 &&
      frame.onsetStrength < 0.24 &&
      visualState.transitionOpportunityBias < 1.05 &&
      audioTransitionScore < 1.15
    ) {
      return false;
    }
    if (edgeMap.maskConfidence === "low") {
      return false;
    }
    return (
      frame.isPeak ||
      frame.onsetStrength > 0.24 ||
      frame.normalizedHighMid > 0.46 ||
      frame.dbNormalized > 0.58 ||
      audioTransitionScore > 1.2 ||
      visualState.transitionTriggerPreference !== "swap" ||
      visualState.transitionOpportunityBias + holdPenalty > 1.15
    );
  }

  private heroSwapDecision(
    frame: AudioFrameFeature,
    sceneGraph: SceneGraph,
    audioTransitionScore: number,
    bandWeightedTransitionDrive: number,
    hzTransitionDrive: number,
  ): { eligible: boolean; suppressedByGrace: boolean; audioDrive: number } {
    const gracefulBias = this.lastActiveSubjectSnapshot.gracefulBias ?? sceneGraph.heroInstanceSeed.travelStyle.gracefulBias;
    const glitchBias = this.lastActiveSubjectSnapshot.glitchBias ?? sceneGraph.heroInstanceSeed.travelStyle.glitchBias;
    const audioDrive = clamp(
      audioTransitionScore * 0.34 +
      bandWeightedTransitionDrive * 0.32 +
      hzTransitionDrive * 0.22 +
      (frame.isPeak ? 0.14 : 0) +
      (sceneGraph.heroMotifProfile.motionBias === "glitch-hop" ? 0.12 : 0),
      0,
      1.8,
    );
    const suppressedByGrace = gracefulBias >= HERO_SWAP_GRACEFUL_THRESHOLD;
    const threshold = clamp(0.9 - glitchBias * 0.34 - (sceneGraph.heroMotifProfile.motionBias === "glitch-hop" ? 0.1 : 0), 0.34, 0.92);
    return {
      eligible: !suppressedByGrace && audioDrive >= threshold,
      suppressedByGrace,
      audioDrive,
    };
  }

  private preserveHeroType(previous: SceneGraph, current: SceneGraph): SceneGraph {
    return {
      ...current,
      heroPrimitive: previous.heroPrimitive,
      heroPrimitiveFallback: previous.heroPrimitiveFallback,
      heroSubEmitterFamily: previous.heroSubEmitterFamily,
      heroShellMode: previous.heroShellMode,
      heroBaseShellMode: previous.heroBaseShellMode,
      heroResolvedShellMode: previous.heroResolvedShellMode,
      heroCircleShellEligible: previous.heroCircleShellEligible,
      heroCircleShellPromoted: previous.heroCircleShellPromoted,
      heroShellSceneEnabled: previous.heroShellSceneEnabled,
      heroShellConfiguredCount: previous.heroShellConfiguredCount,
      heroShellColorMode: previous.heroShellColorMode,
      heroShellLayers: previous.heroShellLayers,
      heroEmitterOffsets: previous.heroEmitterOffsets,
      heroInstanceSeed: previous.heroInstanceSeed,
      heroGlyphs: previous.heroGlyphs,
    };
  }

  private updateHeroChildField(
    state: HeroChildFieldState,
    frame: AudioFrameFeature,
    directive: HeroEmitterDirective,
    sceneGraph: SceneGraph,
    bandEnergy: BandEnergyProfile,
    motifEffectModifiers: MotifEffectRuntimeModifiers,
    heroDirectives: HeroEmitterDirective[],
    clusterIndex = 0,
    clusterCount = 1,
  ): void {
    if (state.lastFrameIndex === frame.frameIndex) {
      return;
    }
    state.lastFrameIndex = frame.frameIndex;
    const physics = state.physics!;
    const motifProfile = sceneGraph.heroMotifProfile;
    const motifVariant = sceneGraph.heroMotifVariant;
    const particleSpawnScale = this.diagnosticOverrides.particleSpawnScale ?? 1;
    const clusterConfig = sceneGraph.heroClusterConfig;
    const emissionTuning = sceneGraph.heroEmissionTuning;
    const motifIntensityClass = sceneGraph.heroMotifProfile.intensityClass;
    const roleScale = clusterIndex === 0 ? 1 : clusterConfig.satelliteEmissionScale;
    const lowDbEmissionScale = clusterIndex === 0 ? (this.lastActiveSubjectSnapshot.emissionScale ?? 1) : 1;
    const normalizedTrailBudget = Math.min(1.6, 1 + Math.max(0, clusterCount - 1) * clusterConfig.satelliteEmissionScale);
    const normalizedBurstBudget = Math.min(1.5, 1 + Math.max(0, clusterCount - 1) * clusterConfig.satelliteEmissionScale);
    const budgetNormalizer = 1 / Math.max(1, 1 + Math.max(0, clusterCount - 1) * clusterConfig.satelliteEmissionScale);
    const heroSpawnMultiplier =
      motifIntensityClass === "restrained" ? 1.45 :
      motifIntensityClass === "colorful-psychedelic" ? 2 :
      2;
    const heroDirectSpawnScale = 1.5 * particleSpawnScale * roleScale * budgetNormalizer * normalizedTrailBudget * heroSpawnMultiplier * lowDbEmissionScale;
    const heroSubSpawnScale = 4 * particleSpawnScale * roleScale * budgetNormalizer * normalizedBurstBudget * heroSpawnMultiplier * lowDbEmissionScale;
    const trailDurationScale = 5 * motifProfile.trailDurationMultiplier * emissionTuning.ttlScale * 0.9;
    const heroParticleSpeedScale = 1.4;
    const heroEmittedParticleSizeScale = 0.8;
    const heroParticleSizeTaper = 0.8075 - motifVariant.sizeWeight * 0.085;
    const prominence = motifProfile.prominenceBias;
    const motifDragMultiplier =
      motifProfile.variantAxes.dragBias.min +
      (motifProfile.variantAxes.dragBias.max - motifProfile.variantAxes.dragBias.min) * motifVariant.dragWeight;
    const particleScaleBoost =
      motifProfile.particleSizeBaseRange.min +
      (motifProfile.particleSizeBaseRange.max - motifProfile.particleSizeBaseRange.min) * motifVariant.sizeWeight;
    const velocityBoost = 3 * clamp(prominence.particleSpeed * 0.72, 0.9, 1.5) * 1.1;
    physics.trail.capacity = Math.max(
      256,
      Math.round(1536 * 1.25 * (1.2 + motifVariant.densityWeight * 0.08) * roleScale * budgetNormalizer * normalizedTrailBudget),
    );
    physics.burst.particleCapacity = Math.max(
      192,
      Math.round(1024 * 1.25 * (1.15 + motifVariant.densityWeight * 0.06) * roleScale * budgetNormalizer * normalizedBurstBudget),
    );
    physics.residue.capacity = Math.max(
      192,
      Math.round(1024 * 1.25 * (1.1 + motifVariant.densityWeight * 0.04) * roleScale * budgetNormalizer * normalizedBurstBudget),
    );
    const envelopeBase = evaluateMotifPhysicsEnvelope(frame, sceneGraph.motifPhysicsProfile);
    physics.wake.maxSamples = Math.max(physics.wake.maxSamples, Math.round(28 * trailDurationScale));
    const envelope: HeroPhysicsEnvelope = {
      ...envelopeBase,
      thrust: envelopeBase.thrust * prominence.particleSpeed * (0.9 + motifVariant.speedWeight * 0.45) * (this.diagnosticOverrides.thrustGain ?? 1),
      drag: envelopeBase.drag * motifDragMultiplier * 0.5,
      jitterAmplitude: envelopeBase.jitterAmplitude * (this.diagnosticOverrides.jitterGain ?? 1),
      trailEmission: envelopeBase.trailEmission * (0.92 + motifVariant.densityWeight * 0.24) * (this.diagnosticOverrides.trailEmissionGain ?? 1) * motifEffectModifiers.trailEmissionMultiplier,
      trailCooling: envelopeBase.trailCooling * prominence.particleFade * (1 + motifVariant.fadeWeight * 0.3) * (this.diagnosticOverrides.trailCoolingGain ?? 1),
      wakeWidth: envelopeBase.wakeWidth * motifEffectModifiers.wakeWidthMultiplier,
      burstFanout: envelopeBase.burstFanout * (this.diagnosticOverrides.burstFanoutGain ?? 1) * motifEffectModifiers.burstFanoutMultiplier,
      residueSpread: envelopeBase.residueSpread * (this.diagnosticOverrides.residueSpreadGain ?? 1) * motifEffectModifiers.residueSpreadMultiplier,
    };
    const motor = physics.motor;
    const transitionFamilyChanged = state.lastTransitionFamily !== undefined && state.lastTransitionFamily !== this.lastVisualState.transitionFamily;
    const imageChanged = state.lastImageIndex !== undefined && state.lastImageIndex !== this.lastRenderSelection.resolvedImageIndex;
    if (transitionFamilyChanged || imageChanged) {
      physics.wake.samples = [];
      this.lastHeroWakeResetCount += 1;
    }
    state.lastImageIndex = this.lastRenderSelection.resolvedImageIndex;
    state.lastTransitionFamily = this.lastVisualState.transitionFamily;
    if (motor.lastFrameIndex < 0) {
      motor.x = directive.x;
      motor.y = directive.y;
      motor.heading = directive.rotation;
      motor.lastFrameIndex = frame.frameIndex - 1;
    }
    const transientDrive = clamp(frame.peakStrength * 0.45 + frame.onsetStrength * 0.25 + frame.normalizedHighMid * 0.2 + frame.normalizedHigh * 0.1, 0, 1.4);
    const steadyDrive = clamp(frame.normalizedLow * 0.3 + frame.normalizedMid * 0.35 + frame.narrativeIntensity * 0.35, 0, 1.2);
    const { dbDrive, hzDrive, audioSpeedDrive } = computeHeroAudioDrive(frame, transientDrive);
    const audioSpawnDrive = computeHeroSpawnAudioDrive(dbDrive, hzDrive, transientDrive);
    const expandedBandDrive =
      sceneGraph.heroExpandedBands.reduce((sum, band) => sum + expandedBandValue(frame, band), 0) /
      Math.max(1, sceneGraph.heroExpandedBands.length);
    const { heroBaselineEmissionScale, heroZeroDbRecovery, zeroDbEmissionRecovery } = computeHeroEmissionRecovery(dbDrive);
    this.lastHeroBaselineEmissionScale = heroBaselineEmissionScale;
    this.lastHeroZeroDbRecovery = heroZeroDbRecovery;
    const glitchParticleShift = clamp(
      (motifProfile.motionBias === "glitch-hop" ? 0.28 : 0) +
      motifVariant.warpWeight * 0.24 +
      motifVariant.inconsistencyWeight * 0.22 +
      sceneGraph.heroInstanceSeed.travelStyle.glitchBias * 0.16 +
      transientDrive * 0.12 +
      motor.jitter * 1.4 +
      ((frame.isBeatAccent ? 0.06 : 0) + (frame.isPeak ? 0.08 : 0)),
      0,
      1,
    );
    const heroParticleMaxSpeedScale = 1 + clamp(transientDrive * 0.35 + motifVariant.speedWeight * 0.65, 0, 1);
    const screenEdgeAimBias = this.screenEdgeAimBiasAt(directive.x, directive.y);
    const directionJitter =
      Math.sin(frame.timeSec * (2 + envelope.jitterFrequency * 3.2) + state.seed * 0.01) * envelope.jitterAmplitude * clamp(0.04 + transientDrive * 0.12, 0.04, 0.16) +
      Math.cos(frame.timeSec * (4.4 + envelope.jitterFrequency * 2.0) + sceneGraph.continuitySeed * 0.013) * envelope.jitterAmplitude * clamp(0.02 + transientDrive * 0.06, 0.02, 0.08);
    const targetHeadingBias = this.biasHeadingTowardCanvasCenter(
      directive.rotation + directionJitter,
      directive.x,
      directive.y,
      1,
      0.55,
    );
    const targetHeading = targetHeadingBias.heading;
    const headingFollowFactor = clamp(0.18 + transientDrive * 0.18 - envelope.smoothBias * 0.04, 0.18, 0.42);
    const previousHeading = motor.heading;
    motor.heading = previousHeading + (targetHeading - previousHeading) * headingFollowFactor;
    this.lastScreenEdgeAimBias = screenEdgeAimBias;
    this.lastStreamCenterBiasDegrees = targetHeadingBias.degrees;
    const baseMotionContribution = 0.68 * 0.1 * 0.8;
    const audioReactiveContribution = transientDrive * envelope.transientSpeedGain * 0.34 * (1 + audioSpeedDrive * 2.5);
    const thrustGain = (baseMotionContribution + audioReactiveContribution) * velocityBoost;
    const dampingBase = clamp(0.88 - envelope.drag * 0.07 - transientDrive * 0.04 + steadyDrive * envelope.steadySpeedDamping * 0.05, 0.68, 0.92);
    const damping = clamp(1 - (1 - dampingBase) * 1.365, 0.56, 0.895);
    motor.ax = Math.cos(motor.heading) * envelope.thrust * thrustGain;
    motor.ay = Math.sin(motor.heading) * envelope.thrust * thrustGain;
    motor.vx = (motor.vx + motor.ax) * damping;
    motor.vy = (motor.vy + motor.ay) * damping;
    motor.x = directive.x + motor.vx * 2.2;
    motor.y = directive.y + motor.vy * 2.2;
    motor.fuel = clamp(motor.fuel - envelope.massDrain * 0.0025, 0.08, 1);
    motor.burnPhase = 1 - motor.fuel;
    motor.jitter = Math.abs(directionJitter);
    motor.lastFrameIndex = frame.frameIndex;

    physics.wake.samples.unshift({
      x: motor.x,
      y: motor.y,
      heat: envelope.trailHeat,
      width: directive.size * clamp(0.2 + envelope.wakeWidth * 0.16, 0.16, 0.48),
      age: 0,
      heading: motor.heading,
    });
    physics.wake.samples = physics.wake.samples
      .slice(0, physics.wake.maxSamples)
      .map((sample, index) => ({
        ...sample,
        age: index,
        heat: clamp(
          sample.heat *
            (index > 0 && Math.abs(sample.heading - motor.heading) > 0.32 ? 0.45 : 1) -
            envelope.trailCooling * 0.024 * Math.max(1, index),
          0,
          1,
        ),
      }))
      .filter((sample) => sample.age <= Math.round(10 * trailDurationScale) && sample.heat > 0.03);

    this.lastEdgeAttractionScale = emissionTuning.edgeAttractionScale * 1.5;
    const edgeForce = {
      scale: this.lastEdgeAttractionScale * 0.24 * motifEffectModifiers.driftFieldMultiplier,
      bypassSpawnDrag: emissionTuning.edgeAttractionBypassSpawnDrag,
    };
    physics.trail.particles = this.integrateHeroParticleList(physics.trail.particles, this.settings.width, this.settings.height, edgeForce);
    physics.burst.particles = this.integrateHeroParticleList(physics.burst.particles, this.settings.width, this.settings.height, edgeForce);
    physics.residue.particles = this.integrateHeroParticleList(physics.residue.particles, this.settings.width, this.settings.height, edgeForce);
    physics.burst.subsystems = physics.burst.subsystems
      .map((subsystem) => ({ ...subsystem, age: subsystem.age + 1 }))
      .filter((subsystem) => subsystem.age < subsystem.ttl);

    let lowUsage = 0;
    let midUsage = 0;
    let highUsage = 0;
    const baseSpawnBudget = (10 + envelope.trailEmission * 14 + bandEnergy.mid * 3 + motifVariant.densityWeight * 8) * 0.1;
    const audioReactiveSpawnBudget =
      (transientDrive * 10 + dbDrive * 8 + hzDrive * 10) * 3.5 +
      expandedBandDrive * 8 +
      (frame.isBeatAccent ? 4 : 0) +
      (frame.isFourBarDownbeat ? 6 : 0);
    const trailSpawnBudget = Math.min(128, Math.max(4, Math.round((baseSpawnBudget + audioReactiveSpawnBudget) * 1.25 * heroDirectSpawnScale * zeroDbEmissionRecovery)));
    physics.trail.particles = this.ensureHeroParticleBuffersCapacity(physics.trail.particles, physics.trail.capacity);
    physics.burst.particles = this.ensureHeroParticleBuffersCapacity(physics.burst.particles, physics.burst.particleCapacity);
    physics.residue.particles = this.ensureHeroParticleBuffersCapacity(physics.residue.particles, physics.residue.capacity);
    for (let spawn = 0; spawn < trailSpawnBudget && physics.trail.particles.count < physics.trail.capacity; spawn += 1) {
      const defaultBandAffinity: HeroBandAffinity =
        motifProfile.spawnTimingMode === "all-band-split"
          ? (spawn % 3 === 0 ? "low" : spawn % 3 === 1 ? "mid" : "high")
          : (spawn % 5 === 0 ? "high" : spawn % 3 === 0 ? "low" : "mid");
      const emitterIndex = spawn % Math.max(1, directive.subEmitters.length);
      const emitter =
        (motifProfile.spawnTimingMode === "all-band-split"
          ? directive.subEmitters.find((candidate) => candidate.bandAffinity === defaultBandAffinity)
          : undefined) ??
        directive.subEmitters[emitterIndex] ??
        directive.subEmitters[0];
      const useDirectSpawn =
        (motifProfile.nonSubEmitterParticleBias ?? sceneGraph.nonSubEmitterHeroParticleBias) > 0 &&
        stableImageSeed(sceneGraph.imagePath, spawn + frame.frameIndex + clusterIndex * 17) % 100 < Math.round((motifProfile.nonSubEmitterParticleBias ?? sceneGraph.nonSubEmitterHeroParticleBias) * 100);
      const emitterPosition = useDirectSpawn
        ? this.resolveHeroDirectSpawnPosition(frame, directive, motifProfile, physics.wake.samples, spawn)
        : emitter
          ? this.resolveHeroSubEmitterPosition(frame, directive, emitter, emitterIndex)
          : { x: directive.x, y: directive.y, rotation: directive.rotation };
      const phase = frame.timeSec * (1.2 + spawn * 0.02);
      const motifSpreadBias =
        sceneGraph.motifPhysicsProfile.motif === "smoke-ribbon" ? 1.18 :
        sceneGraph.motifPhysicsProfile.motif === "shattered-arc" ? 0.82 :
        sceneGraph.motifPhysicsProfile.motif === "cathedral-filament" ? 0.74 :
        sceneGraph.motifPhysicsProfile.motif === "halo-cell" ? 1.06 :
        sceneGraph.motifPhysicsProfile.motif === "glass-orbital" ? 0.78 :
        0.9;
      const baseSpread = envelope.residueSpread * 0.2 * motifSpreadBias;
      const spreadEnergy = clamp(envelope.residueSpread / 4, 0, 1);
      const spreadMultiplier =
        HERO_PROJECTILE_SPREAD_MIN_MULTIPLIER +
        (HERO_PROJECTILE_SPREAD_MAX_MULTIPLIER - HERO_PROJECTILE_SPREAD_MIN_MULTIPLIER) * spreadEnergy;
      const resolvedSpread = baseSpread * spreadMultiplier;
      const rawAngle = motor.heading + Math.PI + Math.sin(phase + spawn * 0.3) * resolvedSpread * emissionTuning.warpFactorScale;
      const baseSpeedContribution = (0.54 + motifVariant.speedWeight * 0.18) * 0.1 * 0.8;
      const reactiveSpeedContribution = (transientDrive * 0.42 + audioSpeedDrive * 0.3) * 2.5;
      const speed = Math.max(0.84, envelope.thrust * velocityBoost * (baseSpeedContribution + reactiveSpeedContribution) * (emitter?.childSpeed ?? 1) * heroDirectSpawnScale * heroParticleSpeedScale * heroParticleMaxSpeedScale * heroZeroDbRecovery);
      const seededScale = 0.5 + sampleNoise2D(frame.frameIndex * 0.11, spawn * 0.17, physics.seed + spawn) * 0.05 + 0.05;
      const sizeVarianceMode = motifProfile.particleSizeVarianceMode;
      const varianceAmplitude =
        sizeVarianceMode === "tight" ? 0.12 :
        sizeVarianceMode === "medium" ? 0.28 :
        sizeVarianceMode === "wide" ? 0.52 :
        0.9;
      const sizeVariance = 1 + (sampleNoise2D(frame.frameIndex * 0.09, spawn * 0.21, physics.seed + spawn * 7) - 0.5) * varianceAmplitude;
      const bandAffinity = defaultBandAffinity;
      if (!this.heroSpawnTimingAllows(frame, motifProfile, bandAffinity)) {
        continue;
      }
      const localX = (useDirectSpawn ? 0 : (emitter?.spawnX ?? 0)) + Math.sin(phase + spawn * 0.37) * (useDirectSpawn ? 0.22 : (emitter?.spawnXRange ?? 0.16));
      const localY = (useDirectSpawn ? 0 : (emitter?.spawnY ?? 0)) + Math.cos(phase * 0.9 + spawn * 0.29) * (useDirectSpawn ? 0.16 : (emitter?.spawnYRange ?? 0.12));
      const spawnRotation = this.biasHeadingTowardCanvasCenter(
        emitterPosition.rotation,
        emitterPosition.x,
        emitterPosition.y,
        1,
        0.35,
      ).heading;
      const rotatedSpawnX = emitterPosition.x + (localX * directive.size) * Math.cos(spawnRotation) - (localY * directive.size) * Math.sin(spawnRotation);
      const rotatedSpawnY = emitterPosition.y + (localX * directive.size) * Math.sin(spawnRotation) + (localY * directive.size) * Math.cos(spawnRotation);
      const angleBias = this.biasHeadingTowardCanvasCenter(rawAngle, rotatedSpawnX, rotatedSpawnY, 1, 0.15);
      const angle = angleBias.heading;
      this.recordCenterwardEmissionSample(rotatedSpawnX, rotatedSpawnY, angle, angleBias.pull);
      const speedBoost =
        (emitter?.motionMode === "atomic-gravity" ? 1.32 :
        emitter?.motionMode === "revolve-hero" ? 1.18 :
        emitter?.motionMode === "patrol" ? 1.08 :
        emitter?.motionMode === "orbit-hero" ? 1.14 :
        1.02) * heroSubSpawnScale * zeroDbEmissionRecovery * heroParticleSpeedScale * heroParticleMaxSpeedScale * heroZeroDbRecovery;
      physics.trail.particles = this.appendHeroParticle(physics.trail.particles, {
        x: rotatedSpawnX + motor.vx * 0.55,
        y: rotatedSpawnY + motor.vy * 0.55,
        vx: Math.cos(angle) * speed * seededScale,
        vy: Math.sin(angle) * speed * seededScale,
        ax: Math.cos(angle) * 0.02,
        ay: Math.sin(angle) * 0.02,
        heat: clamp(envelope.trailHeat * (0.86 + spawn / Math.max(1, trailSpawnBudget) * 0.18), 0, 1.4),
        size: directive.size * particleScaleBoost * sizeVariance * (0.82 + motifVariant.sizeWeight * 0.42) * clamp(0.04 + envelope.wakeWidth * 0.06, 0.04, 0.2) * 4.5 * heroParticleSizeTaper * heroEmittedParticleSizeScale,
        age: 0,
        ttl: Math.max(12, Math.round(((18 + envelope.trailEmission * 10) / (prominence.particleFade * (0.9 + motifVariant.fadeWeight * 0.4))) * trailDurationScale * (emitter?.childLifetime ?? 1))),
        drag: clamp((0.82 - envelope.drag * 0.1) * 0.9 * emissionTuning.dragScale * 1.05, 0.38, 0.9),
        alpha: clamp((0.16 + envelope.trailHeat * 0.14) * (1.02 + motifVariant.sizeWeight * 0.18), 0.12, 0.46),
        bandAffinity,
      });
      const spawnedTrailIndex = physics.trail.particles.count - 1;
      physics.trail.particles.vx[spawnedTrailIndex] *= speedBoost;
      physics.trail.particles.vy[spawnedTrailIndex] *= speedBoost;
      if (bandAffinity === "low") {
        lowUsage += 1;
      } else if (bandAffinity === "mid") {
        midUsage += 1;
      } else {
        highUsage += 1;
      }
    }

    const lowBurstDrive = Math.max(frame.normalizedLow, expandedBandValue(frame, "subLow")) * 1.2;
    const midBurstDrive = frame.normalizedMid * 1.2;
    const highBurstDrive = Math.max(frame.normalizedHigh, frame.normalizedHighMid) * 1.2;
    const burstDrive = clamp(
      lowBurstDrive * 0.28 +
      midBurstDrive * 0.34 +
      highBurstDrive * 0.38 +
      (frame.isBeatAccent ? 0.18 : 0) +
      (frame.isFourBarDownbeat ? 0.24 : 0),
      0,
      1.6,
    );
    const dbBurstGate = clamp(frame.dbNormalized * 0.54 + dbDrive * 0.46 + (frame.isPeak ? 0.08 : 0), 0, 1.8);
    const hzBurstGate = clamp(expandedBandDrive * 0.52 + burstDrive * 0.48 + (frame.isBeatAccent ? 0.08 : 0), 0, 1.8);
    const burstGateScore = Math.max(dbBurstGate, hzBurstGate);
    const burstGateThreshold = clamp(
      0.56 -
      motifVariant.densityWeight * 0.08 -
      motifVariant.speedWeight * 0.04 -
      envelope.burstProbability * 0.06 -
      (sceneGraph.heroMotifProfile.intensityClass === "colorful-psychedelic" ? 0.04 : 0),
      0.36,
      0.72,
    );
    const recentGateScores = physics.burst.recentGateScores ?? [];
    recentGateScores.push(burstGateScore);
    const recentGateHistoryLimit = Math.max(6, Math.round(this.settings.fps * (120 / Math.max(1, this.bpm))));
    while (recentGateScores.length > recentGateHistoryLimit) {
      recentGateScores.shift();
    }
    physics.burst.recentGateScores = recentGateScores;
    const sortedGateScores = [...recentGateScores].sort((a, b) => a - b);
    const quartileIndex = Math.min(sortedGateScores.length - 1, Math.max(0, Math.floor(sortedGateScores.length * 0.75)));
    const topQuartileThreshold = sortedGateScores[quartileIndex] ?? burstGateScore;
    const topQuartileSlowdown = burstGateScore >= topQuartileThreshold && recentGateScores.length >= 4;
    const burstGateActive = burstGateScore >= burstGateThreshold;
    physics.burst.lastGateActive = burstGateActive;
    const cadencePerBeat = burstGateScore >= burstGateThreshold + 0.26 ? 2 : 1;
    const cadenceSlotBase = frame.beatIndex ?? frame.frameIndex;
    const cadenceSubdivision = cadencePerBeat === 2 && frame.subBeatPhase >= 0.5 ? 1 : 0;
    const cadenceSlot = cadenceSlotBase * cadencePerBeat + cadenceSubdivision;
    const cadenceSlotHit = burstGateActive && physics.burst.lastCadenceSlot !== cadenceSlot;
    if (cadenceSlotHit) {
      physics.burst.lastCadenceSlot = cadenceSlot;
    }
    this.lastHeroBurstGateActiveRatio = burstGateActive ? 1 : 0;
    this.lastHeroBurstCadenceSlotHits = cadenceSlotHit ? 1 : 0;
    this.lastHeroBurstTopQuartileRatio = topQuartileSlowdown ? 1 : 0;
    if (cadenceSlotHit && physics.burst.subsystems.length < physics.burst.subsystemCapacity) {
      const fanout = Math.max(2, Math.min(18, Math.round(envelope.burstFanout * 1.2 * (0.75 + burstDrive * 0.12) * heroDirectSpawnScale * zeroDbEmissionRecovery)));
      physics.burst.subsystems.push({
        x: motor.x,
        y: motor.y,
        heading: motor.heading,
        intensity: envelope.burstVelocity,
        age: 0,
        ttl: 10 + Math.round(envelope.subsystemRecursion * 18),
        fanout,
        recursion: Math.max(0, Math.round(envelope.subsystemRecursion)),
        gateScore: burstGateScore,
        topQuartileSlowdown,
        cadenceSlotHit,
      });
      const burstArc = (Math.PI * (0.92 + Math.min(0.4, burstDrive * 0.08))) * 1.2;
      for (let index = 0; index < fanout && physics.burst.particles.count < physics.burst.particleCapacity; index += 1) {
        const burstT = fanout <= 1 ? 0.5 : index / Math.max(1, fanout - 1);
        const rawAngle = motor.heading - burstArc * 0.5 + burstArc * burstT + Math.sin(frame.timeSec + index) * 0.08;
        const angleBias = this.biasHeadingTowardCanvasCenter(rawAngle, motor.x, motor.y, 1, 0.1);
        const angle = angleBias.heading;
        this.recordCenterwardEmissionSample(motor.x, motor.y, angle, angleBias.pull);
        const momentumScale =
          (0.96 + sampleNoise2D(frame.frameIndex * 0.13, index * 0.29, physics.seed + index * 19) * 0.1) *
          (topQuartileSlowdown ? 0.9 : 1);
        physics.burst.particles = this.appendHeroParticle(physics.burst.particles, {
          x: motor.x,
          y: motor.y,
          vx: Math.cos(angle) * envelope.burstVelocity * velocityBoost * (2.2 + motifVariant.speedWeight * 0.5) * heroSubSpawnScale * zeroDbEmissionRecovery * heroParticleSpeedScale * heroParticleMaxSpeedScale * heroZeroDbRecovery * 1.1 * momentumScale,
          vy: Math.sin(angle) * envelope.burstVelocity * velocityBoost * (2.2 + motifVariant.speedWeight * 0.5) * heroSubSpawnScale * zeroDbEmissionRecovery * heroParticleSpeedScale * heroParticleMaxSpeedScale * heroZeroDbRecovery * 1.1 * momentumScale,
          ax: Math.cos(angle) * 0.01,
          ay: Math.sin(angle) * 0.01,
          heat: clamp(envelope.trailHeat * 1.18, 0, 1.6),
          size: directive.size * 0.08 * particleScaleBoost * (0.84 + motifVariant.sizeWeight * 0.36) * (
            1 + (sampleNoise2D(frame.frameIndex * 0.07, index * 0.19, physics.seed + index * 11) - 0.5) *
            (motifProfile.particleSizeVarianceMode === "tight" ? 0.08 : motifProfile.particleSizeVarianceMode === "medium" ? 0.2 : motifProfile.particleSizeVarianceMode === "wide" ? 0.42 : 0.72)
          ) * 4.5 * heroParticleSizeTaper * heroEmittedParticleSizeScale,
          age: 0,
          ttl: Math.max(10, Math.round(((16 + envelope.burstVelocity * 18) / (prominence.particleFade * (0.94 + motifVariant.fadeWeight * 0.32))) * trailDurationScale)),
          drag: clamp((0.84 - envelope.drag * 0.08) * 0.9 * emissionTuning.dragScale * 1.05, 0.4, 0.92),
          alpha: clamp(0.28 * (1.02 + motifVariant.speedWeight * 0.12), 0.2, 0.42),
            bandAffinity: (index % 2 === 0 ? "high" : "mid") as HeroBandAffinity,
        });
      }
    }

    const trailConductors = this.applyConductorInfluence(physics.trail.particles, frame, directive, sceneGraph, heroDirectives);
    const burstConductors = this.applyConductorInfluence(physics.burst.particles, frame, directive, sceneGraph, heroDirectives, physics.trail.particles.count);
    const conductorStates = [...trailConductors, ...burstConductors];
    this.applyHeroImpactParticleWarp(physics.trail.particles, frame, directive, heroDirectives);
    this.applyHeroImpactParticleWarp(physics.burst.particles, frame, directive, heroDirectives);
    this.applyHeroImpactParticleWarp(physics.residue.particles, frame, directive, heroDirectives);
    const totalSceneNodes = sceneGraph.supportAttractors.length + sceneGraph.backgroundAttractors.length;
    this.lastHeroConductorCount = conductorStates.length;
    this.lastHeroConductorType = conductorStates[0]?.type ?? sceneGraph.heroConductorSelection.primary;
    this.lastHeroConductorInfluenceRadiusAvg =
      conductorStates.reduce((sum, conductor) => sum + conductor.radius, 0) / Math.max(1, conductorStates.length);
    this.lastHeroCircleEmitterNodeCoverage =
      sceneGraph.heroCircleEmitterNodeIndices.length / Math.max(1, totalSceneNodes);
    this.lastHeroExpandedBandCount = sceneGraph.heroExpandedBands.length;

    state.particles = [];
    for (const [index, subsystem] of physics.burst.subsystems.filter((candidate) => candidate.age < candidate.ttl).slice(0, 12).entries()) {
      if (
        sceneGraph.heroCircleEmitterNodeIndices.length > 0 &&
        !sceneGraph.heroCircleEmitterNodeIndices.includes(index % Math.max(1, totalSceneNodes))
      ) {
        continue;
      }
      const lifeT = clamp(subsystem.age / Math.max(1, subsystem.ttl), 0, 1);
      state.particles.push({
        x: subsystem.x,
        y: subsystem.y,
        vx: 0,
        vy: 0,
        age: subsystem.age,
        ttl: subsystem.ttl,
        size: directive.size * (0.54 + subsystem.intensity * 0.44 + lifeT * 0.9),
        alpha: clamp((0.2 + subsystem.intensity * 0.24) * (1 - lifeT) * 0.9, 0.04, 0.3),
        primitive: "circle",
        bandAffinity: (index % 2 === 0 ? "low" : "mid") as HeroBandAffinity,
        emitterIndex: 0,
        phase: frame.timeSec + index * 0.11,
        mode: "aoe-ring",
        outlineAlpha: clamp((0.24 + subsystem.intensity * 0.28) * (1 - lifeT * 0.82), 0.08, 0.42),
        fillAlpha: clamp((0.04 + subsystem.intensity * 0.06) * (1 - lifeT) * 0.8, 0.008, 0.08),
      });
    }
    const trailRenderCount = Math.min(128, physics.trail.particles.count);
    for (let index = 0; index < trailRenderCount; index += 1) {
      const bandAffinity = this.decodeHeroBandAffinity(physics.trail.particles.bandAffinity[index]!);
      const conductor = conductorStates[index];
      state.particles.push({
        x: physics.trail.particles.x[index]!,
        y: physics.trail.particles.y[index]!,
        vx: physics.trail.particles.vx[index]!,
        vy: physics.trail.particles.vy[index]!,
        age: physics.trail.particles.age[index]!,
        ttl: physics.trail.particles.ttl[index]!,
        size: physics.trail.particles.size[index]!,
        alpha: physics.trail.particles.alpha[index]! * clamp(physics.trail.particles.heat[index]!, 0.08, 1),
        primitive: chooseHeroParticlePrimitive({
          frameIndex: frame.frameIndex,
          spawnIndex: index,
          basePrimitive: directive.primitive,
          emissionPrimitivePool: motifProfile.emissionPrimitivePool,
          childPrimitiveMix: sceneGraph.heroInstanceSeed.childPrimitiveMix,
          bandAffinity,
          glitchParticleShift,
        }),
        bandAffinity,
        emitterIndex: index % Math.max(1, directive.subEmitters.length),
        phase: frame.timeSec,
        mode: (bandAffinity === "high" ? "spoke" : bandAffinity === "low" ? "drip" : "wake") as HeroChildMode,
        isConductor: !!conductor,
        conductorType: conductor?.type,
        conductorStrength: conductor?.strength,
        conductorRadius: conductor?.radius,
        conductorPhaseOffset: conductor?.phaseOffset,
        conductorBandMask: conductor?.bandMask,
      });
    }
    const burstRenderCount = Math.min(96, physics.burst.particles.count);
    for (let index = 0; index < burstRenderCount; index += 1) {
      const bandAffinity = this.decodeHeroBandAffinity(physics.burst.particles.bandAffinity[index]!);
      const conductor = conductorStates[trailRenderCount + index];
      state.particles.push({
        x: physics.burst.particles.x[index]!,
        y: physics.burst.particles.y[index]!,
        vx: physics.burst.particles.vx[index]!,
        vy: physics.burst.particles.vy[index]!,
        age: physics.burst.particles.age[index]!,
        ttl: physics.burst.particles.ttl[index]!,
        size: physics.burst.particles.size[index]! * 1.2,
        alpha: physics.burst.particles.alpha[index]! * clamp(physics.burst.particles.heat[index]!, 0.08, 1),
        primitive: chooseHeroParticlePrimitive({
          frameIndex: frame.frameIndex,
          spawnIndex: index + trailSpawnBudget,
          basePrimitive: directive.subEmitters[index % Math.max(1, directive.subEmitters.length)]?.primitive ?? directive.primitive,
          emissionPrimitivePool: motifProfile.emissionPrimitivePool,
          childPrimitiveMix: sceneGraph.heroInstanceSeed.childPrimitiveMix,
          bandAffinity,
          glitchParticleShift,
        }),
        bandAffinity,
        emitterIndex: index % Math.max(1, directive.subEmitters.length),
        phase: frame.timeSec,
        mode: "spoke",
        isConductor: !!conductor,
        conductorType: conductor?.type,
        conductorStrength: conductor?.strength,
        conductorRadius: conductor?.radius,
        conductorPhaseOffset: conductor?.phaseOffset,
        conductorBandMask: conductor?.bandMask,
      });
    }
    const total = Math.max(1, lowUsage + midUsage + highUsage);
    const speedMagnitude = Math.hypot(motor.vx, motor.vy);
    this.squeezeHeroParticleSizeExtremes(state.particles);
    this.lastHeroChildEmissionRate = trailSpawnBudget;
    this.lastHeroChildFieldDensity = state.particles.length / Math.max(1, physics.trail.capacity * 0.1);
    this.lastHeroChildFieldRadius = directive.size * 1.9;
    this.lastHeroTrailOccupancy = physics.trail.particles.count / Math.max(1, physics.trail.capacity);
    this.lastHeroWakeLengthPx = physics.wake.samples.reduce((sum, sample, index, arr) => {
      if (index === 0) {
        return sum;
      }
      const previous = arr[index - 1]!;
      return sum + Math.hypot(sample.x - previous.x, sample.y - previous.y);
    }, 0);
    this.lastHeroBurstCount = physics.burst.subsystems.length;
    this.lastHeroBurstChildren = physics.burst.particles.count;
    this.lastHeroMotorJitter = motor.jitter;
    this.lastHeroMotorThrust = envelope.thrust;
    this.lastHeroBurnPhase = motor.burnPhase;
    this.lastHeroWakeTailAgeAvg = physics.wake.samples.reduce((sum, sample) => sum + sample.age, 0) / Math.max(1, physics.wake.samples.length);
    this.lastHeroSpeedAvg = this.lastHeroSpeedAvg * 0.82 + speedMagnitude * 0.18;
    this.lastHeroSpeedPeak = Math.max(this.lastHeroSpeedPeak * 0.98, speedMagnitude);
    this.lastMotifPotencyScore =
      clamp(
        envelope.trailEmission * 0.22 +
        envelope.burstFanout * 0.08 +
        envelope.residueSpread * 0.18 +
        envelope.wakeWidth * 0.16 +
        transientDrive * 0.08 + audioSpawnDrive * 0.08,
        0,
        1,
      );
    this.lastHeroBandLowUsage = lowUsage / total;
    this.lastHeroBandMidUsage = midUsage / total;
    this.lastHeroBandHighUsage = highUsage / total;
    this.lastHeroParticleSizeAvg = state.particles.reduce((sum, particle) => sum + particle.size, 0) / Math.max(1, state.particles.length);
    this.lastHeroParticleTtlAvg = state.particles.reduce((sum, particle) => sum + particle.ttl, 0) / Math.max(1, state.particles.length);
  }

  private squeezeHeroParticleSizeExtremes(particles: HeroChildFieldState["particles"]): void {
    const eligible = particles
      .map((particle, index) => ({ index, size: particle.size, mode: particle.mode }))
      .filter((particle) => particle.mode !== "aoe-ring");
    if (eligible.length < 2) {
      return;
    }
    const bandCount = Math.max(1, Math.floor(eligible.length * 0.1));
    const ordered = [...eligible].sort((a, b) => a.size - b.size || a.index - b.index);
    const smallest = ordered.slice(0, bandCount);
    const largest = ordered.slice(Math.max(0, ordered.length - bandCount));
    const resized = new Set<number>();
    for (const entry of smallest) {
      particles[entry.index]!.size *= 1.05;
      resized.add(entry.index);
    }
    for (const entry of largest) {
      if (resized.has(entry.index)) {
        continue;
      }
      particles[entry.index]!.size *= 0.95;
    }
  }

  private drawHeroChildField(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    state: HeroChildFieldState,
    directive: HeroEmitterDirective,
  ): void {
    const startedAt = performance.now();
    const sceneGraphForImage = this.sceneGraphCache.get(this.lastImagePath);
    const motifProfile: HeroMotifProfile = this.sceneGraphCache.get(this.lastImagePath)?.heroMotifProfile ?? {
      key: "glass-orbital",
      intensityClass: "standard",
      influenceKey: "default-glass-orbital",
      heroPrimitivePool: ["lens", "ring", "ellipse"],
      fallbackHeroPrimitivePool: ["circle", "sector"],
      emissionPrimitivePool: ["arc", "lens", "ring"],
      fillBias: "ring-fill",
      deformationBias: "pulse",
      motionBias: "ritual-orbit",
      edgeAttachmentBias: 1,
      particleSizeBaseRange: { min: 1.6, max: 2.0 },
      particleSizeVarianceMode: "medium",
      particleExitTint: "white-bleach",
      colorProminence: { core: 1, shell: 1, particles: 1 },
      spinProfile: { gracefulSpin: 0.2, glitchSpin: 0.14, jerkStrength: 0.1 },
      particleSpawnRegion: { x: 0, y: 0, xRange: 0.2, yRange: 0.12 },
      variantAxes: {
        sizeBias: { min: 0.8, max: 1 },
        speedBias: { min: 0.9, max: 1.05 },
        fadeBias: { min: 0.9, max: 1.1 },
        warpBias: { min: 0.2, max: 0.45 },
        inconsistencyBias: { min: 0.08, max: 0.22 },
        gravityBias: { min: 0.06, max: 0.2 },
        densityBias: { min: 0.9, max: 1.1 },
        dragBias: { min: 0.28, max: 0.48 },
      },
      prominenceBias: {
        coreScale: 1,
        coreAlpha: 1,
        outlineAlpha: 1,
        contrastLift: 1,
        particleScale: 1,
        particleSpeed: 1,
        particleFade: 1,
      },
      trailDurationMultiplier: 1,
      spawnTimingMode: "continuous",
      clusterConfig: {
        enabled: false,
        count: 1,
        layout: "bilateral",
        relationshipMode: "independent",
        satelliteScale: 0.72,
        satelliteEmissionScale: 0.78,
        satelliteAlphaScale: 0.84,
        satellitePathOffsetRadius: 0.38,
        sharedCoreBias: 0.18,
        mirrorAxisBias: 0.22,
        satellitePhaseLock: 0.24,
      },
      emissionTuning: {
        warpFactorScale: 1.08,
        warpVisualScale: 1.08,
        ttlScale: 1.4,
        dragScale: 1.1,
        colorfulnessScale: 1.4,
        edgeAttractionScale: 3,
        edgeAttractionBypassSpawnDrag: true,
        colorRangeMode: "medium",
      },
      transitionBias: {
        preferredFamilies: ["carry"],
        warpiness: 0.4,
        symmetry: 0.4,
        disruption: 0.3,
        timingJitter: 0.2,
        widthBias: 0.5,
        potencyBias: 0.5,
      },
      warpProfile: {
        xBand: "low",
        yBand: "highMid",
        xBaseMultiplier: 1.15,
        yBaseMultiplier: 1.1,
        xExtremeMultiplier: 1.8,
        yExtremeMultiplier: 1.6,
      },
    };
    const emissionTuning = motifProfile.emissionTuning;
    const colorResponseScale = sceneGraphForImage ? this.resolveHeroColorResponseScale(sceneGraphForImage) : 1.1;
    const motifIntensityClass = sceneGraphForImage?.heroMotifProfile.intensityClass ?? motifProfile.intensityClass;
    const extremeColorScale =
      sceneGraphForImage && isExtremeHeroVariant(sceneGraphForImage.heroMotifVariant, sceneGraphForImage.heroEmissionTuning)
        ? 2
        : 1;
    const particleHueScale =
      motifIntensityClass === "colorful-psychedelic" ? 1.4 :
      motifIntensityClass === "restrained" ? 1 :
      1.1;
    this.lastHeroParticleExitWhiteBias = 0;
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const wake = state.physics?.wake.samples ?? [];
    if (wake.length > 1) {
      for (let index = 1; index < wake.length; index += 1) {
        const head = wake[index - 1]!;
        const tail = wake[index]!;
        const fade = 1 - index / Math.max(1, wake.length);
        const alpha = clamp(Math.min(head.heat, tail.heat) * fade * 0.32, 0, 0.32);
        if (alpha < 0.03) {
          continue;
        }
        this.ctx.strokeStyle = paletteColor(theme, 0.08 + frame.normalizedMid * 0.1 + fade * 0.05, alpha, 14, extremeColorScale);
        this.ctx.lineWidth = Math.max(1, head.width * clamp(0.15 + fade * 0.85, 0.15, 1));
        this.ctx.beginPath();
        this.ctx.moveTo(head.x, head.y);
        this.ctx.lineTo(tail.x, tail.y);
        this.ctx.stroke();
      }
    }
    for (const particle of state.particles) {
      if (particle.mode === "aoe-ring") {
        const lifeT = clamp(particle.age / Math.max(1, particle.ttl), 0, 1);
        const radius = particle.size * (1 + lifeT * 0.65);
        this.ctx.save();
        this.ctx.translate(particle.x, particle.y);
        this.ctx.rotate(particle.phase * 0.08);
        this.ctx.fillStyle = paletteColor(theme, 0.04 + frame.normalizedLow * 0.08, particle.fillAlpha ?? 0.04, 12, particleHueScale * colorResponseScale);
        this.ctx.strokeStyle = plasmaCoreColor(theme, particle.outlineAlpha ?? particle.alpha, 0.08 + frame.normalizedLow * 0.12, particleHueScale * colorResponseScale);
        this.ctx.lineWidth = Math.max(1.4, radius * 0.05);
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
        continue;
      }
      const bandShift = particle.bandAffinity === "low" ? 0.06 : particle.bandAffinity === "mid" ? 0.22 : 0.38;
      const lifeT = clamp(particle.age / Math.max(1, particle.ttl), 0, 1);
      const tintWarmth =
        motifProfile.particleExitTint === "warm-white" ? 0.12 :
        motifProfile.particleExitTint === "cool-white" ? -0.12 :
        0;
      const exitWhiteBias = clamp(Math.max(0, (lifeT - 0.56) / 0.44) ** 1.35, 0, 1);
      const colorRangeBoost =
        emissionTuning.colorRangeMode === "tight" ? 0.55 :
        emissionTuning.colorRangeMode === "medium" ? 0.9 :
        emissionTuning.colorRangeMode === "wide" ? 1.18 :
        1.45;
      const hueShiftBase =
        motifProfile.key === "smoke-ribbon" ? 10 :
        motifProfile.key === "shattered-arc" ? 18 :
        motifProfile.key === "cathedral-filament" ? 4 :
        motifProfile.key === "halo-cell" ? 8 :
        motifProfile.key === "glass-orbital" ? -4 :
        motifProfile.key === "chromatic-xylem" ? 14 :
        motifProfile.key === "data-cathedral" ? -10 :
        motifProfile.key === "mandelbloom" ? 12 :
        motifProfile.key === "harmonic-lattice" ? -6 :
        motifProfile.key === "film-bloom-shard" ? 22 :
        6;
      const particleAlpha = clamp(particle.alpha * (1 - exitWhiteBias * 0.28), 0, 1);
      const motifColorAlpha =
        particleAlpha *
        clamp(1 - exitWhiteBias * 0.58, 0.28, 1) *
        motifProfile.colorProminence.particles *
        emissionTuning.colorfulnessScale *
        colorResponseScale;
      const whiteAlpha = particleAlpha * clamp(exitWhiteBias * 0.736, 0, 0.72);
      this.ctx.save();
      this.ctx.translate(particle.x, particle.y);
      this.ctx.rotate(Math.atan2(particle.vy || 0.001, particle.vx || 0.001));
      this.ctx.fillStyle = paletteColor(
        theme,
        (bandShift + particle.emitterIndex * 0.07 + tintWarmth * 0.05) * particleHueScale,
        motifColorAlpha,
        (particle.bandAffinity === "high" ? 12 : 6) + hueShiftBase * colorRangeBoost,
        extremeColorScale * colorResponseScale,
      );
      this.ctx.strokeStyle = plasmaCoreColor(
        theme,
        particleAlpha * (motifProfile.key === "cathedral-filament" ? 0.9 : 0.75) * clamp(1 - exitWhiteBias * 0.48, 0.28, 1),
        (bandShift * 0.5 + motifProfile.colorProminence.particles * 0.06) * particleHueScale,
        extremeColorScale * colorResponseScale,
      );
      this.ctx.lineWidth = Math.max(1, particle.size * 0.18);
      this.drawPrimitiveShape(
        particle.primitive,
        particle.size,
        particle.mode === "shiver" ? "wobble" : particle.mode === "spoke" ? "tilt" : "pulse",
        frame.timeSec + particle.phase,
        particle.bandAffinity === "low" ? frame.normalizedLow : particle.bandAffinity === "mid" ? frame.normalizedMid : frame.normalizedHigh,
        particle.mode === "wake" || particle.mode === "spoke" ? "stroke-fill" : "solid",
      );
      if (particle.isConductor) {
        this.ctx.strokeStyle = plasmaCoreColor(
          theme,
          clamp((particle.conductorStrength ?? 0.5) * 0.6, 0.18, 0.54),
          0.14 + ((particle.conductorPhaseOffset ?? 0) * 0.1),
          extremeColorScale * colorResponseScale,
        );
        this.ctx.lineWidth = Math.max(1, particle.size * 0.1);
        this.ctx.beginPath();
        this.ctx.arc(0, 0, particle.size * 1.45, 0, Math.PI * 2);
        this.ctx.stroke();
      }
      if (whiteAlpha > 0.01) {
        this.ctx.fillStyle =
          motifProfile.particleExitTint === "warm-white" ? `rgba(255,244,232,${whiteAlpha.toFixed(3)})` :
          motifProfile.particleExitTint === "cool-white" ? `rgba(232,244,255,${whiteAlpha.toFixed(3)})` :
          `rgba(255,255,255,${whiteAlpha.toFixed(3)})`;
        this.ctx.strokeStyle = "rgba(0,0,0,0)";
        this.drawPrimitiveShape(
          particle.primitive,
          particle.size * (0.96 + exitWhiteBias * 0.08),
          particle.mode === "shiver" ? "wobble" : particle.mode === "spoke" ? "tilt" : "pulse",
          frame.timeSec + particle.phase + 0.03,
          particle.bandAffinity === "low" ? frame.normalizedLow : particle.bandAffinity === "mid" ? frame.normalizedMid : frame.normalizedHigh,
          "solid",
        );
      }
      this.ctx.restore();
      this.lastHeroParticleExitWhiteBias = Math.max(this.lastHeroParticleExitWhiteBias, exitWhiteBias);
    }
    this.ctx.restore();
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
    this.lastStageMetrics.heroGlyphDrawCount += state.particles.length;
  }

  private drawHeroContrastBowl(
    theme: RenderTheme,
    directive: HeroEmitterDirective,
    activeSubject: ActiveSubjectState,
    outerAlpha: number,
  ): void {
    const contrastLift = 0.06 + this.lastHeroVariantWarp * 0.04 + this.lastHeroVariantInconsistency * 0.04;
    this.lastHeroContrastBowlUsed = outerAlpha > 0.09 && activeSubject.emphasis > 0.22;
    if (!this.lastHeroContrastBowlUsed) {
      return;
    }
    const radius = directive.size * (1.55 + this.lastHeroVariantGravity * 0.22);
    const gradient = this.ctx.createRadialGradient(directive.x, directive.y, directive.size * 0.24, directive.x, directive.y, radius);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.62, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${clamp(0.08 + outerAlpha * 0.25 + contrastLift, 0.08, 0.2).toFixed(3)})`);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "multiply";
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(directive.x, directive.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private resolveHeroColorResponseScale(
    sceneGraph: Pick<SceneGraph, "heroMotifProfile" | "heroEmissionTuning" | "heroMotifVariant">,
  ): number {
    const motifProfile = sceneGraph.heroMotifProfile;
    const mutationBias =
      this.persistentMotifState
        ? (PERSISTENT_MOTIF_SPECS.find((entry) => entry.id === this.persistentMotifState?.id)?.heroMutationBias ?? 0)
        : 0;
    const baseline = 1.1;
    const rampEligible =
      motifProfile.intensityClass === "colorful-psychedelic" ||
      sceneGraph.heroEmissionTuning.colorRangeMode === "extreme" ||
      mutationBias >= 0.74;
    if (!rampEligible) {
      return baseline;
    }
    const cap = motifProfile.intensityClass === "restrained" ? 1.2 : 1.75;
    const ramp = clamp(
      motifProfile.colorProminence.particles * 0.14 +
      sceneGraph.heroEmissionTuning.colorfulnessScale * 0.08 +
      sceneGraph.heroMotifVariant.warpWeight * 0.22 +
      sceneGraph.heroMotifVariant.densityWeight * 0.12 +
      mutationBias * 0.34,
      0,
      1,
    );
    return baseline + (cap - baseline) * ramp;
  }

  private screenEdgeAimBiasAt(x: number, y: number): number {
    const margin = Math.min(this.settings.width, this.settings.height) * 0.2;
    const distanceToEdge = Math.min(x, this.settings.width - x, y, this.settings.height - y);
    return clamp(1 - distanceToEdge / Math.max(1, margin), 0, 1);
  }

  private biasHeadingTowardCanvasCenter(
    heading: number,
    originX: number,
    originY: number,
    weight = 1,
    shapeRetention = 0.15,
  ): { heading: number; pull: number; degrees: number } {
    const pull = this.screenEdgeAimBiasAt(originX, originY);
    if (pull <= 0 || weight <= 0) {
      return { heading, pull: 0, degrees: 0 };
    }
    const centerHeading = Math.atan2(this.settings.height * 0.5 - originY, (this.settings.width * 0.5 - originX) || 0.001);
    let delta = centerHeading - heading;
    while (delta > Math.PI) {
      delta -= Math.PI * 2;
    }
    while (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    const maxRadians = (Math.PI / 6) * pull * weight;
    const retention = clamp(shapeRetention, 0, 0.9);
    const appliedDelta = clamp(delta, -maxRadians, maxRadians) * (1 - retention);
    return {
      heading: heading + appliedDelta,
      pull,
      degrees: Math.abs(appliedDelta) * (180 / Math.PI),
    };
  }

  private recordCenterwardEmissionSample(originX: number, originY: number, heading: number, pull: number): void {
    this.edgePressureSampleCount += 1;
    if (pull <= 0) {
      return;
    }
    this.edgePressureActiveSampleCount += 1;
    const centerHeading = Math.atan2(this.settings.height * 0.5 - originY, (this.settings.width * 0.5 - originX) || 0.001);
    const alignment = (Math.cos(centerHeading - heading) + 1) * 0.5;
    this.centerwardEmissionAlignmentSum += clamp(alignment, 0, 1);
    this.centerwardEmissionSampleCount += 1;
  }

  private drawHeroShellStackLate(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    directive: HeroEmitterDirective,
    activeSubject: ActiveSubjectState,
    sceneGraph: SceneGraph,
    bandEnergy: BandEnergyProfile,
    alphaScale: number,
    shellFrameState: HeroShellFrameState,
  ): void {
    const startedAt = performance.now();
    if (!sceneGraph.heroShellSceneEnabled || shellFrameState.layers.length === 0) {
      this.lastHeroShellUnderlayActive = false;
      return;
    }
    const activeLayers = shellFrameState.layers.filter((layer) => layer.active);
    if (activeLayers.length === 0) {
      this.lastHeroContrastBowlUsed = false;
      this.lastHeroShellUnderlayActive = false;
      return;
    }
    this.lastHeroShellUnderlayActive = true;
    const variantContrast = 1 + this.lastHeroVariantWarp * 0.12 + this.lastHeroVariantInconsistency * 0.08;
    const shellColorizationScale = heroSpawnShellColorizationScale(frame, sceneGraph, bandEnergy) * this.resolveHeroColorResponseScale(sceneGraph);
    const strongestLayer = activeLayers[0]!;
    const strongestOuterAlpha = clamp(
      (0.08 + strongestLayer.drive * 0.12 + (frame.phrasePulse ?? 0) * 0.04) *
        alphaScale *
        variantContrast *
        strongestLayer.spec.alphaWeight,
      0.04,
      0.24,
    );
    this.drawHeroContrastBowl(theme, directive, activeSubject, strongestOuterAlpha);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.translate(directive.x, directive.y);
    this.ctx.rotate(directive.rotation);
    for (const layer of activeLayers) {
      const colorPosition = shellFrameState.windowState.colorMode === "multi"
        ? shellFrameState.windowState.colorOffsets[layer.spec.index]
        : shellFrameState.windowState.colorOffsets[0];
      const alphaBase = clamp(
        (0.08 + layer.drive * 0.12 + frame.peakStrength * 0.03 + (frame.phrasePulse ?? 0) * 0.04) *
          alphaScale *
          variantContrast *
          layer.spec.alphaWeight,
        0.035,
        0.24,
      );
      const radius =
        directive.size *
        (
          layer.spec.radiusScale +
          activeSubject.emphasis *
            (
              layer.spec.style === "halo-fill" ? 0.16 :
              layer.spec.style === "shock-ring" ? 0.12 :
              0.08
            )
        );
      const palettePosition = (
        colorPosition +
        frame.timeSec * 0.08 * shellFrameState.windowState.hueTravelScale +
        layer.spec.index * 0.06 * shellFrameState.windowState.paletteSpanScale
      ) % 1;
      switch (layer.spec.style) {
        case "shock-ring":
          this.ctx.strokeStyle = paletteColor(theme, palettePosition, alphaBase, 12, shellColorizationScale);
          this.ctx.lineWidth = Math.max(1.4, directive.size * 0.07 * layer.spec.lineWidthScale);
          this.ctx.beginPath();
          this.ctx.ellipse(0, 0, radius * (1 + frame.beatPulse * 0.08), radius * 0.74, 0, 0, Math.PI * 2);
          this.ctx.stroke();
          break;
        case "rim-halo": {
          const rimGradient = this.ctx.createRadialGradient(0, 0, radius * 0.66, 0, 0, radius * 1.08);
          rimGradient.addColorStop(0, "rgba(0,0,0,0)");
          rimGradient.addColorStop(0.68, paletteColor(theme, palettePosition, clamp(alphaBase * 0.52, 0.03, 0.14), 8, shellColorizationScale));
          rimGradient.addColorStop(1, "rgba(0,0,0,0)");
          this.ctx.fillStyle = rimGradient;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius * 1.08, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.strokeStyle = paletteColor(theme, palettePosition, clamp(alphaBase * 0.64, 0.03, 0.12), 10, shellColorizationScale);
          this.ctx.lineWidth = Math.max(1, directive.size * 0.038 * layer.spec.lineWidthScale);
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
          this.ctx.stroke();
          break;
        }
        case "halo-fill":
        default: {
          const innerGradient = this.ctx.createRadialGradient(0, 0, directive.size * 0.14, 0, 0, radius);
          innerGradient.addColorStop(0, paletteColor(theme, palettePosition, clamp(alphaBase * 0.82, 0.04, 0.18), 14, shellColorizationScale));
          innerGradient.addColorStop(0.72, paletteColor(theme, palettePosition + 0.04, clamp(alphaBase * 0.48, 0.03, 0.12), 8, shellColorizationScale));
          innerGradient.addColorStop(1, "rgba(0,0,0,0)");
          this.ctx.fillStyle = innerGradient;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
          this.ctx.fill();
          break;
        }
      }
    }
    this.ctx.restore();
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
  }

  private drawActiveSubjectAura(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    _sceneGraph: SceneGraph,
    _compositionPlan: CompositionPlan,
    edgeMap: EdgeMap,
    safetyMetrics: VisualSafetyMetrics,
  ): void {
    const recoveryScale = safetyMetrics.recoveryActive ? 0.78 : 1;
    const radiusX = activeSubject.radius * (1.3 + activeSubject.emphasis * 0.55) * recoveryScale;
    const radiusY = activeSubject.radius * (0.95 + activeSubject.emphasis * 0.35) * recoveryScale;
    const bandPulse =
      frame.dominantBand === "low" ? frame.normalizedLow :
      frame.dominantBand === "mid" ? frame.normalizedMid :
      frame.normalizedHigh;
    const velocityAngle = Math.atan2(activeSubject.vy, activeSubject.vx || 0.001);
    this.ctx.save();
    this.ctx.translate(activeSubject.x, activeSubject.y);
    this.ctx.rotate(velocityAngle);
    this.ctx.scale(1, radiusY / Math.max(1, radiusX));
    const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, safeRadius(radiusX, 1));
    gradient.addColorStop(0, plasmaCoreColor(theme, 0.08 + activeSubject.emphasis * 0.12, 0.2));
    gradient.addColorStop(0.55, paletteColor(theme, frame.timeSec * 0.08, 0.05 + activeSubject.emphasis * 0.05, 12));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.globalAlpha = clamp(0.22 + activeSubject.emphasis * 0.28, 0.16, 0.5) * recoveryScale;
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, safeRadius(radiusX, 1), 0, Math.PI * 2);
    this.ctx.fill();
    if (activeSubject.mode === "strike" || edgeMap.fractalMotif === "neon-tube") {
      this.ctx.globalAlpha = clamp(0.14 + frame.peakStrength * 0.16, 0.12, 0.3) * recoveryScale;
      const streak = this.ctx.createLinearGradient(-radiusX * 0.3, 0, radiusX * 1.3, 0);
      streak.addColorStop(0, "rgba(0,0,0,0)");
      streak.addColorStop(0.35, paletteColor(theme, 0.1, 0.08, 16));
      streak.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.fillStyle = streak;
      this.ctx.fillRect(-radiusX * 0.4, -radiusY * 0.25, radiusX * 1.8, radiusY * 0.5);
    }
    this.ctx.restore();
    const residualAura = clamp(0.04 + bandPulse * 0.08 + this.lastSupportCoverage * 0.06, 0.03, 0.14);
    if (residualAura > 0.03) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = residualAura;
      this.ctx.translate(activeSubject.x, activeSubject.y);
      this.ctx.rotate(velocityAngle);
      this.ctx.fillStyle = paletteColor(theme, frame.timeSec * 0.08, residualAura, 8);
      this.ctx.fillRect(-radiusX * 0.16, -radiusY * 0.08, radiusX * 0.52, radiusY * 0.16);
      this.ctx.restore();
    }
  }

  private drawHeroPrimitiveCore(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    directive: HeroEmitterDirective,
    activeSubject: ActiveSubjectState,
    sceneGraph: SceneGraph,
    alphaScale: number,
  ): void {
    const startedAt = performance.now();
    const shellBias = directive.postShellMode === "electric-shell" ? 0.08 : 0.04;
    const fillAlpha = clamp((0.22 + directive.brightness * 0.1 + frame.beatPulse * 0.07 + shellBias) * directive.alpha * alphaScale, 0.14, 0.5);
    const strokeAlpha = clamp(fillAlpha * (directive.fillMode === "solid" ? 0.55 : 0.9), 0.1, 0.46);
    const colorResponseScale = this.resolveHeroColorResponseScale(sceneGraph);
    this.ctx.save();
    this.ctx.translate(directive.x, directive.y);
    this.ctx.rotate(directive.rotation);
    this.ctx.fillStyle = paletteColor(theme, frame.timeSec * 0.12, fillAlpha, 10, sceneGraph.heroMotifProfile.colorProminence.core * colorResponseScale);
    this.ctx.strokeStyle = plasmaCoreColor(theme, strokeAlpha, activeSubject.emphasis * 0.18, sceneGraph.heroMotifProfile.colorProminence.core * colorResponseScale);
    this.ctx.lineWidth = Math.max(1.6, directive.size * (directive.fillMode === "solid" ? 0.08 : 0.12) * (1 - directive.alpha * 0.08));
    this.drawPrimitiveShape(directive.primitive, directive.size, directive.deformationMode, frame.timeSec, activeSubject.emphasis + frame.beatPulse * 0.35, directive.fillMode);
    this.ctx.restore();
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
    this.lastStageMetrics.heroGlyphDrawCount += 1;
  }

  private heroSpawnTimingAllows(frame: AudioFrameFeature, motifProfile: HeroMotifProfile, bandAffinity: HeroBandAffinity): boolean {
    switch (motifProfile.spawnTimingMode) {
      case "phasic-downbeat":
        return frame.isFourBarDownbeat || frame.isBeatAccent || (frame.beatPulse ?? 0) > 0.78;
      case "phasic-quarter": {
        const beatIndex = frame.beatIndex ?? Math.floor((frame.beatAlignedTimeSec ?? frame.timeSec) * 2);
        const isNewBeat = beatIndex !== this.lastQuarterSpawnBeatIndex;
        const guaranteed = isNewBeat && !frame.isPreAnchor;
        const energetic = !!frame.isBeatAccent || (frame.beatPulse ?? 0) > 0.42 || frame.normalizedMid > 0.2 || frame.normalizedHighMid > 0.18;
        if (guaranteed || energetic) {
          if (guaranteed) {
            this.lastQuarterSpawnBeatIndex = beatIndex;
            this.lastQuarterSpawnGuaranteeHitCount += 1;
          }
          return true;
        }
        if (isNewBeat && !frame.isPreAnchor) {
          this.lastQuarterSpawnGuaranteeMissCount += 1;
          this.lastQuarterSpawnBeatIndex = beatIndex;
        }
        return false;
      }
      case "band-low":
        return bandAffinity === "low" && (frame.normalizedLow > 0.34 || !!frame.isBeatAccent);
      case "band-mid-high":
        return (
          (bandAffinity === "mid" && frame.normalizedMid > 0.4) ||
          (bandAffinity === "high" && (frame.normalizedHigh > 0.32 || frame.normalizedHighMid > 0.34))
        );
      case "all-band-split":
        return (
          (bandAffinity === "low" && frame.normalizedLow > 0.22) ||
          (bandAffinity === "mid" && frame.normalizedMid > 0.2) ||
          (bandAffinity === "high" && frame.normalizedHigh > 0.18)
        );
      case "continuous":
      default:
        return true;
    }
  }

  private resolveHeroSubEmitterPosition(
    frame: AudioFrameFeature,
    directive: HeroEmitterDirective,
    emitter: HeroEmitterDirective["subEmitters"][number],
    index: number,
    activeSubject?: ActiveSubjectState,
  ): { x: number; y: number; rotation: number } {
    const baseX = directive.x + emitter.offsetX * directive.size * Math.cos(directive.rotation) - emitter.offsetY * directive.size * Math.sin(directive.rotation);
    const baseY = directive.y + emitter.offsetX * directive.size * Math.sin(directive.rotation) + emitter.offsetY * directive.size * Math.cos(directive.rotation);
    const phase = frame.timeSec * (0.8 + emitter.spawnRate * 0.4) + index * 0.9;
    const jitter = activeSubject?.emphasis ?? 0.2;
    switch (emitter.motionMode) {
      case "orbit-hero":
        return {
          x: directive.x + Math.cos(phase) * directive.size * (0.42 + emitter.childScale * 0.7),
          y: directive.y + Math.sin(phase * 0.94) * directive.size * (0.28 + emitter.childScale * 0.54),
          rotation: directive.rotation + phase,
        };
      case "revolve-hero":
        return {
          x: directive.x + Math.cos(phase * 0.72 + Math.sin(phase * 0.33) * 0.5) * directive.size * (0.7 + emitter.childScale * 0.9),
          y: directive.y + Math.sin(phase * 0.72) * directive.size * (0.46 + emitter.childScale * 0.7),
          rotation: directive.rotation + phase * 0.72,
        };
      case "patrol": {
        const waypoints = [
          { x: -0.75, y: -0.25 },
          { x: 0.55, y: -0.58 },
          { x: 0.68, y: 0.34 },
          { x: -0.42, y: 0.62 },
        ];
        const from = waypoints[index % waypoints.length]!;
        const to = waypoints[(index + 1) % waypoints.length]!;
        const t = (Math.sin(phase) + 1) * 0.5;
        const localX = (from.x + (to.x - from.x) * t) * directive.size * 0.58;
        const localY = (from.y + (to.y - from.y) * t) * directive.size * 0.42;
        return {
          x: directive.x + localX,
          y: directive.y + localY,
          rotation: directive.rotation + Math.atan2(to.y - from.y, to.x - from.x),
        };
      }
      case "atomic-gravity": {
        const radius = directive.size * (0.18 + (Math.sin(phase * 1.6) + 1) * 0.26);
        const slingshot = 1 + Math.max(0, Math.sin(phase * 2.1)) * 1.2;
        return {
          x: directive.x + Math.cos(phase * 1.35) * radius * slingshot,
          y: directive.y + Math.sin(phase * 1.12) * radius * slingshot,
          rotation: directive.rotation + phase * 1.1,
        };
      }
      case "hover":
      default:
        return {
          x: baseX + Math.sin(phase * 1.8 + jitter) * directive.size * 0.12,
          y: baseY + Math.cos(phase * 1.4 + jitter) * directive.size * 0.1,
          rotation: directive.rotation + Math.sin(phase) * 0.18,
        };
    }
  }

  private resolveHeroDirectSpawnPosition(
    frame: AudioFrameFeature,
    directive: HeroEmitterDirective,
    motifProfile: HeroMotifProfile,
    wake: HeroPhysicsState["wake"]["samples"],
    spawn: number,
  ): { x: number; y: number; rotation: number } {
    const loci = motifProfile.directSpawnLoci ?? ["centerline", "shell-rim", "path-tangent"];
    const locus = loci[spawn % loci.length]!;
    const phase = frame.timeSec * (1.05 + spawn * 0.015);
    switch (locus) {
      case "shell-rim":
        return {
          x: directive.x + Math.cos(phase) * directive.size * 0.78,
          y: directive.y + Math.sin(phase * 0.92) * directive.size * 0.58,
          rotation: directive.rotation + phase * 0.35,
        };
      case "wake-tail": {
        const tail = wake[Math.min(wake.length - 1, Math.max(0, Math.floor(wake.length * 0.7)))] ?? wake[wake.length - 1];
        if (tail) {
          return { x: tail.x, y: tail.y, rotation: tail.heading };
        }
        return { x: directive.x, y: directive.y, rotation: directive.rotation };
      }
      case "path-tangent":
        return {
          x: directive.x + Math.cos(directive.rotation) * directive.size * 0.22,
          y: directive.y + Math.sin(directive.rotation) * directive.size * 0.22,
          rotation: directive.rotation,
        };
      case "burst-origin":
        return {
          x: directive.x + Math.cos(phase * 1.7) * directive.size * 0.16,
          y: directive.y + Math.sin(phase * 1.3) * directive.size * 0.16,
          rotation: directive.rotation + Math.sin(phase) * 0.28,
        };
      case "centerline":
      default:
        return {
          x: directive.x + Math.cos(directive.rotation) * Math.sin(phase) * directive.size * 0.08,
          y: directive.y + Math.sin(directive.rotation) * Math.sin(phase) * directive.size * 0.08,
          rotation: directive.rotation,
        };
    }
  }

  private applyConductorInfluence(
    particles: HeroParticleBuffers,
    frame: AudioFrameFeature,
    directive: HeroEmitterDirective,
    sceneGraph: SceneGraph,
    heroAnchors: HeroEmitterDirective[],
    particleOffset = 0,
  ): HeroConductorRuntimeState[] {
    if (particles.count <= 1) {
      return [];
    }
    const conductorSpec = heroConductorSpecById(sceneGraph.heroConductorSelection.primary);
    const fallbackSpec = sceneGraph.heroConductorSelection.secondary ? heroConductorSpecById(sceneGraph.heroConductorSelection.secondary) : conductorSpec;
    const targetConductorCount = Math.max(1, Math.min(24, Math.round(particles.count * sceneGraph.heroConductorDensity)));
    const conductors: HeroConductorRuntimeState[] = [];
    const stride = Math.max(1, Math.floor(particles.count / targetConductorCount));
    const influenceLimit = Math.min(particles.count * 6, 320);
    let influenceOps = 0;
    for (let seedIndex = 0; seedIndex < particles.count && conductors.length < targetConductorCount; seedIndex += stride) {
      const index = Math.min(particles.count - 1, seedIndex + Math.floor(stableImageSeed(sceneGraph.imagePath, seedIndex + particleOffset + 5) % stride));
      if (particles.ttl[index]! <= 16 || particles.alpha[index]! <= 0.12) {
        continue;
      }
      const spec = conductors.length % 3 === 2 ? fallbackSpec : conductorSpec;
      const seededHeroAnchorIndex =
        spec.anchorMode === "nearest-hero"
          ? nearestHeroAnchorIndex(particles.x[index]!, particles.y[index]!, heroAnchors)
          : Math.max(0, Math.min(heroAnchors.length - 1, conductors.length % Math.max(1, heroAnchors.length)));
      const baseSeed = stableHash(`${sceneGraph.imagePath}|${sceneGraph.continuitySeed}|${spec.id}|${seededHeroAnchorIndex}|${conductors.length}|${particleOffset}`);
      const baseFloat = (baseSeed % 10_000) / 10_000;
      const signedVariance = (baseFloat - 0.5) * 2;
      const dbDrive = clamp(frame.dbNormalized, 0, 1.5);
      const hzDrive = clamp((frame.dominantHz - 120) / 2200, 0, 1.25);
      const lowBandPulseScale = 1 + clamp(Math.max(frame.normalizedLow, expandedBandValue(frame, "subLow")) * 0.2, 0, 0.2);
      const orbitDistanceScale = spec.anchorMode === "nearest-hero" ? 1.2 * lowBandPulseScale : 1;
      const radiusBase =
        directive.size *
        (1.2 + (spec.radiusScale + signedVariance * (spec.radiusVariance ?? 0.12)) * sceneGraph.heroConductorSelection.influenceRadiusScale) *
        orbitDistanceScale;
      const strengthBase =
        (spec.strength + signedVariance * (spec.strengthVariance ?? 0.12)) * sceneGraph.heroConductorSelection.strengthScale;
      const radius = radiusBase * (0.9 + dbDrive * 0.18 + hzDrive * 0.12);
      const strength = strengthBase * (0.9 + dbDrive * 0.28 + hzDrive * 0.22);
      const resolvedSwirl = clamp(spec.swirl + signedVariance * (spec.swirlVariance ?? 0.12), 0.04, 1.4);
      const resolvedPulse = clamp(spec.pulse + signedVariance * (spec.pulseVariance ?? 0.12), 0.04, 1.4);
      const resolvedTether = clamp(spec.tether + signedVariance * 0.14, 0.08, 1.4);
      const lifespanMod =
        clamp(
          ((spec.lifespanModRange?.min ?? 0.88) + ((spec.lifespanModRange?.max ?? 1.16) - (spec.lifespanModRange?.min ?? 0.88)) * baseFloat) *
          (0.92 + dbDrive * 0.12 + hzDrive * 0.1),
          0.8,
          1.4,
        );
      const phaseOffset = conductorPhaseOffset(frame, {
        type: spec.id,
        motionFamily: spec.motionFamily,
        anchorMode: spec.anchorMode,
        strength,
        radius,
        phaseOffset: 0,
        bandMask: spec.bandBias,
        lifespanMod,
        resolvedSwirl,
        resolvedPulse,
        resolvedTether,
      });
      conductors.push({
        type: spec.id,
        motionFamily: spec.motionFamily,
        anchorMode: spec.anchorMode,
        strength,
        radius,
        phaseOffset,
        bandMask: spec.bandBias,
        lifespanMod,
        resolvedSwirl,
        resolvedPulse,
        resolvedTether,
      });
      for (let targetIndex = 0; targetIndex < particles.count && influenceOps < influenceLimit; targetIndex += 1) {
        if (targetIndex === index) {
          continue;
        }
        const anchorIndex =
          spec.anchorMode === "nearest-hero"
            ? nearestHeroAnchorIndex(particles.x[targetIndex]!, particles.y[targetIndex]!, heroAnchors)
            : seededHeroAnchorIndex;
        const anchor = heroAnchors[anchorIndex] ?? directive;
        const cx = spec.anchorMode === "nearest-hero" ? anchor.x : particles.x[index]!;
        const cy = spec.anchorMode === "nearest-hero" ? anchor.y : particles.y[index]!;
        const dx = particles.x[targetIndex]! - cx;
        const dy = particles.y[targetIndex]! - cy;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.0001 || distance > radius) {
          continue;
        }
        const proximity = 1 - distance / radius;
        const tangentX = -dy / distance;
        const tangentY = dx / distance;
        const outwardX = dx / distance;
        const outwardY = dy / distance;
        const pulse = frame.beatPulse * 0.44 + (frame.barPulse ?? 0) * 0.28 + (frame.phrasePulse ?? 0) * 0.18 + phaseOffset * 0.1;
        const bandDrive = spec.bandBias.reduce((sum, band) => sum + expandedBandValue(frame, band), 0) / Math.max(1, spec.bandBias.length);
        const affinityDrive = bandValueForAffinity(frame, this.decodeHeroBandAffinity(particles.bandAffinity[targetIndex]!));
        const drive = strength * proximity * (0.5 + bandDrive * 0.3 + affinityDrive * 0.2);
        switch (spec.motionFamily) {
          case "orbit":
          case "braid":
          case "flock-curl":
            particles.vx[targetIndex] += tangentX * drive * (1.2 + resolvedSwirl * 0.6);
            particles.vy[targetIndex] += tangentY * drive * (1.2 + resolvedSwirl * 0.6);
            break;
          case "accordion":
          case "collapse-pulse":
          case "tidal-lock":
            particles.vx[targetIndex] += outwardX * drive * (pulse - 0.5) * (1.4 + resolvedPulse * 0.4);
            particles.vy[targetIndex] += outwardY * drive * (pulse - 0.5) * (1.4 + resolvedPulse * 0.4);
            break;
          case "perfect-circle": {
            const heroRadius = (heroAnchors[anchorIndex] ?? directive).size * (0.72 + resolvedTether * 0.28);
            const radiusError = distance - heroRadius;
            particles.vx[targetIndex] += tangentX * drive * (1.35 + resolvedSwirl * 0.52) - outwardX * radiusError * 0.012 * resolvedTether;
            particles.vy[targetIndex] += tangentY * drive * (1.35 + resolvedSwirl * 0.52) - outwardY * radiusError * 0.012 * resolvedTether;
            break;
          }
          case "orbit-through": {
            const throughPulse = Math.sin(frame.timeSec * (1.2 + hzDrive * 0.8) + phaseOffset + targetIndex * 0.09);
            const heroRadius = (heroAnchors[anchorIndex] ?? directive).size * (0.18 + Math.abs(throughPulse) * 0.84);
            const radiusError = distance - heroRadius;
            particles.vx[targetIndex] += tangentX * drive * (1.18 + resolvedSwirl * 0.48) - outwardX * radiusError * 0.014 * resolvedTether + outwardX * throughPulse * drive * 0.68;
            particles.vy[targetIndex] += tangentY * drive * (1.18 + resolvedSwirl * 0.48) - outwardY * radiusError * 0.014 * resolvedTether + outwardY * throughPulse * drive * 0.68;
            break;
          }
          case "spiral-braid": {
            const braidPhase = frame.timeSec * (1.1 + hzDrive * 0.7) + phaseOffset + targetIndex * 0.11;
            const braidRadius = (heroAnchors[anchorIndex] ?? directive).size * (0.42 + (Math.sin(braidPhase) + 1) * 0.34);
            const radiusError = distance - braidRadius;
            particles.vx[targetIndex] += tangentX * drive * (1.24 + resolvedSwirl * 0.64) - outwardX * radiusError * 0.016 * resolvedTether + outwardX * Math.sin(braidPhase * 0.7) * drive * 0.32;
            particles.vy[targetIndex] += tangentY * drive * (1.24 + resolvedSwirl * 0.64) - outwardY * radiusError * 0.016 * resolvedTether + outwardY * Math.sin(braidPhase * 0.7) * drive * 0.32;
            break;
          }
          case "recoil":
          case "pendulum":
          case "delay-wave":
          case "spoke-bloom":
          default:
            particles.vx[targetIndex] += (tangentX * resolvedSwirl + outwardX * (resolvedPulse - 0.5)) * drive;
            particles.vy[targetIndex] += (tangentY * resolvedSwirl + outwardY * (resolvedPulse - 0.5)) * drive;
            break;
        }
        particles.alpha[targetIndex] = clamp(particles.alpha[targetIndex]! * (0.996 + (lifespanMod - 1) * 0.04 * proximity), 0.04, 1);
        particles.heat[targetIndex] = clamp(particles.heat[targetIndex]! * (0.996 + (lifespanMod - 1) * 0.05 * proximity), 0.02, 1.4);
        influenceOps += 1;
      }
    }
    return conductors;
  }

  private applyHeroImpactParticleWarp(
    particles: HeroParticleBuffers,
    frame: AudioFrameFeature,
    directive: HeroEmitterDirective,
    heroAnchors: HeroEmitterDirective[],
  ): void {
    const motifWarpIntensity = this.lastHeroWarpActive ? this.lastMotifEffectIntensity : 0;
    const outroWarpIntensity = this.lastOutroHeroWarp;
    const heroImpactIntensity = clamp(motifWarpIntensity + outroWarpIntensity * 0.8, 0, 2);
    if (particles.count === 0 || heroImpactIntensity <= 0.01) {
      return;
    }
    const dbDrive = clamp(frame.dbNormalized, 0, 1.5);
    const hzDrive = clamp((frame.dominantHz - 120) / 2200, 0, 1.25);
    const violentScale = heroImpactIntensity * (1 + dbDrive * 0.34 + hzDrive * 0.28);
    for (let index = 0; index < particles.count; index += 1) {
      const anchorIndex = nearestHeroAnchorIndex(particles.x[index]!, particles.y[index]!, heroAnchors);
      const anchor = heroAnchors[anchorIndex] ?? directive;
      const dx = particles.x[index]! - anchor.x;
      const dy = particles.y[index]! - anchor.y;
      const distance = Math.hypot(dx, dy);
      const radius = Math.max(anchor.size * (1.3 + heroImpactIntensity * 0.5), 24);
      if (distance <= 0.0001 || distance > radius) {
        continue;
      }
      const proximity = 1 - distance / radius;
      const outwardX = dx / distance;
      const outwardY = dy / distance;
      const tangentX = -outwardY;
      const tangentY = outwardX;
      const phase = stableHash(`${this.lastTransitionIdentitySignature}|${frame.frameIndex}|${index}|${anchorIndex}`) * 0.0001 + frame.timeSec * (2.2 + hzDrive);
      const radialKick = violentScale * proximity * (0.22 + Math.sin(phase) * 0.16);
      const tangentialKick = violentScale * proximity * (0.28 + Math.cos(phase * 1.4) * 0.18);
      const shearKick = violentScale * proximity * Math.sin(phase * 0.8) * 0.12;
      particles.vx[index] += outwardX * radialKick + tangentX * tangentialKick + outwardY * shearKick;
      particles.vy[index] += outwardY * radialKick + tangentY * tangentialKick + outwardX * shearKick;
      particles.heat[index] = clamp(particles.heat[index]! * (1 + proximity * 0.06 * heroImpactIntensity), 0.02, 1.5);
      particles.alpha[index] = clamp(particles.alpha[index]! * (1 + proximity * 0.04 * heroImpactIntensity), 0.04, 1);
    }
  }

  private drawHeroSubEmitterNodes(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    directive: HeroEmitterDirective,
    activeSubject: ActiveSubjectState,
    alphaScale: number,
  ): void {
    const startedAt = performance.now();
    const pulse = clamp(frame.beatPulse * 0.6 + activeSubject.emphasis * 0.4, 0, 1);
    const emissionScale = activeSubject.emissionScale ?? 1;
    const highDbDelta = this.rollingDbWindow.dbHigh.length > 0
      ? frame.dbHigh - (this.rollingDbWindow.dbHigh.reduce((sum, value) => sum + value, 0) / this.rollingDbWindow.dbHigh.length)
      : 0;
    const normalizedHighDb = clamp((highDbDelta + 6) / 12, 0, 1);
    for (let index = 0; index < directive.subEmitters.length; index += 1) {
      const emitter = directive.subEmitters[index]!;
      const emitterPosition = this.resolveHeroSubEmitterPosition(frame, directive, emitter, index, activeSubject);
      const ex = emitterPosition.x;
      const ey = emitterPosition.y;
      const nodeSize = directive.size * clamp(0.14 + emitter.childScale * 0.6, 0.12, 0.28) * 3;
      const rotationVelocity = emitter.rotationReactive
        ? (
            (emitter.rotationBaseVelocity ?? 0.06) *
            (1 + normalizedHighDb * 2.2) *
            ((emitter.rotationNegativeOnDrop && highDbDelta < -0.35)
              ? -1
              : 1) *
            ((emitter.rotationNegativeOnDrop && (frame.isPeak || frame.isBarDownbeat)) ? 1.8 : 1)
          )
        : 0;
      this.ctx.save();
      this.ctx.translate(ex, ey);
      this.ctx.rotate(emitterPosition.rotation + index * 0.12 + frame.timeSec * rotationVelocity);
      this.ctx.fillStyle = paletteColor(theme, 0.2 + index * 0.12, clamp(0.16 + emitter.spawnRate * 0.08, 0.12, 0.3) * alphaScale, 6);
      this.ctx.strokeStyle = rgbaColor(colorStats(theme)[index % colorStats(theme).length]!, 0.2 * alphaScale);
      this.ctx.lineWidth = 1.2;
      this.drawPrimitiveShape(emitter.primitive, nodeSize, "pulse", frame.timeSec + index * 0.2, pulse, "stroke-fill");
      this.ctx.restore();
      const childBursts = Math.max(1, Math.min(8, Math.round(((emitter.spawnRate * 4) + (frame.isFourBarDownbeat ? 2 : 0)) * emissionScale)));
      for (let childIndex = 0; childIndex < childBursts; childIndex += 1) {
        const childAngleBase =
          emitter.emissionMode === "wake" ? directive.rotation + Math.PI :
          emitter.emissionMode === "spine-fountain" ? directive.rotation - Math.PI / 2 :
          emitter.emissionMode === "orbit-shed" ? directive.rotation + ((childIndex / Math.max(1, childBursts)) * Math.PI * 2) :
          directive.rotation + (index - 1) * 0.42;
        const childAngle = childAngleBase + Math.sin(frame.timeSec * 5 + index + childIndex) * emitter.childSpread;
        const childDistance = directive.size * (0.2 + childIndex * 0.14) * (0.8 + emitter.childSpeed * 0.16);
        const cx = ex + Math.cos(childAngle) * childDistance;
        const cy = ey + Math.sin(childAngle) * childDistance;
        const childSize = directive.size * emitter.childScale * (1 + frame.beatPulse * 0.2 - childIndex * 0.08) * 3;
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(childAngle);
        this.ctx.fillStyle = paletteColor(theme, 0.34 + index * 0.1 + childIndex * 0.07, clamp(0.1 + emitter.spawnRate * 0.08 - childIndex * 0.02, 0.06, 0.22) * alphaScale, 2);
        this.ctx.strokeStyle = "rgba(0,0,0,0)";
        this.drawPrimitiveShape(emitter.primitive, childSize, "pulse", frame.timeSec + childIndex * 0.1, pulse, "solid");
        this.ctx.restore();
      }
    }
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
    this.lastStageMetrics.heroGlyphDrawCount += directive.subEmitters.length;
  }

  private drawHeroPostShell(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    directive: HeroEmitterDirective,
    activeSubject: ActiveSubjectState,
    alphaScale: number,
  ): void {
    const startedAt = performance.now();
    const shellRadius = directive.size * (1.4 + activeSubject.emphasis * 0.22);
    const circleShellAlphaBoost = isCircleHeroShellMode(directive.postShellMode) ? 0.945 : 1;
    const shellAlpha = clamp(
      (0.06 + frame.beatPulse * 0.06 + (frame.phrasePulse ?? 0) * 0.08) * directive.alpha * alphaScale * circleShellAlphaBoost,
      0.04,
      0.189,
    );
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.translate(directive.x, directive.y);
    this.ctx.rotate(directive.rotation);
    switch (directive.postShellMode) {
      case "shock-ring":
        this.ctx.strokeStyle = paletteColor(theme, frame.timeSec * 0.08, shellAlpha, 8);
        this.ctx.lineWidth = Math.max(1.4, directive.size * 0.08);
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, shellRadius * (1 + frame.beatPulse * 0.12), shellRadius * 0.72, 0, 0, Math.PI * 2);
        this.ctx.stroke();
        break;
      case "heat-smear": {
        const gradient = this.ctx.createLinearGradient(-shellRadius * 0.4, 0, shellRadius * 1.2, 0);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(0.4, paletteColor(theme, 0.18, shellAlpha, 4));
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(-shellRadius * 0.3, -directive.size * 0.32, shellRadius * 1.5, directive.size * 0.64);
        break;
      }
      case "petal-shell":
        this.ctx.fillStyle = paletteColor(theme, 0.28, shellAlpha, 6);
        for (let index = 0; index < 4; index += 1) {
          this.ctx.save();
          this.ctx.rotate((Math.PI / 2) * index + frame.timeSec * 0.12);
          this.ctx.beginPath();
          this.ctx.ellipse(shellRadius * 0.34, 0, directive.size * 0.34, directive.size * 0.18, 0, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
        }
        break;
      case "monolith-extrude":
        this.ctx.strokeStyle = paletteColor(theme, 0.22, shellAlpha, 10);
        this.ctx.fillStyle = paletteColor(theme, 0.18, shellAlpha * 0.45, 2);
        for (let index = 0; index < 3; index += 1) {
          const depth = index * directive.size * 0.08;
          this.ctx.beginPath();
          this.ctx.rect(-shellRadius * 0.3 + depth, -shellRadius * 0.42 + depth * 0.35, shellRadius * 0.6, shellRadius * 0.84);
          this.ctx.fill();
          this.ctx.stroke();
          this.ctx.beginPath();
          this.ctx.moveTo(shellRadius * 0.3 + depth, -shellRadius * 0.42 + depth * 0.35);
          this.ctx.lineTo(shellRadius * 0.42 + depth, -shellRadius * 0.52 + depth * 0.26);
          this.ctx.lineTo(shellRadius * 0.42 + depth, shellRadius * 0.32 + depth * 0.26);
          this.ctx.lineTo(shellRadius * 0.3 + depth, shellRadius * 0.42 + depth * 0.35);
          this.ctx.closePath();
          this.ctx.fill();
        }
        break;
      case "wire-solid-flip":
        this.ctx.lineWidth = 1.6;
        this.ctx.strokeStyle = paletteColor(theme, 0.42, shellAlpha, 14);
        this.ctx.fillStyle = paletteColor(theme, 0.34, shellAlpha * 0.5, 4);
        this.drawPrimitiveShape(directive.primitive, shellRadius * 0.46, "pulse", frame.timeSec, frame.beatPulse, frame.beatPulse > 0.48 ? "stroke-fill" : "solid");
        break;
      case "hinge-bloom":
        this.ctx.fillStyle = paletteColor(theme, 0.3, shellAlpha, 6);
        for (let index = 0; index < 5; index += 1) {
          this.ctx.save();
          this.ctx.rotate((Math.PI * 2 * index) / 5 + frame.timeSec * 0.08 + Math.sin(frame.timeSec * 1.2 + index) * 0.08);
          this.ctx.beginPath();
          this.ctx.moveTo(0, 0);
          this.ctx.lineTo(shellRadius * 0.7, -directive.size * 0.12);
          this.ctx.lineTo(shellRadius * 0.34, directive.size * 0.18);
          this.ctx.closePath();
          this.ctx.fill();
          this.ctx.restore();
        }
        break;
      case "electric-shell":
        this.ctx.strokeStyle = lightningColor(theme, clamp(shellAlpha * 1.3, 0.05, 0.22));
        this.ctx.lineWidth = 1.8;
        this.ctx.beginPath();
        this.ctx.moveTo(-shellRadius * 0.7, -directive.size * 0.12);
        this.ctx.lineTo(-shellRadius * 0.18, -directive.size * 0.34);
        this.ctx.lineTo(shellRadius * 0.08, directive.size * 0.08);
        this.ctx.lineTo(shellRadius * 0.62, -directive.size * 0.18);
        this.ctx.stroke();
        break;
      case "soft-halo":
      default: {
        const gradient = this.ctx.createRadialGradient(0, 0, directive.size * 0.18, 0, 0, shellRadius);
        gradient.addColorStop(0, paletteColor(theme, 0.12, shellAlpha * 0.9, 10));
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, shellRadius, 0, Math.PI * 2);
        this.ctx.fill();
        break;
      }
    }
    this.ctx.restore();
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
  }

  private drawPrimitiveShape(
    kind: HeroPrimitiveKind,
    size: number,
    deformation: HeroDeformationMode,
    time: number,
    intensity: number,
    fillMode: HeroCoreFillMode,
  ): void {
    const warp = this.lastHeroVariantWarp;
    const gravity = this.lastHeroVariantGravity;
    const inconsistency = this.lastHeroVariantInconsistency;
    const wobble = 1 + Math.sin(time * (4.2 + warp * 1.6)) * (0.08 + warp * 0.08) * intensity;
    const squashX = deformation === "squash" ? 1 + intensity * (0.16 + warp * 0.14) : deformation === "shear" ? 1.08 + warp * 0.18 : wobble + inconsistency * 0.04;
    const squashY = deformation === "squash" ? 1 - intensity * (0.12 + gravity * 0.08) : deformation === "petal" ? 1 + intensity * 0.06 : 1 / wobble + gravity * 0.06;
    const tilt = deformation === "tilt" ? intensity * (0.24 + warp * 0.24) : warp * 0.08;
    this.ctx.save();
    this.ctx.rotate(tilt);
    this.ctx.scale(squashX, squashY);
    const radius = Math.max(1, size);
    const gravityDrop = gravity * radius * 0.14;
    const inconsistencySwing = (sampleNoise2D(time * 0.9, radius * 0.07, 17) - 0.5) * inconsistency * radius * 0.22;
    switch (kind) {
      case "circle":
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
        break;
      case "ellipse":
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, radius * 1.08, radius * 0.72, 0, 0, Math.PI * 2);
        break;
      case "line":
        this.ctx.beginPath();
        this.ctx.moveTo(-radius, 0);
        this.ctx.lineTo(radius, 0);
        break;
      case "rectangle":
        this.ctx.beginPath();
        this.ctx.rect(-radius, -radius * 0.72, radius * 2, radius * 1.44);
        break;
      case "square":
        this.ctx.beginPath();
        this.ctx.rect(-radius, -radius, radius * 2, radius * 2);
        break;
      case "diamond":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -radius * (1 + warp * 0.12));
        this.ctx.lineTo(radius * (0.92 + inconsistency * 0.12), inconsistencySwing * 0.2);
        this.ctx.lineTo(0, radius * (1 + gravity * 0.22));
        this.ctx.lineTo(-radius * (0.92 - inconsistency * 0.08), gravityDrop * 0.1);
        this.ctx.closePath();
        break;
      case "pentagon":
      case "hexagon":
      case "octagon":
      case "star":
      case "hexagram":
      case "asterisk":
        this.drawPolygonalPrimitive(kind, radius, intensity);
        break;
      case "heart":
        this.ctx.beginPath();
        this.ctx.moveTo(0, radius * (0.88 + gravity * 0.12));
        this.ctx.bezierCurveTo(radius * (1.1 + inconsistency * 0.08), radius * (0.2 + gravity * 0.12), radius * (0.9 + warp * 0.08), -radius * (0.72 - warp * 0.08), 0, -radius * 0.2);
        this.ctx.bezierCurveTo(-radius * (0.9 - inconsistency * 0.06), -radius * (0.72 - warp * 0.08), -radius * (1.1 + inconsistency * 0.08), radius * (0.2 + gravity * 0.12), 0, radius * (0.88 + gravity * 0.12));
        this.ctx.closePath();
        break;
      case "moon":
        this.ctx.beginPath();
        this.ctx.arc(0, gravityDrop * 0.12, radius * (1 + warp * 0.06), -Math.PI / 2, (Math.PI / 2) * 3, false);
        this.ctx.arc(radius * (0.36 + inconsistency * 0.08), gravityDrop * 0.08, radius * (0.78 - warp * 0.08), (Math.PI / 2) * 3, -Math.PI / 2, true);
        this.ctx.closePath();
        break;
      case "parallelogram":
        this.ctx.beginPath();
        this.ctx.moveTo(-radius * 0.76, -radius * 0.72);
        this.ctx.lineTo(radius * 0.54, -radius * 0.72);
        this.ctx.lineTo(radius * 0.9, radius * 0.72);
        this.ctx.lineTo(-radius * 0.42, radius * 0.72);
        this.ctx.closePath();
        break;
      case "cross":
        this.ctx.beginPath();
        this.ctx.rect(-radius * 0.24, -radius, radius * 0.48, radius * 2);
        this.ctx.rect(-radius, -radius * 0.24, radius * 2, radius * 0.48);
        break;
      case "arrow":
      case "chevron":
      case "kite":
      case "lightning":
        this.drawAngularPrimitive(kind, radius, intensity);
        break;
      case "arc":
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius, Math.PI * 0.15, Math.PI * 0.85);
        break;
      case "sector":
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, radius, -Math.PI * 0.35, Math.PI * 0.35);
        this.ctx.closePath();
        break;
      case "ring":
        this.ctx.beginPath();
        this.ctx.ellipse(inconsistencySwing * 0.12, gravityDrop * 0.12, radius * (1 + warp * 0.08), radius * (1 - gravity * 0.1), tilt, 0, Math.PI * 2);
        break;
      case "cloud":
        this.drawCloudPrimitive(radius, intensity);
        break;
      case "stadium":
        this.ctx.beginPath();
        this.ctx.moveTo(-radius * 0.7, -radius * (0.5 - warp * 0.08));
        this.ctx.lineTo(radius * 0.7, -radius * (0.5 - warp * 0.08));
        this.ctx.arc(radius * 0.7, gravityDrop * 0.08, radius * (0.5 + inconsistency * 0.06), -Math.PI / 2, Math.PI / 2);
        this.ctx.lineTo(-radius * 0.7, radius * (0.5 + gravity * 0.18));
        this.ctx.arc(-radius * 0.7, gravityDrop * 0.08, radius * (0.5 - inconsistency * 0.04), Math.PI / 2, -Math.PI / 2);
        this.ctx.closePath();
        break;
      case "lens":
        this.ctx.beginPath();
        this.ctx.ellipse(-radius * (0.18 + inconsistency * 0.05), gravityDrop * 0.08, radius * (0.72 + warp * 0.08), radius * (0.42 - gravity * 0.06), warp * 0.1, -Math.PI / 2, Math.PI / 2);
        this.ctx.ellipse(radius * (0.18 - inconsistency * 0.05), gravityDrop * 0.08, radius * (0.72 - warp * 0.04), radius * (0.42 - gravity * 0.04), -warp * 0.08, Math.PI / 2, -Math.PI / 2);
        this.ctx.closePath();
        break;
      case "spiral":
        this.ctx.beginPath();
        for (let angle = 0; angle <= Math.PI * 3.6; angle += 0.11) {
          const r = (radius / (Math.PI * 3.6)) * angle * (1 + intensity * 0.12);
          const px = r * Math.cos(angle + time * 0.24);
          const py = r * Math.sin(angle + time * 0.24);
          angle === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        break;
      case "teardrop":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -radius * (1 - warp * 0.06));
        this.ctx.bezierCurveTo(radius * (0.92 + inconsistency * 0.1), -radius * (0.44 - warp * 0.12), radius * (0.86 - inconsistency * 0.08), radius * (1 + gravity * 0.2), 0, radius * (1 + gravity * 0.14));
        this.ctx.bezierCurveTo(-radius * (0.86 + inconsistency * 0.06), radius * (1 + gravity * 0.2), -radius * (0.92 - inconsistency * 0.08), -radius * (0.44 - warp * 0.12), 0, -radius * (1 - warp * 0.06));
        this.ctx.closePath();
        break;
    }
    if (fillMode === "solid") {
      this.ctx.fill();
      this.ctx.stroke();
    } else if (fillMode === "stroke-fill") {
      this.ctx.globalAlpha *= 0.72;
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
      this.ctx.stroke();
    } else {
      this.ctx.stroke();
      if (kind === "ring" || kind === "arc" || kind === "moon" || kind === "lens") {
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  private drawPolygonalPrimitive(kind: HeroPrimitiveKind, radius: number, intensity: number): void {
    const warp = this.lastHeroVariantWarp;
    const gravity = this.lastHeroVariantGravity;
    const inconsistency = this.lastHeroVariantInconsistency;
    if (kind === "star") {
      const spikes = 5;
      const inner = radius * (0.42 - intensity * 0.04 + inconsistency * 0.04);
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      this.ctx.beginPath();
      this.ctx.moveTo(0, -radius);
      for (let i = 0; i < spikes; i += 1) {
        const outer = radius * (1 + warp * 0.1 * Math.sin(i + intensity));
        this.ctx.lineTo(Math.cos(rot) * outer, Math.sin(rot) * outer);
        rot += step;
        this.ctx.lineTo(Math.cos(rot) * inner, Math.sin(rot) * inner * (1 + gravity * 0.1));
        rot += step;
      }
      this.ctx.closePath();
      return;
    }
    if (kind === "hexagram") {
      this.ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = -Math.PI / 2 + (Math.PI / 3) * i;
        const px = Math.cos(a) * radius;
        const py = Math.sin(a) * radius;
        i === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
      }
      this.ctx.closePath();
      this.ctx.moveTo(0, radius);
      for (let i = 0; i < 6; i += 1) {
        const a = Math.PI / 2 + (Math.PI / 3) * i;
        const px = Math.cos(a) * radius;
        const py = Math.sin(a) * radius;
        i === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
      }
      this.ctx.closePath();
      return;
    }
    if (kind === "asterisk") {
      this.ctx.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const a = (Math.PI / 4) * i;
        this.ctx.moveTo(-Math.cos(a) * radius, -Math.sin(a) * radius);
        this.ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      }
      return;
    }
    const sides = kind === "pentagon" ? 5 : kind === "hexagon" ? 6 : 8;
    this.ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
      const localRadius = radius * (1 + Math.sin(angle * 3 + intensity * 2) * warp * 0.12 + (i % 2 === 0 ? inconsistency * 0.06 : -inconsistency * 0.04));
      const px = Math.cos(angle) * localRadius;
      const py = Math.sin(angle) * localRadius * (1 + gravity * 0.12);
      i === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
  }

  private drawAngularPrimitive(kind: HeroPrimitiveKind, radius: number, intensity: number): void {
    this.ctx.beginPath();
    switch (kind) {
      case "arrow":
        this.ctx.moveTo(-radius * 0.88, -radius * 0.32);
        this.ctx.lineTo(radius * 0.08, -radius * 0.32);
        this.ctx.lineTo(radius * 0.08, -radius * 0.76);
        this.ctx.lineTo(radius, 0);
        this.ctx.lineTo(radius * 0.08, radius * 0.76);
        this.ctx.lineTo(radius * 0.08, radius * 0.32);
        this.ctx.lineTo(-radius * 0.88, radius * 0.32);
        this.ctx.closePath();
        break;
      case "chevron":
        this.ctx.moveTo(-radius * 0.72, -radius * 0.7);
        this.ctx.lineTo(0, 0);
        this.ctx.lineTo(-radius * 0.72, radius * 0.7);
        this.ctx.lineTo(radius * 0.18, radius * 0.36);
        this.ctx.lineTo(radius * 0.9, radius * 0.7);
        this.ctx.lineTo(radius * 0.18, 0);
        this.ctx.lineTo(radius * 0.9, -radius * 0.7);
        this.ctx.lineTo(radius * 0.18, -radius * 0.36);
        this.ctx.closePath();
        break;
      case "kite":
        this.ctx.moveTo(0, -radius);
        this.ctx.lineTo(radius * 0.72, 0);
        this.ctx.lineTo(0, radius * 0.86);
        this.ctx.lineTo(-radius * 0.46, 0);
        this.ctx.closePath();
        break;
      case "lightning":
      default:
        this.ctx.moveTo(-radius * 0.18, -radius);
        this.ctx.lineTo(radius * 0.22, -radius * 0.18);
        this.ctx.lineTo(-radius * 0.06, -radius * 0.18);
        this.ctx.lineTo(radius * 0.18, radius);
        this.ctx.lineTo(-radius * 0.26, radius * 0.16);
        this.ctx.lineTo(radius * 0.02, radius * 0.16);
        this.ctx.closePath();
        break;
    }
  }

  private drawCloudPrimitive(radius: number, intensity: number): void {
    const warp = this.lastHeroVariantWarp;
    const gravity = this.lastHeroVariantGravity;
    const inconsistency = this.lastHeroVariantInconsistency;
    this.ctx.beginPath();
    const lobe = 1 + intensity * 0.08 + warp * 0.08;
    this.ctx.arc(-radius * 0.46, gravity * radius * 0.06, radius * 0.42 * lobe * (1 + inconsistency * 0.06), Math.PI * 0.86, Math.PI * 1.94);
    this.ctx.arc(0, -radius * (0.18 - warp * 0.08), radius * 0.54 * lobe, Math.PI, 0);
    this.ctx.arc(radius * 0.48, gravity * radius * 0.08, radius * 0.4 * lobe * (1 - inconsistency * 0.04), Math.PI * 1.14, Math.PI * 0.06, true);
    this.ctx.closePath();
  }

  private drawDreamWarp(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    visualState: VisualState,
    edgeMap: EdgeMap,
    qualityBudget: RenderQualityBudget,
  ): void {
    if (qualityBudget.skipFullFrameFeedback || qualityBudget.skipOverlayExtras) {
      return;
    }
    if (visualState.regime !== "build" && visualState.regime !== "drop" && frame.peakStrength < 0.42) {
      return;
    }
    const intensity = clamp(
      frame.normalizedLow * 0.34 +
      frame.normalizedHigh * 0.24 +
      frame.peakStrength * 0.4 +
      (visualState.regime === "build" ? 0.12 : 0) +
      (visualState.regime === "drop" ? 0.22 : 0),
      0,
      1,
    );
    if (intensity < 0.22) {
      return;
    }

    this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);

    const cx = activeSubject.x || edgeMap.focalCenterX;
    const cy = activeSubject.y || edgeMap.focalCenterY;
    const wobble = Math.sin(frame.timeSec * (1.4 + frame.normalizedMid * 1.8) + activeSubject.gesturePhase) * intensity;
    const scaleX = 1 + intensity * 0.08 + frame.normalizedLow * 0.06;
    const scaleY = 1 - intensity * 0.045 + frame.normalizedHigh * 0.02;
    const rotation = wobble * 0.08;
    const dx = Math.cos(frame.timeSec * 1.8) * intensity * 22;
    const dy = Math.sin(frame.timeSec * 1.4) * intensity * 16;

    this.ctx.save();
    this.ctx.globalCompositeOperation = visualState.regime === "drop" ? "screen" : "lighten";
    this.ctx.globalAlpha = clamp(0.08 + intensity * 0.18, 0.07, 0.24);
    this.ctx.translate(cx, cy);
    this.ctx.rotate(rotation);
    this.ctx.scale(scaleX, scaleY);
    this.ctx.drawImage(this.scratchCanvas as any, -cx + dx, -cy + dy, this.settings.width, this.settings.height);
    this.ctx.restore();

    if (visualState.regime === "build" || visualState.regime === "drop") {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(0.05 + intensity * 0.12, 0.05, 0.16);
      const ringCount = visualState.regime === "drop" ? 4 : 3;
      for (let index = 0; index < ringCount; index += 1) {
        const radius = activeSubject.radius * (0.8 + index * 0.42) * (1 + frame.beatPulse * 0.35);
        this.ctx.strokeStyle = paletteColor(theme, frame.timeSec * 0.12 + index * 0.17, 0.08 + intensity * 0.04, 12 + index * 2);
        this.ctx.lineWidth = 1.2 + index * 0.35;
        this.ctx.beginPath();
        this.ctx.ellipse(
          cx,
          cy,
          radius * (1 + Math.sin(frame.timeSec * 1.3 + index) * 0.16),
          radius * (0.55 + Math.cos(frame.timeSec * 1.1 + index) * 0.12),
          rotation + index * 0.22,
          0,
          Math.PI * 2,
        );
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  private drawActiveSubjectTrails(
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    safetyMetrics: VisualSafetyMetrics,
  ): void {
    const recoveryScale = safetyMetrics.recoveryActive ? 0.6 : 1;
    this.ctx.save();
    this.ctx.globalCompositeOperation = activeSubject.mode === "ghost" ? "lighten" : "screen";
    for (let index = 0; index < activeSubject.trail.length; index += 1) {
      const trailPoint = activeSubject.trail[index]!;
      const fade = 1 - index / Math.max(1, activeSubject.trail.length);
      const radius = safeRadius(trailPoint.size * (activeSubject.mode === "ghost" ? 0.62 : 0.42), 1);
      const gradient = this.ctx.createRadialGradient(trailPoint.x, trailPoint.y, 0, trailPoint.x, trailPoint.y, radius);
      gradient.addColorStop(0, plasmaCoreColor(theme, trailPoint.alpha * 0.55 * recoveryScale, index / Math.max(1, activeSubject.trail.length)));
      gradient.addColorStop(0.5, paletteColor(theme, index / Math.max(1, activeSubject.trail.length), trailPoint.alpha * 0.28 * recoveryScale, activeSubject.mode === "ghost" ? -6 : 4));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      this.ctx.globalAlpha = clamp(trailPoint.alpha * fade * 0.44 * recoveryScale, 0.02, 0.16);
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(trailPoint.x, trailPoint.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.save();
      this.ctx.translate(trailPoint.x, trailPoint.y);
      this.ctx.rotate(Math.atan2(activeSubject.vy || 0.001, activeSubject.vx || 0.001));
      this.ctx.fillStyle = paletteColor(theme, fade * 0.3, 0.05 * recoveryScale, activeSubject.mode === "ghost" ? -2 : 6);
      this.drawPrimitiveShape(
        activeSubject.mode === "strike" ? "chevron" : activeSubject.mode === "ghost" ? "teardrop" : "diamond",
        Math.max(1.2, radius * 0.82),
        "pulse",
        index * 0.07,
        fade * 0.3,
        "solid",
      );
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  private drawActiveSubjectAccents(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    activeSubject: ActiveSubjectState,
    safetyMetrics: VisualSafetyMetrics,
  ): void {
    const recoveryScale = safetyMetrics.recoveryActive ? 0.7 : 1;
    const satellites = activeSubject.mode === "orbit" ? 4 : activeSubject.mode === "strike" ? 3 : 2;
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    switch (activeSubject.mode) {
      case "hover":
      case "sway":
        for (let index = 0; index < satellites; index += 1) {
          const angle = activeSubject.gesturePhase * 0.8 + (index / satellites) * Math.PI * 2;
          const radius = activeSubject.radius * (0.8 + index * 0.22);
          const x = activeSubject.x + Math.cos(angle) * radius;
          const y = activeSubject.y + Math.sin(angle) * radius * 0.55;
          this.ctx.fillStyle = paletteColor(theme, index / satellites, 0.09 * recoveryScale, 10);
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.rotate(angle);
          this.drawPrimitiveShape("diamond", 4 + index * 1.4, "pulse", frame.timeSec, 0.35, "solid");
          this.ctx.restore();
        }
        break;
      case "windup":
        for (let step = 0; step < 10; step += 1) {
          const t = step / 9;
          const angle = activeSubject.gesturePhase * 1.4 + t * Math.PI * 2.1;
          const radius = activeSubject.radius * (0.24 + t * 0.72);
          const x = activeSubject.x + Math.cos(angle) * radius;
          const y = activeSubject.y + Math.sin(angle) * radius * 0.72;
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.rotate(angle + Math.PI / 2);
          this.ctx.fillStyle = paletteColor(theme, 0.2 + t * 0.15, 0.08 * recoveryScale, 10);
          this.drawPrimitiveShape("chevron", 3.6 + t * 2.4, "tilt", frame.timeSec + t, 0.4, "solid");
          this.ctx.restore();
        }
        break;
      case "strike": {
        const angle = Math.atan2(activeSubject.vy, activeSubject.vx || 0.001);
        this.ctx.translate(activeSubject.x, activeSubject.y);
        this.ctx.rotate(angle);
        this.ctx.fillStyle = paletteColor(theme, 0.08, 0.16 * recoveryScale, 18);
        this.ctx.beginPath();
        this.ctx.moveTo(-activeSubject.radius * 0.3, -activeSubject.radius * 0.16);
        this.ctx.lineTo(activeSubject.radius * 1.4, 0);
        this.ctx.lineTo(-activeSubject.radius * 0.24, activeSubject.radius * 0.16);
        this.ctx.closePath();
        this.ctx.fill();
        break;
      }
      case "orbit":
        for (let index = 0; index < 5; index += 1) {
          const angle = activeSubject.gesturePhase * 2.1 + (index / 5) * Math.PI * 2;
          const radius = activeSubject.radius * (0.8 + (index % 2) * 0.28);
          const x = activeSubject.x + Math.cos(angle) * radius;
          const y = activeSubject.y + Math.sin(angle) * radius * 0.76;
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.rotate(angle);
          this.ctx.fillStyle = paletteColor(theme, index / 5, 0.08 * recoveryScale, 8);
          this.drawPrimitiveShape(index % 2 === 0 ? "lens" : "hexagon", 4.4 + (index % 3) * 1.6, "pulse", frame.timeSec, 0.32, "stroke-fill");
          this.ctx.restore();
        }
        break;
      case "ghost":
        for (let index = 0; index < 3; index += 1) {
          const angle = activeSubject.gesturePhase * 0.5 + index * 1.7;
          const x = activeSubject.x + Math.cos(angle) * activeSubject.radius * 0.35;
          const y = activeSubject.y + Math.sin(angle) * activeSubject.radius * 0.45;
          const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, activeSubject.radius * (0.45 + index * 0.18));
          gradient.addColorStop(0, paletteColor(theme, 0.4 + index * 0.1, 0.06 * recoveryScale, -4));
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          this.ctx.fillStyle = gradient;
          this.ctx.beginPath();
          this.ctx.arc(x, y, activeSubject.radius * (0.45 + index * 0.18), 0, Math.PI * 2);
          this.ctx.fill();
        }
        break;
      case "dissolve":
        for (let index = 0; index < 8; index += 1) {
          const angle = activeSubject.gesturePhase * 0.4 + index * 0.7;
          const x = activeSubject.x + Math.cos(angle) * activeSubject.radius * (0.8 + index * 0.06);
          const y = activeSubject.y + Math.sin(angle) * activeSubject.radius * (0.55 + index * 0.04);
          this.ctx.fillStyle = paletteColor(theme, index / 8, 0.07 * recoveryScale, 4);
          this.ctx.save();
          this.ctx.translate(x, y);
          this.drawPrimitiveShape("teardrop", 2.6 + (index % 3), "wobble", frame.timeSec, 0.3, "solid");
          this.ctx.restore();
        }
        break;
    }
    this.ctx.restore();
  }

  private drawHeroGlyphLayer(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    x: number,
    y: number,
    size: number,
    rotation: number,
    options?: {
      alphaScale?: number;
      glyphs?: HeroGlyphKind[];
    },
  ): void {
    const startedAt = performance.now();
    const glyphs = options?.glyphs ?? heroGlyphKinds(theme, frame);
    const colors = colorStats(theme);
    const bandPulse =
      frame.dominantBand === "low" ? frame.normalizedLow :
      frame.dominantBand === "mid" ? frame.normalizedMid :
      frame.normalizedHigh;
    const alphaScale = options?.alphaScale ?? 1;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(rotation);
    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index]!;
      const stat = colors[index % colors.length]!;
      this.ctx.strokeStyle = rgbaColor(stat, (0.22 + bandPulse * 0.14 - index * 0.03) * alphaScale);
      this.ctx.fillStyle = rgbaColor(stat, (0.08 + bandPulse * 0.08 - index * 0.02) * alphaScale);
      this.ctx.lineWidth = 1.4 + index * 0.4;
      this.drawHeroGlyph(glyph, size * (1 - index * 0.18), frame.timeSec, 4 + index);
    }
    this.ctx.restore();
    this.lastStageMetrics.heroMs += performance.now() - startedAt;
    this.lastStageMetrics.heroGlyphDrawCount += glyphs.length;
  }

  private drawHeroGlyph(kind: HeroGlyphKind, size: number, time: number, variant: number): void {
    switch (kind) {
      case "star": {
        const spikes = 5 + (variant % 4);
        const inner = size * 0.38;
        let rot = (Math.PI / 2) * 3;
        const step = Math.PI / spikes;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -size);
        for (let i = 0; i < spikes; i += 1) {
          this.ctx.lineTo(Math.cos(rot) * size, Math.sin(rot) * size);
          rot += step;
          this.ctx.lineTo(Math.cos(rot) * inner, Math.sin(rot) * inner);
          rot += step;
        }
        this.ctx.closePath();
        break;
      }
      case "infinity":
        this.ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2; t += 0.1) {
          const px = size * Math.cos(t);
          const py = (size * 0.5) * Math.sin(2 * t);
          t === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        break;
      case "glint":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -size);
        this.ctx.quadraticCurveTo(0, 0, size, 0);
        this.ctx.quadraticCurveTo(0, 0, 0, size);
        this.ctx.quadraticCurveTo(0, 0, -size, 0);
        this.ctx.quadraticCurveTo(0, 0, 0, -size);
        this.ctx.closePath();
        break;
      case "hexagon":
        this.ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const angle = (Math.PI / 3) * i;
          const px = Math.cos(angle) * size;
          const py = Math.sin(angle) * size;
          i === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        break;
      case "rose":
        this.ctx.beginPath();
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          const r = size * Math.cos((variant % 5) * a);
          const px = r * Math.cos(a);
          const py = r * Math.sin(a);
          a === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        break;
      case "teardrop":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -size);
        this.ctx.bezierCurveTo(size, -size * 0.5, size, size, 0, size);
        this.ctx.bezierCurveTo(-size, size, -size, -size * 0.5, 0, -size);
        this.ctx.closePath();
        break;
      case "chevron":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -size);
        this.ctx.lineTo(size / 1.5, size);
        this.ctx.lineTo(0, size / 2);
        this.ctx.lineTo(-size / 1.5, size);
        this.ctx.closePath();
        break;
      case "spiral":
        this.ctx.beginPath();
        for (let angle = 0; angle <= Math.PI * (4 + variant); angle += 0.1) {
          const r = (size / (Math.PI * (4 + variant))) * angle;
          const px = r * Math.cos(angle + time * 0.3);
          const py = r * Math.sin(angle + time * 0.3);
          angle === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        break;
      case "blob":
        this.ctx.beginPath();
        for (let a = 0; a < Math.PI * 2; a += 0.1) {
          const wobble = Math.sin(a * 4 + time * 3) * (size * 0.16);
          const r = size + wobble;
          const px = r * Math.cos(a);
          const py = r * Math.sin(a);
          a === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        break;
      case "crescent":
        this.ctx.beginPath();
        this.ctx.arc(0, 0, size, -Math.PI / 2, (Math.PI / 2) * 3, false);
        this.ctx.arc(size * 0.4, 0, size * 0.8, (Math.PI / 2) * 3, -Math.PI / 2, true);
        this.ctx.closePath();
        break;
      case "mask":
        this.ctx.beginPath();
        this.ctx.moveTo(0, -size);
        this.ctx.bezierCurveTo(size * 0.9, -size * 0.72, size * 0.88, size * 0.66, 0, size);
        this.ctx.bezierCurveTo(-size * 0.88, size * 0.66, -size * 0.9, -size * 0.72, 0, -size);
        this.ctx.closePath();
        break;
      case "eye":
        this.ctx.beginPath();
        this.ctx.moveTo(-size, 0);
        this.ctx.quadraticCurveTo(0, -size * 0.68, size, 0);
        this.ctx.quadraticCurveTo(0, size * 0.68, -size, 0);
        this.ctx.closePath();
        break;
      case "crown":
        this.ctx.beginPath();
        this.ctx.moveTo(-size, size * 0.5);
        this.ctx.lineTo(-size * 0.62, -size * 0.82);
        this.ctx.lineTo(0, -size * 0.18);
        this.ctx.lineTo(size * 0.62, -size * 0.82);
        this.ctx.lineTo(size, size * 0.5);
        this.ctx.closePath();
        break;
      case "halo":
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, size, size * 0.46, 0, 0, Math.PI * 2);
        break;
      case "fang":
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.28, -size);
        this.ctx.lineTo(size * 0.3, size * 0.92);
        this.ctx.lineTo(-size * 0.56, size * 0.34);
        this.ctx.closePath();
        break;
      case "sigil":
        this.ctx.beginPath();
        for (let i = 0; i < 8; i += 1) {
          const angle = (Math.PI * 2 * i) / 8;
          const r = i % 2 === 0 ? size : size * 0.42;
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          i === 0 ? this.ctx.moveTo(px, py) : this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        break;
      case "wing":
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.2, 0);
        this.ctx.quadraticCurveTo(size * 0.95, -size * 0.84, size * 0.44, 0);
        this.ctx.quadraticCurveTo(size * 0.95, size * 0.84, -size * 0.2, 0);
        this.ctx.closePath();
        break;
      case "hand":
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.48, size * 0.92);
        this.ctx.lineTo(-size * 0.22, -size * 0.92);
        this.ctx.lineTo(0, -size * 0.36);
        this.ctx.lineTo(size * 0.22, -size);
        this.ctx.lineTo(size * 0.36, -size * 0.1);
        this.ctx.lineTo(size * 0.58, -size * 0.82);
        this.ctx.lineTo(size * 0.74, size * 0.74);
        this.ctx.closePath();
        break;
      case "stair":
        this.ctx.beginPath();
        this.ctx.moveTo(-size, size);
        this.ctx.lineTo(-size, size * 0.44);
        this.ctx.lineTo(-size * 0.34, size * 0.44);
        this.ctx.lineTo(-size * 0.34, -size * 0.06);
        this.ctx.lineTo(size * 0.22, -size * 0.06);
        this.ctx.lineTo(size * 0.22, -size * 0.52);
        this.ctx.lineTo(size, -size * 0.52);
        this.ctx.lineTo(size, -size);
        break;
      case "gate":
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.82, size);
        this.ctx.lineTo(-size * 0.82, -size * 0.12);
        this.ctx.quadraticCurveTo(0, -size, size * 0.82, -size * 0.12);
        this.ctx.lineTo(size * 0.82, size);
        this.ctx.closePath();
        break;
      case "totem":
        this.ctx.beginPath();
        this.ctx.rect(-size * 0.28, -size, size * 0.56, size * 2);
        break;
      case "lightning":
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.16, -size);
        this.ctx.lineTo(size * 0.12, -size * 0.22);
        this.ctx.lineTo(-size * 0.08, -size * 0.22);
        this.ctx.lineTo(size * 0.24, size);
        this.ctx.lineTo(-size * 0.24, size * 0.12);
        this.ctx.lineTo(size * 0.02, size * 0.12);
        this.ctx.closePath();
        break;
    }
    this.ctx.fill();
    this.ctx.stroke();
  }

  private transitionProgress(frame: AudioFrameFeature): number | undefined {
    const transition = this.transitionState;
    if (!transition || transition.toImagePath !== this.lastImagePath) {
      return undefined;
    }
    const elapsedFrames = frame.frameIndex - transition.startFrameIndex;
    if (elapsedFrames < 0) {
      return undefined;
    }
    return clamp(elapsedFrames / Math.max(1, transition.durationFrames), 0, 1);
  }

  private prepareFeedbackState(frame: AudioFrameFeature, resetFeedback: boolean): void {
    const progress = this.transitionProgress(frame);
    this.feedbackCtx.clearRect(0, 0, this.settings.width, this.settings.height);

    if (progress === undefined) {
      this.feedbackCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);
      return;
    }

    const eased = this.smoothstep(0, 1, progress);
    const previousAlpha = 1 - eased;
    const currentAlpha = clamp(0.25 + eased * 0.95, 0.25, 1);

    this.feedbackCtx.save();
    this.feedbackCtx.globalAlpha = previousAlpha;
    this.feedbackCtx.filter = `blur(${Math.max(0, (1 - eased) * 3).toFixed(2)}px)`;
    this.feedbackCtx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.feedbackCtx.restore();

    this.bridgeCtx.clearRect(0, 0, this.settings.width, this.settings.height);
    this.bridgeCtx.save();
    this.bridgeCtx.globalAlpha = currentAlpha;
    this.bridgeCtx.filter = `blur(${Math.max(0, (1 - eased) * 1.2).toFixed(2)}px)`;
    this.bridgeCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);
    this.bridgeCtx.restore();

    this.feedbackCtx.save();
    this.feedbackCtx.globalCompositeOperation = "screen";
    this.feedbackCtx.drawImage(this.bridgeCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.feedbackCtx.restore();
  }

  private resolveAdaptiveEffectBudget(
    visualState: VisualState,
    frame: AudioFrameFeature,
    previousStageMetrics: RenderStageMetrics,
    previousBudgetDowngradeCount: number,
  ): RenderQualityBudget {
    const baseBudget = buildEffectBudget(visualState, this.settings.width, this.settings.height, frame, this.fastMode, this.diagnosticOverrides);
    if (this.diagnosticOverrides.disableBudgetDowngrades) {
      return {
        ...baseBudget,
        budgetDowngradeCount: 0,
        adaptiveDegradeLevel: 0,
      };
    }
    if (!this.fastMode) {
      return {
        ...baseBudget,
        adaptiveDegradeLevel: 0,
      };
    }
    const frameBudgetMs = 1000 / Math.max(1, this.settings.fps);
    const softOverload =
      previousStageMetrics.effectsMs + previousStageMetrics.transitionMs > frameBudgetMs * 0.3 ||
      this.lastEncoderPressureMs > 250 ||
      (previousBudgetDowngradeCount > 0 && previousStageMetrics.effectsMs + previousStageMetrics.transitionMs > frameBudgetMs * 0.24);
    const hardOverload =
      previousStageMetrics.effectsMs + previousStageMetrics.transitionMs > frameBudgetMs * 0.5 ||
      this.lastEncoderPressureMs > 600 ||
      (previousBudgetDowngradeCount > 1 && previousStageMetrics.effectsMs + previousStageMetrics.transitionMs > frameBudgetMs * 0.4);
    const adaptiveDegradeLevel = hardOverload ? 2 : softOverload ? 1 : 0;
    return {
      ...baseBudget,
      effectPasses: hardOverload ? 1 : softOverload ? (Math.min(baseBudget.effectPasses, 2) as 1 | 2 | 3) : baseBudget.effectPasses,
      feedbackSlices: hardOverload ? 0 : softOverload ? Math.min(baseBudget.feedbackSlices, 1) : baseBudget.feedbackSlices,
      scanSliceHeight: softOverload ? Math.max(baseBudget.scanSliceHeight, 48) : baseBudget.scanSliceHeight,
      fullFrameFeedbackAlpha: softOverload ? baseBudget.fullFrameFeedbackAlpha * 0.6 : baseBudget.fullFrameFeedbackAlpha,
      skipFullFrameFeedback: hardOverload,
      skipFeedbackTintPasses: softOverload,
      skipOverlayExtras: softOverload,
      skipFadeWash: hardOverload,
      particleLimitScale: hardOverload ? baseBudget.particleLimitScale * 0.7 : softOverload ? baseBudget.particleLimitScale * 0.86 : baseBudget.particleLimitScale,
      occupancyLimitScale: hardOverload ? baseBudget.occupancyLimitScale * 0.78 : softOverload ? baseBudget.occupancyLimitScale * 0.9 : baseBudget.occupancyLimitScale,
      transitionDetailScale: hardOverload ? baseBudget.transitionDetailScale * 0.7 : softOverload ? baseBudget.transitionDetailScale * 0.85 : baseBudget.transitionDetailScale,
      budgetDowngradeCount: baseBudget.budgetDowngradeCount + (softOverload ? 1 : 0) + (hardOverload ? 1 : 0),
      adaptiveDegradeLevel,
    };
  }

  private applyWeakWindowBudget(
    baseBudget: RenderQualityBudget,
    compositionPlan: CompositionPlan,
    edgeMap: EdgeMap,
    fallbackRenderMode: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery",
    weakCompositionWindow: boolean,
  ): RenderQualityBudget {
    if (!weakCompositionWindow) {
      return baseBudget;
    }
    const supportNearHeroScore = computeSupportNearHeroScore(compositionPlan);
    const focalOccupancyScore = compositionPlan.focalOccupancyScore;
    const deadCenterVoidScore = computeDeadCenterVoidScore(compositionPlan, edgeMap);
    const severeWeakWindow =
      fallbackRenderMode === "fallback-composed" ||
      focalOccupancyScore < 0.14 ||
      (deadCenterVoidScore > 0.84 && supportNearHeroScore < 0.3);
    return {
      ...baseBudget,
      effectPasses: severeWeakWindow ? 1 : (Math.min(baseBudget.effectPasses, 2) as 1 | 2 | 3),
      feedbackSlices: severeWeakWindow ? 0 : Math.min(baseBudget.feedbackSlices, 1),
      scanSliceHeight: Math.max(baseBudget.scanSliceHeight, severeWeakWindow ? 54 : 42),
      fullFrameFeedbackAlpha: baseBudget.fullFrameFeedbackAlpha * (severeWeakWindow ? 0.42 : 0.68),
      skipFullFrameFeedback: baseBudget.skipFullFrameFeedback || severeWeakWindow,
      skipFeedbackTintPasses: true,
      skipOverlayExtras: true,
      skipFadeWash: baseBudget.skipFadeWash || severeWeakWindow,
      particleLimitScale: baseBudget.particleLimitScale * (severeWeakWindow ? 0.72 : 0.84),
      occupancyLimitScale: baseBudget.occupancyLimitScale * (severeWeakWindow ? 0.84 : 0.92),
      transitionDetailScale: baseBudget.transitionDetailScale * (severeWeakWindow ? 0.86 : 0.92),
      budgetDowngradeCount: baseBudget.budgetDowngradeCount + (severeWeakWindow ? 2 : 1),
      adaptiveDegradeLevel: Math.max(baseBudget.adaptiveDegradeLevel, severeWeakWindow ? 2 : 1),
    };
  }

  private shouldCapturePreEffectLuminanceSample(): boolean {
    return (this.diagnosticOverrides.telemetryMode ?? "summary") === "full";
  }

  private estimateLuminanceReadbackCostMs(): number {
    const sampledFrames = this.lastStageMetrics.luminanceReadbackFramesSampled ?? 0;
    if (sampledFrames <= 0) {
      return 0;
    }
    return this.lastStageMetrics.luminanceReadbackMs / sampledFrames;
  }

  private shouldSampleLowResFrameStats(): boolean {
    if (!this.fastMode) {
      return true;
    }
    if (this.renderedFrameCount === 0) {
      return true;
    }
    if (this.renderedFrameCount % BUDGET_LUMINANCE_SAMPLE_INTERVAL === 0) {
      return true;
    }
    // Force denser sampling after a recent dark signal so budget mode does not coast past true near-black runs.
    if (
      this.lastLowResFrameStats.darkestQuartileLuminance <= DARK_LUMINANCE_THRESHOLD * 2
    ) {
      return true;
    }
    return false;
  }

  private sampleLowResFrameStats(force = false): LowResFrameStats {
    const budgetGated = this.fastMode;
    const sampleInterval = budgetGated ? BUDGET_LUMINANCE_SAMPLE_INTERVAL : 1;
    this.lastStageMetrics.luminanceReadbackMode = budgetGated ? "budget-gated" : "full";
    this.lastStageMetrics.luminanceReadbackSampleInterval = sampleInterval;
    if (!force && !this.shouldSampleLowResFrameStats()) {
      this.lastStageMetrics.luminanceReadbackFramesSkipped = (this.lastStageMetrics.luminanceReadbackFramesSkipped ?? 0) + 1;
      this.lastStageMetrics.luminanceReadbackMsSavedEstimate =
        (this.lastStageMetrics.luminanceReadbackMsSavedEstimate ?? 0) + this.estimateLuminanceReadbackCostMs();
      return this.lastLowResFrameStats;
    }
    const readbackStartedAt = performance.now();
    this.luminanceCtx.clearRect(0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT);
    this.luminanceCtx.drawImage(this.canvas as any, 0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT);
    const imageData = this.luminanceCtx.getImageData(0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT);
    const rgba = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
    const { luminanceSample, darkestQuartileLuminance, darkSampleCount, sampleCount } = sampleStridedFrameStatsWasm({
      data: rgba,
      width: LUMINANCE_SAMPLE_WIDTH,
      height: LUMINANCE_SAMPLE_HEIGHT,
      strideX: 1,
      strideY: 1,
    });
    this.lastStageMetrics.luminanceReadbackMs += performance.now() - readbackStartedAt;
    this.lastStageMetrics.luminanceReadbackFramesSampled = (this.lastStageMetrics.luminanceReadbackFramesSampled ?? 0) + 1;
    return {
      luminanceSample,
      darkestQuartileLuminance,
      darkSampleCount,
      sampleCount,
    };
  }

  private captureEncoderBuffer(): Buffer {
    const readbackStartedAt = performance.now();
    const rgba = this.canvas.data();
    this.lastStageMetrics.encoderReadbackMs += performance.now() - readbackStartedAt;
    return rgba;
  }

  private captureRenderedFrame(budgetDowngradeCount: number): RenderedFrame {
    const previousStats = this.lastLowResFrameStats;
    const stats = this.sampleLowResFrameStats();
    const skippedReadback = stats === previousStats;
    const { luminanceSample, darkestQuartileLuminance, darkSampleCount, sampleCount } = stats;
    this.lastLowResFrameStats = {
      luminanceSample,
      darkestQuartileLuminance,
      darkSampleCount,
      sampleCount,
    };
    this.lastDarkestQuartileLuminance = darkestQuartileLuminance;
    const rgba = this.captureEncoderBuffer();
    return {
      rgba,
      luminanceSample,
      darkestQuartileLuminance,
      preEffectLuminanceSample: this.lastPreEffectLuminanceSample,
      blackFrame: darkSampleCount >= Math.max(1, Math.floor(sampleCount * 0.2)),
      sceneKey: this.lastSceneKey,
      budgetDowngradeCount: this.diagnosticOverrides.disableBudgetDowngrades ? 0 : budgetDowngradeCount,
      luminanceReadbackMode: this.lastStageMetrics.luminanceReadbackMode,
      luminanceReadbackSampleInterval: this.lastStageMetrics.luminanceReadbackSampleInterval,
      luminanceReadbackSkipped: skippedReadback,
      motifEffectId: this.lastMotifEffectId,
      motifEffectSelectionReason: this.lastMotifEffectSelectionReason,
      persistentMotifId: this.persistentMotifState?.id,
      persistentMotifLabel: this.persistentMotifState?.label,
      persistentMotifChanged: this.lastPersistentMotifChanged,
      persistentMotifCarryFrames: this.persistentMotifState?.carryFrames,
      eventSpecId: this.lastEventSpec?.id,
      eventSpecLabel: this.lastEventSpec?.label,
      eventSelectionReason: this.lastEventSelectionReason,
      motifEffectPhenomenon: this.lastMotifEffectPhenomenon,
      motifEffectAudioMode: this.lastMotifEffectAudioMode,
      motifEffectIntensity: this.lastMotifEffectIntensity,
      heroWarpActive: this.lastHeroWarpActive,
      adaptiveDegradeLevel: this.lastAdaptiveDegradeLevel,
      transitionBudgetTier: this.lastTransitionBudgetTier,
      transitionBudgetReason: this.lastTransitionBudgetReason,
      transitionBaseDurationFrames: this.lastTransitionBaseDurationFrames,
      transitionCappedDurationFrames: this.lastTransitionCappedDurationFrames,
      transitionCapLossFrames: this.lastTransitionCapLossFrames,
      transitionRiskScore: this.lastTransitionRiskScore,
      transitionCapCategory: this.lastTransitionCapCategory,
      sourceAffinityAvg: this.lastSourceAffinityAvg,
      sourceAffinityHeroAvg: this.lastSourceAffinityHeroAvg,
      sourceAffinitySupportAvg: this.lastSourceAffinitySupportAvg,
      particleConvergenceScore: this.lastParticleConvergenceScore,
      subEmitterChildren: this.lastSubEmitterChildren,
      heroTrailOccupancy: this.lastHeroTrailOccupancy,
      heroWakeLengthPx: this.lastHeroWakeLengthPx,
      heroBurstCount: this.lastHeroBurstCount,
      heroBurstChildren: this.lastHeroBurstChildren,
      heroMotorJitter: this.lastHeroMotorJitter,
      heroMotorThrust: this.lastHeroMotorThrust,
      heroBurnPhase: this.lastHeroBurnPhase,
      heroWakeTailAgeAvg: this.lastHeroWakeTailAgeAvg,
      heroWakeResetCount: this.lastHeroWakeResetCount,
      heroSpeedAvg: this.lastHeroSpeedAvg,
      heroSpeedPeak: this.lastHeroSpeedPeak,
      heroBaselineEmissionScale: this.lastHeroBaselineEmissionScale,
      heroZeroDbRecovery: this.lastHeroZeroDbRecovery,
      mainHeroLowDbThrottle: this.lastMainHeroLowDbThrottle,
      mainHeroFreezeActive: this.lastMainHeroFreezeActive,
      heroScalePulseAvg: this.lastHeroScalePulseAvg,
      heroScalePulsePeak: this.lastHeroScalePulsePeak,
      motifPotencyScore: this.lastMotifPotencyScore,
      transitionTriggerMode: this.lastTransitionTriggerMode,
      heroMotifVariantKey: this.lastHeroMotifVariantKey,
      heroVariantWarp: this.lastHeroVariantWarp,
      heroVariantGravity: this.lastHeroVariantGravity,
      heroVariantInconsistency: this.lastHeroVariantInconsistency,
      heroParticleSizeAvg: this.lastHeroParticleSizeAvg,
      heroParticleTtlAvg: this.lastHeroParticleTtlAvg,
      heroRelationshipMode: this.lastHeroRelationshipMode,
      heroRelationshipClass: this.lastHeroRelationshipClass,
      heroLayoutFamily: this.lastHeroLayoutFamily,
      heroInstanceCountResolved: this.lastHeroInstanceCountResolved,
      heroPairMinDistancePx: this.lastHeroPairMinDistancePx,
      heroPairAvgDistancePx: this.lastHeroPairAvgDistancePx,
      heroOverlapRatio: this.lastHeroOverlapRatio,
      heroCoreOverlapRatio: this.lastHeroCoreOverlapRatio,
      heroGlowMergeRatio: this.lastHeroGlowMergeRatio,
      heroLaneDiversityScore: this.lastHeroLaneDiversityScore,
      heroDistinctQuadrantCount: this.lastHeroDistinctQuadrantCount,
      heroRelationshipResolved: this.lastHeroRelationshipResolved,
      heroSeparationReadable: this.lastHeroSeparationReadable,
      heroSeparationFailureReason: this.lastHeroSeparationFailureReason,
      shotGrammarKey: this.lastShotGrammarKey,
      focalOccupancyScore: this.lastFocalOccupancyScore,
      centerBiasScore: this.lastCenterBiasScore,
      focalQuadrant: this.lastFocalQuadrant,
      heroQuadrant: this.lastHeroQuadrant,
      brightestBlobQuadrant: this.lastBrightestBlobQuadrant,
      supportClusterCount: this.lastSupportClusterCount,
      supportNearHeroScore: this.lastSupportNearHeroScore,
      edgeHighlightPenalty: this.lastEdgeHighlightPenalty,
      edgeDominanceMargin: this.lastEdgeDominanceMargin,
      deadCenterVoidScore: this.lastDeadCenterVoidScore,
      focalReinforcementScore: this.lastFocalReinforcementScore,
      dbTransitionDrive: this.lastDbTransitionDrive,
      bandWeightedTransitionDrive: this.lastBandWeightedTransitionDrive,
      hzTransitionDrive: this.lastHzTransitionDrive,
      audioTransitionScore: this.lastAudioTransitionScore,
      holdPenalty: this.lastHoldPenalty,
      swapPromotedByAudio: this.lastSwapPromotedByAudio,
      audioSwapPromotionChance: this.lastAudioSwapPromotionChance,
      audioSwapPromotionExtraChance: this.lastAudioSwapPromotionExtraChance,
      audioSwapNodeTriggerCount: this.lastAudioSwapNodeTriggerCount,
      heroSwapEligible: this.lastHeroSwapEligible,
      heroSwapSuppressedByGrace: this.lastHeroSwapSuppressedByGrace,
      heroSwapAudioDrive: this.lastHeroSwapAudioDrive,
      backgroundElementId: this.lastBackgroundElementId,
      backgroundSelectionReason: this.lastBackgroundSelectionReason,
      particleConceptIds: this.lastParticleConceptIds,
      particleSelectionReason: this.lastParticleSelectionReason,
      backgroundElementFamily: this.lastBackgroundElementFamily,
      backgroundTriggerMode: this.lastBackgroundTriggerMode || undefined,
      backgroundInteractionMode: this.lastBackgroundInteractionMode || undefined,
      backgroundHeroCouplingStrength: this.lastBackgroundHeroCouplingStrength,
      backgroundParticleCouplingStrength: this.lastBackgroundParticleCouplingStrength,
      backgroundTriggeredThisFrame: this.lastBackgroundTriggeredThisFrame,
      backgroundHeroInteractionActive: this.lastBackgroundHeroInteractionActive,
      backgroundTriggeredFrameRatio: this.lastBackgroundTriggeredFrameRatio,
      backgroundPeakColorEligible: this.lastBackgroundPeakColorEligible,
      backgroundPeakColorDrive: this.lastBackgroundPeakColorDrive,
      backgroundColorfulnessScale: this.lastBackgroundColorfulnessScale,
      backgroundLuminosityLiftAvg: this.lastBackgroundLuminosityLiftAvg,
      backgroundMinorImpactDrive: this.lastBackgroundMinorImpactDrive,
      supportElementDensity: this.lastSupportElementDensity,
      backgroundElementDensity: this.lastBackgroundElementDensity,
      heroIsolationScore: this.lastHeroIsolationScore,
      nearHeroEventDensity: this.lastNearHeroEventDensity,
      heroToSupportDistanceScore: this.lastHeroToSupportDistanceScore,
      transitionCarryMode: this.lastTransitionCarryMode,
      transitionCarryAvailabilityScore: this.lastTransitionCarryAvailabilityScore,
      transitionCarryFallbackReason: this.lastTransitionCarryFallbackReason,
      particleSpawnRequests: this.lastParticleSpawnRequests,
      particleRenderedCount: this.lastParticleRenderedCount,
      particleCulledByLayerCap: this.lastParticleCulledByLayerCap,
      particleCulledByHeroProtection: this.lastParticleCulledByHeroProtection,
      particleCulledByNegativeSpace: this.lastParticleCulledByNegativeSpace,
      particleCulledByImageProgress: this.lastParticleCulledByImageProgress,
      particleCulledBySkipNonHero: this.lastParticleCulledBySkipNonHero,
      particleOffscreenCount: this.lastParticleOffscreenCount,
      particleTooSmallToReadCount: this.lastParticleTooSmallToReadCount,
      particleLowAlphaCount: this.lastParticleLowAlphaCount,
      particleLowContrastCount: this.lastParticleLowContrastCount,
      particleVisibleCount: this.lastParticleVisibleCount,
      particleVisibleRatio: this.lastParticleVisibleRatio,
      heroParticleRenderedCount: this.lastHeroParticleRenderedCount,
      supportParticleRenderedCount: this.lastSupportParticleRenderedCount,
      backgroundParticleRenderedCount: this.lastBackgroundParticleRenderedCount,
      subEmitterTriggerCount: this.lastSubEmitterTriggerCount,
      subEmitterChildSpawnedCount: this.lastSubEmitterChildSpawnedCount,
      edgeDeathEligibleCount: this.lastEdgeDeathEligibleCount,
      edgeDeathTriggeredCount: this.lastEdgeDeathTriggeredCount,
      edgeDeathPlayedCount: this.lastEdgeDeathPlayedCount,
      edgeDeathSkippedByCostCount: this.lastEdgeDeathSkippedByCostCount,
      edgeDeathEffectId: this.lastEdgeDeathEffectId,
      edgeDeathCostTier: this.lastEdgeDeathCostTier,
      edgeExitFramesAvg: this.lastEdgeExitFramesAvg,
      edgeExitDistanceAvg: this.lastEdgeExitDistanceAvg,
      fallbackRenderMode: this.lastFallbackRenderMode,
      fallbackReason: this.lastFallbackReason,
      fallbackTriggerCount: this.lastFallbackTriggerCount,
      fallbackSeverity: this.lastFallbackSeverity,
      compositionModeReason: this.lastCompositionModeReason,
      particleTelemetryAvailable: this.lastParticleTelemetryAvailable,
      visibleFallbackRisk: this.lastVisibleFallbackRisk,
      outroEffectId: this.lastOutroEffectId,
      outroEffectCategory: this.lastOutroEffectCategory,
      outroEffectAudioMode: this.lastOutroEffectAudioMode,
      outroEffectIntensity: this.lastOutroEffectIntensity,
      outroEffectImageSignature: this.lastOutroEffectImageSignature,
      outroCoverageEstimate: this.lastOutroCoverageEstimate,
      outroHeroWarp: this.lastOutroHeroWarp,
      terminalBurstProgress: this.lastOutroTerminalBurstProgress,
      transitionIdentitySignature: this.lastTransitionIdentitySignature,
      transitionIdentityChanged: this.lastTransitionIdentityChanged,
      motifChangedOnTransition: this.lastMotifChangedOnTransition,
      heroChangedOnTransition: this.lastHeroChangedOnTransition,
      quarterSpawnGuaranteeHitCount: this.lastQuarterSpawnGuaranteeHitCount,
      quarterSpawnGuaranteeMissCount: this.lastQuarterSpawnGuaranteeMissCount,
      overlayOpacityAvg: this.lastOverlayOpacityAvg,
      overlayCompositeMode: this.lastOverlayCompositeMode,
      effectVisible: this.lastEffectVisible,
      effectVisiblePixelRatio: this.lastEffectVisiblePixelRatio,
      effectMotionDelta: this.lastEffectMotionDelta,
      framePostEffectId: this.lastFramePostEffectId,
      framePostEffectIntensity: this.lastFramePostEffectIntensity,
      stageMetrics: { ...this.lastStageMetrics },
    };
  }

  private updateSafetyMetrics(
    luminance: number,
    visualState: VisualState,
    overlayModeUsed: VisualState["overlayMode"],
    transitionFamilyUsed: TransitionFamily,
  ): VisualSafetyMetrics {
    this.trailingLuminance = this.trailingLuminance * 0.86 + luminance * 0.14;
    if (this.trailingLuminance < visualState.brightnessFloor - 0.01) {
      this.framesBelowFloor += 1;
      this.recoveryStableFrames = 0;
    } else {
      this.recoveryStableFrames += 1;
      const decay = this.recoveryStableFrames >= Math.round(this.settings.fps * 0.25) ? 4 : 2;
      this.framesBelowFloor = Math.max(0, this.framesBelowFloor - decay);
    }
    const recoveryActive =
      luminance < visualState.brightnessFloor - 0.015 ||
      this.trailingLuminance < visualState.brightnessFloor - 0.01 ||
      this.framesBelowFloor >= Math.max(5, Math.round(this.settings.fps * 0.15));
    if (recoveryActive) {
      this.safetyOverrideCount += 1;
      this.recoveryOverrideFrameCount += 1;
      this.recoveryStableFrames = 0;
    } else {
      this.safetyOverrideCount = Math.max(0, this.safetyOverrideCount - 1);
    }
    const recoveryOverrideFrameRatio = this.recoveryOverrideFrameCount / Math.max(1, this.renderedFrameCount);
    return {
      luminance,
      trailingLuminance: this.trailingLuminance,
      framesBelowFloor: this.framesBelowFloor,
      brightnessFloor: visualState.brightnessFloor,
      recoveryActive,
      safetyOverrideCount: this.safetyOverrideCount,
      recoveryOverrideFrameCount: this.recoveryOverrideFrameCount,
      recoveryOverrideFrameRatio,
      recoverySeverityScore: clamp(recoveryOverrideFrameRatio * 2, 0, 1),
      overlayModeUsed:
        recoveryActive
          ? overlayModeUsed === "climax-burst" || overlayModeUsed === "pulse-wave"
            ? "kinetic-scan"
            : overlayModeUsed === "sparse-contour"
              ? "stable-feedback"
              : overlayModeUsed
          : overlayModeUsed,
      transitionFamilyUsed: recoveryActive && transitionFamilyUsed === "flash" ? "wipe" : transitionFamilyUsed,
    };
  }

  private applySafetyGovernor(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    edgeMap: EdgeMap,
    anchors: NebulaGlowAnchor[],
    visualState: VisualState,
    safetyMetrics: VisualSafetyMetrics,
  ): void {
    const floorGap = Math.max(0, safetyMetrics.brightnessFloor - safetyMetrics.trailingLuminance);
    const darkestQuartile = this.lastLowResFrameStats.darkestQuartileLuminance;
    const averageLuminance = this.lastLowResFrameStats.luminanceSample;
    const quartileGap = Math.max(0, 0.16 - darkestQuartile);
    const averageGap = Math.max(0, 0.24 - averageLuminance);
    const supportLift = clamp(quartileGap * 0.22 + averageGap * 0.08, 0, 0.05);
    const recoveryLift = floorGap + supportLift;
    if (recoveryLift <= 0 && edgeMap.maskConfidence !== "low") {
      return;
    }

    const focalX = Number.isFinite(edgeMap.focalCenterX) ? edgeMap.focalCenterX : this.settings.width * 0.5;
    const focalY = Number.isFinite(edgeMap.focalCenterY) ? edgeMap.focalCenterY : this.settings.height * 0.5;

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.globalAlpha = clamp(0.35 + recoveryLift * 3.2, 0.22, 0.7);
    const liftGradient = this.ctx.createRadialGradient(
      focalX,
      focalY,
      0,
      focalX,
      focalY,
      safeRadius(this.settings.width * 0.7, 1),
    );
    liftGradient.addColorStop(0, plasmaCoreColor(theme, 0.12 + recoveryLift * 0.25, 0.2));
    liftGradient.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = liftGradient;
    this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.ctx.restore();

    if (visualState.rescuePolicy === "recover" || edgeMap.maskConfidence !== "high") {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      for (const anchor of anchors.slice(0, 10)) {
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.radius) || !Number.isFinite(anchor.weight)) {
          continue;
        }
        const radius = safeRadius(anchor.radius * 1.25 + 24, 8);
        const gradient = this.ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius);
        gradient.addColorStop(0, plasmaCoreColor(theme, 0.08 + recoveryLift * 0.16, 0.1));
        gradient.addColorStop(0.7, paletteColor(theme, anchor.weight * 0.2, 0.04 + recoveryLift * 0.06, 12));
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    if (safetyMetrics.recoveryActive) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(0.06 + frame.dbNormalized * 0.05, 0.05, 0.14);
      this.ctx.fillStyle = paletteColor(theme, frame.timeSec * 0.05, 0.08, 18);
      this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
      this.ctx.restore();
    }
    if (supportLift > 0.002) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(supportLift * 1.8, 0.02, 0.09);
      this.ctx.fillStyle = paletteColor(theme, frame.timeSec * 0.03, 0.08, 12);
      this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
      this.ctx.restore();
    }
  }

  private applyStructureRescue(
    frame: AudioFrameFeature,
    theme: RenderTheme,
    edgeMap: EdgeMap,
    occupancy: Array<{ x: number; y: number; weight: number; radius: number; layer: "hero" | "support" | "background" }>,
    visualState: VisualState,
    safetyMetrics: VisualSafetyMetrics,
    luminance: number,
  ): void {
    const targetFloor = Math.max(0.055, visualState.brightnessFloor - 0.005);
    if (luminance >= targetFloor && !safetyMetrics.recoveryActive) {
      return;
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const anchors = [...edgeMap.regionAnchors.slice(0, 8), ...occupancy.filter((point) => point.layer !== "background").slice(0, 12).map((point) => ({
      x: point.x,
      y: point.y,
      radius: point.radius,
      weight: point.weight,
      tx: 1,
      ty: 0,
    }))];
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index]!;
      const radius = safeRadius((anchor.radius * 0.9 + 18) * clamp(frame.pulseScale * 0.45, 1, 2.2), 1);
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
        continue;
      }
      const gradient = this.ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius);
      gradient.addColorStop(0, plasmaCoreColor(theme, 0.05 + anchor.weight * 0.03, index / Math.max(1, anchors.length)));
      gradient.addColorStop(0.6, paletteColor(theme, index / Math.max(1, anchors.length), 0.03 + anchor.weight * 0.02, 8));
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private drawPeakBloom(frame: AudioFrameFeature, theme: RenderTheme): void {
    const cx = this.settings.width * 0.5;
    const cy = this.settings.height * 0.52;
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    const radius = this.settings.width * (0.1 + frame.peakStrength * 0.04);
    const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, plasmaCoreColor(theme, 0.06 + frame.peakStrength * 0.05, 0.4));
    gradient.addColorStop(0.45, lightningColor(theme, 0.035 + frame.peakStrength * 0.03, 0.35));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private applyTransition(frame: AudioFrameFeature, theme: RenderTheme, safetyMetrics: VisualSafetyMetrics): void {
    const transition = this.transitionState;
    if (!transition || transition.toImagePath !== this.lastImagePath) {
      return;
    }
    if (safetyMetrics.recoveryActive && (transition.family === "flash" || transition.family === "fragment")) {
      return;
    }
    const elapsedFrames = frame.frameIndex - transition.startFrameIndex;
    if (elapsedFrames < 0) {
      return;
    }
    const progress = clamp(elapsedFrames / Math.max(1, transition.durationFrames), 0, 1);
    if (progress >= 1) {
      this.transitionState = undefined;
      return;
    }

    const color = `rgba(${Math.round(theme.styleProfile.averageR)}, ${Math.round(theme.styleProfile.averageG)}, ${Math.round(theme.styleProfile.averageB)}, 1)`;
    const cx = this.settings.width * 0.5;
    const cy = this.settings.height * 0.5;
    const variant = this.seededTransitionVariant(transition);
    const transitionGraph = this.transitionBridgeState ? this.getTransitionGraph(this.transitionBridgeState.fromImagePath, this.transitionBridgeState.toImagePath) : undefined;
    const deterministicParams = transitionGraph?.deterministicParams;
    const flashAlphaScale = transition.family === "flash" ? deterministicParams?.flashAlphaScale ?? 0.8 : 1;

    this.ctx.save();
    this.applyStateLinkBlend(progress, transition.family, transition.carryStrength);
    if (transition.carryProfile.mode === "snapshot-only" && !transition.carryProfile.allowParticleDrivenFamily) {
      const eased = this.smoothstep(0, 1, progress);
      this.drawTransitionSnapshot((1 - eased * 0.78) * (0.72 + transition.carryStrength * 0.12));
      this.ctx.restore();
      return;
    }
    if (transition.useMorph && transition.carryProfile.allowMorph && this.transitionBridgeState) {
      this.applyMorphTransition(progress, transition.carryStrength, theme, frame);
      this.ctx.restore();
      return;
    }
    if (
      transition.family === "mirror-kaleido" ||
      transition.family === "split-mirror" ||
      transition.family === "prism-fold" ||
      transition.family === "shear-kaleido" ||
      transition.family === "halo-drift" ||
      transition.family === "veil-shift" ||
      transition.family === "echo-fold" ||
      transition.family === "lattice-breath" ||
      transition.family === "phase-ghost" ||
      PHYSICAL_CAMERA_TRANSITION_FAMILIES.includes(transition.family) ||
      PSYCHEDELIC_TRANSITION_FAMILIES.includes(transition.family)
    ) {
      this.drawDeterministicTransitionFamily(transition.family, progress, deterministicParams, frame, theme);
      this.ctx.restore();
      return;
    }
    const hardLightAlphaScale = clamp(
      (theme.styleProfile.lightnessMean > 0 ? 1 - theme.styleProfile.lightnessMean * 0.45 : 0.82) *
      (this.lastHeroCoverage < 0.16 ? 0.76 : 1),
      0.34,
      0.9,
    );
    switch (transition.mode) {
      case 0: {
        this.ctx.globalCompositeOperation = "lighter";
        this.ctx.globalAlpha = (1 - progress) * flashAlphaScale * hardLightAlphaScale * 0.58;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
        break;
      }
      case 1: {
        const sliceHeight = 32;
        this.ctx.globalAlpha = 1 - progress * 0.9;
        for (let y = 0; y < this.settings.height; y += sliceHeight) {
          const offset = Math.sin(y * 0.05 + frame.timeSec * 12) * (1 - progress) * 90;
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, sliceHeight, offset, y, this.settings.width, sliceHeight);
        }
        break;
      }
      case 2: {
        this.ctx.translate(cx, cy);
        const scale = 1 + progress * 1.2;
        this.ctx.scale(scale, scale);
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        break;
      }
      case 3: {
        this.ctx.globalCompositeOperation = "lighter";
        this.drawTintedTransitionLayer("rgba(255,60,60,1)", -progress * 48, 0, (1 - progress) * flashAlphaScale);
        this.drawTintedTransitionLayer("rgba(60,255,120,1)", progress * 40, -progress * 18, (1 - progress * 0.92) * flashAlphaScale);
        this.drawTintedTransitionLayer("rgba(90,120,255,1)", 0, progress * 34, (1 - progress * 0.95) * flashAlphaScale);
        break;
      }
      case 4: {
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = 1 - progress * 0.82;
        this.ctx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
        this.ctx.globalAlpha = 0.08 + (1 - progress) * 0.08;
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, Math.max(this.settings.width, this.settings.height) * (0.18 + progress * 0.28), 0, Math.PI * 2);
        this.ctx.fill();
        break;
      }
      case 5: {
        this.ctx.globalAlpha = 1 - progress;
        const melt = progress * progress * this.settings.height * 0.35;
        this.ctx.drawImage(this.transitionCanvas as any, 0, melt, this.settings.width, this.settings.height, 0, 0, this.settings.width, this.settings.height);
        break;
      }
      case 6: {
        this.ctx.globalCompositeOperation = elapsedFrames % 2 === 0 ? "difference" : "xor";
        this.ctx.globalAlpha = 0.55 * (1 - progress) + 0.15;
        this.ctx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
        this.ctx.translate(cx, cy);
        this.ctx.rotate(progress * Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -160 * (1 - progress * 0.2));
        this.ctx.lineTo(140 * (1 - progress * 0.15), 120);
        this.ctx.lineTo(-140 * (1 - progress * 0.15), 120);
        this.ctx.closePath();
        this.ctx.fill();
        break;
      }
      case 7:
      {
        this.ctx.translate(cx, cy);
        this.ctx.rotate(progress * progress * Math.PI * 2.4);
        const scale = 1 + progress * 0.55;
        this.ctx.scale(scale, scale);
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        break;
      }
      case 8: {
        const split = 0.72;
        this.ctx.globalCompositeOperation = "lighter";
        if (progress < split) {
          const local = this.easeOutCubic(progress / split);
          const collapseY = Math.max(0.01, 1 - local * 0.99);
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.scale(1, collapseY);
          this.ctx.globalAlpha = 1 - local * 0.08;
          this.ctx.filter = "blur(1px)";
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        } else {
          const local = clamp((progress - split) / (1 - split), 0, 1);
          const lineWidth = this.settings.width * (1 - this.easeInCubic(local));
          const thickness = Math.max(1, (this.settings.height * 0.004) * (1 - local) + 1);
          this.ctx.globalAlpha = 1 - local * 0.2;
          this.ctx.fillStyle = "rgba(255,255,255,1)";
          this.ctx.fillRect(cx - lineWidth * 0.5, cy - thickness * 0.5, lineWidth, thickness);
          const dotRadius = Math.max(0, 4 * (1 - local));
          if (dotRadius > 0.3) {
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }
        break;
      }
      case 9: {
        const maxPixelSize = [24, 32, 40][variant % 3]!;
        if (progress < 0.5) {
          const local = this.easeOutCubic(progress / 0.5);
          const pixelSize = 1 + (maxPixelSize - 1) * local;
          const alpha = progress < 0.4 ? 1 : clamp(1 - (progress - 0.4) / 0.15, 0, 1);
          this.drawPixelatedLayer(this.transitionCanvas as any, pixelSize, alpha);
        } else {
          const local = this.easeInCubic((progress - 0.5) / 0.5);
          const pixelSize = 1 + (maxPixelSize - 1) * (1 - local);
          const alpha = progress < 0.6 ? clamp((progress - 0.45) / 0.15, 0, 1) : 1;
          this.drawPixelatedLayer(this.canvas as any, pixelSize, alpha);
        }
        break;
      }
      case 10: {
        const horizontal = variant % 2 === 0;
        const localProgress = horizontal ? progress : clamp(progress * 1.2, 0, 1);
        this.ctx.globalAlpha = 1 - localProgress * 0.8;
        const travel =
          this.easeOutCubic(localProgress) *
          ((horizontal ? this.settings.width : this.settings.height) + frame.normalizedHigh * 80 + frame.peakStrength * 40);
        if (horizontal) {
          const sliceHeight = variant % 4 < 2 ? 24 : 32;
          for (let y = 0, index = 0; y < this.settings.height; y += sliceHeight, index += 1) {
            const direction = index % 2 === 0 ? -1 : 1;
            this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, sliceHeight, direction * travel, y, this.settings.width, sliceHeight);
          }
        } else {
          const sliceWidth = variant % 4 < 2 ? 32 : 40;
          for (let x = 0, index = 0; x < this.settings.width; x += sliceWidth, index += 1) {
            const direction = index % 2 === 0 ? -1 : 1;
            this.ctx.drawImage(this.transitionCanvas as any, x, 0, sliceWidth, this.settings.height, x, direction * travel, sliceWidth, this.settings.height);
          }
        }
        break;
      }
      case 11: {
        const shardCount = variant % 2 === 0 ? 6 : 8;
        const baseAngle = (Math.PI * 2) / shardCount;
        const distanceBase = this.easeOutCubic(progress) * (40 + frame.motionEnergy * 28);
        for (let shard = 0; shard < shardCount; shard += 1) {
          const angleCenter = shard * baseAngle + (variant % 3) * 0.08;
          const angleOffset = baseAngle * 0.44;
          const moveDistance = distanceBase + (shard % 3) * 8;
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(
            cx + Math.cos(angleCenter - angleOffset) * this.settings.width * 1.6,
            cy + Math.sin(angleCenter - angleOffset) * this.settings.height * 1.6,
          );
          this.ctx.lineTo(
            cx + Math.cos(angleCenter + angleOffset) * this.settings.width * 1.6,
            cy + Math.sin(angleCenter + angleOffset) * this.settings.height * 1.6,
          );
          this.ctx.closePath();
          this.ctx.clip();
          this.ctx.translate(Math.cos(angleCenter) * moveDistance, Math.sin(angleCenter) * moveDistance);
          this.ctx.translate(cx, cy);
          this.ctx.rotate((shard % 2 === 0 ? 1 : -1) * progress * Math.PI * 0.18);
          this.ctx.translate(-cx, -cy);
          this.ctx.globalAlpha = 1 - progress * 0.12;
          this.ctx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      }
      case 12: {
        this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
        this.scratchCtx.globalCompositeOperation = "source-over";
        this.scratchCtx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
        const blockCopies = 8 + (variant % 7);
        const offsetScale = (12 + progress * 52) * (1 + frame.motionEnergy * 0.35);
        for (let index = 0; index < blockCopies; index += 1) {
          const seed = variant * 131 + index * 977 + elapsedFrames * 17;
          const rw = this.settings.width * (0.04 + ((seed % 11) / 10) * 0.14);
          const rh = this.settings.height * (0.04 + (((seed >> 3) % 11) / 10) * 0.14);
          const maxX = Math.max(1, Math.floor(this.settings.width - rw));
          const maxY = Math.max(1, Math.floor(this.settings.height - rh));
          const rx = (seed * 37) % maxX;
          const ry = (seed * 53) % maxY;
          const dx = rx + (index % 3 === 0 ? 1.8 : 0.6) * (seed % 2 === 0 ? 1 : -1) * offsetScale;
          const dy = ry + (((seed % 5) - 2) * 0.35 + (index % 2 === 0 ? 0.12 : -0.12)) * offsetScale;
          this.scratchCtx.drawImage(this.transitionCanvas as any, rx, ry, rw, rh, dx, dy, rw, rh);
        }
        this.ctx.globalAlpha = 1 - this.easeInCubic(progress);
        this.ctx.drawImage(this.scratchCanvas as any, 0, 0, this.settings.width, this.settings.height);
        break;
      }
      case 13: {
        const outgoingAlpha = 1 - this.smoothstep(0, 0.35, progress);
        if (outgoingAlpha > 0.001) {
          this.drawTransitionSnapshot(outgoingAlpha);
        }
        this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
        this.scratchCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);
        const zoom = Math.exp(Math.log(0.1) + (Math.log(1.35) - Math.log(0.1)) * progress);
        const rotationDirection = variant % 2 === 0 ? 1 : -1;
        this.ctx.translate(cx, cy);
        this.ctx.rotate(rotationDirection * progress * Math.PI * 0.18);
        this.ctx.scale(zoom, zoom);
        this.ctx.drawImage(this.scratchCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        break;
      }
      case 14: {
        this.drawTransitionSnapshot(flashAlphaScale * hardLightAlphaScale * 0.72);
        this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
        this.scratchCtx.drawImage(this.canvas as any, 0, 0, this.settings.width, this.settings.height);
        const revealRadiusMax = Math.hypot(cx, cy) + 8;
        const baseRadius = this.easeOutCubic(progress) * revealRadiusMax;
        const jitter = 6 + frame.normalizedHigh * 18 + frame.peakStrength * 10;
        this.ctx.save();
        this.ctx.beginPath();
        switch (variant % 3) {
          case 1:
            this.drawJitteredPolygonPath(cx, cy, baseRadius, 3, jitter, progress * Math.PI * 0.1, frame);
            break;
          case 2:
            this.drawJitteredPolygonPath(cx, cy, baseRadius, 6, jitter, progress * Math.PI * 0.1, frame);
            break;
          default:
            this.drawJitteredPolygonPath(cx, cy, baseRadius, 28, jitter, progress * Math.PI * 0.15, frame);
            break;
        }
        this.ctx.clip();
        this.ctx.drawImage(this.scratchCanvas as any, 0, 0, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case 15: {
        this.ctx.globalCompositeOperation = "screen";
        const rotationDirection = variant % 2 === 0 ? 1 : -1;
        this.drawTintedScaledTransitionLayer("rgba(255,64,64,1)", 1 - progress * 0.1, 6 - progress * 16, 0, (1 - progress) * 0.32 * flashAlphaScale * hardLightAlphaScale, rotationDirection * progress * Math.PI * 0.04);
        this.drawTintedScaledTransitionLayer("rgba(64,255,140,1)", 1 - progress * 0.16, -4 + progress * 8, -6 + progress * 10, (1 - progress) * 0.28 * flashAlphaScale * hardLightAlphaScale, rotationDirection * progress * Math.PI * 0.025);
        this.drawTintedScaledTransitionLayer("rgba(90,120,255,1)", 1 - progress * 0.22, 0, 8 - progress * 18, (1 - progress) * 0.24 * flashAlphaScale * hardLightAlphaScale, rotationDirection * progress * Math.PI * 0.015);
        break;
      }
      default: {
        this.ctx.translate(cx, cy);
        this.ctx.rotate(progress * progress * Math.PI * 2.4);
        const scale = 1 + progress * 0.55;
        this.ctx.scale(scale, scale);
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        break;
      }
    }
    this.ctx.restore();
  }

  private applyMorphTransition(
    progress: number,
    carryStrength: number,
    theme: RenderTheme,
    frame: AudioFrameFeature,
  ): void {
    const bridge = this.transitionBridgeState;
    if (!bridge) {
      return;
    }
    const transitionGraph = this.getTransitionGraph(bridge.fromImagePath, bridge.toImagePath);
    const eased = this.smoothstep(0, 1, progress);
    this.drawTransitionSnapshot((1 - eased * 0.78) * (0.78 + carryStrength * 0.18));

    const bridgePoint = transitionGraph?.heroBridge[Math.floor(eased * Math.max(0, (transitionGraph.heroBridge.length - 1) || 0))];
    const heroX = bridgePoint?.x ?? (bridge.heroFrom.x + (bridge.heroTo.x - bridge.heroFrom.x) * eased);
    const heroY = bridgePoint?.y ?? (bridge.heroFrom.y + (bridge.heroTo.y - bridge.heroFrom.y) * eased);
    const heroRadius = bridgePoint?.radius ?? (bridge.heroFrom.radius + (bridge.heroTo.radius - bridge.heroFrom.radius) * eased);
    const fromTheme = this.transitionFromTheme ?? theme;
    const pathAngle = Math.atan2(bridge.heroTo.y - bridge.heroFrom.y, (bridge.heroTo.x - bridge.heroFrom.x) || 0.001);
    const outgoingX = bridge.heroFrom.x + (heroX - bridge.heroFrom.x) * eased * 0.75;
    const outgoingY = bridge.heroFrom.y + (heroY - bridge.heroFrom.y) * eased * 0.75;
    const incomingX = heroX + (bridge.heroTo.x - heroX) * eased * 0.25;
    const incomingY = heroY + (bridge.heroTo.y - heroY) * eased * 0.25;

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.globalAlpha = 0.1 + (1 - eased) * 0.12 * carryStrength;
    const heroGradient = this.ctx.createRadialGradient(heroX, heroY, 0, heroX, heroY, heroRadius * 1.2);
    heroGradient.addColorStop(0, plasmaCoreColor(theme, 0.32, 0.5));
    heroGradient.addColorStop(0.55, paletteColor(theme, 0.5, 0.08, 8));
    heroGradient.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = heroGradient;
    this.ctx.beginPath();
    this.ctx.arc(heroX, heroY, heroRadius * 1.2, 0, Math.PI * 2);
    this.ctx.fill();
    this.drawHeroGlyphLayer(
      frame,
      fromTheme,
      outgoingX,
      outgoingY,
      heroRadius * (1.08 - eased * 0.22),
      pathAngle - eased * 0.35,
      {
        alphaScale: clamp((1 - eased) * (0.95 + carryStrength * 0.16), 0.16, 1),
        glyphs: transitionGraph?.glyphBlend.from,
      },
    );
    this.drawHeroGlyphLayer(
      frame,
      theme,
      incomingX,
      incomingY,
      heroRadius * (0.84 + eased * 0.34),
      pathAngle + eased * 0.45,
      {
        alphaScale: clamp(eased * (0.85 + carryStrength * 0.2), 0.14, 1),
        glyphs: transitionGraph?.glyphBlend.to,
      },
    );

    const slotPairs = Math.max(bridge.supportFrom.length, bridge.supportTo.length, transitionGraph?.supportPairs.length ?? 0);
    for (let index = 0; index < slotPairs; index += 1) {
      const pair = transitionGraph?.supportPairs[index];
      const from = pair?.from ?? bridge.supportFrom[index % Math.max(1, bridge.supportFrom.length)] ?? bridge.supportTo[index % Math.max(1, bridge.supportTo.length)];
      const to = pair?.to ?? bridge.supportTo[index % Math.max(1, bridge.supportTo.length)] ?? bridge.supportFrom[index % Math.max(1, bridge.supportFrom.length)];
      if (!from || !to) {
        continue;
      }
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y + (to.y - from.y) * eased;
      this.ctx.strokeStyle = paletteColor(theme, index / Math.max(1, slotPairs), 0.12 * (1 - eased) + 0.04, 10);
      this.ctx.lineWidth = 2 + from.weight * 0.8;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.quadraticCurveTo(heroX, heroY, x, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private applyStateLinkBlend(progress: number, family: TransitionFamily, carryStrength: number): void {
    const eased = this.smoothstep(0, 1, progress);
    const carryAlpha =
      family === "carry" ? 0.42 * (1 - eased) :
      family === "melt-safe" ? 0.46 * (1 - eased) :
      0.26 * (1 - eased);
    if (carryAlpha <= 0.001) {
      return;
    }

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.globalAlpha = carryAlpha * carryStrength;
    this.ctx.filter = `blur(${Math.max(0, (1 - eased) * (2.4 + carryStrength * 1.4)).toFixed(2)}px)`;
    this.ctx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.ctx.restore();

    if (family === "carry" || family === "melt-safe") {
      this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
      this.scratchCtx.save();
      this.scratchCtx.globalAlpha = 0.28 * (1 - eased) * carryStrength;
      const heroFrom = this.transitionBridgeState?.heroFrom;
      const heroTo = this.transitionBridgeState?.heroTo;
      const bridgeDx = heroFrom && heroTo ? (heroTo.x - heroFrom.x) * eased * 0.18 : 0;
      const bridgeDy = heroFrom && heroTo ? (heroTo.y - heroFrom.y) * eased * 0.18 : 0;
      const driftX = Math.sin(eased * Math.PI) * (14 + carryStrength * 6) + bridgeDx;
      const driftY = (1 - eased) * (8 + carryStrength * 4) + bridgeDy;
      this.scratchCtx.drawImage(this.transitionCanvas as any, driftX, driftY, this.settings.width, this.settings.height);
      this.scratchCtx.restore();

      this.ctx.save();
      this.ctx.globalCompositeOperation = "lighten";
      this.ctx.globalAlpha = 0.18 * (1 - eased) * carryStrength;
      this.ctx.drawImage(this.scratchCanvas as any, 0, 0, this.settings.width, this.settings.height);
      this.ctx.restore();

      if (this.transitionBridgeState) {
        const support = [...this.transitionBridgeState.supportFrom, ...this.transitionBridgeState.supportTo];
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = 0.06 * (1 - eased) * carryStrength;
        for (const slot of support) {
          const radius = slot.radius * (0.85 + (1 - eased) * 0.25);
          const gradient = this.ctx.createRadialGradient(slot.x, slot.y, 0, slot.x, slot.y, radius);
          gradient.addColorStop(0, "rgba(255,255,255,0.85)");
          gradient.addColorStop(0.5, "rgba(190,220,255,0.18)");
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          this.ctx.fillStyle = gradient;
          this.ctx.beginPath();
          this.ctx.arc(slot.x, slot.y, radius, 0, Math.PI * 2);
          this.ctx.fill();
        }
        this.ctx.restore();
      }
    }
  }

  private transitionQuarterPulse(frame: AudioFrameFeature, strength = 1): number {
    const beatLift = frame.isBeatAccent ? 1 : clamp(1 - (frame.beatPhase ?? 1), 0, 1);
    const barLift = frame.isBarDownbeat ? 0.18 : 0;
    return clamp(0.72 + beatLift * 0.22 * strength + barLift, 0.72, 1.22);
  }

  private drawDeterministicTransitionFamily(
    family: TransitionFamily,
    progress: number,
    params: TransitionGraph["deterministicParams"] | undefined,
    frame: AudioFrameFeature,
    theme: RenderTheme,
  ): void {
    const cx = this.settings.width * 0.5;
    const cy = this.settings.height * 0.5;
    const sliceCount = params?.sliceCount ?? 6;
    const sliceThickness = params?.sliceThickness ?? 28;
    const mirrorCount = params?.mirrorCount ?? 3;
    const warpAmplitude = params?.warpAmplitude ?? 24;
    const rotationAmount = params?.rotationAmount ?? 0.14;
    const travelPx = params?.travelPx ?? 72;
    const eased = this.smoothstep(0, 1, progress);
    const quarterPulse = this.transitionQuarterPulse(
      frame,
      family === "mirror-kaleido" ||
      family === "split-mirror" ||
      family === "shear-kaleido" ||
      family === "bilateral-iris-fold" ||
      family === "mirror-gate-inversion" ||
      family === "quad-kaleido-choir" ||
      family === "reflection-slit-shatter"
        ? 1.1
        : 0.9,
    );
    switch (family) {
      case "mirror-kaleido":
      case "mirror-gate-inversion":
      case "quad-kaleido-choir":
      case "fractal-mirror-shatter":
      case "kon-reality-shatter-match-cut":
        for (let index = 0; index < mirrorCount; index += 1) {
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(((Math.PI * 2) / mirrorCount) * index + eased * rotationAmount * quarterPulse);
          this.ctx.scale(index % 2 === 0 ? 1 : -1, 1);
          this.ctx.globalAlpha = 0.82 - eased * 0.3;
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      case "split-mirror":
      case "bilateral-iris-fold":
      case "hallucinogenic-hex-grid":
      case "moore-nine-panel-particle-grid":
        for (let y = 0; y < this.settings.height; y += sliceThickness) {
          const offset = Math.sin(y * 0.05 + frame.timeSec * 2.2) * warpAmplitude * quarterPulse * (1 - eased);
          this.ctx.save();
          this.ctx.scale(-1, 1);
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, sliceThickness, -this.settings.width + offset, y, this.settings.width, sliceThickness);
          this.ctx.restore();
          this.ctx.globalAlpha = 0.5;
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, sliceThickness, -offset, y, this.settings.width, sliceThickness);
        }
        break;
      case "prism-fold":
      case "prism-axis-lag":
      case "floyd-dark-side-prism-dispersal":
        for (let index = 0; index < sliceCount; index += 1) {
          const x = (this.settings.width / sliceCount) * index;
          const width = this.settings.width / sliceCount;
          const localProgress = 1 - Math.abs(index - (sliceCount - 1) * 0.5) / Math.max(1, sliceCount * 0.5);
          const fold = travelPx * quarterPulse * eased * (0.3 + localProgress * 0.7);
          this.ctx.drawImage(this.transitionCanvas as any, x, 0, width, this.settings.height, x + (index % 2 === 0 ? -fold : fold), 0, width, this.settings.height);
        }
        break;
      case "shear-kaleido":
      case "reflection-slit-shatter":
      case "trippy-symmetry-ripple":
      case "color-shift-kaleidoscope-burst":
      case "wire-solid-phase-cut":
        for (let index = 0; index < Math.max(2, mirrorCount); index += 1) {
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(rotationAmount * quarterPulse * eased * (index % 2 === 0 ? 1 : -1));
          this.ctx.transform(1, 0, Math.sin(frame.timeSec + index) * 0.18 * (1 - eased), 1, 0, 0);
          this.ctx.scale(index % 2 === 0 ? 1 : -1, 1);
          this.ctx.globalAlpha = clamp(0.66 - eased * 0.2, 0.28, 0.66);
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.strokeStyle = paletteColor(theme, frame.timeSec * 0.08, 0.08 * (1 - eased), 10);
        for (let y = 0; y < this.settings.height; y += Math.max(12, sliceThickness)) {
          const offset = Math.sin(y * 0.03 + frame.timeSec * 3) * warpAmplitude * quarterPulse * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, Math.max(8, sliceThickness * 0.5), offset, y, this.settings.width, Math.max(8, sliceThickness * 0.5));
        }
        this.ctx.restore();
        break;
      case "halo-drift":
      case "supernova-glare-reveal":
      case "deep-space-flare-transition": {
        const radius = Math.max(cx, cy) * (0.34 + eased * 0.32) * quarterPulse;
        this.drawTransitionSnapshot((1 - eased) * 0.32);
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = (1 - eased) * 0.18;
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.1);
        gradient.addColorStop(0, "rgba(255,255,255,0.18)");
        gradient.addColorStop(0.45, "rgba(120,170,255,0.10)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius * 2.1, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
        break;
      }
      case "veil-shift":
      case "celestial-aurora-wipe":
      case "nebula-cloud-crossfade":
      case "soft-starlight-blur": {
        const band = Math.max(18, sliceThickness * 0.6);
        this.ctx.globalAlpha = 0.84 - eased * 0.18;
        for (let y = 0; y < this.settings.height; y += band) {
          const offset = Math.sin(y * 0.07 + frame.timeSec * 1.8) * warpAmplitude * 0.22 * quarterPulse * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, band, offset, y, this.settings.width, band);
        }
        break;
      }
      case "echo-fold":
      case "ethereal-particle-drift": {
        const echoes = 3;
        for (let index = 0; index < echoes; index += 1) {
          this.ctx.save();
          this.ctx.globalCompositeOperation = "screen";
          this.ctx.globalAlpha = clamp((1 - eased) * (0.16 - index * 0.03), 0.04, 0.18);
          const localScale = 1 - eased * (0.08 + index * 0.04) * quarterPulse;
          const drift = (index + 1) * 10 * (1 - eased) * quarterPulse;
          this.ctx.translate(cx + drift, cy);
          this.ctx.scale(localScale, localScale);
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      }
      case "lattice-breath":
      case "gilligan-time-lapse-particle-sand": {
        const stride = Math.max(20, sliceThickness);
        for (let x = 0; x < this.settings.width; x += stride) {
          const offset = Math.sin(x * 0.04 + frame.timeSec * 2.6) * warpAmplitude * 0.14 * quarterPulse * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, x, 0, stride, this.settings.height, x, offset, stride, this.settings.height);
        }
        break;
      }
      case "phase-ghost":
      case "interstellar-light-bleed": {
        const ghostOffset = travelPx * 0.18 * (1 - eased) * quarterPulse;
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = (1 - eased) * 0.16;
        this.ctx.drawImage(this.transitionCanvas as any, ghostOffset, 0, this.settings.width, this.settings.height);
        this.ctx.globalAlpha = (1 - eased) * 0.12;
        this.ctx.drawImage(this.transitionCanvas as any, -ghostOffset * 0.6, ghostOffset * 0.4, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "dolly-in":
      case "dolly-out":
      case "barlog-continuous-camera-particle-sweep": {
        const inward = family === "dolly-in" ? 1 : family === "dolly-out" ? -1 : 1;
        const scale = 1 + inward * eased * 0.16 * quarterPulse;
        const drift = travelPx * 0.08 * (1 - eased);
        this.ctx.save();
        this.ctx.translate(cx + drift * inward, cy + drift * 0.4);
        this.ctx.scale(scale, scale);
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "whip-pan-x":
      case "whip-pan-y":
      case "wright-whip-pan-particle-smear": {
        const horizontal = family !== "whip-pan-y";
        const offset = travelPx * 0.9 * (1 - eased) * quarterPulse;
        this.ctx.save();
        this.ctx.globalAlpha = 0.84;
        if (horizontal) {
          this.ctx.drawImage(this.transitionCanvas as any, offset, 0, this.settings.width, this.settings.height);
          this.ctx.globalAlpha = 0.22 * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, -offset * 0.35, 0, this.settings.width, this.settings.height);
        } else {
          this.ctx.drawImage(this.transitionCanvas as any, 0, offset, this.settings.width, this.settings.height);
          this.ctx.globalAlpha = 0.22 * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, 0, -offset * 0.35, this.settings.width, this.settings.height);
        }
        this.ctx.restore();
        break;
      }
      case "handheld-lurch": {
        const lurchX = Math.sin(frame.timeSec * 8.2) * warpAmplitude * 0.28 * (1 - eased);
        const lurchY = Math.cos(frame.timeSec * 6.8) * warpAmplitude * 0.18 * (1 - eased);
        this.ctx.save();
        this.ctx.translate(cx + lurchX, cy + lurchY);
        this.ctx.rotate(Math.sin(frame.timeSec * 5.2) * 0.035 * (1 - eased));
        this.ctx.scale(1 + eased * 0.08, 1 + eased * 0.08);
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "crash-zoom":
      case "snap-zoom-out": {
        const crash = family === "crash-zoom";
        const scale = crash ? 1 + eased * 0.26 * quarterPulse : 1 - eased * 0.18 * quarterPulse;
        const alpha = crash ? 0.92 : 0.8;
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.translate(cx, cy);
        this.ctx.scale(scale, scale);
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        this.ctx.restore();
        if (!crash) {
          this.ctx.save();
          this.ctx.globalCompositeOperation = "screen";
          this.ctx.globalAlpha = (1 - eased) * 0.18;
          this.ctx.drawImage(this.transitionCanvas as any, travelPx * 0.06, 0, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      }
      case "resolution-crash-snapback": {
        const pixelSize = Math.max(3, Math.round(18 - eased * 12));
        this.drawPixelatedLayer(this.transitionCanvas as any, pixelSize, clamp(0.88 - eased * 0.2, 0.5, 0.88));
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = (1 - eased) * 0.14;
        this.ctx.drawImage(this.transitionCanvas as any, travelPx * 0.08 * (1 - eased), 0, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "parallax-slide": {
        const foreground = travelPx * 0.18 * (1 - eased);
        const background = -foreground * 0.45;
        this.ctx.save();
        this.ctx.globalAlpha = 0.72;
        this.ctx.drawImage(this.transitionCanvas as any, background, 0, this.settings.width, this.settings.height);
        this.ctx.globalAlpha = 0.36;
        this.ctx.drawImage(this.transitionCanvas as any, foreground, 0, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "tilt-reframe": {
        const shiftY = travelPx * 0.16 * (1 - eased);
        this.ctx.save();
        this.ctx.translate(cx, cy + shiftY);
        this.ctx.rotate(rotationAmount * 0.55 * (1 - eased));
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "roll-sway": {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(Math.sin(frame.timeSec * 3.4) * rotationAmount * 1.8 * (1 - eased));
        this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "fractal-tunnel":
      case "acid-wash-tunnel":
      case "prismatic-vortex-swirl":
      case "quantum-realm-warp":
      case "kubrick-slit-scan-star-gate":
      case "mobius-wrap-tunnel": {
        for (let index = 0; index < 4; index += 1) {
          const scale = 1 - index * 0.14 - eased * 0.08;
          this.ctx.save();
          this.ctx.globalAlpha = clamp((1 - eased) * (0.22 - index * 0.04), 0.04, 0.22);
          this.ctx.translate(cx, cy);
          this.ctx.scale(scale, scale);
          this.ctx.rotate(index * 0.08 + eased * rotationAmount * (family === "mobius-wrap-tunnel" ? 2.2 : 1));
          if (family === "mobius-wrap-tunnel") {
            this.ctx.transform(
              1,
              Math.sin(frame.timeSec * 0.9 + index) * 0.08 * (1 - eased),
              Math.sin(frame.timeSec * 1.3 + index) * 0.2 * (1 - eased) * (index % 2 === 0 ? 1 : -1),
              1,
              0,
              0,
            );
            this.ctx.translate(Math.sin(frame.timeSec * 1.1 + index) * travelPx * 0.04, Math.cos(frame.timeSec * 1.4 + index * 0.7) * travelPx * 0.025);
          }
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      }
      case "acid-fold":
      case "ink-melt":
      case "liquid-lens":
      case "galactic-smoke-sweep":
      case "joyce-fluid-text-morph":
      case "danielewski-house-typographic-distortion": {
        const bandHeight = Math.max(14, sliceThickness * 0.55);
        for (let y = 0; y < this.settings.height; y += bandHeight) {
          const wave = Math.sin(y * 0.035 + frame.timeSec * (family === "liquid-lens" ? 3.2 : 2.1)) * warpAmplitude * 0.22 * (1 - eased);
          const lensScale = family === "liquid-lens" ? 1 + Math.sin(y * 0.02 + frame.timeSec * 2.6) * 0.06 * (1 - eased) : 1;
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.scale(lensScale, lensScale);
          this.ctx.translate(-cx, -cy);
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, bandHeight, wave, y, this.settings.width, bandHeight);
          this.ctx.restore();
        }
        break;
      }
      case "strobe-bloom":
      case "neon-radial-implosion": {
        this.drawTransitionSnapshot(0.9);
        this.ctx.save();
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.globalAlpha = (Math.sin(frame.timeSec * 18) > 0 ? 1 : 0.35) * (1 - eased) * 0.24;
        this.ctx.fillStyle = paletteColor(theme, frame.timeSec * 0.1, 1, 18);
        this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "solarize-drift":
      case "kojima-tactical-glitch-noise":
      case "snare-negative-flip": {
        this.ctx.save();
        this.ctx.globalCompositeOperation = "difference";
        this.ctx.globalAlpha = (1 - eased) * 0.16;
        this.ctx.fillStyle = "rgba(255,255,255,1)";
        this.ctx.fillRect(0, 0, this.settings.width, this.settings.height);
        this.ctx.restore();
        break;
      }
      case "datamosh-vector-drag": {
        const bandHeight = Math.max(10, sliceThickness * 0.45);
        for (let y = 0; y < this.settings.height; y += bandHeight) {
          const blockGroup = Math.floor(y / bandHeight) % 4;
          const dx = ((blockGroup % 3) - 1) * travelPx * 0.08 * (1 - eased) + Math.sin(frame.timeSec * 8 + blockGroup) * 6 * (1 - eased);
          this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, bandHeight, dx, y, this.settings.width, bandHeight);
          if (blockGroup === 2 && frame.isBeatAccent) {
            this.ctx.globalAlpha = 0.18 * (1 - eased);
            this.ctx.drawImage(this.transitionCanvas as any, 0, y, this.settings.width, bandHeight, dx * 0.3, y, this.settings.width, bandHeight);
            this.ctx.globalAlpha = 1;
          }
        }
        this.drawTintedTransitionLayer("rgba(80,255,220,0.35)", -travelPx * 0.03 * (1 - eased), 0, 0.08 * (1 - eased));
        break;
      }
      case "voronoi-drop-shatter": {
        const cells = Math.max(6, Math.min(18, sliceCount * 2));
        for (let index = 0; index < cells; index += 1) {
          const angle = (Math.PI * 2 * index) / cells;
          const ring = 0.24 + (index % 5) * 0.11;
          const seedJitter = Math.sin(index * 12.9898 + (params?.variant ?? 0) * 0.0001) * 0.5 + 0.5;
          const offset = eased * travelPx * (ring + seedJitter * 0.12);
          const x = cx + Math.cos(angle) * offset;
          const y = cy + Math.sin(angle) * offset;
          const width = Math.max(24, this.settings.width / (4 + (index % 3)));
          const height = Math.max(18, this.settings.height / (4 + ((index + 1) % 3)));
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.rotate(angle * 0.3 + eased * (0.12 + (index % 4) * 0.03));
          this.ctx.drawImage(this.transitionCanvas as any, x - width * 0.5, y - height * 0.5, width, height, -width * 0.5, -height * 0.5, width, height);
          if (frame.peakStrength > 0.55) {
            this.ctx.strokeStyle = paletteColor(theme, index / Math.max(1, cells), 0.12 * (1 - eased), 14);
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(-width * 0.5, -height * 0.5, width, height);
          }
          this.ctx.restore();
        }
        break;
      }
      case "chroma-smear": {
        this.drawTintedTransitionLayer("rgba(255,64,96,0.7)", travelPx * 0.08 * (1 - eased), 0, 0.14 * (1 - eased));
        this.drawTintedTransitionLayer("rgba(64,255,220,0.6)", -travelPx * 0.06 * (1 - eased), 0, 0.1 * (1 - eased));
        break;
      }
      case "afterimage-wheel":
      case "mandala-pulse":
      case "trip-kaleido":
      case "chromatic-mandala-spin":
      case "geometric-stardust-rotation":
      case "psychedelic-pinwheel-dissolve":
      case "cosmic-dust-dispersion": {
        const count = family === "trip-kaleido" || family === "chromatic-mandala-spin" ? 6 : family === "mandala-pulse" ? 5 : 4;
        for (let index = 0; index < count; index += 1) {
          this.ctx.save();
          this.ctx.translate(cx, cy);
          this.ctx.rotate(((Math.PI * 2) / count) * index + eased * rotationAmount);
          if (family !== "afterimage-wheel") {
            this.ctx.scale(index % 2 === 0 ? 1 : -1, 1);
          }
          this.ctx.globalAlpha = clamp((1 - eased) * (family === "trip-kaleido" ? 0.18 : 0.12), 0.04, 0.18);
          this.ctx.drawImage(this.transitionCanvas as any, -cx, -cy, this.settings.width, this.settings.height);
          this.ctx.restore();
        }
        break;
      }
      default:
        break;
    }
  }

  private easeOutCubic(value: number): number {
    const clamped = clamp(value, 0, 1);
    return 1 - Math.pow(1 - clamped, 3);
  }

  private easeInCubic(value: number): number {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * clamped;
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private hashTransitionSeed(fromImagePath: string, toImagePath: string): number {
    return hashTransitionPairSeed(fromImagePath, toImagePath);
  }

  private seededTransitionVariant(transition: TransitionState): number {
    return this.hashTransitionSeed(transition.fromImagePath, transition.toImagePath);
  }

  private drawTransitionSnapshot(alpha = 1): void {
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.ctx.restore();
  }

  private drawPixelatedLayer(source: any, pixelSize: number, alpha: number): void {
    const targetWidth = Math.max(1, Math.round(this.settings.width / Math.max(1, pixelSize)));
    const targetHeight = Math.max(1, Math.round(this.settings.height / Math.max(1, pixelSize)));
    const previousSmoothing = this.ctx.imageSmoothingEnabled;
    const previousScratchSmoothing = this.scratchCtx.imageSmoothingEnabled;
    this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.imageSmoothingEnabled = false;
    this.scratchCtx.drawImage(source, 0, 0, targetWidth, targetHeight);
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.scratchCanvas as any, 0, 0, targetWidth, targetHeight, 0, 0, this.settings.width, this.settings.height);
    this.ctx.restore();
    this.ctx.imageSmoothingEnabled = previousSmoothing;
    this.scratchCtx.imageSmoothingEnabled = previousScratchSmoothing;
  }

  private drawTintedScaledTransitionLayer(
    tint: string,
    scale: number,
    dx: number,
    dy: number,
    alpha: number,
    rotation: number,
  ): void {
    this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.globalCompositeOperation = "source-over";
    this.scratchCtx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.globalCompositeOperation = "source-atop";
    this.scratchCtx.fillStyle = tint;
    this.scratchCtx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.globalCompositeOperation = "source-over";
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.translate(this.settings.width * 0.5 + dx, this.settings.height * 0.5 + dy);
    this.ctx.rotate(rotation);
    this.ctx.scale(scale, scale);
    this.ctx.drawImage(this.scratchCanvas as any, -this.settings.width * 0.5, -this.settings.height * 0.5, this.settings.width, this.settings.height);
    this.ctx.restore();
  }

  private drawJitteredPolygonPath(
    cx: number,
    cy: number,
    radius: number,
    sides: number,
    jitter: number,
    rotation: number,
    frame: AudioFrameFeature,
  ): void {
    const points = Math.max(3, sides);
    for (let index = 0; index <= points; index += 1) {
      const angle = rotation + (index / points) * Math.PI * 2;
      const jitterRadius = radius + sampleNoise2D(Math.cos(angle) * 0.7 + frame.timeSec * 0.6, Math.sin(angle) * 0.7, points + index) * jitter;
      const x = cx + Math.cos(angle) * jitterRadius;
      const y = cy + Math.sin(angle) * jitterRadius;
      if (index === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
  }

  private drawTintedTransitionLayer(tint: string, dx: number, dy: number, alpha: number): void {
    this.scratchCtx.clearRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.drawImage(this.transitionCanvas as any, 0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.globalCompositeOperation = "source-atop";
    this.scratchCtx.fillStyle = tint;
    this.scratchCtx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.scratchCtx.globalCompositeOperation = "source-over";
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.scratchCanvas as any, dx, dy, this.settings.width, this.settings.height);
    this.ctx.restore();
  }
}
/* c8 ignore stop */
