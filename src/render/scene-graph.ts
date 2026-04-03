import { clamp } from "../config";
import { classifyHeroMotifIntensity } from "../types";
import type {
  AccentEventMode,
  BackgroundPlan,
  CompositionPlan,
  EdgeMap,
  EpisodeIntent,
  EpisodeSeed,
  FractalMotif,
  GlyphStoryBeat,
  HeroArchetype,
  HeroEmissionMode,
  HeroGlyphGrammar,
  HeroGlyphKind,
  HeroInstanceSeed,
  HeroMotifProfile,
  HeroMotifVariant,
  HeroPostShellMode,
  HeroPrimitiveKind,
  HeroRelationshipMode,
  HeroTravelStyle,
  HeroPathPoint,
  LayerDirective,
  HeroPhysicsEnvelope,
  NodeIntent,
  NodeIntentSeed,
  MotifPhysicsProfile,
  OccupancyPurpose,
  ParticleBehaviorParams,
  PhysicsParameterChannel,
  PlacementSlot,
  RenderTheme,
  SceneGraph,
  ShapeFamilyToken,
  SourceAttractorProfile,
  StylePlacementMode,
  SubEmitterMode,
  NebulaBandRouting,
  HeroBandAffinity,
  HeroConductorSelection,
  HeroConductorSpec,
  HeroConductorType,
  HeroExpandedBand,
  TransitionFamily,
  VisualRegime,
} from "../types";
import { selectBackgroundElementSpec } from "./background-elements";
import { deriveSeed, pickIndex, pickWeightedIndex, seedToUnitFloat, stableHash32 } from "./seed-utils";

const PHYSICS_CHANNELS: PhysicsParameterChannel[] = [
  "thrust",
  "massDrain",
  "jitterAmplitude",
  "jitterFrequency",
  "drag",
  "smoothBias",
  "transientSpeedGain",
  "steadySpeedDamping",
  "trailEmission",
  "trailHeat",
  "trailCooling",
  "wakeWidth",
  "burstProbability",
  "burstFanout",
  "burstVelocity",
  "subsystemRecursion",
  "residueSpread",
];

const transitionFamilies = (...families: TransitionFamily[]): TransitionFamily[] => families;

interface SceneGraphBuildOptions {
  scheduledHeroMotif?: FractalMotif;
  heroMotifSlotIndex?: number;
  heroMotifSlotStartSec?: number;
  heroMotifSlotEndSec?: number;
  heroMotifScheduleReason?: import("../types").HeroMotifScheduleReason;
  heroMotifLockEnabled?: boolean;
  backgroundPlan?: BackgroundPlan;
  particleBehaviors?: ParticleBehaviorParams[];
}

const CONDUCTOR_REGIMES: VisualRegime[] = ["intro", "groove", "build", "drop", "breakdown", "outro"];

function conductor(entry: Omit<HeroConductorSpec, "anchorMode" | "radiusVariance" | "strengthVariance" | "lifespanModRange" | "swirlVariance" | "pulseVariance" | "selectionTags"> & Partial<Pick<HeroConductorSpec, "anchorMode" | "radiusVariance" | "strengthVariance" | "lifespanModRange" | "swirlVariance" | "pulseVariance" | "selectionTags">>): HeroConductorSpec {
  return {
    anchorMode: "seed-particle",
    radiusVariance: 0.12,
    strengthVariance: 0.12,
    lifespanModRange: { min: 0.88, max: 1.16 },
    swirlVariance: 0.12,
    pulseVariance: 0.12,
    selectionTags: [],
    ...entry,
  };
}

