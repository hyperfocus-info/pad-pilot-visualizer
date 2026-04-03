import { clamp } from "../config";
import type {
  AudioFrameFeature,
  EdgeMap,
  EventSpecId,
  OverlayMode,
  PersistentMotifId,
  PersistentMotifSpec,
  PersistentMotifState,
  RenderTheme,
  TransitionFamily,
  VisualPhrasePlan,
  VisualRegime,
} from "../types";

function phrase(value: string): string {
  return value.replace(/-/g, " ");
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function spec(params: {
  id: PersistentMotifId;
  label: string;
  influenceRefs: string[];
  preferredFractalMotifs: EdgeMap["fractalMotif"][];
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
}): PersistentMotifSpec {
  return {
    family: "continuity-bias",
    ...params,
    pitch: `A continuity bias concept that keeps a specific transition and overlay grammar alive across multiple scene windows.`,
    distinction: `It differs by favoring ${params.preferredTransitionFamilies.slice(0, 3).map(phrase).join(", ")} transitions and leaning ${params.holdFavoring >= params.swapFavoring ? "toward holding" : "toward swapping"} scene identity.`,
    eligibility: {
      motifs: params.preferredFractalMotifs,
      regimes: ["intro", "groove", "build", "drop", "breakdown", "outro"],
      arcs:
        params.swapFavoring > params.holdFavoring
          ? ["swap", "mixed"]
          : ["hold", "mixed"],
    },
    continuityPolicy:
      params.holdFavoring > params.swapFavoring
        ? "hold-friendly"
        : "swap-friendly",
    runtimeTuning: {
      couplingScale: params.heroMutationBias,
      triggerCooldownScale: params.changeCooldownBeats,
      supportsMute: false,
    },
  };
}

export const PERSISTENT_MOTIF_SPECS: PersistentMotifSpec[] = [
  spec({
    id: "audio-synced-whip-pan-hallucinations",
    label: "Audio-Synced Whip-Pan Hallucinations",
    influenceRefs: ["David Lynch", "Aphex Twin", "Edgar Wright", "Arca"],
    preferredFractalMotifs: ["shattered-arc", "film-bloom-shard", "vector-incantation"],
    preferredTransitionFamilies: ["wright-whip-pan-particle-smear", "whip-pan-x", "resolution-crash-snapback", "kon-reality-shatter-match-cut"],
    preferredEventSpecs: ["triboluminescent-crystal-fracture-flashes", "electromagnetic-crown-flash-shifting"],
    overlayBias: { "kinetic-scan": 1, "climax-burst": 0.86 },
    heroMutationBias: 0.9,
    holdFavoring: 0.2,
    swapFavoring: 0.9,
    transientGateThreshold: 0.78,
    minCarryFrames: 24,
    maxCarryFrames: 160,
    changeCooldownBeats: 8,
    influenceKey: "lynch-aphex-whip",
  }),
  spec({
    id: "non-linear-stream-consciousness-tracking",
    label: "Non-Linear Stream-Of-Consciousness Tracking Shots",
    influenceRefs: ["William S. Burroughs", "James Joyce", "Bill Viola"],
    preferredFractalMotifs: ["smoke-ribbon", "glass-orbital", "data-cathedral"],
    preferredTransitionFamilies: ["barlog-continuous-camera-particle-sweep", "phase-ghost", "mobius-wrap-tunnel", "joyce-fluid-text-morph", "corridor-reflection-transit", "infinite-reflection-zoom"],
    preferredEventSpecs: ["fluid-dynamic-starling-murmuration", "bioluminescent-dinoflagellate-agitation"],
    overlayBias: { "stable-feedback": 1, "pulse-wave": 0.74 },
    heroMutationBias: 0.44,
    holdFavoring: 0.92,
    swapFavoring: 0.3,
    transientGateThreshold: 0.82,
    minCarryFrames: 48,
    maxCarryFrames: 220,
    changeCooldownBeats: 12,
    influenceKey: "joyce-burroughs-tracking",
  }),
  spec({
    id: "symmetrical-fourth-wall-glitches",
    label: "Symmetrical Fourth-Wall Breaking Glitches",
    influenceRefs: ["Nam June Paik", "Ryoji Ikeda", "Grant Morrison"],
    preferredFractalMotifs: ["harmonic-lattice", "data-cathedral", "vector-incantation"],
    preferredTransitionFamilies: ["kojima-tactical-glitch-noise", "datamosh-vector-drag", "hallucinogenic-hex-grid", "split-mirror", "mirror-gate-inversion", "quadrant-mirror-sweep", "mirror-grid-dissolve"],
    preferredEventSpecs: ["electromagnetic-crown-flash-shifting", "ionospheric-red-sprite-discharge", "catoptric-chamber-light-fold"],
    overlayBias: { "kinetic-scan": 1, "stable-feedback": 0.68 },
    heroMutationBias: 0.74,
    holdFavoring: 0.56,
    swapFavoring: 0.66,
    transientGateThreshold: 0.8,
    minCarryFrames: 36,
    maxCarryFrames: 180,
    changeCooldownBeats: 8,
    influenceKey: "ikeda-paik-wallglitch",
  }),
  spec({
    id: "typographic-labyrinth-dreams",
    label: "Typographic Labyrinth Dream Sequences",
    influenceRefs: ["Mark Z. Danielewski", "Norman McLaren", "John Cage"],
    preferredFractalMotifs: ["data-cathedral", "vector-incantation", "harmonic-lattice"],
    preferredTransitionFamilies: ["joyce-fluid-text-morph", "danielewski-house-typographic-distortion", "wire-solid-phase-cut", "moore-nine-panel-particle-grid", "reflection-slit-shatter", "mirror-interlock-weave", "synchronized-mirror-slice"],
    preferredEventSpecs: ["cymatic-resonance-sand-metamorphosis", "deep-sea-siphonophore-light-ripples", "mercury-mirror-ripple-shear"],
    overlayBias: { "sparse-contour": 1, "stable-feedback": 0.6 },
    heroMutationBias: 0.58,
    holdFavoring: 0.84,
    swapFavoring: 0.42,
    transientGateThreshold: 0.76,
    minCarryFrames: 54,
    maxCarryFrames: 220,
    changeCooldownBeats: 10,
    influenceKey: "danielewski-typography",
  }),
  spec({
    id: "continuous-one-shot-temporal-shifts",
    label: "Continuous One-Shot Temporal Shifts",
    influenceRefs: ["Bill Viola", "Steve Reich", "Cory Barlog"],
    preferredFractalMotifs: ["glass-orbital", "cathedral-filament", "smoke-ribbon"],
    preferredTransitionFamilies: ["barlog-continuous-camera-particle-sweep", "dolly-in", "mobius-wrap-tunnel", "soft-starlight-blur"],
    preferredEventSpecs: ["acoustic-cavitation-sonoluminescence", "fluid-dynamic-starling-murmuration"],
    overlayBias: { "stable-feedback": 0.92, "pulse-wave": 0.72 },
    heroMutationBias: 0.36,
    holdFavoring: 1,
    swapFavoring: 0.28,
    transientGateThreshold: 0.84,
    minCarryFrames: 64,
    maxCarryFrames: 240,
    changeCooldownBeats: 16,
    influenceKey: "one-shot-temporal",
  }),
  spec({
    id: "comic-panel-nested-realities",
    label: "Psychedelic Comic-Panel Nested Realities",
    influenceRefs: ["Grant Morrison", "Alan Moore", "Wassily Kandinsky"],
    preferredFractalMotifs: ["mandelbloom", "shattered-arc", "film-bloom-shard"],
    preferredTransitionFamilies: ["moore-nine-panel-particle-grid", "trip-kaleido", "voronoi-drop-shatter", "color-shift-kaleidoscope-burst", "quad-kaleido-choir", "kaleido-iris-zoom", "snowflake-kaleido-bloom"],
    preferredEventSpecs: ["triboluminescent-crystal-fracture-flashes", "explosive-fungal-spore-cloud-dispersal", "kaleidoscopic-wingbeat-refrain"],
    overlayBias: { "climax-burst": 0.96, "kinetic-scan": 0.7 },
    heroMutationBias: 0.86,
    holdFavoring: 0.38,
    swapFavoring: 0.82,
    transientGateThreshold: 0.74,
    minCarryFrames: 30,
    maxCarryFrames: 156,
    changeCooldownBeats: 8,
    influenceKey: "morrison-moore-panels",
  }),
  spec({
    id: "metatextual-surveillance-perspectives",
    label: "Metatextual Surveillance Camera Perspectives",
    influenceRefs: ["Jon Rafman", "Nam June Paik", "Pippin Barr"],
    preferredFractalMotifs: ["data-cathedral", "harmonic-lattice", "halo-cell"],
    preferredTransitionFamilies: ["hallucinogenic-hex-grid", "kojima-tactical-glitch-noise", "datamosh-vector-drag", "phase-lattice", "prism-axis-lag", "tri-prism-fold", "refractive-shard-tumble"],
    preferredEventSpecs: ["electromagnetic-crown-flash-shifting", "deep-sea-siphonophore-light-ripples", "axial-vortex-reversal-bloom"],
    overlayBias: { "stable-feedback": 0.9, "kinetic-scan": 0.76 },
    heroMutationBias: 0.52,
    holdFavoring: 0.82,
    swapFavoring: 0.4,
    transientGateThreshold: 0.8,
    minCarryFrames: 44,
    maxCarryFrames: 180,
    changeCooldownBeats: 10,
    influenceKey: "surveillance-metatext",
  }),
  spec({
    id: "rhythm-driven-reality-metamorphosis",
    label: "Rhythm-Driven Reality Metamorphosis",
    influenceRefs: ["Tetsuya Mizuguchi", "Bjork", "Autechre"],
    preferredFractalMotifs: ["mandelbloom", "harmonic-lattice", "chromatic-xylem"],
    preferredTransitionFamilies: ["chromatic-mandala-spin", "mobius-wrap-tunnel", "prismatic-vortex-swirl", "floyd-dark-side-prism-dispersal", "quad-kaleido-choir", "refractive-prism-spin", "prismatic-radial-wipe", "vortex-mirror-spiral"],
    preferredEventSpecs: ["cymatic-resonance-sand-metamorphosis", "acoustic-cavitation-sonoluminescence", "parhelion-double-sun-flare"],
    overlayBias: { "climax-burst": 1, "pulse-wave": 0.78 },
    heroMutationBias: 0.88,
    holdFavoring: 0.54,
    swapFavoring: 0.7,
    transientGateThreshold: 0.7,
    minCarryFrames: 28,
    maxCarryFrames: 168,
    changeCooldownBeats: 8,
    influenceKey: "mizuguchi-rhythm-morph",
  }),
  spec({
    id: "architectural-time-lapse-hyperdetail",
    label: "Hyper-Detailed Architectural Time-Lapses",
    influenceRefs: ["James Turrell", "Brian Eno", "Stanley Kubrick"],
    preferredFractalMotifs: ["cathedral-filament", "data-cathedral", "harmonic-lattice"],
    preferredTransitionFamilies: ["gilligan-time-lapse-particle-sand", "parallax-slide", "celestial-aurora-wipe", "glass-shatter-reflect", "crystal-facet-reveal"],
    preferredEventSpecs: ["ionospheric-red-sprite-discharge", "kawah-ijen-blue-sulfur-combustion"],
    overlayBias: { "stable-feedback": 1, "sparse-contour": 0.8 },
    heroMutationBias: 0.28,
    holdFavoring: 0.96,
    swapFavoring: 0.24,
    transientGateThreshold: 0.86,
    minCarryFrames: 72,
    maxCarryFrames: 260,
    changeCooldownBeats: 16,
    influenceKey: "architectural-timelapse",
  }),
  spec({
    id: "cosmic-neon-descent",
    label: "Cosmic Neon Descent Long Takes",
    influenceRefs: ["Oskar Fischinger", "Jodorowsky", "Yayoi Kusama"],
    preferredFractalMotifs: ["glass-orbital", "mandelbloom", "halo-cell"],
    preferredTransitionFamilies: ["kubrick-slit-scan-star-gate", "mobius-wrap-tunnel", "snare-negative-flip", "deep-space-flare-transition", "bilateral-iris-fold", "kaleido-tunnel-zoom", "centrifugal-hex-mirror", "bilateral-flip-drift"],
    preferredEventSpecs: ["ionospheric-red-sprite-discharge", "bioluminescent-dinoflagellate-agitation", "kawah-ijen-blue-sulfur-combustion", "parhelion-double-sun-flare"],
    overlayBias: { "climax-burst": 0.9, "stable-feedback": 0.74 },
    heroMutationBias: 0.62,
    holdFavoring: 0.88,
    swapFavoring: 0.46,
    transientGateThreshold: 0.77,
    minCarryFrames: 46,
    maxCarryFrames: 210,
    changeCooldownBeats: 12,
    influenceKey: "cosmic-neon-descent",
    selectionWeight: 1.25,
  }),
];

export function buildPersistentMotifState(
  spec: PersistentMotifSpec,
  ageFrames: number,
  carryFrames: number,
  changeGate: PersistentMotifState["changeGate"],
  transientScore: number,
  beatIndex: number,
): PersistentMotifState {
  return {
    id: spec.id,
    label: spec.label,
    influenceKey: spec.influenceKey,
    ageFrames,
    carryFrames,
    changedThisFrame: changeGate !== "startup" ? carryFrames === 0 : true,
    changeGate,
    transientScore,
    cooldownUntilBeat: beatIndex + spec.changeCooldownBeats,
  };
}

export function transientPeakScore(frame: AudioFrameFeature, phrasePlan?: VisualPhrasePlan): number {
  return clamp(
    frame.peakStrength * 0.34 +
      frame.onsetStrength * 0.22 +
    (frame.bandWeightedScore ?? frame.dbNormalized) * 0.18 +
      (frame.isBeatAccent ? 0.08 : 0) +
    (frame.isBarDownbeat ? 0.08 : 0) +
    (frame.isFourBarDownbeat ? 0.1 : 0) +
    (phrasePlan?.rapidPeakDensity ?? 0) * 0.08,
    0,
    1.4,
  );
}

function rankedCandidates(edgeMap: EdgeMap, visualRegime: VisualRegime, theme: RenderTheme): PersistentMotifSpec[] {
  return [...PERSISTENT_MOTIF_SPECS].sort((a, b) => {
    const aScore =
      (a.preferredFractalMotifs.includes(edgeMap.fractalMotif) ? 2 : 0) +
      (a.overlayBias[visualRegime === "drop" ? "climax-burst" : "stable-feedback"] ?? 0) +
      (a.selectionWeight ?? 1) * 0.25 +
      (theme.styleProfile.symmetry > 0.6 && a.preferredTransitionFamilies.some((family) => family.includes("grid") || family.includes("mirror")) ? 0.6 : 0);
    const bScore =
      (b.preferredFractalMotifs.includes(edgeMap.fractalMotif) ? 2 : 0) +
      (b.overlayBias[visualRegime === "drop" ? "climax-burst" : "stable-feedback"] ?? 0) +
      (b.selectionWeight ?? 1) * 0.25 +
      (theme.styleProfile.symmetry > 0.6 && b.preferredTransitionFamilies.some((family) => family.includes("grid") || family.includes("mirror")) ? 0.6 : 0);
    return bScore - aScore;
  });
}

export function selectInitialPersistentMotif(
  edgeMap: EdgeMap,
  visualRegime: VisualRegime,
  theme: RenderTheme,
  seed: number,
): PersistentMotifSpec {
  const candidates = rankedCandidates(edgeMap, visualRegime, theme);
  const hash = stableHash(`${edgeMap.imagePath}|${edgeMap.fractalMotif}|${visualRegime}|${seed}|${theme.styleProfile.effectSeed}`);
  return candidates[hash % Math.max(1, candidates.length)] ?? PERSISTENT_MOTIF_SPECS[0]!;
}

export function shouldRotatePersistentMotif(params: {
  frame: AudioFrameFeature;
  phrasePlan?: VisualPhrasePlan;
  current: PersistentMotifState | undefined;
  spec: PersistentMotifSpec;
  frameIndex: number;
}): boolean {
  const { frame, phrasePlan, current, spec, frameIndex } = params;
  const score = transientPeakScore(frame, phrasePlan);
  const beatIndex = frame.beatIndex ?? frame.frameIndex;
  if (!current) {
    return true;
  }
  if (frameIndex - current.carryFrames < spec.minCarryFrames) {
    return false;
  }
  if (current.ageFrames < spec.minCarryFrames) {
    return false;
  }
  if (beatIndex < current.cooldownUntilBeat) {
    return false;
  }
  if (current.ageFrames >= spec.maxCarryFrames) {
    return true;
  }
  return score >= spec.transientGateThreshold;
}

export function selectNextPersistentMotif(params: {
  currentId?: PersistentMotifId;
  edgeMap: EdgeMap;
  visualRegime: VisualRegime;
  theme: RenderTheme;
  frame: AudioFrameFeature;
  phrasePlan?: VisualPhrasePlan;
}): PersistentMotifSpec {
  const { currentId, edgeMap, visualRegime, theme, frame } = params;
  const candidates = rankedCandidates(edgeMap, visualRegime, theme).filter((entry) => entry.id !== currentId);
  const pool = candidates.length > 0 ? candidates : PERSISTENT_MOTIF_SPECS;
  const hash = stableHash(`${edgeMap.imagePath}|${visualRegime}|${frame.frameIndex}|${frame.phrase4Index ?? 0}|${theme.styleProfile.effectSeed}`);
  return pool[hash % Math.max(1, pool.length)] ?? PERSISTENT_MOTIF_SPECS[0]!;
}
