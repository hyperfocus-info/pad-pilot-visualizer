import type {
  FractalMotif,
  ParticleConceptId,
  ParticleConceptSpec,
  SpawnMotifFamily,
} from "../../types";
import { BACKGROUND_ELEMENT_SPECS } from "../background-elements";
import { EVENT_SPECS } from "../event-specs";
import { MOTIF_EFFECT_SPECS } from "../motif-effects";
import { PERSISTENT_MOTIF_SPECS } from "../persistent-motifs";

function motifFamilyForMotif(motif: FractalMotif): SpawnMotifFamily {
  switch (motif) {
    case "glass-orbital":
      return "orbital";
    case "halo-cell":
      return "cellular";
    case "smoke-ribbon":
    case "chromatic-xylem":
      return "ribbon";
    case "shattered-arc":
      return "fracture";
    case "harmonic-lattice":
    case "vector-incantation":
    case "neon-tube":
      return "grid";
    case "cathedral-filament":
    case "data-cathedral":
      return "cathedral";
    case "mandelbloom":
    case "film-bloom-shard":
    default:
      return "bloom";
  }
}

function particleConcept(
  id: ParticleConceptId,
  family: ParticleConceptSpec["family"],
  pitch: string,
  distinction: string,
): ParticleConceptSpec {
  return {
    id,
    family,
    pitch,
    distinction,
    eligibility: {
      regimes: ["intro", "groove", "build", "drop", "breakdown", "outro"],
      arcs: ["hold", "swap", "mixed", "punctuate"],
    },
    continuityPolicy:
      family === "accent"
        ? "punctuation"
        : family === "emission" || family === "motif"
          ? "reuse"
          : family === "episode"
            ? "swap-friendly"
            : "hold-friendly",
    runtimeTuning: {
      supportsMute: true,
    },
  };
}

export const SPAWN_BACKGROUND_CATALOG = BACKGROUND_ELEMENT_SPECS;
export const SPAWN_EVENT_CATALOG = EVENT_SPECS;
export const SPAWN_MOTIF_EFFECT_CATALOG = MOTIF_EFFECT_SPECS;
export const SPAWN_PERSISTENT_CONTINUITY_CATALOG = PERSISTENT_MOTIF_SPECS;
export const SPAWN_MOTIF_FAMILY_BY_MOTIF: Record<FractalMotif, SpawnMotifFamily> = {
  "glass-orbital": motifFamilyForMotif("glass-orbital"),
  "halo-cell": motifFamilyForMotif("halo-cell"),
  "smoke-ribbon": motifFamilyForMotif("smoke-ribbon"),
  "chromatic-xylem": motifFamilyForMotif("chromatic-xylem"),
  "shattered-arc": motifFamilyForMotif("shattered-arc"),
  "harmonic-lattice": motifFamilyForMotif("harmonic-lattice"),
  "vector-incantation": motifFamilyForMotif("vector-incantation"),
  "neon-tube": motifFamilyForMotif("neon-tube"),
  "cathedral-filament": motifFamilyForMotif("cathedral-filament"),
  "data-cathedral": motifFamilyForMotif("data-cathedral"),
  "mandelbloom": motifFamilyForMotif("mandelbloom"),
  "film-bloom-shard": motifFamilyForMotif("film-bloom-shard"),
};

