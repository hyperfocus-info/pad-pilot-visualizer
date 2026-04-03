import { clamp } from "../config";
import type {
  ActiveSubjectSnapshot,
  ActiveSubjectState,
  AudioFrameFeature,
  EdgeMap,
  PersistentMotifState,
  HeroPhysicsState,
  MotifEffectAudioMode,
  MotifEffectHeroMode,
  MotifEffectId,
  MotifEffectSpec,
  MotifEffectState,
  PhysicalPhenomenonFamily,
  RenderQualityBudget,
  RenderTheme,
  SelectionTag,
  SceneGraph,
  VisualRegime,
  VisualState,
} from "../types";
import { paletteColor } from "./palette";

export interface RollingDbWindowState {
  dbLow: number[];
  dbLowMid: number[];
  dbMid: number[];
  dbHighMid: number[];
  dbHigh: number[];
  maxFrames: number;
}

export interface MotifEffectRuntimeModifiers {
  trailEmissionMultiplier: number;
  burstFanoutMultiplier: number;
  residueSpreadMultiplier: number;
  driftFieldMultiplier: number;
  shellGlowMultiplier: number;
  wakeWidthMultiplier: number;
}

const BPM_DB5_REACTIVE = new Set<MotifEffectId>([
  "arc-ladder",
  "vortex-shear",
  "orbital-tidal-lock",
  "standing-wave-vault",
  "osmotic-pulse",
  "shock-ring",
  "spiral-phasing",
  "signal-echo-chamber",
  "gyro-precession",
  "interference-grid",
  "gate-weave-flutter",
]);

const STATIC_EFFECTS = new Set<MotifEffectId>(["prism-ghosting"]);
const RARE_WARP_EFFECTS = new Set<MotifEffectId>([
  "orbital-tidal-lock",
  "standing-wave-vault",
  "shock-ring",
  "spiral-phasing",
  "gyro-precession",
  "prism-ghosting",
]);
const REFLECTIVE_EFFECTS = new Set<MotifEffectId>([
  "caustic-lensing",
  "diffraction-rose",
  "orbital-tidal-lock",
  "crystal-mode-lock",
  "prism-ghosting",
  "phyllotaxis-burst",
]);

const DEFAULT_PARTICLE_INFLUENCE = {
  trailEmission: 1,
  burstFanout: 1,
  residueSpread: 1,
  driftField: 1,
  shellGlow: 1,
  wakeWidth: 1,
};

function phrase(value: string): string {
  return value.replace(/-/g, " ");
}

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function effectAudioMode(id: MotifEffectId): MotifEffectAudioMode {
  if (STATIC_EFFECTS.has(id)) {
    return "static";
  }
  return BPM_DB5_REACTIVE.has(id) ? "bpm-db5-reactive" : "db5-reactive";
}

function effectHeroMode(id: MotifEffectId): MotifEffectHeroMode {
  return RARE_WARP_EFFECTS.has(id) ? "rare-warp" : "particles-only";
}

function spec(
  id: MotifEffectId,
  primaryMotif: EdgeMap["fractalMotif"],
  phenomenon: PhysicalPhenomenonFamily,
  baseOverlayMode: VisualState["overlayMode"],
  preferredRegimes: VisualRegime[],
  particleInfluence: Partial<MotifEffectSpec["particleInfluence"]>,
  selectionWeight = 1,
): MotifEffectSpec {
  const selectionTags: SelectionTag[] = [];
  if (REFLECTIVE_EFFECTS.has(id)) {
    selectionTags.push("reflective");
  }
  if (RARE_WARP_EFFECTS.has(id)) {
    selectionTags.push("hero-impacting");
  }
  return {
    id,
    family: phenomenon,
    primaryMotif,
    fallbackMotifs: [],
    phenomenon,
    baseOverlayMode,
    audioMode: effectAudioMode(id),
    preferredRegimes,
    particleInfluence: { ...DEFAULT_PARTICLE_INFLUENCE, ...particleInfluence },
    heroMode: effectHeroMode(id),
    heroTriggerGate: RARE_WARP_EFFECTS.has(id) ? "rare-musical" : "none",
    cooldownBeats: RARE_WARP_EFFECTS.has(id) ? 8 : 0,
    selectionWeight,
    selectionTags,
    pitch: `A ${phrase(phenomenon)} motif effect that reshapes the current motif surface without replacing the underlying scene identity.`,
    distinction: `It differs by using ${phrase(effectAudioMode(id))} audio coupling, ${phrase(effectHeroMode(id))} hero response, and ${preferredRegimes.join(", ")} regime coverage.`,
    eligibility: {
      motifs: [primaryMotif],
      regimes: preferredRegimes,
      arcs: RARE_WARP_EFFECTS.has(id) ? ["swap", "punctuate"] : ["hold", "mixed"],
    },
    continuityPolicy: RARE_WARP_EFFECTS.has(id) ? "rare" : "reuse",
    runtimeTuning: {
      densityScale: particleInfluence.trailEmission ?? 1,
      couplingScale: particleInfluence.shellGlow ?? 1,
      triggerCooldownScale: RARE_WARP_EFFECTS.has(id) ? 8 : 0,
      supportsMute: true,
    },
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
    return sorted[stableStringHash(hashSeed) % Math.max(1, sorted.length)]!;
  }
  let cursor = stableStringHash(hashSeed) % Math.max(1, Math.ceil(totalWeight * 1000));
  for (const entry of sorted) {
    cursor -= Math.max(1, Math.round(Math.max(0, weightFor(entry)) * 1000));
    if (cursor < 0) {
      return entry;
    }
  }
  return sorted[sorted.length - 1]!;
}

