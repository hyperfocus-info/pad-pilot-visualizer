import { clamp } from "../../config";
import type {
  BackgroundElementId,
  CompositionPlan,
  EdgeMap,
  EventSpecId,
  MotifEffectId,
  ParticleConceptId,
  PersistentMotifId,
  RenderTheme,
  SceneGraph,
  SpawnCompositionHealth,
  SpawnContext,
  SpawnEnergyTier,
  SpawnSymmetryTier,
  VisualState,
} from "../../types";
import { SPAWN_MOTIF_FAMILY_BY_MOTIF } from "./catalog";

export interface BuildSpawnContextParams {
  edgeMap: EdgeMap;
  theme: RenderTheme;
  visualState: VisualState;
  compositionPlan: CompositionPlan;
  sceneGraph: SceneGraph;
  resolvedImageIndex: number;
  sceneChanged: boolean;
  dominantBand?: SpawnContext["dominantBand"];
  previousBackgroundId?: BackgroundElementId;
  previousEventId?: EventSpecId;
  previousMotifEffectId?: MotifEffectId;
  previousParticleConceptIds?: ParticleConceptId[];
  persistentMotifId?: PersistentMotifId;
  fallbackRenderMode?: "none" | "fallback-composed" | "safety-recovery" | "mask-recovery";
  supportNearHeroScore?: number;
  focalOccupancyScore?: number;
}

function deriveSpawnEnergyTier(state: VisualState): SpawnEnergyTier {
  if (state.regime === "drop" || state.regime === "build" || state.overlayMode === "climax-burst") {
    return "high";
  }
  if (state.regime === "groove" || state.regime === "breakdown" || state.overlayMode === "kinetic-scan") {
    return "mid";
  }
  return "low";
}

function deriveSpawnSymmetryTier(theme: RenderTheme): SpawnSymmetryTier {
  if (theme.styleProfile.symmetry >= 0.72) {
    return "mirrored";
  }
  if (theme.styleProfile.symmetry >= 0.44) {
    return "balanced";
  }
  return "free";
}

function deriveCompositionHealth(
  fallbackRenderMode: BuildSpawnContextParams["fallbackRenderMode"],
  supportNearHeroScore: number,
  focalOccupancyScore: number,
): SpawnCompositionHealth {
  if (fallbackRenderMode === "fallback-composed" || supportNearHeroScore < 0.22 || focalOccupancyScore < 0.12) {
    return "fragile";
  }
  if (fallbackRenderMode === "safety-recovery" || fallbackRenderMode === "mask-recovery" || supportNearHeroScore < 0.34 || focalOccupancyScore < 0.2) {
    return "recovering";
  }
  return "strong";
}

export function buildSpawnContext(params: BuildSpawnContextParams): SpawnContext {
  const resolvedHeroMotif = params.sceneGraph.heroMotifScheduled ?? params.edgeMap.fractalMotif;
  const supportNearHeroScore = params.supportNearHeroScore ?? 0.5;
  const focalOccupancyScore = params.focalOccupancyScore ?? params.compositionPlan.focalOccupancyScore ?? 0.5;
  return {
    sceneKey: params.edgeMap.imagePath,
    sceneChanged: params.sceneChanged,
    resolvedImageIndex: params.resolvedImageIndex,
    sourceImagePath: params.edgeMap.imagePath,
    sourceMotif: params.edgeMap.fractalMotif,
    resolvedHeroMotif,
    motifFamily: SPAWN_MOTIF_FAMILY_BY_MOTIF[resolvedHeroMotif] ?? SPAWN_MOTIF_FAMILY_BY_MOTIF[params.edgeMap.fractalMotif],
    visualRegime: params.visualState.regime,
    overlayMode: params.visualState.overlayMode,
    dominantBand: params.dominantBand,
    spawnArc:
      params.visualState.transitionTriggerPreference === "swap"
        ? "swap"
        : params.visualState.transitionTriggerPreference === "hold"
          ? "hold"
          : params.visualState.overlayMode === "climax-burst"
            ? "punctuate"
            : "mixed",
    energyTier: deriveSpawnEnergyTier(params.visualState),
    symmetryTier: deriveSpawnSymmetryTier(params.theme),
    compositionHealth: deriveCompositionHealth(params.fallbackRenderMode, supportNearHeroScore, focalOccupancyScore),
    maskConfidence: params.edgeMap.maskConfidence,
    heroCount: Math.max(1, params.sceneGraph.heroClusterConfig.count),
    heroRelationshipClass: params.sceneGraph.heroRelationshipClass,
    continuitySeed: params.sceneGraph.continuitySeed,
    preferHeroCoupling: clamp(0.4 + params.sceneGraph.intentSeed.energyBias * 0.2 + params.sceneGraph.intentSeed.playfulness * 0.18, 0.3, 0.9),
    previousBackgroundId: params.previousBackgroundId,
    previousEventId: params.previousEventId,
    previousMotifEffectId: params.previousMotifEffectId,
    previousParticleConceptIds: params.previousParticleConceptIds,
    persistentMotifId: params.persistentMotifId,
  };
}
