import { describe, expect, test } from "bun:test";
import { deriveEffectSeed, deriveParticleBias, deriveShapeBias } from "./image-style";

function makeProfile(overrides: Partial<Parameters<typeof deriveShapeBias>[0]> = {}): Parameters<typeof deriveShapeBias>[0] {
  return {
    imagePath: "fixture.png",
    firstPixelR: 0,
    firstPixelG: 0,
    firstPixelB: 0,
    averageR: 120,
    averageG: 120,
    averageB: 120,
    medianR: 120,
    medianG: 120,
    medianB: 120,
    modeR: 120,
    modeG: 120,
    modeB: 120,
    rangeR: 40,
    rangeG: 40,
    rangeB: 40,
    averageHue: 180,
    effectSeed: 0,
    effectBucket: 0,
    effectCycle: 0,
    effectMode: 0,
    transitionMode: 0,
    dominantHue: 180,
    hueVariance: 24,
    saturationMean: 0.45,
    lightnessMean: 0.42,
    warmCoolBias: 0,
    contrast: 0.2,
    edgeDensity: 0.35,
    symmetry: 0.5,
    clusterCount: 4,
    palette: [],
    ...overrides,
  };
}

describe("deriveEffectSeed", () => {
  test("different structure yields different seeds even when first-pixel red would match", () => {
    const left = deriveEffectSeed({
      averageR: 100,
      averageG: 120,
      averageB: 140,
      dominantHue: 180,
      hueVariance: 12,
      edgeDensity: 0.18,
      contrast: 0.1,
    });
    const right = deriveEffectSeed({
      averageR: 100,
      averageG: 120,
      averageB: 140,
      dominantHue: 240,
      hueVariance: 38,
      edgeDensity: 0.64,
      contrast: 0.31,
    });

    expect(left).not.toBe(right);
  });
});

describe("style bias derivation", () => {
  test("shape bias covers the intended visual families", () => {
    expect(deriveShapeBias(makeProfile({ edgeDensity: 0.72, contrast: 0.28, symmetry: 0.22, hueVariance: 18 }))).toBe("filament");
    expect(deriveShapeBias(makeProfile({ edgeDensity: 0.1, contrast: 0.08, symmetry: 0.48, hueVariance: 10 }))).toBe("cloud");
    expect(deriveShapeBias(makeProfile({ edgeDensity: 0.68, contrast: 0.34, symmetry: 0.18, hueVariance: 58 }))).toBe("shard");
    expect(deriveShapeBias(makeProfile({ edgeDensity: 0.44, contrast: 0.18, symmetry: 0.88, hueVariance: 12 }))).toBe("ring");
    expect(deriveShapeBias(makeProfile({ edgeDensity: 0.38, contrast: 0.22, symmetry: 0.52, hueVariance: 34, clusterCount: 8 }))).toBe("cellular");
  });

  test("particle bias covers the intended motion vocabularies", () => {
    expect(deriveParticleBias(makeProfile({ edgeDensity: 0.12, contrast: 0.08, hueVariance: 8 }))).toBe("dust");
    expect(deriveParticleBias(makeProfile({ edgeDensity: 0.22, contrast: 0.14, clusterCount: 2, hueVariance: 18 }))).toBe("orbs");
    expect(deriveParticleBias(makeProfile({ edgeDensity: 0.7, contrast: 0.22, hueVariance: 14, clusterCount: 5 }))).toBe("streaks");
    expect(deriveParticleBias(makeProfile({ edgeDensity: 0.66, contrast: 0.36, hueVariance: 54, clusterCount: 6 }))).toBe("shards");
    expect(deriveParticleBias(makeProfile({ edgeDensity: 0.4, contrast: 0.22, hueVariance: 28, clusterCount: 6 }))).toBe("mixed");
  });
});
