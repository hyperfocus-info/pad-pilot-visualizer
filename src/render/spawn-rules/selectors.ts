import type {
  BackgroundElementSpec,
  EventSpec,
  MotifEffectSpec,
  ParticleConceptId,
  SceneGraph,
  SpawnContext,
  SpawnSelection,
} from "../../types";
import {
  PARTICLE_CONCEPT_SPECS,
  SPAWN_BACKGROUND_CATALOG,
  SPAWN_EVENT_CATALOG,
  SPAWN_MOTIF_EFFECT_CATALOG,
  particleConceptById,
} from "./catalog";

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scoreBackground(entry: BackgroundElementSpec, context: SpawnContext): SpawnSelection<BackgroundElementSpec["id"]> & { score: number; spec: BackgroundElementSpec } {
  const motifMatch = entry.supportedMotifs.includes(context.resolvedHeroMotif) ? 2.4 : entry.fallbackMotifs.includes(context.resolvedHeroMotif) ? 1.1 : 0;
  const continuity = context.previousBackgroundId === entry.id ? (entry.continuityPolicy === "hold-friendly" || entry.continuityPolicy === "reuse" ? 0.6 : -0.2) : 0;
  const coupling = context.preferHeroCoupling * entry.heroCouplingStrength * 0.8;
  const symmetry =
    context.symmetryTier === "mirrored" && (entry.imageResponseMode === "symmetry" || entry.family === "ring-field" || entry.family === "sigil-field")
      ? 0.35
      : context.symmetryTier === "free" && entry.family === "plane-field"
        ? 0.2
        : 0;
  const fragilityPenalty =
    context.compositionHealth === "fragile" && (entry.imageResponseMode === "silhouette" || entry.interactionMode === "hero-path-predictive")
      ? -0.45
      : context.compositionHealth === "recovering" && entry.interactionMode === "hero-path-predictive"
        ? -0.2
        : 0;
  const sceneChangeBias = context.sceneChanged && entry.continuityPolicy === "swap-friendly" ? 0.25 : 0;
  const score = motifMatch + continuity + coupling + symmetry + sceneChangeBias + fragilityPenalty;
  return {
    id: entry.id,
    spec: entry,
    score,
    reasonCodes: [
      motifMatch > 0 ? "motif-match" : "motif-fallback",
      continuity > 0 ? "continuity-hold" : "fresh-pick",
      fragilityPenalty < 0 ? "fragility-trim" : "full-read",
    ],
    continuityReason: context.previousBackgroundId === entry.id ? "kept previous background concept because its continuity policy prefers carry." : "picked a new background concept from explicit motif and coupling rules.",
    rankingSignals: [
      { label: "motifMatch", value: motifMatch },
      { label: "continuity", value: continuity },
      { label: "coupling", value: coupling },
      { label: "symmetry", value: symmetry },
      { label: "fragilityPenalty", value: fragilityPenalty },
    ],
  };
}

function scoreEvent(entry: EventSpec, context: SpawnContext): SpawnSelection<EventSpec["id"]> & { score: number; spec: EventSpec } {
  const regimeMatch = entry.preferredRegimes.includes(context.visualRegime) ? 1.6 : 0;
  const bandMatch = context.dominantBand && entry.preferredBands.includes(context.dominantBand) ? 1 : 0;
  const continuityPenalty = context.previousEventId === entry.id ? -0.5 : 0;
  const punctuationBias = context.spawnArc === "punctuate" ? 0.4 : 0;
  const score = regimeMatch + bandMatch + punctuationBias + continuityPenalty;
  return {
    id: entry.id,
    spec: entry,
    score,
    reasonCodes: [
      regimeMatch > 0 ? "regime-match" : "regime-wide",
      bandMatch > 0 ? "band-match" : "band-neutral",
      continuityPenalty < 0 ? "repeat-penalty" : "fresh-pick",
    ],
    continuityReason: context.previousEventId === entry.id ? "avoided repeating the same event concept on consecutive selections." : "picked an event concept from explicit regime and band preferences.",
    rankingSignals: [
      { label: "regimeMatch", value: regimeMatch },
      { label: "bandMatch", value: bandMatch },
      { label: "punctuationBias", value: punctuationBias },
      { label: "continuityPenalty", value: continuityPenalty },
    ],
  };
}

function scoreMotifEffect(entry: MotifEffectSpec, context: SpawnContext): SpawnSelection<MotifEffectSpec["id"]> & { score: number; spec: MotifEffectSpec } {
  const motifMatch = entry.primaryMotif === context.resolvedHeroMotif ? 2.2 : entry.fallbackMotifs.includes(context.resolvedHeroMotif) ? 1 : 0;
  const regimeMatch = entry.preferredRegimes.includes(context.visualRegime) ? 1.2 : 0;
  const overlayMatch = entry.baseOverlayMode === context.overlayMode ? 0.5 : 0;
  const continuityPenalty = context.previousMotifEffectId === entry.id ? -0.35 : 0;
  const rarePenalty = entry.continuityPolicy === "rare" && context.spawnArc === "hold" ? -0.25 : 0;
  const score = motifMatch + regimeMatch + overlayMatch + continuityPenalty + rarePenalty + (entry.selectionWeight ?? 1) * 0.05;
  return {
    id: entry.id,
    spec: entry,
    score,
    reasonCodes: [
      motifMatch > 0 ? "motif-match" : "motif-wide",
      regimeMatch > 0 ? "regime-match" : "regime-wide",
      overlayMatch > 0 ? "overlay-match" : "overlay-neutral",
    ],
    continuityReason: context.previousMotifEffectId === entry.id ? "de-prioritized the previous motif effect because this selector does not silently hold effects forever." : "picked a motif effect from explicit motif, regime, and overlay rules.",
    rankingSignals: [
      { label: "motifMatch", value: motifMatch },
      { label: "regimeMatch", value: regimeMatch },
      { label: "overlayMatch", value: overlayMatch },
      { label: "continuityPenalty", value: continuityPenalty },
      { label: "rarePenalty", value: rarePenalty },
    ],
  };
}

