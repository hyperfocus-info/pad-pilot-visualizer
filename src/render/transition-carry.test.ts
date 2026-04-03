import { describe, expect, test } from "bun:test";
import { resolveTransitionCarryProfile } from "./transition-carry";

describe("transition carry policy", () => {
  test("keeps full carry when outgoing particles are visibly populated", () => {
    const profile = resolveTransitionCarryProfile({
      family: "halo-drift",
      grammar: "halo-drift",
      outgoingParticleVisibleCount: 14,
      outgoingHeroParticleRenderedCount: 2,
      supportFromCount: 2,
      supportToCount: 1,
      hasTransitionGraph: true,
    });

    expect(profile.mode).toBe("full");
    expect(profile.reason).toBe("ok");
    expect(profile.allowMorph).toBe(true);
    expect(profile.allowParticleDrivenFamily).toBe(true);
  });

  test("falls back to snapshot-only when outgoing particles are depleted", () => {
    const profile = resolveTransitionCarryProfile({
      family: "ethereal-particle-drift",
      grammar: "cosmic-dispersion",
      outgoingParticleVisibleCount: 4,
      outgoingHeroParticleRenderedCount: 1,
      supportFromCount: 2,
      supportToCount: 2,
      hasTransitionGraph: true,
    });

    expect(profile.mode).toBe("snapshot-only");
    expect(profile.reason).toBe("outgoing-particles-depleted");
    expect(profile.allowMorph).toBe(false);
    expect(profile.allowParticleDrivenFamily).toBe(false);
  });

  test("falls back to snapshot-only when bridge support detail is missing", () => {
    const profile = resolveTransitionCarryProfile({
      family: "halo-drift",
      grammar: "halo-drift",
      outgoingParticleVisibleCount: 18,
      outgoingHeroParticleRenderedCount: 8,
      supportFromCount: 0,
      supportToCount: 0,
      hasTransitionGraph: true,
    });

    expect(profile.mode).toBe("snapshot-only");
    expect(profile.reason).toBe("missing-bridge-detail");
    expect(profile.allowMorph).toBe(false);
    expect(profile.allowParticleDrivenFamily).toBe(true);
  });

  test("falls back to snapshot-only when transition graph detail is missing", () => {
    const profile = resolveTransitionCarryProfile({
      family: "gilligan-time-lapse-particle-sand",
      grammar: "particle-sand",
      outgoingParticleVisibleCount: 18,
      outgoingHeroParticleRenderedCount: 8,
      supportFromCount: 0,
      supportToCount: 0,
      hasTransitionGraph: false,
    });

    expect(profile.mode).toBe("snapshot-only");
    expect(profile.reason).toBe("missing-transition-graph");
    expect(profile.allowMorph).toBe(false);
    expect(profile.allowParticleDrivenFamily).toBe(false);
  });

  test("non-risky families stay allowed even when carry is thin", () => {
    const profile = resolveTransitionCarryProfile({
      family: "halo-drift",
      grammar: "halo-drift",
      outgoingParticleVisibleCount: 2,
      outgoingHeroParticleRenderedCount: 0,
      supportFromCount: 2,
      supportToCount: 2,
      hasTransitionGraph: true,
    });

    expect(profile.mode).toBe("snapshot-only");
    expect(profile.reason).toBe("outgoing-particles-depleted");
    expect(profile.allowParticleDrivenFamily).toBe(true);
  });
});
