import { clamp } from "../config";
import { classifyHeroMotifIntensity } from "../types";
import type {
  BackgroundElementSpec,
  BackgroundFamilyVariant,
  BackgroundImageResponseMode,
  BackgroundInteractionMode,
  BackgroundTriggerMode,
  FractalMotif,
  RenderTheme,
} from "../types";
import { seedToUnitFloat, stableHash32 } from "./seed-utils";

const ALL_REFS = [
  "Flying Lotus",
  "Chris Cunningham",
  "Refik Anadol",
  "SOPHIE",
  "Jonathan Glazer",
  "Ian Cheng",
  "Amon Tobin",
  "Alva Noto",
  "Olafur Eliasson",
  "Rene Laloux",
  "Michel Gondry",
  "Holly Herndon",
  "Oneohtrix Point Never",
  "Peter Greenaway",
  "Goichi Suda",
  "Panos Cosmatos",
  "Jenny Holzer",
  "Thomas Pynchon",
  "Laurie Anderson",
  "Dan Flavin",
  "Hiro Murai",
  "Keita Takahashi",
  "Don Hertzfeldt",
  "David OReilly",
  "Boards of Canada",
] as const;

type SpecMeta = {
  interactionMode: BackgroundInteractionMode;
  triggerMode: BackgroundTriggerMode;
  imageResponseMode: BackgroundImageResponseMode;
  familyVariant: BackgroundFamilyVariant;
  heroCouplingStrength: number;
  particleCouplingStrength: number;
  triggerCooldownBeats: number;
  supportsHeroCluster?: boolean;
  supportsHeroParticles?: boolean;
  hazeAssist?: boolean;
};

function phrase(value: string): string {
  return value.replace(/-/g, " ");
}

function continuityPolicyForMeta(meta: SpecMeta): BackgroundElementSpec["continuityPolicy"] {
  if (meta.triggerMode === "collision" || meta.triggerMode === "silhouette-strobe" || meta.triggerMode === "crescendo") {
    return "punctuation";
  }
  if (meta.triggerMode === "interval" || meta.triggerMode === "four-bar") {
    return "rotate";
  }
  if (meta.heroCouplingStrength >= 0.72) {
    return "swap-friendly";
  }
  return "hold-friendly";
}

function eligibilityForSpec(
  supportedMotifs: FractalMotif[],
  fallbackMotifs: FractalMotif[],
  meta: SpecMeta,
): BackgroundElementSpec["eligibility"] {
  return {
    motifs: [...new Set([...supportedMotifs, ...fallbackMotifs])],
    regimes: ["intro", "groove", "build", "drop", "breakdown", "outro"],
    arcs:
      meta.triggerMode === "collision" || meta.triggerMode === "crescendo"
        ? ["punctuate", "swap"]
        : meta.triggerMode === "interval" || meta.triggerMode === "four-bar"
          ? ["mixed", "hold"]
          : ["hold", "mixed"],
  };
}

function pitchForSpec(family: BackgroundElementSpec["family"], familyVariant: BackgroundFamilyVariant): string {
  return `A ${phrase(familyVariant)} ${phrase(family)} background concept that keeps support motion readable without taking the frame away from the hero.`;
}

function distinctionForSpec(meta: SpecMeta): string {
  return `It stands apart through ${phrase(meta.triggerMode)} triggering, ${phrase(meta.interactionMode)} coupling, and ${phrase(meta.imageResponseMode)} image response.`;
}

function spec(
  id: BackgroundElementSpec["id"],
  family: BackgroundElementSpec["family"],
  supportedMotifs: FractalMotif[],
  fallbackMotifs: FractalMotif[],
  continuityCategory: BackgroundElementSpec["continuityCategory"],
  geometryDefaults: BackgroundElementSpec["geometryDefaults"],
  motionDefaults: BackgroundElementSpec["motionDefaults"],
  hzColorBehavior: BackgroundElementSpec["hzColorBehavior"],
  pulseBehavior: BackgroundElementSpec["pulseBehavior"],
  motifAffinity: number,
  meta: SpecMeta,
  selectionWeight = 1,
): BackgroundElementSpec {
  return {
    id,
    family,
    supportedMotifs,
    fallbackMotifs,
    continuityCategory,
    geometryDefaults,
    motionDefaults,
    hzColorBehavior,
    pulseBehavior,
    motifAffinity,
    densityBudget: geometryDefaults.density,
    interactionMode: meta.interactionMode,
    triggerMode: meta.triggerMode,
    imageResponseMode: meta.imageResponseMode,
    familyVariant: meta.familyVariant,
    heroCouplingStrength: meta.heroCouplingStrength,
    particleCouplingStrength: meta.particleCouplingStrength,
    triggerCooldownBeats: meta.triggerCooldownBeats,
    supportsHeroCluster: meta.supportsHeroCluster ?? meta.heroCouplingStrength > 0.5,
    supportsHeroParticles: meta.supportsHeroParticles ?? meta.particleCouplingStrength > 0.2,
    selectionWeight,
    hazeAssist: meta.hazeAssist,
    influenceRefs: [...ALL_REFS],
    pitch: pitchForSpec(family, meta.familyVariant),
    distinction: distinctionForSpec(meta),
    eligibility: eligibilityForSpec(supportedMotifs, fallbackMotifs, meta),
    continuityPolicy: continuityPolicyForMeta(meta),
    runtimeTuning: {
      densityScale: geometryDefaults.density,
      heroCouplingScale: meta.heroCouplingStrength,
      particleCouplingScale: meta.particleCouplingStrength,
      triggerCooldownScale: meta.triggerCooldownBeats,
      supportsMute: true,
      disableSilhouetteOnLowMask: meta.imageResponseMode === "silhouette" || meta.triggerMode === "silhouette-strobe",
      disablePathPredictionOnWeakComposition: meta.interactionMode === "hero-path-predictive",
    },
  };
}

const glitchMotifs: FractalMotif[] = ["neon-tube", "vector-incantation", "harmonic-lattice", "shattered-arc"];
const filmMotifs: FractalMotif[] = ["smoke-ribbon", "film-bloom-shard", "chromatic-xylem"];
const orbitalMotifs: FractalMotif[] = ["glass-orbital", "halo-cell", "mandelbloom"];
const cathedralMotifs: FractalMotif[] = ["cathedral-filament", "data-cathedral"];

const DEFAULT_META: SpecMeta = {
  interactionMode: "none",
  triggerMode: "beat",
  imageResponseMode: "palette",
  familyVariant: "default",
  heroCouplingStrength: 0,
  particleCouplingStrength: 0,
  triggerCooldownBeats: 2,
};

const old = (meta: Partial<SpecMeta>): SpecMeta => ({ ...DEFAULT_META, ...meta });

