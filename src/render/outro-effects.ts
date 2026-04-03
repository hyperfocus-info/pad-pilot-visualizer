import { clamp } from "../config";
import type {
  ActiveSubjectSnapshot,
  ActiveSubjectState,
  AudioFrameFeature,
  EdgeMap,
  FractalMotif,
  OutroEffectAudioMode,
  OutroEffectCategory,
  OutroEffectId,
  OutroEffectSpec,
  OutroEffectState,
  RenderQualityBudget,
  RenderTheme,
  SelectionTag,
  SceneGraph,
  TransitionFamily,
  VisualState,
} from "../types";
import { paletteColor } from "./palette";

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableFloat(value: string): number {
  return (stableHash(value) % 10_000) / 10_000;
}

const REFLECTIVE_OUTRO_EFFECTS = new Set<OutroEffectId>([
  "mirror-lag-orbit",
  "prism-halo-retreat",
  "petal-desat-recursion",
]);

function spec(
  id: OutroEffectId,
  motif: FractalMotif | "wildcard",
  category: OutroEffectCategory,
  influenceKey: string,
  overlayMode: VisualState["overlayMode"],
  transitionFamily: TransitionFamily,
  audioMode: OutroEffectAudioMode,
  beatDivision: number,
  heroBehavior: OutroEffectSpec["heroBehavior"],
  dbBand: OutroEffectSpec["dbResponse"]["band"],
  selectionWeight = 1,
): OutroEffectSpec {
  const selectionTags: SelectionTag[] = [];
  if (REFLECTIVE_OUTRO_EFFECTS.has(id)) {
    selectionTags.push("reflective");
  }
  if (category === "time-play" || heroBehavior === "time-lag") {
    selectionTags.push("temporal-freeze");
  }
  if (heroBehavior !== "none") {
    selectionTags.push("hero-impacting");
  }
  return {
    id,
    motif,
    category,
    influenceKey,
    overlayMode,
    transitionFamily,
    audioMode,
    timingProfile: {
      beatDivision,
      barAccentWeight: category === "camera-flare-pan" || category === "hero-movement" ? 0.9 : 0.72,
      phraseAccentWeight: category === "black-hole" || category === "time-play" ? 1 : 0.78,
      swingAmount:
        influenceKey === "j-dilla" ? 0.22 :
        influenceKey === "daft-punk" ? 0.1 :
        influenceKey === "kendrick-lamar" ? 0.12 :
        0.06,
    },
    dbResponse: {
      band: dbBand,
      gain:
        audioMode === "bpm-db-pulse-gated" ? 1.08 :
        audioMode === "bpm-db-reactive" ? 0.88 :
        0.45,
      floor: category === "desaturate" || category === "fade" ? 0.16 : 0.08,
      ceiling: category === "glitch" || category === "tv-static" ? 1 : 0.92,
    },
    imageControlProfile: {
      hueSource:
        category === "rainbow" ? "palette-cycle" :
        category === "black-hole" || category === "desaturate" ? "dominant-hue" :
        category === "analog" ? "average-hue" :
        "warm-cool",
      satSource:
        category === "desaturate" ? "lightness-mean" :
        category === "rainbow" ? "palette-energy" :
        "saturation-mean",
      contrastSource:
        category === "glitch" || category === "tv-static" ? "edge-density" :
        category === "black-hole" ? "symmetry" :
        "contrast",
      symmetryBias: category === "desaturate" || category === "black-hole" ? 0.8 : 0.4,
      edgeBias: category === "glitch" || category === "tv-static" ? 0.9 : 0.45,
      warmCoolBias: category === "rainbow" || category === "camera-flare-pan" ? 0.72 : 0.35,
    },
    heroBehavior,
    outroWeight:
      motif === "wildcard" ? 0.32 :
      category === "fade" || category === "desaturate" ? 0.86 :
      category === "black-hole" ? 0.7 :
      0.78,
    cooldownBars: motif === "wildcard" ? 12 : 8,
    selectionWeight,
    selectionTags,
  };
}

function weightedPick<T extends { id: string }>(
  entries: readonly T[],
  hashSeed: string,
  weightFor: (entry: T) => number,
): T {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const totalWeight = sorted.reduce((sum, entry) => sum + Math.max(0, weightFor(entry)), 0);
  if (totalWeight <= 0) {
    return sorted[stableHash(hashSeed) % Math.max(1, sorted.length)]!;
  }
  let cursor = stableHash(hashSeed) % Math.max(1, Math.ceil(totalWeight * 1000));
  for (const entry of sorted) {
    cursor -= Math.max(1, Math.round(Math.max(0, weightFor(entry)) * 1000));
    if (cursor < 0) {
      return entry;
    }
  }
  return sorted[sorted.length - 1]!;
}

