import { clamp } from "../../config";
import type {
  BackgroundElementSpec,
  BackgroundPlan,
  CompositionPlan,
  EdgeMap,
  HeroEmissionMode,
  OccupancyPurpose,
  ParticleBehaviorParams,
  ParticleConceptId,
  PlacementSlot,
  RenderTheme,
  SceneGraph,
  ShapeFamilyToken,
  SpawnAdjustment,
  SpawnContext,
} from "../../types";
import { pickIndex, seedToUnitFloat, stableHash32 } from "../seed-utils";

function defaultSlot(edgeMap: EdgeMap, compositionPlan: CompositionPlan, index: 0 | 1): PlacementSlot {
  return compositionPlan.backgroundSlots[index] ?? {
    x: index === 0 ? edgeMap.width * 0.14 : edgeMap.width * 0.86,
    y: index === 0 ? edgeMap.height * 0.18 : edgeMap.height * 0.82,
    radius: index === 0 ? 64 : 72,
    weight: 0.5,
    layer: "background",
    angle: index === 0 ? 0 : Math.PI,
  };
}

export function createBackgroundAdjustment(context: SpawnContext, spec: BackgroundElementSpec): SpawnAdjustment {
  const densityScale =
    context.compositionHealth === "fragile"
      ? 0.66
      : context.compositionHealth === "recovering"
        ? 0.82
        : 1;
  const disableSilhouette =
    context.maskConfidence === "low" &&
    (spec.imageResponseMode === "silhouette" || spec.triggerMode === "silhouette-strobe");
  const disablePathPrediction =
    context.compositionHealth !== "strong" &&
    spec.interactionMode === "hero-path-predictive";
  const muted = context.compositionHealth === "fragile" && context.energyTier === "low" && spec.family === "void-shape";
  return {
    densityScale,
    heroCouplingScale: context.compositionHealth === "fragile" ? 0.72 : 1,
    particleCouplingScale: context.compositionHealth === "fragile" ? 0.76 : 1,
    triggerWindowScale: context.compositionHealth === "fragile" ? 0.75 : 1,
    disableSilhouette,
    disablePathPrediction,
    muted,
    renderMode: muted ? "muted" : densityScale < 1 || disableSilhouette || disablePathPrediction ? "reduced" : "full",
  };
}

