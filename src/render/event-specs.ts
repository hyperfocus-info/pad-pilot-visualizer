import { clamp } from "../config";
import type {
  AccentEventMode,
  AudioFrameFeature,
  EdgeMap,
  EventSpec,
  EventSpecId,
  EventState,
  PersistentMotifState,
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

function spec(entry: EventSpec): EventSpec {
  return {
    ...entry,
    family: entry.phenomenon,
    cooldownFrames: Math.max(3, Math.round(entry.cooldownFrames / 4)),
    pitch: `A ${phrase(entry.phenomenon)} event concept that punctuates ${entry.preferredBands.join(", ")} energy with a clear burst of scene-level emphasis.`,
    distinction: `It differs by favoring ${entry.preferredRegimes.join(", ")} passages and bridging into ${entry.accentEventModeBridge.map(phrase).join(", ")} accent modes.`,
    eligibility: {
      regimes: entry.preferredRegimes,
      arcs: ["punctuate", "swap"],
    },
    continuityPolicy: "punctuation",
    runtimeTuning: {
      densityScale: (entry.particleBiasModifiers.emitterScale + entry.particleBiasModifiers.explosionScale) / 2,
      couplingScale: (entry.nebulaBiasModifiers.glowScale + entry.nebulaBiasModifiers.rippleScale) / 2,
      triggerCooldownScale: entry.cooldownFrames,
      supportsMute: true,
    },
  };
}

export const EVENT_SPECS: EventSpec[] = [
  spec({
    id: "ionospheric-red-sprite-discharge",
    label: "Ionospheric Red Sprite Discharge",
    phenomenon: "atmospheric",
    preferredBands: ["high", "highMid"],
    preferredRegimes: ["build", "drop", "outro"],
    accentEventModeBridge: ["emitters", "mirror-flip"],
    triggerModeWeights: { emitter: 0.9, absorber: 0.2, explosion: 0.7 },
    particleBiasModifiers: { emitterScale: 1.2, absorberScale: 0.84, explosionScale: 1.08, driftScale: 1.04 },
    nebulaBiasModifiers: { glowScale: 1.16, streakScale: 1.2, rippleScale: 0.78 },
    transientSensitivity: 0.9,
    downbeatSensitivity: 0.66,
    phraseSensitivity: 0.52,
    cooldownFrames: 18,
  }),
  spec({
    id: "bioluminescent-dinoflagellate-agitation",
    label: "Bioluminescent Dinoflagellate Agitation",
    phenomenon: "biological",
    preferredBands: ["mid", "high"],
    preferredRegimes: ["groove", "breakdown", "outro"],
    accentEventModeBridge: ["emitters"],
    triggerModeWeights: { emitter: 0.84, absorber: 0.16, explosion: 0.24 },
    particleBiasModifiers: { emitterScale: 1.06, absorberScale: 0.92, explosionScale: 0.82, driftScale: 1.14 },
    nebulaBiasModifiers: { glowScale: 1.22, streakScale: 0.88, rippleScale: 1.08 },
    transientSensitivity: 0.52,
    downbeatSensitivity: 0.36,
    phraseSensitivity: 0.72,
    cooldownFrames: 14,
  }),
  spec({
    id: "cymatic-resonance-sand-metamorphosis",
    label: "Cymatic Resonance Sand Metamorphosis",
    phenomenon: "wave",
    preferredBands: ["low", "mid"],
    preferredRegimes: ["groove", "build"],
    accentEventModeBridge: ["chain-transfer", "petal-explosion"],
    triggerModeWeights: { emitter: 0.42, absorber: 0.34, explosion: 0.68 },
    particleBiasModifiers: { emitterScale: 0.94, absorberScale: 1, explosionScale: 1.14, driftScale: 0.96 },
    nebulaBiasModifiers: { glowScale: 0.98, streakScale: 0.76, rippleScale: 1.22 },
    transientSensitivity: 0.68,
    downbeatSensitivity: 0.62,
    phraseSensitivity: 0.54,
    cooldownFrames: 16,
  }),
  spec({
    id: "fluid-dynamic-starling-murmuration",
    label: "Fluid-Dynamic Starling Murmuration",
    phenomenon: "fluid",
    preferredBands: ["mid", "high"],
    preferredRegimes: ["groove", "build", "outro"],
    accentEventModeBridge: ["emitters", "chain-transfer"],
    triggerModeWeights: { emitter: 0.78, absorber: 0.22, explosion: 0.18 },
    particleBiasModifiers: { emitterScale: 1.14, absorberScale: 0.9, explosionScale: 0.8, driftScale: 1.24 },
    nebulaBiasModifiers: { glowScale: 1.04, streakScale: 1.1, rippleScale: 1.02 },
    transientSensitivity: 0.5,
    downbeatSensitivity: 0.32,
    phraseSensitivity: 0.82,
    cooldownFrames: 12,
  }),
  spec({
    id: "acoustic-cavitation-sonoluminescence",
    label: "Acoustic Cavitation Sonoluminescence",
    phenomenon: "optical",
    preferredBands: ["subLow", "low"],
    preferredRegimes: ["build", "drop"],
    accentEventModeBridge: ["burst-gate", "emitters"],
    triggerModeWeights: { emitter: 0.46, absorber: 0.14, explosion: 0.92 },
    particleBiasModifiers: { emitterScale: 0.96, absorberScale: 0.84, explosionScale: 1.28, driftScale: 1 },
    nebulaBiasModifiers: { glowScale: 1.18, streakScale: 0.9, rippleScale: 1.12 },
    transientSensitivity: 0.88,
    downbeatSensitivity: 0.76,
    phraseSensitivity: 0.4,
    cooldownFrames: 20,
  }),
  spec({
    id: "triboluminescent-crystal-fracture-flashes",
    label: "Triboluminescent Crystal Fracture Flashes",
    phenomenon: "fracture",
    preferredBands: ["high", "highMid"],
    preferredRegimes: ["build", "drop"],
    accentEventModeBridge: ["burst-gate", "mirror-flip"],
    triggerModeWeights: { emitter: 0.34, absorber: 0.1, explosion: 1 },
    particleBiasModifiers: { emitterScale: 0.86, absorberScale: 0.82, explosionScale: 1.32, driftScale: 0.88 },
    nebulaBiasModifiers: { glowScale: 1.06, streakScale: 1.18, rippleScale: 0.7 },
    transientSensitivity: 0.96,
    downbeatSensitivity: 0.64,
    phraseSensitivity: 0.36,
    cooldownFrames: 20,
  }),
  spec({
    id: "deep-sea-siphonophore-light-ripples",
    label: "Deep Sea Siphonophore Light Ripples",
    phenomenon: "biological",
    preferredBands: ["mid", "highMid"],
    preferredRegimes: ["breakdown", "outro", "groove"],
    accentEventModeBridge: ["absorbers", "emitters"],
    triggerModeWeights: { emitter: 0.52, absorber: 0.62, explosion: 0.18 },
    particleBiasModifiers: { emitterScale: 0.94, absorberScale: 1.12, explosionScale: 0.72, driftScale: 1.08 },
    nebulaBiasModifiers: { glowScale: 1.2, streakScale: 0.7, rippleScale: 1.24 },
    transientSensitivity: 0.4,
    downbeatSensitivity: 0.3,
    phraseSensitivity: 0.84,
    cooldownFrames: 12,
  }),
  spec({
    id: "electromagnetic-crown-flash-shifting",
    label: "Electromagnetic Crown Flash Shifting",
    phenomenon: "electrical",
    preferredBands: ["high", "mid"],
    preferredRegimes: ["build", "drop", "groove"],
    accentEventModeBridge: ["mirror-flip", "emitters"],
    triggerModeWeights: { emitter: 0.82, absorber: 0.22, explosion: 0.58 },
    particleBiasModifiers: { emitterScale: 1.16, absorberScale: 0.9, explosionScale: 1.02, driftScale: 1.06 },
    nebulaBiasModifiers: { glowScale: 1.08, streakScale: 1.16, rippleScale: 0.94 },
    transientSensitivity: 0.84,
    downbeatSensitivity: 0.58,
    phraseSensitivity: 0.42,
    cooldownFrames: 16,
  }),
  spec({
    id: "explosive-fungal-spore-cloud-dispersal",
    label: "Explosive Fungal Spore Cloud Dispersal",
    phenomenon: "biological",
    preferredBands: ["lowMid", "mid"],
    preferredRegimes: ["build", "breakdown", "groove"],
    accentEventModeBridge: ["petal-explosion", "emitters"],
    triggerModeWeights: { emitter: 0.76, absorber: 0.18, explosion: 0.72 },
    particleBiasModifiers: { emitterScale: 1.08, absorberScale: 0.9, explosionScale: 1.06, driftScale: 1.16 },
    nebulaBiasModifiers: { glowScale: 1, streakScale: 0.82, rippleScale: 1.16 },
    transientSensitivity: 0.62,
    downbeatSensitivity: 0.56,
    phraseSensitivity: 0.74,
    cooldownFrames: 15,
  }),
  spec({
    id: "kawah-ijen-blue-sulfur-combustion",
    label: "Kawah Ijen Blue Sulfur Combustion",
    phenomenon: "chemical",
    preferredBands: ["low", "high"],
    preferredRegimes: ["outro", "breakdown", "drop"],
    accentEventModeBridge: ["absorbers", "burst-gate"],
    triggerModeWeights: { emitter: 0.3, absorber: 0.76, explosion: 0.62 },
    particleBiasModifiers: { emitterScale: 0.82, absorberScale: 1.12, explosionScale: 1.04, driftScale: 1.02 },
    nebulaBiasModifiers: { glowScale: 1.18, streakScale: 0.84, rippleScale: 0.98 },
    transientSensitivity: 0.66,
    downbeatSensitivity: 0.5,
    phraseSensitivity: 0.8,
    cooldownFrames: 18,
  }),
  spec({
    id: "parhelion-double-sun-flare",
    label: "Parhelion Double Sun Flare",
    phenomenon: "optical",
    preferredBands: ["highMid", "high"],
    preferredRegimes: ["build", "drop", "outro"],
    accentEventModeBridge: ["mirror-flip", "burst-gate"],
    triggerModeWeights: { emitter: 0.58, absorber: 0.18, explosion: 0.88 },
    particleBiasModifiers: { emitterScale: 1.04, absorberScale: 0.9, explosionScale: 1.18, driftScale: 1.02 },
    nebulaBiasModifiers: { glowScale: 1.22, streakScale: 1.08, rippleScale: 0.92 },
    transientSensitivity: 0.84,
    downbeatSensitivity: 0.66,
    phraseSensitivity: 0.46,
    cooldownFrames: 17,
  }),
  spec({
    id: "catoptric-chamber-light-fold",
    label: "Catoptric Chamber Light Fold",
    phenomenon: "optical",
    preferredBands: ["mid", "highMid"],
    preferredRegimes: ["groove", "build", "breakdown"],
    accentEventModeBridge: ["mirror-flip", "absorbers"],
    triggerModeWeights: { emitter: 0.44, absorber: 0.72, explosion: 0.34 },
    particleBiasModifiers: { emitterScale: 0.92, absorberScale: 1.18, explosionScale: 0.86, driftScale: 1.08 },
    nebulaBiasModifiers: { glowScale: 1.1, streakScale: 0.84, rippleScale: 1.2 },
    transientSensitivity: 0.58,
    downbeatSensitivity: 0.4,
    phraseSensitivity: 0.8,
    cooldownFrames: 15,
  }),
  spec({
    id: "mercury-mirror-ripple-shear",
    label: "Mercury Mirror Ripple Shear",
    phenomenon: "fluid",
    preferredBands: ["mid", "high"],
    preferredRegimes: ["build", "drop", "groove"],
    accentEventModeBridge: ["mirror-flip", "chain-transfer"],
    triggerModeWeights: { emitter: 0.78, absorber: 0.28, explosion: 0.54 },
    particleBiasModifiers: { emitterScale: 1.1, absorberScale: 0.94, explosionScale: 1.02, driftScale: 1.16 },
    nebulaBiasModifiers: { glowScale: 1.06, streakScale: 1.18, rippleScale: 1.08 },
    transientSensitivity: 0.76,
    downbeatSensitivity: 0.52,
    phraseSensitivity: 0.62,
    cooldownFrames: 16,
  }),
  spec({
    id: "kaleidoscopic-wingbeat-refrain",
    label: "Kaleidoscopic Wingbeat Refrain",
    phenomenon: "biological",
    preferredBands: ["mid", "highMid"],
    preferredRegimes: ["groove", "outro", "breakdown"],
    accentEventModeBridge: ["mirror-flip", "emitters", "petal-explosion"],
    triggerModeWeights: { emitter: 0.88, absorber: 0.22, explosion: 0.46 },
    particleBiasModifiers: { emitterScale: 1.16, absorberScale: 0.92, explosionScale: 0.94, driftScale: 1.22 },
    nebulaBiasModifiers: { glowScale: 1.14, streakScale: 0.96, rippleScale: 1.16 },
    transientSensitivity: 0.54,
    downbeatSensitivity: 0.34,
    phraseSensitivity: 0.86,
    cooldownFrames: 13,
  }),
  spec({
    id: "axial-vortex-reversal-bloom",
    label: "Axial Vortex Reversal Bloom",
    phenomenon: "wave",
    preferredBands: ["subLow", "low", "mid"],
    preferredRegimes: ["build", "drop", "outro"],
    accentEventModeBridge: ["mirror-flip", "burst-gate", "absorbers"],
    triggerModeWeights: { emitter: 0.42, absorber: 0.68, explosion: 0.82 },
    particleBiasModifiers: { emitterScale: 0.9, absorberScale: 1.14, explosionScale: 1.22, driftScale: 1 },
    nebulaBiasModifiers: { glowScale: 1.12, streakScale: 0.88, rippleScale: 1.24 },
    transientSensitivity: 0.82,
    downbeatSensitivity: 0.74,
    phraseSensitivity: 0.48,
    cooldownFrames: 18,
  }),
];

export function eventEnergyScore(frame: AudioFrameFeature): number {
  return clamp(
    (
      frame.peakStrength * 0.28 +
      frame.onsetStrength * 0.24 +
      (frame.bandWeightedScore ?? frame.dbNormalized) * 0.18 +
      (frame.phrasePulse ?? 0) * 0.16 +
      (frame.isBarDownbeat ? 0.08 : 0) +
      (frame.isFourBarDownbeat ? 0.12 : 0)
    ) * 3,
    0,
    1.4,
  );
}

export function selectEventSpec(params: {
  edgeMap: EdgeMap;
  frame: AudioFrameFeature;
  visualRegime: VisualRegime;
  persistentMotif?: PersistentMotifState;
  previousEventId?: EventSpecId;
}): EventSpec {
  const { edgeMap, frame, visualRegime, persistentMotif, previousEventId } = params;
  let pool = EVENT_SPECS.filter((entry) => entry.preferredRegimes.includes(visualRegime));
  pool = pool.filter(
    (entry) =>
      entry.preferredBands.includes(frame.dominantBand) ||
      entry.preferredBands.includes(frame.dominantBand === "low" ? "subLow" : frame.dominantBand === "high" ? "highMid" : frame.dominantBand),
  );
  if (persistentMotif) {
    const preferred = pool.filter((entry) => {
      const motifMatch = stableHash(`${persistentMotif.id}|${entry.id}`) % 5 === 0;
      return motifMatch;
    });
    if (preferred.length > 0) {
      pool = preferred;
    }
  }
  if (pool.length === 0) {
    pool = EVENT_SPECS;
  }
  const deduped = previousEventId && pool.length > 1 ? pool.filter((entry) => entry.id !== previousEventId) : pool;
  const hash = stableHash(`${edgeMap.imagePath}|${frame.frameIndex}|${visualRegime}|${persistentMotif?.id ?? "none"}`);
  return deduped[hash % Math.max(1, deduped.length)] ?? EVENT_SPECS[0]!;
}

export function evaluateEventState(params: {
  spec: EventSpec;
  frame: AudioFrameFeature;
  persistentMotif?: PersistentMotifState;
  previous?: EventState;
}): EventState {
  const { spec, frame, persistentMotif, previous } = params;
  const energy = eventEnergyScore(frame);
  const motifBias = persistentMotif ? clamp(persistentMotif.transientScore * 0.18 + persistentMotif.ageFrames / 240, 0, 0.22) : 0;
  const intensity = clamp(
    energy * 0.58 +
    spec.transientSensitivity * frame.peakStrength * 0.2 +
    spec.downbeatSensitivity * ((frame.isBarDownbeat ? 0.1 : 0) + (frame.isFourBarDownbeat ? 0.14 : 0)) +
    spec.phraseSensitivity * (frame.phrasePulse ?? 0) * 0.24 +
    motifBias,
    0,
    1.3,
  );
  return {
    id: spec.id,
    label: spec.label,
    intensity,
    emitterBias: clamp(spec.triggerModeWeights.emitter * intensity, 0, 1.5),
    absorberBias: clamp(spec.triggerModeWeights.absorber * intensity, 0, 1.5),
    explosionBias: clamp(spec.triggerModeWeights.explosion * intensity, 0, 1.5),
    accentModes: spec.accentEventModeBridge,
    changedThisFrame: previous?.id !== spec.id,
  };
}

export function mergeAccentModes(base: AccentEventMode[], extra: AccentEventMode[]): AccentEventMode[] {
  return [...new Set([...base, ...extra])];
}