export const OUTRO_EFFECT_SPECS: OutroEffectSpec[] = [
  spec("mono-strobe-drain", "neon-tube", "desaturate", "edgar-wright", "kinetic-scan", "whip-pan-x", "bpm-db-pulse-gated", 1, "recoil", "high"),
  spec("signal-fade-ladder", "neon-tube", "fade", "daft-punk", "stable-feedback", "dolly-out", "bpm-locked", 2, "pan-follow", "none"),
  spec("terminal-tear-jitter", "neon-tube", "glitch", "sam-esmail", "kinetic-scan", "axis-swap", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("runway-pan-flare", "neon-tube", "camera-flare-pan", "christopher-nolan", "climax-burst", "dolly-in", "bpm-db-reactive", 1, "pan-follow", "broadband"),
  spec("ash-bloom-descent", "smoke-ribbon", "fade", "pink-floyd", "pulse-wave", "ink-melt", "bpm-locked", 2, "drift", "none"),
  spec("memory-vapor-smear", "smoke-ribbon", "time-play", "virginia-woolf", "stable-feedback", "phase-ghost", "bpm-db-reactive", 1, "time-lag", "mid"),
  spec("dilla-drift-pulse", "smoke-ribbon", "hero-movement", "j-dilla", "pulse-wave", "chorus-drift", "bpm-db-pulse-gated", 1, "drift", "low"),
  spec("nocturne-spectrum-bleed", "smoke-ribbon", "rainbow", "gaspar-noe", "climax-burst", "solarize-drift", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("kubrick-iris-decay", "glass-orbital", "desaturate", "stanley-kubrick", "sparse-contour", "phase-ghost", "bpm-locked", 2, "collapse", "none"),
  spec("prism-halo-retreat", "glass-orbital", "rainbow", "daft-punk", "stable-feedback", "prism-fold", "bpm-db-reactive", 1, "orbit", "high"),
  spec("orbit-collapse-well", "glass-orbital", "black-hole", "christopher-nolan", "climax-burst", "fractal-tunnel", "bpm-db-pulse-gated", 4, "collapse", "broadband"),
  spec("mirror-lag-orbit", "glass-orbital", "time-play", "satoshi-kon", "stable-feedback", "afterimage-wheel", "bpm-db-reactive", 1, "time-lag", "mid"),
  spec("stained-fade-vigil", "cathedral-filament", "fade", "alan-moore", "stable-feedback", "veil-shift", "bpm-locked", 2, "drift", "none"),
  spec("choir-scan-shiver", "cathedral-filament", "tv-static", "pink-floyd", "kinetic-scan", "echo-fold", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("nave-echo-glitch", "cathedral-filament", "glitch", "sam-barlow", "kinetic-scan", "split-mirror", "bpm-db-reactive", 1, "time-lag", "high"),
  spec("processional-rise-away", "cathedral-filament", "hero-movement", "cory-barlog", "pulse-wave", "dolly-out", "bpm-db-pulse-gated", 1, "drift", "low"),
  spec("bleach-cell-breath", "halo-cell", "desaturate", "virginia-woolf", "pulse-wave", "lattice-breath", "bpm-locked", 2, "drift", "none"),
  spec("osmotic-afterglow", "halo-cell", "fade", "james-joyce", "pulse-wave", "carry", "bpm-db-reactive", 1, "time-lag", "mid"),
  spec("petri-rainbow-pulse", "halo-cell", "rainbow", "osamu-tezuka", "pulse-wave", "mandala-pulse", "bpm-db-pulse-gated", 1, "orbit", "broadband"),
  spec("cellular-recoil-drift", "halo-cell", "hero-movement", "kendrick-lamar", "kinetic-scan", "parallax-slide", "bpm-db-reactive", 1, "recoil", "low"),
  spec("comic-book-shearout", "shattered-arc", "glitch", "scott-mccloud", "kinetic-scan", "shear-kaleido", "bpm-db-reactive", 0.5, "recoil", "high"),
  spec("fracture-silence-falloff", "shattered-arc", "fade", "chris-ware", "sparse-contour", "wipe", "bpm-locked", 2, "collapse", "none"),
  spec("impact-snap-retreat", "shattered-arc", "hero-movement", "edgar-wright", "climax-burst", "snap-zoom-out", "bpm-db-pulse-gated", 1, "recoil", "broadband"),
  spec("white-hole-inversion", "shattered-arc", "black-hole", "hideo-kojima", "climax-burst", "fractal-tunnel", "bpm-db-reactive", 4, "collapse", "low"),
  spec("petal-desat-recursion", "mandelbloom", "desaturate", "virginia-woolf", "stable-feedback", "mirror-kaleido", "bpm-locked", 2, "time-lag", "none"),
  spec("spiral-sunspill", "mandelbloom", "rainbow", "the-beatles", "climax-burst", "mandala-pulse", "bpm-db-pulse-gated", 1, "orbit", "broadband"),
  spec("recall-glass-glitch", "mandelbloom", "glitch", "david-mitchell", "kinetic-scan", "trip-kaleido", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("mandala-sink-core", "mandelbloom", "black-hole", "alejandro-g-inarritu", "climax-burst", "fractal-tunnel", "bpm-db-reactive", 4, "collapse", "broadband"),
  spec("archive-dropout", "data-cathedral", "tv-static", "sam-barlow", "sparse-contour", "phase-lattice", "bpm-db-reactive", 1, "time-lag", "high"),
  spec("codec-melt-fade", "data-cathedral", "analog", "david-mitchell", "stable-feedback", "ink-melt", "bpm-locked", 2, "smear", "none"),
  spec("signal-procession-pan", "data-cathedral", "camera-flare-pan", "vince-gilligan", "kinetic-scan", "parallax-slide", "bpm-db-reactive", 1, "pan-follow", "mid"),
  spec("echo-chapel-rewind", "data-cathedral", "hero-movement", "christopher-nolan", "stable-feedback", "echo-fold", "bpm-db-pulse-gated", 1, "time-lag", "broadband"),
  spec("sap-drain-monochrome", "chromatic-xylem", "desaturate", "chris-ware", "sparse-contour", "wipe", "bpm-locked", 2, "collapse", "none"),
  spec("branch-afterimage-flare", "chromatic-xylem", "camera-flare-pan", "jh-williams-iii", "stable-feedback", "parallax-slide", "bpm-db-reactive", 1, "pan-follow", "mid"),
  spec("woodgrain-ghost-slip", "chromatic-xylem", "analog", "alan-moore", "stable-feedback", "phase-ghost", "bpm-db-reactive", 1, "smear", "low"),
  spec("root-clock-stagger", "chromatic-xylem", "hero-movement", "james-joyce", "pulse-wave", "tilt-reframe", "bpm-db-pulse-gated", 1, "time-lag", "low"),
  spec("glyph-burnout", "vector-incantation", "analog", "hideo-kojima", "climax-burst", "strobe-bloom", "bpm-db-reactive", 1, "recoil", "high"),
  spec("sigil-scan-break", "vector-incantation", "tv-static", "sam-esmail", "kinetic-scan", "axis-swap", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("axis-lurch-retreat", "vector-incantation", "hero-movement", "cory-barlog", "kinetic-scan", "handheld-lurch", "bpm-db-pulse-gated", 1, "recoil", "broadband"),
  spec("chant-spectrum-slice", "vector-incantation", "rainbow", "kendrick-lamar", "climax-burst", "chroma-smear", "bpm-db-reactive", 1, "pan-follow", "high"),
  spec("grid-dim-collapse", "harmonic-lattice", "desaturate", "stanley-kubrick", "stable-feedback", "lattice-breath", "bpm-locked", 2, "collapse", "none"),
  spec("phase-gate-jitter", "harmonic-lattice", "glitch", "daft-punk", "kinetic-scan", "phase-lattice", "bpm-db-reactive", 0.5, "orbit", "high"),
  spec("lattice-fade-bloom", "harmonic-lattice", "fade", "pink-floyd", "stable-feedback", "halo-drift", "bpm-db-reactive", 2, "drift", "mid"),
  spec("chorus-event-horizon", "harmonic-lattice", "black-hole", "christopher-nolan", "climax-burst", "fractal-tunnel", "bpm-db-pulse-gated", 4, "collapse", "broadband"),
  spec("emulsion-solar-fade", "film-bloom-shard", "analog", "vince-gilligan", "stable-feedback", "solarize-drift", "bpm-db-reactive", 2, "smear", "mid"),
  spec("frame-slip-corruption", "film-bloom-shard", "glitch", "gaspar-noe", "kinetic-scan", "chroma-smear", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("hero-dolly-bleed", "film-bloom-shard", "hero-movement", "edgar-wright", "climax-burst", "dolly-in", "bpm-db-pulse-gated", 1, "pan-follow", "broadband"),
  spec("celluloid-rainbow-burn", "film-bloom-shard", "rainbow", "the-beatles", "climax-burst", "solarize-drift", "bpm-db-reactive", 1, "smear", "high"),
  spec("phantom-broadcast-snow", "wildcard", "tv-static", "composite", "kinetic-scan", "phase-ghost", "bpm-db-reactive", 0.5, "smear", "high"),
  spec("authorial-void-iris", "wildcard", "black-hole", "mark-z-danielewski", "climax-burst", "fractal-tunnel", "bpm-db-pulse-gated", 4, "collapse", "broadband"),
];

export function buildOutroImageSignature(edgeMap: EdgeMap, theme: RenderTheme): string {
  const profile = theme.styleProfile;
  return [
    edgeMap.imagePath,
    profile.effectSeed,
    profile.dominantHue.toFixed(2),
    profile.hueVariance.toFixed(3),
    profile.edgeDensity.toFixed(3),
    profile.contrast.toFixed(3),
    profile.symmetry.toFixed(3),
  ].join("|");
}

function wildcardAllowed(frame: AudioFrameFeature, visualState: VisualState, recentEffectBars: Map<OutroEffectId, number>): boolean {
  return Boolean(frame.isFourBarDownbeat) || (frame.phrasePulse ?? 0) > 0.92 || recentEffectBars.size >= 3;
}

export function selectOutroEffect(params: {
  edgeMap: EdgeMap;
  visualState: VisualState;
  theme: RenderTheme;
  frame: AudioFrameFeature;
  recentEffectBars: Map<OutroEffectId, number>;
  previousCategory?: OutroEffectCategory;
}): OutroEffectSpec | undefined {
  const { edgeMap, visualState, theme, frame, recentEffectBars, previousCategory } = params;
  if (visualState.regime !== "outro") {
    return undefined;
  }
  const barIndex = frame.barIndex ?? 0;
  let pool = OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === edgeMap.fractalMotif);
  if (wildcardAllowed(frame, visualState, recentEffectBars)) {
    pool = [...pool, ...OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === "wildcard")];
  }
  pool = pool.filter((entry) => {
    const lastBar = recentEffectBars.get(entry.id);
    return lastBar === undefined || barIndex - lastBar >= entry.cooldownBars;
  });
  if (pool.length === 0) {
    pool = OUTRO_EFFECT_SPECS.filter((entry) => entry.motif === edgeMap.fractalMotif);
  }
  const rotatedPool = previousCategory && pool.some((entry) => entry.category !== previousCategory)
    ? pool.filter((entry) => entry.category !== previousCategory)
    : pool;
  const selectionPool = rotatedPool.length > 0 ? rotatedPool : pool;
  const signature = buildOutroImageSignature(edgeMap, theme);
  const hashSeed = `${edgeMap.fractalMotif}|${visualState.phraseIndex}|${signature}|${frame.barIndex ?? 0}|${frame.phrase4Index ?? 0}`;
  return weightedPick(selectionPool, hashSeed, (entry) => {
    const reflectiveBias = entry.selectionTags?.includes("reflective") ? 1.5 : 1;
    const temporalPenalty = entry.selectionTags?.includes("temporal-freeze") ? 0.5 : 1;
    return (entry.selectionWeight ?? 1) * reflectiveBias * temporalPenalty;
  });
}

function dbDrive(frame: AudioFrameFeature, band: OutroEffectSpec["dbResponse"]["band"]): number {
    switch (band) {
      case "low":
        return clamp(((frame.impactBandScore ?? frame.dbNormalized) * 0.55) + (frame.normalizedLow * 0.45), 0, 1);
      case "mid":
        return clamp(((frame.bandWeightedScore ?? frame.dbNormalized) * 0.45) + (frame.normalizedMid * 0.55), 0, 1);
      case "high":
        return clamp(((frame.textureBandScore ?? frame.dbNormalized) * 0.4) + (frame.normalizedHigh * 0.6), 0, 1);
    case "broadband":
      return clamp((frame.normalizedLow + frame.normalizedMid + frame.normalizedHigh) / 3, 0, 1);
    case "none":
      default:
        return clamp((frame.bandWeightedScore ?? frame.dbNormalized) * 0.25, 0, 1);
    }
}

function beatPulse(phase: number): number {
  return phase < 0.5 ? Math.cos(phase * Math.PI) * 0.5 + 0.5 : 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value >= edge1 ? 1 : 0;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function computeOutroProgress(frame: AudioFrameFeature, visualState: VisualState): {
  outroProgress: number;
  closingBarsProgress: number;
  terminalBurstProgress: number;
} {
  const phraseFrameSpan = Math.max(1, visualState.phraseEndFrame - visualState.phraseStartFrame);
  const frameProgress = clamp((frame.frameIndex - visualState.phraseStartFrame) / phraseFrameSpan, 0, 1);
  const phraseDurationSec = Math.max(1e-6, visualState.phraseEndSec - visualState.phraseStartSec);
  const timeProgress = clamp((frame.timeSec - visualState.phraseStartSec) / phraseDurationSec, 0, 1);
  const outroProgress = Math.max(frameProgress, timeProgress);
  const barIndex = frame.barIndex;
  const phraseBarIndex = frame.phrase4Index;

  if (barIndex !== undefined && phraseBarIndex !== undefined) {
    const barsIntoPhrase = Math.max(0, barIndex - (phraseBarIndex * 4));
    const closingBarsProgress = smoothstep(4, 7, barsIntoPhrase);
    const terminalBurstProgress = smoothstep(6, 7, barsIntoPhrase);
    return {
      outroProgress,
      closingBarsProgress,
      terminalBurstProgress,
    };
  }

  return {
    outroProgress,
    closingBarsProgress: smoothstep(0.85, 1, outroProgress),
    terminalBurstProgress: smoothstep(0.92, 1, outroProgress),
  };
}

function resolveColorSet(spec: OutroEffectSpec, theme: RenderTheme, statePhase: number): string[] {
  const profile = theme.styleProfile;
  const seedHue =
    spec.imageControlProfile.hueSource === "average-hue" ? profile.averageHue / 360 :
    spec.imageControlProfile.hueSource === "warm-cool" ? clamp(0.5 + profile.warmCoolBias * 0.35, 0, 1) :
    spec.imageControlProfile.hueSource === "palette-cycle" ? statePhase :
    profile.dominantHue / 360;
  const seededShift = ((profile.effectSeed % 29) / 29) * 0.18;
  const alphaBase = clamp(0.12 + profile.contrast * 0.35, 0.1, 0.32);
  return [
    paletteColor(theme, (seedHue + seededShift + 0.00) % 1, alphaBase, 18),
    paletteColor(theme, (seedHue + seededShift + 0.14) % 1, alphaBase * 0.92, 14),
    paletteColor(theme, (seedHue + seededShift + 0.31) % 1, alphaBase * 0.84, 10),
  ];
}

export function evaluateOutroEffectState(params: {
  frame: AudioFrameFeature;
  bpm: number;
  spec: OutroEffectSpec;
  edgeMap: EdgeMap;
  theme: RenderTheme;
  visualState: VisualState;
}): OutroEffectState {
  const { frame, bpm, spec, edgeMap, theme, visualState } = params;
  const beatsPerSecond = Math.max(1, bpm) / 60;
  const progress = computeOutroProgress(frame, visualState);
  const swingOffset = spec.timingProfile.swingAmount * ((frame.beatIndex ?? 0) % 2 === 0 ? 1 : -1);
  const rawPhase = frame.timeSec * beatsPerSecond * spec.timingProfile.beatDivision + swingOffset + (frame.barPhase ?? 0) * 0.25;
  const phase = ((rawPhase % 1) + 1) % 1;
  const pulse = beatPulse(phase);
  const barAccent = (
    (frame.isBarDownbeat ? spec.timingProfile.barAccentWeight : 0) +
    (frame.barPulse ?? 0) * 0.28
  ) * (1 + progress.closingBarsProgress * 0.55 + progress.terminalBurstProgress * 0.35);
  const phraseAccent = (frame.phrasePulse ?? 0) * spec.timingProfile.phraseAccentWeight * (1 + progress.closingBarsProgress * 0.35);
  const responsiveDb = clamp(
    spec.dbResponse.floor + dbDrive(frame, spec.dbResponse.band) * spec.dbResponse.gain,
    spec.dbResponse.floor,
    spec.dbResponse.ceiling,
  );
  const baseMix =
    spec.audioMode === "bpm-db-pulse-gated"
      ? clamp(pulse * 0.6 + responsiveDb * 0.4 + phraseAccent * 0.18, 0, 1)
      : spec.audioMode === "bpm-db-reactive"
        ? clamp(pulse * 0.7 + responsiveDb * 0.3 + barAccent * 0.12, 0, 1)
        : clamp(pulse * 0.82 + barAccent * 0.12 + phraseAccent * 0.08, 0, 1);
  const collapseDrive = clamp(
    0.18 +
    progress.outroProgress * 0.28 +
    progress.closingBarsProgress * 0.44 +
    progress.terminalBurstProgress * 0.56 +
    responsiveDb * 0.12,
    0,
    1,
  );
  const mix = clamp(
    baseMix * (0.78 + progress.outroProgress * 0.22) +
    progress.closingBarsProgress * 0.18 +
    progress.terminalBurstProgress * 0.22,
    0,
    1,
  );
  const heroWarp =
    spec.heroBehavior === "none"
      ? 0
      : clamp(
          mix * 0.58 +
          collapseDrive * 0.28 +
          (spec.heroBehavior === "collapse" || spec.heroBehavior === "recoil" ? barAccent * 0.42 : 0.18) +
          (visualState.phraseIndex % 2) * 0.02,
          0,
          1,
        );
  const frameCoverageTarget = clamp(
    0.2 +
    mix * 0.22 +
    collapseDrive * 0.34 +
    progress.terminalBurstProgress * 0.18,
    0.18,
    0.9,
  );
  return {
    id: spec.id,
    imageSignature: buildOutroImageSignature(edgeMap, theme),
    phase,
    beatPulse: pulse,
    barPulse: clamp(barAccent, 0, 1),
    phrasePulse: clamp(phraseAccent, 0, 1),
    dbDrive: responsiveDb,
    mix,
    outroProgress: progress.outroProgress,
    closingBarsProgress: progress.closingBarsProgress,
    terminalBurstProgress: progress.terminalBurstProgress,
    collapseDrive,
    frameCoverageTarget,
    heroWarp,
    colorSet: resolveColorSet(spec, theme, phase),
    intensity: clamp(mix * 0.56 + heroWarp * 0.2 + collapseDrive * 0.24, 0, 1),
  };
}

export function applyOutroEffectToActiveSubject(
  state: OutroEffectState,
  spec: OutroEffectSpec,
  sceneGraph: SceneGraph,
  activeSubjectState: ActiveSubjectState,
): void {
  const orbitRadius = sceneGraph.heroOrbitRadius * (0.12 + state.collapseDrive * 0.14 + state.terminalBurstProgress * 0.16) * state.heroWarp;
  const theta = state.phase * Math.PI * 2;
  const heroImpactScale = spec.selectionTags?.includes("hero-impacting") ? 2 : 1;
  switch (spec.heroBehavior) {
    case "drift":
      activeSubjectState.x += Math.cos(theta) * orbitRadius * (0.4 + state.terminalBurstProgress * 0.25) * heroImpactScale;
      activeSubjectState.y += Math.sin(theta * 0.8) * orbitRadius * (0.5 + state.closingBarsProgress * 0.2) * heroImpactScale;
      break;
    case "orbit":
      activeSubjectState.x += Math.cos(theta) * orbitRadius * heroImpactScale;
      activeSubjectState.y += Math.sin(theta) * orbitRadius * (0.76 + state.terminalBurstProgress * 0.22) * heroImpactScale;
      break;
    case "recoil":
      activeSubjectState.vx += Math.cos(theta) * state.heroWarp * (0.28 + state.collapseDrive * 0.24) * heroImpactScale;
      activeSubjectState.vy -= state.heroWarp * (0.2 + state.terminalBurstProgress * 0.18) * heroImpactScale;
      break;
    case "collapse":
      activeSubjectState.x += (activeSubjectState.targetX - activeSubjectState.x) * state.heroWarp * (0.12 + state.collapseDrive * 0.12) * heroImpactScale;
      activeSubjectState.y += (activeSubjectState.targetY - activeSubjectState.y) * state.heroWarp * (0.12 + state.collapseDrive * 0.12) * heroImpactScale;
      activeSubjectState.radius = clamp(activeSubjectState.radius * (1 - state.heroWarp * (0.02 + state.terminalBurstProgress * 0.03) * heroImpactScale), 28, sceneGraph.heroPriorityRadius);
      break;
    case "smear":
      activeSubjectState.vx += Math.sin(theta) * state.heroWarp * (0.24 + state.closingBarsProgress * 0.18) * heroImpactScale;
      activeSubjectState.vy += Math.cos(theta * 0.5) * state.heroWarp * (0.16 + state.terminalBurstProgress * 0.14) * heroImpactScale;
      break;
    case "pan-follow":
      activeSubjectState.x += Math.cos(theta) * orbitRadius * (0.8 + state.closingBarsProgress * 0.3) * heroImpactScale;
      activeSubjectState.vx += Math.cos(theta) * state.heroWarp * (0.12 + state.terminalBurstProgress * 0.12) * heroImpactScale;
      break;
    case "time-lag":
      activeSubjectState.filteredTargetX = activeSubjectState.filteredTargetX * (1 - state.heroWarp * 0.06 * heroImpactScale) + activeSubjectState.x * state.heroWarp * 0.06 * heroImpactScale;
      activeSubjectState.filteredTargetY = activeSubjectState.filteredTargetY * (1 - state.heroWarp * 0.06 * heroImpactScale) + activeSubjectState.y * state.heroWarp * 0.06 * heroImpactScale;
      break;
    case "none":
    default:
      break;
  }
}

function categoryVisibleRatio(category: OutroEffectCategory, state: OutroEffectState): number {
  switch (category) {
    case "black-hole":
      return clamp(0.22 + state.frameCoverageTarget * 0.52, 0, 1);
    case "glitch":
    case "tv-static":
      return clamp(0.24 + state.dbDrive * 0.22 + state.terminalBurstProgress * 0.22, 0, 1);
    case "fade":
    case "desaturate":
      return clamp(0.18 + state.frameCoverageTarget * 0.4, 0, 1);
    default:
      return clamp(0.18 + state.frameCoverageTarget * 0.42, 0, 1);
  }
}

export function renderOutroEffect(params: {
  ctx: CanvasRenderingContext2D;
  frame: AudioFrameFeature;
  state: OutroEffectState;
  spec: OutroEffectSpec;
  sceneGraph: SceneGraph;
  activeSubject?: ActiveSubjectSnapshot;
  theme: RenderTheme;
  width: number;
  height: number;
  qualityBudget: RenderQualityBudget;
}): { overlayOpacityEstimate: number; effectVisiblePixelRatioEstimate: number; effectVisible: boolean } {
  const { ctx, frame, state, spec, sceneGraph, activeSubject, theme, width, height, qualityBudget } = params;
  const cx = activeSubject?.x ?? width * 0.5;
  const cy = activeSubject?.y ?? height * 0.5;
  const radius = sceneGraph.heroOrbitRadius * (0.82 + state.intensity * 1.05 + state.terminalBurstProgress * 0.9);
  const opacity = clamp(
    0.12 +
    state.mix * 0.2 +
    state.closingBarsProgress * 0.14 +
    state.terminalBurstProgress * 0.2,
    0.08,
    0.68,
  );
  const collapseAlpha = clamp(0.14 + state.collapseDrive * 0.3 + state.terminalBurstProgress * 0.24, 0.12, 0.78);
  ctx.save();
  ctx.globalCompositeOperation = spec.category === "desaturate" || spec.category === "fade" ? "source-over" : "screen";
  switch (spec.category) {
    case "desaturate":
      ctx.fillStyle = `rgba(240,240,240,${opacity * 0.3})`;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `rgba(16,16,20,${collapseAlpha * 0.28})`;
      ctx.fillRect(0, 0, width, height);
      break;
    case "fade": {
      const wash = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius * 1.8);
      wash.addColorStop(0, state.colorSet[0]!);
      wash.addColorStop(0.45, state.colorSet[1]!);
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);
      const vignette = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, Math.max(width, height) * 0.82);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, `rgba(0,0,0,${collapseAlpha * 0.72})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "glitch":
    case "tv-static":
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = state.colorSet[0]!;
      for (let index = 0; index < (qualityBudget.effectPasses > 1 ? 26 : 14) + Math.round(state.terminalBurstProgress * 16); index += 1) {
        const y = ((stableFloat(`${spec.id}|${frame.barIndex}|${index}`) + state.phase) % 1) * height;
        const offset = (stableFloat(`${spec.id}|offset|${frame.frameIndex}|${index}`) - 0.5) * width * 0.16 * (0.6 + state.dbDrive + state.terminalBurstProgress * 0.5);
        ctx.beginPath();
        ctx.moveTo(offset, y);
        ctx.lineTo(width + offset, y + Math.sin(state.phase * Math.PI * 2 + index) * (4 + state.terminalBurstProgress * 8));
        ctx.stroke();
      }
      ctx.fillStyle = state.colorSet[1]!;
      ctx.globalAlpha = opacity * 0.22;
      for (let index = 0; index < 4 + Math.round(state.terminalBurstProgress * 6); index += 1) {
        const bandY = stableFloat(`${spec.id}|band|${frame.frameIndex}|${index}`) * height;
        const bandH = height * (0.02 + stableFloat(`${spec.id}|band-h|${frame.frameIndex}|${index}`) * 0.08);
        const bandW = width * (0.18 + stableFloat(`${spec.id}|band-w|${frame.frameIndex}|${index}`) * 0.42);
        const bandX = (stableFloat(`${spec.id}|band-x|${frame.frameIndex}|${index}`) - 0.5) * width * 0.28;
        ctx.fillRect(bandX, bandY, bandW, bandH);
      }
      break;
    case "hero-movement":
      ctx.strokeStyle = state.colorSet[1]!;
      for (let index = 0; index < 3 + Math.round(state.terminalBurstProgress * 3); index += 1) {
        ctx.lineWidth = 1.8 + index + state.intensity * 2.2;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          radius * (0.64 + index * 0.14 + state.heroWarp * 0.24),
          radius * (0.34 + state.beatPulse * 0.2 + index * 0.08),
          state.phase * Math.PI + index * 0.22,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      break;
    case "rainbow":
      for (let index = 0; index < 4; index += 1) {
        ctx.strokeStyle = state.colorSet[index % state.colorSet.length]!;
        ctx.lineWidth = 2 + index;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.72 + index * 0.2 + state.beatPulse * 0.16 + state.terminalBurstProgress * 0.08), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case "black-hole": {
      const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      hole.addColorStop(0, `rgba(0,0,0,${collapseAlpha})`);
      hole.addColorStop(0.45, state.colorSet[0]!);
      hole.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hole;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `rgba(0,0,0,${collapseAlpha * 0.34})`;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "analog":
      ctx.globalAlpha = opacity * 0.9;
      ctx.fillStyle = state.colorSet[2]!;
      for (let y = 0; y < height; y += Math.max(3, Math.round(7 - state.dbDrive * 3))) {
        ctx.fillRect(0, y, width, 1);
      }
      ctx.fillStyle = state.colorSet[0]!;
      for (let index = 0; index < 3 + Math.round(state.terminalBurstProgress * 4); index += 1) {
        const driftY = ((state.phase + index * 0.17) % 1) * height;
        ctx.fillRect(0, driftY, width, Math.max(2, height * 0.01));
      }
      break;
    case "camera-flare-pan": {
      const flareX = cx + Math.cos(state.phase * Math.PI * 2) * width * (0.18 + state.terminalBurstProgress * 0.14);
      const flare = ctx.createRadialGradient(flareX, cy, 0, flareX, cy, radius * 1.15);
      flare.addColorStop(0, state.colorSet[0]!);
      flare.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = flare;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `rgba(255,255,255,${opacity * 0.16})`;
      ctx.fillRect(Math.max(0, flareX - width * 0.08), 0, width * 0.16, height);
      break;
    }
    case "time-play":
      ctx.globalAlpha = opacity * 0.84;
      ctx.strokeStyle = state.colorSet[1]!;
      for (let index = 0; index < 4 + Math.round(state.terminalBurstProgress * 2); index += 1) {
        ctx.beginPath();
        ctx.arc(
          cx + Math.sin(state.phase * Math.PI * 2 + index) * (14 + state.terminalBurstProgress * 20),
          cy + Math.cos(state.phase * Math.PI + index) * (state.terminalBurstProgress * 12),
          radius * (0.6 + index * 0.14),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      break;
  }
  if (state.terminalBurstProgress > 0.02) {
    const vignette = ctx.createRadialGradient(cx, cy, radius * 0.18, cx, cy, Math.max(width, height) * 0.86);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(0,0,0,${state.terminalBurstProgress * 0.58})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
  const visibleRatio = categoryVisibleRatio(spec.category, state);
  return {
    overlayOpacityEstimate: opacity,
    effectVisiblePixelRatioEstimate: visibleRatio,
    effectVisible: opacity >= 0.12 || visibleRatio >= 0.22,
  };
}
