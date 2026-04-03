import { clamp } from "../config";
import type { TransitionCarryProfile, TransitionFamily } from "../types";

const RISKY_TRANSITION_GRAMMARS = new Set([
  "grid-panel",
  "cosmic-dispersion",
  "camera-particle-sweep",
  "particle-sand",
]);

export interface ResolveTransitionCarryProfileParams {
  family: TransitionFamily;
  grammar?: string;
  outgoingParticleVisibleCount: number;
  outgoingHeroParticleRenderedCount: number;
  supportFromCount: number;
  supportToCount: number;
  hasTransitionGraph: boolean;
}

export function resolveTransitionCarryProfile(params: ResolveTransitionCarryProfileParams): TransitionCarryProfile {
  const availabilityScore = clamp(
    Math.max(
      params.outgoingParticleVisibleCount / 12,
      params.outgoingHeroParticleRenderedCount / 6,
    ),
    0,
    1,
  );
  const hasBridgeDetail = params.supportFromCount + params.supportToCount > 0;
  const riskyGrammar = params.grammar !== undefined && RISKY_TRANSITION_GRAMMARS.has(params.grammar);
  const mode =
    availabilityScore >= 1 && hasBridgeDetail && params.hasTransitionGraph
      ? "full"
      : "snapshot-only";
  const reason =
    mode === "full"
      ? "ok"
      : !params.hasTransitionGraph
        ? "missing-transition-graph"
        : !hasBridgeDetail
          ? "missing-bridge-detail"
          : "outgoing-particles-depleted";

  return {
    mode,
    availabilityScore,
    reason,
    allowMorph: mode === "full",
    allowParticleDrivenFamily: mode === "full" || !riskyGrammar,
  };
}
