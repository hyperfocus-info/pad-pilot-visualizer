export interface CliOptions {
  input: string;
  theme?: string;
  fast?: boolean;
  duration?: string;
  output: string;
  fps: number;
  workers?: "auto" | number;
  format?: OutputFormatPreset;
  transition?: number;
  round4bar?: boolean;
  disableNebula?: boolean;
  halftime?: boolean;
  debug?: boolean;
  stateIn?: string;
  stateOut?: string;
  probe?: DiagnosticTargetType;
  probeIndex?: number;
  probeFrom?: number;
  probeTo?: number;
  probeStart?: number;
  probeEnd?: number;
  iterateSmoke?: boolean;
  targetGrade?: GradeLabel;
  maxIterations?: number;
  particleIntensity?: number;
}

export interface ResolvedPaths {
  ffmpegPath: string;
  ffprobePath: string;
  tempDir: string;
  audioDir: string;
  imageDir: string;
  videoDir: string;
  outputPath: string;
  trimmedAudioPath?: string;
}

export interface CleanupTempResult {
  ok: boolean;
  tempDir: string;
  finalPath?: string;
  attempts: number;
  renamed: boolean;
  skipped: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export type CliStage =
  | "input-validation"
  | "probe-source-audio"
  | "trim-audio"
  | "audio-analysis"
  | "image-download"
  | "image-style-analysis"
  | "edge-precompute"
  | "chunk-rendering"
  | "concat-video"
  | "mux-audio"
  | "debug-report"
  | "cleanup"
  | "run";

export interface CliStatusLogEntry {
  stage: CliStage | string;
  status: "ok" | "failed" | "warning";
  message: string;
  elapsedMs?: number;
}

export interface AudioMetadata {
  durationSec: number;
  sampleRate: number;
  channels: number;
  bpm?: number;
  beatIntervalSec?: number;
  estimatedBpm?: number;
  bpmSource?: BpmSource;
  beatOriginSec?: number;
  beatOriginConfidence?: number;
  beatOriginSource?: BeatOriginSource;
  anchorSearchStartSec?: number;
  anchorSearchEndSec?: number;
  anchorCandidateCount?: number;
  anchorSupportHitCount?: number;
  bpmTrustState?: BpmTrustState;
  anchorTrustState?: AnchorTrustState;
  anchorTopCandidates?: Array<{
    timeSec: number;
    score: number;
    confidence: number;
    supportHits: number;
  }>;
}

export type BpmSource = "source-metadata" | "trimmed-metadata" | "estimated" | "default";
export type BeatOriginSource = "transient-anchor" | "fallback-zero";
export type BpmTrustState =
  | "trusted-metadata"
  | "trusted-metadata-half-double-resolved"
  | "estimated-preferred"
  | "metadata-overridden"
  | "metadata-rejected";
export type AnchorTrustState = "transient-anchor" | "weak-anchor" | "fallback-zero";
export type CompositionModeReason =
  | "normal"
  | "dead-center-avoidance"
  | "edge-dominance-recovery"
  | "low-confidence-mask-recovery";
export type FallbackReason =
  | "none"
  | "edge-dominance"
  | "dead-center-void"
  | "low-focal-occupancy"
  | "low-support-near-hero"
  | "held-sparse"
  | "mask-confidence-low"
  | "readback-failure"
  | "safety-recovery"
  | "stat-missing"
  | "unknown";

export interface ProbedAudioMetadata {
  durationSec: number;
  sampleRate: number;
  channels: number;
  metadataBpm?: number;
}

export type DominantBand = "low" | "lowMid" | "mid" | "high";
export type OutputFormatPreset = "1080" | "720" | "480";
export type GradeLabel = "A" | "A-" | "B+" | "B" | "C";
export type DiagnosticTargetType = "node" | "transition" | "phrase-window" | "image-range" | "all-transitions" | "all-nodes";
export type DiagnosticSweepMode = "visual" | "responsiveness" | "all";
export type PhysicsParameterChannel =
  | "thrust"
  | "massDrain"
  | "jitterAmplitude"
  | "jitterFrequency"
  | "drag"
  | "smoothBias"
  | "transientSpeedGain"
  | "steadySpeedDamping"
  | "trailEmission"
  | "trailHeat"
  | "trailCooling"
  | "wakeWidth"
  | "burstProbability"
  | "burstFanout"
  | "burstVelocity"
  | "subsystemRecursion"
  | "residueSpread";

export const FRACTAL_MOTIFS = [
  "neon-tube",
  "smoke-ribbon",
  "glass-orbital",
  "cathedral-filament",
  "halo-cell",
  "shattered-arc",
  "mandelbloom",
  "data-cathedral",
  "chromatic-xylem",
  "vector-incantation",
  "harmonic-lattice",
  "film-bloom-shard",
] as const;
export type FractalMotif = typeof FRACTAL_MOTIFS[number];
export type SceneKey = string;
export type ConceptPitch = string;
export type ConceptDistinction = string;
export type SpawnMotifFamily = "orbital" | "cellular" | "ribbon" | "fracture" | "grid" | "cathedral" | "bloom";
export type SpawnArc = "hold" | "swap" | "mixed" | "punctuate";
export type SpawnEnergyTier = "low" | "mid" | "high";
export type SpawnSymmetryTier = "free" | "balanced" | "mirrored";
export type SpawnCompositionHealth = "strong" | "recovering" | "fragile";
export type SpawnContinuityPolicy = "reuse" | "rotate" | "rare" | "punctuation" | "hold-friendly" | "swap-friendly";

export interface SpawnEligibility {
  motifs?: FractalMotif[];
  motifFamilies?: SpawnMotifFamily[];
  regimes?: VisualRegime[];
  arcs?: SpawnArc[];
}

export interface SpawnRuntimeTuning {
  densityScale?: number;
  couplingScale?: number;
  heroCouplingScale?: number;
  particleCouplingScale?: number;
  triggerCooldownScale?: number;
  supportsMute?: boolean;
  disableSilhouetteOnLowMask?: boolean;
  disablePathPredictionOnWeakComposition?: boolean;
}

export interface SpawnConceptMetadata {
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface SpawnContext {
  sceneKey: SceneKey;
  sceneChanged: boolean;
  resolvedImageIndex: number;
  sourceImagePath: string;
  sourceMotif: FractalMotif;
  resolvedHeroMotif: FractalMotif;
  motifFamily: SpawnMotifFamily;
  visualRegime: VisualRegime;
  overlayMode: OverlayMode;
  dominantBand?: DominantBand;
  spawnArc: SpawnArc;
  energyTier: SpawnEnergyTier;
  symmetryTier: SpawnSymmetryTier;
  compositionHealth: SpawnCompositionHealth;
  maskConfidence: EdgeMap["maskConfidence"];
  heroCount: number;
  heroRelationshipClass?: HeroRelationshipClass;
  continuitySeed: number;
  preferHeroCoupling: number;
  previousBackgroundId?: BackgroundElementId;
  previousEventId?: EventSpecId;
  previousMotifEffectId?: MotifEffectId;
  previousParticleConceptIds?: ParticleConceptId[];
  persistentMotifId?: PersistentMotifId;
}

export interface SpawnAdjustment {
  densityScale?: number;
  couplingScale?: number;
  heroCouplingScale?: number;
  particleCouplingScale?: number;
  triggerWindowScale?: number;
  disableSilhouette?: boolean;
  disablePathPrediction?: boolean;
  muted?: boolean;
  renderMode?: "full" | "reduced" | "muted";
}

export interface SpawnSelection<TId extends string> {
  id: TId;
  reasonCodes: string[];
  continuityReason: string;
  rankingSignals: Array<{ label: string; value: number }>;
}

export type ParticleConceptId = string;
export type HeroMotifScheduleReason = "intro-setup" | "body-hold" | "body-promoted" | "outro-lock";

export interface HeroMotifScheduleSlot {
  slotIndex: number;
  startSec: number;
  endSec: number;
  motif: FractalMotif;
  reason: HeroMotifScheduleReason;
}

export interface HeroMotifSchedule {
  introEndSec: number;
  outroStartSec: number;
  slots: HeroMotifScheduleSlot[];
}
export const HERO_RESTRAINED_MOTIFS = [
  "data-cathedral",
  "cathedral-filament",
  "harmonic-lattice",
] as const satisfies readonly FractalMotif[];
export const HERO_COLORFUL_PSYCHEDELIC_MOTIFS = [
  "mandelbloom",
  "shattered-arc",
  "film-bloom-shard",
  "smoke-ribbon",
  "chromatic-xylem",
] as const satisfies readonly FractalMotif[];
export type HeroMotifIntensityClass = "restrained" | "standard" | "colorful-psychedelic";

export function classifyHeroMotifIntensity(motif: FractalMotif): HeroMotifIntensityClass {
  if ((HERO_RESTRAINED_MOTIFS as readonly FractalMotif[]).includes(motif)) {
    return "restrained";
  }
  if ((HERO_COLORFUL_PSYCHEDELIC_MOTIFS as readonly FractalMotif[]).includes(motif)) {
    return "colorful-psychedelic";
  }
  return "standard";
}

export const MOTIF_EFFECT_IDS = [
  "lorentz-drift",
  "arc-ladder",
  "vortex-shear",
  "thermal-plume",
  "caustic-lensing",
  "orbital-tidal-lock",
  "standing-wave-vault",
  "diffraction-rose",
  "soap-film-constriction",
  "osmotic-pulse",
  "brittle-fracture",
  "shock-ring",
  "phyllotaxis-burst",
  "spiral-phasing",
  "ferrofluid-choir",
  "signal-echo-chamber",
  "sap-pressure-rise",
  "branch-tension-snap",
  "gyro-precession",
  "slipstream-curl",
  "interference-grid",
  "crystal-mode-lock",
  "emulsion-burn",
  "gate-weave-flutter",
  "prism-ghosting",
] as const;
export type MotifEffectId = typeof MOTIF_EFFECT_IDS[number];
export const PERSISTENT_MOTIF_IDS = [
  "audio-synced-whip-pan-hallucinations",
  "non-linear-stream-consciousness-tracking",
  "symmetrical-fourth-wall-glitches",
  "typographic-labyrinth-dreams",
  "continuous-one-shot-temporal-shifts",
  "comic-panel-nested-realities",
  "metatextual-surveillance-perspectives",
  "rhythm-driven-reality-metamorphosis",
  "architectural-time-lapse-hyperdetail",
  "cosmic-neon-descent",
] as const;
export type PersistentMotifId = typeof PERSISTENT_MOTIF_IDS[number];
export const EVENT_SPEC_IDS = [
  "ionospheric-red-sprite-discharge",
  "bioluminescent-dinoflagellate-agitation",
  "cymatic-resonance-sand-metamorphosis",
  "fluid-dynamic-starling-murmuration",
  "acoustic-cavitation-sonoluminescence",
  "triboluminescent-crystal-fracture-flashes",
  "deep-sea-siphonophore-light-ripples",
  "electromagnetic-crown-flash-shifting",
  "explosive-fungal-spore-cloud-dispersal",
  "kawah-ijen-blue-sulfur-combustion",
  "parhelion-double-sun-flare",
  "catoptric-chamber-light-fold",
  "mercury-mirror-ripple-shear",
  "kaleidoscopic-wingbeat-refrain",
  "axial-vortex-reversal-bloom",
] as const;
export type EventSpecId = typeof EVENT_SPEC_IDS[number];
export const OUTRO_EFFECT_IDS = [
  "mono-strobe-drain",
  "signal-fade-ladder",
  "terminal-tear-jitter",
  "runway-pan-flare",
  "ash-bloom-descent",
  "memory-vapor-smear",
  "dilla-drift-pulse",
  "nocturne-spectrum-bleed",
  "kubrick-iris-decay",
  "prism-halo-retreat",
  "orbit-collapse-well",
  "mirror-lag-orbit",
  "stained-fade-vigil",
  "choir-scan-shiver",
  "nave-echo-glitch",
  "processional-rise-away",
  "bleach-cell-breath",
  "osmotic-afterglow",
  "petri-rainbow-pulse",
  "cellular-recoil-drift",
  "comic-book-shearout",
  "fracture-silence-falloff",
  "impact-snap-retreat",
  "white-hole-inversion",
  "petal-desat-recursion",
  "spiral-sunspill",
  "recall-glass-glitch",
  "mandala-sink-core",
  "archive-dropout",
  "codec-melt-fade",
  "signal-procession-pan",
  "echo-chapel-rewind",
  "sap-drain-monochrome",
  "branch-afterimage-flare",
  "woodgrain-ghost-slip",
  "root-clock-stagger",
  "glyph-burnout",
  "sigil-scan-break",
  "axis-lurch-retreat",
  "chant-spectrum-slice",
  "grid-dim-collapse",
  "phase-gate-jitter",
  "lattice-fade-bloom",
  "chorus-event-horizon",
  "emulsion-solar-fade",
  "frame-slip-corruption",
  "hero-dolly-bleed",
  "celluloid-rainbow-burn",
  "phantom-broadcast-snow",
  "authorial-void-iris",
] as const;
export type OutroEffectId = typeof OUTRO_EFFECT_IDS[number];
export const FRAME_POST_EFFECT_IDS = [
  "canvas-smear-residue",
  "pressure-grid-plane",
  "bass-monolith-extrude",
  "mobius-tunnel-wrap",
  "mirror-kaleido-lattice",
  "prism-axis-echo",
  "hard-pixel-lock",
  "impact-chromatic-aberration",
  "uv-feedback-tunnel",
  "datamosh-vector-drag",
  "crt-phosphor-mask",
  "godray-bloom-shaft",
  "tunnel-vision-pulse",
  "sobel-ink-outline",
  "resolution-crash-snapback",
  "palette-inversion-snare",
  "lens-dirt-specular",
] as const;
export type FramePostEffectId = typeof FRAME_POST_EFFECT_IDS[number];
export type PhysicalPhenomenonFamily =
  | "fluid"
  | "thermal"
  | "optical"
  | "electrical"
  | "magnetic"
  | "fracture"
  | "wave"
  | "orbital"
  | "mechanical"
  | "atmospheric"
  | "biological"
  | "chemical";
export type MotifEffectAudioMode = "static" | "db5-reactive" | "bpm-db5-reactive";
export type MotifEffectHeroMode = "none" | "particles-only" | "rare-warp";
export type SelectionTag = "reflective" | "temporal-freeze" | "hero-impacting" | "hero-revolve";
export type OutroEffectCategory =
  | "desaturate"
  | "fade"
  | "glitch"
  | "hero-movement"
  | "rainbow"
  | "black-hole"
  | "analog"
  | "tv-static"
  | "camera-flare-pan"
  | "time-play";
export type OutroEffectAudioMode = "bpm-locked" | "bpm-db-reactive" | "bpm-db-pulse-gated";
export type OutroEffectHeroBehavior = "none" | "drift" | "orbit" | "recoil" | "collapse" | "smear" | "pan-follow" | "time-lag";
export type OutroDbResponseBand = "none" | "low" | "mid" | "high" | "broadband";
export type OutroHueSource = "dominant-hue" | "average-hue" | "palette-cycle" | "warm-cool";
export type OutroSaturationSource = "saturation-mean" | "lightness-mean" | "palette-energy";
export type OutroContrastSource = "contrast" | "edge-density" | "symmetry";
export type FramePostEffectAudioMode = "static" | "db-reactive" | "pulse-gated" | "phrase-gated";
export type FramePostEffectBlendMode = "screen" | "lighter" | "difference" | "multiply" | "overlay";

export interface AudioFrameFeature {
  frameIndex: number;
  timeSec: number;
  beatAlignedTimeSec?: number;
  isPreAnchor?: boolean;
  subLowEnergy: number;
  lowEnergy: number;
  lowMidEnergy: number;
  midEnergy: number;
  highMidEnergy: number;
  highEnergy: number;
  normalizedSubLow: number;
  normalizedLow: number;
  normalizedLowMid: number;
  normalizedMid: number;
  normalizedHighMid: number;
  normalizedHigh: number;
  motionEnergy: number;
  isPeak: boolean;
  peakStrength: number;
  segmentIndex: number;
  dominantHz: number;
  dominantBand: DominantBand;
  rainbowHueOffset: number;
  beatPhase: number;
  subBeatPhase: number;
  barPhase: number;
  beatPulse: number;
  subBeatPulse: number;
  onsetStrength: number;
  motionEnvelope: number;
  dbLow: number;
  dbLowMid: number;
  dbMid: number;
  dbHighMid: number;
  dbHigh: number;
  dbOverall: number;
  dbNormalized: number;
  bandDeltaLow?: number;
  bandDeltaLowMid?: number;
  bandDeltaMid?: number;
  bandDeltaHighMid?: number;
  bandDeltaHigh?: number;
  bandAvgLow?: number;
  bandAvgLowMid?: number;
  bandAvgMid?: number;
  bandAvgHighMid?: number;
  bandAvgHigh?: number;
  bandRiseLow?: number;
  bandRiseLowMid?: number;
  bandRiseMid?: number;
  bandRiseHighMid?: number;
  bandRiseHigh?: number;
  bandRelativeScore?: number;
  bandWeightedScore?: number;
  impactBandScore?: number;
  textureBandScore?: number;
  bandVolatility?: number;
  songSignaturePhase?: number;
  phraseSignaturePhase?: number;
  pulseRaw: number;
  pulseEnvelope: number;
  pulseAccent: number;
  narrativeIntensity: number;
  pulseScale: number;
  beatIndex?: number;
  barIndex?: number;
  phrase4Index?: number;
  isBeatAccent?: boolean;
  isBarDownbeat?: boolean;
  isFourBarDownbeat?: boolean;
  barPulse?: number;
  phrasePulse?: number;
}

export interface AudioSegmentFeature {
  index: number;
  startSec: number;
  endSec: number;
  dominantHz: number;
  dominantBand: DominantBand;
  rainbowHueOffset: number;
  paletteWeights: {
    subLow: number;
    low: number;
    lowMid: number;
    mid: number;
    highMid: number;
    high: number;
  };
  motionScale: number;
  densityScale: number;
  energyTilt?: number;
  brightnessTilt?: number;
  impactDensity?: number;
  movementSkew?: number;
  bandDominanceVector?: [number, number, number, number, number];
  motifSeed?: number;
  transitionSeed?: number;
}

export type SongVisualFamily =
  | "ritual-drive"
  | "glass-surge"
  | "neon-drama"
  | "dust-glide"
  | "shard-pressure"
  | "cathedral-bloom";

export type PhraseMotifFamily =
  | "orbit-thread"
  | "shard-lattice"
  | "ribbon-surge"
  | "cathedral-beam"
  | "dust-choir"
  | "glow-grid";

export type PhraseTransitionCluster =
  | "carry"
  | "prism"
  | "impact"
  | "echo"
  | "shatter"
  | "glide";

export type PhraseCompositionBias =
  | "portrait-lock"
  | "detail-lane"
  | "establish-breath"
  | "negative-space-push"
  | "hero-split"
  | "center-release";

export type PhraseHeroMotionBias =
  | "glide"
  | "surge"
  | "stutter"
  | "orbit"
  | "lunge"
  | "drift";

export type PhraseBackgroundResponseBias =
  | "restrained"
  | "banded"
  | "echoed"
  | "sparked"
  | "veiled"
  | "pulsed";

export interface BandPhysicsMatrix5 {
  subLow: Record<PhysicsParameterChannel, number>;
  low: Record<PhysicsParameterChannel, number>;
  mid: Record<PhysicsParameterChannel, number>;
  highMid: Record<PhysicsParameterChannel, number>;
  high: Record<PhysicsParameterChannel, number>;
}

export interface HeroPhysicsEnvelope {
  thrust: number;
  massDrain: number;
  jitterAmplitude: number;
  jitterFrequency: number;
  drag: number;
  smoothBias: number;
  transientSpeedGain: number;
  steadySpeedDamping: number;
  trailEmission: number;
  trailHeat: number;
  trailCooling: number;
  wakeWidth: number;
  burstProbability: number;
  burstFanout: number;
  burstVelocity: number;
  subsystemRecursion: number;
  residueSpread: number;
}

export interface MotifPhysicsProfile {
  motif: EdgeMap["fractalMotif"];
  key: string;
  matrix: BandPhysicsMatrix5;
  base: HeroPhysicsEnvelope;
  channels: PhysicsParameterChannel[];
}

export interface HeroWakeSample {
  x: number;
  y: number;
  heat: number;
  width: number;
  age: number;
  heading: number;
}

export interface HeroWakeState {
  samples: HeroWakeSample[];
  maxSamples: number;
}

export interface HeroMotorPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  heading: number;
  fuel: number;
  burnPhase: number;
  jitter: number;
  lastFrameIndex: number;
}

export interface HeroPhysicsParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  heat: number;
  size: number;
  age: number;
  ttl: number;
  drag: number;
  alpha: number;
  bandAffinity: HeroBandAffinity;
  isConductor?: boolean;
  conductorType?: HeroConductorType;
  conductorStrength?: number;
  conductorRadius?: number;
  conductorPhaseOffset?: number;
  conductorBandMask?: HeroExpandedBand[];
}