export const MOTIF_EFFECT_SPECS: MotifEffectSpec[] = [
  spec("lorentz-drift", "neon-tube", "magnetic", "kinetic-scan", ["groove", "build"], { driftField: 1.18, shellGlow: 1.08 }),
  spec("arc-ladder", "neon-tube", "electrical", "climax-burst", ["build", "drop"], { burstFanout: 1.18, shellGlow: 1.14 }),
  spec("vortex-shear", "smoke-ribbon", "fluid", "kinetic-scan", ["groove", "build"], { trailEmission: 1.14, residueSpread: 1.22 }),
  spec("thermal-plume", "smoke-ribbon", "thermal", "pulse-wave", ["breakdown", "groove"], { trailEmission: 1.1, wakeWidth: 1.12 }),
  spec("caustic-lensing", "glass-orbital", "optical", "stable-feedback", ["groove", "outro"], { shellGlow: 1.16, driftField: 1.06 }),
  spec("orbital-tidal-lock", "glass-orbital", "orbital", "pulse-wave", ["build", "drop"], { wakeWidth: 1.18, shellGlow: 1.08 }),
  spec("standing-wave-vault", "cathedral-filament", "wave", "kinetic-scan", ["build", "drop"], { shellGlow: 1.14, wakeWidth: 1.14 }),
  spec("diffraction-rose", "cathedral-filament", "optical", "stable-feedback", ["intro", "groove", "outro"], { shellGlow: 1.18, driftField: 1.04 }),
  spec("soap-film-constriction", "halo-cell", "fluid", "pulse-wave", ["breakdown", "groove"], { wakeWidth: 1.16, trailEmission: 1.08 }),
  spec("osmotic-pulse", "halo-cell", "mechanical", "pulse-wave", ["build", "drop"], { burstFanout: 1.12, wakeWidth: 1.1 }),
  spec("brittle-fracture", "shattered-arc", "fracture", "sparse-contour", ["groove", "build"], { burstFanout: 1.18, driftField: 1.14 }),
  spec("shock-ring", "shattered-arc", "wave", "climax-burst", ["drop"], { burstFanout: 1.22, shellGlow: 1.12 }),
  spec("phyllotaxis-burst", "mandelbloom", "orbital", "pulse-wave", ["groove", "build"], { trailEmission: 1.1, burstFanout: 1.1 }),
  spec("spiral-phasing", "mandelbloom", "wave", "kinetic-scan", ["build", "drop"], { driftField: 1.18, wakeWidth: 1.12 }),
  spec("ferrofluid-choir", "data-cathedral", "magnetic", "stable-feedback", ["groove", "breakdown"], { shellGlow: 1.14, driftField: 1.16 }),
  spec("signal-echo-chamber", "data-cathedral", "mechanical", "kinetic-scan", ["build", "drop"], { trailEmission: 1.12, shellGlow: 1.08 }),
  spec("sap-pressure-rise", "chromatic-xylem", "fluid", "pulse-wave", ["groove", "build"], { wakeWidth: 1.12, trailEmission: 1.08 }),
  spec("branch-tension-snap", "chromatic-xylem", "fracture", "sparse-contour", ["build", "drop"], { burstFanout: 1.16, residueSpread: 1.14 }),
  spec("gyro-precession", "vector-incantation", "mechanical", "kinetic-scan", ["build", "drop"], { driftField: 1.2, shellGlow: 1.08 }),
  spec("slipstream-curl", "vector-incantation", "fluid", "stable-feedback", ["groove", "outro"], { trailEmission: 1.1, driftField: 1.12 }),
  spec("interference-grid", "harmonic-lattice", "wave", "kinetic-scan", ["build", "drop"], { shellGlow: 1.12, wakeWidth: 1.1 }),
  spec("crystal-mode-lock", "harmonic-lattice", "optical", "stable-feedback", ["intro", "groove", "outro"], { shellGlow: 1.16, driftField: 1.08 }),
  spec("emulsion-burn", "film-bloom-shard", "thermal", "climax-burst", ["build", "drop"], { residueSpread: 1.18, shellGlow: 1.12 }),
  spec("gate-weave-flutter", "film-bloom-shard", "electrical", "kinetic-scan", ["build", "drop"], { driftField: 1.18, burstFanout: 1.1 }),
  spec("prism-ghosting", "film-bloom-shard", "optical", "stable-feedback", ["intro", "breakdown", "outro"], { shellGlow: 1.18, wakeWidth: 1.08 }),
];