export const PARTICLE_CONCEPT_SPECS: ParticleConceptSpec[] = [
  particleConcept("directive-follow-hero", "directive", "A follow hero particle concept that keeps particles wrapped around the hero path.", "It differs by centering behavior on hero-follow rather than on lane or anchor choreography."),
  particleConcept("directive-orbit-anchor", "directive", "An orbit anchor particle concept that keeps particles circling a stable attractor.", "It differs by committing to ritual anchor motion instead of free drift."),
  particleConcept("directive-braid-lane", "directive", "A braid lane particle concept that threads particles through readable directional lanes.", "It differs by favoring lane structure over radial motion."),
  particleConcept("directive-dual-well", "directive", "A dual well particle concept that balances particles between two attractors.", "It differs by splitting pull across paired anchors instead of one center."),
  particleConcept("directive-emit-to-edge", "directive", "An emit to edge particle concept that throws particles outward toward the canvas boundary.", "It differs by emphasizing escape and edge punctuation instead of retention."),
  particleConcept("directive-spiral-in", "directive", "A spiral in particle concept that tightens motion toward a center.", "It differs by collapsing motion inward instead of blooming outward."),
  particleConcept("directive-spiral-out", "directive", "A spiral out particle concept that expands motion away from the center.", "It differs by turning continuity into outward release instead of containment."),
  particleConcept("directive-burst-falloff", "directive", "A burst falloff particle concept that treats motion as short-lived remnant energy.", "It differs by decaying quickly after impact instead of sustaining a lane."),
  particleConcept("directive-signal-drift", "directive", "A signal drift particle concept that lets particles slide through the field with mild advection.", "It differs by prioritizing drift texture over discrete impacts."),
  particleConcept("directive-edge-fog", "directive", "An edge fog particle concept that keeps residue thin and atmospheric near the frame edge.", "It differs by acting as support haze rather than as a hero-owned burst."),
  particleConcept("directive-absorb-well", "directive", "An absorb well particle concept that pulls particles inward as if the scene is swallowing them.", "It differs by treating continuity as collection rather than emission."),
  particleConcept("directive-emit-chain", "directive", "An emit chain particle concept that releases particles in serial linked bursts.", "It differs by chaining release beats instead of scattering them evenly."),
  particleConcept("directive-release-bloom", "directive", "A release bloom particle concept that expands particles outward in a brief opened burst.", "It differs by blooming rather than latching or orbiting."),
  particleConcept("directive-play-scatter", "directive", "A play scatter particle concept that treats particles as lively paired motion instead of strict structure.", "It differs by allowing looser movement than the more authored directive concepts."),
  particleConcept("directive-escort", "directive", "An escort particle concept that keeps particles accompanying the scene without taking over.", "It differs by behaving as subordinate support instead of a primary gesture."),
  particleConcept("accent-emitters", "accent", "An emitter accent particle concept that adds extra release pressure around active beats.", "It differs by layering punctuation on top of the base concept set."),
  particleConcept("accent-absorbers", "accent", "An absorber accent particle concept that adds a temporary inward pull around active beats.", "It differs by adding sink behavior instead of extra outward release."),
  particleConcept("accent-release-bloom", "accent", "A release bloom accent particle concept that adds a scene-wide punctuation burst.", "It differs by existing only as a transient accent layer."),
  particleConcept("emission-breath", "emission", "A breath emission particle concept that keeps hero emission gentle and cyclical.", "It differs by reading as baseline presence instead of a hard directional push."),
  particleConcept("emission-crown-spray", "emission", "A crown spray emission particle concept that throws particles outward from the hero crown.", "It differs by pushing upward and outward rather than down a spine."),
  particleConcept("emission-spine-fountain", "emission", "A spine fountain emission particle concept that shoots particles through a narrow vertical core.", "It differs by using a central fountain instead of a wide spray."),
  particleConcept("emission-orbit-shed", "emission", "An orbit shed emission particle concept that sheds particles while the hero stays in orbital motion.", "It differs by keeping emission tied to orbit continuity."),
  particleConcept("emission-mouth-flare", "emission", "A mouth flare emission particle concept that punches a brief forward-facing burst from the hero.", "It differs by acting as a direct flare instead of a continuous trail."),
  particleConcept("emission-hand-cascade", "emission", "A hand cascade emission particle concept that releases particles in a directional falling stream.", "It differs by behaving like a guided cascade rather than a radial spray."),
  particleConcept("sub-petal-shed", "sub-emitter", "A petal shed sub-emitter concept that lets secondary particles peel away in soft fragments.", "It differs by favoring soft fragment loss over sharp electrical forks."),
  particleConcept("sub-spark-fork", "sub-emitter", "A spark fork sub-emitter concept that splits secondary particles into sharp conductive branches.", "It differs by favoring electrical forks over circular echoes."),
  particleConcept("sub-echo-ring", "sub-emitter", "An echo ring sub-emitter concept that adds circular support pulses around the hero.", "It differs by reinforcing continuity through ring echoes instead of debris."),
  particleConcept("sub-mask-fracture", "sub-emitter", "A mask fracture sub-emitter concept that breaks secondary particles into sharper shards.", "It differs by reading as fracture instead of echo or dust."),
  particleConcept("sub-dust-afterimage", "sub-emitter", "A dust afterimage sub-emitter concept that leaves a faint secondary residue trail.", "It differs by acting as afterimage carry rather than a discrete burst."),
  particleConcept("episode-reflective-core", "episode", "A reflective core particle concept that adds mirrored support behaviors for reflective scene episodes.", "It differs by appearing only when the scene identity explicitly turns reflective."),
  particleConcept("episode-kaleido-shear", "episode", "A kaleido shear particle concept that adds sheared mirrored support in kaleidoscopic episodes.", "It differs by emphasizing sheared mirror motion over orbital symmetry."),
  particleConcept("episode-paired-braid", "episode", "A paired braid particle concept that threads paired support lines through reflective episodes.", "It differs by doubling lane structure instead of widening orbit motion."),
  particleConcept("episode-prism-well", "episode", "A prism well particle concept that adds a prismatic ritual pull around reflective heroes.", "It differs by behaving like a gravity well instead of a braid or shear."),
  particleConcept("motif-halo-cell", "motif", "A halo cell particle concept that turns hero motion into flocked cells with faint residue.", "It differs from glass orbital by behaving as clustered cellular motion instead of orbital mechanics."),
  particleConcept("motif-smoke-ribbon", "motif", "A smoke ribbon particle concept that stretches particles into advected ribbon traces and residue.", "It differs by acting like flowing trail material instead of rigid lattice or orbital structure."),
  particleConcept("motif-glass-orbital", "motif", "A glass orbital particle concept that locks motion into gravity-like rings and depth cues.", "It differs from halo cell by reading as orbital mechanics instead of living clustered cells."),
  particleConcept("motif-data-cathedral", "motif", "A data cathedral particle concept that treats particles as conductive architecture with depth scaffolding.", "It differs by favoring latches and voxel depth over fluid or organic residue."),
  particleConcept("motif-harmonic-lattice", "motif", "A harmonic lattice particle concept that turns particles into linked grid tension and conductive supports.", "It differs by reading as a tense lattice instead of the more volumetric cathedral variant."),
  particleConcept("motif-film-bloom-shard", "motif", "A film bloom shard particle concept that mixes decaying shard bursts with emulsion-like residue.", "It differs by pairing cinematic bloom decay with shatter remnants."),
  particleConcept("motif-shattered-arc", "motif", "A shattered arc particle concept that throws sharp rebound fragments through unstable wells.", "It differs by leaning into rebound fracture rather than smooth ribbon or ring behavior."),
  particleConcept("motif-mandelbloom", "motif", "A mandelbloom particle concept that grows flocked bloom motion with morphing support shapes.", "It differs by emphasizing recursive bloom growth rather than strict orbital or grid logic."),
  particleConcept("motif-chromatic-xylem", "motif", "A chromatic xylem particle concept that advects particles like branching sap with thin residue.", "It differs by reading as branching flow instead of smoke ribbon haze."),
  particleConcept("motif-vector-incantation", "motif", "A vector incantation particle concept that turns particles into linked directional glyph strokes.", "It differs by feeling like drawn vector marks instead of harmonic grid tension."),
];

export function particleConceptById(id: ParticleConceptId): ParticleConceptSpec | undefined {
  return PARTICLE_CONCEPT_SPECS.find((entry) => entry.id === id);
}