export function buildBackgroundPlanFromSelection(params: {
  context: SpawnContext;
  selectionId: BackgroundElementSpec["id"];
  spec: BackgroundElementSpec;
  adjustment: SpawnAdjustment;
  edgeMap: EdgeMap;
  theme: RenderTheme;
  compositionPlan: CompositionPlan;
  sceneGraph: SceneGraph;
}): BackgroundPlan {
  const { context, spec, adjustment, edgeMap, theme, compositionPlan, sceneGraph } = params;
  const profile = theme.styleProfile;
  const start = defaultSlot(edgeMap, compositionPlan, 0);
  const end = defaultSlot(edgeMap, compositionPlan, 1);
  const densityScale = adjustment.densityScale ?? 1;
  const heroCouplingScale = adjustment.heroCouplingScale ?? 1;
  const particleCouplingScale = adjustment.particleCouplingScale ?? 1;
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
    driftScale: (0.16 + profile.edgeDensity * 0.12) * densityScale,
    backgroundElementId: spec.id,
    backgroundElementFamily: spec.family,
    motifAffinity: spec.motifAffinity,
    renderMode:
      adjustment.renderMode === "muted"
        ? "gradient-only"
        : "element-primary",
    pulseProfile: {
      beatPulseStrength: clamp((0.58 + sceneGraph.intentSeed.energyBias * 0.34 + profile.edgeDensity * 0.12) * densityScale, 0.42, 1.08),
      barPulseStrength: clamp((0.62 + profile.contrast * 0.18 + sceneGraph.intentSeed.pathBias * 0.24) * densityScale, 0.5, 1.04),
      betweenBeatBreathing: clamp(0.38 + (1 - profile.contrast) * 0.22 + profile.saturationMean * 0.18, 0.28, 0.86),
      flickerAmount: clamp(0.08 + sceneGraph.intentSeed.scatterBias * 0.2 + sceneGraph.nebulaBandRouting.sparkHigh * 0.08, 0.06, 0.44),
    },
    hzColorRouting: {
      subLow: clamp(0.22 + sceneGraph.nebulaBandRouting.structureLow * 0.42, 0.18, 1.04),
      low: clamp(0.28 + sceneGraph.nebulaBandRouting.glowLowMid * 0.34, 0.22, 1),
      mid: clamp(0.32 + sceneGraph.nebulaBandRouting.textureMid * 0.42, 0.26, 1.08),
      highMid: clamp(0.24 + sceneGraph.nebulaBandRouting.distortionHighMid * 0.44, 0.18, 1.04),
      high: clamp(0.18 + sceneGraph.nebulaBandRouting.sparkHigh * 0.52, 0.14, 1.1),
    },
    continuityBlend: clamp(0.38 + seedToUnitFloat(stableHash32(`${context.sceneKey}:${context.continuitySeed}:continuity-blend`)) * 0.6, 0.38, 0.98),
    geometryParams: {
      ...spec.geometryDefaults,
      density: clamp(spec.geometryDefaults.density * densityScale, 0.12, 1),
      count: Math.max(1, Math.round(spec.geometryDefaults.count * densityScale)),
    },
    motionParams: spec.motionDefaults,
    interactionMode: adjustment.disablePathPrediction ? "none" : spec.interactionMode,
    triggerMode: spec.triggerMode,
    imageResponseMode: adjustment.disableSilhouette ? "palette" : spec.imageResponseMode,
    familyVariant: spec.familyVariant,
    heroCouplingStrength: spec.heroCouplingStrength * heroCouplingScale,
    particleCouplingStrength: spec.particleCouplingStrength * particleCouplingScale,
    triggerPhaseOffset: seedToUnitFloat(stableHash32(`${context.sceneKey}:${context.continuitySeed}:trigger-phase`)),
    triggerWindowFrames: Math.max(2, Math.round((8 + pickIndex(stableHash32(`${context.sceneKey}:${context.continuitySeed}:trigger-window`), 5) * 2) * (adjustment.triggerWindowScale ?? 1))),
    usesHeroParticles: spec.supportsHeroParticles && !adjustment.muted,
    usesHeroPathPrediction: spec.interactionMode === "hero-path-predictive" && !adjustment.disablePathPrediction,
    colorTuning: {
      baselineColorfulnessScale: 1.1,
      peakColorfulnessScale: 1.4,
      peakColorEligible: spec.heroCouplingStrength >= 0.72 || spec.particleCouplingStrength >= 0.48,
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
    layeringParams: {
      hazeAlpha: spec.hazeAssist ? clamp(0.06 + profile.contrast * 0.05, 0.05, 0.14) : 0,
      glowAlpha: clamp(0.08 + profile.saturationMean * 0.08 + sceneGraph.intentSeed.energyBias * 0.06, 0.06, 0.18),
      blendMode: spec.family === "void-shape" ? "overlay" : "screen",
    },
    fallbackNebulaEnabled: Boolean(spec.hazeAssist) || adjustment.muted,
  };
}