export function createRollingDbWindowState(maxFrames: number): RollingDbWindowState {
  return {
    dbLow: [],
    dbLowMid: [],
    dbMid: [],
    dbHighMid: [],
    dbHigh: [],
    maxFrames: Math.max(1, maxFrames),
  };
}

export function updateRollingDbWindowState(state: RollingDbWindowState, frame: AudioFrameFeature): void {
  const append = (target: number[], value: number) => {
    target.push(value);
    if (target.length > state.maxFrames) {
      target.shift();
    }
  };
  append(state.dbLow, frame.dbLow);
  append(state.dbLowMid, frame.dbLowMid);
  append(state.dbMid, frame.dbMid);
  append(state.dbHighMid, frame.dbHighMid);
  append(state.dbHigh, frame.dbHigh);
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
  const span = Math.max(1, max - min);
  return clamp((current - min) / span, 0, 1);
}

function lowMidHighWeights(frame: AudioFrameFeature, rolling: RollingDbWindowState): {
  low: number;
  mid: number;
  high: number;
} {
  const low = clamp(
    normalizedDbWeight(rolling.dbLow, frame.dbLow) +
    normalizedDbWeight(rolling.dbLowMid, frame.dbLowMid) * 0.5,
    0,
    1,
  );
  const mid = clamp(
    normalizedDbWeight(rolling.dbLowMid, frame.dbLowMid) * 0.5 +
    normalizedDbWeight(rolling.dbMid, frame.dbMid) +
    normalizedDbWeight(rolling.dbHighMid, frame.dbHighMid) * 0.5,
    0,
    1,
  );
  const high = clamp(
    normalizedDbWeight(rolling.dbHighMid, frame.dbHighMid) * 0.5 +
    normalizedDbWeight(rolling.dbHigh, frame.dbHigh),
    0,
    1,
  );
  return { low, mid, high };
}

export function selectMotifEffect(
  edgeMap: EdgeMap,
  visualState: VisualState,
  theme: RenderTheme,
  continuitySeed: number,
  previousEffectId?: MotifEffectId,
  persistentMotif?: PersistentMotifState,
): MotifEffectSpec {
  const candidates = MOTIF_EFFECT_SPECS.filter((entry) => entry.primaryMotif === edgeMap.fractalMotif || entry.fallbackMotifs.includes(edgeMap.fractalMotif));
  const preferred = candidates.filter((entry) => entry.preferredRegimes.includes(visualState.regime));
  const motifBiased =
    persistentMotif
      ? preferred.filter((entry) => stableStringHash(`${persistentMotif.id}:${entry.id}`) % 3 !== 0)
      : preferred;
  const pool = motifBiased.length > 0 ? motifBiased : preferred.length > 0 ? preferred : candidates;
  const dedupedPool = previousEffectId && pool.length > 1 ? pool.filter((entry) => entry.id !== previousEffectId) : pool;
  const selectionPool = dedupedPool.length > 0 ? dedupedPool : pool;
  const hashSeed = `${edgeMap.fractalMotif}:${visualState.regime}:${continuitySeed}:${edgeMap.imagePath}:${theme.styleProfile.imagePath}`;
  return weightedPick(selectionPool, hashSeed, (entry) => {
    const reflectiveBias = entry.selectionTags?.includes("reflective") ? 1.5 : 1;
    return (entry.selectionWeight ?? 1) * reflectiveBias;
  });
}