export interface HeroParticleBuffers {
  count: number;
  capacity: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  heat: Float32Array;
  size: Float32Array;
  drag: Float32Array;
  alpha: Float32Array;
  age: Uint16Array;
  ttl: Uint16Array;
  bandAffinity: Uint8Array;
}

export interface HeroTrailState {
  particles: HeroParticleBuffers;
  capacity: number;
}

export interface HeroBurstSubsystem {
  x: number;
  y: number;
  heading: number;
  intensity: number;
  age: number;
  ttl: number;
  fanout: number;
  recursion: number;
  gateScore?: number;
  topQuartileSlowdown?: boolean;
  cadenceSlotHit?: boolean;
}

export interface HeroBurstState {
  particles: HeroParticleBuffers;
  subsystems: HeroBurstSubsystem[];
  particleCapacity: number;
  subsystemCapacity: number;
  lastCadenceSlot?: number;
  recentGateScores?: number[];
  lastGateActive?: boolean;
}

export interface HeroPhysicsState {
  motor: HeroMotorPhysicsState;
  wake: HeroWakeState;
  trail: HeroTrailState;
  burst: HeroBurstState;
  residue: HeroTrailState;
  seed: number;
  lastFrameIndex: number;
}

export interface DiagnosticSelector {
  type: DiagnosticTargetType;
  imageIndex?: number;
  phraseIndex?: number;
  fromImageIndex?: number;
  toImageIndex?: number;
  startSec?: number;
  endSec?: number;
  startImageIndex?: number;
  endImageIndex?: number;
  label?: string;
}

export interface DiagnosticAcceptanceProfile {
  grade: GradeLabel;
  minHeroCoverage?: number;
  maxClutter?: number;
  minTrailContinuity?: number;
  maxTransitionMs?: number;
  minCarrySmoothness?: number;
  allowNearBlackBridge?: boolean;
}

export interface DiagnosticScoreBreakdown {
  visualScore: number;
  responsivenessScore: number;
  smokeGrade: GradeLabel;
  failingChecks: string[];
}

export interface NodeVisualScore {
  imageIndex: number;
  heroCoverage: number;
  clutter: number;
  trailContinuity: number;
  motionEnergy: number;
  burstRichness: number;
  luminanceSafety: number;
  score: number;
}

export interface TransitionPerformanceScore {
  fromImageIndex: number;
  toImageIndex: number;
  transitionMs: number;
  carrySmoothness: number;
  nearBlackFrames: number;
  budgetPressure: number;
  score: number;
}

export interface NodeProbeResult {
  selector: DiagnosticSelector;
  visual: NodeVisualScore;
  acceptancePassed: boolean;
}

export interface TransitionProbeResult {
  selector: DiagnosticSelector;
  performance: TransitionPerformanceScore;
  acceptancePassed: boolean;
}

export interface DiagnosticReport {
  targetType: DiagnosticTargetType;
  targetId: string;
  visualScore: number;
  responsivenessScore: number;
  failingChecks: string[];
  nodeResults?: NodeProbeResult[];
  transitionResults?: TransitionProbeResult[];
}

export interface DiagnosticStateFile {
  audioPath: string;
  imageSet?: string;
  imagePaths?: string[];
  selectors: DiagnosticSelector[];
  sweepModes: DiagnosticSweepMode[];
  renderSettings: {
    width: number;
    height: number;
    fps: number;
  };
  diagnosticOverrides?: DiagnosticOverrides;
  acceptanceProfile: DiagnosticAcceptanceProfile;
}

export interface DiagnosticOverrides {
  thrustGain?: number;
  jitterGain?: number;
  trailEmissionGain?: number;
  trailCoolingGain?: number;
  burstFanoutGain?: number;
  residueSpreadGain?: number;
  supportSuppressionGain?: number;
  transitionCarryGain?: number;
  bridgeBiasGain?: number;
  disableBudgetDowngrades?: boolean;
  disableParticleCaps?: boolean;
  particleSpawnScale?: number;
  telemetryMode?: RenderTelemetryMode;
}

export type RenderTelemetryMode = "full" | "summary" | "off";

export type RenderDiagnosticFailureReason =
  | "window-not-found"
  | "window-key-collision"
  | "window-key-fragmented"
  | "window-rendered-no-stats"
  | "stat-merge-miss"
  | "frame-readback-miss"
  | "image-index-miss"
  | "unknown";

export interface AudioAnalysisResult {
  metadata: AudioMetadata;
  frames: AudioFrameFeature[];
  segments: AudioSegmentFeature[];
}

export type ShapeBias = "filament" | "cloud" | "shard" | "ring" | "cellular";
export type ParticleBias = "dust" | "orbs" | "streaks" | "shards" | "mixed";
export type VisualRegime = "intro" | "groove" | "build" | "drop" | "breakdown" | "outro";
export type OverlayMode = "stable-feedback" | "pulse-wave" | "kinetic-scan" | "climax-burst" | "sparse-contour";
export const TRANSITION_FAMILIES = [
  "carry",
  "compress",
  "flash",
  "fragment",
  "wipe",
  "melt-safe",
  "spiral-carry",
  "orbital-shear",
  "phase-lattice",
  "ribbon-fold",
  "axis-swap",
  "chorus-drift",
  "mirror-kaleido",
  "split-mirror",
  "bilateral-iris-fold",
  "mirror-gate-inversion",
  "prism-axis-lag",
  "quad-kaleido-choir",
  "reflection-slit-shatter",
  "prism-fold",
  "shear-kaleido",
  "halo-drift",
  "veil-shift",
  "echo-fold",
  "lattice-breath",
  "phase-ghost",
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
  "wright-whip-pan-particle-smear",
  "kon-reality-shatter-match-cut",
  "moore-nine-panel-particle-grid",
  "kojima-tactical-glitch-noise",
  "gilligan-time-lapse-particle-sand",
  "floyd-dark-side-prism-dispersal",
  "barlog-continuous-camera-particle-sweep",
  "joyce-fluid-text-morph",
  "kubrick-slit-scan-star-gate",
  "danielewski-house-typographic-distortion",
  "voronoi-drop-shatter",
  "wire-solid-phase-cut",
  "mobius-wrap-tunnel",
  "datamosh-vector-drag",
  "resolution-crash-snapback",
  "snare-negative-flip",
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
] as const;
export type TransitionFamily = typeof TRANSITION_FAMILIES[number];
export type MotionMode = "glide" | "pulse" | "surge" | "burst" | "drift";
export type ShotMode = "establish" | "portrait" | "detail" | "climax";
export type EffectPolicy = "safe" | "balanced" | "aggressive";
export type RescuePolicy = "none" | "lift" | "reinforce" | "recover";
export type ActiveSubjectMode = "hover" | "sway" | "windup" | "strike" | "orbit" | "ghost" | "dissolve";
export type StylePlacementMode = "orbital" | "filament" | "ribbon" | "cell" | "shard-lane";
export type PlacementLayer = "hero" | "support" | "background";
export type HeroGlyphKind =
  | "star"
  | "circle"
  | "ellipse"
  | "line"
  | "rectangle"
  | "square"
  | "diamond"
  | "pentagon"
  | "infinity"
  | "glint"
  | "hexagon"
  | "octagon"
  | "rose"
  | "heart"
  | "teardrop"
  | "chevron"
  | "spiral"
  | "blob"
  | "crescent"
  | "moon"
  | "parallelogram"
  | "cross"
  | "arrow"
  | "arc"
  | "sector"
  | "ring"
  | "cloud"
  | "stadium"
  | "kite"
  | "hexagram"
  | "lens"
  | "mask"
  | "eye"
  | "crown"
  | "halo"
  | "fang"
  | "sigil"
  | "wing"
  | "hand"
  | "stair"
  | "gate"
  | "totem"
  | "lightning";
export type HeroArchetype =
  | "oracle-mask"
  | "electric-seraph"
  | "corridor-witness"
  | "ritual-engine"
  | "fractured-rider"
  | "petal-devourer"
  | "laughing-mandala"
  | "void-guitarist";
export type GlyphStoryBeat =
  | "arrival"
  | "invocation"
  | "duplication"
  | "shedding"
  | "possession"
  | "rupture"
  | "communion"
  | "aftermath";
export type HeroEmissionMode = "breath" | "crown-spray" | "spine-fountain" | "orbit-shed" | "mouth-flare" | "hand-cascade";
export type SubEmitterMode = "petal-shed" | "spark-fork" | "echo-ring" | "mask-fracture" | "dust-afterimage";
export type HeroPrimitiveKind =
  | "rectangle"
  | "square"
  | "circle"
  | "ellipse"
  | "line"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "star"
  | "heart"
  | "moon"
  | "parallelogram"
  | "cross"
  | "arrow"
  | "arc"
  | "sector"
  | "ring"
  | "cloud"
  | "stadium"
  | "chevron"
  | "kite"
  | "hexagram"
  | "lens"
  | "lightning"
  | "asterisk"
  | "spiral"
  | "teardrop";
export type HeroCoreFillMode = "solid" | "stroke-fill" | "ring-fill";
export type HeroDeformationMode = "pulse" | "squash" | "tilt" | "wobble" | "shear" | "petal";
export type HeroPostShellMode = "soft-halo" | "shock-ring" | "heat-smear" | "petal-shell" | "electric-shell" | "monolith-extrude" | "wire-solid-flip" | "hinge-bloom" | "none";
export type HeroShellColorMode = "single" | "multi";
export type HeroShellBand = "low" | "lowMid" | "lowComposite";
export type RecoveryMode = "none" | "safety-recovery" | "fallback-composed";
export type HeroShellLayerStyle = "halo-fill" | "shock-ring" | "rim-halo";
export type HeroEmissionPattern = "spray" | "orbit-shed" | "spine-fountain" | "wake" | "petal-shed";
export type HeroBandAffinity = "low" | "mid" | "high";
export type HeroExpandedBand = "subLow" | "low" | "mid" | "highMid" | "high";
export type HeroChildMode = "wake" | "orbit-chip" | "petal" | "spoke" | "shiver" | "drip" | "aoe-ring";
export type HeroSubEmitterMotionMode = "orbit-hero" | "revolve-hero" | "patrol" | "atomic-gravity" | "hover";
export type HeroSpawnTimingMode = "continuous" | "phasic-downbeat" | "phasic-quarter" | "band-low" | "band-mid-high" | "all-band-split";
export type HeroConductorMotionFamily =
  | "orbit"
  | "braid"
  | "accordion"
  | "recoil"
  | "pendulum"
  | "tidal-lock"
  | "flock-curl"
  | "spoke-bloom"
  | "delay-wave"
  | "collapse-pulse"
  | "perfect-circle"
  | "orbit-through"
  | "spiral-braid";
