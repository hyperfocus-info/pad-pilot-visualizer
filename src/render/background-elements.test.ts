import { describe, expect, test } from "bun:test";
import type { RenderTheme } from "../types";
import { BACKGROUND_ELEMENT_SPECS, backgroundElementPoolForMotif, selectBackgroundElementSpec } from "./background-elements";

const theme = {
  styleProfile: {
    imagePath: "test-image.png",
    symmetry: 0.72,
    edgeDensity: 0.64,
  },
} as unknown as RenderTheme;

describe("background element selection", () => {
  test("catalog keeps a broad background surface without duplicate ids", () => {
    expect(BACKGROUND_ELEMENT_SPECS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BACKGROUND_ELEMENT_SPECS.map((entry) => entry.id)).size).toBe(BACKGROUND_ELEMENT_SPECS.length);
  });

  test("motif pools stay motif-tied", () => {
    const pool = backgroundElementPoolForMotif("shattered-arc");
    expect(pool.length).toBeGreaterThanOrEqual(6);
    expect(pool.some((entry) => entry.id === "twitching-glitch-rectangles")).toBe(true);
    expect(pool.some((entry) => entry.id === "stark-pixelated-punishment-blocks")).toBe(true);
    expect(pool.some((entry) => entry.id === "collision-triggered-shattering-rhombuses")).toBe(true);
    expect(pool.some((entry) => entry.id === "staccato-emulsion-slashes-piercing-hero")).toBe(true);
  });

  test("selection is deterministic for the same input", () => {
    const first = selectBackgroundElementSpec({
      motif: "glass-orbital",
      imagePath: "same-image.png",
      continuitySeed: 42,
      theme,
    });
    const second = selectBackgroundElementSpec({
      motif: "glass-orbital",
      imagePath: "same-image.png",
      continuitySeed: 42,
      theme,
    });
    expect(first?.id).toBe(second?.id);
  });

  test("low mask confidence penalizes silhouette-heavy picks", () => {
    const high = selectBackgroundElementSpec({
      motif: "film-bloom-shard",
      imagePath: "same-image.png",
      continuitySeed: 42,
      theme,
      maskConfidence: "high",
    });
    const low = selectBackgroundElementSpec({
      motif: "film-bloom-shard",
      imagePath: "same-image.png",
      continuitySeed: 42,
      theme,
      maskConfidence: "low",
    });
    expect(high).toBeDefined();
    expect(low).toBeDefined();
    expect(low?.imageResponseMode === "silhouette" && low?.triggerMode === "silhouette-strobe").toBe(false);
  });
});