export function evaluateMotifEffectState(
  frame: AudioFrameFeature,
  bpm: number,
  specEntry: MotifEffectSpec,
  rolling: RollingDbWindowState,
): MotifEffectState {
  const weights = lowMidHighWeights(frame, rolling);
  const beatLock = clamp(
    (frame.isBeatAccent ? 0.45 : 0) +
    (frame.isBarDownbeat ? 0.22 : 0) +
    (frame.isFourBarDownbeat ? 0.33 : 0),
    0,
    1,
  );
  const dbDriven = clamp(weights.low * 0.28 + weights.mid * 0.38 + weights.high * 0.34, 0, 1);
  const tempoPhase = ((frame.beatPhase ?? 0) + (frame.barPhase ?? 0) * 0.35 + (frame.phrasePulse ?? 0) * 0.25) % 1;
  const beatsPerSecond = Math.max(1, bpm) / 60;
  const reactivePhase = (frame.timeSec * beatsPerSecond + tempoPhase) % 1;
  const intensity =
    specEntry.audioMode === "static"
      ? clamp(0.28 + beatLock * 0.6 + frame.peakStrength * 0.22, 0, 1)
      : specEntry.audioMode === "db5-reactive"
        ? clamp(0.16 + dbDriven * 0.84 + frame.peakStrength * 0.12, 0, 1)
        : clamp(0.12 + dbDriven * 0.68 + beatLock * 0.36 + (frame.phrasePulse ?? 0) * 0.18, 0, 1);
  const heroWarpActive =
    specEntry.heroMode === "rare-warp" &&
    (
      Boolean(frame.isFourBarDownbeat) ||
      (((frame.phrasePulse ?? 0) > 0.82) && frame.peakStrength > 0.58)
    );
  return {
    id: specEntry.id,
    intensity,
    phase: reactivePhase,
    lowDbWeight: weights.low,
    midDbWeight: weights.mid,
    highDbWeight: weights.high,
    beatLock,
    heroWarpActive,
  };
}