export type HeroConductorAnchorMode = "seed-particle" | "nearest-hero";
export type HeroConductorType =
  | "mesh-ritual"
  | "cut-up-marionette"
  | "dust-vellum-orbit"
  | "funeral-android"
  | "spine-furnace"
  | "clear-line-drift"
  | "buried-subway-bloom"
  | "catacomb-choir"
  | "ink-labyrinth"
  | "false-choice-carousel"
  | "glacial-feedback"
  | "tape-lot-lurch"
  | "neon-votive"
  | "cosmic-processional"
  | "bruise-satin-surge"
  | "checkpoint-parallax"
  | "xerox-shadow-pulse"
  | "biomech-cathedral"
  | "vector-handwriting"
  | "invisible-constellation"
  | "candy-goblin-skip"
  | "signal-archivist"
  | "acid-panel-jolt"
  | "orbital-museum-scan"
  | "paper-echo-lantern"
  | "swarm-choirmaster"
  | "latch-archivist"
  | "mirror-choir"
  | "catoptric-weaver"
  | "axis-orrery"
  | "prism-synod"
  | "kaleido-lantern"
  | "vigil-ring"
  | "transit-orrery"
  | "braid-procession";
export type HeroRelationshipMode = "independent" | "mirror-x" | "mirror-y" | "mirror-xy" | "cojoined";
export type HeroRelationshipClass = "symmetric" | "independent" | "attracted_repulsed" | "codependent";
export type HeroLayoutFamily = "independent-lanes" | "bilateral-stage" | "vertical-stage" | "quad-stage" | "cojoined-cluster";
export type HeroRelationshipRole = "primary" | "mirror-left" | "mirror-right" | "mirror-top" | "mirror-bottom" | "satellite" | "diagonal-a" | "diagonal-b";
export type HeroSeparationFailureReason = "none" | "cojoined-intent" | "center-collapse" | "insufficient-spread" | "lane-collapse" | "glow-merge" | "quadrant-collapse";
export type NodeIntent =
  | "repopulation"
  | "cosmic-collapse"
  | "follow-the-path"
  | "dj-rave"
  | "fireworks"
  | "rambunctious-play"
  | "orbit-ritual"
  | "cathedral-procession"
  | "signal-braid"
  | "vortex-release";
export type EpisodeIntent =
  | "rabbit-hole-drift"
  | "tea-party-chaos"
  | "procession-of-masks"
  | "mirror-corridor"
  | "catoptric-duet"
  | "mirror-procession"
  | "kaleido-coronation"
  | "quad-vigil"
  | "prism-tribunal"
  | "royal-decapitation"
  | "garden-repopulation"
  | "cosmic-trial"
  | "carnival-bloom"
  | "scale-inversion"
  | "fool-procession"
  | "electric-funeral"
  | "mirror-sermon"
  | "desert-revelation"
  | "neon-bardo"
  | "comic-occult-heist"
  | "velvet-overload"
  | "psychedelic-procession"
  | "machine-communion";
export type AccentEventMode = "emitters" | "absorbers" | "burst-gate" | "petal-explosion" | "chain-transfer" | "mirror-flip";
export type MotionScript =
  | "escort"
  | "emit-to-edge"
  | "orbit-anchor"
  | "dual-well"
  | "braid-lane"
  | "spiral-in"
  | "spiral-out"
  | "burst-falloff"
  | "follow-hero"
  | "play-scatter"
  | "edge-fog"
  | "signal-drift"
  | "absorb-well"
  | "emit-chain"
  | "release-bloom";
export type ShapeFamilyToken =
  | "dot"
  | "ring"
  | "shard"
  | "chevron"
  | "diamond"
  | "arc"
  | "star"
  | "crescent"
  | "glint"
  | "rose"
  | "spiral"
  | "blob"
  | "hexagon"
  | "infinity"
  | "teardrop"
  | "cell-cluster"
  | "arc-haze"
  | "braid-marker"
  | "pulse-shard"
  | "fallout-arc";
export type OccupancyPurpose = "hero-wake" | "support-wake" | "burst-remnant" | "path-node" | "ambient-fog" | "ritual-ring";

export interface ParticleLifecycleStats {
  particleSpawnRequests: number;
  particleRenderedCount: number;
  particleCulledByLayerCap: number;
  particleCulledByHeroProtection: number;
  particleCulledByNegativeSpace: number;
  particleCulledByImageProgress: number;
  particleCulledBySkipNonHero: number;
  particleOffscreenCount: number;
  particleTooSmallToReadCount: number;
  particleLowAlphaCount: number;
  particleLowContrastCount: number;
  particleVisibleCount: number;
  heroParticleRenderedCount: number;
  supportParticleRenderedCount: number;
  backgroundParticleRenderedCount: number;
  subEmitterTriggerCount: number;
  subEmitterChildSpawnedCount: number;
  edgeDeathEligibleCount: number;
  edgeDeathTriggeredCount: number;
  edgeDeathPlayedCount: number;
  edgeDeathSkippedByCostCount: number;
  edgeDeathEffectId?: string;
  edgeDeathCostTier?: "low" | "medium" | "high";
  edgeExitFramesAvg: number;
  edgeExitDistanceAvg: number;
}
export type AtmosphereMode = "field-halo" | "signal-haze" | "stained-glow" | "fallout-fog" | "petal-bloom";
export type InterferenceMode = "lane-braids" | "phase-ripples" | "arch-membranes" | "scan-ripples" | "petal-wave";
export type SymmetryMode = "none" | "hero-wedge" | "support-petals" | "contour-bilateral" | "shard-kaleidoscope";
export type BridgePattern = "paired-links" | "burst-spokes" | "procession-lanes" | "petal-chain" | "signal-cords";
export type NegativeSpaceMode = "open-void" | "charged-silence" | "punctured-void" | "sacred-opening";

export interface LayerDirective {
  spawnMode: "hero-core" | "support-lane" | "edge-field" | "scatter-field";
  targetMode: "hero-path" | "support-attractors" | "background-attractors" | "paired-attractors" | "edge-release";
  motionScript: MotionScript;
  shapeFamilies: ShapeFamilyToken[];
  densityRange: [number, number];
  dominance: number;
  lingerPenalty: number;
}

export interface NodeIntentSeed {
  intent: NodeIntent;
  heroDirective: LayerDirective;
  supportDirective: LayerDirective;
  backgroundDirective: LayerDirective;
  atmosphereMode: AtmosphereMode;
  interferenceMode: InterferenceMode;
  bridgePattern: BridgePattern;
  symmetryMode: SymmetryMode;
  negativeSpaceMode: NegativeSpaceMode;
  energyBias: number;
  playfulness: number;
  collapseBias: number;
  radialBias: number;
  pathBias: number;
  scatterBias: number;
}

export interface PhrasePulseProfile {
  bpmPulseStrength: number;
  barPulseStrength: number;
  fourBarAccentStrength: number;
  downbeatExplosionChance: number;
  betweenBeatBreathing: number;
}

export interface EpisodeSeed {
  episodeIntent: EpisodeIntent;
  accentModes: AccentEventMode[];
  particleVolumeScale: number;
  emitterBias: number;
  absorberBias: number;
  explosionBias: number;
  metamorphBias: number;
  narrativeContinuityBias: number;
  pulseProfile: PhrasePulseProfile;
}

export interface SourceAttractorProfile {
  mask: number;
  edgeDensity: number;
  contrast: number;
  luminanceGradient: number;
  focalDistance: number;
  supportLaneBoost: number;
  silhouetteBoost: number;
}

export interface HeroGlyphGrammar {
  primary: HeroGlyphKind;
  secondary: HeroGlyphKind[];
  tertiary: HeroGlyphKind[];
  symmetryMode: "bilateral" | "radial" | "off-axis" | "corridor";
  deformation: "squeeze" | "tear" | "mirror-slip" | "radial-bloom" | "corridor-recursion";
  echoPolicy: "none" | "trail" | "bilateral" | "recursive";
}

export interface HeroSubEmitterDirective {
  offsetX: number;
  offsetY: number;
  spawnX: number;
  spawnY: number;
  spawnXRange: number;
  spawnYRange: number;
  primitive: HeroPrimitiveKind;
  spawnRate: number;
  childSpread: number;
  childSpeed: number;
  childLifetime: number;
  childScale: number;
  emissionMode: HeroEmissionPattern;
  bandAffinity: HeroBandAffinity;
  densityScale: number;
  shellCoupling: number;
  motionMode: HeroSubEmitterMotionMode;
  rotationReactive?: boolean;
  rotationBand?: HeroExpandedBand;
  rotationBaseVelocity?: number;
  rotationNegativeOnDrop?: boolean;
}

export interface HeroChildParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  alpha: number;
  primitive: HeroPrimitiveKind;
  bandAffinity: HeroBandAffinity;
  emitterIndex: number;
  phase: number;
  mode: HeroChildMode;
  outlineAlpha?: number;
  fillAlpha?: number;
  isConductor?: boolean;
  conductorType?: HeroConductorType;
  conductorStrength?: number;
  conductorRadius?: number;
  conductorPhaseOffset?: number;
  conductorBandMask?: HeroExpandedBand[];
}

export interface HeroChildFieldState {
  particles: HeroChildParticle[];
  seed: number;
  clusterIndex?: number;
  role?: "primary" | "satellite";
  lastFrameIndex: number;
  lastImageIndex?: number;
  lastTransitionFamily?: TransitionFamily;
  physics?: HeroPhysicsState;
}

export interface BandEnergyProfile {
  low: number;
  mid: number;
  high: number;
  lowDominant: boolean;
  midDominant: boolean;
  highDominant: boolean;
}

export interface MotifEffectParticleInfluence {
  trailEmission: number;
  burstFanout: number;
  residueSpread: number;
  driftField: number;
  shellGlow: number;
  wakeWidth: number;
}