function motionModeForConcept(id: ParticleConceptId): ParticleBehaviorParams["mode"] {
  if (id.includes("follow-hero")) return "orbit-hero";
  if (id.includes("orbit-anchor")) return "orbit-hero";
  if (id.includes("braid-lane")) return "edge-drift";
  if (id.includes("dual-well")) return "dual-attractor";
  if (id.includes("emit-to-edge")) return "edge-escape";
  if (id.includes("spiral-in")) return "spiral-in";
  if (id.includes("spiral-out")) return "spiral-out";
  if (id.includes("burst-falloff")) return "edge-escape";
  if (id.includes("signal-drift")) return "edge-drift";
  if (id.includes("edge-fog")) return "edge-drift";
  if (id.includes("absorb-well")) return "absorb-well";
  if (id.includes("emit-chain")) return "emit-chain";
  if (id.includes("release-bloom")) return "release-bloom";
  return "dual-attractor";
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

function occupancyPurposeForDirective(layer: "hero" | "support" | "background", motionScript: string): OccupancyPurpose {
  if (layer === "hero") {
    return motionScript === "orbit-anchor" ? "ritual-ring" : "hero-wake";
  }
  if (motionScript === "burst-falloff" || motionScript === "emit-to-edge") {
    return "burst-remnant";
  }
  if (motionScript === "braid-lane" || motionScript === "follow-hero") {
    return "path-node";
  }
  return layer === "background" ? "ambient-fog" : "support-wake";
}

function pushDirectiveBehaviors(
  behaviors: ParticleBehaviorParams[],
  layer: "hero" | "support" | "background",
  motionScript: string,
  shapeFamilies: ShapeFamilyToken[],
  slots: PlacementSlot[],
  compositionPlan: CompositionPlan,
  dominance: number,
  scatterBias: number,
): void {
  const poolSize = layer === "hero" ? 4 : layer === "support" ? 6 : 8;
  for (let index = 0; index < poolSize; index += 1) {
    const count = Math.max(1, slots.length);
    const counterpartCount = Math.max(1, (layer === "background" ? compositionPlan.supportSlots.length : compositionPlan.backgroundSlots.length) || count);
    behaviors.push({
      mode: motionModeForConcept(`directive-${motionScript}`),
      shape: shapeModeForFamily(shapeFamilies[index % shapeFamilies.length] ?? "dot"),
      targetA: index % count,
      targetB: (index + 1) % counterpartCount,
      orbitScale: 0.45 + dominance * 0.55 + index * 0.06,
      driftScale: 0.28 + scatterBias * 0.4 + index * 0.04,
      script: motionScript as ParticleBehaviorParams["script"],
      purpose: occupancyPurposeForDirective(layer, motionScript),
      layer,
    });
  }
}

function heroEmissionBehavior(emissionMode: HeroEmissionMode): ParticleBehaviorParams {
  if (emissionMode === "orbit-shed") {
    return { mode: "emit-chain", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.88, driftScale: 0.56, script: "emit-chain", purpose: "hero-wake", layer: "hero" };
  }
  if (emissionMode === "mouth-flare") {
    return { mode: "release-bloom", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.72, script: "release-bloom", purpose: "burst-remnant", layer: "hero" };
  }
  return {
    mode: "emit-chain",
    shape: emissionMode === "hand-cascade" ? "chevron" : emissionMode === "crown-spray" ? "arc" : "ring",
    targetA: 0,
    targetB: 0,
    orbitScale: emissionMode === "spine-fountain" ? 0.44 : 0.58,
    driftScale: emissionMode === "spine-fountain" ? 0.78 : 0.62,
    script: "emit-chain",
    purpose: "hero-wake",
    layer: "hero",
  };
}

export function buildParticleBehaviorsFromSelection(params: {
  conceptIds: ParticleConceptId[];
  compositionPlan: CompositionPlan;
  sceneGraph: SceneGraph;
}): ParticleBehaviorParams[] {
  const { conceptIds, compositionPlan, sceneGraph } = params;
  const has = (id: ParticleConceptId): boolean => conceptIds.includes(id);
  const behaviors: ParticleBehaviorParams[] = [];
  pushDirectiveBehaviors(
    behaviors,
    "hero",
    sceneGraph.intentSeed.heroDirective.motionScript,
    sceneGraph.intentSeed.heroDirective.shapeFamilies.length > 0 ? sceneGraph.intentSeed.heroDirective.shapeFamilies : ["dot"],
    [{ x: compositionPlan.heroCenterX, y: compositionPlan.heroCenterY, radius: compositionPlan.heroRadius, weight: 1, layer: "hero", angle: 0 }],
    compositionPlan,
    sceneGraph.intentSeed.heroDirective.dominance,
    sceneGraph.intentSeed.scatterBias,
  );
  pushDirectiveBehaviors(
    behaviors,
    "support",
    sceneGraph.intentSeed.supportDirective.motionScript,
    sceneGraph.intentSeed.supportDirective.shapeFamilies.length > 0 ? sceneGraph.intentSeed.supportDirective.shapeFamilies : ["dot"],
    compositionPlan.supportSlots,
    compositionPlan,
    sceneGraph.intentSeed.supportDirective.dominance,
    sceneGraph.intentSeed.scatterBias,
  );
  pushDirectiveBehaviors(
    behaviors,
    "background",
    sceneGraph.intentSeed.backgroundDirective.motionScript,
    sceneGraph.intentSeed.backgroundDirective.shapeFamilies.length > 0 ? sceneGraph.intentSeed.backgroundDirective.shapeFamilies : ["dot"],
    compositionPlan.backgroundSlots,
    compositionPlan,
    sceneGraph.intentSeed.backgroundDirective.dominance,
    sceneGraph.intentSeed.scatterBias,
  );
  if (has("accent-emitters")) {
    behaviors.push({ mode: "emit-chain", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.65, driftScale: 0.72, script: "emit-chain", purpose: "burst-remnant", layer: "support" });
  }
  if (has("accent-absorbers")) {
    behaviors.push({ mode: "absorb-well", shape: "ring", targetA: Math.min(1, Math.max(0, compositionPlan.supportSlots.length - 1)), targetB: 0, orbitScale: 0.52, driftScale: 0.44, script: "absorb-well", purpose: "path-node", layer: "support" });
  }
  if (has("accent-release-bloom")) {
    behaviors.push({ mode: "release-bloom", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.74, driftScale: 0.84, script: "release-bloom", purpose: "burst-remnant", layer: "background" });
  }
  behaviors.push(heroEmissionBehavior(sceneGraph.heroEmissionMode));
  if (has("sub-echo-ring")) {
    behaviors.push({ mode: "orbit-hero", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.92, driftScale: 0.34, script: "follow-hero", purpose: "ritual-ring", layer: "hero" });
  }
  if (has("episode-reflective-core")) {
    behaviors.push(
      { mode: "mirror-orbit", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.86, driftScale: 0.44, script: "follow-hero", purpose: "ritual-ring", layer: "hero" },
      { mode: "axis-reflect", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.52, script: "braid-lane", purpose: "path-node", layer: "support" },
    );
  }
  if (has("episode-kaleido-shear")) {
    behaviors.push({ mode: "kaleido-shear", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.82, driftScale: 0.68, script: "signal-drift", purpose: "support-wake", layer: "support" });
  }
  if (has("episode-paired-braid")) {
    behaviors.push({ mode: "paired-braid", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.64, driftScale: 0.58, script: "braid-lane", purpose: "path-node", layer: "support" });
  }
  if (has("episode-prism-well")) {
    behaviors.push({ mode: "prism-well", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.76, driftScale: 0.42, script: "orbit-anchor", purpose: "ritual-ring", layer: "hero", behaviorTuning: { gravityStrength: 0.16 } });
  }
  const motifId = `motif-${sceneGraph.heroMotifScheduled ?? sceneGraph.sourceMotif ?? "glass-orbital"}`;
  if (has(motifId)) {
    switch (sceneGraph.heroMotifScheduled ?? sceneGraph.sourceMotif) {
      case "halo-cell":
        behaviors.push(
          { mode: "flock-curl", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.74, driftScale: 0.6, script: "follow-hero", purpose: "hero-wake", layer: "hero", behaviorTuning: { neighborRadius: 54, cohesion: 0.05, alignment: 0.08, separation: 0.12 } },
          { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.54, driftScale: 0.44, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.1 } },
        );
        break;
      case "smoke-ribbon":
        behaviors.push(
          { mode: "flow-advect", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.86, driftScale: 0.76, script: "signal-drift", purpose: "hero-wake", layer: "hero" },
          { mode: "ribbon-trace", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.68, script: "emit-chain", purpose: "support-wake", layer: "support" },
          { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.52, driftScale: 0.48, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.1 } },
        );
        break;
      case "glass-orbital":
        behaviors.push(
          { mode: "gravity-orrery", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.94, driftScale: 0.4, script: "orbit-anchor", purpose: "ritual-ring", layer: "support", behaviorTuning: { gravityStrength: 0.18 } },
          { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.78, driftScale: 0.62, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.72 } },
        );
        break;
      case "data-cathedral":
        behaviors.push(
          { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.5, script: "emit-chain", purpose: "path-node", layer: "support" },
          { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.48, script: "braid-lane", purpose: "ambient-fog", layer: "background", behaviorTuning: { linkRadius: 88 } },
          { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.72, driftScale: 0.52, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.68 } },
        );
        break;
      case "harmonic-lattice":
        behaviors.push(
          { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.6, driftScale: 0.46, script: "braid-lane", purpose: "path-node", layer: "support", behaviorTuning: { linkRadius: 82 } },
          { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.42, script: "emit-chain", purpose: "hero-wake", layer: "hero" },
          { mode: "voxel-depth", shape: "voxel", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.5, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { depthScale: 0.64 } },
        );
        break;
      case "film-bloom-shard":
        behaviors.push(
          { mode: "lifecycle-morph", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.74, driftScale: 0.7, script: "release-bloom", purpose: "burst-remnant", layer: "support", behaviorTuning: { morphProfile: "shard-to-teardrop" } },
          { mode: "shell-bounce", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.7, driftScale: 0.8, script: "burst-falloff", purpose: "burst-remnant", layer: "background", behaviorTuning: { bounceDamping: 0.78 } },
          { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.48, driftScale: 0.42, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.11 } },
        );
        break;
      case "shattered-arc":
        behaviors.push(
          { mode: "shell-bounce", shape: "shard", targetA: 0, targetB: 0, orbitScale: 0.76, driftScale: 0.78, script: "burst-falloff", purpose: "burst-remnant", layer: "hero", behaviorTuning: { bounceDamping: 0.74 } },
          { mode: "gravity-orrery", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.62, script: "dual-well", purpose: "support-wake", layer: "support", behaviorTuning: { gravityStrength: 0.22 } },
        );
        break;
      case "mandelbloom":
        behaviors.push(
          { mode: "flock-curl", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.88, driftScale: 0.62, script: "follow-hero", purpose: "hero-wake", layer: "hero", behaviorTuning: { neighborRadius: 62, cohesion: 0.06, alignment: 0.09, separation: 0.1 } },
          { mode: "lifecycle-morph", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.66, driftScale: 0.56, script: "release-bloom", purpose: "support-wake", layer: "support", behaviorTuning: { morphProfile: "diamond-to-shard" } },
        );
        break;
      case "chromatic-xylem":
        behaviors.push(
          { mode: "flow-advect", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.8, driftScale: 0.72, script: "signal-drift", purpose: "support-wake", layer: "support" },
          { mode: "paint-residue", shape: "dot", targetA: 0, targetB: 0, orbitScale: 0.46, driftScale: 0.38, script: "edge-fog", purpose: "ambient-fog", layer: "background", behaviorTuning: { residueAlpha: 0.09 } },
        );
        break;
      case "vector-incantation":
        behaviors.push(
          { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.68, driftScale: 0.46, script: "emit-chain", purpose: "path-node", layer: "support" },
          { mode: "plexus-link", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.44, script: "braid-lane", purpose: "hero-wake", layer: "hero", behaviorTuning: { linkRadius: 76 } },
        );
        break;
    }
  }
  if (sceneGraph.heroEmissionMode === "spine-fountain" || sceneGraph.heroEmissionMode === "orbit-shed") {
    behaviors.push({ mode: "ribbon-trace", shape: "arc", targetA: 0, targetB: 0, orbitScale: 0.68, driftScale: 0.72, script: "emit-chain", purpose: "hero-wake", layer: "hero" });
  }
  if (sceneGraph.heroEmissionMode === "crown-spray" || sceneGraph.heroEmissionMode === "mouth-flare" || sceneGraph.heroEmissionMode === "hand-cascade") {
    behaviors.push({ mode: "lifecycle-morph", shape: "diamond", targetA: 0, targetB: 0, orbitScale: 0.62, driftScale: 0.7, script: "release-bloom", purpose: "burst-remnant", layer: "hero", behaviorTuning: { morphProfile: "diamond-to-shard" } });
  }
  if (sceneGraph.subEmitterMode === "echo-ring") {
    behaviors.push({ mode: "shell-bounce", shape: "ring", targetA: 0, targetB: 0, orbitScale: 0.88, driftScale: 0.42, script: "burst-falloff", purpose: "ritual-ring", layer: "hero", behaviorTuning: { bounceDamping: 0.82 } });
  }
  if (sceneGraph.subEmitterMode === "spark-fork" || sceneGraph.subEmitterMode === "mask-fracture") {
    behaviors.push(
      { mode: "plexus-link", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.58, driftScale: 0.48, script: "braid-lane", purpose: "path-node", layer: "support", behaviorTuning: { linkRadius: 72 } },
      { mode: "lightning-latch", shape: "chevron", targetA: 0, targetB: 0, orbitScale: 0.64, driftScale: 0.5, script: "emit-chain", purpose: "burst-remnant", layer: "hero" },
    );
  }
  return behaviors;
}