function strokeOrbit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  color: string,
  lineWidth: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.46, rotation, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function renderMotifEffect(params: {
  ctx: CanvasRenderingContext2D;
  frame: AudioFrameFeature;
  state: MotifEffectState;
  spec: MotifEffectSpec;
  sceneGraph: SceneGraph;
  activeSubject?: ActiveSubjectSnapshot;
  theme: RenderTheme;
  width: number;
  height: number;
  qualityBudget: RenderQualityBudget;
}): void {
  const { ctx, frame, state, spec: specEntry, sceneGraph, activeSubject, theme, width, height, qualityBudget } = params;
  if (qualityBudget.skipOverlayExtras && state.intensity < 0.42) {
    return;
  }
  const cx = activeSubject?.x ?? width * 0.5;
  const cy = activeSubject?.y ?? height * 0.5;
  const heroRadius = sceneGraph.heroOrbitRadius * (1.4 + state.intensity * 0.9);
  const alpha = clamp(0.03 + state.intensity * 0.09, 0.03, 0.16);
  ctx.save();
  ctx.globalCompositeOperation = specEntry.baseOverlayMode === "climax-burst" ? "screen" : "lighter";
  switch (specEntry.phenomenon) {
    case "fluid":
      for (let index = 0; index < (qualityBudget.effectPasses > 1 ? 3 : 2); index += 1) {
        ctx.strokeStyle = paletteColor(theme, state.phase + index * 0.11, alpha, 14);
        ctx.lineWidth = 1 + index * 0.7;
        ctx.beginPath();
        for (let step = 0; step <= 42; step += 1) {
          const t = step / 42;
          const px = cx + Math.cos(t * Math.PI * 2 + state.phase * Math.PI * 2 + index * 0.3) * heroRadius * (0.6 + t * 0.5);
          const py = cy + Math.sin(t * Math.PI * 3 + state.phase * Math.PI * 2) * heroRadius * 0.24;
          if (step === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      break;
    case "thermal":
      for (let plume = 0; plume < (qualityBudget.skipOverlayExtras ? 2 : 4); plume += 1) {
        const plumeHeight = heroRadius * (0.8 + plume * 0.22 + state.highDbWeight * 0.35);
        const gradient = ctx.createLinearGradient(cx, cy + heroRadius * 0.35, cx, cy - plumeHeight);
        gradient.addColorStop(0, paletteColor(theme, 0.04 + plume * 0.08, alpha * 1.1, 18));
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.2 + plume * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - heroRadius * 0.35 + plume * heroRadius * 0.22, cy + heroRadius * 0.22);
        ctx.bezierCurveTo(
          cx - heroRadius * 0.45 + plume * heroRadius * 0.18,
          cy - plumeHeight * 0.25,
          cx + heroRadius * 0.3 - plume * heroRadius * 0.12,
          cy - plumeHeight * 0.72,
          cx + Math.sin(state.phase * Math.PI * 2 + plume) * heroRadius * 0.22,
          cy - plumeHeight,
        );
        ctx.stroke();
      }
      break;
    case "optical":
      strokeOrbit(ctx, cx, cy, heroRadius, state.phase * Math.PI * 2, paletteColor(theme, 0.16, alpha, 14), 1.2);
      strokeOrbit(ctx, cx, cy, heroRadius * 0.72, -state.phase * Math.PI * 1.5, paletteColor(theme, 0.52, alpha, 12), 0.9);
      if (!qualityBudget.skipOverlayExtras) {
        ctx.strokeStyle = paletteColor(theme, 0.84, alpha * 0.88, 18);
        ctx.lineWidth = 0.8;
        for (let ray = 0; ray < 8; ray += 1) {
          const angle = (Math.PI * 2 * ray) / 8 + state.phase * Math.PI;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * heroRadius * 1.4, cy + Math.sin(angle) * heroRadius * 1.4);
          ctx.stroke();
        }
      }
      break;
    case "electrical":
      ctx.strokeStyle = paletteColor(theme, 0.92, alpha * 1.2, 18);
      ctx.lineWidth = 1.1;
      for (let bolt = 0; bolt < (qualityBudget.effectPasses > 1 ? 4 : 2); bolt += 1) {
        ctx.beginPath();
        let px = cx - heroRadius * 0.8 + bolt * heroRadius * 0.42;
        let py = cy - heroRadius * 0.6;
        ctx.moveTo(px, py);
        for (let step = 0; step < 7; step += 1) {
          px += heroRadius * 0.14 + Math.sin(frame.timeSec * 8 + bolt + step) * heroRadius * 0.08;
          py += heroRadius * 0.18 + (step % 2 === 0 ? -1 : 1) * heroRadius * 0.08;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    case "magnetic":
      strokeOrbit(ctx, cx, cy, heroRadius * 0.92, state.phase * Math.PI, paletteColor(theme, 0.06, alpha, 12), 1);
      strokeOrbit(ctx, cx, cy, heroRadius * 1.18, state.phase * -Math.PI * 0.85, paletteColor(theme, 0.56, alpha, 10), 1);
      ctx.fillStyle = paletteColor(theme, 0.82, alpha * 0.95, 16);
      for (let node = 0; node < 6; node += 1) {
        const angle = state.phase * Math.PI * 2 + (Math.PI * 2 * node) / 6;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * heroRadius * 1.1, cy + Math.sin(angle) * heroRadius * 0.7, 2 + state.midDbWeight * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "fracture":
      ctx.strokeStyle = paletteColor(theme, 0.98, alpha * 1.1, 10);
      ctx.lineWidth = 1;
      for (let crack = 0; crack < (qualityBudget.effectPasses > 1 ? 5 : 3); crack += 1) {
        const angle = (Math.PI * 2 * crack) / 5 + state.phase;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let segment = 1; segment <= 4; segment += 1) {
          const radius = heroRadius * (0.28 + segment * 0.22);
          const jitter = ((segment % 2 === 0 ? -1 : 1) * heroRadius * 0.08) + Math.sin(frame.timeSec * 6 + crack + segment) * heroRadius * 0.05;
          ctx.lineTo(cx + Math.cos(angle) * radius + jitter, cy + Math.sin(angle) * radius - jitter * 0.4);
        }
        ctx.stroke();
      }
      break;
    case "wave":
      ctx.strokeStyle = paletteColor(theme, 0.24, alpha, 12);
      ctx.lineWidth = 1;
      for (let band = 0; band < 4; band += 1) {
        const radius = heroRadius * (0.55 + band * 0.18 + state.beatLock * 0.08);
        ctx.beginPath();
        for (let step = 0; step <= 60; step += 1) {
          const t = step / 60;
          const angle = t * Math.PI * 2;
          const waveRadius = radius + Math.sin(angle * (2 + band) + state.phase * Math.PI * 2) * heroRadius * 0.08 * (0.6 + state.highDbWeight);
          const px = cx + Math.cos(angle) * waveRadius;
          const py = cy + Math.sin(angle) * waveRadius;
          if (step === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      break;
    case "orbital":
      for (let ring = 0; ring < 3; ring += 1) {
        strokeOrbit(ctx, cx, cy, heroRadius * (0.68 + ring * 0.24), state.phase * Math.PI * (0.8 + ring * 0.25), paletteColor(theme, 0.12 + ring * 0.2, alpha, 16), 1);
      }
      break;
    case "mechanical":
      ctx.strokeStyle = paletteColor(theme, 0.42, alpha, 10);
      ctx.lineWidth = 1;
      for (let radial = 0; radial < 8; radial += 1) {
        const angle = state.phase * Math.PI * 2 + (Math.PI * 2 * radial) / 8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * heroRadius * 0.32, cy + Math.sin(angle) * heroRadius * 0.32);
        ctx.lineTo(cx + Math.cos(angle) * heroRadius * 1.1, cy + Math.sin(angle) * heroRadius * 1.1);
        ctx.stroke();
      }
      strokeOrbit(ctx, cx, cy, heroRadius * 0.58, state.phase * Math.PI * 2, paletteColor(theme, 0.68, alpha, 14), 1.2);
      break;
  }
  ctx.restore();
}

export function applyMotifEffectToHeroParticles(
  state: MotifEffectState,
  specEntry: MotifEffectSpec,
  heroPhysicsState?: HeroPhysicsState,
): MotifEffectRuntimeModifiers {
  const scalar = clamp(0.92 + state.intensity * 0.24, 0.92, 1.22);
  const modifiers: MotifEffectRuntimeModifiers = {
    trailEmissionMultiplier: clamp(specEntry.particleInfluence.trailEmission * scalar, 0.9, 1.28),
    burstFanoutMultiplier: clamp(specEntry.particleInfluence.burstFanout * (0.94 + state.highDbWeight * 0.24), 0.9, 1.3),
    residueSpreadMultiplier: clamp(specEntry.particleInfluence.residueSpread * (0.94 + state.midDbWeight * 0.22), 0.9, 1.28),
    driftFieldMultiplier: clamp(specEntry.particleInfluence.driftField * (0.96 + state.lowDbWeight * 0.18), 0.92, 1.24),
    shellGlowMultiplier: clamp(specEntry.particleInfluence.shellGlow * (0.96 + state.midDbWeight * 0.16), 0.92, 1.22),
    wakeWidthMultiplier: clamp(specEntry.particleInfluence.wakeWidth * (0.96 + state.lowDbWeight * 0.2), 0.92, 1.24),
  };
  if (heroPhysicsState) {
    heroPhysicsState.wake.maxSamples = Math.max(8, Math.round(heroPhysicsState.wake.maxSamples * clamp(modifiers.wakeWidthMultiplier, 0.96, 1.08)));
  }
  return modifiers;
}

export function applyRareHeroWarp(
  state: MotifEffectState,
  specEntry: MotifEffectSpec,
  sceneGraph: SceneGraph,
  activeSubjectState: ActiveSubjectState,
): void {
  if (specEntry.heroMode !== "rare-warp" || !state.heroWarpActive) {
    return;
  }
  const heroImpactScale = specEntry.selectionTags?.includes("hero-impacting") ? 2 : 1;
  const pulse = 1 + state.intensity * 0.08 * heroImpactScale;
  const phase = state.phase * Math.PI * 2;
  activeSubjectState.radius = clamp(activeSubjectState.radius * pulse, 36, sceneGraph.heroPriorityRadius * 0.8);
  activeSubjectState.x += Math.cos(phase) * sceneGraph.heroOrbitRadius * 0.08 * heroImpactScale;
  activeSubjectState.y += Math.sin(phase * 1.2) * sceneGraph.heroOrbitRadius * 0.06 * heroImpactScale;
  activeSubjectState.vx += Math.cos(phase) * 0.24 * state.lowDbWeight * heroImpactScale;
  activeSubjectState.vy += Math.sin(phase) * 0.24 * state.highDbWeight * heroImpactScale;
}