export const BACKGROUND_ELEMENT_SPECS: BackgroundElementSpec[] = [
  spec("flickering-chevron-floor-patterns", "stripe-field", ["neon-tube", "vector-incantation"], ["harmonic-lattice"], "glitch", { count: 18, spacing: 0.12, thickness: 0.028, depth: 0.42, scaleVariance: 0.24, symmetry: 0.72, density: 0.82 }, { driftScale: 0.18, jitterScale: 0.1, rotationScale: 0.08, expansionScale: 0.16, phaseRate: 0.9 }, { subLow: 0.3, low: 0.9, mid: 0.6, highMid: 0.5, high: 0.75 }, { beatPulseStrength: 0.96, barPulseStrength: 0.72, betweenBeatBreathing: 0.36, flickerAmount: 0.24 }, 1.12, old({ familyVariant: "floor-tiles", imageResponseMode: "contrast" })),
  spec("twitching-glitch-rectangles", "grid-field", ["shattered-arc", "vector-incantation"], ["neon-tube", "harmonic-lattice"], "glitch", { count: 22, spacing: 0.08, thickness: 0.02, depth: 0.5, scaleVariance: 0.32, symmetry: 0.44, density: 0.86 }, { driftScale: 0.14, jitterScale: 0.24, rotationScale: 0.04, expansionScale: 0.12, phaseRate: 1.22 }, { subLow: 0.18, low: 0.42, mid: 0.72, highMid: 0.92, high: 1.08 }, { beatPulseStrength: 0.88, barPulseStrength: 0.68, betweenBeatBreathing: 0.24, flickerAmount: 0.52 }, 1.16, old({ interactionMode: "hero-proximity", heroCouplingStrength: 0.34, imageResponseMode: "contrast" })),
  spec("rhythmic-wireframe-cube-swarms", "primitive-swarm", ["data-cathedral", "cathedral-filament"], ["harmonic-lattice"], "architectural", { count: 14, spacing: 0.16, thickness: 0.018, depth: 0.76, scaleVariance: 0.42, symmetry: 0.66, density: 0.68 }, { driftScale: 0.1, jitterScale: 0.06, rotationScale: 0.32, expansionScale: 0.18, phaseRate: 0.62 }, { subLow: 0.54, low: 0.82, mid: 0.66, highMid: 0.44, high: 0.38 }, { beatPulseStrength: 0.64, barPulseStrength: 0.82, betweenBeatBreathing: 0.42, flickerAmount: 0.14 }, 1.08, old({ imageResponseMode: "density", hazeAssist: true })),
  spec("hand-scratched-emulsion-lines", "line-field", ["film-bloom-shard", "smoke-ribbon"], ["chromatic-xylem"], "organic", { count: 28, spacing: 0.06, thickness: 0.012, depth: 0.34, scaleVariance: 0.48, symmetry: 0.22, density: 0.78 }, { driftScale: 0.22, jitterScale: 0.18, rotationScale: 0.12, expansionScale: 0.08, phaseRate: 0.84 }, { subLow: 0.28, low: 0.38, mid: 0.72, highMid: 0.94, high: 1 }, { beatPulseStrength: 0.58, barPulseStrength: 0.52, betweenBeatBreathing: 0.58, flickerAmount: 0.4 }, 1.12, old({ familyVariant: "emulsion-slashes", imageResponseMode: "contour" })),
  spec("high-frequency-barcode-stripes", "stripe-field", ["harmonic-lattice", "data-cathedral"], ["neon-tube", "vector-incantation"], "architectural", { count: 30, spacing: 0.05, thickness: 0.014, depth: 0.24, scaleVariance: 0.12, symmetry: 0.9, density: 0.9 }, { driftScale: 0.08, jitterScale: 0.16, rotationScale: 0.02, expansionScale: 0.06, phaseRate: 1.28 }, { subLow: 0.16, low: 0.44, mid: 0.72, highMid: 0.92, high: 1.1 }, { beatPulseStrength: 0.76, barPulseStrength: 0.68, betweenBeatBreathing: 0.22, flickerAmount: 0.46 }, 1.1, old({ familyVariant: "strobing-scanlines", imageResponseMode: "contrast" })),
  spec("intersecting-crystalline-triangles", "sigil-field", ["cathedral-filament", "harmonic-lattice"], ["data-cathedral", "glass-orbital"], "architectural", { count: 16, spacing: 0.14, thickness: 0.018, depth: 0.62, scaleVariance: 0.28, symmetry: 0.78, density: 0.72 }, { driftScale: 0.12, jitterScale: 0.08, rotationScale: 0.16, expansionScale: 0.14, phaseRate: 0.76 }, { subLow: 0.34, low: 0.7, mid: 0.84, highMid: 0.56, high: 0.42 }, { beatPulseStrength: 0.68, barPulseStrength: 0.82, betweenBeatBreathing: 0.36, flickerAmount: 0.16 }, 1.06, old({ familyVariant: "orbiting-tetrahedrons", heroCouplingStrength: 0.28, imageResponseMode: "symmetry", hazeAssist: true })),
  spec("slowly-expanding-heavy-spheres", "primitive-swarm", ["glass-orbital", "halo-cell"], ["mandelbloom"], "orbital", { count: 10, spacing: 0.22, thickness: 0.02, depth: 0.82, scaleVariance: 0.24, symmetry: 0.54, density: 0.56 }, { driftScale: 0.08, jitterScale: 0.02, rotationScale: 0.04, expansionScale: 0.32, phaseRate: 0.38 }, { subLow: 1, low: 0.82, mid: 0.42, highMid: 0.18, high: 0.12 }, { beatPulseStrength: 0.72, barPulseStrength: 0.86, betweenBeatBreathing: 0.68, flickerAmount: 0.08 }, 1.02, old({ familyVariant: "void-spheres", imageResponseMode: "palette", hazeAssist: true })),
  spec("jittering-minimalist-angles", "line-field", ["shattered-arc", "vector-incantation"], ["film-bloom-shard"], "glitch", { count: 20, spacing: 0.1, thickness: 0.018, depth: 0.28, scaleVariance: 0.3, symmetry: 0.3, density: 0.74 }, { driftScale: 0.16, jitterScale: 0.22, rotationScale: 0.12, expansionScale: 0.08, phaseRate: 1.04 }, { subLow: 0.18, low: 0.36, mid: 0.8, highMid: 0.9, high: 0.96 }, { beatPulseStrength: 0.8, barPulseStrength: 0.58, betweenBeatBreathing: 0.26, flickerAmount: 0.38 }, 1.1, old({ imageResponseMode: "contour" })),
  spec("slowly-overlapping-ambient-planes", "plane-field", ["smoke-ribbon", "film-bloom-shard"], ["glass-orbital"], "organic", { count: 8, spacing: 0.26, thickness: 0.06, depth: 0.7, scaleVariance: 0.18, symmetry: 0.42, density: 0.48 }, { driftScale: 0.14, jitterScale: 0.04, rotationScale: 0.08, expansionScale: 0.22, phaseRate: 0.44 }, { subLow: 0.72, low: 0.62, mid: 0.46, highMid: 0.28, high: 0.14 }, { beatPulseStrength: 0.42, barPulseStrength: 0.64, betweenBeatBreathing: 0.74, flickerAmount: 0.06 }, 1, old({ familyVariant: "echo-boxes", triggerMode: "interval", imageResponseMode: "palette", hazeAssist: true })),
  spec("suspended-tension-circles-and-diagonals", "ring-field", ["glass-orbital", "mandelbloom"], ["halo-cell", "cathedral-filament"], "ritual", { count: 16, spacing: 0.16, thickness: 0.014, depth: 0.48, scaleVariance: 0.22, symmetry: 0.8, density: 0.7 }, { driftScale: 0.1, jitterScale: 0.06, rotationScale: 0.14, expansionScale: 0.14, phaseRate: 0.68 }, { subLow: 0.44, low: 0.62, mid: 0.86, highMid: 0.52, high: 0.3 }, { beatPulseStrength: 0.6, barPulseStrength: 0.72, betweenBeatBreathing: 0.46, flickerAmount: 0.14 }, 1.08, old({ familyVariant: "orbiting-rings", heroCouplingStrength: 0.24, imageResponseMode: "symmetry" })),
  spec("looming-monolithic-cylinders", "primitive-swarm", ["cathedral-filament", "data-cathedral"], ["glass-orbital"], "architectural", { count: 9, spacing: 0.24, thickness: 0.024, depth: 0.88, scaleVariance: 0.16, symmetry: 0.62, density: 0.52 }, { driftScale: 0.08, jitterScale: 0.04, rotationScale: 0.1, expansionScale: 0.18, phaseRate: 0.4 }, { subLow: 0.9, low: 0.76, mid: 0.44, highMid: 0.24, high: 0.12 }, { beatPulseStrength: 0.56, barPulseStrength: 0.84, betweenBeatBreathing: 0.48, flickerAmount: 0.08 }, 1.04, old({ familyVariant: "shadow-cylinders", triggerMode: "bar", imageResponseMode: "contrast", hazeAssist: true })),
  spec("fractured-cut-up-grid-squares", "grid-field", ["film-bloom-shard", "shattered-arc"], ["vector-incantation"], "glitch", { count: 20, spacing: 0.09, thickness: 0.02, depth: 0.44, scaleVariance: 0.34, symmetry: 0.38, density: 0.8 }, { driftScale: 0.12, jitterScale: 0.2, rotationScale: 0.04, expansionScale: 0.1, phaseRate: 1.08 }, { subLow: 0.2, low: 0.38, mid: 0.66, highMid: 0.9, high: 1.02 }, { beatPulseStrength: 0.74, barPulseStrength: 0.66, betweenBeatBreathing: 0.22, flickerAmount: 0.44 }, 1.14, old({ imageResponseMode: "contrast" })),
  spec("stacked-crt-static-blocks", "grid-field", ["film-bloom-shard", "harmonic-lattice"], ["data-cathedral", "shattered-arc"], "glitch", { count: 24, spacing: 0.07, thickness: 0.024, depth: 0.38, scaleVariance: 0.18, symmetry: 0.64, density: 0.84 }, { driftScale: 0.06, jitterScale: 0.26, rotationScale: 0.02, expansionScale: 0.08, phaseRate: 1.34 }, { subLow: 0.12, low: 0.28, mid: 0.62, highMid: 0.88, high: 1.14 }, { beatPulseStrength: 0.82, barPulseStrength: 0.54, betweenBeatBreathing: 0.16, flickerAmount: 0.58 }, 1.16, old({ familyVariant: "strobing-scanlines", triggerMode: "silhouette-strobe", imageResponseMode: "contrast" })),
  spec("hyper-dimensional-geometric-sigils", "sigil-field", ["vector-incantation", "harmonic-lattice"], ["data-cathedral", "mandelbloom"], "ritual", { count: 14, spacing: 0.14, thickness: 0.016, depth: 0.56, scaleVariance: 0.3, symmetry: 0.86, density: 0.68 }, { driftScale: 0.1, jitterScale: 0.08, rotationScale: 0.22, expansionScale: 0.18, phaseRate: 0.72 }, { subLow: 0.3, low: 0.54, mid: 0.88, highMid: 0.76, high: 0.62 }, { beatPulseStrength: 0.66, barPulseStrength: 0.74, betweenBeatBreathing: 0.34, flickerAmount: 0.2 }, 1.1, old({ familyVariant: "predictive-polygons", interactionMode: "hero-path-predictive", heroCouplingStrength: 0.32, imageResponseMode: "symmetry" })),
  spec("asymmetrical-bio-mechanical-spikes", "sigil-field", ["shattered-arc", "chromatic-xylem"], ["film-bloom-shard"], "organic", { count: 17, spacing: 0.12, thickness: 0.02, depth: 0.5, scaleVariance: 0.36, symmetry: 0.2, density: 0.76 }, { driftScale: 0.14, jitterScale: 0.18, rotationScale: 0.16, expansionScale: 0.14, phaseRate: 0.94 }, { subLow: 0.34, low: 0.56, mid: 0.64, highMid: 0.78, high: 0.86 }, { beatPulseStrength: 0.72, barPulseStrength: 0.62, betweenBeatBreathing: 0.28, flickerAmount: 0.32 }, 1.08, old({ imageResponseMode: "contour" })),
  spec("symmetrical-elliptical-tracks", "ring-field", ["glass-orbital", "halo-cell"], ["mandelbloom"], "orbital", { count: 12, spacing: 0.18, thickness: 0.014, depth: 0.52, scaleVariance: 0.16, symmetry: 0.94, density: 0.64 }, { driftScale: 0.08, jitterScale: 0.04, rotationScale: 0.12, expansionScale: 0.16, phaseRate: 0.58 }, { subLow: 0.48, low: 0.66, mid: 0.82, highMid: 0.38, high: 0.22 }, { beatPulseStrength: 0.58, barPulseStrength: 0.7, betweenBeatBreathing: 0.52, flickerAmount: 0.12 }, 1.06, old({ familyVariant: "orbiting-rings", heroCouplingStrength: 0.24, imageResponseMode: "symmetry" })),
  spec("synchronized-falling-diamonds", "primitive-swarm", ["mandelbloom", "halo-cell"], ["glass-orbital", "harmonic-lattice"], "orbital", { count: 18, spacing: 0.12, thickness: 0.016, depth: 0.48, scaleVariance: 0.24, symmetry: 0.7, density: 0.74 }, { driftScale: 0.12, jitterScale: 0.08, rotationScale: 0.18, expansionScale: 0.12, phaseRate: 0.88 }, { subLow: 0.3, low: 0.48, mid: 0.84, highMid: 0.7, high: 0.44 }, { beatPulseStrength: 0.78, barPulseStrength: 0.64, betweenBeatBreathing: 0.3, flickerAmount: 0.18 }, 1.08, old({ familyVariant: "trailing-prisms", imageResponseMode: "density" })),
  spec("aleatoric-scattered-tension-dots", "ring-field", ["smoke-ribbon", "mandelbloom"], ["halo-cell", "film-bloom-shard"], "organic", { count: 26, spacing: 0.06, thickness: 0.012, depth: 0.22, scaleVariance: 0.4, symmetry: 0.18, density: 0.82 }, { driftScale: 0.16, jitterScale: 0.14, rotationScale: 0.04, expansionScale: 0.1, phaseRate: 1 }, { subLow: 0.22, low: 0.38, mid: 0.72, highMid: 0.82, high: 0.88 }, { beatPulseStrength: 0.62, barPulseStrength: 0.48, betweenBeatBreathing: 0.42, flickerAmount: 0.3 }, 1.04, old({ familyVariant: "swelling-polka-dots", imageResponseMode: "palette" })),
  spec("algorithmic-metallic-polyhedrons", "primitive-swarm", ["data-cathedral", "harmonic-lattice"], ["cathedral-filament", "vector-incantation"], "architectural", { count: 12, spacing: 0.18, thickness: 0.018, depth: 0.72, scaleVariance: 0.28, symmetry: 0.62, density: 0.62 }, { driftScale: 0.1, jitterScale: 0.06, rotationScale: 0.24, expansionScale: 0.14, phaseRate: 0.66 }, { subLow: 0.52, low: 0.7, mid: 0.78, highMid: 0.46, high: 0.3 }, { beatPulseStrength: 0.68, barPulseStrength: 0.8, betweenBeatBreathing: 0.34, flickerAmount: 0.14 }, 1.1, old({ imageResponseMode: "density", hazeAssist: true })),
  spec("sharp-luminous-trapezoidal-voids", "void-shape", ["neon-tube", "harmonic-lattice"], ["vector-incantation", "shattered-arc"], "ritual", { count: 8, spacing: 0.3, thickness: 0.08, depth: 0.64, scaleVariance: 0.2, symmetry: 0.56, density: 0.44 }, { driftScale: 0.06, jitterScale: 0.08, rotationScale: 0.1, expansionScale: 0.24, phaseRate: 0.48 }, { subLow: 0.68, low: 0.74, mid: 0.56, highMid: 0.48, high: 0.6 }, { beatPulseStrength: 0.54, barPulseStrength: 0.7, betweenBeatBreathing: 0.46, flickerAmount: 0.16 }, 1.06, old({ familyVariant: "void-spheres", interactionMode: "hero-proximity", heroCouplingStrength: 0.28 })),
  spec("stark-pixelated-punishment-blocks", "grid-field", ["shattered-arc"], ["vector-incantation", "film-bloom-shard"], "glitch", { count: 18, spacing: 0.08, thickness: 0.032, depth: 0.32, scaleVariance: 0.14, symmetry: 0.52, density: 0.82 }, { driftScale: 0.08, jitterScale: 0.22, rotationScale: 0.02, expansionScale: 0.1, phaseRate: 1.18 }, { subLow: 0.24, low: 0.5, mid: 0.7, highMid: 0.84, high: 0.96 }, { beatPulseStrength: 0.86, barPulseStrength: 0.64, betweenBeatBreathing: 0.2, flickerAmount: 0.5 }, 1.16, old({ imageResponseMode: "contrast" })),
  spec("concentric-mystical-spirals", "ring-field", ["mandelbloom", "glass-orbital"], ["halo-cell", "cathedral-filament"], "ritual", { count: 10, spacing: 0.22, thickness: 0.014, depth: 0.58, scaleVariance: 0.18, symmetry: 0.88, density: 0.58 }, { driftScale: 0.08, jitterScale: 0.04, rotationScale: 0.2, expansionScale: 0.2, phaseRate: 0.64 }, { subLow: 0.42, low: 0.6, mid: 0.86, highMid: 0.56, high: 0.28 }, { beatPulseStrength: 0.62, barPulseStrength: 0.76, betweenBeatBreathing: 0.52, flickerAmount: 0.12 }, 1.08, old({ familyVariant: "orbiting-rings", imageResponseMode: "symmetry" })),
  spec("endless-obliterating-polka-dots", "ring-field", ["halo-cell", "mandelbloom"], ["glass-orbital", "smoke-ribbon"], "orbital", { count: 28, spacing: 0.06, thickness: 0.014, depth: 0.18, scaleVariance: 0.26, symmetry: 0.74, density: 0.88 }, { driftScale: 0.12, jitterScale: 0.1, rotationScale: 0.02, expansionScale: 0.18, phaseRate: 0.92 }, { subLow: 0.18, low: 0.44, mid: 0.82, highMid: 0.64, high: 0.42 }, { beatPulseStrength: 0.84, barPulseStrength: 0.58, betweenBeatBreathing: 0.36, flickerAmount: 0.22 }, 1.08, old({ familyVariant: "swelling-polka-dots", imageResponseMode: "palette" })),
  spec("uncanny-floating-digital-primitives", "primitive-swarm", ["harmonic-lattice", "mandelbloom"], ["glass-orbital", "data-cathedral"], "orbital", { count: 16, spacing: 0.14, thickness: 0.018, depth: 0.54, scaleVariance: 0.36, symmetry: 0.48, density: 0.7 }, { driftScale: 0.12, jitterScale: 0.1, rotationScale: 0.18, expansionScale: 0.14, phaseRate: 0.78 }, { subLow: 0.28, low: 0.5, mid: 0.8, highMid: 0.7, high: 0.58 }, { beatPulseStrength: 0.74, barPulseStrength: 0.62, betweenBeatBreathing: 0.32, flickerAmount: 0.2 }, 1.06, old({ imageResponseMode: "palette" })),
  spec("phasing-rhythmic-pendulum-arcs", "line-field", ["cathedral-filament", "glass-orbital"], ["smoke-ribbon", "harmonic-lattice"], "ritual", { count: 14, spacing: 0.18, thickness: 0.016, depth: 0.42, scaleVariance: 0.18, symmetry: 0.82, density: 0.62 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.22, expansionScale: 0.12, phaseRate: 0.72 }, { subLow: 0.5, low: 0.62, mid: 0.72, highMid: 0.46, high: 0.34 }, { beatPulseStrength: 0.7, barPulseStrength: 0.74, betweenBeatBreathing: 0.44, flickerAmount: 0.12 }, 1.02, old({ familyVariant: "metronomic-pendulums", interactionMode: "hero-proximity", heroCouplingStrength: 0.26 })),
  spec("beat-reactive-repelling-pyramids", "primitive-swarm", ["neon-tube", "shattered-arc"], ["vector-incantation"], "glitch", { count: 15, spacing: 0.13, thickness: 0.018, depth: 0.58, scaleVariance: 0.24, symmetry: 0.58, density: 0.76 }, { driftScale: 0.14, jitterScale: 0.16, rotationScale: 0.22, expansionScale: 0.18, phaseRate: 1.02 }, { subLow: 0.42, low: 0.84, mid: 0.72, highMid: 0.56, high: 0.48 }, { beatPulseStrength: 1, barPulseStrength: 0.64, betweenBeatBreathing: 0.24, flickerAmount: 0.2 }, 1.2, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "beat", imageResponseMode: "contrast", familyVariant: "repelling-pyramids", heroCouplingStrength: 0.82, particleCouplingStrength: 0.2, triggerCooldownBeats: 1 }),
  spec("proximity-glitching-wireframe-polygons", "sigil-field", ["vector-incantation", "harmonic-lattice"], ["shattered-arc"], "glitch", { count: 16, spacing: 0.14, thickness: 0.014, depth: 0.5, scaleVariance: 0.32, symmetry: 0.7, density: 0.68 }, { driftScale: 0.1, jitterScale: 0.22, rotationScale: 0.18, expansionScale: 0.12, phaseRate: 1.08 }, { subLow: 0.2, low: 0.48, mid: 0.86, highMid: 0.98, high: 0.92 }, { beatPulseStrength: 0.84, barPulseStrength: 0.6, betweenBeatBreathing: 0.18, flickerAmount: 0.48 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "wireframe-polygons", heroCouplingStrength: 0.78, particleCouplingStrength: 0.18, triggerCooldownBeats: 1 }),
  spec("phasing-concentric-rings-orbiting-hero", "ring-field", ["glass-orbital", "halo-cell"], ["cathedral-filament"], "orbital", { count: 14, spacing: 0.16, thickness: 0.014, depth: 0.62, scaleVariance: 0.18, symmetry: 0.92, density: 0.7 }, { driftScale: 0.08, jitterScale: 0.04, rotationScale: 0.18, expansionScale: 0.22, phaseRate: 0.72 }, { subLow: 0.36, low: 0.56, mid: 0.86, highMid: 0.6, high: 0.28 }, { beatPulseStrength: 0.76, barPulseStrength: 0.78, betweenBeatBreathing: 0.44, flickerAmount: 0.1 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "beat", imageResponseMode: "symmetry", familyVariant: "orbiting-rings", heroCouplingStrength: 0.92, particleCouplingStrength: 0.12, triggerCooldownBeats: 1 }),
  spec("interval-fading-silhouette-rectangles", "grid-field", ["smoke-ribbon", "film-bloom-shard"], ["harmonic-lattice"], "organic", { count: 18, spacing: 0.1, thickness: 0.022, depth: 0.36, scaleVariance: 0.22, symmetry: 0.44, density: 0.7 }, { driftScale: 0.08, jitterScale: 0.1, rotationScale: 0.02, expansionScale: 0.1, phaseRate: 0.52 }, { subLow: 0.22, low: 0.42, mid: 0.74, highMid: 0.66, high: 0.34 }, { beatPulseStrength: 0.48, barPulseStrength: 0.64, betweenBeatBreathing: 0.58, flickerAmount: 0.18 }, 1.12, { ...DEFAULT_META, triggerMode: "interval", imageResponseMode: "silhouette", familyVariant: "silhouette-rectangles", heroCouplingStrength: 0.1, particleCouplingStrength: 0, triggerCooldownBeats: 2 }),
  spec("hero-synchronized-breathing-triangles", "ring-field", ["halo-cell", "glass-orbital"], ["mandelbloom", "chromatic-xylem"], "orbital", { count: 12, spacing: 0.18, thickness: 0.016, depth: 0.5, scaleVariance: 0.16, symmetry: 0.82, density: 0.64 }, { driftScale: 0.08, jitterScale: 0.04, rotationScale: 0.14, expansionScale: 0.2, phaseRate: 0.66 }, { subLow: 0.32, low: 0.58, mid: 0.82, highMid: 0.52, high: 0.26 }, { beatPulseStrength: 0.68, barPulseStrength: 0.72, betweenBeatBreathing: 0.54, flickerAmount: 0.1 }, 1.12, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "beat", imageResponseMode: "palette", familyVariant: "breathing-triangles", heroCouplingStrength: 0.84, particleCouplingStrength: 0.06, triggerCooldownBeats: 1 }),
  spec("tactile-swelling-polka-dots", "ring-field", ["halo-cell", "mandelbloom"], ["glass-orbital"], "orbital", { count: 28, spacing: 0.06, thickness: 0.014, depth: 0.22, scaleVariance: 0.32, symmetry: 0.66, density: 0.9 }, { driftScale: 0.1, jitterScale: 0.08, rotationScale: 0.02, expansionScale: 0.24, phaseRate: 0.86 }, { subLow: 0.18, low: 0.4, mid: 0.76, highMid: 0.62, high: 0.34 }, { beatPulseStrength: 0.9, barPulseStrength: 0.58, betweenBeatBreathing: 0.42, flickerAmount: 0.14 }, 1.12, { ...DEFAULT_META, triggerMode: "beat", imageResponseMode: "palette", familyVariant: "swelling-polka-dots", heroCouplingStrength: 0.08, particleCouplingStrength: 0, triggerCooldownBeats: 1 }),
  spec("metronome-slicing-chevron-masks", "grid-field", ["neon-tube", "shattered-arc"], ["harmonic-lattice"], "glitch", { count: 16, spacing: 0.11, thickness: 0.028, depth: 0.46, scaleVariance: 0.18, symmetry: 0.72, density: 0.78 }, { driftScale: 0.12, jitterScale: 0.14, rotationScale: 0.08, expansionScale: 0.1, phaseRate: 1.18 }, { subLow: 0.28, low: 0.72, mid: 0.78, highMid: 0.72, high: 0.64 }, { beatPulseStrength: 0.88, barPulseStrength: 0.7, betweenBeatBreathing: 0.24, flickerAmount: 0.22 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "beat", imageResponseMode: "silhouette", familyVariant: "chevron-masks", heroCouplingStrength: 0.74, particleCouplingStrength: 0.08, triggerCooldownBeats: 1 }),
  spec("periodically-resetting-physics-cubes", "primitive-swarm", ["data-cathedral"], ["harmonic-lattice", "vector-incantation"], "architectural", { count: 14, spacing: 0.16, thickness: 0.018, depth: 0.72, scaleVariance: 0.28, symmetry: 0.64, density: 0.68 }, { driftScale: 0.08, jitterScale: 0.12, rotationScale: 0.2, expansionScale: 0.14, phaseRate: 0.78 }, { subLow: 0.48, low: 0.74, mid: 0.72, highMid: 0.46, high: 0.28 }, { beatPulseStrength: 0.56, barPulseStrength: 0.7, betweenBeatBreathing: 0.28, flickerAmount: 0.14 }, 1.16, { ...DEFAULT_META, triggerMode: "four-bar", imageResponseMode: "density", familyVariant: "physics-cubes", heroCouplingStrength: 0.14, particleCouplingStrength: 0, triggerCooldownBeats: 4 }),
  spec("crescendo-expanding-octagon-enclosures", "sigil-field", ["mandelbloom", "cathedral-filament"], ["glass-orbital"], "ritual", { count: 10, spacing: 0.2, thickness: 0.02, depth: 0.62, scaleVariance: 0.16, symmetry: 0.88, density: 0.58 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.12, expansionScale: 0.28, phaseRate: 0.62 }, { subLow: 0.46, low: 0.62, mid: 0.82, highMid: 0.5, high: 0.26 }, { beatPulseStrength: 0.64, barPulseStrength: 0.86, betweenBeatBreathing: 0.42, flickerAmount: 0.1 }, 1.14, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "crescendo", imageResponseMode: "density", familyVariant: "octagon-enclosures", heroCouplingStrength: 0.72, particleCouplingStrength: 0.08, triggerCooldownBeats: 2 }),
  spec("silhouette-distorting-strobing-scanlines", "grid-field", ["harmonic-lattice", "film-bloom-shard"], ["shattered-arc"], "glitch", { count: 26, spacing: 0.05, thickness: 0.012, depth: 0.24, scaleVariance: 0.1, symmetry: 0.84, density: 0.92 }, { driftScale: 0.06, jitterScale: 0.22, rotationScale: 0.01, expansionScale: 0.06, phaseRate: 1.3 }, { subLow: 0.12, low: 0.34, mid: 0.68, highMid: 0.92, high: 1.08 }, { beatPulseStrength: 0.78, barPulseStrength: 0.66, betweenBeatBreathing: 0.16, flickerAmount: 0.56 }, 1.18, { ...DEFAULT_META, triggerMode: "silhouette-strobe", imageResponseMode: "silhouette", familyVariant: "strobing-scanlines", heroCouplingStrength: 0.14, particleCouplingStrength: 0, triggerCooldownBeats: 1 }),
  spec("timer-aligned-random-cube-clusters", "primitive-swarm", ["data-cathedral"], ["harmonic-lattice"], "architectural", { count: 16, spacing: 0.14, thickness: 0.018, depth: 0.68, scaleVariance: 0.34, symmetry: 0.52, density: 0.72 }, { driftScale: 0.08, jitterScale: 0.14, rotationScale: 0.2, expansionScale: 0.12, phaseRate: 0.88 }, { subLow: 0.42, low: 0.68, mid: 0.74, highMid: 0.48, high: 0.34 }, { beatPulseStrength: 0.58, barPulseStrength: 0.68, betweenBeatBreathing: 0.24, flickerAmount: 0.12 }, 1.14, { ...DEFAULT_META, triggerMode: "countdown", imageResponseMode: "density", familyVariant: "random-cube-clusters", heroCouplingStrength: 0.12, particleCouplingStrength: 0, triggerCooldownBeats: 4 }),
  spec("delayed-collapse-shadow-cylinders", "void-shape", ["smoke-ribbon", "chromatic-xylem", "cathedral-filament"], ["data-cathedral"], "organic", { count: 9, spacing: 0.22, thickness: 0.048, depth: 0.72, scaleVariance: 0.18, symmetry: 0.5, density: 0.54 }, { driftScale: 0.06, jitterScale: 0.08, rotationScale: 0.1, expansionScale: 0.18, phaseRate: 0.46 }, { subLow: 0.76, low: 0.72, mid: 0.46, highMid: 0.24, high: 0.16 }, { beatPulseStrength: 0.42, barPulseStrength: 0.8, betweenBeatBreathing: 0.48, flickerAmount: 0.08 }, 1.1, { ...DEFAULT_META, triggerMode: "bar", imageResponseMode: "contrast", familyVariant: "shadow-cylinders", heroCouplingStrength: 0.12, particleCouplingStrength: 0, triggerCooldownBeats: 2, hazeAssist: true }),
  spec("staccato-emulsion-slashes-piercing-hero", "line-field", ["shattered-arc", "film-bloom-shard"], ["smoke-ribbon"], "glitch", { count: 18, spacing: 0.1, thickness: 0.016, depth: 0.4, scaleVariance: 0.34, symmetry: 0.3, density: 0.78 }, { driftScale: 0.14, jitterScale: 0.18, rotationScale: 0.24, expansionScale: 0.1, phaseRate: 1.1 }, { subLow: 0.22, low: 0.46, mid: 0.74, highMid: 0.9, high: 0.96 }, { beatPulseStrength: 0.9, barPulseStrength: 0.6, betweenBeatBreathing: 0.2, flickerAmount: 0.42 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-particle-collision", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "emulsion-slashes", heroCouplingStrength: 0.86, particleCouplingStrength: 0.74, triggerCooldownBeats: 1, supportsHeroParticles: true }),
  spec("hero-absorbing-pulsing-void-spheres", "void-shape", ["glass-orbital", "halo-cell"], ["smoke-ribbon"], "orbital", { count: 8, spacing: 0.24, thickness: 0.06, depth: 0.78, scaleVariance: 0.18, symmetry: 0.66, density: 0.46 }, { driftScale: 0.06, jitterScale: 0.06, rotationScale: 0.08, expansionScale: 0.28, phaseRate: 0.58 }, { subLow: 0.88, low: 0.74, mid: 0.48, highMid: 0.2, high: 0.12 }, { beatPulseStrength: 0.72, barPulseStrength: 0.84, betweenBeatBreathing: 0.5, flickerAmount: 0.08 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-particle-absorb", triggerMode: "collision", imageResponseMode: "palette", familyVariant: "void-spheres", heroCouplingStrength: 0.92, particleCouplingStrength: 0.84, triggerCooldownBeats: 1, supportsHeroParticles: true, hazeAssist: true }),
  spec("rhythmically-contracting-prismatic-frames", "plane-field", ["neon-tube", "harmonic-lattice", "vector-incantation"], ["mandelbloom"], "ritual", { count: 8, spacing: 0.26, thickness: 0.034, depth: 0.62, scaleVariance: 0.18, symmetry: 0.84, density: 0.5 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.1, expansionScale: 0.24, phaseRate: 0.8 }, { subLow: 0.34, low: 0.64, mid: 0.82, highMid: 0.58, high: 0.42 }, { beatPulseStrength: 0.74, barPulseStrength: 0.76, betweenBeatBreathing: 0.3, flickerAmount: 0.12 }, 1.14, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "bar", imageResponseMode: "symmetry", familyVariant: "prismatic-frames", heroCouplingStrength: 0.72, particleCouplingStrength: 0.1, triggerCooldownBeats: 2 }),
  spec("trajectory-predicting-polygon-clusters", "sigil-field", ["vector-incantation", "data-cathedral", "chromatic-xylem"], ["harmonic-lattice"], "architectural", { count: 14, spacing: 0.16, thickness: 0.014, depth: 0.56, scaleVariance: 0.34, symmetry: 0.6, density: 0.68 }, { driftScale: 0.1, jitterScale: 0.12, rotationScale: 0.18, expansionScale: 0.14, phaseRate: 0.9 }, { subLow: 0.26, low: 0.52, mid: 0.84, highMid: 0.76, high: 0.64 }, { beatPulseStrength: 0.72, barPulseStrength: 0.68, betweenBeatBreathing: 0.28, flickerAmount: 0.2 }, 1.2, { ...DEFAULT_META, interactionMode: "hero-path-predictive", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "predictive-polygons", heroCouplingStrength: 0.88, particleCouplingStrength: 0.58, triggerCooldownBeats: 1, supportsHeroParticles: true }),
  spec("time-delayed-echo-box-primitives", "plane-field", ["smoke-ribbon", "data-cathedral", "film-bloom-shard"], ["glass-orbital"], "organic", { count: 10, spacing: 0.22, thickness: 0.028, depth: 0.58, scaleVariance: 0.22, symmetry: 0.62, density: 0.54 }, { driftScale: 0.08, jitterScale: 0.1, rotationScale: 0.08, expansionScale: 0.18, phaseRate: 0.56 }, { subLow: 0.32, low: 0.54, mid: 0.76, highMid: 0.52, high: 0.36 }, { beatPulseStrength: 0.58, barPulseStrength: 0.72, betweenBeatBreathing: 0.44, flickerAmount: 0.14 }, 1.12, { ...DEFAULT_META, interactionMode: "hero-particle-collision", triggerMode: "four-bar", imageResponseMode: "palette", familyVariant: "echo-boxes", heroCouplingStrength: 0.42, particleCouplingStrength: 0.48, triggerCooldownBeats: 4, supportsHeroParticles: true }),
  spec("hero-targeted-orbiting-tetrahedrons", "primitive-swarm", ["vector-incantation", "glass-orbital"], ["mandelbloom"], "orbital", { count: 14, spacing: 0.15, thickness: 0.016, depth: 0.58, scaleVariance: 0.26, symmetry: 0.72, density: 0.7 }, { driftScale: 0.1, jitterScale: 0.08, rotationScale: 0.22, expansionScale: 0.14, phaseRate: 0.86 }, { subLow: 0.28, low: 0.5, mid: 0.82, highMid: 0.7, high: 0.46 }, { beatPulseStrength: 0.8, barPulseStrength: 0.66, betweenBeatBreathing: 0.28, flickerAmount: 0.18 }, 1.18, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "orbiting-tetrahedrons", heroCouplingStrength: 0.84, particleCouplingStrength: 0.14, triggerCooldownBeats: 1 }),
  spec("countdown-triggered-collapsing-hexagons", "sigil-field", ["harmonic-lattice", "vector-incantation", "mandelbloom"], ["shattered-arc"], "architectural", { count: 12, spacing: 0.18, thickness: 0.018, depth: 0.52, scaleVariance: 0.2, symmetry: 0.84, density: 0.62 }, { driftScale: 0.08, jitterScale: 0.1, rotationScale: 0.14, expansionScale: 0.22, phaseRate: 0.64 }, { subLow: 0.38, low: 0.62, mid: 0.78, highMid: 0.54, high: 0.38 }, { beatPulseStrength: 0.54, barPulseStrength: 0.68, betweenBeatBreathing: 0.26, flickerAmount: 0.12 }, 1.14, { ...DEFAULT_META, triggerMode: "countdown", imageResponseMode: "density", familyVariant: "collapsing-hexagons", heroCouplingStrength: 0.2, particleCouplingStrength: 0, triggerCooldownBeats: 4 }),
  spec("audio-reactive-expanding-floor-tiles", "grid-field", ["neon-tube"], ["harmonic-lattice", "vector-incantation"], "glitch", { count: 18, spacing: 0.1, thickness: 0.024, depth: 0.42, scaleVariance: 0.16, symmetry: 0.82, density: 0.8 }, { driftScale: 0.1, jitterScale: 0.1, rotationScale: 0.02, expansionScale: 0.18, phaseRate: 0.96 }, { subLow: 0.52, low: 0.86, mid: 0.74, highMid: 0.48, high: 0.32 }, { beatPulseStrength: 0.92, barPulseStrength: 0.74, betweenBeatBreathing: 0.26, flickerAmount: 0.14 }, 1.18, { ...DEFAULT_META, triggerMode: "beat", imageResponseMode: "contrast", familyVariant: "floor-tiles", heroCouplingStrength: 0.16, particleCouplingStrength: 0, triggerCooldownBeats: 1 }),
  spec("hero-tracking-metronomic-pendulums", "line-field", ["cathedral-filament", "chromatic-xylem"], ["glass-orbital"], "ritual", { count: 12, spacing: 0.2, thickness: 0.016, depth: 0.48, scaleVariance: 0.16, symmetry: 0.78, density: 0.6 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.24, expansionScale: 0.1, phaseRate: 0.88 }, { subLow: 0.42, low: 0.6, mid: 0.74, highMid: 0.46, high: 0.28 }, { beatPulseStrength: 0.72, barPulseStrength: 0.8, betweenBeatBreathing: 0.36, flickerAmount: 0.12 }, 1.12, { ...DEFAULT_META, interactionMode: "hero-velocity", triggerMode: "bar", imageResponseMode: "density", familyVariant: "metronomic-pendulums", heroCouplingStrength: 0.8, particleCouplingStrength: 0.08, triggerCooldownBeats: 2 }),
  spec("kinetic-interlocking-cylinder-gears", "primitive-swarm", ["cathedral-filament", "data-cathedral"], ["harmonic-lattice"], "architectural", { count: 12, spacing: 0.18, thickness: 0.024, depth: 0.66, scaleVariance: 0.22, symmetry: 0.82, density: 0.66 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.28, expansionScale: 0.12, phaseRate: 0.82 }, { subLow: 0.58, low: 0.74, mid: 0.72, highMid: 0.38, high: 0.2 }, { beatPulseStrength: 0.58, barPulseStrength: 0.82, betweenBeatBreathing: 0.28, flickerAmount: 0.08 }, 1.16, { ...DEFAULT_META, triggerMode: "bar", imageResponseMode: "symmetry", familyVariant: "cylinder-gears", heroCouplingStrength: 0.12, particleCouplingStrength: 0, triggerCooldownBeats: 2, hazeAssist: true }),
  spec("tempo-matched-bouncing-arc-halos", "ring-field", ["glass-orbital", "mandelbloom", "halo-cell"], ["cathedral-filament"], "orbital", { count: 14, spacing: 0.16, thickness: 0.014, depth: 0.48, scaleVariance: 0.18, symmetry: 0.8, density: 0.68 }, { driftScale: 0.08, jitterScale: 0.06, rotationScale: 0.14, expansionScale: 0.18, phaseRate: 0.9 }, { subLow: 0.34, low: 0.54, mid: 0.84, highMid: 0.6, high: 0.34 }, { beatPulseStrength: 0.88, barPulseStrength: 0.7, betweenBeatBreathing: 0.36, flickerAmount: 0.14 }, 1.14, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "beat", imageResponseMode: "palette", familyVariant: "arc-halos", heroCouplingStrength: 0.78, particleCouplingStrength: 0.08, triggerCooldownBeats: 1 }),
  spec("velocity-scaled-trailing-prisms", "primitive-swarm", ["chromatic-xylem", "neon-tube"], ["vector-incantation"], "organic", { count: 16, spacing: 0.15, thickness: 0.016, depth: 0.52, scaleVariance: 0.28, symmetry: 0.42, density: 0.72 }, { driftScale: 0.12, jitterScale: 0.1, rotationScale: 0.22, expansionScale: 0.14, phaseRate: 0.92 }, { subLow: 0.26, low: 0.52, mid: 0.82, highMid: 0.74, high: 0.58 }, { beatPulseStrength: 0.76, barPulseStrength: 0.64, betweenBeatBreathing: 0.24, flickerAmount: 0.18 }, 1.16, { ...DEFAULT_META, interactionMode: "hero-velocity", triggerMode: "beat", imageResponseMode: "density", familyVariant: "trailing-prisms", heroCouplingStrength: 0.88, particleCouplingStrength: 0.72, triggerCooldownBeats: 1, supportsHeroParticles: true }),
  spec("collision-triggered-shattering-rhombuses", "sigil-field", ["shattered-arc"], ["film-bloom-shard", "vector-incantation"], "glitch", { count: 16, spacing: 0.14, thickness: 0.016, depth: 0.48, scaleVariance: 0.3, symmetry: 0.52, density: 0.74 }, { driftScale: 0.12, jitterScale: 0.18, rotationScale: 0.18, expansionScale: 0.18, phaseRate: 1.06 }, { subLow: 0.22, low: 0.48, mid: 0.78, highMid: 0.92, high: 0.88 }, { beatPulseStrength: 0.84, barPulseStrength: 0.62, betweenBeatBreathing: 0.18, flickerAmount: 0.34 }, 1.2, { ...DEFAULT_META, interactionMode: "hero-particle-collision", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "shattering-rhombuses", heroCouplingStrength: 0.86, particleCouplingStrength: 0.84, triggerCooldownBeats: 1, supportsHeroParticles: true }),
  spec("eddy-advect-plume", "plane-field", ["smoke-ribbon", "glass-orbital", "chromatic-xylem", "film-bloom-shard"], ["halo-cell", "mandelbloom", "cathedral-filament", "data-cathedral"], "organic", { count: 12, spacing: 0.18, thickness: 0.04, depth: 0.64, scaleVariance: 0.24, symmetry: 0.42, density: 0.6 }, { driftScale: 0.22, jitterScale: 0.08, rotationScale: 0.06, expansionScale: 0.22, phaseRate: 0.92 }, { subLow: 0.44, low: 0.66, mid: 0.82, highMid: 0.52, high: 0.34 }, { beatPulseStrength: 0.62, barPulseStrength: 0.7, betweenBeatBreathing: 0.5, flickerAmount: 0.12 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-velocity", triggerMode: "beat", imageResponseMode: "density", familyVariant: "advect-plume", heroCouplingStrength: 0.62, particleCouplingStrength: 0.78, triggerCooldownBeats: 1, supportsHeroParticles: true, hazeAssist: true }, 1.25),
  spec("plexus-neighbor-web", "line-field", ["vector-incantation", "harmonic-lattice", "data-cathedral", "glass-orbital"], ["cathedral-filament", "neon-tube", "mandelbloom", "halo-cell"], "architectural", { count: 18, spacing: 0.14, thickness: 0.012, depth: 0.54, scaleVariance: 0.2, symmetry: 0.72, density: 0.74 }, { driftScale: 0.12, jitterScale: 0.08, rotationScale: 0.14, expansionScale: 0.14, phaseRate: 0.84 }, { subLow: 0.26, low: 0.42, mid: 0.84, highMid: 0.82, high: 0.64 }, { beatPulseStrength: 0.78, barPulseStrength: 0.72, betweenBeatBreathing: 0.28, flickerAmount: 0.18 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-path-predictive", triggerMode: "collision", imageResponseMode: "symmetry", familyVariant: "plexus-web", heroCouplingStrength: 0.76, particleCouplingStrength: 0.84, triggerCooldownBeats: 1, supportsHeroParticles: true }, 1.25),
  spec("bass-well-orrery", "ring-field", ["glass-orbital", "mandelbloom", "halo-cell", "neon-tube"], ["harmonic-lattice", "smoke-ribbon", "cathedral-filament", "chromatic-xylem"], "orbital", { count: 10, spacing: 0.22, thickness: 0.018, depth: 0.72, scaleVariance: 0.2, symmetry: 0.82, density: 0.58 }, { driftScale: 0.1, jitterScale: 0.06, rotationScale: 0.18, expansionScale: 0.28, phaseRate: 0.68 }, { subLow: 1.02, low: 0.86, mid: 0.58, highMid: 0.26, high: 0.12 }, { beatPulseStrength: 0.84, barPulseStrength: 0.86, betweenBeatBreathing: 0.38, flickerAmount: 0.1 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "bar", imageResponseMode: "density", familyVariant: "gravity-orrery", heroCouplingStrength: 0.78, particleCouplingStrength: 0.76, triggerCooldownBeats: 1, supportsHeroParticles: true, hazeAssist: true }, 1.25),
  spec("voxel-depth-drift", "primitive-swarm", ["data-cathedral", "harmonic-lattice", "neon-tube", "shattered-arc"], ["vector-incantation", "glass-orbital", "film-bloom-shard", "cathedral-filament"], "architectural", { count: 18, spacing: 0.12, thickness: 0.024, depth: 0.84, scaleVariance: 0.24, symmetry: 0.56, density: 0.72 }, { driftScale: 0.12, jitterScale: 0.06, rotationScale: 0.24, expansionScale: 0.16, phaseRate: 0.9 }, { subLow: 0.42, low: 0.68, mid: 0.8, highMid: 0.62, high: 0.4 }, { beatPulseStrength: 0.72, barPulseStrength: 0.74, betweenBeatBreathing: 0.24, flickerAmount: 0.12 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-velocity", triggerMode: "beat", imageResponseMode: "contrast", familyVariant: "voxel-drift", heroCouplingStrength: 0.58, particleCouplingStrength: 0.72, triggerCooldownBeats: 1, supportsHeroParticles: true }, 1.25),
  spec("pressure-grid-plane", "grid-field", ["harmonic-lattice", "data-cathedral", "vector-incantation", "neon-tube"], ["glass-orbital", "shattered-arc", "film-bloom-shard", "cathedral-filament"], "architectural", { count: 20, spacing: 0.1, thickness: 0.014, depth: 0.44, scaleVariance: 0.12, symmetry: 0.88, density: 0.82 }, { driftScale: 0.1, jitterScale: 0.08, rotationScale: 0.04, expansionScale: 0.22, phaseRate: 1 }, { subLow: 0.62, low: 0.86, mid: 0.74, highMid: 0.48, high: 0.26 }, { beatPulseStrength: 0.9, barPulseStrength: 0.74, betweenBeatBreathing: 0.2, flickerAmount: 0.14 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "beat", imageResponseMode: "symmetry", familyVariant: "pressure-grid", heroCouplingStrength: 0.72, particleCouplingStrength: 0.42, triggerCooldownBeats: 1 }, 1.25),
  spec("boolean-aperture-cuts", "void-shape", ["shattered-arc", "vector-incantation", "harmonic-lattice", "film-bloom-shard"], ["neon-tube", "data-cathedral", "glass-orbital", "mandelbloom"], "glitch", { count: 8, spacing: 0.28, thickness: 0.08, depth: 0.62, scaleVariance: 0.24, symmetry: 0.52, density: 0.46 }, { driftScale: 0.08, jitterScale: 0.1, rotationScale: 0.14, expansionScale: 0.18, phaseRate: 0.72 }, { subLow: 0.34, low: 0.52, mid: 0.84, highMid: 0.76, high: 0.6 }, { beatPulseStrength: 0.8, barPulseStrength: 0.68, betweenBeatBreathing: 0.24, flickerAmount: 0.16 }, 1.22, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "collision", imageResponseMode: "contour", familyVariant: "aperture-cuts", heroCouplingStrength: 0.7, particleCouplingStrength: 0.22, triggerCooldownBeats: 1 }, 1.25),
  spec("metaball-merge-mass", "ring-field", ["halo-cell", "smoke-ribbon", "glass-orbital", "chromatic-xylem"], ["mandelbloom", "film-bloom-shard", "cathedral-filament", "data-cathedral"], "organic", { count: 16, spacing: 0.14, thickness: 0.02, depth: 0.5, scaleVariance: 0.28, symmetry: 0.48, density: 0.74 }, { driftScale: 0.14, jitterScale: 0.08, rotationScale: 0.08, expansionScale: 0.22, phaseRate: 0.74 }, { subLow: 0.46, low: 0.64, mid: 0.82, highMid: 0.5, high: 0.26 }, { beatPulseStrength: 0.74, barPulseStrength: 0.7, betweenBeatBreathing: 0.38, flickerAmount: 0.1 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-orbit", triggerMode: "beat", imageResponseMode: "palette", familyVariant: "metaball-merge", heroCouplingStrength: 0.8, particleCouplingStrength: 0.64, triggerCooldownBeats: 1, supportsHeroParticles: true, hazeAssist: true }, 1.25),
  spec("voronoi-drop-shatter", "sigil-field", ["shattered-arc", "film-bloom-shard", "vector-incantation", "harmonic-lattice"], ["neon-tube", "data-cathedral", "mandelbloom", "glass-orbital"], "glitch", { count: 16, spacing: 0.12, thickness: 0.018, depth: 0.52, scaleVariance: 0.32, symmetry: 0.42, density: 0.76 }, { driftScale: 0.14, jitterScale: 0.18, rotationScale: 0.18, expansionScale: 0.18, phaseRate: 1.02 }, { subLow: 0.26, low: 0.48, mid: 0.76, highMid: 0.92, high: 0.88 }, { beatPulseStrength: 0.88, barPulseStrength: 0.66, betweenBeatBreathing: 0.18, flickerAmount: 0.32 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-particle-collision", triggerMode: "collision", imageResponseMode: "contrast", familyVariant: "voronoi-shatter", heroCouplingStrength: 0.82, particleCouplingStrength: 0.82, triggerCooldownBeats: 1, supportsHeroParticles: true }, 1.25),
  spec("lissajous-sigil-loop", "sigil-field", ["vector-incantation", "harmonic-lattice", "glass-orbital", "mandelbloom"], ["cathedral-filament", "data-cathedral", "halo-cell", "neon-tube"], "ritual", { count: 12, spacing: 0.18, thickness: 0.014, depth: 0.58, scaleVariance: 0.2, symmetry: 0.9, density: 0.62 }, { driftScale: 0.08, jitterScale: 0.08, rotationScale: 0.2, expansionScale: 0.18, phaseRate: 0.86 }, { subLow: 0.28, low: 0.54, mid: 0.88, highMid: 0.72, high: 0.46 }, { beatPulseStrength: 0.74, barPulseStrength: 0.78, betweenBeatBreathing: 0.4, flickerAmount: 0.14 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-path-predictive", triggerMode: "four-bar", imageResponseMode: "symmetry", familyVariant: "lissajous-loop", heroCouplingStrength: 0.84, particleCouplingStrength: 0.54, triggerCooldownBeats: 4, supportsHeroParticles: true }, 1.25),
  spec("hard-pixel-lock", "grid-field", ["neon-tube", "shattered-arc", "harmonic-lattice", "film-bloom-shard"], ["vector-incantation", "data-cathedral", "mandelbloom", "glass-orbital"], "glitch", { count: 22, spacing: 0.08, thickness: 0.028, depth: 0.34, scaleVariance: 0.08, symmetry: 0.78, density: 0.86 }, { driftScale: 0.06, jitterScale: 0.12, rotationScale: 0.02, expansionScale: 0.08, phaseRate: 1.18 }, { subLow: 0.26, low: 0.52, mid: 0.72, highMid: 0.86, high: 0.94 }, { beatPulseStrength: 0.88, barPulseStrength: 0.64, betweenBeatBreathing: 0.14, flickerAmount: 0.2 }, 1.24, { ...DEFAULT_META, interactionMode: "hero-proximity", triggerMode: "beat", imageResponseMode: "contrast", familyVariant: "pixel-lock", heroCouplingStrength: 0.52, particleCouplingStrength: 0.18, triggerCooldownBeats: 1 }, 1.25),
  spec("crt-phosphor-mask", "stripe-field", ["neon-tube", "harmonic-lattice", "film-bloom-shard", "data-cathedral"], ["vector-incantation", "glass-orbital", "shattered-arc", "chromatic-xylem"], "glitch", { count: 30, spacing: 0.05, thickness: 0.01, depth: 0.22, scaleVariance: 0.06, symmetry: 0.92, density: 0.94 }, { driftScale: 0.04, jitterScale: 0.14, rotationScale: 0.01, expansionScale: 0.04, phaseRate: 1.22 }, { subLow: 0.14, low: 0.28, mid: 0.62, highMid: 0.88, high: 1.04 }, { beatPulseStrength: 0.76, barPulseStrength: 0.56, betweenBeatBreathing: 0.12, flickerAmount: 0.42 }, 1.24, { ...DEFAULT_META, interactionMode: "none", triggerMode: "silhouette-strobe", imageResponseMode: "contrast", familyVariant: "crt-mask", heroCouplingStrength: 0.1, particleCouplingStrength: 0.08, triggerCooldownBeats: 1 }, 1.25),
];

function continuityCompatible(a: BackgroundElementSpec, b: BackgroundElementSpec): boolean {
  return a.family === b.family || a.continuityCategory === b.continuityCategory || a.familyVariant === b.familyVariant;
}

export function backgroundElementPoolForMotif(motif: FractalMotif): BackgroundElementSpec[] {
  const pool = BACKGROUND_ELEMENT_SPECS.filter((entry) => entry.supportedMotifs.includes(motif));
  if (pool.length >= 4) {
    return pool;
  }
  const fallback = BACKGROUND_ELEMENT_SPECS.filter((entry) => entry.fallbackMotifs.includes(motif));
  return [...pool, ...fallback].filter((entry, index, all) => all.indexOf(entry) === index);
}

export function selectBackgroundElementSpec(params: {
  motif: FractalMotif;
  imagePath: string;
  continuitySeed: number;
  theme: RenderTheme;
  previousId?: BackgroundElementSpec["id"];
  preferHeroCoupling?: number;
  maskConfidence?: "low" | "medium" | "high";
}): BackgroundElementSpec | undefined {
  const pool = backgroundElementPoolForMotif(params.motif);
  if (pool.length === 0) {
    return undefined;
  }
  const previous = params.previousId ? BACKGROUND_ELEMENT_SPECS.find((entry) => entry.id === params.previousId) : undefined;
  const motifIntensityClass = classifyHeroMotifIntensity(params.motif);
  const weightedPool = pool
    .map((entry) => {
      const profile = params.theme.styleProfile;
      const symmetryBias = 1 + clamp((entry.geometryDefaults.symmetry - 0.5) * profile.symmetry, -0.2, 0.28);
      const densityBias = 1 + clamp((entry.geometryDefaults.density - 0.5) * profile.edgeDensity, -0.16, 0.22);
      const continuityBias = previous && continuityCompatible(previous, entry) ? 1.18 : 1;
      const repeatPenalty = previous?.id === entry.id ? 0.76 : 1;
      const heroCouplingBias = 1 + clamp(((params.preferHeroCoupling ?? 0.5) - 0.5) * entry.heroCouplingStrength * 0.6, -0.18, 0.26);
      const physicalCouplingStrength = entry.heroCouplingStrength * 0.55 + entry.particleCouplingStrength * 0.45;
      const physicalCouplingBias =
        motifIntensityClass === "restrained"
          ? 1 + clamp(physicalCouplingStrength * 0.08, 0, 0.08)
          : motifIntensityClass === "colorful-psychedelic"
            ? 1 + clamp(physicalCouplingStrength * 0.16, 0, 0.16)
            : 1 + clamp(physicalCouplingStrength * 0.1, 0, 0.1);
      const silhouettePenalty =
        (entry.imageResponseMode === "silhouette" || entry.triggerMode === "silhouette-strobe") && params.maskConfidence === "low"
          ? 0.66
          : 1;
      return {
        entry,
        weight: entry.motifAffinity * (entry.selectionWeight ?? 1) * symmetryBias * densityBias * continuityBias * repeatPenalty * heroCouplingBias * physicalCouplingBias * silhouettePenalty,
      };
    })
    .sort((a, b) => b.weight - a.weight);
  const total = weightedPool.reduce((sum, item) => sum + item.weight, 0);
  let cursor = seedToUnitFloat(stableHash32(`${params.imagePath}:${params.continuitySeed}:${params.motif}:${params.theme.styleProfile.imagePath}`)) * Math.max(total, 1);
  for (const item of weightedPool) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.entry;
    }
  }
  return weightedPool[0]?.entry;
}

export function motifPoolCategory(motif: FractalMotif): "glitch" | "film" | "orbital" | "cathedral" {
  if (glitchMotifs.includes(motif)) {
    return "glitch";
  }
  if (filmMotifs.includes(motif)) {
    return "film";
  }
  if (orbitalMotifs.includes(motif)) {
    return "orbital";
  }
  return cathedralMotifs.includes(motif) ? "cathedral" : "glitch";
}
