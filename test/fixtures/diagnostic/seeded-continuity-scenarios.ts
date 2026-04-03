export interface SeededScenarioSpec {
  id: "hero-hold" | "mirror-dialogue" | "energy-recovery";
  description: string;
  frameNarrative: number[];
  expectedRelationshipMode?: "mirror-x" | "independent";
}

export const SEEDED_CONTINUITY_SCENARIOS: SeededScenarioSpec[] = [
  {
    id: "hero-hold",
    description: "Same image identity across a long phrase window should preserve motif lineage and path coherence.",
    frameNarrative: [0.2, 0.24, 0.28, 0.3, 0.32, 0.34],
  },
  {
    id: "mirror-dialogue",
    description: "Mirrored multi-hero staging should remain bilaterally readable through continuity mutation.",
    frameNarrative: [0.35, 0.42, 0.5, 0.56],
    expectedRelationshipMode: "mirror-x",
  },
  {
    id: "energy-recovery",
    description: "A calm baseline should recover hero particle force at peak without losing continuity lineage.",
    frameNarrative: [0.16, 0.2, 0.28, 0.46, 0.72, 0.94],
  },
];