function chooseTop<T extends { id: string; score: number }>(entries: T[], hashSeed: string): T {
  const sorted = [...entries].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const topScore = sorted[0]?.score ?? 0;
  const top = sorted.filter((entry) => Math.abs(entry.score - topScore) < 0.0001);
  return top[stableHash(hashSeed) % Math.max(1, top.length)] ?? sorted[0]!;
}

export function selectBackgroundConcept(context: SpawnContext): { spec: BackgroundElementSpec; selection: SpawnSelection<BackgroundElementSpec["id"]> } {
  const scored = SPAWN_BACKGROUND_CATALOG.map((entry) => scoreBackground(entry, context));
  const chosen = chooseTop(scored, `${context.sceneKey}:${context.continuitySeed}:background`);
  return { spec: chosen.spec, selection: chosen };
}

export function selectEventConcept(context: SpawnContext): { spec: EventSpec; selection: SpawnSelection<EventSpec["id"]> } {
  const scored = SPAWN_EVENT_CATALOG.map((entry) => scoreEvent(entry, context));
  const chosen = chooseTop(scored, `${context.sceneKey}:${context.continuitySeed}:event`);
  return { spec: chosen.spec, selection: chosen };
}

export function selectMotifEffectConcept(context: SpawnContext): { spec: MotifEffectSpec; selection: SpawnSelection<MotifEffectSpec["id"]> } {
  const scored = SPAWN_MOTIF_EFFECT_CATALOG.map((entry) => scoreMotifEffect(entry, context));
  const chosen = chooseTop(scored, `${context.sceneKey}:${context.continuitySeed}:effect`);
  return { spec: chosen.spec, selection: chosen };
}

export function selectParticleConcepts(context: SpawnContext, sceneGraph: SceneGraph): { ids: ParticleConceptId[]; selections: Array<SpawnSelection<ParticleConceptId>> } {
  const ids: ParticleConceptId[] = [];
  const add = (id: ParticleConceptId, reasonCode: string, continuityReason: string): void => {
    if (!particleConceptById(id) || ids.includes(id)) {
      return;
    }
    ids.push(id);
    selections.push({
      id,
      reasonCodes: [reasonCode],
      continuityReason,
      rankingSignals: [],
    });
  };
  const selections: Array<SpawnSelection<ParticleConceptId>> = [];
  add(`directive-${sceneGraph.intentSeed.heroDirective.motionScript}`, "hero-directive", "kept the hero directive explicit instead of inferring a hidden particle family.");
  add(`directive-${sceneGraph.intentSeed.supportDirective.motionScript}`, "support-directive", "kept the support directive explicit instead of inferring a hidden particle family.");
  add(`directive-${sceneGraph.intentSeed.backgroundDirective.motionScript}`, "background-directive", "kept the background directive explicit instead of inferring a hidden particle family.");
  for (const accent of sceneGraph.episodeSeed.accentModes) {
    if (accent === "emitters") add("accent-emitters", "accent-mode", "added the emitter accent because the episode seed explicitly asked for it.");
    if (accent === "absorbers") add("accent-absorbers", "accent-mode", "added the absorber accent because the episode seed explicitly asked for it.");
    if (accent === "burst-gate" || accent === "petal-explosion") add("accent-release-bloom", "accent-mode", "added the release bloom accent because the episode seed explicitly asked for punctuation.");
  }
  add(`emission-${sceneGraph.heroEmissionMode}`, "hero-emission", "used the scene's explicit hero emission mode as a particle concept.");
  add(`sub-${sceneGraph.subEmitterMode}`, "sub-emitter", "used the scene's explicit sub-emitter mode as a particle concept.");
  if (["catoptric-duet", "mirror-procession", "kaleido-coronation", "quad-vigil", "prism-tribunal"].includes(sceneGraph.episodeSeed.episodeIntent)) {
    add("episode-reflective-core", "episode-intent", "added reflective support because the episode intent is explicitly reflective.");
  }
  if (["kaleido-coronation", "quad-vigil"].includes(sceneGraph.episodeSeed.episodeIntent)) {
    add("episode-kaleido-shear", "episode-intent", "added kaleido shear because the episode intent explicitly calls for it.");
  }
  if (["mirror-procession", "prism-tribunal"].includes(sceneGraph.episodeSeed.episodeIntent)) {
    add("episode-paired-braid", "episode-intent", "added paired braid because the episode intent explicitly calls for lane pairing.");
  }
  if (["catoptric-duet", "prism-tribunal"].includes(sceneGraph.episodeSeed.episodeIntent)) {
    add("episode-prism-well", "episode-intent", "added prism well because the episode intent explicitly calls for reflective pull.");
  }
  add(`motif-${context.resolvedHeroMotif}`, "resolved-hero-motif", "added the resolved hero motif particle concept rather than relying on hidden motif-specific branches.");
  return { ids, selections };
}

export function listParticleConceptMetadata(): typeof PARTICLE_CONCEPT_SPECS {
  return PARTICLE_CONCEPT_SPECS;
}