export interface MotifEffectSpec {
  id: MotifEffectId;
  family: PhysicalPhenomenonFamily;
  primaryMotif: FractalMotif;
  fallbackMotifs: FractalMotif[];
  phenomenon: PhysicalPhenomenonFamily;
  baseOverlayMode: OverlayMode;
  audioMode: MotifEffectAudioMode;
  preferredRegimes: VisualRegime[];
  particleInfluence: MotifEffectParticleInfluence;
  heroMode: MotifEffectHeroMode;
  heroTriggerGate: "none" | "rare-musical";
  cooldownBeats: number;
  selectionWeight?: number;
  selectionTags?: SelectionTag[];
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface MotifEffectState {
  id: MotifEffectId;
  intensity: number;
  phase: number;
  lowDbWeight: number;
  midDbWeight: number;
  highDbWeight: number;
  beatLock: number;
  heroWarpActive: boolean;
}

export interface PersistentMotifSpec {
  id: PersistentMotifId;
  family: "continuity-bias";
  label: string;
  influenceRefs: string[];
  preferredFractalMotifs: FractalMotif[];
  preferredTransitionFamilies: TransitionFamily[];
  preferredEventSpecs: EventSpecId[];
  overlayBias: Partial<Record<OverlayMode, number>>;
  heroMutationBias: number;
  holdFavoring: number;
  swapFavoring: number;
  transientGateThreshold: number;
  minCarryFrames: number;
  maxCarryFrames: number;
  changeCooldownBeats: number;
  influenceKey: string;
  selectionWeight?: number;
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface PersistentMotifState {
  id: PersistentMotifId;
  label: string;
  influenceKey: string;
  ageFrames: number;
  carryFrames: number;
  changedThisFrame: boolean;
  changeGate: "startup" | "transient-peak" | "forced-reset";
  transientScore: number;
  cooldownUntilBeat: number;
}

export interface EventSpec {
  id: EventSpecId;
  family: PhysicalPhenomenonFamily;
  label: string;
  phenomenon: PhysicalPhenomenonFamily;
  preferredBands: Array<DominantBand | "subLow" | "highMid">;
  preferredRegimes: VisualRegime[];
  accentEventModeBridge: AccentEventMode[];
  triggerModeWeights: {
    emitter: number;
    absorber: number;
    explosion: number;
  };
  particleBiasModifiers: {
    emitterScale: number;
    absorberScale: number;
    explosionScale: number;
    driftScale: number;
  };
  nebulaBiasModifiers: {
    glowScale: number;
    streakScale: number;
    rippleScale: number;
  };
  transientSensitivity: number;
  downbeatSensitivity: number;
  phraseSensitivity: number;
  cooldownFrames: number;
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface EventState {
  id: EventSpecId;
  label: string;
  intensity: number;
  emitterBias: number;
  absorberBias: number;
  explosionBias: number;
  accentModes: AccentEventMode[];
  changedThisFrame: boolean;
}

export interface OutroEffectTimingProfile {
  beatDivision: number;
  barAccentWeight: number;
  phraseAccentWeight: number;
  swingAmount: number;
}

export interface OutroEffectDbResponse {
  band: OutroDbResponseBand;
  gain: number;
  floor: number;
  ceiling: number;
}

export interface OutroEffectImageControlProfile {
  hueSource: OutroHueSource;
  satSource: OutroSaturationSource;
  contrastSource: OutroContrastSource;
  symmetryBias: number;
  edgeBias: number;
  warmCoolBias: number;
}

export interface OutroEffectSpec {
  id: OutroEffectId;
  motif: FractalMotif | "wildcard";
  category: OutroEffectCategory;
  influenceKey: string;
  overlayMode: OverlayMode;
  transitionFamily: TransitionFamily;
  audioMode: OutroEffectAudioMode;
  timingProfile: OutroEffectTimingProfile;
  dbResponse: OutroEffectDbResponse;
  imageControlProfile: OutroEffectImageControlProfile;
  heroBehavior: OutroEffectHeroBehavior;
  outroWeight: number;
  cooldownBars: number;
  selectionWeight?: number;
  selectionTags?: SelectionTag[];
}

export interface OutroEffectState {
  id: OutroEffectId;
  imageSignature: string;
  phase: number;
  beatPulse: number;
  barPulse: number;
  phrasePulse: number;
  dbDrive: number;
  mix: number;
  outroProgress: number;
  closingBarsProgress: number;
  terminalBurstProgress: number;
  collapseDrive: number;
  frameCoverageTarget: number;
  heroWarp: number;
  colorSet: string[];
  intensity: number;
}

export interface FramePostEffectSpec {
  id: FramePostEffectId;
  motifs: Array<FractalMotif | "wildcard">;
  preferredRegimes: VisualRegime[];
  preferredOverlayModes: OverlayMode[];
  preferredPersistentMotifs: PersistentMotifId[];
  audioMode: FramePostEffectAudioMode;
  blendMode: FramePostEffectBlendMode;
  selectionWeight: number;
  intensityFloor: number;
  intensityCeiling: number;
  selectionTags?: SelectionTag[];
}

export interface FramePostEffectState {
  id: FramePostEffectId;
  intensity: number;
  phase: number;
  overlayOpacityEstimate: number;
  effectVisiblePixelRatioEstimate: number;
}

export interface NebulaBandRouting {
  structureLow: number;
  textureMid: number;
  sparkHigh: number;
  glowLowMid: number;
  distortionHighMid: number;
}

export const BACKGROUND_ELEMENT_IDS = [
  "flickering-chevron-floor-patterns",
  "twitching-glitch-rectangles",
  "rhythmic-wireframe-cube-swarms",
  "hand-scratched-emulsion-lines",
  "high-frequency-barcode-stripes",
  "intersecting-crystalline-triangles",
  "slowly-expanding-heavy-spheres",
  "jittering-minimalist-angles",
  "slowly-overlapping-ambient-planes",
  "suspended-tension-circles-and-diagonals",
  "looming-monolithic-cylinders",
  "fractured-cut-up-grid-squares",
  "stacked-crt-static-blocks",
  "hyper-dimensional-geometric-sigils",
  "asymmetrical-bio-mechanical-spikes",
  "symmetrical-elliptical-tracks",
  "synchronized-falling-diamonds",
  "aleatoric-scattered-tension-dots",
  "algorithmic-metallic-polyhedrons",
  "sharp-luminous-trapezoidal-voids",
  "stark-pixelated-punishment-blocks",
  "concentric-mystical-spirals",
  "endless-obliterating-polka-dots",
  "uncanny-floating-digital-primitives",
  "phasing-rhythmic-pendulum-arcs",
  "beat-reactive-repelling-pyramids",
  "proximity-glitching-wireframe-polygons",
  "phasing-concentric-rings-orbiting-hero",
  "interval-fading-silhouette-rectangles",
  "hero-synchronized-breathing-triangles",
  "tactile-swelling-polka-dots",
  "metronome-slicing-chevron-masks",
  "periodically-resetting-physics-cubes",
  "crescendo-expanding-octagon-enclosures",
  "silhouette-distorting-strobing-scanlines",
  "timer-aligned-random-cube-clusters",
  "delayed-collapse-shadow-cylinders",
  "staccato-emulsion-slashes-piercing-hero",
  "hero-absorbing-pulsing-void-spheres",
  "rhythmically-contracting-prismatic-frames",
  "trajectory-predicting-polygon-clusters",
  "time-delayed-echo-box-primitives",
  "hero-targeted-orbiting-tetrahedrons",
  "countdown-triggered-collapsing-hexagons",
  "audio-reactive-expanding-floor-tiles",
  "hero-tracking-metronomic-pendulums",
  "kinetic-interlocking-cylinder-gears",
  "tempo-matched-bouncing-arc-halos",
  "velocity-scaled-trailing-prisms",
  "collision-triggered-shattering-rhombuses",
  "eddy-advect-plume",
  "plexus-neighbor-web",
  "bass-well-orrery",
  "voxel-depth-drift",
  "pressure-grid-plane",
  "boolean-aperture-cuts",
  "metaball-merge-mass",
  "voronoi-drop-shatter",
  "lissajous-sigil-loop",
  "hard-pixel-lock",
  "crt-phosphor-mask",
] as const;
export type BackgroundElementId = typeof BACKGROUND_ELEMENT_IDS[number];

export type BackgroundElementFamily =
  | "line-field"
  | "grid-field"
  | "stripe-field"
  | "plane-field"
  | "primitive-swarm"
  | "ring-field"
  | "void-shape"
  | "sigil-field";

export type BackgroundInteractionMode =
  | "none"
  | "hero-proximity"
  | "hero-orbit"
  | "hero-velocity"
  | "hero-particle-collision"
  | "hero-particle-absorb"
  | "hero-path-predictive";

export type BackgroundTriggerMode =
  | "beat"
  | "bar"
  | "four-bar"
  | "countdown"
  | "interval"
  | "crescendo"
  | "collision"
  | "silhouette-strobe";

export type BackgroundImageResponseMode =
  | "silhouette"
  | "contour"
  | "density"
  | "symmetry"
  | "palette"
  | "contrast";

export type BackgroundFamilyVariant =
  | "default"
  | "repelling-pyramids"
  | "wireframe-polygons"
  | "orbiting-rings"
  | "silhouette-rectangles"
  | "breathing-triangles"
  | "swelling-polka-dots"
  | "chevron-masks"
  | "physics-cubes"
  | "octagon-enclosures"
  | "strobing-scanlines"
  | "random-cube-clusters"
  | "shadow-cylinders"
  | "emulsion-slashes"
  | "void-spheres"
  | "prismatic-frames"
  | "predictive-polygons"
  | "echo-boxes"
  | "orbiting-tetrahedrons"
  | "collapsing-hexagons"
  | "floor-tiles"
  | "metronomic-pendulums"
  | "cylinder-gears"
  | "arc-halos"
  | "trailing-prisms"
  | "shattering-rhombuses"
  | "advect-plume"
  | "plexus-web"
  | "gravity-orrery"
  | "voxel-drift"
  | "pressure-grid"
  | "aperture-cuts"
  | "metaball-merge"
  | "voronoi-shatter"
  | "lissajous-loop"
  | "pixel-lock"
  | "crt-mask";

export interface BackgroundPulseProfile {
  beatPulseStrength: number;
  barPulseStrength: number;
  betweenBeatBreathing: number;
  flickerAmount: number;
}

export interface BackgroundHzColorRouting {
  subLow: number;
  low: number;
  mid: number;
  highMid: number;
  high: number;
}

export interface BackgroundElementMotionParams {
  driftScale: number;
  jitterScale: number;
  rotationScale: number;
  expansionScale: number;
  phaseRate: number;
}

export interface BackgroundGeometryParams {
  count: number;
  spacing: number;
  thickness: number;
  depth: number;
  scaleVariance: number;
  symmetry: number;
  density: number;
}

export interface BackgroundLayeringParams {
  hazeAlpha: number;
  glowAlpha: number;
  blendMode: "screen" | "lighter" | "overlay" | "source-over";
}

export interface BackgroundColorTuning {
  baselineColorfulnessScale: number;
  peakColorfulnessScale: number;
  peakColorEligible: boolean;
  lowAlphaLuminosityLift: number;
  highAlphaLuminosityLift: number;
}

export interface BackgroundMotionTuning {
  bpmMotionFloor: number;
  minorImpactMotionFloor: number;
  minorImpactDriveMix: {
    onset: number;
    peak: number;
    highMid: number;
  };
}

export interface BackgroundElementSpec {
  id: BackgroundElementId;
  family: BackgroundElementFamily;
  supportedMotifs: FractalMotif[];
  fallbackMotifs: FractalMotif[];
  densityBudget: number;
  pulseBehavior: BackgroundPulseProfile;
  hzColorBehavior: BackgroundHzColorRouting;
  geometryDefaults: BackgroundGeometryParams;
  motionDefaults: BackgroundElementMotionParams;
  continuityCategory: "architectural" | "orbital" | "glitch" | "organic" | "ritual";
  motifAffinity: number;
  interactionMode: BackgroundInteractionMode;
  triggerMode: BackgroundTriggerMode;
  imageResponseMode: BackgroundImageResponseMode;
  familyVariant: BackgroundFamilyVariant;
  heroCouplingStrength: number;
  particleCouplingStrength: number;
  triggerCooldownBeats: number;
  supportsHeroCluster: boolean;
  supportsHeroParticles: boolean;
  selectionWeight?: number;
  hazeAssist?: boolean;
  influenceRefs?: string[];
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface ParticleConceptSpec {
  id: ParticleConceptId;
  family: "directive" | "accent" | "emission" | "sub-emitter" | "episode" | "motif";
  pitch: ConceptPitch;
  distinction: ConceptDistinction;
  eligibility: SpawnEligibility;
  continuityPolicy: SpawnContinuityPolicy;
  runtimeTuning: SpawnRuntimeTuning;
}

export interface HeroInstanceSeed {
  primitive: HeroPrimitiveKind;
  aspectBias: number;
  pointiness: number;
  symmetryBreak: number;
  rotationBias: number;
  shellMorph: number;
  emitterTopology: "bilateral" | "orbit" | "spine" | "fan" | "petal";
  childPrimitiveMix: HeroPrimitiveKind[];
  bandRouting: [HeroBandAffinity, HeroBandAffinity, HeroBandAffinity];
  sizeBias: number;
  outlineBias: number;
  deformationBias: HeroDeformationMode;
  travelStyle: HeroTravelStyle;
  motifProfileKey: string;
  edgeAttachmentBias: number;
  variantKey: string;
}

export interface HeroTravelStyle {
  gracefulBias: number;
  glitchBias: number;
  pathSmoothing: number;
  targetSmoothing: number;
  warpProbability: number;
  deformJitter: number;
  landingIntent: number;
  warpXBand: HeroExpandedBand;
  warpYBand: HeroExpandedBand;
  warpXBaseMultiplier: number;
  warpYBaseMultiplier: number;
  warpXExtremeMultiplier: number;
  warpYExtremeMultiplier: number;
  lowDbMoveScale: number;
  lowDbEmissionScale: number;
  lowDbFreezeOnDrop: boolean;
  lowDbDropThreshold: number;
}

export type HeroClusterRole = "primary" | "satellite";

export interface HeroClusterConfig {
  enabled: boolean;
  count: number;
  layout: "bilateral" | "triad" | "orbit-ring" | "staggered-arc";
  relationshipMode: HeroRelationshipMode;
  satelliteScale: number;
  satelliteEmissionScale: number;
  satelliteAlphaScale: number;
  satellitePathOffsetRadius: number;
  sharedCoreBias: number;
  mirrorAxisBias: number;
  satellitePhaseLock: number;
}

export interface HeroEmissionTuning {
  warpFactorScale: number;
  warpVisualScale: number;
  ttlScale: number;
  dragScale: number;
  colorfulnessScale: number;
  edgeAttractionScale: number;
  edgeAttractionBypassSpawnDrag: boolean;
  colorRangeMode: "tight" | "medium" | "wide" | "extreme";
}

export interface HeroConductorSpec {
  id: HeroConductorType;
  motionFamily: HeroConductorMotionFamily;
  anchorMode: HeroConductorAnchorMode;
  bandBias: HeroExpandedBand[];
  radiusScale: number;
  strength: number;
  phaseMode: "locked" | "swing" | "staggered" | "phrase-lag";
  swirl: number;
  tether: number;
  pulse: number;
  radiusVariance?: number;
  strengthVariance?: number;
  lifespanModRange?: { min: number; max: number };
  swirlVariance?: number;
  pulseVariance?: number;
  preferredMotifs: EdgeMap["fractalMotif"][];
  preferredRegimes: VisualRegime[];
  influenceRefs: string[];
  selectionWeight?: number;
  selectionTags?: SelectionTag[];
}

export interface HeroConductorSelection {
  primary: HeroConductorType;
  secondary?: HeroConductorType;
  density: number;
  influenceRadiusScale: number;
  strengthScale: number;
}

export interface HeroConductorRuntimeState {
  type: HeroConductorType;
  motionFamily: HeroConductorMotionFamily;
  anchorMode: HeroConductorAnchorMode;
  strength: number;
  radius: number;
  phaseOffset: number;
  bandMask: HeroExpandedBand[];
  lifespanMod: number;
  resolvedSwirl: number;
  resolvedPulse: number;
  resolvedTether: number;
}

export interface TransitionCooldownContext {
  nominalNextAllowableFrame: number;
  reducedNextAllowableFrame: number;
  cooldownReduction: number;
  dbReduction: number;
  hzReduction: number;
  audioCooldownTriggeredTransition: boolean;
  acceleratedByDb: boolean;
  acceleratedByHz: boolean;
}

export interface TransitionBiasProfile {
  preferredFamilies: TransitionFamily[];
  warpiness: number;
  symmetry: number;
  disruption: number;
  timingJitter: number;
  widthBias: number;
  potencyBias: number;
}

export interface HeroMotifProfile {
  key: string;
  intensityClass: HeroMotifIntensityClass;
  influenceKey: string;
  heroPrimitivePool: HeroPrimitiveKind[];
  fallbackHeroPrimitivePool: HeroPrimitiveKind[];
  emissionPrimitivePool?: HeroPrimitiveKind[];
  fillBias: HeroCoreFillMode;
  deformationBias: HeroDeformationMode;
  motionBias: "glide" | "tightrope" | "swerve" | "glitch-hop" | "ritual-orbit";
  edgeAttachmentBias: number;
  spinProfile: {
    gracefulSpin: number;
    glitchSpin: number;
    jerkStrength: number;
  };
  particleSpawnRegion: {
    x: number;
    y: number;
    xRange: number;
    yRange: number;
  };
  particleSizeBaseRange: {
    min: number;
    max: number;
  };
  particleSizeVarianceMode: "tight" | "medium" | "wide" | "extreme";
  particleExitTint: "white-bleach" | "warm-white" | "cool-white";
  colorProminence: {
    core: number;
    shell: number;
    particles: number;
  };
  variantAxes: {
    sizeBias: { min: number; max: number };
    speedBias: { min: number; max: number };
    fadeBias: { min: number; max: number };
    warpBias: { min: number; max: number };
    inconsistencyBias: { min: number; max: number };
    gravityBias: { min: number; max: number };
    densityBias: { min: number; max: number };
    dragBias: { min: number; max: number };
  };
  prominenceBias: {
    coreScale: number;
    coreAlpha: number;
    outlineAlpha: number;
    contrastLift: number;
    particleScale: number;
    particleSpeed: number;
    particleFade: number;
  };
  trailDurationMultiplier: number;
  spawnTimingMode: HeroSpawnTimingMode;
  nonSubEmitterParticleBias?: number;
  directSpawnLoci?: Array<"centerline" | "shell-rim" | "wake-tail" | "path-tangent" | "burst-origin">;
  clusterConfig: HeroClusterConfig;
  emissionTuning: HeroEmissionTuning;
  transitionBias: TransitionBiasProfile;
  warpProfile: {
    xBand: HeroExpandedBand;
    yBand: HeroExpandedBand;
    xBaseMultiplier: number;
    yBaseMultiplier: number;
    xExtremeMultiplier: number;
    yExtremeMultiplier: number;
  };
}

export interface HeroMotifVariant {
  key: string;
  sizeWeight: number;
  speedWeight: number;
  fadeWeight: number;
  warpWeight: number;
  inconsistencyWeight: number;
  gravityWeight: number;
  densityWeight: number;
  dragWeight: number;
}

export interface HeroShellLayerSpec {
  index: 0 | 1 | 2;
  band: HeroShellBand;
  style: HeroShellLayerStyle;
  radiusScale: number;
  alphaWeight: number;
  lineWidthScale: number;
  baseThreshold: number;
  targetTriggerRatio: number;
}

export interface HeroEmitterDirective {
  x: number;
  y: number;
  laneId?: string;
  relationshipRole?: HeroRelationshipRole;
  quadrant?: "tl" | "tr" | "bl" | "br" | "center";
  pathOffsetPhase?: number;
  rotation: number;
  spinVelocity: number;
  size: number;
  primitive: HeroPrimitiveKind;
  fillMode: HeroCoreFillMode;
  deformationMode: HeroDeformationMode;
  subEmitters: HeroSubEmitterDirective[];
  postShellMode: HeroPostShellMode;
  brightness: number;
  alpha: number;
}

export interface ImageStyleProfile {
  imagePath: string;
  firstPixelR: number;
  firstPixelG: number;
  firstPixelB: number;
  averageR: number;
  averageG: number;
  averageB: number;
  medianR: number;
  medianG: number;
  medianB: number;
  modeR: number;
  modeG: number;
  modeB: number;
  rangeR: number;
  rangeG: number;
  rangeB: number;
  averageHue: number;
  effectSeed: number;
  effectBucket: number;
  effectCycle: number;
  effectMode: number;
  transitionMode: number;
  dominantHue: number;
  hueVariance: number;
  saturationMean: number;
  lightnessMean: number;
  warmCoolBias: number;
  contrast: number;
  edgeDensity: number;
  symmetry: number;
  clusterCount: number;
  palette: string[];
  shapeBias: ShapeBias;
  particleBias: ParticleBias;
}

export interface ImageAsset {
  id: string;
  sourceUrl: string;
  localPath: string;
  width: number;
  height: number;
  styleProfile?: ImageStyleProfile;
}

export interface EdgePoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  strength: number;
}

export interface ContourPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  curvature: number;
}

export interface EdgeContour {
  points: ContourPoint[];
  strength: number;
  length: number;
  closed: boolean;
}

export interface EdgeMap {
  imagePath: string;
  points: EdgePoint[];
  contours: EdgeContour[];
  flowField: EdgeFlowField;
  densityField: EdgeDensityField;
  toneField: EdgeToneField;
  subjectMask: EdgeMaskField;
  silhouetteContours: EdgeContour[];
  spawners: EdgeSpawner[];
  regionAnchors: EdgeSpawner[];
  spatialBins: EdgeSpatialBins;
  focalCenterX: number;
  focalCenterY: number;
  focalSpread: number;
  leftWeight: number;
  rightWeight: number;
  topWeight: number;
  bottomWeight: number;
  subjectBounds: { minX: number; minY: number; maxX: number; maxY: number };
  negativeSpaceQuadrant: "tl" | "tr" | "bl" | "br" | "center";
  maskConfidence: "low" | "medium" | "high";
  fractalMotif: FractalMotif;
  width: number;
  height: number;
  complexity: number;
  styleProfile?: ImageStyleProfile;
}

export interface EdgeFlowField {
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  vectors: Float32Array;
  weights: Float32Array;
}

export interface EdgeDensityField {
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  values: Float32Array;
}

export interface EdgeToneField {
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  luminance: Float32Array;
  contrast: Float32Array;
}

export interface EdgeMaskField {
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  values: Float32Array;
}

export interface EdgeSpawner {
  x: number;
  y: number;
  radius: number;
  weight: number;
  tx: number;
  ty: number;
}

export interface EdgeSpatialBins {
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  pointBins: number[][];
  spawnerBins: number[][];
}

export interface RenderSettings {
  width: number;
  height: number;
  fps: number;
  format: OutputFormatPreset;
}

export interface HslaColor {
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
}

export interface NebulaRenderParams {
  vortexCenterX: number;
  vortexCenterY: number;
  vortexStrength: number;
  swirlStrength: number;
  noiseScale: number;
  noiseOctaves: number;
  plasmaDensity: number;
  sparkDensity: number;
  starDensity: number;
  edgeFieldStrength: number;
  contourSampleLimit: number;
  trailStepLimit: number;
  lightningSampleLimit: number;
  dustBudget: number;
  sparkBudget: number;
  starBudget: number;
}

export interface NebulaPalette {
  voidColor: string;
  coreCyan: string;
  tealGlow: string;
  purpleBody: string;
  magentaBody: string;
  orangeEdge: string;
  sparkWhite: string;
  sparkYellow: string;
}

export interface RenderTheme {
  dominantHz: number;
  dominantBand: DominantBand;
  rainbowHueOffset: number;
  paletteStops: string[];
  hueStops: number[];
  motionScale: number;
  densityScale: number;
  nebula: NebulaPalette;
  vortexBias: number;
  lightningHueOffset: number;
  shadowTint: string;
  lowBandColor: string;
  lowMidBandColor: string;
  midBandColor: string;
  highBandColor: string;
  styleProfile: ImageStyleProfile;
  styleMode: ShapeBias;
  particleMode: ParticleBias;
  basePalette: string[];
  basePaletteHsl: HslaColor[];
  imageWarmCoolBias: number;
  imageContrast: number;
  rawEffectMode: number;
  effectiveEffectMode: number;
  transitionMode: number;
}

export interface CompositionZone {
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
  kind: "negative-space" | "hero" | "support";
}

export interface PlacementSlot {
  x: number;
  y: number;
  radius: number;
  weight: number;
  layer: PlacementLayer;
  angle: number;
}

export interface CompositionPlan {
  imagePath: string;
  heroCenterX: number;
  heroCenterY: number;
  heroRadius: number;
  focalOccupancyScore: number;
  centerBiasScore: number;
  shotGrammarKey: string;
  supportSlots: PlacementSlot[];
  backgroundSlots: PlacementSlot[];
  protectedZones: CompositionZone[];
  heroContours: EdgeContour[];
  supportContours: EdgeContour[];
  bridgeAnchors: Array<{ x: number; y: number; weight: number }>;
  stylePlacementMode: StylePlacementMode;
  dustSlots: Array<{ x: number; y: number; radius: number; weight: number }>;
  starSlots: Array<{ x: number; y: number; weight: number }>;
}

export interface HeroResolvedInstanceLayout {
  index: number;
  anchorX: number;
  anchorY: number;
  radius: number;
  laneId: string;
  quadrant: "tl" | "tr" | "bl" | "br" | "center";
  relationshipRole: HeroRelationshipRole;
  pathOffsetPhase: number;
}

export interface HeroLayoutResolution {
  instances: HeroResolvedInstanceLayout[];
  layoutFamily: HeroLayoutFamily;
  baseSpreadPx: number;
  laneDiversityScore: number;
  expectedRelationshipMode: HeroRelationshipMode;
}

export interface TransitionBridgeState {
  fromImagePath: string;
  toImagePath: string;
  heroFrom: { x: number; y: number; radius: number };
  heroTo: { x: number; y: number; radius: number };
  supportFrom: PlacementSlot[];
  supportTo: PlacementSlot[];
  protectedZones: CompositionZone[];
  carryStrength: number;
}

export type TransitionCarryMode = "full" | "snapshot-only";

export type TransitionCarryReason =
  | "ok"
  | "outgoing-particles-depleted"
  | "missing-bridge-detail"
  | "missing-transition-graph";

export interface TransitionCarryProfile {
  mode: TransitionCarryMode;
  availabilityScore: number;
  reason: TransitionCarryReason;
  allowMorph: boolean;
  allowParticleDrivenFamily: boolean;
}

export interface HeroPathPoint {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
  radius: number;
}

export interface BackgroundPlan {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  colorStops: Array<{ offset: number; r: number; g: number; b: number; alpha: number }>;
  secondaryWash?: { x: number; y: number; radius: number; alpha: number };
  driftScale: number;
  backgroundElementId?: BackgroundElementId;
  backgroundElementFamily?: BackgroundElementFamily;
  motifAffinity?: number;
  renderMode?: "element-primary" | "gradient-only" | "nebula-fallback";
  pulseProfile?: BackgroundPulseProfile;
  hzColorRouting?: BackgroundHzColorRouting;
  continuityBlend?: number;
  geometryParams?: BackgroundGeometryParams;
  motionParams?: BackgroundElementMotionParams;
  layeringParams?: BackgroundLayeringParams;
  colorTuning?: BackgroundColorTuning;
  motionTuning?: BackgroundMotionTuning;
  interactionMode?: BackgroundInteractionMode;
  triggerMode?: BackgroundTriggerMode;
  imageResponseMode?: BackgroundImageResponseMode;
  familyVariant?: BackgroundFamilyVariant;
  heroCouplingStrength?: number;
  particleCouplingStrength?: number;
  triggerPhaseOffset?: number;
  triggerWindowFrames?: number;
  usesHeroParticles?: boolean;
  usesHeroPathPrediction?: boolean;
  fallbackNebulaEnabled?: boolean;
}

export interface ParticleBehaviorParams {
  mode: ParticleMotionMode;
  shape: ParticleShapeMode;
  targetA: number;
  targetB: number;
  orbitScale: number;
  driftScale: number;
  behaviorTuning?: {
    neighborRadius?: number;
    cohesion?: number;
    alignment?: number;
    separation?: number;
    linkRadius?: number;
    gravityStrength?: number;
    bounceDamping?: number;
    depthScale?: number;
    residueAlpha?: number;
    morphProfile?: "shard-to-teardrop" | "diamond-to-shard" | "voxel-to-dust";
  };
  script?: MotionScript;
  purpose?: OccupancyPurpose;
  layer?: PlacementLayer;
}

// A scene is every visual element currently built from one resolved source image.
// Scene-scoped state should change only when the resolved source image changes.
export interface SceneGraph {
  sceneKey?: SceneKey;
  imagePath: string;
  // Source motif is the structural motif classified from the source image.
  sourceMotif?: FractalMotif;
  // Resolved hero motif is the scheduled motif the renderer actually uses for hero identity.
  heroMotifScheduled?: FractalMotif;
  heroMotifSlotIndex?: number;
  heroMotifSlotStartSec?: number;
  heroMotifSlotEndSec?: number;
  heroMotifScheduleReason?: HeroMotifScheduleReason;
  heroMotifLockEnabled?: boolean;
  shotGrammarKey?: string;
  heroRelationshipClass?: HeroRelationshipClass;
  heroLayoutFamily?: HeroLayoutFamily;
  heroPath: HeroPathPoint[];
  heroOrbitRadius: number;
  heroPrimitive: HeroPrimitiveKind;
  heroPrimitiveFallback: HeroPrimitiveKind;
  heroSubEmitterFamily: ShapeFamilyToken;
  heroSubEmitterVariant: string;
  heroSubEmitterMotifAlignmentScore: number;
  heroShellMode: HeroPostShellMode;
  heroBaseShellMode: HeroPostShellMode;
  heroResolvedShellMode: HeroPostShellMode;
  heroCircleShellEligible: boolean;
  heroCircleShellPromoted: boolean;
  heroShellSceneEnabled: boolean;
  heroShellConfiguredCount: 0 | 1 | 2 | 3;
  heroShellColorMode: HeroShellColorMode;
  heroShellLayers: HeroShellLayerSpec[];
  heroConcreteBias: number;
  heroOutlineSuppression: number;
  heroEmitterOffsets: Array<{ x: number; y: number }>;
  heroInstanceSeed: HeroInstanceSeed;
  heroMotifProfile: HeroMotifProfile;
  heroMotifVariant: HeroMotifVariant;
  heroClusterConfig: HeroClusterConfig;
  heroEmissionTuning: HeroEmissionTuning;
  nebulaBandRouting: NebulaBandRouting;
  heroGlyphs: HeroGlyphKind[];
  heroArchetype: HeroArchetype;
  heroStoryBeat: GlyphStoryBeat;
  heroEmissionMode: HeroEmissionMode;
  subEmitterMode: SubEmitterMode;
  continuitySeed: number;
  heroGlyphGrammar: HeroGlyphGrammar;
  heroConductorSelection: HeroConductorSelection;
  heroConductorDensity: number;
  heroCircleEmitterNodeIndices: number[];
  heroExpandedBands: HeroExpandedBand[];
  nonSubEmitterHeroParticleBias: number;
  sourceAttractorProfile: SourceAttractorProfile;
  supportAttractors: PlacementSlot[];
  backgroundAttractors: PlacementSlot[];
  motifFamilySet: [StylePlacementMode, StylePlacementMode, StylePlacementMode];
  backgroundPlan: BackgroundPlan;
  particleBehaviors: ParticleBehaviorParams[];
  intentSeed: NodeIntentSeed;
  episodeSeed: EpisodeSeed;
  heroPriorityRadius: number;
  supportPriorityRadius: number;
  occupancyLingerFrames: number;
  heroVisibilityBias: number;
  supportAttractorRoles: string[];
  backgroundAttractorRoles: string[];
  occupancyPolicy: {
    heroAllowed: OccupancyPurpose[];
    supportAllowed: OccupancyPurpose[];
    backgroundAllowed: OccupancyPurpose[];
    suppressLowMotionBelow: number;
  };
  midScaleFamilies: ShapeFamilyToken[];
  emitterCandidateIndices: number[];
  absorberCandidateIndices: number[];
  persistentMotifId?: PersistentMotifId;
  persistentMotifInfluenceKey?: string;
  motifPhysicsProfile: MotifPhysicsProfile;
  heroPhysicsEnvelope: HeroPhysicsEnvelope;
  diagnosticPhysicsFamily: string;
  transitionIdentitySignature: string;
}

export interface AtmosphereEmitter {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  colorWeight: number;
  role: "hero" | "support" | "background";
}

export interface VeilStrip {
  points: Array<{ x: number; y: number }>;
  alpha: number;
  width: number;
  colorWeight: number;
}

export interface BridgeLattice {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  alpha: number;
  width: number;
  colorWeight: number;
  mode: BridgePattern;
}

export interface SymmetryZone {
  x: number;
  y: number;
  radius: number;
  mode: SymmetryMode;
  alpha: number;
}

export interface AtmosphereGraph {
  imagePath: string;
  emitters: AtmosphereEmitter[];
  veilStrips: VeilStrip[];
  bridgeLattices: BridgeLattice[];
  symmetryZones: SymmetryZone[];
  localGlowBudget: number;
  paletteWeights: number[];
  atmosphereDensity: number;
  midScaleCoverage: number;
}

export interface TransitionGraph {
  key: string;
  fromImagePath: string;
  toImagePath: string;
  heroBridge: HeroPathPoint[];
  supportPairs: Array<{ from: PlacementSlot; to: PlacementSlot }>;
  glyphBlend: { from: HeroGlyphKind[]; to: HeroGlyphKind[] };
  carryAttenuation: number;
  morphBias: number;
  motionGrammar?: string;
  accentCarry?: AccentEventMode;
  deterministicParams?: TransitionDeterministicParams;
}

export interface TransitionDeterministicParams {
  variant: number;
  sliceCount: number;
  sliceThickness: number;
  mirrorCount: number;
  warpAmplitude: number;
  rotationAmount: number;
  travelPx: number;
  flashAlphaScale: number;
  radialSliceCount?: number;
  noiseBand?: number;
  dispersionBias?: number;
  tunnelDepth?: number;
  panelGridCols?: number;
  panelGridRows?: number;
}

export interface ShapeStampKey {
  shape: ParticleShapeMode | HeroGlyphKind;
  sizeBucket: number;
  colorBucket: number;
  layer: PlacementLayer;
  purpose?: OccupancyPurpose | "hero-echo" | "trail";
  variant?: string;
  intent?: NodeIntent;
}

export interface RenderStageMetrics {
  backgroundMs: number;
  particlesMs: number;
  occupancyMs: number;
  atmosphereMs: number;
  effectsMs: number;
  transitionMs: number;
  heroMs: number;
  luminanceReadbackMs: number;
  luminanceReadbackMode?: "full" | "budget-gated";
  luminanceReadbackSampleInterval?: number;
  luminanceReadbackFramesSampled?: number;
  luminanceReadbackFramesSkipped?: number;
  luminanceReadbackMsSavedEstimate?: number;
  encoderReadbackMs: number;
  stampDrawCount: number;
  supportStampDrawCount: number;
  backgroundStampDrawCount: number;
  vectorDrawCount: number;
  occupancyDrawCount: number;
  heroGlyphDrawCount: number;
  veilDrawCount: number;
  bridgeDrawCount: number;
  localGlowDrawCount: number;
  gradientCreateCount: number;
  avgSupportMotionPx: number;
  avgBackgroundMotionPx: number;
}

export interface RenderQualityBudget {
  fastMode: boolean;
  effectPasses: 1 | 2 | 3;
  feedbackSlices: number;
  scanSliceHeight: number;
  fullFrameFeedbackAlpha: number;
  particleLimitScale: number;
  occupancyLimitScale: number;
  transitionDetailScale: number;
  budgetDowngradeCount: number;
  adaptiveDegradeLevel: number;
  transitionBudgetTier: "full" | "trimmed" | "minimal" | "fallback";
  transitionBudgetReason?: string;
  skipFullFrameFeedback: boolean;
  skipFeedbackTintPasses: boolean;
  skipOverlayExtras: boolean;
  skipFadeWash: boolean;
}

export interface VisualPhrasePlan {
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
  regime: VisualRegime;
  averageEnergy: number;
  peakiness: number;
  brightnessFloor: number;
  densityCap: number;
  motionMode: MotionMode;
  overlayMode: OverlayMode;
  transitionFamily: TransitionFamily;
  shotMode: ShotMode;
  effectPolicy: EffectPolicy;
  rescuePolicy: RescuePolicy;
  imageHoldMultiplier: number;
  effectiveImageHoldMultiplier: number;
  transientCutBias: number;
  rapidPeakDensity: number;
  transitionOpportunityBias: number;
  imageSwapAllowed: boolean;
  transitionTriggerPreference: "swap" | "hold" | "mixed";
  spawnArc: SpawnArc;
  spawnEnergyTier: SpawnEnergyTier;
  preferredCutFrame: number;
  transitionDurationMultiplier: number;
  transitionCarryBias: number;
  songVisualFamily: SongVisualFamily;
  phraseMotifFamily: PhraseMotifFamily;
  phraseTransitionCluster: PhraseTransitionCluster;
  phraseCompositionBias: PhraseCompositionBias;
  phraseHeroMotionBias: PhraseHeroMotionBias;
  phraseBackgroundResponseBias: PhraseBackgroundResponseBias;
  averageBandWeightedScore?: number;
  averageImpactBandScore?: number;
  averageTextureBandScore?: number;
  bandVolatility?: number;
  bandDominanceVector?: [number, number, number, number, number];
  lowRiseDensity?: number;
  midHighRiseDensity?: number;
  phraseContrastVsPrevious?: number;
  transientOpportunityFrames?: number[];
}

export interface VisualState {
  frameIndex: number;
  phraseIndex: number;
  phraseStartFrame: number;
  phraseEndFrame: number;
  phraseStartSec: number;
  phraseEndSec: number;
  regime: VisualRegime;
  brightnessFloor: number;
  densityCap: number;
  motionMode: MotionMode;
  overlayMode: OverlayMode;
  transitionFamily: TransitionFamily;
  shotMode: ShotMode;
  effectPolicy: EffectPolicy;
  rescuePolicy: RescuePolicy;
  imageHoldMultiplier: number;
  effectiveImageHoldMultiplier: number;
  transientCutBias: number;
  rapidPeakDensity: number;
  transitionOpportunityBias: number;
  imageSwapAllowed: boolean;
  transitionTriggerPreference: "swap" | "hold" | "mixed";
  spawnArc: SpawnArc;
  spawnEnergyTier: SpawnEnergyTier;
  preferredCutFrame: number;
  transitionDurationMultiplier: number;
  transitionCarryBias: number;
  persistentMotifId?: PersistentMotifId;
  persistentMotifLabel?: string;
  persistentMotifChangeGate?: "startup" | "transient-peak" | "forced-reset";
  persistentMotifAgeFrames?: number;
  outroEffectId?: OutroEffectId;
  outroEffectCategory?: OutroEffectCategory;
  outroEffectIntensity?: number;
  outroEffectImageSignature?: string;
  outroTerminalBurstProgress?: number;
}

export type TransitionTriggerMode = "swap" | "hold";

export interface VisualSafetyMetrics {
  luminance: number;
  trailingLuminance: number;
  framesBelowFloor: number;
  brightnessFloor: number;
  recoveryActive: boolean;
  safetyOverrideCount: number;
  recoveryOverrideFrameCount: number;
  recoveryOverrideFrameRatio: number;
  recoverySeverityScore: number;
  overlayModeUsed: OverlayMode;
  transitionFamilyUsed: TransitionFamily;
}

export interface ActiveSubjectTrailPoint {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

export interface ActiveSubjectState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  filteredTargetX: number;
  filteredTargetY: number;
  vx: number;
  vy: number;
  radius: number;
  emphasis: number;
  gesturePhase: number;
  mode: ActiveSubjectMode;
  gracefulBias?: number;
  glitchBias?: number;
  targetSmoothing?: number;
  moveScale?: number;
  emissionScale?: number;
  lowDbFreezeActive?: boolean;
  recentDbOverall?: number[];
  motionTier?: "jump" | "glide" | "flourish";
  flourishStrength?: number;
  jumpTriggered?: boolean;
  jitterSuppressed?: boolean;
  motionTierReadable?: boolean;
  jumpCooldownFrames?: number;
  lastJumpFrame?: number;
  lastJumpTargetEdge?: "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  flourishSpinPhase?: number;
  flourishTwirlPhase?: number;
  flourishBouncePhase?: number;
  trail: ActiveSubjectTrailPoint[];
  lastPeakFrame: number;
  lastBeatFrame: number;
}

export interface ActiveSubjectSnapshot {
  mode: ActiveSubjectMode;
  motionPx: number;
  emphasis: number;
  trailLength: number;
  x: number;
  y: number;
  motionTier?: "jump" | "glide" | "flourish";
  flourishStrength?: number;
  jumpTriggered?: boolean;
  jitterSuppressed?: boolean;
  motionTierReadable?: boolean;
  gracefulBias?: number;
  glitchBias?: number;
  targetSmoothing?: number;
  moveScale?: number;
  emissionScale?: number;
  lowDbFreezeActive?: boolean;
}

export interface ActiveRenderSelection {
  requestedImageIndex: number;
  resolvedImageIndex: number;
  segmentIndex: number;
  imagePath: string;
  themeImagePath: string;
}

export interface NebulaGlowAnchor {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: string;
  kind: "core" | "ridge" | "edge";
  weight: number;
}

export type ParticleAnchorType = "edge" | "silhouette" | "region";
export type ParticleMotionMode = "edge-drift" | "spiral-in" | "spiral-out" | "orbit-hero" | "dual-attractor" | "edge-escape" | "absorb-well" | "emit-chain" | "release-bloom" | "flock-curl" | "flow-advect" | "plexus-link" | "gravity-orrery" | "ribbon-trace" | "lifecycle-morph" | "shell-bounce" | "voxel-depth" | "paint-residue" | "lightning-latch" | "mirror-orbit" | "axis-reflect" | "kaleido-shear" | "paired-braid" | "prism-well";
export type ParticleShapeMode = "dot" | "ring" | "shard" | "chevron" | "diamond" | "arc" | "voxel";

export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  baseSize: number;
  currentSize: number;
  anchorType: ParticleAnchorType;
  targetX: number;
  targetY: number;
  tangentX: number;
  tangentY: number;
  edgeWeight: number;
  toneWeight: number;
  curvatureWeight: number;
  brightness: number;
  hueOffset: number;
  motionMode: ParticleMotionMode;
  shapeMode: ParticleShapeMode;
  phaseOffset: number;
  behaviorScript?: MotionScript;
  occupancyPurpose?: OccupancyPurpose;
}

export interface ParticleSystemState {
  count: number;
  capacity: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  age: Uint16Array;
  ttl: Uint16Array;
  baseSize: Float32Array;
  currentSize: Float32Array;
  anchorType: Uint8Array;
  targetX: Float32Array;
  targetY: Float32Array;
  tangentX: Float32Array;
  tangentY: Float32Array;
  edgeWeight: Float32Array;
  toneWeight: Float32Array;
  curvatureWeight: Float32Array;
  brightness: Float32Array;
  hueOffset: Float32Array;
  motionMode: Uint8Array;
  shapeMode: Uint8Array;
  phaseOffset: Float32Array;
  behaviorTargetA: Uint16Array;
  behaviorTargetB: Uint16Array;
  orbitScale: Float32Array;
  driftScale: Float32Array;
  neighborRadius: Float32Array;
  cohesion: Float32Array;
  alignment: Float32Array;
  separation: Float32Array;
  linkRadius: Float32Array;
  gravityStrength: Float32Array;
  bounceDamping: Float32Array;
  depthScale: Float32Array;
  residueAlpha: Float32Array;
  scratchAx: Float32Array;
  scratchAy: Float32Array;
  scratchDamping: Float32Array;
  scratchPulseScale: Float32Array;
  scratchRetarget: Uint8Array;
  edgeExitFramesRemaining: Uint8Array;
  edgeExitTargetX: Float32Array;
  edgeExitTargetY: Float32Array;
  edgeExitEffectIndex: Uint8Array;
  edgeExitPlayed: Uint8Array;
  edgeExitDistance: Float32Array;
  seed: number;
  lastFrameIndex: number;
  lastBeatIndex: number;
  cachedOccupancy: Array<{ x: number; y: number; weight: number; radius: number; layer: "hero" | "support" | "background" }>;
  cachedAnchors: NebulaGlowAnchor[];
  lastBudgetDowngradeCount: number;
}

export interface HeroSubjectPlan {
  centerX: number;
  centerY: number;
  radius: number;
  intensity: number;
  coverage: number;
}

export interface SupportingStructurePlan {
  centerX: number;
  centerY: number;
  radius: number;
  intensity: number;
}

export interface ShotComposition {
  mode: "establish" | "portrait" | "detail" | "climax";
  focalCenterX: number;
  focalCenterY: number;
  focalSpread: number;
  negativeSpaceQuadrant: "tl" | "tr" | "bl" | "br" | "center";
}

export interface RevealSchedule {
  revealPhase: number;
  heroResolved: boolean;
  detailResolved: boolean;
}

export interface RenderChunkJob {
  chunkIndex: number;
  outputPath: string;
  frames: AudioFrameFeature[];
  estimatedCost: number;
}

export interface RenderWorkerPayload {
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
  telemetryMode?: RenderTelemetryMode;
}

export interface RenderWorkerJobMessage {
  type: "render";
  chunk: RenderChunkJob;
  dispatchedAtMs: number;
}

export interface RenderWorkerShutdownMessage {
  type: "shutdown";
}

export type RenderWorkerControlMessage = RenderWorkerJobMessage | RenderWorkerShutdownMessage;

export interface RenderWorkerProgressMessage {
  type: "progress";
  chunkIndex: number;
  renderedFrames: number;
}

export interface RenderWorkerDoneMessage {
  type: "done";
  chunkIndex: number;
  outputPath: string;
  frameCount: number;
  elapsedMs: number;
  workerInitMs?: number;
  rendererConstructionMs?: number;
  firstFrameLatencyMs?: number;
  jobQueueWaitMs?: number;
  renderCpuMs?: number;
  encodeWaitMs?: number;
  stdinBackpressureMs?: number;
  encoderDrainWaitMs?: number;
  budgetDowngradeCount?: number;
  averageLuminance?: number;
  minLuminance?: number;
  blackFrameCount?: number;
  configuredWorkerCount?: number;
  averageStageMetrics?: RenderStageMetrics;
  imageWindows?: RenderImageWindowStat[];
}

export type RenderWorkerMessage = RenderWorkerProgressMessage | RenderWorkerDoneMessage;

export interface RenderChunkStat {
  chunkIndex: number;
  frameCount: number;
  elapsedMs: number;
  averageMsPerFrame: number;
  outputPath: string;
  workerInitMs?: number;
  rendererConstructionMs?: number;
  firstFrameLatencyMs?: number;
  jobQueueWaitMs?: number;
  renderCpuMs?: number;
  encodeWaitMs?: number;
  stdinBackpressureMs?: number;
  encoderDrainWaitMs?: number;
  budgetDowngradeCount?: number;
  averageLuminance?: number;
  minLuminance?: number;
  blackFrameCount?: number;
  configuredWorkerCount?: number;
  averageStageMetrics?: RenderStageMetrics;
  imageWindows?: RenderImageWindowStat[];
}

export interface RenderedFrame {
  rgba: Buffer;
  luminanceSample: number;
  darkestQuartileLuminance?: number;
  preEffectLuminanceSample?: number;
  blackFrame: boolean;
  sceneKey?: SceneKey;
  budgetDowngradeCount: number;
  luminanceReadbackMode?: "full" | "budget-gated";
  luminanceReadbackSampleInterval?: number;
  luminanceReadbackSkipped?: boolean;
  motifEffectId?: MotifEffectId;
  motifEffectSelectionReason?: string;
  persistentMotifId?: PersistentMotifId;
  persistentMotifLabel?: string;
  persistentMotifChanged?: boolean;
  persistentMotifCarryFrames?: number;
  eventSpecId?: EventSpecId;
  eventSpecLabel?: string;
  eventSelectionReason?: string;
  motifEffectPhenomenon?: PhysicalPhenomenonFamily;
  motifEffectAudioMode?: MotifEffectAudioMode;
  motifEffectIntensity?: number;
  heroWarpActive?: boolean;
  adaptiveDegradeLevel?: number;
  transitionBudgetTier?: "full" | "trimmed" | "minimal" | "fallback";
  transitionBudgetReason?: string;
  transitionCarryMode?: TransitionCarryMode;
  transitionCarryAvailabilityScore?: number;
  transitionCarryFallbackReason?: TransitionCarryReason;
  sourceAffinityAvg?: number;
  sourceAffinityHeroAvg?: number;
  sourceAffinitySupportAvg?: number;
  particleConvergenceScore?: number;
  subEmitterChildren?: number;
  stageMetrics?: RenderStageMetrics;
  heroTrailOccupancy?: number;
  heroWakeLengthPx?: number;
  heroBurstCount?: number;
  heroBurstChildren?: number;
  heroMotorJitter?: number;
  heroMotorThrust?: number;
  heroBurnPhase?: number;
  heroWakeTailAgeAvg?: number;
  heroWakeResetCount?: number;
  heroSpeedAvg?: number;
  heroSpeedPeak?: number;
  heroBaselineEmissionScale?: number;
  heroZeroDbRecovery?: number;
  motionTier?: "jump" | "glide" | "flourish";
  jumpTriggered?: boolean;
  flourishStrength?: number;
  screenEdgeAimBias?: number;
  streamCenterBiasDegrees?: number;
  reflectiveTransitionCount?: number;
  reflectiveTransitionUniqueCount?: number;
  heroBurstGateActiveRatio?: number;
  heroBurstCadenceSlotHits?: number;
  heroBurstTopQuartileRatio?: number;
  heroShellHueTravelAvg?: number;
  heroShellUnderlayActiveRatio?: number;
  mainHeroLowDbThrottle?: boolean;
  mainHeroFreezeActive?: boolean;
  heroScalePulseAvg?: number;
  heroScalePulsePeak?: number;
  motifPotencyScore?: number;
  transitionTriggerMode?: TransitionTriggerMode;
  heroMotifVariantKey?: string;
  heroVariantWarp?: number;
  heroVariantGravity?: number;
  heroVariantInconsistency?: number;
  heroParticleSizeAvg?: number;
  heroParticleTtlAvg?: number;
  heroConductorCount?: number;
  heroConductorType?: string;
  heroConductorInfluenceRadiusAvg?: number;
  heroCircleEmitterNodeCoverage?: number;
  heroExpandedBandCount?: number;
  heroRelationshipMode?: HeroRelationshipMode;
  heroRelationshipClass?: HeroRelationshipClass;
  heroLayoutFamily?: HeroLayoutFamily;
  heroInstanceCountResolved?: number;
  heroPairMinDistancePx?: number;
  heroPairAvgDistancePx?: number;
  heroOverlapRatio?: number;
  heroCoreOverlapRatio?: number;
  heroGlowMergeRatio?: number;
  heroLaneDiversityScore?: number;
  heroDistinctQuadrantCount?: number;
  heroRelationshipResolved?: HeroRelationshipMode;
  heroSeparationReadable?: boolean;
  heroSeparationFailureReason?: HeroSeparationFailureReason;
  shotGrammarKey?: string;
  focalOccupancyScore?: number;
  centerBiasScore?: number;
  transitionIdentitySignature?: string;
  transitionIdentityChanged?: boolean;
  motifChangedOnTransition?: boolean;
  heroChangedOnTransition?: boolean;
  quarterSpawnGuaranteeHitCount?: number;
  quarterSpawnGuaranteeMissCount?: number;
  overlayOpacityAvg?: number;
  overlayCompositeMode?: string;
  effectVisible?: boolean;
  effectVisiblePixelRatio?: number;
  effectMotionDelta?: number;
  framePostEffectId?: FramePostEffectId;
  framePostEffectIntensity?: number;
  focalQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  heroQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  brightestBlobQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  supportClusterCount?: number;
  supportNearHeroScore?: number;
  edgeHighlightPenalty?: number;
  edgeDominanceMargin?: number;
  deadCenterVoidScore?: number;
  focalReinforcementScore?: number;
  dbTransitionDrive?: number;
  bandWeightedTransitionDrive?: number;
  hzTransitionDrive?: number;
  audioTransitionScore?: number;
  holdPenalty?: number;
  swapPromotedByAudio?: boolean;
  audioSwapPromotionChance?: number;
  audioSwapPromotionExtraChance?: number;
  audioSwapNodeTriggerCount?: number;
  heroSwapEligible?: boolean;
  heroSwapSuppressedByGrace?: boolean;
  heroSwapAudioDrive?: number;
  backgroundElementId?: BackgroundElementId;
  backgroundSelectionReason?: string;
  particleConceptIds?: ParticleConceptId[];
  particleSelectionReason?: string;
  backgroundElementFamily?: BackgroundElementFamily;
  backgroundTriggerMode?: BackgroundTriggerMode;
  backgroundInteractionMode?: BackgroundInteractionMode;
  backgroundHeroCouplingStrength?: number;
  backgroundParticleCouplingStrength?: number;
  backgroundTriggeredThisFrame?: boolean;
  backgroundHeroInteractionActive?: boolean;
  backgroundTriggeredFrameRatio?: number;
  backgroundPeakColorEligible?: boolean;
  backgroundPeakColorDrive?: number;
  backgroundColorfulnessScale?: number;
  backgroundLuminosityLiftAvg?: number;
  backgroundMinorImpactDrive?: number;
  supportElementDensity?: number;
  backgroundElementDensity?: number;
  heroIsolationScore?: number;
  nearHeroEventDensity?: number;
  heroToSupportDistanceScore?: number;
  transitionBaseDurationFrames?: number;
  transitionCappedDurationFrames?: number;
  transitionCapLossFrames?: number;
  transitionRiskScore?: number;
  transitionCapCategory?: "full" | "trimmed" | "minimal" | "fallback";
  particleSpawnRequests?: number;
  particleRenderedCount?: number;
  particleCulledByLayerCap?: number;
  particleCulledByHeroProtection?: number;
  particleCulledByNegativeSpace?: number;
  particleCulledByImageProgress?: number;
  particleCulledBySkipNonHero?: number;
  particleOffscreenCount?: number;
  particleTooSmallToReadCount?: number;
  particleLowAlphaCount?: number;
  particleLowContrastCount?: number;
  particleVisibleCount?: number;
  particleVisibleRatio?: number;
  heroParticleRenderedCount?: number;
  supportParticleRenderedCount?: number;
  backgroundParticleRenderedCount?: number;
  subEmitterTriggerCount?: number;
  subEmitterChildSpawnedCount?: number;
  edgeDeathEligibleCount?: number;
  edgeDeathTriggeredCount?: number;
  edgeDeathPlayedCount?: number;
  edgeDeathSkippedByCostCount?: number;
  edgeDeathEffectId?: string;
  edgeDeathCostTier?: "low" | "medium" | "high";
  edgeExitFramesAvg?: number;
  edgeExitDistanceAvg?: number;
  recoveryMode?: RecoveryMode;
  fallbackRenderMode?: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery";
  fallbackReason?: FallbackReason;
  fallbackTriggerCount?: number;
  fallbackSeverity?: "none" | "light" | "full";
  compositionModeReason?: CompositionModeReason;
  particleTelemetryAvailable?: boolean;
  visibleFallbackRisk?: boolean;
  outroEffectId?: OutroEffectId;
  outroEffectCategory?: OutroEffectCategory;
  outroEffectAudioMode?: OutroEffectAudioMode;
  outroEffectIntensity?: number;
  outroEffectImageSignature?: string;
  outroCoverageEstimate?: number;
  outroHeroWarp?: number;
  terminalBurstProgress?: number;
}

export interface RenderImageWindowStat {
  imageIndex: number;
  sceneKey?: SceneKey;
  windowKey?: string;
  firstFrameIndex?: number;
  startSec?: number;
  endSec?: number;
  chunkIndex?: number;
  fastMode?: boolean;
  requestedImageIndex?: number;
  resolvedImageIndex?: number;
  themeImagePath?: string;
  frameCount: number;
  averageLuminance: number;
  darkestQuartileLuminance?: number;
  minLuminance: number;
  blackFrameCount: number;
  averageDbOverall?: number;
  averagePulseScale?: number;
  luminanceCorrelation?: number;
  subjectMaskCoverage?: number;
  heroCoverage?: number;
  backgroundClutterRatio?: number;
  motif?: string;
  sourceMotif?: FractalMotif;
  heroMotifResolved?: string;
  heroMotifScheduled?: FractalMotif;
  heroMotifSlotIndex?: number;
  heroMotifSlotStartSec?: number;
  heroMotifSlotEndSec?: number;
  heroMotifScheduleReason?: HeroMotifScheduleReason;
  heroMotifChangedOnSlotBoundary?: boolean;
  heroMotifChangedOutsideSlot?: boolean;
  heroMotifScheduleMismatch?: boolean;
  persistentMotifId?: PersistentMotifId;
  persistentMotifLabel?: string;
  persistentMotifCarryFrames?: number;
  persistentMotifChanged?: boolean;
  motifEffectId?: MotifEffectId;
  motifEffectSelectionReason?: string;
  motifEffectPhenomenon?: PhysicalPhenomenonFamily;
  motifEffectAudioMode?: MotifEffectAudioMode;
  motifEffectIntensity?: number;
  outroEffectId?: OutroEffectId;
  outroEffectCategory?: OutroEffectCategory;
  outroEffectAudioMode?: OutroEffectAudioMode;
  outroEffectIntensity?: number;
  outroEffectImageSignature?: string;
  outroCoverageEstimate?: number;
  outroHeroWarp?: number;
  terminalBurstProgress?: number;
  heroWarpActive?: boolean;
  maskConfidence?: string;
  visualRegime?: VisualRegime;
  overlayMode?: OverlayMode;
  transitionFamily?: TransitionFamily;
  brightnessFloor?: number;
  safetyOverrideCount?: number;
  recoveryTriggered?: boolean;
  recoveryOverrideFrameCount?: number;
  recoveryOverrideFrameRatio?: number;
  recoverySeverityScore?: number;
  recoveryActiveAny?: boolean;
  activeMode?: ActiveSubjectMode;
  averageActiveMotionPx?: number;
  averageActiveEmphasis?: number;
  negativeSpaceOccupancy?: number;
  supportCoverage?: number;
  transitionAvgDurationFrames?: number;
  transitionCarryStrength?: number;
  transitionCarryMode?: TransitionCarryMode;
  transitionCarryAvailabilityScore?: number;
  transitionCarryFallbackReason?: TransitionCarryReason;
  compositionMode?: StylePlacementMode;
  shapePlacementScore?: number;
  averageSupportMotionPx?: number;
  averageBackgroundMotionPx?: number;
  atmosphereDensity?: number;
  midScaleCoverage?: number;
  symmetryUsage?: number;
  nodeIntent?: NodeIntent;
  episodeIntent?: EpisodeIntent;
  eventDensity?: number;
  eventSpecId?: EventSpecId;
  eventSpecLabel?: string;
  eventSelectionReason?: string;
  emitterUsage?: number;
  absorberUsage?: number;
  explosionCount?: number;
  heroArchetype?: HeroArchetype;
  heroStoryBeat?: GlyphStoryBeat;
  heroEmissionMode?: HeroEmissionMode;
  subEmitterMode?: SubEmitterMode;
  sourceAffinityAvg?: number;
  sourceAffinityHeroAvg?: number;
  sourceAffinitySupportAvg?: number;
  particleConvergenceScore?: number;
  subEmitterChildren?: number;
  heroEchoCount?: number;
  heroGlyphComplexity?: number;
  heroPrimitive?: HeroPrimitiveKind;
  heroShellMode?: HeroPostShellMode;
  heroBaseShellMode?: HeroPostShellMode;
  heroResolvedShellMode?: HeroPostShellMode;
  heroCircleShellEligible?: boolean;
  heroCircleShellPromoted?: boolean;
  heroShellSceneEnabled?: boolean;
  heroShellConfiguredCount?: 0 | 1 | 2 | 3;
  heroShellColorMode?: HeroShellColorMode;
  heroShellActiveCountAvg?: number;
  heroShellActivationDriverBand?: HeroShellBand;
  heroShellTriggerRateLow?: number;
  heroShellTriggerRateLowMid?: number;
  heroShellTriggerRateLowComposite?: number;
  heroShellThresholdLowAvg?: number;
  heroShellThresholdLowMidAvg?: number;
  heroShellThresholdLowCompositeAvg?: number;
  heroShellTriggerRateHighMid?: number;
  heroShellTriggerRateHigh?: number;
  heroShellTriggerRateUpper?: number;
  heroShellThresholdHighMidAvg?: number;
  heroShellThresholdHighAvg?: number;
  heroShellThresholdUpperAvg?: number;
  heroSubEmitterCount?: number;
  heroCoreSize?: number;
  heroCoreFillMode?: HeroCoreFillMode;
  heroOutlineRatio?: number;
  heroPrimitiveComplexity?: number;
  heroChildEmissionRate?: number;
  heroChildFieldDensity?: number;
  heroChildFieldRadius?: number;
  heroTrailOccupancy?: number;
  heroWakeLengthPx?: number;
  heroBurstCount?: number;
  heroBurstChildren?: number;
  heroMotorJitter?: number;
  heroMotorThrust?: number;
  heroBurnPhase?: number;
  heroWakeTailAgeAvg?: number;
  heroWakeResetCount?: number;
  heroSpeedAvg?: number;
  heroSpeedPeak?: number;
  heroBaselineEmissionScale?: number;
  heroZeroDbRecovery?: number;
  mainHeroLowDbThrottleRatio?: number;
  mainHeroFreezeFrameRatio?: number;
  heroScalePulseAvg?: number;
  heroScalePulsePeak?: number;
  motifPotencyScore?: number;
  transientCutRate?: number;
  steadyCutRate?: number;
  transitionTriggerMode?: TransitionTriggerMode;
  heldTransitionCount?: number;
  swapTransitionCount?: number;
  heldTransitionRatio?: number;
  diagnosticTargetType?: DiagnosticTargetType;
  diagnosticTargetId?: string;
  motifPhysicsProfile?: string;
  visualScore?: number;
  responsivenessScore?: number;
  failingChecks?: string[];
  heroShellInnerAlpha?: number;
  heroShellOuterAlpha?: number;
  heroBandLowUsage?: number;
  heroBandMidUsage?: number;
  heroBandHighUsage?: number;
  heroEmitterTopology?: string;
  heroInstanceVariant?: string;
  heroContrastBowlUsed?: boolean;
  heroTravelGracefulBias?: number;
  heroTravelGlitchBias?: number;
  heroTargetSmoothing?: number;
  heroSpinVelocity?: number;
  motionTier?: "jump" | "glide" | "flourish";
  jumpTriggered?: boolean;
  jitterSuppressed?: boolean;
  motionTierReadable?: boolean;
  flourishStrength?: number;
  screenEdgeAimBias?: number;
  streamCenterBiasDegrees?: number;
  centerwardEmissionRatio?: number;
  edgePressureActiveFrameRatio?: number;
  reflectiveTransitionCount?: number;
  reflectiveTransitionUniqueCount?: number;
  heroBurstGateActiveRatio?: number;
  heroBurstCadenceSlotHits?: number;
  heroBurstTopQuartileRatio?: number;
  heroShellHueTravelAvg?: number;
  heroShellUnderlayActiveRatio?: number;
  heroSpawnRegion?: string;
  heroParticleExitWhiteBias?: number;
  heroParticleSizeVariance?: string;
  heroColorProminence?: string;
  motifInfluenceKey?: string;
  transitionMotionGrammar?: string;
  heroMotionBias?: string;
  heroMotifProfile?: string;
  heroMotifVariantKey?: string;
  heroVariantWarp?: number;
  heroVariantGravity?: number;
  heroVariantInconsistency?: number;
  heroParticleSizeAvg?: number;
  heroParticleTtlAvg?: number;
  heroConductorCount?: number;
  heroConductorType?: string;
  heroConductorInfluenceRadiusAvg?: number;
  heroCircleEmitterNodeCoverage?: number;
  heroExpandedBandCount?: number;
  edgeAttractionScale?: number;
  heroRelationshipMode?: HeroRelationshipMode;
  heroRelationshipClass?: HeroRelationshipClass;
  heroLayoutFamily?: HeroLayoutFamily;
  heroInstanceCountResolved?: number;
  heroPairMinDistancePx?: number;
  heroPairAvgDistancePx?: number;
  heroOverlapRatio?: number;
  heroCoreOverlapRatio?: number;
  heroGlowMergeRatio?: number;
  heroLaneDiversityScore?: number;
  heroDistinctQuadrantCount?: number;
  heroRelationshipResolved?: HeroRelationshipMode;
  heroSeparationReadable?: boolean;
  heroSeparationFailureReason?: HeroSeparationFailureReason;
  shotGrammarKey?: string;
  focalOccupancyScore?: number;
  centerBiasScore?: number;
  adaptiveDegradeLevel?: number;
  transitionBudgetTier?: "full" | "trimmed" | "minimal" | "fallback";
  transitionBudgetReason?: string;
  transitionIdentitySignature?: string;
  transitionIdentityChanged?: boolean;
  motifChangedOnTransition?: boolean;
  heroChangedOnTransition?: boolean;
  quarterSpawnGuaranteeHitCount?: number;
  quarterSpawnGuaranteeMissCount?: number;
  diagnosticCompleteness?: "complete" | "missing-stats";
  diagnosticMissingFields?: string[];
  diagnosticFailureReason?: RenderDiagnosticFailureReason;
  effectVisibleFrameRatio?: number;
  effectVisiblePixelRatioAvg?: number;
  effectLuminanceDeltaAvg?: number;
  effectMotionDeltaAvg?: number;
  overlayOpacityAvg?: number;
  overlayCompositeMode?: string;
  effectVisibilityScore?: number;
  focalQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  heroQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  brightestBlobQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
  supportClusterCount?: number;
  supportNearHeroScore?: number;
  edgeHighlightPenalty?: number;
  edgeDominanceMargin?: number;
  deadCenterVoidScore?: number;
  focalReinforcementScore?: number;
  dbTransitionDrive?: number;
  bandWeightedTransitionDrive?: number;
  hzTransitionDrive?: number;
  audioTransitionScore?: number;
  holdPenalty?: number;
  swapPromotedByAudio?: boolean;
  audioSwapPromotionChance?: number;
  audioSwapPromotionExtraChance?: number;
  audioSwapNodeTriggerCount?: number;
  heroSwapEligible?: boolean;
  heroSwapSuppressedByGrace?: boolean;
  heroSwapAudioDrive?: number;
  backgroundElementId?: BackgroundElementId;
  backgroundElementFamily?: BackgroundElementFamily;
  backgroundTriggerMode?: BackgroundTriggerMode;
  backgroundInteractionMode?: BackgroundInteractionMode;
  backgroundHeroCouplingStrength?: number;
  backgroundParticleCouplingStrength?: number;
  backgroundTriggeredThisFrame?: boolean;
  backgroundHeroInteractionActive?: boolean;
  backgroundTriggeredFrameRatio?: number;
  backgroundPeakColorEligible?: boolean;
  backgroundPeakColorDrive?: number;
  backgroundColorfulnessScale?: number;
  backgroundLuminosityLiftAvg?: number;
  backgroundMinorImpactDrive?: number;
  supportElementDensity?: number;
  backgroundElementDensity?: number;
  heroIsolationScore?: number;
  nearHeroEventDensity?: number;
  heroToSupportDistanceScore?: number;
  transitionBaseDurationFrames?: number;
  transitionCappedDurationFrames?: number;
  transitionCapLossFrames?: number;
  transitionRiskScore?: number;
  transitionCapCategory?: "full" | "trimmed" | "minimal" | "fallback";
  particleSpawnRequests?: number;
  particleRenderedCount?: number;
  particleCulledByLayerCap?: number;
  particleCulledByHeroProtection?: number;
  particleCulledByNegativeSpace?: number;
  particleCulledByImageProgress?: number;
  particleCulledBySkipNonHero?: number;
  particleOffscreenCount?: number;
  particleTooSmallToReadCount?: number;
  particleLowAlphaCount?: number;
  particleLowContrastCount?: number;
  particleVisibleCount?: number;
  particleVisibleRatio?: number;
  heroParticleRenderedCount?: number;
  supportParticleRenderedCount?: number;
  backgroundParticleRenderedCount?: number;
  subEmitterTriggerCount?: number;
  subEmitterChildSpawnedCount?: number;
  edgeDeathEligibleCount?: number;
  edgeDeathTriggeredCount?: number;
  edgeDeathPlayedCount?: number;
  edgeDeathSkippedByCostCount?: number;
  edgeDeathEffectId?: string;
  edgeDeathCostTier?: "low" | "medium" | "high";
  edgeExitFramesAvg?: number;
  edgeExitDistanceAvg?: number;
  heroSubEmitterFamily?: ShapeFamilyToken;
  heroSubEmitterVariant?: string;
  heroSubEmitterMotifAlignmentScore?: number;
  recoveryMode?: RecoveryMode;
  fallbackRenderMode?: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery";
  fallbackReason?: FallbackReason;
  fallbackTriggerCount?: number;
  fallbackSeverity?: "none" | "light" | "full";
  compositionModeReason?: CompositionModeReason;
  particleTelemetryAvailable?: boolean;
  visibleFallbackRisk?: boolean;
  warningFlags?: string[];
}

export interface StageTiming {
  name: string;
  elapsedMs: number;
}

export interface DebugReport {
  outputPath: string;
  imageDebugDir?: string;
  fastMode?: boolean;
  themeImageCacheHits?: number;
  themeImageCacheMisses?: number;
  themeImageRemoteDownloads?: number;
  runStatus: "success" | "failure";
  failureStage?: CliStage;
  failureMessage?: string;
  failureStack?: string;
  lastCompletedStage?: CliStage;
  statusLog?: CliStatusLogEntry[];
  artifacts?: {
    chunkPaths?: string[];
    videoOnlyPath?: string;
    finalOutputExists?: boolean;
    debugReportPath?: string;
  };
  stageTimings: StageTiming[];
  totalElapsedMs: number;
  encoderPreset: string;
  sourceAudioPath: string;
  trimmedAudioPath?: string;
  sourceMetadataBpm?: number;
  trimmedMetadataBpm?: number;
  estimatedBpm?: number;
  chosenBpm: number;
  bpmSource: BpmSource;
  bpmTrustState?: BpmTrustState;
  beatOriginSec?: number;
  beatOriginConfidence?: number;
  beatOriginSource?: BeatOriginSource;
  anchorTrustState?: AnchorTrustState;
  anchorSearchStartSec?: number;
  anchorSearchEndSec?: number;
  anchorCandidateCount?: number;
  anchorSupportHitCount?: number;
  anchorTopCandidates?: Array<{
    timeSec: number;
    score: number;
    confidence: number;
    supportHits: number;
  }>;
  cleanup?: CleanupTempResult;
  renderChunks: RenderChunkStat[];
  effects: Array<{
    imageIndex: number;
    windowKey?: string;
    sceneKey?: SceneKey;
    fastMode?: boolean;
    requestedImageIndex?: number;
    resolvedImageIndex?: number;
    imagePath: string;
    themeImagePath?: string;
    referenceImagePath?: string;
    quarterFramePath?: string;
    middleFramePath?: string;
    threeQuarterFramePath?: string;
    startSec: number;
    endSec: number;
    chunkIndex: number;
    firstPixelR: number;
    firstPixelG: number;
    firstPixelB: number;
    averageR?: number;
    averageG?: number;
    averageB?: number;
    effectSeed: number;
    effectBucket: number;
    effectCycle: number;
    transitionMode: number;
    rawEffectMode: number;
    effectiveEffectMode: number;
    averageLuminance?: number;
    minLuminance?: number;
    blackFrameCount?: number;
    blackFrameRatio?: number;
    averageDbOverall?: number;
    averagePulseScale?: number;
    subjectMaskCoverage?: number;
    heroCoverage?: number;
    backgroundClutterRatio?: number;
    motif?: string;
    sourceMotif?: FractalMotif;
    heroMotifResolved?: string;
    heroMotifScheduled?: FractalMotif;
    heroMotifSlotIndex?: number;
    heroMotifSlotStartSec?: number;
    heroMotifSlotEndSec?: number;
    heroMotifScheduleReason?: HeroMotifScheduleReason;
    heroMotifChangedOnSlotBoundary?: boolean;
    heroMotifChangedOutsideSlot?: boolean;
    heroMotifScheduleMismatch?: boolean;
    persistentMotifId?: PersistentMotifId;
    persistentMotifLabel?: string;
    persistentMotifCarryFrames?: number;
    persistentMotifChanged?: boolean;
    motifEffectId?: MotifEffectId;
    motifEffectSelectionReason?: string;
    motifEffectPhenomenon?: PhysicalPhenomenonFamily;
    motifEffectAudioMode?: MotifEffectAudioMode;
    motifEffectIntensity?: number;
    outroEffectId?: OutroEffectId;
    outroEffectCategory?: OutroEffectCategory;
    outroEffectAudioMode?: OutroEffectAudioMode;
    outroEffectIntensity?: number;
    outroEffectImageSignature?: string;
    outroCoverageEstimate?: number;
    outroHeroWarp?: number;
    terminalBurstProgress?: number;
    heroWarpActive?: boolean;
    maskConfidence?: string;
    visualRegime?: VisualRegime;
    overlayMode?: OverlayMode;
    transitionFamily?: TransitionFamily;
    brightnessFloor?: number;
    safetyOverrideCount?: number;
    recoveryTriggered?: boolean;
    recoveryOverrideFrameCount?: number;
    recoveryOverrideFrameRatio?: number;
    recoverySeverityScore?: number;
    recoveryActiveAny?: boolean;
    activeMode?: ActiveSubjectMode;
    averageActiveMotionPx?: number;
    averageActiveEmphasis?: number;
  negativeSpaceOccupancy?: number;
  supportCoverage?: number;
  transitionAvgDurationFrames?: number;
  transitionCarryStrength?: number;
  transitionCarryMode?: TransitionCarryMode;
  transitionCarryAvailabilityScore?: number;
  transitionCarryFallbackReason?: TransitionCarryReason;
  compositionMode?: StylePlacementMode;
    shapePlacementScore?: number;
    averageSupportMotionPx?: number;
    averageBackgroundMotionPx?: number;
    atmosphereDensity?: number;
    midScaleCoverage?: number;
    symmetryUsage?: number;
    nodeIntent?: NodeIntent;
    episodeIntent?: EpisodeIntent;
    eventDensity?: number;
    eventSpecId?: EventSpecId;
    eventSpecLabel?: string;
    eventSelectionReason?: string;
    emitterUsage?: number;
    absorberUsage?: number;
    explosionCount?: number;
    heroArchetype?: HeroArchetype;
    heroStoryBeat?: GlyphStoryBeat;
    heroEmissionMode?: HeroEmissionMode;
    subEmitterMode?: SubEmitterMode;
    sourceAffinityAvg?: number;
    sourceAffinityHeroAvg?: number;
    sourceAffinitySupportAvg?: number;
    particleConvergenceScore?: number;
    subEmitterChildren?: number;
    heroEchoCount?: number;
    heroGlyphComplexity?: number;
    heroPrimitive?: HeroPrimitiveKind;
    heroShellMode?: HeroPostShellMode;
    heroBaseShellMode?: HeroPostShellMode;
    heroResolvedShellMode?: HeroPostShellMode;
    heroCircleShellEligible?: boolean;
    heroCircleShellPromoted?: boolean;
    heroShellSceneEnabled?: boolean;
    heroShellConfiguredCount?: 0 | 1 | 2 | 3;
    heroShellColorMode?: HeroShellColorMode;
    heroShellActiveCountAvg?: number;
    heroShellActivationDriverBand?: HeroShellBand;
    heroShellTriggerRateLow?: number;
    heroShellTriggerRateLowMid?: number;
    heroShellTriggerRateLowComposite?: number;
    heroShellThresholdLowAvg?: number;
    heroShellThresholdLowMidAvg?: number;
    heroShellThresholdLowCompositeAvg?: number;
    heroShellTriggerRateHighMid?: number;
    heroShellTriggerRateHigh?: number;
    heroShellTriggerRateUpper?: number;
    heroShellThresholdHighMidAvg?: number;
    heroShellThresholdHighAvg?: number;
    heroShellThresholdUpperAvg?: number;
    heroSubEmitterCount?: number;
    heroCoreSize?: number;
    heroCoreFillMode?: HeroCoreFillMode;
    heroOutlineRatio?: number;
    heroPrimitiveComplexity?: number;
    heroChildEmissionRate?: number;
    heroChildFieldDensity?: number;
    heroChildFieldRadius?: number;
    heroTrailOccupancy?: number;
    heroWakeLengthPx?: number;
    heroBurstCount?: number;
    heroBurstChildren?: number;
    heroMotorJitter?: number;
    heroMotorThrust?: number;
    heroBurnPhase?: number;
    heroWakeTailAgeAvg?: number;
    heroWakeResetCount?: number;
    heroSpeedAvg?: number;
    heroSpeedPeak?: number;
    heroBaselineEmissionScale?: number;
    heroZeroDbRecovery?: number;
    heroScalePulseAvg?: number;
    heroScalePulsePeak?: number;
    motifPotencyScore?: number;
    transientCutRate?: number;
    steadyCutRate?: number;
    transitionTriggerMode?: TransitionTriggerMode;
    heldTransitionCount?: number;
    swapTransitionCount?: number;
    heldTransitionRatio?: number;
    diagnosticTargetType?: DiagnosticTargetType;
    diagnosticTargetId?: string;
    motifPhysicsProfile?: string;
    visualScore?: number;
    responsivenessScore?: number;
    failingChecks?: string[];
    heroShellInnerAlpha?: number;
    heroShellOuterAlpha?: number;
    heroBandLowUsage?: number;
    heroBandMidUsage?: number;
    heroBandHighUsage?: number;
    heroEmitterTopology?: string;
    heroInstanceVariant?: string;
    heroContrastBowlUsed?: boolean;
    heroTravelGracefulBias?: number;
    heroTravelGlitchBias?: number;
    heroTargetSmoothing?: number;
    heroSpinVelocity?: number;
    motionTier?: "jump" | "glide" | "flourish";
    jumpTriggered?: boolean;
    jitterSuppressed?: boolean;
    motionTierReadable?: boolean;
    flourishStrength?: number;
    screenEdgeAimBias?: number;
    streamCenterBiasDegrees?: number;
    centerwardEmissionRatio?: number;
    edgePressureActiveFrameRatio?: number;
    reflectiveTransitionCount?: number;
    reflectiveTransitionUniqueCount?: number;
    heroBurstGateActiveRatio?: number;
    heroBurstCadenceSlotHits?: number;
    heroBurstTopQuartileRatio?: number;
    heroShellHueTravelAvg?: number;
    heroShellUnderlayActiveRatio?: number;
    heroSpawnRegion?: string;
    heroParticleExitWhiteBias?: number;
    heroParticleSizeVariance?: string;
    heroColorProminence?: string;
    motifInfluenceKey?: string;
    transitionMotionGrammar?: string;
    heroMotionBias?: string;
    heroMotifProfile?: string;
    heroMotifVariantKey?: string;
    heroVariantWarp?: number;
    heroVariantGravity?: number;
    heroVariantInconsistency?: number;
    heroParticleSizeAvg?: number;
    heroParticleTtlAvg?: number;
    heroConductorCount?: number;
    heroConductorType?: string;
    heroConductorInfluenceRadiusAvg?: number;
    heroCircleEmitterNodeCoverage?: number;
    heroExpandedBandCount?: number;
    heroLayoutFamily?: HeroLayoutFamily;
    heroInstanceCountResolved?: number;
    heroPairMinDistancePx?: number;
    heroPairAvgDistancePx?: number;
    heroOverlapRatio?: number;
    heroCoreOverlapRatio?: number;
    heroGlowMergeRatio?: number;
    heroLaneDiversityScore?: number;
    heroDistinctQuadrantCount?: number;
    focalOccupancyScore?: number;
    centerBiasScore?: number;
    adaptiveDegradeLevel?: number;
    transitionBudgetTier?: "full" | "trimmed" | "minimal" | "fallback";
    transitionBudgetReason?: string;
    heroRelationshipMode?: HeroRelationshipMode;
    heroRelationshipClass?: HeroRelationshipClass;
    heroRelationshipResolved?: HeroRelationshipMode;
    heroSeparationReadable?: boolean;
    heroSeparationFailureReason?: HeroSeparationFailureReason;
    shotGrammarKey?: string;
    transitionIdentitySignature?: string;
    transitionIdentityChanged?: boolean;
    motifChangedOnTransition?: boolean;
    heroChangedOnTransition?: boolean;
    quarterSpawnGuaranteeHitCount?: number;
    quarterSpawnGuaranteeMissCount?: number;
    edgeAttractionScale?: number;
    diagnosticCompleteness?: "complete" | "missing-stats";
    diagnosticMissingFields?: string[];
    diagnosticFailureReason?: RenderDiagnosticFailureReason;
    effectVisibleFrameRatio?: number;
    effectVisiblePixelRatioAvg?: number;
    effectLuminanceDeltaAvg?: number;
    effectMotionDeltaAvg?: number;
    overlayOpacityAvg?: number;
    overlayCompositeMode?: string;
    effectVisibilityScore?: number;
    suspiciousNearBlack?: boolean;
    focalQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
    heroQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
    brightestBlobQuadrant?: "tl" | "tr" | "bl" | "br" | "center";
    supportClusterCount?: number;
    supportNearHeroScore?: number;
    edgeHighlightPenalty?: number;
    edgeDominanceMargin?: number;
    deadCenterVoidScore?: number;
    focalReinforcementScore?: number;
    dbTransitionDrive?: number;
    bandWeightedTransitionDrive?: number;
    hzTransitionDrive?: number;
    audioTransitionScore?: number;
    holdPenalty?: number;
    swapPromotedByAudio?: boolean;
    audioSwapPromotionChance?: number;
    audioSwapPromotionExtraChance?: number;
    audioSwapNodeTriggerCount?: number;
    heroSwapEligible?: boolean;
    heroSwapSuppressedByGrace?: boolean;
    heroSwapAudioDrive?: number;
    backgroundElementId?: BackgroundElementId;
    backgroundSelectionReason?: string;
    particleConceptIds?: ParticleConceptId[];
    particleSelectionReason?: string;
    backgroundElementFamily?: BackgroundElementFamily;
    backgroundTriggerMode?: BackgroundTriggerMode;
    backgroundInteractionMode?: BackgroundInteractionMode;
    backgroundHeroCouplingStrength?: number;
    backgroundParticleCouplingStrength?: number;
    backgroundTriggeredThisFrame?: boolean;
    backgroundHeroInteractionActive?: boolean;
    backgroundTriggeredFrameRatio?: number;
    backgroundPeakColorEligible?: boolean;
    backgroundPeakColorDrive?: number;
    backgroundColorfulnessScale?: number;
    backgroundLuminosityLiftAvg?: number;
    backgroundMinorImpactDrive?: number;
    supportElementDensity?: number;
    backgroundElementDensity?: number;
    heroIsolationScore?: number;
    nearHeroEventDensity?: number;
    heroToSupportDistanceScore?: number;
    transitionBaseDurationFrames?: number;
    transitionCappedDurationFrames?: number;
    transitionCapLossFrames?: number;
    transitionRiskScore?: number;
    transitionCapCategory?: "full" | "trimmed" | "minimal" | "fallback";
    particleSpawnRequests?: number;
    particleRenderedCount?: number;
    particleCulledByLayerCap?: number;
    particleCulledByHeroProtection?: number;
    particleCulledByNegativeSpace?: number;
    particleCulledByImageProgress?: number;
    particleCulledBySkipNonHero?: number;
    particleOffscreenCount?: number;
    particleTooSmallToReadCount?: number;
    particleLowAlphaCount?: number;
    particleLowContrastCount?: number;
    particleVisibleCount?: number;
    particleVisibleRatio?: number;
    heroParticleRenderedCount?: number;
    supportParticleRenderedCount?: number;
    backgroundParticleRenderedCount?: number;
    subEmitterTriggerCount?: number;
    subEmitterChildSpawnedCount?: number;
    edgeDeathEligibleCount?: number;
    edgeDeathTriggeredCount?: number;
    edgeDeathPlayedCount?: number;
    edgeDeathSkippedByCostCount?: number;
    edgeDeathEffectId?: string;
    edgeDeathCostTier?: "low" | "medium" | "high";
    edgeExitFramesAvg?: number;
    edgeExitDistanceAvg?: number;
    heroSubEmitterFamily?: ShapeFamilyToken;
    heroSubEmitterVariant?: string;
    heroSubEmitterMotifAlignmentScore?: number;
    recoveryMode?: RecoveryMode;
    fallbackRenderMode?: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery";
    fallbackReason?: FallbackReason;
    fallbackTriggerCount?: number;
    fallbackSeverity?: "none" | "light" | "full";
    compositionModeReason?: CompositionModeReason;
    particleTelemetryAvailable?: boolean;
    visibleFallbackRisk?: boolean;
    bpmTrustState?: BpmTrustState;
    anchorTrustState?: AnchorTrustState;
    warningFlags?: string[];
  }>;
}