export const HERO_CONDUCTOR_SPECS: HeroConductorSpec[] = [
  conductor({ id: "mesh-ritual", motionFamily: "orbit", bandBias: ["low", "mid"], radiusScale: 0.94, strength: 0.62, phaseMode: "locked", swirl: 0.42, tether: 0.58, pulse: 0.48, preferredMotifs: ["harmonic-lattice", "glass-orbital"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Maya Deren", "Moebius"] }),
  conductor({ id: "cut-up-marionette", motionFamily: "recoil", bandBias: ["mid", "high"], radiusScale: 0.82, strength: 0.68, phaseMode: "staggered", swirl: 0.24, tether: 0.72, pulse: 0.66, preferredMotifs: ["film-bloom-shard", "shattered-arc"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Jan Svankmajer", "Brothers Quay"] }),
  conductor({ id: "dust-vellum-orbit", motionFamily: "orbit", bandBias: ["subLow", "mid"], radiusScale: 1.04, strength: 0.54, phaseMode: "swing", swirl: 0.56, tether: 0.44, pulse: 0.36, preferredMotifs: ["smoke-ribbon", "glass-orbital"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Italo Calvino", "Jorge Luis Borges"] }),
  conductor({ id: "funeral-android", motionFamily: "pendulum", bandBias: ["low", "highMid"], radiusScale: 0.88, strength: 0.7, phaseMode: "locked", swirl: 0.18, tether: 0.74, pulse: 0.52, preferredMotifs: ["data-cathedral", "cathedral-filament"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Yoko Taro", "Burial"] }),
  conductor({ id: "spine-furnace", motionFamily: "spoke-bloom", bandBias: ["low", "mid", "high"], radiusScale: 0.78, strength: 0.74, phaseMode: "staggered", swirl: 0.44, tether: 0.38, pulse: 0.72, preferredMotifs: ["shattered-arc", "film-bloom-shard"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Shinya Tsukamoto", "H.R. Giger"] }),
  conductor({ id: "clear-line-drift", motionFamily: "braid", bandBias: ["mid", "high"], radiusScale: 1.08, strength: 0.52, phaseMode: "locked", swirl: 0.3, tether: 0.5, pulse: 0.34, preferredMotifs: ["vector-incantation", "harmonic-lattice"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Moebius", "Zach Lieberman"] }),
  conductor({ id: "buried-subway-bloom", motionFamily: "delay-wave", bandBias: ["subLow", "low", "highMid"], radiusScale: 1.12, strength: 0.58, phaseMode: "phrase-lag", swirl: 0.48, tether: 0.32, pulse: 0.64, preferredMotifs: ["smoke-ribbon", "film-bloom-shard"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Burial", "Tim Hecker"] }),
  conductor({ id: "catacomb-choir", motionFamily: "tidal-lock", bandBias: ["low", "mid"], radiusScale: 1.02, strength: 0.6, phaseMode: "swing", swirl: 0.34, tether: 0.66, pulse: 0.42, preferredMotifs: ["data-cathedral", "cathedral-filament"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Sun Ra", "Jean-Michel Jarre"] }),
  conductor({ id: "ink-labyrinth", motionFamily: "accordion", bandBias: ["mid", "highMid"], radiusScale: 0.92, strength: 0.64, phaseMode: "staggered", swirl: 0.26, tether: 0.64, pulse: 0.58, preferredMotifs: ["cathedral-filament", "vector-incantation"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Jorge Luis Borges", "Lucas Pope"] }),
  conductor({ id: "false-choice-carousel", motionFamily: "collapse-pulse", bandBias: ["mid", "high"], radiusScale: 0.86, strength: 0.72, phaseMode: "phrase-lag", swirl: 0.4, tether: 0.46, pulse: 0.76, preferredMotifs: ["film-bloom-shard", "mandelbloom"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Davey Wreden", "Harmony Korine"] }),
  conductor({ id: "glacial-feedback", motionFamily: "delay-wave", bandBias: ["subLow", "low"], radiusScale: 1.14, strength: 0.5, phaseMode: "locked", swirl: 0.2, tether: 0.72, pulse: 0.32, preferredMotifs: ["glass-orbital", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Tim Hecker", "Trevor Paglen"] }),
  conductor({ id: "tape-lot-lurch", motionFamily: "recoil", bandBias: ["low", "mid", "high"], radiusScale: 0.84, strength: 0.7, phaseMode: "swing", swirl: 0.36, tether: 0.42, pulse: 0.68, preferredMotifs: ["film-bloom-shard", "smoke-ribbon"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Harmony Korine", "Ralph Bakshi"] }),
  conductor({ id: "neon-votive", motionFamily: "pendulum", bandBias: ["mid", "highMid"], radiusScale: 0.96, strength: 0.63, phaseMode: "locked", swirl: 0.28, tether: 0.58, pulse: 0.46, preferredMotifs: ["neon-tube", "vector-incantation"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Nicolas Winding Refn", "FKA twigs"] }),
  conductor({ id: "cosmic-processional", motionFamily: "tidal-lock", bandBias: ["subLow", "low", "mid"], radiusScale: 1.16, strength: 0.56, phaseMode: "swing", swirl: 0.52, tether: 0.38, pulse: 0.4, preferredMotifs: ["glass-orbital", "mandelbloom"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Sun Ra", "Jean-Michel Jarre"] }),
  conductor({ id: "bruise-satin-surge", motionFamily: "flock-curl", bandBias: ["mid", "high"], radiusScale: 1.08, strength: 0.66, phaseMode: "phrase-lag", swirl: 0.62, tether: 0.28, pulse: 0.54, preferredMotifs: ["smoke-ribbon", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Yves Tumor", "FKA twigs"] }),
  conductor({ id: "checkpoint-parallax", motionFamily: "accordion", bandBias: ["low", "mid", "highMid"], radiusScale: 0.9, strength: 0.61, phaseMode: "staggered", swirl: 0.22, tether: 0.68, pulse: 0.5, preferredMotifs: ["data-cathedral", "harmonic-lattice"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Lucas Pope", "Trevor Paglen"] }),
  conductor({ id: "xerox-shadow-pulse", motionFamily: "collapse-pulse", bandBias: ["mid", "highMid", "high"], radiusScale: 0.88, strength: 0.69, phaseMode: "locked", swirl: 0.32, tether: 0.52, pulse: 0.74, preferredMotifs: ["shattered-arc", "film-bloom-shard"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Charles Burns", "Brothers Quay"] }),
  conductor({ id: "biomech-cathedral", motionFamily: "spoke-bloom", bandBias: ["low", "mid", "high"], radiusScale: 0.98, strength: 0.76, phaseMode: "staggered", swirl: 0.46, tether: 0.62, pulse: 0.7, preferredMotifs: ["data-cathedral", "cathedral-filament"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["H.R. Giger", "Shinya Tsukamoto"] }),
  conductor({ id: "vector-handwriting", motionFamily: "braid", bandBias: ["mid", "highMid"], radiusScale: 1.06, strength: 0.55, phaseMode: "locked", swirl: 0.24, tether: 0.56, pulse: 0.38, preferredMotifs: ["vector-incantation", "harmonic-lattice"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Zach Lieberman", "Moebius"] }),
  conductor({ id: "invisible-constellation", motionFamily: "delay-wave", bandBias: ["subLow", "mid", "high"], radiusScale: 1.18, strength: 0.48, phaseMode: "phrase-lag", swirl: 0.58, tether: 0.3, pulse: 0.34, preferredMotifs: ["glass-orbital", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Trevor Paglen", "Sun Ra"] }),
  conductor({ id: "candy-goblin-skip", motionFamily: "flock-curl", bandBias: ["mid", "high", "highMid"], radiusScale: 1.02, strength: 0.67, phaseMode: "swing", swirl: 0.72, tether: 0.2, pulse: 0.62, preferredMotifs: ["mandelbloom", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Sally Cruikshank", "Ralph Bakshi"] }),
  conductor({ id: "signal-archivist", motionFamily: "tidal-lock", bandBias: ["low", "mid", "highMid"], radiusScale: 0.94, strength: 0.57, phaseMode: "locked", swirl: 0.18, tether: 0.74, pulse: 0.4, preferredMotifs: ["harmonic-lattice", "data-cathedral"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Jean-Michel Jarre", "Lucas Pope"] }),
  conductor({ id: "acid-panel-jolt", motionFamily: "recoil", bandBias: ["mid", "highMid", "high"], radiusScale: 0.8, strength: 0.75, phaseMode: "staggered", swirl: 0.38, tether: 0.4, pulse: 0.72, preferredMotifs: ["film-bloom-shard", "mandelbloom"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Ralph Bakshi", "Nicolas Winding Refn"] }),
  conductor({ id: "orbital-museum-scan", motionFamily: "orbit", bandBias: ["subLow", "low", "highMid"], radiusScale: 1.1, strength: 0.53, phaseMode: "locked", swirl: 0.48, tether: 0.5, pulse: 0.36, preferredMotifs: ["glass-orbital", "harmonic-lattice"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Trevor Paglen", "Moebius"] }),
  conductor({ id: "paper-echo-lantern", motionFamily: "pendulum", bandBias: ["low", "mid", "high"], radiusScale: 1, strength: 0.59, phaseMode: "phrase-lag", swirl: 0.3, tether: 0.62, pulse: 0.44, preferredMotifs: ["smoke-ribbon", "cathedral-filament"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Maya Deren", "Italo Calvino"] }),
  conductor({ id: "swarm-choirmaster", motionFamily: "flock-curl", bandBias: ["mid", "high", "highMid"], radiusScale: 1.1, strength: 0.68, phaseMode: "staggered", swirl: 0.7, tether: 0.24, pulse: 0.58, preferredMotifs: ["halo-cell", "mandelbloom", "smoke-ribbon", "glass-orbital"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Particle Fleet: Emergence", "Osmos"], selectionWeight: 1.25 }),
  conductor({ id: "latch-archivist", motionFamily: "tidal-lock", bandBias: ["low", "mid", "highMid"], radiusScale: 0.92, strength: 0.66, phaseMode: "locked", swirl: 0.14, tether: 0.82, pulse: 0.5, preferredMotifs: ["data-cathedral", "harmonic-lattice", "vector-incantation", "shattered-arc"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Rez Infinite", "Nova Drift"], selectionWeight: 1.25 }),
  conductor({ id: "mirror-choir", motionFamily: "tidal-lock", bandBias: ["low", "mid", "highMid"], radiusScale: 1.04, strength: 0.64, phaseMode: "locked", swirl: 0.18, tether: 0.86, pulse: 0.48, preferredMotifs: ["harmonic-lattice", "glass-orbital", "cathedral-filament"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["John Whitney", "James Turrell"], selectionWeight: 1.18, selectionTags: ["reflective"] }),
  conductor({ id: "catoptric-weaver", motionFamily: "braid", bandBias: ["mid", "highMid"], radiusScale: 0.98, strength: 0.62, phaseMode: "staggered", swirl: 0.4, tether: 0.7, pulse: 0.52, preferredMotifs: ["vector-incantation", "harmonic-lattice", "data-cathedral"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Bridget Riley", "Ryoji Ikeda"], selectionWeight: 1.14, selectionTags: ["reflective"] }),
  conductor({ id: "axis-orrery", motionFamily: "orbit", bandBias: ["subLow", "low", "mid"], radiusScale: 1.12, strength: 0.58, phaseMode: "swing", swirl: 0.54, tether: 0.52, pulse: 0.38, preferredMotifs: ["glass-orbital", "mandelbloom", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Oskar Fischinger", "Julius Horsthuis"], selectionWeight: 1.12, selectionTags: ["reflective"] }),
  conductor({ id: "prism-synod", motionFamily: "accordion", bandBias: ["mid", "highMid", "high"], radiusScale: 0.94, strength: 0.68, phaseMode: "phrase-lag", swirl: 0.3, tether: 0.78, pulse: 0.62, preferredMotifs: ["data-cathedral", "cathedral-filament", "vector-incantation"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Stanley Kubrick", "Mark Z. Danielewski"], selectionWeight: 1.14, selectionTags: ["reflective"] }),
  conductor({ id: "kaleido-lantern", motionFamily: "spoke-bloom", bandBias: ["mid", "high", "highMid"], radiusScale: 1.06, strength: 0.7, phaseMode: "staggered", swirl: 0.6, tether: 0.34, pulse: 0.66, preferredMotifs: ["mandelbloom", "halo-cell", "glass-orbital"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Yayoi Kusama", "Alex Grey"], selectionWeight: 1.16, selectionTags: ["reflective"] }),
  conductor({ id: "vigil-ring", motionFamily: "perfect-circle", anchorMode: "nearest-hero", bandBias: ["low", "mid", "highMid"], radiusScale: 1.08, strength: 0.68, phaseMode: "locked", swirl: 0.78, tether: 0.92, pulse: 0.36, radiusVariance: 0.08, strengthVariance: 0.1, lifespanModRange: { min: 0.94, max: 1.24 }, swirlVariance: 0.06, pulseVariance: 0.08, preferredMotifs: ["glass-orbital", "harmonic-lattice", "halo-cell", "mandelbloom"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["John Whitney", "James Turrell"], selectionWeight: 1.28, selectionTags: ["reflective", "hero-revolve"] }),
  conductor({ id: "transit-orrery", motionFamily: "orbit-through", anchorMode: "nearest-hero", bandBias: ["subLow", "low", "mid"], radiusScale: 1.02, strength: 0.72, phaseMode: "swing", swirl: 0.72, tether: 0.54, pulse: 0.58, radiusVariance: 0.1, strengthVariance: 0.12, lifespanModRange: { min: 0.9, max: 1.22 }, swirlVariance: 0.1, pulseVariance: 0.12, preferredMotifs: ["glass-orbital", "mandelbloom", "harmonic-lattice", "halo-cell"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Oskar Fischinger", "Julius Horsthuis"], selectionWeight: 1.26, selectionTags: ["reflective", "hero-revolve"] }),
  conductor({ id: "braid-procession", motionFamily: "spiral-braid", anchorMode: "nearest-hero", bandBias: ["mid", "highMid", "high"], radiusScale: 1.06, strength: 0.74, phaseMode: "staggered", swirl: 0.9, tether: 0.62, pulse: 0.64, radiusVariance: 0.12, strengthVariance: 0.14, lifespanModRange: { min: 0.92, max: 1.28 }, swirlVariance: 0.14, pulseVariance: 0.12, preferredMotifs: ["glass-orbital", "mandelbloom", "halo-cell", "smoke-ribbon"], preferredRegimes: CONDUCTOR_REGIMES, influenceRefs: ["Bridget Riley", "Julius Horsthuis"], selectionWeight: 1.3, selectionTags: ["reflective", "hero-revolve"] }),
];

export function heroConductorSpecById(id: HeroConductorType): HeroConductorSpec {
  return HERO_CONDUCTOR_SPECS.find((spec) => spec.id === id) ?? HERO_CONDUCTOR_SPECS[0]!;
}

function weightedPickBySeed<T extends { id: string }>(
  entries: readonly T[],
  selectionSeed: number,
  weightFor: (entry: T) => number,
): T {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 0) {
    throw new Error("weightedPickBySeed requires at least one entry.");
  }
  const weights = sorted.map((entry) => Math.max(0, weightFor(entry)));
  return sorted[pickWeightedIndex(selectionSeed, weights)] ?? sorted[0]!;
}

function channelRecord(values: number[]): Record<PhysicsParameterChannel, number> {
  return PHYSICS_CHANNELS.reduce((record, channel, index) => {
    record[channel] = values[index] ?? 0;
    return record;
  }, {} as Record<PhysicsParameterChannel, number>);
}

function evaluatePhysicsEnvelope(profile: MotifPhysicsProfile, weights: {
  subLow: number;
  low: number;
  mid: number;
  highMid: number;
  high: number;
}): HeroPhysicsEnvelope {
  const rows = [
    { weight: weights.subLow, values: profile.matrix.subLow },
    { weight: weights.low, values: profile.matrix.low },
    { weight: weights.mid, values: profile.matrix.mid },
    { weight: weights.highMid, values: profile.matrix.highMid },
    { weight: weights.high, values: profile.matrix.high },
  ];
  return PHYSICS_CHANNELS.reduce((envelope, channel) => {
    const bandContribution = rows.reduce((sum, row) => sum + row.weight * row.values[channel], 0);
    envelope[channel] = clamp(profile.base[channel] + bandContribution, 0, channel === "burstFanout" ? 8 : 4);
    return envelope;
  }, {} as HeroPhysicsEnvelope);
}

function buildMotifPhysicsProfile(
  motif: EdgeMap["fractalMotif"],
  intent: NodeIntent,
  episodeIntent: EpisodeIntent,
): MotifPhysicsProfile {
  const key = `${motif}:${intent}:${episodeIntent}`;
  switch (motif) {
    case "mandelbloom":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.44, 0.14, 0.1, 0.18, 0.1, 0.9, 1.18, 0.98, 0.82, 0.88, 0.3, 0.62, 0.2, 0.2, 1.72, 0.7, 0.58]),
        matrix: {
          subLow: channelRecord([0.14, 0.08, 0.02, 0.03, 0.03, 0.1, 0.08, 0.1, 0.16, 0.08, -0.02, 0.08, 0.02, 0.04, 0.12, 0.06, 0.08]),
          low: channelRecord([0.16, 0.1, 0.02, 0.03, 0.04, 0.12, 0.1, 0.12, 0.2, 0.1, -0.02, 0.1, 0.04, 0.08, 0.18, 0.08, 0.12]),
          mid: channelRecord([0.12, 0.06, 0.04, 0.05, 0.01, 0.06, 0.14, 0.08, 0.14, 0.12, 0.04, 0.08, 0.08, 0.12, 0.24, 0.1, 0.14]),
          highMid: channelRecord([0.08, 0.03, 0.08, 0.12, -0.01, -0.04, 0.2, -0.06, 0.1, 0.14, 0.08, 0.06, 0.16, 0.18, 0.28, 0.14, 0.1]),
          high: channelRecord([0.06, 0.02, 0.1, 0.14, -0.02, -0.08, 0.24, -0.08, 0.06, 0.16, 0.12, 0.04, 0.22, 0.24, 0.36, 0.18, 0.08]),
        },
      };
    case "data-cathedral":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.48, 0.1, 0.06, 0.12, 0.12, 0.98, 1.12, 1.08, 0.66, 0.96, 0.24, 0.48, 0.16, 0.14, 1.42, 0.56, 0.34]),
        matrix: {
          subLow: channelRecord([0.1, 0.08, 0.01, 0.01, 0.03, 0.08, 0.06, 0.08, 0.1, 0.06, -0.02, 0.06, 0.02, 0.04, 0.08, 0.04, 0.04]),
          low: channelRecord([0.14, 0.1, 0.01, 0.02, 0.03, 0.1, 0.08, 0.1, 0.12, 0.08, -0.02, 0.06, 0.03, 0.04, 0.12, 0.06, 0.04]),
          mid: channelRecord([0.1, 0.04, 0.04, 0.04, 0.01, 0.04, 0.1, 0.06, 0.1, 0.1, 0.02, 0.08, 0.08, 0.1, 0.18, 0.08, 0.04]),
          highMid: channelRecord([0.08, 0.02, 0.06, 0.1, -0.01, -0.04, 0.14, -0.05, 0.06, 0.12, 0.06, 0.06, 0.14, 0.16, 0.22, 0.1, 0.02]),
          high: channelRecord([0.06, 0.02, 0.08, 0.12, -0.02, -0.06, 0.18, -0.08, 0.04, 0.14, 0.1, 0.04, 0.18, 0.18, 0.28, 0.14, 0.02]),
        },
      };
    case "chromatic-xylem":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.42, 0.16, 0.14, 0.18, 0.1, 0.88, 1.2, 0.96, 0.88, 0.84, 0.3, 0.66, 0.2, 0.2, 1.6, 0.62, 0.74]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.02, 0.02, 0.03, 0.1, 0.08, 0.1, 0.14, 0.08, -0.02, 0.08, 0.02, 0.04, 0.08, 0.04, 0.16]),
          low: channelRecord([0.14, 0.1, 0.02, 0.03, 0.04, 0.12, 0.1, 0.12, 0.18, 0.1, -0.02, 0.1, 0.04, 0.08, 0.14, 0.06, 0.18]),
          mid: channelRecord([0.12, 0.06, 0.04, 0.05, 0.01, 0.06, 0.14, 0.08, 0.14, 0.12, 0.04, 0.08, 0.08, 0.12, 0.2, 0.08, 0.14]),
          highMid: channelRecord([0.08, 0.03, 0.08, 0.12, -0.01, -0.04, 0.2, -0.04, 0.1, 0.14, 0.08, 0.08, 0.16, 0.18, 0.26, 0.12, 0.1]),
          high: channelRecord([0.06, 0.02, 0.1, 0.14, -0.02, -0.08, 0.24, -0.06, 0.06, 0.16, 0.12, 0.06, 0.22, 0.22, 0.32, 0.14, 0.08]),
        },
      };
    case "vector-incantation":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.46, 0.12, 0.1, 0.16, 0.12, 0.92, 1.22, 1.02, 0.8, 0.86, 0.28, 0.58, 0.18, 0.18, 1.66, 0.6, 0.46]),
        matrix: {
          subLow: channelRecord([0.1, 0.08, 0.02, 0.02, 0.03, 0.08, 0.06, 0.08, 0.12, 0.08, -0.02, 0.06, 0.02, 0.04, 0.08, 0.04, 0.08]),
          low: channelRecord([0.12, 0.08, 0.02, 0.03, 0.04, 0.1, 0.08, 0.1, 0.14, 0.08, -0.02, 0.08, 0.04, 0.06, 0.12, 0.06, 0.08]),
          mid: channelRecord([0.12, 0.06, 0.04, 0.05, 0.01, 0.04, 0.16, 0.08, 0.14, 0.1, 0.04, 0.08, 0.08, 0.12, 0.22, 0.08, 0.08]),
          highMid: channelRecord([0.08, 0.02, 0.08, 0.12, -0.01, -0.04, 0.22, -0.06, 0.08, 0.12, 0.08, 0.06, 0.16, 0.18, 0.28, 0.12, 0.06]),
          high: channelRecord([0.06, 0.02, 0.1, 0.14, -0.02, -0.06, 0.28, -0.08, 0.06, 0.14, 0.12, 0.04, 0.22, 0.22, 0.34, 0.16, 0.04]),
        },
      };
    case "harmonic-lattice":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.44, 0.1, 0.08, 0.12, 0.12, 0.96, 1.1, 1.06, 0.72, 0.9, 0.24, 0.5, 0.16, 0.14, 1.48, 0.54, 0.32]),
        matrix: {
          subLow: channelRecord([0.1, 0.08, 0.01, 0.01, 0.03, 0.08, 0.06, 0.08, 0.1, 0.06, -0.02, 0.06, 0.02, 0.04, 0.08, 0.04, 0.04]),
          low: channelRecord([0.12, 0.08, 0.01, 0.02, 0.03, 0.1, 0.08, 0.1, 0.12, 0.08, -0.02, 0.06, 0.03, 0.04, 0.1, 0.06, 0.04]),
          mid: channelRecord([0.1, 0.05, 0.04, 0.04, 0.01, 0.04, 0.1, 0.06, 0.1, 0.08, 0.02, 0.08, 0.08, 0.1, 0.18, 0.08, 0.04]),
          highMid: channelRecord([0.08, 0.02, 0.06, 0.08, -0.01, -0.04, 0.14, -0.05, 0.06, 0.1, 0.06, 0.06, 0.14, 0.16, 0.22, 0.1, 0.02]),
          high: channelRecord([0.06, 0.02, 0.08, 0.1, -0.02, -0.06, 0.18, -0.08, 0.04, 0.12, 0.1, 0.04, 0.18, 0.18, 0.28, 0.12, 0.02]),
        },
      };
    case "film-bloom-shard":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.5, 0.12, 0.12, 0.22, 0.12, 0.82, 1.34, 0.88, 0.94, 0.92, 0.34, 0.72, 0.24, 0.28, 1.96, 0.76, 0.82]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.02, 0.03, 0.04, 0.08, 0.08, 0.08, 0.14, 0.08, -0.02, 0.08, 0.02, 0.06, 0.12, 0.06, 0.08]),
          low: channelRecord([0.16, 0.1, 0.02, 0.04, 0.04, 0.1, 0.1, 0.1, 0.18, 0.1, -0.02, 0.1, 0.04, 0.1, 0.18, 0.08, 0.12]),
          mid: channelRecord([0.14, 0.06, 0.06, 0.06, 0.02, 0.02, 0.18, 0.04, 0.14, 0.12, 0.04, 0.1, 0.1, 0.14, 0.26, 0.12, 0.12]),
          highMid: channelRecord([0.1, 0.03, 0.1, 0.14, -0.01, -0.08, 0.26, -0.08, 0.1, 0.16, 0.08, 0.08, 0.2, 0.24, 0.38, 0.18, 0.1]),
          high: channelRecord([0.08, 0.02, 0.12, 0.18, -0.02, -0.1, 0.32, -0.1, 0.08, 0.18, 0.12, 0.06, 0.26, 0.3, 0.46, 0.22, 0.08]),
        },
      };
    case "smoke-ribbon":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.4, 0.18, 0.12, 0.2, 0.08, 0.86, 1.24, 0.92, 0.92, 0.78, 0.34, 0.7, 0.2, 0.18, 1.55, 0.54, 0.9]),
        matrix: {
          subLow: channelRecord([0.16, 0.1, 0.01, 0.02, 0.04, 0.12, 0.08, 0.1, 0.18, 0.08, -0.03, 0.12, 0.02, 0.06, 0.08, 0.02, 0.2]),
          low: channelRecord([0.2, 0.12, 0.02, 0.03, 0.04, 0.14, 0.1, 0.12, 0.22, 0.1, -0.02, 0.12, 0.04, 0.08, 0.14, 0.04, 0.18]),
          mid: channelRecord([0.12, 0.06, 0.04, 0.05, 0.01, 0.06, 0.12, 0.1, 0.12, 0.12, 0.03, 0.08, 0.08, 0.12, 0.22, 0.08, 0.12]),
          highMid: channelRecord([0.1, 0.03, 0.08, 0.12, -0.02, -0.08, 0.22, -0.08, 0.08, 0.14, 0.08, 0.06, 0.18, 0.24, 0.34, 0.16, 0.08]),
          high: channelRecord([0.08, 0.02, 0.1, 0.14, -0.03, -0.12, 0.28, -0.12, 0.04, 0.18, 0.12, 0.04, 0.24, 0.28, 0.42, 0.2, 0.06]),
        },
      };
    case "cathedral-filament":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.46, 0.12, 0.08, 0.14, 0.14, 0.94, 1.04, 1.06, 0.7, 0.92, 0.28, 0.54, 0.18, 0.16, 1.5, 0.62, 0.42]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.01, 0.02, 0.03, 0.1, 0.06, 0.1, 0.14, 0.06, -0.02, 0.08, 0.02, 0.04, 0.12, 0.06, 0.08]),
          low: channelRecord([0.16, 0.1, 0.01, 0.03, 0.04, 0.12, 0.08, 0.12, 0.16, 0.08, -0.02, 0.08, 0.04, 0.06, 0.18, 0.1, 0.08]),
          mid: channelRecord([0.12, 0.05, 0.03, 0.04, 0.01, 0.04, 0.1, 0.06, 0.12, 0.08, 0.02, 0.1, 0.08, 0.1, 0.22, 0.12, 0.06]),
          highMid: channelRecord([0.08, 0.02, 0.05, 0.08, -0.01, -0.04, 0.16, -0.06, 0.08, 0.12, 0.08, 0.08, 0.14, 0.16, 0.28, 0.16, 0.04]),
          high: channelRecord([0.06, 0.02, 0.08, 0.1, -0.02, -0.06, 0.18, -0.08, 0.04, 0.14, 0.12, 0.06, 0.18, 0.18, 0.32, 0.2, 0.04]),
        },
      };
    case "shattered-arc":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.54, 0.08, 0.2, 0.34, 0.07, 0.74, 1.34, 0.84, 0.56, 0.9, 0.22, 0.46, 0.14, 0.28, 2.35, 0.96, 0.66]),
        matrix: {
          subLow: channelRecord([0.16, 0.08, 0.02, 0.03, 0.03, 0.08, 0.08, 0.08, 0.08, 0.08, -0.02, 0.08, 0.04, 0.08, 0.18, 0.1, 0.14]),
          low: channelRecord([0.2, 0.1, 0.04, 0.05, 0.04, 0.08, 0.1, 0.1, 0.1, 0.1, -0.01, 0.08, 0.08, 0.12, 0.28, 0.16, 0.18]),
          mid: channelRecord([0.18, 0.06, 0.08, 0.1, 0.01, 0.02, 0.14, 0.04, 0.12, 0.12, 0.04, 0.08, 0.14, 0.2, 0.42, 0.28, 0.16]),
          highMid: channelRecord([0.14, 0.04, 0.14, 0.18, -0.02, -0.04, 0.24, -0.06, 0.08, 0.16, 0.08, 0.06, 0.24, 0.34, 0.6, 0.42, 0.12]),
          high: channelRecord([0.1, 0.03, 0.18, 0.24, -0.03, -0.08, 0.32, -0.08, 0.04, 0.2, 0.12, 0.04, 0.3, 0.4, 0.74, 0.5, 0.1]),
        },
      };
    case "glass-orbital":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.42, 0.12, 0.08, 0.14, 0.12, 0.88, 0.96, 1.02, 0.46, 0.56, 0.24, 0.36, 0.2, 0.12, 1.3, 0.48, 0.3]),
        matrix: {
          subLow: channelRecord([0.1, 0.08, 0.01, 0.02, 0.03, 0.08, 0.06, 0.08, 0.08, 0.04, -0.02, 0.06, 0.02, 0.04, 0.08, 0.04, 0.06]),
          low: channelRecord([0.12, 0.1, 0.01, 0.03, 0.04, 0.1, 0.08, 0.1, 0.1, 0.06, -0.02, 0.06, 0.04, 0.04, 0.12, 0.06, 0.06]),
          mid: channelRecord([0.1, 0.05, 0.03, 0.04, 0.01, 0.04, 0.1, 0.04, 0.08, 0.08, 0.02, 0.06, 0.08, 0.08, 0.16, 0.1, 0.04]),
          highMid: channelRecord([0.08, 0.03, 0.05, 0.08, -0.01, -0.04, 0.16, -0.04, 0.06, 0.1, 0.06, 0.04, 0.12, 0.12, 0.22, 0.14, 0.04]),
          high: channelRecord([0.06, 0.02, 0.08, 0.1, -0.02, -0.06, 0.2, -0.06, 0.04, 0.12, 0.1, 0.02, 0.16, 0.16, 0.28, 0.18, 0.02]),
        },
      };
    case "halo-cell":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.4, 0.12, 0.06, 0.12, 0.1, 0.9, 1.02, 1.0, 0.74, 0.72, 0.28, 0.5, 0.2, 0.16, 1.45, 0.52, 0.34]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.01, 0.02, 0.03, 0.08, 0.06, 0.08, 0.12, 0.06, -0.02, 0.08, 0.02, 0.04, 0.1, 0.04, 0.08]),
          low: channelRecord([0.16, 0.1, 0.01, 0.03, 0.04, 0.1, 0.08, 0.1, 0.16, 0.08, -0.02, 0.1, 0.04, 0.06, 0.14, 0.06, 0.1]),
          mid: channelRecord([0.12, 0.06, 0.03, 0.04, 0.01, 0.04, 0.1, 0.04, 0.12, 0.1, 0.02, 0.08, 0.08, 0.08, 0.18, 0.08, 0.08]),
          highMid: channelRecord([0.08, 0.03, 0.05, 0.08, -0.01, -0.04, 0.16, -0.04, 0.08, 0.12, 0.06, 0.06, 0.14, 0.14, 0.24, 0.12, 0.06]),
          high: channelRecord([0.06, 0.02, 0.08, 0.1, -0.02, -0.06, 0.18, -0.06, 0.04, 0.14, 0.1, 0.04, 0.18, 0.18, 0.3, 0.16, 0.04]),
        },
      };
    case "neon-tube":
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.48, 0.12, 0.08, 0.16, 0.09, 0.92, 1.1, 0.98, 0.52, 0.42, 0.22, 0.42, 0.18, 0.14, 1.35, 0.5, 0.26]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.01, 0.02, 0.03, 0.08, 0.06, 0.08, 0.1, 0.04, -0.02, 0.08, 0.02, 0.04, 0.08, 0.04, 0.06]),
          low: channelRecord([0.16, 0.1, 0.01, 0.03, 0.04, 0.1, 0.08, 0.1, 0.12, 0.06, -0.02, 0.08, 0.04, 0.04, 0.12, 0.06, 0.06]),
          mid: channelRecord([0.14, 0.06, 0.03, 0.04, 0.01, 0.04, 0.1, 0.04, 0.1, 0.08, 0.02, 0.08, 0.08, 0.08, 0.16, 0.08, 0.04]),
          highMid: channelRecord([0.1, 0.03, 0.05, 0.08, -0.01, -0.04, 0.18, -0.04, 0.06, 0.1, 0.06, 0.06, 0.14, 0.14, 0.22, 0.12, 0.04]),
          high: channelRecord([0.08, 0.02, 0.08, 0.12, -0.02, -0.06, 0.22, -0.06, 0.04, 0.12, 0.1, 0.04, 0.18, 0.16, 0.28, 0.16, 0.02]),
        },
      };
    default:
      return {
        motif,
        key,
        channels: PHYSICS_CHANNELS,
        base: channelRecord([0.44, 0.12, 0.08, 0.14, 0.1, 0.88, 1.02, 1.0, 0.62, 0.68, 0.26, 0.48, 0.18, 0.16, 1.45, 0.56, 0.4]),
        matrix: {
          subLow: channelRecord([0.12, 0.08, 0.01, 0.02, 0.03, 0.08, 0.06, 0.08, 0.1, 0.06, -0.02, 0.08, 0.02, 0.04, 0.1, 0.04, 0.08]),
          low: channelRecord([0.16, 0.1, 0.02, 0.03, 0.04, 0.1, 0.08, 0.1, 0.14, 0.08, -0.02, 0.1, 0.04, 0.06, 0.14, 0.06, 0.1]),
          mid: channelRecord([0.12, 0.06, 0.04, 0.05, 0.01, 0.04, 0.1, 0.04, 0.1, 0.1, 0.02, 0.08, 0.08, 0.1, 0.18, 0.1, 0.08]),
          highMid: channelRecord([0.1, 0.03, 0.06, 0.1, -0.01, -0.04, 0.18, -0.04, 0.08, 0.12, 0.06, 0.06, 0.14, 0.16, 0.24, 0.14, 0.06]),
          high: channelRecord([0.08, 0.02, 0.08, 0.12, -0.02, -0.06, 0.22, -0.06, 0.04, 0.16, 0.1, 0.04, 0.18, 0.18, 0.3, 0.18, 0.04]),
        },
      };
  }
}

function buildHeroMotifProfile(
  intent: NodeIntent,
  motif: EdgeMap["fractalMotif"],
  episodeIntent: EpisodeIntent,
  theme: RenderTheme,
): HeroMotifProfile {
  const profile = theme.styleProfile;
  const intensityClass = classifyHeroMotifIntensity(motif);
  const trailDurationMultiplierForKey = (key: string): number => {
    const baseMultiplier = (() => {
      switch (key) {
      case "cathedral-filament":
        return 1.35;
      case "glass-orbital":
        return 1.28;
      case "smoke-ribbon":
        return 1.18;
      case "vector-incantation":
        return 1.22;
      case "harmonic-lattice":
        return 1.26;
      case "shattered-arc":
        return 0.92;
      case "film-bloom-shard":
        return 0.88;
      default:
        return 1;
      }
    })();
    return baseMultiplier * 2;
  };
  const clusterConfigForKey = (key: string): HeroMotifProfile["clusterConfig"] => {
    const base = {
      enabled: false,
      count: 1,
      layout: "bilateral" as const,
      relationshipMode: "independent" as const,
      satelliteScale: 0.72,
      satelliteEmissionScale: 0.78,
      satelliteAlphaScale: 0.84,
      satellitePathOffsetRadius: 0.38,
      sharedCoreBias: 0.18,
      mirrorAxisBias: 0.22,
      satellitePhaseLock: 0.24,
    };
    switch (key) {
      case "glass-orbital":
        return { ...base, enabled: true, count: 3, layout: "orbit-ring", relationshipMode: "cojoined", satellitePathOffsetRadius: 0.44, sharedCoreBias: 0.58, mirrorAxisBias: 0.56, satellitePhaseLock: 0.62 };
      case "halo-cell":
        return { ...base, enabled: true, count: 3, layout: "triad", relationshipMode: "independent", satellitePathOffsetRadius: 0.34, sharedCoreBias: 0.2, mirrorAxisBias: 0.18, satellitePhaseLock: 0.22 };
      case "harmonic-lattice":
        return { ...base, enabled: true, count: 2, layout: "bilateral", relationshipMode: "mirror-x", satellitePathOffsetRadius: 0.36, sharedCoreBias: 0.34, mirrorAxisBias: 0.78, satellitePhaseLock: 0.74 };
      case "data-cathedral":
        return { ...base, enabled: true, count: 2, layout: "bilateral", relationshipMode: "mirror-y", satellitePathOffsetRadius: 0.32, sharedCoreBias: 0.28, mirrorAxisBias: 0.82, satellitePhaseLock: 0.72 };
      case "shattered-arc":
        return { ...base, enabled: true, count: 2, layout: "staggered-arc", relationshipMode: "independent", satellitePathOffsetRadius: 0.42, sharedCoreBias: 0.12, mirrorAxisBias: 0.14, satellitePhaseLock: 0.18 };
      case "film-bloom-shard":
        return { ...base, enabled: true, count: 2, layout: "staggered-arc", relationshipMode: "independent", satellitePathOffsetRadius: 0.46, sharedCoreBias: 0.1, mirrorAxisBias: 0.12, satellitePhaseLock: 0.16 };
      default:
        return base;
    }
  };
  const emissionTuningForKey = (key: string): HeroMotifProfile["emissionTuning"] => {
    const warpFactorScale =
      key === "shattered-arc" ? 1.95 :
      key === "film-bloom-shard" ? 1.75 :
      key === "smoke-ribbon" ? 1.45 :
      key === "glass-orbital" ? 1.08 :
      key === "data-cathedral" ? 1.12 :
      key === "harmonic-lattice" ? 1.14 :
      key === "cathedral-filament" ? 0.94 :
      key === "halo-cell" ? 0.98 :
      key === "mandelbloom" ? 0.97 :
      key === "chromatic-xylem" ? 0.99 :
      key === "vector-incantation" ? 1 :
      0.95;
    const colorRangeMode =
      key === "data-cathedral" || key === "cathedral-filament" || key === "harmonic-lattice" ? "tight" :
      key === "shattered-arc" || key === "film-bloom-shard" || key === "chromatic-xylem" || key === "mandelbloom" ? "extreme" :
      key === "glass-orbital" || key === "vector-incantation" ? "medium" :
      "wide";
    const colorfulnessBoost =
      intensityClass === "colorful-psychedelic" ? 1.4 :
      intensityClass === "restrained" ? 1.02 :
      1.1;
    return {
      warpFactorScale,
      warpVisualScale: clamp(warpFactorScale * 1.02, 1.08, 2),
      ttlScale: 1.4,
      dragScale: 1.1,
      colorfulnessScale: 1.68 * colorfulnessBoost,
      edgeAttractionScale: 4.2,
      edgeAttractionBypassSpawnDrag: true,
      colorRangeMode,
    };
  };
  const transitionBiasForKey = (key: string): HeroMotifProfile["transitionBias"] => {
    switch (key) {
      case "glass-orbital":
        return { preferredFamilies: transitionFamilies("mirror-gate-inversion", "bilateral-iris-fold", "phase-ghost", "mirror-kaleido"), warpiness: 0.34, symmetry: 0.92, disruption: 0.24, timingJitter: 0.22, widthBias: 0.66, potencyBias: 0.52 };
      case "halo-cell":
        return { preferredFamilies: transitionFamilies("halo-drift", "mandala-pulse", "mirror-kaleido", "prism-fold"), warpiness: 0.28, symmetry: 0.88, disruption: 0.28, timingJitter: 0.18, widthBias: 0.62, potencyBias: 0.48 };
      case "harmonic-lattice":
        return { preferredFamilies: transitionFamilies("bilateral-iris-fold", "quad-kaleido-choir", "lattice-breath", "phase-lattice"), warpiness: 0.24, symmetry: 0.84, disruption: 0.22, timingJitter: 0.16, widthBias: 0.56, potencyBias: 0.44 };
      case "data-cathedral":
        return { preferredFamilies: transitionFamilies("prism-axis-lag", "reflection-slit-shatter", "veil-shift", "phase-lattice"), warpiness: 0.22, symmetry: 0.82, disruption: 0.2, timingJitter: 0.14, widthBias: 0.58, potencyBias: 0.42 };
      case "shattered-arc":
        return { preferredFamilies: transitionFamilies("trip-kaleido", "chroma-smear", "shear-kaleido", "fragment"), warpiness: 0.82, symmetry: 0.22, disruption: 0.88, timingJitter: 0.62, widthBias: 0.74, potencyBias: 0.92 };
      case "film-bloom-shard":
        return { preferredFamilies: transitionFamilies("chroma-smear", "strobe-bloom", "shear-kaleido", "fragment"), warpiness: 0.76, symmetry: 0.18, disruption: 0.84, timingJitter: 0.66, widthBias: 0.78, potencyBias: 0.88 };
      case "mandelbloom":
        return { preferredFamilies: transitionFamilies("mandala-pulse", "fractal-tunnel", "shear-kaleido", "spiral-carry"), warpiness: 0.9, symmetry: 0.48, disruption: 0.54, timingJitter: 0.44, widthBias: 0.52, potencyBias: 0.72 };
      case "smoke-ribbon":
        return { preferredFamilies: transitionFamilies("liquid-lens", "acid-fold", "shear-kaleido", "ribbon-fold"), warpiness: 0.82, symmetry: 0.32, disruption: 0.46, timingJitter: 0.38, widthBias: 0.46, potencyBias: 0.66 };
      case "vector-incantation":
        return { preferredFamilies: transitionFamilies("trip-kaleido", "roll-sway", "axis-swap", "split-mirror"), warpiness: 0.78, symmetry: 0.46, disruption: 0.52, timingJitter: 0.42, widthBias: 0.54, potencyBias: 0.64 };
      default:
        return { preferredFamilies: transitionFamilies("halo-drift", "echo-fold", "veil-shift", "chorus-drift"), warpiness: 0.4, symmetry: 0.4, disruption: 0.34, timingJitter: 0.24, widthBias: 0.48, potencyBias: 0.5 };
    }
  };
  const warpProfileForMotif = (resolvedMotif: EdgeMap["fractalMotif"]): HeroMotifProfile["warpProfile"] => {
    switch (resolvedMotif) {
      case "neon-tube":
        return { xBand: "mid", yBand: "highMid", xBaseMultiplier: 1.15, yBaseMultiplier: 1.1, xExtremeMultiplier: 1.8, yExtremeMultiplier: 1.6 };
      case "smoke-ribbon":
        return { xBand: "subLow", yBand: "mid", xBaseMultiplier: 1.35, yBaseMultiplier: 1.2, xExtremeMultiplier: 2.4, yExtremeMultiplier: 2.0 };
      case "glass-orbital":
        return { xBand: "low", yBand: "highMid", xBaseMultiplier: 1.15, yBaseMultiplier: 1.1, xExtremeMultiplier: 1.8, yExtremeMultiplier: 1.6 };
      case "cathedral-filament":
        return { xBand: "mid", yBand: "highMid", xBaseMultiplier: 1.1, yBaseMultiplier: 1.2, xExtremeMultiplier: 1.6, yExtremeMultiplier: 1.8 };
      case "halo-cell":
        return { xBand: "low", yBand: "highMid", xBaseMultiplier: 1.25, yBaseMultiplier: 1.2, xExtremeMultiplier: 2.0, yExtremeMultiplier: 1.8 };
      case "shattered-arc":
        return { xBand: "mid", yBand: "high", xBaseMultiplier: 1.35, yBaseMultiplier: 1.4, xExtremeMultiplier: 2.8, yExtremeMultiplier: 3.0 };
      case "mandelbloom":
        return { xBand: "low", yBand: "high", xBaseMultiplier: 1.3, yBaseMultiplier: 1.35, xExtremeMultiplier: 2.6, yExtremeMultiplier: 2.8 };
      case "data-cathedral":
        return { xBand: "low", yBand: "highMid", xBaseMultiplier: 1.05, yBaseMultiplier: 1.15, xExtremeMultiplier: 1.5, yExtremeMultiplier: 1.8 };
      case "chromatic-xylem":
        return { xBand: "low", yBand: "high", xBaseMultiplier: 1.25, yBaseMultiplier: 1.3, xExtremeMultiplier: 2.2, yExtremeMultiplier: 2.4 };
      case "vector-incantation":
        return { xBand: "mid", yBand: "highMid", xBaseMultiplier: 1.2, yBaseMultiplier: 1.25, xExtremeMultiplier: 2.1, yExtremeMultiplier: 2.3 };
      case "harmonic-lattice":
        return { xBand: "low", yBand: "highMid", xBaseMultiplier: 1.1, yBaseMultiplier: 1.15, xExtremeMultiplier: 1.6, yExtremeMultiplier: 1.8 };
      case "film-bloom-shard":
        return { xBand: "mid", yBand: "high", xBaseMultiplier: 1.35, yBaseMultiplier: 1.45, xExtremeMultiplier: 2.8, yExtremeMultiplier: 3.0 };
      default:
        return { xBand: "mid", yBand: "highMid", xBaseMultiplier: 1.25, yBaseMultiplier: 1.25, xExtremeMultiplier: 2.0, yExtremeMultiplier: 2.0 };
    }
  };
  const makeProfile = (
    key: string,
    influenceKey: string,
    heroPrimitivePool: HeroPrimitiveKind[],
    fallbackHeroPrimitivePool: HeroPrimitiveKind[],
    emissionPrimitivePool: HeroPrimitiveKind[] | undefined,
    fillBias: HeroMotifProfile["fillBias"],
    deformationBias: HeroMotifProfile["deformationBias"],
    motionBias: HeroMotifProfile["motionBias"],
    edgeAttachmentBias: number,
    spinProfile: HeroMotifProfile["spinProfile"],
    particleSpawnRegion: HeroMotifProfile["particleSpawnRegion"],
    particleSizeBaseRange: HeroMotifProfile["particleSizeBaseRange"],
    particleSizeVarianceMode: HeroMotifProfile["particleSizeVarianceMode"],
    particleExitTint: HeroMotifProfile["particleExitTint"],
    colorProminence: HeroMotifProfile["colorProminence"],
    variantAxes: HeroMotifProfile["variantAxes"],
    prominenceBias: HeroMotifProfile["prominenceBias"],
    spawnTimingMode: HeroMotifProfile["spawnTimingMode"],
  ): HeroMotifProfile => ({
    key,
    intensityClass,
    influenceKey,
    heroPrimitivePool,
    fallbackHeroPrimitivePool,
    emissionPrimitivePool,
    fillBias,
    deformationBias,
    motionBias,
    edgeAttachmentBias,
    spinProfile,
    particleSpawnRegion,
    particleSizeBaseRange,
    particleSizeVarianceMode,
    particleExitTint,
    colorProminence,
    variantAxes,
    prominenceBias,
    trailDurationMultiplier: trailDurationMultiplierForKey(key),
    spawnTimingMode,
    nonSubEmitterParticleBias:
      key === "smoke-ribbon" || key === "glass-orbital" ? 0.72 :
      key === "shattered-arc" || key === "film-bloom-shard" ? 0.64 :
      key === "data-cathedral" || key === "harmonic-lattice" ? 0.56 :
      0.6,
    directSpawnLoci:
      key === "shattered-arc" || key === "film-bloom-shard"
        ? ["shell-rim", "path-tangent", "burst-origin"]
        : key === "smoke-ribbon"
          ? ["centerline", "wake-tail", "path-tangent"]
          : key === "glass-orbital" || key === "halo-cell"
            ? ["shell-rim", "centerline", "wake-tail"]
            : ["centerline", "shell-rim", "path-tangent"],
    clusterConfig: clusterConfigForKey(key),
    emissionTuning: emissionTuningForKey(key),
    transitionBias: transitionBiasForKey(key),
    warpProfile: warpProfileForMotif(motif),
  });
  if (motif === "cathedral-filament") {
    return makeProfile("cathedral-filament", "alex-grey+john-whitney", ["diamond", "hexagon", "lens", "kite"], ["hexagon", "diamond", "lens"], ["chevron", "arrow", "lightning", "arc"], "stroke-fill", "tilt", "tightrope", 1.18, {
      gracefulSpin: 0.18,
      glitchSpin: 1.1,
      jerkStrength: 0.18,
    }, {
      x: 0.02,
      y: -0.08,
      xRange: 0.18,
      yRange: 0.12,
    }, {
      min: 1.5,
      max: 1.9,
    }, "tight", "cool-white", {
      core: 1.14,
      shell: 1.1,
      particles: 1.08,
    }, {
      sizeBias: { min: 0.35, max: 0.72 },
      speedBias: { min: 0.28, max: 0.64 },
      fadeBias: { min: 0.48, max: 0.86 },
      warpBias: { min: 0.38, max: 0.82 },
      inconsistencyBias: { min: 0.22, max: 0.76 },
      gravityBias: { min: 0.08, max: 0.42 },
      densityBias: { min: 0.34, max: 0.78 },
      dragBias: { min: 0.32, max: 0.56 },
    }, {
      coreScale: 1.18,
      coreAlpha: 1.16,
      outlineAlpha: 1.12,
      contrastLift: 0.16,
      particleScale: 1.72,
      particleSpeed: 1.86,
      particleFade: 1.24,
    }, "all-band-split");
  }
  if (motif === "smoke-ribbon") {
    return makeProfile("smoke-ribbon", "venosa+android-jones", ["teardrop", "moon", "ellipse", "cloud", "stadium"], ["ellipse", "teardrop", "moon", "cloud"], ["arc", "chevron"], "solid", "wobble", "glide", 0.92, {
      gracefulSpin: 0.1,
      glitchSpin: 0.84,
      jerkStrength: 0.12,
    }, {
      x: -0.04,
      y: 0.02,
      xRange: 0.26,
      yRange: 0.22,
    }, {
      min: 1.7,
      max: 2.2,
    }, "wide", "warm-white", {
      core: 1.2,
      shell: 1.16,
      particles: 1.14,
    }, {
      sizeBias: { min: 0.28, max: 0.7 },
      speedBias: { min: 0.18, max: 0.54 },
      fadeBias: { min: 0.42, max: 0.82 },
      warpBias: { min: 0.46, max: 0.92 },
      inconsistencyBias: { min: 0.24, max: 0.84 },
      gravityBias: { min: 0.34, max: 0.94 },
      densityBias: { min: 0.3, max: 0.74 },
      dragBias: { min: 0.42, max: 0.74 },
    }, {
      coreScale: 1.14,
      coreAlpha: 1.12,
      outlineAlpha: 0.94,
      contrastLift: 0.12,
      particleScale: 2.2,
      particleSpeed: 1.72,
      particleFade: 1.28,
    }, "band-low");
  }
  if (motif === "glass-orbital" || episodeIntent === "mirror-corridor") {
    return makeProfile("glass-orbital", "julius-horsthuis+john-whitney", ["lens", "ring", "ellipse", "sector", "circle"], ["ellipse", "lens", "ring", "moon"], ["arc", "chevron"], "ring-fill", "pulse", "ritual-orbit", 1.02, {
      gracefulSpin: 0.24,
      glitchSpin: 1.28,
      jerkStrength: 0.2,
    }, {
      x: 0,
      y: 0,
      xRange: 0.22,
      yRange: 0.14,
    }, {
      min: 1.6,
      max: 2.0,
    }, "medium", "cool-white", {
      core: 1.18,
      shell: 1.12,
      particles: 1.08,
    }, {
      sizeBias: { min: 0.26, max: 0.62 },
      speedBias: { min: 0.2, max: 0.52 },
      fadeBias: { min: 0.5, max: 0.82 },
      warpBias: { min: 0.34, max: 0.78 },
      inconsistencyBias: { min: 0.18, max: 0.62 },
      gravityBias: { min: 0.04, max: 0.24 },
      densityBias: { min: 0.3, max: 0.68 },
      dragBias: { min: 0.26, max: 0.5 },
    }, {
      coreScale: 1.16,
      coreAlpha: 1.14,
      outlineAlpha: 1.08,
      contrastLift: 0.14,
      particleScale: 1.92,
      particleSpeed: 1.78,
      particleFade: 1.22,
    }, "phasic-quarter");
  }
  if (motif === "shattered-arc") {
    return makeProfile("shattered-arc", "draves+kawaguchi", ["lightning", "star", "kite", "diamond", "hexagram"], ["diamond", "star", "lightning", "kite"], ["chevron", "arrow", "lightning", "arc"], "stroke-fill", "shear", "glitch-hop", 1.08, {
      gracefulSpin: 0.32,
      glitchSpin: 2.1,
      jerkStrength: 0.42,
    }, {
      x: 0.08,
      y: -0.02,
      xRange: 0.3,
      yRange: 0.18,
    }, {
      min: 2.0,
      max: 3.0,
    }, "extreme", "white-bleach", {
      core: 1.24,
      shell: 1.2,
      particles: 1.18,
    }, {
      sizeBias: { min: 0.24, max: 0.66 },
      speedBias: { min: 0.42, max: 0.94 },
      fadeBias: { min: 0.56, max: 0.94 },
      warpBias: { min: 0.52, max: 0.96 },
      inconsistencyBias: { min: 0.42, max: 0.98 },
      gravityBias: { min: 0.1, max: 0.44 },
      densityBias: { min: 0.38, max: 0.88 },
      dragBias: { min: 0.14, max: 0.36 },
    }, {
      coreScale: 1.2,
      coreAlpha: 1.18,
      outlineAlpha: 1.1,
      contrastLift: 0.18,
      particleScale: 2.46,
      particleSpeed: 2.04,
      particleFade: 1.36,
    }, "band-mid-high");
  }
  if (motif === "halo-cell" || episodeIntent === "garden-repopulation") {
    return makeProfile("halo-cell", "alex-grey+android-jones", ["cloud", "heart", "teardrop", "lens", "circle"], ["teardrop", "cloud", "heart", "lens"], ["arc", "chevron"], "solid", "petal", "glide", 0.96, {
      gracefulSpin: 0.08,
      glitchSpin: 0.72,
      jerkStrength: 0.1,
    }, {
      x: 0,
      y: 0.04,
      xRange: 0.24,
      yRange: 0.26,
    }, {
      min: 1.8,
      max: 2.4,
    }, "wide", "warm-white", {
      core: 1.22,
      shell: 1.16,
      particles: 1.16,
    }, {
      sizeBias: { min: 0.34, max: 0.78 },
      speedBias: { min: 0.16, max: 0.48 },
      fadeBias: { min: 0.44, max: 0.8 },
      warpBias: { min: 0.4, max: 0.86 },
      inconsistencyBias: { min: 0.26, max: 0.8 },
      gravityBias: { min: 0.22, max: 0.7 },
      densityBias: { min: 0.34, max: 0.78 },
      dragBias: { min: 0.38, max: 0.68 },
    }, {
      coreScale: 1.16,
      coreAlpha: 1.15,
      outlineAlpha: 0.98,
      contrastLift: 0.12,
      particleScale: 2.1,
      particleSpeed: 1.68,
      particleFade: 1.2,
    }, "continuous");
  }
  if (motif === "mandelbloom") {
    return makeProfile("mandelbloom", "mandelbrot+kerry-mitchell+karl-sims", ["spiral", "star", "lens", "hexagram"], ["diamond", "lens", "star"], ["arc", "spiral", "diamond"], "stroke-fill", "pulse", "ritual-orbit", 1.04, {
      gracefulSpin: 0.2,
      glitchSpin: 1.0,
      jerkStrength: 0.16,
    }, {
      x: 0.03,
      y: -0.03,
      xRange: 0.28,
      yRange: 0.24,
    }, { min: 1.9, max: 2.7 }, "wide", "cool-white", { core: 1.18, shell: 1.12, particles: 1.12 }, {
      sizeBias: { min: 0.28, max: 0.76 },
      speedBias: { min: 0.24, max: 0.68 },
      fadeBias: { min: 0.46, max: 0.88 },
      warpBias: { min: 0.42, max: 0.84 },
      inconsistencyBias: { min: 0.2, max: 0.7 },
      gravityBias: { min: 0.08, max: 0.34 },
      densityBias: { min: 0.36, max: 0.82 },
      dragBias: { min: 0.22, max: 0.46 },
    }, {
      coreScale: 1.18, coreAlpha: 1.14, outlineAlpha: 1.08, contrastLift: 0.14, particleScale: 2.12, particleSpeed: 1.82, particleFade: 1.24,
    }, "phasic-quarter");
  }
  if (motif === "data-cathedral") {
    return makeProfile("data-cathedral", "refik-anadol+ryoji-ikeda", ["rectangle", "hexagon", "lens", "diamond"], ["hexagon", "diamond", "lens"], ["line", "chevron", "arc"], "stroke-fill", "tilt", "tightrope", 1.2, {
      gracefulSpin: 0.26, glitchSpin: 1.18, jerkStrength: 0.16,
    }, {
      x: 0, y: -0.06, xRange: 0.16, yRange: 0.1,
    }, { min: 1.5, max: 1.85 }, "tight", "cool-white", { core: 1.24, shell: 1.22, particles: 1.1 }, {
      sizeBias: { min: 0.3, max: 0.68 }, speedBias: { min: 0.26, max: 0.62 }, fadeBias: { min: 0.48, max: 0.84 }, warpBias: { min: 0.34, max: 0.72 }, inconsistencyBias: { min: 0.16, max: 0.54 }, gravityBias: { min: 0.06, max: 0.26 }, densityBias: { min: 0.32, max: 0.74 }, dragBias: { min: 0.3, max: 0.54 },
    }, {
      coreScale: 1.16, coreAlpha: 1.18, outlineAlpha: 1.12, contrastLift: 0.16, particleScale: 1.74, particleSpeed: 1.84, particleFade: 1.2,
    }, "all-band-split");
  }
  if (motif === "chromatic-xylem") {
    return makeProfile("chromatic-xylem", "android-jones+alex-grey+venosa", ["teardrop", "cloud", "heart", "lens"], ["teardrop", "cloud", "circle"], ["teardrop", "arc", "star"], "solid", "petal", "glide", 0.98, {
      gracefulSpin: 0.12, glitchSpin: 0.82, jerkStrength: 0.12,
    }, {
      x: 0, y: 0.02, xRange: 0.26, yRange: 0.28,
    }, { min: 1.8, max: 2.6 }, "wide", "warm-white", { core: 1.3, shell: 1.22, particles: 1.24 }, {
      sizeBias: { min: 0.34, max: 0.82 }, speedBias: { min: 0.22, max: 0.62 }, fadeBias: { min: 0.44, max: 0.84 }, warpBias: { min: 0.42, max: 0.86 }, inconsistencyBias: { min: 0.28, max: 0.82 }, gravityBias: { min: 0.2, max: 0.66 }, densityBias: { min: 0.36, max: 0.84 }, dragBias: { min: 0.36, max: 0.68 },
    }, {
      coreScale: 1.22, coreAlpha: 1.2, outlineAlpha: 1.02, contrastLift: 0.18, particleScale: 2.18, particleSpeed: 1.76, particleFade: 1.24,
    }, "band-low");
  }
  if (motif === "vector-incantation") {
    return makeProfile("vector-incantation", "casey-reas+joshua-davis+lia", ["chevron", "diamond", "hexagon", "line"], ["diamond", "hexagon", "lens"], ["line", "chevron", "diamond"], "stroke-fill", "tilt", "swerve", 1.08, {
      gracefulSpin: 0.22, glitchSpin: 1.22, jerkStrength: 0.2,
    }, {
      x: 0.02, y: 0, xRange: 0.24, yRange: 0.14,
    }, { min: 1.6, max: 2.1 }, "medium", "cool-white", { core: 1.18, shell: 1.12, particles: 1.14 }, {
      sizeBias: { min: 0.28, max: 0.72 }, speedBias: { min: 0.32, max: 0.76 }, fadeBias: { min: 0.46, max: 0.86 }, warpBias: { min: 0.34, max: 0.8 }, inconsistencyBias: { min: 0.22, max: 0.7 }, gravityBias: { min: 0.08, max: 0.3 }, densityBias: { min: 0.34, max: 0.8 }, dragBias: { min: 0.24, max: 0.48 },
    }, {
      coreScale: 1.14, coreAlpha: 1.16, outlineAlpha: 1.08, contrastLift: 0.14, particleScale: 1.92, particleSpeed: 1.9, particleFade: 1.18,
    }, "all-band-split");
  }
  if (motif === "harmonic-lattice") {
    return makeProfile("harmonic-lattice", "john-whitney+julius-horsthuis+william-latham", ["ring", "lens", "hexagon", "ellipse"], ["lens", "ellipse", "hexagon"], ["arc", "ring", "diamond"], "ring-fill", "pulse", "ritual-orbit", 1.06, {
      gracefulSpin: 0.34, glitchSpin: 1.02, jerkStrength: 0.1,
    }, {
      x: 0, y: 0, xRange: 0.18, yRange: 0.12,
    }, { min: 1.5, max: 1.95 }, "tight", "cool-white", { core: 1.16, shell: 1.18, particles: 1.08 }, {
      sizeBias: { min: 0.24, max: 0.62 }, speedBias: { min: 0.22, max: 0.58 }, fadeBias: { min: 0.48, max: 0.82 }, warpBias: { min: 0.3, max: 0.68 }, inconsistencyBias: { min: 0.14, max: 0.48 }, gravityBias: { min: 0.04, max: 0.22 }, densityBias: { min: 0.28, max: 0.68 }, dragBias: { min: 0.34, max: 0.58 },
    }, {
      coreScale: 1.14, coreAlpha: 1.14, outlineAlpha: 1.1, contrastLift: 0.12, particleScale: 1.76, particleSpeed: 1.74, particleFade: 1.18,
    }, "phasic-quarter");
  }
  if (motif === "film-bloom-shard") {
    return makeProfile("film-bloom-shard", "brakhage+lillian-schwartz+beeple", ["lightning", "star", "kite", "parallelogram"], ["diamond", "kite", "star"], ["lightning", "chevron", "arc"], "stroke-fill", "shear", "glitch-hop", 1.1, {
      gracefulSpin: 0.18, glitchSpin: 2.28, jerkStrength: 0.48,
    }, {
      x: 0.1, y: -0.06, xRange: 0.34, yRange: 0.24,
    }, { min: 2.1, max: 3.0 }, "extreme", "white-bleach", { core: 1.26, shell: 1.18, particles: 1.2 }, {
      sizeBias: { min: 0.24, max: 0.7 }, speedBias: { min: 0.42, max: 0.98 }, fadeBias: { min: 0.54, max: 0.94 }, warpBias: { min: 0.5, max: 0.98 }, inconsistencyBias: { min: 0.4, max: 1 }, gravityBias: { min: 0.1, max: 0.38 }, densityBias: { min: 0.4, max: 0.92 }, dragBias: { min: 0.12, max: 0.32 },
    }, {
      coreScale: 1.2, coreAlpha: 1.18, outlineAlpha: 1.08, contrastLift: 0.16, particleScale: 2.4, particleSpeed: 2.08, particleFade: 1.34,
    }, "band-mid-high");
  }
  return makeProfile(`${motif}:${intent}`, "laposky+nake+verostko", profile.shapeBias === "ring" ? ["ellipse", "lens", "diamond", "ring"] : ["diamond", "hexagon", "lens", "kite"], ["diamond", "lens", "hexagon", "teardrop"], ["chevron", "arrow", "arc"], profile.shapeBias === "ring" ? "ring-fill" : "stroke-fill", profile.edgeDensity > 0.36 ? "tilt" : "pulse", profile.symmetry > 0.58 ? "tightrope" : "swerve", 1, {
    gracefulSpin: profile.symmetry > 0.58 ? 0.16 : 0.22,
    glitchSpin: 1.12,
    jerkStrength: 0.18,
  }, {
    x: 0,
    y: 0,
    xRange: 0.2,
    yRange: 0.16,
  }, {
    min: 1.6,
    max: 2.1,
  }, "medium", "white-bleach", {
    core: 1.14,
    shell: 1.1,
    particles: 1.08,
  }, {
    sizeBias: { min: 0.24, max: 0.64 },
    speedBias: { min: 0.2, max: 0.58 },
    fadeBias: { min: 0.44, max: 0.82 },
    warpBias: { min: 0.28, max: 0.72 },
    inconsistencyBias: { min: 0.18, max: 0.66 },
    gravityBias: { min: 0.08, max: 0.4 },
    densityBias: { min: 0.26, max: 0.72 },
    dragBias: { min: 0.28, max: 0.54 },
  }, {
    coreScale: 1.12,
    coreAlpha: 1.1,
    outlineAlpha: 1.02,
    contrastLift: 0.1,
    particleScale: 1.84,
    particleSpeed: 1.72,
    particleFade: 1.18,
  }, "continuous");
}

function buildHeroTravelStyle(
  motifProfile: HeroMotifProfile,
  edgeMap: EdgeMap,
  theme: RenderTheme,
): HeroTravelStyle {
  const gracefulBase =
    motifProfile.motionBias === "tightrope" ? 0.82 :
    motifProfile.motionBias === "ritual-orbit" ? 0.76 :
    motifProfile.motionBias === "glide" ? 0.72 :
    motifProfile.motionBias === "swerve" ? 0.58 :
    0.24;
  const gracefulBias = clamp(gracefulBase + theme.styleProfile.symmetry * 0.06 - (edgeMap.maskConfidence === "low" ? 0.16 : 0), 0, 1);
  return {
    gracefulBias,
    glitchBias: clamp(1 - gracefulBias, 0, 1),
    pathSmoothing: clamp(0.18 + gracefulBias * 0.1, 0.18, 0.3),
    targetSmoothing: clamp(0.16 + gracefulBias * 0.1, 0.16, 0.26),
    warpProbability: clamp(0.18 + (1 - gracefulBias) * 0.38 + (edgeMap.fractalMotif === "shattered-arc" ? 0.1 : 0), 0.08, 0.62),
    deformJitter: clamp(0.18 + (1 - gracefulBias) * 0.48, 0.12, 0.66),
    landingIntent: clamp(0.36 + gracefulBias * 0.46, 0.3, 0.88),
    warpXBand: motifProfile.warpProfile.xBand,
    warpYBand: motifProfile.warpProfile.yBand,
    warpXBaseMultiplier: motifProfile.warpProfile.xBaseMultiplier,
    warpYBaseMultiplier: motifProfile.warpProfile.yBaseMultiplier,
    warpXExtremeMultiplier: motifProfile.warpProfile.xExtremeMultiplier,
    warpYExtremeMultiplier: motifProfile.warpProfile.yExtremeMultiplier,
    lowDbMoveScale: 0.4,
    lowDbEmissionScale: 0.4,
    lowDbFreezeOnDrop: true,
    lowDbDropThreshold: 0.35,
  };
}

function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function pointAt(points: HeroPathPoint[], index: number): HeroPathPoint {
  return points[Math.max(0, Math.min(points.length - 1, index))]!;
}

function stableFloat(seed: number): number {
  return seedToUnitFloat(seed);
}

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function preferredExpandedBandsForMotif(
  motif: EdgeMap["fractalMotif"],
  continuitySeed: number,
): HeroExpandedBand[] {
  const base: HeroExpandedBand[] = ["low", "mid", "high"];
  const extras: HeroExpandedBand[] =
    motif === "smoke-ribbon" || motif === "glass-orbital"
      ? ["subLow", "highMid"]
      : motif === "data-cathedral" || motif === "harmonic-lattice" || motif === "cathedral-filament"
        ? ["highMid", "subLow"]
        : stableFloat(continuitySeed + motif.length) > 0.5
          ? ["subLow", "highMid"]
          : ["highMid"];
  return Array.from(new Set([...base, ...extras])).slice(0, 5);
}

function chooseHeroConductorSelection(
  motif: EdgeMap["fractalMotif"],
  intensityClass: HeroMotifProfile["intensityClass"],
  selectionSeed: number,
  episodeIntent?: EpisodeIntent,
): HeroConductorSelection {
  const reflectiveIntent =
    episodeIntent === "catoptric-duet" ||
    episodeIntent === "mirror-procession" ||
    episodeIntent === "kaleido-coronation" ||
    episodeIntent === "quad-vigil" ||
    episodeIntent === "prism-tribunal" ||
    episodeIntent === "mirror-corridor" ||
    episodeIntent === "mirror-sermon";
  const pool = HERO_CONDUCTOR_SPECS.filter(
    (spec) =>
      spec.preferredMotifs.includes(motif) &&
      (!reflectiveIntent ||
        spec.id === "mirror-choir" ||
        spec.id === "catoptric-weaver" ||
        spec.id === "axis-orrery" ||
        spec.id === "prism-synod" ||
        spec.id === "kaleido-lantern" ||
        spec.id === "vigil-ring" ||
        spec.id === "transit-orrery" ||
        spec.id === "braid-procession"),
  );
  const resolvedPool = pool.length > 0 ? pool : HERO_CONDUCTOR_SPECS;
  const primary = weightedPickBySeed(
    resolvedPool,
    deriveSeed(selectionSeed, `primary:${motif}:${episodeIntent ?? "none"}:${intensityClass}`),
    (spec) => {
      const motifBias = spec.preferredMotifs.includes(motif) ? 1.5 : 1;
      const reflectiveBias = spec.selectionTags?.includes("reflective") ? 1.5 : 1;
      return (spec.selectionWeight ?? 1) * motifBias * reflectiveBias;
    },
  );
  const secondaryPool = resolvedPool.filter((spec) => spec.id !== primary.id);
  const secondary = secondaryPool.length > 0
    ? weightedPickBySeed(
        secondaryPool,
        deriveSeed(selectionSeed, `secondary:${motif}:${episodeIntent ?? "none"}:${intensityClass}`),
        (spec) => {
          const motifBias = spec.preferredMotifs.includes(motif) ? 1.35 : 1;
          const reflectiveBias = spec.selectionTags?.includes("reflective") ? 1.5 : 1;
          return (spec.selectionWeight ?? 1) * motifBias * reflectiveBias;
        },
      ).id
    : undefined;
  const densitySeed = deriveSeed(selectionSeed, `density:${motif}:${episodeIntent ?? "none"}:${intensityClass}`);
  const density =
    intensityClass === "restrained" ? 0.08 + seedToUnitFloat(densitySeed) * 0.04 :
    intensityClass === "colorful-psychedelic" ? 0.14 + seedToUnitFloat(densitySeed) * 0.04 :
    0.11 + seedToUnitFloat(densitySeed) * 0.04;
  return {
    primary: primary.id,
    secondary,
    density: clamp(density, 0.08, 0.18),
    influenceRadiusScale: clamp(primary.radiusScale * (intensityClass === "colorful-psychedelic" ? 1.08 : 0.96), 0.78, 1.24),
    strengthScale: clamp(primary.strength * (intensityClass === "restrained" ? 0.92 : 1.04), 0.48, 0.88),
  };
}

function selectHeroCircleEmitterNodeIndices(
  supportCount: number,
  backgroundCount: number,
  selectionSeed: number,
): number[] {
  const total = supportCount + backgroundCount;
  if (total <= 0) {
    return [];
  }
  const target = Math.max(1, Math.round(total * 0.3));
  const ranked = Array.from({ length: total }, (_, index) => ({
    index,
    weight: seedToUnitFloat(deriveSeed(selectionSeed, index)),
  }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, target)
    .map((entry) => entry.index)
    .sort((a, b) => a - b);
  return ranked;
}

function chooseHeroRelationshipMode(
  base: HeroRelationshipMode,
  key: string,
  episodeIntent: EpisodeIntent,
  relationshipClass: "symmetric" | "independent" | "attracted_repulsed" | "codependent",
  relationshipSeed: number,
  clusterCount: number,
): HeroRelationshipMode {
  if (clusterCount <= 1) {
    return "independent";
  }
  if (relationshipClass === "codependent") {
    return "cojoined";
  }
  const pickFrom = (options: HeroRelationshipMode[], label: string): HeroRelationshipMode => {
    const unique = Array.from(new Set(options));
    return unique[pickIndex(deriveSeed(relationshipSeed, `${label}:${key}:${episodeIntent}`), unique.length)] ?? unique[0] ?? base;
  };
  if (relationshipClass === "symmetric") {
    return pickFrom(["mirror-x", "mirror-y", "mirror-xy"], "symmetric");
  }
  if (episodeIntent === "catoptric-duet") {
    return "mirror-x";
  }
  if (episodeIntent === "mirror-procession") {
    return "mirror-y";
  }
  if (episodeIntent === "kaleido-coronation" || episodeIntent === "quad-vigil") {
    return "mirror-xy";
  }
  if (episodeIntent === "prism-tribunal") {
    return "mirror-x";
  }
  if (episodeIntent === "mirror-corridor") {
    return pickFrom(["mirror-x", "mirror-y"], "mirror-corridor");
  }
  if (episodeIntent === "mirror-sermon") {
    return "mirror-xy";
  }
  if (episodeIntent === "machine-communion") {
    return pickFrom(["cojoined", "independent"], "machine-communion");
  }
  if (episodeIntent === "psychedelic-procession") {
    return pickFrom(["cojoined", "independent"], "psychedelic-procession");
  }
  if (key === "glass-orbital" || key === "harmonic-lattice") {
    return pickFrom([base, "cojoined"], "orbital-lattice");
  }
  if (key === "data-cathedral") {
    return pickFrom(["mirror-y", "mirror-x"], "data-cathedral");
  }
  return base;
}

function chooseHeroRelationshipClass(
  compositionPlan: CompositionPlan,
  relationshipSeed: number,
  clusterCount: number,
): "symmetric" | "independent" | "attracted_repulsed" | "codependent" {
  if (clusterCount <= 1) {
    return "independent";
  }
  const biasLabel = `${Math.round(compositionPlan.centerBiasScore * 100)}:${Math.round(compositionPlan.focalOccupancyScore * 100)}`;
  const index = pickIndex(deriveSeed(relationshipSeed, biasLabel), 4);
  return (["symmetric", "independent", "attracted_repulsed", "codependent"] as const)[index]!;
}

export function buildTransitionIdentitySignature(sceneGraph: Pick<SceneGraph, "heroMotifProfile" | "heroPrimitive" | "heroInstanceSeed" | "heroClusterConfig" | "heroMotifVariant">): string {
  return [
    sceneGraph.heroMotifProfile.key,
    sceneGraph.heroPrimitive,
    sceneGraph.heroInstanceSeed.emitterTopology,
    sceneGraph.heroClusterConfig.relationshipMode,
    sceneGraph.heroMotifVariant.key,
  ].join("|");
}

function transitionMotifCandidates(
  current: SceneGraph,
  edgeMap: EdgeMap,
  theme: RenderTheme,
): HeroMotifProfile[] {
  const motifOrder: EdgeMap["fractalMotif"][] = [
    "glass-orbital",
    "harmonic-lattice",
    "data-cathedral",
    "halo-cell",
    "mandelbloom",
    "smoke-ribbon",
    "chromatic-xylem",
    "vector-incantation",
    "shattered-arc",
    "film-bloom-shard",
  ];
  return motifOrder
    .map((motif) => buildHeroMotifProfile("orbit-ritual", motif, current.episodeSeed.episodeIntent, theme))
    .filter((profile, index, profiles) => profile.key !== current.heroMotifProfile.key && profiles.findIndex((candidate) => candidate.key === profile.key) === index);
}

function weightedRangeValue(range: { min: number; max: number }, seed: number): number {
  return clamp(range.min + stableFloat(seed) * (range.max - range.min), 0, 1);
}

function describeHeroMotifVariant(variant: HeroMotifVariant): string {
  const candidates = [
    { label: variant.sizeWeight > 0.66 ? "grown" : variant.sizeWeight < 0.34 ? "shrunk" : "average-sized", score: Math.abs(variant.sizeWeight - 0.5) },
    { label: variant.speedWeight > 0.72 ? "needle-fast" : variant.speedWeight < 0.3 ? "floating" : "surging", score: Math.abs(variant.speedWeight - 0.5) },
    { label: variant.fadeWeight > 0.7 ? "flash-fade" : "lingering", score: Math.abs(variant.fadeWeight - 0.5) },
    { label: variant.warpWeight > 0.68 ? "sheared" : "clean", score: Math.abs(variant.warpWeight - 0.5) },
    { label: variant.inconsistencyWeight > 0.64 ? "ragged" : "clean", score: Math.abs(variant.inconsistencyWeight - 0.5) },
    { label: variant.gravityWeight > 0.62 ? "gravity-pulled" : "floating", score: Math.abs(variant.gravityWeight - 0.5) },
    { label: variant.densityWeight > 0.68 ? "blooming" : "underfed", score: Math.abs(variant.densityWeight - 0.5) },
    { label: variant.dragWeight > 0.66 ? "sticky" : variant.dragWeight < 0.34 ? "slippery" : "steady", score: Math.abs(variant.dragWeight - 0.5) },
  ].sort((a, b) => b.score - a.score);
  return candidates[0]?.label ?? "average-sized";
}

function buildHeroMotifVariant(
  motifProfile: HeroMotifProfile,
  edgeMap: EdgeMap,
  theme: RenderTheme,
  variantSeed: number,
  episodeSeed: EpisodeSeed,
  intentSeed: NodeIntentSeed,
): HeroMotifVariant {
  const baseSeed = stableHash32([
    variantSeed,
    edgeMap.imagePath,
    motifProfile.key,
    theme.styleProfile.imagePath,
    Math.round(theme.styleProfile.symmetry * 1000),
    Math.round(theme.styleProfile.edgeDensity * 1000),
    episodeSeed.episodeIntent,
    intentSeed.intent,
  ].join("|"));
  const variant: HeroMotifVariant = {
    key: "",
    sizeWeight: weightedRangeValue(motifProfile.variantAxes.sizeBias, deriveSeed(baseSeed, "size")),
    speedWeight: weightedRangeValue(motifProfile.variantAxes.speedBias, deriveSeed(baseSeed, "speed")),
    fadeWeight: weightedRangeValue(motifProfile.variantAxes.fadeBias, deriveSeed(baseSeed, "fade")),
    warpWeight: weightedRangeValue(motifProfile.variantAxes.warpBias, deriveSeed(baseSeed, "warp")),
    inconsistencyWeight: weightedRangeValue(motifProfile.variantAxes.inconsistencyBias, deriveSeed(baseSeed, "inconsistency")),
    gravityWeight: weightedRangeValue(motifProfile.variantAxes.gravityBias, deriveSeed(baseSeed, "gravity")),
    densityWeight: weightedRangeValue(motifProfile.variantAxes.densityBias, deriveSeed(baseSeed, "density")),
    dragWeight: weightedRangeValue(motifProfile.variantAxes.dragBias, deriveSeed(baseSeed, "drag")),
  };
  variant.key = describeHeroMotifVariant(variant);
  return variant;
}

function imageSequenceOrdinal(imagePath: string): number {
  const match = /(?:^|[\\/])(\d{3,})[-_]/.exec(imagePath);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function buildPathTemplate(
  template: "processional-ladder" | "broken-lemniscate" | "crown-arc" | "ritual-spiral" | "off-axis-zig" | "corridor-recede",
  edgeMap: EdgeMap,
  compositionPlan: CompositionPlan,
): Array<{ x: number; y: number }> {
  const width = edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX;
  const height = edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY;
  const radius = clamp(Math.max(width, height) * 0.16, 24, compositionPlan.heroRadius * 0.82);
  const cx = compositionPlan.heroCenterX;
  const cy = compositionPlan.heroCenterY;
  const points: Array<{ x: number; y: number }> = [];
  switch (template) {
    case "processional-ladder":
      points.push({ x: cx, y: cy - radius * 0.95 }, { x: cx - radius * 0.18, y: cy - radius * 0.3 }, { x: cx + radius * 0.18, y: cy + radius * 0.24 }, { x: cx, y: cy + radius * 0.96 });
      break;
    case "broken-lemniscate":
      points.push({ x: cx - radius * 0.82, y: cy - radius * 0.18 }, { x: cx, y: cy - radius * 0.58 }, { x: cx + radius * 0.8, y: cy + radius * 0.18 }, { x: cx, y: cy + radius * 0.58 });
      break;
    case "crown-arc":
      points.push({ x: cx - radius * 0.86, y: cy + radius * 0.24 }, { x: cx - radius * 0.36, y: cy - radius * 0.72 }, { x: cx + radius * 0.36, y: cy - radius * 0.8 }, { x: cx + radius * 0.9, y: cy + radius * 0.18 });
      break;
    case "ritual-spiral":
      points.push({ x: cx - radius * 0.2, y: cy - radius * 0.2 }, { x: cx + radius * 0.54, y: cy - radius * 0.38 }, { x: cx + radius * 0.24, y: cy + radius * 0.52 }, { x: cx - radius * 0.66, y: cy + radius * 0.3 });
      break;
    case "off-axis-zig":
      points.push({ x: cx - radius * 0.78, y: cy - radius * 0.4 }, { x: cx + radius * 0.22, y: cy - radius * 0.82 }, { x: cx - radius * 0.1, y: cy + radius * 0.12 }, { x: cx + radius * 0.74, y: cy + radius * 0.76 });
      break;
    case "corridor-recede":
    default:
      points.push({ x: cx, y: cy - radius * 0.82 }, { x: cx - radius * 0.12, y: cy - radius * 0.18 }, { x: cx + radius * 0.08, y: cy + radius * 0.28 }, { x: cx, y: cy + radius * 0.9 });
      break;
  }
  for (const slot of compositionPlan.supportSlots.slice(0, 2)) {
    points.push({
      x: cx + (slot.x - cx) * 0.22,
      y: cy + (slot.y - cy) * 0.22,
    });
  }
  return points.map((point) => ({
    x: clamp(point.x, edgeMap.subjectBounds.minX - radius * 0.25, edgeMap.subjectBounds.maxX + radius * 0.25),
    y: clamp(point.y, edgeMap.subjectBounds.minY - radius * 0.25, edgeMap.subjectBounds.maxY + radius * 0.25),
  }));
}

function buildHeroPath(edgeMap: EdgeMap, compositionPlan: CompositionPlan, template: "processional-ladder" | "broken-lemniscate" | "crown-arc" | "ritual-spiral" | "off-axis-zig" | "corridor-recede"): HeroPathPoint[] {
  const width = edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX;
  const height = edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY;
  const radius = clamp(Math.max(width, height) * 0.16, 24, compositionPlan.heroRadius * 0.82);
  const points = buildPathTemplate(template, edgeMap, compositionPlan);
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const tangent = normalize(next.x - previous.x, next.y - previous.y);
    return {
      x: point.x,
      y: point.y,
      tangentX: tangent.x,
      tangentY: tangent.y,
      radius: radius * (index === 0 ? 1 : 0.8 + ((index % 3) * 0.08)),
    };
  });
}

function glyphFamiliesForArchetype(archetype: HeroArchetype): HeroGlyphKind[] {
  switch (archetype) {
    case "oracle-mask":
      return ["mask", "eye", "crown", "stair"];
    case "electric-seraph":
      return ["wing", "lightning", "halo", "glint"];
    case "corridor-witness":
      return ["eye", "gate", "stair", "glint"];
    case "ritual-engine":
      return ["sigil", "totem", "halo", "hand"];
    case "fractured-rider":
      return ["fang", "kite", "star", "lightning"];
    case "petal-devourer":
      return ["rose", "crescent", "fang", "eye"];
    case "laughing-mandala":
      return ["infinity", "halo", "eye", "blob"];
    case "void-guitarist":
    default:
      return ["lightning", "wing", "star", "glint"];
  }
}

function makeDirective(
  spawnMode: LayerDirective["spawnMode"],
  targetMode: LayerDirective["targetMode"],
  motionScript: LayerDirective["motionScript"],
  shapeFamilies: ShapeFamilyToken[],
  densityRange: [number, number],
  dominance: number,
  lingerPenalty: number,
): LayerDirective {
  return { spawnMode, targetMode, motionScript, shapeFamilies, densityRange, dominance, lingerPenalty };
}

function chooseIntent(edgeMap: EdgeMap, theme: RenderTheme, compositionPlan: CompositionPlan): NodeIntent {
  const profile = theme.styleProfile;
  const centrality =
    1 -
    Math.min(
      1,
      Math.hypot(
        compositionPlan.heroCenterX - edgeMap.width * 0.5,
        compositionPlan.heroCenterY - edgeMap.height * 0.5,
      ) / Math.max(1, Math.min(edgeMap.width, edgeMap.height) * 0.35),
    );
  const strongLanes = compositionPlan.supportSlots.length >= 3 || edgeMap.silhouetteContours.length >= 2;
  if (profile.contrast < 0.18 && edgeMap.fractalMotif === "smoke-ribbon") {
    return profile.saturationMean < 0.34 ? "repopulation" : "rambunctious-play";
  }
  if (centrality > 0.72 && profile.symmetry > 0.58) {
    return strongLanes ? "follow-the-path" : "cathedral-procession";
  }
  if (profile.edgeDensity > 0.42 && (edgeMap.fractalMotif === "shattered-arc" || theme.styleMode === "shard")) {
    return profile.saturationMean > 0.5 ? "dj-rave" : "fireworks";
  }
  if (profile.contrast > 0.34 && centrality > 0.58 && edgeMap.negativeSpaceQuadrant === "center") {
    return "cosmic-collapse";
  }
  if (strongLanes) {
    return profile.hueVariance > 0.2 ? "signal-braid" : "follow-the-path";
  }
  if (edgeMap.fractalMotif === "glass-orbital" || edgeMap.fractalMotif === "halo-cell") {
    return "orbit-ritual";
  }
  return theme.styleProfile.warmCoolBias < 0 ? "vortex-release" : "rambunctious-play";
}

function directivesForIntent(intent: NodeIntent): Pick<NodeIntentSeed, "heroDirective" | "supportDirective" | "backgroundDirective"> {
  switch (intent) {
    case "cosmic-collapse":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "spiral-in", ["spiral", "crescent", "glint"], [0.12, 0.24], 1, 0.7),
        supportDirective: makeDirective("support-lane", "support-attractors", "dual-well", ["shard", "ring"], [0.08, 0.18], 0.68, 0.82),
        backgroundDirective: makeDirective("edge-field", "edge-release", "edge-fog", ["arc", "fallout-arc"], [0.04, 0.1], 0.36, 0.9),
      };
    case "follow-the-path":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "follow-hero", ["chevron", "glint", "infinity"], [0.12, 0.22], 1, 0.68),
        supportDirective: makeDirective("support-lane", "paired-attractors", "braid-lane", ["chevron", "braid-marker", "arc"], [0.08, 0.18], 0.64, 0.78),
        backgroundDirective: makeDirective("edge-field", "background-attractors", "signal-drift", ["arc", "arc-haze"], [0.03, 0.09], 0.32, 0.88),
      };
    case "dj-rave":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "orbit-anchor", ["star", "glint", "hexagon"], [0.12, 0.24], 1, 0.72),
        supportDirective: makeDirective("support-lane", "support-attractors", "emit-to-edge", ["shard", "ring", "chevron"], [0.1, 0.22], 0.72, 0.76),
        backgroundDirective: makeDirective("scatter-field", "background-attractors", "burst-falloff", ["pulse-shard", "dot", "arc"], [0.05, 0.14], 0.42, 0.84),
      };
    case "fireworks":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "follow-hero", ["star", "rose", "shard"], [0.12, 0.24], 1, 0.7),
        supportDirective: makeDirective("support-lane", "support-attractors", "emit-to-edge", ["dot", "shard", "arc"], [0.08, 0.22], 0.68, 0.74),
        backgroundDirective: makeDirective("scatter-field", "edge-release", "burst-falloff", ["fallout-arc", "dot"], [0.06, 0.14], 0.4, 0.84),
      };
    case "orbit-ritual":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "orbit-anchor", ["rose", "hexagon", "crescent"], [0.1, 0.2], 1, 0.5),
        supportDirective: makeDirective("support-lane", "support-attractors", "orbit-anchor", ["ring", "arc", "cell-cluster"], [0.08, 0.18], 0.66, 0.48),
        backgroundDirective: makeDirective("edge-field", "background-attractors", "signal-drift", ["arc-haze", "dot"], [0.03, 0.08], 0.28, 0.8),
      };
    case "cathedral-procession":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "follow-hero", ["glint", "rose", "hexagon"], [0.1, 0.2], 1, 0.46),
        supportDirective: makeDirective("support-lane", "paired-attractors", "escort", ["arc", "braid-marker", "ring"], [0.08, 0.18], 0.72, 0.52),
        backgroundDirective: makeDirective("edge-field", "background-attractors", "edge-fog", ["arc-haze", "dot"], [0.02, 0.06], 0.24, 0.86),
      };
    case "signal-braid":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "braid-lane", ["chevron", "glint", "infinity"], [0.1, 0.22], 1, 0.68),
        supportDirective: makeDirective("support-lane", "paired-attractors", "braid-lane", ["chevron", "braid-marker", "diamond"], [0.08, 0.18], 0.7, 0.72),
        backgroundDirective: makeDirective("edge-field", "background-attractors", "signal-drift", ["arc", "dot"], [0.03, 0.08], 0.28, 0.88),
      };
    case "vortex-release":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "spiral-out", ["spiral", "crescent", "blob"], [0.1, 0.22], 1, 0.74),
        supportDirective: makeDirective("support-lane", "support-attractors", "dual-well", ["ring", "arc", "shard"], [0.08, 0.18], 0.62, 0.8),
        backgroundDirective: makeDirective("edge-field", "edge-release", "spiral-out", ["arc", "fallout-arc", "dot"], [0.04, 0.11], 0.34, 0.9),
      };
    case "repopulation":
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "follow-hero", ["blob", "rose", "crescent"], [0.1, 0.2], 1, 0.82),
        supportDirective: makeDirective("support-lane", "support-attractors", "escort", ["dot", "cell-cluster", "arc"], [0.08, 0.18], 0.56, 0.78),
        backgroundDirective: makeDirective("scatter-field", "background-attractors", "play-scatter", ["dot", "arc-haze"], [0.04, 0.1], 0.26, 0.9),
      };
    case "rambunctious-play":
    default:
      return {
        heroDirective: makeDirective("hero-core", "hero-path", "follow-hero", ["blob", "crescent", "star"], [0.12, 0.24], 1, 0.78),
        supportDirective: makeDirective("scatter-field", "support-attractors", "play-scatter", ["dot", "arc", "chevron"], [0.08, 0.2], 0.58, 0.82),
        backgroundDirective: makeDirective("scatter-field", "background-attractors", "play-scatter", ["dot", "arc-haze"], [0.04, 0.12], 0.3, 0.92),
      };
  }
}

function intentAtmosphereDefaults(intent: NodeIntent): Pick<
  NodeIntentSeed,
  "atmosphereMode" | "interferenceMode" | "bridgePattern" | "symmetryMode" | "negativeSpaceMode"
> {
  switch (intent) {
    case "signal-braid":
      return {
        atmosphereMode: "signal-haze",
        interferenceMode: "lane-braids",
        bridgePattern: "paired-links",
        symmetryMode: "contour-bilateral",
        negativeSpaceMode: "open-void",
      };
    case "dj-rave":
      return {
        atmosphereMode: "field-halo",
        interferenceMode: "scan-ripples",
        bridgePattern: "burst-spokes",
        symmetryMode: "shard-kaleidoscope",
        negativeSpaceMode: "punctured-void",
      };
    case "cathedral-procession":
      return {
        atmosphereMode: "stained-glow",
        interferenceMode: "arch-membranes",
        bridgePattern: "procession-lanes",
        symmetryMode: "contour-bilateral",
        negativeSpaceMode: "sacred-opening",
      };
    case "fireworks":
      return {
        atmosphereMode: "fallout-fog",
        interferenceMode: "petal-wave",
        bridgePattern: "burst-spokes",
        symmetryMode: "support-petals",
        negativeSpaceMode: "charged-silence",
      };
    case "orbit-ritual":
      return {
        atmosphereMode: "field-halo",
        interferenceMode: "phase-ripples",
        bridgePattern: "petal-chain",
        symmetryMode: "hero-wedge",
        negativeSpaceMode: "sacred-opening",
      };
    case "cosmic-collapse":
      return {
        atmosphereMode: "fallout-fog",
        interferenceMode: "phase-ripples",
        bridgePattern: "signal-cords",
        symmetryMode: "hero-wedge",
        negativeSpaceMode: "charged-silence",
      };
    case "follow-the-path":
      return {
        atmosphereMode: "signal-haze",
        interferenceMode: "lane-braids",
        bridgePattern: "procession-lanes",
        symmetryMode: "contour-bilateral",
        negativeSpaceMode: "open-void",
      };
    case "repopulation":
      return {
        atmosphereMode: "petal-bloom",
        interferenceMode: "petal-wave",
        bridgePattern: "petal-chain",
        symmetryMode: "support-petals",
        negativeSpaceMode: "charged-silence",
      };
    case "vortex-release":
      return {
        atmosphereMode: "signal-haze",
        interferenceMode: "phase-ripples",
        bridgePattern: "signal-cords",
        symmetryMode: "hero-wedge",
        negativeSpaceMode: "charged-silence",
      };
    case "rambunctious-play":
    default:
      return {
        atmosphereMode: "petal-bloom",
        interferenceMode: "petal-wave",
        bridgePattern: "petal-chain",
        symmetryMode: "support-petals",
        negativeSpaceMode: "charged-silence",
      };
  }
}

function midScaleFamiliesForIntent(intent: NodeIntent): ShapeFamilyToken[] {
  switch (intent) {
    case "signal-braid":
      return ["braid-marker", "arc", "diamond", "arc-haze"];
    case "dj-rave":
      return ["pulse-shard", "ring", "glint", "arc"];
    case "cathedral-procession":
      return ["arc", "rose", "ring", "glint"];
    case "fireworks":
      return ["star", "pulse-shard", "fallout-arc", "arc"];
    case "orbit-ritual":
      return ["ring", "rose", "crescent", "arc"];
    case "cosmic-collapse":
      return ["spiral", "crescent", "ring", "fallout-arc"];
    case "follow-the-path":
      return ["chevron", "braid-marker", "arc", "glint"];
    case "repopulation":
      return ["cell-cluster", "rose", "arc-haze", "dot"];
    case "vortex-release":
      return ["spiral", "fallout-arc", "arc", "dot"];
    case "rambunctious-play":
    default:
      return ["blob", "star", "arc", "dot"];
  }
}

function chooseEpisodeIntent(intent: NodeIntent, edgeMap: EdgeMap, theme: RenderTheme): EpisodeIntent {
  const profile = theme.styleProfile;
  switch (intent) {
    case "follow-the-path":
    case "cathedral-procession":
      return profile.symmetry > 0.78 ? "mirror-procession" : profile.symmetry > 0.6 ? "mirror-sermon" : "psychedelic-procession";
    case "signal-braid":
      return profile.symmetry > 0.76 ? "prism-tribunal" : profile.symmetry > 0.6 ? "mirror-corridor" : "machine-communion";
    case "fireworks":
      return profile.saturationMean > 0.52 ? "electric-funeral" : "royal-decapitation";
    case "orbit-ritual":
      return edgeMap.fractalMotif === "glass-orbital" && profile.symmetry > 0.72 ? "kaleido-coronation" : edgeMap.fractalMotif === "glass-orbital" ? "neon-bardo" : "catoptric-duet";
    case "repopulation":
      return "garden-repopulation";
    case "cosmic-collapse":
      return profile.symmetry > 0.74 ? "quad-vigil" : profile.contrast > 0.3 ? "comic-occult-heist" : "cosmic-trial";
    case "vortex-release":
      return profile.symmetry > 0.7 ? "kaleido-coronation" : profile.contrast > 0.3 ? "desert-revelation" : "velvet-overload";
    case "dj-rave":
      return "electric-funeral";
    case "rambunctious-play":
    default:
      return "fool-procession";
  }
}

function accentModesForEpisode(episodeIntent: EpisodeIntent): AccentEventMode[] {
  switch (episodeIntent) {
    case "catoptric-duet":
      return ["mirror-flip", "absorbers", "emitters"];
    case "mirror-procession":
      return ["mirror-flip", "chain-transfer", "emitters"];
    case "kaleido-coronation":
      return ["mirror-flip", "petal-explosion", "burst-gate"];
    case "quad-vigil":
      return ["mirror-flip", "absorbers"];
    case "prism-tribunal":
      return ["mirror-flip", "absorbers", "chain-transfer"];
    case "rabbit-hole-drift":
      return ["emitters", "absorbers", "mirror-flip"];
    case "tea-party-chaos":
      return ["emitters", "petal-explosion", "chain-transfer"];
    case "procession-of-masks":
      return ["emitters", "chain-transfer"];
    case "mirror-corridor":
      return ["mirror-flip", "absorbers"];
    case "royal-decapitation":
      return ["burst-gate", "petal-explosion"];
    case "garden-repopulation":
      return ["emitters", "petal-explosion"];
    case "cosmic-trial":
      return ["absorbers", "burst-gate"];
    case "carnival-bloom":
      return ["emitters", "petal-explosion", "burst-gate"];
    case "electric-funeral":
      return ["emitters", "petal-explosion", "chain-transfer"];
    case "mirror-sermon":
      return ["absorbers", "mirror-flip"];
    case "desert-revelation":
      return ["emitters", "burst-gate"];
    case "neon-bardo":
      return ["emitters", "mirror-flip", "petal-explosion"];
    case "comic-occult-heist":
      return ["emitters", "chain-transfer", "mirror-flip"];
    case "velvet-overload":
      return ["absorbers", "burst-gate", "mirror-flip"];
    case "psychedelic-procession":
      return ["emitters", "chain-transfer", "petal-explosion"];
    case "machine-communion":
      return ["emitters", "absorbers", "chain-transfer"];
    case "scale-inversion":
      return ["absorbers", "mirror-flip"];
    case "fool-procession":
    default:
      return ["emitters", "chain-transfer"];
  }
}

function chooseHeroArchetype(intentSeed: NodeIntentSeed, edgeMap: EdgeMap, theme: RenderTheme, episodeIntent: EpisodeIntent): HeroArchetype {
  if (episodeIntent === "catoptric-duet" || episodeIntent === "mirror-procession" || episodeIntent === "quad-vigil") {
    return edgeMap.fractalMotif === "cathedral-filament" ? "oracle-mask" : "corridor-witness";
  }
  if (episodeIntent === "kaleido-coronation" || episodeIntent === "prism-tribunal") {
    return edgeMap.fractalMotif === "glass-orbital" ? "ritual-engine" : "laughing-mandala";
  }
  if (episodeIntent === "mirror-sermon" || episodeIntent === "mirror-corridor") {
    return edgeMap.fractalMotif === "cathedral-filament" ? "oracle-mask" : "corridor-witness";
  }
  if (episodeIntent === "electric-funeral" || intentSeed.intent === "dj-rave") {
    return edgeMap.fractalMotif === "neon-tube" || edgeMap.fractalMotif === "shattered-arc" ? "void-guitarist" : "electric-seraph";
  }
  if (episodeIntent === "desert-revelation" || episodeIntent === "velvet-overload") {
    return edgeMap.fractalMotif === "shattered-arc" ? "fractured-rider" : "petal-devourer";
  }
  if (episodeIntent === "neon-bardo" || episodeIntent === "machine-communion") {
    return edgeMap.fractalMotif === "glass-orbital" ? "ritual-engine" : "laughing-mandala";
  }
  if (episodeIntent === "garden-repopulation") {
    return "petal-devourer";
  }
  if (episodeIntent === "royal-decapitation") {
    return edgeMap.fractalMotif === "cathedral-filament" ? "oracle-mask" : "corridor-witness";
  }
  const profile = theme.styleProfile;
  switch (edgeMap.fractalMotif) {
    case "smoke-ribbon":
      return profile.saturationMean < 0.36 ? "petal-devourer" : "corridor-witness";
    case "glass-orbital":
      return "ritual-engine";
    case "cathedral-filament":
      return profile.symmetry > 0.55 ? "oracle-mask" : "corridor-witness";
    case "shattered-arc":
      return "fractured-rider";
    case "halo-cell":
      return "laughing-mandala";
    case "neon-tube":
    default:
      return profile.saturationMean > 0.45 ? "void-guitarist" : "electric-seraph";
  }
}

function chooseHeroStoryBeat(intent: NodeIntent, episodeIntent: EpisodeIntent, theme: RenderTheme): GlyphStoryBeat {
  if (episodeIntent === "catoptric-duet" || episodeIntent === "mirror-procession" || episodeIntent === "kaleido-coronation" || episodeIntent === "quad-vigil" || episodeIntent === "prism-tribunal") {
    return "duplication";
  }
  if (episodeIntent === "mirror-sermon" || episodeIntent === "mirror-corridor") {
    return "duplication";
  }
  if (episodeIntent === "electric-funeral" || intent === "dj-rave") {
    return "rupture";
  }
  if (episodeIntent === "machine-communion" || episodeIntent === "neon-bardo") {
    return "communion";
  }
  if (theme.styleProfile.contrast < 0.16) {
    return "arrival";
  }
  if (theme.styleProfile.hueVariance > 0.22) {
    return "possession";
  }
  return "invocation";
}

function chooseHeroEmissionMode(archetype: HeroArchetype, episodeIntent: EpisodeIntent): HeroEmissionMode {
  if (episodeIntent === "quad-vigil" || episodeIntent === "prism-tribunal") {
    return "hand-cascade";
  }
  if (episodeIntent === "catoptric-duet" || episodeIntent === "kaleido-coronation") {
    return "orbit-shed";
  }
  if (episodeIntent === "electric-funeral") {
    return "spine-fountain";
  }
  if (episodeIntent === "mirror-sermon") {
    return "hand-cascade";
  }
  if (episodeIntent === "desert-revelation") {
    return "mouth-flare";
  }
  if (episodeIntent === "neon-bardo") {
    return "orbit-shed";
  }
  switch (archetype) {
    case "oracle-mask":
      return "breath";
    case "electric-seraph":
      return "crown-spray";
    case "corridor-witness":
      return "hand-cascade";
    case "ritual-engine":
      return "orbit-shed";
    case "fractured-rider":
      return "mouth-flare";
    case "petal-devourer":
      return "breath";
    case "laughing-mandala":
      return "orbit-shed";
    case "void-guitarist":
    default:
      return "spine-fountain";
  }
}

function chooseSubEmitterMode(archetype: HeroArchetype, episodeIntent: EpisodeIntent): SubEmitterMode {
  if (episodeIntent === "catoptric-duet" || episodeIntent === "mirror-procession" || episodeIntent === "quad-vigil") {
    return "echo-ring";
  }
  if (episodeIntent === "kaleido-coronation" || episodeIntent === "prism-tribunal") {
    return "mask-fracture";
  }
  if (episodeIntent === "mirror-sermon") {
    return "echo-ring";
  }
  if (episodeIntent === "electric-funeral") {
    return "spark-fork";
  }
  if (episodeIntent === "desert-revelation") {
    return "dust-afterimage";
  }
  if (episodeIntent === "neon-bardo") {
    return "mask-fracture";
  }
  switch (archetype) {
    case "petal-devourer":
      return "petal-shed";
    case "fractured-rider":
      return "spark-fork";
    case "oracle-mask":
    case "corridor-witness":
      return "echo-ring";
    case "ritual-engine":
      return "mask-fracture";
    default:
      return "dust-afterimage";
  }
}

function buildHeroGlyphGrammar(archetype: HeroArchetype, storyBeat: GlyphStoryBeat, continuitySeed: number): HeroGlyphGrammar {
  const family = glyphFamiliesForArchetype(archetype);
  const variant = pickIndex(deriveSeed(continuitySeed, "glyph-tertiary"), 3);
  return {
    primary: family[0]!,
    secondary: family.slice(1, 3),
    tertiary: variant === 0 ? family.slice(2, 4) : variant === 1 ? family.slice(1, 4).reverse() : family.slice(0, 3).reverse(),
    symmetryMode:
      archetype === "corridor-witness" ? "corridor" :
      archetype === "ritual-engine" || archetype === "laughing-mandala" ? "radial" :
      archetype === "fractured-rider" || archetype === "void-guitarist" ? "off-axis" :
      "bilateral",
    deformation:
      storyBeat === "rupture" ? "tear" :
      storyBeat === "duplication" ? "corridor-recursion" :
      storyBeat === "possession" ? "mirror-slip" :
      seedToUnitFloat(deriveSeed(continuitySeed, "glyph-deformation")) > 0.5 ? "radial-bloom" : "squeeze",
    echoPolicy:
      storyBeat === "duplication" ? "recursive" :
      storyBeat === "communion" ? "bilateral" :
      seedToUnitFloat(deriveSeed(continuitySeed, "glyph-echo")) > 0.56 ? "trail" : "none",
  };
}

function buildSourceAttractorProfile(intentSeed: NodeIntentSeed, edgeMap: EdgeMap, theme: RenderTheme): SourceAttractorProfile {
  return {
    mask: clamp(0.34 + (edgeMap.maskConfidence === "high" ? 0.18 : edgeMap.maskConfidence === "medium" ? 0.1 : 0.04), 0.2, 0.58),
    edgeDensity: clamp(0.14 + theme.styleProfile.edgeDensity * 0.18, 0.08, 0.32),
    contrast: clamp(0.1 + theme.styleProfile.contrast * 0.18, 0.06, 0.28),
    luminanceGradient: 0.16,
    focalDistance: clamp(0.14 + intentSeed.pathBias * 0.12, 0.08, 0.26),
    supportLaneBoost: clamp(0.12 + intentSeed.pathBias * 0.16, 0.08, 0.32),
    silhouetteBoost: clamp(0.1 + intentSeed.heroDirective.dominance * 0.12, 0.08, 0.26),
  };
}

function chooseHeroPathTemplate(archetype: HeroArchetype, episodeIntent: EpisodeIntent, edgeMap: EdgeMap): "processional-ladder" | "broken-lemniscate" | "crown-arc" | "ritual-spiral" | "off-axis-zig" | "corridor-recede" {
  if (episodeIntent === "mirror-procession") {
    return "processional-ladder";
  }
  if (episodeIntent === "catoptric-duet" || episodeIntent === "quad-vigil" || episodeIntent === "prism-tribunal") {
    return "corridor-recede";
  }
  if (episodeIntent === "kaleido-coronation") {
    return "ritual-spiral";
  }
  if (episodeIntent === "mirror-sermon" || episodeIntent === "mirror-corridor") {
    return "corridor-recede";
  }
  if (episodeIntent === "electric-funeral") {
    return "off-axis-zig";
  }
  if (episodeIntent === "neon-bardo" || archetype === "ritual-engine" || archetype === "laughing-mandala") {
    return "ritual-spiral";
  }
  if (archetype === "oracle-mask") {
    return "crown-arc";
  }
  if (archetype === "corridor-witness") {
    return "corridor-recede";
  }
  if (archetype === "fractured-rider" || edgeMap.fractalMotif === "shattered-arc") {
    return "off-axis-zig";
  }
  if (archetype === "void-guitarist") {
    return "broken-lemniscate";
  }
  return "processional-ladder";
}

function buildEpisodeSeed(intentSeed: NodeIntentSeed, edgeMap: EdgeMap, theme: RenderTheme): EpisodeSeed {
  const episodeIntent = chooseEpisodeIntent(intentSeed.intent, edgeMap, theme);
  const accentModes = accentModesForEpisode(episodeIntent);
  const profile = theme.styleProfile;
  return {
    episodeIntent,
    accentModes,
    particleVolumeScale: clamp(
      1.22 +
        intentSeed.energyBias * 0.18 +
        (accentModes.includes("emitters") ? 0.08 : 0) +
        (accentModes.includes("petal-explosion") ? 0.06 : 0),
      1.18,
      1.72,
    ),
    emitterBias: clamp(0.3 + intentSeed.playfulness * 0.35 + (accentModes.includes("emitters") ? 0.2 : 0), 0.2, 0.95),
    absorberBias: clamp(0.2 + intentSeed.collapseBias * 0.45 + (accentModes.includes("absorbers") ? 0.18 : 0), 0.16, 0.95),
    explosionBias: clamp(0.16 + intentSeed.energyBias * 0.42 + (accentModes.includes("burst-gate") ? 0.22 : 0), 0.12, 1.08),
    metamorphBias: clamp(0.26 + profile.hueVariance * 0.3 + (accentModes.includes("mirror-flip") ? 0.14 : 0), 0.16, 0.88),
    narrativeContinuityBias: clamp(0.34 + profile.symmetry * 0.28 + intentSeed.pathBias * 0.2, 0.2, 0.9),
    pulseProfile: {
      bpmPulseStrength: clamp(0.84 + profile.saturationMean * 0.4, 0.72, 1.42),
      barPulseStrength: clamp(0.88 + intentSeed.energyBias * 0.34, 0.72, 1.35),
      fourBarAccentStrength: clamp(1.1 + intentSeed.energyBias * 0.45 + profile.edgeDensity * 0.25, 1, 1.7),
      downbeatExplosionChance: clamp(0.18 + (accentModes.includes("petal-explosion") ? 0.22 : 0) + (accentModes.includes("burst-gate") ? 0.18 : 0), 0.12, 0.6),
      betweenBeatBreathing: clamp(0.56 + intentSeed.playfulness * 0.34, 0.42, 1.02),
    },
  };
}

function buildIntentSeed(edgeMap: EdgeMap, theme: RenderTheme, compositionPlan: CompositionPlan): NodeIntentSeed {
  const intent = chooseIntent(edgeMap, theme, compositionPlan);
  const directives = directivesForIntent(intent);
  const atmosphere = intentAtmosphereDefaults(intent);
  const profile = theme.styleProfile;
  return {
    intent,
    ...directives,
    ...atmosphere,
    energyBias: clamp(profile.contrast * 1.35 + profile.edgeDensity * 0.75, 0, 1),
    playfulness: clamp((1 - profile.contrast) * 0.55 + profile.saturationMean * 0.6, 0, 1),
    collapseBias: clamp(profile.contrast * 0.85 + (edgeMap.negativeSpaceQuadrant === "center" ? 0.22 : 0), 0, 1),
    radialBias: clamp((edgeMap.fractalMotif === "glass-orbital" ? 0.35 : 0.12) + profile.symmetry * 0.55, 0, 1),
    pathBias: clamp((compositionPlan.supportSlots.length / 5) * 0.45 + profile.symmetry * 0.4, 0, 1),
    scatterBias: clamp((1 - profile.symmetry) * 0.45 + profile.hueVariance * 0.55, 0, 1),
  };
}

function motifFamilySet(edgeMap: EdgeMap, theme: RenderTheme): [StylePlacementMode, StylePlacementMode, StylePlacementMode] {
  switch (edgeMap.fractalMotif) {
    case "data-cathedral":
      return ["filament", "orbital", "shard-lane"];
    case "mandelbloom":
      return ["orbital", "cell", "ribbon"];
    case "chromatic-xylem":
      return ["cell", "ribbon", "orbital"];
    case "vector-incantation":
      return ["shard-lane", "filament", "orbital"];
    case "harmonic-lattice":
      return ["orbital", "filament", "cell"];
    case "film-bloom-shard":
      return ["shard-lane", "ribbon", "filament"];
    case "cathedral-filament":
      return ["filament", "shard-lane", "ribbon"];
    case "glass-orbital":
      return ["orbital", "cell", "ribbon"];
    case "smoke-ribbon":
      return ["ribbon", "cell", "orbital"];
    case "halo-cell":
      return ["cell", "orbital", "ribbon"];
    case "shattered-arc":
      return ["shard-lane", "filament", "ribbon"];
    case "neon-tube":
    default:
      return theme.styleMode === "shard" ? ["shard-lane", "filament", "orbital"] : ["filament", "ribbon", "cell"];
  }
}

export function isPeakColorEligibleBackgroundElement(params: {
  continuityCategory: "architectural" | "orbital" | "glitch" | "organic" | "ritual";
  heroCouplingStrength: number;
  particleCouplingStrength: number;
}): boolean {
  return (
    params.continuityCategory === "glitch" ||
    params.continuityCategory === "orbital" ||
    params.continuityCategory === "ritual" ||
    params.heroCouplingStrength >= 0.72 ||
    params.particleCouplingStrength >= 0.48
  );
}

function buildBackgroundPlan(
  theme: RenderTheme,
  compositionPlan: CompositionPlan,
  edgeMap: EdgeMap,
  intentSeed: NodeIntentSeed,
  backgroundSeed: number,
  nebulaBandRouting: NebulaBandRouting,
): BackgroundPlan {
  const profile = theme.styleProfile;
  const selectedElement = selectBackgroundElementSpec({
    motif: edgeMap.fractalMotif,
    imagePath: edgeMap.imagePath,
    continuitySeed: backgroundSeed,
    theme,
    preferHeroCoupling: clamp(0.4 + intentSeed.energyBias * 0.2 + intentSeed.playfulness * 0.18, 0.3, 0.9),
    maskConfidence: edgeMap.maskConfidence,
  });
  const peakColorEligible = selectedElement !== undefined
    ? isPeakColorEligibleBackgroundElement(selectedElement)
    : false;
  const start = compositionPlan.backgroundSlots[0] ?? {
    x: edgeMap.width * 0.14,
    y: edgeMap.height * 0.18,
    radius: 64,
    weight: 0.5,
    layer: "background" as const,
    angle: 0,
  };
  const end = compositionPlan.backgroundSlots[1] ?? {
    x: edgeMap.width * 0.86,
    y: edgeMap.height * 0.82,
    radius: 72,
    weight: 0.5,
    layer: "background" as const,
    angle: Math.PI,
  };
  const pulseProfile = {
    beatPulseStrength: clamp(0.58 + intentSeed.energyBias * 0.34 + profile.edgeDensity * 0.12, 0.42, 1.08),
    barPulseStrength: clamp(0.62 + profile.contrast * 0.18 + intentSeed.pathBias * 0.24, 0.5, 1.04),
    betweenBeatBreathing: clamp(0.38 + (1 - profile.contrast) * 0.22 + profile.saturationMean * 0.18, 0.28, 0.86),
    flickerAmount: clamp(0.08 + intentSeed.scatterBias * 0.2 + nebulaBandRouting.sparkHigh * 0.08, 0.06, 0.44),
  };
  const hzColorRouting = {
    subLow: clamp(0.22 + nebulaBandRouting.structureLow * 0.42, 0.18, 1.04),
    low: clamp(0.28 + nebulaBandRouting.glowLowMid * 0.34, 0.22, 1),
    mid: clamp(0.32 + nebulaBandRouting.textureMid * 0.42, 0.26, 1.08),
    highMid: clamp(0.24 + nebulaBandRouting.distortionHighMid * 0.44, 0.18, 1.04),
    high: clamp(0.18 + nebulaBandRouting.sparkHigh * 0.52, 0.14, 1.1),
  };
  return {
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    colorStops: [
      { offset: 0, r: 0, g: 0, b: 0, alpha: 0.98 },
      { offset: 0.48, r: Math.round(profile.averageR), g: Math.round(profile.averageG), b: Math.round(profile.averageB), alpha: 0.18 },
      { offset: 0.76, r: Math.round(profile.modeR), g: Math.round(profile.modeG), b: Math.round(profile.modeB), alpha: 0.22 },
      { offset: 1, r: 0, g: 0, b: 0, alpha: 0.96 },
    ],
    secondaryWash: {
      x: compositionPlan.heroCenterX,
      y: compositionPlan.heroCenterY,
      radius: compositionPlan.heroRadius * 1.8,
      alpha: 0.08 + profile.contrast * 0.08,
    },
    driftScale: 0.16 + profile.edgeDensity * 0.12,
    backgroundElementId: selectedElement?.id,
    backgroundElementFamily: selectedElement?.family,
    motifAffinity: selectedElement?.motifAffinity,
    renderMode: selectedElement ? "element-primary" : "gradient-only",
    pulseProfile,
    hzColorRouting,
    continuityBlend: clamp(0.38 + seedToUnitFloat(deriveSeed(backgroundSeed, "continuity-blend")) * 0.6, 0.38, 0.98),
    geometryParams: selectedElement?.geometryDefaults,
    motionParams: selectedElement?.motionDefaults,
    interactionMode:
      edgeMap.maskConfidence === "low" && selectedElement?.imageResponseMode === "silhouette"
        ? "none"
        : selectedElement?.interactionMode,
    triggerMode: selectedElement?.triggerMode,
    imageResponseMode: selectedElement?.imageResponseMode,
    familyVariant:
      edgeMap.maskConfidence === "low" && selectedElement?.imageResponseMode === "silhouette"
        ? "default"
        : selectedElement?.familyVariant,
    heroCouplingStrength:
      edgeMap.maskConfidence === "low" && selectedElement?.imageResponseMode === "silhouette"
        ? 0
        : selectedElement?.heroCouplingStrength,
    particleCouplingStrength: selectedElement?.particleCouplingStrength,
    triggerPhaseOffset: seedToUnitFloat(deriveSeed(backgroundSeed, "trigger-phase")),
    triggerWindowFrames: 8 + pickIndex(deriveSeed(backgroundSeed, "trigger-window"), 5) * 2,
    usesHeroParticles: selectedElement?.supportsHeroParticles,
    usesHeroPathPrediction: selectedElement?.interactionMode === "hero-path-predictive",
    colorTuning: {
      baselineColorfulnessScale: 1.1,
      peakColorfulnessScale: 1.4,
      peakColorEligible,
      lowAlphaLuminosityLift: 0.39,
      highAlphaLuminosityLift: 0.126,
    },
    motionTuning: {
      bpmMotionFloor: 1,
      minorImpactMotionFloor: 1,
      minorImpactDriveMix: {
        onset: 0.45,
        peak: 0.35,
        highMid: 0.2,
      },
    },
    layeringParams: selectedElement
      ? {
          hazeAlpha: selectedElement.hazeAssist ? clamp(0.06 + profile.contrast * 0.05, 0.05, 0.14) : 0,
          glowAlpha: clamp(0.08 + profile.saturationMean * 0.08 + intentSeed.energyBias * 0.06, 0.06, 0.18),
          blendMode: selectedElement.family === "void-shape" ? "overlay" : "screen",
        }
      : undefined,
    fallbackNebulaEnabled: !selectedElement || Boolean(selectedElement.hazeAssist),
  };
}

function buildParticleBehaviors(compositionPlan: CompositionPlan): ParticleBehaviorParams[] {
  const supportCount = Math.max(1, compositionPlan.supportSlots.length);
  const backgroundCount = Math.max(1, compositionPlan.backgroundSlots.length);
  const modes: ParticleBehaviorParams["mode"][] = ["edge-drift", "spiral-out", "dual-attractor", "edge-escape", "spiral-in", "orbit-hero"];
  const shapes: ParticleBehaviorParams["shape"][] = ["dot", "ring", "shard", "chevron", "diamond", "arc"];
  return Array.from({ length: 12 }, (_, index) => ({
    mode: modes[index % modes.length]!,
    shape: shapes[(index * 2) % shapes.length]!,
    targetA: index % supportCount,
    targetB: index % 2 === 0 ? (index + 1) % backgroundCount : (index + 1) % supportCount,
    orbitScale: 0.5 + (index % 4) * 0.18,
    driftScale: 0.34 + (index % 3) * 0.16,
  }));
}

function motionModeForScript(script: LayerDirective["motionScript"]): ParticleBehaviorParams["mode"] {
  switch (script) {
    case "follow-hero":
      return "orbit-hero";
    case "orbit-anchor":
      return "orbit-hero";
    case "braid-lane":
      return "edge-drift";
    case "dual-well":
      return "dual-attractor";
    case "emit-to-edge":
      return "edge-escape";
    case "spiral-in":
      return "spiral-in";
    case "spiral-out":
      return "spiral-out";
    case "burst-falloff":
      return "edge-escape";
    case "signal-drift":
      return "edge-drift";
    case "edge-fog":
      return "edge-drift";
    case "absorb-well":
      return "absorb-well";
    case "emit-chain":
      return "emit-chain";
    case "release-bloom":
      return "release-bloom";
    case "play-scatter":
      return "dual-attractor";
    case "escort":
    default:
      return "dual-attractor";
  }
}

function shapeModeForFamily(shape: ShapeFamilyToken): ParticleBehaviorParams["shape"] {
  switch (shape) {
    case "ring":
      return "ring";
    case "shard":
    case "pulse-shard":
      return "shard";
    case "chevron":
    case "braid-marker":
      return "chevron";
    case "diamond":
      return "diamond";
    case "arc":
    case "arc-haze":
    case "fallout-arc":
      return "arc";
    case "dot":
    case "cell-cluster":
    default:
      return "dot";
  }
}

function occupancyPurposeForDirective(directive: LayerDirective, layer: "hero" | "support" | "background"): OccupancyPurpose {
  if (layer === "hero") {
    return directive.motionScript === "orbit-anchor" ? "ritual-ring" : "hero-wake";
  }
  if (directive.motionScript === "burst-falloff" || directive.motionScript === "emit-to-edge") {
    return "burst-remnant";
  }
  if (directive.motionScript === "braid-lane" || directive.motionScript === "follow-hero") {
    return "path-node";
  }
  if (layer === "background") {
    return "ambient-fog";
  }
  return "support-wake";
}

function buildParticleBehaviorsForIntent(
  compositionPlan: CompositionPlan,
  intentSeed: NodeIntentSeed,
  episodeSeed: EpisodeSeed,
  motif: EdgeMap["fractalMotif"],
  heroEmissionMode: HeroEmissionMode,
  subEmitterMode: SubEmitterMode,
): ParticleBehaviorParams[] {
  const layers: Array<{ directive: LayerDirective; layer: "hero" | "support" | "background"; slots: PlacementSlot[] }> = [
    {
      directive: intentSeed.heroDirective,
      layer: "hero",
      slots: [{ x: compositionPlan.heroCenterX, y: compositionPlan.heroCenterY, radius: compositionPlan.heroRadius, weight: 1, layer: "hero", angle: 0 }],
    },
    { directive: intentSeed.supportDirective, layer: "support", slots: compositionPlan.supportSlots },
    { directive: intentSeed.backgroundDirective, layer: "background", slots: compositionPlan.backgroundSlots },
  ];
  const behaviors: ParticleBehaviorParams[] = [];
  for (const [layerIndex, spec] of layers.entries()) {
    const family: ShapeFamilyToken[] = spec.directive.shapeFamilies.length > 0 ? spec.directive.shapeFamilies : ["dot"];
    const poolSize = spec.layer === "hero" ? 4 : spec.layer === "support" ? 6 : 8;
    for (let index = 0; index < poolSize; index += 1) {
      const count = Math.max(1, spec.slots.length);
      behaviors.push({
        mode: motionModeForScript(spec.directive.motionScript),
        shape: shapeModeForFamily(family[index % family.length]!),
        targetA: (index + layerIndex) % count,
        targetB: (index + 1 + layerIndex) % Math.max(1, (spec.layer === "background" ? compositionPlan.supportSlots.length : compositionPlan.backgroundSlots.length) || count),
        orbitScale: 0.45 + spec.directive.dominance * 0.55 + index * 0.06,
        driftScale: 0.28 + intentSeed.scatterBias * 0.4 + index * 0.04,
        script: spec.directive.motionScript,
        purpose: occupancyPurposeForDirective(spec.directive, spec.layer),
        layer: spec.layer,
      });
    }
  }
  if (episodeSeed.accentModes.includes("emitters")) {
    behaviors.push({
      mode: "emit-chain",
      shape: "arc",
      targetA: 0,
      targetB: 0,
      orbitScale: 0.65,
      driftScale: 0.72,
      script: "emit-chain",
      purpose: "burst-remnant",
      layer: "support",
    });
  }
  if (episodeSeed.accentModes.includes("absorbers")) {
    behaviors.push({
      mode: "absorb-well",
      shape: "ring",
      targetA: Math.min(1, Math.max(0, compositionPlan.supportSlots.length - 1)),
      targetB: 0,
      orbitScale: 0.52,
      driftScale: 0.44,
      script: "absorb-well",
      purpose: "path-node",
      layer: "support",
    });
  }
  if (episodeSeed.accentModes.includes("burst-gate") || episodeSeed.accentModes.includes("petal-explosion")) {
    behaviors.push({
      mode: "release-bloom",
      shape: "shard",
      targetA: 0,
      targetB: 0,
      orbitScale: 0.74,
      driftScale: 0.84,
      script: "release-bloom",
      purpose: "burst-remnant",
      layer: "background",
    });
  }
  const heroEmissionBehavior: ParticleBehaviorParams =
    heroEmissionMode === "orbit-shed"
      ? {
          mode: "emit-chain",
          shape: "arc",
          targetA: 0,
          targetB: 0,
          orbitScale: 0.88,
          driftScale: 0.56,
          script: "emit-chain",
          purpose: "hero-wake",
          layer: "hero",
        }
      : heroEmissionMode === "mouth-flare"
        ? {
            mode: "release-bloom",
            shape: "shard",
            targetA: 0,
            targetB: 0,
            orbitScale: 0.62,
            driftScale: 0.72,
            script: "release-bloom",
            purpose: "burst-remnant",
            layer: "hero",
          }
        : {
            mode: "emit-chain",
            shape: heroEmissionMode === "hand-cascade" ? "chevron" : heroEmissionMode === "crown-spray" ? "arc" : "ring",
            targetA: 0,
            targetB: 0,
            orbitScale: heroEmissionMode === "spine-fountain" ? 0.44 : 0.58,
            driftScale: heroEmissionMode === "spine-fountain" ? 0.78 : 0.62,
            script: "emit-chain",
            purpose: "hero-wake",
            layer: "hero",
          };
  behaviors.push(heroEmissionBehavior);
  if (subEmitterMode === "echo-ring") {
    behaviors.push({
      mode: "orbit-hero",
      shape: "ring",
      targetA: 0,
      targetB: 0,
      orbitScale: 0.92,
      driftScale: 0.34,
      script: "follow-hero",
      purpose: "ritual-ring",
      layer: "hero",
    });
  }
  if (
    episodeSeed.episodeIntent === "catoptric-duet" ||
    episodeSeed.episodeIntent === "mirror-procession" ||
    episodeSeed.episodeIntent === "kaleido-coronation" ||
    episodeSeed.episodeIntent === "quad-vigil" ||
    episodeSeed.episodeIntent === "prism-tribunal"
  ) {
    behaviors.push(
      { mode: "mirror-orbit", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.86, driftScale: 0.44, script: "follow-hero", purpose: "ritual-ring", layer: "hero" },
      { mode: "axis-reflect", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.52, script: "braid-lane", purpose: "path-node", layer: "support" },
    );
  }
  if (episodeSeed.episodeIntent === "kaleido-coronation" || episodeSeed.episodeIntent === "quad-vigil") {
    behaviors.push({ mode: "kaleido-shear", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.82, driftScale: 0.68, script: "signal-drift", purpose: "support-wake", layer: "support" });
  }
  if (episodeSeed.episodeIntent === "mirror-procession" || episodeSeed.episodeIntent === "prism-tribunal") {
    behaviors.push({ mode: "paired-braid", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.64, driftScale: 0.58, script: "braid-lane", purpose: "path-node", layer: "support" });
  }
  if (episodeSeed.episodeIntent === "catoptric-duet" || episodeSeed.episodeIntent === "prism-tribunal") {
    behaviors.push({ mode: "prism-well", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.76, driftScale: 0.42, script: "orbit-anchor", purpose: "ritual-ring", layer: "hero", behaviorTuning: { gravityStrength: 0.16 } });
  }
  const motifBehaviorMap: Partial<Record<EdgeMap["fractalMotif"], ParticleBehaviorParams[]>> = {
    "halo-cell": [
      { mode: "flock-curl", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.74, driftScale: 0.6, script: "follow-hero", purpose: "hero-wake", layer: "hero", behaviorTuning: { neighborRadius: 54, cohesion: 0.05, alignment: 0.08, separation: 0.12 } },
      { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.54, driftScale: 0.44, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.1 } },
    ],
    "smoke-ribbon": [
      { mode: "flow-advect", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.86, driftScale: 0.76, script: "signal-drift", purpose: "hero-wake", layer: "hero" },
      { mode: "ribbon-trace", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.68, script: "emit-chain", purpose: "support-wake", layer: "support" },
      { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.52, driftScale: 0.48, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.1 } },
    ],
    "glass-orbital": [
      { mode: "gravity-orrery", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.94, driftScale: 0.4, script: "orbit-anchor", purpose: "ritual-ring", layer: "support", behaviorTuning: { gravityStrength: 0.18 } },
      { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.78, driftScale: 0.62, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.72 } },
    ],
    "data-cathedral": [
      { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.5, script: "emit-chain", purpose: "path-node", layer: "support" },
      { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.48, script: "braid-lane", purpose: "ambient-fog", layer: "background", behaviorTuning: { linkRadius: 88 } },
      { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.72, driftScale: 0.52, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.68 } },
    ],
    "harmonic-lattice": [
      { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.6, driftScale: 0.46, script: "braid-lane", purpose: "path-node", layer: "support", behaviorTuning: { linkRadius: 82 } },
      { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.42, script: "emit-chain", purpose: "hero-wake", layer: "hero" },
      { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.5, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.64 } },
    ],
    "film-bloom-shard": [
      { mode: "lifecycle-morph", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.74, driftScale: 0.7, script: "release-bloom", purpose: "burst-remnant", layer: "support", behaviorTuning: { morphProfile: "shard-to-teardrop" } },
      { mode: "shell-bounce", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.8, script: "burst-falloff", purpose: "burst-remnant", layer: "background", behaviorTuning: { bounceDamping: 0.78 } },
      { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.48, driftScale: 0.42, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.11 } },
    ],
    "shattered-arc": [
      { mode: "shell-bounce", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.76, driftScale: 0.78, script: "burst-falloff", purpose: "burst-remnant", layer: "hero", behaviorTuning: { bounceDamping: 0.74 } },
      { mode: "gravity-orrery", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.62, script: "dual-well", purpose: "support-wake", layer: "support", behaviorTuning: { gravityStrength: 0.22 } },
    ],
    "mandelbloom": [
      { mode: "flock-curl", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.88, driftScale: 0.62, script: "follow-hero", purpose: "hero-wake", layer: "hero", behaviorTuning: { neighborRadius: 62, cohesion: 0.06, alignment: 0.09, separation: 0.1 } },
      { mode: "lifecycle-morph", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.56, script: "release-bloom", purpose: "support-wake", layer: "support", behaviorTuning: { morphProfile: "diamond-to-shard" } },
    ],
    "chromatic-xylem": [
      { mode: "flow-advect", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.8, driftScale: 0.72, script: "signal-drift", purpose: "support-wake", layer: "support" },
      { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.46, driftScale: 0.38, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.09 } },
    ],
    "vector-incantation": [
      { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.68, driftScale: 0.46, script: "emit-chain", purpose: "path-node", layer: "support" },
      { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.44, script: "braid-lane", purpose: "hero-wake", layer: "hero", behaviorTuning: { linkRadius: 76 } },
    ],
  };
  behaviors.push(...(motifBehaviorMap[motif] ?? []));
  if (heroEmissionMode === "spine-fountain" || heroEmissionMode === "orbit-shed") {
    behaviors.push({ mode: "ribbon-trace", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.68, driftScale: 0.72, script: "emit-chain", purpose: "hero-wake", layer: "hero" });
  }
  if (heroEmissionMode === "crown-spray" || heroEmissionMode === "mouth-flare" || heroEmissionMode === "hand-cascade") {
    behaviors.push({ mode: "lifecycle-morph", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.7, script: "release-bloom", purpose: "burst-remnant", layer: "hero", behaviorTuning: { morphProfile: "diamond-to-shard" } });
  }
  if (subEmitterMode === "echo-ring") {
    behaviors.push({ mode: "shell-bounce", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.88, driftScale: 0.42, script: "burst-falloff", purpose: "ritual-ring", layer: "hero", behaviorTuning: { bounceDamping: 0.82 } });
  }
  if (subEmitterMode === "spark-fork" || subEmitterMode === "mask-fracture") {
    behaviors.push({ mode: "plexus-link", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.48, script: "braid-lane", purpose: "path-node", layer: "support", behaviorTuning: { linkRadius: 72 } });
    behaviors.push({ mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.64, driftScale: 0.5, script: "emit-chain", purpose: "burst-remnant", layer: "hero" });
  }
  return behaviors.length > 0 ? behaviors : buildParticleBehaviors(compositionPlan);
}

function pickHeroPrimitive(
  intent: NodeIntent,
  edgeMap: EdgeMap,
  episodeIntent: EpisodeIntent,
  theme: RenderTheme,
  motifProfile: HeroMotifProfile,
  compositionPlan: CompositionPlan,
): HeroPrimitiveKind {
  const motif = edgeMap.fractalMotif;
  const profile = theme.styleProfile;
  const ordinal = imageSequenceOrdinal(edgeMap.imagePath);
  let pathHash = 0;
  for (let index = 0; index < edgeMap.imagePath.length; index += 1) {
    pathHash = (pathHash * 167 + edgeMap.imagePath.charCodeAt(index)) >>> 0;
  }
  const pickFrom = (candidates: HeroPrimitiveKind[]): HeroPrimitiveKind => {
    const mixed =
      pathHash ^
      (pathHash >>> 9) ^
      (Math.round(profile.symmetry * 100) << 3) ^
      (Math.round(profile.hueVariance * 100) << 5) ^
      (Math.round(profile.edgeDensity * 100) << 7) ^
      (ordinal * 41) ^
      (intent.length * 31) ^
      (episodeIntent.length * 17);
    return candidates[Math.abs(mixed) % candidates.length]!;
  };

  let pool = [...motifProfile.heroPrimitivePool];
  if (motif === "shattered-arc" && profile.hueVariance > 0.18) {
    pool.unshift("lightning", "star");
  }
  if (intent === "orbit-ritual" && profile.symmetry > 0.62) {
    pool.unshift("ring", "lens");
  }
  if (compositionPlan.shotGrammarKey !== "halo-orbital") {
    const nonOrbitalPool = pool.filter((primitive) => !["ring", "lens", "circle", "ellipse", "moon", "sector"].includes(primitive));
    if (nonOrbitalPool.length > 0) {
      pool = nonOrbitalPool;
    }
  }
  if (["split-lane-duel", "corridor-recede", "shard-fan"].includes(compositionPlan.shotGrammarKey)) {
    const directionalPool = pool.filter((primitive) => ["diamond", "chevron", "kite", "star", "lightning", "hexagon", "arc"].includes(primitive));
    if (directionalPool.length > 0) {
      pool = directionalPool;
    }
  }
  return pickFrom(pool);
}

function fallbackHeroPrimitive(primary: HeroPrimitiveKind): HeroPrimitiveKind {
  switch (primary) {
    case "ring":
    case "ellipse":
    case "circle":
      return "lens";
    case "star":
    case "lightning":
      return "diamond";
    case "cloud":
    case "heart":
      return "teardrop";
    case "spiral":
      return "kite";
    default:
      return "hexagon";
  }
}

function fallbackHeroPrimitiveFromProfile(primary: HeroPrimitiveKind, motifProfile: HeroMotifProfile): HeroPrimitiveKind {
  const candidate = motifProfile.fallbackHeroPrimitivePool.find((primitive) => primitive !== primary && primitive !== "arrow");
  return candidate ?? fallbackHeroPrimitive(primary);
}

function heroShellModeForPrimitive(intent: NodeIntent, motif: EdgeMap["fractalMotif"], primitive: HeroPrimitiveKind): HeroPostShellMode {
  if (motif === "data-cathedral" || motif === "harmonic-lattice") {
    return primitive === "hexagon" || primitive === "rectangle" ? "monolith-extrude" : "wire-solid-flip";
  }
  if (motif === "mandelbloom" || motif === "halo-cell" || primitive === "heart" || primitive === "teardrop") {
    return "hinge-bloom";
  }
  if (primitive === "lightning" || primitive === "chevron" || motif === "neon-tube") {
    return "electric-shell";
  }
  if (primitive === "cloud" || intent === "repopulation") {
    return "petal-shell";
  }
  if (primitive === "ring" || primitive === "sector" || intent === "fireworks") {
    return "shock-ring";
  }
  if (motif === "smoke-ribbon") {
    return "heat-smear";
  }
  return "soft-halo";
}

function heroSubEmitterFamilyForPrimitive(
  primitive: HeroPrimitiveKind,
  motif: EdgeMap["fractalMotif"],
  heroMotifProfile?: HeroMotifProfile,
  heroStoryBeat?: GlyphStoryBeat,
): ShapeFamilyToken {
  if (motif === "smoke-ribbon") {
    return primitive === "cloud" || primitive === "heart" ? "teardrop" : "arc-haze";
  }
  if (motif === "shattered-arc") {
    return primitive === "diamond" || primitive === "kite" ? "pulse-shard" : "shard";
  }
  if (motif === "harmonic-lattice" || motif === "data-cathedral") {
    return primitive === "hexagon" || primitive === "rectangle" ? "hexagon" : "braid-marker";
  }
  if (motif === "glass-orbital") {
    return primitive === "ring" || primitive === "sector" ? "ring" : "glint";
  }
  if (heroMotifProfile?.motionBias === "tightrope" || heroStoryBeat === "communion") {
    return "braid-marker";
  }
  switch (primitive) {
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
      return "arc";
    case "star":
    case "hexagram":
    case "asterisk":
      return "star";
    case "heart":
    case "teardrop":
    case "cloud":
      return "teardrop";
    case "hexagon":
    case "pentagon":
    case "octagon":
      return "hexagon";
    default:
      return "glint";
  }
}

function heroSubEmitterVariantKey(
  primitive: HeroPrimitiveKind,
  motif: EdgeMap["fractalMotif"],
  subEmitterMode: SubEmitterMode,
  heroStoryBeat: GlyphStoryBeat,
  heroMotifProfile: HeroMotifProfile,
): string {
  return `${primitive}:${motif}:${subEmitterMode}:${heroStoryBeat}:${heroMotifProfile.motionBias}`;
}

function heroSubEmitterMotifAlignmentScore(
  primitive: HeroPrimitiveKind,
  motif: EdgeMap["fractalMotif"],
  family: ShapeFamilyToken,
): number {
  if ((motif === "smoke-ribbon" && (family === "arc-haze" || family === "teardrop")) ||
      (motif === "shattered-arc" && (family === "shard" || family === "pulse-shard")) ||
      ((motif === "harmonic-lattice" || motif === "data-cathedral") && (family === "hexagon" || family === "braid-marker")) ||
      (motif === "glass-orbital" && (family === "ring" || family === "glint"))) {
    return 0.92;
  }
  return primitive === "ring" || primitive === "sector" || primitive === "moon" ? 0.74 : 0.68;
}

function heroEmitterOffsetsForPrimitive(primitive: HeroPrimitiveKind): Array<{ x: number; y: number }> {
  switch (primitive) {
    case "diamond":
    case "kite":
      return [{ x: 0, y: -0.9 }, { x: 0, y: 0.9 }];
    case "chevron":
    case "arrow":
      return [{ x: -0.65, y: 0.1 }, { x: -0.2, y: 0.55 }, { x: -0.2, y: -0.55 }];
    case "ring":
    case "ellipse":
    case "circle":
      return [{ x: -0.72, y: 0 }, { x: 0.72, y: 0 }, { x: 0, y: -0.72 }];
    case "hexagon":
    case "pentagon":
    case "octagon":
      return [{ x: -0.56, y: -0.4 }, { x: 0.56, y: -0.4 }, { x: 0, y: 0.7 }];
    case "heart":
    case "cloud":
      return [{ x: -0.44, y: -0.12 }, { x: 0.44, y: -0.12 }, { x: 0, y: 0.62 }];
    default:
      return [{ x: -0.48, y: 0 }, { x: 0.48, y: 0 }];
  }
}

function buildNebulaBandRouting(intent: NodeIntentSeed, theme: RenderTheme, edgeMap: EdgeMap): NebulaBandRouting {
  return {
    structureLow: clamp(0.7 + theme.styleProfile.contrast * 0.18 + intent.collapseBias * 0.14, 0.65, 1.08),
    textureMid: clamp(0.8 + theme.styleProfile.edgeDensity * 0.2 + intent.pathBias * 0.16, 0.7, 1.14),
    sparkHigh: clamp(0.7 + theme.styleProfile.hueVariance * 0.65 + intent.playfulness * 0.18, 0.62, 1.18),
    glowLowMid: clamp(0.76 + theme.styleProfile.saturationMean * 0.18 + intent.radialBias * 0.14, 0.68, 1.08),
    distortionHighMid: clamp(0.72 + edgeMap.complexity * 0.18 + intent.scatterBias * 0.16, 0.64, 1.12),
  };
}

function buildHeroInstanceSeed(
  heroPrimitive: HeroPrimitiveKind,
  intentSeed: NodeIntentSeed,
  edgeMap: EdgeMap,
  theme: RenderTheme,
  instanceSeed: number,
): HeroInstanceSeed {
  const heroMotifProfile = buildHeroMotifProfile(intentSeed.intent, edgeMap.fractalMotif, buildEpisodeSeed(intentSeed, edgeMap, theme).episodeIntent, theme);
  const profile = theme.styleProfile;
  const baseSeed = stableHash32([
    instanceSeed,
    heroPrimitive,
    intentSeed.intent,
    edgeMap.imagePath,
    edgeMap.fractalMotif,
    heroMotifProfile.key,
    Math.round(profile.symmetry * 1000),
    Math.round(profile.edgeDensity * 1000),
    Math.round(profile.saturationMean * 1000),
    Math.round(profile.hueVariance * 1000),
    Math.round(profile.contrast * 1000),
    Math.round(profile.warmCoolBias * 1000),
    Math.round(edgeMap.focalCenterX),
    Math.round(edgeMap.focalCenterY),
    Math.round(edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX),
    Math.round(edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY),
  ].join("|"));
  const affinityA = seedToUnitFloat(deriveSeed(baseSeed, "affinity-a"));
  const affinityB = seedToUnitFloat(deriveSeed(baseSeed, "affinity-b"));
  const affinityC = seedToUnitFloat(deriveSeed(baseSeed, "affinity-c"));
  const affinityD = seedToUnitFloat(deriveSeed(baseSeed, "affinity-d"));
  const affinityE = seedToUnitFloat(deriveSeed(baseSeed, "affinity-e"));
  const topologyOptions = intentSeed.intent === "repopulation" || edgeMap.fractalMotif === "halo-cell"
    ? ["petal", "bilateral", "fan", "orbit"] as const
    : ["orbit", "bilateral", "fan", "spine", "petal"] as const;
  const topology = topologyOptions[pickIndex(deriveSeed(baseSeed, "topology"), topologyOptions.length)]!;
  const bandRoutingOptions: Array<[HeroBandAffinity, HeroBandAffinity, HeroBandAffinity]> = [
    ["high", "mid", "low"],
    ["mid", "high", "low"],
    ["low", "mid", "high"],
    ["mid", "low", "high"],
  ];
  const bandRouting = bandRoutingOptions[pickIndex(deriveSeed(baseSeed, "band-routing"), bandRoutingOptions.length)]!;
  const childPrimitiveMix: HeroPrimitiveKind[] =
    heroPrimitive === "lens" || heroPrimitive === "ring"
      ? (affinityC > 0.56 ? ["lens", "arc", "diamond"] : ["arc", "ring", "diamond"])
      : heroPrimitive === "chevron" || heroPrimitive === "arrow"
        ? (affinityC > 0.5 ? ["chevron", "arrow", "lightning"] : ["chevron", "diamond", "lightning"])
        : heroPrimitive === "teardrop" || heroPrimitive === "heart"
          ? (affinityA > 0.54 ? ["teardrop", "heart", "arc"] : ["teardrop", "diamond", "arc"])
          : heroPrimitive === "star" || heroPrimitive === "hexagram"
            ? (affinityD > 0.52 ? ["star", "hexagram", "arc"] : ["star", "diamond", "arc"])
            : heroPrimitive === "spiral"
            ? ["spiral", "arc", affinityB > 0.5 ? "star" : "diamond"]
            : [heroPrimitive, "diamond", "arc"];
  if (heroMotifProfile.emissionPrimitivePool?.length) {
    for (const emissionPrimitive of heroMotifProfile.emissionPrimitivePool) {
      if (!childPrimitiveMix.includes(emissionPrimitive)) {
        childPrimitiveMix.push(emissionPrimitive);
      }
      if (childPrimitiveMix.length >= 5) {
        break;
      }
    }
  }
  return {
    primitive: heroPrimitive,
    aspectBias: clamp(0.74 + affinityA * 0.58 + (affinityE - 0.5) * 0.18, 0.66, 1.32),
    pointiness: clamp(0.24 + affinityB * 0.52 + affinityD * 0.18 + (theme.styleProfile.edgeDensity * 0.18), 0.16, 1),
    symmetryBreak: clamp((1 - theme.styleProfile.symmetry) * 0.36 + affinityC * 0.22 + affinityE * 0.12, 0.04, 0.52),
    rotationBias: (affinityA - 0.5) * 0.95 + (affinityD - 0.5) * 0.18,
    shellMorph: clamp(0.28 + affinityB * 0.42 + affinityE * 0.18, 0.18, 0.98),
    emitterTopology: topology,
    childPrimitiveMix,
    bandRouting,
    sizeBias: clamp(0.68 + affinityC * 0.18 + affinityD * 0.12, 0.68, 0.98),
    outlineBias: clamp(0.14 + affinityA * 0.34 + affinityE * 0.16, 0.08, 0.78),
    deformationBias:
      heroMotifProfile.deformationBias === "wobble" ? "wobble" :
      heroMotifProfile.deformationBias === "shear" ? "shear" :
      affinityC > 0.7 ? "tilt" :
      affinityE > 0.56 ? "pulse" :
      heroMotifProfile.deformationBias,
    travelStyle: buildHeroTravelStyle(heroMotifProfile, edgeMap, theme),
    motifProfileKey: heroMotifProfile.key,
    edgeAttachmentBias: heroMotifProfile.edgeAttachmentBias,
    variantKey: `${heroPrimitive}:${topology}:${bandRouting.join("-")}:${Math.round(affinityA * 9)}${Math.round(affinityB * 9)}${Math.round(affinityC * 9)}${Math.round(affinityD * 9)}${Math.round(affinityE * 9)}`,
  };
}

function heroGlyphsForPrimitive(primary: HeroPrimitiveKind, fallback: HeroPrimitiveKind): HeroGlyphKind[] {
  const sanitize = (primitive: HeroPrimitiveKind): HeroGlyphKind => {
    if (primitive === "arrow") {
      return "kite";
    }
    return primitive as HeroGlyphKind;
  };
  return [sanitize(primary), sanitize(fallback)];
}

export function buildSceneGraph(
  edgeMap: EdgeMap,
  theme: RenderTheme,
  compositionPlan: CompositionPlan,
  options: SceneGraphBuildOptions = {},
): SceneGraph {
  const intentSeed = buildIntentSeed(edgeMap, theme, compositionPlan);
  const episodeSeed = buildEpisodeSeed(intentSeed, edgeMap, theme);
  const continuitySeed = stableHash32([
    edgeMap.imagePath,
    edgeMap.fractalMotif,
    compositionPlan.shotGrammarKey,
    intentSeed.intent,
    episodeSeed.episodeIntent,
    theme.styleProfile.imagePath,
    Math.round(theme.styleProfile.symmetry * 1000),
    Math.round(theme.styleProfile.contrast * 1000),
    Math.round(theme.styleProfile.saturationMean * 1000),
    Math.round(theme.styleProfile.edgeDensity * 1000),
    Math.round(theme.styleProfile.hueVariance * 1000),
    Math.round(theme.styleProfile.warmCoolBias * 1000),
    Math.round(theme.styleProfile.lightnessMean * 1000),
    Math.round(theme.styleProfile.averageHue),
    Math.round(edgeMap.focalCenterX),
    Math.round(edgeMap.focalCenterY),
    Math.round(edgeMap.focalSpread),
    Math.round(edgeMap.subjectBounds.maxX - edgeMap.subjectBounds.minX),
    Math.round(edgeMap.subjectBounds.maxY - edgeMap.subjectBounds.minY),
    Math.round(compositionPlan.heroCenterX),
    Math.round(compositionPlan.heroCenterY),
    Math.round(compositionPlan.heroRadius),
    compositionPlan.supportSlots.length,
    compositionPlan.backgroundSlots.length,
    edgeMap.negativeSpaceQuadrant,
    edgeMap.maskConfidence,
    Math.round(edgeMap.complexity * 1000),
  ].join("|"));
  const relationshipSeed = deriveSeed(continuitySeed, "relationship");
  const glyphSeed = deriveSeed(continuitySeed, "glyph-grammar");
  const motifVariantSeed = deriveSeed(continuitySeed, "motif-variant");
  const heroInstanceSeedValue = deriveSeed(continuitySeed, "hero-instance");
  const conductorSeed = deriveSeed(continuitySeed, "conductor");
  const circleEmitterSeed = deriveSeed(continuitySeed, "circle-emitter");
  const backgroundSeed = deriveSeed(continuitySeed, "background-plan");
  const transitionPreferenceSeed = deriveSeed(continuitySeed, "transition-preference");
  const heroArchetype = chooseHeroArchetype(intentSeed, edgeMap, theme, episodeSeed.episodeIntent);
  const heroStoryBeat = chooseHeroStoryBeat(intentSeed.intent, episodeSeed.episodeIntent, theme);
  const heroEmissionMode = chooseHeroEmissionMode(heroArchetype, episodeSeed.episodeIntent);
  const subEmitterMode = chooseSubEmitterMode(heroArchetype, episodeSeed.episodeIntent);
  const heroGlyphGrammar = buildHeroGlyphGrammar(heroArchetype, heroStoryBeat, glyphSeed);
  const heroPathTemplate = chooseHeroPathTemplate(heroArchetype, episodeSeed.episodeIntent, edgeMap);
  const resolvedHeroMotif = options.scheduledHeroMotif ?? edgeMap.fractalMotif;
  const baseHeroMotifProfile = buildHeroMotifProfile(intentSeed.intent, resolvedHeroMotif, episodeSeed.episodeIntent, theme);
  const forceReflectionCluster =
    episodeSeed.episodeIntent === "catoptric-duet" ||
    episodeSeed.episodeIntent === "mirror-procession" ||
    episodeSeed.episodeIntent === "kaleido-coronation" ||
    episodeSeed.episodeIntent === "quad-vigil" ||
    episodeSeed.episodeIntent === "prism-tribunal";
  const heroMotifProfile =
    (episodeSeed.episodeIntent === "mirror-corridor" ||
      episodeSeed.episodeIntent === "mirror-sermon" ||
      forceReflectionCluster) &&
    (baseHeroMotifProfile.clusterConfig.enabled || forceReflectionCluster)
      ? {
          ...baseHeroMotifProfile,
          clusterConfig: {
            ...baseHeroMotifProfile.clusterConfig,
            enabled: true,
            count:
              episodeSeed.episodeIntent === "quad-vigil"
                ? 4
                : episodeSeed.episodeIntent === "catoptric-duet"
                  ? 2
                  : Math.max(3, baseHeroMotifProfile.clusterConfig.count),
          },
          transitionBias: {
            ...baseHeroMotifProfile.transitionBias,
            symmetry: clamp(baseHeroMotifProfile.transitionBias.symmetry + 0.2, 0, 1),
            preferredFamilies: ([
              episodeSeed.episodeIntent === "quad-vigil" ? "quad-kaleido-choir" :
              episodeSeed.episodeIntent === "prism-tribunal" ? "prism-axis-lag" :
              episodeSeed.episodeIntent === "catoptric-duet" ? "bilateral-iris-fold" :
              "mirror-gate-inversion",
              episodeSeed.episodeIntent === "kaleido-coronation" ? "quad-kaleido-choir" : "mirror-gate-inversion",
              episodeSeed.episodeIntent === "prism-tribunal" ? "reflection-slit-shatter" : "prism-axis-lag",
              ...baseHeroMotifProfile.transitionBias.preferredFamilies.filter(
                (family) =>
                  family !== "mirror-kaleido" &&
                  family !== "split-mirror" &&
                  family !== "prism-fold" &&
                  family !== "bilateral-iris-fold" &&
                  family !== "mirror-gate-inversion" &&
                  family !== "prism-axis-lag" &&
                  family !== "quad-kaleido-choir" &&
                  family !== "reflection-slit-shatter",
              ),
            ].slice(0, 4)) as HeroMotifProfile["transitionBias"]["preferredFamilies"],
          },
        }
      : baseHeroMotifProfile;
  const relationshipClass = chooseHeroRelationshipClass(
    compositionPlan,
    relationshipSeed,
    heroMotifProfile.clusterConfig.count,
  );
  const relationshipMode = chooseHeroRelationshipMode(
    heroMotifProfile.clusterConfig.relationshipMode,
    heroMotifProfile.key,
    episodeSeed.episodeIntent,
    relationshipClass,
    relationshipSeed,
    heroMotifProfile.clusterConfig.count,
  );
  const preferredFamilies = [...heroMotifProfile.transitionBias.preferredFamilies];
  const preferredFamilyOffset = preferredFamilies.length > 1 ? pickIndex(transitionPreferenceSeed, preferredFamilies.length) : 0;
  const resolvedHeroMotifProfile = {
    ...heroMotifProfile,
    clusterConfig: {
      ...heroMotifProfile.clusterConfig,
      relationshipMode,
    },
    transitionBias: {
      ...heroMotifProfile.transitionBias,
      preferredFamilies:
        preferredFamilies.length > 1
          ? ([...preferredFamilies.slice(preferredFamilyOffset), ...preferredFamilies.slice(0, preferredFamilyOffset)] as HeroMotifProfile["transitionBias"]["preferredFamilies"])
          : heroMotifProfile.transitionBias.preferredFamilies,
    },
  };
  const heroMotifVariant = buildHeroMotifVariant(resolvedHeroMotifProfile, edgeMap, theme, motifVariantSeed, episodeSeed, intentSeed);
  const heroPrimitive = pickHeroPrimitive(intentSeed.intent, edgeMap, episodeSeed.episodeIntent, theme, resolvedHeroMotifProfile, compositionPlan);
  const heroPrimitiveFallback = fallbackHeroPrimitiveFromProfile(heroPrimitive, resolvedHeroMotifProfile);
  const heroSubEmitterFamily = heroSubEmitterFamilyForPrimitive(heroPrimitive, edgeMap.fractalMotif, resolvedHeroMotifProfile, heroStoryBeat);
  const heroSubEmitterVariant = heroSubEmitterVariantKey(heroPrimitive, edgeMap.fractalMotif, subEmitterMode, heroStoryBeat, resolvedHeroMotifProfile);
  const heroSubEmitterMotifAlignment = heroSubEmitterMotifAlignmentScore(heroPrimitive, edgeMap.fractalMotif, heroSubEmitterFamily);
  const heroInstanceSeed = buildHeroInstanceSeed(heroPrimitive, intentSeed, edgeMap, theme, heroInstanceSeedValue);
  const heroExpandedBands = preferredExpandedBandsForMotif(resolvedHeroMotif, continuitySeed);
  const heroConductorSelection = chooseHeroConductorSelection(resolvedHeroMotif, resolvedHeroMotifProfile.intensityClass, conductorSeed, episodeSeed.episodeIntent);
  const heroCircleEmitterNodeIndices = selectHeroCircleEmitterNodeIndices(compositionPlan.supportSlots.length, compositionPlan.backgroundSlots.length, circleEmitterSeed);
  const heroEmitterOffsets = heroEmitterOffsetsForPrimitive(heroPrimitive);
  const heroConcreteBias = clamp(0.76 + theme.styleProfile.contrast * 0.22 + theme.styleProfile.edgeDensity * 0.12, 0.72, 1.1);
  const heroOutlineSuppression = clamp(0.62 + theme.styleProfile.saturationMean * 0.2, 0.58, 0.9);
  const nebulaBandRouting = buildNebulaBandRouting(intentSeed, theme, edgeMap);
  const motifPhysicsProfile = buildMotifPhysicsProfile(resolvedHeroMotif, intentSeed.intent, episodeSeed.episodeIntent);
  const heroPhysicsEnvelope = evaluatePhysicsEnvelope(motifPhysicsProfile, {
    subLow: theme.styleProfile.warmCoolBias > 0 ? 0.18 : 0.12,
    low: 0.24,
    mid: 0.26,
    highMid: 0.18,
    high: 0.14,
  });
  const sceneGraph: SceneGraph = {
    sceneKey: edgeMap.imagePath,
    imagePath: edgeMap.imagePath,
    sourceMotif: edgeMap.fractalMotif,
    heroMotifScheduled: resolvedHeroMotif,
    heroMotifSlotIndex: options.heroMotifSlotIndex ?? 0,
    heroMotifSlotStartSec: options.heroMotifSlotStartSec ?? 0,
    heroMotifSlotEndSec: options.heroMotifSlotEndSec ?? 0,
    heroMotifScheduleReason: options.heroMotifScheduleReason ?? "body-hold",
    heroMotifLockEnabled: options.heroMotifLockEnabled ?? false,
    shotGrammarKey: compositionPlan.shotGrammarKey,
    heroRelationshipClass: relationshipClass,
    heroLayoutFamily:
      relationshipMode === "cojoined"
        ? "cojoined-cluster"
        : relationshipMode === "mirror-x"
          ? "bilateral-stage"
          : relationshipMode === "mirror-y"
            ? "vertical-stage"
            : relationshipMode === "mirror-xy"
              ? "quad-stage"
              : "independent-lanes",
    heroPath: buildHeroPath(edgeMap, compositionPlan, heroPathTemplate),
    heroOrbitRadius: clamp(compositionPlan.heroRadius * 0.22, 18, 72),
    heroPrimitive,
    heroPrimitiveFallback,
    heroSubEmitterFamily,
    heroSubEmitterVariant,
    heroSubEmitterMotifAlignmentScore: heroSubEmitterMotifAlignment,
    heroShellMode: "none",
    heroBaseShellMode: "none",
    heroResolvedShellMode: "none",
    heroCircleShellEligible: false,
    heroCircleShellPromoted: false,
    heroShellSceneEnabled: false,
    heroShellConfiguredCount: 0,
    heroShellColorMode: "single",
    heroShellLayers: [],
    heroConcreteBias,
    heroOutlineSuppression,
    heroEmitterOffsets,
    heroInstanceSeed,
    heroMotifProfile: resolvedHeroMotifProfile,
    heroMotifVariant,
    heroClusterConfig: resolvedHeroMotifProfile.clusterConfig,
    heroEmissionTuning: resolvedHeroMotifProfile.emissionTuning,
    motifPhysicsProfile,
    heroPhysicsEnvelope,
    diagnosticPhysicsFamily: motifPhysicsProfile.key,
    nebulaBandRouting,
    heroGlyphs: heroGlyphsForPrimitive(heroPrimitive, heroPrimitiveFallback),
    heroArchetype,
    heroStoryBeat,
    heroEmissionMode,
    subEmitterMode,
    continuitySeed,
    heroGlyphGrammar,
    heroConductorSelection,
    heroConductorDensity: heroConductorSelection.density,
    heroCircleEmitterNodeIndices,
    heroExpandedBands,
    nonSubEmitterHeroParticleBias: resolvedHeroMotifProfile.nonSubEmitterParticleBias ?? 0.6,
    sourceAttractorProfile: buildSourceAttractorProfile(intentSeed, edgeMap, theme),
    supportAttractors: compositionPlan.supportSlots,
    backgroundAttractors: compositionPlan.backgroundSlots,
    motifFamilySet: motifFamilySet(edgeMap, theme),
    backgroundPlan: options.backgroundPlan ?? buildBackgroundPlan(theme, compositionPlan, edgeMap, intentSeed, backgroundSeed, nebulaBandRouting),
    particleBehaviors: options.particleBehaviors ?? buildParticleBehaviorsForIntent(compositionPlan, intentSeed, episodeSeed, edgeMap.fractalMotif, heroEmissionMode, subEmitterMode),
    intentSeed,
    episodeSeed,
    heroPriorityRadius: clamp(compositionPlan.heroRadius * (0.72 + intentSeed.heroDirective.dominance * 0.14), 42, compositionPlan.heroRadius * 1.05),
    supportPriorityRadius: clamp(compositionPlan.heroRadius * 1.42, compositionPlan.heroRadius * 1.05, compositionPlan.heroRadius * 2.1),
    occupancyLingerFrames: Math.round(8 + (1 - intentSeed.supportDirective.lingerPenalty) * 16),
    heroVisibilityBias: clamp(0.9 + intentSeed.heroDirective.dominance * 0.45, 0.9, 1.4),
    supportAttractorRoles: compositionPlan.supportSlots.map((_, index) => (index % 2 === 0 ? "escort" : "relay")),
    backgroundAttractorRoles: compositionPlan.backgroundSlots.map((_, index) => (index % 2 === 0 ? "release" : "fog")),
    occupancyPolicy: {
      heroAllowed: ["hero-wake", "path-node", "ritual-ring"],
      supportAllowed: intentSeed.intent === "orbit-ritual" || intentSeed.intent === "cathedral-procession"
        ? ["support-wake", "path-node", "ritual-ring"]
        : ["support-wake", "burst-remnant", "path-node"],
      backgroundAllowed: ["ambient-fog", "burst-remnant"],
      suppressLowMotionBelow: 0.55 + intentSeed.backgroundDirective.lingerPenalty * 0.75,
    },
    midScaleFamilies: midScaleFamiliesForIntent(intentSeed.intent),
    emitterCandidateIndices: compositionPlan.supportSlots.map((_, index) => index).filter((index) => index % 2 === 0).slice(0, 4),
    absorberCandidateIndices: compositionPlan.supportSlots.map((_, index) => index).filter((index) => index % 2 === 1).slice(0, 3),
    transitionIdentitySignature: "",
  };
  return {
    ...sceneGraph,
    transitionIdentitySignature: buildTransitionIdentitySignature(sceneGraph),
  };
}

export function mutateSceneGraphContinuity(
  previous: SceneGraph,
  current: SceneGraph,
  edgeMap: EdgeMap,
  theme: RenderTheme,
): SceneGraph {
  const pairHash = stableStringHash(`${previous.imagePath}->${current.imagePath}`);
  const mutationSeed = deriveSeed(current.continuitySeed, `continuity-mutation:${pairHash}`);
  const samePrimitive = previous.heroPrimitive === current.heroPrimitive;
  const sameTopology = previous.heroInstanceSeed.emitterTopology === current.heroInstanceSeed.emitterTopology;
  const sameMotionBias = previous.heroMotifProfile.motionBias === current.heroMotifProfile.motionBias;
  const sameMotifIdentity =
    previous.heroMotifProfile.key === current.heroMotifProfile.key &&
    previous.intentSeed.intent === current.intentSeed.intent;
  const shouldMutate = samePrimitive || (sameTopology && sameMotionBias) || sameMotifIdentity;
  if (!shouldMutate) {
    return current;
  }

  const alternateCandidates = [
    ...current.heroMotifProfile.heroPrimitivePool.filter((primitive) => primitive !== current.heroPrimitive && primitive !== previous.heroPrimitive),
    ...current.heroMotifProfile.fallbackHeroPrimitivePool.filter(
      (primitive, index, pool) =>
        primitive !== current.heroPrimitive &&
        primitive !== previous.heroPrimitive &&
        primitive !== "arrow" &&
        !pool.slice(0, index).includes(primitive) &&
        !current.heroMotifProfile.heroPrimitivePool.includes(primitive),
    ),
  ];
  const alternatePrimitive =
    alternateCandidates[pickIndex(deriveSeed(mutationSeed, "alternate-primitive"), Math.max(1, alternateCandidates.length))] ??
    current.heroPrimitiveFallback;
  const continuitySeed = deriveSeed(mutationSeed, "continuity-seed");
  const heroInstanceSeed = buildHeroInstanceSeed(alternatePrimitive, current.intentSeed, edgeMap, theme, deriveSeed(continuitySeed, "hero-instance"));
  const topologyCandidates = (["orbit", "bilateral", "fan", "spine", "petal"] as const).filter(
    (topology) => topology !== previous.heroInstanceSeed.emitterTopology && topology !== heroInstanceSeed.emitterTopology,
  );
  const mutatedTopology =
    sameTopology && topologyCandidates.length > 0
      ? topologyCandidates[pickIndex(deriveSeed(mutationSeed, "mutated-topology"), topologyCandidates.length)]!
      : heroInstanceSeed.emitterTopology;
  const mutated: SceneGraph = {
    ...current,
    heroPrimitive: alternatePrimitive,
    heroPrimitiveFallback: fallbackHeroPrimitiveFromProfile(alternatePrimitive, current.heroMotifProfile),
    heroSubEmitterFamily: heroSubEmitterFamilyForPrimitive(alternatePrimitive, edgeMap.fractalMotif, current.heroMotifProfile, current.heroStoryBeat),
    heroSubEmitterVariant: heroSubEmitterVariantKey(alternatePrimitive, edgeMap.fractalMotif, current.subEmitterMode, current.heroStoryBeat, current.heroMotifProfile),
    heroSubEmitterMotifAlignmentScore: heroSubEmitterMotifAlignmentScore(
      alternatePrimitive,
      edgeMap.fractalMotif,
      heroSubEmitterFamilyForPrimitive(alternatePrimitive, edgeMap.fractalMotif, current.heroMotifProfile, current.heroStoryBeat),
    ),
    heroShellMode: "none",
    heroBaseShellMode: "none",
    heroResolvedShellMode: "none",
    heroCircleShellEligible: false,
    heroCircleShellPromoted: false,
    heroShellSceneEnabled: current.heroShellSceneEnabled,
    heroShellConfiguredCount: current.heroShellConfiguredCount,
    heroShellColorMode: current.heroShellColorMode,
    heroShellLayers: current.heroShellLayers,
    heroEmitterOffsets: heroEmitterOffsetsForPrimitive(alternatePrimitive),
    heroGlyphs: heroGlyphsForPrimitive(alternatePrimitive, fallbackHeroPrimitiveFromProfile(alternatePrimitive, current.heroMotifProfile)),
    continuitySeed,
    heroInstanceSeed: {
      ...heroInstanceSeed,
      emitterTopology: mutatedTopology,
      variantKey: `${heroInstanceSeed.variantKey}:mut${pickIndex(deriveSeed(mutationSeed, "mutation-tag"), 11)}`,
    },
  };
  return {
    ...mutated,
    transitionIdentitySignature: buildTransitionIdentitySignature(mutated),
  };
}

export function mutateSceneGraphForTransition(
  previous: SceneGraph,
  current: SceneGraph,
  edgeMap: EdgeMap,
  theme: RenderTheme,
  triggerMode: "swap" | "hold",
  lastTransitionIdentitySignature?: string,
): SceneGraph {
  const pairHash = stableStringHash(`${previous.imagePath}|${current.imagePath}|${triggerMode}|${lastTransitionIdentitySignature ?? ""}`);
  const transitionSeed = deriveSeed(current.continuitySeed, `transition-mutation:${pairHash}:${triggerMode}`);
  const motifCandidates = current.heroMotifLockEnabled ? [current.heroMotifProfile] : transitionMotifCandidates(current, edgeMap, theme);
  const alternateProfile =
    motifCandidates[pickIndex(deriveSeed(transitionSeed, "alternate-profile"), Math.max(1, motifCandidates.length))] ??
    current.heroMotifProfile;
  const continuitySeed = deriveSeed(transitionSeed, "continuity-seed");
  const relationshipMode = chooseHeroRelationshipMode(
    alternateProfile.clusterConfig.relationshipMode,
    alternateProfile.key,
    current.episodeSeed.episodeIntent,
    current.heroRelationshipClass ?? "independent",
    deriveSeed(continuitySeed, "relationship"),
    Math.max(2, alternateProfile.clusterConfig.count),
  );
  const heroMotifProfile: HeroMotifProfile = {
    ...alternateProfile,
    key: current.heroMotifLockEnabled || triggerMode !== "hold"
      ? alternateProfile.key
      : `${alternateProfile.key}:hold-${pickIndex(deriveSeed(transitionSeed, "hold-tag"), 7)}`,
    clusterConfig: {
      ...alternateProfile.clusterConfig,
      enabled: true,
      count: Math.max(triggerMode === "hold" ? 2 : 1, alternateProfile.clusterConfig.count),
      relationshipMode,
    },
  };
  const heroMotifVariant = buildHeroMotifVariant(heroMotifProfile, edgeMap, theme, deriveSeed(continuitySeed, "motif-variant"), current.episodeSeed, current.intentSeed);
  const heroPrimitiveCandidates = [
    ...heroMotifProfile.heroPrimitivePool,
    ...heroMotifProfile.fallbackHeroPrimitivePool,
  ].filter((primitive, index, pool) => primitive !== previous.heroPrimitive && primitive !== current.heroPrimitive && pool.indexOf(primitive) === index);
  const heroPrimitive = heroPrimitiveCandidates[pickIndex(deriveSeed(transitionSeed, "hero-primitive"), Math.max(1, heroPrimitiveCandidates.length))] ?? current.heroPrimitiveFallback;
  const heroPrimitiveFallback = fallbackHeroPrimitiveFromProfile(heroPrimitive, heroMotifProfile);
  const heroInstanceSeed = buildHeroInstanceSeed(heroPrimitive, current.intentSeed, edgeMap, theme, deriveSeed(continuitySeed, "hero-instance"));
  const topologyPool = (["orbit", "bilateral", "fan", "spine", "petal"] as const).filter(
    (topology) => topology !== previous.heroInstanceSeed.emitterTopology || heroMotifProfile.key !== previous.heroMotifProfile.key,
  );
  const emitterTopology = topologyPool[pickIndex(deriveSeed(transitionSeed, "emitter-topology"), Math.max(1, topologyPool.length))] ?? heroInstanceSeed.emitterTopology;
  const mutated: SceneGraph = {
    ...current,
    continuitySeed,
    heroMotifProfile,
    heroMotifVariant,
    heroPrimitive,
    heroPrimitiveFallback,
    heroSubEmitterFamily: heroSubEmitterFamilyForPrimitive(heroPrimitive, edgeMap.fractalMotif, heroMotifProfile, current.heroStoryBeat),
    heroSubEmitterVariant: heroSubEmitterVariantKey(heroPrimitive, edgeMap.fractalMotif, current.subEmitterMode, current.heroStoryBeat, heroMotifProfile),
    heroSubEmitterMotifAlignmentScore: heroSubEmitterMotifAlignmentScore(
      heroPrimitive,
      edgeMap.fractalMotif,
      heroSubEmitterFamilyForPrimitive(heroPrimitive, edgeMap.fractalMotif, heroMotifProfile, current.heroStoryBeat),
    ),
    heroShellMode: "none",
    heroBaseShellMode: "none",
    heroResolvedShellMode: "none",
    heroCircleShellEligible: false,
    heroCircleShellPromoted: false,
    heroShellSceneEnabled: current.heroShellSceneEnabled,
    heroShellConfiguredCount: current.heroShellConfiguredCount,
    heroShellColorMode: current.heroShellColorMode,
    heroShellLayers: current.heroShellLayers,
    heroEmitterOffsets: heroEmitterOffsetsForPrimitive(heroPrimitive),
    heroClusterConfig: heroMotifProfile.clusterConfig,
    heroEmissionTuning: heroMotifProfile.emissionTuning,
    heroGlyphs: heroGlyphsForPrimitive(heroPrimitive, heroPrimitiveFallback),
    heroInstanceSeed: {
      ...heroInstanceSeed,
      emitterTopology,
      variantKey: `${heroInstanceSeed.variantKey}:tx${pickIndex(deriveSeed(transitionSeed, "transition-tag"), 17)}`,
    },
  };
  const signature = buildTransitionIdentitySignature(mutated);
  if (
    heroMotifProfile.key === previous.heroMotifProfile.key ||
    signature === lastTransitionIdentitySignature
  ) {
    return mutateSceneGraphContinuity(previous, { ...mutated, transitionIdentitySignature: signature }, edgeMap, theme);
  }
  return {
    ...mutated,
    transitionIdentitySignature: signature,
  };
}

export function sampleSceneGraphPath(sceneGraph: SceneGraph, progress: number): HeroPathPoint {
  const points = sceneGraph.heroPath;
  if (points.length <= 1) {
    return pointAt(points, 0);
  }
  const wrapped = ((progress % 1) + 1) % 1;
  const scaled = wrapped * points.length;
  const index = Math.floor(scaled) % points.length;
  const nextIndex = (index + 1) % points.length;
  const local = scaled - Math.floor(scaled);
  const from = points[index]!;
  const to = points[nextIndex]!;
  const tangent = normalize(
    from.tangentX + (to.tangentX - from.tangentX) * local,
    from.tangentY + (to.tangentY - from.tangentY) * local,
  );
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local,
    tangentX: tangent.x,
    tangentY: tangent.y,
    radius: from.radius + (to.radius - from.radius) * local,
  };
}
